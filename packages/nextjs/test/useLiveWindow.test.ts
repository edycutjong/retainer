// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_AGENT,
  type Status,
  ZERO,
  clock,
  hbar,
  isAddress,
  short,
  useLiveWindow,
} from "~~/components/landing/useLiveWindow";

/**
 * The live window is a state machine over a polled endpoint, and the interesting part is not what
 * it displays — it is what it *decides*: that a window which moved forward is a renewal worth
 * announcing, that one failed read is noise and two are news, that a different address is a
 * different subscription whose story starts from nothing.
 *
 * ── What is real here and what is not ──────────────────────────────────────────────────────
 *
 * Nothing in this file touches Hedera, and nothing in it is evidence about Hedera. The fixtures
 * below are invented numbers fed to `fetch` so that the hook's own branches can be driven; they
 * prove that the hook reacts correctly to a shape of response, and they prove nothing whatsoever
 * about what the chain would actually put in that shape. The chain's behaviour is tested against
 * a real network in `packages/hardhat/test` and recorded in `docs/proof.md`.
 *
 * The one thing being stubbed is the boundary the hook itself draws: `/api/retainer/status`.
 * Everything on this side of it is ours.
 */

const wagmi = vi.hoisted(() => ({ address: undefined as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: wagmi.address }) }));

const OTHER_AGENT = "0x1111111111111111111111111111111111111111";

/** A response shaped like the endpoint's, with invented values. See the note above. */
function statusBody(over: Partial<Status> = {}): Status {
  return {
    agent: DEMO_AGENT,
    contract: "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931",
    hasAccess: true,
    expiresAt: 1_000_000,
    secondsRemaining: 90,
    periodSeconds: 90,
    pricePerPeriodTinybar: "100000000",
    balanceTinybar: "300000000",
    periodsFunded: 3,
    active: true,
    nextRenewalSchedule: "0.0.10416728",
    renewalsReserveCanArm: 3,
    usage: { used: 0, allowance: 5, remaining: 5 },
    now: 1_000_000,
    ...over,
  };
}

const ok = (body: Status) => ({ ok: true, json: async () => body });
const notOk = (body: unknown) => ({ ok: false, json: async () => body });

/**
 * A hook harness, deliberately hand-rolled: React 19 ships `act`, and `react-dom/client` renders
 * a probe component into jsdom, so a testing library and its peer would add two dependencies to
 * do what twenty lines already do.
 */
function renderHook<T>(hook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const handle = {
    current: undefined as unknown as T,
    rerender: () => {},
    unmount: () => {},
  };
  const Probe = () => {
    handle.current = hook();
    return null;
  };
  const render = () => act(() => void root.render(createElement(Probe)));
  render();
  handle.rerender = render;
  handle.unmount = () => {
    act(() => void root.unmount());
    container.remove();
  };
  return handle;
}

/** Let React and any in-flight fetch settle without moving the clock. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
/** Move the clock, then let everything it triggered settle. */
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

const POLL_MS = 4000;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  wagmi.address = undefined;
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => ok(statusBody()));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("address handling — the gate in front of every chain read", () => {
  it("accepts a 20-byte hex address in either case and rejects everything that merely looks like one", () => {
    expect(isAddress(DEMO_AGENT)).toBe(true);
    expect(isAddress(DEMO_AGENT.toLowerCase())).toBe(true);
    expect(isAddress(ZERO)).toBe(true);
    expect(isAddress("")).toBe(false);
    expect(isAddress(DEMO_AGENT.slice(0, -1))).toBe(false); // 39 nibbles
    expect(isAddress(`${DEMO_AGENT}0`)).toBe(false); // 41 nibbles
    expect(isAddress(DEMO_AGENT.slice(2))).toBe(false); // no 0x prefix
    expect(isAddress(`0x${"g".repeat(40)}`)).toBe(false); // not hex
    expect(isAddress(` ${DEMO_AGENT}`)).toBe(false); // why setAgent trims before storing
  });

  it("names a demo agent and a zero address that are both well-formed, since the page renders them unchecked", () => {
    expect(ZERO).toBe(`0x${"0".repeat(40)}`);
    expect(isAddress(DEMO_AGENT)).toBe(true);
    expect(DEMO_AGENT).not.toBe(ZERO);
  });
});

