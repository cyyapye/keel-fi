import { expect, test, type Page } from "@playwright/test";
import type {
  Holding,
  PortfolioBaselineState,
} from "../packages/domain/src/index";

import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { InvestmentHoldingsViewSchema } from "../packages/domain/src/investment-holdings-view";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";

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
    quantityMicros: publicPosition ? 2_000_000_000 : null,
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
const unchangedHoldingsView = investmentHoldingsViewFor(holdings);

function performanceHoldingsView(source = holdingsView) {
  const view = structuredClone(source);
  for (const position of view.exposureView.positions) {
    if (position.valueMinor === null) continue;
    const value = BigInt(position.valueMinor);
    if (position.positionKind === "direct") {
      position.providerCostBasisMinor = Number((value * 4n) / 5n);
      continue;
    }
    position.realizedValueMinor = Number(value / 10n);
    position.reviewedInvestment = {
      snapshotId: position.snapshotId,
      receiptId: `receipt_${position.id}`,
      cashPaidMinor: Number(value / 2n),
      upfrontDeductionsMinor: Number(value / 10n),
      netCapitalMinor: Number((value * 4n) / 10n),
      terms: {
        ...unknownInvestmentTerms(),
        reportedValueReview: {
          sourceSnapshotId: position.snapshotId,
          valueMinor: position.valueMinor,
          sourceLabel: "Synthetic after-carry value",
          effectiveDate: "2026-08-16",
          carryStatus: "after_carry",
        },
      },
    };
  }
  return InvestmentHoldingsViewSchema.parse(view);
}

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
  changes: { positions: [], cashAccounts: [] },
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
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings,
    investmentHoldings: holdingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/portfolio-baseline", async (route) => {
    baselineRequestCount += 1;
    await route.fulfill({ json: baseline });
  });
});

test(
  "shows a two-color portfolio snapshot on Overview",
  { tag: "@desktop-only" },
  async ({ page }) => {
    await page.route("**/api/investment-holdings", async (route) => {
      holdingsRequestCount += 1;
      await route.fulfill({ json: performanceHoldingsView() });
    });
    await page.goto("/");

    const snapshot = page.getByRole("region", { name: "Portfolio snapshot" });
    await expect(
      snapshot.getByRole("heading", { name: "Portfolio snapshot" }),
    ).toBeVisible();
    await expect(snapshot).toContainText("Portfolio value");
    await expect(snapshot).not.toContainText("Reviewed total");
    await expect(snapshot).not.toContainText("Known portfolio");
    const headline = snapshot.locator(".portfolio-snapshot__metrics");
    await expect(headline).not.toContainText("Mapped");
    await expect(headline).not.toContainText("concentration");
    await expect(headline).toContainText("+76.8%");
    await expect(headline).toContainText("11 of 12 holdings");
    await expect(headline).toContainText("2.20×");
    await expect(headline).toContainText("0.20×");
    await expect(snapshot).toContainText("Excludes closed positions and cash");
    await expect(snapshot).toContainText("$3.6M");
    await expect(snapshot).toContainText("$3.0M");
    await expect(snapshot).toContainText("61.8%");
    await expect(snapshot).toContainText("1 value is unavailable and excluded");
    await expect(
      snapshot.getByRole("heading", { name: "Top 10 holdings" }),
    ).toBeVisible();
    const portfolioHeader = snapshot.locator(":scope > .section-heading");
    const topHoldings = snapshot.locator(".portfolio-snapshot__top");
    const viewHoldings = topHoldings.getByRole("button", {
      name: "View holdings",
    });
    await expect(portfolioHeader.getByRole("button")).toHaveCount(0);
    await expect(viewHoldings).toBeVisible();
    const [topHeaderBox, viewHoldingsBox] = await Promise.all([
      topHoldings.locator(".panel__header").boundingBox(),
      viewHoldings.boundingBox(),
    ]);
    expect(topHeaderBox).not.toBeNull();
    expect(viewHoldingsBox).not.toBeNull();
    expect(viewHoldingsBox!.x).toBeGreaterThanOrEqual(topHeaderBox!.x);
    expect(viewHoldingsBox!.x + viewHoldingsBox!.width).toBeLessThanOrEqual(
      topHeaderBox!.x + topHeaderBox!.width + 1,
    );
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
    const basis = snapshot.getByRole("button", { name: "Performance basis" });
    await basis.press("Enter");
    await expect(basis).toHaveAttribute("aria-expanded", "true");
    await expect(snapshot).toContainText("$780k paid in");
    const calculationDetail = snapshot.locator(
      ".portfolio-snapshot__basis-content",
    );
    // The calculation detail should be scannable, not the former prose manual.
    expect(
      (await calculationDetail.innerText()).trim().split(/\s+/).length,
    ).toBeLessThan(110);
    await expectNoHorizontalOverflow(page);
    await expect(
      snapshot.locator(".portfolio-snapshot__basis"),
    ).toHaveScreenshot("portfolio-performance-basis.png", {
      animations: "disabled",
    });
  },
);

