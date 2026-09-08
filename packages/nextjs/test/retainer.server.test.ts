import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The seller-side reader/writer for `RetainerAccess`.
 *
 * viem's two clients are replaced with stubs at the transport boundary, so nothing in this file
 * observes a chain or claims that one did anything. What it does assert is the code between the
 * route and the RPC call, which is where this module's real failure modes live:
 *
 *   1. **the unit boundary.** `openSubscriptionFor` and `creditSubscription` are the only places
 *      in the project that scale tinybar to the weibar a JSON-RPC `value` carries. Getting that
 *      wrong overpays by ten orders of magnitude and still returns a successful receipt, so the
 *      exact `value` handed to viem is asserted, not the fact that a write happened.
 *   2. **tuple decoding.** `subscriptionOf` and `usageOf` unpack positional contract returns into
 *      named fields. Swapping two positions of the same type is invisible to the compiler and
 *      would misreport the window a buyer paid for.
 *   3. **deliberate asymmetries.** `openSubscriptionFor` waits for its receipt (not waiting
 *      double-charges the agent); `meterCall` deliberately does not (waiting timed out the
 *      serverless function). Both are product decisions and both are pinned here, including the
 *      degraded case where the unawaited receipt never confirms.
 *   4. **configuration failure.** A missing deployment or a missing server key must raise a
 *      named error the route can turn into a 503/500, not an anonymous RPC crash.
 */

