/**
 * Check Retainer's HCS payment audit trail against the chain it describes.
 *
 * The trail is only worth something if a stranger can falsify it, so this script takes no
 * credentials, reads no local state, and never talks to Retainer's own server. It asks the
 * public Hedera mirror node two kinds of question:
 *
 *   1. what does the topic say?          GET /api/v1/topics/{id}/messages
 *   2. is each thing it says true?       GET /api/v1/transactions/{settlement}
 *                                        GET /api/v1/contracts/results/{subscriptionTx}
 *
 * Every record names a settlement transaction and, for an opened subscription, the
 * `subscribeFor` call that settlement paid for. Both are looked up. A record whose transaction
 * does not exist, did not succeed, or did not go to the contract the record names, fails — and
 * the script exits non-zero, so a stale or invented trail cannot pass quietly.
 *
 * Usage:
 *   yarn tsx scripts/verify-audit-trail.ts                 # the published topic
 *   yarn tsx scripts/verify-audit-trail.ts 0.0.10440194    # any topic
 */

/** The live audit topic. Immutable (no admin key); only the seller's account can append. */
const DEFAULT_TOPIC = "0.0.10440194";

const TOPIC = process.argv[2] ?? process.env.HCS_AUDIT_TOPIC_ID ?? DEFAULT_TOPIC;
const MIRROR = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

type TopicMessage = { consensus_timestamp: string; sequence_number: number; message: string };

/** Hedera writes transaction ids as `0.0.x@s.n` and reads them back as `0.0.x-s-n`. */
function toMirrorTxId(id: string): string {
  return id.replace("@", "-").replace(/\.(\d+)$/, "-$1");
}

async function getJson(path: string): Promise<any | null> {
  const res = await fetch(`${MIRROR}${path}`);
  if (!res.ok) return null;
  return await res.json();
}

async function fetchMessages(): Promise<TopicMessage[]> {
  const all: TopicMessage[] = [];
  let path: string | null = `/api/v1/topics/${TOPIC}/messages?order=asc&limit=100`;
  while (path) {
    const page: any = await getJson(path);
    if (!page) throw new Error(`mirror node has no topic ${TOPIC} (or refused ${path})`);
    all.push(...(page.messages ?? []));
    path = page.links?.next ?? null;
  }
  return all;
}

/** Was this Hedera transaction consensus-accepted? */
async function transactionOk(id: string): Promise<{ ok: boolean; detail: string }> {
  const body = await getJson(`/api/v1/transactions/${toMirrorTxId(id)}`);
  const tx = body?.transactions?.[0];
  if (!tx) return { ok: false, detail: "not found on the mirror node" };
  return { ok: tx.result === "SUCCESS", detail: `${tx.name} ${tx.result} @ ${tx.consensus_timestamp}` };
}

/** Did this EVM transaction succeed, and did it go to the contract the record claims? */
async function contractCallOk(hash: string, expectedTo: string): Promise<{ ok: boolean; detail: string }> {
  const r = await getJson(`/api/v1/contracts/results/${hash}`);
  if (!r) return { ok: false, detail: "not found on the mirror node" };
  const to = String(r.to ?? "").toLowerCase();
  const wanted = expectedTo.toLowerCase();
  if (to !== wanted) return { ok: false, detail: `went to ${r.to}, record says ${expectedTo}` };
  const ok = r.result === "SUCCESS";
  return { ok, detail: `${r.result} @ ${r.timestamp} to ${r.to}` };
}

/**
 * Report what the topic itself is before reading a word of what it says.
 *
 * `admin_key: null` is the load-bearing part: without one the topic can never be updated or
 * deleted, by its author or anyone else. A submit key names the only account allowed to append.
 * A trail on a mutable topic would be a log, not evidence — so this prints both, rather than
 * asking a reader to take the README's word for it.
 */
async function describeTopic(): Promise<void> {
  const info = await getJson(`/api/v1/topics/${TOPIC}`);
  if (!info) throw new Error(`mirror node has no topic ${TOPIC}`);
  console.log(`memo    ${info.memo}`);
  console.log(`admin   ${info.admin_key ? "PRESENT — this topic can be changed or deleted" : "none — immutable"}`);
  console.log(`submit  ${info.submit_key ? `${info.submit_key._type} — append is restricted` : "open to anyone"}`);
  console.log(`created ${info.created_timestamp}\n`);
}

async function main() {
  console.log(`topic   ${TOPIC}`);
  console.log(`mirror  ${MIRROR}`);
  await describeTopic();

  const messages = await fetchMessages();
  if (messages.length === 0) {
    console.log("no messages on this topic yet");
    return;
  }

  // Decode everything before checking anything.
  //
  // The two records a paid request produces are submitted independently — see the note in
  // README.md — so consensus can order `subscription.opened` ahead of the `payment.settled` it
  // belongs to, and a single forward pass would report a perfectly good trail as broken. The
  // join is the settlement id, not the sequence number.
  const decoded: { m: TopicMessage; record: any }[] = [];
  let failures = 0;

  for (const m of messages) {
    try {
      decoded.push({ m, record: JSON.parse(Buffer.from(m.message, "base64").toString("utf8")) });
    } catch {
      failures++;
      console.log(`#${m.sequence_number}  FAIL  message is not JSON`);
    }
  }

  const settlementsRecorded = new Set(
    decoded.filter(d => d.record.event === "payment.settled").map(d => d.record.settlement),
  );

  for (const { m, record } of decoded) {
    const head = `#${m.sequence_number}  ${record.event}  agent ${record.agent}  ${record.amountTinybar} tinybar`;
    const checks: string[] = [];

    const settlement = await transactionOk(record.settlement);
    if (!settlement.ok) failures++;
    checks.push(`settlement ${record.settlement} — ${settlement.ok ? "OK" : "FAIL"}: ${settlement.detail}`);

    if (record.event !== "payment.settled") {
      // The join: an outcome record must belong to a payment this topic also recorded.
      const linked = settlementsRecorded.has(record.settlement);
      if (!linked) failures++;
      checks.push(`links to a recorded payment — ${linked ? "OK" : "FAIL"}`);
    }

    if (record.event === "subscription.opened") {
      const call = await contractCallOk(record.subscriptionTx, record.contract);
      if (!call.ok) failures++;
      checks.push(`subscribeFor ${record.subscriptionTx} — ${call.ok ? "OK" : "FAIL"}: ${call.detail}`);
    }

    console.log(`${head}\n  consensus ${m.consensus_timestamp}`);
    for (const c of checks) console.log(`  ${c}`);
    console.log();
  }

  console.log(
    `${messages.length} message(s), ${settlementsRecorded.size} settled payment(s), ${failures} failed check(s)`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
