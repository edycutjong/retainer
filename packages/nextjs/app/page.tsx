"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";

/**
 * The live view.
 *
 * Retainer's claim is about something that happens when nobody is watching, which is a hard
 * thing to put on a screen. So this page watches it for you, and the countdown is deliberately
 * the largest object on it: the moment it reaches zero and springs back to a full window —
 * with no payment, no signature and no cron — is the entire product, and it has to be legible
 * at a glance and on video.
 *
 * Everything here is read from chain state via /api/retainer/status. Nothing is simulated.
 */

type Usage = { used: number; allowance: number; remaining: number };

type Status = {
  agent: string;
  contract: string;
  hasAccess: boolean;
  expiresAt: number;
  secondsRemaining: number;
  periodSeconds: number;
  pricePerPeriodTinybar: string;
  balanceTinybar: string;
  periodsFunded: number;
  active: boolean;
  nextRenewalSchedule: string;
  renewalsReserveCanArm: number;
  usage: Usage;
  now: number;
};

type LogEntry = { id: number; at: number; kind: "renewed" | "metered"; detail: string };

const ZERO = "0x0000000000000000000000000000000000000000";
const HASHSCAN = "https://hashscan.io/testnet";
const DEMO_AGENT = "0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66";
const POLL_MS = 4000;

