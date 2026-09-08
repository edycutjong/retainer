# Retainer — architecture

**An agent can pay for a thing. An agent cannot *subscribe* to a thing.**

Every x402 payment today is one-shot: the agent hits a 402, signs, retries, gets its data.
When the access expires, something has to pay again — and today that something is a human, or
an off-chain cron job someone has to run and keep alive. Retainer removes that person: the
access window is extended by a call the Hedera network executes on the contract's behalf, at
the second the window ends, with nobody awake.

---

## The flow

```
  Agent ──1── GET /api/retainer/access?agent=0x… ──▶ Resource server (Next.js)
        ◀─2── 402 + payment requirements               │
        ──3── sign (Hedera `exact` scheme, x402 v2)    │ price = period price × periods/purchase
        ──4── retry with PAYMENT-SIGNATURE ──────────▶ │
                                                       │
                                        5 verify+settle│
                                                       ▼
                                            Blocky402 facilitator (hosted)
                                                       │ co-signs as fee payer,
                                                       │ submits a native TransferTransaction
                                                       ▼
                                                 Hedera testnet
                                                       │
        ◀─6── 200 + PAYMENT-RESPONSE ──────────────────┤
                                                       │
                        7 forward the settled payment  │ server key calls
                          on-chain, as the seller      │ RetainerAccess.subscribeFor(agent)
                                                       ▼
                                            ┌──────────────────────┐
                                            │   RetainerAccess     │
                                            │  charges period 1,   │
                                            │  opens the window,   │
                                            │  arms the renewal    │
                                            └──────────┬───────────┘
                                                       │ scheduleCall(this, expiresAt, …)
                                                       ▼
                                     Hedera Schedule Service — system contract 0x16b
                                                       │
                            at expiresAt, with no user, no server and no cron job:
                                                       │
                                            renew(agent) ──▶ charges the next period,
                                                             extends the window,
                                                             arms the following renewal

  Later requests:  GET /api/retainer/access  ──▶  200, `paidThisRequest: false`
                   …and still 200 after the window should have expired.
```

The interesting response is the second one. Nothing was paid, nothing was signed, and no human
or cron job was involved.

---

## Two rails, and the join between them

Retainer is two systems that do not natively know about each other, plus one line of code that
makes them the same subscription.

| | Rail | What it is | Where it lives |
|---|---|---|---|
| A | **x402 payment** | An off-chain HTTP payment protocol. The agent signs a native Hedera `TransferTransaction`; the Blocky402 facilitator co-signs as fee payer and submits it. Money moves to the seller's Hedera account. | `services/x402/server.ts`, `app/api/retainer/access/route.ts` |
| B | **On-chain subscription** | `RetainerAccess` on Hedera testnet: balances, windows, and a scheduled call that renews them. | `packages/hardhat/contracts/RetainerAccess.sol` |

A settled x402 payment is, by itself, just a transfer — it leaves no subscription behind. The
join is that the resource server, holding `RETAINER_SERVER_KEY`, forwards the same amount into
the contract:

- **`subscribeFor(agent)`** — opens a subscription for an agent that paid off-chain, charges
  period one, and arms the first scheduled renewal. Called by
  `openSubscriptionFor()` in `services/retainer/server.ts` immediately after settlement.
- **`creditFor(agent)`** — tops up an existing subscriber's refundable balance from a settled
  payment (`creditSubscription()`).

Both are deliberately permissionless: they only ever *add* money to the named agent's pot.
`subscribeFor` additionally requires the caller to fund at least one period themselves, so a
stranger cannot open an unwanted subscription that burns the agent's balance or the seller's
gas reserve — they can only make one a gift.

This is what lets an agent hold a self-renewing subscription **without ever signing an
on-chain transaction**. It signs one x402 payment; the network keeps the access alive from
there.

One payment buys `RETAINER_PERIODS_PER_PURCHASE` periods (default 3). The first is charged the
moment the subscription opens; every period after it is charged by an unattended renewal.
Selling a single period would mean the interesting thing never happens.

---

## Components

