import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHederaProviderSigner, createUniversalProviderHederaSigner } from "~~/services/x402/walletSigner";

/**
 * What the browser signer *builds* before a wallet ever sees it.
 *
 * The Hedera SDK and the WalletConnect provider are stubbed: this file makes no claim about
 * whether a transaction would be accepted by the network. It pins the assembly instead —
 * the part that is ours and the part that is silently wrong when it is wrong:
 *
 *   - the transfer must balance (payer debited exactly what the recipient is credited);
 *   - HBAR and HTS take different SDK calls off the same `asset` field;
 *   - the transaction id must be generated for the **facilitator's** fee payer, not the payer,
 *     because that is what makes the transfer fee-payer-sponsored;
 *   - `signerAccountId` must be CAIP-prefixed with the network, or HashPack rejects the request.
 *
 * Every guard clause is checked by its real message, because those messages are what a user
 * sees when a payment cannot be built.
 */

const sdk = vi.hoisted(() => {
  const addHbarTransfer = vi.fn();
  const addTokenTransfer = vi.fn();
  const setTransactionId = vi.fn();
  const accountFromString = vi.fn((value: string) => ({ account: value }));
  const tokenFromString = vi.fn((value: string) => ({ token: value }));
  const hbarFromTinybars = vi.fn((value: string) => ({ tinybars: value }));
  const transactionIdGenerate = vi.fn((account: unknown) => ({ generatedFor: account }));
  return {
    addHbarTransfer,
    addTokenTransfer,
    setTransactionId,
    accountFromString,
    tokenFromString,
    hbarFromTinybars,
    transactionIdGenerate,
  };
});

const x402hedera = vi.hoisted(() => ({
  isSupportedHederaNetwork: vi.fn(() => true),
  isHbarAsset: vi.fn(() => true),
}));

vi.mock("@hiero-ledger/sdk", () => ({
  AccountId: { fromString: sdk.accountFromString },
  TokenId: { fromString: sdk.tokenFromString },
  Hbar: { fromTinybars: sdk.hbarFromTinybars },
  TransactionId: { generate: sdk.transactionIdGenerate },
  TransferTransaction: class {
    addHbarTransfer(...args: unknown[]) {
      sdk.addHbarTransfer(...args);
      return this;
    }
    addTokenTransfer(...args: unknown[]) {
      sdk.addTokenTransfer(...args);
      return this;
    }
    setTransactionId(...args: unknown[]) {
      sdk.setTransactionId(...args);
      return this;
    }
  },
}));

vi.mock("@x402/hedera", () => x402hedera);

const PAYER = "0.0.1001";
const FEE_PAYER = "0.0.7162784";

/** A provider that records what it was asked to sign and returns three known bytes. */
function makeProvider() {
  const signed = { toBytes: () => new Uint8Array([1, 2, 3]) };
  return {
    hedera_signTransaction: vi.fn(async () => signed),
  } as never;
}

function requirements(overrides: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    payTo: "0.0.2002",
    amount: "300000000",
    extra: { feePayer: FEE_PAYER },
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  x402hedera.isSupportedHederaNetwork.mockReturnValue(true);
  x402hedera.isHbarAsset.mockReturnValue(true);
});

describe("createHederaProviderSigner — the signer handed to the x402 client", () => {
  it("carries the account id it was created for", () => {
    const signer = createHederaProviderSigner(PAYER, makeProvider());
    expect(signer.accountId).toBe(PAYER);
  });

  it("is still exported under the deprecated name, so an older import keeps working", () => {
    expect(createUniversalProviderHederaSigner).toBe(createHederaProviderSigner);
  });

  it("accepts an explicit network in its config as well as defaulting to the client network", async () => {
    const withConfig = createHederaProviderSigner(PAYER, makeProvider(), { network: "hedera:mainnet" as never });
    const withDefault = createHederaProviderSigner(PAYER, makeProvider());

    await expect(withConfig.createPartiallySignedTransferTransaction(requirements())).resolves.toBe("AQID");
    await expect(withDefault.createPartiallySignedTransferTransaction(requirements())).resolves.toBe("AQID");
  });
});

