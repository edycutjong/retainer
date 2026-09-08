import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/retainer/access` — the gate itself.
 *
 * Two boundaries are replaced and nothing else: viem's clients (so no RPC leaves the process,
 * exactly as in `retainer.server.test.ts`) and the facilitator's HTTP client (so no request
 * reaches Blocky402). Everything between them is the real thing — the route, the real
 * `x402ResourceServer`, the real `ExactHederaScheme`, the real base64 header codecs and the real
 * `services/retainer/server`. Nothing here asserts that a Hedera transaction happened; what it
 * asserts is what this route decides, and what it hands the agent when it decides it.
 *
 * Three of those decisions are the ones that would cost real money if they were wrong:
 *
 *   1. **the 402 challenge.** The requirements in the body and in the `PAYMENT-REQUIRED` header
 *      are the machine-readable price. A wrong amount, network or `payTo` is not a bug an agent
 *      can work around — it pays the wrong seller, or it cannot pay at all. So the challenge is
 *      not merely asserted to exist: it is decoded and paid, and the payload built from it is
 *      fed back into the same route.
 *   2. **the paid path's ordering.** `subscribeFor` must be mined before the route answers. When
 *      it was not, the agent's next request still read no subscription on-chain, got another 402
 *      and paid a second time for access it had already bought. That ordering is pinned below
 *      with a receipt that has not arrived yet.
 *   3. **failing closed.** With `RETAINER_PAY_TO` unset the route has nowhere to send money, and
 *      the only safe answer is to serve nothing at all.
 */

const viemStub = vi.hoisted(() => {
  const readContract = vi.fn();
  const simulateContract = vi.fn();
  const waitForTransactionReceipt = vi.fn(async () => ({ status: "success" }));
  const writeContract = vi.fn(async () => "0xwritehash");
  const http = vi.fn((url?: string) => ({ transportUrl: url }) as never);
  const createPublicClient = vi.fn(() => ({ readContract, simulateContract, waitForTransactionReceipt }) as never);
  const createWalletClient = vi.fn(
    (config: { account: unknown }) => ({ account: config.account, writeContract }) as never,
  );
  return {
    readContract,
    simulateContract,
    waitForTransactionReceipt,
    writeContract,
    http,
    createPublicClient,
    createWalletClient,
  };
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

/**
 * The facilitator is an HTTP service, so only its client is stubbed. The resource server and the
 * Hedera exact scheme around it are the real library code, which is the point: the requirements
 * asserted below are the ones x402 actually builds, not ones this test wrote down.
 */
const facilitatorStub = vi.hoisted(() => {
  const constructed = vi.fn();
  const getSupported = vi.fn(async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.7162784" } }],
    extensions: [],
    signers: {},
  }));
  const verify = vi.fn(async () => ({ isValid: true }) as Record<string, unknown>);
  const settle = vi.fn(
    async () =>
      ({
        success: true,
        transaction: "0.0.4783194@1757280000.000000000",
        network: "hedera:testnet",
        payer: "0.0.4783194",
      }) as Record<string, unknown>,
  );
  return { constructed, getSupported, verify, settle };
});

vi.mock("@x402/core/server", async importOriginal => {
  const actual = await importOriginal<typeof import("@x402/core/server")>();
  return {
    ...actual,
    HTTPFacilitatorClient: class {
      constructor(config: { url: string }) {
        facilitatorStub.constructed(config);
      }
      getSupported = facilitatorStub.getSupported;
      verify = facilitatorStub.verify;
      settle = facilitatorStub.settle;
    },
  };
});

/** The address `deployedContracts` records for Hedera testnet (chain 296). */
const DEPLOYED_ADDRESS = "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931";
const AGENT_LOWER = "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a";
const AGENT = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const SCHEDULE = "0x00000000000000000000000000000000004d2eb0";
/** The seller's Hedera account. Getting this wrong pays the wrong person. */
const PAY_TO = "0.0.4783193";
const SERVER_KEY = "11".repeat(32);

/** balance, pricePerPeriod, expiresAt, periodSeconds, active, schedule — the contract's order. */
function subTuple({ expiresAt = 4_000_000_000n }: { expiresAt?: bigint } = {}) {
  return [300_000_000n, 100_000_000n, expiresAt, 3600, true, SCHEDULE];
}

/** Answer the two gate reads by name; `open` is what `hasAccess` says. */
function stubGate({ open, sub = subTuple() }: { open: boolean | Error; sub?: unknown }) {
  const answers: Record<string, unknown> = { hasAccess: open, subscriptionOf: sub };
  viemStub.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    const answer = answers[functionName];
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

/** The mirror node's exchange-rate response — the thing actually being sold. */
function stubFeed({ ok = true }: { ok?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 503,
      json: async () => ({
        current_rate: { cent_equivalent: 1234, hbar_equivalent: 100, expiration_time: 1_757_283_600 },
      }),
    })),
  );
}

/** `payTo: null` leaves `RETAINER_PAY_TO` genuinely absent, which is not the same as empty. */
type LoadOptions = { deployed?: boolean; payTo?: string | null; price?: string; periods?: string };

/**
 * Load a fresh copy of the route.
 *
 * Necessary rather than tidy: `RETAINER_PAY_TO` is read into a module-level constant, the
 * resource server caches its initialised promise, and `services/retainer/server` caches its
 * public client — so a configuration change only takes effect on a rebuilt module graph.
 */
async function loadRoute({ deployed = true, payTo = PAY_TO, price, periods }: LoadOptions = {}) {
  if (payTo !== null) vi.stubEnv("RETAINER_PAY_TO", payTo);
  vi.stubEnv("RETAINER_SERVER_KEY", SERVER_KEY);
  if (price !== undefined) vi.stubEnv("RETAINER_PRICE_TINYBAR", price);
  if (periods !== undefined) vi.stubEnv("RETAINER_PERIODS_PER_PURCHASE", periods);

  if (deployed) {
    vi.doUnmock("~~/contracts/deployedContracts");
  } else {
    vi.doMock("~~/contracts/deployedContracts", () => ({ default: {} }));
  }
  vi.resetModules();
  return await import("~~/app/api/retainer/access/route");
}

function request(query = `?agent=${AGENT_LOWER}`, headers: Record<string, string> = {}) {
  return new Request(`https://retainer.example/api/retainer/access${query}`, { headers });
}

