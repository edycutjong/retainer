# Retainer — verification runbook

How to go from a clean checkout to watching an on-chain subscription renew itself on Hedera
testnet with nobody awake.

Run every command from the repository root unless a step says otherwise.

The claim being verified is narrow and specific: a request that gets `402` before payment, and
`200` after the paid window has already expired, **because the Hedera Schedule Service called
`renew()` on the contract** — no user transaction, no server job, no cron.

---

## 1. Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | ≥ 20.18.3 | Hardhat, Next.js, scripts |
| Yarn | 3.2.3 (via `corepack enable`) | monorepo scripts |
| A funded **ECDSA** Hedera testnet account | — | deploying, and forwarding settled payments on-chain |
| A second funded **ECDSA** testnet account | — | the buying agent |

No Docker. No MinIO. No self-hosted facilitator. Settlement goes through the hosted
**Blocky402** testnet facilitator (`https://api.testnet.blocky402.com`), which needs no API key
and supplies its own fee payer.

Create both accounts as **ECDSA** at the [Hedera Portal](https://portal.hedera.com/) and fund
them from the faucet. x402 on Hedera requires ECDSA keys. The seller account needs enough HBAR
to cover the contract's gas reserve plus its own transaction fees; budget generously, because
each unattended renewal costs the seller about **1.55 HBAR** (see §8).

```bash
corepack enable
yarn install
```

### Provenance

This repo was built from [`hedera-dev/scaffold-hbar`](https://github.com/hedera-dev/scaffold-hbar)'s
`x402-pay-per-use` template — the starter Hedera's own bounty page points at. The template's
product (a MinIO-backed pay-per-download file marketplace, `FileRegistry`, a block explorer,
`docker-compose`, a self-hosted facilitator) has been removed. What remains of the scaffold is
the Hardhat/Next.js wiring and the account tooling.

---

## 2. Environment

### 2.1 Contract keys — `packages/hardhat/.env`

```bash
cp packages/hardhat/.env.example packages/hardhat/.env
```

| Variable | Where it comes from |
| --- | --- |
| `HEDERA_RPC_URL` | `https://testnet.hashio.io/api` (the default) |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | **Do not fill by hand.** Written by `yarn hardhat:account:import` |

Import the seller's ECDSA key once. It is stored password-encrypted and decrypted only in
memory at deploy time:

```bash
yarn hardhat:account:import      # paste the ECDSA key, choose a password
yarn hardhat:account             # prints the address + balance; confirm it is funded
```

`yarn hardhat:account:generate` makes a fresh key instead, which then needs funding.

### 2.2 Resource server — `packages/nextjs/.env`

```bash
cp packages/nextjs/.env.example packages/nextjs/.env
```

The variables Retainer actually reads:

| Variable | What to set it to |
| --- | --- |
| `HEDERA_RPC_URL` | `https://testnet.hashio.io/api` |
| `FACILITATOR_URL` | `https://api.testnet.blocky402.com` |
| `X402_NETWORK` | `hedera:testnet` |
| `RETAINER_PAY_TO` | The **seller's Hedera account id** (`0.0.x`) that receives the x402 payment |
| `RETAINER_PRICE_TINYBAR` | Price of **one** period, in tinybar. Default `100000000` (1 HBAR). Must equal the contract's `pricePerPeriod` |
| `RETAINER_PERIODS_PER_PURCHASE` | How many periods one payment buys. Default `3`. The 402 charges `RETAINER_PRICE_TINYBAR × RETAINER_PERIODS_PER_PURCHASE` |
| `RETAINER_SERVER_KEY` | ECDSA private key of the seller account. This is what forwards a settled payment into `subscribeFor(agent)`. Without it the payment settles and **no subscription opens** — see §9.1 |
| `RETAINER_ACCESS_ADDRESS` | Optional. Normally resolved from `packages/nextjs/contracts/deployedContracts.ts`, which deploy regenerates. Set it to point at an already-deployed contract |

`RETAINER_PERIODS_PER_PURCHASE` must be greater than 1 or the interesting thing never happens:
the first period is charged the moment the subscription opens, and every period after it is
charged by a renewal the network executes on its own.

### 2.3 Agent credentials — `~/.config/retainer/hedera.env`

The buyer-side scripts read credentials from outside the repo, never from the tree:

```dotenv
BUYER_ACCOUNT_ID=0.0.xxxxxxx
BUYER_PRIVATE_KEY=0x...
RETAINER_ACCESS_ADDRESS=0x...
```

---

## 3. Compile

```bash
yarn hardhat:compile
```

Expect `RetainerAccess.sol` and the test-only `MockScheduleService` to compile, with TypeChain
typings generated into `packages/hardhat/typechain-types`.

---

## 4. Run the tests

```bash
yarn hardhat:test
```

Expect **40 passing**. The suite takes roughly two minutes; each test redeploys the contract
and reinstalls the mock scheduler.

The tests run against a forked Hedera environment (`HEDERA_FORKING=true`) with a
`MockScheduleService` written into the Schedule Service system-contract address
`0x…016b` via `hardhat_setCode`. That mock is what makes scheduling deterministic — it can be
told to refuse a schedule, report no capacity, or refuse a delete, so the lapse paths are
actually exercised rather than asserted.

The eight groups map onto the things that were got wrong at least once during the build:

| Group | What it pins down |
| --- | --- |
| units — tinybar everywhere inside the contract | the relay converts weibar to tinybar at the edge, so the contract converts nothing; an *added* `1e10` conversion overpays a refund without reverting |
| the seller sets the price, not the subscriber | `setTerms` is beneficiary-only; 2 tinybar must not buy a window that burns 2 HBAR of the seller's reserve |
| x402 settlement credits the on-chain subscription | `creditFor` / `subscribeFor` — the join between the off-chain payment and on-chain state |
| renew() time gate — the griefing fix | `renew()` is public but reverts before expiry, because scheduling costs the **contract** money |
| what the contract asks the scheduler to do | `scheduleCall`, `deleteSchedule`, `hasScheduleCapacity` against the mock |
| money separation | `_owed`, `revenue` and `gasReserve` never borrow from each other; `_solvent()` holds |
| lapsing is loud, never silent | every way a renewal can stop emits `Lapsed` with its own reason string — four of the contract's five reasons are asserted by name here; the fifth, `"insufficient subscriber balance"` inside `renew()`, is a defensive branch — `_armRenewal` already lapses the subscription one renewal earlier |
| access gate | `hasAccess` across the window boundary, including surviving expiry when the renewal fires |

`REPORT_GAS=true` is on, so a gas table prints at the end. Read it with one caveat: the mock
scheduler is a normal contract, so those numbers **exclude the real `scheduleCall` into the
Hedera system contract**. Locally `renew()` runs **48,247–77,085** gas and `subscribe()`
**137,552–205,722**. On testnet `subscribe()` used **1,582,554**. That ~1.4M difference is the
system-contract call, and it is the entire cost story of this project (§8).

---

## 5. Deploy to Hedera testnet

Terms are constructor arguments, so choose them before deploying. For a demo you want a period
short enough to watch; the contract's floor is `MIN_PERIOD_SECONDS = 61`.

```bash
RETAINER_PRICE_TINYBAR=100000000 \
RETAINER_PERIOD_SECONDS=120 \
  yarn hardhat:deploy --network hederaTestnet
```

You will be prompted for the password that decrypts `DEPLOYER_PRIVATE_KEY_ENCRYPTED`.

What the deploy does (`packages/hardhat/deploy/01_deploy_retainer_access.ts`):

- constructor `(beneficiary = deployer, pricePerPeriod, periodSeconds)`
- seeds `gasReserve` in a **separate** `fundGasReserve()` transaction after the deploy, with
  `RETAINER_RESERVE_HBAR` HBAR (default **8**). Deliberately not a deploy `value`: Hedera
  credits a contract-create's initial balance at the HAPI level, outside the EVM frame, so a
  payable constructor sees `msg.value == 0` while the contract really does hold the money.
  (`syncReserve()` exists to adopt a balance stranded that way.) A self-renewing contract has
  to hold gas for its own future, because the network charges the *contract* for each scheduled
  execution. 8 HBAR arms four renewals at the contract's `RENEWAL_COST_ESTIMATE` of 2 HBAR
- `gasLimit: 4000000`. The deploy itself used **968,564** gas on testnet
- resolves and records the native Hedera contract id (`0.0.x`) into the deployment JSON
- regenerates `packages/nextjs/contracts/deployedContracts.ts` so the resource server finds the
  address with no further configuration

Expected output includes:

```
deploying "RetainerAccess" ... deployed at 0x...
Funded gas reserve with 8 HBAR — arms 4 renewals
Resolved Hedera contract id: 0.0.xxxxxxx
📝 Updated TypeScript contract definition file on ../nextjs/contracts/deployedContracts.ts
```

Then confirm on HashScan: `https://hashscan.io/testnet/contract/0.0.xxxxxxx`.

Optionally verify the source:

```bash
yarn hardhat:verify:testnet
```

### The two deployments already on testnet

```
current   0.0.10414167  /  0xd3A218AD4c817B14Cc754e4c996A95435155a27B
          https://hashscan.io/testnet/contract/0.0.10414167
measured  0.0.10406083  /  0x8B42a662b0Bd5EecF09517840f63A61AAbEb952A
          https://hashscan.io/testnet/contract/0.0.10406083
```

`0.0.10414167` runs the current source and is the address recorded in
`packages/nextjs/contracts/deployedContracts.ts`. One renewal has executed on it unattended
(`CONTRACTCALL`, `scheduled=true`, `SUCCESS` at `1788827767.015718559`), and `cancel()` deleted
its pending schedule `0.0.10414197` and reclaimed the reserved gas.

`0.0.10406083` is the deployment that produced the measured proof in §8. It **predates the
later contract fixes and runs an older constructor and ABI**, so do not point the current code
at it.

Deploying your own is still the honest way to verify this runbook end to end.

### Changing terms later

Terms are snapshotted into each subscription at `subscribe()` time, so changing them never
reprices a subscription already running:

```solidity
setTerms(uint256 pricePerPeriod, uint32 periodSeconds)   // beneficiary only
```

`periodSeconds` below 61 reverts with `InvalidTerms`.

---

## 6. Run the resource server

```bash
yarn next:dev          # http://localhost:3000
```

Two routes matter:

- `GET /api/retainer/access?agent=<0x…>` — **the gate.** Asking about an agent with no access
  starts a payment: it builds x402 requirements, talks to the facilitator, and answers `402`.
  Do not poll this.
- `GET /api/retainer/status?agent=<0x…>` — read-only chain state, safe to poll. This is what
  the live view at `/` uses to count the window down and show the renewal firing.

Sanity check before the demo — no payment path is touched:

```bash
curl -s "localhost:3000/api/retainer/status?agent=0xYOUR_AGENT" | python3 -m json.tool
```

Expect `contract` to be your deployed address, `hasAccess: false`, `active: false`,
`nextRenewalSchedule: 0x0000…0000`, and `renewalsReserveCanArm: 4` at the default 8 HBAR
reserve. If you get `503`,
the server cannot find the contract — see §9.4.

---

## 7. The demo walk

### 7.1 Cold request → 402

```bash
curl -s -i "localhost:3000/api/retainer/access?agent=0xYOUR_AGENT"
```

Expect:

- status `402 Payment Required`
- a `PAYMENT-REQUIRED` response header carrying the base64 challenge for x402 clients
- a JSON body whose `accepts[0]` advertises `scheme: "exact"`, `network: "hedera:testnet"`,
  `payTo` = your `RETAINER_PAY_TO`, and an amount of
  `RETAINER_PRICE_TINYBAR × RETAINER_PERIODS_PER_PURCHASE` (3 HBAR at the defaults)

### 7.2 Pay once → 200

The agent client signs a Hedera `TransferTransaction` under the x402 `exact` scheme and retries
with the payment header:

```bash
cd packages/nextjs
BASE_URL=http://localhost:3000 yarn tsx scripts/retainer-agent.ts
```

Steps 1 and 2 of that script are the real paid request end to end: it takes the `402`, builds a
payment payload with `@x402/hedera`, retries, and prints the settled Hedera transaction id plus
its HashScan link.

Step 3 does not re-subscribe. With `RETAINER_SERVER_KEY` configured the resource server has
already forwarded the settled payment into `subscribeFor(agent)`, so the script reads
`subscription.opened` out of the paid response and prints that transaction; calling
`subscribe()` itself there would revert with `AlreadyActive`. Only when the server has no key
to forward with does the script open the subscription directly, with the agent's own key, and
it says so on the way past. Steps 4 and 5 then run the post-expiry walk, waiting the seller's
own `periodSeconds` read off the contract unless `PERIOD_SECONDS` overrides it.

The server's own `200` response to the paid request is what to read:

```jsonc
{
  "access": "granted",
  "paidThisRequest": true,
  "payment":      { "transaction": "0.0.…@…", "payer": "0.0.…" },
  "subscription": { "opened": true, "transaction": "0x…", "periodsPurchased": 3 }
}
```

`payment.transaction` is the Blocky402 settlement. `subscription.transaction` is the seller
forwarding that same amount into `RetainerAccess.subscribeFor(agent)`, which opens the
subscription, charges period one, and **arms the first scheduled renewal**.

If `subscription.opened` is `false`, the payment was still captured — read the error and go to
§9.1. The route never implies a subscription that does not exist.

### 7.3 Inside the window → 200, nothing paid

```bash
curl -s "localhost:3000/api/retainer/access?agent=0xYOUR_AGENT" | python3 -m json.tool
```

Expect `paidThisRequest: false`, a `subscription.secondsRemaining` counting down, and
`nextRenewalSchedule` set to a non-zero address. That address is the pending scheduled call —
the network is holding a renewal for you.

### 7.4 Wait past expiry, sending nothing

Wait `periodSeconds + ~45s`. Send no transaction. Do not touch the contract. Open
`http://localhost:3000` and watch the window count to zero.

### 7.5 After expiry → still 200

```bash
curl -s "localhost:3000/api/retainer/access?agent=0xYOUR_AGENT" | python3 -m json.tool
```

Expect `200` with `paidThisRequest: false` again, and `expiresAt` moved a full period into the
future. Nothing was signed, nothing was paid, and the only party that acted was the network.

That is the product.

### 7.6 The same proof without the HTTP layer

`packages/hardhat/scripts/proveRenewal.ts` proves it directly against the deployed contract:
it reads the seller's terms, subscribes, records `expiresAt` and `balance`, waits without
sending anything, and asserts the window extended and the balance drew down. It then cancels
and checks the refund was paid **in full**, which is the regression guard on the contract's
unit handling.

```bash
cd packages/hardhat
yarn hardhat run scripts/proveRenewal.ts --network hederaTestnet
```

It reads the deployed address from `deployments/hederaTestnet/RetainerAccess.json` and the
buyer key from `~/.config/retainer/hedera.env`.

---

## 8. Confirming the renewal on-chain

The renewal is a `CONTRACTCALL` the network submitted on the contract's behalf. The field that
proves nobody sent it is **`scheduled=True`**.

**HashScan.** Open `https://hashscan.io/testnet/contract/0.0.xxxxxxx`, go to the contract's
transactions, and look for `CONTRACTCALL` entries whose payer is the contract and whose
`scheduled` flag is true. There is no `from` address that belongs to you or the server.

**Mirror node**, which is where the numbers below were measured:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions?\
account.id=0.0.10406083&transactiontype=contractcall&order=desc&limit=25" \
  | python3 -c 'import sys,json
for t in json.load(sys.stdin)["transactions"]:
    print(t["consensus_timestamp"], t["result"], "scheduled=%s" % t["scheduled"], t["charged_tx_fee"])'
```

### What was actually measured

The x402 payment settled through Blocky402: `0.0.7162784@1788780154.225876092`.
`subscribe()` used **1,582,554** gas against a 2,000,000 limit.

Three scheduled `CONTRACTCALL`s then executed with `scheduled=True`, `SUCCESS`:

| Consensus timestamp | Charged | What happened |
| --- | --- | --- |
| `1788780226.016366208` | 154,896,000 tinybar = **1.54896 HBAR** | renewed **and re-armed** the next |
| `1788780286.019735208` | 154,896,000 tinybar = **1.54896 HBAR** | renewed **and re-armed** the next |
| `1788780346.345418842` | 5,067,825 tinybar = **0.0507 HBAR** | charged the last funded period, emitted `Lapsed("balance will not cover the next period")`, did **not** re-arm |

The 30× gap between the first two and the third is the whole cost story. Re-arming the next
renewal — the `scheduleCall` into `0x…016b` — is about **97%** of what a renewal costs. The
renewal's own bookkeeping is the cheap 0.05 HBAR part.

### The economics, stated honestly

Hedera refunds at most 20% of an unused gas limit, so `RENEWAL_GAS_LIMIT = 2,500,000` is
charged at roughly 2,000,000 gas whether or not it is used.

**At 1 HBAR per period, this product loses money on every renewal**, because each renewal costs
about 1.55 HBAR out of the seller's gas reserve. That is the real constraint of on-chain
self-renewal and it is not solved here. Two things move it:

1. Right-sizing `RENEWAL_GAS_LIMIT` toward the ~1.5M actually used recovers roughly a third.
2. Pricing a period above the renewal cost is what actually makes it solvent.

---

## 9. Troubleshooting

### 9.1 `RETAINER_SERVER_KEY` missing — payment settles but no subscription opens

**Symptom.** The paid request returns `200` with:

```jsonc
"subscription": {
  "opened": false,
  "error": "RETAINER_SERVER_KEY is not configured; the server cannot forward settled payments on-chain"
}
```

The agent's money is gone — settlement already happened — and every later request goes back to
`402` because `hasAccess(agent)` is still `false`.

**Why.** `RETAINER_SERVER_KEY` is the ECDSA key that calls `subscribeFor(agent)`. It is the
join between the x402 rail and the chain. Without it the two are unrelated events.

**Fix.** Set `RETAINER_SERVER_KEY` in `packages/nextjs/.env` to the seller account's ECDSA
private key and restart `yarn next:dev` (Next.js reads it at request time in a Node runtime
route, but a stale dev server can hold an old module). Then confirm:

- the key's account holds HBAR — `subscribeFor` is a real transaction and pays its own gas
- `RETAINER_ACCESS_ADDRESS` (or `deployedContracts.ts`) points at the deployed contract

Other failures reported the same honest way, all of them from `subscribeFor`:

| Reverted with | Cause |
| --- | --- |
| `InsufficientBalance` | The forwarded value was below one period. `RETAINER_PRICE_TINYBAR` in `.env` does not match the contract's `pricePerPeriod` |
| `AlreadyActive` | That agent already has an open subscription |
| `TermsNotSet` | The contract has no terms yet — see §9.3 |

To recover a payment that settled without opening a subscription, credit the agent manually —
`creditFor(agent)` is permissionless and only ever adds refundable money to the named agent's
pot — then have the agent (or the seller) open the subscription.

### 9.2 Gas reserve exhausted — `Lapsed("gas reserve will not cover the next renewal")`

**Symptom.** A renewal succeeds, extends the window, and then access simply stops at the next
expiry. The mirror node shows a cheap scheduled `CONTRACTCALL` — the same early-exit shape as
the 0.0507 HBAR call in §8, rather than the ~1.55 HBAR a re-arming renewal costs — and no new
schedule after it. `/api/retainer/status` shows `renewalsReserveCanArm: 0`, and the
next scheduled call emits:

```
Lapsed(agent, "gas reserve will not cover the next renewal")
```

**Why.** `_armRenewal` checks `gasReserve >= RENEWAL_COST_ESTIMATE` (200,000,000 tinybar =
2 HBAR) **before** scheduling, and lapses loudly rather than arming a call that cannot pay for
itself. Note this is *not* what the third scheduled call in §8 did — that one lapsed on the
subscriber's balance, not on the reserve. Both paths end the same way: visibly, with a reason.

**Fix.** Top up the reserve. `fundGasReserve()` is `payable` and anyone may contribute. Any
tool that can send a transaction will do; `cast` (Foundry) is shown because it is one line:

```bash
cast send <RETAINER_ACCESS_ADDRESS> "fundGasReserve()" \
  --value 8ether --rpc-url https://testnet.hashio.io/api --private-key <SELLER_KEY>
```

`value` on the wire is **weibar** (1 HBAR = 1e18); the contract stores **tinybar**
(1 HBAR = 1e8). `8ether` here means 8 HBAR. Then check `renewalsRemaining()`, or read
`renewalsReserveCanArm` from `/api/retainer/status`.

A lapsed subscription does not resume by itself — the agent subscribes again. Note that the
reserve is a *seller* cost: at the current price, refilling it is the losing side of §8.

Two neighbouring lapse reasons, same mechanism:

- `Lapsed("balance will not cover the next period")` — the agent's own money ran out. Expected
  after `RETAINER_PERIODS_PER_PURCHASE` periods. Not an error.
- `Lapsed("no schedule capacity at that second")` — `hasScheduleCapacity` said the network is
  full at that exact second. Asking first is what turns this into a clean lapse instead of a
  revert.

### 9.3 Terms not set — `TermsNotSet`

**Symptom.** `subscribe()` / `subscribeFor()` revert with `TermsNotSet`. The paid request
returns `200` with `subscription.opened: false` and that error.

**Why.** The constructor only sets terms when `pricePerPeriod_` or `periodSeconds_` is non-zero.
Deploying with both at zero leaves the contract live with no terms, and nothing can subscribe.

**Fix.** Call `setTerms` from the beneficiary account:

```bash
cast send <RETAINER_ACCESS_ADDRESS> "setTerms(uint256,uint32)" 100000000 120 \
  --rpc-url https://testnet.hashio.io/api --private-key <SELLER_KEY>
```

`InvalidTerms` instead means `pricePerPeriod == 0` or `periodSeconds < 61`
(`MIN_PERIOD_SECONDS`). The floor exists because `renew()` is public and gated on expiry; a
tiny period would hold that gate permanently open, and every forced renewal burns the
contract's own HBAR.

Then make sure `RETAINER_PRICE_TINYBAR` in `packages/nextjs/.env` equals the on-chain
`pricePerPeriod`, or §9.1's `InsufficientBalance` is next.

### 9.4 Other responses from the gate

| Response | Meaning |
| --- | --- |
| `400 Provide ?agent=<evm address>` | Missing or malformed agent address |
| `500 RETAINER_PAY_TO is not configured` | No seller account id set |
| `502 Payment facilitator unavailable` | Blocky402 unreachable; check `FACILITATOR_URL` |
| `502 Failed to read RetainerAccess` | RPC or ABI problem; check `HEDERA_RPC_URL` and that the address really holds this contract |
| `503 RetainerAccess is not deployed on the target network` | Neither `RETAINER_ACCESS_ADDRESS` nor `deployedContracts.ts` resolves an address for chain 296 |

### 9.5 `subscribe()` reverts on testnet with no readable reason

`packages/hardhat/scripts/diagnose.ts` isolates it: it checks the Schedule Service system
contract actually has code at `0x…016b`, decodes the raw revert data against the ABI (including
`ScheduleFailed(int64)` with the Hedera response code), and tests whether `fund()` alone
succeeds — which separates a payment-path failure from a `scheduleCall` failure.

```bash
cd packages/hardhat
yarn hardhat run scripts/diagnose.ts --network hederaTestnet
```

---

## 10. Testnet notes

- **ECDSA only.** x402 on Hedera requires ECDSA accounts.
- **Units are asymmetric, and the boundary is the relay — not the contract.** `value` on the
  wire is weibar (1 HBAR = 1e18); `msg.value` as the contract sees it, `address(this).balance`,
  and the `value` of an outbound `call{value:}` are all tinybar (1 HBAR = 1e8). A non-zero value
  below 1e10 weibar is rejected outright by the relay. So the contract converts nothing:
  *adding* the 1e10 conversion an Ethereum instinct asks for overpays every transfer by ten
  orders of magnitude, without reverting — which is why §7.6 measures the refund against a
  wallet balance. Settled by measurement with `contracts/test/UnitProbe.sol` on testnet.
- **The contract pays for its own future.** Scheduled executions are charged to the contract,
  not to whoever benefits. `gasReserve` is kept strictly separate from subscriber money
  (`_owed`) and seller revenue (`revenue`); `_solvent()` asserts the balance covers all three
  after every state change.
- **Nothing here is private.** Amounts, accounts and settlement transactions are public on
  Hedera. That is what makes the proof in §8 checkable, and it is also a real property of the
  product.
