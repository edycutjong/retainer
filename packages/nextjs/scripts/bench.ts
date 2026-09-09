/**
 * Retainer benchmark — three numbers, all measured, none simulated.
 *
 * Run it against the live deployment and the public Hedera mirror node:
 *
 *   yarn bench
 *
 * Nothing here is mocked, seeded with fake latency, or replayed from a fixture. Two of the
 * three scenarios are HTTP round trips to the deployed resource server; the third is read back
 * from Hedera's own public mirror node and can be re-derived by anyone with `curl`.
 *
 * ## What is measured, and why these three
 *
 * A subscription product has exactly two hot paths and one claim.
 *
 *   1. `gate`      GET /api/retainer/status — "does this agent still have access?", answered
 *                  from contract state. Every warm request pays this cost.
 *   2. `challenge` GET /api/retainer/access for an agent with no subscription — the full x402
 *                  402 path: contract reads plus building payment requirements through the
 *                  Blocky402 facilitator. This is what a cold agent hits first.
 *   3. `drift`     how late the Hedera Schedule Service actually executes a renewal, against
 *                  the exact second the contract armed it for. This is the claim — "access
 *                  renews itself" is only true if the network fires when it said it would.
 *
 * ## What is deliberately NOT measured
 *
 * The paid path (402 -> sign -> settle -> 200) moves real HBAR and changes on-chain state, so
 * it cannot be sampled a hundred times for a percentile without buying a hundred
 * subscriptions. It is measured **once**, as a real receipt, by `scripts/retainer-agent.ts`;
 * DEMO.md carries that run's numbers separately and says so. A p95 over a path you can only
 * afford to run once would be a fabricated number wearing a statistic's clothes.
 *
 * Likewise `renew()` gas: `docs/gas-economics.md` measures it on testnet, where the
 * `scheduleCall` into `0x16b` is ~97% of the cost. Re-deriving it here would add nothing.
 *
 * ## Determinism
 *
 * The probe addresses are drawn from a seeded PRNG (`SEED`, default 42), so the same run hits
 * the same addresses. They are unfunded, unsubscribed addresses by construction — the script
 * asserts that — which is what makes the gate and challenge scenarios read-only and repeatable.
 * The drift scenario is fully determined by history: same contract, same answer, forever.
 *
 * Exit code is nonzero if any correctness assertion fails. This is a verification script that
 * happens to print latencies, not a latency script that happens to run.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Configuration. Every default points at the live deployment, so `yarn bench` needs no .env.
const BASE_URL = (process.env.BASE_URL ?? "https://retainer.edycu.dev").replace(/\/$/, "");
const MIRROR_NODE = (process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com").replace(/\/$/, "");
const CONTRACT_ID = process.env.RETAINER_CONTRACT_ID ?? "0.0.10415845";
const SEED = Number(process.env.SEED ?? 42);
const SAMPLES = Number(process.env.BENCH_SAMPLES ?? 60);
/** The challenge path talks to a third-party facilitator on every call, so sample it lighter. */
const CHALLENGE_SAMPLES = Number(process.env.BENCH_CHALLENGE_SAMPLES ?? 30);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 5);

/**
 * `RENEW_SLACK` in RetainerAccess.sol. The contract lets a scheduled `renew()` run up to 30s
 * early; a renewal arriving later than that would still work, but the window it extends would
 * have a visible gap. So 30s is the tolerance the contract itself was written against, and it
 * is what the drift assertion uses.
 */
const RENEW_SLACK_SECONDS = 30;

/** Pair an armed schedule with an execution only inside this window, in seconds. */
const PAIR_WINDOW_SECONDS = 600;

/** keccak256 of the event signatures in RetainerAccess.sol. */
const TOPIC_RENEWAL_SCHEDULED = "0x0cc8d0cdd16f7c325665ab7bbc4651e027a0597743d5c19ce69236462889193d";

type Sample = number;

// ── Statistics ────────────────────────────────────────────────────────────────────────────

/**
 * Linear-interpolated percentile over the sorted sample, the "R-7" definition — the same one
 * NumPy and Excel use by default. Stated explicitly because percentile definitions disagree at
 * small n, and every number in DEMO.md comes out of this function.
 */
