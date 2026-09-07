# Retainer — architecture

**Agents can pay for a call. They cannot subscribe.**
Every x402 payment today is one-shot: an agent hits a 402, signs, retries, gets its data.
When access expires, something has to pay again — and today that something is a human, or an
off-chain cron job someone has to run and keep alive.

Retainer removes both. An agent's access **renews itself on-chain**, with nobody awake.

## The flow

```
  Agent ──1── GET /resource ─────────────▶ Resource server
        ◀─2── 402 + payment requirements
        ──3── sign (Hedera exact scheme)
        ──4── retry with X-PAYMENT ───────▶ Resource server
                                             │
                              5 verify+settle│
                                             ▼
                                    Blocky402 facilitator
                                             │ co-signs as fee payer,
                                             │ submits TransferTransaction
                                             ▼
                                       Hedera testnet
        ◀─6── 200 + settlement reference
                                             │
                              7 log settlement
                                             ▼
                                       HCS topic (audit trail)

  ── on payment, the contract schedules its own next renewal ──
                                             │
                                             ▼
                            HederaScheduleService.scheduleCall()
                            fires at expiry → renews → no cron, no human
```

## Components

| Component | Role |
|---|---|
| **Resource server** (Next.js) | Serves the gated resource, issues 402s, talks to the facilitator over HTTP |
| **Blocky402 facilitator** (hosted) | Verifies the buyer's signature, co-signs as fee payer, submits to Hedera, returns a settlement reference |
| **Access contract** (Solidity, Hedera testnet) | Records access windows; schedules its own renewal |
| **Agent** (programmatic) | Holds a key, signs payments, never needs a human |
| **HCS topic** | Append-only audit trail of every settlement |

## Why each Hedera piece is load-bearing

Removing any of these breaks the product rather than degrading it:

- **`HederaScheduleService.scheduleCall()`** — the renewal itself. Without it there is no
  self-renewal, only a cron job someone has to operate. This is the product.
- **x402 via Blocky402** — the payment rail. Settlement is a native `TransferTransaction`:
  the agent signs partially, the facilitator co-signs as fee payer and submits.
- **HCS** — the audit trail. Each settlement is written to a topic, so renewals are
  independently verifiable rather than trusted.
- **Exchange Rate system contract** (`tinycentsToTinybars`) — prices access in exact USD
  cents instead of overpaying in round HBAR and ignoring the refund.

## Networks

Hedera **testnet** throughout. Blocky402's hosted testnet facilitator advertises
`hedera:testnet` with scheme `exact` (x402 v2) and supplies its own fee payer, so no
self-hosted facilitator is required.

## Notes

Account balances are read via the **Mirror Node REST API**. `AccountBalanceQuery` is
deprecated as of Consensus Node v0.77 (September 2026) and is deliberately not used.
