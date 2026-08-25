import { expect, test, type Page } from "@playwright/test";
import type { AlphaData } from "../packages/domain/src/index";

import { withStableOverviewValues } from "./overview-alpha-fixture";

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test("keeps Overview text actions restrained and reusable", async ({
  page,
}, testInfo) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = withStableOverviewValues(
    (await alphaResponse.json()) as AlphaData,
  );
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });

  await page.goto("/");

  const textLinks = page.locator('[data-slot="text-link"]');
  await expect(textLinks).toHaveCount(4);
  expect(
    (await textLinks.allTextContents()).every((label) => !label.includes("→")),
  ).toBe(true);

  const linkStyles = await textLinks.evaluateAll((links) =>
    links.map((link) => {
      const styles = window.getComputedStyle(link);
      const bounds = link.getBoundingClientRect();
      return {
        height: bounds.height,
        textDecorationLine: styles.textDecorationLine,
      };
    }),
  );
  expect(
    linkStyles.every(
      ({ height, textDecorationLine }) =>
        height >= (testInfo.project.name === "mobile-chromium" ? 44 : 40) &&
        textDecorationLine === "none",
    ),
  ).toBe(true);

  const heroAction = page
    .locator(".hero")
    .getByRole("button", { name: "Edit this goal" });
  await heroAction.focus();
  await expect(heroAction).toBeFocused();
  expect(
    await heroAction.evaluate((link) => {
      const styles = window.getComputedStyle(link);
      return {
        boxShadow: styles.boxShadow,
        outlineStyle: styles.outlineStyle,
      };
    }),
  ).toEqual({ boxShadow: "none", outlineStyle: "solid" });
  await heroAction.evaluate((link) => (link as HTMLElement).blur());

  await expect(page.locator(".hero")).toHaveScreenshot(
    "overview-hero-links.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await expect(page.locator(".metrics-grid")).toHaveScreenshot(
    "overview-metric-links.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await expect(page.locator(".metrics-grid")).not.toContainText("→");
  await expectNoHorizontalOverflow(page);
});
