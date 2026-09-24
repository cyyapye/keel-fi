import { expect, test, type Page, type Request } from "./api-mocked-test";
import type * as CollectionSearch from "../apps/web/src/collection-search";
import type { Holding } from "../packages/domain/src/index";
import type { InvestmentHoldingsView } from "../packages/domain/src/investment-holdings-view";

import {
  emptyInvestmentHoldingsView,
  investmentHoldingsViewFor,
  multiInstitutionInvestmentHoldingsView,
  reconciledReviewedHistoryInvestmentHoldingsView,
} from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { navigateToScreen } from "./navigation";

async function openHoldingSources(page: Page) {
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(page).toHaveURL(/\/holdings\/sources$/u);
  await expect(
    page.getByRole("heading", { name: "Holding sources", exact: true }),
  ).toBeVisible();
}

const holdingsView = multiInstitutionInvestmentHoldingsView();

const paginatedHoldings: Holding[] = Array.from({ length: 25 }, (_, index) => ({
  id: `position_paginated_${String(index + 1).padStart(2, "0")}`,
  companyId: null,
  positionName: `Demo Security ${String(index + 1).padStart(2, "0")}`,
  exposureName: `Demo Exposure ${String(index + 1).padStart(2, "0")}`,
  ownerLabel: "Demo Brokerage",
  positionKind: "direct",
  administratorNavMinor: (index + 1) * 10_000,
  administratorNavState: "reported",
  externalMarkMinor: null,
  underwritingValueMinor: null,
  scenarioValueMinor: null,
  usableLiquidityMinor: null,
  sourceStatus: "verified",
  sourceLabel: "Plaid Investments",
  effectiveDate: "2026-08-16",
  retrievedAt: "2026-08-16T12:00:00.000Z",
  confidencePpm: null,
  ticker: `DMO${index + 1}`,
  quantityMicros: 1_000_000,
  costBasisMinor: null,
}));

const paginatedHoldingsView = investmentHoldingsViewFor(paginatedHoldings);

function alphaHoldingsFrom(view: InvestmentHoldingsView) {
  const sourcePositionById = new Map(
    view.positionView.connections.flatMap((connection) =>
      connection.containers.flatMap((container) =>
        container.positions.map((position) => [position.id, position] as const),
      ),
    ),
  );
  return view.exposureView.positions.map((position) => {
    const sourcePosition = sourcePositionById.get(position.id);
    if (sourcePosition === undefined) {
      throw new Error(
        "Synthetic exposure position is missing source evidence.",
      );
    }
    return {
      id: position.id,
      companyId:
        view.exposureView.exposures.find((group) =>
          group.contributions.some(
            (contribution) => contribution.positionId === position.id,
          ),
        )?.exposure.companyId ?? null,
      positionName: position.legalVehicleName,
      exposureName: position.reportedExposureName,
      ownerLabel: position.containerLabel,
      positionKind: position.positionKind,
      administratorNavMinor: sourcePosition.snapshot.unrealizedValue.minor,
      administratorNavState:
        sourcePosition.snapshot.unrealizedValue.state === "not_reported"
          ? ("not_set" as const)
          : sourcePosition.snapshot.unrealizedValue.state,
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
      costBasisMinor: position.providerCostBasisMinor,
      investedMinor: position.investedMinor,
      committedMinor: position.committedMinor,
      realizedValueMinor: position.realizedValueMinor,
      instrumentType: position.instrumentType,
      positionEconomicsContext:
        position.positionKind !== "spv_interest" || position.committedMinor <= 0
          ? undefined
          : {
              snapshotId: position.snapshotId,
              currency: position.currency,
              committedMinor: position.committedMinor,
              fundedMinor: position.investedMinor,
              acceptedTerms: position.acceptedEconomicsTerms ?? null,
              reportedTerms: position.reportedEconomicsTerms ?? null,
            },
      positionValueContext: {
        snapshotId: position.snapshotId,
        currency: position.currency,
        providerValueState: sourcePosition.snapshot.unrealizedValue.state,
        providerValueMinor: sourcePosition.snapshot.unrealizedValue.minor,
        acceptedAdjustment: sourcePosition.acceptedValueAdjustment ?? null,
        projectedEstimate: position.privateValueEstimate,
      },
    };
  });
}

