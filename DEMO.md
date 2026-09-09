# 📊 Demo & Benchmarks

Every number on this page was produced by running the checked-in script against the live
deployment and Hedera testnet on **2026-09-09**. Nothing is estimated, extrapolated or replayed
from a fixture, and there is no offline mode to fall back to — `yarn bench` has no flag that
makes it stop talking to the network.

---

## 🎯 The 30-second demo

Retainer's claim is one sentence: **an agent pays once, and the access window keeps renewing
itself on-chain with nobody awake.** The query that proves it needs no wallet, no key and no
clone — it asks Hedera's own public mirror node who sent the last few calls to our contract:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions\
?account.id=0.0.10415845&transactiontype=CONTRACTCALL&limit=5&order=desc" \
  | jq '.transactions[] | {consensus_timestamp, scheduled, result, charged_tx_fee}'
```

Every row comes back `"scheduled": true`. **Nobody sent those transactions.** The contract
scheduled them for itself through the Hedera Schedule Service (HIP-1215, system contract
`0x16b`), and the network executed them — charging the contract's own gas reserve, not a
server, not a cron job, not a person.

---

## 🏁 Headline number

> Across **30 of 30** renewals this contract has ever armed, the Hedera Schedule Service
> executed the call a median of **64 ms** — p95 **151 ms** — after the exact second it was
> asked for. Never early, never later than 248 ms.

That is the whole product in one measurement. Self-renewal is only real if the network turns up
when the contract said it would, and this is Hedera's own record of it turning up.

---

## 🧾 Real run — receipt

One genuine end-to-end run of the product, not a replay. Real HBAR, real settlement, real
unattended renewals.

**Command** (the real, zero-flag path; `scripts/retainer-agent.ts`, unchanged):

```bash
BASE_URL=https://retainer.edycu.dev \
RETAINER_ACCESS_ADDRESS=0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931 \
yarn tsx scripts/retainer-agent.ts
```

| Metric | Value |
|---|---|
| Run window | 2026-09-09T13:06:23Z → 13:08:50Z |
| Wall clock | **147 s**, of which **135 s** is the script deliberately sitting past expiry sending nothing |
| Agent spend | **3.00000000 ℏ** (300,000,000 tinybar), one x402 payment, `0.0.10403066` → `0.0.10402910` |
| Agent network fees | **0.00000000 ℏ** — the 0.00254287 ℏ CryptoTransfer fee was charged to Blocky402's fee payer `0.0.7162784` |
| On-chain transactions signed by the agent | **0** |
| Seller spend, `subscribeFor()` | 1.66587516 ℏ |
| Unattended renewals executed | **2** — 1.60263036 ℏ (charged a period and re-armed) + 0.05432076 ℏ (charged the last period, then `Lapsed`) |
| Total HBAR moved or burned | 3.00000000 paid + 3.32536915 in fees |

**Timeline, from consensus timestamps:**

| UTC | What happened | Evidence |
|---|---|---|
| 13:06:27.251382149 | x402 payment settled through the Blocky402 facilitator | [`0.0.7162784@1788959177.453258623`](https://hashscan.io/testnet/transaction/0.0.7162784@1788959177.453258623) |
| 13:06:28.927540241 | resource server forwarded it into `subscribeFor(agent)`; first renewal armed | [`0xf339932e…c901227`](https://hashscan.io/testnet/transaction/0xf339932e125a8d71fbf2cce36235faa2594ff06bf56a940ddfd47d409c901227) |
| 13:07:58.032191312 | **renewal #1 — nobody sent it** | scheduled `CONTRACTCALL`, **+32 ms** after the armed second |
| 13:08:50 | script exits | — |
| 13:09:28.009026464 | **renewal #2 fired 38 s after the script had exited** | scheduled `CONTRACTCALL`, **+9 ms** after the armed second |

The last row is the point. No process of ours was running.

Re-check the whole receipt against the ledger:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=0.0.10415845&limit=4&order=desc" | jq
```

---

## ▶️ Reproduce

```bash
git clone https://github.com/edycutjong/retainer && cd retainer
corepack enable && yarn install     # Node >= 20.18.3, Yarn 3.2.3
yarn bench
```

No `.env`, no keys, no local chain, no seeded fixture. The defaults point at the live
deployment (`https://retainer.edycu.dev`) and the public Hedera testnet mirror node. Runs in
about 45 s and exits nonzero if any assertion fails.

