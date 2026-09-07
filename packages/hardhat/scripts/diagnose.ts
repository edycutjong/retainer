import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
const RPC = "https://testnet.hashio.io/api";
function cred(k: string) {
  const m = fs
    .readFileSync(path.join(process.env.HOME!, ".config/retainer/hedera.env"), "utf8")
    .match(new RegExp(`^${k}=(.*)$`, "m"));
  return m![1].trim();
}
async function main() {
  const dep = JSON.parse(fs.readFileSync("deployments/hederaTestnet/RetainerAccess.json", "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC);
  const buyer = new ethers.Wallet(cred("BUYER_PRIVATE_KEY"), provider);
  const c = new ethers.Contract(dep.address, dep.abi, buyer);

  console.log("1) Is the Schedule Service system contract (0x16b) present?");
  const code = await provider.getCode("0x000000000000000000000000000000000000016b");
  console.log(
    `   getCode(0x16b) = ${code.length > 2 ? code.slice(0, 20) + "... (" + (code.length - 2) / 2 + " bytes)" : "0x  <-- EMPTY"}`,
  );

  console.log("\n2) Decode the revert reason from subscribe()");
  const price = ethers.parseEther("1");
  try {
    await c.subscribe.staticCall(price, 60, { value: price * 3n });
    console.log("   staticCall SUCCEEDED (so the revert is state/gas dependent, not logic)");
  } catch (e: any) {
    const d = e?.data ?? e?.info?.error?.data;
    console.log(`   raw error data: ${d ?? "(none returned)"}`);
    if (d && d !== "0x") {
      try {
        const parsed = c.interface.parseError(d);
        console.log(`   DECODED: ${parsed?.name}(${parsed?.args.map(String).join(", ")})`);
        if (parsed?.name === "ScheduleFailed") {
          console.log(
            `   -> Hedera response code ${parsed.args[0]} (22 = SUCCESS, 15 = INVALID_TRANSACTION, 3 = INVALID_..., etc.)`,
          );
        }
      } catch {
        console.log("   (could not decode against ABI)");
      }
    } else {
      console.log(`   message: ${String(e?.shortMessage ?? e?.message).slice(0, 300)}`);
    }
  }

  console.log("\n3) Does fund() alone work (isolates scheduleCall as the culprit)?");
  try {
    await c.fund.staticCall({ value: ethers.parseEther("1") });
    console.log("   fund() staticCall OK -> payment path fine; scheduleCall is the failure");
  } catch (e: any) {
    console.log(`   fund() also fails: ${String(e?.shortMessage ?? e?.message).slice(0, 200)}`);
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
