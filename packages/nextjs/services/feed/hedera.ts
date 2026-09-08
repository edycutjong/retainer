/**
 * The thing that is actually being sold.
 *
 * Retainer's point is the renewal, but a subscription to nothing is not a product — and Hedera's
 * brief asks for a service you can pay for: "wrap an API, sell inference by the call, meter data
 * or compute". So the gated resource is a real metered data feed, not a constant.
 *
 * It reads the live HBAR/USD rate the Hedera network itself uses, straight from the mirror node.
 * That rate is not a third-party quote: it is the exchange rate the network applies when it
 * converts the USD-denominated fee schedule into tinybar, which is what makes Hedera fees
 * "predictable sub-cent". So a caller metering this feed is reading the same number that priced
 * their own transaction.
 *
 * Keyless and public, which matters here: the point of x402 is that the agent needs no API key
 * for OUR service, and it would be odd to prove that by hiding someone else's behind one.
 */

const MIRROR = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

export type Quote = {
  pair: "HBAR/USD";
  rate: number;
  /** The rate as the network stores it: cents and HBAR as integers. */
  raw: { centEquivalent: number; hbarEquivalent: number };
  /** Consensus second the rate takes effect until. */
  expirationTime: number | null;
  source: string;
  observedAt: number;
};

type NetworkRate = { cent_equivalent: number; hbar_equivalent: number; expiration_time?: number };

/**
 * Fetch the network's current HBAR/USD exchange rate.
 *
 * `no-store` on purpose: a metered feed that served a cached number would be charging for a
 * reading it did not take.
 */
export async function getQuote(): Promise<Quote> {
  const url = `${MIRROR}/api/v1/network/exchangerate`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`mirror node returned ${res.status} for ${url}`);
  }

  const body = (await res.json()) as { current_rate?: NetworkRate };
  const current = body.current_rate;
  if (!current?.cent_equivalent || !current?.hbar_equivalent) {
    throw new Error("mirror node response did not contain a usable current_rate");
  }

  return {
    pair: "HBAR/USD",
    // cents per HBAR → dollars per HBAR
    rate: current.cent_equivalent / current.hbar_equivalent / 100,
    raw: { centEquivalent: current.cent_equivalent, hbarEquivalent: current.hbar_equivalent },
    expirationTime: current.expiration_time ?? null,
    source: url,
    observedAt: Math.floor(Date.now() / 1000),
  };
}
