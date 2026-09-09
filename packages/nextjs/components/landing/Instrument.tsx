"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ring } from "./Ring";
import { CURRENT_CONTRACT, RECORDED_CONTRACT, RECORDED_RUN, REPLAY_SPEED } from "./recordedRun";
import { DEMO_AGENT, type LiveWindow, ZERO, clock, short } from "./useLiveWindow";

/**
 * The instrument — the one object on the page a judge should remember.
 *
 * Two modes, switched explicitly and labelled at all times:
 *
 *  - **Recorded run.** Replays the four transactions the network actually executed on testnet
 *    (`recordedRun.ts`, transcribed from docs/proof.md) at 10× time. The ring drains violet to
 *    zero and the network's own scheduled call refills it mint; the third renewal charges the
 *    last period and lapses loudly. It exists because the live demo agent's window is not always
 *    open, and a hero that depended on live state would show a dead product on judging day.
 *  - **Live chain.** The same ring driven by `/api/retainer/status` for any address. Nothing is
 *    simulated here; every number is a chain read.
 *
 * Under `prefers-reduced-motion` the replay does not autoplay — it steps one event per press.
 */

type Mode = "replay" | "live";

const PERIOD = RECORDED_CONTRACT.periodSeconds;
const FILL_MS = 900; // the refill sweep
const HOLD_MS = 1100; // the closed ring holds, mint settles back to violet
const DRAIN_MS = (PERIOD * 1000) / REPLAY_SPEED;
const CLOSED_MS = 3200;
const FIRE_MS = 2200;

type Phase = { kind: "fill" | "hold" | "drain" | "closed"; i: number; ms: number };
const PHASES: Phase[] = [];
RECORDED_RUN.forEach((_, i) => {
  PHASES.push({ kind: "fill", i, ms: FILL_MS }, { kind: "hold", i, ms: HOLD_MS }, { kind: "drain", i, ms: DRAIN_MS });
});
PHASES.push({ kind: "closed", i: RECORDED_RUN.length - 1, ms: CLOSED_MS });

/** Step mode: each event fires, then drains. The last drain stays closed. */
type Key = { i: number; drained: boolean };
const KEYS: Key[] = RECORDED_RUN.flatMap((_, i) => [
  { i, drained: false },
  { i, drained: true },
]);

type View = { i: number; frac: number; firing: boolean; tweening: boolean; closed: boolean };

function phaseForKey(k: Key): number {
  if (!k.drained) return k.i * 3 + 1; // hold, ring full
  return k.i === RECORDED_RUN.length - 1 ? PHASES.length - 1 : (k.i + 1) * 3; // next fill, or closed
}

