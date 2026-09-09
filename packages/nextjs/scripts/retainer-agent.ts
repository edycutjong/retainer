/**
 * The Retainer demo, end to end, as an agent experiences it.
 *
 *   1. request  -> 402. The agent signs a Hedera payment; Blocky402 settles it.
 *   2. the server forwards that settled payment into subscribeFor(agent), which opens the
 *      self-renewing subscription. (Without RETAINER_SERVER_KEY the server cannot forward,
 *      and the script opens the subscription itself so the rest of the demo still runs.)
 *   3. request  -> 200, and nothing was paid.
 *   4. wait past expiry, sending nothing at all.
 *   5. request  -> 200 again, because the contract renewed itself.
 *
 * Step 5 is the point. No human, no cron, no second payment.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 yarn tsx scripts/retainer-agent.ts
 */
import { PrivateKey } from "@hiero-ledger/sdk";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network } from "@x402/core/types";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RPC = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
const NETWORK = (process.env.X402_NETWORK ?? "hedera:testnet") as Network;
/** Override the wait; unset means "read the seller's period off the contract". */
const PERIOD = process.env.PERIOD_SECONDS ? Number(process.env.PERIOD_SECONDS) : undefined;

function cred(k: string): string {
  const m = readFileSync(join(homedir(), ".config/retainer/hedera.env"), "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`missing ${k} in ~/.config/retainer/hedera.env`);
  return m[1].trim();
}

const ABI = [
  // `subscribe()` takes no arguments: the terms are the seller's, set with `setTerms`.
  "function subscribe() payable",
  "function pricePerPeriod() view returns (uint256)",
  "function periodSeconds() view returns (uint32)",
  "function subscriptionOf(address) view returns (uint256,uint256,uint256,uint32,bool,address)",
  "function cancel()",
];

async function ask(agent: string, label: string) {
  const res = await fetch(`${BASE}/api/retainer/access?agent=${agent}`);
  const body: any = await res.json().catch(() => ({}));
  console.log(
    `  ${label}: HTTP ${res.status}` + (res.status === 200 ? `  paidThisRequest=${body.paidThisRequest}` : ""),
  );
  if (res.status === 200 && body.subscription) {
    console.log(
      `     window ${body.subscription.secondsRemaining}s remaining · renewal scheduled at ${body.subscription.nextRenewalSchedule}`,
    );
  }
  return { res, body };
}

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const buyerKey = cred("BUYER_PRIVATE_KEY");
  const wallet = new Wallet(buyerKey, provider);
  const agent = wallet.address;
  const contractAddr = process.env.RETAINER_ACCESS_ADDRESS ?? cred("RETAINER_ACCESS_ADDRESS");

  console.log(`agent    ${agent}`);
  console.log(`contract ${contractAddr}\n`);

  // ── 1. cold: no subscription, so the resource costs money
  console.log("1) cold request — expect 402");
  const first = await fetch(`${BASE}/api/retainer/access?agent=${agent}`);
  console.log(`  HTTP ${first.status}`);
  if (first.status !== 402) {
    // Access is still open from an earlier run. Cancelling stops the renewals and refunds the
    // unspent balance, but it does NOT revoke the window already paid for — so the demo has to
    // wait that out either way. Only cancel if there is still a subscription to cancel;
    // cancel() reverts once pricePerPeriod has been zeroed by a previous cancel.
    const c = new Contract(contractAddr, ABI, wallet);
    const [, price, expiresAt] = await c.subscriptionOf(agent);
    if (price > 0n) {
      console.log("  (already subscribed — cancelling so the demo starts cold)");
      await (await c.cancel({ gasLimit: 1_000_000 })).wait();
    }
    const waitFor = Number(expiresAt) - Math.floor(Date.now() / 1000);
    console.log(
      waitFor > 0
        ? `  the paid window still has ${waitFor}s to run; re-run after it expires for the cold path`
        : "  re-run to see the cold path",
    );
    return;
  }

  // ── 2. pay through Blocky402
  console.log("\n2) paying via x402 — settled by Blocky402");
  const privateKey = PrivateKey.fromStringECDSA(buyerKey);
  const signer = createClientHederaSigner(cred("BUYER_ACCOUNT_ID"), privateKey, { network: NETWORK });
  // @x402/core 2.25 enforces spend controls before any policy: only assets its own
  // `findDefaultAsset` recognises are payable, and native HBAR on Hedera is not one of
  // them. The challenge asks for asset "0.0.0" (HBAR), so the default client rejects it
  // before it ever signs. Allow that one asset explicitly, with a cap — disabling spend
  // controls entirely (`spendControls: false`) would also work and is worse: an agent
  // that pays unattended should keep a ceiling.
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactHederaScheme(signer) }],
    spendControls: {
      allowedAssets: [{ network: NETWORK, asset: "0.0.0", maxAmountPerPayment: "1000000000" }],
    },
  });
  const http = new x402HTTPClient(client);

  const challenge = await first
    .clone()
    .json()
    .catch(() => undefined);
  const required = http.getPaymentRequiredResponse(n => first.headers.get(n), challenge);
  const payload = await http.createPaymentPayload(required);
  const paid = await fetch(`${BASE}/api/retainer/access?agent=${agent}`, {
    headers: http.encodePaymentSignatureHeader(payload),
  });
  const paidBody: any = await paid
    .clone()
    .json()
    .catch(() => ({}));
  const result = await http.processResponse(paid);
  if (result.paymentStatus !== "settled") throw new Error(`payment failed: ${result.paymentStatus}`);
  const settle = result.header as { transaction: string };
  console.log(`  ✅ settled · tx ${settle.transaction}`);
  console.log(`  https://hashscan.io/testnet/transaction/${settle.transaction}`);

  // ── 3. the self-renewing subscription
  //
  // With RETAINER_SERVER_KEY set, the resource server has already forwarded the settled
  // payment into subscribeFor(agent) — the agent holds a self-renewing subscription without
  // ever signing an on-chain transaction, and calling subscribe() here would revert with
  // AlreadyActive. Only when that key is absent does the agent open the subscription itself.
  const c = new Contract(contractAddr, ABI, wallet);
  if (paidBody?.subscription?.opened) {
    console.log("\n3) the server opened the subscription with the settled payment");
    console.log(`  subscribed · tx ${paidBody.subscription.transaction}`);
  } else {
    console.log("\n3) no server-side forward — opening the subscription directly");
    // Terms are the seller's; the agent only chooses how many periods to fund. `value` on the
    // wire is weibar (1e18) and the relay converts it to the tinybar the EVM sees (1e8).
    const price: bigint = await c.pricePerPeriod();
    const funding = price * 4n * 10n ** 10n; // 4 periods
    const tx = await c.subscribe({ value: funding, gasLimit: 2_000_000 });
    await tx.wait();
    console.log(`  subscribed · tx ${tx.hash}`);
  }

  // ── 4. the same request, now free
  console.log("\n4) same request again");
  await ask(agent, "warm request");

  // ── 5. wait past expiry, sending nothing. The period is the seller's, read from the
  //      contract, so this waits for the window that actually exists.
  const period = PERIOD ?? Number(await c.periodSeconds());
  console.log(`\n5) waiting ${period + 45}s past expiry — sending NOTHING`);
  await new Promise(r => setTimeout(r, (period + 45) * 1000));
  const after = await ask(agent, "post-expiry request");

  console.log("\n─────────────────────────────────────────");
  if (after.res.status === 200 && after.body.paidThisRequest === false) {
    console.log("✅ Access survived expiry with no payment and no transaction from us.");
    console.log("   The contract renewed itself.");
  } else {
    console.log(`⚠️  expected a free 200 after expiry, got ${after.res.status}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
