# On-chain proof

Retainer claims that a subscription can renew itself on Hedera with nobody awake — no cron
job, no server loop, no user signature at renewal time. This file is the evidence for that
claim: every artifact the run left on Hedera testnet, what each one proves, and the exact
mirror-node requests to re-check all of it without trusting anything in this repo.

`packages/hardhat/contracts/test/MockScheduleService.sol` mocks the Hedera Schedule Service
so the local test suite can exercise the scheduling paths (a hardhat node has no system
contract at `0x16b`). The mock proves nothing about the real network. **This file is where
that gap is closed** — the run below is the real Schedule Service calling the real contract.

Everything here was read back from `https://testnet.mirrornode.hedera.com` on 2026-09-08; the
"current deployment" section and the correction under "Read this first" were added the same
evening after every citation was re-checked against `entity_id`.

---

## Read this first: three deployments, and which one each number came from

The contract at **0.0.10406083** is the deployment that produced the run recorded below. It
predates the contract fixes made after that run, so **it does not run the code currently in
`packages/hardhat/contracts/RetainerAccess.sol`**. Treat this address as the source of the
evidence, not as a copy of the current source.

Two later deployments exist, and an earlier revision of this file conflated them:

| | Contract | Deployed by | What it did on chain |
|---|---|---|---|
| first, **measured** | `0.0.10406083` / `0x8B42a662b0Bd5EecF09517840f63A61AAbEb952A` | `818c517` | the run below: 1 subscription, **3** unattended renewals (2 re-armed at 154,896,000 tinybar, 1 lapsed at 5,067,825) |
| intermediate | `0.0.10414167` / `0xd3A218AD4c817B14Cc754e4c996A95435155a27B` | `9eb39e3` (units fix, before metering) | 4 subscriptions, **7** unattended renewals (4 re-armed at 153,816,728, 3 lapsed at 5,027,776), one `cancel()` that deleted pending schedule `0.0.10414197`; the agent-script run at the end of this file |
| **current** | [`0.0.10415845`](https://hashscan.io/testnet/contract/0.0.10415845) / `0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931` | `7400cd7` (metering) | the address in `packages/nextjs/contracts/deployedContracts.ts`, so the one the resource server talks to. **9** unattended renewals (8 re-armed, 1 lapsed) and **one scheduled execution that reverted** — see "The current deployment" below |

**19 unattended renewals across the three** — `CONTRACTCALL`, `scheduled=true`, `SUCCESS`, each
with a `Renewed` event. Counted on the mirror node on 2026-09-08 with the commands in "Re-verify
it yourself". A twentieth scheduled execution, on the current deployment, reverted; it is
recorded, not omitted.

**Correction, 2026-09-08.** Until this revision the file said the current deployment "has already
renewed itself once unattended" and cited `1788827767.015718559`. That transaction is real,
`scheduled=true` and `SUCCESS` — but its `entity_id` is `0.0.10414167`, and `0.0.10415845` was
not created until `1788838675.869780648`, three hours later. The sentence had been written when
`0.0.10414167` was the current deployment and carried across the redeploy in `7400cd7` without
being re-checked against the chain. Likewise the schedule `0.0.10414197` that `cancel()` deleted
belongs to `0.0.10414167`, and the agent-script transcript at the end of this file ran against
`0.0.10414167`, not the current contract. Every surface that repeated those sentences (README,
JUDGE.md, `/judge`, the landing page, the pitch deck) was corrected at the same time. The
mistake is kept here in words because a judge who clicks the old HashScan link will see
`0.0.10414167`, and should find the explanation rather than a silent edit.

Two details visible in the data below make the difference between the first deployment and the
current source concrete:

- The subscribe call carries selector `0xa33087cd`, which matches no function in the current
  source (`subscribe()` is `0x8f449a05`, `subscribeFor(address)` is `0x6da6c39c`).
- The run used a **60-second period**. The current source sets `MIN_PERIOD_SECONDS = 61`, a
  bound added after this run so the anyone-callable `renew()` window stays a strict minority
  of every period; the current deployment runs 90-second periods.

Neither affects what the run demonstrates: the Schedule Service really does call back into a
contract, on time, unattended, and re-arm itself — and what that costs.

---

## The current deployment — the same loop on the deployed source, and one revert

Everything in this section is `0.0.10415845`, read back from the mirror node on 2026-09-08. The
agent is the same `0.0.10403066` / `0xd14c…cc66`; the seller is `0.0.10402910`.

| Consensus | UTC | What | Result | Charged to the contract |
|---|---|---|---|---|
| `1788840233.455239257` | 04:03:53 | x402 payment settled by Blocky402: `0.0.7162784@1788840225.936068496`, 3 ℏ agent → seller, fee paid by `0.0.7162784` | `SUCCESS` | — |
| `1788840235.495889027` | 04:03:55 | `subscribeFor(agent)` forwarded by the server, value 3 ℏ, 1,613,677 gas → `SubscriptionStarted` (period 90 s), `RenewalScheduled` `0.0.10416088` | `SUCCESS` | — |
| `1788840242.157589795` | 04:04:02 | `meter(agent)` — one metered call served, counted on chain | `SUCCESS` | — |
| [`1788840325.135282208`](https://hashscan.io/testnet/transaction/1788840325.135282208) | 04:05:25 | **scheduled** `renew(agent)` → `Renewed`, `RenewalScheduled` `0.0.10416101` | `scheduled=true` `SUCCESS` | 154,327,368 tinybar |
| [`1788840415.078121802`](https://hashscan.io/testnet/transaction/1788840415.078121802) | 04:06:55 | **scheduled** `renew(agent)` from schedule `0.0.10416101` | `scheduled=true` **`CONTRACT_REVERT_EXECUTED`**, error `0xfc220038` = `Insolvent()` | 6,540,872 tinybar |
| `1788841036.913994605` | 04:17:16 | `subscribe()` sent by the agent | `CONTRACT_REVERT_EXECUTED`, `AlreadyActive()` — the rolled-back state still says active | — |
| `1788844232.261452104` | 05:10:32 | `creditFor(agent)` +8 ℏ by the seller → `Funded` | `SUCCESS` | — |
| `1788844245.406393732` | 05:10:45 | `renew(agent)` sent as an ordinary transaction by the seller, 1,481,020 gas → `Renewed`, `RenewalScheduled` `0.0.10416711` — the restart | `SUCCESS` | (paid by the sender) |
| [`1788844334.069565823`](https://hashscan.io/testnet/transaction/1788844334.069565823) | 05:12:14 | **scheduled** `renew` → `Renewed`, re-armed `0.0.10416728` | `scheduled=true` `SUCCESS` | 154,036,168 |
| `1788844424.147499693` | 05:13:44 | scheduled `renew` → `Renewed`, re-armed `0.0.10416743` | `scheduled=true` `SUCCESS` | 154,036,168 |
| `1788844514.031171208` | 05:15:14 | scheduled `renew` → `Renewed`, re-armed `0.0.10416751` | `scheduled=true` `SUCCESS` | 154,036,168 |
| `1788844604.062103189` | 05:16:44 | scheduled `renew` → `Renewed`, re-armed `0.0.10416761` | `scheduled=true` `SUCCESS` | 154,036,168 |
| `1788844694.152962208` | 05:18:14 | scheduled `renew` → `Renewed`, re-armed `0.0.10416782` | `scheduled=true` `SUCCESS` | 154,036,168 |
| `1788844784.021991773` | 05:19:44 | scheduled `renew` → `Renewed`, re-armed `0.0.10416798` | `scheduled=true` `SUCCESS` | 154,036,168 |
| `1788844874.087845672` | 05:21:14 | scheduled `renew` → `Renewed`, re-armed `0.0.10416816` | `scheduled=true` `SUCCESS` | 153,536,968 |
| [`1788844964.085627208`](https://hashscan.io/testnet/transaction/1788844964.085627208) | 05:22:44 | scheduled `renew` → `Renewed` (balance 0), `Lapsed("balance will not cover the next period")`, **no** `RenewalScheduled` | `scheduled=true` `SUCCESS` | **5,222,880** |

**What it proves.** The deployed source does what the first deployment did, at the current gas
price: a re-arming renewal is charged ~154,036,168 tinybar (1.54036 ℏ) and the one that lapses
5,222,880 (0.0522 ℏ) — a **29.5×** gap, so re-arming is again **~96.6%** of the cost. Eight
consecutive executions with no submitter, ending loudly. The demo agent's window has been
closed since `1788845054` (05:24:14 UTC), which is what `/api/retainer/status` reports today.

**What it also proves, and this is the part to read twice.** The scheduled execution at
`1788840415.078121802` **reverted** with the contract's own `Insolvent()` guard —
`address(this).balance < _owed + revenue + gasReserve`. Reconstructed from the transfers the
mirror node lists against the contract, its real balance at that second was
20 ℏ + 3 ℏ − 154,327,368 − 6,540,872 = **2,139,131,760 tinybar**, and by the source's own
arithmetic the three pots at the end of that call totalled 0 + 300,000,000 + 1,600,000,000 =
**1,900,000,000**. The guard should have passed by 239 million tinybar. It did not, so the balance
the EVM exposed to the contract *during a network-scheduled execution* was lower than the
account's balance — consistent with Hedera reserving the scheduled call's full gas cost
(`RENEWAL_GAS_LIMIT` 2,500,000 at the network's provisional price, which is more than the
~154 million finally charged) on the payer before the call runs. That is an inference from two
numbers, not a measured mechanism; what is measured is that `Insolvent()` fired with 239 million
tinybar of apparent headroom, and that every later execution — which had 439 million or more —
passed. The consequence was the failure mode the docs warn about elsewhere: for 64 minutes the
subscription read `active: true` with an `expiresAt` in the past and a stale schedule pointer,
until a human noticed. The fix is to keep the scheduled call's own gas out of the solvency
arithmetic or to hold `RENEWAL_COST_ESTIMATE` outside the pots; either needs a redeploy and
neither is made in this build. Recorded here because a judge can find it in one query, and
because it is the most useful thing the current deployment taught.

**Re-verify the current deployment:**

```bash
# every scheduled execution and the ordinary renew() that armed the first — one request
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7314364-1788844238-651641588" \
  | jq -r '.transactions[] | [.consensus_timestamp, .name, "scheduled=\(.scheduled)", .result, "fee=\(.charged_tx_fee)"] | @tsv'

# the earlier renewal that succeeded, and the one that reverted
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions?timestamp=1788840325.135282208" | jq '.transactions[0] | {name, scheduled, result, charged_tx_fee, entity_id}'
curl -s "https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.10415845/results/1788840415.078121802" | jq '{result, error_message, gas_used, gas_limit}'
#   error_message 0xfc220038 == keccak256("Insolvent()")[0:4]

# every event the current contract emitted, in order (topic0 table further down)
curl -s "https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.10415845/results/logs?order=asc&limit=100" \
  | jq -r '.logs[] | [.timestamp, .topics[0][0:10]] | @tsv'

# the x402 settlement that opened it
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1788840225-936068496" \
  | jq -r '.transactions[] | .name, (.transfers[] | "\(.account) \(.amount)")'
```

**Count the 19 yourself** — one line per deployment, each counting `Renewed` events emitted by a
`scheduled=true` `SUCCESS` execution:

```bash
for c in 0.0.10406083 0.0.10414167 0.0.10415845; do
  curl -s "https://testnet.mirrornode.hedera.com/api/v1/contracts/$c/results/logs?order=asc&limit=100" \
    | jq -r --arg c "$c" '[.logs[] | select(.topics[0] | startswith("0x97d5a615"))] | .[].timestamp' \
    | while read ts; do curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions?timestamp=$ts" \
        | jq -r --arg c "$c" '.transactions[0] | select(.scheduled==true and .result=="SUCCESS") | $c'; done | sort | uniq -c
done
# 3 0.0.10406083 · 7 0.0.10414167 · 9 0.0.10415845
```

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
scheduler is the mock and `scheduleCall` is a no-op emit — reports 137,552–205,722. The
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

## Artifact 7 — the payment audit trail on HCS

- **Topic** [`0.0.10440194`](https://hashscan.io/testnet/topic/0.0.10440194) · created at
  consensus `1788962445.497065104`
- **Memo** `Retainer x402 payment audit trail | retainer.edycu.dev`
- **Admin key** `null` — the topic can never be updated or deleted, by anyone, including us
- **Submit key** `ECDSA_SECP256K1`, the seller account `0.0.10402910` — only it can append
- **Messages** 4, from two real paid requests through the live gate on 2026-09-09

| Seq | Consensus | Event | Settlement |
|---|---|---|---|
| 1 | `1788962638.913214511` | `payment.settled` | `0.0.7162784@1788962625.048553106` |
| 2 | `1788962638.915568407` | `subscription.opened`, `subscribeFor` `0x72acc577…de1319` at [`1788962634.749890619`](https://hashscan.io/testnet/transaction/1788962634.749890619) | `0.0.7162784@1788962625.048553106` |
| 3 | `1788962964.258637896` | `subscription.opened`, `subscribeFor` `0x37afa072…32eb72` at [`1788962958.304056104`](https://hashscan.io/testnet/transaction/1788962958.304056104) | `0.0.7162784@1788962945.717898779` |
| 4 | `1788962964.413170104` | `payment.settled` | `0.0.7162784@1788962945.717898779` |

**Proves the two rails can be joined by a stranger.** The settlement id on each record resolves
to a `CRYPTOTRANSFER` `SUCCESS` on the mirror node, and each `subscriptionTx` resolves to a
`SUCCESS` `CONTRACTCALL` to `0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931` — the contract the
record itself names. Nothing has to be taken on trust; `yarn verify:audit-trail` performs exactly
those lookups and exits non-zero on any mismatch.

Note sequence 3 and 4: the second request's `subscription.opened` reached consensus *before* its
own `payment.settled`. The two records are submitted independently — deliberately, so a stuck
payment write cannot suppress the subscription write — so consensus may order them either way.
The join is the settlement id, never the sequence number.

```bash
# what the topic says
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10440194/messages?order=asc" \
  | jq -r '.messages[] | "\(.sequence_number) \(.consensus_timestamp) \(.message | @base64d)"'

# that it cannot be rewritten: admin_key is null
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10440194" | jq '{memo, admin_key, submit_key}'
```

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

- It does not, by itself, prove the **current** source behaves this way; that is what "The
  current deployment" above is for — eight unattended renewals to a loud lapse on
  `0.0.10415845`, and one scheduled execution that reverted, which this run never showed. The
  current source is covered by 46 tests in `packages/hardhat/test/RetainerAccess.test.ts`
  (`yarn hardhat:test`), against the mock; none of them models the balance a scheduled
  execution sees.
- It does not prove the fee stays at 1.54896 HBAR. Hedera gas price moves; the measurement is
  a point in time, which is why `RENEWAL_COST_ESTIMATE` is a documented estimate with headroom
  rather than a promise.
- It does not prove the network will always have schedule capacity. It cannot — which is why
  the contract asks `hasScheduleCapacity` before arming and lapses cleanly if the answer is no,
  a path that only the mock can exercise on demand.


---

## The live service, end to end

The deployed resource server at <https://retainer.edycu.dev>, recorded on 2026-09-08 at
01:14 UTC against the deployment that was current at that moment, **`0.0.10414167`** (the
`subscribeFor` in step 3, `0x97b7…b3cc`, is `1788830074.772208503` on that contract; the
redeploy to `0.0.10415845` came two and a half hours later). This is
`packages/nextjs/scripts/retainer-agent.ts` in full, unedited — the agent signs exactly one
thing, the payment in step 2, and nothing afterwards. The same route against the current
deployment produced the x402 settlement and `subscribeFor` at the top of "The current
deployment" above.

```
1) cold request — expect 402
  HTTP 402

2) paying via x402 — settled by Blocky402
  ✅ settled · tx 0.0.7162784@1788830067.404863715

3) the server opened the subscription with the settled payment
  subscribed · tx 0x97b7729275031c07ce73c74fd9b9d6badf4999245ce372da6d197c902301b3cc

4) same request again
  warm request: HTTP 200  paidThisRequest=false
     window 116s remaining · renewal scheduled at 0x…9eE9d4

5) waiting 165s past expiry — sending NOTHING
  post-expiry request: HTTP 200  paidThisRequest=false
     window 70s remaining · renewal scheduled at 0x…9eE9E5
```

Step 5 is the claim. The request after the window expired was served for free, and the schedule
address had changed — the contract had already armed the *next* renewal. No user, no server job
and no cron was involved in extending it.

Verify the settlement:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1788830067-404863715" | jq
```

### One bug this run found

An earlier run of the same script returned **402** at step 4 rather than 200. The route forwarded
the settled payment and answered immediately with the transaction hash, without waiting for it to
be mined, so the agent's next request still read no subscription on-chain and would have paid a
second time for access it had already bought. `openSubscriptionFor` now waits for the receipt
before reporting access open. It is recorded here because the failure was real, was caught by
running the thing rather than reading it, and the fix is one the numbers above depend on.
