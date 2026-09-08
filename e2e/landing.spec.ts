import { expect, test } from "@playwright/test";
import { version } from "../package.json";

/**
 * The landing page's structure, asserted at the level a judge experiences it.
 *
 * The product UI used to be free of markup tests on purpose; now that the page carries the claim,
 * the instrument and the proof for a cold visitor, the things a judge relies on are pinned:
 * one claim, the instrument in the first viewport, the recorded run clearly labelled as
 * recorded, an explicit switch to the live chain, no autoplay under reduced motion, and no
 * sideways scroll on a phone. Nothing here depends on the chain answering.
 */

const CLAIM = "renews itself";

test.describe("/ — the landing page a cold visitor gets", () => {
  test("carries exactly one h1 with the claim, and the instrument above the fold", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText(CLAIM);

    const instrument = page.getByTestId("instrument");
    await expect(instrument).toBeVisible();
    const box = await instrument.boundingBox();
    expect(box, "the instrument must exist").not.toBeNull();
    expect(
      box!.y,
      "the instrument starts inside the first viewport",
    ).toBeLessThan(900);
  });

  test("labels the recorded run as recorded, and every receipt links to HashScan", async ({
    page,
  }) => {
    await page.goto("/");
    const instrument = page.getByTestId("instrument");
    await expect(instrument).toHaveAttribute("data-mode", "replay");
    await expect(
      instrument.getByText(/REPLAY · 2026-09-07 · 0\.0\.10406083/),
    ).toBeVisible();

    // Pause, then step through the run: the chips that appear are links to real transactions.
    await instrument.getByRole("button", { name: "Pause" }).click();
    for (let i = 0; i < 6; i++)
      await instrument.getByRole("button", { name: "Step" }).click();
    const chips = instrument.locator("a.rt-chip");
    await expect(chips).toHaveCount(4);
    for (const href of await chips.evaluateAll((as) =>
      as.map((a) => a.getAttribute("href")),
    )) {
      expect(href).toMatch(
        /^https:\/\/hashscan\.io\/testnet\/transaction\/\d+\.\d+$/,
      );
    }
  });

  test("switches to the live chain explicitly and says so", async ({
    page,
  }) => {
    await page.goto("/");
    const instrument = page.getByTestId("instrument");
    await instrument.getByRole("tab", { name: "Live chain" }).click();
    await expect(instrument).toHaveAttribute("data-mode", "live");
    await expect(
      instrument.getByText(/LIVE · Hedera testnet · 0\.0\.10415845/),
    ).toBeVisible();
    await expect(
      instrument.getByPlaceholder("0x… agent address"),
    ).toBeVisible();
  });

  test("does not autoplay the replay when the visitor prefers reduced motion", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    const play = page
      .getByTestId("instrument")
      .getByRole("button", { name: "Play" });
    await expect(play).toBeVisible();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    await context.close();
  });

  test("does not scroll sideways on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForSelector('[data-testid="instrument"]');
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(
      overflow,
      `document scrolls ${overflow}px sideways`,
    ).toBeLessThanOrEqual(1);
  });

  test("has the landmarks and the version stamp a real page has", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);
    // Read from the manifest rather than hard-coding: `yarn release:*` bumps that file and tags
    // the same commit, so pinning a literal here would fail every release for the wrong reason.
    await expect(
      page.locator("footer").getByText(`v${version}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open /judge" }),
    ).toHaveAttribute("href", "/judge");
  });
});

/**
 * The dead-link guard.
 *
 * The header's "Contract" item and a footer entry both pointed at `/debug`, a route whose page
 * called `notFound()` unconditionally — so the nav promised a contract and served a 404. No test
 * caught it, and an HTTP-status sweep would not have either: Next serves the not-found body for
 * an in-app `notFound()` without the link itself ever looking broken.
 *
 * So this asserts what a visitor actually experiences — the destination is not the 404 page —
 * rather than that the request succeeded.
 */
test.describe("navigation goes where it says", () => {
  test("no header or footer link lands on the not-found page", async ({ page }) => {
    await page.goto("/");
    // The shell is client-rendered, so the nav does not exist on first paint and `evaluateAll`
    // does not auto-wait the way a normal locator assertion does.
    await expect(page.locator("footer a").first()).toBeAttached();

    const hrefs = await page
      .locator("header a, footer a")
      .evaluateAll(nodes =>
        nodes
          .map(n => n.getAttribute("href") ?? "")
          // In-app routes only; external destinations are somebody else's uptime.
          .filter(h => h.startsWith("/") && !h.startsWith("/#")),
      );

    expect(hrefs.length, "expected some in-app nav links to check").toBeGreaterThan(0);

    for (const href of new Set(hrefs)) {
      await page.goto(href);
      // Wait for the destination to actually render something first. `toHaveCount(0)` is
      // satisfied instantly by an empty DOM, so asserting it against the un-hydrated shell
      // would pass for every route including the broken ones — which is how the /debug link
      // survived a full QA pass in the first place.
      await expect(page.locator("h1, h2").first()).toBeVisible();
      // Anchored on the not-found page's own heading. A bare /404/ would false-positive: real
      // consensus timestamps on /judge contain "404".
      await expect(
        page.getByRole("heading", { name: "Page Not Found" }),
        `${href} renders the not-found page`,
      ).toHaveCount(0);
    }
  });
});
