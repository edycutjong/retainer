import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import {
  RetainerNotDeployedError,
  getRetainerAddress,
  renewalsRemaining,
  subscriptionOf,
} from "~~/services/retainer/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only subscription state, safe to poll.
 *
 * Deliberately separate from `/api/retainer/access`. That route is the *gate*: asking it about
 * an agent with no access starts a payment — it builds requirements, talks to the facilitator
 * and answers 402. A UI that polled it every second would be repeatedly opening payment
 * challenges just to draw a countdown.
 *
 * This route asks the chain and nothing else, so the live view can watch a window tick down
 * and a renewal fire without ever touching the payment path.
 */
export async function GET(req: Request) {
  const agentParam = new URL(req.url).searchParams.get("agent");
  if (!agentParam || !isAddress(agentParam)) {
    return NextResponse.json({ error: "Provide ?agent=<evm address>" }, { status: 400 });
  }
  const agent = getAddress(agentParam);

  const contract = getRetainerAddress();
  if (!contract) {
    return NextResponse.json({ error: new RetainerNotDeployedError().message }, { status: 503 });
  }

  try {
    const [sub, reserve] = await Promise.all([subscriptionOf(agent), renewalsRemaining()]);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number(sub.expiresAt);

    return NextResponse.json({
      agent,
      contract,
      // The gate's own question, answered from the same state the contract uses.
      hasAccess: now < expiresAt,
      expiresAt,
      secondsRemaining: Math.max(0, expiresAt - now),
      periodSeconds: sub.periodSeconds,
      pricePerPeriodTinybar: sub.pricePerPeriod.toString(),
      balanceTinybar: sub.balance.toString(),
      // How many more times this subscription can renew before the money runs out.
      periodsFunded: sub.pricePerPeriod > 0n ? Number(sub.balance / sub.pricePerPeriod) : 0,
      active: sub.active,
      // The pending scheduled call. Non-zero means the network is holding a renewal for us.
      nextRenewalSchedule: sub.schedule,
      // How many further renewals the seller's gas reserve can arm, for anyone.
      renewalsReserveCanArm: Number(reserve),
      now,
    });
  } catch (error) {
    console.error("[api/retainer/status] contract read failed", error);
    return NextResponse.json({ error: "Failed to read RetainerAccess" }, { status: 502 });
  }
}
