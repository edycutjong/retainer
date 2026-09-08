# Retainer

**Your agent's access renews itself on-chain at 3am, with nobody awake.**

An x402-gated resource on Hedera whose access window is an on-chain subscription that the
Hedera Schedule Service extends by itself.

## The problem

An agent can pay for a thing. An agent cannot *subscribe* to a thing, because every renewal
needs somebody awake to re-authorise it — a human clicking, or a cron job someone has to
operate and keep alive. Retainer removes that person.

## What actually happens

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

## Architecture

Two rails. The payment rail is off-chain HTTP that settles on Hedera; the renewal rail is
purely on-chain. They join in exactly one place: `subscribeFor()`.

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

### Money is kept in three pots

`RetainerAccess` never mixes whose money is whose, and `_solvent()` asserts the contract's
balance still covers all three after every state change:

| Pot | Whose | Spent on |
|---|---|---|
| `_owed` | the subscriber's | periods, refunded in full on `cancel()` |
| `revenue` | the seller's | withdrawable by `beneficiary` only |
| `gasReserve` | the seller's | the network's fee for each scheduled execution |

Amounts are stored in **tinybar** everywhere and converted only at the EVM boundary, because
Hedera's EVM denominates `msg.value` and `address(this).balance` in **weibar**
(1 tinybar = 1e10 weibar). Mixing them underpays a transfer by ten orders of magnitude and
still looks like a successful transaction.

### Hedera Schedule Service integration

Three methods from `HederaScheduleService` (HIP-1215, system contract `0x16b`), all
load-bearing — remove any one and the product breaks rather than degrades:

| Method | Where | What it is for |
|---|---|---|
| `scheduleCall` | `_armRenewal()` | Arms the next renewal: asks the network to call `renew(agent)` on this contract at `expiresAt`. This *is* the product — without it there is only a cron job someone has to run. |
| `hasScheduleCapacity` | `_armRenewal()` | Asked **before** arming. A second with no capacity becomes a clean `Lapsed` event instead of a revert or a subscription that silently stops. |
| `deleteSchedule` | `_releaseSchedule()` | Releases the pending schedule on `cancel()` and returns its held gas to the reserve. Without it, subscribe→cancel churn is a free, repeatable drain of the seller's reserve. |

Two details that only show up on a real network:

- **The scheduler can fire early.** Observed on testnet executing at 1788779924 for a call
  scheduled at 1788779925. A strict `block.timestamp >= expiresAt` gate therefore rejects the
  network's own call and self-renewal silently stops. `renew()` allows `RENEW_SLACK = 30`
  seconds of earliness, and `MIN_PERIOD_SECONDS = 61` keeps that tolerance a strict minority
  of every period so `renew()` cannot be looped by a third party at the seller's expense.
- **Lapsing is loud.** `Lapsed` is emitted *before* scheduling, because a scheduled call that
  cannot pay for itself fails with `INSUFFICIENT_PAYER_BALANCE` and emits nothing at all — the
  subscription would otherwise look alive forever while being dead.

## Proof on Hedera testnet

