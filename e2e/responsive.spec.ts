import { expect, test } from "@playwright/test";

/**
 * Layout checks at the three widths that matter, run against `/judge`.
 *
 * `/judge` rather than the product UI on purpose: it is the page most likely to be opened on a
 * phone, from a link in a submission list, by someone who will not try twice — and it is
 * styled by its own CSS module, so these assertions stay meaningful while the product's design
 * system evolves independently.
 */

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

test.describe("/judge is readable at every width", () => {
  for (const viewport of VIEWPORTS) {
    test(`no horizontal overflow at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/judge");

      // The page itself must never scroll sideways. Wide content — the command blocks and the
      // receipt tables — is allowed to scroll inside its own container, which is why this
      // measures documentElement rather than every element.
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflow, `document scrolls ${overflow}px sideways`).toBeLessThanOrEqual(1);
    });

    test(`body text stays legible at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/judge");

      const fontSize = await page
        .locator('[data-testid="judge"] p')
        .first()
        .evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(14);
    });
  }

  test("the heading fits the narrowest viewport without clipping", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/judge");

    const heading = page.getByRole("heading", { level: 1 });
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(375);
  });
});
