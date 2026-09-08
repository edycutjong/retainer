# On-chain proof

Retainer claims that a subscription can renew itself on Hedera with nobody awake — no cron
job, no server loop, no user signature at renewal time. This file is the evidence for that
claim: every artifact the run left on Hedera testnet, what each one proves, and the exact
mirror-node requests to re-check all of it without trusting anything in this repo.

`packages/hardhat/contracts/test/MockScheduleService.sol` mocks the Hedera Schedule Service
so the local test suite can exercise the scheduling paths (a hardhat node has no system
contract at `0x16b`). The mock proves nothing about the real network. **This file is where
that gap is closed** — the run below is the real Schedule Service calling the real contract.

Everything here was read back from `https://testnet.mirrornode.hedera.com` on 2026-09-08.

---

## Read this first: the live deployment is behind the source

The contract at **0.0.10406083** is the deployment that produced the run recorded below. It
predates the contract fixes made after that run, so **it does not run the code currently in
`packages/hardhat/contracts/RetainerAccess.sol`**. A redeploy is pending; until it lands,
treat this address as the source of the evidence, not as a copy of the current source.

Two details visible in the data below make the difference concrete, and are worth knowing
before anyone tries to reconcile them with the source:

- The subscribe call carries selector `0xa33087cd`, which matches no function in the current
  source (`subscribe()` is `0x8f449a05`, `subscribeFor(address)` is `0x6da6c39c`).
- The run used a **60-second period**. The current source sets `MIN_PERIOD_SECONDS = 61`, a
  bound added after this run so the anyone-callable `renew()` window stays a strict minority
  of every period.

Neither affects what the run demonstrates: the Schedule Service really does call back into a
contract, on time, unattended, and re-arm itself — and what that costs.

---

## The cast

| Account | EVM address | Role |
|---|---|---|
| `0.0.10406083` | `0x8B42a662b0Bd5EecF09517840f63A61AAbEb952A` | the `RetainerAccess` contract |
| `0.0.10402910` | `0x48c548ad35de8a358d9c49568445462f51269e85` | seller — deployer, `beneficiary`, `RETAINER_PAY_TO` |
| `0.0.10403066` | `0xd14ca86a1483e9b2147a7b86fb74d437d3d2cc66` | the agent — pays over x402, and is the subscriber in every event below |
| `0.0.7162784` | `0xc7a05f74a48f936cc3ed5a908f815471523545ad` | submitted and paid the fee for the x402 settlement (the hosted Blocky402 facilitator) |
| `0.0.7314364` | — | the Hedera JSON-RPC relay operator that submitted the EVM transactions |

The single most useful check is that `0.0.10403066` is the account that moved 1 HBAR over
x402 **and** the indexed `agent` in `SubscriptionStarted` and in all three `Renewed` events.
That is the join between the payment and the subscription.

---

## Artifact 1 — deployment