const alphaFixture = {
  dashboard: {
    asOfDate: "2026-07-01",
    forecastHorizonDate: "2031-12-31",
    householdName: "Demo Household",
    fiEligibleLiquidMinor: 182_500_000,
    protectedRunwayMonths: 42,
    protectedCashFloorMinor: 10_300_000,
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
  holdings: alphaHoldingsFrom(holdingsView),
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
    lastSyncedAt: "2026-08-19T11:45:00.000Z",
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
    connectionId: "66666666-6666-4666-8666-666666666666",
    institutionKey: "ins_robinhood_legacy",
    institutionLabel: "Robinhood",
    status: "disconnected" as const,
    lastSyncedAt: "2026-03-01T11:45:00.000Z",
    automaticUpdatesEnabled: false,
    latestImportId: null,
    latestRunStatus: null,
    errorCode: null,
    latestAdjudication: null,
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

const acceptedCashAccounts = [
  {
    id: "cash_fact_synthetic_checking",
    naturalKeySha256: "7".repeat(64),
    connectionId: "cash_connection_synthetic_bank",
    institutionLabel: "Northstar Demo Bank",
    accountLabel: "Everyday checking",
    subtype: "checking" as const,
    valueMinor: 2_500_000,
    valueState: "reported" as const,
    balanceSource: "available" as const,
    refreshKind: "live" as const,
    observedAt: "2026-08-18T16:00:00.000Z",
    acceptedAt: "2026-08-18T16:05:00.000Z",
  },
  {
    id: "cash_fact_synthetic_wallet",
    naturalKeySha256: "6".repeat(64),
    connectionId: "cash_connection_synthetic_bank",
    institutionLabel: "Northstar Demo Bank",
    accountLabel: "Travel cash",
    subtype: "checking" as const,
    valueMinor: 5_000,
    valueState: "reported" as const,
    balanceSource: "available" as const,
    refreshKind: "live" as const,
    observedAt: "2026-08-18T16:00:00.000Z",
    acceptedAt: "2026-08-18T16:05:00.000Z",
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
  await page.clock.setFixedTime(new Date("2026-08-19T12:00:00.000Z"));
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaFixture.holdings,
    investmentHoldings: holdingsView,
    acceptedCashAccounts,
    pendingImports: [],
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
        acceptedAccounts: acceptedCashAccounts,
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
        changes: { positions: [], cashAccounts: [] },
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
  await page.route(
    "**/api/automation/provider-holdings/*/status",
    async (route) => {
      const provider = new URL(route.request().url()).pathname
        .split("/")
        .at(-2);
      await route.fulfill({
        json: {
          version: 1,
          provider,
          status: "setup_required",
          interval: "daily",
          runStatus: null,
          lastSeenAt: null,
          lastCompletedAt: null,
          nextRunAt: null,
          latestImportId: null,
          errorCode: null,
        },
      });
    },
  );
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: holdingsView });
  });
  await page.route("**/api/private-exposure-reviews", async (route) => {
    await route.fulfill({
      json: {
        version: 2,
        positions: [],
        companies: [],
        exactBatch: {
          revision: "a".repeat(64),
          positionCount: 0,
          companyCount: 0,
          existingCompanyCount: 0,
          newCompanyCount: 0,
          excludedPositionCount: 0,
        },
      },
    });
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
  await page.route("**/api/investment-connections/auto-sync", async (route) => {
    expect(route.request().method()).toBe("POST");
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

test("groups reviewed public stock with separate SPVs and keeps their value bases", async ({
  page,
}, testInfo) => {
  const syntheticHolding = (
    id: string,
    name: string,
    valueMinor: number | null,
    ticker: string | null,
  ): Holding => ({
    id,
    companyId: ticker === null ? "company_northstar" : null,
    positionName: name,
    exposureName: "Northstar Robotics",
    ownerLabel: ticker === null ? "Synthetic SPV" : "Demo Brokerage",
    positionKind: ticker === null ? "spv_interest" : "direct",
    administratorNavMinor: valueMinor,
    administratorNavState: valueMinor === null ? "not_set" : "reported",
    externalMarkMinor: null,
    underwritingValueMinor: null,
    scenarioValueMinor: null,
    usableLiquidityMinor: null,
    sourceStatus: "verified",
    sourceLabel: ticker === null ? "Synthetic manager" : "Plaid Investments",
    effectiveDate: "2026-08-15",
    retrievedAt: "2026-08-15T12:00:00.000Z",
    confidencePpm: null,
    ticker,
    quantityMicros: ticker === null ? null : 100_000_000,
    investedMinor: ticker === null ? 2_000_000 : 1_500_000,
    committedMinor: ticker === null ? 2_000_000 : 1_500_000,
    costBasisMinor: ticker === null ? null : 1_500_000,
  });
  const holdings = [
    syntheticHolding(
      "position_nstr_public",
      "Northstar Class A",
      1_600_000,
      "NSTR",
    ),
    syntheticHolding("position_nstr_spv_a", "Northstar SPV A", 2_000_000, null),
    syntheticHolding("position_nstr_spv_b", "Northstar SPV B", null, null),
  ];
  const view = investmentHoldingsViewFor(holdings);
  const publicId = view.exposureView.exposures.find(
    (group) => group.exposure.exposureKind === "public_instrument",
  )!.exposure.id;
  const companyId = view.exposureView.exposures.find(
    (group) => group.exposure.exposureKind === "private_company",
  )!.exposure.id;
  const linkedView: InvestmentHoldingsView = {
    ...view,
    exposureView: {
      ...view.exposureView,
      publicCompanyLinks: [
        { publicExposureId: publicId, companyExposureId: companyId },
      ],
    },
  };
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings,
    investmentHoldings: linkedView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.goto("/holdings");
  await expect(page.locator(".exposure-group")).toHaveCount(1);
  const group = page.locator(".exposure-group");
  await expect(group).toContainText("Northstar Robotics");
  await expect(group).toContainText("3 positions");
  await group.locator('[data-slot="collapsible-trigger"]').click();
  await expect(group).toContainText("NSTR");
  await expect(group).toContainText("Northstar SPV A");
  await expect(group).toContainText("Northstar SPV B");
  await expect(group).toContainText("1 estimate");
  await expect(group).toContainText("$56k");
  await expect(
    group.getByRole("link", { name: "Review company link" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (process.platform === "linux") {
    await group.screenshot({
      path: testInfo.outputPath("public-private-company-group-linux.png"),
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
  } else {
    await expect(group).toHaveScreenshot("public-private-company-group.png", {
      animations: "disabled",
      caret: "hide",
    });
  }
});

test("shows the Holdings shell while one read-only projection loads", async ({
  page,
}) => {
  let releaseHoldingsPage: () => void = () => undefined;
  const holdingsPageGate = new Promise<void>((resolve) => {
    releaseHoldingsPage = resolve;
  });
  const apiRequests: Array<{ method: string; pathname: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push({ method: request.method(), pathname: url.pathname });
    }
  });

  await page.unroute("**/api/holdings-page");
  await page.route("**/api/holdings-page", async (route) => {
    await holdingsPageGate;
    await route.fulfill({
      json: {
        version: 1,
        shell: {
          householdName: alphaFixture.dashboard.householdName,
          pendingEvidenceCount: 0,
        },
        holdings: alphaFixture.holdings,
        investmentHoldings: holdingsView,
        acceptedCashAccounts,
        pendingImports: [],
      },
    });
  });

  await page.goto("/holdings");
  await expect(page.getByRole("heading", { name: "Holdings" })).toBeVisible();
  await expect(
    page.getByRole("status", { name: "" }).filter({
      hasText: "Loading reviewed exposures…",
    }),
  ).toBeVisible();
  await expect.poll(() => apiRequests.length).toBe(1);
  expect(apiRequests).toEqual([
    { method: "GET", pathname: "/api/holdings-page" },
  ]);
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".holdings-screen")).toHaveScreenshot(
    "holdings-fast-path-loading.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  releaseHoldingsPage();
  await expect(
    page.locator(".exposure-group").filter({ hasText: "NVDA" }).first(),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        apiRequests.filter(
          (request) =>
            request.method === "GET" &&
            request.pathname === "/api/investment-connections",
        ).length,
    )
    .toBe(1);
  expect(apiRequests.filter((request) => request.method !== "GET")).toEqual([]);
});

test("shows compact empty exposure and account states", async ({ page }) => {
  const emptyAlphaFixture = { ...alphaFixture, holdings: [] };
  const emptyConnectionStatus = {
    ...statuses[0]!,
    connectionId: "77777777-7777-4777-8777-777777777777",
    institutionKey: "ins_demo_empty",
    institutionLabel: "Demo Empty Brokerage",
    lastSyncedAt: null,
    latestAdjudication: null,
  };
  const emptyConnectionState = {
    version: 1 as const,
    configured: true,
    connections: [emptyConnectionStatus],
    errorCode: null,
  };

  await page.unroute("**/api/alpha");
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: emptyAlphaFixture });
  });
  await page.unroute("**/api/holdings-page");
  await routeHoldingsPage(page, {
    householdName: emptyAlphaFixture.dashboard.householdName,
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.unroute("**/api/investment-holdings");
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: emptyInvestmentHoldingsView });
  });
  await page.unroute("**/api/investment-connections");
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({ json: emptyConnectionState });
  });
  await page.unroute("**/api/investment-connections/auto-sync");
  await page.route("**/api/investment-connections/auto-sync", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ json: emptyConnectionState });
  });
  await page.unroute("**/api/cash-accounts");
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

  await page.goto("/holdings");
  const exposureView = page.locator(".investment-views");
  await expect(
    exposureView.getByRole("heading", {
      level: 3,
      name: "No company exposures",
    }),
  ).toBeVisible();
  await expect(
    exposureView.locator('[data-slot="empty-state"] > span'),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expect(exposureView).toHaveScreenshot(
    "investment-holdings-empty-exposures.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await openHoldingSources(page);
  const emptyInstitution = page
    .locator(".investment-institution")
    .filter({ hasText: "Demo Empty Brokerage" });
  await emptyInstitution.locator(".investment-institution__trigger").click();
  await expect(
    emptyInstitution.getByRole("heading", {
      level: 4,
      name: "No reviewed accounts yet.",
    }),
  ).toBeVisible();
  await expect(
    emptyInstitution.locator('[data-slot="empty-state"] > span'),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expect(emptyInstitution).toHaveScreenshot(
    "investment-holdings-empty-accounts.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
});

test("operates multiple institutions from one exposure-first holdings view", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);
  await expect(
    page.getByRole("link", { name: "Sources", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".page-count")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Import holdings" }),
  ).toHaveCount(0);
  await openHoldingSources(page);
  await expect(
    page.getByRole("button", { name: "Import holdings" }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Brokerages", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add brokerage" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add bank" })).toBeVisible();
  await expect(
    page.getByText("Robinhood, Fidelity, Schwab investing. Banking above."),
  ).toBeVisible();
  const robinhoodCard = page
    .locator(".investment-institution")
    .filter({ hasText: "Robinhood" });
  await expect(robinhoodCard).toHaveCount(1);
  await expect(
    robinhoodCard.getByText("Up to date", { exact: true }),
  ).toBeVisible();
  await expect(
    robinhoodCard.locator(".investment-institution__value"),
  ).toHaveText("$186.25k");
  await expect(robinhoodCard).toContainText(
    "Data as of Aug 15, 2026 · Checked Aug 19, 2026",
  );
  await robinhoodCard.locator(".investment-institution__trigger").click();
  const robinhoodAccount = robinhoodCard
    .locator(".investment-institution__account")
    .filter({ hasText: "Robinhood brokerage" });
  await expect(robinhoodAccount).toBeVisible();
  await expect(
    robinhoodAccount.locator(".investment-institution__account-value strong"),
  ).toHaveText("$186.25k");
  await expect(robinhoodAccount).toContainText("Complete · as of Aug 15, 2026");
  await expect(
    robinhoodCard.getByRole("button", { name: "Connect again" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".investment-institution").filter({ hasText: "Fidelity" }),
  ).toHaveCount(2);
  await expect(
    page.locator(".investment-institution").filter({ hasText: "Fidelity" }),
  ).toContainText(["2 accounts", "1 account"]);
  const currentFidelityCard = page
    .locator(".investment-institution")
    .filter({ hasText: "Fidelity" })
    .first();
  await expect(
    currentFidelityCard.locator(".investment-institution__value"),
  ).toHaveText("$647.25k");
  await expect(
    currentFidelityCard.locator(
      ".investment-institution__account-value strong",
    ),
  ).toHaveText(["$330k", "$317.25k"]);
  const reconnectCard = page.locator(".investment-institution").filter({
    hasText: "Synthetic Reconnect Brokerage",
  });
  await expect(
    reconnectCard.getByText("Reconnect needed", { exact: true }),
  ).toBeVisible();
  await expect(
    reconnectCard.getByRole("button", { name: "Reconnect", exact: true }),
  ).toBeVisible();
  const disconnectedCard = page.locator(".investment-institution").filter({
    hasText: "Synthetic Former Brokerage",
  });
  await expect(disconnectedCard).toBeVisible();
  await expect(
    disconnectedCard.getByText("Disconnected", { exact: true }),
  ).toBeVisible();
  await expect(disconnectedCard).toContainText("No current accounts");
  await expect(
    disconnectedCard.getByRole("button", { name: "Connect again" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Holdings sections" })
    .getByRole("link", { name: "Holdings", exact: true })
    .click();
  await expect(page).toHaveURL(/\/holdings$/u);

  const exposureView = page.locator(".investment-views");
  await expect(
    exposureView.getByRole("heading", { name: "Exposures", exact: true }),
  ).toBeVisible();
  await expect(exposureView.getByRole("tab")).toHaveCount(0);
  await expect(
    exposureView.locator(".investment-views__heading"),
  ).toContainText("5 exposures");
  await expect(
    exposureView.locator(".investment-views__heading"),
  ).toContainText("7 legal positions");
  await expect(exposureView.locator(".investment-views__total")).toContainText(
    "Total exposure$860k · 2 values unavailable",
  );
  await expect(exposureView.locator(".exposure-group")).toHaveCount(5);
  const exposureSort = exposureView.getByLabel(
    "Sort exposures and positions by value",
  );
  await expect(exposureSort).toContainText("Highest first");
  const restingSortBorder = await exposureSort.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return [
      styles.borderTopWidth,
      styles.borderRightWidth,
      styles.borderBottomWidth,
      styles.borderLeftWidth,
    ];
  });
  expect(restingSortBorder).toEqual(["0px", "0px", "0px", "0px"]);
  await exposureSort.focus();
  const focusedSortFrame = await exposureSort.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      border: [
        styles.borderTopWidth,
        styles.borderRightWidth,
        styles.borderBottomWidth,
        styles.borderLeftWidth,
      ],
      outline: styles.outlineStyle,
    };
  });
  expect(focusedSortFrame.border).toEqual(restingSortBorder);
  expect(focusedSortFrame.outline).toBe("none");
  await expect(
    exposureView.locator(".exposure-group__summary strong").first(),
  ).toHaveText("NVDA");
  await expect(
    page.getByRole("heading", { name: "Company holdings" }),
  ).toHaveCount(0);
  const nvda = page.locator(".exposure-group").filter({
    has: page.locator(
      '.exposure-group__summary strong[title="NVIDIA common stock"]',
    ),
  });
  await expect(nvda).toContainText("3 positions");
  await nvda.locator(".exposure-group__summary").click();
  await expect(nvda.getByText("Robinhood · Robinhood brokerage")).toBeVisible();
  await expect(nvda.getByText("Fidelity · Fidelity brokerage")).toBeVisible();
  await expect(
    nvda.getByText("Fidelity · Fidelity rollover IRA"),
  ).toBeVisible();
  await expect(
    nvda.locator(".exposure-group__summary .exposure-group__totals"),
  ).toContainText("$740k");
  const nvdaSummaryMeta = nvda.locator(
    ".exposure-group__summary .exposure-group__market-meta",
  );
  await expect(nvdaSummaryMeta).toHaveText("$681k · $185 · +9%");
  expect(
    await nvda
      .locator(
        ".exposure-group__summary .exposure-group__identity small, .exposure-group__summary .exposure-group__totals small",
      )
      .evaluateAll((elements) =>
        elements.map((element) => window.getComputedStyle(element).fontSize),
      ),
  ).toEqual(["12px", "12px"]);
  const summaryAlignment = await nvda
    .locator(".exposure-group__summary")
    .evaluate((summary) => {
      const gridRow = (selector: string) => {
        const element = summary.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
          throw new Error(`Missing summary element: ${selector}`);
        }
        return window.getComputedStyle(element).gridRowStart;
      };

      return {
        alignItems: window.getComputedStyle(summary).alignItems,
        identityRow: gridRow(".exposure-group__identity strong"),
        valueRow: gridRow(".exposure-group__value"),
        positionCountRow: gridRow(".exposure-group__identity small"),
        marketMetaRow: gridRow(".exposure-group__market-meta"),
      };
    });
  expect(summaryAlignment).toEqual({
    alignItems: "baseline",
    identityRow: "1",
    valueRow: "1",
    positionCountRow: "2",
    marketMetaRow: "2",
  });
  await expect(nvdaSummaryMeta).toHaveAttribute(
    "title",
    "Share price as of Aug 15, 2026",
  );
  await expect(nvda.locator(".position-row__value")).toContainText([
    "$315k",
    "$240k",
    "$185k",
  ]);
  const nvdaPositionMeta = nvda.locator(".position-row__market-meta");
  await expect(nvdaPositionMeta).toHaveText([
    "$290k · $185 · +9%",
    "$221k · $185 · +9%",
    "$170k · $185 · +9%",
  ]);
  await expect(nvdaPositionMeta.first()).toHaveAttribute(
    "title",
    "Share price as of Aug 15, 2026",
  );
  expect(
    await nvdaPositionMeta.evaluateAll((elements) =>
      elements.map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      }),
    ),
  ).toEqual([1, 1, 1]);
  await expect(nvda).not.toContainText("Cost basis");
  await expect(nvda).not.toContainText("Return");
  await expect(nvda).not.toContainText("Full exposure");
  await expect(nvda).not.toContainText("/sh");
  const cash = page.locator(".cash-holdings");
  await expect(cash.getByRole("heading", { name: "Cash" })).toBeVisible();
  await expect(cash).toContainText("Total cash$28.55k");
  await expect(cash).toContainText("2 bank accounts · 2 brokerage positions");
  await expect(cash.getByText("Everyday checking")).toBeVisible();
  await expect(cash.getByText("Northstar Demo Bank · Bank cash")).toBeVisible();
  await expect(cash.getByText("Travel cash")).toHaveCount(0);
  await expect(cash.getByText("Robinhood · Robinhood brokerage")).toBeVisible();
  await expect(
    cash.getByText("Fidelity · Fidelity rollover IRA"),
  ).toBeVisible();
  await expect(
    cash.locator(".cash-holdings__rows article > strong"),
  ).toHaveText(["$25k", "$1.25k", "$2.25k"]);
  const smallCashDisclosure = cash.getByRole("button", {
    name: "Show 1 balance under $100",
  });
  await expect(smallCashDisclosure).toHaveAttribute(
    "data-slot",
    "collapsible-trigger",
  );
  await expect(smallCashDisclosure).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() =>
      smallCashDisclosure.evaluate(
        (element) => window.getComputedStyle(element).textDecorationLine,
      ),
    )
    .toBe("none");
  await smallCashDisclosure.click();
  await expect(cash.getByText("Travel cash")).toBeVisible();
  await expect(
    cash.locator(".cash-holdings__rows article > strong"),
  ).toHaveText(["$25k", "$1.25k", "$2.25k", "$50"]);
  await cash.getByRole("button", { name: "Hide balances under $100" }).click();
  await expect(cash.getByText("Travel cash")).toHaveCount(0);
  await expect(
    page.locator(".exposure-group").filter({
      has: page.getByText("US Dollar", { exact: true }),
    }),
  ).toHaveCount(0);
  await exposureSort.click();
  await expect(
    page.getByRole("option", { name: "Lowest first" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("investment-holdings-sort-open.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  await page.getByRole("option", { name: "Lowest first" }).click();
  await expect(exposureSort).toContainText("Lowest first");
  await expect(
    exposureView.locator(".exposure-group__summary strong").first(),
  ).toHaveText("Beacon Robotics");
  await expect(nvda.locator(".position-row__value")).toContainText([
    "$185k",
    "$240k",
    "$315k",
  ]);
  await exposureSort.click();
  await page.getByRole("option", { name: "Highest first" }).click();
  await expect(exposureSort).toContainText("Highest first");
  await exposureSort.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "Highest first" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "Lowest first" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(exposureSort).toContainText("Lowest first");
  await exposureSort.focus();
  await page.keyboard.press("ArrowUp");
  await expect(
    page.getByRole("option", { name: "Lowest first" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(
    page.getByRole("option", { name: "Highest first" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(exposureSort).toContainText("Highest first");
  await expect
    .poll(() =>
      exposureSort.evaluate(
        (element) => window.getComputedStyle(element).boxShadow,
      ),
    )
    .not.toBe("none");
  expect(
    await exposureSort.evaluate(
      (element) => window.getComputedStyle(element).boxShadow,
    ),
  ).not.toContain("inset");
  await exposureSort.evaluate((element) => {
    (element as HTMLElement).blur();
  });
  const harbor = page.locator(".exposure-group").filter({
    has: page.getByText("Harbor Health Systems", { exact: true }),
  });
  await harbor.locator(".exposure-group__summary").click();
  await expect(harbor.getByText("Synthetic Horizon SPV")).toBeVisible();
  await expect(harbor.getByText("Locked", { exact: true })).toBeVisible();
  await expect(
    page.locator(".unallocated-positions").getByText("Allocation unknown"),
  ).toBeVisible();
  await expect(page.locator(".unallocated-positions")).not.toContainText(
    "NVDA",
  );
  await expect(page.locator(".unallocated-positions")).not.toContainText(
    "U S Dollar",
  );
  await expect(
    page
      .locator(".unallocated-positions")
      .getByText("Company unresolved", { exact: true }),
  ).toHaveCount(0);
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
  ).not.toContainText("$0");
  const beacon = page.locator(".exposure-group").filter({
    has: page.getByText("Beacon Robotics", { exact: true }),
  });
  await expect(beacon.locator(".exposure-group__summary")).toContainText(
    "$120k",
  );
  await expect(beacon.locator(".exposure-group__summary")).toContainText(
    "1 estimate · $60k · +100%",
  );
  await beacon.locator(".exposure-group__summary").click();
  await expect(beacon.getByText("Synthetic Beacon SPV")).toBeVisible();
  await expect(beacon.locator(".position-row__value")).toContainText([
    "$60k",
    "$60k",
  ]);
  const beaconEstimateRow = beacon.locator("article").filter({
    hasText: "Synthetic Beacon SPV",
  });
  await expect(
    beaconEstimateRow.locator(".position-row__value"),
  ).toHaveAttribute("title", "Portfolio Watch estimate as of Aug 15, 2026");
  await expect(beaconEstimateRow).toContainText("$40k · +50%");
  await expect(beaconEstimateRow).not.toContainText("Portfolio Watch estimate");
  expect(
    await beaconEstimateRow
      .locator(".position-row__value small")
      .evaluate((element) => element.getClientRects().length),
  ).toBe(1);
  await expect(beacon).not.toContainText("/sh");
  await expect(page.locator(".unallocated-positions")).not.toContainText(
    "Synthetic Beacon SPV",
  );
  await expect(
    page.getByRole("heading", { name: "Resolve positions" }),
  ).toBeVisible();
  const resolutionTop = await page
    .locator(".unallocated-positions")
    .evaluate((element) => element.getBoundingClientRect().top);
  const firstExposureTop = await page
    .locator(".exposure-group")
    .first()
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(resolutionTop).toBeLessThan(firstExposureTop);
  await expect(
    nvda.getByRole("button", {
      name: "View NVDA holding details",
    }),
  ).toHaveCount(3);
  await expect(
    cash.getByRole("button", {
      name: "View U S Dollar holding details",
    }),
  ).toHaveCount(2);
  await expect(exposureView).not.toContainText("USD ");
  expect(
    await exposureView
      .locator(".exposure-group__summary")
      .evaluateAll((summaries) =>
        summaries.every(
          (summary) => getComputedStyle(summary, "::after").content === "none",
        ),
      ),
  ).toBe(true);
  const targetHeights = await page
    .locator(
      ".investment-institutions .button:visible, .cash-holdings .button:visible, .position-row__action:visible",
    )
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  expect(targetHeights.every((height) => height >= 44)).toBe(true);
  const supportingFontSizes = await nvda
    .locator(
      ".exposure-group__totals small, .exposure-group__positions small, .position-row__action",
    )
    .evaluateAll((elements) =>
      elements.map((element) =>
        Number.parseFloat(window.getComputedStyle(element).fontSize),
      ),
    );
  expect(supportingFontSizes.every((size) => size >= 11)).toBe(true);
  const hasVisibleDecorativeBorder = await page
    .locator(
      [
        ".provider-agents",
        ".provider-agent-row__controls select",
        ".provider-agent-row__meta",
        ".cash-accounts",
        ".cash-holdings",
        ".investment-institutions",
        ".investment-institution-list",
        ".investment-institution",
        ".exposure-group",
        ".exposure-group__positions article",
        ".unallocated-positions",
      ].join(", "),
    )
    .evaluateAll((elements) =>
      elements.some((element) => {
        const styles = window.getComputedStyle(element);
        return ["Top", "Right", "Bottom", "Left"].some((side) => {
          const width = Number.parseFloat(
            styles.getPropertyValue(`border-${side.toLowerCase()}-width`),
          );
          const style = styles.getPropertyValue(
            `border-${side.toLowerCase()}-style`,
          );
          const color = styles.getPropertyValue(
            `border-${side.toLowerCase()}-color`,
          );
          return (
            width > 0 &&
            style !== "none" &&
            color !== "transparent" &&
            color !== "rgba(0, 0, 0, 0)"
          );
        });
      }),
    );
  expect(hasVisibleDecorativeBorder).toBe(false);
  await expectNoHorizontalOverflow(page);
  await page.addStyleTag({
    content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
  });
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "investment-holdings-exposures.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  const nvdaDetailAction = nvda
    .getByRole("button", {
      name: "View NVDA holding details",
    })
    .first();
  await nvdaDetailAction.click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "NVIDIA common stock",
    }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(nvdaDetailAction).toBeFocused();

  const cashDetailAction = cash
    .getByRole("button", {
      name: "View U S Dollar holding details",
    })
    .first();
  await cashDetailAction.click();
  await expect(
    page.getByRole("heading", { level: 2, name: "US Dollar" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Add value evidence" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Position return" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(cashDetailAction).toBeFocused();

  if (
    (await beacon
      .locator(".exposure-group__summary")
      .getAttribute("aria-expanded")) !== "true"
  ) {
    await beacon.locator(".exposure-group__summary").click();
  }
  const privateEstimateDetailAction = beaconEstimateRow.getByRole("button", {
    name: "View Synthetic Beacon SPV holding details",
  });
  await privateEstimateDetailAction.click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Beacon Robotics" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Position return" }),
  ).toBeVisible();
  await expect(page.getByText("Total return").locator("..")).toContainText(
    "+50.0%",
  );
  await expect(page.getByText("Day gain / loss")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Portfolio Watch estimate" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic GP portal").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-detail-portfolio-watch-estimate.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await page.getByRole("button", { name: "Review estimate" }).click();
  await expect(page.getByLabel("Value · USD")).toHaveValue("60000");
  await expect(page.getByLabel("Position value source type")).toContainText(
    "Other",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(privateEstimateDetailAction).toBeFocused();

  await openHoldingSources(page);
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

test("runs one due brokerage check after Holdings renders", async ({
  page,
}, testInfo) => {
  const robinhoodConnectionId = "11111111-1111-4111-8111-111111111111";
  const staleStatuses = statuses.map((status) =>
    status.connectionId === robinhoodConnectionId
      ? { ...status, lastSyncedAt: "2026-08-17T11:45:00.000Z" }
      : status,
  );
  let automaticRequestCount = 0;

  await page.unroute("**/api/investment-connections");
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: staleStatuses,
        errorCode: null,
      },
    });
  });
  await page.unroute("**/api/investment-connections/auto-sync");
  await page.route("**/api/investment-connections/auto-sync", async (route) => {
    automaticRequestCount += 1;
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: staleStatuses,
        errorCode: null,
      },
    });
  });

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);
  await expect(page.locator(".exposure-group")).toHaveCount(5);
  await openHoldingSources(page);

  const robinhoodCard = page
    .locator(".investment-institution")
    .filter({ hasText: "Robinhood" });
  await expect(robinhoodCard).toContainText(
    "Data as of Aug 15, 2026 · Checked Aug 17, 2026",
  );
  await expect.poll(() => automaticRequestCount).toBe(1);
  await page
    .getByRole("navigation", { name: "Holdings sections" })
    .getByRole("link", { name: "Holdings", exact: true })
    .click();
  await expect(page.locator(".exposure-group")).toHaveCount(5);
  await openHoldingSources(page);
  await expect(robinhoodCard).toBeVisible();
  expect(automaticRequestCount).toBe(1);
});

