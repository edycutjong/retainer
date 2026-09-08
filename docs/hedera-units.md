# The unit trap, measured

Hedera has two denominations for the same money, and the boundary between them is not where
an Ethereum instinct puts it. Getting it wrong is silent in both directions — the transaction
succeeds either way, and the receipt looks identical. This file records how the question was
settled here, which was by measurement, not by argument.

`packages/nextjs/services/retainer/server.ts` points here from the one line in this project
that performs the conversion. The reasoning is also carried in the natspec at the top of
`packages/hardhat/contracts/RetainerAccess.sol`, which is left untouched so the deployed
bytecode keeps matching its verified source.

---

## The two denominations

| Unit | Scale | Where you meet it |
|---|---|---|
| **tinybar** | 1 HBAR = 1e8 | inside the EVM: `msg.value`, `address(this).balance`, the `value` of an outbound `call{value:}` |
| **weibar** | 1 HBAR = 1e18 | on the JSON-RPC wire: `eth_getBalance`, and the `value` field of the transaction you sign |

The relay converts at the edge. That single sentence is the whole rule, and it is the opposite
of the natural assumption — that a chain speaking Ethereum's RPC also speaks Ethereum's units
inside the VM.

## Why arguing about it was not good enough

The question mattered symmetrically:

- If `msg.value` were weibar and storage were tinybar, **every payout needs a `1e10` multiply.**
- If `msg.value` is already tinybar, **that same multiply overpays by ten orders of magnitude.**

Both mistakes produce a `SUCCESS` receipt. Neither reverts. And nothing local can tell them
apart: a Hardhat node uses Ethereum's units, so a green test suite there is evidence about
Ethereum, not about Hedera.

This project got it wrong first. Commit `78025d2` added the `1e10` conversion *inside the
contract*, on the Ethereum assumption, with a docblock defending it. The suite passed.

## The symptom that had no explanation

The thing that forced the measurement was unrelated-looking: deploying with a value left
`gasReserve` at **zero** while HashScan plainly showed the contract holding 8 HBAR. A payable
constructor that receives money and books none of it is not a units bug on its face — but it
was the first hint that value on Hedera does not arrive the way an EVM developer expects.

## The probe

[`packages/hardhat/contracts/test/UnitProbe.sol`](../packages/hardhat/contracts/test/UnitProbe.sol)
is thirty lines whose only job is to report what it was actually handed. It was deployed to
Hedera testnet and sent **2 HBAR as `2e18` on the wire**:

```
msg.value              == 200000000        // 2 HBAR in tinybar
address(this).balance  == 200000000        // tinybar, not weibar
call{value: 1e8}       moved exactly 1 HBAR
```

Answer: the relay speaks weibar and converts at the edge; **inside the EVM everything is
already tinybar**. A contract on Hedera should therefore do *no conversion at all* — it
receives tinybar and it sends tinybar.

## What that changed

Commit `9eb39e3` removed `_toTinybar`, the contract-side `WEIBAR_PER_TINYBAR`, and the
`DustAmount` error from `RetainerAccess.sol`. `_send()` now sends the tinybar it was given.

The only `1e10` conversion left anywhere is in the TypeScript that puts a value on the wire —
`tinybarToWeibar()` in [`packages/nextjs/utils/x402.ts`](../packages/nextjs/utils/x402.ts),
used by `openSubscriptionFor` and `creditSubscription` and nowhere else.

It also explained the 8-HBAR symptom, which turned out to be a second Hedera-specific rule
rather than a units error: **Hedera credits a contract-create's initial balance at the HAPI
level, outside the EVM frame**, so a payable constructor never sees it. Hence `syncReserve()`,
which adopts held-but-unbooked balance, and a deploy script that funds the gas reserve with an
ordinary `fundGasReserve()` call instead of constructor value.

Proven end to end on testnet: `cancel()` refunded exactly 1 HBAR where the pre-fix code would
have paid `1e-10` of it.

## What guards it now

A bug whose failure mode is "looks fine, off by 1e10" cannot be guarded by examples, so the
conversion is verified across a range instead:

[`packages/nextjs/test/units.property.test.ts`](../packages/nextjs/test/units.property.test.ts)
checks **202,059 distinct amounts** against three invariants each — 606,177 assertions:

| Band | Amounts |
|---|---|
| exhaustive, `0 … 100_000` | 100,001 |
| exhaustive, across the 1 HBAR seam `99_999_000 … 100_001_000` | 2,001 |
| exhaustive, every decade edge `10^k − 1, 10^k, 10^k + 1` for `k ≤ 18` | 57 |
| randomised over the full uint64 range (fast-check) | 100,000 |

The invariants: the wire round trip `tinybar → weibar → tinybar` is the exact identity; the
display round trip `tinybar → "H.BBBBBBBB" → tinybar` is the exact identity; and no formatted
amount ever carries more than 8 decimal places. The two display functions are independently
written code paths (`padStart` + trim one way, `split` + `padEnd` the other), so their
agreement is evidence rather than tautology.

`weibarToTinybar()` **throws** on a weibar value that is not a whole number of tinybar rather
than truncating it, because silent truncation is the same class of bug as the overpay.

## The one-line rule

> On Hedera, convert once, in JavaScript, at the moment a value goes on the wire. The contract
> converts nothing.