test(
  "keeps empty performance unavailable and recovers from a snapshot failure",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const recovered = performanceHoldingsView(unchangedHoldingsView);
    for (const position of recovered.exposureView.positions) {
      const review = position.reviewedInvestment?.terms.reportedValueReview;
      if (review) review.carryStatus = "unknown";
    }
    let fail = true;
    await page.route("**/api/investment-holdings", async (route) => {
      holdingsRequestCount += 1;
      await route.fulfill(
        fail
          ? { status: 503, json: { error: "unavailable" } }
          : { json: recovered },
      );
    });
    await page.goto("/");
    const snapshot = page.getByRole("region", { name: "Portfolio snapshot" });
    await expect(snapshot).toContainText("Portfolio snapshot unavailable.");
    await expect(snapshot.locator(".portfolio-snapshot__metrics")).toHaveCount(
      0,
    );
    await expect(snapshot).toHaveScreenshot(
      "portfolio-performance-failed.png",
      {
        animations: "disabled",
      },
    );
    fail = false;
    await snapshot.getByRole("button", { name: "Try again" }).click();
    const recoveredMetrics = snapshot.locator(".portfolio-snapshot__metrics");
    await expect(recoveredMetrics).toContainText("+25.0%");
    await expect(recoveredMetrics).toContainText("5 of 12 holdings");
    await expect(
      recoveredMetrics
        .locator("[data-slot='data-item']")
        .filter({ hasText: "Private TVPI" }),
    ).toContainText("—");
    await expect(recoveredMetrics).toContainText("0.20×");
    await expect(recoveredMetrics).not.toContainText("0.00×");
    await snapshot.getByRole("button", { name: "Performance basis" }).click();
    await expect(snapshot).toContainText(
      "TVPI and DPI cover different holdings",
    );

    expect(holdingsRequestCount).toBe(2);
    expect(baselineRequestCount).toBe(2);
    const movers = snapshot.locator(".portfolio-movers");
    await expect(
      movers.getByRole("heading", { level: 4, name: "No comparable changes." }),
    ).toHaveCount(2);
    await expect(
      movers.locator('[data-slot="empty-state"] > span'),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    const empty = InvestmentHoldingsViewSchema.parse({
      version: 1,
      authorizationStatus: "available",
      positionView: { asOf, connections: [] },
      exposureView: { asOf, positions: [], exposures: [] },
    });
    await page.route("**/api/investment-holdings", (route) =>
      route.fulfill({ json: empty }),
    );
    await page.route("**/api/portfolio-baseline", (route) =>
      route.fulfill({
        json: {
          ...baseline,
          positions: [],
          cashAccounts: [],
          suggestedOtherFiEligibleLiquidMinor: 0,
        },
      }),
    );
    await page.reload();
    const metrics = snapshot.locator(".portfolio-snapshot__metrics");
    await expect(metrics).toContainText("No investment holdings");
    await expect(
      metrics.getByText("No private holdings", { exact: true }),
    ).toHaveCount(2);
    await expect(metrics).not.toContainText("0.0%");
    await expect(metrics).not.toContainText("0.00×");
    await expectNoHorizontalOverflow(page);
    await page.addStyleTag({
      content: ".topbar { visibility: hidden !important; }",
    });
    await expect(snapshot).toHaveScreenshot("portfolio-performance-empty.png", {
      animations: "disabled",
    });
  },
);