test("lets a failed brokerage check be retried", async ({ page }, testInfo) => {
  const robinhood = statuses[0]!;
  const interrupted = {
    ...robinhood,
    status: "needs_attention" as const,
    lastSyncedAt: new Date().toISOString(),
    latestRunStatus: "failed" as const,
    errorCode: "unexpected_failure" as const,
  };
  await page.unroute("**/api/investment-connections");
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: [interrupted],
        errorCode: null,
      },
    });
  });
  await page.route(
    `**/api/investment-connections/${robinhood.connectionId}/sync`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      await route.fulfill({ json: robinhood });
    },
  );

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);
  await openHoldingSources(page);
  const robinhoodCard = page
    .locator(".investment-institution")
    .filter({ hasText: "Robinhood" });
  const failedStatus = robinhoodCard.getByText("Check failed", { exact: true });
  await expect(failedStatus).toBeVisible();
  await expect(failedStatus).toHaveCSS("text-decoration-line", "none");
  await expect(
    robinhoodCard.getByText("We’ll try again later.", { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const retry = robinhoodCard.getByRole("button", { name: "Try now" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(
    robinhoodCard.getByText("Up to date", { exact: true }),
  ).toBeVisible();
});

test("automatically retries an old interrupted brokerage check once", async ({
  page,
}, testInfo) => {
  const robinhood = statuses[0]!;
  const failed = {
    ...robinhood,
    status: "needs_attention" as const,
    lastSyncedAt: null,
    latestRunStatus: "failed" as const,
    errorCode: "unexpected_failure" as const,
  };
  let automaticRequestCount = 0;
  await page.unroute("**/api/investment-connections");
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: [failed],
        errorCode: null,
      },
    });
  });
  await page.unroute("**/api/investment-connections/auto-sync");
  await page.route("**/api/investment-connections/auto-sync", async (route) => {
    automaticRequestCount += 1;
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: [robinhood],
        errorCode: null,
      },
    });
  });

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);
  await openHoldingSources(page);
  const robinhoodCard = page
    .locator(".investment-institution")
    .filter({ hasText: "Robinhood" });
  await expect(
    robinhoodCard.getByText("Up to date", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => automaticRequestCount).toBe(1);
});

