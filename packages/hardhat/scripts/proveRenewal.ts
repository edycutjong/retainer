/**
 * Proves the core claim: access renews itself, with nobody calling renew().
 *
 * 1. buyer funds + subscribes with a short period
 * 2. contract asks the Schedule Service to call renew() at expiry
 * 3. we WAIT and watch — no further transaction is sent
 * 4. if Renewed fires on its own, the product works
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const RPC = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const PERIOD = Number(process.env.PERIOD_SECONDS || 60);

function cred(k: string): string {
  const f = path.join(process.env.HOME!, ".config/retainer/hedera.env");
  const m = fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`missing ${k}`);
  return m[1].trim();
}

async function main() {
  const dep = JSON.parse(fs.readFileSync("deployments/hederaTestnet/RetainerAccess.json", "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC);
  const buyer = new ethers.Wallet(cred("BUYER_PRIVATE_KEY"), provider);
  const c = new ethers.Contract(dep.address, dep.abi, buyer);

  console.log(`contract ${dep.address}  (${dep.hederaContractId})`);
  console.log(`buyer    ${buyer.address}\n`);

  // Hedera units are asymmetric, and getting this wrong reverts in a misleading way:
  //   * the transaction's `value` field is WEIBAR (1 HBAR = 1e18); a non-zero value below
  //     1e10 weibar (= 1 tinybar) is rejected outright by the relay
  //   * but `msg.value` as SEEN INSIDE the contract is TINYBAR (1 HBAR = 1e8)
  // So amounts stored/compared on-chain are tinybar, while what we send is weibar.
  const priceTinybar = ethers.parseUnits("1", 8); // 1 HBAR per period, as the contract sees it
  const fundingWeibar = ethers.parseEther("3"); // 3 HBAR sent -> contract sees 3e8 tinybar
  const price = priceTinybar;
  const funding = fundingWeibar;

  console.log(`subscribe: price=${price} period=${PERIOD}s funding=${funding}`);
  const tx = await c.subscribe(priceTinybar, PERIOD, { value: fundingWeibar, gasLimit: 2_000_000 });
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
  console.log(`\nafter subscribe: expiresAt=${before[2]} balance=${before[0]} schedule=${before[5]}`);
  if (before[5] === ethers.ZeroAddress) {
    console.log("\n❌ no schedule address — the renewal was NOT scheduled");
    process.exit(1);
  }

  const waitMs = (PERIOD + 45) * 1000;
  console.log(`\nWaiting ${waitMs / 1000}s for the network to fire renew() on its own.`);
  console.log("Sending NO further transactions from here.\n");
  await new Promise(r => setTimeout(r, waitMs));

  const after = await c.subscriptionOf(buyer.address);
  console.log(`after wait:      expiresAt=${after[2]} balance=${after[0]} schedule=${after[5]}`);

  if (after[2] > before[2]) {
    console.log(
      `\n✅ RENEWED BY THE NETWORK. window extended ${after[2] - before[2]}s, ` +
        `balance drew down ${before[0] - after[0]} — with no transaction from us.`,
    );
  } else {
    console.log("\n⚠️  window did NOT extend. The scheduled call has not executed (yet).");
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
