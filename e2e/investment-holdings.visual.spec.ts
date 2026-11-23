import { expect, test, type Page, type Request } from "./api-mocked-test";
import type * as CollectionSearch from "../apps/web/src/collection-search";
import type { Holding } from "../packages/domain/src/index";
import type { InvestmentHoldingsView } from "../packages/domain/src/investment-holdings-view";
import { createInvestmentExposureView } from "../packages/domain/src/exposure-read-model";

import {
  alphaHoldingsFrom,
  emptyInvestmentHoldingsView,
  investmentHoldingsViewFor,
  multiInstitutionInvestmentHoldingsView,
} from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { routeCollectionSearchModule } from "./collection-search-module";

const captureDesignVariants = process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1";

async function captureDesignReview(
  page: Page,
  filename: string,
  selector?: string,
) {
  if (captureDesignVariants) {
    const options = {
      path: test.info().outputPath(filename),
      animations: "disabled" as const,
      scale: "css" as const,
    };
    if (selector)
      await page.locator(selector).screenshot({
        ...options,
        style: ".topbar, .mobile-nav { visibility: hidden !important; }",
      });
    else await page.screenshot({ ...options, fullPage: true });
  }
}

async function openHoldingSources(page: Page) {
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(page).toHaveURL(/\/holdings\/sources$/u);
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
}

const holdingsView = multiInstitutionInvestmentHoldingsView();

const searchHolding: Holding = {
  id: "position_paginated_01",
  companyId: null,
  positionName: "Demo Security 01",
  exposureName: "Demo Exposure 01",
  ownerLabel: "Demo Brokerage",
  positionKind: "direct",
  administratorNavMinor: 10_000,
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
  ticker: "DMO1",
  quantityMicros: 1_000_000,
  costBasisMinor: null,
};

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

async function expectExposureSummaryLayout(page: Page, mobile: boolean) {
  const geometry = await page
    .locator(".investment-views")
    .evaluate((section) => {
      const bounds = (selector: string) => {
        const { top, bottom, left, right, width, height } = section
          .querySelector(selector)!
          .getBoundingClientRect();
        return { top, bottom, left, right, width, height };
      };
      return {
        heading: bounds(".investment-views__heading > div:first-child"),
        header: bounds(".investment-views__heading"),
        total: bounds(".investment-views__total"),
        sort: bounds(".exposure-sort"),
      };
    });
  if (mobile) {
    expect(geometry.total.top).toBeGreaterThanOrEqual(geometry.heading.bottom);
    expect(geometry.total.left).toBe(geometry.heading.left);
  } else {
    expect(geometry.total.left).toBeGreaterThanOrEqual(geometry.heading.right);
    expect(geometry.total.top).toBeLessThan(geometry.heading.bottom);
    expect(geometry.total.right).toBe(geometry.header.right);
  }
  expect(geometry.sort.top).toBeGreaterThanOrEqual(geometry.header.bottom);
  // Keep the order control compact without sacrificing a mobile touch target.
  expect(geometry.sort.width).toBeLessThanOrEqual(100);
  expect(geometry.sort.height).toBeGreaterThanOrEqual(44);
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

test(
  "groups reviewed public stock with separate SPVs and keeps their value bases",
  { tag: "@mobile-only" },
  async ({ page }) => {
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
      syntheticHolding(
        "position_nstr_spv_a",
        "Northstar SPV A",
        2_000_000,
        null,
      ),
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
    await expect(group).toContainText("1 value awaiting valuation");
    await expect(group).toContainText("$36,000");
    await expect(
      group.getByRole("link", {
        name: /Group with company|Review company link/u,
      }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await captureDesignReview(page, "review-mixed-company.png");
    await expect(group).toHaveScreenshot("public-private-company-group.png", {
      animations: "disabled",
      caret: "hide",
    });
  },
);

test(
  "shows the Holdings shell while one read-only projection loads",
  { tag: "@mobile-only" },
  async ({ page }) => {
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
    expect(apiRequests.filter((request) => request.method !== "GET")).toEqual(
      [],
    );
  },
);

test(
  "shows compact empty exposure and account states",
  { tag: "@desktop-only" },
  async ({ page }) => {
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
    await page.route(
      "**/api/investment-connections/auto-sync",
      async (route) => {
        expect(route.request().method()).toBe("POST");
        await route.fulfill({ json: emptyConnectionState });
      },
    );
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
        name: "Your holdings, in one place",
      }),
    ).toBeVisible();
    await expect(
      exposureView.locator('[data-slot="empty-state"] > span'),
    ).toHaveCount(0);
    await expect(
      exposureView.getByRole("link", { name: "Manage sources" }),
    ).toHaveAttribute("href", "/holdings/sources");
    await expectNoHorizontalOverflow(page);
    await captureDesignReview(page, "review-empty-holdings.png");
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
    const empty = page
      .locator(".investment-institution")
      .filter({ hasText: "Demo Empty Brokerage" });
    await empty.locator(".investment-institution__trigger").click();
    await expect(
      empty.getByRole("heading", { name: "No reviewed accounts yet." }),
    ).toBeVisible();
  },
);