describe("the display helpers", () => {
  // Grouping and decimal marks are the runtime's, not ours, so the assertions compare values.
  const parts = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).formatToParts(1234.5678);
  const group = parts.find(p => p.type === "group")?.value ?? "";
  const decimal = parts.find(p => p.type === "decimal")?.value ?? ".";
  const valueOf = (s: string) => Number((group ? s.split(group).join("") : s).replace(decimal, "."));

  it("renders tinybar as HBAR at 1e8 — the boundary that silently misprices by ten orders of magnitude if it drifts", () => {
    expect(hbar("100000000")).toBe("1");
    expect(hbar("0")).toBe("0");
    expect(valueOf(hbar("250000000"))).toBe(2.5);
    expect(valueOf(hbar("154896000"))).toBeCloseTo(1.549, 6);
    // The weibar factor is 1e18. If it ever leaks in here, one HBAR renders as ten billionths.
    expect(valueOf(hbar("100000000"))).toBe(1);
  });

  it("never shows more than four decimal places, because the fifth is noise at the size a fee is quoted", () => {
    for (const tinybar of ["1", "12345678", "99999999", "154896000", "123456789012"]) {
      const rendered = hbar(tinybar);
      const fraction = rendered.includes(decimal) ? rendered.split(decimal)[1] : "";
      expect(fraction.length).toBeLessThanOrEqual(4);
      expect(valueOf(rendered)).toBeCloseTo(Number(tinybar) / 1e8, 4);
    }
  });

  it("clocks the countdown as zero-padded mm:ss, and keeps counting in minutes past the hour", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(9)).toBe("00:09");
    expect(clock(59)).toBe("00:59");
    expect(clock(60)).toBe("01:00");
    expect(clock(90)).toBe("01:30");
    // A funding period is minutes, never hours, so mm rolls past 59 rather than growing an hh field.
    expect(clock(3600)).toBe("60:00");
  });

  it("shortens an address to its first six and last four characters, which is what makes two agents distinguishable", () => {
    expect(short(DEMO_AGENT)).toBe("0xD14C…Cc66");
    expect(short(ZERO)).toBe("0x0000…0000");
    expect(short(DEMO_AGENT)).toHaveLength(11);
  });
});

