/**
 * The Retainer demo, end to end, as an agent experiences it.
 *
 *   1. request  -> 402. The agent signs a Hedera payment; Blocky402 settles it.
 *   2. subscribe on-chain so access renews itself.
 *   3. request  -> 200, and nothing was paid.
 *   4. wait past expiry, sending nothing at all.
 *   5. request  -> 200 again, because the contract renewed itself.
 *
 * Step 5 is the point. No human, no cron, no second payment.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 yarn tsx scripts/retainer-agent.ts
 */
import { PrivateKey } from "@hiero-ledger/sdk";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network } from "@x402/core/types";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RPC = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
const NETWORK = (process.env.X402_NETWORK ?? "hedera:testnet") as Network;
const PERIOD = Number(process.env.PERIOD_SECONDS ?? 60);

function cred(k: string): string {
  const m = readFileSync(join(homedir(), ".config/retainer/hedera.env"), "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`missing ${k} in ~/.config/retainer/hedera.env`);
  return m[1].trim();
}

const ABI = [
  "function subscribe(uint256 pricePerPeriod, uint32 periodSeconds) payable",
  "function subscriptionOf(address) view returns (uint256,uint256,uint256,uint32,bool,address)",
  "function cancel()",
];

async function ask(agent: string, label: string) {
  const res = await fetch(`${BASE}/api/retainer/access?agent=${agent}`);
  const body: any = await res.json().catch(() => ({}));
  console.log(
    `  ${label}: HTTP ${res.status}` + (res.status === 200 ? `  paidThisRequest=${body.paidThisRequest}` : ""),
  );
  if (res.status === 200 && body.subscription) {
    console.log(
      `     window ${body.subscription.secondsRemaining}s remaining · renewal scheduled at ${body.subscription.nextRenewalSchedule}`,
    );
  }
  return { res, body };
}

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const buyerKey = cred("BUYER_PRIVATE_KEY");
  const wallet = new Wallet(buyerKey, provider);
  const agent = wallet.address;
  const contractAddr = process.env.RETAINER_ACCESS_ADDRESS ?? cred("RETAINER_ACCESS_ADDRESS");

  console.log(`agent    ${agent}`);
  console.log(`contract ${contractAddr}\n`);

  // ── 1. cold: no subscription, so the resource costs money
  console.log("1) cold request — expect 402");
  const first = await fetch(`${BASE}/api/retainer/access?agent=${agent}`);
  console.log(`  HTTP ${first.status}`);
  if (first.status !== 402) {
    console.log("  (already has access — cancelling first so the demo starts cold)");
    const c = new Contract(contractAddr, ABI, wallet);
    await (await c.cancel({ gasLimit: 1_000_000 })).wait();
    console.log("  cancelled; re-run to see the cold path");
    return;
  }

  // ── 2. pay through Blocky402
  console.log("\n2) paying via x402 — settled by Blocky402");
  const privateKey = PrivateKey.fromStringECDSA(buyerKey);
  const signer = createClientHederaSigner(cred("BUYER_ACCOUNT_ID"), privateKey, { network: NETWORK });
  const client = new x402Client().register(NETWORK, new ExactHederaScheme(signer));
  const http = new x402HTTPClient(client);

  const challenge = await first
    .clone()
    .json()
    .catch(() => undefined);
  const required = http.getPaymentRequiredResponse(n => first.headers.get(n), challenge);
  const payload = await http.createPaymentPayload(required);
  const paid = await fetch(`${BASE}/api/retainer/access?agent=${agent}`, {
    headers: http.encodePaymentSignatureHeader(payload),
  });
  const result = await http.processResponse(paid);
  if (result.kind !== "success") throw new Error(`payment failed: ${result.kind}`);
  console.log(`  ✅ settled · tx ${result.settleResponse.transaction}`);
  console.log(`  https://hashscan.io/testnet/transaction/${result.settleResponse.transaction}`);

  // ── 3. open a self-renewing subscription
  console.log("\n3) opening a self-renewing subscription on-chain");
  const c = new Contract(contractAddr, ABI, wallet);
  const price = 100_000_000n; // 1 HBAR per period, tinybar
  const funding = 4n * 10n ** 18n; // 4 HBAR, weibar
  const tx = await c.subscribe(price, PERIOD, { value: funding, gasLimit: 2_000_000 });
  await tx.wait();
  console.log(`  subscribed · tx ${tx.hash}`);

  // ── 4. the same request, now free
  console.log("\n4) same request again");
  await ask(agent, "warm request");

  // ── 5. wait past expiry, sending nothing
  console.log(`\n5) waiting ${PERIOD + 45}s past expiry — sending NOTHING`);
  await new Promise(r => setTimeout(r, (PERIOD + 45) * 1000));
  const after = await ask(agent, "post-expiry request");

  console.log("\n─────────────────────────────────────────");
  if (after.res.status === 200 && after.body.paidThisRequest === false) {
    console.log("✅ Access survived expiry with no payment and no transaction from us.");
    console.log("   The contract renewed itself.");
  } else {
    console.log(`⚠️  expected a free 200 after expiry, got ${after.res.status}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