| Component | File | Role |
|---|---|---|
| **Resource server — the gate** | `app/api/retainer/access/route.ts` | Asks the chain one question (`hasAccess`). Open: serve, charge nothing. Closed: issue a 402, verify and settle through the facilitator, then forward the payment on-chain. |
| **Status route — read-only** | `app/api/retainer/status/route.ts` | Subscription state, safe to poll. Deliberately separate from the gate: polling the gate for an agent with no access would open a payment challenge every second just to draw a countdown. |
| **Contract reader/writer** | `services/retainer/server.ts` | viem public client for `hasAccess` / `subscriptionOf` / `renewalsRemaining`; wallet client for `subscribeFor` / `creditFor`. |
| **x402 wiring** | `services/x402/server.ts` | The single `x402ResourceServer`, registered with `ExactHederaScheme` on `hedera:testnet`, pointed at the facilitator. Holds no keys and no funds. |
| **Blocky402 facilitator** (hosted) | `https://api.testnet.blocky402.com` | Verifies the buyer's partial signature, co-signs as fee payer, submits to Hedera, returns a settlement reference. |
| **Access contract** | `contracts/RetainerAccess.sol` | Windows, three money pots, and its own scheduled renewals. |
| **Hedera Schedule Service** | system contract `0x16b` (HIP-1215) | Executes `renew(agent)` at the expiry second. |
| **Live view** | `app/page.tsx` | Watches one agent's window count down and jump back to a full period when a renewal fires. Every number is read from `/api/retainer/status`; nothing is simulated. |
| **Agent demo** | `scripts/retainer-agent.ts` | Drives the whole loop from a terminal: 402 → pay → free 200 → wait past expiry sending nothing → 200 again. |

---

## The contract

### Three separate pots

The contract holds money for three different purposes and never lets one spend another:

| Pot | Whose | Spent on |
|---|---|---|
| `_owed` | the subscribers' | refunded in full on `cancel()`; drawn down one period at a time by `renew()` |
| `revenue` | the seller's | charged periods, withdrawable by `beneficiary` |
| `gasReserve` | the network's claim on the seller | scheduled executions — the network charges **the contract** for each one, so a self-renewing contract must hold gas for its own future |

`_solvent()` asserts, after every state change, that the native balance still covers all three.
The beneficiary cannot withdraw subscriber money or the gas reserve; tests cover both.

### Three Schedule Service methods, all load-bearing

Removing any one of these breaks the product rather than degrading it:

- **`scheduleCall(address(this), expiresAt, RENEWAL_GAS_LIMIT, 0, renew(agent))`** — arms the
  next renewal. This *is* the product. Without it there is no self-renewal, only a cron job
  somebody has to operate.
- **`deleteSchedule(pending)`** — released on `cancel()`, which returns the reserved gas to
  `gasReserve`. Without it, subscribe→cancel churn is a free, repeatable drain of the seller's
  reserve.
- **`hasScheduleCapacity(expiresAt, gasLimit)`** — asked *before* arming. HIP-1215 exposes
  capacity up front, which turns "the network is full at that second" from a revert into a
  clean, visible lapse.

### Lapsing is loud, never silent

`Lapsed` is emitted **before** the scheduling attempt wherever the contract can see the failure
coming. A scheduled call that cannot pay for itself fails with `INSUFFICIENT_PAYER_BALANCE` and
emits nothing at all — the subscription would otherwise look alive forever while being dead.
Five reason strings are named explicitly. Four of them are asserted by name in the test suite:

- `"balance will not cover the next period"` — the period after this one is unaffordable
- `"gas reserve will not cover the next renewal"` — the seller's reserve is below
  `RENEWAL_COST_ESTIMATE`
- `"no schedule capacity at that second"` — `hasScheduleCapacity` said no
- `"network refused the schedule"` — `scheduleCall` returned a non-`SUCCESS` response code

The fifth, `"insufficient subscriber balance"` at the top of `renew()`, is a defensive branch
with no test, because `_armRenewal` deactivates a subscription one period *before* the money
runs out — so a renewal that reaches `renew()` with an empty balance should not be reachable.
It is kept rather than replaced with an assert: an unreachable branch that emits an event is
cheaper to be wrong about than one that reverts inside the network's own scheduled call.

