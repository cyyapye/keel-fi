import { expect, test, type Page } from "@playwright/test";

import { routeHoldingsPage } from "./holdings-page-fixtures";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: emptyInvestmentHoldingsView });
  });
  await page.route("**/api/investment-connections/auto-sync", async (route) => {
    await route.fulfill({ json: investmentConnectionsState });
  });
});

const investmentConnectionsState = {
  version: 1,
  configured: true,
  connections: [
    {
      version: 1,
      connectionId: "11111111-1111-4111-8111-111111111111",
      institutionKey: "ins_robinhood",
      institutionLabel: "Robinhood",
      status: "ready",
      lastSyncedAt: "2026-08-13T16:00:00.000Z",
      automaticUpdatesEnabled: true,
      latestImportId: null,
      latestRunStatus: "succeeded",
      errorCode: null,
      latestAdjudication: null,
    },
  ],
  errorCode: null,
};

const readyState = {
  status: "ready",
  sourceRevision: "a".repeat(64),
  observedAt: "2026-08-10T16:00:00.000Z",
  baseForecastSnapshotId: "snap_fi_v3",
  baseForecastSnapshotVersion: 3,
  summary: {
    positionCount: 3,
    publicMarketValueMinor: 23_800_000,
    privatePaperValueMinor: 12_500_000,
    cashAccountCount: 2,
    cashAccountValueMinor: 9_968_055,
    unknownCashAccountCount: 0,
    unknownValueCount: 1,
    potentialDuplicateCount: 0,
  },
  positions: [
    {
      id: "holding_demo_robinhood",
      positionName: "Synthetic Public Company",
      ownerLabel: "Robinhood individual account",
      sourceLabel: "Robinhood",
      provider: "plaid_investments",
      classification: "public_market",
      valueMinor: 23_800_000,
      valueState: "reported",
      observedAt: "2026-08-10T16:00:00.000Z",
      ticker: "SYN",
      isCashPosition: false,
      potentialDuplicate: false,
      duplicateWith: [],
    },
    {
      id: "holding_demo_spv",
      positionName: "Synthetic Public Company",
      ownerLabel: "Demo Family LLC",
      sourceLabel: "AngelList",
      provider: "angellist",
      classification: "private_paper",
      valueMinor: 12_500_000,
      valueState: "reported",
      observedAt: "2026-08-09T16:00:00.000Z",
      ticker: null,
      isCashPosition: false,
      potentialDuplicate: false,
      duplicateWith: [],
    },
    {
      id: "holding_demo_locked",
      positionName: "Lattice Grove Energy",
      ownerLabel: "Demo Operator",
      sourceLabel: "AngelList",
      provider: "angellist",
      classification: "private_paper",
      valueMinor: null,
      valueState: "locked",
      observedAt: "2026-08-09T16:00:00.000Z",
      ticker: null,
      isCashPosition: false,
      potentialDuplicate: false,
      duplicateWith: [],
    },
  ],
  cashAccounts: [
    {
      id: "cash_fact_checking",
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Everyday checking",
      subtype: "checking",
      valueMinor: 2_468_055,
      valueState: "reported",
      refreshKind: "live",
      observedAt: "2026-08-14T16:00:00.000Z",
    },
    {
      id: "cash_fact_savings",
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Reserve savings",
      subtype: "savings",
      valueMinor: 7_500_000,
      valueState: "reported",
      refreshKind: "live",
      observedAt: "2026-08-14T16:00:00.000Z",
    },
  ],
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
  suggestedOtherFiEligibleLiquidMinor: 5_000_000,
  currentImpact: {
    fiEligibleLiquidMinor: 182_500_000,
    fiEligibleChangeMinor: 0,
    protectedRunwayMonths: 42,
    fiGapMinor: 142_500_000,
    lowerTotalAvailableMinor: 276_500_000,
    middleTotalAvailableMinor: 392_500_000,
    higherTotalAvailableMinor: 536_500_000,
    probabilityCrossingFiPpm: 645_475,
  },
  latestBaseline: null,
  hasSourceChanges: true,
  hasCashAccountChanges: true,
  requiresDuplicateReview: false,
  requiresCashOverlapReview: true,
  canConfirm: true,
} as const;

