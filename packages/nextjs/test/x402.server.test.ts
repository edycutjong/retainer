import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The resource server's own wiring — the part of x402 that is ours.
 *
 * Nothing here asserts anything about Hedera. The facilitator is an HTTP service and the
 * scheme is a library; both are replaced by stubs so that what is under test is the code this
 * project wrote around them: which URL the facilitator is pointed at, which network the scheme
 * is registered for, whether a failed `initialize()` leaves the process permanently wedged, and
 * how an incoming `Request` is translated into the context the library expects.
 *
 * The header extraction in `makeHttpContext` is the one that bites: x402 v2 sends
 * `PAYMENT-SIGNATURE` and older clients send `X-PAYMENT`. Reading only one of them turns a
 * perfectly good payment into an endless 402 loop, and the failure looks like the client's fault.
 */

const stub = vi.hoisted(() => {
  const facilitatorConstructed = vi.fn();
  const serverConstructed = vi.fn();
  const registered = vi.fn();
  const initialize = vi.fn(async () => {});
  const schemeConstructed = vi.fn();
  return { facilitatorConstructed, serverConstructed, registered, initialize, schemeConstructed };
});

vi.mock("@x402/core/server", () => ({
  HTTPFacilitatorClient: class {
    constructor(options: { url: string }) {
      stub.facilitatorConstructed(options);
    }
  },
  x402ResourceServer: class {
    constructor(facilitator: unknown) {
      stub.serverConstructed(facilitator);
    }
    register(network: string, scheme: unknown) {
      stub.registered(network, scheme);
      return this;
    }
    initialize() {
      return stub.initialize();
    }
  },
}));

vi.mock("@x402/hedera/exact/server", () => ({
  ExactHederaScheme: class {
    constructor() {
      stub.schemeConstructed();
    }
  },
}));

/** Load a fresh copy of the module so its cached server promise and env-read constants reset. */
async function loadServerModule() {
  vi.resetModules();
  return await import("~~/services/x402/server");
}

