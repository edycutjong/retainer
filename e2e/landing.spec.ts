import { expect, test } from "@playwright/test";

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
    await expect(page.locator("footer").getByText("v0.0.0-dev")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open /judge" }),
    ).toHaveAttribute("href", "/judge");
  });
});
