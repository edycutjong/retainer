# Gas economics of a self-renewing subscription

Retainer's renewals are executed by the Hedera Schedule Service (HIP-1215, system contract
`0x16b`), not by a server or a cron job. Nobody is awake for them, but somebody still pays for
them: the network charges **the contract** for each scheduled execution, out of `gasReserve`.

This document is the measurement of what that actually costs, taken from three real scheduled
executions on Hedera testnet, and what the numbers mean for pricing. The short version: at the
default price of 1 HBAR per period, the seller loses money on every unattended renewal. That is
the real economic constraint of on-chain self-renewal, and this project has measured it rather
than solved it.

## How Hedera charges for a scheduled call

A scheduled call is armed with a gas limit — `RENEWAL_GAS_LIMIT`, currently `2_500_000` in
[`RetainerAccess.sol`](../packages/hardhat/contracts/RetainerAccess.sol).

Hedera refunds **at most 20% of an unused gas limit**. On an EVM where unused gas is refunded in
full, an oversized limit is free headroom; here it is not. A 2,500,000 limit is charged at
roughly 2,000,000 gas — 80% of the limit — whether the call uses 2,000,000 or 60,000. In effect
the bill is `max(gas used, 80% of the limit)`: the limit is not a ceiling you might touch, it is
the floor of what you pay.

That single rule is why `RENEWAL_GAS_LIMIT` is a pricing decision and not a safety margin.

## The three measured renewals

A purchase charges its first period at subscribe time and arms the first renewal. Each renewal
then charges the next period and arms the one after it, until the money or the gas reserve runs
out. The measured run funded 4 HBAR at 1 HBAR per period, so it bought four periods: one at
subscribe and three by renewal. That produced exactly three scheduled executions, all
`scheduled=True`, all `SUCCESS`, read back from the mirror node:

| Consensus timestamp | Charged (tinybar) | Charged (HBAR) | What it did |
|---|---:|---:|---|
| `1788780226.016366208` | 154,896,000 | 1.54896 | renewed **and re-armed** the next |
| `1788780286.019735208` | 154,896,000 | 1.54896 | renewed **and re-armed** the next |
| `1788780346.345418842` | 5,067,825 | 0.05068 | charged the last period, then lapsed on the subscriber's balance, **did not re-arm** |

Supporting figures from the same run:

| Measurement | Value |
|---|---:|
| x402 payment settled through Blocky402 | tx `0.0.7162784@1788780154.225876092` |
| `subscribe()` gas used (testnet) | 1,582,554 (limit 2,000,000) |
| Deploy gas used (testnet) | 968,564 |
| `RENEWAL_GAS_LIMIT` | 2,500,000 |
| `RENEWAL_COST_ESTIMATE` debited from `gasReserve` per *armed* renewal | 200,000,000 tinybar (2 HBAR) |
| Local hardhat `renew()` gas | 48,247 – 77,085 |
| Local hardhat `subscribe()` gas | 137,552 – 205,722 |

