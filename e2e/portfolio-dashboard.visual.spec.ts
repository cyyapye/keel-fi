import { expect, test, type Page } from "@playwright/test";
import type {
  Holding,
  PortfolioBaselineState,
} from "../packages/domain/src/index";

import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";

const asOf = "2026-08-16T12:00:00.000Z";

function dashboardHolding(input: {
  id: string;
  name: string;
  valueMinor: number | null;
  ticker?: string;
}): Holding {
  const publicPosition = input.ticker !== undefined;
  return {
    id: input.id,
    companyId: publicPosition ? null : `company_${input.id}_synthetic`,
    positionName: publicPosition
      ? `${input.ticker} · ${input.name}`
      : `${input.name} Demo SPV`,
    exposureName: input.name,
    ownerLabel: publicPosition ? "Demo Brokerage" : "Demo Family LLC",
    positionKind: publicPosition ? "direct" : "spv_interest",
    administratorNavMinor: input.valueMinor,
    administratorNavState: input.valueMinor === null ? "locked" : "reported",
    externalMarkMinor: null,
    underwritingValueMinor: null,
    scenarioValueMinor: null,
    usableLiquidityMinor: null,
    sourceStatus: "verified",
    sourceLabel: publicPosition ? "Plaid Investments" : "AngelList export",
    effectiveDate: "2026-08-16",
    retrievedAt: asOf,
    confidencePpm: null,
    ticker: input.ticker ?? null,
    quantityMicros: publicPosition ? 1_000_000 : null,
    costBasisMinor: null,
  };
}

const holdings = [
  dashboardHolding({
    id: "position_orion_synthetic",
    name: "Orion Compute",
    valueMinor: 48_000_000,
    ticker: "ORN",
  }),
  dashboardHolding({
    id: "position_meridian_synthetic",
    name: "Meridian Bio",
    valueMinor: 40_000_000,
  }),
  dashboardHolding({
    id: "position_northstar_synthetic",
    name: "Northstar Grid",
    valueMinor: 32_000_000,
    ticker: "NST",
  }),
  dashboardHolding({
    id: "position_aster_synthetic",
    name: "Aster Labs",
    valueMinor: 26_000_000,
  }),
  dashboardHolding({
    id: "position_harbor_synthetic",
    name: "Harbor Systems",
    valueMinor: 22_000_000,
  }),
  dashboardHolding({
    id: "position_juniper_synthetic",
    name: "Juniper Mobility",
    valueMinor: 38_000_000,
    ticker: "JNP",
  }),
  dashboardHolding({
    id: "position_lattice_synthetic",
    name: "Lattice Energy",
    valueMinor: 30_000_000,
  }),
  dashboardHolding({
    id: "position_beacon_synthetic",
    name: "Beacon Health",
    valueMinor: 24_000_000,
  }),
  dashboardHolding({
    id: "position_cedar_synthetic",
    name: "Cedar Networks",
    valueMinor: 18_000_000,
    ticker: "CDR",
  }),
  dashboardHolding({
    id: "position_summit_synthetic",
    name: "Summit Robotics",
    valueMinor: 14_000_000,
  }),
  dashboardHolding({
    id: "position_vale_synthetic",
    name: "Vale Software",
    valueMinor: 12_000_000,
    ticker: "VLE",
  }),
  dashboardHolding({
    id: "position_locked_synthetic",
    name: "Horizon Materials",
    valueMinor: null,
  }),
] as const;

const priorValuesByPosition = {
  position_orion_synthetic: 40_000_000,
  position_meridian_synthetic: 35_000_000,
  position_northstar_synthetic: 29_000_000,
  position_aster_synthetic: 24_000_000,
  position_harbor_synthetic: 21_000_000,
  position_juniper_synthetic: 44_000_000,
  position_lattice_synthetic: 34_000_000,
  position_beacon_synthetic: 27_000_000,
  position_cedar_synthetic: 20_000_000,
  position_summit_synthetic: 15_000_000,
  position_vale_synthetic: 12_000_000,
} as const;

const holdingsView = investmentHoldingsViewFor(holdings, priorValuesByPosition);

let holdingsRequestCount = 0;
let baselineRequestCount = 0;

