/**
 * Create the Hedera Consensus Service topic the payment audit trail is written to.
 *
 * Run once. It prints a topic id; put that in `HCS_AUDIT_TOPIC_ID` and the resource server
 * starts publishing settlement events to it. Re-running creates a *second* topic, which is
 * why it refuses when one is already configured unless you ask twice.
 *
 * The topic is created with a submit key and deliberately **without an admin key**:
 *
 *   submit key  — the seller's account. Only it can append, so a message on this topic is
 *                 provably the seller's own record and not something a passer-by wrote.
 *   admin key   — absent. The topic can never be updated or deleted, by us or by anyone. An
 *                 append-only log its author can erase would not be worth reading.
 *
 * Usage:
 *   yarn tsx scripts/hcs-create-topic.ts            # credentials from ~/.config/retainer/hedera.env
 *   yarn tsx scripts/hcs-create-topic.ts --force    # create another even if one is configured
 */
import { auditNetwork, auditTopicId, parseOperatorKey } from "../services/audit/hcs";
import { AccountId, Client, PrivateKey, TopicCreateTransaction } from "@hiero-ledger/sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Hedera caps a topic memo at 100 bytes. Say what the topic is and where to check it. */
const MEMO = "Retainer x402 payment audit trail | retainer.edycu.dev";

function cred(key: string): string | undefined {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const file = readFileSync(join(homedir(), ".config/retainer/hedera.env"), "utf8");
    return file.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1].trim() || undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const existing = auditTopicId();
  if (existing && !force) {
    console.error(`HCS_AUDIT_TOPIC_ID is already ${existing}. Pass --force to create another topic anyway.`);
    process.exitCode = 1;
    return;
  }

  const accountId = cred("HCS_AUDIT_OPERATOR_ID") ?? cred("SELLER_ACCOUNT_ID");
  const rawKey = cred("HCS_AUDIT_OPERATOR_KEY") ?? cred("SELLER_PRIVATE_KEY");
  if (!accountId || !rawKey) {
    console.error("Need SELLER_ACCOUNT_ID and SELLER_PRIVATE_KEY (or HCS_AUDIT_OPERATOR_*) to create the topic.");
    process.exitCode = 1;
    return;
  }

  const network = auditNetwork();
  const key: PrivateKey = parseOperatorKey(rawKey);
  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(AccountId.fromString(accountId), key);

  console.log(`network   ${network}`);
  console.log(`operator  ${accountId}`);
  console.log(`memo      ${MEMO} (${Buffer.byteLength(MEMO, "utf8")} bytes)`);

  try {
    const tx = await new TopicCreateTransaction()
      .setTopicMemo(MEMO)
      // Only this account may append. No admin key is set, on purpose: the topic is immutable.
      .setSubmitKey(key.publicKey)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId?.toString();
    if (!topicId) throw new Error("receipt carried no topic id");

    const mirror =
      network === "mainnet" ? "https://mainnet.mirrornode.hedera.com" : "https://testnet.mirrornode.hedera.com";
    console.log(`\ntopic     ${topicId}`);
    console.log(`tx        ${tx.transactionId?.toString()}`);
    console.log(`hashscan  https://hashscan.io/${network}/topic/${topicId}`);
    console.log(`mirror    ${mirror}/api/v1/topics/${topicId}/messages`);
    console.log(`\nSet HCS_AUDIT_TOPIC_ID=${topicId} in packages/nextjs/.env (and in the deployment).`);
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
