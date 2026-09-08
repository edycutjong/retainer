import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/retainer/status` — the read-only view the countdown polls.
 *
 * Only viem's clients are replaced, at the transport boundary, exactly as
 * `retainer.server.test.ts` does it: the route, `services/retainer/server` and the ABI decoding
 * between them all run for real, and the only thing that does not happen is the RPC call. So
 * nothing here claims a chain did anything — what is asserted is the code that decides what to
 * say when the chain answers, and what to say when it does not.
 *
 * The second half is the point. This route makes three reads and treats them differently on
 * purpose: `subscriptionOf` is the window itself, and if it fails there is nothing honest to
 * return, so the route answers 502. The gas reserve and the metered usage are auxiliary, and the
 * public Hedera relay occasionally refuses a plain view read with a spurious revert. A judge who
 * hits a 502 because *that* failed sees a dead product. So the degraded path is a product
 * feature and is pinned here from both directions: a failing auxiliary read must NOT become a
 * 502, and it must NOT be filled in with a plausible-looking number either — it comes back
 * `null`, named in `unavailable`, with the window state untouched beside it.
 */

const viemStub = vi.hoisted(() => {
  const readContract = vi.fn();
  const http = vi.fn((url?: string) => ({ transportUrl: url }) as never);
  const createPublicClient = vi.fn(() => ({ readContract }) as never);
  const createWalletClient = vi.fn(() => ({}) as never);
  return { readContract, http, createPublicClient, createWalletClient };
});

vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    http: viemStub.http,
    createPublicClient: viemStub.createPublicClient,
    createWalletClient: viemStub.createWalletClient,
  };
});

/** The address `deployedContracts` records for Hedera testnet (chain 296). */
const DEPLOYED_ADDRESS = "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931";
/** Deliberately lower-case: the route must answer with the checksummed form. */
const AGENT_LOWER = "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a";
const AGENT = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const SCHEDULE = "0x00000000000000000000000000000000004d2eb0";

/**
 * The tuple `subscriptionOf` returns, in the contract's positional order:
 * balance, pricePerPeriod, expiresAt, periodSeconds, active, schedule.
 */
function subTuple(overrides: { balance?: bigint; price?: bigint; expiresAt?: bigint; active?: boolean } = {}) {
  const { balance = 300_000_000n, price = 100_000_000n, expiresAt = 4_000_000_000n, active = true } = overrides;
  return [balance, price, expiresAt, 3600, active, SCHEDULE];
}

type ReadStubs = { sub?: unknown; reserve?: unknown; usage?: unknown };

/**
 * Answer each of the three reads by name rather than by call order.
 *
 * The route fires them through `Promise.allSettled`, so ordering is an implementation detail —
 * keying on `functionName` means a rejection lands on the read it was meant for even if the
 * route later reorders the array. An `Error` value rejects; anything else resolves.
 */
function stubReads({ sub = subTuple(), reserve = 12n, usage = [7, 100, 93] }: ReadStubs = {}) {
  const answers: Record<string, unknown> = { subscriptionOf: sub, renewalsRemaining: reserve, usageOf: usage };
  viemStub.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    const answer = answers[functionName];
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

/**
 * Load a fresh copy of the route.
 *
 * `services/retainer/server` caches its public client in a module-level variable and reads the
 * deployment out of a module this file sometimes needs to vary, so the graph has to be rebuilt
 * rather than reused.
 */
async function loadRoute({ deployed = true }: { deployed?: boolean } = {}) {
  if (deployed) {
    vi.doUnmock("~~/contracts/deployedContracts");
  } else {
    vi.doMock("~~/contracts/deployedContracts", () => ({ default: {} }));
  }
  vi.resetModules();
  return await import("~~/app/api/retainer/status/route");
}

/** Pin the wall clock so `now`, `secondsRemaining` and the expiry under test cannot disagree. */
function freezeClock(seconds = 1_757_289_600) {
  vi.spyOn(Date, "now").mockReturnValue(seconds * 1000);
  return seconds;
}

function request(query = `?agent=${AGENT_LOWER}`) {
  return new Request(`https://retainer.example/api/retainer/status${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  stubReads();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the agent parameter — a poll for nobody is a client error, not a chain read", () => {
  it("answers 400 and names the parameter when ?agent is absent, without touching the chain", async () => {
    const { GET } = await loadRoute();

    const res = await GET(request(""));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Provide ?agent=<evm address>" });
    expect(viemStub.readContract).not.toHaveBeenCalled();
  });

  it("answers 400 for something that is not an EVM address rather than asking the contract about it", async () => {
    const { GET } = await loadRoute();

    const res = await GET(request("?agent=not-an-address"));

    expect(res.status).toBe(400);
    expect(viemStub.readContract).not.toHaveBeenCalled();
  });
});

describe("a missing deployment — 503, and no invented state", () => {
  it("answers 503 with the named RetainerNotDeployedError message when nothing is deployed", async () => {
    const { GET } = await loadRoute({ deployed: false });

    const res = await GET(request());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "RetainerAccess is not deployed on the target network" });
    expect(viemStub.readContract).not.toHaveBeenCalled();
  });
});