describe("the live window — what it does before an address exists", () => {
  it("reads nothing at all until it has an address worth reading, and reports itself as not loading", () => {
    const hook = renderHook(useLiveWindow);
    expect(hook.current.agent).toBe("");
    expect(hook.current.valid).toBe(false);
    expect(hook.current.loading).toBe(false);
    expect(hook.current.status).toBeNull();
    expect(hook.current.log).toStrictEqual([]);
    expect(hook.current.flash).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("ignores a half-typed address rather than asking the contract about it", async () => {
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent("0xD14CA86A"));
    await advance(POLL_MS * 3);
    expect(hook.current.valid).toBe(false);
    expect(hook.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("adopts the connected wallet as the agent, so a visitor who connects sees their own subscription", async () => {
    wagmi.address = DEMO_AGENT;
    const hook = renderHook(useLiveWindow);
    await settle();
    expect(hook.current.agent).toBe(DEMO_AGENT);
    expect(hook.current.valid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("does not hijack an address the visitor typed when a wallet connects afterwards", async () => {
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(OTHER_AGENT));
    await settle();
    wagmi.address = DEMO_AGENT;
    hook.rerender();
    await settle();
    expect(hook.current.agent).toBe(OTHER_AGENT);
    hook.unmount();
  });

  it("trims a pasted address, because a trailing space is the difference between valid and invalid", async () => {
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(`  ${DEMO_AGENT}\n`));
    await settle();
    expect(hook.current.agent).toBe(DEMO_AGENT);
    expect(hook.current.valid).toBe(true);
    hook.unmount();
  });
});

describe("the live window — polling", () => {
  it("reads once immediately and then every four seconds, always uncached and always for the current agent", async () => {
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/retainer/status?agent=${DEMO_AGENT}`);
    // A cached read would make a renewal invisible, which is the one thing the page exists to show.
    expect(fetchMock.mock.calls[0][1]).toStrictEqual({ cache: "no-store" });

    await advance(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    hook.unmount();
  });

  it("is loading only between the first read being asked for and the first answer landing", async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise(r => (release = r)));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expect(hook.current.loading).toBe(true);
    await act(async () => {
      release(ok(statusBody()));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.current.loading).toBe(false);
    expect(hook.current.status).not.toBeNull();
    hook.unmount();
  });

  it("takes the countdown from the chain read and then ticks it down locally, without polling every second", async () => {
    fetchMock.mockImplementation(async () => ok(statusBody({ secondsRemaining: 30 })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expect(hook.current.remaining).toBe(30);

    await advance(3000);
    // Three seconds of local ticking cost no extra reads beyond the scheduled 4s poll.
    expect(hook.current.remaining).toBe(27);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("floors the local countdown at zero rather than counting into negative time", async () => {
    fetchMock.mockImplementation(async () => ok(statusBody({ secondsRemaining: 2, expiresAt: 1_000_000 })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    await advance(10_000);
    expect(hook.current.remaining).toBe(0);
    hook.unmount();
  });

  it("stops reading the moment it is unmounted, so a closed page leaves nothing polling", async () => {
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hook.unmount();
    await advance(POLL_MS * 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the live window — recognising a renewal", () => {
  it("says nothing on the first read, because one observation is not a change", async () => {
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expect(hook.current.status).not.toBeNull();
    expect(hook.current.log).toStrictEqual([]);
    expect(hook.current.flash).toBe(false);
    hook.unmount();
  });

  it("says nothing when two reads describe the same window, however many times it is polled", async () => {
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    await advance(POLL_MS * 4);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(4);
    expect(hook.current.log).toStrictEqual([]);
    expect(hook.current.flash).toBe(false);
    hook.unmount();
  });

  it("announces a renewal when the window moves forward, and stops announcing it 2.2 seconds later", async () => {
    let expiresAt = 1_000_000;
    fetchMock.mockImplementation(async () => ok(statusBody({ expiresAt, now: expiresAt - 90 })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();

    expiresAt += 90;
    await advance(POLL_MS);
    expect(hook.current.flash).toBe(true);
    expect(hook.current.log).toHaveLength(1);
    expect(hook.current.log[0].kind).toBe("renewed");
    expect(hook.current.log[0].detail).toContain("no user, no server, no cron");
    expect(hook.current.log[0].at).toBe(expiresAt - 90);

    // The flash is an announcement, not a state: it has to end on its own.
    await advance(2100);
    expect(hook.current.flash).toBe(true);
    await advance(200);
    expect(hook.current.flash).toBe(false);
    hook.unmount();
  });

  it("re-announces each further renewal and restarts the flash rather than letting the first one end it", async () => {
    let expiresAt = 1_000_000;
    fetchMock.mockImplementation(async () => ok(statusBody({ expiresAt })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();

    expiresAt += 90;
    await advance(POLL_MS);
    expect(hook.current.flash).toBe(true);
    expiresAt += 90;
    await advance(POLL_MS);
    expect(hook.current.log).toHaveLength(2);
    expect(hook.current.flash).toBe(true);
    // 2.2s after the FIRST renewal has now passed; the second one's flash must still be running.
    await advance(1000);
    expect(hook.current.flash).toBe(true);
    hook.unmount();
  });

  it("never announces a window that went backwards, which is a stale read rather than a renewal", async () => {
    let expiresAt = 1_000_000;
    fetchMock.mockImplementation(async () => ok(statusBody({ expiresAt })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expiresAt -= 90;
    await advance(POLL_MS);
    expect(hook.current.log).toStrictEqual([]);
    expect(hook.current.flash).toBe(false);
    hook.unmount();
  });

  it("keeps the six most recent events, newest first, and drops the rest", async () => {
    let expiresAt = 1_000_000;
    fetchMock.mockImplementation(async () => ok(statusBody({ expiresAt })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();

    for (let i = 0; i < 8; i++) {
      expiresAt += 90;
      await advance(POLL_MS);
    }
    expect(hook.current.log).toHaveLength(6);
    const ids = hook.current.log.map(e => e.id);
    expect(ids).toStrictEqual([8, 7, 6, 5, 4, 3]);
    hook.unmount();
  });
});

describe("the live window — recognising a metered call", () => {
  it("logs a metered call when on-chain usage rises, quoting the allowance left in this period", async () => {
    let used = 0;
    fetchMock.mockImplementation(async () => ok(statusBody({ usage: { used, allowance: 5, remaining: 5 - used } })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expect(hook.current.log).toStrictEqual([]);

    used = 1;
    await advance(POLL_MS);
    expect(hook.current.log).toHaveLength(1);
    expect(hook.current.log[0].kind).toBe("metered");
    expect(hook.current.log[0].detail).toBe("call metered on-chain · 4 of 5 left this period");
    hook.unmount();
  });

  it("says nothing while usage is unchanged, and nothing at all when the usage read is unavailable", async () => {
    fetchMock.mockImplementation(async () => ok(statusBody({ usage: null, unavailable: ["usage"] })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    await advance(POLL_MS * 3);
    // `null` usage is "the chain did not answer", not "zero calls" — inventing a change here would
    // put a metered event on the page that never happened.
    expect(hook.current.log).toStrictEqual([]);
    expect(hook.current.status?.usage).toBeNull();
    hook.unmount();
  });

  it("does not treat the first usage reading after an unavailable one as a jump from zero", async () => {
    let usage: Status["usage"] = null;
    fetchMock.mockImplementation(async () => ok(statusBody({ usage })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();

    usage = { used: 3, allowance: 5, remaining: 2 };
    await advance(POLL_MS);
    expect(hook.current.log).toStrictEqual([]);

    usage = { used: 4, allowance: 5, remaining: 1 };
    await advance(POLL_MS);
    expect(hook.current.log).toHaveLength(1);
    expect(hook.current.log[0].kind).toBe("metered");
    hook.unmount();
  });

  it("records a renewal and a metered call from the same read as two separate events", async () => {
    let expiresAt = 1_000_000;
    let used = 0;
    fetchMock.mockImplementation(async () =>
      ok(statusBody({ expiresAt, usage: { used, allowance: 5, remaining: 5 - used } })),
    );
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();

    expiresAt += 90;
    used = 2;
    await advance(POLL_MS);
    expect(hook.current.log.map(e => e.kind)).toStrictEqual(["metered", "renewed"]);
    hook.unmount();
  });

  it("gives two events from the same read distinct ids, so the keyed list has no duplicate key", async () => {
    // Regression. `seq.current += 1` runs immediately, but reading `id: seq.current` inside the
    // setState updater does not: React defers the updater, so by the time it ran BOTH increments
    // had happened and a renewal and a metered call arriving in the same poll came out numbered
    // identically. The log is rendered as a keyed list, so that was a duplicate React key.
    // Fixed by capturing the number before building the updater; this test is what proves it.
    let expiresAt = 1_000_000;
    let used = 0;
    fetchMock.mockImplementation(async () =>
      ok(statusBody({ expiresAt, usage: { used, allowance: 5, remaining: 5 - used } })),
    );
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();

    expiresAt += 90;
    used = 2;
    await advance(POLL_MS);
    expect(hook.current.log).toHaveLength(2);
    expect(new Set(hook.current.log.map(e => e.id)).size).toBe(2);
    hook.unmount();
  });
});

describe("the live window — a read that fails", () => {
  it("treats a single spurious revert as noise: no error shown, last good state left on screen", async () => {
    fetchMock.mockImplementationOnce(async () => ok(statusBody({ periodsFunded: 3 })));
    fetchMock.mockImplementationOnce(async () => notOk({ error: "CONTRACT_REVERT_EXECUTED" }));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    const good = hook.current.status;

    await advance(POLL_MS);
    expect(hook.current.error).toBeNull();
    expect(hook.current.status).toBe(good);
    hook.unmount();
  });

  it("tells the visitor once a second read fails too, quoting the contract's own error and saying it is retrying", async () => {
    fetchMock.mockImplementation(async () => notOk({ error: "CONTRACT_REVERT_EXECUTED" }));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expect(hook.current.error).toBeNull();

    // The retry is fast and silent; only its failure is worth saying.
    await advance(1500);
    expect(hook.current.error).toBe("CONTRACT_REVERT_EXECUTED — retrying");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    hook.unmount();
  });

  it("falls back to a plain sentence when the failed response carries no error of its own", async () => {
    fetchMock.mockImplementation(async () => notOk({}));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    await advance(1500);
    expect(hook.current.error).toBe("Failed to read the contract — retrying");
    hook.unmount();
  });

  it("reports the transport's own message when the request never completes", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("network unreachable");
    });
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expect(hook.current.error).toBeNull();
    await advance(1500);
    expect(hook.current.error).toBe("network unreachable — retrying");
    hook.unmount();
  });

  it("still says something useful when what was thrown is not an Error at all", async () => {
    fetchMock.mockImplementation(async () => {
      throw "abort";
    });
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    await advance(1500);
    expect(hook.current.error).toBe("abort — retrying");
    hook.unmount();
  });

  it("clears the error and resumes as soon as a read succeeds again", async () => {
    fetchMock.mockImplementation(async () => notOk({ error: "CONTRACT_REVERT_EXECUTED" }));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    await advance(1500);
    expect(hook.current.error).not.toBeNull();

    fetchMock.mockImplementation(async () => ok(statusBody()));
    await advance(POLL_MS);
    expect(hook.current.error).toBeNull();
    expect(hook.current.status).not.toBeNull();
    hook.unmount();
  });

  it("is not 'loading' once it has an error, even though no status ever arrived", async () => {
    fetchMock.mockImplementation(async () => notOk({ error: "CONTRACT_REVERT_EXECUTED" }));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expect(hook.current.loading).toBe(true);
    await advance(1500);
    expect(hook.current.status).toBeNull();
    expect(hook.current.loading).toBe(false);
    hook.unmount();
  });

  it("leaves nothing scheduled after unmounting mid-retry", async () => {
    fetchMock.mockImplementation(async () => notOk({ error: "CONTRACT_REVERT_EXECUTED" }));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    hook.unmount();
    const calls = fetchMock.mock.calls.length;
    await advance(POLL_MS * 5);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

describe("the live window — changing agent", () => {
  it("starts the new subscription's story from nothing, so one agent's events never appear under another's", async () => {
    let expiresAt = 1_000_000;
    fetchMock.mockImplementation(async () => ok(statusBody({ expiresAt })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expiresAt += 90;
    await advance(POLL_MS);
    expect(hook.current.log).toHaveLength(1);

    act(() => hook.current.setAgent(OTHER_AGENT));
    expect(hook.current.agent).toBe(OTHER_AGENT);
    expect(hook.current.log).toStrictEqual([]);
    expect(hook.current.status).toBeNull();
    expect(hook.current.error).toBeNull();

    // And the first read of the new agent is a baseline, not a renewal.
    await settle();
    expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]).toContain(OTHER_AGENT);
    expect(hook.current.log).toStrictEqual([]);
    hook.unmount();
  });

  it("does not announce a renewal just because the new agent's window happens to be further out", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      ok(statusBody({ expiresAt: url.includes(OTHER_AGENT) ? 9_000_000 : 1_000_000 })),
    );
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    act(() => hook.current.setAgent(OTHER_AGENT));
    await settle();
    await advance(POLL_MS);
    expect(hook.current.log).toStrictEqual([]);
    hook.unmount();
  });

  it("cancels a pending retry when the agent changes, so the old agent is never read again", async () => {
    fetchMock.mockImplementation(async () => notOk({ error: "CONTRACT_REVERT_EXECUTED" }));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();

    act(() => hook.current.setAgent(OTHER_AGENT));
    await settle();
    const seen = fetchMock.mock.calls.length;
    await advance(1500);
    for (const call of fetchMock.mock.calls.slice(seen)) expect(call[0]).toContain(OTHER_AGENT);
    hook.unmount();
  });

  it("leaves everything alone when the same address is set again, so re-entering it is not a reset", async () => {
    let expiresAt = 1_000_000;
    fetchMock.mockImplementation(async () => ok(statusBody({ expiresAt })));
    const hook = renderHook(useLiveWindow);
    act(() => hook.current.setAgent(DEMO_AGENT));
    await settle();
    expiresAt += 90;
    await advance(POLL_MS);
    const log = hook.current.log;
    const status = hook.current.status;
    expect(log).toHaveLength(1);

    act(() => hook.current.setAgent(`  ${DEMO_AGENT}  `));
    await settle();
    expect(hook.current.log).toBe(log);
    expect(hook.current.status).toBe(status);
    hook.unmount();
  });
});
