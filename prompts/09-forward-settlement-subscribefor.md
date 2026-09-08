# 09 — Make the settled payment open the subscription itself

**Commit produced:** `c0d7e08` — *Forward settled x402 payments into the subscription*
**When:** 2026-09-08 07:21 +07

## The direction given

Read the 402 flow as an agent, and follow the instructions literally.

Doing that showed the flaw: the route settled the payment and then told the agent, **in prose**,
to go and call `subscribe()` itself. The agent had paid and still had no subscription, and the
next step was a chain transaction it had to construct on its own. The headline claim — pay once,
access renews itself — was true of neither half on its own.

Close it. The resource server should forward the money it just received on-chain, so the agent
signs **one off-chain x402 payment and never touches the chain**.

Second direction, of equal weight: **one payment must buy more than one period.** If a purchase
buys a single period, the subscription expires at the end of the thing that was paid for and the
unattended renewal never happens. The interesting event would be unreachable in a demo.

## Why it was given then

Step 08 built `creditFor()`, which puts money on an agent's balance. That is the ingredient, not
the flow. This is the commit that makes the two rails one rail, and it is the last structural
change before the surface work in step 10.

## What the commit does

`subscribeFor(agent)` lets the resource server open the subscription with the money the agent
just paid. The route calls it after the facilitator settles, so the sequence becomes:

```
request with no access -> 402
  -> agent pays once via x402, settled through Blocky402
  -> resource server forwards that payment into subscribeFor(agent)
  -> subscription opens, first renewal armed
  -> later requests: 200, paidThisRequest:false
  -> after the window expires: still 200, renewed by the Schedule Service
```

The caller of `subscribeFor` has to fund a period itself, which is what stops it from being a
way to spend someone else's balance.

`RETAINER_PERIODS_PER_PURCHASE` defaults to **3**: the first period is charged when the
subscription opens, the other two by renewals the network runs on its own. That is the smallest
number for which the claim is observable twice.

## Files

- `packages/hardhat/contracts/RetainerAccess.sol` — `subscribeFor`
- `packages/nextjs/services/retainer/server.ts` — the forwarding path, signed by `RETAINER_SERVER_KEY`
- `packages/nextjs/app/api/retainer/access/route.ts` — call it on settlement instead of printing advice
- `packages/nextjs/.env.example` — `RETAINER_SERVER_KEY`, `RETAINER_PERIODS_PER_PURCHASE`

Tests for the new path bring the suite to 38 passing (`yarn hardhat:test`).
