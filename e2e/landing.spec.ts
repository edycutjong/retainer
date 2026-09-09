import { type Page, expect, test } from "@playwright/test";
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

/**
 * The status the page reads on arrival, stubbed.
 *
 * The landing page asks the chain once, unprompted, whether the demo agent's window is open, and
 * behaves differently depending on the answer. Left unstubbed that makes these tests a function of
 * what testnet happens to be doing at the minute they run — which is exactly how a green suite went
 * red the moment the demo was restarted, with no code change between the two runs. So the answer is
 * supplied here, both ways round, and the chain gets to decide nothing.
 */
const statusBody = (open: boolean) => ({
  agent: "0xD14CA86A1483e9b2147a7B86fB74D437d3d2Cc66",
  contract: "0x433050c9bd203FBdd49FAB6b5E20eD3E1FB2a931",
  hasAccess: open,
  expiresAt: open ? Math.floor(Date.now() / 1000) + 1800 : 0,
  secondsRemaining: open ? 1800 : 0,
  periodSeconds: open ? 3600 : 0,
  pricePerPeriodTinybar: "100000000",
  balanceTinybar: open ? "17600000000" : "0",
  periodsFunded: open ? 176 : 0,
  active: open,
  nextRenewalSchedule: open
    ? "0x00000000000000000000000000000000009F56b5"
    : "0x0000000000000000000000000000000000000000",
  renewalsReserveCanArm: open ? 176 : 0,
  usage: { used: 0, allowance: 5, remaining: open ? 5 : 0 },
  unavailable: [],
  now: Math.floor(Date.now() / 1000),
});

/** Answer every status read with `open`, after `delayMs`. Resolves the count of reads served. */
async function stubStatus(page: Page, open: boolean, delayMs = 0) {
  const served = { count: 0 };
  await page.route("**/api/retainer/status**", async route => {
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    served.count += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(statusBody(open)),
    });
  });
  return served;
}

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
    // Ask for the recorded run rather than assuming it is what a cold visitor gets: when the demo
    // agent's window is open on chain, the page legitimately opens on the live tab instead.
    await instrument.getByRole("tab", { name: "Recorded run" }).click();
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
    await stubStatus(page, false);
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

  test("opens on the live chain when the demo agent's window is open and nobody has touched it", async ({
    page,
  }) => {
    await stubStatus(page, true);
    await page.goto("/");
    const instrument = page.getByTestId("instrument");
    await expect(instrument).toHaveAttribute("data-mode", "live");
  });

  /**
   * The regression this file exists to prevent from recurring.
   *
   * The arrival read lands a few hundred milliseconds after paint. While the demo agent was lapsed
   * it answered "closed" and changed nothing, so nothing here ever ran against the other branch.
   * Once the demo was restarted the same read started switching the instrument to live *after* a
   * visitor had begun working the replay — the controls unmounted under a click already in flight
   * (`element is not stable`). The suite caught it, on a branch that touched no UI code at all.
   */
  test("a late arrival read never pulls the mode away from a visitor already working the replay", async ({
    page,
  }) => {
    const served = await stubStatus(page, true, 1200);
    await page.goto("/");
    const instrument = page.getByTestId("instrument");

    // Take hold of the instrument before the read can land.
    await instrument.getByRole("tab", { name: "Recorded run" }).click();
    await expect(instrument).toHaveAttribute("data-mode", "replay");

    // Now let it land — and keep landing, because the live window polls.
    await expect.poll(() => served.count, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(instrument).toHaveAttribute("data-mode", "replay");
    await expect(
      instrument.getByRole("button", { name: /Pause|Play/ }),
    ).toBeVisible();
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
