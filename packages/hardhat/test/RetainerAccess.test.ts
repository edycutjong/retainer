import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { RetainerAccess } from "../typechain-types";

const HSS = "0x000000000000000000000000000000000000016b";
const PRICE = 100n; // tinybar per period
const PERIOD = 60; // seconds
const RESERVE = 200_000_000n; // must match RENEWAL_COST_ESTIMATE

/** Contract-internal amounts are tinybar; msg.value is weibar (1 tinybar = 1e10 weibar). */
const toWeibar = (tinybar: bigint) => tinybar * 10n ** 10n;

describe("RetainerAccess", () => {
  let c: RetainerAccess;
  let seller: any, agent: any, stranger: any;

  beforeEach(async () => {
    [seller, agent, stranger] = await ethers.getSigners();

    // Put the mock Schedule Service at the system-contract address.
    const mock = await (await ethers.getContractFactory("MockScheduleService")).deploy();
    const code = await ethers.provider.getCode(await mock.getAddress());
    await network.provider.send("hardhat_setCode", [HSS, code]);

    c = (await (
      await ethers.getContractFactory("RetainerAccess")
    ).deploy(seller.address, { value: toWeibar(RESERVE * 5n) })) as any;
  });

  describe("renew() time gate — the griefing fix", () => {
    it("rejects renewal before the window expires", async () => {
      await c.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 10n) });
      await expect(c.connect(stranger).renew(agent.address)).to.be.revertedWithCustomError(c, "TooEarly");
    });

    it("a stranger cannot repeatedly force renewals to drain the contract", async () => {
      await c.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 10n) });
      const before = await c.gasReserve();
      for (let i = 0; i < 5; i++) {
        await expect(c.connect(stranger).renew(agent.address)).to.be.revertedWithCustomError(c, "TooEarly");
      }
      expect(await c.gasReserve()).to.equal(before); // no scheduling was forced
    });

    it("allows renewal once the window has expired", async () => {
      await c.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 10n) });
      const before = (await c.subscriptionOf(agent.address))[2];
      await network.provider.send("evm_increaseTime", [PERIOD + 1]);
      await network.provider.send("evm_mine");
      await expect(c.connect(stranger).renew(agent.address)).to.emit(c, "Renewed");
      expect((await c.subscriptionOf(agent.address))[2]).to.be.greaterThan(before);
    });
  });

  describe("money separation", () => {
    it("charged periods become withdrawable revenue, not subscriber funds", async () => {
      await c.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 10n) });
      expect(await c.revenue()).to.equal(PRICE);
      expect(await c.owed()).to.equal(PRICE * 9n);
    });

    it("only the beneficiary may withdraw", async () => {
      await c.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 10n) });
      await expect(c.connect(stranger).withdraw(PRICE)).to.be.revertedWithCustomError(c, "NotBeneficiary");
      await expect(c.connect(seller).withdraw(PRICE)).to.emit(c, "Withdrawn");
    });

    it("the beneficiary cannot withdraw subscriber money", async () => {
      await c.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 10n) });
      await expect(c.connect(seller).withdraw(PRICE * 2n)).to.be.revertedWithCustomError(c, "InsufficientBalance");
    });

    it("cancel refunds the remaining balance and cannot be replayed", async () => {
      await c.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 10n) });
      await expect(c.connect(agent).cancel()).to.emit(c, "Cancelled");
      expect(await c.owed()).to.equal(0n);
      await expect(c.connect(agent).cancel()).to.be.revertedWithCustomError(c, "NotSubscribed");
    });
  });

  describe("lapsing is loud, never silent", () => {
    it("emits Lapsed when the gas reserve cannot cover the next renewal", async () => {
      const poor = (await (
        await ethers.getContractFactory("RetainerAccess")
      ).deploy(seller.address, { value: toWeibar(RESERVE) })) as any; // exactly one renewal
      await poor.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 10n) });
      await network.provider.send("evm_increaseTime", [PERIOD + 1]);
      await network.provider.send("evm_mine");
      await expect(poor.connect(agent).renew(agent.address))
        .to.emit(poor, "Lapsed")
        .withArgs(agent.address, "gas reserve will not cover the next renewal");
      expect((await poor.subscriptionOf(agent.address))[4]).to.equal(false);
    });

    it("emits Lapsed when the subscriber cannot cover the next period", async () => {
      await c.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 2n) });
      await network.provider.send("evm_increaseTime", [PERIOD + 1]);
      await network.provider.send("evm_mine");
      await expect(c.connect(agent).renew(agent.address))
        .to.emit(c, "Lapsed")
        .withArgs(agent.address, "balance will not cover the next period");
    });
  });

  describe("access gate", () => {
    it("grants access for the window and withdraws it after expiry", async () => {
      expect(await c.hasAccess(agent.address)).to.equal(false);
      await c.connect(agent).subscribe(PRICE, PERIOD, { value: toWeibar(PRICE * 10n) });
      expect(await c.hasAccess(agent.address)).to.equal(true);
      await network.provider.send("evm_increaseTime", [PERIOD + 5]);
      await network.provider.send("evm_mine");
      expect(await c.hasAccess(agent.address)).to.equal(false);
    });
  });
});