const viemStub = vi.hoisted(() => {
  const readContract = vi.fn();
  const simulateContract = vi.fn();
  const waitForTransactionReceipt = vi.fn(async () => ({ status: "success" }));
  const writeContract = vi.fn(async () => "0xwritehash");
  const publicClientConfigs: any[] = [];
  const walletClientConfigs: any[] = [];
  const transportUrls: string[] = [];

  const http = vi.fn((url?: string) => {
    transportUrls.push(url as string);
    return { transportUrl: url } as never;
  });
  const createPublicClient = vi.fn((config: any) => {
    publicClientConfigs.push(config);
    return { readContract, simulateContract, waitForTransactionReceipt } as never;
  });
  const createWalletClient = vi.fn((config: any) => {
    walletClientConfigs.push(config);
    return { account: config.account, writeContract } as never;
  });

  return {
    readContract,
    simulateContract,
    waitForTransactionReceipt,
    writeContract,
    publicClientConfigs,
    walletClientConfigs,
    transportUrls,
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

/** A real key: `privateKeyToAccount` is left unmocked so its validation is genuinely exercised. */
const SERVER_KEY_UNPREFIXED = "11".repeat(32);
const SERVER_KEY_ADDRESS = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
/** The address `deployedContracts` records for Hedera testnet (chain 296). */
const DEPLOYED_ADDRESS = "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931";
const AGENT = "0x00000000000000000000000000000000004d2eaf" as Address;

type LoadOptions = { deployed?: boolean; rpcOverrides?: boolean };

/**
 * Load a fresh copy of the module.
 *
 * Necessary rather than tidy: the module caches its public client in a module-level variable and
 * reads the deployment address from a module the test sometimes needs to vary.
 */
async function loadRetainer(options: LoadOptions = {}) {
  const { deployed = true, rpcOverrides = true } = options;

  if (deployed) {
    vi.doUnmock("~~/contracts/deployedContracts");
  } else {
    vi.doMock("~~/contracts/deployedContracts", () => ({ default: {} }));
  }

  if (rpcOverrides) {
    vi.doUnmock("~~/scaffold.config");
  } else {
    vi.doMock("~~/scaffold.config", async importOriginal => {
      const actual = await importOriginal<{ default: Record<string, unknown> }>();
      return { default: { ...actual.default, rpcOverrides: undefined } };
    });
  }

  vi.resetModules();
  return await import("~~/services/retainer/server");
}

beforeEach(() => {
  vi.clearAllMocks();
  viemStub.publicClientConfigs.length = 0;
  viemStub.walletClientConfigs.length = 0;
  viemStub.transportUrls.length = 0;
  viemStub.waitForTransactionReceipt.mockResolvedValue({ status: "success" } as never);
  viemStub.writeContract.mockResolvedValue("0xwritehash" as never);
  vi.stubEnv("RETAINER_SERVER_KEY", SERVER_KEY_UNPREFIXED);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("named errors — a misconfiguration must be recognisable, not an anonymous RPC crash", () => {
  it("RetainerNotDeployedError says the contract is not on the target network and keeps its class name", async () => {
    const { RetainerNotDeployedError } = await loadRetainer();
    const error = new RetainerNotDeployedError();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("RetainerAccess is not deployed on the target network");
    expect(error.name).toBe("RetainerNotDeployedError");
  });

  it("ServerKeyMissingError explains that settled payments cannot be forwarded on-chain", async () => {
    const { ServerKeyMissingError } = await loadRetainer();
    const error = new ServerKeyMissingError();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      "RETAINER_SERVER_KEY is not configured; the server cannot forward settled payments on-chain",
    );
    expect(error.name).toBe("ServerKeyMissingError");
  });
});

describe("RETAINER_ABI — the surface the route is allowed to touch", () => {
  it("declares the reads as view and the two funding entry points as payable", async () => {
    const { RETAINER_ABI } = await loadRetainer();
    const byName = Object.fromEntries(RETAINER_ABI.map(entry => [entry.name, entry]));

    expect(byName.hasAccess.stateMutability).toBe("view");
    expect(byName.subscriptionOf.stateMutability).toBe("view");
    expect(byName.usageOf.stateMutability).toBe("view");
    expect(byName.renewalsRemaining.stateMutability).toBe("view");
    expect(byName.subscribeFor.stateMutability).toBe("payable");
    expect(byName.creditFor.stateMutability).toBe("payable");
    // `meter` writes: it is the on-chain record of a served call, so it cannot be a view.
    expect(byName.meter.stateMutability).toBe("nonpayable");
  });
});

describe("getRetainerAddress — where the deployment comes from", () => {
  it("prefers RETAINER_ACCESS_ADDRESS and returns it checksummed, whatever case it was written in", async () => {
    vi.stubEnv("RETAINER_ACCESS_ADDRESS", DEPLOYED_ADDRESS.toLowerCase());
    const { getRetainerAddress } = await loadRetainer();

    expect(getRetainerAddress()).toBe(DEPLOYED_ADDRESS);
  });

  it("falls back to NEXT_PUBLIC_RETAINER_ACCESS_ADDRESS, so a browser-only configuration still works server-side", async () => {
    vi.stubEnv("NEXT_PUBLIC_RETAINER_ACCESS_ADDRESS", "0x00000000000000000000000000000000004d2eaf");
    const { getRetainerAddress } = await loadRetainer();

    expect(getRetainerAddress()).toBe(AGENT);
  });

  it("falls back to the generated deployedContracts entry for the target network when no env var is set", async () => {
    const { getRetainerAddress } = await loadRetainer();

    expect(getRetainerAddress()).toBe(DEPLOYED_ADDRESS);
  });

  it("returns undefined — not a throw — when nothing is deployed, so the route can answer 503", async () => {
    const { getRetainerAddress } = await loadRetainer({ deployed: false });

    expect(getRetainerAddress()).toBeUndefined();
  });
});

describe("every entry point refuses to touch the chain when nothing is deployed", () => {
  it("throws RetainerNotDeployedError from each read and write, before any client is built", async () => {
    const mod = await loadRetainer({ deployed: false });

    await expect(mod.hasAccess(AGENT)).rejects.toThrow("RetainerAccess is not deployed on the target network");
    await expect(mod.subscriptionOf(AGENT)).rejects.toThrow(mod.RetainerNotDeployedError);
    await expect(mod.usageOf(AGENT)).rejects.toThrow(mod.RetainerNotDeployedError);
    await expect(mod.renewalsRemaining()).rejects.toThrow(mod.RetainerNotDeployedError);
    await expect(mod.openSubscriptionFor(AGENT, 1n)).rejects.toThrow(mod.RetainerNotDeployedError);
    await expect(mod.creditSubscription(AGENT, 1n)).rejects.toThrow(mod.RetainerNotDeployedError);
    await expect(mod.meterCall(AGENT)).rejects.toThrow(mod.RetainerNotDeployedError);

    expect(viemStub.createPublicClient).not.toHaveBeenCalled();
    expect(viemStub.createWalletClient).not.toHaveBeenCalled();
  });
});

describe("the RPC endpoint the reader is pointed at", () => {
  it("uses HEDERA_RPC_URL when the deployment supplies a private relay", async () => {
    vi.stubEnv("HEDERA_RPC_URL", "https://private-relay.example/api");
    const { hasAccess } = await loadRetainer();
    viemStub.readContract.mockResolvedValueOnce(true);

    await hasAccess(AGENT);

    expect(viemStub.transportUrls).toEqual(["https://private-relay.example/api"]);
  });

  it("falls back to the configured rpc override for the target chain", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL", "https://override-relay.example/api");
    const { hasAccess } = await loadRetainer();
    viemStub.readContract.mockResolvedValueOnce(true);

    await hasAccess(AGENT);

    expect(viemStub.transportUrls).toEqual(["https://override-relay.example/api"]);
  });

  it("falls back to the chain's own default RPC URL when no override is configured at all", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL", "https://override-relay.example/api");
    const { hasAccess } = await loadRetainer({ rpcOverrides: false });
    viemStub.readContract.mockResolvedValueOnce(true);

    await hasAccess(AGENT);

    expect(viemStub.transportUrls).toEqual(["https://testnet.hashio.io/api"]);
  });

  it("builds the public client once and reuses it across reads", async () => {
    const { hasAccess, renewalsRemaining } = await loadRetainer();
    viemStub.readContract.mockResolvedValue(true as never);

    await hasAccess(AGENT);
    await hasAccess(AGENT);
    await renewalsRemaining();

    expect(viemStub.createPublicClient).toHaveBeenCalledTimes(1);
    expect(viemStub.publicClientConfigs[0].chain.id).toBe(296);
  });
});

describe("hasAccess — the single question the gate asks", () => {
  it("calls hasAccess on the deployed contract with the agent address and returns the answer verbatim", async () => {
    const { hasAccess } = await loadRetainer();
    viemStub.readContract.mockResolvedValueOnce(true);

    await expect(hasAccess(AGENT)).resolves.toBe(true);
    expect(viemStub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: DEPLOYED_ADDRESS, functionName: "hasAccess", args: [AGENT] }),
    );
  });

  it("returns false without inventing a reason when the contract says the window is closed", async () => {
    const { hasAccess } = await loadRetainer();
    viemStub.readContract.mockResolvedValueOnce(false);

    await expect(hasAccess(AGENT)).resolves.toBe(false);
  });

  it("propagates a failed read so the route can answer 502 instead of guessing", async () => {
    const { hasAccess } = await loadRetainer();
    viemStub.readContract.mockRejectedValueOnce(new Error("relay refused the call"));

    await expect(hasAccess(AGENT)).rejects.toThrow("relay refused the call");
  });
});

