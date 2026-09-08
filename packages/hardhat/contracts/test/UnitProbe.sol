// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @dev Settles, empirically, what unit Hedera's EVM uses for value.
 *
 *      The question is not academic: if `msg.value` is weibar and the contract stores tinybar,
 *      every payout must be multiplied by 1e10 — and if it is tinybar, that same multiplication
 *      overpays by ten orders of magnitude. Both mistakes are silent. So we measure instead of
 *      reasoning from Ethereum's semantics.
 */
contract UnitProbe {
    uint256 public constructorValue;
    uint256 public lastCallValue;

    constructor() payable {
        constructorValue = msg.value;
    }

    function ping() external payable {
        lastCallValue = msg.value;
    }

    function selfBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @return ok whether a raw `call{value:}` of `amount` succeeds against this contract's balance
    function trySend(address payable to, uint256 amount) external returns (bool ok) {
        (ok, ) = to.call{value: amount}("");
    }
}