A subscriber cancelling is **not** one of them: `cancel()` emits `Cancelled` and releases the
pending schedule, which is an ending the subscriber chose rather than one that surprised them.

### Guards worth knowing about

| Guard | Why it exists |
|---|---|
| Seller sets terms (`setTerms`), snapshotted per subscription | Letting the subscriber pick the price meant 2 tinybar bought a full window while burning ~2 HBAR of the seller's gas reserve. Changing terms never reprices a running subscription. |
| `renew()` is public, but time-gated | The network's scheduled call has no special identity, so `renew` must be callable by anyone. The gate is what stops a stranger looping it and burning the contract's own HBAR. |
| `RENEW_SLACK = 30s` | A scheduled call can see a block timestamp **behind** the second it was scheduled for. On testnet (`0.0.10406002`) a schedule armed for `expiresAt = 1788779924` executed at consensus `1788779924.038958161` and still reverted under a strict `>=` gate, silently breaking self-renewal. |
| `MIN_PERIOD_SECONDS = 61` | A period shorter than `2 × RENEW_SLACK` would leave the callable window permanently open, re-opening the griefing hole the slack created. |
| tinybar everywhere inside the contract | The JSON-RPC relay speaks **weibar** (1 HBAR = 1e18) and converts at the edge; inside the EVM `msg.value`, `address(this).balance` and an outbound `call{value:}` are all **tinybar** (1 HBAR = 1e8). So the contract converts nothing. Measured with `contracts/test/UnitProbe.sol` on testnet after an earlier 1e10 conversion overpaid every transfer by ten orders of magnitude (`9eb39e3`). |

**40 tests** cover these paths (`yarn hardhat:test`). The scheduler itself is mocked locally —
`contracts/test/MockScheduleService.sol`, installed at `0x16b` with `hardhat_setCode` — because
a local node has no Schedule Service and because testnet cannot be asked to refuse you on
demand. The mock stands in for the *scheduler*, never for the product logic; that the real
Schedule Service behaves as assumed is proven on testnet, below.

---

## What a renewal actually costs

Measured on Hedera testnet from the mirror node, not estimated.

| Event | Result |
|---|---|
| x402 payment settled through Blocky402 | tx `0.0.7162784@1788780154.225876092` |
| `subscribe()` | 1,582,554 gas (limit 2,000,000) |
| deploy | 968,564 gas |

Three scheduled `CONTRACTCALL`s then executed with `scheduled=True`, `SUCCESS`, with no
transaction from any user or server:

| Consensus timestamp | Charged | What happened |
|---|---|---|
| `1788780226.016366208` | 154,896,000 tinybar (1.54896 HBAR) | renewed **and re-armed** the next |
| `1788780286.019735208` | 154,896,000 tinybar (1.54896 HBAR) | renewed **and re-armed** the next |
| `1788780346.345418842` | 5,067,825 tinybar (0.0507 HBAR) | charged the last funded period, then emitted `Lapsed("balance will not cover the next period")` and did **not** re-arm |

**The 30x gap between the first two and the third is the whole cost story.** Re-arming the next
renewal — the `scheduleCall` into `0x16b` — is roughly 97% of what a renewal costs. The
renewal's own bookkeeping is the cheap 0.05 HBAR part. Local hardhat gas reports agree by
subtraction: with the scheduler mocked out, `renew()` measures 48,247–77,085 and `subscribe()`
137,552–205,722, so the ~1.4M gas difference against testnet *is* the real system-contract call.

Hedera refunds at most 20% of an unused gas limit, so `RENEWAL_GAS_LIMIT = 2,500,000` is
charged at roughly 2,000,000 gas whether or not it is used.

### The honest consequence

At `RETAINER_PRICE_TINYBAR = 100000000` (1 HBAR per period), **the product loses money on every
renewal**: the seller collects 1 HBAR of revenue and spends ~1.55 HBAR of gas reserve to
collect it. This is the real constraint of on-chain self-renewal and it is not solved here.

Two things move it, and both are stated as work, not as claims:

1. Right-sizing `RENEWAL_GAS_LIMIT` toward the ~1.5M actually consumed recovers roughly a
   third of the cost — the current 2.5M limit is paying for headroom that the 20% refund cap
   never returns.
