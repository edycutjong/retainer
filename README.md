<div align="center">

<!-- ASSET TODO: icon not produced yet — add <img src="docs/icon.svg" alt="Retainer Icon" width="144"> here once it exists -->

<h1>Retainer 🔁</h1>

<p><em>Your agent's access renews itself on-chain at 3am, with nobody awake.</em></p>

<!-- ASSET TODO: hero image not produced yet — add <img src="docs/readme-hero.png" alt="Retainer — your agent's access renews itself on-chain" width="100%"> here once it exists -->

<p>An x402-gated resource on Hedera whose access window is an on-chain subscription that the
Hedera Schedule Service extends by itself.</p>

<br/>

[![Live Demo](https://img.shields.io/badge/🚀_Live-Demo-06b6d4?style=for-the-badge)](https://retainer-plum.vercel.app)
[![Live Contract](https://img.shields.io/badge/⛓️_HashScan-0.0.10415845-8b5cf6?style=for-the-badge)](https://hashscan.io/testnet/contract/0.0.10415845)
[![Built for ETHOnline 2026](https://img.shields.io/badge/ETHGlobal-ETHOnline_2026-1f6feb?style=for-the-badge)](https://ethglobal.com/events/ethonline2026)

<br/>

![Next.js](https://img.shields.io/badge/Next.js_15-black?style=flat&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity_0.8.28-363636?style=flat&logo=solidity&logoColor=white)
![Hardhat](https://img.shields.io/badge/Hardhat-FFF100?style=flat&logo=hardhat&logoColor=black)
![Hedera](https://img.shields.io/badge/Hedera-testnet-000000?style=flat&logo=hedera&logoColor=white)
![x402](https://img.shields.io/badge/x402-exact_scheme-06b6d4?style=flat)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/edycutjong/retainer/actions/workflows/lint.yaml/badge.svg)](https://github.com/edycutjong/retainer/actions/workflows/lint.yaml)

</div>

---

**Live:** <https://retainer-plum.vercel.app> · try the gate yourself:

```bash
# a cold agent is charged
curl -i "https://retainer-plum.vercel.app/api/retainer/access?agent=0x0000000000000000000000000000000000000abc"
# → 402, with an x402 challenge for hedera:testnet settled by Blocky402

# read any agent's window without touching the payment path
curl -s "https://retainer-plum.vercel.app/api/retainer/status?agent=0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66"
```

## 💡 The Problem & Solution

### The Problem

An agent can pay for a thing. An agent cannot *subscribe* to a thing, because every renewal
needs somebody awake to re-authorise it — a human clicking, or a cron job someone has to
operate and keep alive. Retainer removes that person.

### The Solution — what actually happens

A walkthrough you can follow against the running server. The agent's address is passed as
`?agent=0x…`; the only thing it ever signs is the payment in step 2.

**1 — cold request, no access**

```
GET /api/retainer/access?agent=0xAGENT
→ 402  Payment Required
```

The route reads `hasAccess(agent)` on-chain, gets `false`, and builds x402 payment
requirements: `scheme: exact`, `network: hedera:testnet`, asset native HBAR, amount
`RETAINER_PRICE_TINYBAR × RETAINER_PERIODS_PER_PURCHASE`. The challenge body is emitted
verbatim in the `PAYMENT-REQUIRED` header so ordinary x402 clients can parse it.

**2 — the agent pays once**

The agent signs a Hedera `TransferTransaction` under the x402 `exact` scheme and retries with
the payment header. The resource server verifies and settles through the hosted **Blocky402**
facilitator (`https://api.testnet.blocky402.com`), which co-signs as fee payer and submits to
consensus. Nothing is served until funds are actually captured.

**3 — the settled payment becomes on-chain state**

This is the join between the two rails. The server takes the amount it just received and
calls `RetainerAccess.subscribeFor(agent)` with it. That opens the subscription, charges
period one, and **arms the first scheduled renewal**. The response carries both transactions:

```jsonc
{
  "access": "granted",
  "paidThisRequest": true,
  "payment":      { "transaction": "0.0.…@…", "payer": "0.0.…" },
  "subscription": { "opened": true, "transaction": "0x…", "periodsPurchased": 3 }
}
```

If settlement succeeds but the on-chain forward fails, the request is still served and
`subscription.opened` is `false` with the error — the route never implies a subscription that
does not exist.

**4 — the second request, inside the window**

```
GET /api/retainer/access?agent=0xAGENT
→ 200  { "paidThisRequest": false, … }
```

No 402, no signature, no payment. The gate asked the chain one question and the answer was yes.

**5 — a request after the window has expired**

```
GET /api/retainer/access?agent=0xAGENT
→ 200  { "paidThisRequest": false, … }
```

Still 200. Nothing was paid, nobody was awake, no cron job ran. Between step 4 and step 5 the
Hedera Schedule Service called `renew()` on the contract, which charged the next period and
extended the window. One x402 payment buys `RETAINER_PERIODS_PER_PURCHASE` periods (default
3): the first is charged when the subscription opens, the rest are charged by unattended
renewals.

`GET /api/retainer/status?agent=0x…` is the read-only version of the same state — it touches
the chain and nothing else, so a UI can poll it without repeatedly opening payment challenges.
The page at `/` uses it to show the window counting down and then jumping back up on its own.

## 🏗️ Architecture & Tech Stack

Two rails. The payment rail is off-chain HTTP that settles on Hedera; the renewal rail is
purely on-chain. They join in exactly one place: `subscribeFor()`.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/architecture-light.svg">
    <img alt="Retainer architecture: a payment rail that settles once through Blocky402 on Hedera, joined by subscribeFor to a renewal rail where the Hedera Schedule Service calls renew on the contract unattended." src="docs/architecture-light.svg" width="100%">
  </picture>
</p>

<details>
<summary>Same diagram as plain text</summary>

```
  PAYMENT RAIL (once, at the start)
  ─────────────────────────────────
   Agent ──1─ GET /api/retainer/access ─────▶ Resource server (Next.js)
         ◀─2─ 402 + payment requirements          │ reads hasAccess(agent)
         ──3─ sign Hedera "exact" transfer        │
         ──4─ retry with payment header ─────────▶│
                                                  │ 5 verify + settle
                                                  ▼
                                       Blocky402 facilitator (hosted)
                                                  │ co-signs as fee payer,
                                                  │ submits TransferTransaction
                                                  ▼
                                           Hedera testnet
         ◀─6─ 200 + settlement reference ─────────┘

                    ── THE JOIN ──
      the server forwards what it received on-chain:
         RetainerAccess.subscribeFor(agent) { value }
                          │
                          ▼
  RENEWAL RAIL (from here on, unattended)
  ───────────────────────────────────────
   ┌────────────────────────────────────────────────────────────┐
   │ RetainerAccess.sol            (Hedera testnet)             │
   │   charges period 1, sets expiresAt                         │
   │   hasScheduleCapacity(expiresAt, gas)  ── ask first        │
   │   scheduleCall(this, expiresAt, gas, renew(agent)) ── arm  │
   └───────────────┬────────────────────────────────────────────┘
                   │  at expiresAt, with no caller
                   ▼
        Hedera Schedule Service  (HIP-1215, system contract 0x16b)
                   │  executes CONTRACTCALL, scheduled=true
                   ▼
   ┌────────────────────────────────────────────────────────────┐
   │ renew(agent): charge next period, extend window,           │
   │               arm the following renewal ───────────────────┼──┐
   └────────────────────────────────────────────────────────────┘  │
                   ▲                                               │
                   └───────────────────────────────────────────────┘
                        loops until money or gas reserve runs out,
                        or the subscriber cancels — always with an event

   Later requests ask one on-chain question: hasAccess(agent) → 200, nothing paid.
```

</details>

### Tech stack

| Layer | What |
|---|---|
| Resource server | Next.js 15 (App Router) + TypeScript — `packages/nextjs` |
| Payment | x402 `exact` scheme (`@x402/core`, `@x402/hedera`), settled by the hosted Blocky402 facilitator |
| Contract | Solidity 0.8.28, Hardhat — `packages/hardhat` |
| Self-renewal | Hedera Schedule Service (HIP-1215), system contract `0x16b` |
| Chain | Hedera testnet — JSON-RPC via Hashio, artifacts re-verified against the public mirror node |
| Chain client | ethers v6 |

### What is actually being sold

A subscription to nothing is not a product, so the gated resource is a real metered data feed,
not a constant string.

It serves the **live HBAR/USD rate the Hedera network itself uses**, read from the mirror node
(`/api/v1/network/exchangerate`). That rate is not a third-party quote — it is the number the
network applies when converting its USD-denominated fee schedule into tinybar, which is what
makes Hedera fees predictable and sub-cent. An agent metering this feed is reading the same
number that priced its own transaction.

**The charge is metered, not flat.** A period does not buy unlimited use; it buys a countable
quantity of calls (`callsPerPeriod`). Every served call is counted **on-chain** by
`meter(agent)` before the response goes out, so the tally is auditable by the buyer rather than
asserted by the seller. Spend the allowance and the route answers `429` — the window is still
open, but what the period bought is used up.

And this is where the two halves meet: **the unattended renewal refills the meter.** The same
scheduled call that extends the access window resets `callsUsed` to zero. That is what makes a
self-renewing subscription worth having rather than a novelty.

```jsonc
{
  "access": "granted",
  "paidThisRequest": false,
  "metering": {
    "callsRemainingThisPeriod": 3,
    "recordedOnChain": "0x…"          // one Hedera transaction per served call
  },
  "resource": {
    "pair": "HBAR/USD",
    "rate": 0.08258,
    "raw": { "centEquivalent": 247738, "hbarEquivalent": 30000 },
    "source": "https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate"
  }
}
```

Metering each call on-chain costs one transaction per request, which is only reasonable because
Hedera fees are sub-cent. On a chain with real gas this design would be indefensible, and that
tradeoff is the honest reason it is written this way here rather than kept in a database.

### Money is kept in three pots

`RetainerAccess` never mixes whose money is whose, and `_solvent()` asserts the contract's
balance still covers all three at the end of every call that moves money out of a pot —
`subscribe`/`subscribeFor`, `renew`, `cancel` and `withdraw`:

| Pot | Whose | Spent on |
|---|---|---|
| `_owed` | the subscriber's | drawn down one period at a time; whatever is unspent is refunded on `cancel()` |
| `revenue` | the seller's | withdrawable by `beneficiary` only |
| `gasReserve` | the seller's | the network's fee for each scheduled execution |

Every amount is **tinybar**, and the contract converts nothing. Hedera has two denominations
and the boundary is not where an Ethereum instinct puts it: the JSON-RPC relay speaks
**weibar** (1 HBAR = 1e18), so the `value` you sign is 1e18-scaled, but inside the EVM
`msg.value`, `address(this).balance` and the `value` of an outbound `call{value:}` are all
**tinybar** (1 HBAR = 1e8). The relay converts at the edge. Adding the 1e10 conversion that
Ethereum experience asks for overpays every transfer by ten orders of magnitude, and it still
looks like a successful transaction. This was settled by measurement, not by reasoning:
`packages/hardhat/contracts/test/UnitProbe.sol` was deployed to testnet, sent 2 HBAR as 2e18 on
the wire, and reported `msg.value == 200000000`.

## 🏆 Hedera Schedule Service Integration

Three methods from `HederaScheduleService` (HIP-1215, system contract `0x16b`), all
load-bearing — remove any one and the product breaks rather than degrades:

| Method | Where | What it is for |
|---|---|---|
| `scheduleCall` | `_armRenewal()` | Arms the next renewal: asks the network to call `renew(agent)` on this contract at `expiresAt`. This *is* the product — without it there is only a cron job someone has to run. |
| `hasScheduleCapacity` | `_armRenewal()` | Asked **before** arming. A second with no capacity becomes a clean `Lapsed` event instead of a revert or a subscription that silently stops. |
| `deleteSchedule` | `_releaseSchedule()` | Releases the pending schedule on `cancel()` and returns its held gas to the reserve. Without it, subscribe→cancel churn is a free, repeatable drain of the seller's reserve. |

Two details that only show up on a real network:

- **A scheduled call can see a block timestamp behind its own second.** Observed on testnet
  against contract `0.0.10406002`: the schedule was armed for `expiresAt = 1788779924`, the
  network executed it at consensus `1788779924.038958161`, and `renew()` still reverted with
  `CONTRACT_REVERT_EXECUTED`. A strict `block.timestamp >= expiresAt` gate therefore rejects the
  network's own call and self-renewal silently stops. `renew()` allows `RENEW_SLACK = 30`
  seconds of earliness, and `MIN_PERIOD_SECONDS = 61` keeps that tolerance a strict minority
  of every period so `renew()` cannot be looped by a third party at the seller's expense.
- **Lapsing is loud.** `Lapsed` is emitted *before* scheduling, because a scheduled call that
  cannot pay for itself fails with `INSUFFICIENT_PAYER_BALANCE` and emits nothing at all — the
  subscription would otherwise look alive forever while being dead.

## ⛓️ Live Deployment — proof on Hedera testnet

There are two deployments on testnet, and they are not interchangeable:

| | Contract | What it is |
|---|---|---|
| **Current** | `0.0.10415845` / `0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931` · [HashScan](https://hashscan.io/testnet/contract/0.0.10415845) | `RetainerAccess.sol` as it stands in this repo. It is what `packages/nextjs/contracts/deployedContracts.ts` points at, so it is the contract the resource server talks to. |
| **First** | `0.0.10406083` / `0x8B42a662b0Bd5EecF09517840f63A61AAbEb952A` · [HashScan](https://hashscan.io/testnet/contract/0.0.10406083) | The deployment that produced every gas and fee measurement below. It predates the current constructor and ABI, so do not read it as a copy of the current source. |

On the current deployment, one renewal has already executed unattended — `CONTRACTCALL`,
`scheduled=true`, `SUCCESS` at `1788827767.015718559`, charged 153,816,728 tinybar to the
contract — and `cancel()` then deleted the pending schedule `0.0.10414197` and returned its
reserved gas. The cost measurements below are still quoted from the first deployment, because
that is the run that was measured end to end.

**An x402 payment settled through Blocky402:**
[`0.0.7162784@1788780154.225876092`](https://hashscan.io/testnet/transaction/1788780164.857913104)

**Three renewals the network executed on its own**, all `CONTRACTCALL` with `scheduled=true`
and status `SUCCESS`, read back from the mirror node. No transaction was sent to trigger any
of them:

| Consensus timestamp | Charged to the contract | What happened |
|---|---|---|
| [`1788780226.016366208`](https://hashscan.io/testnet/transaction/1788780226.016366208) | 154,896,000 tinybar = **1.54896 ℏ** | renewed **and** re-armed the next |
| [`1788780286.019735208`](https://hashscan.io/testnet/transaction/1788780286.019735208) | 154,896,000 tinybar = **1.54896 ℏ** | renewed **and** re-armed the next |
| [`1788780346.345418842`](https://hashscan.io/testnet/transaction/1788780346.345418842) | 5,067,825 tinybar = **0.0507 ℏ** | charged the last period, then found nothing left for a fifth: emitted `Lapsed("balance will not cover the next period")` and did **not** re-arm |

Gas used on testnet: `subscribe()` **1,582,554** (limit 2,000,000), deploy **968,564**.

## 📊 Engineering Rigor — gas economics, the honest part

The third row above is the whole cost story, and it is the most interesting thing this build
measured. A renewal that re-arms the next one costs **1.54896 HBAR**. A renewal that does not
re-arm costs **0.0507 HBAR**. That is a **~30×** gap between two executions of the same
function, and it means:

> Re-arming the next renewal — the `scheduleCall` into `0x16b` — is roughly **97%** of what a
> renewal costs. The renewal's own bookkeeping is the cheap 0.05 HBAR part.

The local Hardhat gas report, which mocks the scheduler and therefore excludes the
system-contract call, puts `renew()` at **48,247–77,085** gas and `subscribe()` at
**137,552–205,722**. The ~1.4M difference against testnet *is* the real `scheduleCall`. If you
only ever measure locally, you will not see the cost of this product at all.

It gets worse before it gets better: **Hedera refunds at most 20% of an unused gas limit**, so
`RENEWAL_GAS_LIMIT = 2_500_000` is charged at roughly 2,000,000 gas whether or not it is used.

**The consequence, stated plainly: at the default price of 1 HBAR per period, Retainer loses
money on every renewal**, because each renewal burns ~1.55 HBAR of the *seller's* gas reserve
to collect 1 HBAR of revenue. `RENEWAL_COST_ESTIMATE` (2 HBAR) is held out of the reserve per
armed renewal for exactly this reason, and `renewalsRemaining()` reports how many the reserve
can still afford.

This is the real constraint of on-chain self-renewal, and it is not solved here. Two things
move it:

1. **Right-size `RENEWAL_GAS_LIMIT`** toward the ~1.5M actually used. Recovers roughly a third.
2. **Price a period above the renewal cost.** This is what actually makes it solvent, and it
   is a product decision, not a code one: break-even is the ~1.55 HBAR a re-arming renewal
   actually costs, and the reserve drains at the 2 HBAR `RENEWAL_COST_ESTIMATE` the contract
   holds back per armed renewal. Below that, the seller is paying for its own users.

The full measurement — how Hedera charges a scheduled call, what the 1.549-vs-0.051 split
proves, and each option sized honestly — is in [`docs/gas-economics.md`](docs/gas-economics.md).
Every transaction, schedule and event behind the table above, with `curl` commands that
re-verify all of it against the public mirror node, is in [`docs/proof.md`](docs/proof.md).

A subscription therefore ends loudly rather than silently. Renewal stops with a `Lapsed` event
carrying its own reason string — `"balance will not cover the next period"`,
`"gas reserve will not cover the next renewal"`, `"no schedule capacity at that second"`,
`"network refused the schedule"`, or the defensive `"insufficient subscriber balance"` — and
the first four are asserted by name in the test suite. A subscriber who cancels is a separate
event, `Cancelled`: an ending they chose, not one that surprised them.

## 🚀 Getting Started

No Docker, no object storage, no self-hosted facilitator. Settlement uses the hosted Blocky402
testnet facilitator, which supplies its own fee payer.

### Prerequisites

Node.js ≥ 20.18.3 (Node 20 LTS), Yarn 3 via Corepack
(`corepack enable && corepack prepare yarn@stable --activate`), and a funded **ECDSA** Hedera
testnet account from the [Hedera Portal](https://portal.hedera.com/) faucet. ECDSA is required
— x402 on Hedera will not work with an ED25519 key.

### Installation

```bash
git clone https://github.com/edycutjong/retainer.git
cd retainer
yarn install
```

### 1. Contract keys and compile

```bash
cp packages/hardhat/.env.example packages/hardhat/.env
yarn hardhat:account:generate      # or: yarn hardhat:account:import
yarn hardhat:compile
yarn hardhat:test
```

Fund the printed deployer account with testnet HBAR before deploying.

### 2. Deploy `RetainerAccess`

```bash
RETAINER_PRICE_TINYBAR=100000000 \
RETAINER_PERIOD_SECONDS=3600 \
yarn hardhat:deploy --network hederaTestnet
```

After deploying, the script seeds the gas reserve with **8 HBAR** (`RETAINER_RESERVE_HBAR`) in a
separate `fundGasReserve()` call — not as constructor value, because Hedera credits a
contract-create's initial balance outside the EVM frame, where a payable constructor cannot book
it. A self-renewing contract has to hold gas for its own future; at the 2 HBAR
`RENEWAL_COST_ESTIMATE` the contract holds back per armed renewal, 8 HBAR arms four of them.
The script writes the address and native `0.0.x` contract id into
`packages/nextjs/contracts/deployedContracts.ts`, which the resource server reads
automatically.

### 3. Resource server

```bash
cp packages/nextjs/.env.example packages/nextjs/.env
```

Set these (the rest of the file has sensible defaults):

| Variable | What it is |
|---|---|
| `HEDERA_RPC_URL` | JSON-RPC endpoint. Defaults to `https://testnet.hashio.io/api`. |
| `FACILITATOR_URL` | `https://api.testnet.blocky402.com`. Already the code default. |
| `RETAINER_PAY_TO` | The seller's Hedera account id (`0.0.x`) that x402 payments go to. |
| `RETAINER_PRICE_TINYBAR` | Price of one period. Default `100000000` (1 HBAR). Must match the contract's terms. |
| `RETAINER_PERIODS_PER_PURCHASE` | How many periods one payment buys. Default `3`. |
| `RETAINER_SERVER_KEY` | ECDSA key of the seller account that forwards settled payments on-chain. Without it the 402 still settles but no subscription opens. |
| `RETAINER_ACCESS_ADDRESS` | Optional override; normally resolved from `deployedContracts.ts`. |

Then:

```bash
yarn next:dev
```

- `http://localhost:3000` — the live view: paste an agent address and watch the window count
  down and then extend itself. Everything on it is read from chain state via
  `/api/retainer/status`; nothing is simulated.
- `http://localhost:3000/api/retainer/access?agent=0x…` — the gate.
- `http://localhost:3000/api/retainer/status?agent=0x…` — read-only state, safe to poll.

### 4. Run the agent end to end

`packages/nextjs/scripts/retainer-agent.ts` is the demo as an agent experiences it: cold
request → 402 → pay via x402 → the server forwards that settled payment into `subscribeFor` →
the same request again, now 200 with `paidThisRequest:false` → wait past expiry sending
nothing → 200 again. It reads `BUYER_PRIVATE_KEY`, `BUYER_ACCOUNT_ID` and
`RETAINER_ACCESS_ADDRESS` from `~/.config/retainer/hedera.env` (credentials live outside the
repo):

```bash
cd packages/nextjs
BASE_URL=http://localhost:3000 yarn tsx scripts/retainer-agent.ts
```

If `RETAINER_SERVER_KEY` is not configured the server cannot forward the payment, so the
script opens the subscription itself with the agent's own key and says so — the rest of the
run is unchanged. It waits the seller's own `periodSeconds` (plus 45s of slack) unless
`PERIOD_SECONDS` overrides it.

`packages/hardhat/scripts/proveRenewal.ts` is the narrower proof that produced the testnet
measurements above: it reads the seller's terms off the contract, subscribes for three
periods, then *sends nothing* and re-reads `subscriptionOf` to show the window extended on its
own. It then cancels and compares the refund against the wallet balance, which is the
regression guard for the tinybar/weibar bug.

## 🧪 Testing & CI

```bash
yarn hardhat:test
```

**40 passing** in `packages/hardhat/test/RetainerAccess.test.ts`, grouped by the thing each
group protects: tinybar/weibar unit handling, the seller — not the subscriber — setting the
price, x402 settlement crediting the on-chain subscription, the `renew()` time gate that
closes the griefing vector, what the contract actually asks the scheduler to do, separation of
the three money pots, lapsing loudly in every failure case, and the access gate itself.
`MockScheduleService.sol` stands in for the `0x16b` system contract locally — which is exactly
why local gas numbers understate the real cost, as measured above.

`.github/workflows/lint.yaml` runs the same suite on every push and pull request to `main`,
alongside the contract compile, both lint passes and the TypeScript type check.

## 📁 Project Structure

```
packages/hardhat/
  contracts/RetainerAccess.sol          the subscription + self-renewal contract
  contracts/test/MockScheduleService.sol local stand-in for system contract 0x16b
  contracts/test/UnitProbe.sol          the tinybar/weibar measurement, run on testnet
  deploy/01_deploy_retainer_access.ts   deploys, then funds the gas reserve
  scripts/proveRenewal.ts               subscribe, send nothing, watch it renew
  test/RetainerAccess.test.ts           40 tests

packages/nextjs/
  app/api/retainer/access/route.ts      the x402 gate: 402, settle, subscribeFor
  app/api/retainer/status/route.ts      read-only chain state, safe to poll
  app/page.tsx                          the live view
  services/retainer/server.ts           contract reads + forwarding settled payments
  services/x402/server.ts               x402 resource server, Blocky402 facilitator
  scripts/retainer-agent.ts             the whole flow as an agent runs it

specs/                                  architecture and provenance
prompts/                                the prompts that directed the build
docs/proof.md                           every on-chain artifact, and how to re-verify it
docs/gas-economics.md                   what an unattended renewal actually costs
```

## 📄 License

MIT — see [`LICENCE`](LICENCE). The file retains the original copyright line from the
scaffold-hbar template it was inherited from.

## 🙏 Acknowledgments — provenance

This repository was built from **[hedera-dev/scaffold-hbar](https://github.com/hedera-dev/scaffold-hbar)**,
branch `templates/x402-pay-per-use` — the starter template Hedera's own bounty page lists as
official. Saying so plainly is the point: it is permitted, and hiding it would read far worse.

The template's own product — a MinIO-backed pay-per-download file marketplace with a
`FileRegistry` contract, a block explorer, `docker-compose`, and a self-hosted facilitator —
has been **removed**. What remains from it is the Hedera wallet/RPC plumbing, the Hardhat
setup, and the x402 client/server wiring. `RetainerAccess.sol`, both API routes, the retainer
service layer, the live view, the agent script, and the tests are this project's own.

Full file-by-file accounting, including a correction to an earlier overstatement, is in
[`specs/provenance.md`](specs/provenance.md). AI attribution per file is in
[`AI-USAGE.md`](AI-USAGE.md); the prompts that directed the build are in
[`prompts/`](prompts/).
