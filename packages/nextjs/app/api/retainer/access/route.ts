import { NextResponse } from "next/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentRequirements, ResourceInfo } from "@x402/core/types";
import { getAddress, isAddress } from "viem";
import {
  RetainerNotDeployedError,
  getRetainerAddress,
  hasAccess,
  openSubscriptionFor,
  subscriptionOf,
} from "~~/services/retainer/server";
import {
  HBAR_ASSET,
  MAX_TIMEOUT_SECONDS,
  X402_NETWORK,
  getResourceServer,
  makeHttpContext,
} from "~~/services/x402/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An x402-gated resource whose access renews itself.
 *
 * The ordinary x402 pattern charges on **every** request: 402, sign, retry, pay, repeat
 * forever. That works for one-off calls and breaks for anything an agent needs continuously
 * — somebody has to keep paying, so somebody has to stay awake.
 *
 * Here the gate is an on-chain subscription (`RetainerAccess`) that renews itself through the
 * Hedera Schedule Service. So:
 *
 *   request 1  no subscription  -> 402, pay once through Blocky402, access granted
 *   request 2  window still open -> 200, **no payment**, no challenge
 *   request N  after expiry      -> 200 anyway, because the contract renewed itself
 *
 * The interesting response is the second one. Nothing was paid, nothing was signed, and no
 * human or cron job was involved — the access window was extended by a call the network
 * executed on the contract's behalf.
 *
 * Settlement goes through the hosted Blocky402 facilitator (`FACILITATOR_URL`), which is what
 * the Hedera track requires; the payment itself is a native Hedera `TransferTransaction`.
 */

/** Where subscription payments go. The seller's Hedera account. */
const PAY_TO = process.env.RETAINER_PAY_TO ?? "";
/** Price of one period, in tinybar. Must match the contract's own terms. */
const PERIOD_PRICE_TINYBAR = BigInt(process.env.RETAINER_PRICE_TINYBAR ?? "100000000");
/**
 * How many periods one x402 payment buys.
 *
 * More than one on purpose. The first period is charged the moment the subscription opens;
 * every period after it is charged by a renewal the network executes on its own. Selling a
 * single period would mean the interesting thing never happens.
 */
const PERIODS_PER_PURCHASE = BigInt(process.env.RETAINER_PERIODS_PER_PURCHASE ?? "3");
/** What the 402 actually charges. */
const PRICE_TINYBAR = (PERIOD_PRICE_TINYBAR * PERIODS_PER_PURCHASE).toString();

/**
 * Build the 402 challenge. The body the resource server produces is also what goes in the
 * `PAYMENT-REQUIRED` header — x402 clients parse that shape, so it is emitted verbatim
 * rather than hand-rolled.
 */
