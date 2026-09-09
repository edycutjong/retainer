/**
 * The audit trail: every payment event, written to a Hedera Consensus Service topic.
 *
 * The product's two rails already leave marks on the chain — an x402 settlement is a
 * `CRYPTOTRANSFER`, opening a subscription is a `CONTRACTCALL` — but nothing ties the two
 * together. A judge, or a buyer's accountant, reading the chain sees a transfer to the seller
 * and, separately, a contract call, and has to take our word for it that the second happened
 * *because of* the first.
 *
 * So the resource server publishes the join. One HCS message per payment event, carrying the
 * settlement id, the agent, the amount and the resulting subscription transaction. The topic is
 * public and the messages are ordered and timestamped by Hedera consensus, not by us: anyone can
 * read them back from the mirror node, follow each identifier to the transaction it names, and
 * check that the trail matches the chain. `scripts/verify-audit-trail.ts` does exactly that, with
 * no credentials.
 *
 * Three properties are deliberate:
 *
 * - **The topic has a submit key and no admin key.** Only the seller's account can append to it,
 *   and *nobody* — including the seller — can update or delete it. An audit trail that its author
 *   can rewrite is not an audit trail.
 * - **One record per message, never chunked.** A record that fits in a single consensus message
 *   means one message id is one event; a chunked record would make "the trail" depend on
 *   reassembly. Records are built to stay inside {@link MAX_MESSAGE_BYTES} and the long,
 *   attacker-influenced field (an error string) is truncated rather than allowed to split.
 * - **Nothing here can fail a request.** Every function in this file resolves; none rejects. The
 *   caller runs it after the response has been sent. See {@link submitAuditEvent}.
 *
 * Enabled by configuration: with `HCS_AUDIT_TOPIC_ID` unset the writer is off and every call is
 * an immediate no-op. The payment path behaves identically either way — that is the point.
 */
