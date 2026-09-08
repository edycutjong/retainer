import type { HTTPRequestContext } from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";

/**
 * x402 resource-server wiring for Retainer's paid route.
 *
 * This module owns the single {@link x402ResourceServer} instance used to build
 * payment requirements and to verify / settle payments. Verification and
 * settlement are delegated to the hosted Blocky402 facilitator on Hedera testnet
 * ({@link FACILITATOR_URL}); this process never holds keys or funds.
 */

/** x402 network identifier, e.g. `hedera:testnet`. */
export const X402_NETWORK = (process.env.X402_NETWORK ?? "hedera:testnet") as Network;

/**
 * Base URL of the x402 facilitator.
 *
 * Defaults to the hosted Blocky402 testnet facilitator. Settlement must go through
 * Blocky402, so this is the default rather than an opt-in: cloning the repo and running
 * it with no extra configuration uses the correct rail.
 *
 * Verified 2026-09-07: `GET /supported` advertises `hedera:testnet`, scheme `exact`,
 * x402Version 2, and supplies its own fee payer, so no self-hosted facilitator is needed.
 */
export const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "https://api.testnet.blocky402.com";

/** Asset id used by x402 to denote native HBAR; amounts are quoted in tinybars. */
export const HBAR_ASSET = "0.0.0";

/** Window a client has to present a valid payment for a 402 challenge. */
export const MAX_TIMEOUT_SECONDS = 180;

let serverPromise: Promise<x402ResourceServer> | null = null;

/**
 * Lazily build and initialise the resource server.
 *
 * `initialize()` fetches the facilitator's supported kinds (which carry the fee
 * payer used to enrich payment requirements), so it must complete before any
 * requirements are built. The promise is cached on success and cleared on
 * failure so a transient facilitator outage does not permanently wedge the app.
 *
 * @returns The initialised resource server.
 */
export function getResourceServer(): Promise<x402ResourceServer> {
  if (!serverPromise) {
    serverPromise = (async () => {
      const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
      const server = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme());
      await server.initialize();
      return server;
    })().catch(error => {
      serverPromise = null;
      throw error;
    });
  }
  return serverPromise;
}

/**
 * Adapt a Web `Request` into the {@link HTTPRequestContext} the resource server
 * expects, extracting the x402 payment header under either the v2
 * (`PAYMENT-SIGNATURE`) or legacy (`X-PAYMENT`) name.
 *
 * @param req - Incoming request.
 * @returns The request context plus the canonical resource URL.
 */
export function makeHttpContext(req: Request): { context: HTTPRequestContext; resourceUrl: string } {
  const url = new URL(req.url);
  const resourceUrl = `${url.origin}${url.pathname}`;

  const context: HTTPRequestContext = {
    adapter: {
      getHeader: name => req.headers.get(name) ?? undefined,
      getMethod: () => req.method,
      getPath: () => url.pathname,
      getUrl: () => req.url,
      getAcceptHeader: () => req.headers.get("accept") ?? "",
      getUserAgent: () => req.headers.get("user-agent") ?? "",
      getQueryParam: name => url.searchParams.get(name) ?? undefined,
    },
    path: url.pathname,
    method: req.method,
    paymentHeader: req.headers.get("payment-signature") ?? req.headers.get("x-payment") ?? undefined,
  };

  return { context, resourceUrl };
}
