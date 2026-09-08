import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser side of the x402 retry loop.
 *
 * `fetch`, the wallet provider and the x402 HTTP client are stubbed. This file asserts nothing
 * about Hedera settlement — the interesting logic is the loop itself and, above all, the failure
 * mapping: `processResponse` returns a discriminated union, and every arm of it has to become a
 * message a person can act on. An arm that falls through to a generic string is how a user ends
 * up staring at "undefined" after paying real money, so each arm is pinned to its real text,
 * including the fallbacks used when the server declines to say why.
 *
 * The happy path is also checked for what it does *not* do: when the resource is already free to
 * the caller, no wallet is opened and no second request is made.
 */

const wallet = vi.hoisted(() => ({
  getHederaProvider: vi.fn(async () => ({ provider: true })),
  createHederaProviderSigner: vi.fn((accountId: string, provider: unknown, config: unknown) => ({
    accountId,
    provider,
    config,
  })),
}));

const x402 = vi.hoisted(() => {
  const httpClient = {
    getPaymentRequiredResponse: vi.fn(() => ({ accepts: [] })),
    createPaymentPayload: vi.fn(async () => ({ payload: true })),
    encodePaymentSignatureHeader: vi.fn(() => ({ "PAYMENT-SIGNATURE": "encoded-payload" })),
    processResponse: vi.fn(),
  };
  const registeredNetworks: unknown[] = [];
  const schemeSigners: unknown[] = [];
  const httpClientArgs: unknown[] = [];
  return { httpClient, registeredNetworks, schemeSigners, httpClientArgs };
});

vi.mock("~~/services/web3/appKitHedera", () => ({ getHederaProvider: wallet.getHederaProvider }));
vi.mock("~~/services/x402/walletSigner", () => ({
  createHederaProviderSigner: wallet.createHederaProviderSigner,
}));

vi.mock("@x402/hedera/exact/client", () => ({
  ExactHederaScheme: class {
    constructor(signer: unknown) {
      x402.schemeSigners.push(signer);
    }
  },
}));

vi.mock("@x402/core/client", () => ({
  x402Client: class {
    register(network: unknown) {
      x402.registeredNetworks.push(network);
      return this;
    }
  },
  x402HTTPClient: class {
    constructor(client: unknown) {
      x402.httpClientArgs.push(client);
      return x402.httpClient as never;
    }
  },
}));

const RESOURCE = "https://retainer.example/api/private/report.pdf";
const ACCOUNT = "0.0.1001";

const fetchMock = vi.fn();

/** Load a fresh copy so the env-read network constant is re-evaluated. */
async function loadClient() {
  vi.resetModules();
  return await import("~~/services/x402/client");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A response whose body is not JSON — the shape a proxy or gateway error actually arrives in. */
function brokenResponse(status: number) {
  return new Response("<html>gateway error</html>", { status, headers: { "content-type": "text/html" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  x402.registeredNetworks.length = 0;
  x402.schemeSigners.length = 0;
  x402.httpClientArgs.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("X402_CLIENT_NETWORK — must match the resource server or every signature is rejected", () => {
  it("defaults to hedera:testnet", async () => {
    const mod = await loadClient();
    expect(mod.X402_CLIENT_NETWORK).toBe("hedera:testnet");
  });

  it("follows NEXT_PUBLIC_X402_NETWORK when the deployment sets one", async () => {
    vi.stubEnv("NEXT_PUBLIC_X402_NETWORK", "hedera:mainnet");
    const mod = await loadClient();
    expect(mod.X402_CLIENT_NETWORK).toBe("hedera:mainnet");
  });
});

describe("payAndGetDownloadUrl — before any money moves", () => {
  it("refuses to start without a connected Hedera account, and says so in words a user can act on", async () => {
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: "" })).rejects.toThrow(
      "Connect HashPack to pay in-browser.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wallet.getHederaProvider).not.toHaveBeenCalled();
  });

  it("builds the signer from the connected wallet and registers the scheme for the client network", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ url: "https://files.example/report.pdf" }));
    const { payAndGetDownloadUrl } = await loadClient();

    await payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT });

    expect(wallet.createHederaProviderSigner).toHaveBeenCalledWith(
      ACCOUNT,
      { provider: true },
      {
        network: "hedera:testnet",
      },
    );
    expect(x402.registeredNetworks).toEqual(["hedera:testnet"]);
    expect(x402.schemeSigners[0]).toMatchObject({ accountId: ACCOUNT });
  });
});

describe("payAndGetDownloadUrl — the resource answers without a challenge", () => {
  it("returns the URL and never opens the payment path when the first request already succeeds", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ url: "https://files.example/report.pdf" }));
    const { payAndGetDownloadUrl } = await loadClient();

    const result = await payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT });

    expect(result).toEqual({ url: "https://files.example/report.pdf" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(x402.httpClient.createPaymentPayload).not.toHaveBeenCalled();
  });

  it("treats a 200 with no url as a server fault instead of returning an undefined download link", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Server did not return a download URL",
    );
  });
});

describe("payAndGetDownloadUrl — a non-402 failure is not a payment problem", () => {
  it("surfaces the server's own error message when it supplies one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "RETAINER_PAY_TO is not configured" }, 500));
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "RETAINER_PAY_TO is not configured",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the status code when the failing response is not even JSON", async () => {
    fetchMock.mockResolvedValueOnce(brokenResponse(503));
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Request failed with status 503",
    );
  });
});

