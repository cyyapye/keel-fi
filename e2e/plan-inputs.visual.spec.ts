import { expect, test, type Page } from "@playwright/test";
import type { AlphaData } from "../packages/domain/src/index";

const planState = {
  baseCashFlowPlanId: "cash_plan_fi_v1",
  baseForecastSnapshotId: "snap_fi_v3",
  baseForecastSnapshotVersion: 3,
  values: {
    householdBurnMonthlyMinor: 2_850_000,
    businessBurnMonthlyMinor: 1_250_000,
    protectedCashFloorMinor: 10_300_000,
  },
  fiEligibleLiquidMinor: 182_500_000,
  fiTargetMinor: 325_000_000,
  forecastHorizonDate: "2031-12-31",
  impact: {
    totalMonthlyBurnMinor: 4_100_000,
    liquidAfterCashFloorMinor: 172_200_000,
    protectedRunwayMonths: 42,
  },
} as const;

function withStableFiScenario(data: AlphaData): AlphaData {
  return {
    ...data,
    scenarios: data.scenarios.map((scenario) =>
      scenario.id === "scn_fi"
        ? {
            ...scenario,
            conditionalValueMinor: 168_000_000,
            timingAdjustedLiquidityMinor: 92_500_000,
            assumptions: scenario.assumptions.map((assumption) => ({
              ...assumption,
              value:
                assumption.key === "liquidity_probability"
                  ? 430_000
                  : assumption.key === "timing_delay_months"
                    ? 18
                    : assumption.value,
            })),
          }
        : scenario,
    ),
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test("keeps current and draft runway plan inputs clear", async ({ page }) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = withStableFiScenario(
    (await alphaResponse.json()) as AlphaData,
  );

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.route("**/api/plan-inputs", async (route) => {
    await route.fulfill({ json: planState });
  });

  await page.goto("/scenarios");
  await page.addStyleTag({
    content:
      ".topbar { position: absolute !important; visibility: hidden !important; }",
  });
  const scenarioSummary = page.locator(".scenario-summary");
  await expect(scenarioSummary).toContainText("Conditional value");
  await expect(scenarioSummary).toContainText("Timing-adjusted liquidity");
  await expect(scenarioSummary).toHaveScreenshot("scenario-summary.png", {
    animations: "disabled",
  });
  const editor = page.locator(".plan-inputs-editor");
  await expect(
    editor.getByRole("heading", { name: "Plan inputs" }),
  ).toBeVisible();
  await expect(editor.getByText("Current plan")).toBeVisible();
  await expect(editor).toHaveScreenshot("plan-inputs-current.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await editor.getByRole("textbox", { name: /Household burn/ }).fill("30000");
  await editor
    .getByRole("textbox", { name: /Protected cash floor/ })
    .fill("150000");
  await expect(editor.getByText("Unsaved draft")).toBeVisible();
  await expect(editor.getByText("39 months")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Save plan" })).toBeEnabled();
  await expect(editor).toHaveScreenshot("plan-inputs-draft.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  await expectNoHorizontalOverflow(page);
});
