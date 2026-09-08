# For judges — Retainer in 30 seconds

> **Your agent's access renews itself on-chain at 3am, with nobody awake.**

An x402-gated metered data feed on Hedera whose access window is an on-chain subscription that
the **Hedera Schedule Service** (HIP-1215, system contract `0x16b`) extends by itself. The agent
signs exactly one thing — the first payment. Nothing signs anything again.

This page is also live at **<https://retainer-plum.vercel.app/judge>**. Nothing on it needs an
account, a key, or a clone.

---

## The 30-second path

Everything below runs against the live deployment. No setup, no keys, no install.

**1 — watch a cold agent get charged.** Copy this into a terminal:

```bash
curl -i "https://retainer-plum.vercel.app/api/retainer/access?agent=0x0000000000000000000000000000000000000abc"
```

You get **`402 Payment Required`** with a real x402 challenge — `scheme: exact`,
`network: hedera:testnet`, native HBAR — in the body *and* verbatim in the `PAYMENT-REQUIRED`
header, so an ordinary x402 client can parse it. That is the gate refusing service.

**2 — read an agent that already paid.** This one has a live subscription:

```bash
curl -s "https://retainer-plum.vercel.app/api/retainer/status?agent=0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66"
```

No 402. The window, the metered allowance, and the address of the *pending scheduled renewal*
come straight off the chain. Nothing here is served from a database.

**3 — check that on Hedera yourself, not on our word.** The contract the server just read:

- [`0.0.10415845` on HashScan](https://hashscan.io/testnet/contract/0.0.10415845) —
  `0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931`
- One renewal the **network executed on its own**, `CONTRACTCALL`, `scheduled=true`, `SUCCESS`:
  [`1788827767.015718559`](https://hashscan.io/testnet/transaction/1788827767.015718559).
  No transaction was sent to trigger it.

**4 — open the live view.** <https://retainer-plum.vercel.app> — paste an agent address and
watch the window count down and then jump back up on its own. Every number on it is a chain
read via `/api/retainer/status`.

That is the whole product. Steps 1 and 2 are the two halves of the claim; step 3 is the part
nobody has to trust us for.

---

## The receipt block

Real numbers from real runs, not estimates. Every one is re-verifiable against the public
Hedera mirror node — the exact `curl` commands are in [`docs/proof.md`](docs/proof.md).

| | |
|---|---|
| **x402 payment settled through Blocky402** | `0.0.7162784@1788830067.404863715` |
| **Unattended renewals executed by the network** | 4 across two deployments, all `scheduled=true` `SUCCESS` |
| **Cost of one self-re-arming renewal** | **1.54896 HBAR** (154,896,000 tinybar) |
| **Cost of a renewal that does *not* re-arm** | **0.0507 HBAR** (5,067,825 tinybar) |
| **→ what that ~30× gap proves** | re-arming — the `scheduleCall` into `0x16b` — is **~97%** of what a renewal costs |
| **Gas used, `subscribe()` on testnet** | 1,582,554 (limit 2,000,000) |
| **Gas used, deploy** | 968,564 |
| **Contract tests** | **46 passing** — `yarn hardhat:test` |
| **Resource-server unit tests** | **10 passing** — `yarn next:test` |
| **Amounts checked across the unit boundary** | **202,059**, three invariants each = 606,177 assertions |
| **Hedera Schedule Service methods used** | 3, all load-bearing: `scheduleCall`, `hasScheduleCapacity`, `deleteSchedule` |

The number worth ten seconds of attention is the 1.54896-vs-0.0507 split. It is the same
function executing twice, and it is the whole cost story of unattended on-chain renewal — see
[`docs/gas-economics.md`](docs/gas-economics.md).

---

## Reproduce it

**The real path** — this is the product, hitting the live server and the real chain. It needs a
funded ECDSA Hedera testnet account in `~/.config/retainer/hedera.env`
(`BUYER_PRIVATE_KEY`, `BUYER_ACCOUNT_ID`); credentials never live in the repo:

```bash
git clone https://github.com/edycutjong/retainer.git && cd retainer && yarn install
cd packages/nextjs
BASE_URL=https://retainer-plum.vercel.app yarn tsx scripts/retainer-agent.ts
```

Cold request → 402 → pay once over x402 → the server forwards that settled payment into
`subscribeFor` → the same request again, now 200 with `paidThisRequest:false` → **wait past
expiry sending nothing** → 200 again. The last step is the claim. A recorded run of exactly this
is at the end of [`docs/proof.md`](docs/proof.md).

**The deterministic replay** — CI only. This does *not* exercise the Schedule Service; it runs
against `MockScheduleService.sol`, because a Hardhat node has no system contract at `0x16b`. It
proves the contract logic, not the network behaviour, and it is never the demo:

```bash
yarn hardhat:test     # 46 contract tests
yarn next:test        # 10 unit tests, 202,059 amounts across the unit boundary
```

There is no offline, mock or demo mode for the product itself. The gate reads `hasAccess()` on
Hedera on every request; if the chain is unreachable the route fails rather than pretending.

---

## Honest limitations

Three real ones. None of them is fixed here.

1. **At the default price, Retainer loses money on every renewal.** A renewal burns ~1.55 HBAR
   of the seller's gas reserve to collect 1 HBAR of revenue. That is not a bug in the code — it
   is the actual economics of on-chain self-renewal at this gas limit, and pricing a period
   above the renewal cost is a product decision this build did not make. The measurement, and
   each option sized honestly, is in [`docs/gas-economics.md`](docs/gas-economics.md).
2. **The metering write is fire-and-forget.** The allowance is *enforced* by simulating
   `meter()` against current chain state, but the recording transaction is not awaited — waiting
   put Hedera finality inside a serverless request and timed it out. So a burst of requests
   arriving within the same few seconds can overshoot the allowance by roughly the number in
   flight. Bounded and small, and disclosed rather than discovered.
3. **The full lapse cycle was measured on the previous deployment.** `0.0.10406083` is the
   contract that ran to exhaustion and produced every cost number above; the current
   `0.0.10415845` has completed one unattended renewal and a cancel, not a full lapse. The two
   are one revision apart and `docs/proof.md` says exactly where they differ, including a
   selector that will not match if you go looking.

Also true: not audited, testnet only, and `RENEWAL_COST_ESTIMATE` is an explicit estimate — a
contract cannot know a future network fee.

---

## Links

| | |
|---|---|
| **Live app** | <https://retainer-plum.vercel.app> |
| **This page, live** | <https://retainer-plum.vercel.app/judge> |
| **Repository** | <https://github.com/edycutjong/retainer> |
| **Contract on HashScan** | [`0.0.10415845`](https://hashscan.io/testnet/contract/0.0.10415845) |
| **On-chain proof, with re-verify commands** | [`docs/proof.md`](docs/proof.md) |
| **What an unattended renewal costs** | [`docs/gas-economics.md`](docs/gas-economics.md) |
| **The unit trap, measured** | [`docs/hedera-units.md`](docs/hedera-units.md) |
| **Architecture** | [`specs/architecture.md`](specs/architecture.md) |
| **How AI was used, per file** | [`AI-USAGE.md`](AI-USAGE.md) · prompts in [`prompts/`](prompts/) |
| **Security properties, each next to its test** | [`.github/SECURITY.md`](.github/SECURITY.md) |
