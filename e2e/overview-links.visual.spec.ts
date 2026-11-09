import { expect, test, type Page } from "@playwright/test";
import type { AlphaData } from "../packages/domain/src/index";
import { formatCompactMoney, formatProbability } from "../apps/web/src/format";

import { withStableOverviewValues } from "./overview-alpha-fixture";

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

function latestGoalName(goal: AlphaData["goals"][number] | undefined) {
  const version = goal?.versions[0];
  if (version === undefined) {
    throw new Error("Expected a saved goal version in the Overview fixture.");
  }
  return version.name;
}

function formatExpectedGoalValue(
  value: number,
  unit: AlphaData["goals"][number]["versions"][number]["targetUnit"],
) {
  if (unit === "minor_units") return formatCompactMoney(value);
  if (unit === "ppm") return formatProbability(value);
  return `${new Intl.NumberFormat("en-US").format(value)} ${
    unit === "months" ? "months" : ""
  }`.trim();
}

function expectedGoalProgress(
  version: AlphaData["goals"][number]["versions"][number],
) {
  if (version.currentValueInteger === null)
    throw new Error("This seeded goal must have measured progress.");
  const target = version.targetValueInteger;
  if (target === null) return 0;
  if (target === 0) return 1_000_000;
  return Math.min(
    Number((BigInt(version.currentValueInteger) * 1_000_000n) / BigInt(target)),
    1_000_000,
  );
}

function expectedGoalPosition(
  version: AlphaData["goals"][number]["versions"][number],
) {
  if (version.currentValueInteger === null)
    throw new Error("This seeded goal must have measured progress.");
  const target = version.targetValueInteger;
  if (target === null) return "Not available";
  const difference = version.currentValueInteger - target;
  if (difference === 0) return "Met";
  return formatExpectedGoalValue(Math.abs(difference), version.targetUnit);
}