These came off the first deployment, `0.0.10406083` /
[`0x8B42a662b0Bd5EecF09517840f63A61AAbEb952A`](https://hashscan.io/testnet/contract/0.0.10406083),
which predates the current constructor and ABI. The current source is deployed separately at
[`0.0.10415845`](https://hashscan.io/testnet/contract/0.0.10415845), where one scheduled renewal
was charged 153,816,728 tinybar (1.53817 HBAR) — within 0.7% of the figures in the table above. The fee
behaviour and the `RENEWAL_GAS_LIMIT` the measurements rest on are unchanged, but do not expect
`0.0.10406083` to match `RetainerAccess.sol` as it stands today.

### What the 1.549 vs 0.051 split proves

The third execution charged its period and then lapsed instead of arming the next one: with the
subscriber's balance spent it emitted `Lapsed("balance will not cover the next period")` and
never reached `scheduleCall`. It cost **1.498 HBAR less** than the two that did — a 30x gap. So:

- **Re-arming the next renewal is ~97% of what a renewal costs.** The `scheduleCall` into `0x16b`
  is the expense.
- **The renewal's own bookkeeping is cheap.** Charging a period, extending the window, moving
  tinybar between `_owed` and `revenue` — that is the 0.05 HBAR part.

The interesting cost is not "running a subscription". It is *buying the next unattended wake-up*,
paid one wake-up at a time, in advance.

### What we did not pin down

Three samples. If the 1.54896 HBAR charge corresponds to the ~2,000,000 gas floor implied by the
20% refund rule, the effective price is roughly 77 tinybar/gas — at which the 0.05068 HBAR lapse
charge works out near 65,000 gas, comfortably inside the local `renew()` band above. That is
arithmetic on two charged amounts, not a separately measured gas price, and the lapse charge
itself is far below what an 80%-of-limit floor would predict for the same limit. We did not chase
the exact fee path for a scheduled call that exits early. The re-arming path is the one that
matters for pricing, and that one is measured directly.

## Why the local gas report disagrees

`yarn hardhat:test` reports `renew()` at 48,247 – 77,085 gas. On testnet a re-arming renewal
consumes ~1.5M and is billed at the ~2.0M floor. That is not a discrepancy to reconcile away —
**the ~1.4M gap between the local figure and real consumption _is_ the system-contract call.**

The hardhat tests mock the scheduler, because `0x16b` does not exist on a local EVM. The mock
records that a call was scheduled and returns success; it does not perform the Hedera-side work
of creating a schedule entity. Everything the local report measures is Solidity. Everything it
omits is the part that costs money.

So: read the local gas report for regressions in contract logic, and never for the cost of a
renewal. Only testnet knows that number.

## What this means for pricing

The statement is a per-renewal one, and it needs no ledger: **an unattended renewal that re-arms
costs 1.549 HBAR and sells one period.** At the default `RETAINER_PRICE_TINYBAR` of 1 HBAR that
is −0.549 HBAR every time the network wakes the contract up, and selling more periods per
purchase makes the loss bigger rather than smaller — each extra period is one more renewal.

Two details qualify it, both in the seller's favour, neither large enough to close the gap:

- **The first period costs the reserve nothing.** `subscribe()` is an ordinary transaction —
  1,582,554 gas — paid by whoever sends it, which here is the resource server forwarding the
  settled x402 payment, i.e. the seller's own key. Only scheduled executions draw on
  `gasReserve`.
- **A renewal that lapses is nearly free**, at 0.051 HBAR. But a lapse is the subscription
  ending, not a renewal the seller wanted.

Separately, the contract debits `RENEWAL_COST_ESTIMATE` = 2 HBAR from `gasReserve` each time it
*arms* a renewal, against an actual network charge of 1.549 for executing one. That conservatism
is deliberate — an on-chain contract cannot know a future fee — but it means the reserve's own
counter draws down ~0.45 HBAR per renewal faster than the network bills, so the reserve stops
arming sooner than the raw fees alone would suggest.

## The options, honestly sized

**1. Right-size `RENEWAL_GAS_LIMIT` — recovers roughly a third.**
The bill is `max(gas used, 80% of the limit)`, and at a 2,500,000 limit against ~1.5M actually
used the floor is what wins: 2,000,000 charged for 1.5M of work. Lower the limit toward real
usage and the floor stops binding, so the bill converges on the work instead of the headroom.
The limit cannot go below what a re-arming renewal consumes, or renewals start failing, so the
room is real but bounded — roughly a third. Worth doing. Does not reach 1 HBAR.

**2. Price the period above the renewal cost — this is what actually works.**
Break-even is the renewal cost, not zero: a period must sell for more than ~1.55 HBAR today, and
for more than whatever option 1 leaves, before the seller keeps anything.
`RETAINER_PRICE_TINYBAR` is a seller setting and the default of 1 HBAR is a demo default, not a
viable price. This is the only option that makes the product solvent on its own terms.

**3. Amortise by selling longer periods.**
The cost is per *renewal*, not per second of access. A 30-day period costs the same ~1.55 HBAR to
renew as a one-minute one. Long periods make the fixed wake-up cost negligible against the price;
short ones make it dominant. The measured run above used 60-second periods — the three consensus
timestamps are exactly 60 seconds apart — because that is the worst case and the only one short
enough to sit and watch. The deploy default is `RETAINER_PERIOD_SECONDS=3600`, and the contract
as it stands will not accept a period below `MIN_PERIOD_SECONDS = 61`.

Options 2 and 3 are the same lever seen from two ends: the gap between what a period sells for
and what one wake-up costs. Option 1 shrinks the cost side by about a third and no further.

## The constraint, stated plainly

Self-renewal on-chain is not free automation. Every unattended renewal buys its successor in
advance, at a price set by the network, charged to the seller, and dominated almost entirely by
the `scheduleCall` that arms the next one. A subscription product on this rail has to price a
period above the cost of one scheduled wake-up, or it pays for its own users.

Retainer measured that number — 1.54896 HBAR per re-arming renewal on Hedera testnet — and has
not yet engineered its way under it.
