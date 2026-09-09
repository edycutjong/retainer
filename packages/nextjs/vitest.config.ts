import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the resource server's pure logic.
 *
 * Deliberately narrow: this suite covers the arithmetic that must never be wrong and can be
 * checked without a chain. Everything that touches Hedera is tested against a real network in
 * `packages/hardhat/test`, and the end-to-end path is exercised by
 * `packages/nextjs/scripts/retainer-agent.ts` against the live deployment. Nothing here mocks
 * a chain in order to claim coverage of one.
 */
export default defineConfig({
  resolve: {
    alias: { "~~": path.resolve(__dirname, ".") },
  },
  // Vitest 4 hands .tsx to esbuild, and this workspace's tsconfig sets `jsx: "preserve"` for
  // Next.js — which esbuild cannot parse. Ring.test.ts imports a component, so say explicitly
  // which JSX runtime to use rather than letting the tsconfig decide. Harmless under Vitest 3.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The property suite runs a few hundred thousand BigInt round trips.
    testTimeout: 60_000,
  },
});