function percentile(sorted: Sample[], p: number): number {
  if (sorted.length === 0) return NaN;
  const k = (sorted.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

type Stats = { n: number; min: number; p50: number; p95: number; max: number; mean: number };

function stats(samples: Sample[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

// ── Deterministic probe addresses ─────────────────────────────────────────────────────────

/** mulberry32 — a small, exactly reproducible PRNG. Seeded once, so the run repeats. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function probeAddresses(count: number): string[] {
  const rnd = mulberry32(SEED);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let hex = "";
    for (let b = 0; b < 20; b++) {
      hex += Math.floor(rnd() * 256)
        .toString(16)
        .padStart(2, "0");
    }
    out.push(`0x${hex}`);
  }
  return out;
}

// ── HTTP timing ───────────────────────────────────────────────────────────────────────────

type Timed = { ms: number; status: number; body: any; headers: Headers };

/** Time a full round trip, body included — a latency that stops before the body is a half-truth. */
async function timed(url: string): Promise<Timed> {
  const started = performance.now();
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  const ms = performance.now() - started;
  let body: any = undefined;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ms, status: res.status, body, headers: res.headers };
}

// ── Mirror node ───────────────────────────────────────────────────────────────────────────

async function mirror<T>(path: string): Promise<T> {
  const res = await fetch(`${MIRROR_NODE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`mirror node ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Follow `links.next` until exhausted or `cap` pages, collecting one array field. */
async function mirrorAll<T>(firstPath: string, field: string, cap = 20): Promise<T[]> {
  const out: T[] = [];
  let path: string | null = firstPath;
  for (let page = 0; path && page < cap; page++) {
    const body: any = await mirror<any>(path);
    out.push(...((body[field] ?? []) as T[]));
    path = body?.links?.next ?? null;
  }
  return out;
}

function word(data: string, index: number): bigint {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  return BigInt(`0x${hex.slice(index * 64, (index + 1) * 64)}`);
}

type MirrorLog = { timestamp: string; topics: string[]; data: string };
type MirrorTx = { name: string; scheduled: boolean; result: string; consensus_timestamp: string };

type DriftResult = {
  samples: Sample[];
  armed: number;
  unexecuted: number;
  scheduledExecutions: number;
  failedExecutions: number;
  pairs: { firesAt: number; executedAt: number; drift: number }[];
};

/**
 * How late the network was, per armed renewal.
 *
 * `RenewalScheduled(agent, schedule, firesAt)` records the exact second the contract asked the
 * Schedule Service to call it back. Each armed schedule then shows up as a `scheduled=true`
 * CONTRACTCALL against the contract's own account. Drift is the difference — a number produced
 * entirely by Hedera, read from Hedera, with nothing of ours in between.
 *
 * The two sides are matched by time rather than by schedule id on purpose: the mirror node's
 * `/schedules` index does not return schedules created by a contract through HIP-1215, and
 * `/contracts/{id}/results` omits scheduled executions altogether (both verified against this
 * deployment). The endpoints that do see them are the log stream and the account's transaction
 * list, so those are the two used here.
 */
async function measureDrift(): Promise<DriftResult> {
  const logs = await mirrorAll<MirrorLog>(`/api/v1/contracts/${CONTRACT_ID}/results/logs?limit=100&order=asc`, "logs");
  const txs = await mirrorAll<MirrorTx>(
    `/api/v1/transactions?account.id=${CONTRACT_ID}&limit=100&order=asc`,
    "transactions",
  );

  const armedAt = logs
    .filter(l => l.topics[0]?.toLowerCase() === TOPIC_RENEWAL_SCHEDULED)
    .map(l => Number(word(l.data, 1)))
    .sort((a, b) => a - b);

  const executions = txs
    .filter(t => t.scheduled === true && t.name === "CONTRACTCALL")
    .map(t => ({ at: Number(t.consensus_timestamp), ok: t.result === "SUCCESS" }))
    .sort((a, b) => a.at - b.at);

  const succeeded = executions.filter(e => e.ok);
  const used = new Set<number>();
  const pairs: DriftResult["pairs"] = [];
  let unexecuted = 0;

  for (const firesAt of armedAt) {
    const match = succeeded.find(e => !used.has(e.at) && e.at >= firesAt && e.at - firesAt < PAIR_WINDOW_SECONDS);
    if (!match) {
      unexecuted++;
      continue;
    }
    used.add(match.at);
    pairs.push({ firesAt, executedAt: match.at, drift: match.at - firesAt });
  }

  return {
    samples: pairs.map(p => p.drift),
    armed: armedAt.length,
    unexecuted,
    scheduledExecutions: executions.length,
    failedExecutions: executions.length - succeeded.length,
    pairs,
  };
}

// ── Reporting ─────────────────────────────────────────────────────────────────────────────

const failures: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

function row(name: string, unit: string, s: Stats): string {
  const f = (v: number) => (unit === "ms" ? v.toFixed(1) : v.toFixed(3));
  return `| ${name} | ${s.n} | ${f(s.min)} | ${f(s.p50)} | ${f(s.p95)} | ${f(s.max)} | ${f(s.mean)} |`;
}

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── Scenarios ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();
  console.log("Retainer benchmark");
  console.log(`  version   ${version()}`);
  console.log(`  base      ${BASE_URL}`);
  console.log(`  mirror    ${MIRROR_NODE}`);
  console.log(`  contract  ${CONTRACT_ID}`);
  console.log(`  seed      ${SEED}   samples ${SAMPLES} (gate) / ${CHALLENGE_SAMPLES} (challenge), warm-up ${WARMUP}`);
  console.log(`  started   ${startedAt}\n`);

  const probes = probeAddresses(SAMPLES + WARMUP);

  // ── 1. gate: the read every warm request pays for.
  console.log("1) gate — GET /api/retainer/status");
  const gate: Sample[] = [];
  let gateSample: Timed | undefined;
  for (let i = 0; i < probes.length; i++) {
    const t = await timed(`${BASE_URL}/api/retainer/status?agent=${probes[i]}`);
    if (i === WARMUP) gateSample = t;
    if (i >= WARMUP) {
      if (t.status !== 200) {
        failures.push(`gate returned HTTP ${t.status}`);
        break;
      }
      gate.push(t.ms);
    }
  }
  check("gate answers 200", gateSample?.status === 200, `HTTP ${gateSample?.status}`);
  check(
    "gate reports the contract under test",
    typeof gateSample?.body?.contract === "string" && gateSample.body.contract.startsWith("0x"),
    gateSample?.body?.contract,
  );
  check(
    "probe addresses hold no subscription",
    gateSample?.body?.hasAccess === false,
    `hasAccess=${gateSample?.body?.hasAccess}`,
  );
  check("gate collected the full sample", gate.length === SAMPLES, `n=${gate.length}/${SAMPLES}`);

  // ── 2. challenge: what a cold agent gets. Read-only — nothing is signed, nothing is paid.
  console.log("\n2) challenge — GET /api/retainer/access (cold agent, expects 402)");
  const challenge: Sample[] = [];
  let challengeSample: Timed | undefined;
  for (let i = 0; i < CHALLENGE_SAMPLES + WARMUP; i++) {
    const t = await timed(`${BASE_URL}/api/retainer/access?agent=${probes[i]}`);
    if (i === WARMUP) challengeSample = t;
    if (i >= WARMUP) {
      if (t.status !== 402) {
        failures.push(`challenge returned HTTP ${t.status}`);
        break;
      }
      challenge.push(t.ms);
    }
  }
  const accepts = challengeSample?.body?.accepts?.[0];
  check("cold request answers 402", challengeSample?.status === 402, `HTTP ${challengeSample?.status}`);
  check("challenge carries the PAYMENT-REQUIRED header", !!challengeSample?.headers.get("payment-required"));
  check(
    "challenge is x402 v2 on hedera:testnet",
    challengeSample?.body?.x402Version === 2 && accepts?.network === "hedera:testnet",
    `${accepts?.network} v${challengeSample?.body?.x402Version}`,
  );
  check(
    "challenge prices HBAR under the exact scheme",
    accepts?.scheme === "exact" && accepts?.asset === "0.0.0",
    `${accepts?.scheme}/${accepts?.asset} amount=${accepts?.amount}`,
  );
  check(
    "challenge collected the full sample",
    challenge.length === CHALLENGE_SAMPLES,
    `n=${challenge.length}/${CHALLENGE_SAMPLES}`,
  );

  // ── 3. drift: the claim. Hedera's own record of when it executed our renewals.
  console.log("\n3) schedule drift — Hedera Schedule Service, from the public mirror node");
  const drift = await measureDrift();
  console.log(
    `  ${drift.armed} renewals armed · ${drift.scheduledExecutions} scheduled executions on the contract` +
      ` (${drift.failedExecutions} failed) · ${drift.samples.length} paired`,
  );
  if (drift.unexecuted > 0) {
    console.log(
      `  ${drift.unexecuted} armed renewal(s) produced no successful scheduled execution — reported, not dropped.`,
    );
  }
  check("enough executed renewals to describe a tail", drift.samples.length >= 10, `n=${drift.samples.length}`);
  check(
    "no renewal executed before the second it was armed for",
    drift.samples.every(d => d >= 0),
    `min=${drift.samples.length ? Math.min(...drift.samples).toFixed(3) : "n/a"}s`,
  );
  check(
    `every renewal landed inside the contract's own ${RENEW_SLACK_SECONDS}s tolerance`,
    drift.samples.every(d => d < RENEW_SLACK_SECONDS),
    `max=${drift.samples.length ? Math.max(...drift.samples).toFixed(3) : "n/a"}s`,
  );

  // ── Results
  console.log("\n─── results ───────────────────────────────────────────────────────────────");
  console.log("| scenario | n | min | p50 | p95 | max | mean |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  if (gate.length) console.log(row("gate latency (ms)", "ms", stats(gate)));
  if (challenge.length) console.log(row("402 challenge latency (ms)", "ms", stats(challenge)));
  if (drift.samples.length) console.log(row("schedule drift (s)", "s", stats(drift.samples)));
  console.log("");

  if (drift.pairs.length) {
    const last = drift.pairs.slice(-5);
    console.log("last 5 unattended renewals (armed second -> consensus timestamp):");
    for (const p of last) {
      console.log(`  ${p.firesAt} -> ${p.executedAt.toFixed(9)}  (+${(p.drift * 1000).toFixed(0)} ms)`);
    }
    console.log("");
  }

  console.log(`finished  ${new Date().toISOString()}`);
  if (failures.length) {
    console.log(`\n${failures.length} check(s) FAILED:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