describe("the window — the read the route cannot degrade", () => {
  it("returns the whole subscription, checksums the agent it was asked about, and names the contract", async () => {
    const { GET } = await loadRoute();

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agent).toBe(AGENT);
    expect(body.agent).not.toBe(AGENT_LOWER);
    expect(body.contract).toBe(DEPLOYED_ADDRESS);
    expect(body).toMatchObject({
      hasAccess: true,
      expiresAt: 4_000_000_000,
      periodSeconds: 3600,
      pricePerPeriodTinybar: "100000000",
      balanceTinybar: "300000000",
      periodsFunded: 3,
      active: true,
      nextRenewalSchedule: SCHEDULE,
      renewalsReserveCanArm: 12,
      usage: { used: 7, allowance: 100, remaining: 93 },
      unavailable: [],
    });
    // The tinybar amounts cross a JSON boundary, so they must be strings: a uint256 balance does
    // not survive a Number, and silently rounding a balance misreports how long the window lasts.
    expect(typeof body.balanceTinybar).toBe("string");
    expect(typeof body.pricePerPeriodTinybar).toBe("string");
    // The checksummed address is what actually reached the contract, not the lower-case input.
    expect(viemStub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: DEPLOYED_ADDRESS, functionName: "subscriptionOf", args: [AGENT] }),
    );
  });

  it("answers the gate's own question from the same expiry the contract stores, and counts down to it", async () => {
    const now = freezeClock();
    const { GET } = await loadRoute();
    stubReads({ sub: subTuple({ expiresAt: BigInt(now + 90) }) });

    const body = await (await GET(request())).json();

    expect(body.hasAccess).toBe(true);
    expect(body.now).toBe(now);
    expect(body.secondsRemaining).toBe(90);
  });

  it("reports an expired window as closed with zero remaining, never a negative countdown", async () => {
    const now = freezeClock();
    const { GET } = await loadRoute();
    stubReads({ sub: subTuple({ expiresAt: BigInt(now - 3600), active: false }) });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hasAccess).toBe(false);
    expect(body.secondsRemaining).toBe(0);
    expect(body.active).toBe(false);
  });

  it("reports zero funded periods for a subscription with no price, instead of dividing by zero", async () => {
    const { GET } = await loadRoute();
    stubReads({ sub: subTuple({ balance: 500_000_000n, price: 0n }) });

    const body = await (await GET(request())).json();

    expect(body.periodsFunded).toBe(0);
    expect(body.pricePerPeriodTinybar).toBe("0");
  });

  it("floors the funded-period count rather than promising a renewal the balance cannot pay for", async () => {
    const { GET } = await loadRoute();
    stubReads({ sub: subTuple({ balance: 250_000_000n, price: 100_000_000n }) });

    const body = await (await GET(request())).json();

    expect(body.periodsFunded).toBe(2);
  });

  it("answers 502 when the window read itself fails, because there is nothing honest to return", async () => {
    const { GET } = await loadRoute();
    stubReads({ sub: new Error("relay refused the call") });

    const res = await GET(request());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Failed to read RetainerAccess" });
  });
});

describe("the degraded path — a spurious relay revert on an auxiliary read is not an outage", () => {
  it("still returns 200 and the full window when the gas-reserve read reverts, reporting null and naming it", async () => {
    const { GET } = await loadRoute();
    stubReads({ reserve: new Error("execution reverted") });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.renewalsReserveCanArm).toBeNull();
    expect(body.unavailable).toEqual(["renewalsReserveCanArm"]);
    // The window — the thing the countdown draws — is unaffected by the auxiliary failure.
    expect(body.hasAccess).toBe(true);
    expect(body.expiresAt).toBe(4_000_000_000);
    expect(body.periodsFunded).toBe(3);
    // And the read that did answer is still reported.
    expect(body.usage).toEqual({ used: 7, allowance: 100, remaining: 93 });
  });

  it("still returns 200 when the usage read reverts, and does not invent a call count the chain did not give", async () => {
    const { GET } = await loadRoute();
    stubReads({ usage: new Error("execution reverted") });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.usage).toBeNull();
    expect(body.unavailable).toEqual(["usage"]);
    expect(body.renewalsReserveCanArm).toBe(12);
    // `null` means unread. A zero here would read as "this agent has made no calls", which is a
    // different claim entirely and one the chain did not make.
    expect(body.usage).not.toEqual({ used: 0, allowance: 0, remaining: 0 });
  });

  it("names both auxiliary reads when both revert and still serves the window", async () => {
    const { GET } = await loadRoute();
    stubReads({ reserve: new Error("execution reverted"), usage: new Error("execution reverted") });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unavailable).toEqual(["renewalsReserveCanArm", "usage"]);
    expect(body.renewalsReserveCanArm).toBeNull();
    expect(body.usage).toBeNull();
    expect(body.hasAccess).toBe(true);
  });

  it("logs each failed auxiliary read, so a degraded response is not a silent one", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await loadRoute();
    stubReads({ reserve: new Error("reserve reverted"), usage: new Error("usage reverted") });

    await GET(request());

    const logged = consoleError.mock.calls.map(call => String(call[0]));
    expect(logged).toContain("[api/retainer/status] renewalsRemaining() read failed");
    expect(logged).toContain("[api/retainer/status] usageOf() read failed");
  });

  it("makes all three reads concurrently, so one slow relay call does not serialise the poll", async () => {
    const { GET } = await loadRoute();
    let started = 0;
    const answers: Record<string, unknown> = {
      subscriptionOf: subTuple(),
      renewalsRemaining: 12n,
      usageOf: [7, 100, 93],
    };
    viemStub.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      started += 1;
      // Resolve only once every read has been issued: a sequential route would deadlock here.
      await vi.waitFor(() => expect(started).toBe(3));
      return answers[functionName];
    });

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(started).toBe(3);
  });
});