test("opens a new Item flow for a disconnected brokerage", async ({
  page,
}, testInfo) => {
  let linkTokenRequests = 0;
  await page.addInitScript(() => {
    Object.assign(window, {
      Plaid: {
        create: ({ onExit }: { onExit: () => void }) => ({
          destroy: () => undefined,
          open: () => window.setTimeout(onExit, 0),
        }),
      },
    });
  });
  await page.route(
    "**/api/investment-connections/link-token",
    async (route) => {
      linkTokenRequests += 1;
      await route.fulfill({
        json: {
          linkToken: "link-synthetic-disconnected",
          expiration: "2026-08-18T12:30:00.000Z",
        },
      });
    },
  );

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);
  await openHoldingSources(page);
  const disconnectedCard = page.locator(".investment-institution").filter({
    hasText: "Synthetic Former Brokerage",
  });
  const connectAgain = disconnectedCard.getByRole("button", {
    name: "Connect again",
  });

  await connectAgain.click();

  await expect.poll(() => linkTokenRequests).toBe(1);
  await expect(connectAgain).toBeEnabled();
});

test("keeps a same-label disconnected Item when it has a reviewed account", async ({
  page,
}, testInfo) => {
  await page.unroute("**/api/investment-connections");
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: statuses.map((status) =>
          status.connectionId === "33333333-3333-4333-8333-333333333333"
            ? {
                ...status,
                institutionKey: "ins_fidelity_legacy",
                status: "disconnected" as const,
              }
            : status,
        ),
        errorCode: null,
      },
    });
  });

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);
  await openHoldingSources(page);

  const fidelityCards = page
    .locator(".investment-institution")
    .filter({ hasText: "Fidelity" });
  await expect(fidelityCards).toHaveCount(2);
  const disconnectedFidelity = fidelityCards.filter({
    hasText: "Disconnected",
  });
  await expect(disconnectedFidelity).toContainText("1 reviewed account");
  await expect(
    disconnectedFidelity.getByRole("button", { name: "Connect again" }),
  ).toBeVisible();
});