2. Pricing a period above the renewal cost is what actually makes it solvent. Self-renewal is
   worth paying for above a floor set by the network, not below it.

`renewalsRemaining()` (`gasReserve / RENEWAL_COST_ESTIMATE`, where the estimate is 2 HBAR with
headroom over the measured 1.5490) is the contract's own answer to "how many more times can
this run", and the live view shows it.

---

## Networks and deployment

Hedera **testnet** throughout. Blocky402's hosted testnet facilitator advertises
`hedera:testnet`, scheme `exact`, x402Version 2, and supplies its own fee payer — so no
self-hosted facilitator, and no Docker, is required.

Two deployments, and they are not the same code. Keeping them apart is the point:

- **The measured one** — `0.0.10406083` / `0x8B42a662b0Bd5EecF09517840f63A61AAbEb952A`,
  <https://hashscan.io/testnet/contract/0.0.10406083>. Every cost figure above came off this
  contract. It predates the later contract fixes and carries an older constructor and ABI, so
  it does **not** run `RetainerAccess.sol` as it stands today.
- **The current one** — `0.0.10415845` / `0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931`,
  <https://hashscan.io/testnet/contract/0.0.10415845>. This is the address in
  `packages/nextjs/contracts/deployedContracts.ts`, so it is the contract the resource server
  actually talks to. It has renewed itself once unattended; it has not been run to exhaustion,
  which is why the cost table is still quoted from the older deployment.

[`docs/proof.md`](../docs/proof.md) holds the mirror-node evidence for both, with the exact
requests to re-check it.

### Configuration

`packages/nextjs/.env.example`:

| Variable | Meaning |
|---|---|
| `HEDERA_RPC_URL` | JSON-RPC endpoint the server reads the contract through |
| `FACILITATOR_URL` | `https://api.testnet.blocky402.com` — the code default, so a fresh clone uses the correct rail with no configuration |
| `RETAINER_PAY_TO` | The seller's Hedera account (`0.0.x`) that x402 payments settle to |
| `RETAINER_PRICE_TINYBAR` | Price of one period; default `100000000` (1 HBAR) |
| `RETAINER_PERIODS_PER_PURCHASE` | How many periods one payment buys; default `3` |
| `RETAINER_SERVER_KEY` | ECDSA key that forwards settled payments on-chain. Without it the 402 still settles, but no subscription opens — and the route says so rather than implying one exists |
| `RETAINER_ACCESS_ADDRESS` | Deployed contract; normally resolved from `contracts/deployedContracts.ts` |

---

## Not built

Named here so nothing in this document is mistaken for something that ships.

- **HCS audit trail.** There is no Hedera Consensus Service topic in this repository and no
  code writes to one. An earlier version of this file listed an HCS topic as a component and
  called it load-bearing; that was false and is corrected here. Settlement references are
  returned in the `PAYMENT-RESPONSE` header and are verifiable on HashScan, which is where the
  audit trail actually is today.
- **USD pricing via the Exchange Rate system contract.** `tinycentsToTinybars` is not called
  anywhere. Prices are set and charged in tinybar. An earlier version of this file claimed
  exact-USD-cent pricing; that was also false. Quoting a period in cents would be a real
  improvement — a subscription whose price drifts with the HBAR rate is a worse product — but
  it is unbuilt.
- **Mainnet.** Testnet only.

## Removed from the starter

This repository began as Hedera's own `x402-pay-per-use` starter template, whose product was a
MinIO-backed pay-per-download file marketplace with a self-hosted facilitator, a `FileRegistry`
contract, a block explorer and a `docker-compose` stack. The product is gone — nothing above
runs on any of it, and Retainer needs no Docker, no object storage and no self-hosted
facilitator. A few unused files and keys it touched have not been swept yet;
[`provenance.md`](provenance.md) names each one under "Template residue" rather than leaving a
judge to find them, alongside the full account of what came from the template, what was
deleted, and what was written here.

## Notes

Account balances are read via the **Mirror Node REST API**. `AccountBalanceQuery` is deprecated
as of Consensus Node v0.77 (September 2026) and is deliberately not used.
