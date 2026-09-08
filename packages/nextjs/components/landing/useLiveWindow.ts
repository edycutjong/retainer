"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

/**
 * The live window — everything the page knows about one agent's subscription, read from chain
 * state via `/api/retainer/status` and nothing else.
 *
 * Polls every 4s; ticks the countdown locally every second so the number moves without hitting
 * the chain every second. A window that moved forward between two polls is a renewal that fired,
 * and that is the moment the product exists for — so it is recorded and announced (`flash`),
 * not merely redrawn.
 */

export type Usage = { used: number; allowance: number; remaining: number };

export type Status = {
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
  /** `null` when the auxiliary reserve read failed on this poll — unknown, not zero. */
  renewalsReserveCanArm: number | null;
  /** `null` when the auxiliary usage read failed on this poll — unknown, not empty. */
  usage: Usage | null;
  /** Names of the auxiliary fields the chain did not answer on this poll. */
  unavailable?: string[];
  now: number;
};

export type LogEntry = { id: number; at: number; kind: "renewed" | "metered"; detail: string };

export const ZERO = "0x0000000000000000000000000000000000000000";
export const DEMO_AGENT = "0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66";
const POLL_MS = 4000;
const FLASH_MS = 2200;

export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

export type LiveWindow = {
  agent: string;
  setAgent: (a: string) => void;
  valid: boolean;
  status: Status | null;
  error: string | null;
  log: LogEntry[];
  flash: boolean;
  remaining: number;
  /** True once an address has been entered but the first chain read has not landed yet. */
  loading: boolean;
};

export function useLiveWindow(): LiveWindow {
  const { address: connected } = useAccount();
  const [agent, setAgentState] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [flash, setFlash] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const lastExpiry = useRef<number | null>(null);
  const lastUsed = useRef<number | null>(null);
  const seq = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setAgent = useCallback((a: string) => {
    const next = a.trim();
    setAgentState(prev => {
      if (prev !== next) {
        // A different agent is a different subscription: start its story from nothing.
        lastExpiry.current = null;
        lastUsed.current = null;
        failures.current = 0;
        if (retryTimer.current) clearTimeout(retryTimer.current);
        setStatus(null);
        setError(null);
        setLog([]);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (connected && !agent) setAgent(connected);
  }, [connected, agent, setAgent]);

  const poll = useCallback(async (who: string) => {
    try {
      const res = await fetch(`/api/retainer/status?agent=${who}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        // The public relay occasionally answers a plain view read with a spurious revert. One
        // failure is retried quickly and silently; only a repeat is worth telling the visitor,
        // and the last good state stays on screen either way.
        failures.current += 1;
        if (failures.current >= 2) setError(`${body.error ?? "Failed to read the contract"} — retrying`);
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => void poll(who), 1500);
        return;
      }
      failures.current = 0;
      setError(null);
      setStatus(body as Status);
      setRemaining(body.secondsRemaining);

      if (lastExpiry.current !== null && body.expiresAt > lastExpiry.current) {
        const entryId = (seq.current += 1);
        setLog(prev =>
          [
            {
              id: entryId,
              at: body.now,
              kind: "renewed" as const,
              detail: "the Schedule Service called renew() — no user, no server, no cron",
            },
            ...prev,
          ].slice(0, 6),
        );
        setFlash(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS);
      }
      if (body.usage && lastUsed.current !== null && body.usage.used > lastUsed.current) {
        const entryId = (seq.current += 1);
        setLog(prev =>
          [
            {
              id: entryId,
              at: body.now,
              kind: "metered" as const,
              detail: `call metered on-chain · ${body.usage.remaining} of ${body.usage.allowance} left this period`,
            },
            ...prev,
          ].slice(0, 6),
        );
      }
      lastExpiry.current = body.expiresAt;
      if (body.usage) lastUsed.current = body.usage.used;
    } catch (e) {
      failures.current += 1;
      if (failures.current >= 2) setError(`${e instanceof Error ? e.message : String(e)} — retrying`);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => void poll(who), 1500);
    }
  }, []);

  const valid = isAddress(agent);

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

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  return { agent, setAgent, valid, status, error, log, flash, remaining, loading: valid && !status && !error };
}

export const hbar = (tinybar: string) =>
  (Number(tinybar) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 });
export const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