const confirmationResult = {
  baseline: {
    id: "baseline_synthetic",
    sourceRevision: readyState.sourceRevision,
    observedAt: readyState.observedAt,
    summary: readyState.summary,
    priorFiEligibleLiquidMinor: 182_500_000,
    fiEligibleLiquidMinor: 38_768_055,
    otherFiEligibleLiquidMinor: 5_000_000,
    forecastSnapshotId: "snap_fi_v4",
    forecastSnapshotVersion: 4,
    goalVersion: 2,
    changeNote: "Reviewed synced holdings for the FI plan.",
    createdAt: "2026-08-13T19:00:00.000Z",
    createdBy: "Demo Operator",
  },
  impact: {
    fiEligibleLiquidMinor: 38_768_055,
    fiEligibleChangeMinor: -143_731_945,
    protectedRunwayMonths: 6,
    fiGapMinor: 286_231_945,
    lowerTotalAvailableMinor: 132_768_055,
    middleTotalAvailableMinor: 248_768_055,
    higherTotalAvailableMinor: 392_768_055,
    probabilityCrossingFiPpm: 367_653,
  },
} as const;

const automaticReadyState = {
  ...readyState,
  summary: {
    ...readyState.summary,
    cashAccountCount: 0,
    cashAccountValueMinor: 0,
    unknownCashAccountCount: 0,
    potentialDuplicateCount: 0,
  },
  positions: readyState.positions.map((position) => ({
    ...position,
    potentialDuplicate: false,
    duplicateWith: [],
  })),
  cashAccounts: [],
  suggestedOtherFiEligibleLiquidMinor: 2_500_000,
  latestBaseline: {
    ...confirmationResult.baseline,
    id: "baseline_synthetic_prior",
    sourceRevision: "b".repeat(64),
    summary: {
      ...confirmationResult.baseline.summary,
      cashAccountCount: 0,
      cashAccountValueMinor: 0,
      unknownCashAccountCount: 0,
      potentialDuplicateCount: 0,
    },
    fiEligibleLiquidMinor: 26_300_000,
    otherFiEligibleLiquidMinor: 2_500_000,
    createdAt: "2026-08-10T19:00:00.000Z",
  },
  hasCashAccountChanges: false,
  requiresDuplicateReview: false,
  requiresCashOverlapReview: false,
} as const;

const automaticConfirmationResult = {
  baseline: {
    ...confirmationResult.baseline,
    id: "baseline_synthetic_automatic",
    summary: automaticReadyState.summary,
    fiEligibleLiquidMinor: 26_300_000,
    otherFiEligibleLiquidMinor: 2_500_000,
    changeNote: "Accepted holdings refreshed automatically.",
  },
  impact: {
    ...confirmationResult.impact,
    fiEligibleLiquidMinor: 26_300_000,
    fiEligibleChangeMinor: -156_200_000,
    fiGapMinor: 298_700_000,
  },
} as const;

