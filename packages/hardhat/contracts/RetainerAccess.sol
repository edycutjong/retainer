// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HederaScheduleService} from "@hiero-ledger/hiero-contracts/schedule-service/HederaScheduleService.sol";
import {HederaResponseCodes} from "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";

/**
 * @title RetainerAccess
 * @notice Access that renews itself.
 *
 * An agent can pay for an API call today. It cannot *subscribe* — when the access window
 * expires, something has to pay again, and that something is a human or an off-chain cron
 * job somebody has to keep alive.
 *
 * This contract removes both. An agent funds a balance once and starts a subscription. The
 * contract then asks the Hedera Schedule Service (HIP-1215, system contract `0x16b`) to call
 * `renew()` on itself at the moment the window expires. When the network fires that call, the
 * contract debits the next period, extends the window, and schedules the following renewal.
 *
 * No server. No cron. No human awake at 3am.
 *
 * The loop stops on its own when the agent's balance can no longer cover a period, or when
 * the agent cancels. Nothing is silently drained: a lapse is an event, not a failure.
 */
contract RetainerAccess is HederaScheduleService {
    struct Subscription {
        uint256 balance;       // tinybar held for this agent
        uint256 pricePerPeriod;
        uint256 expiresAt;     // unix seconds; access is live while block.timestamp < expiresAt
        uint32  periodSeconds;
        bool    active;        // false once cancelled or lapsed
        address schedule;      // address of the pending scheduled call, if any
    }

    /**
     * Gas made available to the scheduled `renew()` call when the network executes it.
     *
     * Measured, not guessed: `subscribe()` — storage writes plus one `scheduleCall` — used
     * 1,531,677 gas on testnet. `renew()` does comparable work, since it also schedules the
     * following renewal. An earlier value of 200_000 caused the scheduled call to fire and
     * then revert with CONTRACT_REVERT_EXECUTED, which looks identical to "scheduling does
     * not work" from the outside. Headroom here is cheap; a starved renewal is silent.
     */
    uint256 private constant RENEWAL_GAS_LIMIT = 2_500_000;

    mapping(address => Subscription) private _subs;

    event Funded(address indexed agent, uint256 amount, uint256 balance);
    event SubscriptionStarted(address indexed agent, uint256 pricePerPeriod, uint32 periodSeconds, uint256 expiresAt);
    event RenewalScheduled(address indexed agent, address schedule, uint256 firesAt);
    event Renewed(address indexed agent, uint256 paid, uint256 expiresAt, uint256 balance);
    event Lapsed(address indexed agent, string reason);
    event Cancelled(address indexed agent, uint256 refunded);

    error NothingToFund();
    error AlreadyActive();
    error InvalidTerms();
    error InsufficientBalance();
    error NotSubscribed();
    error ScheduleFailed(int64 responseCode);

    /// @notice Add funds the subscription will draw on. Callable at any time, including mid-term.
    function fund() external payable {
        if (msg.value == 0) revert NothingToFund();
        Subscription storage s = _subs[msg.sender];
        s.balance += msg.value;
        emit Funded(msg.sender, msg.value, s.balance);
    }

    /**
     * @notice Start a self-renewing subscription. Pays the first period immediately, then
     *         hands the next renewal to the network.
     * @param pricePerPeriod tinybar charged per period
     * @param periodSeconds  length of one access window
     */
    function subscribe(uint256 pricePerPeriod, uint32 periodSeconds) external payable {
        Subscription storage s = _subs[msg.sender];
        if (s.active) revert AlreadyActive();
        if (pricePerPeriod == 0 || periodSeconds == 0) revert InvalidTerms();

        if (msg.value > 0) {
            s.balance += msg.value;
            emit Funded(msg.sender, msg.value, s.balance);
        }
        if (s.balance < pricePerPeriod) revert InsufficientBalance();

        s.balance -= pricePerPeriod;
        s.pricePerPeriod = pricePerPeriod;
        s.periodSeconds = periodSeconds;
        s.expiresAt = block.timestamp + periodSeconds;
        s.active = true;

        emit SubscriptionStarted(msg.sender, pricePerPeriod, periodSeconds, s.expiresAt);
        _scheduleRenewal(msg.sender, s.expiresAt);
    }

    /**
     * @notice Extend an agent's access by one period.
     * @dev Executed by the Hedera network when the scheduled call fires — not by a human and
     *      not by a server. Deliberately callable by anyone: it can only ever debit the agent's
     *      own prepaid balance and extend that agent's own window, so an early caller wastes
     *      their own gas and changes nothing else.
     */
    function renew(address agent) external {
        Subscription storage s = _subs[agent];
        if (!s.active) revert NotSubscribed();

        s.schedule = address(0);

        if (s.balance < s.pricePerPeriod) {
            s.active = false;
            emit Lapsed(agent, "insufficient balance");
            return;
        }

        s.balance -= s.pricePerPeriod;
        // Extend from the previous expiry so windows never drift, even if the network
        // executes the scheduled call slightly late.
        s.expiresAt = (s.expiresAt > block.timestamp ? s.expiresAt : block.timestamp) + s.periodSeconds;

        emit Renewed(agent, s.pricePerPeriod, s.expiresAt, s.balance);

        // The loop: each renewal schedules the next one.
        if (s.balance >= s.pricePerPeriod) {
            _scheduleRenewal(agent, s.expiresAt);
        } else {
            emit Lapsed(agent, "balance will not cover the next period");
        }
    }

    /// @notice Stop renewing and withdraw whatever is left.
    function cancel() external {
        Subscription storage s = _subs[msg.sender];
        if (s.pricePerPeriod == 0) revert NotSubscribed();

        s.active = false;
        uint256 refund = s.balance;
        s.balance = 0;

        emit Cancelled(msg.sender, refund);
        if (refund > 0) {
            (bool ok, ) = payable(msg.sender).call{value: refund}("");
            require(ok, "refund failed");
        }
    }

    /// @notice The gate a resource server checks.
    function hasAccess(address agent) external view returns (bool) {
        return block.timestamp < _subs[agent].expiresAt;
    }

    function subscriptionOf(address agent)
        external
        view
        returns (uint256 balance, uint256 pricePerPeriod, uint256 expiresAt, uint32 periodSeconds, bool active, address schedule)
    {
        Subscription storage s = _subs[agent];
        return (s.balance, s.pricePerPeriod, s.expiresAt, s.periodSeconds, s.active, s.schedule);
    }

    /// @dev Ask the Schedule Service to call `renew(agent)` on this contract at `firesAt`.
    function _scheduleRenewal(address agent, uint256 firesAt) private {
        bytes memory callData = abi.encodeWithSelector(this.renew.selector, agent);
        (int64 rc, address scheduleAddress) =
            scheduleCall(address(this), firesAt, RENEWAL_GAS_LIMIT, 0, callData);
        if (rc != HederaResponseCodes.SUCCESS) revert ScheduleFailed(rc);

        _subs[agent].schedule = scheduleAddress;
        emit RenewalScheduled(agent, scheduleAddress, firesAt);
    }
}