test("keeps the Overview masthead swipeable without a duplicate goals section", async ({
  page,
}, testInfo) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = withStableOverviewValues(
    (await alphaResponse.json()) as AlphaData,
  );
  let visibleGoals = alphaFixture.goals;
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: { ...alphaFixture, goals: visibleGoals } });
  });

  await page.goto("/");

  const goalHero = page.getByRole("region", { name: "Goal overview" });
  const goalSlides = goalHero.locator("[data-slot='carousel-item']");
  const goalDots = goalHero.locator("[data-slot='carousel-dot']");
  await expect(goalHero).toBeVisible();
  await expect(goalSlides).toHaveCount(alphaFixture.goals.length);
  await expect(goalDots).toHaveCount(alphaFixture.goals.length);
  await expect(goalDots.first()).toHaveAttribute("aria-current", "true");
  await expect(
    goalHero.getByRole("group", { name: "Choose a goal" }),
  ).toBeVisible();
  await expect(
    goalHero.getByRole("button", { name: "Previous goal" }),
  ).toHaveCount(0);
  await expect(goalHero.getByRole("button", { name: "Next goal" })).toHaveCount(
    0,
  );
  await expect(goalSlides.first().getByText(/Primary goal/u)).toBeVisible();
  await expect(page.locator(".overview-goals")).toHaveCount(0);

  const goalOverview = page.locator(".goal-overview");
  const goalSignal = goalOverview.locator(".goal-signal");
  const goalStats = goalSignal.locator(
    ".goal-signal__stats [data-slot='stat']",
  );
  const portfolioOutlook = page.locator(".liquidity-panel");
  const portfolioBase = portfolioOutlook.locator(".portfolio-outlook__base");
  const initialGoal = alphaFixture.goals[0];
  await expect(goalOverview).toHaveAttribute("data-goal-id", initialGoal!.id);
  await expect(goalSignal.getByRole("heading", { level: 2 })).toHaveText(
    latestGoalName(initialGoal),
  );
  const [goalSignalHeaderBox, goalSignalBodyBox] = await Promise.all([
    goalSignal.locator(".panel__header").boundingBox(),
    goalSignal.locator(".goal-signal__body").boundingBox(),
  ]);
  expect(goalSignalHeaderBox).not.toBeNull();
  expect(goalSignalBodyBox).not.toBeNull();
  expect(
    Math.abs(
      goalSignalHeaderBox!.x +
        goalSignalHeaderBox!.width -
        (goalSignalBodyBox!.x + goalSignalBodyBox!.width),
    ),
  ).toBeLessThanOrEqual(1);
  if ((page.viewportSize()?.width ?? 0) > 620) {
    const [goalRingBox, firstGoalStatBox, secondGoalStatBox] =
      await Promise.all([
        goalSignal.locator(".probability-ring").boundingBox(),
        goalStats.nth(0).boundingBox(),
        goalStats.nth(1).boundingBox(),
      ]);
    expect(goalRingBox).not.toBeNull();
    expect(firstGoalStatBox).not.toBeNull();
    expect(secondGoalStatBox).not.toBeNull();
    expect(
      Math.abs(
        firstGoalStatBox!.x -
          goalRingBox!.x -
          (secondGoalStatBox!.x - firstGoalStatBox!.x),
      ),
    ).toBeLessThanOrEqual(1);
  }

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
  await expect(goalOverview).toHaveScreenshot("overview-goal-overview.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  await expect(goalOverview).not.toContainText("Protected runway");
  await expect(goalOverview).not.toContainText("FI-eligible liquid");
  await expect(portfolioBase).toContainText("Current base");
  await expect(portfolioBase).toContainText("FI-eligible liquid");
  await expect(portfolioBase).toContainText("Protected runway");
  await expect(portfolioBase).toContainText(
    "$41k/month after a $103k cash floor",
  );
  const [chartBox, portfolioBaseBox] = await Promise.all([
    portfolioOutlook.locator(".liquidity-chart").boundingBox(),
    portfolioBase.boundingBox(),
  ]);
  expect(chartBox).not.toBeNull();
  expect(portfolioBaseBox).not.toBeNull();
  expect(portfolioBaseBox!.y).toBeGreaterThan(chartBox!.y + chartBox!.height);
  if ((page.viewportSize()?.width ?? 0) > 620) {
    const portfolioMetrics = portfolioBase.locator(
      ".portfolio-outlook__metrics",
    );
    const portfolioMetricItems = portfolioMetrics.locator(
      ".portfolio-outlook__metric",
    );
    const [
      portfolioMetricsBox,
      firstPortfolioMetricBox,
      secondPortfolioMetricBox,
    ] = await Promise.all([
      portfolioMetrics.boundingBox(),
      portfolioMetricItems.nth(0).boundingBox(),
      portfolioMetricItems.nth(1).boundingBox(),
    ]);
    expect(portfolioMetricsBox).not.toBeNull();
    expect(firstPortfolioMetricBox).not.toBeNull();
    expect(secondPortfolioMetricBox).not.toBeNull();
    expect(
      Math.abs(portfolioMetricsBox!.width - portfolioBaseBox!.width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        firstPortfolioMetricBox!.width - secondPortfolioMetricBox!.width,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        secondPortfolioMetricBox!.x -
          firstPortfolioMetricBox!.x -
          portfolioMetricsBox!.width / 2,
      ),
    ).toBeLessThanOrEqual(1);
  }
  // The chart above can place this crop at a fractional CSS pixel. Align only
  // the capture origin so equivalent layouts do not gain a blank pixel row.
  const captureStyle = await page.addStyleTag({
    content: `.portfolio-outlook__base { transform: translateY(${Math.ceil(portfolioBaseBox!.y) - portfolioBaseBox!.y}px); }`,
  });
  try {
    await expect(portfolioBase).toHaveScreenshot(
      "overview-portfolio-base.png",
      {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.025,
        threshold: 0.25,
      },
    );
  } finally {
    await captureStyle.evaluate((element) => {
      element.parentNode?.removeChild(element);
    });
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await goalDots.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(goalDots.nth(1)).toHaveAttribute("aria-current", "true");
  if (testInfo.project.name === "chromium") {
    await expect(goalOverview).toHaveAttribute(
      "data-goal-id",
      alphaFixture.goals[1]!.id,
    );
    await expectNoHorizontalOverflow(page);
    return;
  }
  await goalDots.first().click();
  await expect(goalDots.first()).toHaveAttribute("aria-current", "true");

  const viewport = goalHero.locator("[data-slot='carousel-content']");
  await expect
    .poll(async () => {
      const [firstSlideBox, currentViewportBox] = await Promise.all([
        goalSlides.first().locator(".hero__slide").boundingBox(),
        viewport.boundingBox(),
      ]);
      if (firstSlideBox === null || currentViewportBox === null) return null;
      return Math.abs(Math.round(firstSlideBox.x - currentViewportBox.x));
    })
    .toBe(0);
  const viewportBox = await viewport.boundingBox();
  expect(viewportBox).not.toBeNull();
  await page.mouse.move(
    viewportBox!.x + viewportBox!.width * 0.9,
    viewportBox!.y + viewportBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    viewportBox!.x - viewportBox!.width * 0.2,
    viewportBox!.y + viewportBox!.height / 2,
    { steps: 20 },
  );
  await page.mouse.up();
  await expect(goalDots.nth(1)).toHaveAttribute("aria-current", "true");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await expect
    .poll(async () => {
      const [secondSlideBox, currentViewportBox] = await Promise.all([
        goalSlides.nth(1).locator(".hero__slide").boundingBox(),
        viewport.boundingBox(),
      ]);
      if (secondSlideBox === null || currentViewportBox === null) return null;
      return Math.abs(Math.round(secondSlideBox.x - currentViewportBox.x));
    })
    .toBe(0);
  await expect(
    goalSlides.first().locator("[data-slot='text-link']"),
  ).toHaveAttribute("tabindex", "-1");
  await expect(
    goalSlides.nth(1).locator("[data-slot='text-link']"),
  ).toHaveAttribute("tabindex", "0");

  const selectedGoal = alphaFixture.goals[1];
  const selectedVersion = selectedGoal?.versions[0];
  if (selectedGoal === undefined || selectedVersion === undefined) {
    throw new Error("Expected a second saved goal in the Overview fixture.");
  }
  await expect(goalOverview).toHaveAttribute("data-goal-id", selectedGoal.id);
  await expect(goalStats.first().locator("strong")).toHaveText(
    selectedVersion.targetValueInteger === null
      ? "Not set"
      : formatExpectedGoalValue(
          selectedVersion.targetValueInteger,
          selectedVersion.targetUnit,
        ),
  );
  await expect(goalStats.nth(1).locator("strong")).toHaveText(
    expectedGoalPosition(selectedVersion),
  );
  await expect(goalSignal.getByRole("heading", { level: 2 })).toHaveText(
    selectedVersion.name,
  );
  await expect(goalSignal.locator(".probability-ring strong")).toHaveText(
    formatProbability(expectedGoalProgress(selectedVersion)),
  );
  await expect(portfolioBase).toContainText("42 months");

  const dotHeights = await goalDots.evaluateAll((dots) =>
    dots.map((dot) => dot.getBoundingClientRect().height),
  );
  expect(dotHeights.every((height) => height >= 44)).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".hero")).toHaveScreenshot(
    "overview-hero-carousel-swiped.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await expect(goalOverview).toHaveScreenshot(
    "overview-goal-overview-swiped.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  const textLinks = page.locator('[data-slot="text-link"]');
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
        height >= 44 && textDecorationLine === "none",
    ),
  ).toBe(true);
  await expect(goalOverview).not.toContainText("→");
  await expectNoHorizontalOverflow(page);

  const selectedGoalName = latestGoalName(selectedGoal);
  await goalHero.getByRole("button", { name: "Edit this goal" }).click();
  await expect(page).toHaveURL(/\/goals$/u);
  await expect(
    page.getByRole("combobox", { name: "Saved goal" }).locator("strong"),
  ).toHaveText(selectedGoalName);
  visibleGoals = alphaFixture.goals.slice(0, 1);
  await page.goto("/");
  await expect(
    page
      .locator(".hero")
      .getByRole("heading", { name: "Financial independence", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Goal overview" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("group", { name: "Choose a goal" })).toHaveCount(
    0,
  );
  await expect(page.locator(".overview-goals")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