test("keeps valued positions in the total before exposure assignment", async ({
  page,
}) => {
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaFixture.holdings,
    investmentHoldings: {
      ...holdingsView,
      exposureView: createInvestmentExposureView(
        holdingsView.positionView,
        [],
        [],
      ),
    },
    acceptedCashAccounts,
    pendingImports: [],
  });
  await page.goto("/holdings");
  const total = page.locator(".investment-views__total");
  await expect(total.locator(".stat__label")).toHaveText("Known total");
  await expect(total.locator(".stat__detail")).toHaveText(
    "7 exposures · 7 positions",
  );
  await expect(total.locator(".stat__value")).toHaveText("$890,000");
  await expect(
    page.getByRole("tab", { name: "All exposures" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".exposure-group")).toHaveCount(7);
  await page.getByRole("tab", { name: "Needs resolution (2)" }).click();
  await expect(page.locator(".unallocated-positions article")).toHaveCount(2);
  await captureDesignReview(
    page,
    "review-exposures-no-total.png",
    ".investment-views",
  );
});

test("operates multiple institutions from one exposure-first holdings view", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chromium";
  await page.goto("/holdings");
  const exposureView = page.locator(".investment-views");
  const total = exposureView.locator(".investment-views__total");
  await expect(total.locator(".stat__label")).toHaveText("Known total");
  await expect(total.locator(".stat__value")).toHaveText("$950,000");
  await expect(total.locator(".stat__detail")).toHaveText(
    "4 exposures · 7 positions",
  );
  await expect(exposureView.locator(".exposure-group")).toHaveCount(4);
  await expectExposureSummaryLayout(page, mobile);
  const rows = exposureView.getByRole("list", { name: "Company exposures" });
  await expect(rows.locator(".exposure-group__summary").nth(0)).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(rows.locator(".exposure-group__summary").nth(1)).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  const allTab = exposureView.getByRole("tab", { name: "All exposures" });
  const reviewTab = exposureView.getByRole("tab", {
    name: "Needs resolution (1)",
  });
  const allPanel = exposureView.getByRole("tabpanel", {
    name: "All exposures",
  });
  const review = exposureView.getByRole("tabpanel", {
    name: /^Needs resolution/u,
  });
  const sort = allPanel.getByRole("button", {
    name: /^Sort exposures and positions by value/u,
  });
  await expect(allTab).toHaveAttribute("aria-selected", "true");
  await expect(sort).toBeVisible();
  await expect(review).toBeHidden();
  await captureDesignReview(
    page,
    "review-exposures-closed.png",
    ".investment-views",
  );
  if (!mobile) {
    await allTab.press("ArrowRight");
    await expect(reviewTab).toBeFocused();
    await expect(allTab).toHaveAttribute("aria-selected", "true");
    await reviewTab.press("Enter");
  } else {
    await reviewTab.click();
  }
  await expect(reviewTab).toHaveAttribute("aria-selected", "true");
  await expect(rows).toBeHidden();
  await expect(sort).toBeHidden();
  await expect(total.locator(".stat__detail")).toHaveText(
    "4 exposures · 7 positions",
  );
  const unresolvedRow = review
    .locator("article")
    .filter({ hasText: "Horizon" });
  await expect(review.locator("article")).toHaveCount(1);
  await expect(unresolvedRow).toContainText("Awaiting valuation");
  await expect(unresolvedRow).not.toContainText(/Basis|total return|\$0/u);
  await captureDesignReview(
    page,
    "review-needs-resolution.png",
    ".investment-views",
  );
  const unresolvedDetail = review.getByRole("link", {
    name: "View Synthetic Horizon SPV holding details",
  });
  await expect(unresolvedDetail).toHaveText("");
  await expect(unresolvedDetail).toHaveAttribute(
    "href",
    "/holdings?position=position_locked_spv_5",
  );
  const navigationTarget = await unresolvedDetail.boundingBox();
  const positionRow = await unresolvedDetail.locator("..").boundingBox();
  expect(navigationTarget!.width).toBeGreaterThanOrEqual(
    positionRow!.width - 2,
  );
  expect(navigationTarget!.height).toBeGreaterThanOrEqual(
    Math.max(44, positionRow!.height - 2),
  );
  await unresolvedDetail.press("Enter");
  await expect(page).toHaveURL(/\?position=position_locked_spv_5$/u);
  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(unresolvedDetail).toBeFocused();
  await expect(reviewTab).toHaveAttribute("aria-selected", "true");
  const holdingsSearch = page.getByRole("searchbox", {
    name: "Search holdings",
  });
  await holdingsSearch.fill("NVDA");
  await expect(
    review.getByText("No matching positions", { exact: true }),
  ).toBeVisible();
  await holdingsSearch.fill("Horizon");
  await expect(unresolvedRow).toBeVisible();
  await holdingsSearch.clear();
  await allTab.click();
  const nvda = exposureView.locator(".exposure-group").filter({
    has: page.locator(
      '.exposure-group__summary strong[title="NVIDIA common stock"]',
    ),
  });
  await nvda.locator(".exposure-group__summary").click();
  await expect(nvda).toContainText("3 positions");
  await expect(nvda.locator(".exposure-group__totals")).toContainText(
    "$740,000",
  );
  await expect(
    nvda.getByText("Robinhood brokerage", { exact: true }),
  ).toBeVisible();
  await expect(
    nvda.getByText("Fidelity brokerage", { exact: true }),
  ).toBeVisible();
  await expect(
    nvda.getByText("Fidelity rollover IRA", { exact: true }),
  ).toBeVisible();
  for (const account of [
    "Fidelity rollover IRA",
    "Fidelity brokerage",
    "Robinhood brokerage",
  ]) {
    await expect(
      nvda.getByRole("link", {
        name: `View NVDA holding details in ${account}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  if (!mobile) {
    await sort.focus();
    await sort.press("Space");
    await expect(nvda.locator(".position-row__value")).toContainText([
      "$185,000",
      "$240,000",
      "$315,000",
    ]);
    await sort.press("Enter");
    await expect(nvda.locator(".position-row__value")).toContainText([
      "$315,000",
      "$240,000",
      "$185,000",
    ]);
    await expect(sort).toBeFocused();
  }
  await expect(page.locator(".cash-holdings")).toContainText(
    "Total cash$28,550.00",
  );
  const harbor = page.locator(".exposure-group").filter({
    has: page.getByText("Harbor Health Systems", { exact: true }),
  });
  await harbor.locator(".exposure-group__summary").click();
  await expect(harbor.getByText("Synthetic Horizon SPV")).toBeVisible();
  await expect(harbor.locator(".position-row__value")).toHaveText(
    "Awaiting valuation",
  );
  const fund = page
    .locator(".exposure-group")
    .filter({ has: page.getByText("SYNF", { exact: true }) });
  await expect(fund.locator(".exposure-group__value")).toHaveText("$90,000");
  await fund.locator(".exposure-group__summary").click();
  await expect(fund.locator(".position-row__value")).toHaveText("$90,000");
  await expect(
    fund.getByRole("link", {
      name: "View SYNF holding details in Fidelity brokerage",
    }),
  ).toBeVisible();
  await expect(total.locator(".stat__value")).toHaveText("$950,000");
  await captureDesignReview(
    page,
    "review-whole-position-value.png",
    '[data-exposure-id="position:position_synthetic_fund_4"]',
  );
  const beacon = page.locator(".exposure-group").filter({
    has: page.getByText("Beacon Robotics", { exact: true }),
  });
  await expect(beacon.locator(".exposure-group__summary")).toContainText(
    "$120,000",
  );
  await expect(beacon.locator(".exposure-group__summary")).toContainText(
    "1 estimate",
  );
  await beacon.locator(".exposure-group__summary").click();
  await expect(beacon.getByText("Synthetic Beacon SPV")).toBeVisible();
  await expect(beacon.locator(".position-row__value")).toContainText([
    "$60,000",
    "$60,000",
  ]);
  const beaconEstimateRow = beacon.locator("article").filter({
    hasText: "Synthetic Beacon SPV",
  });
  await expect(
    beaconEstimateRow.locator(".position-row__value"),
  ).toHaveAttribute("title", "Portfolio Watch estimate as of Aug 15, 2026");
  await expect(beaconEstimateRow).not.toContainText("%");
  await expect(beaconEstimateRow).toContainText("Watch estimate");
  await expect(
    beaconEstimateRow.getByText("Demo Family LLC", { exact: true }),
  ).toBeVisible();
  expect(
    await beaconEstimateRow
      .locator(".record-row__title, .record-row__detail")
      .evaluateAll((items) =>
        items.every((item) => {
          const identity = item.parentElement!.getBoundingClientRect();
          const text = document.createRange();
          text.selectNodeContents(item);
          return [...text.getClientRects()].every(
            (line) =>
              line.right <= identity.right + 1 &&
              line.bottom <= identity.bottom + 1,
          );
        }),
      ),
  ).toBe(true);
  expect(
    await beaconEstimateRow
      .locator(".position-row__value small")
      .evaluate((element) => element.getClientRects().length),
  ).toBe(1);
  await expect(beacon).not.toContainText("/sh");
  await expect(review).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await captureDesignReview(
    page,
    "review-exposures-open.png",
    ".investment-views",
  );
  await page.addStyleTag({
    content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
  });
  const horizonIdentity = page
    .locator(".record-row__identity")
    .filter({ hasText: "Synthetic Horizon SPV" });
  await expect(horizonIdentity).toContainText("Demo Family LLC");
  await expect
    .poll(() =>
      horizonIdentity.evaluate((identity) => {
        const box = identity.getBoundingClientRect();
        return [...identity.children].every(
          (item) => item.getBoundingClientRect().bottom <= box.bottom + 1,
        );
      }),
    )
    .toBe(true);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "investment-holdings-exposures.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  if (!mobile) {
    const detail = nvda.getByRole("link", {
      name: "View NVDA holding details in Fidelity rollover IRA",
      exact: true,
    });
    const selectedPositionId = (await detail.getAttribute("data-holding-id"))!;
    const publicExposure = holdingsView.exposureView.exposures.find(
      (group) =>
        group.exposure.exposureKind === "public_instrument" &&
        group.contributions.some(
          (item) => item.positionId === selectedPositionId,
        ),
    )!;
    await detail.click();
    await expect(
      page.getByRole("heading", { level: 2, name: "NVIDIA common stock" }),
    ).toBeFocused();
    const grouping = page.getByRole("group", {
      name: "Company grouping",
      exact: true,
    });
    await expect(grouping).toContainText(
      "Applies to all 3 positions in this security.",
    );
    await expect(
      grouping.getByRole("link", { name: "Group with company" }),
    ).toHaveAttribute(
      "href",
      `/holdings/entities?companies=1&public=${encodeURIComponent(publicExposure.exposure.id)}&returnPosition=${encodeURIComponent(selectedPositionId)}`,
    );
    await page.getByRole("button", { name: "Back to holdings" }).click();
    await expect(detail).toBeFocused();
    return;
  }
  const privateEstimateDetailAction = beaconEstimateRow.getByRole("link", {
    name: "View Synthetic Beacon SPV holding details",
  });
  await privateEstimateDetailAction.click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Beacon Robotics" }),
  ).toBeFocused();
  await expect(
    page.getByRole("group", { name: "Company grouping", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Position summary" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Position summary" })
      .getByText("Total return"),
  ).toHaveCount(0);
  await expect(page.getByText("Day gain / loss")).toHaveCount(0);
  await page
    .getByRole("button", { name: /Ownership, sources & history/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Portfolio Watch estimate" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic GP portal").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(privateEstimateDetailAction).toBeFocused();
});

test(
  "runs one due brokerage check after Holdings renders",
  { tag: "@desktop-only" },
  async ({ page }) => {
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
    await page.route(
      "**/api/investment-connections/auto-sync",
      async (route) => {
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
      },
    );

    await page.goto("/holdings");
    await expect(page.locator(".exposure-group")).toHaveCount(4);
    await openHoldingSources(page);

    const robinhoodCard = page
      .locator(".investment-institution")
      .filter({ hasText: "Robinhood" });
    await expect(robinhoodCard).toContainText(
      "Latest report Aug 15, 2026 · Checked Aug 17, 2026",
    );
    await expect.poll(() => automaticRequestCount).toBe(1);
    await page
      .getByRole("navigation", { name: "Holdings sections" })
      .getByRole("link", { name: "Holdings", exact: true })
      .click();
    await expect(page.locator(".exposure-group")).toHaveCount(4);
    await openHoldingSources(page);
    await expect(robinhoodCard).toBeVisible();
    expect(automaticRequestCount).toBe(1);
    await robinhoodCard.locator(".investment-institution__trigger").click();
    await robinhoodCard
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    const warning = robinhoodCard.getByText(
      "Provider access will be removed. Reviewed history stays in Keel.",
    );
    await expect(warning).toBeVisible();
    await robinhoodCard.getByRole("button", { name: "Keep connected" }).click();
    await expect(warning).toHaveCount(0);
  },
);

test(
  "keeps failed canonical holdings out of view and retries",
  { tag: captureDesignVariants ? [] : "@desktop-only" },
  async ({ page, isMobile }) => {
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
    await expect(errorState.locator(".investment-views__total")).toHaveCount(0);
    await expect(errorState.locator(".exposure-groups")).toHaveCount(0);
    await expect(errorState.locator(".unallocated-positions")).toHaveCount(0);
    await expect(
      errorState.getByText("Exposure unresolved", { exact: true }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await captureDesignReview(page, "review-unavailable-holdings.png");
    if (!isMobile)
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
    const nvda = errorState.locator(".exposure-group").filter({
      has: page.locator(
        '.exposure-group__summary strong[title="NVIDIA common stock"]',
      ),
    });
    await expect(nvda).toContainText("3 positions");
    await expect(errorState.getByRole("alert")).toHaveCount(0);
    await errorState.getByRole("tab", { name: /^Needs resolution/u }).click();
    await expect(
      errorState
        .getByRole("tabpanel", { name: /^Needs resolution/u })
        .getByText("NVDA", { exact: true }),
    ).toHaveCount(0);
  },
);

test(
  "searches holdings by SPV and hidden cash while preserving totals and return navigation",
  { tag: "@desktop-only" },
  async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const reviewsLoaded = page.waitForResponse(
      "**/api/private-exposure-reviews",
    );
    await page.goto("/holdings");
    await reviewsLoaded;
    const search = page.getByRole("searchbox", { name: "Search holdings" });
    await expect(page.locator(".exposure-group")).toHaveCount(4);
    const total = (await page
      .locator(".investment-views__total")
      .textContent())!;
    const cashTotal = (await page
      .locator(".cash-holdings__total")
      .textContent())!;
    await captureDesignReview(page, "review-overview.png");
    const requests: string[] = [];
    const recordRequest = (request: Request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push(request.url());
    };
    page.on("request", recordRequest);
    await search.fill("  BEACON, spv ");
    const group = page.locator(".exposure-group");
    await expect(group).toHaveCount(1);
    await expect(group.locator(".exposure-group__summary")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(group).toContainText("Beacon Robotics");
    await expect(group).toContainText("1 matching position · 2 total");
    await expect(
      group.locator(".exposure-group__positions article"),
    ).toHaveCount(1);
    await expect(group.locator(".exposure-group__value")).toHaveText(
      "$120,000",
    );
    await expect(page.locator(".investment-views__total")).toHaveText(total);
    await expect(group.locator("mark").first()).toHaveText("Beacon");
    expect(requests).toEqual([]);
    page.off("request", recordRequest);
    await expectNoHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await captureDesignReview(page, "review-search-match.png");
    await expect(page).toHaveScreenshot("investment-holdings-search-spv.png", {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
    });
    await group
      .getByRole("link", {
        name: "View Synthetic Beacon SPV holding details",
      })
      .click();
    await page
      .getByRole("button", { name: "Back to holdings", exact: true })
      .click();
    await expect(search).toHaveValue("  BEACON, spv ");
    await expect(
      group.getByRole("link", {
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
      page
        .locator(".cash-holdings__account-summary")
        .filter({ hasText: "Travel cash" }),
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
    await captureDesignReview(page, "review-search-empty.png");
    // The previous full-page SPV comparison owns the desktop navigation. Compare
    // the empty result and page header without rechecking the sticky sidebar.
    if (testInfo.project.name === "chromium") {
      const main = page.getByRole("main");
      expect(await main.boundingBox()).toEqual({
        x: 224,
        y: 0,
        width: 1056,
        height: 720,
      });
      await expect(main).toHaveScreenshot(
        "investment-holdings-search-empty.png",
        {
          animations: "disabled",
          caret: "hide",
        },
      );
    } else {
      await expect(page).toHaveScreenshot(
        "investment-holdings-search-empty.png",
        {
          animations: "disabled",
          caret: "hide",
          fullPage: true,
        },
      );
    }
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(page.locator(".exposure-group")).toHaveCount(4);
    await expect(page.locator(".investment-views__total")).toHaveText(total);
    await expect(
      page
        .locator(".cash-holdings__account-summary")
        .filter({ hasText: "Travel cash" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  },
);

// The 120/1,000 search matrix runs in collection-search.test.ts. Keep the
// larger browser case for DOM bounds, projection reads, highlights and p95.
for (const size of [1_000]) {
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
      ...searchHolding,
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
    const moduleUrl = await routeCollectionSearchModule(page);
    const timings = await page.evaluate(
      async ({ data, moduleUrl }) => {
        const { buildHoldingsSearchIndex, searchHoldings } = (await import(
          moduleUrl
        )) as typeof CollectionSearch;
        const buildStart = performance.now();
        const index = buildHoldingsSearchIndex(data, []);
        const buildMs = performance.now() - buildStart;
        const durations: number[] = [];
        const resultLabels: string[] = [];
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const started = performance.now();
          const matches = searchHoldings(
            index,
            ["cafe nebula", "Robinhood", "no matching record"][attempt % 3]!,
          );
          durations.push(performance.now() - started);
          resultLabels.push(matches!.resultLabel);
        }
        durations.sort((left, right) => left - right);
        return {
          buildMs,
          p95SearchMs: durations[56],
          maxSearchMs: durations.at(-1),
          resultLabels,
        };
      },
      { data: scaleView, moduleUrl },
    );
    await testInfo.attach(`holdings-search-${size}-timings.json`, {
      body: JSON.stringify(timings),
      contentType: "application/json",
    });
    expect(timings.resultLabels).toEqual(
      Array.from(
        { length: 60 },
        (_, attempt) =>
          [
            "1 exposure · 1 position",
            `${size} exposures · ${size} positions`,
            "0 results",
          ][attempt % 3],
      ),
    );
    expect(timings.p95SearchMs).toBeLessThan(50);
  });
}

test(
  "search bounds positions within a single large exposure and preserves the loaded batch on return",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(window, "IntersectionObserver", {
        configurable: true,
        value: undefined,
      }),
    );
    const positions = Array.from({ length: 120 }, (_, index) => ({
      ...searchHolding,
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
    await page
      .getByRole("searchbox", { name: "Search holdings" })
      .fill("nebula");
    await expect(
      page.locator(".exposure-group__positions article"),
    ).toHaveCount(25);
    await page
      .getByRole("button", { name: "Load more Demo Nebula positions" })
      .click();
    await expect(
      page.locator(".exposure-group__positions article"),
    ).toHaveCount(50);
    const target = page.getByRole("link", {
      name: "View Demo Nebula SPV 049 holding details",
    });
    await target.click();
    await page
      .getByRole("button", { name: "Back to holdings", exact: true })
      .click();
    await expect(
      page.locator(".exposure-group__positions article"),
    ).toHaveCount(50);
    await expect(target).toBeFocused();
  },
);

test("valuation readback lands quietly on the exposure and aligns its quote with Change", async ({
  page,
}) => {
  const exposureId = "exposure_invested_amount_synthetic";
  const quote = {
    id: "first-close",
    ticker: "BCN",
    venue: "Demo Exchange",
    shareClass: "Common",
    shareBasis: { key: "common", unitsPerOriginal: 1 },
    date: "2026-08-18",
    priceMicros: 50_000_000,
    sourceUrl: "https://example.com/first-close",
  };
  await page.route("**/api/exposure-closes", (route) =>
    route.fulfill({
      json: [
        {
          exposureId,
          name: "Beacon Robotics",
          quote,
          firstDate: quote.date,
          firstPriceMicros: quote.priceMicros,
          read: true,
          readVersion: 1,
          version: 1,
          choice: "follow",
          token: "saved",
          positions: [
            {
              id: "position_invested_amount_8",
              name: "Synthetic Beacon SPV",
              quantityMicros: 1_000_000,
              valueMinor: 5000,
              previousMinor: 4000,
              enrolled: true,
            },
          ],
        },
      ],
    }),
  );
  await page.goto(`/holdings?exposure=${exposureId}`);
  const group = page.getByRole("listitem", {
    name: "Beacon Robotics",
    exact: true,
  });
  const disclosure = group.getByRole("button", { name: /Beacon Robotics/ });
  await expect(group).toBeFocused();
  await expect(group).toHaveCSS("outline-style", "none");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(disclosure).toHaveCSS("outline-style", "none");
  await expect(disclosure).toHaveCSS("box-shadow", "none");

  await page.evaluate(() => document.fonts.ready);
  const quoteText = group.getByText(/\$50\.00\/share/);
  const change = group.getByRole("link", { name: /Change source/ });
  // Measure the painted text, not the link's intentionally taller hit area.
  const textCenter = (element: Element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = range.getBoundingClientRect();
    return box.y + box.height / 2;
  };
  const quoteCenter = await quoteText.evaluate(textCenter);
  expect(
    Math.abs(quoteCenter - (await change.evaluate(textCenter))),
  ).toBeLessThanOrEqual(2);

  const positionRow = group.getByRole("listitem").first();
  const name = positionRow.locator(".record-row__title");
  const amount = positionRow.locator(".position-row__value");
  // Compare the first painted line; either column can have wrapping source details.
  const firstLine = (el: Element) => {
    const text = document
      .createTreeWalker(el, NodeFilter.SHOW_TEXT)
      .nextNode()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    return {
      top: range.getClientRects()[0]!.top,
      size: getComputedStyle(el).fontSize,
    };
  };
  const [nameLine, amountLine] = await Promise.all([
    name.evaluate(firstLine),
    amount.evaluate(firstLine),
  ]);
  expect(nameLine.size).toBe(amountLine.size);
  expect(Math.abs(nameLine.top - amountLine.top)).toBeLessThanOrEqual(1);

  const details = positionRow.getByRole("link", { name: /holding details/ });
  const [actionBox, valueBox] = await Promise.all([
    details.locator("svg").boundingBox(),
    positionRow.locator(".record-row__value").boundingBox(),
  ]);
  expect(actionBox!.x).toBeGreaterThanOrEqual(valueBox!.x + valueBox!.width);

  await page.keyboard.press("Tab");
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveCSS("outline-style", "solid");
  await expect(disclosure).toHaveCSS("box-shadow", "none");
  await page.keyboard.press("Tab");
  await expect(change).toBeFocused();
});
