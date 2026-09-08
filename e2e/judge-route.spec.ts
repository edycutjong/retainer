import { expect, test } from "@playwright/test";

/**
 * `/judge` is the surface built for a single reader, and it is the one page in this project
 * that must never require anything of them.
 *
 * A judge page that has gone 404, started redirecting, or begun asking for a wallet on
 * submission day is worse than not having one at all — so the guarantee is asserted rather
 * than assumed: **no credentials, no session, no cookies, no redirect, 200.**
 */

const CLAIM = "renews itself on-chain at 3am";
const PAGE = '[data-testid="judge"]';
const baseURL =
  process.env.E2E_BASE_URL ??
  `http://localhost:${process.env.E2E_PORT ?? 3000}`;

test.describe("/judge — reachable with nothing", () => {
  test("returns 200 to a bare HTTP request with no cookies and no session", async ({
    playwright,
  }) => {
    // A brand-new request context: no storage state, no cookies, nothing inherited from any
    // other test. This is what someone opening the link from a submission page gets.
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });

    const response = await anonymous.get("/judge");
    expect(response.status()).toBe(200);

    const html = await response.text();
    expect(html).toContain(CLAIM);

    await anonymous.dispose();
  });

  test("does not redirect anywhere on the way", async ({ page }) => {
    const response = await page.goto("/judge");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/judge");
  });

  test("carries the claim, the receipts and the limitations a judge came for", async ({
    page,
  }) => {
    await page.goto("/judge");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(CLAIM);

    // The receipt numbers, not prose about them.
    await expect(page.getByText("1.54896 HBAR").first()).toBeVisible();
    await expect(page.getByText("0.0507 HBAR").first()).toBeVisible();
    await expect(page.getByText("202,059").first()).toBeVisible();

    // The limitations section exists and leads with the unflattering one.
    await expect(
      page.getByRole("heading", { name: "Honest limitations" }),
    ).toBeVisible();
    await expect(
      page.getByText("loses money on every renewal").first(),
    ).toBeVisible();

    // The verify-it-yourself links, which are what make the receipts checkable.
    await expect(
      page
        .getByRole("link", { name: /hashscan\.io\/testnet\/contract/ })
        .first(),
    ).toBeVisible();
  });

  test("every outbound link is absolute and https, so nothing dead-ends off a fork", async ({
    page,
  }) => {
    await page.goto("/judge");
    // evaluateAll does not auto-wait, so wait for the page to exist before counting.
    await page.waitForSelector(`${PAGE} a[href]`);
    const hrefs = await page
      .locator(`${PAGE} a[href]`)
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href") ?? ""));

    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      expect(href, `link "${href}" should be an absolute https URL`).toMatch(
        /^https:\/\//,
      );
    }
  });
});
