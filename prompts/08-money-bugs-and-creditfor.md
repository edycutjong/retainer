# 08 — Audit the money paths, not the control flow

**Commit produced:** `78025d2` — *Fix four money bugs and wire x402 settlement into the subscription*
**When:** 2026-09-08 07:19 +07

## The direction given

The previous audit (step 05) looked at who may call what. This one looks at **the arithmetic**:
follow every tinybar from the moment it enters the contract to the moment it leaves, and check
the units at each hop. Then ask what a subscriber can choose that they should not be allowed to
choose.

Separately: name and close the gap between the payment rail and the subscription. Paying the
402 and holding a subscription were still unrelated events.

## Why it was given then

Step 07 proved the loop runs on the network. That means the next class of bug that matters is
not "does it run" but "does it move the right amounts" — and unit bugs on Hedera are silent.
They do not revert. They produce a successful transaction that paid the wrong number.

## The four bugs

**1 — Units.** Acting on the belief that Hedera's EVM denominates `msg.value` and
`address(this).balance` in **weibar** while the network accounts in **tinybar** at 1:1e10, this
commit added a 1e10 conversion at the EVM boundary — `_toTinybar` on the way in, a multiply back
by `WEIBAR_PER_TINYBAR` on the way out — made `_solvent()` compare like with like, and rejected
sub-tinybar deposits as dust instead of crediting them 1:1.

> **Correction (`9eb39e3`).** The belief was wrong and this "fix" was itself the bug. Settled by
> measurement rather than argument: `contracts/test/UnitProbe.sol` was deployed to testnet and
> sent 2 HBAR as 2e18 on the wire; it reported `msg.value == 200000000` and
> `address(this).balance == 200000000`. The JSON-RPC relay speaks weibar at the edge and converts
> there — inside the EVM everything is already tinybar, so a Hedera contract should do no
> conversion at all. The conversion added here overpaid every outbound transfer by ten orders of
> magnitude. `9eb39e3` removed `_toTinybar`, `WEIBAR_PER_TINYBAR` and the `DustAmount` error, and
> left the only 1e10 conversion in the JavaScript that puts a value on the wire. See
> `11-units-measured-not-assumed.md`; the reasoning is kept here rather than rewritten, because
> what a judge should be able to see is the wrong turn and the measurement that corrected it.

**2 — The subscriber chose their own price.** Two tinybar bought a full access window and burned
~2 HBAR of the seller's gas reserve. Terms are now the **seller's** (`setTerms(price, period)`),
snapshotted per subscription so a running one is never repriced.

**3 — The subscriber chose their own period.** A period shorter than `RENEW_SLACK` left the
`renew()` window permanently open, and `renew()` is callable by anyone — so a third party could
loop it, charging the subscriber and burning the seller's reserve on each pass.
`MIN_PERIOD_SECONDS = 61` closes it by requiring the period to exceed twice the slack, keeping
the callable window a strict minority of every period. This is the bill for step 07's fix,
paid explicitly.

**4 — Cancelling was a free repeatable drain.** `cancel()` abandoned the pending schedule while
its gas stayed debited, so subscribe/cancel churn drained the reserve. `cancel()` now calls
`deleteSchedule` and reclaims the reserve.

## The join: `creditFor()`

`creditFor(agent)` lets the resource server settle an x402 payment and credit it to the paying
agent, so the payment rail actually funds the balance that `renew()` draws down unattended.
Before this, the thing the agent paid for and the thing that renews itself were two systems that
happened to be in the same repository.

## Also in this commit

`hasScheduleCapacity` — ask the network whether it can take a schedule at that second before
trying, so a full second lapses cleanly instead of reverting. And a scheduling failure inside
the network's own scheduled call no longer reverts a renewal that already succeeded.

## Tests

12 → 36, covering every path above. The `MockScheduleService` grew switchable failure modes,
because on testnet you cannot ask the network to refuse you on demand.

## The finding that is not fixed, and should not be presented as fixed

At 1 HBAR per period the product **loses money on every renewal**: the renewal costs ~1.55 HBAR
of the seller's gas reserve (step 07's measurements). This is the real constraint of on-chain
self-renewal. Right-sizing `RENEWAL_GAS_LIMIT` toward the ~1.5M actually used recovers roughly a
third — Hedera refunds at most 20% of an unused limit, so a 2,500,000 limit is charged at
roughly 2,000,000 gas regardless of use. Pricing a period above the renewal cost is what
actually makes it solvent. Documented as a measured constraint, not solved.
