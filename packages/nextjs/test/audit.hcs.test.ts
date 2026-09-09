import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_SCHEMA_VERSION,
  MAX_MESSAGE_BYTES,
  type PaymentSettledRecord,
  type SubscriptionFailedRecord,
  auditEnabled,
  auditMessageBytes,
  auditNetwork,
  auditTopicId,
  encodeAuditMessage,
  fitFailureRecord,
  parseOperatorKey,
  submitAuditEvent,
} from "~~/services/audit/hcs";

/**
 * The audit writer, tested for the one property that matters most: it cannot hurt a payment.
 *
 * The trail is bolted onto the money path, which is the most dangerous place in this codebase to
 * add anything. So the interesting cases here are not the happy ones — they are the ones where
 * HCS is broken. An unset topic, an unfunded operator, a network that throws, a record too long
 * to fit in one consensus message: every one of them must come back as a resolved
 * `{ ok: false }`, because a rejected promise inside `after()` is an unhandled rejection in a
 * serverless runtime, and a thrown one in the request path would be a service that stops selling
 * access when its own bookkeeping is down.
 *
 * The Hedera SDK is stubbed. Nothing here claims to prove the trail exists on-chain — that is
 * `scripts/verify-audit-trail.ts`, which reads the real topic off the public mirror node and
 * follows every identifier it finds to the transaction it names.
 */

const sdk = vi.hoisted(() => {
  const execute = vi.fn();
  const close = vi.fn();
  const setOperator = vi.fn();
  const setRequestTimeout = vi.fn();
  return { execute, close, setOperator, setRequestTimeout };
});

vi.mock("@hiero-ledger/sdk", () => {
  class Client {
    static forTestnet() {
      return new Client();
    }
    static forMainnet() {
      return new Client();
    }
    setOperator(...args: unknown[]) {
      sdk.setOperator(...args);
      return this;
    }
    setRequestTimeout(ms: number) {
      sdk.setRequestTimeout(ms);
      return this;
    }
    close() {
      sdk.close();
    }
  }
  return {
    Client,
    AccountId: { fromString: (s: string) => ({ toString: () => s }) },
    TopicId: { fromString: (s: string) => ({ toString: () => s }) },
    PrivateKey: {
      fromStringECDSA: (s: string) => {
        if (!/^(0x)?[0-9a-fA-F]{64}$/.test(s)) throw new Error("not ECDSA");
        return { publicKey: "pub", toString: () => s };
      },
      fromStringED25519: (s: string) => {
        if (!s.startsWith("ed")) throw new Error("not ED25519");
        return { publicKey: "pub", toString: () => s };
      },
    },
    TopicMessageSubmitTransaction: class {
      setTopicId() {
        return this;
      }
      setMessage() {
        return this;
      }
      execute(client: unknown) {
        return sdk.execute(client);
      }
    },
  };
});

const KEY = "0x" + "11".repeat(32);

const settled = (): PaymentSettledRecord => ({
  v: AUDIT_SCHEMA_VERSION,
  event: "payment.settled",
  network: "hedera:testnet",
  resource: "/api/retainer/access",
  agent: "0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66",
  settlement: "0.0.7162784@1788962625.048553106",
  amountTinybar: "300000000",
  asset: "HBAR",
  facilitator: "api.testnet.blocky402.com",
  payer: "0.0.10403066",
  at: 1788962632,
});

let env: NodeJS.ProcessEnv;

beforeEach(() => {
  env = { ...process.env };
  delete process.env.HCS_AUDIT_TOPIC_ID;
  delete process.env.HCS_AUDIT_OPERATOR_ID;
  delete process.env.HCS_AUDIT_OPERATOR_KEY;
  delete process.env.RETAINER_PAY_TO;
  delete process.env.RETAINER_SERVER_KEY;
  delete process.env.X402_NETWORK;
  vi.clearAllMocks();
  sdk.execute.mockResolvedValue({
    transactionId: { toString: () => "0.0.10402910@1788962638.1" },
    getReceipt: async () => ({ topicSequenceNumber: { toString: () => "7" } }),
  });
});

afterEach(() => {
  process.env = env;
  vi.restoreAllMocks();
});

function configure() {
  process.env.HCS_AUDIT_TOPIC_ID = "0.0.10440194";
  process.env.RETAINER_PAY_TO = "0.0.10402910";
  process.env.RETAINER_SERVER_KEY = KEY;
}

describe("configuration", () => {
  it("is off, and reports itself off, until a topic is configured", () => {
    process.env.RETAINER_PAY_TO = "0.0.10402910";
    process.env.RETAINER_SERVER_KEY = KEY;
    expect(auditTopicId()).toBeUndefined();
    expect(auditEnabled()).toBe(false);
  });

  it("stays off when a topic is set but nothing can sign for it", () => {
    process.env.HCS_AUDIT_TOPIC_ID = "0.0.10440194";
    expect(auditEnabled()).toBe(false);
  });

  it("borrows the seller's account so enabling the trail is one variable", () => {
    configure();
    expect(auditEnabled()).toBe(true);
  });

  it("lets a different account own the trail without touching the money keys", async () => {
    configure();
    process.env.HCS_AUDIT_OPERATOR_ID = "0.0.999";
    process.env.HCS_AUDIT_OPERATOR_KEY = KEY;
    await submitAuditEvent(settled());
    expect(sdk.setOperator.mock.calls[0][0].toString()).toBe("0.0.999");
  });

  it("treats an empty topic id as unset rather than as a topic named ''", () => {
    process.env.HCS_AUDIT_TOPIC_ID = "   ";
    expect(auditTopicId()).toBeUndefined();
  });

  it("defaults to testnet and only reaches mainnet when told to", () => {
    expect(auditNetwork()).toBe("testnet");
    process.env.X402_NETWORK = "hedera:mainnet";
    expect(auditNetwork()).toBe("mainnet");
  });
});

