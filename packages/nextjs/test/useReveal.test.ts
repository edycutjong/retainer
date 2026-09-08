// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReveal } from "~~/components/landing/useReveal";

/**
 * The scroll reveal is four lines of policy wrapped around a browser API, and every one of the
 * four is a way the landing page can break in front of a judge:
 *
 *   - reveal on intersect, or the page stays blank while someone scrolls it;
 *   - reveal *once*, or a section flickers back out as it leaves the viewport;
 *   - reveal everything when the API is missing, or an unsupported browser sees nothing at all;
 *   - disconnect on unmount, or every navigation leaves an observer holding detached nodes.
 *
 * jsdom implements none of IntersectionObserver, so the observer below is a stand-in that records
 * what the hook asked for and lets the test play the part of the scroll. That is the honest shape
 * of this test: it proves the hook's decisions, not that a real browser reports intersections.
 */

type FakeEntry = { isIntersecting: boolean; target: Element };

class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly observed: Element[] = [];
  readonly unobserved: Element[] = [];
  disconnected = 0;

  constructor(
    readonly callback: (entries: FakeEntry[]) => void,
    readonly options?: { threshold?: number; rootMargin?: string },
  ) {
    FakeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve(el: Element) {
    this.unobserved.push(el);
  }

  disconnect() {
    this.disconnected += 1;
  }

  /** Play the scroll: report these elements as having come into view. */
  enter(...els: Element[]) {
    this.callback(els.map(target => ({ isIntersecting: true, target })));
  }

  /** Report these elements as observed but not intersecting — the state before a scroll. */
  miss(...els: Element[]) {
    this.callback(els.map(target => ({ isIntersecting: false, target })));
  }
}

/**
 * A hook harness, hand-rolled for the same reason `useLiveWindow.test.ts` hand-rolls one: React 19
 * ships `act`, `react-dom/client` renders a probe into jsdom, and a testing library would be two
 * new dependencies to do what fifteen lines already do.
 */
function renderHook(hook: () => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const Probe = () => {
    hook();
    return null;
  };
  const render = () => act(() => void root.render(createElement(Probe)));
  render();
  return {
    rerender: render,
    unmount: () => {
      act(() => void root.unmount());
      container.remove();
    },
  };
}

/** `n` sections marked for reveal, in the document, in order. */
function sections(n: number) {
  return Array.from({ length: n }, () => {
    const el = document.createElement("section");
    el.className = "rt-reveal";
    document.body.appendChild(el);
    return el;
  });
}

const revealed = (el: Element) => el.classList.contains("is-in");
const only = () => {
  expect(FakeObserver.instances).toHaveLength(1);
  return FakeObserver.instances[0];
};

let addEventListenerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  FakeObserver.instances = [];
  addEventListenerSpy = vi.spyOn(window, "addEventListener");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Did the hook subscribe to the print event? */
const watchesPrint = () => addEventListenerSpy.mock.calls.some(call => call[0] === "beforeprint");