test("keeps reviewed history in exposures without showing fake brokerage accounts", async ({
  page,
}, testInfo) => {
  const reviewedHistoryView = reconciledReviewedHistoryInvestmentHoldingsView();
  const reviewedAlphaHoldings = alphaHoldingsFrom(reviewedHistoryView);
  const retainedPredecessor = {
    ...reviewedAlphaHoldings[0]!,
    id: "position_reviewed_history_retained_predecessor",
    positionName: "Demo Pharmacy retired predecessor",
    administratorNavMinor: 123_456,
  };
  await page.unroute("**/api/alpha");
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({
      json: {
        ...alphaFixture,
        holdings: [...reviewedAlphaHoldings, retainedPredecessor],
      },
    });
  });
  await page.unroute("**/api/investment-connections");
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: [],
        errorCode: null,
      },
    });
  });
  await page.unroute("**/api/investment-holdings");
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: reviewedHistoryView });
  });
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: reviewedAlphaHoldings,
    investmentHoldings: reviewedHistoryView,
    acceptedCashAccounts,
    pendingImports: [],
  });

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);
  await openHoldingSources(page);

  const accounts = page.locator(".investment-institutions");
  await expect(accounts.locator(".investment-institution")).toHaveCount(0);
  await expect(accounts).not.toContainText("AngelList reviewed history");
  await expect(accounts).not.toContainText("Original account details");
  await expectNoHorizontalOverflow(page);
  await page
    .getByRole("navigation", { name: "Holdings sections" })
    .getByRole("link", { name: "Holdings", exact: true })
    .click();

  const exposureView = page.locator(".investment-views");
  await expect(exposureView.getByRole("tab")).toHaveCount(0);
  await expect(
    exposureView.locator(".investment-views__heading"),
  ).toContainText("1 exposure");
  await expect(
    exposureView.locator(".investment-views__heading"),
  ).toContainText("14 legal positions");
  const exposure = page.locator(".exposure-group").filter({
    has: page.getByText("Demo Pharmacy", { exact: true }),
  });
  await expect(page.locator(".exposure-group")).toHaveCount(1);
  await expect(exposure).toContainText("14 positions");
  await exposure.locator(".exposure-group__summary").click();
  await expect(
    exposure.locator(".exposure-group__positions article"),
  ).toHaveCount(14);
  await expect(exposure).toContainText("Demo Pharmacy SPV 01");
  await expect(exposure).toContainText("Demo Pharmacy SPV 14");
  await expect(exposureView).not.toContainText(
    "Demo Pharmacy retired predecessor",
  );
  await expect(exposure).not.toContainText("Demo Family holding");
  await expect(exposure).not.toContainText("AngelList reviewed history");
  const positionActions = exposure.getByRole("button", {
    name: /View Demo Pharmacy SPV \d+ holding details/,
  });
  await expect(positionActions).toHaveCount(14);
  await expectNoHorizontalOverflow(page);

  const firstPositionAction = positionActions.first();
  await firstPositionAction.click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Demo Pharmacy",
      exact: true,
    }),
  ).toBeFocused();
  await expect(page.getByText("Via Demo Pharmacy SPV 01")).toBeVisible();
  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(firstPositionAction).toBeFocused();
});

