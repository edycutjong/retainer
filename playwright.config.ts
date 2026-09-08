import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, run against a real production build of the resource server.
 *
 * Two deliberate constraints:
 *
 * 1. **No credentials, no chain writes.** Everything here passes with an empty environment, so
 *    it runs on a fork and on a first clone. That is a property of the *test suite*, not of the
 *    product: the product has no offline or mock mode, and the paid path is proven against the
 *    live network by `packages/nextjs/scripts/retainer-agent.ts` and recorded in `docs/proof.md`.
 * 2. **Route-level, not markup-level.** These assert HTTP status, response shape and the
 *    judge-facing page's own content. They deliberately do not assert on the product UI's
 *    markup, which is free to change without a test going red for no reason.
 *
 * The single most important assertion in here is in `gate.spec.ts`: with no seller account
 * configured, the gate must never answer 200. It fails closed or it is not a gate.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  // Skipped when E2E_BASE_URL points somewhere already running (CI builds once, then serves).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "yarn next:build && yarn next:serve",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