const cashChangeReadyState = {
  ...automaticReadyState,
  summary: {
    ...automaticReadyState.summary,
    cashAccountCount: 1,
    cashAccountValueMinor: 2_468_055,
  },
  cashAccounts: [readyState.cashAccounts[0]],
  suggestedOtherFiEligibleLiquidMinor: 0,
  latestBaseline: {
    ...automaticReadyState.latestBaseline,
    summary: automaticReadyState.summary,
    fiEligibleLiquidMinor: 23_800_000,
    otherFiEligibleLiquidMinor: 0,
  },
  hasCashAccountChanges: true,
  requiresCashOverlapReview: false,
} as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test("sets the initial FI baseline while checking only manual cash", async ({
  page,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = await alphaResponse.json();
  let baselineState: Record<string, unknown> = readyState;
  let confirmationBody: Record<string, unknown> | null = null;

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaFixture.holdings,
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/portfolio-baseline", async (route) => {
    await route.fulfill({ json: baselineState });
  });
  await page.route("**/api/portfolio-baselines", async (route) => {
    confirmationBody = (await route.request().postDataJSON()) as Record<
      string,
      unknown
    >;
    baselineState = {
      ...readyState,
      status: "current",
      baseForecastSnapshotId: "snap_fi_v4",
      baseForecastSnapshotVersion: 4,
      planning: {
        ...readyState.planning,
        currentFiEligibleLiquidMinor: 38_768_055,
      },
      suggestedOtherFiEligibleLiquidMinor: 5_000_000,
      currentImpact: confirmationResult.impact,
      latestBaseline: confirmationResult.baseline,
      hasSourceChanges: false,
      hasCashAccountChanges: false,
      canConfirm: false,
    };
    await route.fulfill({ json: confirmationResult, status: 201 });
  });
  await page.route("**/api/holding-imports", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/automation/angellist/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        status: "ready",
        interval: "weekly",
        runStatus: null,
        lastSeenAt: "2026-08-13T16:00:00.000Z",
        lastCompletedAt: "2026-08-13T15:58:00.000Z",
        nextRunAt: "2026-08-20T16:00:00.000Z",
        latestImportId: null,
        errorCode: null,
      },
    });
  });
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({ json: investmentConnectionsState });
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

  await page.goto("/holdings");
  const summary = page.locator(".portfolio-baseline");
  await expect(
    page.getByRole("heading", {
      name: "Set the FI planning baseline",
    }),
  ).toBeVisible();
  await expect(summary).not.toContainText("reviewed positions");
  await expect(summary).toHaveScreenshot("portfolio-baseline-ready.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await page.getByRole("button", { name: "Set baseline" }).click();
  await expect(page.getByLabel("Manual liquid residual")).toHaveValue(
    "50,000.00",
  );
  await expect(
    page.getByLabel("Proposed FI-eligible liquid calculation"),
  ).toContainText("$387,680.55");
  await expect(page.getByLabel(/possible overlapping positions/u)).toHaveCount(
    0,
  );
  await page
    .getByLabel(/I checked linked cash accounts, brokerage cash positions/u)
    .check();
  const review = page.locator(".portfolio-baseline-review");
  await page.addStyleTag({
    content:
      ".topbar { position: absolute !important; visibility: hidden !important; } @media (max-width: 620px) { .portfolio-baseline-review { min-height: 1717px; } }",
  });
  await review.evaluate((element) =>
    element.scrollIntoView({ block: "start", behavior: "auto" }),
  );
  await expect(review).toHaveScreenshot("portfolio-baseline-review.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Confirm baseline" }).click();
  await expect(
    page.getByRole("heading", { name: "Planning baseline is current" }),
  ).toHaveCount(0);
  await expect(page.locator(".portfolio-baseline")).toHaveCount(0);
  expect(confirmationBody).toMatchObject({
    sourceRevision: readyState.sourceRevision,
    baseForecastSnapshotId: "snap_fi_v3",
    baseForecastSnapshotVersion: 3,
    otherFiEligibleLiquidMinor: 5_000_000,
    duplicateReviewConfirmed: false,
    cashOverlapReviewConfirmed: true,
  });
});

