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
 * This contract removes both. An agent funds a balance and subscribes. The contract asks the
 * Hedera Schedule Service (HIP-1215, system contract `0x16b`) to call `renew()` on itself at
 * the moment the window expires. When the network fires that call, the contract charges the
 * next period, extends the window, and schedules the following renewal.
 *
 * ## Three separate pots of HBAR
 *
 * The contract's native balance is not one pool. Conflating them is how an autonomous
 * contract quietly becomes insolvent, so they are tracked apart:
 *
 *  - `_owed`       subscriber money, refundable on `cancel()`. Never spent on anything else.
 *  - `revenue`     charged periods, withdrawable by `beneficiary`. This is the seller's.
 *  - `gasReserve`  pays for scheduled executions. **The network charges the CONTRACT for a
 *                  scheduled call**, so a self-renewing contract must hold gas for its own
 *                  future. Measured cost is ~1.53 HBAR per renewal on testnet — more than a
 *                  typical period price, which is the real economic constraint of on-chain
 *                  self-renewal and is deliberately not hidden.
 *
 * `_solvent()` asserts the native balance still covers all three.
 *
 * ## Why renewal can stop
 *
 * A subscription ends loudly, never silently:
 *  - the subscriber cancels, or
 *  - their balance cannot cover the next period, or
 *  - the gas reserve cannot cover the next scheduled execution.
 *
 * The third case matters. `Lapsed` is emitted **before** scheduling, because a scheduled call
 * that cannot pay for itself fails with `INSUFFICIENT_PAYER_BALANCE` and emits nothing at all
 * — the subscription would otherwise look alive forever while being dead.
 */
