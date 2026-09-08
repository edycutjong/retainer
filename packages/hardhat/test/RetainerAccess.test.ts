import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { RetainerAccess } from "../typechain-types";

const HSS = "0x000000000000000000000000000000000000016b";
const PRICE = 100n; // tinybar per period
const PERIOD = 120; // seconds — must exceed MIN_PERIOD_SECONDS (61)
const CALLS = 5; // metered calls one period buys
const RESERVE = 200_000_000n; // must match RENEWAL_COST_ESTIMATE

/**
 * Everything is tinybar, including `value`.
 *
 * Measured on testnet with contracts/test/UnitProbe.sol: the JSON-RPC relay takes weibar on the
 * wire and the EVM sees tinybar, so a contract does no conversion. These tests therefore pass
 * tinybar straight into `value`, exactly as the deployed contract receives it.
 */
const tinybar = (t: bigint) => t;

/** The mock scheduler, reached at the system-contract address it was installed at. */
const scheduler = async () => ethers.getContractAt("MockScheduleService", HSS);

describe("RetainerAccess", () => {
  let c: RetainerAccess;
  let seller: any, agent: any, stranger: any;

  beforeEach(async () => {
    [seller, agent, stranger] = await ethers.getSigners();

    // Put the mock Schedule Service at the system-contract address.
    const mock = await (await ethers.getContractFactory("MockScheduleService")).deploy();
    const code = await ethers.provider.getCode(await mock.getAddress());
    await network.provider.send("hardhat_setCode", [HSS, code]);
    const m = await scheduler();
    await m.setRefuseSchedule(false);
    await m.setNoCapacity(false);
    await m.setRefuseDelete(false);

    c = (await (
      await ethers.getContractFactory("RetainerAccess")
    ).deploy(seller.address, PRICE, PERIOD, CALLS, { value: tinybar(RESERVE * 5n) })) as any;
  });

  const subscribe = (who: any, periods: bigint = 10n) => c.connect(who).subscribe({ value: tinybar(PRICE * periods) });

  const factory = () => ethers.getContractFactory("RetainerAccess");

  describe("what the constructor will and will not accept", () => {
    it("names the deployer as beneficiary when the deploy does not name one", async () => {
      const d = await (await factory()).deploy(ethers.ZeroAddress, PRICE, PERIOD, CALLS);
      expect(await d.beneficiary()).to.equal(seller.address);
    });

    it("books nothing into the gas reserve when the deploy carries no value", async () => {
      // On Hedera a payable constructor usually sees msg.value == 0 even when the create carried
      // money, because the balance is credited outside the EVM frame. Booking only what the frame
      // actually saw is the honest reading; syncReserve() adopts the rest afterwards.
      const d = await (await factory()).deploy(seller.address, PRICE, PERIOD, CALLS);
      expect(await d.gasReserve()).to.equal(0n);
      expect(await d.renewalsRemaining()).to.equal(0n);
    });

    it("may be deployed with no terms at all, and then sells nothing until the seller sets them", async () => {
      const d = await (await factory()).deploy(seller.address, 0n, 0, 0);
      expect(await d.pricePerPeriod()).to.equal(0n);
      expect(await d.periodSeconds()).to.equal(0);
      await expect(d.connect(agent).subscribe({ value: tinybar(PRICE) })).to.be.revertedWithCustomError(
        d,
        "TermsNotSet",
      );
    });

    it("refuses to deploy with a period but no price", async () => {
      await expect((await factory()).deploy(seller.address, 0n, PERIOD, CALLS)).to.be.revertedWithCustomError(
        c,
        "InvalidTerms",
      );
    });
  });

  describe("units — tinybar in storage, weibar on the wire", () => {
    // The bug this locks out: `call{value: tinybar}` sends 1e10 times too little. It does not
    // revert, it does not emit anything unusual — it just silently underpays the refund.
    it("refunds the subscriber the real amount, with no unit conversion", async () => {
      await subscribe(agent, 10n);
      const before = await ethers.provider.getBalance(agent.address);
      const tx = await c.connect(agent).cancel();
      const rc = await tx.wait();
      const gas = rc!.gasUsed * rc!.gasPrice;
      const after = await ethers.provider.getBalance(agent.address);
      // 10 periods funded, 1 charged on subscribe → 9 refundable.
      expect(after - before + gas).to.equal(PRICE * 9n);
    });

    it("pays the beneficiary the real amount, with no unit conversion", async () => {
      await subscribe(agent, 10n);
      const before = await ethers.provider.getBalance(seller.address);
      const tx = await c.withdraw(PRICE);
      const rc = await tx.wait();
      const gas = rc!.gasUsed * rc!.gasPrice;
      const after = await ethers.provider.getBalance(seller.address);
      expect(after - before + gas).to.equal(PRICE);
    });

    it("credits a deposit as the exact amount sent", async () => {
      await c.connect(agent).fund({ value: 500n });
      const [balance] = await c.subscriptionOf(agent.address);
      expect(balance).to.equal(500n);
    });

    it("rejects a zero deposit instead of booking nothing", async () => {
      await expect(c.connect(agent).fund({ value: 0n })).to.be.revertedWithCustomError(c, "NothingToFund");
    });

    it("holds the solvency invariant: balance covers all three pots", async () => {
      await subscribe(agent, 10n);
      const held = await ethers.provider.getBalance(await c.getAddress());
      const liabilities = (await c.owed()) + (await c.revenue()) + (await c.gasReserve());
      expect(held).to.be.gte(liabilities);
    });

    it("syncReserve adopts balance the contract holds but never booked", async () => {
      // Hedera credits a contract-create's initial balance outside the EVM frame, so a payable
      // constructor can see msg.value == 0 while the contract really does hold the money.
      const before = await c.gasReserve();
      const held = await ethers.provider.getBalance(await c.getAddress());
      // setBalance, not a transfer: the point is money arriving WITHOUT an EVM frame, which is
      // exactly what Hedera's HAPI-level initial balance does to a payable constructor.
      await network.provider.send("hardhat_setBalance", [await c.getAddress(), "0x" + (held + 12345n).toString(16)]);
      await expect(c.syncReserve()).to.emit(c, "GasReserveFunded");
      expect(await c.gasReserve()).to.equal(before + 12345n);
    });

    it("only the beneficiary may sync the reserve", async () => {
      await expect(c.connect(stranger).syncReserve()).to.be.revertedWithCustomError(c, "NotBeneficiary");
    });
  });

  describe("the gas reserve pays for the contract's own future", () => {
    it("lets anyone top up the reserve that funds scheduled executions", async () => {
      const before = await c.gasReserve();
      await expect(c.connect(stranger).fundGasReserve({ value: tinybar(RESERVE) }))
        .to.emit(c, "GasReserveFunded")
        .withArgs(stranger.address, RESERVE, before + RESERVE);
      expect(await c.gasReserve()).to.equal(before + RESERVE);
      expect(await c.renewalsRemaining()).to.equal(6n);
    });

    it("keeps a reserve top-up out of the subscriber pot entirely", async () => {
      // The three pots only work if money cannot drift between them: gas is not refundable.
      await c.connect(stranger).fundGasReserve({ value: tinybar(RESERVE) });
      expect(await c.owed()).to.equal(0n);
      const [balance] = await c.subscriptionOf(stranger.address);
      expect(balance).to.equal(0n);
    });

    it("rejects a zero contribution to the reserve instead of booking nothing", async () => {
      await expect(c.connect(stranger).fundGasReserve({ value: 0n })).to.be.revertedWithCustomError(c, "NothingToFund");
    });

    it("finds nothing to adopt when every tinybar the contract holds is already booked", async () => {
      // syncReserve() exists for money that arrived without an EVM frame. When there is none,
      // it must not quietly re-book the reserve as if it had found some.
      await expect(c.syncReserve()).to.be.revertedWithCustomError(c, "NothingToFund");
    });
  });

  describe("the seller sets the price, not the subscriber", () => {
    it("charges the seller's price regardless of what the subscriber sends", async () => {
      await subscribe(agent, 10n);
      const [, price] = await c.subscriptionOf(agent.address);
      expect(price).to.equal(PRICE);
      expect(await c.revenue()).to.equal(PRICE);
    });

    it("refuses a subscription that cannot cover one period at the seller's price", async () => {
      // Formerly: subscribe(2, 60) bought a full window for 2 tinybar and burned 2 HBAR of reserve.
      await expect(c.connect(agent).subscribe({ value: tinybar(2n) })).to.be.revertedWithCustomError(
        c,
        "InsufficientBalance",
      );
    });

    it("only the beneficiary may change the terms", async () => {
      await expect(c.connect(stranger).setTerms(1n, PERIOD, CALLS)).to.be.revertedWithCustomError(c, "NotBeneficiary");
    });

    it("rejects a period short enough to keep the renew() window permanently open", async () => {
      // periodSeconds <= 2 * RENEW_SLACK would let anyone loop renew() unattended.
      await expect(c.setTerms(PRICE, 30, CALLS)).to.be.revertedWithCustomError(c, "InvalidTerms");
    });

    it("rejects terms that give the resource away for nothing", async () => {
      await expect(c.setTerms(0n, PERIOD, CALLS)).to.be.revertedWithCustomError(c, "InvalidTerms");
    });

    it("rejects terms whose period buys no calls at all", async () => {
      // A period that buys zero calls is a charge for nothing: meter() would revert on the first
      // request of a window the subscriber has already paid for.
      await expect(c.setTerms(PRICE, PERIOD, 0)).to.be.revertedWithCustomError(c, "InvalidTerms");
    });

    it("does not reprice a subscription that is already running", async () => {
      await subscribe(agent, 10n);
      await c.setTerms(PRICE * 5n, PERIOD, CALLS);
      await network.provider.send("evm_increaseTime", [PERIOD]);
      await network.provider.send("evm_mine");
      await c.connect(stranger).renew(agent.address);
      expect(await c.revenue()).to.equal(PRICE * 2n); // still the original price
    });
  });

  describe("x402 settlement credits the on-chain subscription", () => {
    // Without this the payment rail and the renewal mechanism are unrelated systems.
    it("lets the resource server credit a settled payment to the paying agent", async () => {
      await c.connect(seller).creditFor(agent.address, { value: tinybar(PRICE * 3n) });
      const [balance] = await c.subscriptionOf(agent.address);
      expect(balance).to.equal(PRICE * 3n);
    });

    it("counts credited funds as money owed back to the agent, not revenue", async () => {
      await c.connect(seller).creditFor(agent.address, { value: tinybar(PRICE * 3n) });
      expect(await c.owed()).to.equal(PRICE * 3n);
      expect(await c.revenue()).to.equal(0n);
    });

    it("the resource server can open the subscription for an agent that paid off-chain", async () => {
      // The agent signs one x402 payment and never touches the chain; the server forwards it.
      await expect(c.connect(seller).subscribeFor(agent.address, { value: tinybar(PRICE * 3n) }))
        .to.emit(c, "SubscriptionStarted")
        .and.to.emit(c, "RenewalScheduled");
      expect(await c.hasAccess(agent.address)).to.equal(true);
      const [balance] = await c.subscriptionOf(agent.address);
      expect(balance).to.equal(PRICE * 2n); // 3 forwarded, 1 charged now
    });

    it("subscribeFor cannot spend an agent's existing balance without funding a period", async () => {
      // Otherwise a stranger could open an unwanted subscription on the agent's money
      // and burn a slot of the seller's gas reserve doing it.
      await c.connect(stranger).creditFor(agent.address, { value: tinybar(PRICE * 5n) });
      await expect(
        c.connect(stranger).subscribeFor(agent.address, { value: tinybar(PRICE - 1n) }),
      ).to.be.revertedWithCustomError(c, "InsufficientBalance");
    });

    it("a credited agent can subscribe with no further payment", async () => {
      await c.connect(stranger).creditFor(agent.address, { value: tinybar(PRICE * 2n) });
      await expect(c.connect(agent).subscribe()).to.emit(c, "SubscriptionStarted");
      expect(await c.hasAccess(agent.address)).to.equal(true);
    });
  });

  describe("one subscription per agent, and only on real terms", () => {
    it("refuses to open a second subscription while one is already running", async () => {
      // Otherwise the second subscribe would re-snapshot the terms and arm a second schedule,
      // holding two slots of the seller's reserve for one window of access.
      await subscribe(agent, 10n);
      await expect(c.connect(agent).subscribe({ value: tinybar(PRICE) })).to.be.revertedWithCustomError(
        c,
        "AlreadyActive",
      );
    });

    it("refuses to renew an agent that never subscribed", async () => {
      await expect(c.connect(stranger).renew(stranger.address)).to.be.revertedWithCustomError(c, "NotSubscribed");
    });

    it("lapses at once when the deposit covers the first period but not the second", async () => {
      // The lapse happens before anything is scheduled, so no reserve is held against a renewal
      // that was never going to be affordable.
      const reserve = await c.gasReserve();
      await expect(c.connect(agent).subscribe({ value: tinybar(PRICE) }))
        .to.emit(c, "Lapsed")
        .withArgs(agent.address, "balance will not cover the next period");

      const [, , , , active, schedule] = await c.subscriptionOf(agent.address);
      expect(active).to.equal(false);
      expect(schedule).to.equal(ethers.ZeroAddress);
      expect(await c.gasReserve()).to.equal(reserve);
      expect(await c.hasAccess(agent.address)).to.equal(true); // the period they paid for is theirs
    });

    it("cancels a lapsed subscription with nothing to refund and no schedule to release", async () => {
      await c.connect(agent).subscribe({ value: tinybar(PRICE) }); // lapses immediately: 0 left
      const reserve = await c.gasReserve();
      const tx = c.connect(agent).cancel();
      await expect(tx).to.emit(c, "Cancelled").withArgs(agent.address, 0n);
      await expect(tx).to.not.emit(c, "RenewalCancelled");
      expect(await c.gasReserve()).to.equal(reserve); // nothing was held, so nothing comes back
      expect(await c.owed()).to.equal(0n);
    });
  });

  describe("renew() time gate — the griefing fix", () => {
    it("rejects renewal before the window expires", async () => {
      await subscribe(agent);
      await expect(c.connect(stranger).renew(agent.address)).to.be.revertedWithCustomError(c, "TooEarly");
    });

    it("a stranger cannot repeatedly force renewals to drain the contract", async () => {
      await subscribe(agent);
      const before = await c.gasReserve();
      for (let i = 0; i < 5; i++) {
        await expect(c.connect(stranger).renew(agent.address)).to.be.revertedWithCustomError(c, "TooEarly");
      }
      expect(await c.gasReserve()).to.equal(before); // no scheduling was forced
    });

    it("accepts a renewal that fires slightly EARLY, as the real scheduler does", async () => {
      // Regression test. The Schedule Service was observed firing one second before
      // expirySecond on testnet; a strict `>=` gate rejected it and self-renewal broke.
      await subscribe(agent);
      await network.provider.send("evm_increaseTime", [PERIOD - 5]); // still 5s early
      await network.provider.send("evm_mine");
      await expect(c.connect(stranger).renew(agent.address)).to.emit(c, "Renewed");
    });

    it("allows renewal once the window has expired", async () => {
      await subscribe(agent);
      await network.provider.send("evm_increaseTime", [PERIOD]);
      await network.provider.send("evm_mine");
      await expect(c.connect(stranger).renew(agent.address)).to.emit(c, "Renewed");
    });
  });

  describe("what the contract asks the scheduler to do", () => {
    // The core mechanism. Everything else is bookkeeping around this one call.
    it("schedules renew(agent) against itself, at the expiry second", async () => {
      const mock = await ethers.getContractAt("MockScheduleService", HSS);
      const tx = await subscribe(agent);
      const rc = await tx.wait();
      const [, , expiresAt] = await c.subscriptionOf(agent.address);

      const log = rc!.logs
        .map(l => {
          try {
            return mock.interface.parseLog(l as any);
          } catch {
            return null;
          }
        })
        .find(l => l?.name === "MockScheduled");

      expect(log, "no schedule was created").to.not.equal(undefined);
      expect(log!.args.to).to.equal(await c.getAddress());
      expect(log!.args.expirySecond).to.equal(expiresAt);
      expect(log!.args.value).to.equal(0n);
      expect(log!.args.callData).to.equal(c.interface.encodeFunctionData("renew", [agent.address]));
    });

    it("records the returned schedule address on the subscription", async () => {
      await subscribe(agent);
      const [, , , , , schedule] = await c.subscriptionOf(agent.address);
      expect(schedule).to.not.equal(ethers.ZeroAddress);
    });

    it("deletes the pending schedule on cancel and reclaims its gas", async () => {
      // Otherwise subscribe→cancel churn is a free, repeatable drain of the seller's reserve.
      await subscribe(agent);
      const during = await c.gasReserve();
      await expect(c.connect(agent).cancel()).to.emit(c, "RenewalCancelled");
      expect(await c.gasReserve()).to.equal(during + RESERVE);
    });

    it("does not reclaim gas for a schedule the network will no longer delete", async () => {
      // A schedule that has already fired cannot be deleted. Crediting the reserve anyway would
      // book gas the network has already spent, and the solvency check would eventually catch it.
      await subscribe(agent, 10n);
      const during = await c.gasReserve();
      await (await scheduler()).setRefuseDelete(true);

      const tx = c.connect(agent).cancel();
      await expect(tx).to.not.emit(c, "RenewalCancelled");
      await tx;

      expect(await c.gasReserve()).to.equal(during);
      const [, , , , , schedule] = await c.subscriptionOf(agent.address);
      expect(schedule).to.equal(ethers.ZeroAddress); // the pointer is dropped either way
    });

    it("subscribe→cancel churn does not drain the gas reserve", async () => {
      const before = await c.gasReserve();
      for (let i = 0; i < 5; i++) {
        await subscribe(agent);
        await c.connect(agent).cancel();
      }
      expect(await c.gasReserve()).to.equal(before);
    });
  });

  describe("money separation", () => {
    it("charged periods become withdrawable revenue, not subscriber funds", async () => {
      await subscribe(agent, 10n);
      expect(await c.revenue()).to.equal(PRICE);
      expect(await c.owed()).to.equal(PRICE * 9n);
    });

    it("only the beneficiary may withdraw", async () => {
      await subscribe(agent, 10n);
      await expect(c.connect(stranger).withdraw(PRICE)).to.be.revertedWithCustomError(c, "NotBeneficiary");
    });

    it("the beneficiary cannot withdraw subscriber money", async () => {
      await subscribe(agent, 10n);
      await expect(c.withdraw(PRICE * 2n)).to.be.revertedWithCustomError(c, "InsufficientBalance");
    });

    it("the beneficiary cannot withdraw the gas reserve", async () => {
      await subscribe(agent, 10n);
      await expect(c.withdraw(RESERVE)).to.be.revertedWithCustomError(c, "InsufficientBalance");
    });

    it("rejects a zero withdrawal instead of emitting a payout of nothing", async () => {
      await subscribe(agent, 10n);
      await expect(c.withdraw(0n)).to.be.revertedWithCustomError(c, "InsufficientBalance");
    });

    it("cancel refunds the remaining balance and cannot be replayed", async () => {
      await subscribe(agent, 10n);
      await c.connect(agent).cancel();
      expect(await c.owed()).to.equal(0n);
      await expect(c.connect(agent).cancel()).to.be.revertedWithCustomError(c, "NotSubscribed");
    });
  });

  describe("lapsing is loud, never silent", () => {
    it("emits Lapsed when the gas reserve cannot cover the next renewal", async () => {
      // Drain the reserve down to a single armed renewal.
      const poor = (await (
        await ethers.getContractFactory("RetainerAccess")
      ).deploy(seller.address, PRICE, PERIOD, CALLS, { value: tinybar(RESERVE) })) as any;

      await poor.connect(agent).subscribe({ value: tinybar(PRICE * 10n) });
      await network.provider.send("evm_increaseTime", [PERIOD]);
      await network.provider.send("evm_mine");
      await expect(poor.connect(stranger).renew(agent.address))
        .to.emit(poor, "Lapsed")
        .withArgs(agent.address, "gas reserve will not cover the next renewal");
    });

    it("emits Lapsed when the subscriber cannot cover the next period", async () => {
      await subscribe(agent, 2n); // one period charged now, one left
      await network.provider.send("evm_increaseTime", [PERIOD]);
      await network.provider.send("evm_mine");
      await expect(c.connect(stranger).renew(agent.address))
        .to.emit(c, "Lapsed")
        .withArgs(agent.address, "balance will not cover the next period");
    });

    it("emits Lapsed when the network has no schedule capacity", async () => {
      await subscribe(agent, 10n);
      await (await scheduler()).setNoCapacity(true);
      await network.provider.send("evm_increaseTime", [PERIOD]);
      await network.provider.send("evm_mine");
      await expect(c.connect(stranger).renew(agent.address))
        .to.emit(c, "Lapsed")
        .withArgs(agent.address, "no schedule capacity at that second");
    });

    it("a scheduling failure inside renew() lapses loudly instead of reverting the renewal", async () => {
      await subscribe(agent, 10n);
      await (await scheduler()).setRefuseSchedule(true);
      await network.provider.send("evm_increaseTime", [PERIOD]);
      await network.provider.send("evm_mine");
      const tx = c.connect(stranger).renew(agent.address);
      await expect(tx).to.emit(c, "Renewed"); // the renewal itself still happened
      await expect(tx).to.emit(c, "Lapsed").withArgs(agent.address, "network refused the schedule");
    });

    it("refunds the reserve when the network refuses the schedule", async () => {
      await subscribe(agent, 10n);
      const before = await c.gasReserve();
      await (await scheduler()).setRefuseSchedule(true);
      await network.provider.send("evm_increaseTime", [PERIOD]);
      await network.provider.send("evm_mine");
      await c.connect(stranger).renew(agent.address);
      expect(await c.gasReserve()).to.equal(before); // nothing scheduled, nothing held
    });

    it("a scheduling failure at subscribe() time reverts, because the user is watching", async () => {
      await (await scheduler()).setRefuseSchedule(true);
      await expect(c.connect(agent).subscribe({ value: tinybar(PRICE * 10n) })).to.be.revertedWithCustomError(
        c,
        "ScheduleFailed",
      );
    });
  });

  describe("failures that must be surfaced, never swallowed", () => {
    it("reverts rather than losing the refund when the subscriber cannot receive payment", async () => {
      // A subscriber can be a contract — subscribeFor() exists precisely so an agent's server can
      // hold the subscription. If that account cannot take a bare value transfer, the refund must
      // fail loudly instead of zeroing the books and dropping the money on the floor.
      // Any deployed contract with no receive() serves as that account; reusing the scheduler mock
      // avoids adding a contract whose only purpose is to refuse money.
      const contractAccount = await (await ethers.getContractFactory("MockScheduleService")).deploy();
      const who = await contractAccount.getAddress();
      await network.provider.send("hardhat_impersonateAccount", [who]);
      await network.provider.send("hardhat_setBalance", [who, "0x" + (10n ** 20n).toString(16)]);
      const asContract = await ethers.getSigner(who);

      await c.connect(asContract).subscribe({ value: tinybar(PRICE * 10n) });
      await expect(c.connect(asContract).cancel()).to.be.revertedWithCustomError(c, "TransferFailed");
      expect(await c.owed()).to.equal(PRICE * 9n); // still owed: a failed payout settles nothing

      await network.provider.send("hardhat_stopImpersonatingAccount", [who]);
    });

    it("stops transacting once its native balance no longer covers the three pots", async () => {
      // The mirror image of syncReserve(). Hedera moves a contract's balance outside the EVM frame
      // in both directions — it credits a create's value, and it debits the contract for every
      // scheduled execution. So the books really can outrun the balance with no EVM call to notice,
      // which is why _solvent() is checked after every state change rather than trusted.
      await subscribe(agent, 10n);
      const liabilities = (await c.owed()) + (await c.revenue()) + (await c.gasReserve());
      await network.provider.send("hardhat_setBalance", [await c.getAddress(), "0x" + (liabilities - 1n).toString(16)]);
      await expect(c.connect(agent).cancel()).to.be.revertedWithCustomError(c, "Insolvent");
    });
  });

  describe("metering — the period buys a countable quantity", () => {
    it("counts each served call against the allowance", async () => {
      await subscribe(agent, 10n);
      await expect(c.meter(agent.address)).to.emit(c, "Metered").withArgs(agent.address, 1, CALLS);
      const u = await c.usageOf(agent.address);
      expect(u.used).to.equal(1);
      expect(u.remaining).to.equal(CALLS - 1);
    });

    it("refuses once the calls the period bought are spent", async () => {
      await subscribe(agent, 10n);
      for (let i = 0; i < CALLS; i++) await c.meter(agent.address);
      await expect(c.meter(agent.address)).to.be.revertedWithCustomError(c, "QuotaExhausted").withArgs(CALLS, CALLS);
    });

    it("the renewal refills the meter — the same call that extends the window", async () => {
      await subscribe(agent, 10n);
      for (let i = 0; i < CALLS; i++) await c.meter(agent.address);
      expect((await c.usageOf(agent.address)).remaining).to.equal(0);

      await network.provider.send("evm_increaseTime", [PERIOD]);
      await network.provider.send("evm_mine");
      await c.connect(stranger).renew(agent.address); // stands in for the scheduled call

      expect((await c.usageOf(agent.address)).remaining).to.equal(CALLS);
      await expect(c.meter(agent.address)).to.emit(c, "Metered");
    });

    it("only the seller may move the meter", async () => {
      // Otherwise a stranger could burn an agent's allowance without serving it anything.
      await subscribe(agent, 10n);
      await expect(c.connect(stranger).meter(agent.address)).to.be.revertedWithCustomError(c, "NotBeneficiary");
    });

    it("refuses to meter an agent with no access", async () => {
      await expect(c.meter(stranger.address)).to.be.revertedWithCustomError(c, "NoAccess");
    });

    it("does not reprice or re-quota a subscription already running", async () => {
      await subscribe(agent, 10n);
      await c.setTerms(PRICE, PERIOD, CALLS * 10);
      expect((await c.usageOf(agent.address)).allowance).to.equal(CALLS);
    });
  });

  describe("access gate", () => {
    it("grants access for the window and withdraws it after expiry", async () => {
      await subscribe(agent, 2n);
      expect(await c.hasAccess(agent.address)).to.equal(true);
      await network.provider.send("evm_increaseTime", [PERIOD + 1]);
      await network.provider.send("evm_mine");
      expect(await c.hasAccess(agent.address)).to.equal(false);
    });

    it("keeps access for the period already paid for after a cancel", async () => {
      // cancel() refunds the UNSPENT balance; the current period was charged and is theirs.
      await subscribe(agent, 10n);
      await c.connect(agent).cancel();
      expect(await c.hasAccess(agent.address)).to.equal(true);
    });

    it("access survives its own expiry when the renewal fires — the whole point", async () => {
      await subscribe(agent, 10n);
      const [, , firstExpiry] = await c.subscriptionOf(agent.address);
      await network.provider.send("evm_increaseTime", [PERIOD]);
      await network.provider.send("evm_mine");
      await c.connect(stranger).renew(agent.address); // stands in for the scheduled call
      const [, , secondExpiry] = await c.subscriptionOf(agent.address);
      // A full further period is granted, measured from whichever is later: the old expiry, or
      // now. A renewal that runs late must never hand back a window that is already spent.
      expect(secondExpiry).to.be.gte(firstExpiry + BigInt(PERIOD));
      expect(await c.hasAccess(agent.address)).to.equal(true);
    });

    it("reports how many further renewals the reserve can arm", async () => {
      expect(await c.renewalsRemaining()).to.equal(5n);
      await subscribe(agent, 10n);
      expect(await c.renewalsRemaining()).to.equal(4n);
    });
  });
});
