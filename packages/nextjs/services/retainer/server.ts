import { type Address, type Hex, createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployedContracts from "~~/contracts/deployedContracts";
import scaffoldConfig from "~~/scaffold.config";

/**
 * Server-side reader for the on-chain `RetainerAccess` contract.
 *
 * The resource server asks one question on every request: does this agent currently
 * hold access? That answer is on-chain and nobody has to be awake to maintain it —
 * the contract renews its own subscriptions via the Hedera Schedule Service.
 */

const targetChain = scaffoldConfig.targetNetworks[0];

export class RetainerNotDeployedError extends Error {
  constructor() {
    super("RetainerAccess is not deployed on the target network");
    this.name = "RetainerNotDeployedError";
  }
}

export const RETAINER_ABI = [
  {
    type: "function",
    name: "hasAccess",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "subscriptionOf",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      { name: "balance", type: "uint256" },
      { name: "pricePerPeriod", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "periodSeconds", type: "uint32" },
      { name: "active", type: "bool" },
      { name: "schedule", type: "address" },
    ],
  },
  {
    type: "function",
    name: "subscribeFor",
    stateMutability: "payable",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "creditFor",
    stateMutability: "payable",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "renewalsRemaining",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export function getRetainerAddress(): Address | undefined {
  const fromEnv = process.env.RETAINER_ACCESS_ADDRESS ?? process.env.NEXT_PUBLIC_RETAINER_ACCESS_ADDRESS;
  if (fromEnv) return getAddress(fromEnv);

  const chainContracts = (deployedContracts as Record<number, Record<string, { address?: string }>>)[targetChain.id];
  const address = chainContracts?.RetainerAccess?.address;
  return address ? getAddress(address) : undefined;
}

let cachedClient: ReturnType<typeof createPublicClient> | null = null;

function getClient() {
  if (!cachedClient) {
    const rpcUrl =
      process.env.HEDERA_RPC_URL ||
      scaffoldConfig.rpcOverrides?.[targetChain.id] ||
      targetChain.rpcUrls.default.http[0];
    cachedClient = createPublicClient({ chain: targetChain, transport: http(rpcUrl) });
  }
  return cachedClient;
}

export type Subscription = {
  balance: bigint;
  pricePerPeriod: bigint;
  expiresAt: bigint;
  periodSeconds: number;
  active: boolean;
  schedule: Address;
};

/** Does this agent hold access right now? The only question the gate asks. */
export async function hasAccess(agent: Address): Promise<boolean> {
  const address = getRetainerAddress();
  if (!address) throw new RetainerNotDeployedError();

  return (await getClient().readContract({
    address,
    abi: RETAINER_ABI,
    functionName: "hasAccess",
    args: [agent],
  })) as boolean;
}

/** Full subscription state — used to explain *why* access is or is not held. */
export async function subscriptionOf(agent: Address): Promise<Subscription> {
  const address = getRetainerAddress();
  if (!address) throw new RetainerNotDeployedError();

  const r = (await getClient().readContract({
    address,
    abi: RETAINER_ABI,
    functionName: "subscriptionOf",
    args: [agent],
  })) as readonly [bigint, bigint, bigint, number, boolean, Address];

  return {
    balance: r[0],
    pricePerPeriod: r[1],
    expiresAt: r[2],
    periodSeconds: r[3],
    active: r[4],
    schedule: r[5],
  };
}

/** 1 tinybar = 1e10 weibar. Storage is tinybar; `value` on the wire is weibar. */
const WEIBAR_PER_TINYBAR = 10n ** 10n;

export class ServerKeyMissingError extends Error {
  constructor() {
    super("RETAINER_SERVER_KEY is not configured; the server cannot forward settled payments on-chain");
    this.name = "ServerKeyMissingError";
  }
}

function getWallet() {
  const key = process.env.RETAINER_SERVER_KEY;
  if (!key) throw new ServerKeyMissingError();
  const rpcUrl =
    process.env.HEDERA_RPC_URL || scaffoldConfig.rpcOverrides?.[targetChain.id] || targetChain.rpcUrls.default.http[0];
  return createWalletClient({
    account: privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex),
    chain: targetChain,
    transport: http(rpcUrl),
  });
}

/**
 * Turn a settled x402 payment into on-chain subscription state.
 *
 * This is the join between the two rails. The agent signs one x402 payment off-chain; the
 * seller receives it and forwards the same amount into `RetainerAccess`, which opens the
 * subscription and arms the first scheduled renewal. From then on the Hedera Schedule Service
 * keeps the access alive and the agent never signs anything again.
 *
 * Without this the agent would have to send its own on-chain transaction, which is exactly the
 * "somebody has to be awake" problem the project exists to remove.
 */
export async function openSubscriptionFor(agent: Address, tinybar: bigint): Promise<Hex> {
  const address = getRetainerAddress();
  if (!address) throw new RetainerNotDeployedError();

  return await getWallet().writeContract({
    address,
    abi: RETAINER_ABI,
    functionName: "subscribeFor",
    args: [agent],
    value: tinybar * WEIBAR_PER_TINYBAR,
  });
}

/** Top up an existing subscriber's refundable balance from a settled payment. */
export async function creditSubscription(agent: Address, tinybar: bigint): Promise<Hex> {
  const address = getRetainerAddress();
  if (!address) throw new RetainerNotDeployedError();

  return await getWallet().writeContract({
    address,
    abi: RETAINER_ABI,
    functionName: "creditFor",
    args: [agent],
    value: tinybar * WEIBAR_PER_TINYBAR,
  });
}

/** How many further renewals the contract's gas reserve can arm. */
export async function renewalsRemaining(): Promise<bigint> {
  const address = getRetainerAddress();
  if (!address) throw new RetainerNotDeployedError();
  return (await getClient().readContract({
    address,
    abi: RETAINER_ABI,
    functionName: "renewalsRemaining",
  })) as bigint;
}
