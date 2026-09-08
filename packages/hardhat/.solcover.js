/**
 * solidity-coverage configuration.
 *
 * `contracts/test/UnitProbe.sol` is deliberately excluded. It is a throwaway on-chain
 * measurement probe: it was deployed to Hedera testnet to settle, empirically, whether the EVM
 * denominates `msg.value` in tinybar or weibar (see `docs/hedera-units.md` and the units note in
 * `RetainerAccess.sol`). It is not on the shipped path, it is not imported by the test suite, and
 * it is kept only as the evidence that overturned an earlier unit "fix". Writing unit tests for it
 * would be theatre; leaving it in the report drags the totals down for a file nothing calls.
 *
 * `contracts/test/MockScheduleService.sol` IS measured. It stands in for Hedera's Schedule Service
 * system contract (`0x16b`), which does not exist on a local node — it replaces the scheduler and
 * nothing else, so its own failure modes are worth holding to the same bar as the product.
 */
module.exports = {
  skipFiles: ["test/UnitProbe.sol"],
};
