# 04 — Build the contract that renews itself, and prove it on testnet

**Commit produced:** `fefd461` — *Add RetainerAccess: access that renews itself on-chain*
**When:** 2026-09-07 17:58 +07

## The direction given

Write the product's own contract — the thing the scaffold does not contain.

`RetainerAccess`: an agent funds a balance and subscribes. The contract calls the Hedera
Schedule Service (HIP-1215, system contract `0x16b`) to schedule a call to `renew()` on
*itself*, at the second the current window expires. When the network fires it, `renew()`
debits the next period, extends the window, and schedules the following renewal. No server,
no cron, no human anywhere in that loop.

**Do not accept a local test as evidence.** A hardhat test that advances a block clock proves
nothing about whether the Hedera Schedule Service actually executes a call it was handed. The
acceptance criterion is a mirror-node record: `expiresAt` and `balance` observed before, the
same values observed after, and **no transaction sent in between**.

## Why it was given then

This is the load-bearing claim of the entire project. If the Schedule Service could not call
back into the contract unattended, there is no product — only a normal pay-per-use x402 demo
with a countdown on it. Everything else in the build is downstream of this working, so it had
to be proven before the payment rail was wired to it.

## What it produced

Proven on testnet against the first deployment, contract `0.0.10405786`:

```
before  expiresAt=1788778541  balance=200000000  schedule=0x…009eC79d
after   expiresAt=1788778601  balance=100000000  schedule=0x…009Ec7A8
```

with nothing sent in between. The mirror node shows `CONTRACTCALL SUCCESS`, `scheduled=True`,
at `1788778541.008`, requiring 0 signatures.

Three fixes were needed to get there, all of them things prose documentation could not have
told us:

- the import paths and the `uint64` value parameter had been guessed from prose, and were wrong;
- Hedera's units are asymmetric — the transaction value is weibar, but `msg.value` inside the
  contract is tinybar (this is the shallow end of the unit problem that step 08 finishes);
- `RENEWAL_GAS_LIMIT` was set to 200,000 against measured usage of ~1.53M, so the scheduled
  call fired and then reverted — which from outside is indistinguishable from "scheduling is
  broken".

## What was recorded as known-broken, deliberately not fixed here

Each renewal cost ~1.53 HBAR of gas, paid by the contract, while charging 1 HBAR of
subscription. The loop therefore died after one cycle. The mechanism worked; the economics did
not. Written into the commit message as an open issue rather than left implied, with the fix
direction named: separate the gas reserve from subscriber balances, and right-size the gas
limit. Step 05 does the separation.
