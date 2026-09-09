# For judges — Retainer in 30 seconds

> **Your agent's access renews itself on-chain at 3am, with nobody awake.**

An x402-gated metered data feed on Hedera whose access window is an on-chain subscription that
the **Hedera Schedule Service** (HIP-1215, system contract `0x16b`) extends by itself. The agent
signs exactly one thing — the first payment. Nothing signs anything again.

This page is also live at **<https://retainer.edycu.dev/judge>**. Nothing on it needs an
account, a key, or a clone.

---

## The 30-second path

Everything below runs against the live deployment. No setup, no keys, no install.

**1 — watch a cold agent get charged.** Copy this into a terminal:

```bash
curl -i "https://retainer.edycu.dev/api/retainer/access?agent=0x0000000000000000000000000000000000000abc"
```

You get **`402 Payment Required`** with a real x402 challenge — `scheme: exact`,
`network: hedera:testnet`, native HBAR — in the body *and* verbatim in the `PAYMENT-REQUIRED`
header, so an ordinary x402 client can parse it. That is the gate refusing service.

**2 — read an agent that has paid before.**

```bash
curl -s "https://retainer.edycu.dev/api/retainer/status?agent=0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66"
```

No 402. Whatever the chain says about this agent right now — window open, or lapsed with
`balanceTinybar: "0"` after its last run ended — the balance, the metered allowance and the
address of any *pending scheduled renewal* come straight off the contract. Nothing here is
served from a database, and nothing is made to look alive.

**3 — check that on Hedera yourself, not on our word.** The contract the server just read:

- [`0.0.10415845` on HashScan](https://hashscan.io/testnet/contract/0.0.10415845) —
  `0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931`
- One renewal the **network executed on its own**, `CONTRACTCALL`, `scheduled=true`, `SUCCESS`:
  [`1788844334.069565823`](https://hashscan.io/testnet/transaction/1788844334.069565823).
  No transaction was sent to trigger it. It is the first of eight in a row; all eight, and the
  one ordinary call that armed the first, come back from a single mirror-node request:

  ```bash
  curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7314364-1788844238-651641588" \
    | jq -r '.transactions[] | [.consensus_timestamp, .name, "scheduled=\(.scheduled)", .result, "fee=\(.charged_tx_fee)"] | @tsv'
  ```

**3b — read the payment audit trail.** Every settled payment is written to a public **Hedera
Consensus Service** topic, [`0.0.10440194`](https://hashscan.io/testnet/topic/0.0.10440194) —
immutable (no admin key), appendable only by the seller's account:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10440194/messages?order=asc" \
  | jq -r '.messages[] | "\(.sequence_number) \(.consensus_timestamp) \(.message | @base64d)"'
```

Each record names the x402 settlement id and, for the subscription it opened, the `subscribeFor`
transaction — so one identifier walks you from the off-chain payment to the on-chain access it
bought. `yarn verify:audit-trail` resolves every one of those identifiers on the mirror node and
exits non-zero if any of them does not check out. It needs no keys.

**4 — open the live view.** <https://retainer.edycu.dev> — paste an agent address and
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
| **x402 payment settled through Blocky402** | `0.0.7162784@1788840225.936068496` — 3 HBAR, agent → seller, fee paid by the facilitator; it opened the current deployment's subscription |
| **Unattended renewals executed by the network** | **19** across three deployments (3 · 7 · 9), every one `CONTRACTCALL` `scheduled=true` `SUCCESS` with a `Renewed` event. One further scheduled execution reverted — limitation 3 |
| **Cost of one self-re-arming renewal** | **1.54896 HBAR** (154,896,000 tinybar) on the first deployment; **1.54036 HBAR** (154,036,168) on the current one |
| **Cost of a renewal that does *not* re-arm** | **0.0507 HBAR** (5,067,825 tinybar) on the first deployment; **0.0522 HBAR** (5,222,880) on the current one |
| **→ what that ~30× gap proves** | re-arming — the `scheduleCall` into `0x16b` — is **~97%** of what a renewal costs, on both deployments |
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
BASE_URL=https://retainer.edycu.dev yarn tsx scripts/retainer-agent.ts
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

Four real ones. None of them is fixed here.

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
3. **One scheduled renewal on the deployed source reverted.** At
   [`1788840415.078121802`](https://hashscan.io/testnet/transaction/1788840415.078121802) the
   network fired `renew()` on `0.0.10415845` and the call came back `CONTRACT_REVERT_EXECUTED`
   with the contract's own `Insolvent()` guard — the check that the three money pots never exceed
   `address(this).balance`. The account's real balance at that second, reconstructed from the
   mirror node, was 2,139,131,760 tinybar against pots totalling 1,900,000,000, so the balance the
   EVM exposed *during* the scheduled execution was lower than the account's — consistent with
   Hedera reserving the call's full gas cost on the payer before it runs. The subscription was
   restarted by hand (`creditFor`, then one ordinary `renew()`) and the network then executed
   eight renewals unattended to a loud lapse. The guard is right to exist and wrong to count that
   reservation; the fix needs a redeploy and is not made here. Three deployments exist —
   `0.0.10406083`, `0.0.10414167`, `0.0.10415845` — and [`docs/proof.md`](docs/proof.md) keeps
   them apart.
4. **A lapsed subscription cannot restart itself.** Lapsing is loud — every ending carries a
   `Lapsed` event with a reason string — but once `active` is false the contract will not re-arm.
   `renew(agent)` reverts `NotSubscribed()` (an `eth_call` against the live contract for a lapsed
   agent returns `0x237e6c28`, that error's selector) and `fund()` only credits the subscriber's
   balance; neither schedules anything. Opening a subscription again is the only way back —
   `subscribe()`, or the `subscribeFor()` the server calls when the agent pays the next 402. So
   the unattended part runs exactly as far as the money does: until the subscriber's balance or
   the seller's gas reserve runs dry, and then someone outside has to send a transaction. At the
   demo settings — 90-second periods, 2 ℏ held back per armed renewal — that is minutes, not
   months.

Also true: not audited, testnet only, and `RENEWAL_COST_ESTIMATE` is an explicit estimate — a
contract cannot know a future network fee.

---

## Links

| | |
|---|---|
| **Live app** | <https://retainer.edycu.dev> |
| **This page, live** | <https://retainer.edycu.dev/judge> |
| **Repository** | <https://github.com/edycutjong/retainer> |
| **Contract on HashScan** | [`0.0.10415845`](https://hashscan.io/testnet/contract/0.0.10415845) |
| **On-chain proof, with re-verify commands** | [`docs/proof.md`](docs/proof.md) |
| **Payment audit trail on HCS** | topic [`0.0.10440194`](https://hashscan.io/testnet/topic/0.0.10440194) · [`README.md`](README.md#-verifiable-payment-audit-trail-on-hcs) · `yarn verify:audit-trail` |
| **The API as MCP tools, and an agent that checks the claim** | [`README.md`](README.md#-the-api-as-mcp-tools--and-an-agent-that-checks-the-claim) · the spec itself at <https://retainer.edycu.dev/openapi.json> |
| **What an unattended renewal costs** | [`docs/gas-economics.md`](docs/gas-economics.md) |
| **The unit trap, measured** | [`docs/hedera-units.md`](docs/hedera-units.md) |
| **Architecture** | [`specs/architecture.md`](specs/architecture.md) |
| **How AI was used, per file** | [`AI-USAGE.md`](AI-USAGE.md) · prompts in [`prompts/`](prompts/) |
| **Security properties, each next to its test** | [`.github/SECURITY.md`](.github/SECURITY.md) |