import { AccountId, Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";

/** Schema version of an audit record. Bump when a field changes meaning, not when one is added. */
export const AUDIT_SCHEMA_VERSION = 1 as const;

/**
 * A single HCS message is 1024 bytes before the SDK starts chunking it. Records are kept under
 * this so one consensus message is always exactly one event.
 */
export const MAX_MESSAGE_BYTES = 1024;

/** How long a submission may take before it is abandoned. It runs after the response, so this
 * bounds a background task, never a request. */
const SUBMIT_TIMEOUT_MS = 15_000;

export type AuditEventName = "payment.settled" | "subscription.opened" | "subscription.failed";

type AuditBase = {
  v: typeof AUDIT_SCHEMA_VERSION;
  event: AuditEventName;
  /** x402 network id, e.g. `hedera:testnet`. */
  network: string;
  /** Path of the resource that was paid for. */
  resource: string;
  /** The agent the access was bought for, as an EVM address. */
  agent: string;
  /** Hedera transaction id of the x402 settlement. The join key: it appears on every record
   * belonging to the same payment, and names a transaction on the public mirror node. */
  settlement: string;
  /** Amount settled, in tinybar, as a decimal string (JSON has no integers this size). */
  amountTinybar: string;
  /** Server clock when the event was observed. Advisory only — the authority on ordering and
   * time is the consensus timestamp the network assigns to the message itself. */
  at: number;
};

export type PaymentSettledRecord = AuditBase & {
  event: "payment.settled";
  asset: "HBAR";
  /** Host of the x402 facilitator that settled it. */
  facilitator: string;
  /** Account that paid, as reported by the facilitator. */
  payer?: string;
};

export type SubscriptionOpenedRecord = AuditBase & {
  event: "subscription.opened";
  /** `RetainerAccess` the settled payment was forwarded into. */
  contract: string;
  /** EVM transaction hash of the `subscribeFor` call. Resolvable on the mirror node. */
  subscriptionTx: string;
  periods: number;
};

export type SubscriptionFailedRecord = AuditBase & {
  event: "subscription.failed";
  contract: string;
  /** Why the forward failed. Truncated to keep the record inside one consensus message. */
  error: string;
};

export type AuditRecord = PaymentSettledRecord | SubscriptionOpenedRecord | SubscriptionFailedRecord;

/** The configured topic, or undefined when the audit trail is switched off. */
export function auditTopicId(): string | undefined {
  const raw = process.env.HCS_AUDIT_TOPIC_ID?.trim();
  return raw ? raw : undefined;
}

/**
 * Credentials the writer submits with.
 *
 * Defaults to the seller's own account — the one that already receives the x402 payment and
 * forwards it on-chain — so enabling the trail on a running deployment is one variable,
 * `HCS_AUDIT_TOPIC_ID`, and not a second key to manage. Overridable when the trail should be
 * written by a different account than the one holding the money.
 */
function operator(): { accountId: string; key: string } | undefined {
  const accountId = (process.env.HCS_AUDIT_OPERATOR_ID ?? process.env.RETAINER_PAY_TO)?.trim();
  const key = (process.env.HCS_AUDIT_OPERATOR_KEY ?? process.env.RETAINER_SERVER_KEY)?.trim();
  if (!accountId || !key) return undefined;
  return { accountId, key };
}

/** Is the audit trail configured well enough to write? */
export function auditEnabled(): boolean {
  return Boolean(auditTopicId() && operator());
}

/**
 * Parse a Hedera private key without knowing which curve it is.
 *
 * The seller key is ECDSA — x402 on Hedera requires it — but the operator override may not be,
 * and guessing wrong throws inside the SDK with a message that names neither variable.
 */
export function parseOperatorKey(raw: string): PrivateKey {
  try {
    return PrivateKey.fromStringECDSA(raw);
  } catch {
    return PrivateKey.fromStringED25519(raw);
  }
}

/** Testnet unless the x402 network says otherwise. Mainnet is opt-in, never inferred. */
export function auditNetwork(): "mainnet" | "testnet" {
  return (process.env.X402_NETWORK ?? "hedera:testnet").includes("mainnet") ? "mainnet" : "testnet";
}

/**
 * Serialise a record for the wire. Plain JSON, so a reader needs nothing but `base64 -d`.
 *
 * An over-long record is not silently chunked: {@link submitAuditEvent} refuses it, because a
 * split record breaks the one-message-one-event property the trail is verified on.
 */
export function encodeAuditMessage(record: AuditRecord): string {
  return JSON.stringify(record);
}

/** Bytes the record will occupy in a consensus message. */
export function auditMessageBytes(record: AuditRecord): number {
  return Buffer.byteLength(encodeAuditMessage(record), "utf8");
}

/**
 * Shorten a failure reason until the whole record fits in one consensus message.
 *
 * The error text comes from an RPC provider or a revert, so its length is not ours to control;
 * everything else on the record is bounded. Trimming the one unbounded field keeps the record
 * atomic instead of letting it chunk.
 */
export function fitFailureRecord(record: SubscriptionFailedRecord): SubscriptionFailedRecord {
  let fitted = record;
  while (auditMessageBytes(fitted) > MAX_MESSAGE_BYTES && fitted.error.length > 1) {
    const overflow = Math.max(1, auditMessageBytes(fitted) - MAX_MESSAGE_BYTES);
    fitted = { ...fitted, error: fitted.error.slice(0, Math.max(1, fitted.error.length - overflow)) };
  }
  return fitted;
}

export type SubmitOutcome =
  { ok: true; topicId: string; sequenceNumber: string; transactionId: string } | { ok: false; reason: string };

/**
 * Publish one audit record to the topic.
 *
 * **This function never rejects.** It is called from `after()` once the HTTP response is already
 * on the wire, but "never rejects" is not about that: it is the guarantee that makes the trail
 * safe to add to a payment path at all. An HCS outage, a wrong topic id, an unfunded operator —
 * every one of them ends here as a logged `{ ok: false }` and changes nothing a caller sees. The
 * agent's money and its access do not depend on the seller's bookkeeping succeeding.
 */
export async function submitAuditEvent(record: AuditRecord): Promise<SubmitOutcome> {
  const topicId = auditTopicId();
  const op = operator();
  if (!topicId || !op) return { ok: false, reason: "audit trail is not configured" };

  const message = encodeAuditMessage(record);
  const bytes = Buffer.byteLength(message, "utf8");
  if (bytes > MAX_MESSAGE_BYTES) {
    return { ok: false, reason: `record is ${bytes} bytes, over the ${MAX_MESSAGE_BYTES}-byte single-message limit` };
  }

  let client: Client | undefined;
  try {
    client = auditNetwork() === "mainnet" ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(AccountId.fromString(op.accountId), parseOperatorKey(op.key));
    client.setRequestTimeout(SUBMIT_TIMEOUT_MS);

    const submitted = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .execute(client);
    const receipt = await submitted.getReceipt(client);

    return {
      ok: true,
      topicId,
      sequenceNumber: receipt.topicSequenceNumber?.toString() ?? "unknown",
      transactionId: submitted.transactionId?.toString() ?? "unknown",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[audit/hcs] could not publish ${record.event} for ${record.settlement}: ${reason}`);
    return { ok: false, reason };
  } finally {
    // Always close: each submission opens its own gRPC channels, and a serverless invocation that
    // leaves them open is a handle leak that outlives the request it belonged to.
    try {
      client?.close();
    } catch {
      /* closing a client that never connected is not an error worth reporting */
    }
  }
}
