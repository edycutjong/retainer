// @vitest-environment jsdom
import React, { act, createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Ring, type RingProps } from "~~/components/landing/Ring";

/**
 * The ring is the product's instrument: six props in, and what a judge sees out.
 *
 * Everything it does is a mapping — `frac` to an arc length, four booleans to a set of state
 * classes, `armed` to whether the pin looks live. None of it has a test elsewhere, and all of it
 * is what the demo is judged on, so this file asserts the mapping rather than the render.
 *
 * The invariant worth naming: **`firing` wins.** A renewal that just fired is not "expiring" and
 * is not "closed", however the window and the clock happened to read on the poll before it. If
 * that ordering ever inverts, the one moment the product exists to show renders as a failure.
 *
 * No JSX here on purpose: `vitest.config.ts` includes `test/**\/*.test.ts` only, and
 * `React.createElement` renders the same component without widening that glob.
 *
 * The one piece of scaffolding: `tsconfig.json` sets `jsx: "preserve"` because Next.js compiles
 * the JSX itself with the automatic runtime, so vitest's esbuild falls back to the *classic*
 * transform and `Ring.tsx` emits bare `React.createElement` calls. Next never needs a `React`
 * global; this harness does, and only at render time, so putting one on `globalThis` here is
 * cheaper and less invasive than changing how the whole suite is transformed.
 */
(globalThis as { React?: typeof React }).React = React;

const R = 92;
const CIRC = 2 * Math.PI * R;

/** The component's own defaults for a healthy, open window with plenty of time left. */
const base: RingProps = {
  frac: 1,
  seconds: 90,
  armed: true,
  open: true,
  soon: false,
  firing: false,
  label: "renews itself",
  ariaLabel: "Access window open, 1 minute 30 seconds remaining",
};

function render(over: Partial<RingProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => void root.render(createElement(Ring, { ...base, ...over })));
  const pick = (selector: string) => {
    const el = container.querySelector(selector);
    if (!el) throw new Error(`no element matched ${selector}`);
    return el;
  };
  return {
    container,
    pick,
    /** The class list of the first element matching `selector`, as a set for order-free asserts. */
    classes: (selector: string) => new Set((pick(selector).getAttribute("class") ?? "").split(/\s+/).filter(Boolean)),
    /** A numeric SVG attribute. */
    num: (selector: string, attr: string) => Number(pick(selector).getAttribute(attr)),
    unmount: () => {
      act(() => void root.unmount());
      container.remove();
    },
  };
}

const WINDOW = ".rt-ring__window";
const REFILL = "[class^='rt-ring__refill']";
const READOUT = ".rt-readout";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the arc — the dash offset IS the window", () => {
  it("drains the ring in step with `frac`, so the violet left on screen is the time left on chain", () => {
    // strokeDashoffset = CIRC * (1 - frac): a full window hides no arc, an empty one hides it all.
    // Getting the sense of this backwards draws a ring that fills as the subscription expires.
    for (const [frac, visible] of [
      [1, 1],
      [0.75, 0.75],
      [0.5, 0.5],
      [0.25, 0.25],
      [0, 0],
    ] as const) {
      const r = render({ frac });
      expect(r.num(WINDOW, "stroke-dashoffset")).toBeCloseTo(CIRC * (1 - visible), 6);
      expect(r.num(WINDOW, "stroke-dasharray")).toBeCloseTo(CIRC, 6);
      r.unmount();
    }
  });

  it("clamps a frac outside 0..1 rather than drawing an arc that is not on the circle", () => {
    // `frac` is computed from a countdown against a polled `expiresAt`; a stale poll or a clock
    // skew makes it briefly negative or greater than one, and an unclamped offset would render
    // as a stroke wrapping past the seam.
    const over = render({ frac: 1.7 });
    expect(over.num(WINDOW, "stroke-dashoffset")).toBe(0);
    over.unmount();

    const under = render({ frac: -0.4 });
    expect(under.num(WINDOW, "stroke-dashoffset")).toBeCloseTo(CIRC, 6);
    under.unmount();
  });

  it("publishes the circumference to CSS, so the keyframed animations measure the same circle", () => {
    const r = render();
    const svg = r.pick("svg") as SVGSVGElement;
    expect(Number(svg.style.getPropertyValue("--rt-circ"))).toBeCloseTo(CIRC, 6);
    r.unmount();
  });

  it("keeps the mint refill fully retracted until the schedule fires, then closes the whole circle", () => {
    const idle = render({ firing: false });
    expect(idle.num(REFILL, "stroke-dashoffset")).toBeCloseTo(CIRC, 6);
    expect(idle.classes(REFILL).has("is-firing")).toBe(false);
    idle.unmount();

    const firing = render({ firing: true });
    expect(firing.num(REFILL, "stroke-dashoffset")).toBe(0);
    expect(firing.classes(REFILL).has("is-firing")).toBe(true);
    firing.unmount();
  });
});

