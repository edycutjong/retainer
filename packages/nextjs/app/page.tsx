"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";

/**
 * The live view.
 *
 * Retainer's whole claim is about something that happens when nobody is watching, which is a
 * hard thing to put on a screen. So this page watches it for you: the access window counts
 * down in real time, and when it reaches zero it does not go dark — it jumps back to a full
 * period, because the Hedera Schedule Service called `renew()` on the contract with no user,
 * no server and no cron job involved.
 *
 * Everything here is read from chain state via /api/retainer/status. Nothing is simulated.
 */

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
  now: number;
};

type RenewalEvent = { at: number; expiresAt: number; note: string };

const ZERO = "0x0000000000000000000000000000000000000000";
const HASHSCAN = "https://hashscan.io/testnet";
const tinybarToHbar = (t: string) => (Number(t) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 });

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const Home: NextPage = () => {
  const { address: connected } = useAccount();
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renewals, setRenewals] = useState<RenewalEvent[]>([]);
  // Local countdown so the number moves every second without polling every second.
  const [remaining, setRemaining] = useState(0);
  const lastExpiry = useRef<number | null>(null);

  useEffect(() => {
    if (connected && !agent) setAgent(connected);
  }, [connected, agent]);

  const poll = useCallback(async (who: string) => {
    try {
      const res = await fetch(`/api/retainer/status?agent=${who}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to read the contract");
        return;
      }
      setError(null);
      setStatus(body as Status);
      setRemaining(body.secondsRemaining);

      // A window that moved forward is a renewal that fired. This is the moment the
      // product exists for, so it gets recorded rather than just redrawn.
      if (lastExpiry.current !== null && body.expiresAt > lastExpiry.current) {
        setRenewals(prev =>
          [
            {
              at: body.now,
              expiresAt: body.expiresAt,
              note: "the Schedule Service called renew() — no user, no server, no cron",
            },
            ...prev,
          ].slice(0, 8),
        );
      }
      lastExpiry.current = body.expiresAt;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!agent || !/^0x[0-9a-fA-F]{40}$/.test(agent)) return;
    void poll(agent);
    const id = setInterval(() => void poll(agent), 5000);
    return () => clearInterval(id);
  }, [agent, poll]);

  useEffect(() => {
    const id = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const pct = status?.periodSeconds ? Math.min(100, (remaining / status.periodSeconds) * 100) : 0;
  const expiringSoon = remaining <= 15 && remaining > 0;

  return (
    <div className="flex flex-col grow w-full">
      <section className="w-full px-5 py-14 bg-base-200">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold mb-3">Retainer</h1>
          <p className="text-xl opacity-80 mb-2">Your agent&apos;s access renews itself on-chain at 3am.</p>
          <p className="opacity-60 max-w-xl mx-auto">
            An agent can pay for a thing. An agent cannot <em>subscribe</em> to a thing — every renewal needs somebody
            awake to re-authorise it. Retainer removes that person.
          </p>
        </div>
      </section>

      <section className="w-full px-5 py-10">
        <div className="max-w-3xl mx-auto">
          <label className="block text-sm font-medium mb-2" htmlFor="agent">
            Watch an agent&apos;s access
          </label>
          <input
            id="agent"
            className="input input-bordered w-full font-mono text-sm"
            placeholder="0x… agent address"
            value={agent}
            onChange={e => setAgent(e.target.value.trim())}
          />

          {error && (
            <div className="alert alert-warning mt-4">
              <span className="text-sm">{error}</span>
            </div>
          )}

          {status && (
            <>
              <div className="card bg-base-100 shadow-lg mt-6">
                <div className="card-body">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className={`badge badge-lg ${status.hasAccess ? "badge-success" : "badge-error"}`}>
                      {status.hasAccess ? "access open" : "access closed"}
                    </span>
                    <span className="text-sm opacity-60">
                      period {status.periodSeconds}s · {tinybarToHbar(status.pricePerPeriodTinybar)} HBAR
                    </span>
                  </div>

                  <div className="mt-5">
                    <div className="flex justify-between items-end mb-1">
                      <span className="text-sm opacity-60">this window closes in</span>
                      <span className={`font-mono text-3xl ${expiringSoon ? "text-warning" : ""}`}>
                        {clock(remaining)}
                      </span>
                    </div>
                    <progress
                      className={`progress w-full ${expiringSoon ? "progress-warning" : "progress-success"}`}
                      value={pct}
                      max={100}
                    />
                    {expiringSoon && (
                      <p className="text-sm text-warning mt-2">
                        About to expire — and about to keep working anyway. Nothing is watching this but you.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 text-center">
                    <Stat label="balance" value={`${tinybarToHbar(status.balanceTinybar)} ℏ`} />
                    <Stat label="periods funded" value={String(status.periodsFunded)} />
                    <Stat label="reserve can arm" value={String(status.renewalsReserveCanArm)} />
                    <Stat label="renewal armed" value={status.nextRenewalSchedule !== ZERO ? "yes" : "no"} />
                  </div>

                  <div className="mt-6 text-sm space-y-1">
                    <ProofLink
                      label="contract"
                      href={`${HASHSCAN}/contract/${status.contract}`}
                      value={status.contract}
                    />
                    {status.nextRenewalSchedule !== ZERO && (
                      <ProofLink
                        label="pending schedule"
                        href={`${HASHSCAN}/account/${status.nextRenewalSchedule}`}
                        value={status.nextRenewalSchedule}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <h2 className="font-semibold mb-3">Renewals seen while this page was open</h2>
                {renewals.length === 0 ? (
                  <p className="text-sm opacity-60">
                    None yet. Leave this tab open past the countdown — the window will extend itself.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {renewals.map(r => (
                      <li key={r.at} className="card bg-base-100 shadow-sm">
                        <div className="card-body py-3">
                          <div className="flex justify-between flex-wrap gap-2">
                            <span className="font-mono text-sm">
                              {new Date(r.at * 1000).toLocaleTimeString()} → window now ends{" "}
                              {new Date(r.expiresAt * 1000).toLocaleTimeString()}
                            </span>
                          </div>
                          <span className="text-sm opacity-60">{r.note}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-2xl font-mono">{value}</div>
    <div className="text-xs opacity-60 uppercase tracking-wide">{label}</div>
  </div>
);

const ProofLink = ({ label, href, value }: { label: string; href: string; value: string }) => (
  <div className="flex gap-2 flex-wrap">
    <span className="opacity-60">{label}</span>
    <a className="link link-primary font-mono break-all" href={href} target="_blank" rel="noreferrer">
      {value}
    </a>
  </div>
);

export default Home;