/** Encode a payment payload the way an x402 client does: plain base64 of the JSON. */
function encodePayload(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

/**
 * Take the 402 the route just issued and pay it.
 *
 * The payload's `accepted` is the requirement the route itself published, so a challenge that
 * quoted the wrong price or network would produce a payment that no longer matches it. That
 * round trip is the assertion: the 402 this route emits has to be payable.
 */
async function payChallenge(
  GET: (req: Request) => Promise<Response>,
  {
    header = "PAYMENT-SIGNATURE",
    mutate,
  }: { header?: string; mutate?: (accepted: Record<string, unknown>) => void } = {},
) {
  const challenge = await (await GET(request())).json();
  const accepted = challenge.accepts[0] as Record<string, unknown>;
  mutate?.(accepted);
  const payload = { x402Version: 2, accepted, payload: { signedTransaction: "0xdeadbeef" } };
  return request(`?agent=${AGENT_LOWER}`, { [header]: encodePayload(payload) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  viemStub.waitForTransactionReceipt.mockResolvedValue({ status: "success" } as never);
  viemStub.writeContract.mockResolvedValue("0xwritehash" as never);
  viemStub.simulateContract.mockResolvedValue({ request: { functionName: "meter" }, result: 93 } as never);
  facilitatorStub.verify.mockResolvedValue({ isValid: true });
  facilitatorStub.settle.mockResolvedValue({
    success: true,
    transaction: "0.0.4783194@1757280000.000000000",
    network: "hedera:testnet",
    payer: "0.0.4783194",
  });
  stubFeed();
  stubGate({ open: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the guard rails — questions the gate refuses before it costs anybody anything", () => {
  it("answers 400 and names the parameter when ?agent is absent, without reading the chain", async () => {
    const { GET } = await loadRoute();

    const res = await GET(request(""));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Provide ?agent=<evm address>" });
    expect(viemStub.readContract).not.toHaveBeenCalled();
  });

  it("answers 400 for something that is not an EVM address rather than opening a payment challenge", async () => {
    const { GET } = await loadRoute();

    const res = await GET(request("?agent=0xnope"));

    expect(res.status).toBe(400);
    expect(facilitatorStub.constructed).not.toHaveBeenCalled();
  });

  it("answers 503 with the named RetainerNotDeployedError message when nothing is deployed", async () => {
    const { GET } = await loadRoute({ deployed: false });

    const res = await GET(request());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "RetainerAccess is not deployed on the target network" });
  });

  it("answers 502 when the gate read fails, instead of guessing which side of the gate the agent is on", async () => {
    const { GET } = await loadRoute();
    stubGate({ open: new Error("relay refused the call") });

    const res = await GET(request());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Failed to read RetainerAccess" });
    // A failed read must not fall through into a charge.
    expect(facilitatorStub.settle).not.toHaveBeenCalled();
  });
});

describe("an open window — the second request, which is the entire product", () => {
  it("serves the feed with no payment, no challenge and no contact with the facilitator at all", async () => {
    const { GET } = await loadRoute();
    stubGate({ open: true });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.access).toBe("granted");
    expect(body.paidThisRequest).toBe(false);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeNull();
    // Nothing about a payment rail was even constructed: an open window costs the agent nothing
    // and costs the seller no facilitator round trip.
    expect(facilitatorStub.constructed).not.toHaveBeenCalled();
    expect(facilitatorStub.settle).not.toHaveBeenCalled();
    expect(body.subscription).toMatchObject({
      expiresAt: 4_000_000_000,
      periodSeconds: 3600,
      balanceTinybar: "300000000",
      active: true,
      nextRenewalSchedule: SCHEDULE,
    });
    expect(body.resource).toMatchObject({ pair: "HBAR/USD", rate: 0.1234 });
  });

  it("counts the call against the on-chain allowance BEFORE serving, and reports what is left", async () => {
    const { GET } = await loadRoute();
    stubGate({ open: true });
    const order: string[] = [];
    viemStub.simulateContract.mockImplementation(async () => {
      order.push("meter");
      return { request: { functionName: "meter" }, result: 41 };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        order.push("feed");
        return { ok: true, json: async () => ({ current_rate: { cent_equivalent: 1234, hbar_equivalent: 100 } }) };
      }),
    );

    const body = await (await GET(request())).json();

    // A period buys a countable quantity of the feed. Serving first and metering afterwards
    // would give away the call that the allowance was supposed to gate.
    expect(order).toEqual(["meter", "feed"]);
    expect(body.metering).toMatchObject({ callsRemainingThisPeriod: 41, recordedOnChain: "0xwritehash" });
  });

  it("reports zero seconds remaining rather than a negative countdown when the window has just lapsed", async () => {
    const { GET } = await loadRoute();
    stubGate({ open: true, sub: subTuple({ expiresAt: 1_000_000_000n }) });

    const body = await (await GET(request())).json();

    expect(body.subscription.secondsRemaining).toBe(0);
    expect(body.subscription.expiresAt).toBe(1_000_000_000);
  });

  it("answers 429 — not a fresh 402 — when the calls the period bought are spent", async () => {
    const { GET } = await loadRoute();
    stubGate({ open: true });
    viemStub.simulateContract.mockRejectedValue(new Error('The contract function "meter" reverted. QuotaExhausted()'));

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.access).toBe("quota exhausted");
    // The crucial claim: an exhausted allowance is not a new sale. Charging again here would
    // bill the agent twice for a window it has already paid for.
    expect(body.paidThisRequest).toBe(false);
    expect(facilitatorStub.settle).not.toHaveBeenCalled();
    expect(body.why).toMatch(/next scheduled renewal refills the allowance/);
    // Nothing leaks the revert text to the caller on the expected failure.
    expect(body.detail).toBeUndefined();
    expect(body.subscription).toMatchObject({ expiresAt: 4_000_000_000, nextRenewalSchedule: SCHEDULE });
  });

  it("answers 502 with the underlying message when metering fails for a reason that is not exhaustion", async () => {
    const { GET } = await loadRoute();
    stubGate({ open: true });
    viemStub.simulateContract.mockRejectedValue(new Error("relay refused the simulate"));

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.access).toBe("error");
    expect(body.paidThisRequest).toBe(false);
    expect(body.why).toBe("could not record the metered call");
    expect(body.detail).toBe("relay refused the simulate");
  });

  it("still reports a non-Error rejection as text instead of dropping it into an empty detail", async () => {
    const { GET } = await loadRoute();
    stubGate({ open: true });
    viemStub.simulateContract.mockRejectedValue("relay closed the socket");

    const res = await GET(request());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ detail: "relay closed the socket" });
  });

  it("answers 502 when the feed is unavailable, having already counted the call it could not serve", async () => {
    const { GET } = await loadRoute();
    stubGate({ open: true });
    stubFeed({ ok: false });

    const res = await GET(request());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Upstream data feed unavailable" });
    // The meter is deliberately upstream of the feed read, so this call is spent. Documenting it
    // here because it is a real cost of metering before serving, not an oversight.
    expect(viemStub.writeContract).toHaveBeenCalled();
  });
});