test("keeps an existing FI baseline behind an explicit review", async ({
  page,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = await alphaResponse.json();
  let baselineState: Record<string, unknown> = automaticReadyState;
  let confirmationBody: Record<string, unknown> | null = null;

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaFixture.holdings,
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/portfolio-baseline", async (route) => {
    await route.fulfill({ json: baselineState });
  });
  await page.route("**/api/portfolio-baselines", async (route) => {
    confirmationBody = (await route.request().postDataJSON()) as Record<
      string,
      unknown
    >;
    baselineState = {
      ...automaticReadyState,
      status: "current",
      baseForecastSnapshotId: "snap_fi_v4",
      baseForecastSnapshotVersion: 4,
      planning: {
        ...automaticReadyState.planning,
        currentFiEligibleLiquidMinor: 26_300_000,
      },
      currentImpact: automaticConfirmationResult.impact,
      latestBaseline: automaticConfirmationResult.baseline,
      hasSourceChanges: false,
      hasCashAccountChanges: false,
      canConfirm: false,
    };
    await route.fulfill({ json: automaticConfirmationResult, status: 201 });
  });
  await page.route("**/api/holding-imports", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/automation/angellist/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        status: "ready",
        interval: "weekly",
        runStatus: null,
        lastSeenAt: "2026-08-13T16:00:00.000Z",
        lastCompletedAt: "2026-08-13T15:58:00.000Z",
        nextRunAt: "2026-08-20T16:00:00.000Z",
        latestImportId: null,
        errorCode: null,
      },
    });
  });
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({ json: investmentConnectionsState });
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

  await page.goto("/holdings");
  await expect(
    page.getByRole("heading", { name: "Holdings changes are ready" }),
  ).toBeVisible();
  await page.waitForTimeout(250);
  expect(confirmationBody).toBeNull();
  await expect(
    page.getByRole("button", { name: "Review baseline" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review baseline" }).click();
  await expect(
    page.getByRole("heading", { name: "Review the new FI liquid baseline" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Confirm baseline" }).click();
  await expect.poll(() => confirmationBody).not.toBeNull();
  expect(confirmationBody).toMatchObject({
    sourceRevision: automaticReadyState.sourceRevision,
    baseForecastSnapshotId: "snap_fi_v3",
    baseForecastSnapshotVersion: 3,
    otherFiEligibleLiquidMinor: 2_500_000,
    duplicateReviewConfirmed: false,
    cashOverlapReviewConfirmed: false,
    changeNote: "Replaced the FI liquid baseline with reviewed sources.",
  });
  await expectNoHorizontalOverflow(page);
});

test("keeps accepted cash changes behind a separate baseline review", async ({
  page,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = await alphaResponse.json();
  let confirmationCount = 0;

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaFixture.holdings,
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/portfolio-baseline", async (route) => {
    await route.fulfill({ json: cashChangeReadyState });
  });
  await page.route("**/api/portfolio-baselines", async (route) => {
    confirmationCount += 1;
    await route.fulfill({ json: automaticConfirmationResult, status: 201 });
  });
  await page.route("**/api/holding-imports", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/automation/angellist/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        status: "ready",
        interval: "weekly",
        runStatus: null,
        lastSeenAt: "2026-08-13T16:00:00.000Z",
        lastCompletedAt: "2026-08-13T15:58:00.000Z",
        nextRunAt: "2026-08-20T16:00:00.000Z",
        latestImportId: null,
        errorCode: null,
      },
    });
  });
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({ json: investmentConnectionsState });
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

  await page.goto("/holdings");
  await expect(
    page.getByRole("heading", { name: "Bank cash changes are ready" }),
  ).toBeVisible();
  await page.waitForTimeout(250);
  expect(confirmationCount).toBe(0);
  await page.getByRole("button", { name: "Review bank cash" }).click();
  await expect(page.getByLabel("Manual liquid residual")).toHaveValue("0.00");
  await expectNoHorizontalOverflow(page);
});

test("retries an unavailable planning baseline", async ({ page }) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = await alphaResponse.json();
  let baselineRequestCount = 0;

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaFixture.holdings,
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/portfolio-baseline", async (route) => {
    baselineRequestCount += 1;
    if (baselineRequestCount === 1) {
      await route.fulfill({
        status: 503,
        json: { error: "The planning baseline is temporarily unavailable." },
      });
      return;
    }
    await route.fulfill({ json: readyState });
  });
  await page.route("**/api/holding-imports", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/automation/angellist/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        status: "ready",
        interval: "weekly",
        runStatus: null,
        lastSeenAt: "2026-08-13T16:00:00.000Z",
        lastCompletedAt: "2026-08-13T15:58:00.000Z",
        nextRunAt: "2026-08-20T16:00:00.000Z",
        latestImportId: null,
        errorCode: null,
      },
    });
  });
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({ json: investmentConnectionsState });
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

  await page.goto("/holdings");
  const errorState = page.locator(".portfolio-baseline--error");
  await expect(
    errorState.getByRole("heading", { name: "Planning baseline unavailable" }),
  ).toBeVisible();
  await expect(errorState).toContainText(
    "The planning baseline is temporarily unavailable.",
  );
  await expect(
    errorState.getByRole("button", { name: "Try again" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(errorState).toHaveScreenshot(
    "portfolio-baseline-retry-error.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await errorState.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => baselineRequestCount).toBe(2);
  await expect(errorState).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Set the FI planning baseline" }),
  ).toBeVisible();
});
