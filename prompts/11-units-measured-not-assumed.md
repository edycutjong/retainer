# 11 — Settle the unit question by measuring it, not by reasoning from Ethereum

**Commit produced:** `9eb39e3` — *Correct the value units: Hedera is tinybar inside the EVM, not weibar*
**When:** 2026-09-08 07:31 +07

## The direction given

Stop reasoning about Hedera's value denomination from Ethereum's semantics and go and measure
it. Deploy a throwaway contract to testnet whose only job is to report what it was actually
handed, send it a known amount, and read the answer off the chain.

The question mattered in both directions, which is why argument was not good enough: if
`msg.value` is weibar and storage is tinybar, every payout needs a `1e10` multiply — and if
`msg.value` is already tinybar, that same multiply overpays by ten orders of magnitude. Both
mistakes produce a successful transaction.

## Why it was given then

Step 08 had added exactly that `1e10` conversion, on the Ethereum assumption, and nothing in
the local test suite could tell the two worlds apart: the mock chain uses Ethereum's units, so
a suite that passes there proves nothing about which denomination Hedera hands the contract.
The suspicion that put this on the list was a symptom that had no explanation yet — deploying
with a value left `gasReserve` at zero while the contract plainly held 8 HBAR.

## What the measurement said

`contracts/test/UnitProbe.sol`, deployed to testnet and sent 2 HBAR as `2e18` on the wire:

```
msg.value              == 200000000
address(this).balance  == 200000000
call{value: 1e8}       moved exactly 1 HBAR
```

So the JSON-RPC relay speaks **weibar** at the edge and converts there, and inside the EVM
everything is already **tinybar**. A contract on Hedera should do no conversion at all. Step
08's conversion was not a fix; it was an overpay bug with a docblock defending it.

## What the commit changed

- removed `_toTinybar`, `WEIBAR_PER_TINYBAR` and the `DustAmount` error from
  `packages/hardhat/contracts/RetainerAccess.sol`; `_send` now sends the tinybar it was given
- the only `1e10` conversion left is in the JavaScript that puts a value on the wire
- `syncReserve()`, and a deploy script that funds the reserve with an ordinary call — because
  Hedera credits a contract-create's initial balance at the HAPI level, outside the EVM frame,
  so a payable constructor never sees it. That is the 8-HBAR symptom above, explained
- tests 38 → 40

Proven end to end on testnet against contract `0.0.10415845`: the network renewed a
subscription with no transaction from us, and `cancel()` refunded exactly 1 HBAR where the
pre-fix code would have paid `1e-10` of it.

## Why this one is in the record rather than tidied away

Step 08's write-up still describes the conversion it added, with a correction block pointing
here. Rewriting it into having been right the first time would delete the only interesting
thing about this step: an assumption carried over from another chain, held for three commits,
and killed by a thirty-line probe rather than by a better argument.

## Also in this commit

The documentation catch-up: `docs/proof.md` (every testnet artifact with mirror-node commands
to re-check it), `docs/gas-economics.md` (what a renewal costs and why), and this `prompts/`
record itself, which up to that point did not exist.
