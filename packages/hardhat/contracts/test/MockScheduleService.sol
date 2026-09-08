// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @dev Stand-in for Hedera's Schedule Service system contract (`0x16b`), which does not exist
 *      on a local hardhat node. Placed at that address with `hardhat_setCode` so the paths
 *      around scheduling can be exercised off-chain.
 *
 *      This mocks the SCHEDULER, never the product logic — the `RetainerAccess` under test is
 *      the real contract. That the real Schedule Service behaves as assumed is proven by the
 *      live testnet runs recorded in `docs/proof.md`, not by this mock.
 *
 *      Failure modes are switchable so the lapse paths can be tested, which is the whole point
 *      of having a mock: on testnet you cannot ask the network to refuse you on demand.
 */
contract MockScheduleService {
    uint160 private _n;
    /// When true, `scheduleCall` returns a non-SUCCESS response code.
    bool public refuseSchedule;
    /// When true, `hasScheduleCapacity` returns false.
    bool public noCapacity;
    /// When true, `deleteSchedule` returns a non-SUCCESS response code.
    bool public refuseDelete;

    function setRefuseSchedule(bool on) external { refuseSchedule = on; }
    function setNoCapacity(bool on) external { noCapacity = on; }
    function setRefuseDelete(bool on) external { refuseDelete = on; }

    int64 private constant SUCCESS = 22;
    int64 private constant BUSY = 7;
    int64 private constant INVALID_SCHEDULE_ID = 122;

    event MockScheduled(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes callData);
    event MockDeleted(address scheduleAddress);

    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes memory callData)
        external
        returns (int64 responseCode, address scheduleAddress)
    {
        if (refuseSchedule) return (BUSY, address(0));
        emit MockScheduled(to, expirySecond, gasLimit, value, callData);
        _n = _n == 0 ? 0x9E0001 : _n + 1;
        return (SUCCESS, address(_n));
    }

    function deleteSchedule(address scheduleAddress) external returns (int64 responseCode) {
        if (refuseDelete) return INVALID_SCHEDULE_ID;
        emit MockDeleted(scheduleAddress);
        return SUCCESS;
    }

    function hasScheduleCapacity(uint256, uint256) external view returns (bool) {
        return !noCapacity;
    }
}