describe("payAndGetDownloadUrl — the 402 retry loop", () => {
  function challenge() {
    return jsonResponse({ x402Version: 2, accepts: [{ scheme: "exact" }] }, 402);
  }

  it("reads the challenge, signs, retries with the payment header, and returns the settled download", async () => {
    fetchMock.mockResolvedValueOnce(challenge());
    fetchMock.mockResolvedValueOnce(jsonResponse({ url: "https://files.example/report.pdf" }));
    x402.httpClient.processResponse.mockResolvedValueOnce({
      paymentStatus: "settled",
      body: { url: "https://files.example/report.pdf" },
      header: { transaction: "0.0.1001@1757280000.000000000", payer: ACCOUNT },
    });
    const { payAndGetDownloadUrl } = await loadClient();

    const result = await payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT });

    expect(result).toEqual({
      url: "https://files.example/report.pdf",
      transaction: "0.0.1001@1757280000.000000000",
      payer: ACCOUNT,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, RESOURCE, { headers: { "PAYMENT-SIGNATURE": "encoded-payload" } });
    expect(x402.httpClient.getPaymentRequiredResponse).toHaveBeenCalledWith(expect.any(Function), {
      x402Version: 2,
      accepts: [{ scheme: "exact" }],
    });
  });

  it("reads the challenge headers through the accessor it hands the x402 client", async () => {
    const withHeader = new Response(JSON.stringify({ x402Version: 2 }), {
      status: 402,
      headers: { "content-type": "application/json", "PAYMENT-REQUIRED": "encoded-challenge" },
    });
    fetchMock.mockResolvedValueOnce(withHeader);
    fetchMock.mockResolvedValueOnce(jsonResponse({ url: "https://files.example/report.pdf" }));
    x402.httpClient.processResponse.mockResolvedValueOnce({
      paymentStatus: "settled",
      body: { url: "https://files.example/report.pdf" },
      header: {},
    });
    const { payAndGetDownloadUrl } = await loadClient();

    await payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT });

    const [[getHeader]] = x402.httpClient.getPaymentRequiredResponse.mock.calls as unknown as [
      [(name: string) => string | null],
    ];
    expect(getHeader("PAYMENT-REQUIRED")).toBe("encoded-challenge");
  });

  it("still builds the challenge when the 402 body is unreadable, because the header alone carries it", async () => {
    fetchMock.mockResolvedValueOnce(brokenResponse(402));
    fetchMock.mockResolvedValueOnce(jsonResponse({ url: "https://files.example/report.pdf" }));
    x402.httpClient.processResponse.mockResolvedValueOnce({
      paymentStatus: "settled",
      body: { url: "https://files.example/report.pdf" },
      header: {},
    });
    const { payAndGetDownloadUrl } = await loadClient();

    const result = await payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT });

    expect(result.url).toBe("https://files.example/report.pdf");
    expect(x402.httpClient.getPaymentRequiredResponse).toHaveBeenCalledWith(expect.any(Function), undefined);
  });

  it("does not pretend a download exists when the payment succeeded but the body carries no url", async () => {
    fetchMock.mockResolvedValueOnce(challenge());
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    x402.httpClient.processResponse.mockResolvedValueOnce({
      paymentStatus: "settled",
      body: {},
      header: { transaction: "0.0.1@1.0" },
    });
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Payment succeeded but no download URL was returned",
    );
  });
});

describe("payAndGetDownloadUrl — every failure arm of processResponse becomes a readable message", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse({ x402Version: 2 }, 402));
  });

  it("reports the facilitator's stated reason when settlement fails", async () => {
    x402.httpClient.processResponse.mockResolvedValueOnce({
      paymentStatus: "settle_failed",
      header: { errorReason: "insufficient_funds" },
    });
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Payment settlement failed: insufficient_funds",
    );
  });

  it("says 'unknown' rather than 'undefined' when settlement fails without a reason", async () => {
    x402.httpClient.processResponse.mockResolvedValueOnce({ paymentStatus: "settle_failed", header: {} });
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Payment settlement failed: unknown",
    );
  });

  it("surfaces the server's reason when the retry is challenged again", async () => {
    x402.httpClient.processResponse.mockResolvedValueOnce({
      paymentStatus: "payment_required",
      header: { error: "Payment does not match requirements" },
    });
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Payment does not match requirements",
    );
  });

  it("falls back to a plain rejection message when a repeat challenge carries no reason", async () => {
    x402.httpClient.processResponse.mockResolvedValueOnce({ paymentStatus: "payment_required", header: {} });
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Payment was rejected by the server",
    );
  });

  it("surfaces the body's error for a generic failure arm", async () => {
    x402.httpClient.processResponse.mockResolvedValueOnce({
      paymentStatus: "none",
      status: 500,
      body: { error: "Upstream data feed unavailable" },
    });
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Upstream data feed unavailable",
    );
  });

  it("falls back to the status code when the generic failure arm has no error in its body", async () => {
    x402.httpClient.processResponse.mockResolvedValueOnce({ paymentStatus: "none", status: 504, body: {} });
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Download failed with status 504",
    );
  });

  it("refuses to guess when the client returns a payment status this code has never heard of", async () => {
    x402.httpClient.processResponse.mockResolvedValueOnce({ paymentStatus: "something_new", status: 502, body: {} });
    const { payAndGetDownloadUrl } = await loadClient();

    await expect(payAndGetDownloadUrl({ resourceUrl: RESOURCE, hederaAccountId: ACCOUNT })).rejects.toThrow(
      "Download failed with status 502",
    );
  });
});
