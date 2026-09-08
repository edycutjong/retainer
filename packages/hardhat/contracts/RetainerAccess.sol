// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HederaScheduleService} from "@hiero-ledger/hiero-contracts/schedule-service/HederaScheduleService.sol";
import {HederaResponseCodes} from "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";

/**
 * @title RetainerAccess
 * @notice Access that renews itself.
 *
 * An agent can pay for a thing. An agent cannot *subscribe* to a thing: every renewal needs
 * somebody awake to re-authorise it. This contract removes that person. It uses the Hedera
 * Schedule Service (HIP-1215, system contract `0x16b`) to call `renew()` on itself at the
 * moment the current window expires. The renewal charges the next period, extends the window,
 * and schedules the following renewal.
 *
 * ## Money is kept in three separate pots
 *
 *  - `_owed`       subscriber money, refundable on `cancel()`. Never spent on anything else.
 *  - `revenue`     charged periods, withdrawable by `beneficiary`. This is the seller's.
 *  - `gasReserve`  the network charges **the contract** for each scheduled call, so a
 *                  self-renewing contract must hold gas for its own future.
 *
 * `_solvent()` asserts the native balance still covers all three.
 *
 * ## Units — the sharpest edge on Hedera, and not where it looks
 *
 * Hedera has two denominations: tinybar (1 HBAR = 1e8) and weibar (1 HBAR = 1e18, the shape
 * Ethereum tooling expects). They are not used in the same places, and the boundary is not
 * where an Ethereum instinct puts it:
 *
 *   - the JSON-RPC relay speaks **weibar**. `eth_getBalance`, and the `value` field of the
 *     transaction you sign, are 1e18-scaled.
 *   - inside the EVM everything is **tinybar**. `msg.value`, `address(this).balance` and the
 *     `value` of an outbound `call{value:}` are all 1e8-scaled. The relay converts at the edge.
 *
 * So a contract on Hedera should do **no conversion at all** — it receives tinybar and it sends
 * tinybar. Adding the 1e10 conversion Ethereum experience asks for overpays every transfer by
 * ten orders of magnitude; omitting one that were genuinely needed would underpay by the same
 * factor. Both failures are silent.
 *
 * This is measured, not assumed. `contracts/test/UnitProbe.sol` was deployed to testnet and sent
 * 2 HBAR as 2e18 on the wire; it reported `msg.value == 200000000` and
 * `address(this).balance == 200000000`. That probe is the evidence, and it is in this repo.
 *
 * ## Why renewal can stop
 *
 * A subscription ends loudly, never silently:
 *  - the subscriber cancels, or
 *  - their balance cannot cover the next period, or
 *  - the gas reserve cannot cover the next scheduled execution, or
 *  - the network has no schedule capacity at that second.
 *
 * `Lapsed` is emitted **before** scheduling, because a scheduled call that cannot pay for
 * itself fails with `INSUFFICIENT_PAYER_BALANCE` and emits nothing at all — the subscription
 * would otherwise look alive forever while being dead.
 */