test("keeps one reviewed-history legal position without a fake account", async ({
  page,
}, testInfo) => {
  const reviewedHistoryView =
    reconciledReviewedHistoryInvestmentHoldingsView(1);
  await page.unroute("**/api/alpha");
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({
      json: {
        ...alphaFixture,
        holdings: alphaHoldingsFrom(reviewedHistoryView),
      },
    });
  });
  await page.unroute("**/api/investment-connections");
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: [],
        errorCode: null,
      },
    });
  });
  await page.unroute("**/api/investment-holdings");
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: reviewedHistoryView });
  });
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaHoldingsFrom(reviewedHistoryView),
    investmentHoldings: reviewedHistoryView,
    acceptedCashAccounts,
    pendingImports: [],
  });

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  await openHoldingSources(page);
  await expect(page.locator(".investment-institution")).toHaveCount(0);
  await expect(page.locator(".investment-institutions")).not.toContainText(
    "AngelList reviewed history",
  );
  await page
    .getByRole("navigation", { name: "Holdings sections" })
    .getByRole("link", { name: "Holdings", exact: true })
    .click();
  const exposure = page.locator(".exposure-group").filter({
    has: page.getByText("Demo Pharmacy", { exact: true }),
  });
  await expect(exposure).toContainText("1 position");
  await exposure.locator(".exposure-group__summary").click();
  await expect(
    exposure.getByRole("button", {
      name: "View Demo Pharmacy SPV 01 holding details",
    }),
  ).toBeVisible();
});

