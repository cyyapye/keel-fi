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

const readyStateWithoutChanges = {
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

const readyState = {
  ...readyStateWithoutChanges,
  changes: {
    positions: readyStateWithoutChanges.positions.map((current) => ({
      changeType: "added" as const,
      current,
      previous: null,
    })),
    cashAccounts: readyStateWithoutChanges.cashAccounts.map((current) => ({
      changeType: "added" as const,
      current,
      previous: null,
    })),
  },
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
  changes: {
    positions: [
      {
        changeType: "updated",
        current: readyState.positions[0],
        previous: {
          valueMinor: 22_800_000,
          valueState: "reported",
          observedAt: "2026-08-08T16:00:00.000Z",
        },
      },
    ],
    cashAccounts: [],
  },
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
  changes: {
    positions: [],
    cashAccounts: [
      {
        changeType: "updated",
        current: readyState.cashAccounts[0],
        previous: {
          valueMinor: 2_300_000,
          valueState: "reported",
          observedAt: "2026-08-10T16:00:00.000Z",
        },
      },
    ],
  },
} as const;

const scalePositions = Array.from({ length: 120 }, (_, index) => ({
  id: `holding_scale_${index.toString().padStart(3, "0")}`,
  positionName: `Synthetic Scale Holding ${index.toString().padStart(3, "0")}`,
  ownerLabel: "Synthetic brokerage",
  sourceLabel: "Plaid Investments",
  provider: "plaid_investments" as const,
  classification: "public_market" as const,
  valueMinor: 100_000 + index,
  valueState: "reported" as const,
  observedAt: "2026-08-18T16:00:00.000Z",
  ticker: `S${index.toString().padStart(3, "0")}`,
  isCashPosition: false,
  potentialDuplicate: false,
  duplicateWith: [],
}));

const scaleReadyState = {
  ...automaticReadyState,
  requiresDuplicateReview: true,
  sourceRevision: "c".repeat(64),
  observedAt: "2026-08-18T16:00:00.000Z",
  summary: {
    ...automaticReadyState.summary,
    positionCount: 120,
    publicMarketValueMinor: 12_007_140,
  },
  positions: scalePositions,
  suggestedOtherFiEligibleLiquidMinor: 0,
  latestBaseline: {
    ...automaticReadyState.latestBaseline,
    summary: {
      ...automaticReadyState.latestBaseline.summary,
      positionCount: 120,
      publicMarketValueMinor: 10_807_140,
    },
    fiEligibleLiquidMinor: 10_807_140,
    otherFiEligibleLiquidMinor: 0,
  },
  changes: {
    positions: scalePositions.map((current, index) => ({
      changeType: "updated" as const,
      current,
      previous: {
        valueMinor: 90_000 + index,
        valueState: "reported" as const,
        observedAt: "2026-08-17T16:00:00.000Z",
      },
    })),
    cashAccounts: [],
  },
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
      changes: { positions: [], cashAccounts: [] },
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
  const baselineLayout = await summary.evaluate((element) => {
    const button = element.querySelector<HTMLButtonElement>(".button");
    if (button === null) throw new Error("Missing baseline action");
    const sectionBounds = element.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    return {
      buttonWidth: buttonBounds.width,
      isNarrow: window.matchMedia("(max-width: 620px)").matches,
      rightGap: sectionBounds.right - buttonBounds.right,
      sectionWidth: sectionBounds.width,
    };
  });
  if (baselineLayout.isNarrow) {
    expect(baselineLayout.buttonWidth).toBeCloseTo(
      baselineLayout.sectionWidth,
      0,
    );
  } else {
    expect(baselineLayout.buttonWidth).toBeLessThan(180);
    expect(baselineLayout.rightGap).toBeCloseTo(0, 0);
  }
  await expect(summary).toHaveScreenshot("portfolio-baseline-ready.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await page.getByRole("button", { name: "Set baseline" }).click();
  await expect(
    page.getByRole("textbox", { name: /^Cash held elsewhere/u }),
  ).toHaveValue("50,000.00");
  await expect(
    page.getByLabel("Proposed FI-eligible liquid calculation"),
  ).toContainText("$387,680.55");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByLabel("What changed")).toHaveValue(
    /5 (?:reviewed )?sources|3 holdings changed/u,
  );
  await expect(
    page.getByLabel("Baseline source changes").locator("article"),
  ).toHaveCount(5);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Set baseline" }).click();
  await expect(page.locator(".portfolio-baseline-review")).toHaveCount(0);
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

test("keeps a possible overlap behind an explicit baseline decision", async ({
  page,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = await alphaResponse.json();
  let baselineState: Record<string, unknown> = {
    ...automaticReadyState,
    requiresDuplicateReview: true,
  };
  const confirmationBodies: unknown[] = [];

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
    expect(route.request().method()).toBe("POST");
    confirmationBodies.push(route.request().postDataJSON());
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
      changes: { positions: [], cashAccounts: [] },
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

  await page.clock.install();
  await page.goto("/holdings");
  await expect(
    page.getByRole("heading", { name: "1 baseline change is ready" }),
  ).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(
    page.getByRole("button", { name: "Review changes" }),
  ).toBeVisible();
  expect(confirmationBodies).toHaveLength(0);
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Review 1 baseline change" }),
  ).toBeFocused();
  await expect(page.getByLabel("What changed")).toHaveValue(
    "Synthetic Public Company: $228,000.00 → $238,000.00; FI-eligible liquid: $1,825,000.00 → $263,000.00",
  );
  const review = page.locator(".portfolio-baseline-review");
  await page.addStyleTag({
    content:
      ".topbar { position: absolute !important; visibility: hidden !important; }",
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
  const apply = page.getByRole("button", { name: "Apply changes" });
  await apply.focus();
  await expectNoHorizontalOverflow(page);
  await page.clock.fastForward(60_000);
  expect(confirmationBodies).toHaveLength(0);
  await apply.click();
  await expect(review).toHaveCount(0);
  expect(confirmationBodies).toHaveLength(1);
  expect(confirmationBodies[0]).toMatchObject({
    sourceRevision: automaticReadyState.sourceRevision,
    baseForecastSnapshotId: "snap_fi_v3",
    baseForecastSnapshotVersion: 3,
    otherFiEligibleLiquidMinor: 2_500_000,
    duplicateReviewConfirmed: true,
    cashOverlapReviewConfirmed: false,
    changeNote:
      "Synthetic Public Company: $228,000.00 → $238,000.00; FI-eligible liquid: $1,825,000.00 → $263,000.00",
  });
});

test("keeps a 120-source baseline review DOM bounded", async ({ page }) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = await alphaResponse.json();

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
    await route.fulfill({
      json: {
        ...scaleReadyState,
        automaticUpdateCount: 0,
        exceptions: scalePositions.map((position) => ({
          key: `position:${position.id}`,
          kind: "position",
          name: position.positionName,
          context: position.ownerLabel,
          reason: "removed",
          previousValueMinor: position.valueMinor,
          proposedValueMinor: null,
          previousObservedAt: position.observedAt,
          fiEligibleChangeMinor: -position.valueMinor,
        })),
      },
    });
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
        lastSeenAt: "2026-08-18T16:00:00.000Z",
        lastCompletedAt: "2026-08-18T15:58:00.000Z",
        nextRunAt: "2026-08-25T16:00:00.000Z",
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
    page.getByRole("heading", { name: "120 sources need your decision" }),
  ).toBeVisible();
  const rows = page.locator(".portfolio-baseline-review article");
  await expect(rows).toHaveCount(12);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(rows).toHaveCount(24);
  await expectNoHorizontalOverflow(page);
});

for (const kind of ["public", "private", "cash"] as const) {
  const title = `automatically refreshes routine ${kind} changes without a baseline review`;
  const tag = kind === "private" ? [] : "@desktop-only";
  test(title, { tag }, async ({ page }) => {
    const alphaResponse = await page.request.get("/api/alpha");
    const alphaFixture = {
      ...(await alphaResponse.json()),
      holdings: [],
    };
    const base = kind === "cash" ? cashChangeReadyState : automaticReadyState;
    const source =
      kind === "private"
        ? {
            ...base,
            changes: {
              positions: [
                {
                  changeType: "updated",
                  current: base.positions[1],
                  previous: {
                    valueMinor: 120_000,
                    valueState: "reported",
                    observedAt: "2026-08-08T16:00:00.000Z",
                  },
                },
              ],
              cashAccounts: [],
            },
          }
        : base;
    const current = {
      ...source,
      status: "current",
      canConfirm: false,
      hasSourceChanges: false,
      changes: { positions: [], cashAccounts: [] },
    };
    let refreshCount = 0;
    let confirmationCount = 0;
    await routeHoldingsPage(page, {
      householdName: alphaFixture.dashboard.householdName,
      holdings: alphaFixture.holdings,
      investmentHoldings: emptyInvestmentHoldingsView,
      acceptedCashAccounts: [],
      pendingImports: [],
    });
    await page.route("**/api/alpha", (route) =>
      route.fulfill({ json: alphaFixture }),
    );
    await page.route("**/api/portfolio-baseline", (route) =>
      route.fulfill({ json: source }),
    );
    await page.route("**/api/portfolio-baselines", (route) => {
      confirmationCount += 1;
      return route.fulfill({ status: 500 });
    });
    let releaseRefresh!: () => void;
    const refreshResponse = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    await page.route("**/api/portfolio-baseline/refresh", async (route) => {
      expect(route.request().method()).toBe("POST");
      refreshCount += 1;
      await refreshResponse;
      await route.fulfill({ json: current });
    });
    const updating = page
      .getByRole("status")
      .filter({ hasText: "Updating planning values…" });
    try {
      await page.goto("/holdings");
      await expect.poll(() => refreshCount).toBe(1);
      await expect(updating).toBeVisible();
    } finally {
      releaseRefresh();
    }
    await expect(updating).toHaveCount(0);
    await expect(
      page.locator(".portfolio-baseline, .portfolio-baseline-review"),
    ).toHaveCount(0);
    expect(refreshCount).toBe(1);
    expect(confirmationCount).toBe(0);
    await expectNoHorizontalOverflow(page);
    if (kind === "private")
      await expect(page.locator("main")).toHaveScreenshot(
        "portfolio-baseline-automatic.png",
        { animations: "disabled", maxDiffPixelRatio: 0.025 },
      );
  });
}

test(
  "retries an unavailable planning baseline",
  { tag: "@mobile-only" },
  async ({ page }) => {
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
      errorState.getByRole("heading", {
        name: "Planning baseline unavailable",
      }),
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
  },
);

test("updates routine sources and reviews only one exception at a time", async ({
  page,
  isMobile,
}) => {
  const alphaFixture = await (await page.request.get("/api/alpha")).json();
  const cashException = {
    key: "cash:synthetic-new-cash",
    kind: "cash",
    name: "Synthetic reserve cash",
    context: "Northstar Demo Bank · savings",
    reason: "cash_overlap",
    previousValueMinor: null,
    proposedValueMinor: 500_000,
    previousObservedAt: null,
    fiEligibleChangeMinor: 500_000,
  };
  const removedException = {
    key: "position:synthetic-removed",
    kind: "position",
    name: "Synthetic missing holding",
    context: "Plaid Investments · Synthetic brokerage",
    reason: "removed",
    previousValueMinor: 100_000,
    proposedValueMinor: null,
    previousObservedAt: "2026-08-10T16:00:00.000Z",
    fiEligibleChangeMinor: -100_000,
  };
  let baselineState = {
    ...automaticReadyState,
    exceptions: [cashException, removedException],
    automaticUpdateCount: 1,
    planning: {
      ...automaticReadyState.planning,
      currentFiEligibleLiquidMinor: 26_300_000,
    },
  } as Record<string, unknown>;
  let refreshCount = 0;
  let failNext = true;
  const decisions: Record<string, unknown>[] = [];
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaFixture.holdings,
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/alpha", (route) =>
    route.fulfill({ json: alphaFixture }),
  );
  await page.route("**/api/portfolio-baseline", (route) =>
    route.fulfill({ json: baselineState }),
  );
  await page.route("**/api/portfolio-baseline/refresh", (route) => {
    refreshCount++;
    baselineState = {
      ...baselineState,
      automaticUpdateCount: 0,
      changes: { positions: [], cashAccounts: [] },
      latestBaseline: {
        ...automaticReadyState.latestBaseline,
        id: "synthetic-partial-baseline",
      },
    };
    return route.fulfill({ json: baselineState });
  });
  await page.route("**/api/portfolio-baselines", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 409,
        json: { error: "The portfolio changed. Reload before saving." },
      });
      return;
    }
    decisions.push(body);
    const remaining = (
      baselineState.exceptions as (typeof cashException)[]
    ).filter(
      (item) => !(body.reviewedExceptionKeys as string[]).includes(item.key),
    );
    baselineState = {
      ...baselineState,
      exceptions: remaining,
      status: remaining.length === 0 ? "current" : "ready",
      baseForecastSnapshotVersion: 5 + decisions.length,
      suggestedOtherFiEligibleLiquidMinor: body.otherFiEligibleLiquidMinor,
      latestBaseline: {
        ...automaticConfirmationResult.baseline,
        id: `synthetic-reviewed-${decisions.length}`,
      },
    };
    await route.fulfill({ status: 201, json: automaticConfirmationResult });
  });
  await page.goto("/holdings");
  await expect(
    page.getByRole("heading", { name: "2 sources need your decision" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(refreshCount).toBe(1);
  await expect(
    page.getByText("Synthetic Public Company", { exact: true }),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".portfolio-baseline-review")).toHaveScreenshot(
    "portfolio-baseline-exceptions.png",
    { animations: "disabled" },
  );
  if (!isMobile) return;
  await page
    .getByRole("button", { name: "Review Synthetic reserve cash" })
    .click();
  await page
    .getByLabel("Cash held elsewhere", { exact: true })
    .fill("20,000.00");
  await expect(
    page.getByText("$263,000.00 → $263,000.00", { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".portfolio-baseline-review")).toHaveScreenshot(
    "portfolio-baseline-exception-decision.png",
    { animations: "disabled" },
  );
  await page
    .getByRole("button", { name: "Include cash with this amount" })
    .click();
  await expect(
    page.getByText("The portfolio changed. Reload before saving."),
  ).toBeVisible();
  await expect(
    page.getByLabel("Cash held elsewhere", { exact: true }),
  ).toHaveValue("20,000.00");
  await page
    .getByRole("button", { name: "Include cash with this amount" })
    .click();
  await expect(
    page.getByRole("heading", { name: "1 source needs your decision" }),
  ).toBeVisible();
  expect(decisions[0]).toMatchObject({
    reviewedExceptionKeys: [cashException.key],
    otherFiEligibleLiquidMinor: 2_000_000,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "1 source needs your decision" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review Synthetic missing holding" })
    .click();
  await expect(page.getByText("$1,000.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Decide later" }).click();
  expect(decisions).toHaveLength(1);
  await page
    .getByRole("button", { name: "Review Synthetic missing holding" })
    .click();
  await page.getByRole("button", { name: "Remove from plan" }).click();
  await expect(page.locator(".portfolio-baseline-review")).toHaveCount(0);
  expect(decisions[1]).toMatchObject({
    reviewedExceptionKeys: [removedException.key],
  });
  expect(refreshCount).toBe(1);
});