describe("the state classes — four booleans, and they have to stay consistent", () => {
  it("says nothing at all about an open window with time left", () => {
    const r = render();
    expect(r.classes(WINDOW)).toStrictEqual(new Set(["rt-ring__window"]));
    expect(r.classes(READOUT)).toStrictEqual(new Set(["rt-readout"]));
    r.unmount();
  });

  it("reads closed on both the ring and the clock when there is no access", () => {
    const r = render({ open: false, frac: 0, seconds: 0 });
    expect(r.classes(WINDOW).has("is-closed")).toBe(true);
    expect(r.classes(READOUT).has("is-closed")).toBe(true);
    expect(r.classes(READOUT).has("is-expiring")).toBe(false);
    r.unmount();
  });

  it("reads expiring only while the window is still open — a closed window is not 'about to close'", () => {
    const open = render({ open: true, soon: true, seconds: 9 });
    expect(open.classes(WINDOW).has("is-expiring")).toBe(true);
    expect(open.classes(READOUT).has("is-expiring")).toBe(true);
    expect(open.classes(READOUT).has("is-closed")).toBe(false);
    open.unmount();

    // `soon` is a countdown threshold and stays true for a moment after access lapses. Closed
    // has to win there, or the clock urges the viewer to hurry at a window that already shut.
    const shut = render({ open: false, soon: true, seconds: 0 });
    expect(shut.classes(WINDOW).has("is-expiring")).toBe(false);
    expect(shut.classes(READOUT).has("is-expiring")).toBe(false);
    expect(shut.classes(READOUT).has("is-closed")).toBe(true);
    shut.unmount();
  });

  it("lets `firing` beat `soon`, because a window that just renewed is not expiring", () => {
    // The demo's whole point lands in this combination: the poll before the renewal said nine
    // seconds left, the renewal fires, and for the length of the sweep both flags are true. The
    // readout must go mint (is-renewed) and must not simultaneously go red (is-expiring).
    const r = render({ open: true, soon: true, firing: true, seconds: 9 });
    expect(r.classes(READOUT)).toStrictEqual(new Set(["rt-readout", "is-renewed"]));
    expect(r.classes(WINDOW).has("is-snapping")).toBe(true);
    r.unmount();
  });

  it("lets `firing` beat `open` too — a renewal arriving at zero reads renewed, never closed", () => {
    // The renewal that matters most is the one that lands exactly as access lapses.
    const r = render({ open: false, soon: false, firing: true, frac: 0, seconds: 0 });
    expect(r.classes(READOUT)).toStrictEqual(new Set(["rt-readout", "is-renewed"]));
    expect(r.classes(READOUT).has("is-closed")).toBe(false);
    // The ring itself still shows the drained window underneath the mint sweep, which is the
    // picture: an empty violet arc being overwritten. Only the clock switches allegiance.
    expect(r.classes(WINDOW).has("is-closed")).toBe(true);
    expect(r.classes(WINDOW).has("is-snapping")).toBe(true);
    r.unmount();
  });

  it("never puts two colours on the clock at once, over every combination of the four flags", () => {
    // The three readout states are mutually exclusive by construction; this walks all 16 states
    // and proves it, so a fourth condition added later cannot quietly overlap an existing one.
    const exclusive = ["is-renewed", "is-closed", "is-expiring"];
    for (const armed of [true, false]) {
      for (const open of [true, false]) {
        for (const soon of [true, false]) {
          for (const firing of [true, false]) {
            const r = render({ armed, open, soon, firing });
            const on = exclusive.filter(c => r.classes(READOUT).has(c));
            expect(on.length).toBeLessThanOrEqual(1);
            // And `firing` is the one that wins whenever it is set.
            if (firing) expect(on).toStrictEqual(["is-renewed"]);
            r.unmount();
          }
        }
      }
    }
  });

  it("marks the ring as tweening only while rAF is driving `frac`, so CSS does not fight it", () => {
    // Both the CSS transition and the rAF loop want to own the dash offset. `is-tweening` is how
    // the ring hands the animation over; leaving it on afterwards makes the arc jump on poll.
    const driven = render({ tweening: true });
    expect(driven.classes(WINDOW).has("is-tweening")).toBe(true);
    driven.unmount();

    const off = render({ tweening: false });
    expect(off.classes(WINDOW).has("is-tweening")).toBe(false);
    off.unmount();

    const omitted = render();
    expect(omitted.classes(WINDOW).has("is-tweening")).toBe(false);
    omitted.unmount();
  });
});