describe("subscriptionOf — positional contract output decoded into named fields", () => {
  it("maps all six return positions to the field the UI reads, in the contract's order", async () => {
    const { subscriptionOf } = await loadRetainer();
    viemStub.readContract.mockResolvedValueOnce([
      300_000_000n,
      100_000_000n,
      1_757_280_000n,
      3600,
      true,
      "0x00000000000000000000000000000000004d2eb0",
    ]);

    const sub = await subscriptionOf(AGENT);

    expect(sub).toEqual({
      balance: 300_000_000n,
      pricePerPeriod: 100_000_000n,
      expiresAt: 1_757_280_000n,
      periodSeconds: 3600,
      active: true,
      schedule: "0x00000000000000000000000000000000004d2eb0",
    });
    // balance and pricePerPeriod are both uint256: swapping them compiles and misprices the product.
    expect(sub.balance).not.toBe(sub.pricePerPeriod);
    expect(viemStub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "subscriptionOf", args: [AGENT] }),
    );
  });
});

describe("usageOf — the metered counters", () => {
  it("maps used, allowance and remaining in that order", async () => {
    const { usageOf } = await loadRetainer();
    viemStub.readContract.mockResolvedValueOnce([7, 100, 93]);

    await expect(usageOf(AGENT)).resolves.toEqual({ used: 7, allowance: 100, remaining: 93 });
    expect(viemStub.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "usageOf", args: [AGENT] }),
    );
  });
});

describe("renewalsRemaining — the seller's gas reserve, read with no arguments", () => {
  it("returns the count as a bigint and sends no args", async () => {
    const { renewalsRemaining } = await loadRetainer();
    viemStub.readContract.mockResolvedValueOnce(42n);

    await expect(renewalsRemaining()).resolves.toBe(42n);
    const call = viemStub.readContract.mock.calls[0][0] as Record<string, unknown>;
    expect(call.functionName).toBe("renewalsRemaining");
    expect(call.args).toBeUndefined();
  });

  it("propagates a failed read, which the status route degrades to a null field rather than a 502", async () => {
    const { renewalsRemaining } = await loadRetainer();
    viemStub.readContract.mockRejectedValueOnce(new Error("execution reverted"));

    await expect(renewalsRemaining()).rejects.toThrow("execution reverted");
  });
});