describe("with IntersectionObserver available", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });

  it("watches every section that has not been revealed yet, and skips the ones that already have", () => {
    // The `:not(.is-in)` in the selector is what makes this hook cheap to re-run: a page that has
    // already scrolled to the bottom re-observes nothing when its deps change.
    const [a, b, c] = sections(3);
    b.classList.add("is-in");
    const hook = renderHook(() => useReveal());

    expect(only().observed).toStrictEqual([a, c]);
    hook.unmount();
  });

  it("reveals a section the moment it intersects, and stops watching that one only", () => {
    const [a, b] = sections(2);
    const hook = renderHook(() => useReveal());

    only().enter(a);
    expect(revealed(a)).toBe(true);
    expect(revealed(b)).toBe(false);
    // Unobserving the revealed node is what keeps a long page from re-running this callback for
    // every section on every scroll frame.
    expect(only().unobserved).toStrictEqual([a]);
    hook.unmount();
  });

  it("leaves a section alone while it is being watched but is not on screen", () => {
    const [a] = sections(1);
    const hook = renderHook(() => useReveal());

    only().miss(a);
    expect(revealed(a)).toBe(false);
    expect(only().unobserved).toStrictEqual([]);
    hook.unmount();
  });

  it("never re-hides what it has revealed, so a section does not flicker as it scrolls back out", () => {
    // This is the difference between a reveal and an animation: `is-in` is added, never removed,
    // and the observer stops reporting the node at all.
    const [a] = sections(1);
    const hook = renderHook(() => useReveal());

    only().enter(a);
    only().miss(a);
    expect(revealed(a)).toBe(true);
    hook.unmount();
  });

  it("reveals everything before a print, because a print never scrolls", () => {
    // Copy-to-PDF lays the whole page out at once. Without this, every section below the fold
    // prints at its pre-reveal opacity — which is to say, blank.
    const nodes = sections(3);
    const hook = renderHook(() => useReveal());
    expect(nodes.every(n => !revealed(n))).toBe(true);

    window.dispatchEvent(new Event("beforeprint"));
    expect(nodes.every(revealed)).toBe(true);
    hook.unmount();
  });

  it("watches with a threshold and a bottom margin, so a section reveals as it enters, not once centred", () => {
    // These two numbers are the reveal's timing. 0.18 fires when a section is barely in; the -8%
    // bottom margin holds it back until it is properly on screen rather than one pixel over.
    sections(1);
    const hook = renderHook(() => useReveal());

    expect(only().options).toStrictEqual({ threshold: 0.18, rootMargin: "0px 0px -8% 0px" });
    hook.unmount();
  });

  it("disconnects the observer and drops the print listener on unmount, so a closed page leaks neither", () => {
    // A leak here is a real bug rather than a tidiness point: the hook lives on the landing page,
    // and every client-side navigation away from it would strand an observer holding detached
    // nodes plus a window listener that outlives them.
    const nodes = sections(2);
    const hook = renderHook(() => useReveal());
    hook.unmount();

    expect(only().disconnected).toBe(1);
    nodes.forEach(n => n.classList.remove("is-in"));
    window.dispatchEvent(new Event("beforeprint"));
    expect(nodes.some(revealed)).toBe(false);
  });

  it("does nothing whatsoever when there is nothing left to reveal", () => {
    // The landing page calls this on every deps change. With no unrevealed sections it must not
    // construct an observer or register a listener it would then have to clean up.
    const [a] = sections(1);
    a.classList.add("is-in");
    const hook = renderHook(() => useReveal());

    expect(FakeObserver.instances).toStrictEqual([]);
    expect(watchesPrint()).toBe(false);
    hook.unmount();
  });

  it("picks up sections that appear later when its deps change, and retires the previous observer", () => {
    // The page passes deps precisely because its sections are rendered from polled data: content
    // that arrives after the first paint has to be observed by a fresh pass.
    let generation = 0;
    const [first] = sections(1);
    const hook = renderHook(() => useReveal([generation]));
    expect(FakeObserver.instances[0].observed).toStrictEqual([first]);

    const [late] = sections(1);
    generation = 1;
    hook.rerender();

    expect(FakeObserver.instances).toHaveLength(2);
    expect(FakeObserver.instances[0].disconnected).toBe(1);
    // The already-observed section is not observed twice; only the new one is picked up.
    expect(FakeObserver.instances[1].observed).toStrictEqual([first, late]);
    hook.unmount();
  });
});

describe("with no IntersectionObserver at all", () => {
  it("shows every section immediately rather than leaving the page blank", () => {
    // jsdom has no IntersectionObserver, and neither do the older browsers this fallback exists
    // for. Failing open is the only acceptable behaviour: a page whose content is hidden by an
    // animation that can never run is a page with no content.
    expect(typeof IntersectionObserver).toBe("undefined");
    const nodes = sections(3);
    const hook = renderHook(() => useReveal());

    expect(nodes.every(revealed)).toBe(true);
    // Nothing was scheduled, so there is nothing to tear down — including no print listener,
    // since everything is already revealed.
    expect(watchesPrint()).toBe(false);
    expect(() => hook.unmount()).not.toThrow();
  });
});
