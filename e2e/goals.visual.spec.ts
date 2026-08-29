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
  await expect(page.locator(".goal-selector .eyebrow")).toHaveText("Goals");
  await expect(
    page.getByText("Goal version and forecast snapshot save together."),
  ).toHaveCount(0);

  const modeledBadge = page.getByText("Modeled", { exact: true });
  await expect(modeledBadge).toHaveCSS("color", "rgb(247, 244, 238)");
  await expect(modeledBadge).toHaveCSS("background-color", "rgb(38, 34, 56)");

  const selectorBox = await page.locator(".goal-selector").boundingBox();
  const formBox = await page.locator(".goal-form").boundingBox();
  expect(selectorBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(selectorBox!.y + selectorBox!.height).toBeLessThan(formBox!.y);

  const livePreview = page.locator(".goal-preview");
  if ((page.viewportSize()?.width ?? 0) <= 980) {
    await expect(livePreview).toBeHidden();
  } else {
    await expect(livePreview).toBeVisible();
  }
  await expect(page.locator("[data-slot='panel']")).toHaveCount(4);
  await expect(page.locator("[data-slot='metric-card']")).toHaveCount(1);
  await expect(page.locator("[data-slot='action-group']")).toHaveCount(1);
  const newGoalAction = page.getByRole("button", { name: "New goal +" });
  await expect(newGoalAction).toHaveAttribute("data-slot", "text-link");
  await expect(page.locator(".goal-form .field--filled")).toHaveCount(7);
  await expect(page.locator(".goal-form input[type='date']")).toHaveCount(0);
  const targetDate = page.getByRole("button", { name: "Target date" });
  await expect(targetDate).toHaveAttribute("data-slot", "date-picker");
  await expect(page).toHaveScreenshot("goals-editor.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

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

  const unit = page.getByRole("combobox", { name: "Unit" });
  await expect(unit).toBeEnabled();

  const targetValue = page.getByRole("textbox", {
    name: "Target value · optional",
  });
  const targetValueInset = await targetValue.evaluate((input) => {
    const group = input.parentElement;
    if (group === null) return null;
    return {
      adornments: group.querySelectorAll(
        "[data-slot='input-prefix'], [data-slot='input-suffix']",
      ).length,
      inset:
        input.getBoundingClientRect().left - group.getBoundingClientRect().left,
    };
  });
  expect(targetValueInset).toEqual({ adornments: 0, inset: 12 });

  await unit.click();
  await page.getByRole("option", { exact: true, name: "Count" }).click();
  await expect(unit).toHaveText("Count");
  await unit.click();
  await page.getByRole("option", { exact: true, name: "Months" }).click();
  await expect(unit).toHaveText("Months");

  await targetValue.scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot("goals-runway-fields.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await selector.click();
  await page
    .getByRole("option", {
      name: "Major purchase Future home purchase v1 · $250k",
    })
    .click();
  await expect(targetDate).toHaveText("Jun 30, 2030");
  await targetDate.click();
  await expect(page.locator(".date-picker__popup")).toBeVisible();
  const clearDate = page.getByRole("button", { name: "Clear date" });
  await expect(clearDate).toBeVisible();
  await clearDate.click();
  await expect(targetDate).toHaveText("Choose date");

  await newGoalAction.click();
  await expect(page.getByText("Start from a template")).toBeVisible();
  await expect(newGoalAction).toHaveCount(0);
  await expect(page.locator(".goal-templates").getByRole("button")).toHaveCount(
    4,
  );
  await expect(
    page.locator(".goal-templates [data-slot='button']"),
  ).toHaveCount(4);
  await expect(
    page.getByRole("button", { exact: true, name: "Custom" }),
  ).toHaveAttribute("aria-pressed", "true");
  const customTemplate = page.getByRole("button", {
    exact: true,
    name: "Custom",
  });
  const cashRunwayTemplate = page.getByRole("button", {
    exact: true,
    name: "Cash runway",
  });
  await cashRunwayTemplate.click();
  await expect(cashRunwayTemplate).toHaveAttribute("aria-pressed", "true");
  await expect(customTemplate).toHaveAttribute("aria-pressed", "false");
  await expect(cashRunwayTemplate).toHaveCSS(
    "background-color",
    "rgb(38, 34, 56)",
  );
  await expect(cashRunwayTemplate).toHaveCSS("color", "rgb(247, 244, 238)");
  await expect(page.getByRole("textbox", { name: "Goal name" })).toHaveValue(
    "Protect cash runway",
  );
  await expect(selectorHeader.locator("strong")).toHaveText("Choose a goal");
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot("goals-template-selected.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
});
