/**
 * Re-terms the live contract and restarts the demo subscription, in the one order that works.
 *
 * The demo dies because the economics are upside down at the default terms: a renewal that
 * re-arms costs ~1.55 HBAR of gas to collect 1 HBAR, so at a 90s period the gas reserve drains
 * in minutes. Covering a multi-day judging window at 90s would need thousands of HBAR. Making
 * the period longer is the only affordable fix — 72 renewals an hour apart instead of 2,880 at
 * 90 seconds.
 *
 * ORDER IS LOAD-BEARING. `setTerms` snapshots into each Subscription at subscribe() time, so a
 * subscription opened before the re-term keeps the OLD period for its whole life. Re-term first,
 * subscribe second. This script refuses to run them the wrong way round.
 *
 * Raising the price does NOT fix the drain. The three pots are separate: a subscription payment
 * lands in refundable/revenue, while scheduled calls are paid out of gasReserve, which is only
 * fed by fundGasReserve() or syncReserve(). Topping the reserve up is the actual fix; the longer
 * period is what makes the top-up last.
 *
 *   yarn hardhat run scripts/retermAndRestart.ts --network hederaTestnet
 *
 * Env (all optional, shown with defaults):
 *   PERIOD_SECONDS=3600     new access window. Contract floor is MIN_PERIOD_SECONDS = 61.
 *   PRICE_HBAR=1            price per period. Unchanged by default.
 *   CALLS_PER_PERIOD=<keep> metered calls per window. Read from the contract if unset.
 *   RESERVE_HBAR=120        HBAR to add to the gas reserve.
 *   PERIODS=24              periods to fund the demo subscription for.
 *   AGENT=0xD14C...         subscription to restart. Defaults to the demo agent.
 *   DRY_RUN=1               print the plan and the arithmetic, send nothing.
 *
 * SELLER_PRIVATE_KEY signs setTerms (onlyBeneficiary). BUYER_PRIVATE_KEY funds and subscribes.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const RPC = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const DEMO_AGENT = "0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66";

// Measured on this deployment, 2026-09-09: a renewal that re-arms costs 1.53-1.60 HBAR, one that
// lapses costs 0.05-0.06. Sizing the reserve off the re-arm cost is the conservative direction.
const REARM_COST_HBAR = 1.6;

function cred(k: string): string {
  const f = path.join(process.env.HOME!, ".config/retainer/hedera.env");
  const m = fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`missing ${k} in ~/.config/retainer/hedera.env`);
  return m[1].trim();
}

const WEIBAR_PER_TINYBAR = 10n ** 10n;
const hbar = (tinybar: bigint | number) => `${Number(tinybar) / 1e8} HBAR`;
const toTinybar = (h: number) => BigInt(Math.round(h * 1e8));

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const periodSeconds = Number(process.env.PERIOD_SECONDS ?? 3600);
  const reserveHbar = Number(process.env.RESERVE_HBAR ?? 120);
  const periods = BigInt(process.env.PERIODS ?? 24);
  const agent = process.env.AGENT ?? DEMO_AGENT;

  const dep = JSON.parse(fs.readFileSync("deployments/hederaTestnet/RetainerAccess.json", "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC);
  const seller = new ethers.Wallet(cred("SELLER_PRIVATE_KEY"), provider);
  const buyer = new ethers.Wallet(cred("BUYER_PRIVATE_KEY"), provider);

  const asSeller = new ethers.Contract(dep.address, dep.abi, seller);
  const asBuyer = new ethers.Contract(dep.address, dep.abi, buyer);

  const beneficiary: string = await asSeller.beneficiary();
  const priceNow: bigint = await asSeller.pricePerPeriod();
  const periodNow = Number(await asSeller.periodSeconds());
  const callsNow = Number(await asSeller.callsPerPeriod());
  const minPeriod = Number(await asSeller.MIN_PERIOD_SECONDS());
  const armableNow: bigint = await asSeller.renewalsRemaining();

  const priceHbar = Number(process.env.PRICE_HBAR ?? Number(priceNow) / 1e8);
  const callsPerPeriod = Number(process.env.CALLS_PER_PERIOD ?? callsNow);
  const price = toTinybar(priceHbar);

  console.log(`contract    ${dep.address}  (${dep.hederaContractId})`);
  console.log(`beneficiary ${beneficiary}`);
  console.log(`seller      ${seller.address}`);
  console.log(`buyer       ${buyer.address}`);
  console.log(`agent       ${agent}\n`);

  if (beneficiary.toLowerCase() !== seller.address.toLowerCase())
    throw new Error(
      `SELLER_PRIVATE_KEY is ${seller.address} but beneficiary is ${beneficiary}. ` +
        `setTerms is onlyBeneficiary and beneficiary is immutable — this key cannot re-term.`,
    );
  if (periodSeconds < minPeriod)
    throw new Error(`PERIOD_SECONDS=${periodSeconds} is below the contract floor of ${minPeriod}`);

  console.log(`now:  ${hbar(priceNow)} per ${periodNow}s · ${callsNow} calls · reserve arms ${armableNow}`);
  console.log(`      = ${((Number(armableNow) * periodNow) / 60).toFixed(1)} minutes of life\n`);
  console.log(`next: ${hbar(price)} per ${periodSeconds}s · ${callsPerPeriod} calls`);

  const renewalsFunded = Math.floor(reserveHbar / REARM_COST_HBAR);
  const hours = (renewalsFunded * periodSeconds) / 3600;
  console.log(
    `      +${reserveHbar} HBAR reserve ≈ ${renewalsFunded} re-arming renewals at ~${REARM_COST_HBAR} HBAR each`,
  );
  console.log(`      ≈ ${hours.toFixed(1)} hours of unattended life\n`);

  if (hours < 72)
    console.log(`      NOTE: under 72h. Judging starts 2026-09-14T16:00Z; raise RESERVE_HBAR or PERIOD_SECONDS.\n`);

  if (dryRun) return void console.log("DRY_RUN=1 — nothing sent.");

  // 1. Re-term FIRST. Terms snapshot at subscribe() time, so a subscription opened before this
  //    would keep the old period for its entire life.
  console.log(`1/3 setTerms(${price}, ${periodSeconds}, ${callsPerPeriod}) as beneficiary`);
  let rc = await (await asSeller.setTerms(price, periodSeconds, callsPerPeriod, { gasLimit: 200_000 })).wait();
  console.log(`    tx ${rc!.hash}`);

  // 2. Top up the reserve. This is the actual fix — payments never reach gasReserve.
  //    value on the wire is WEIBAR; the relay converts to TINYBAR before the EVM sees it.
  console.log(`2/3 fundGasReserve() +${reserveHbar} HBAR`);
  rc = await (
    await asBuyer.fundGasReserve({ value: toTinybar(reserveHbar) * WEIBAR_PER_TINYBAR, gasLimit: 200_000 })
  ).wait();
  console.log(`    tx ${rc!.hash}`);

  // 3. Restart the demo subscription, now under the new terms.
  console.log(`3/3 subscribeFor(${agent}) funding ${periods} periods`);
  rc = await (
    await asBuyer.subscribeFor(agent, { value: price * periods * WEIBAR_PER_TINYBAR, gasLimit: 2_000_000 })
  ).wait();
  console.log(`    tx ${rc!.hash}`);

  const armable: bigint = await asSeller.renewalsRemaining();
  console.log(
    `\ndone. reserve arms ${armable} renewals ≈ ${((Number(armable) * periodSeconds) / 3600).toFixed(1)} hours`,
  );
  console.log(`verify: curl -s "https://retainer.edycu.dev/api/retainer/status?agent=${agent}"`);
}

main().catch(e => {
  console.error(e.message ?? e);
  process.exit(1);
});
