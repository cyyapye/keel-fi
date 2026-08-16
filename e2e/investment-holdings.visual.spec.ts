import { expect, test, type Page } from "@playwright/test";

import { multiInstitutionInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { navigateToScreen } from "./navigation";

const holdingsView = multiInstitutionInvestmentHoldingsView();

const alphaFixture = {
  dashboard: {
    asOfDate: "2026-07-01",
    forecastHorizonDate: "2031-12-31",
    householdName: "Demo Household",
    fiEligibleLiquidMinor: 182_500_000,
    protectedRunwayMonths: 42,
    householdBurnMonthlyMinor: 2_850_000,
    businessBurnMonthlyMinor: 1_250_000,
    fiTargetMinor: 325_000_000,
    fiGapMinor: 142_500_000,
    p25FiveYearLiquidityMinor: 94_000_000,
    p50FiveYearLiquidityMinor: 210_000_000,
    p75FiveYearLiquidityMinor: 354_000_000,
    probabilityCrossingFiPpm: 640_000,
  },
  goals: [
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
            methodology: "Synthetic method",
            createdAt: "2026-07-01T09:00:00-07:00",
            createdBy: "Demo Operator",
          },
        },
      ],
    },
  ],
  holdings: holdingsView.exposureView.positions.map((position) => ({
    id: position.id,
    positionName: position.legalVehicleName,
    exposureName: position.reportedExposureName,
    ownerLabel: position.containerLabel,
    positionKind: position.positionKind,
    administratorNavMinor: position.valueMinor,
    administratorNavState:
      position.valueState === "not_reported"
        ? ("not_set" as const)
        : position.valueState,
    externalMarkMinor: null,
    underwritingValueMinor: null,
    scenarioValueMinor: null,
    usableLiquidityMinor: null,
    sourceStatus: "verified" as const,
    sourceLabel: position.sourceLabel,
    effectiveDate: position.observedAt.slice(0, 10),
    retrievedAt: position.observedAt,
    confidencePpm: null,
    ticker: position.ticker,
    quantityMicros: null,
    costBasisMinor: null,
  })),
  evidenceInbox: [],
  portfolioWatch: { targets: [], observations: [] },
  scenarios: [],
  signalReconciliations: [],
  signalUpdateProposals: [],
  forecastHistory: [],
};

const statuses = [
  {
    version: 1 as const,
    connectionId: "11111111-1111-4111-8111-111111111111",
    institutionKey: "ins_robinhood",
    institutionLabel: "Robinhood",
    status: "ready" as const,
    lastSyncedAt: "2026-08-15T11:45:00.000Z",
    automaticUpdatesEnabled: true,
    latestImportId: null,
    latestRunStatus: "succeeded" as const,
    errorCode: null,
    latestAdjudication: {
      importId: "import_robinhood_synthetic",
      policyVersion: "plaid-investments-holdings-auto-v3",
      autoAppliedCount: 0,
      quarantinedCount: 0,
      preservedPositionCount: 1,
      baselineRefreshStatus: "not_needed" as const,
    },
  },
  {
    version: 1 as const,
    connectionId: "22222222-2222-4222-8222-222222222222",
    institutionKey: "ins_fidelity",
    institutionLabel: "Fidelity",
    status: "needs_attention" as const,
    lastSyncedAt: "2026-08-15T11:45:00.000Z",
    automaticUpdatesEnabled: true,
    latestImportId: "import_fidelity_review_synthetic",
    latestRunStatus: "failed" as const,
    errorCode: "holdings_incomplete" as const,
    latestAdjudication: {
      importId: "import_fidelity_review_synthetic",
      policyVersion: "plaid-investments-holdings-auto-v3",
      autoAppliedCount: 0,
      quarantinedCount: 1,
      preservedPositionCount: 3,
      baselineRefreshStatus: "manual_required" as const,
    },
  },
  {
    version: 1 as const,
    connectionId: "33333333-3333-4333-8333-333333333333",
    institutionKey: "ins_fidelity",
    institutionLabel: "Fidelity",
    status: "paused" as const,
    lastSyncedAt: "2026-04-01T11:45:00.000Z",
    automaticUpdatesEnabled: false,
    latestImportId: null,
    latestRunStatus: null,
    errorCode: null,
    latestAdjudication: null,
  },
  {
    version: 1 as const,
    connectionId: "44444444-4444-4444-8444-444444444444",
    institutionKey: "ins_synthetic_reconnect",
    institutionLabel: "Synthetic Reconnect Brokerage",
    status: "needs_attention" as const,
    lastSyncedAt: "2026-08-14T11:45:00.000Z",
    automaticUpdatesEnabled: true,
    latestImportId: null,
    latestRunStatus: "failed" as const,
    errorCode: "connection_invalid" as const,
    latestAdjudication: null,
  },
  {
    version: 1 as const,
    connectionId: "55555555-5555-4555-8555-555555555555",
    institutionKey: "ins_synthetic_closed",
    institutionLabel: "Synthetic Former Brokerage",
    status: "disconnected" as const,
    lastSyncedAt: "2026-03-01T11:45:00.000Z",
    automaticUpdatesEnabled: false,
    latestImportId: null,
    latestRunStatus: null,
    errorCode: null,
    latestAdjudication: null,
  },
];

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.route("**/api/holding-imports", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/cash-accounts", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        status: "disconnected",
        connections: [],
        acceptedAccounts: [],
        pendingProposals: [],
        errorCode: null,
      },
    });
  });
  await page.route("**/api/portfolio-baseline", async (route) => {
    await route.fulfill({
      json: {
        status: "waiting_for_reviewed_holdings",
        sourceRevision: null,
        observedAt: null,
        baseForecastSnapshotId: null,
        baseForecastSnapshotVersion: null,
        summary: null,
        positions: [],
        cashAccounts: [],
        planning: {
          currentFiEligibleLiquidMinor: 182_500_000,
          protectedCashFloorMinor: 10_300_000,
          householdBurnMonthlyMinor: 2_850_000,
          businessBurnMonthlyMinor: 1_250_000,
          fiTargetMinor: 325_000_000,
          p25FiveYearLiquidityMinor: 94_000_000,
          p50FiveYearLiquidityMinor: 210_000_000,
          p75FiveYearLiquidityMinor: 354_000_000,
          forecastHorizonDate: "2031-12-31",
        },
        suggestedOtherFiEligibleLiquidMinor: 0,
        currentImpact: {
          fiEligibleLiquidMinor: 182_500_000,
          fiEligibleChangeMinor: 0,
          protectedRunwayMonths: 42,
          fiGapMinor: 142_500_000,
          lowerTotalAvailableMinor: 276_500_000,
          middleTotalAvailableMinor: 392_500_000,
          higherTotalAvailableMinor: 536_500_000,
          probabilityCrossingFiPpm: 640_000,
        },
        latestBaseline: null,
        hasSourceChanges: false,
        hasCashAccountChanges: false,
        requiresDuplicateReview: false,
        requiresCashOverlapReview: false,
        canConfirm: false,
      },
    });
  });
  await page.route("**/api/automation/angellist/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        status: "ready",
        interval: "weekly",
        runStatus: null,
        lastSeenAt: "2026-08-15T12:00:00.000Z",
        lastCompletedAt: "2026-08-15T11:55:00.000Z",
        nextRunAt: "2026-08-22T12:00:00.000Z",
        latestImportId: null,
        errorCode: null,
      },
    });
  });
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: holdingsView });
  });
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: statuses,
        errorCode: null,
      },
    });
  });
});