describe("failing closed — a seller with nowhere to be paid serves nothing", () => {
  it("answers 500 when RETAINER_PAY_TO is unset, rather than serving the feed for free", async () => {
    const { GET } = await loadRoute({ payTo: "" });

    const res = await GET(request());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "RETAINER_PAY_TO is not configured" });
    // Closed, not open: no challenge was built, no facilitator was contacted, and — the part
    // that matters — no resource was served.
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
    expect(facilitatorStub.constructed).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 500 when RETAINER_PAY_TO is absent from the environment entirely, not just empty", async () => {
    const { GET } = await loadRoute({ payTo: null });

    const res = await GET(request());

    // An unset variable falls back to the empty string, and the empty string is the closed state
    // — the default has to be "refuse", because the alternative default is "give it away".
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "RETAINER_PAY_TO is not configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 502 when the facilitator cannot be reached, rather than serving unpaid access", async () => {
    const { GET } = await loadRoute();
    facilitatorStub.getSupported.mockRejectedValueOnce(new Error("facilitator down"));

    const res = await GET(request());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Payment facilitator unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the 402 challenge — the machine-readable price, which has to be exactly right", () => {
  it("quotes the seller's account, the Hedera network and the full purchase in tinybar", async () => {
    const { GET } = await loadRoute();

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.x402Version).toBe(2);
    expect(body.error).toBe("Payment required to open a Retainer subscription");
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "hedera:testnet",
      payTo: PAY_TO,
      // One period is 1 HBAR (1e8 tinybar) and a purchase buys three of them. Quoting one
      // period here would sell the renewal that makes the product interesting for nothing.
      amount: "300000000",
      asset: "0.0.0",
      maxTimeoutSeconds: 180,
    });
    expect(body.resource).toEqual({
      // The canonical resource URL: origin + pathname, with the agent query string dropped, so
      // every agent is quoted for the same resource.
      url: "https://retainer.example/api/retainer/access",
      description: "Retainer — self-renewing access",
      mimeType: "application/json",
    });
  });

  it("repeats the challenge verbatim in the PAYMENT-REQUIRED header, which is what clients parse", async () => {
    const { GET } = await loadRoute();

    const res = await GET(request());
    const header = res.headers.get("PAYMENT-REQUIRED");

    expect(header).toBeTruthy();
    expect(JSON.parse(Buffer.from(header as string, "base64").toString("utf8"))).toEqual(await res.json());
  });

  it("prices the purchase from RETAINER_PRICE_TINYBAR × RETAINER_PERIODS_PER_PURCHASE", async () => {
    const { GET } = await loadRoute({ price: "250000000", periods: "2" });

    const body = await (await GET(request())).json();

    expect(body.accepts[0].amount).toBe("500000000");
  });

  it("tolerates an env value that arrived quoted and padded, because deployment consoles add both", async () => {
    const { GET } = await loadRoute({ price: '  "250000000" ', periods: "'4'" });

    const body = await (await GET(request())).json();

    expect(body.accepts[0].amount).toBe("1000000000");
  });

  it("falls back to the documented default and warns when a price is not a positive integer", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { GET } = await loadRoute({ price: "1.5e8", periods: "" });

    const body = await (await GET(request())).json();

    // The fallback is the whole point of reading env inside the request: one bad setting must
    // degrade to the documented default, not take the route down.
    expect(body.accepts[0].amount).toBe("300000000");
    expect(consoleWarn).toHaveBeenCalledWith(
      '[api/retainer/access] RETAINER_PRICE_TINYBAR="1.5e8" is not a positive integer; using 100000000',
    );
  });

  it("challenges again — with the reason — when the payment header is not decodable", async () => {
    const { GET } = await loadRoute();

    const res = await GET(request(`?agent=${AGENT_LOWER}`, { "PAYMENT-SIGNATURE": "not base64!!" }));

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({ error: "Malformed payment header" });
    expect(facilitatorStub.verify).not.toHaveBeenCalled();
  });

  it("challenges again when the payment was signed against different requirements than the ones quoted", async () => {
    const { GET } = await loadRoute();
    const paid = await payChallenge(GET, { mutate: accepted => (accepted.amount = "1") });

    const res = await GET(paid);

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({ error: "Payment does not match requirements" });
    expect(facilitatorStub.verify).not.toHaveBeenCalled();
  });

  it("passes the facilitator's own invalidMessage back to the agent when it supplies one", async () => {
    const { GET } = await loadRoute();
    facilitatorStub.verify.mockResolvedValue({
      isValid: false,
      invalidReason: "insufficient_funds",
      invalidMessage: "payer 0.0.4783194 holds 0.4 HBAR",
    });
    const paid = await payChallenge(GET);

    const res = await GET(paid);

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({ error: "payer 0.0.4783194 holds 0.4 HBAR" });
    expect(facilitatorStub.settle).not.toHaveBeenCalled();
  });

  it("falls back to invalidReason when the facilitator sends no message", async () => {
    const { GET } = await loadRoute();
    facilitatorStub.verify.mockResolvedValue({ isValid: false, invalidReason: "expired_payment" });
    const paid = await payChallenge(GET);

    const res = await GET(paid);

    await expect(res.json()).resolves.toMatchObject({ error: "expired_payment" });
  });

  it("says the payment is not valid when the facilitator explains nothing usable at all", async () => {
    const { GET } = await loadRoute();
    facilitatorStub.verify.mockResolvedValue({ isValid: false, invalidMessage: { code: 7 } });
    const paid = await payChallenge(GET);

    const res = await GET(paid);

    await expect(res.json()).resolves.toMatchObject({ error: "Payment is not valid" });
  });

  it("answers 402 with the facilitator's reason when settlement fails, and opens no subscription", async () => {
    const { GET } = await loadRoute();
    facilitatorStub.settle.mockResolvedValue({
      success: false,
      errorReason: "insufficient_funds",
      transaction: "",
      network: "hedera:testnet",
    });
    const paid = await payChallenge(GET);

    const res = await GET(paid);

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toEqual({
      error: "Payment settlement failed",
      reason: "insufficient_funds",
    });
    // Funds were never captured, so nothing may be forwarded on-chain.
    expect(viemStub.writeContract).not.toHaveBeenCalled();
  });
});

