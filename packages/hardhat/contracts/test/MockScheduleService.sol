// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @dev Stand-in for Hedera's Schedule Service system contract (`0x16b`), which does not exist
 *      on a local hardhat node. Placed at that address with `hardhat_setCode` so the paths
 *      around scheduling can be exercised off-chain. It returns SUCCESS (22) and a
 *      deterministic schedule address.
 *
 *      This mocks the SCHEDULER, never the product logic — the `RetainerAccess` under test is
 *      the real contract. That the real Schedule Service behaves as assumed is proven by the
 *      live testnet runs recorded in the project's spike notes, not by this mock.
 */
contract MockScheduleService {
    uint160 private _n = 0x9E0000;

    event MockScheduled(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes callData);

    fallback(bytes calldata data) external returns (bytes memory) {
        (address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes memory callData) =
            abi.decode(data[4:], (address, uint256, uint256, uint64, bytes));
        emit MockScheduled(to, expirySecond, gasLimit, value, callData);
        _n += 1;
        return abi.encode(int64(22), address(_n));
    }
}