describe("building the transfer — HBAR", () => {
  it("debits the payer and credits the recipient the identical tinybar amount, in one balanced transfer", async () => {
    const signer = createHederaProviderSigner(PAYER, makeProvider());

    await signer.createPartiallySignedTransferTransaction(requirements({ amount: "300000000" }));

    expect(sdk.addHbarTransfer).toHaveBeenCalledTimes(2);
    expect(sdk.hbarFromTinybars).toHaveBeenNthCalledWith(1, "-300000000");
    expect(sdk.hbarFromTinybars).toHaveBeenNthCalledWith(2, "300000000");
    expect(sdk.addHbarTransfer.mock.calls[0][0]).toEqual({ account: PAYER });
    expect(sdk.addHbarTransfer.mock.calls[1][0]).toEqual({ account: "0.0.2002" });
    expect(sdk.addTokenTransfer).not.toHaveBeenCalled();
  });

  it("generates the transaction id for the facilitator's fee payer, which is what makes the transfer sponsored", async () => {
    const signer = createHederaProviderSigner(PAYER, makeProvider());

    await signer.createPartiallySignedTransferTransaction(requirements());

    expect(sdk.transactionIdGenerate).toHaveBeenCalledWith({ account: FEE_PAYER });
    expect(sdk.setTransactionId).toHaveBeenCalledWith({ generatedFor: { account: FEE_PAYER } });
  });

  it("asks the wallet to sign as `<network>:<accountId>` and returns the signed bytes base64-encoded", async () => {
    const provider = makeProvider();
    const signer = createHederaProviderSigner(PAYER, provider);

    const result = await signer.createPartiallySignedTransferTransaction(requirements());

    expect(
      (provider as unknown as { hedera_signTransaction: ReturnType<typeof vi.fn> }).hedera_signTransaction,
    ).toHaveBeenCalledTimes(1);
    const arg = (provider as unknown as { hedera_signTransaction: ReturnType<typeof vi.fn> }).hedera_signTransaction
      .mock.calls[0][0];
    expect(arg.signerAccountId).toBe(`hedera:testnet:${PAYER}`);
    expect(arg.transactionBody).toBeDefined();
    expect(result).toBe(Buffer.from(new Uint8Array([1, 2, 3])).toString("base64"));
    expect(result).toBe("AQID");
  });
});

describe("building the transfer — HTS token", () => {
  it("uses addTokenTransfer against the asset's token id when the asset is not native HBAR", async () => {
    x402hedera.isHbarAsset.mockReturnValue(false);
    const signer = createHederaProviderSigner(PAYER, makeProvider());

    await signer.createPartiallySignedTransferTransaction(requirements({ asset: "0.0.5005", amount: "42" }));

    expect(sdk.tokenFromString).toHaveBeenCalledWith("0.0.5005");
    expect(sdk.addTokenTransfer).toHaveBeenNthCalledWith(1, { token: "0.0.5005" }, { account: PAYER }, -42n);
    expect(sdk.addTokenTransfer).toHaveBeenNthCalledWith(2, { token: "0.0.5005" }, { account: "0.0.2002" }, 42n);
    expect(sdk.addHbarTransfer).not.toHaveBeenCalled();
  });
});

describe("guard clauses — every way a payment is refused before a wallet is opened", () => {
  it("refuses a network the x402 Hedera package does not support, naming the network", async () => {
    x402hedera.isSupportedHederaNetwork.mockReturnValue(false);
    const provider = makeProvider();
    const signer = createHederaProviderSigner(PAYER, provider);

    await expect(
      signer.createPartiallySignedTransferTransaction(requirements({ network: "solana:mainnet" })),
    ).rejects.toThrow("Unsupported Hedera network: solana:mainnet");
    expect(
      (provider as unknown as { hedera_signTransaction: ReturnType<typeof vi.fn> }).hedera_signTransaction,
    ).not.toHaveBeenCalled();
  });

  it("refuses requirements whose extra block carries no fee payer", async () => {
    const signer = createHederaProviderSigner(PAYER, makeProvider());

    await expect(signer.createPartiallySignedTransferTransaction(requirements({ extra: {} }))).rejects.toThrow(
      "feePayer is required in paymentRequirements.extra",
    );
  });

  it("refuses requirements with no extra block at all, rather than reading through undefined", async () => {
    const signer = createHederaProviderSigner(PAYER, makeProvider());

    await expect(signer.createPartiallySignedTransferTransaction(requirements({ extra: undefined }))).rejects.toThrow(
      "feePayer is required in paymentRequirements.extra",
    );
  });

  it("refuses a fee payer that is present but not a string", async () => {
    const signer = createHederaProviderSigner(PAYER, makeProvider());

    await expect(
      signer.createPartiallySignedTransferTransaction(requirements({ extra: { feePayer: 7162784 } })),
    ).rejects.toThrow("feePayer is required in paymentRequirements.extra");
  });

  it("refuses a zero or negative amount, so a signature is never requested for a transfer of nothing", async () => {
    const signer = createHederaProviderSigner(PAYER, makeProvider());

    await expect(signer.createPartiallySignedTransferTransaction(requirements({ amount: "0" }))).rejects.toThrow(
      "amount must be greater than zero",
    );
    await expect(signer.createPartiallySignedTransferTransaction(requirements({ amount: "-1" }))).rejects.toThrow(
      "amount must be greater than zero",
    );
    expect(sdk.addHbarTransfer).not.toHaveBeenCalled();
  });

  it("lets a non-numeric amount fail loudly at BigInt rather than silently signing for zero", async () => {
    const signer = createHederaProviderSigner(PAYER, makeProvider());

    await expect(
      signer.createPartiallySignedTransferTransaction(requirements({ amount: "not-a-number" })),
    ).rejects.toThrow(SyntaxError);
  });
});
