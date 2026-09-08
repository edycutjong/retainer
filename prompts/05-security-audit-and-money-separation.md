# 05 — Audit the contract adversarially, including its own comments

**Commit produced:** `b68b540` — *Fix griefing vector, add revenue path, separate the money, add tests*
**When:** 2026-09-07 18:08 +07

## The direction given

Take `RetainerAccess` as written and attack it. Specifically:

- Assume every external function is called by someone hostile, at the worst moment, in a loop.
- **Treat the code's own comments as claims to be falsified, not as documentation.** A comment
  that argues something is safe is exactly where an unexamined assumption hides.
- Then write tests that would have caught each finding, and be explicit about what the tests
  do *not* prove.

## Why it was given then

The contract had just been proven to work in the happy path on testnet, which is the point at
which a build is most likely to move on and never look back. It was also the last moment before
the payment rail would be wired on top of it — after that, every fix touches two systems.

## What the audit found

**BLOCKER — `renew()` had no time gate.** A comment argued this was safe because the function
"only touches that agent's own balance". That reasoning was wrong: the *network* charges the
**contract** for each scheduled call, so anyone could call `renew(victim)` repeatedly and force
the contract to queue scheduled calls that each burned ~1.53 HBAR of its own HBAR. Fixed with a
`block.timestamp >= expiresAt` gate, and the comment rewritten to explain why the old reasoning
was insufficient. (That gate is itself wrong in a way nobody predicted — see step 07.)

**FALSE CLAIM — "Nothing is silently drained: a lapse is an event, not a failure."** Falsified
by the chain, not by argument: the second scheduled renewal had failed with
`INSUFFICIENT_PAYER_BALANCE` and emitted nothing at all, leaving the subscription looking
active forever. `Lapsed` is now emitted **before** scheduling, at the moment the reserve is
seen not to cover the next execution, so a subscription that cannot renew says so.

**MISSING — nobody could get paid.** Charged periods accumulated in the contract with no owner
and no `withdraw()`. Added an immutable `beneficiary` and a `withdraw()` restricted to revenue.

**INSOLVENCY — one pool of money for three purposes.** Subscriber refunds, revenue and
scheduled-call gas shared a balance, so one subscriber's renewal gas could eat another's
refund. Split into three tracked amounts — `_owed`, `revenue`, `gasReserve` — with a
`_solvent()` invariant asserted after every balance change.

## Tests, and their honest limit

10 cases, using a `MockScheduleService` placed at `0x16b` with `hardhat_setCode`: the time gate,
the drain attempt, revenue separation, withdrawal permissions, refund replay, and both lapse
reasons.

Stated in the commit message rather than left for a reader to work out: **the mock stands in
for the scheduler only.** That the real Schedule Service behaves as assumed is proven by the
live testnet runs, not by the mock — and local gas figures therefore understate real cost,
because mocked scheduling is nearly free.