describe("submitAuditEvent never rejects", () => {
  it("resolves ok:false when the trail is switched off", async () => {
    await expect(submitAuditEvent(settled())).resolves.toEqual({
      ok: false,
      reason: "audit trail is not configured",
    });
    expect(sdk.execute).not.toHaveBeenCalled();
  });

  it("resolves ok:false when Hedera throws, and still closes the client", async () => {
    configure();
    sdk.execute.mockRejectedValue(new Error("INSUFFICIENT_PAYER_BALANCE"));
    const outcome = await submitAuditEvent(settled());
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ reason: expect.stringContaining("INSUFFICIENT_PAYER_BALANCE") });
    expect(sdk.close).toHaveBeenCalledTimes(1);
  });

  it("resolves ok:false when the receipt never comes back", async () => {
    configure();
    sdk.execute.mockResolvedValue({
      transactionId: { toString: () => "0.0.1@1.1" },
      getReceipt: async () => {
        throw new Error("TIMEOUT");
      },
    });
    await expect(submitAuditEvent(settled())).resolves.toMatchObject({ ok: false });
  });

  it("reports the sequence number the network assigned when it works", async () => {
    configure();
    await expect(submitAuditEvent(settled())).resolves.toEqual({
      ok: true,
      topicId: "0.0.10440194",
      sequenceNumber: "7",
      transactionId: "0.0.10402910@1788962638.1",
    });
    expect(sdk.close).toHaveBeenCalledTimes(1);
  });
});

describe("one record, one consensus message", () => {
  it("keeps a real settlement record well inside the single-message limit", () => {
    expect(auditMessageBytes(settled())).toBeLessThan(MAX_MESSAGE_BYTES);
  });

  it("refuses to publish a record that would be chunked, rather than splitting the trail", async () => {
    configure();
    const huge = { ...settled(), payer: "x".repeat(MAX_MESSAGE_BYTES) };
    const outcome = await submitAuditEvent(huge);
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringContaining("single-message limit") });
    expect(sdk.execute).not.toHaveBeenCalled();
  });

  it("shrinks an unbounded failure reason until the record fits, keeping every other field", () => {
    const failure: SubscriptionFailedRecord = {
      v: AUDIT_SCHEMA_VERSION,
      event: "subscription.failed",
      network: "hedera:testnet",
      resource: "/api/retainer/access",
      agent: "0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66",
      settlement: "0.0.7162784@1788962625.048553106",
      amountTinybar: "300000000",
      contract: "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931",
      error: "revert ".repeat(400),
      at: 1788962638,
    };
    const fitted = fitFailureRecord(failure);
    expect(auditMessageBytes(fitted)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(fitted.error.length).toBeGreaterThan(0);
    expect(failure.error.startsWith(fitted.error)).toBe(true);
    expect(fitted.settlement).toBe(failure.settlement);
    expect(fitted.contract).toBe(failure.contract);
    expect(fitted.event).toBe("subscription.failed");
  });

  it("leaves a record that already fits completely alone", () => {
    const failure: SubscriptionFailedRecord = {
      v: AUDIT_SCHEMA_VERSION,
      event: "subscription.failed",
      network: "hedera:testnet",
      resource: "/api/retainer/access",
      agent: "0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66",
      settlement: "0.0.7162784@1788962625.048553106",
      amountTinybar: "300000000",
      contract: "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931",
      error: "NotSubscribed()",
      at: 1788962638,
    };
    expect(fitFailureRecord(failure)).toEqual(failure);
  });
});

describe("what a reader gets back", () => {
  it("survives the exact round trip the mirror node puts it through", () => {
    const record = settled();
    // This is what `scripts/verify-audit-trail.ts` does, and what any judge does with `base64 -d`.
    const asMirrorReturnsIt = Buffer.from(encodeAuditMessage(record), "utf8").toString("base64");
    expect(JSON.parse(Buffer.from(asMirrorReturnsIt, "base64").toString("utf8"))).toEqual(record);
  });

  it("carries the settlement id that joins the record to the chain", () => {
    const parsed = JSON.parse(encodeAuditMessage(settled()));
    expect(parsed.settlement).toBe("0.0.7162784@1788962625.048553106");
    expect(parsed.v).toBe(AUDIT_SCHEMA_VERSION);
  });
});

describe("operator keys", () => {
  it("reads an ECDSA key, which is what x402 on Hedera requires", () => {
    expect(parseOperatorKey(KEY)).toBeTruthy();
  });

  it("falls back to ED25519 rather than assuming the curve", () => {
    expect(parseOperatorKey("ed25519-looking-key")).toBeTruthy();
  });

  it("throws for something that is neither, instead of signing with a wrong key", () => {
    expect(() => parseOperatorKey("not-a-key")).toThrow();
  });
});