describe("the paid path — a settled payment becoming on-chain subscription state", () => {
  it("serves the resource, reports paidThisRequest, and forwards the settled amount into RetainerAccess", async () => {
    const { GET } = await loadRoute();
    viemStub.writeContract.mockResolvedValue("0xsubscribe" as never);
    const paid = await payChallenge(GET);

    const res = await GET(paid);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.access).toBe("granted");
    expect(body.paidThisRequest).toBe(true);
    expect(body.payment).toEqual({
      transaction: "0.0.4783194@1757280000.000000000",
      payer: "0.0.4783194",
      network: "hedera:testnet",
    });
    expect(body.subscription).toMatchObject({
      opened: true,
      transaction: "0xsubscribe",
      periodsPurchased: 3,
    });
    expect(body.resource).toMatchObject({ pair: "HBAR/USD" });

    // The join: the same amount the agent was quoted is what goes into the contract, scaled
    // from tinybar to the weibar a JSON-RPC `value` carries. 3e8 tinybar -> 3e18 weibar.
    const [[call]] = viemStub.writeContract.mock.calls as unknown as [[Record<string, unknown>]];
    expect(call.functionName).toBe("subscribeFor");
    expect(call.address).toBe(DEPLOYED_ADDRESS);
    expect(call.args).toEqual([AGENT]);
    expect(call.value).toBe(3_000_000_000_000_000_000n);
  });

  it("echoes the settlement in the PAYMENT-RESPONSE header, which is how the client learns it paid", async () => {
    const { GET } = await loadRoute();
    const paid = await payChallenge(GET);

    const res = await GET(paid);
    const header = res.headers.get("PAYMENT-RESPONSE");

    expect(header).toBeTruthy();
    expect(JSON.parse(Buffer.from(header as string, "base64").toString("utf8"))).toMatchObject({
      success: true,
      transaction: "0.0.4783194@1757280000.000000000",
      payer: "0.0.4783194",
    });
  });

  it("accepts the legacy X-PAYMENT header as well as PAYMENT-SIGNATURE, so older clients are not 402'd forever", async () => {
    const { GET } = await loadRoute();
    const paid = await payChallenge(GET, { header: "X-PAYMENT" });

    const res = await GET(paid);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ paidThisRequest: true });
    expect(facilitatorStub.settle).toHaveBeenCalledTimes(1);
  });

  it("does not answer until subscribeFor is mined — the ordering that stops the agent paying twice", async () => {
    const { GET } = await loadRoute();
    viemStub.writeContract.mockResolvedValue("0xsubscribe" as never);
    let mine!: (receipt: unknown) => void;
    viemStub.waitForTransactionReceipt.mockReturnValue(
      new Promise(resolve => {
        mine = resolve;
      }) as never,
    );
    const paid = await payChallenge(GET);

    let answered = false;
    const pending = GET(paid).then(res => {
      answered = true;
      return res;
    });
    // Give the route every chance to answer early. If it does, the agent's next request reads
    // no subscription on-chain, is challenged again, and pays for the same window twice.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(answered).toBe(false);
    expect(viemStub.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xsubscribe", timeout: 30_000 });

    mine({ status: "success" });
    const res = await pending;

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ subscription: { opened: true, transaction: "0xsubscribe" } });
  });

  it("still serves the captured payment when subscribeFor reverts, and says plainly that no subscription opened", async () => {
    const { GET } = await loadRoute();
    viemStub.writeContract.mockResolvedValue("0xreverted" as never);
    viemStub.waitForTransactionReceipt.mockResolvedValue({ status: "reverted" } as never);
    const paid = await payChallenge(GET);

    const res = await GET(paid);
    const body = await res.json();

    // The money is already captured, so refusing to serve would take the payment and give
    // nothing. But claiming a subscription exists would be a lie the next request exposes.
    expect(res.status).toBe(200);
    expect(body.paidThisRequest).toBe(true);
    expect(body.subscription).toEqual({ opened: false, error: "subscribeFor reverted (tx 0xreverted)" });
    expect(body.subscription.transaction).toBeUndefined();
  });

  it("reports a non-Error failure from the subscription write as text rather than an empty error", async () => {
    const { GET } = await loadRoute();
    viemStub.writeContract.mockRejectedValue("relay closed the socket");
    const paid = await payChallenge(GET);

    const body = await (await GET(paid)).json();

    expect(body.subscription).toEqual({ opened: false, error: "relay closed the socket" });
  });

  it("returns a null resource rather than failing the paid request when the feed is down after settlement", async () => {
    const { GET } = await loadRoute();
    const paid = await payChallenge(GET);
    stubFeed({ ok: false });

    const res = await GET(paid);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.paidThisRequest).toBe(true);
    expect(body.subscription.opened).toBe(true);
    // `null` is honest: the payment settled and the subscription opened, and the feed is simply
    // not there this second. Inventing a quote would be the dishonest option.
    expect(body.resource).toBeNull();
  });
});
