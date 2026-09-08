# 01 — Pick the Hedera x402 track, and the self-renewal angle

**Commit produced:** none directly. This is pre-code direction; the first commit that came
out of it is `4a0ddc3` (see `02-facilitator-spike-and-scaffold-import.md`).
**When:** 2026-09-07, before any code was written.

## The direction given

Build for Hedera's x402 bounty. Read its requirements as hard binary gates and design
backwards from them, not from what demos well. The gates are:

1. a live x402-gated service on Hedera testnet, settled through the **Blocky402** facilitator;
2. a platform or agent that consumes it and completes at least one real paid request end to end;
3. a public GitHub repo with a README covering setup, architecture, and the payment flow;
4. a demo video (ETHGlobal's own 2–4 minute cap is the binding one).

Then find the one thing that is *not* the obvious build. The obvious x402 build is
pay-per-request: charge on every call. Everyone entering this track will ship that, because
it is what the reference implementations do.

The angle to build instead: **an agent can pay for a thing, but an agent cannot subscribe to
a thing, because every renewal needs somebody awake to re-authorise it.** Remove that person.
Hedera has a primitive no other chain in this event has — the Schedule Service (HIP-1215,
system contract `0x16b`) — which lets a contract ask the network to call a function on it at
a future second. A subscription contract can therefore schedule its own next renewal.

Constraint on the angle: the Schedule Service must be the engine, not decoration. If the
renewal could be done by a cron job on a server, the project is a cron job with extra steps.
The demo has to be a window that expires while nothing is running and stays open anyway.

## Why it was given then

Choosing the track fixes the gates, and the gates fix the architecture. Doing this before any
code meant the differentiator (self-renewal) and the mandatory rail (x402 through Blocky402)
were designed as one system rather than bolted together late — which is exactly the failure
mode that shows up as a sponsor SDK used decoratively at the end of a build.

## What it committed us to

- Hedera testnet, not mainnet, not another chain.
- Blocky402 hosted as the settlement path — non-negotiable, and worth verifying on day one
  rather than assuming (which is what step 02 does).
- A Solidity contract that calls the Schedule Service on itself, rather than a scheduler
  service in the resource server.