test("keeps failed canonical holdings out of view and retries", async ({
  page,
}) => {
  let holdingsRequestCount = 0;
  await page.unroute("**/api/holdings-page");
  await page.route("**/api/holdings-page", async (route) => {
    holdingsRequestCount += 1;
    if (holdingsRequestCount === 1) {
      await route.fulfill({
        status: 503,
        json: { error: "Reviewed holdings are temporarily unavailable." },
      });
      return;
    }
    await route.fulfill({
      json: {
        version: 1,
        shell: {
          householdName: alphaFixture.dashboard.householdName,
          pendingEvidenceCount: 0,
        },
        holdings: alphaFixture.holdings,
        investmentHoldings: holdingsView,
        acceptedCashAccounts,
        pendingImports: [],
      },
    });
  });
  await page.goto("/holdings");
  await expect.poll(() => holdingsRequestCount).toBe(1);

  const errorState = page.locator(".investment-views");
  await expect(errorState.getByRole("alert")).toContainText(
    "Reviewed holdings are temporarily unavailable.",
  );
  await expect(
    errorState.locator(".investment-views__heading > span"),
  ).toHaveCount(0);
  await expect(errorState.locator(".exposure-groups")).toHaveCount(0);
  await expect(errorState.locator(".unallocated-positions")).toHaveCount(0);
  await expect(
    errorState.getByText("Exposure unresolved", { exact: true }),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expect(errorState).toHaveScreenshot(
    "investment-holdings-retry-error.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await errorState.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => holdingsRequestCount).toBe(2);
  await expect(errorState.getByRole("alert")).toHaveCount(0);
  const nvda = errorState.locator(".exposure-group").filter({
    has: page.locator(
      '.exposure-group__summary strong[title="NVIDIA common stock"]',
    ),
  });
  await expect(nvda).toContainText("3 positions");
  await expect(errorState.locator(".unallocated-positions")).not.toContainText(
    "NVDA",
  );
});

test("progressively renders long exposure lists", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
  });
  await page.unroute("**/api/alpha");
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({
      json: {
        ...alphaFixture,
        holdings: paginatedHoldings,
      },
    });
  });
  await page.unroute("**/api/investment-holdings");
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: paginatedHoldingsView });
  });
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: paginatedHoldings,
    investmentHoldings: paginatedHoldingsView,
    acceptedCashAccounts,
    pendingImports: [],
  });

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  const exposureView = page.locator(".investment-views");
  await expect(exposureView.locator(".exposure-group")).toHaveCount(12);
  await expect(exposureView.locator(".exposure-pagination")).toContainText(
    "Showing 12 of 25 exposures",
  );
  const lowestExposureName = exposureView
    .locator(".exposure-group__summary")
    .getByText("DMO1", { exact: true });
  await expect(lowestExposureName).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { display: none !important; }",
  });
  await expect(page.locator(".topbar")).toHaveCSS("display", "none");
  await expect(exposureView).toHaveScreenshot(
    "investment-holdings-paginated-exposures.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await exposureView
    .getByRole("button", { name: "Load more exposures" })
    .click();
  await expect(exposureView.locator(".exposure-group")).toHaveCount(24);
  await expect(exposureView.locator(".exposure-pagination")).toContainText(
    "Showing 24 of 25 exposures",
  );
  await exposureView
    .getByRole("button", { name: "Load more exposures" })
    .click();
  await expect(exposureView.locator(".exposure-group")).toHaveCount(25);
  await expect(lowestExposureName).toBeVisible();
  await expect(exposureView.locator(".exposure-pagination")).toHaveCount(0);
});