const baseline: PortfolioBaselineState = {
  status: "ready",
  sourceRevision: "a".repeat(64),
  observedAt: asOf,
  baseForecastSnapshotId: "forecast_dashboard_synthetic",
  baseForecastSnapshotVersion: 1,
  summary: {
    positionCount: holdings.length + 1,
    publicMarketValueMinor: 168_000_000,
    privatePaperValueMinor: 156_000_000,
    cashAccountCount: 1,
    cashAccountValueMinor: 30_000_000,
    unknownCashAccountCount: 0,
    unknownValueCount: 1,
    potentialDuplicateCount: 0,
  },
  positions: [
    ...holdings.map((holding) => ({
      id: holding.id,
      positionName: holding.exposureName ?? holding.positionName,
      ownerLabel: holding.ownerLabel,
      sourceLabel: holding.sourceLabel,
      provider:
        holding.ticker === null
          ? ("angellist" as const)
          : ("plaid_investments" as const),
      classification:
        holding.ticker === null
          ? ("private_paper" as const)
          : ("public_market" as const),
      valueMinor: holding.administratorNavMinor,
      valueState:
        holding.administratorNavState === "not_set"
          ? ("not_reported" as const)
          : holding.administratorNavState,
      observedAt: holding.retrievedAt,
      ticker: holding.ticker,
      isCashPosition: false,
      potentialDuplicate: false,
      duplicateWith: [],
    })),
    {
      id: "position_brokerage_cash_synthetic",
      positionName: "US Dollar",
      ownerLabel: "Demo Brokerage",
      sourceLabel: "Plaid Investments",
      provider: "plaid_investments",
      classification: "public_market",
      valueMinor: 20_000_000,
      valueState: "reported",
      observedAt: asOf,
      ticker: null,
      isCashPosition: true,
      potentialDuplicate: false,
      duplicateWith: [],
    },
  ],
  cashAccounts: [
    {
      id: "cash_reserve_synthetic",
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Reserve savings",
      subtype: "savings",
      valueMinor: 30_000_000,
      valueState: "reported",
      refreshKind: "live",
      observedAt: asOf,
    },
  ],
  planning: {
    currentFiEligibleLiquidMinor: 364_000_000,
    protectedCashFloorMinor: 10_000_000,
    householdBurnMonthlyMinor: 2_800_000,
    businessBurnMonthlyMinor: 1_200_000,
    fiTargetMinor: 500_000_000,
    p25FiveYearLiquidityMinor: 80_000_000,
    p50FiveYearLiquidityMinor: 180_000_000,
    p75FiveYearLiquidityMinor: 320_000_000,
    forecastHorizonDate: "2031-12-31",
  },
  suggestedOtherFiEligibleLiquidMinor: 10_000_000,
  currentImpact: {
    fiEligibleLiquidMinor: 364_000_000,
    fiEligibleChangeMinor: 0,
    protectedRunwayMonths: 88,
    fiGapMinor: 136_000_000,
    lowerTotalAvailableMinor: 444_000_000,
    middleTotalAvailableMinor: 544_000_000,
    higherTotalAvailableMinor: 684_000_000,
    probabilityCrossingFiPpm: 540_000,
  },
  latestBaseline: null,
  hasSourceChanges: true,
  hasCashAccountChanges: true,
  requiresDuplicateReview: false,
  requiresCashOverlapReview: false,
  canConfirm: true,
};

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test.beforeEach(async ({ page }) => {
  holdingsRequestCount = 0;
  baselineRequestCount = 0;
  await page.clock.setFixedTime(new Date("2026-08-23T12:00:00.000Z"));
  await page.route("**/api/investment-holdings", async (route) => {
    holdingsRequestCount += 1;
    await route.fulfill({ json: holdingsView });
  });
  await page.route("**/api/portfolio-baseline", async (route) => {
    baselineRequestCount += 1;
    await route.fulfill({ json: baseline });
  });
});

test("shows a two-color portfolio snapshot on Overview", async ({ page }) => {
  await page.goto("/");

  const snapshot = page.getByRole("region", { name: "Portfolio snapshot" });
  await expect(
    snapshot.getByRole("heading", { name: "Portfolio snapshot" }),
  ).toBeVisible();
  await expect(snapshot).toContainText("$3.6M");
  await expect(snapshot).toContainText("$3.0M");
  await expect(snapshot).toContainText("61.8%");
  await expect(snapshot).toContainText("1 value is unavailable and excluded");
  await expect(
    snapshot.getByRole("heading", { name: "Top 10 holdings" }),
  ).toBeVisible();
  await expect(
    snapshot.getByRole("heading", { name: "Portfolio by access" }),
  ).toBeVisible();
  await expect(
    snapshot.getByRole("heading", { name: "Largest value changes" }),
  ).toBeVisible();
  await expect(snapshot.getByRole("heading", { name: "Up" })).toBeVisible();
  await expect(snapshot.getByRole("heading", { name: "Down" })).toBeVisible();
  await expect(
    snapshot
      .locator("ol.visually-hidden li")
      .filter({ hasText: "Orion Compute: $480k" }),
  ).toHaveCount(1);
  await expect(
    snapshot
      .locator("ol.visually-hidden li")
      .filter({ hasText: "Juniper Mobility: −$60k" }),
  ).toHaveCount(1);
  await expect(snapshot.locator(".recharts-wrapper")).toHaveCount(4);
  expect(holdingsRequestCount).toBe(1);
  expect(baselineRequestCount).toBe(1);
  await expectNoHorizontalOverflow(page);

  await page.addStyleTag({
    content:
      ".topbar { position: absolute !important; visibility: hidden !important; }",
  });
  await expect(snapshot).toHaveScreenshot("portfolio-snapshot.png", {
    animations: "disabled",
  });
});