Overridable: `BASE_URL`, `MIRROR_NODE_URL`, `RETAINER_CONTRACT_ID`, `SEED` (default 42),
`BENCH_SAMPLES`, `BENCH_CHALLENGE_SAMPLES`, `BENCH_WARMUP`.

Want only the headline, with no clone at all? The drift figure is derivable from two public
mirror-node endpoints — the `RenewalScheduled` logs give the second each renewal was armed for,
the account's `scheduled=true` transactions give when Hedera executed it. `measureDrift()` in
[`packages/nextjs/scripts/bench.ts`](packages/nextjs/scripts/bench.ts) does exactly that, in
about thirty lines.

---

## 📈 Full results

Run of 2026-09-09T13:12Z, `yarn bench`, seed 42, first 5 requests per scenario discarded as
warm-up.

| Scenario | n | min | p50 | p95 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| Gate — `GET /api/retainer/status` (ms) | 60 | 317.4 | 339.3 | 400.1 | 476.3 | 345.5 |
| 402 challenge — `GET /api/retainer/access`, cold agent (ms) | 30 | 364.8 | 385.3 | 427.3 | 432.5 | 392.1 |
| **Schedule drift — armed second → execution (s)** | **30** | **0.001** | **0.064** | **0.151** | **0.248** | **0.064** |

Assertions, all passing, each one a nonzero exit if it breaks:

- gate answers `200`, reports the contract under test, and the seeded probe addresses hold no
  subscription — which is what keeps the gate and challenge scenarios read-only
- cold request answers `402` with a `PAYMENT-REQUIRED` header, x402 v2, `hedera:testnet`,
  scheme `exact`, asset `0.0.0`, amount `300000000`
- every armed renewal was executed by the network (`unexecuted = 0`)
- no renewal executed *before* its armed second
- every renewal landed inside `RENEW_SLACK` (30 s), the tolerance the contract itself was
  written against

---

## 🔬 Methodology & limitations

**Machine and network.** Apple M1 Max, macOS 26.5.2, Node v22.22.0, residential connection;
7 ms ICMP RTT to the deployment's edge. Requests are strictly sequential — this is a latency
measurement, not a load test, and says nothing about throughput or behaviour under concurrency.

**What the latency figures include.** Client-observed wall clock for a full round trip,
response body read included. That bundles the Vercel function's own time *and* the Hedera
JSON-RPC read it makes; it is not a server-side timing. At 7 ms RTT to the edge, essentially
all of the ~340 ms is server-side work rather than client distance. One location, one hour,
one run.

**Percentiles.** Linear-interpolated (R-7, the NumPy/Excel default), stated because definitions
disagree at small n. At n = 30 a p95 is close to the second-largest sample — a weak tail
estimate. Treat 151 ms as "the tail we have observed", not a service-level guarantee.

**The drift sample is a population, not a sample.** All 30 renewals this deployment has ever
armed are in it, because the contract emits `RenewalScheduled(agent, schedule, firesAt)` and
every one of those pairs to a `scheduled=true` CONTRACTCALL. Nothing was selected out.

**Disclosed seeding.** That traffic is operator-generated: every renewal came from subscriptions
we funded ourselves on testnet, at a demo period of 90 seconds. There are no external users in
this sample.

**One execution reverted, and it is counted.** `1788840415.078121802` returned
`CONTRACT_REVERT_EXECUTED` — the contract's own `Insolvent()` guard firing against Hedera's
gas reservation for the scheduled call, written up in
[`docs/gas-economics.md`](docs/gas-economics.md). The network still arrived on time (+78 ms), so
its drift stays in the sample; dropping a call that showed up would flatter the number.

**Testnet, not mainnet.** Every figure here is Hedera *testnet*. Mainnet load, fees and
scheduling behaviour may differ, and this project has not measured them.

**Renewal cost, reconciled.** This run's re-arming renewal charged 1.60263036 ℏ against the
1.54896 ℏ and 1.54036 ℏ recorded in [`docs/gas-economics.md`](docs/gas-economics.md) — 3.5%
higher, consistent with the gas-price movement that document already flags. The conclusion it
draws is unchanged: re-arming is ~97% of what a renewal costs (1.60263036 vs 0.05432076 ℏ here,
a 29.5× split), and at 1 ℏ per period Retainer still loses money on every unattended renewal.

**Not measured, on purpose.** The paid path (402 → sign → settle → 200) moves real money and
changes on-chain state, so it has one honest receipt above and no percentile. A p95 over a path
run once would be a fabricated number wearing a statistic's clothes. `renew()` gas is measured
in `docs/gas-economics.md` and not re-derived here.