test("searches holdings by SPV and hidden cash while preserving totals and return navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const reviewsLoaded = page.waitForResponse("**/api/private-exposure-reviews");
  await page.goto("/holdings");
  await reviewsLoaded;
  const search = page.getByRole("searchbox", { name: "Search holdings" });
  await expect(page.locator(".exposure-group")).toHaveCount(5);
  const total = (await page.locator(".investment-views__total").textContent())!;
  const cashTotal = (await page
    .locator(".cash-holdings__total")
    .textContent())!;
  const requests: string[] = [];
  const recordRequest = (request: Request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url());
  };
  page.on("request", recordRequest);
  await search.fill("  BEACON, spv ");
  const group = page.locator(".exposure-group");
  await expect(group).toHaveCount(1);
  await expect(group).toContainText("Beacon Robotics");
  await expect(group).toContainText("1 matching position · 2 total");
  await expect(group.locator(".exposure-group__positions article")).toHaveCount(
    1,
  );
  await expect(group.locator(".exposure-group__value")).toHaveText("$120k");
  await expect(page.locator(".investment-views__total")).toHaveText(total);
  await expect(group.locator("mark").first()).toHaveText("Beacon");
  expect(requests).toEqual([]);
  page.off("request", recordRequest);
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot("investment-holdings-search-spv.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  });
  await group
    .getByRole("button", { name: "View Synthetic Beacon SPV holding details" })
    .click();
  await page
    .getByRole("button", { name: "Back to holdings", exact: true })
    .click();
  await expect(search).toHaveValue("  BEACON, spv ");
  await expect(
    group.getByRole("button", {
      name: "View Synthetic Beacon SPV holding details",
    }),
  ).toBeFocused();
  await search.fill("nvidia");
  await expect(page.locator(".exposure-group")).toHaveCount(1);
  await expect(page.locator(".exposure-group")).toContainText("NVDA");
  await expect(page.locator(".exposure-group")).toContainText(
    "NVIDIA common stock",
  );
  await search.fill("Travel cash");
  await expect(
    page.locator(".cash-holdings").getByText("Travel cash", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cash-holdings__total")).toHaveText(cashTotal);
  await search.fill("no-such-synthetic-holding");
  await expect(
    page.getByRole("heading", { name: "No matching holdings" }),
  ).toBeVisible();
  await expect(page.locator(".holdings-search [role=status]")).toHaveText(
    "0 results",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot("investment-holdings-search-empty.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  });
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(page.locator(".exposure-group")).toHaveCount(5);
  await expect(page.locator(".investment-views__total")).toHaveText(total);
  await expect(
    page.locator(".cash-holdings").getByText("Travel cash", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const size of [120, 1_000]) {
  test(`searches all ${size} holdings before pagination with zero additional projection reads`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() =>
      Object.defineProperty(window, "IntersectionObserver", {
        configurable: true,
        value: undefined,
      }),
    );
    const scaleHoldings = Array.from({ length: size }, (_, index) => ({
      ...paginatedHoldings[0]!,
      id: `position_search_${index}`,
      positionName:
        index === 0 ? "Café Nebula Series A" : `Demo Security ${index}`,
      exposureName: index === 0 ? "Café Nebula" : `Demo Exposure ${index}`,
      ticker: index === 0 ? "NEB1" : `DMO${index}`,
      administratorNavMinor: (index + 1) * 10_000,
    }));
    const scaleView = investmentHoldingsViewFor(scaleHoldings);
    let projectionReads = 0;
    await routeHoldingsPage(page, () => {
      projectionReads += 1;
      return {
        householdName: "Demo Household",
        holdings: scaleHoldings,
        investmentHoldings: scaleView,
        acceptedCashAccounts: [],
        pendingImports: [],
      };
    });
    await page.goto("/holdings");
    await expect(page.locator(".exposure-group")).toHaveCount(12);
    await expect(
      page.locator(".exposure-group").getByText("NEB1", { exact: true }),
    ).toHaveCount(0);
    const search = page.getByRole("searchbox", { name: "Search holdings" });
    await search.fill(" CAFE — nebula ");
    await expect(page.locator(".exposure-group")).toHaveCount(1);
    await expect(page.locator(".exposure-group")).toContainText("NEB1");
    await expect(page.locator(".holdings-search [role=status]")).toHaveText(
      "1 exposure · 1 position",
    );
    await expect(page.locator(".exposure-group mark").first()).toHaveText(
      "Café",
    );
    await search.fill("Robinhood");
    await expect(page.locator(".exposure-group")).toHaveCount(12);
    await expect(
      page.locator(".exposure-group__positions article"),
    ).toHaveCount(12);
    await expect(page.locator(".holdings-search [role=status]")).toHaveText(
      `${size} exposures · ${size} positions`,
    );
    expect(projectionReads).toBe(1);
    await search.fill("NEB1");
    await expect(page.locator(".exposure-group")).toHaveCount(1);
    expect(projectionReads).toBe(1);
    await expectNoHorizontalOverflow(page);
    const timings = await page.evaluate(async (data) => {
      const moduleUrl = "/src/collection-search.ts";
      const { buildHoldingsSearchIndex, searchHoldings } = (await import(
        moduleUrl
      )) as typeof CollectionSearch;
      const buildStart = performance.now();
      const index = buildHoldingsSearchIndex(data, []);
      const buildMs = performance.now() - buildStart;
      const durations: number[] = [];
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const started = performance.now();
        searchHoldings(
          index,
          ["cafe nebula", "Robinhood", "no matching record"][attempt % 3]!,
        );
        durations.push(performance.now() - started);
      }
      durations.sort((left, right) => left - right);
      return {
        buildMs,
        p95SearchMs: durations[56],
        maxSearchMs: durations.at(-1),
      };
    }, scaleView);
    await testInfo.attach(`holdings-search-${size}-timings.json`, {
      body: JSON.stringify(timings),
      contentType: "application/json",
    });
    expect(timings.p95SearchMs).toBeLessThan(50);
  });
}

test("search bounds positions within a single large exposure and preserves the loaded batch on return", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    }),
  );
  const positions = Array.from({ length: 120 }, (_, index) => ({
    ...paginatedHoldings[0]!,
    id: `position_search_group_${index}`,
    companyId: "company_search_nebula",
    positionName: `Demo Nebula SPV ${String(index).padStart(3, "0")}`,
    exposureName: "Demo Nebula",
    ticker: null,
    sourceLabel: "Synthetic venture export",
  }));
  const view = investmentHoldingsViewFor(positions);
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: positions,
    investmentHoldings: view,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.goto("/holdings");
  await page.getByRole("searchbox", { name: "Search holdings" }).fill("nebula");
  await expect(page.locator(".exposure-group__positions article")).toHaveCount(
    25,
  );
  await page
    .getByRole("button", { name: "Load more Demo Nebula positions" })
    .click();
  await expect(page.locator(".exposure-group__positions article")).toHaveCount(
    50,
  );
  const target = page.getByRole("button", {
    name: "View Demo Nebula SPV 049 holding details",
  });
  await target.click();
  await page
    .getByRole("button", { name: "Back to holdings", exact: true })
    .click();
  await expect(page.locator(".exposure-group__positions article")).toHaveCount(
    50,
  );
  await expect(target).toBeFocused();
});