async function paymentRequired(
  server: Awaited<ReturnType<typeof getResourceServer>>,
  requirements: PaymentRequirements[],
  info: ResourceInfo,
  error = "Payment required to open a Retainer subscription",
) {
  const body = await server.createPaymentRequiredResponse(requirements, info, error);
  const res = NextResponse.json(body, { status: 402 });
  res.headers.set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(body));
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentParam = url.searchParams.get("agent");

  if (!agentParam || !isAddress(agentParam)) {
    return NextResponse.json({ error: "Provide ?agent=<evm address>" }, { status: 400 });
  }
  const agent = getAddress(agentParam);

  if (!getRetainerAddress()) {
    return NextResponse.json({ error: new RetainerNotDeployedError().message }, { status: 503 });
  }

  // ── The gate. One on-chain question.
  let open = false;
  let sub;
  try {
    open = await hasAccess(agent);
    sub = await subscriptionOf(agent);
  } catch (error) {
    console.error("[api/retainer/access] contract read failed", error);
    return NextResponse.json({ error: "Failed to read RetainerAccess" }, { status: 502 });
  }

  // ── Access already held: serve it, charge nothing.
  // This is the whole point. No 402, no signature, no human — the subscription
  // extended itself while nobody was watching.
  if (open) {
    return NextResponse.json({
      access: "granted",
      paidThisRequest: false,
      why: "an on-chain subscription is open; it renews itself via the Hedera Schedule Service",
      subscription: {
        expiresAt: Number(sub.expiresAt),
        secondsRemaining: Math.max(0, Number(sub.expiresAt) - Math.floor(Date.now() / 1000)),
        periodSeconds: sub.periodSeconds,
        balanceTinybar: sub.balance.toString(),
        active: sub.active,
        nextRenewalSchedule: sub.schedule,
      },
      resource: { message: "This is the protected resource. You did not pay for this request." },
    });
  }

  // ── No access: charge for it through Blocky402.
  if (!PAY_TO) {
    return NextResponse.json({ error: "RETAINER_PAY_TO is not configured" }, { status: 500 });
  }

  const { context, resourceUrl } = makeHttpContext(req);

  let server;
  try {
    server = await getResourceServer();
  } catch (error) {
    console.error("[api/retainer/access] facilitator unavailable", error);
    return NextResponse.json({ error: "Payment facilitator unavailable" }, { status: 502 });
  }

  const requirements = await server.buildPaymentRequirementsFromOptions(
    [
      {
        scheme: "exact",
        network: X402_NETWORK,
        payTo: PAY_TO,
        price: { asset: HBAR_ASSET, amount: PRICE_TINYBAR },
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      },
    ],
    context,
  );

  const info: ResourceInfo = {
    url: resourceUrl,
    description: "Retainer — self-renewing access",
    mimeType: "application/json",
  };

  if (!context.paymentHeader) return await paymentRequired(server, requirements, info);

  let payload;
  try {
    payload = decodePaymentSignatureHeader(context.paymentHeader);
  } catch {
    return await paymentRequired(server, requirements, info, "Malformed payment header");
  }

  const matched = server.findMatchingRequirements(requirements, payload);
  if (!matched) return await paymentRequired(server, requirements, info, "Payment does not match requirements");

  const verification = await server.verifyPayment(payload, matched);
  if (!verification.isValid) {
    const reason =
      ("invalidMessage" in verification && typeof verification.invalidMessage === "string"
        ? verification.invalidMessage
        : undefined) ??
      verification.invalidReason ??
      "Payment is not valid";
    return await paymentRequired(server, requirements, info, reason);
  }

  // Settle through Blocky402. Only serve once funds are actually captured.
  const settlement = await server.settlePayment(payload, matched);
  if (!settlement.success) {
    return NextResponse.json({ error: "Payment settlement failed", reason: settlement.errorReason }, { status: 402 });
  }

  // ── Turn the settled payment into on-chain subscription state.
  //
  // This is the join. The agent signed one off-chain x402 payment; the seller received it and
  // now forwards the same amount into RetainerAccess, which opens the subscription and arms
  // the first scheduled renewal. From here the Hedera Schedule Service keeps the window alive
  // and the agent never signs anything again — which is the entire product.
  let subscriptionTx: string | undefined;
  let subscriptionError: string | undefined;
  try {
    subscriptionTx = await openSubscriptionFor(agent, PERIOD_PRICE_TINYBAR * PERIODS_PER_PURCHASE);
  } catch (error) {
    // The payment is already captured, so the request is still served. Report the failure
    // honestly rather than implying a subscription exists when it does not.
    subscriptionError = error instanceof Error ? error.message : String(error);
    console.error("[api/retainer/access] settled payment but failed to open subscription", error);
  }

  const res = NextResponse.json({
    access: "granted",
    paidThisRequest: true,
    why: "paid via x402, settled through the Blocky402 facilitator on Hedera",
    payment: {
      transaction: settlement.transaction,
      payer: settlement.payer,
      network: settlement.network,
    },
    subscription: subscriptionTx
      ? {
          opened: true,
          transaction: subscriptionTx,
          periodsPurchased: Number(PERIODS_PER_PURCHASE),
          why: "the settled payment was forwarded into RetainerAccess; the first renewal is scheduled",
          nextStep: "Ask again after this window expires. It will still be 200, and nothing will have been paid.",
        }
      : { opened: false, error: subscriptionError },
    resource: { message: "This is the protected resource." },
  });
  res.headers.set("PAYMENT-RESPONSE", encodePaymentResponseHeader(settlement));
  return res;
}
