import { expect, test, type Page } from "@playwright/test";
import type { AlphaData } from "../packages/domain/src/index";

const stableGoals = [
  {
    id: "goal_fi",
    templateKey: "financial_independence",
    isPrimary: true,
    archivedAt: null,
    createdAt: "2026-07-01T09:00:00-07:00",
    versions: [
      {
        id: "goalv_fi_1",
        version: 1,
        name: "Financial independence",
        metricKey: "fi_eligible_liquid",
        metricLabel: "FI-eligible liquid assets",
        targetValueInteger: 325_000_000,
        targetUnit: "minor_units",
        targetDate: null,
        currentValueInteger: 182_500_000,
        currentValueSource: "Synthetic FI planning inputs",
        changeNote: "Initial synthetic FI goal",
        createdAt: "2026-07-01T09:00:00-07:00",
        createdBy: "Demo Operator",
        forecast: {
          id: "goalsnap_fi_1",
          version: 1,
          modelStatus: "modeled",
          lowerValueInteger: 276_500_000,
          middleValueInteger: 392_500_000,
          higherValueInteger: 536_500_000,
          successProbabilityPpm: 640_000,
          unit: "minor_units",
          horizonDate: "2031-12-31",
          methodology:
            "Five-year total available value combines the current baseline with the saved lower, middle, and higher liquidity outcomes.",
          createdAt: "2026-07-01T09:00:00-07:00",
          createdBy: "Demo Operator",
        },
      },
    ],
  },
  {
    id: "goal_runway",
    templateKey: "cash_runway",
    isPrimary: false,
    archivedAt: null,
    createdAt: "2026-07-01T09:01:00-07:00",
    versions: [
      {
        id: "goalv_runway_1",
        version: 1,
        name: "Keep a three-year cash runway",
        metricKey: "protected_runway_months",
        metricLabel: "Months of protected runway",
        targetValueInteger: 36,
        targetUnit: "months",
        targetDate: null,
        currentValueInteger: 42,
        currentValueSource: "Synthetic cash-flow plan",
        changeNote: "Initial synthetic runway guardrail",
        createdAt: "2026-07-01T09:01:00-07:00",
        createdBy: "Demo Operator",
        forecast: {
          id: "goalsnap_runway_1",
          version: 1,
          modelStatus: "not_configured",
          lowerValueInteger: null,
          middleValueInteger: null,
          higherValueInteger: null,
          successProbabilityPpm: null,
          unit: "months",
          horizonDate: null,
          methodology:
            "Current progress is saved. Add scenario inputs before treating this goal as a forecast.",
          createdAt: "2026-07-01T09:01:00-07:00",
          createdBy: "Demo Operator",
        },
      },
    ],
  },
  {
    id: "goal_purchase",
    templateKey: "major_purchase",
    isPrimary: false,
    archivedAt: null,
    createdAt: "2026-07-01T09:02:00-07:00",
    versions: [
      {
        id: "goalv_purchase_1",
        version: 1,
        name: "Future home purchase",
        metricKey: "purchase_fund",
        metricLabel: "Purchase fund",
        targetValueInteger: 120_000_000,
        targetUnit: "minor_units",
        targetDate: "2030-06-30",
        currentValueInteger: 25_000_000,
        currentValueSource: "Synthetic goal input",
        changeNote: "Initial synthetic purchase goal",
        createdAt: "2026-07-01T09:02:00-07:00",
        createdBy: "Demo Operator",
        forecast: {
          id: "goalsnap_purchase_1",
          version: 1,
          modelStatus: "not_configured",
          lowerValueInteger: null,
          middleValueInteger: null,
          higherValueInteger: null,
          successProbabilityPpm: null,
          unit: "minor_units",
          horizonDate: null,
          methodology:
            "Current progress is saved. Add scenario inputs before treating this goal as a forecast.",
          createdAt: "2026-07-01T09:02:00-07:00",
          createdBy: "Demo Operator",
        },
      },
    ],
  },
] satisfies AlphaData["goals"];

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test("keeps saved goals compact and templates creation-only", async ({
  page,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = (await alphaResponse.json()) as AlphaData;
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({
      json: {
        ...alphaFixture,
        dashboard: {
          ...alphaFixture.dashboard,
          fiEligibleLiquidMinor: 182_500_000,
          fiTargetMinor: 325_000_000,
          p25FiveYearLiquidityMinor: 94_000_000,
          p50FiveYearLiquidityMinor: 210_000_000,
          p75FiveYearLiquidityMinor: 354_000_000,
          protectedRunwayMonths: 42,
        },
        goals: stableGoals,
      } satisfies AlphaData,
    });
  });

  await page.goto("/goals");

  const selector = page.getByRole("combobox", { name: "Saved goal" });
  const selectorHeader = selector.locator(".goal-selector__goal-header");
  await expect(selectorHeader.locator(":scope > span")).toHaveText("Primary");
  await expect(selectorHeader.locator("strong")).toHaveText(
    "Financial independence",
  );
  await expect(selectorHeader.locator("small")).toHaveText("v1 · $1.8M");
  await expect(page.locator(".goal-templates")).toHaveCount(0);

  await selector.click();
  const options = page.getByRole("option");
  await expect(options).toHaveCount(3);
  expect(
    await page
      .locator(".goal-selector__item .goal-selector__goal-header")
      .evaluateAll((headers) =>
        headers.map((header) =>
          Array.from(header.children).map((child) => child.tagName),
        ),
      ),
  ).toEqual([
    ["SPAN", "STRONG", "SMALL"],
    ["SPAN", "STRONG", "SMALL"],
    ["SPAN", "STRONG", "SMALL"],
  ]);
  await expect(page).toHaveScreenshot("goals-selector-open.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await page
    .getByRole("option", {
      name: "Cash runway Keep a three-year cash runway v1 · 42 months",
    })
    .click();
  await expect(selectorHeader.locator(":scope > span")).toHaveText(
    "Cash runway",
  );
  await expect(page.getByRole("textbox", { name: "Goal name" })).toHaveValue(
    "Keep a three-year cash runway",
  );
  await expect(page.locator(".goal-templates")).toHaveCount(0);

  await page.getByRole("button", { name: "New goal +" }).click();
  await expect(page.getByText("Start from a template")).toBeVisible();
  await expect(page.locator(".goal-templates").getByRole("button")).toHaveCount(
    4,
  );
  await expect(
    page.getByRole("button", { exact: true, name: "Custom" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(selectorHeader.locator("strong")).toHaveText("Choose a goal");
  await expectNoHorizontalOverflow(page);
});