test("operates multiple institutions and keeps position and exposure identity visible", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  await expect(
    page.getByRole("heading", { name: "Accounts and updates" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add investment institution" }),
  ).toBeVisible();
  await expect(
    page.locator(".investment-institution").filter({ hasText: "Fidelity" }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Fidelity brokerage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fidelity rollover IRA" }),
  ).toBeVisible();
  await expect(page.getByText("Partial", { exact: true })).toBeVisible();
  await expect(page.getByText("Stale · Apr 1, 2026")).toBeVisible();
  const reconnectCard = page.locator(".investment-institution").filter({
    hasText: "Synthetic Reconnect Brokerage",
  });
  await expect(
    reconnectCard.getByText("Reconnect needed", { exact: true }),
  ).toBeVisible();
  await expect(
    reconnectCard.getByRole("button", { name: "Reconnect" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic Former Brokerage")).toBeVisible();
  await expect(
    page.getByText("Reviewed positions and planning history remain available."),
  ).toBeVisible();

  const positionTab = page.getByRole("tab", { name: "Positions" });
  const exposureTab = page.getByRole("tab", { name: "Exposures" });
  await expect(positionTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("NVDA common stock", { exact: true }),
  ).toHaveCount(3);
  await expect(page.getByText("Locked", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Company holdings" }),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  const targetHeights = await page
    .locator(".investment-institutions .button, .investment-view-tabs button")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  expect(targetHeights.every((height) => height >= 44)).toBe(true);

  await page.addStyleTag({
    content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
  });
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "investment-holdings-positions.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await exposureTab.click();
  await expect(exposureTab).toHaveAttribute("aria-selected", "true");
  const nvda = page.locator(".exposure-group").filter({
    has: page.getByText("NVIDIA common stock", { exact: true }),
  });
  await expect(nvda).toContainText("3 positions");
  await nvda.locator("summary").click();
  await expect(nvda.getByText("Robinhood · Robinhood brokerage")).toBeVisible();
  await expect(nvda.getByText("Fidelity · Fidelity brokerage")).toBeVisible();
  await expect(
    nvda.getByText("Fidelity · Fidelity rollover IRA"),
  ).toBeVisible();
  await expect(
    page.locator(".unallocated-positions").getByText("Allocation unknown"),
  ).toBeVisible();
  await expect(
    page
      .locator(".exposure-group")
      .filter({ hasText: "Synthetic Cloud Basket" })
      .getByText("Value unavailable"),
  ).toBeVisible();
  await expect(
    page
      .locator(".exposure-group")
      .filter({ hasText: "Synthetic Cloud Basket" }),
  ).not.toContainText("USD 0");
  await expect(
    page.getByRole("heading", { name: "Unallocated or unresolved value" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "investment-holdings-exposures.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  const robinhoodCard = page
    .locator(".investment-institution")
    .filter({ hasText: "Robinhood" });
  await robinhoodCard.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    robinhoodCard.getByText(
      "Provider access will be removed. Reviewed history stays in Keel.",
    ),
  ).toBeVisible();
  await robinhoodCard.getByRole("button", { name: "Keep connected" }).click();
  await expect(
    robinhoodCard.getByText(
      "Provider access will be removed. Reviewed history stays in Keel.",
    ),
  ).toHaveCount(0);
});