Contract `0.0.10406083` / `0x8B42a662b0Bd5EecF09517840f63A61AAbEb952A` —
[HashScan](https://hashscan.io/testnet/contract/0.0.10406083).

> This is the first deployment, and it produced the measurements below. It predates the
> current contract's constructor and ABI; a redeploy is pending, so do not expect the live
> address to match `RetainerAccess.sol` as it stands in this repo today.

**An x402 payment settled through Blocky402:**
[`0.0.7162784@1788780154.225876092`](https://hashscan.io/testnet/transaction/0.0.7162784@1788780154.225876092)

**Three renewals the network executed on its own**, all `CONTRACTCALL` with `scheduled=true`
and status `SUCCESS`, read back from the mirror node. No transaction was sent to trigger any
of them:

| Consensus timestamp | Charged to the contract | What happened |
|---|---|---|
| [`1788780226.016366208`](https://hashscan.io/testnet/transaction/1788780226.016366208) | 154,896,000 tinybar = **1.54896 ℏ** | renewed **and** re-armed the next |
| [`1788780286.019735208`](https://hashscan.io/testnet/transaction/1788780286.019735208) | 154,896,000 tinybar = **1.54896 ℏ** | renewed **and** re-armed the next |
| [`1788780346.345418842`](https://hashscan.io/testnet/transaction/1788780346.345418842) | 5,067,825 tinybar = **0.0507 ℏ** | hit the gas-reserve guard, emitted `Lapsed`, did **not** re-arm |

Gas used on testnet: `subscribe()` **1,582,554** (limit 2,000,000), deploy **968,564**.

## Gas economics — the honest part

The third row above is the whole cost story, and it is the most interesting thing this build
measured. A renewal that re-arms the next one costs **1.54896 HBAR**. A renewal that does not
re-arm costs **0.0507 HBAR**. That is a **~30×** gap between two executions of the same
function, and it means:

> Re-arming the next renewal — the `scheduleCall` into `0x16b` — is roughly **97%** of what a
> renewal costs. The renewal's own bookkeeping is the cheap 0.05 HBAR part.

The local Hardhat gas report, which mocks the scheduler and therefore excludes the
system-contract call, puts `renew()` at **48,168–75,092** gas and `subscribe()` at
**177,765–199,665**. The ~1.4M difference against testnet *is* the real `scheduleCall`. If you
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
   is a product decision, not a code one: self-renewing access is worth selling above ~2 HBAR
   per period, or not at all.

The full measurement — how Hedera charges a scheduled call, what the 1.549-vs-0.051 split
proves, and each option sized honestly — is in [`docs/gas-economics.md`](docs/gas-economics.md).

A subscription therefore ends loudly rather than silently, in four cases, each with its own
`Lapsed` reason: the subscriber cancels, their balance cannot cover the next period, the gas
reserve cannot cover the next scheduled execution, or the network has no schedule capacity at
that second.

## Setup

No Docker, no object storage, no self-hosted facilitator. Settlement uses the hosted Blocky402
testnet facilitator, which supplies its own fee payer.

**Prerequisites:** Node.js ≥ 20.18.3 (Node 20 LTS), Yarn 3 via Corepack
(`corepack enable && corepack prepare yarn@stable --activate`), and a funded **ECDSA** Hedera
testnet account from the [Hedera Portal](https://portal.hedera.com/) faucet. ECDSA is required
— x402 on Hedera will not work with an ED25519 key.

```bash
git clone https://github.com/edycutjong/retainer.git
cd retainer
yarn install
```

**1. Contract keys and compile**

```bash
cp packages/hardhat/.env.example packages/hardhat/.env
yarn hardhat:account:generate      # or: yarn hardhat:account:import
yarn hardhat:compile
yarn hardhat:test
```

Fund the printed deployer account with testnet HBAR before deploying.

**2. Deploy `RetainerAccess`**

```bash
RETAINER_PRICE_TINYBAR=100000000 \
RETAINER_PERIOD_SECONDS=3600 \
yarn hardhat:deploy --network hederaTestnet
```

The deploy sends **8 HBAR** with the constructor to seed the gas reserve — a self-renewing
contract has to hold gas for its own future, and at ~1.55 HBAR per renewal that is about four
of them. It writes the address and native `0.0.x` contract id into
`packages/nextjs/contracts/deployedContracts.ts`, which the resource server reads
automatically.

**3. Resource server**

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

**4. Run the agent end to end**

`packages/nextjs/scripts/retainer-agent.ts` is the demo as an agent experiences it: cold
request → 402 → pay via x402 → 200 with `paidThisRequest:false` → wait past expiry sending
nothing → 200 again. It reads `BUYER_PRIVATE_KEY` and `RETAINER_ACCESS_ADDRESS` from
`~/.config/retainer/hedera.env` (credentials live outside the repo):

```bash
cd packages/nextjs
BASE_URL=http://localhost:3000 yarn tsx scripts/retainer-agent.ts
```

`packages/hardhat/scripts/proveRenewal.ts` is the narrower proof that produced the testnet
measurements above: it subscribes with a short period, then *sends nothing* and waits for
`Renewed` to fire on its own.

## Tests

```bash
yarn hardhat:test
```

**38 passing** in `packages/hardhat/test/RetainerAccess.test.ts`, grouped by the thing each
group protects: tinybar/weibar unit handling, the seller — not the subscriber — setting the
price, x402 settlement crediting the on-chain subscription, the `renew()` time gate that
closes the griefing vector, what the contract actually asks the scheduler to do, separation of
the three money pots, lapsing loudly in every failure case, and the access gate itself.
`MockScheduleService.sol` stands in for the `0x16b` system contract locally — which is exactly
why local gas numbers understate the real cost, as measured above.

## Provenance

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

## Repo layout

```
packages/hardhat/
  contracts/RetainerAccess.sol          the subscription + self-renewal contract
  contracts/test/MockScheduleService.sol local stand-in for system contract 0x16b
  deploy/01_deploy_retainer_access.ts   deploys and seeds the gas reserve
  scripts/proveRenewal.ts               subscribe, send nothing, watch it renew
  test/RetainerAccess.test.ts           38 tests

packages/nextjs/
  app/api/retainer/access/route.ts      the x402 gate: 402, settle, subscribeFor
  app/api/retainer/status/route.ts      read-only chain state, safe to poll
  app/page.tsx                          the live view
  services/retainer/server.ts           contract reads + forwarding settled payments
  services/x402/server.ts               x402 resource server, Blocky402 facilitator
  scripts/retainer-agent.ts             the whole flow as an agent runs it

specs/                                  architecture and provenance
prompts/                                the prompts that directed the build
```

## Licence

MIT — see [`LICENCE`](LICENCE). The file retains the original copyright line from the
scaffold-hbar template it was inherited from.
