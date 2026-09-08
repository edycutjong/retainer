"use client";

import { clock } from "./useLiveWindow";

/**
 * The access window as a ring, with the scheduled call as a pin on its seam.
 *
 * Geometry matches the product mark (`/icon.svg`): the window drains violet clockwise from the
 * pin at twelve o'clock, so the gap opens on the pin's left; at zero the mint refill sweeps the
 * full circle and its head arrives back at the pin from that same side — the ring closes at the
 * seam, which is where the schedule was waiting.
 */

const R = 92;
const CIRC = 2 * Math.PI * R;

export type RingProps = {
  /** 0..1 of the period still open. */
  frac: number;
  /** Seconds shown in the readout. */
  seconds: number;
  /** A schedule is booked for this window. */
  armed: boolean;
  /** The window is open right now. */
  open: boolean;
  /** Last 15 seconds. */
  soon: boolean;
  /** The refill sweep is running. */
  firing: boolean;
  /** rAF is driving `frac` — turn the CSS tween off so the two do not fight. */
  tweening?: boolean;
  /** Text under the readout. */
  label: string;
  ariaLabel: string;
};

export function Ring({ frac, seconds, armed, open, soon, firing, tweening, label, ariaLabel }: RingProps) {
  const f = Math.max(0, Math.min(1, frac));
  const windowClass = [
    "rt-ring__window",
    !open && "is-closed",
    open && soon && "is-expiring",
    firing && "is-snapping",
    tweening && "is-tweening",
  ]
    .filter(Boolean)
    .join(" ");
  const readoutClass = [
    "rt-readout",
    firing && "is-renewed",
    !firing && !open && "is-closed",
    !firing && open && soon && "is-expiring",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="relative mx-auto w-full max-w-[19rem] sm:max-w-[21rem] lg:max-w-[22rem] aspect-square">
      <svg
        viewBox="0 0 220 220"
        className="rt-ring"
        role="img"
        aria-label={ariaLabel}
        style={{ ["--rt-circ" as string]: CIRC }}
      >
        <g transform="rotate(-90 110 110)">
          <circle className="rt-ring__track" cx="110" cy="110" r={R} strokeWidth="12" fill="none" />
          <circle
            className={windowClass}
            cx="110"
            cy="110"
            r={R}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - f)}
          />
          <circle
            className={`rt-ring__refill${firing ? " is-firing" : ""}`}
            cx="110"
            cy="110"
            r={R}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={CIRC}
            strokeDashoffset={firing ? 0 : CIRC}
          />
        </g>
        {/* the ripple from the pin when the scheduled call fires */}
        <circle className={`rt-ring__ripple${firing ? " is-firing" : ""}`} cx="110" cy="18" r="60" />
        {/* The pin: the scheduled call, armed on the seam — and it presses when it fires.
            Geometry is the brand mark's clicker at exactly one third scale (48x54 -> 16x18),
            so the same object reads the same in the icon, the README hero and here. */}
        <g className={`rt-ring__press${firing ? " is-firing" : ""}`}>
          <rect
            className={`rt-ring__pin${armed ? "" : " is-unarmed"}`}
            x="102"
            y="6"
            width="16"
            height="18"
            rx="4.67"
          />
          <rect className="rt-ring__pinslot" x="106" y="10" width="8" height="3.33" rx="1.67" />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
        <span className={readoutClass} aria-hidden="true">
          {clock(Math.max(0, seconds))}
        </span>
        <span className="rt-eyebrow mt-2" aria-hidden="true">
          {label}
        </span>
      </div>
    </div>
  );
}
