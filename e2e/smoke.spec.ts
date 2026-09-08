import { expect, test } from "@playwright/test";

/**
 * The app boots and serves its pages with an entirely empty environment — no seller key, no
 * WalletConnect project id, no facilitator credentials.
 *
 * This is about the *build* being honest, not about the product being keyless. The paid path
 * genuinely needs a funded Hedera account; what it must never need is a secret in order to
 * render at all.
 *
 * Assertions here are route-level on purpose. The product UI is redesigned freely; a test that
 * pinned its markup would go red for a reason that has nothing to do with correctness.
 */
test.describe("smoke — the server stands up with no configuration", () => {
  test("serves the live view", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("serves the judge page", async ({ page }) => {
    const response = await page.goto("/judge");
    expect(response?.status()).toBe(200);
  });

  test("answers 404 for a route that does not exist rather than 500", async ({
    request,
  }) => {
    const response = await request.get("/definitely-not-a-route");
    expect(response.status()).toBe(404);
  });

  test("the live view reports no uncaught page error", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    expect(pageErrors).toEqual([]);
  });
});