test(
  "drills each portfolio chart into its corresponding Holdings detail without arrows",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const exposureIdFor = (name: string) => {
      const exposure = holdingsView.exposureView.exposures.find(
        (item) => item.exposure.canonicalName === name,
      );
      expect(exposure, `${name} exposure fixture`).toBeDefined();
      return exposure!.exposure.id;
    };
    const expectExposureOpen = async (exposureId: string) => {
      await expect(page).toHaveURL(/\/holdings\?exposure=/u);
      expect(new URL(page.url()).searchParams.get("exposure")).toBe(exposureId);
      const exposure = page.locator(`[data-exposure-id="${exposureId}"]`);
      await expect(exposure).toHaveAttribute("data-open", "");
      await expect(exposure.locator(".exposure-group__summary")).toBeFocused();
      await expectNoHorizontalOverflow(page);
      return exposure;
    };
    const snapshot = page.getByRole("region", { name: "Portfolio snapshot" });
    const expectSnapshot = async () => {
      await expect(
        snapshot.getByRole("heading", { name: "Portfolio snapshot" }),
      ).toBeVisible();
      await expect(snapshot).not.toContainText("→");
    };

    await page.goto("/");
    await expectSnapshot();
    const topExposureLink = snapshot
      .getByLabel(/Top 10 holdings grouped by economic exposure/u)
      .getByRole("link", { name: /View Orion Compute holdings detail/u });
    await expect(topExposureLink).toBeVisible();
    const topExposureTarget = await topExposureLink.boundingBox();
    expect(topExposureTarget?.height).toBeGreaterThanOrEqual(44);
    await topExposureLink.press("Enter");
    await expectExposureOpen(exposureIdFor("Orion Compute"));
    const unknownCapitalSummary = page.locator(
      `[data-exposure-id="${exposureIdFor("Meridian Bio")}"] .exposure-group__summary`,
    );
    await expect(unknownCapitalSummary).toContainText("$400,000");
    await expect(unknownCapitalSummary).not.toContainText("%");
    await page.addStyleTag({
      content: ".topbar { visibility: hidden !important; }",
    });
    await expect(page.locator(".investment-views")).toHaveScreenshot(
      "portfolio-exposure-drilldown.png",
      { animations: "disabled" },
    );

    await page.goBack();
    await expectSnapshot();
    await snapshot
      .getByLabel("Largest decreases in USD")
      .getByRole("link", { name: /View Juniper Mobility holdings detail/u })
      .click();
    await expectExposureOpen(exposureIdFor("Juniper Mobility"));

    const accessCases = [
      { key: "cash", label: "Cash", row: "Reserve savings" },
      { key: "private_paper", label: "Private paper", row: "Meridian Bio" },
      {
        key: "other_liquid",
        label: "Other liquid",
        row: "Assets held elsewhere",
      },
      { key: "public_market", label: "Public market", row: "Orion Compute" },
    ];
    for (const [index, access] of accessCases.entries()) {
      await page.goBack();
      await expectSnapshot();
      const accessButton = snapshot.getByRole("button", {
        name: new RegExp(`View ${access.label} holdings detail`, "u"),
      });
      await expect(accessButton).toBeVisible();
      await expect(accessButton).toHaveAttribute("data-slot", "button");
      if (index === 0) {
        await accessButton.press("Enter");
      } else {
        await accessButton.click();
      }
      await expect(page).toHaveURL(/\/holdings\?access=/u);
      expect(new URL(page.url()).searchParams.get("access")).toBe(access.key);
      const detail = page
        .getByRole("region", { name: access.label, exact: true })
        .filter({ has: page.locator("#portfolio-access-detail-title") });
      await expect(
        detail.getByRole("heading", { name: access.label }),
      ).toBeFocused();
      await expect(detail).toContainText(access.row);
      await expectNoHorizontalOverflow(page);
      if (access.key === "cash") {
        await expect(detail).toHaveScreenshot(
          "portfolio-access-drilldown.png",
          {
            animations: "disabled",
          },
        );
      }
    }
  },
);