beforeEach(() => {
  vi.clearAllMocks();
  stub.initialize.mockImplementation(async () => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuration constants — the defaults a fresh clone runs on", () => {
  it("points at the hosted Blocky402 testnet facilitator when FACILITATOR_URL is unset, because settlement must go through it", async () => {
    const mod = await loadServerModule();
    expect(mod.FACILITATOR_URL).toBe("https://api.testnet.blocky402.com");
  });

  it("uses the FACILITATOR_URL from the environment when one is supplied", async () => {
    vi.stubEnv("FACILITATOR_URL", "https://facilitator.example/x402");
    const mod = await loadServerModule();
    expect(mod.FACILITATOR_URL).toBe("https://facilitator.example/x402");
  });

  it("defaults the x402 network to hedera:testnet and honours X402_NETWORK when set", async () => {
    const defaults = await loadServerModule();
    expect(defaults.X402_NETWORK).toBe("hedera:testnet");

    vi.stubEnv("X402_NETWORK", "hedera:mainnet");
    const overridden = await loadServerModule();
    expect(overridden.X402_NETWORK).toBe("hedera:mainnet");
  });

  it("quotes native HBAR as asset 0.0.0 and gives a client 180 seconds to answer a challenge", async () => {
    const mod = await loadServerModule();
    expect(mod.HBAR_ASSET).toBe("0.0.0");
    expect(mod.MAX_TIMEOUT_SECONDS).toBe(180);
  });
});

describe("getResourceServer — built once, and never permanently wedged by a bad facilitator", () => {
  it("builds the facilitator against FACILITATOR_URL and registers the Hedera exact scheme for X402_NETWORK", async () => {
    vi.stubEnv("FACILITATOR_URL", "https://facilitator.example/x402");
    vi.stubEnv("X402_NETWORK", "hedera:mainnet");
    const mod = await loadServerModule();

    const server = await mod.getResourceServer();

    expect(stub.facilitatorConstructed).toHaveBeenCalledWith({ url: "https://facilitator.example/x402" });
    expect(stub.schemeConstructed).toHaveBeenCalledTimes(1);
    expect(stub.registered).toHaveBeenCalledTimes(1);
    expect(stub.registered.mock.calls[0][0]).toBe("hedera:mainnet");
    // `register` returns the server itself, so what callers get back is the registered instance.
    expect(server).toBeDefined();
  });

  it("initialises exactly once no matter how many concurrent requests ask for it", async () => {
    const mod = await loadServerModule();

    const [a, b] = await Promise.all([mod.getResourceServer(), mod.getResourceServer()]);
    const c = await mod.getResourceServer();

    expect(stub.initialize).toHaveBeenCalledTimes(1);
    expect(stub.serverConstructed).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("clears the cached promise when initialise fails, so a transient facilitator outage is retried rather than remembered forever", async () => {
    const mod = await loadServerModule();
    stub.initialize.mockRejectedValueOnce(new Error("facilitator unreachable"));

    await expect(mod.getResourceServer()).rejects.toThrow("facilitator unreachable");

    // The degraded path that matters: the very next request must be allowed to try again.
    await expect(mod.getResourceServer()).resolves.toBeDefined();
    expect(stub.initialize).toHaveBeenCalledTimes(2);
    expect(stub.serverConstructed).toHaveBeenCalledTimes(2);
  });

  it("keeps rejecting while the facilitator stays down, without ever caching the failure", async () => {
    const mod = await loadServerModule();
    stub.initialize.mockRejectedValue(new Error("facilitator unreachable"));

    await expect(mod.getResourceServer()).rejects.toThrow("facilitator unreachable");
    await expect(mod.getResourceServer()).rejects.toThrow("facilitator unreachable");
    expect(stub.initialize).toHaveBeenCalledTimes(2);
  });
});

describe("makeHttpContext — translating a Web Request into what x402 expects", () => {
  it("derives the canonical resource URL from origin and path, dropping the query string a signature must not depend on", async () => {
    const mod = await loadServerModule();
    const req = new Request("https://retainer.example/api/retainer/access?agent=0xabc&cache=1");

    const { resourceUrl } = mod.makeHttpContext(req);

    expect(resourceUrl).toBe("https://retainer.example/api/retainer/access");
  });

  it("reads the x402 v2 PAYMENT-SIGNATURE header", async () => {
    const mod = await loadServerModule();
    const req = new Request("https://retainer.example/api/retainer/access", {
      headers: { "PAYMENT-SIGNATURE": "sig-v2" },
    });

    expect(mod.makeHttpContext(req).context.paymentHeader).toBe("sig-v2");
  });

  it("falls back to the legacy X-PAYMENT header so older clients are not stuck in a 402 loop", async () => {
    const mod = await loadServerModule();
    const req = new Request("https://retainer.example/api/retainer/access", {
      headers: { "X-PAYMENT": "legacy-header" },
    });

    expect(mod.makeHttpContext(req).context.paymentHeader).toBe("legacy-header");
  });

  it("prefers PAYMENT-SIGNATURE when a client sends both names", async () => {
    const mod = await loadServerModule();
    const req = new Request("https://retainer.example/api/retainer/access", {
      headers: { "PAYMENT-SIGNATURE": "sig-v2", "X-PAYMENT": "legacy-header" },
    });

    expect(mod.makeHttpContext(req).context.paymentHeader).toBe("sig-v2");
  });

  it("reports an absent payment header as undefined rather than null, which is what the route branches on", async () => {
    const mod = await loadServerModule();
    const req = new Request("https://retainer.example/api/retainer/access");

    expect(mod.makeHttpContext(req).context.paymentHeader).toBeUndefined();
  });

  it("exposes method, path, url and query through the adapter the resource server calls", async () => {
    const mod = await loadServerModule();
    const req = new Request("https://retainer.example/api/retainer/access?agent=0xabc", {
      method: "POST",
      headers: { accept: "application/json", "user-agent": "retainer-agent/1.0", "x-custom": "present" },
    });

    const { context } = mod.makeHttpContext(req);

    expect(context.method).toBe("POST");
    expect(context.path).toBe("/api/retainer/access");
    expect(context.adapter.getMethod()).toBe("POST");
    expect(context.adapter.getPath()).toBe("/api/retainer/access");
    expect(context.adapter.getUrl()).toBe("https://retainer.example/api/retainer/access?agent=0xabc");
    expect(context.adapter.getAcceptHeader()).toBe("application/json");
    expect(context.adapter.getUserAgent()).toBe("retainer-agent/1.0");
    expect(context.adapter.getHeader("x-custom")).toBe("present");
    expect(context.adapter.getQueryParam?.("agent")).toBe("0xabc");
  });

  it("returns undefined for a missing header or query param, and an empty string for a missing accept or user-agent", async () => {
    const mod = await loadServerModule();
    const req = new Request("https://retainer.example/api/retainer/access");

    const { context } = mod.makeHttpContext(req);

    expect(context.adapter.getHeader("x-absent")).toBeUndefined();
    expect(context.adapter.getQueryParam?.("agent")).toBeUndefined();
    // The x402 library expects strings here; handing it null would throw inside the library.
    expect(context.adapter.getAcceptHeader()).toBe("");
    expect(context.adapter.getUserAgent()).toBe("");
  });
});
