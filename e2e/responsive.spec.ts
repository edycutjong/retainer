import { expect, test } from "@playwright/test";

/**
 * Layout checks at the three widths that matter, run against `/judge`.
 *
 * `/judge` rather than the product UI on purpose: it is the page most likely to be opened on a
 * phone, from a link in a submission list, by someone who will not try twice — and it is styled
 * by its own CSS module, so these assertions stay meaningful while the product's design system
 * evolves independently.
 *
 * Every assertion is *relative* to the width the browser actually reports rather than to the
 * number requested. Emulated mobile devices do not honour a requested viewport the way a
 * desktop context does, and a test that hard-codes 375 quietly measures the wrong thing there.
 *
 * These caught a real bug on the first run: `/judge` is a flex item of the app shell, so it
 * sized to its content-based minimum — the widest `<pre>` is a curl command — and rendered
 * 864px wide inside a 375px viewport.
 */

const PAGE = '[data-testid="judge"]';

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`/judge at ${viewport.name} (${viewport.width}px)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.goto("/judge");
      await page.waitForSelector(PAGE);
    });

    test("the document does not scroll sideways", async ({ page }) => {
      // Wide content — the command blocks and the receipt tables — is allowed to scroll inside
      // its own container, which is why this measures the document rather than every element.
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(
        overflow,
        `document scrolls ${overflow}px sideways`,
      ).toBeLessThanOrEqual(1);
    });

    test("the heading fits the viewport", async ({ page }) => {
      const { heading, available } = await page.evaluate(() => ({
        heading:
          document.querySelector("h1")?.getBoundingClientRect().width ??
          Infinity,
        available: document.documentElement.clientWidth,
      }));
      expect(heading).toBeLessThanOrEqual(available);
    });

    test("body copy stays at a readable size", async ({ page }) => {
      const fontSize = await page
        .locator('[data-testid="judge-lede"]')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(15);
    });
  });
}
