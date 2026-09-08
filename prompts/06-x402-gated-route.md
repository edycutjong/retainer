# 06 — Put the contract behind an x402-gated route

**Commit produced:** `c047b63` — *Wire RetainerAccess into an x402-gated route*
**When:** 2026-09-07 18:13 +07

## The direction given

Connect the two halves that had been built separately: the self-renewing contract and the x402
payment rail. One route, three behaviours, and the middle one is the entire point:

```
GET /api/retainer/access?agent=0x…
  no subscription   -> 402, pay once, settled through Blocky402
  window open       -> 200 with paidThisRequest:false, no challenge at all
  after expiry      -> 200 anyway, because the contract renewed itself
```

The ordinary x402 pattern charges on every request, which is precisely the thing that requires
somebody awake to keep paying. Here the gate is an on-chain subscription that extends itself,
so later requests are free and unattended. The response must make that visible —
`paidThisRequest:false` is the field a judge can point at.

Read subscription state from the chain rather than caching it server-side: `hasAccess()` and
`subscriptionOf()` over viem. Cached state would let the server be right when the chain is
wrong, which defeats the demonstration.

## Why it was given then

The contract was proven and audited; the facilitator was proven compatible. This is the commit
where the bounty's first two gates — a live x402-gated service settled through Blocky402, and
an end-to-end paid request — become checkable in one place.

## What the commit contains

- `packages/nextjs/services/retainer/server.ts` — reads `hasAccess()` / `subscriptionOf()` over viem
- `packages/nextjs/app/api/retainer/access/route.ts` — the gated resource
- `RETAINER_PAY_TO`, `RETAINER_PRICE_TINYBAR`, `RETAINER_ACCESS_ADDRESS` in `.env.example`
- redeploy of `RetainerAccess` carrying the step-05 audit fixes → `0.0.10406002`
  (`0x8a053c6F1b70deDae84f4a16EB7F30dAD94Cc375`), seeded with 8 HBAR of gas reserve

The commit message names the previous deployment `0.0.10405786` as the pre-audit contract with
the ungated `renew()`, and says not to use it — because a stale address in a repo is a live
foot-gun, not a historical note.

## One AI failure worth naming

An API that does not exist was invented during this work and caught by the typechecker:
`buildPaymentRequiredResponse`. The real call is the async `createPaymentRequiredResponse`,
whose return value is *both* the JSON body and the `PAYMENT-REQUIRED` header payload. A
hand-rolled body would have produced a 402 that real x402 clients cannot parse — the kind of
bug that passes review, passes a browser test, and fails the only test that matters.