- **Contract** `0.0.10406083` · [HashScan](https://hashscan.io/testnet/contract/0.0.10406083)
- **Transaction** `CONTRACTCREATEINSTANCE` `0.0.7314364-1788780104-171368234`
- **Consensus** `1788780111.670126313` — 2026-09-07 11:21:51 UTC
- **EVM hash** `0x35aac6532e5d91af0f45f8fe67554a3fc92e5a3582fc0b00ee72342a32f92528`
- **Gas used** 968,564 (limit 4,000,000) · **value** 800,000,000 tinybar (8 HBAR)
- **Log** `GasReserveFunded(0x48c5…9e85, 800000000, 800000000)`

**Proves:** the contract exists on Hedera testnet, and the 8 HBAR sent at construction landed
in `gasReserve` — a separate pot from subscriber money and from revenue. A contract that pays
for its own future executions has to hold that money itself; this is the moment it does.

## Artifact 2 — the x402 payment, settled through Blocky402

- **Transaction** `0.0.7162784@1788780154.225876092` (path form
  `0.0.7162784-1788780154-225876092`) ·
  [HashScan](https://hashscan.io/testnet/transaction/1788780164.857913104)
- **Type** `CRYPTOTRANSFER` · **result** `SUCCESS`
- **Consensus** `1788780164.857913104` — 2026-09-07 11:22:44 UTC
- **Transfers** `0.0.10403066` −100,000,000 tinybar → `0.0.10402910` +100,000,000 tinybar
- **Fee** 248,786 tinybar, charged to `0.0.7162784`

**Proves:** an HTTP 402 was answered with a real payment on Hedera, for exactly
`RETAINER_PRICE_TINYBAR` (100,000,000 tinybar = 1 HBAR), paid to `RETAINER_PAY_TO`. The give-away
that this is a *facilitator* settlement rather than a direct wallet transfer is that the account
which submitted and paid the fee (`0.0.7162784`) is not the account whose HBAR moved
(`0.0.10403066`). The payer signed a payment; the facilitator put it on the ledger.

## Artifact 3 — the subscription opens and arms the first renewal

- **Transaction** `0.0.7314364-1788780163-271854529` · type `ETHEREUMTRANSACTION` ·
  [HashScan](https://hashscan.io/testnet/transaction/1788780167.771453657)
- **Consensus** `1788780167.771453657` — 2026-09-07 11:22:47 UTC
- **EVM hash** `0x55e59bf1909c9743827b62b800214a8c4ebce86e34e82810eaa549b05e9b754b`
- **From** `0xd14ca86a…cc66` · **selector** `0xa33087cd` · **value** 400,000,000 tinybar (4 HBAR)
- **Gas used** 1,582,554 (limit 2,000,000)
- **Logs**
  - `Funded(0xd14c…cc66, 400000000, 400000000)`
  - `SubscriptionStarted(0xd14c…cc66, price 100000000, period 60, expiresAt 1788780226)`
  - `RenewalScheduled(0xd14c…cc66, schedule 0.0.10406098, firesAt 1788780226)`
- **Child** `SCHEDULECREATE` at `1788780167.771453658` creating schedule
  [`0.0.10406098`](https://hashscan.io/testnet/schedule/0.0.10406098)

**Proves two things.** First, the subscription is opened by an ordinary EVM call and the first
period is charged immediately — 4 HBAR funded, price 1 HBAR/period. Second, and this is the
part that matters: **that same call created a Hedera schedule**. `scheduleCall` into the system
contract at `0x16b` produced a real scheduled entity, `0.0.10406098`, with
`payer_account_id = 0.0.10406083` — the contract, not a person, is on the hook for the fee.
`wait_for_expiry: true`, `expiration_time: 1788780226.000000000`.

The gas number is the cost story in one line: 1,582,554 gas for a call whose product logic is
bookkeeping over a struct. The same `subscribe` path in the local hardhat suite — where the
scheduler is the mock and `scheduleCall` is a no-op emit — reports 177,765–199,665. The
~1.4M difference **is** the real `scheduleCall`.

## Artifacts 4 and 5 — two unattended renewals

Both are `CONTRACTCALL`, `scheduled: true`, `SUCCESS`, entity `0.0.10406083`. Nobody signed
them. No server sent them. The network executed them because a schedule said to.

| | Renewal 1 | Renewal 2 |
|---|---|---|
| Consensus | `1788780226.016366208` | `1788780286.019735208` |
| UTC | 2026-09-07 11:23:46 | 2026-09-07 11:24:46 |
| Schedule executed | `0.0.10406098` | `0.0.10406108` |
| Fee charged to the contract | **154,896,000 tinybar (1.54896 HBAR)** | **154,896,000 tinybar (1.54896 HBAR)** |
| `Renewed` | paid 100000000, expiresAt 1788780286, balance left 200000000 | paid 100000000, expiresAt 1788780346, balance left 100000000 |
| `RenewalScheduled` | next schedule `0.0.10406108`, fires 1788780286 | next schedule `0.0.10406116`, fires 1788780346 |
| Child `SCHEDULECREATE` | `1788780226.016366209` | `1788780286.019735209` |

HashScan: [renewal 1](https://hashscan.io/testnet/transaction/1788780226.016366208) ·
[renewal 2](https://hashscan.io/testnet/transaction/1788780286.019735208) ·
schedules [`0.0.10406108`](https://hashscan.io/testnet/schedule/0.0.10406108) ·
[`0.0.10406116`](https://hashscan.io/testnet/schedule/0.0.10406116)

**Proves the whole product.** `scheduled: true` on a `SUCCESS` `CONTRACTCALL` is the ledger
saying this transaction had no submitter. Each one charged the next period, extended the
window by 60 seconds, and — the part that makes it a subscription rather than a one-shot timer
— **created the schedule for the renewal after it**. That is the loop closing: 0.0.10406098
executes and creates 0.0.10406108, which executes and creates 0.0.10406116. Timing was
accurate to within milliseconds of the scheduled second (expiry `…226.000000000`, executed
`…226.016366208`).

## Artifact 6 — the renewal that stopped, loudly

- **Transaction** `CONTRACTCALL`, `scheduled: true`, `SUCCESS`, entity `0.0.10406083` ·
  [HashScan](https://hashscan.io/testnet/transaction/1788780346.345418842)
- **Consensus** `1788780346.345418842` — 2026-09-07 11:25:46 UTC
- **Schedule executed** `0.0.10406116`
- **Fee charged to the contract** **5,067,825 tinybar (0.0507 HBAR)**
- **Logs**
  - `Renewed(0xd14c…cc66, paid 100000000, expiresAt 1788780406, balance left 0)`
  - `Lapsed(0xd14c…cc66, "balance will not cover the next period")`
- **No `RenewalScheduled`. No child `SCHEDULECREATE`.**

**Proves the failure mode is honest and the cost model is real.** The subscriber's 4 HBAR
bought exactly four periods (one at subscribe, three at renewal). This call charged the last
of them, then found nothing left for a fifth, emitted `Lapsed` with the reason string, and
deliberately did not arm anything. `Lapsed` is emitted *before* the scheduling attempt for
exactly this reason: a scheduled call that cannot pay for itself fails with
`INSUFFICIENT_PAYER_BALANCE` and emits nothing at all, which would leave a dead subscription
looking alive forever.

And then there is the number. **1.54896 HBAR versus 0.0507 HBAR — 30x.** The only difference
between this call and the two before it is that this one did not re-arm. So re-arming — the
`scheduleCall` into `0x16b` — is roughly **97% of what a renewal costs**. The renewal's own
bookkeeping is the 0.05 HBAR part.

---

## What this run cost, stated plainly

| | |
|---|---|
| Periods charged to the subscriber | 4 × 1 HBAR = **4 HBAR** revenue |
| Renewals paid for out of `gasReserve` | 1.54896 + 1.54896 + 0.0507 = **3.14862 HBAR** |
| Cost of one self-re-arming renewal | **1.54896 HBAR**, against a **1 HBAR** period price |

At this price the product loses money on every renewal. That is the real constraint of
on-chain self-renewal and it is not solved here. Two things move it: `RENEWAL_GAS_LIMIT` is
2,500,000 while a renewal actually uses ~1.5M, and Hedera refunds at most 20% of an unused
limit, so the call is charged at roughly 2,000,000 gas regardless — right-sizing the limit
recovers on the order of a third. The rest is pricing: a period has to cost more than a
renewal does. See `docs/gas-economics.md`.

---

## Re-verify it yourself

Nothing below trusts this repo. Every command is a plain `curl` against the public Hedera
testnet mirror node.

**The whole chain in one request.** The scheduled calls inherit the transaction ID of the
EVM transaction that armed the first schedule, so this single response contains the subscribe
call, all three scheduled renewals, and every `SCHEDULECREATE` between them:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7314364-1788780163-271854529" \
  | jq -r '.transactions[] | [.consensus_timestamp, .name, "scheduled=\(.scheduled)", .result, "fee=\(.charged_tx_fee)"] | @tsv'
```

Expected — note the three `scheduled=true` rows, and that the last one has no `SCHEDULECREATE`
after it:

```
1788780167.771453657   ETHEREUMTRANSACTION   scheduled=false   SUCCESS   fee=166168170
1788780167.771453658   SCHEDULECREATE        scheduled=false   SUCCESS   fee=0
1788780226.016366208   CONTRACTCALL          scheduled=true    SUCCESS   fee=154896000
1788780226.016366209   SCHEDULECREATE        scheduled=false   SUCCESS   fee=0
1788780286.019735208   CONTRACTCALL          scheduled=true    SUCCESS   fee=154896000
1788780286.019735209   SCHEDULECREATE        scheduled=false   SUCCESS   fee=0
1788780346.345418842   CONTRACTCALL          scheduled=true    SUCCESS   fee=5067825
```

**One scheduled renewal on its own** (swap the timestamp for any of the three):

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions?timestamp=1788780346.345418842" | jq
```

**The contract itself** — existence, EVM address, creation timestamp:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.10406083" | jq
```

**The two EVM transactions and their gas** — deploy 968,564, subscribe 1,582,554:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.10406083/results?order=asc&limit=25" \
  | jq -r '.results[] | [.timestamp, .function_parameters[0:10], "gas_used=\(.gas_used)", "gas_limit=\(.gas_limit)", "value=\(.amount)"] | @tsv'
```

Scheduled calls do **not** appear in that index — they are not EVM-submitted transactions.
Use the transaction-ID query above for those, and the log query below to see their effects.

**Every event the contract emitted, in order:**

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.10406083/results/logs?order=asc&limit=25" \
  | jq -r '.logs[] | [.timestamp, .topics[0][0:18]] | @tsv'
```

Topic hashes to read that against:

| `topic0` | Event |
|---|---|
| `0x9b005089293fbaa1…` | `GasReserveFunded(address,uint256,uint256)` |
| `0xcd909ec339185c45…` | `Funded(address,uint256,uint256)` |
| `0x550da42bac929cbe…` | `SubscriptionStarted(address,uint256,uint32,uint256)` |
| `0x0cc8d0cdd16f7c32…` | `RenewalScheduled(address,address,uint256)` |
| `0x97d5a61531816e9a…` | `Renewed(address,uint256,uint256,uint256)` |
| `0x35b88348a56dedff…` | `Lapsed(address,string)` |

**Read the lapse reason out of the last log** — it decodes to
`balance will not cover the next period`:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.10406083/results/logs?order=asc&limit=25" \
  | jq -r '.logs[] | select(.topics[0] | startswith("0x35b88348")) | .data' \
  | cut -c131-206 | xxd -r -p
```

**The three schedules**, each with the second it was due and the second it actually ran:

```bash
for s in 0.0.10406098 0.0.10406108 0.0.10406116; do
  curl -s "https://testnet.mirrornode.hedera.com/api/v1/schedules/$s" \
    | jq -r '[.schedule_id, .expiration_time, .executed_timestamp, .payer_account_id, "wait_for_expiry=\(.wait_for_expiry)"] | @tsv'
done
```

Every one reports `payer_account_id: 0.0.10406083` — the contract paid for its own executions.

**The x402 settlement** — 1 HBAR from the agent to the seller, submitted by the facilitator:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1788780154-225876092" \
  | jq -r '.transactions[] | .name, (.transfers[] | "\(.account) \(.amount)")'
```

---

## What this does not prove

- It does not prove the **current** source behaves this way on testnet. The deployment is one
  revision behind; see the note at the top. The current source is covered by 38 tests in
  `packages/hardhat/test/RetainerAccess.test.ts` (`yarn hardhat:test`), against the mock.
- It does not prove the fee stays at 1.54896 HBAR. Hedera gas price moves; the measurement is
  a point in time, which is why `RENEWAL_COST_ESTIMATE` is a documented estimate with headroom
  rather than a promise.
- It does not prove the network will always have schedule capacity. It cannot — which is why
  the contract asks `hasScheduleCapacity` before arming and lapses cleanly if the answer is no,
  a path that only the mock can exercise on demand.