describe("the readout", () => {
  it("shows the countdown as mm:ss and the caption underneath it", () => {
    const r = render({ seconds: 90, label: "renews itself" });
    expect(r.pick(READOUT).textContent).toBe("01:30");
    expect(r.pick(".rt-eyebrow").textContent).toBe("renews itself");
    r.unmount();
  });

  it("floors a negative countdown at zero instead of rendering '0-1:-1'", () => {
    // `seconds` is derived from `expiresAt - now` and goes negative between a lapse and the next
    // poll. `clock()` does no clamping of its own, so the guard has to live here.
    const r = render({ seconds: -7, open: false });
    expect(r.pick(READOUT).textContent).toBe("00:00");
    r.unmount();
  });

  it("names the whole instrument once for a screen reader and hides the decorative duplicates", () => {
    // The clock and the caption restate, in fragments, what `ariaLabel` already says as a
    // sentence. Leaving them readable makes a screen reader announce the ring three times.
    const r = render({ ariaLabel: "Access window open, 1 minute 30 seconds remaining" });
    const svg = r.pick("svg");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Access window open, 1 minute 30 seconds remaining");
    expect(r.pick(READOUT).getAttribute("aria-hidden")).toBe("true");
    expect(r.pick(".rt-eyebrow").getAttribute("aria-hidden")).toBe("true");
    r.unmount();
  });
});

describe("the pin — the scheduled call, sitting on the seam", () => {
  it("shows the pin live when a renewal is booked and greys it when nothing is scheduled", () => {
    const armed = render({ armed: true });
    expect(armed.classes(".rt-ring__pin")).toStrictEqual(new Set(["rt-ring__pin"]));
    armed.unmount();

    const unarmed = render({ armed: false });
    expect(unarmed.classes(".rt-ring__pin")).toStrictEqual(new Set(["rt-ring__pin", "is-unarmed"]));
    unarmed.unmount();
  });

  it("presses the pin and rings the ripple at the same instant, since they are one event", () => {
    const idle = render({ firing: false });
    expect(idle.classes(".rt-ring__press").has("is-firing")).toBe(false);
    expect(idle.classes("[class^='rt-ring__ripple']").has("is-firing")).toBe(false);
    idle.unmount();

    const firing = render({ firing: true });
    expect(firing.classes(".rt-ring__press").has("is-firing")).toBe(true);
    expect(firing.classes("[class^='rt-ring__ripple']").has("is-firing")).toBe(true);
    firing.unmount();
  });

  it("is the brand mark's clicker at exactly one third scale, which is what keeps the mark one object", () => {
    // The same clicker appears in `public/icon.svg`, the README hero and here. Its proportions are
    // the identity; nudging one number in one place breaks the resemblance everywhere without
    // breaking anything a build would catch. So this reads the icon and compares.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const icon = readFileSync(path.join(here, "..", "public", "icon.svg"), "utf8");
    const rects = [...icon.matchAll(/<rect\b[^>]*>/g)]
      .map(m => {
        const attr = (name: string) => Number(new RegExp(`\\b${name}="([-\\d.]+)"`).exec(m[0])?.[1]);
        return { x: attr("x"), y: attr("y"), width: attr("width"), height: attr("height"), rx: attr("rx") };
      })
      // The plate rects are the full 512 canvas; the clicker and its slot are the small pair.
      .filter(r => r.width < 100);
    expect(rects).toHaveLength(2);
    const [iconBox, iconSlot] = rects;

    const r = render();
    const read = (selector: string) => ({
      x: r.num(selector, "x"),
      y: r.num(selector, "y"),
      width: r.num(selector, "width"),
      height: r.num(selector, "height"),
      rx: r.num(selector, "rx"),
    });
    const box = read(".rt-ring__pin");
    const slot = read(".rt-ring__pinslot");

    // One third, on every dimension the two shapes share.
    const third = 1 / 3;
    expect(box.width / iconBox.width).toBeCloseTo(third, 6);
    expect(box.height / iconBox.height).toBeCloseTo(third, 6);
    expect(slot.width / iconSlot.width).toBeCloseTo(third, 6);
    expect(box.rx / iconBox.rx).toBeCloseTo(third, 2);
    expect(slot.height / iconSlot.height).toBeCloseTo(third, 2);
    expect(slot.rx / iconSlot.rx).toBeCloseTo(third, 2);

    // The ratios the shape is actually made of, restated so a drift is readable in the failure.
    expect(box.width / box.height).toBeCloseTo(iconBox.width / iconBox.height, 6); // 16 x 18
    expect(box.rx / box.width).toBeCloseTo(iconBox.rx / iconBox.width, 3); // rx 4.67
    expect(slot.width / box.width).toBeCloseTo(0.5, 6); // slot is half the body wide
    expect(slot.height / box.height).toBeCloseTo(iconSlot.height / iconBox.height, 3); // 3.33 / 18
    expect(slot.rx / slot.height).toBeCloseTo(0.5, 2); // fully rounded ends

    // Centred across, and 0.2222 of the body's height down from its top — in both marks.
    expect(slot.x + slot.width / 2).toBeCloseTo(box.x + box.width / 2, 6);
    expect(iconSlot.x + iconSlot.width / 2).toBeCloseTo(iconBox.x + iconBox.width / 2, 6);
    expect((slot.y - box.y) / box.height).toBeCloseTo(0.2222, 4);
    expect((iconSlot.y - iconBox.y) / iconBox.height).toBeCloseTo(0.2222, 4);

    // And the pin sits on the seam: centred on the ring's twelve o'clock, x = 110 of a 220 box.
    expect(box.x + box.width / 2).toBe(110);
    r.unmount();
  });
});