contract RetainerAccess is HederaScheduleService {
    struct Subscription {
        uint256 balance;        // tinybar, refundable
        uint256 pricePerPeriod; // tinybar
        uint256 expiresAt;      // unix seconds
        uint32  periodSeconds;
        bool    active;
        address schedule;       // pending scheduled call, if any
    }

    /// Gas handed to the scheduled `renew()`. Measured: `subscribe()` used 1,531,677 on testnet.
    uint256 private constant RENEWAL_GAS_LIMIT = 2_500_000;

    /**
     * How early `renew()` may be called, in seconds.
     *
     * The Schedule Service does not execute at exactly `expirySecond` — observed on testnet
     * firing one second early (scheduled 1788779925, executed 1788779924). A strict
     * `block.timestamp >= expiresAt` gate therefore rejects the network's own scheduled call
     * and the subscription silently fails to renew.
     *
     * The slack has to be large enough to absorb consensus timing and small enough to be
     * worthless to an attacker: renewing a few seconds early neither grants free access nor
     * meaningfully accelerates spending, since each renewal still charges a full period.
     */
    uint256 private constant RENEW_SLACK = 30;

    /**
     * Gas reserve required per scheduled renewal, in tinybar. Measured at 1.5319 HBAR on
     * testnet; carries headroom for gas-price movement. An on-chain contract cannot know the
     * exact future fee, so this is an explicit, documented estimate rather than a guarantee.
     */
    uint256 public constant RENEWAL_COST_ESTIMATE = 200_000_000; // 2 HBAR

    address public immutable beneficiary;

    uint256 public revenue;    // charged periods, withdrawable by beneficiary
    uint256 public gasReserve; // funds scheduled executions
    uint256 private _owed;     // sum of all subscriber balances

    mapping(address => Subscription) private _subs;

    event Funded(address indexed agent, uint256 amount, uint256 balance);
    event GasReserveFunded(address indexed from, uint256 amount, uint256 reserve);
    event SubscriptionStarted(address indexed agent, uint256 pricePerPeriod, uint32 periodSeconds, uint256 expiresAt);
    event RenewalScheduled(address indexed agent, address schedule, uint256 firesAt);
    event Renewed(address indexed agent, uint256 paid, uint256 expiresAt, uint256 balance);
    event Lapsed(address indexed agent, string reason);
    event Cancelled(address indexed agent, uint256 refunded);
    event Withdrawn(address indexed to, uint256 amount);

    error NothingToFund();
    error AlreadyActive();
    error InvalidTerms();
    error InsufficientBalance();
    error NotSubscribed();
    error ScheduleFailed(int64 responseCode);
    error TooEarly(uint256 nowTs, uint256 expiresAt);
    error NotBeneficiary();
    error Insolvent();
    error TransferFailed();

    constructor(address beneficiary_) payable {
        beneficiary = beneficiary_ == address(0) ? msg.sender : beneficiary_;
        if (msg.value > 0) {
            gasReserve += _toTinybar(msg.value);
            emit GasReserveFunded(msg.sender, _toTinybar(msg.value), gasReserve);
        }
    }

    /// @notice Top up the reserve that pays for scheduled executions. Anyone may contribute.
    function fundGasReserve() external payable {
        if (msg.value == 0) revert NothingToFund();
        uint256 amount = _toTinybar(msg.value);
        gasReserve += amount;
        emit GasReserveFunded(msg.sender, amount, gasReserve);
    }

    /// @notice Add refundable funds the subscription draws on.
    function fund() external payable {
        if (msg.value == 0) revert NothingToFund();
        uint256 amount = _toTinybar(msg.value);
        Subscription storage s = _subs[msg.sender];
        s.balance += amount;
        _owed += amount;
        emit Funded(msg.sender, amount, s.balance);
    }

    /// @notice Start a self-renewing subscription. Charges the first period immediately.
    function subscribe(uint256 pricePerPeriod, uint32 periodSeconds) external payable {
        Subscription storage s = _subs[msg.sender];
        if (s.active) revert AlreadyActive();
        if (pricePerPeriod == 0 || periodSeconds == 0) revert InvalidTerms();

        if (msg.value > 0) {
            uint256 amount = _toTinybar(msg.value);
            s.balance += amount;
            _owed += amount;
            emit Funded(msg.sender, amount, s.balance);
        }
        if (s.balance < pricePerPeriod) revert InsufficientBalance();

        _charge(s, pricePerPeriod);
        s.pricePerPeriod = pricePerPeriod;
        s.periodSeconds = periodSeconds;
        s.expiresAt = block.timestamp + periodSeconds;
        s.active = true;

        emit SubscriptionStarted(msg.sender, pricePerPeriod, periodSeconds, s.expiresAt);
        _armRenewal(msg.sender, s);
        _solvent();
    }

    /**
     * @notice Extend an agent's access by one period.
     * @dev Executed by the network when the scheduled call fires. Callable by anyone, but only
     *      once the window has actually expired — without that gate a third party could call it
     *      repeatedly, and because the network charges the CONTRACT for each scheduled call,
     *      every forced renewal would burn the contract's own HBAR. The time gate is what makes
     *      a public function safe here; "it only touches that agent's own balance" is not
     *      sufficient reasoning, because scheduling itself costs the contract money.
     */
    function renew(address agent) external {
        Subscription storage s = _subs[agent];
        if (!s.active) revert NotSubscribed();
        // `+ RENEW_SLACK` so the network's scheduled call is not rejected for firing a
        // second early. Without it the griefing fix silently breaks self-renewal.
        if (block.timestamp + RENEW_SLACK < s.expiresAt) revert TooEarly(block.timestamp, s.expiresAt);

        s.schedule = address(0);

        if (s.balance < s.pricePerPeriod) {
            s.active = false;
            emit Lapsed(agent, "insufficient subscriber balance");
            return;
        }

        _charge(s, s.pricePerPeriod);
        // Extend from the previous expiry so windows do not drift if execution is late.
        s.expiresAt = (s.expiresAt > block.timestamp ? s.expiresAt : block.timestamp) + s.periodSeconds;
        emit Renewed(agent, s.pricePerPeriod, s.expiresAt, s.balance);

        _armRenewal(agent, s);
        _solvent();
    }

    /// @notice Stop renewing and withdraw the remaining balance.
    function cancel() external {
        Subscription storage s = _subs[msg.sender];
        if (s.pricePerPeriod == 0) revert NotSubscribed();

        s.active = false;
        s.pricePerPeriod = 0;
        uint256 refund = s.balance;
        s.balance = 0;
        _owed -= refund;

        emit Cancelled(msg.sender, refund);
        if (refund > 0) _send(msg.sender, refund);
    }

    /// @notice Beneficiary collects charged periods. Subscriber funds and gas reserve are untouchable.
    function withdraw(uint256 amount) external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (amount == 0 || amount > revenue) revert InsufficientBalance();
        revenue -= amount;
        emit Withdrawn(beneficiary, amount);
        _send(beneficiary, amount);
        _solvent();
    }

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

    /// @notice Total subscriber money the contract owes back.
    function owed() external view returns (uint256) { return _owed; }

    // ── internals ─────────────────────────────────────────────────────────────

    function _charge(Subscription storage s, uint256 amount) private {
        s.balance -= amount;
        _owed -= amount;
        revenue += amount;
    }

    /**
     * @dev Schedule the next renewal, but only if the reserve can pay for it. Emitting
     *      `Lapsed` here — before scheduling — is the difference between a subscription that
     *      ends visibly and one that dies with no event at all when the scheduled call cannot
     *      afford to run.
     */
    function _armRenewal(address agent, Subscription storage s) private {
        if (s.balance < s.pricePerPeriod) {
            s.active = false;
            emit Lapsed(agent, "balance will not cover the next period");
            return;
        }
        if (gasReserve < RENEWAL_COST_ESTIMATE) {
            s.active = false;
            emit Lapsed(agent, "gas reserve will not cover the next renewal");
            return;
        }
        gasReserve -= RENEWAL_COST_ESTIMATE;

        bytes memory callData = abi.encodeWithSelector(this.renew.selector, agent);
        (int64 rc, address scheduleAddress) =
            scheduleCall(address(this), s.expiresAt, RENEWAL_GAS_LIMIT, 0, callData);
        if (rc != HederaResponseCodes.SUCCESS) revert ScheduleFailed(rc);

        s.schedule = scheduleAddress;
        emit RenewalScheduled(agent, scheduleAddress, s.expiresAt);
    }

    /// @dev `msg.value` arrives in weibar; everything stored on-chain is tinybar (1e10 weibar).
    function _toTinybar(uint256 weibar) private pure returns (uint256) {
        return weibar >= 1e10 ? weibar / 1e10 : weibar;
    }

    function _send(address to, uint256 tinybar) private {
        (bool ok, ) = payable(to).call{value: tinybar}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev The contract must always be able to honour refunds, revenue and scheduled gas.
    function _solvent() private view {
        if (address(this).balance < _owed + revenue + gasReserve) revert Insolvent();
    }
}