export function Instrument({
  live,
  initialMode = "replay",
  fromArrival = false,
}: {
  live: LiveWindow;
  initialMode?: Mode;
  /** True while the only reason live data exists is the page's own arrival read — nobody asked. */
  fromArrival?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [reduced, setReduced] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>({ i: 0, frac: 1, firing: false, tweening: false, closed: false });
  const [stepIdx, setStepIdx] = useState(0);
  const [stepFire, setStepFire] = useState(false);
  const [announce, setAnnounce] = useState("");
  const plateRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const raf = useRef<number | null>(null);
  const phaseIdx = useRef(0);
  const phaseElapsed = useRef(0);
  const lastTs = useRef<number | null>(null);
  const onScreen = useRef(true);
  const lastAnnounced = useRef<number>(-1);
  const stepFireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set the moment the visitor works a control. From then on the mode is theirs, not ours. */
  const engaged = useRef(false);

  // Reduced motion decides autoplay once, at mount.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    setPlaying(!mq.matches);
    const onChange = (e: MediaQueryListEvent) => {
      setReduced(e.matches);
      if (e.matches) setPlaying(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // An address, the demo agent or a wallet means the visitor wants the chain.
  //
  // With one exception, and it is the whole reason this is not a one-liner: the page also reads
  // the demo agent on arrival, unasked, and that read lands a few hundred milliseconds late. If
  // the window happens to be open it used to switch the mode out from under whoever was already
  // working the replay — the controls unmount mid-click. Invisible for as long as the demo agent
  // was lapsed, and a broken hero the day it was not. An unasked-for read never wins against a
  // visitor who has taken hold of the instrument; anything they asked for still does.
  useEffect(() => {
    if (!live.valid) return;
    if (fromArrival && engaged.current) return;
    setMode("live");
  }, [live.valid, fromArrival]);

  // Pause when the instrument is off screen or the tab is hidden — the replay is not a CPU tax.
  useEffect(() => {
    const el = plateRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      onScreen.current = e.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const applyPhase = useCallback((idx: number, elapsed: number) => {
    const p = PHASES[idx];
    const t = Math.min(1, elapsed / p.ms);
    const isSubscribe = p.i === 0 && p.kind === "fill";
    const frac = p.kind === "drain" ? 1 - t : p.kind === "closed" ? 0 : isSubscribe ? t : 1;
    setView({
      i: p.i,
      frac,
      firing: p.kind === "fill" && p.i > 0,
      tweening: p.kind === "drain" || isSubscribe,
      closed: p.kind === "closed",
    });
    if (p.kind === "fill" && lastAnnounced.current !== p.i) {
      lastAnnounced.current = p.i;
      const ev = RECORDED_RUN[p.i];
      setAnnounce(
        ev.kind === "subscribe"
          ? `Recorded run: subscription opened at ${ev.utc} UTC and the first renewal armed.`
          : ev.kind === "renewed"
            ? `Renewal executed by the network at ${ev.utc} UTC. Nothing was paid, nothing was signed.`
            : `Renewal executed at ${ev.utc} UTC, then lapsed: balance will not cover the next period.`,
      );
    }
    if (p.kind === "closed" && lastAnnounced.current !== -2) {
      lastAnnounced.current = -2;
      setAnnounce("Window closed. No schedule armed. Nobody paid again.");
    }
  }, []);

  // The replay engine.
  useEffect(() => {
    if (mode !== "replay" || !playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      lastTs.current = null;
      return;
    }
    const loop = (ts: number) => {
      if (lastTs.current !== null && onScreen.current && !document.hidden) {
        phaseElapsed.current += ts - lastTs.current;
        while (phaseElapsed.current >= PHASES[phaseIdx.current].ms) {
          phaseElapsed.current -= PHASES[phaseIdx.current].ms;
          phaseIdx.current = (phaseIdx.current + 1) % PHASES.length;
          if (phaseIdx.current === 0) lastAnnounced.current = -1;
        }
        applyPhase(phaseIdx.current, phaseElapsed.current);
      }
      lastTs.current = ts;
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [mode, playing, applyPhase]);

  // Step mode (paused or reduced motion): one event per press.
  const showKey = useCallback((idx: number) => {
    const k = KEYS[idx];
    setStepIdx(idx);
    phaseIdx.current = phaseForKey(k);
    phaseElapsed.current = 0;
    setView({
      i: k.i,
      frac: k.drained ? 0 : 1,
      firing: false,
      tweening: false,
      closed: k.drained && k.i === RECORDED_RUN.length - 1,
    });
    // A drained frame must never wear the previous fire's mint: clear it before anything else.
    if (stepFireTimer.current) clearTimeout(stepFireTimer.current);
    setStepFire(false);
    if (!k.drained) {
      setStepFire(true);
      const ev = RECORDED_RUN[k.i];
      setAnnounce(
        ev.kind === "subscribe"
          ? `Subscription opened at ${ev.utc} UTC and the first renewal armed.`
          : ev.kind === "renewed"
            ? `Renewal executed by the network at ${ev.utc} UTC. Nothing was paid, nothing was signed.`
            : `Renewal executed at ${ev.utc} UTC, then lapsed: balance will not cover the next period.`,
      );
      stepFireTimer.current = setTimeout(() => setStepFire(false), FIRE_MS);
      return;
    }
    setAnnounce(
      k.i === RECORDED_RUN.length - 1
        ? "Window closed. No schedule armed. Nobody paid again."
        : `Window at zero, ${RECORDED_RUN[k.i].armed} due to fire.`,
    );
  }, []);

  const step = () => {
    engaged.current = true;
    setPlaying(false);
    showKey((stepIdx + 1) % KEYS.length);
  };
  const togglePlay = () => {
    engaged.current = true;
    if (playing) {
      setPlaying(false);
      // Land on the nearest key so Step continues from here.
      const p = PHASES[phaseIdx.current];
      setStepIdx(Math.min(KEYS.length - 1, p.i * 2 + (p.kind === "drain" || p.kind === "closed" ? 1 : 0)));
      return;
    }
    phaseIdx.current = phaseForKey(KEYS[stepIdx]);
    phaseElapsed.current = 0;
    lastTs.current = null;
    setPlaying(true);
  };

  const switchMode = (m: Mode) => {
    engaged.current = true;
    setMode(m);
    setAnnounce(m === "replay" ? "Showing the recorded run." : "Showing the live chain.");
    if (m === "live" && !live.valid) setTimeout(() => inputRef.current?.focus(), 0);
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      switchMode(mode === "replay" ? "live" : "replay");
    }
  };

  // ── Derive what the ring shows.
  const ev = RECORDED_RUN[view.i];
  const replayArmed = !!ev.armed && !view.closed;
  const replaySeconds = view.closed ? 0 : Math.ceil(view.frac * PERIOD);
  const replayFiring = view.firing || stepFire;

  const s = live.status;
  const period = s?.periodSeconds ?? 1;
  const liveOpen = !!s?.hasAccess && live.remaining > 0;
  const liveAtZero = !!s?.hasAccess && live.remaining === 0;
  const liveArmed = !!s && s.nextRenewalSchedule !== ZERO;
  const liveSoon = liveOpen && live.remaining <= 15;

  const ring =
    mode === "replay"
      ? {
          frac: view.frac,
          seconds: replaySeconds,
          armed: replayArmed,
          open: !view.closed,
          soon: !view.closed && replaySeconds <= 15 && replaySeconds > 0 && view.frac < 1,
          firing: replayFiring,
          tweening: view.tweening,
          label: replayFiring
            ? "renewed by the network"
            : view.closed
              ? "window closed"
              : replayArmed
                ? "until this window closes"
                : "last period · nothing armed",
          ariaLabel: view.closed
            ? "Recorded run, window closed, no schedule armed."
            : `Recorded run at ${REPLAY_SPEED} times speed: ${replaySeconds} of ${PERIOD} seconds remaining; ${replayArmed ? "renewal armed" : "no renewal armed"}.`,
        }
      : {
          frac: s ? live.remaining / period : 0,
          seconds: s ? live.remaining : 0,
          armed: liveArmed,
          open: liveOpen,
          soon: liveSoon,
          firing: live.flash,
          tweening: false,
          label: live.flash
            ? "renewed by the network"
            : !s
              ? live.loading
                ? "reading the chain…"
                : "no agent selected"
              : liveAtZero
                ? liveArmed
                  ? "at zero · waiting for the network"
                  : "window closed"
                : liveOpen
                  ? "until this window closes"
                  : "window closed",
          ariaLabel: !s
            ? "Access window: no agent selected."
            : liveOpen
              ? `Access window: ${live.remaining} of ${period} seconds remaining; ${liveArmed ? "renewal armed" : "no renewal armed"}.`
              : "Access window closed.",
        };

  const caption = useMemo(() => {
    if (mode === "replay") {
      if (view.closed)
        return { mono: "window closed · no schedule armed · nobody paid again", strong: null as string | null };
      if (replayFiring && ev.kind !== "subscribe")
        return { mono: ev.caption, strong: "Nothing was paid. Nothing was signed." };
      return { mono: ev.caption, strong: null };
    }
    if (!s) {
      return {
        mono:
          live.error ??
          (live.loading
            ? `reading ${short(live.agent)} on Hedera testnet…`
            : "paste an agent address, or watch the demo agent"),
        strong: null,
      };
    }
    const where = `agent ${short(s.agent)} · contract ${
      s.contract.toLowerCase() === CURRENT_CONTRACT.evm.toLowerCase() ? CURRENT_CONTRACT.id : short(s.contract)
    } · polled every 4s`;
    if (live.flash) return { mono: where, strong: "It renewed itself. Nothing was paid. Nothing was signed." };
    if (!s.hasAccess) {
      return {
        mono: s.active
          ? "the window lapsed — a renewal is armed but the balance ran out; fund it and the loop resumes"
          : "no open window on chain for this agent right now — a cold request is charged once, and then this starts · the recorded run shows the loop",
        strong: null,
      };
    }
    if (liveAtZero)
      return { mono: `${where} · the schedule is due; the next read should show a new window`, strong: null };
    if (liveSoon) return { mono: `${where} · about to expire — and about to keep working anyway`, strong: null };
    return { mono: `${where} · leave this open past zero; the window will extend itself`, strong: null };
  }, [mode, view.closed, replayFiring, ev, s, live.error, live.loading, live.agent, live.flash, liveAtZero, liveSoon]);

  const plateFiring = mode === "replay" ? replayFiring : live.flash;
  // Both labels are always rendered, stacked in one grid cell, with the inactive one hidden.
  // The REPLAY label is materially longer than the LIVE one, so sizing the pill to whichever
  // is showing made the row change height on every switch: at mid widths the long label
  // wrapped the pill below the tabs, and inside the pill it wrapped to a second line. Sizing
  // the box to the larger of the two, in both dimensions, removes the jump at every width
  // without a magic min-width to keep in sync with the copy.
  const replayLabel = `REPLAY · ${RECORDED_CONTRACT.date} · ${RECORDED_CONTRACT.id} · ${REPLAY_SPEED}× time`;
  const liveLabel = `LIVE · Hedera testnet · ${
    s && s.contract.toLowerCase() !== CURRENT_CONTRACT.evm.toLowerCase() ? short(s.contract) : CURRENT_CONTRACT.id
  }`;

  return (
    <div
      ref={plateRef}
      id="instrument"
      className={`rt-plate p-5 sm:p-7 lg:p-8${plateFiring ? " is-firing" : ""}`}
      data-testid="instrument"
      data-mode={mode}
      data-step={mode === "replay" && !playing ? stepIdx : undefined}
    >
      {/* mode row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="rt-tabs" role="tablist" aria-label="What the instrument shows" onKeyDown={onTabKey}>
          <button
            type="button"
            role="tab"
            id="tab-replay"
            aria-selected={mode === "replay"}
            aria-controls="instrument-panel"
            tabIndex={mode === "replay" ? 0 : -1}
            className="rt-tab"
            onClick={() => switchMode("replay")}
          >
            Recorded run
          </button>
          <button
            type="button"
            role="tab"
            id="tab-live"
            aria-selected={mode === "live"}
            aria-controls="instrument-panel"
            tabIndex={mode === "live" ? 0 : -1}
            className="rt-tab"
            onClick={() => switchMode("live")}
          >
            Live chain
          </button>
        </div>
        <span
          className={`rt-pill rt-pill--wrap ${mode === "replay" ? "rt-pill--armed" : liveOpen ? "rt-pill--renewed" : "rt-pill--closed"}`}
        >
          <span className={`rt-dot${mode === "live" && liveOpen ? " rt-dot--pulse" : ""}`} aria-hidden="true" />
          <span className="rt-pill__slot">
            <span className="rt-pill__label" aria-hidden={mode !== "replay"} data-on={mode === "replay"}>
              {replayLabel}
            </span>
            <span className="rt-pill__label" aria-hidden={mode !== "live"} data-on={mode === "live"}>
              {liveLabel}
            </span>
          </span>
        </span>
      </div>

      <div
        id="instrument-panel"
        role="tabpanel"
        aria-labelledby={mode === "replay" ? "tab-replay" : "tab-live"}
        className="mt-6"
      >
        <Ring {...ring} />

        <p className="rt-caption mt-5" aria-hidden="true">
          {caption.strong && (
            <>
              <strong>{caption.strong}</strong>
              <br />
            </>
          )}
          {caption.mono}
        </p>

        {/* the tape: receipts so far.
            `role="group"` because a bare div is `generic`, and generic prohibits an accessible
            name — the label below was being dropped, silently, and axe flags it
            (`aria-prohibited-attr`). It only showed up once the live tab became the default:
            in live mode the tape starts empty, so the label is all a screen reader would get. */}
        <div
          className="rt-tape mt-4"
          role="group"
          aria-label={mode === "replay" ? "Receipts in the recorded run" : "Seen while this page was open"}
        >
          {mode === "replay"
            ? RECORDED_RUN.slice(0, view.i + 1).map((r, idx) => (
                <a
                  key={r.consensus}
                  href={r.href}
                  target="_blank"
                  rel="noreferrer"
                  className={`rt-chip${r.kind === "renewed" ? " rt-chip--renewed" : r.kind === "lapsed" ? " rt-chip--lapsed" : ""}`}
                  title={`${r.type} · ${r.consensus} · HashScan`}
                >
                  <span aria-hidden="true">{idx === 0 ? "↗" : "⟳"}</span>
                  {r.chip}
                </a>
              ))
            : live.log.map(e => (
                <span key={e.id} className={`rt-chip${e.kind === "renewed" ? " rt-chip--renewed" : ""}`}>
                  {new Date(e.at * 1000).toLocaleTimeString()} ·{" "}
                  {e.kind === "renewed" ? "renewed by the network" : "call metered"}
                </span>
              ))}
        </div>

        {/* foot row */}
        <div className="rt-foot mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
          {mode === "replay" ? (
            <>
              <button
                type="button"
                className="rt-btn rt-btn--ghost rt-btn--sm"
                onClick={togglePlay}
                aria-pressed={playing}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <button type="button" className="rt-btn rt-btn--ghost rt-btn--sm" onClick={step}>
                Step
              </button>
              {reduced && (
                <span className="rt-mono-ui" style={{ color: "var(--rt-text-low)" }}>
                  reduced motion: stepping, not playing
                </span>
              )}
            </>
          ) : (
            <>
              <label htmlFor="agent" className="rt-sr">
                Agent address
              </label>
              <input
                id="agent"
                ref={inputRef}
                className="rt-input"
                placeholder="0x… agent address"
                value={live.agent}
                onChange={e => {
                  engaged.current = true;
                  live.setAgent(e.target.value);
                }}
                spellCheck={false}
                autoComplete="off"
                inputMode="text"
              />
              <button
                type="button"
                className="rt-btn rt-btn--ghost whitespace-nowrap"
                onClick={() => {
                  engaged.current = true;
                  live.setAgent(DEMO_AGENT);
                }}
              >
                Watch the demo agent
              </button>
            </>
          )}
        </div>
      </div>

      <div className="rt-sr" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
      {/* the readout for assistive tech, once per second is too chatty: announce mode + events only */}
      <span className="rt-sr">{`Countdown ${clock(ring.seconds)}.`}</span>
    </div>
  );
}
