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

test("keeps Overview actions restrained and goals swipeable", async ({
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

  const goals = page.getByRole("region", { name: "Active goals" });
  const goalSlides = goals.locator("[data-slot='carousel-item']");
  await expect(goals).toBeVisible();
  await expect(goalSlides).toHaveCount(alphaFixture.goals.length);
  await expect(goals.locator(".overview-goal-carousel__position")).toHaveText(
    `1 / ${alphaFixture.goals.length}`,
  );
  const previousGoal = goals.getByRole("button", { name: "Previous goal" });
  const nextGoal = goals.getByRole("button", { name: "Next goal" });
  await expect(previousGoal).toBeDisabled();
  await expect(nextGoal).toBeEnabled();
  await expect(goalSlides.first().getByText("Primary goal")).toBeVisible();

  await nextGoal.focus();
  await page.keyboard.press("ArrowRight");
  await expect(goals.locator(".overview-goal-carousel__position")).toHaveText(
    `2 / ${alphaFixture.goals.length}`,
  );
  await page.keyboard.press("ArrowLeft");
  await expect(goals.locator(".overview-goal-carousel__position")).toHaveText(
    `1 / ${alphaFixture.goals.length}`,
  );

  const viewport = goals.locator("[data-slot='carousel-content']");
  const viewportBox = await viewport.boundingBox();
  expect(viewportBox).not.toBeNull();
  await page.mouse.move(
    viewportBox!.x + viewportBox!.width * 0.82,
    viewportBox!.y + viewportBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    viewportBox!.x + viewportBox!.width * 0.16,
    viewportBox!.y + viewportBox!.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(goals.locator(".overview-goal-carousel__position")).toHaveText(
    `2 / ${alphaFixture.goals.length}`,
  );
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await expect
    .poll(async () => {
      const [secondSlideBox, currentViewportBox] = await Promise.all([
        goalSlides.nth(1).locator(".overview-goal-card").boundingBox(),
        viewport.boundingBox(),
      ]);
      if (secondSlideBox === null || currentViewportBox === null) return null;
      return Math.abs(Math.round(secondSlideBox.x - currentViewportBox.x));
    })
    .toBe(0);
  await expect(page.locator(".overview-goals")).toHaveScreenshot(
    "overview-goals-carousel-swiped.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

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

test("keeps the carousel off Overview when only one goal is active", async ({
  page,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = withStableOverviewValues(
    (await alphaResponse.json()) as AlphaData,
  );
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({
      json: {
        ...alphaFixture,
        goals: alphaFixture.goals.slice(0, 1),
      } satisfies AlphaData,
    });
  });

  await page.goto("/");

  await expect(page.getByRole("region", { name: "Active goals" })).toHaveCount(
    0,
  );
  await expect(page.locator(".overview-goals")).toHaveCount(0);
  await expect(page.locator(".hero")).toContainText("Financial independence");
  await expectNoHorizontalOverflow(page);
});
