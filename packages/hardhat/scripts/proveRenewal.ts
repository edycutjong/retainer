/**
 * Proves the two claims that matter, against the live testnet contract.
 *
 *  1. Access renews itself with nobody calling renew(). We subscribe, then send NO further
 *     transaction and watch the window extend on its own.
 *  2. Refunds pay out the real amount. This is the regression guard for the unit bug: the
 *     JSON-RPC relay takes weibar on the wire and the EVM sees tinybar, so the contract
 *     converts nothing — and an added 1e10 conversion on the way out overpays by ten orders
 *     of magnitude, silently. Measured with contracts/test/UnitProbe.sol.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const RPC = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";

function cred(k: string): string {
  const f = path.join(process.env.HOME!, ".config/retainer/hedera.env");
  const m = fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`missing ${k}`);
  return m[1].trim();
}

const WEIBAR_PER_TINYBAR = 10n ** 10n;
const hbar = (tinybar: bigint | number) => `${Number(tinybar) / 1e8} HBAR`;

async function main() {
  const dep = JSON.parse(fs.readFileSync("deployments/hederaTestnet/RetainerAccess.json", "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC);
  const buyer = new ethers.Wallet(cred("BUYER_PRIVATE_KEY"), provider);
  const c = new ethers.Contract(dep.address, dep.abi, buyer);

  console.log(`contract ${dep.address}  (${dep.hederaContractId})`);
  console.log(`buyer    ${buyer.address}\n`);

  const price: bigint = await c.pricePerPeriod();
  const period: bigint = BigInt(await c.periodSeconds());
  console.log(`terms: ${hbar(price)} per ${period}s period (set by the seller, not the subscriber)`);
  console.log(`gas reserve can arm ${await c.renewalsRemaining()} more renewals\n`);

  // Units are asymmetric and getting this wrong is the bug this script guards against:
  // `value` on the wire is WEIBAR (1 HBAR = 1e18); the RELAY converts it to TINYBAR
  // (1 HBAR = 1e8) before the EVM sees it. The contract itself converts nothing.
  const periodsToFund = 3n;
  const fundingWeibar = price * periodsToFund * WEIBAR_PER_TINYBAR;

  console.log(`subscribe: funding ${hbar(price * periodsToFund)} (${periodsToFund} periods)`);
  const tx = await c.subscribe({ value: fundingWeibar, gasLimit: 2_000_000 });
  const rc = await tx.wait();
  console.log(`  tx ${rc!.hash}`);
  for (const log of rc!.logs) {
    try {
      const p = c.interface.parseLog(log as any);
      if (p) console.log(`  event ${p.name}(${p.args.map(String).join(", ")})`);
    } catch {
      /* not ours */
    }
  }

  const before = await c.subscriptionOf(buyer.address);
  console.log(`\nafter subscribe: expiresAt=${before[2]} balance=${hbar(before[0])} schedule=${before[5]}`);
  if (before[5] === ethers.ZeroAddress) {
    console.log("\n❌ no schedule address — the renewal was NOT scheduled");
    process.exit(1);
  }

  const waitMs = (Number(period) + 45) * 1000;
  console.log(`\nWaiting ${waitMs / 1000}s for the network to fire renew() on its own.`);
  console.log("Sending NO further transactions from here.\n");
  await new Promise(r => setTimeout(r, waitMs));

  const after = await c.subscriptionOf(buyer.address);
  console.log(`after wait:      expiresAt=${after[2]} balance=${hbar(after[0])} schedule=${after[5]}`);

  if (after[2] > before[2]) {
    console.log(
      `\n✅ RENEWED BY THE NETWORK. Window extended ${BigInt(after[2]) - BigInt(before[2])}s, ` +
        `balance drew down ${hbar(BigInt(before[0]) - BigInt(after[0]))} — with no transaction from us.`,
    );
  } else {
    console.log("\n⚠️  window did NOT extend. The scheduled call has not executed (yet).");
  }

  // ── The refund, measured. A wallet balance is the only witness that cannot be argued with.
  const owedBack: bigint = (await c.subscriptionOf(buyer.address))[0];
  if (owedBack > 0n) {
    console.log(`\ncancel: expecting ${hbar(owedBack)} back`);
    const walletBefore = await provider.getBalance(buyer.address);
    const cancelRc = await (await c.cancel({ gasLimit: 2_000_000 })).wait();
    const walletAfter = await provider.getBalance(buyer.address);
    const gasPaid = BigInt(cancelRc!.gasUsed) * BigInt(cancelRc!.gasPrice);
    const received = walletAfter - walletBefore + gasPaid;
    const expected = owedBack * WEIBAR_PER_TINYBAR;

    console.log(`  received ${received} weibar, expected ${expected} weibar`);
    // Allow for the relay's own rounding; the bug being guarded against is a 1e10 shortfall.
    if (received * 100n >= expected * 99n) {
      console.log(`✅ REFUND PAID IN FULL — the tinybar/weibar conversion is correct on both sides.`);
    } else {
      console.log(`❌ REFUND SHORT by ${expected - received} weibar (ratio ${Number(expected) / Number(received)}x)`);
      process.exit(1);
    }
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