describe("the server wallet — the key that forwards settled payments", () => {
  it("refuses to build a wallet with no RETAINER_SERVER_KEY, and does so from every write path", async () => {
    vi.stubEnv("RETAINER_SERVER_KEY", "");
    const mod = await loadRetainer();

    await expect(mod.openSubscriptionFor(AGENT, 1n)).rejects.toThrow(mod.ServerKeyMissingError);
    await expect(mod.creditSubscription(AGENT, 1n)).rejects.toThrow(mod.ServerKeyMissingError);
    await expect(mod.meterCall(AGENT)).rejects.toThrow(mod.ServerKeyMissingError);
    expect(viemStub.createWalletClient).not.toHaveBeenCalled();
  });

  it("points the write client at HEDERA_RPC_URL when one is configured", async () => {
    vi.stubEnv("HEDERA_RPC_URL", "https://private-relay.example/api");
    const { creditSubscription } = await loadRetainer();

    await creditSubscription(AGENT, 1n);

    expect(viemStub.walletClientConfigs.at(-1).transport).toEqual({
      transportUrl: "https://private-relay.example/api",
    });
    expect(viemStub.walletClientConfigs.at(-1).chain.id).toBe(296);
  });

  it("falls back to the configured rpc override for the write client, exactly as the reader does", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL", "https://override-relay.example/api");
    const { creditSubscription } = await loadRetainer();

    await creditSubscription(AGENT, 1n);

    expect(viemStub.walletClientConfigs.at(-1).transport).toEqual({
      transportUrl: "https://override-relay.example/api",
    });
  });

  it("falls back to the chain's own default RPC URL for the write client when no override is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL", "https://override-relay.example/api");
    const { creditSubscription } = await loadRetainer({ rpcOverrides: false });

    await creditSubscription(AGENT, 1n);

    expect(viemStub.walletClientConfigs.at(-1).transport).toEqual({ transportUrl: "https://testnet.hashio.io/api" });
  });

  it("accepts a key with or without the 0x prefix and derives the same account either way", async () => {
    vi.stubEnv("RETAINER_SERVER_KEY", SERVER_KEY_UNPREFIXED);
    const unprefixed = await loadRetainer();
    viemStub.readContract.mockResolvedValue(0n as never);
    await unprefixed.creditSubscription(AGENT, 1n);
    const fromUnprefixed = viemStub.walletClientConfigs.at(-1).account.address;

    vi.stubEnv("RETAINER_SERVER_KEY", `0x${SERVER_KEY_UNPREFIXED}`);
    const prefixed = await loadRetainer();
    await prefixed.creditSubscription(AGENT, 1n);
    const fromPrefixed = viemStub.walletClientConfigs.at(-1).account.address;

    expect(fromUnprefixed).toBe(SERVER_KEY_ADDRESS);
    expect(fromPrefixed).toBe(SERVER_KEY_ADDRESS);
  });
});