const hbar = (tinybar: string) => (Number(tinybar) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 });
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const Home: NextPage = () => {
  const { address: connected } = useAccount();
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [flash, setFlash] = useState(false);
  // Ticks locally so the number moves every second without polling every second.
  const [remaining, setRemaining] = useState(0);
  const lastExpiry = useRef<number | null>(null);
  const lastUsed = useRef<number | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (connected && !agent) setAgent(connected);
  }, [connected, agent]);

  const poll = useCallback(async (who: string) => {
    try {
      const res = await fetch(`/api/retainer/status?agent=${who}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) return setError(body.error ?? "Failed to read the contract");
      setError(null);
      setStatus(body as Status);
      setRemaining(body.secondsRemaining);

      // A window that moved forward is a renewal that fired. This is the moment the product
      // exists for, so it is recorded and announced rather than merely redrawn.
      if (lastExpiry.current !== null && body.expiresAt > lastExpiry.current) {
        seq.current += 1;
        setLog(prev =>
          [
            {
              id: seq.current,
              at: body.now,
              kind: "renewed" as const,
              detail: "the Schedule Service called renew() — no user, no server, no cron",
            },
            ...prev,
          ].slice(0, 6),
        );
        setFlash(true);
        setTimeout(() => setFlash(false), 2200);
      }
      if (lastUsed.current !== null && body.usage.used > lastUsed.current) {
        seq.current += 1;
        setLog(prev =>
          [
            {
              id: seq.current,
              at: body.now,
              kind: "metered" as const,
              detail: `call metered on-chain · ${body.usage.remaining} of ${body.usage.allowance} left this period`,
            },
            ...prev,
          ].slice(0, 6),
        );
      }
      lastExpiry.current = body.expiresAt;
      lastUsed.current = body.usage.used;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const valid = /^0x[0-9a-fA-F]{40}$/.test(agent);

  useEffect(() => {
    if (!valid) return;
    void poll(agent);
    const id = setInterval(() => void poll(agent), POLL_MS);
    return () => clearInterval(id);
  }, [agent, valid, poll]);

  useEffect(() => {
    const id = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const period = status?.periodSeconds ?? 1;
  const frac = Math.max(0, Math.min(1, remaining / period));
  const R = 92;
  const CIRC = 2 * Math.PI * R;
  const soon = remaining <= 15 && remaining > 0;

  return (
    <div className="grow w-full bg-base-200">
      {/* ── Masthead */}
      <header className="border-b border-base-300 bg-base-100">
        <div className="max-w-5xl mx-auto px-5 py-10 sm:py-14">
          <div className="flex items-center gap-2 mb-4">
            <span className="badge badge-sm badge-primary badge-outline font-mono">x402</span>
            <span className="badge badge-sm badge-outline font-mono">Hedera testnet</span>
            <span className="badge badge-sm badge-outline font-mono">HIP-1215</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-3">Retainer</h1>
          <p className="text-xl sm:text-2xl mb-4 text-base-content/80">
            Your agent&apos;s access renews itself on-chain at 3am, with nobody awake.
          </p>
          <p className="max-w-2xl text-base-content/60 leading-relaxed">
            An agent can pay for a thing. An agent cannot <em>subscribe</em> to a thing — every renewal needs somebody
            awake to re-authorise it. Retainer removes that person.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-8 sm:py-12">
        {/* ── Address input */}
        <div className="flex flex-col sm:flex-row gap-2 mb-8">
          <input
            id="agent"
            className="input input-bordered w-full font-mono text-sm"
            placeholder="0x… agent address"
            value={agent}
            onChange={e => setAgent(e.target.value.trim())}
            spellCheck={false}
          />
          <button className="btn btn-outline whitespace-nowrap" onClick={() => setAgent(DEMO_AGENT)} type="button">
            Use the demo agent
          </button>
        </div>

        {error && (
          <div role="alert" className="alert alert-warning mb-8">
            <span className="text-sm">{error}</span>
          </div>
        )}

        {!status && !error && <EmptyState onUseDemo={() => setAgent(DEMO_AGENT)} waiting={valid} />}

        {status && (
          <>
            {/* ── The countdown. Deliberately the biggest thing on the page. */}
            <section
              className={`card bg-base-100 shadow-sm border transition-colors duration-500 ${
                flash ? "border-success ring-2 ring-success/40" : "border-base-300"
              }`}
            >
              <div className="card-body items-center text-center gap-1 py-10">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`badge ${status.hasAccess ? "badge-success" : "badge-error"} badge-lg`}>
                    {status.hasAccess ? "access open" : "access closed"}
                  </span>
                  {status.nextRenewalSchedule !== ZERO && (
                    <span className="badge badge-outline badge-lg font-mono">renewal armed</span>
                  )}
                </div>

                <div className="relative w-56 h-56 my-2">
                  <svg viewBox="0 0 220 220" className="w-full h-full -rotate-90" aria-hidden="true">
                    <circle cx="110" cy="110" r={R} className="stroke-base-300" strokeWidth="12" fill="none" />
                    <circle
                      cx="110"
                      cy="110"
                      r={R}
                      className={soon ? "stroke-warning" : "stroke-primary"}
                      strokeWidth="12"
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray={CIRC}
                      strokeDashoffset={CIRC * (1 - frac)}
                      style={{ transition: "stroke-dashoffset 1s linear" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`font-mono text-5xl tabular-nums ${soon ? "text-warning" : ""}`}>
                      {clock(remaining)}
                    </span>
                    <span className="text-xs uppercase tracking-widest text-base-content/50 mt-1">
                      until this window closes
                    </span>
                  </div>
                </div>

                <p className="text-sm text-base-content/60 max-w-md">
                  {flash
                    ? "It renewed itself. Nothing was paid, nothing was signed."
                    : soon
                      ? "About to expire — and about to keep working anyway."
                      : "Leave this open past zero. The window will extend itself."}
                </p>
              </div>
            </section>

            {/* ── Metering */}
            <section className="card bg-base-100 shadow-sm border border-base-300 mt-6">
              <div className="card-body">
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <h2 className="card-title text-base">Calls this period</h2>
                  <span className="font-mono text-sm text-base-content/60">
                    {status.usage.remaining} of {status.usage.allowance} left
                  </span>
                </div>
                <div className="flex gap-1.5 mt-2" role="img" aria-label={`${status.usage.remaining} calls remaining`}>
                  {Array.from({ length: status.usage.allowance }, (_, i) => (
                    <span
                      key={i}
                      className={`h-2.5 flex-1 rounded-full transition-colors duration-500 ${
                        i < status.usage.remaining ? "bg-primary" : "bg-base-300"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-sm text-base-content/60 mt-3">
                  The period buys a countable quantity, not an unlimited licence — every served call is counted
                  on-chain. The renewal that extends the window also refills this.
                </p>
              </div>
            </section>

            {/* ── Numbers */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
              <Stat label="balance" value={`${hbar(status.balanceTinybar)} ℏ`} />
              <Stat label="periods funded" value={String(status.periodsFunded)} />
              <Stat label="price / period" value={`${hbar(status.pricePerPeriodTinybar)} ℏ`} />
              <Stat label="reserve can arm" value={String(status.renewalsReserveCanArm)} />
            </section>

            {/* ── Proof */}
            <section className="card bg-base-100 shadow-sm border border-base-300 mt-6">
              <div className="card-body gap-2">
                <h2 className="card-title text-base">On-chain</h2>
                <ProofLink label="contract" href={`${HASHSCAN}/contract/${status.contract}`} value={status.contract} />
                {status.nextRenewalSchedule !== ZERO && (
                  <ProofLink
                    label="pending schedule"
                    href={`${HASHSCAN}/account/${status.nextRenewalSchedule}`}
                    value={status.nextRenewalSchedule}
                  />
                )}
                <ProofLink label="agent" href={`${HASHSCAN}/account/${status.agent}`} value={status.agent} />
              </div>
            </section>

            {/* ── Log */}
            <section className="mt-6">
              <h2 className="font-semibold mb-3">Seen while this page was open</h2>
              {log.length === 0 ? (
                <p className="text-sm text-base-content/50">
                  Nothing yet. Renewals and metered calls appear here as they happen.
                </p>
              ) : (
                <ul className="space-y-2">
                  {log.map(e => (
                    <li
                      key={e.id}
                      className={`card bg-base-100 border-l-4 shadow-sm ${
                        e.kind === "renewed" ? "border-l-success" : "border-l-primary"
                      } border border-base-300`}
                    >
                      <div className="card-body py-3 gap-0.5">
                        <span className="font-mono text-xs text-base-content/50">
                          {new Date(e.at * 1000).toLocaleTimeString()}
                        </span>
                        <span className="text-sm">{e.detail}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
};

const EmptyState = ({ onUseDemo, waiting }: { onUseDemo: () => void; waiting: boolean }) => (
  <div className="card bg-base-100 border border-base-300 shadow-sm">
    <div className="card-body">
      <h2 className="card-title">{waiting ? "Reading the chain…" : "What you are about to watch"}</h2>
      <ol className="mt-2 space-y-3">
        {[
          ["402", "A cold agent asks for the feed and is charged — an x402 challenge on Hedera testnet."],
          ["pay", "It signs one payment, settled through the Blocky402 facilitator. The only thing it ever signs."],
          ["200", "The server forwards that payment on-chain, opening a subscription and arming a renewal."],
          ["still 200", "The window expires — and the request is still free, because the network renewed it."],
        ].map(([tag, text]) => (
          <li key={tag} className="flex gap-3 items-start">
            <span className="badge badge-outline font-mono shrink-0 mt-0.5">{tag}</span>
            <span className="text-sm text-base-content/70">{text}</span>
          </li>
        ))}
      </ol>
      {!waiting && (
        <button className="btn btn-primary mt-5 self-start" onClick={onUseDemo} type="button">
          Watch the demo agent
        </button>
      )}
    </div>
  </div>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="card bg-base-100 border border-base-300 shadow-sm">
    <div className="card-body items-center text-center py-5 gap-1">
      <span className="font-mono text-2xl tabular-nums">{value}</span>
      <span className="text-xs uppercase tracking-wide text-base-content/50">{label}</span>
    </div>
  </div>
);

const ProofLink = ({ label, href, value }: { label: string; href: string; value: string }) => (
  <div className="flex gap-3 items-center flex-wrap text-sm">
    <span className="text-base-content/50 w-32 shrink-0">{label}</span>
    <a className="link link-primary font-mono" href={href} target="_blank" rel="noreferrer">
      <span className="sm:hidden">{short(value)}</span>
      <span className="hidden sm:inline">{value}</span>
    </a>
  </div>
);

export default Home;