contract RetainerAccess is HederaScheduleService {
    struct Subscription {
        uint256 balance;        // tinybar, refundable
        uint256 pricePerPeriod; // tinybar, snapshotted at subscribe time
        uint256 expiresAt;      // unix seconds
        uint32  periodSeconds;
        bool    active;
        address schedule;       // pending scheduled call, if any
    }

    /// Gas handed to the scheduled `renew()`. Measured on testnet: a renewal that re-arms the
    /// next one consumes ~1.5M gas, almost all of it the `scheduleCall` into `0x16b` itself.
    /// See `docs/gas-economics.md` for the measurement and what it costs per renewal.
    uint256 private constant RENEWAL_GAS_LIMIT = 2_500_000;

    /**
     * How early `renew()` may be called, in seconds.
     *
     * The block timestamp a scheduled call sees can be behind the second it was scheduled for.
     * Observed on testnet against contract 0.0.10406002: the schedule was armed for
     * `expiresAt = 1788779924`, the network executed it at consensus 1788779924.038958161, and
     * `renew()` still reverted (CONTRACT_REVERT_EXECUTED) under a strict
     * `block.timestamp >= expiresAt` gate. So that gate rejects the network's own scheduled call
     * and the subscription silently fails to renew.
     */
    uint256 private constant RENEW_SLACK = 30;

    /**
     * Shortest period the seller may configure.
     *
     * This is a security bound, not a product one. `renew()` is callable by anyone once
     * `block.timestamp + RENEW_SLACK >= expiresAt`. If a period were shorter than the slack,
     * that window would be open continuously and a third party could loop `renew()` — each
     * call charging the subscriber and burning `RENEWAL_COST_ESTIMATE` of the seller's gas
     * reserve. Requiring `periodSeconds > 2 * RENEW_SLACK` keeps the callable window a
     * strict minority of every period.
     */
    uint32 public constant MIN_PERIOD_SECONDS = 61;

    /**
     * Gas reserve required per scheduled renewal, in tinybar. Measured at 1.5490 HBAR on
     * testnet; carries headroom for gas-price movement. An on-chain contract cannot know the
     * exact future fee, so this is an explicit, documented estimate rather than a guarantee.
     */
    uint256 public constant RENEWAL_COST_ESTIMATE = 200_000_000; // 2 HBAR

    address public immutable beneficiary;

    /// Seller-set terms. A running subscription keeps the terms it started on.
    uint256 public pricePerPeriod; // tinybar
    uint32  public periodSeconds;

    uint256 public revenue;    // charged periods, withdrawable by beneficiary
    uint256 public gasReserve; // funds scheduled executions
    uint256 private _owed;     // sum of all subscriber balances

    mapping(address => Subscription) private _subs;

    event Funded(address indexed agent, uint256 amount, uint256 balance);
    event GasReserveFunded(address indexed from, uint256 amount, uint256 reserve);
    event TermsSet(uint256 pricePerPeriod, uint32 periodSeconds);
    event SubscriptionStarted(address indexed agent, uint256 pricePerPeriod, uint32 periodSeconds, uint256 expiresAt);
    event RenewalScheduled(address indexed agent, address schedule, uint256 firesAt);
    event RenewalCancelled(address indexed agent, address schedule, uint256 reclaimed);
    event Renewed(address indexed agent, uint256 paid, uint256 expiresAt, uint256 balance);
    event Lapsed(address indexed agent, string reason);
    event Cancelled(address indexed agent, uint256 refunded);
    event Withdrawn(address indexed to, uint256 amount);

    error NothingToFund();
    error AlreadyActive();
    error InvalidTerms();
    error TermsNotSet();
    error InsufficientBalance();
    error NotSubscribed();
    error ScheduleFailed(int64 responseCode);
    error TooEarly(uint256 nowTs, uint256 expiresAt);
    error NotBeneficiary();
    error Insolvent();
    error TransferFailed();

    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        _;
    }

    constructor(address beneficiary_, uint256 pricePerPeriod_, uint32 periodSeconds_) payable {
        beneficiary = beneficiary_ == address(0) ? msg.sender : beneficiary_;
        if (pricePerPeriod_ != 0 || periodSeconds_ != 0) {
            _setTerms(pricePerPeriod_, periodSeconds_);
        }
        // On Hedera this is usually 0 even when the deploy carried a value — the initial
        // balance is credited outside the EVM frame. See `syncReserve()`.
        if (msg.value > 0) {
            gasReserve += msg.value;
            emit GasReserveFunded(msg.sender, msg.value, gasReserve);
        }
    }

    /**
     * @notice The seller sets the price. The subscriber does not.
     * @dev Terms are snapshotted into each `Subscription` at `subscribe()` time, so changing
     *      them never reprices a subscription that is already running.
     */
    function setTerms(uint256 pricePerPeriod_, uint32 periodSeconds_) external onlyBeneficiary {
        _setTerms(pricePerPeriod_, periodSeconds_);
    }

    function _setTerms(uint256 pricePerPeriod_, uint32 periodSeconds_) private {
        if (pricePerPeriod_ == 0 || periodSeconds_ < MIN_PERIOD_SECONDS) revert InvalidTerms();
        pricePerPeriod = pricePerPeriod_;
        periodSeconds = periodSeconds_;
        emit TermsSet(pricePerPeriod_, periodSeconds_);
    }

    /// @notice Top up the reserve that pays for scheduled executions. Anyone may contribute.
    function fundGasReserve() external payable {
        if (msg.value == 0) revert NothingToFund();
        gasReserve += msg.value;
        emit GasReserveFunded(msg.sender, msg.value, gasReserve);
    }

    /**
     * @notice Account for native balance the contract holds but has not booked.
     * @dev Hedera credits a contract-create's initial balance at the HAPI level, outside the EVM
     *      frame — so a payable constructor sees `msg.value == 0` while the contract really does
     *      hold the money. Deploying with a value therefore strands it: present, unbooked and
     *      unusable, surfacing later as a subscription that will not arm because `gasReserve` is
     *      zero. This adopts any such balance into the gas reserve.
     */
    function syncReserve() external onlyBeneficiary {
        uint256 booked = _owed + revenue + gasReserve;
        uint256 held = address(this).balance;
        if (held <= booked) revert NothingToFund();
        uint256 unbooked = held - booked;
        gasReserve += unbooked;
        emit GasReserveFunded(msg.sender, unbooked, gasReserve);
    }

    /// @notice Add refundable funds the caller's own subscription draws on.
    function fund() external payable {
        _credit(msg.sender, msg.value);
    }

    /**
     * @notice Credit a settled x402 payment to `agent`'s subscription.
     * @dev This is the join between the two rails. The resource server settles an x402 payment
     *      through the Blocky402 facilitator, then calls this with the paid amount so the
     *      agent's on-chain balance — the thing `renew()` draws down unattended — actually
     *      grows. Without it, paying the 402 and holding a subscription are unrelated events.
     *
     *      Deliberately permissionless: it only ever *adds* refundable money to the named
     *      agent's pot. There is no way to credit yourself at anyone's expense.
     */
    function creditFor(address agent) external payable {
        _credit(agent, msg.value);
    }

    function _credit(address agent, uint256 amount) private {
        if (amount == 0) revert NothingToFund();
        Subscription storage s = _subs[agent];
        s.balance += amount;
        _owed += amount;
        emit Funded(agent, amount, s.balance);
    }

    /// @notice Start a self-renewing subscription on the seller's terms. Charges period one now.
    function subscribe() external payable {
        _subscribe(msg.sender, msg.value);
    }

    /**
     * @notice Open a subscription on behalf of an agent that has just paid off-chain.
     * @dev The resource server calls this after settling an x402 payment through the Blocky402
     *      facilitator, forwarding what the agent paid. It is what lets an agent hold a
     *      self-renewing subscription without ever signing an on-chain transaction: it signs
     *      one x402 payment, and the network keeps the access alive from there.
     *
     *      The caller must fund at least one period themselves. That is what stops this being
     *      a griefing vector — a stranger cannot burn an agent's existing balance or the
     *      seller's gas reserve by opening a subscription the agent did not ask for; they can
     *      only make one a gift.
     */
    function subscribeFor(address agent) external payable {
        if (msg.value < pricePerPeriod) revert InsufficientBalance();
        _subscribe(agent, msg.value);
    }

    function _subscribe(address agent, uint256 value) private {
        Subscription storage s = _subs[agent];
        if (s.active) revert AlreadyActive();
        if (pricePerPeriod == 0 || periodSeconds == 0) revert TermsNotSet();

        if (value > 0) _credit(agent, value);
        if (s.balance < pricePerPeriod) revert InsufficientBalance();

        s.pricePerPeriod = pricePerPeriod;
        s.periodSeconds = periodSeconds;
        _charge(s, s.pricePerPeriod);
        s.expiresAt = block.timestamp + s.periodSeconds;
        s.active = true;

        emit SubscriptionStarted(agent, s.pricePerPeriod, s.periodSeconds, s.expiresAt);
        _armRenewal(agent, s, true);
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
     *      `MIN_PERIOD_SECONDS` is what stops that gate from being permanently open.
     */
    function renew(address agent) external {
        Subscription storage s = _subs[agent];
        if (!s.active) revert NotSubscribed();
        // `+ RENEW_SLACK` so the network's scheduled call is not rejected for firing a
        // second early. Without it the griefing fix silently breaks self-renewal.
        if (block.timestamp + RENEW_SLACK < s.expiresAt) revert TooEarly(block.timestamp, s.expiresAt);

        // The schedule that brought us here has executed and no longer exists.
        s.schedule = address(0);

        if (s.balance < s.pricePerPeriod) {
            s.active = false;
            emit Lapsed(agent, "insufficient subscriber balance");
            return;
        }

        _charge(s, s.pricePerPeriod);
        // Grant a full period from whichever is later: the window that just ended, or now.
        // Anchoring on the old expiry keeps windows from drifting when execution is a second
        // early; falling back to `block.timestamp` means a renewal that ran *late* never hands
        // back a window that has already been spent.
        s.expiresAt = (s.expiresAt > block.timestamp ? s.expiresAt : block.timestamp) + s.periodSeconds;
        emit Renewed(agent, s.pricePerPeriod, s.expiresAt, s.balance);

        // `false`: a scheduling failure inside the network's own scheduled call must not revert
        // the renewal that already succeeded. It lapses loudly instead.
        _armRenewal(agent, s, false);
        _solvent();
    }

    /// @notice Stop renewing and withdraw the remaining balance.
    function cancel() external {
        Subscription storage s = _subs[msg.sender];
        if (s.pricePerPeriod == 0) revert NotSubscribed();

        // Release the pending scheduled call and reclaim the gas held against it. Without
        // this, subscribe→cancel churn is a free, repeatable drain of the seller's reserve.
        _releaseSchedule(msg.sender, s);

        s.active = false;
        s.pricePerPeriod = 0;
        uint256 refund = s.balance;
        s.balance = 0;
        _owed -= refund;

        emit Cancelled(msg.sender, refund);
        if (refund > 0) _send(msg.sender, refund);
        _solvent();
    }

    /// @notice Beneficiary collects charged periods. Subscriber funds and gas reserve are untouchable.
    function withdraw(uint256 amount) external onlyBeneficiary {
        if (amount == 0 || amount > revenue) revert InsufficientBalance();
        revenue -= amount;
        emit Withdrawn(beneficiary, amount);
        _send(beneficiary, amount);
        _solvent();
    }

    /**
     * @notice Whether `agent` may use the service right now.
     * @dev Deliberately keyed on the window, not on `active`. A cancelled subscriber has already
     *      paid for the period they are inside; `cancel()` refunds the *unspent* balance only.
     *      Revoking access they paid for would be theft in the other direction.
     */
    function hasAccess(address agent) external view returns (bool) {
        return block.timestamp < _subs[agent].expiresAt;
    }

    function subscriptionOf(address agent)
        external
        view
        returns (uint256 balance, uint256 price, uint256 expiresAt, uint32 period, bool active, address schedule)
    {
        Subscription storage s = _subs[agent];
        return (s.balance, s.pricePerPeriod, s.expiresAt, s.periodSeconds, s.active, s.schedule);
    }

    /// @notice Total subscriber money the contract owes back.
    function owed() external view returns (uint256) { return _owed; }

    /// @notice How many further renewals the current gas reserve can arm.
    function renewalsRemaining() external view returns (uint256) {
        return gasReserve / RENEWAL_COST_ESTIMATE;
    }

    function _charge(Subscription storage s, uint256 amount) private {
        s.balance -= amount;
        _owed -= amount;
        revenue += amount;
    }

    /**
     * @dev Schedule the next renewal, but only if the reserve can pay for it and the network
     *      has capacity at that second. Emitting `Lapsed` here — before scheduling — is the
     *      difference between a subscription that ends visibly and one that dies with no event
     *      at all when the scheduled call cannot afford to run.
     * @param strict when true (a user-facing `subscribe()`), a scheduling failure reverts the
     *      whole call. When false (inside the network's scheduled `renew()`), it lapses loudly,
     *      because reverting would undo a renewal that already succeeded and, worse, leave no
     *      event behind.
     */
    function _armRenewal(address agent, Subscription storage s, bool strict) private {
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
        // HIP-1215 exposes capacity up front. Asking first turns a failed schedule into a
        // clean lapse rather than a revert or a subscription that quietly stops.
        if (!hasScheduleCapacity(s.expiresAt, RENEWAL_GAS_LIMIT)) {
            s.active = false;
            emit Lapsed(agent, "no schedule capacity at that second");
            return;
        }

        gasReserve -= RENEWAL_COST_ESTIMATE;

        bytes memory callData = abi.encodeWithSelector(this.renew.selector, agent);
        (int64 rc, address scheduleAddress) =
            scheduleCall(address(this), s.expiresAt, RENEWAL_GAS_LIMIT, 0, callData);

        if (rc != HederaResponseCodes.SUCCESS) {
            gasReserve += RENEWAL_COST_ESTIMATE; // nothing was scheduled; give it back
            if (strict) revert ScheduleFailed(rc);
            s.active = false;
            emit Lapsed(agent, "network refused the schedule");
            return;
        }

        s.schedule = scheduleAddress;
        emit RenewalScheduled(agent, scheduleAddress, s.expiresAt);
    }

    /// @dev Delete a pending schedule and return its held gas to the reserve.
    function _releaseSchedule(address agent, Subscription storage s) private {
        address pending = s.schedule;
        if (pending == address(0)) return;
        s.schedule = address(0);
        // A schedule that already fired cannot be deleted; that is not an error here.
        if (deleteSchedule(pending) == HederaResponseCodes.SUCCESS) {
            gasReserve += RENEWAL_COST_ESTIMATE;
            emit RenewalCancelled(agent, pending, RENEWAL_COST_ESTIMATE);
        }
    }

    /// @dev Tinybar in, tinybar out. Inside the EVM Hedera's `value` is already tinybar, so a
    ///      conversion here would overpay by 1e10. See the units note in the contract docblock.
    function _send(address to, uint256 tinybar) private {
        (bool ok, ) = payable(to).call{value: tinybar}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev The contract must always be able to honour refunds, revenue and scheduled gas.
    ///      `address(this).balance` is tinybar inside the EVM — the same unit as the three pots.
    function _solvent() private view {
        if (address(this).balance < _owed + revenue + gasReserve) revert Insolvent();
    }
}
