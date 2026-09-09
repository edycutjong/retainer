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
  // This workspace's tsconfig sets `jsx: "preserve"` because Next.js requires it, and Vite reads
  // that setting for its own transform — leaving JSX untouched, so Ring.test.ts (the one suite
  // that imports a component) fails import analysis. Name the runtime explicitly instead of
  // letting the tsconfig decide. Both keys are needed and neither is redundant: Vite 7 and below
  // transform with esbuild, Vite 8 (Vitest 4) switched to Oxc and ignores the esbuild key.
  esbuild: { jsx: "automatic" },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The property suite runs a few hundred thousand BigInt round trips.
    testTimeout: 60_000,
  },
});
