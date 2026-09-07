import { type Address, createPublicClient, getAddress, http } from "viem";
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