describe("openSubscriptionFor — the join between the x402 rail and the contract", () => {
  it("sends the tinybar price scaled by 1e10, because the wire speaks weibar and the EVM sees tinybar", async () => {
    const { openSubscriptionFor } = await loadRetainer();

    await openSubscriptionFor(AGENT, 300_000_000n);

    const [[call]] = viemStub.writeContract.mock.calls as unknown as [[Record<string, unknown>]];
    expect(call.functionName).toBe("subscribeFor");
    expect(call.args).toEqual([AGENT]);
    expect(call.address).toBe(DEPLOYED_ADDRESS);
    // 3 HBAR: 3e8 tinybar on-chain, 3e18 weibar on the wire. Applying the factor twice here is
    // the ten-orders-of-magnitude overpay that still returns a successful receipt.
    expect(call.value).toBe(3_000_000_000_000_000_000n);
    expect(call.value).not.toBe(300_000_000n);
  });

  it("waits for the receipt before reporting access is open, so the agent is not 402'd into paying twice", async () => {
    const { openSubscriptionFor } = await loadRetainer();
    viemStub.writeContract.mockResolvedValueOnce("0xsubscribe" as never);

    await expect(openSubscriptionFor(AGENT, 100_000_000n)).resolves.toBe("0xsubscribe");
    expect(viemStub.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xsubscribe", timeout: 30_000 });
  });

  it("throws with the transaction hash when the subscription transaction reverts, rather than claiming a subscription exists", async () => {
    const { openSubscriptionFor } = await loadRetainer();
    viemStub.writeContract.mockResolvedValueOnce("0xreverted" as never);
    viemStub.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" } as never);

    await expect(openSubscriptionFor(AGENT, 100_000_000n)).rejects.toThrow("subscribeFor reverted (tx 0xreverted)");
  });

  it("refuses a negative amount at the unit conversion instead of scaling it into a transfer", async () => {
    const { openSubscriptionFor } = await loadRetainer();

    await expect(openSubscriptionFor(AGENT, -1n)).rejects.toThrow("tinybar amount cannot be negative");
    expect(viemStub.writeContract).not.toHaveBeenCalled();
  });
});

describe("creditSubscription — a top-up, deliberately without the receipt wait", () => {
  it("calls creditFor with the same 1e10 scaling and returns the hash immediately", async () => {
    const { creditSubscription } = await loadRetainer();
    viemStub.writeContract.mockResolvedValueOnce("0xcredit" as never);

    await expect(creditSubscription(AGENT, 50_000_000n)).resolves.toBe("0xcredit");

    const [[call]] = viemStub.writeContract.mock.calls as unknown as [[Record<string, unknown>]];
    expect(call.functionName).toBe("creditFor");
    expect(call.value).toBe(500_000_000_000_000_000n);
    expect(viemStub.waitForTransactionReceipt).not.toHaveBeenCalled();
  });
});

describe("meterCall — counting a served call against the on-chain allowance", () => {
  function simulated(remaining: number) {
    return { request: { functionName: "meter", args: [AGENT], marker: "simulated-request" }, result: remaining };
  }

  it("simulates first — the simulate is the enforcement — and sends exactly the request it produced", async () => {
    const { meterCall } = await loadRetainer();
    viemStub.simulateContract.mockResolvedValueOnce(simulated(93));
    viemStub.writeContract.mockResolvedValueOnce("0xmeter" as never);
    viemStub.waitForTransactionReceipt.mockResolvedValue(new Promise(() => {}) as never);

    const result = await meterCall(AGENT);

    expect(viemStub.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "meter", args: [AGENT], address: DEPLOYED_ADDRESS }),
    );
    expect(viemStub.simulateContract.mock.calls[0][0].account.address).toBe(SERVER_KEY_ADDRESS);
    expect(viemStub.writeContract).toHaveBeenCalledWith(simulated(93).request);
    expect(result).toEqual({ hash: "0xmeter", remaining: 93 });
  });

  it("returns the remaining allowance as a number, whatever numeric type the contract returned", async () => {
    const { meterCall } = await loadRetainer();
    viemStub.simulateContract.mockResolvedValueOnce({ request: {}, result: 0n });
    viemStub.writeContract.mockResolvedValueOnce("0xmeter" as never);

    const result = await meterCall(AGENT);

    expect(result.remaining).toBe(0);
    expect(typeof result.remaining).toBe("number");
  });

  it("does not wait for the meter receipt, so a slow finality cannot time out the served request", async () => {
    const { meterCall } = await loadRetainer();
    viemStub.simulateContract.mockResolvedValueOnce(simulated(5));
    viemStub.writeContract.mockResolvedValueOnce("0xmeter" as never);
    // A receipt that never arrives. The call must still resolve.
    viemStub.waitForTransactionReceipt.mockReturnValue(new Promise(() => {}) as never);

    await expect(meterCall(AGENT)).resolves.toEqual({ hash: "0xmeter", remaining: 5 });
    expect(viemStub.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xmeter", timeout: 30_000 });
  });

  it("logs an unconfirmed meter transaction instead of leaving an unhandled rejection behind", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { meterCall } = await loadRetainer();
    viemStub.simulateContract.mockResolvedValueOnce(simulated(5));
    viemStub.writeContract.mockResolvedValueOnce("0xmeter" as never);
    viemStub.waitForTransactionReceipt.mockRejectedValueOnce(new Error("receipt timed out"));

    await expect(meterCall(AGENT)).resolves.toMatchObject({ hash: "0xmeter" });

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(consoleError.mock.calls[0][0]).toBe("[retainer] meter tx 0xmeter not confirmed");
  });

  it("propagates the simulate revert when the allowance is spent, which is what the route turns into a 402", async () => {
    const { meterCall } = await loadRetainer();
    viemStub.simulateContract.mockRejectedValueOnce(
      new Error('The contract function "meter" reverted. QuotaExhausted()'),
    );

    await expect(meterCall(AGENT)).rejects.toThrow(/QuotaExhausted/);
    expect(viemStub.writeContract).not.toHaveBeenCalled();
  });
});
