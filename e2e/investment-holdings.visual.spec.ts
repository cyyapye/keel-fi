import { expect, test, type Page } from "@playwright/test";
import type { Holding } from "../packages/domain/src/index";
import type { InvestmentHoldingsView } from "../packages/domain/src/investment-holdings-view";

import {
  investmentHoldingsViewFor,
  multiInstitutionInvestmentHoldingsView,
  reconciledReviewedHistoryInvestmentHoldingsView,
} from "./investment-holdings-fixtures";
import { navigateToScreen } from "./navigation";

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
  return view.exposureView.positions.map((position) => ({
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
  }));
}

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

test("operates multiple institutions from one exposure-first holdings view", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

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
  await expect(robinhoodCard).toContainText(
    "Data as of Aug 15, 2026 · Checked Aug 19, 2026",
  );
  await expect(
    robinhoodCard.getByRole("button", { name: "Connect again" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".investment-institution").filter({ hasText: "Fidelity" }),
  ).toHaveCount(2);
  await expect(
    page.locator(".investment-institution").filter({ hasText: "Fidelity" }),
  ).toContainText(["2 accounts", "1 account"]);
  const reconnectCard = page.locator(".investment-institution").filter({
    hasText: "Synthetic Reconnect Brokerage",
  });
  await expect(
    reconnectCard.getByText("Reconnect needed", { exact: true }),
  ).toBeVisible();
  await expect(
    reconnectCard.getByRole("button", { name: "Reconnect" }),
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
    exposureView.locator(".exposure-group summary strong").first(),
  ).toHaveText("NVIDIA common stock");
  await expect(
    page.getByRole("heading", { name: "Company holdings" }),
  ).toHaveCount(0);
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
  await expect(nvda.locator(".position-row__value")).toHaveText([
    "USD 315k",
    "USD 240k",
    "USD 185k",
  ]);
  const cash = page.locator(".exposure-group").filter({
    has: page.getByText("US Dollar", { exact: true }),
  });
  await expect(cash).toContainText("2 positions");
  await cash.locator("summary").click();
  await expect(cash.getByText("Robinhood · Robinhood brokerage")).toBeVisible();
  await expect(
    cash.getByText("Fidelity · Fidelity rollover IRA"),
  ).toBeVisible();
  await expect(cash.locator(".position-row__value")).toHaveText([
    "USD 2.25k",
    "USD 1.25k",
  ]);
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
    exposureView.locator(".exposure-group summary strong").first(),
  ).toHaveText("US Dollar");
  await expect(cash.locator(".position-row__value")).toHaveText([
    "USD 1.25k",
    "USD 2.25k",
  ]);
  await expect(nvda.locator(".position-row__value")).toHaveText([
    "USD 185k",
    "USD 240k",
    "USD 315k",
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
  await harbor.locator("summary").click();
  await expect(harbor.getByText("Synthetic Horizon SPV")).toBeVisible();
  await expect(harbor.getByText("Locked", { exact: true })).toBeVisible();
  await expect(
    page.locator(".unallocated-positions").getByText("Allocation unknown"),
  ).toBeVisible();
  await expect(page.locator(".unallocated-positions")).not.toContainText(
    "NVDA common stock",
  );
  await expect(page.locator(".unallocated-positions")).not.toContainText(
    "U S Dollar",
  );
  await expect(
    page
      .locator(".unallocated-positions")
      .getByText("Exposure unresolved", { exact: true }),
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
  ).not.toContainText("USD 0");
  await expect(
    page.getByRole("heading", { name: "Unallocated or unresolved value" }),
  ).toBeVisible();
  await expect(
    nvda.getByRole("button", {
      name: "View NVDA common stock holding details",
    }),
  ).toHaveCount(3);
  await expect(
    cash.getByRole("button", {
      name: "View U S Dollar holding details",
    }),
  ).toHaveCount(2);
  const targetHeights = await page
    .locator(
      ".investment-institutions .button:visible, .position-row__action:visible",
    )
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  expect(targetHeights.every((height) => height >= 44)).toBe(true);
  const hasVisibleDecorativeBorder = await page
    .locator(
      [
        ".angellist-agent",
        ".angellist-agent__controls select",
        ".angellist-agent__meta",
        ".cash-accounts",
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
      name: "View NVDA common stock holding details",
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

test("checks a stale brokerage after rendering current holdings", async ({
  page,
}, testInfo) => {
  const robinhoodConnectionId = "11111111-1111-4111-8111-111111111111";
  const staleStatuses = statuses.map((status) =>
    status.connectionId === robinhoodConnectionId
      ? { ...status, lastSyncedAt: "2026-08-17T11:45:00.000Z" }
      : status,
  );
  let automaticRequestCount = 0;
  let releaseAutomaticSync: () => void = () => undefined;
  const automaticSyncGate = new Promise<void>((resolve) => {
    releaseAutomaticSync = resolve;
  });

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
    await automaticSyncGate;
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        connections: statuses,
        errorCode: null,
      },
    });
  });

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  const robinhoodCard = page
    .locator(".investment-institution")
    .filter({ hasText: "Robinhood" });
  await expect(robinhoodCard).toContainText(
    "Data as of Aug 15, 2026 · Checked Aug 17, 2026",
  );
  try {
    await expect(page.locator(".exposure-group")).toHaveCount(5);
    await expect.poll(() => automaticRequestCount).toBe(1);
  } finally {
    releaseAutomaticSync();
  }
  await expect(robinhoodCard).toContainText(
    "Data as of Aug 15, 2026 · Checked Aug 19, 2026",
  );
  expect(automaticRequestCount).toBe(1);
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

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  const accounts = page.locator(".investment-institutions");
  await expect(accounts.locator(".investment-institution")).toHaveCount(0);
  await expect(accounts).not.toContainText("AngelList reviewed history");
  await expect(accounts).not.toContainText("Original account details");
  await expectNoHorizontalOverflow(page);

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
  await exposure.locator("summary").click();
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

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  await expect(page.locator(".investment-institution")).toHaveCount(0);
  await expect(page.locator(".investment-institutions")).not.toContainText(
    "AngelList reviewed history",
  );
  const exposure = page.locator(".exposure-group").filter({
    has: page.getByText("Demo Pharmacy", { exact: true }),
  });
  await expect(exposure).toContainText("1 position");
  await exposure.locator("summary").click();
  await expect(
    exposure.getByRole("button", {
      name: "View Demo Pharmacy SPV 01 holding details",
    }),
  ).toBeVisible();
});

test("keeps failed canonical holdings out of unresolved exposures and retries", async ({
  page,
}, testInfo) => {
  let holdingsRequestCount = 0;
  await page.unroute("**/api/investment-holdings");
  await page.route("**/api/investment-holdings", async (route) => {
    holdingsRequestCount += 1;
    if (holdingsRequestCount === 1) {
      await route.fulfill({
        status: 503,
        json: { error: "Reviewed holdings are temporarily unavailable." },
      });
      return;
    }
    await route.fulfill({ json: holdingsView });
  });
  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  const errorState = page.locator(".investment-views");
  await expect(errorState.getByRole("alert")).toContainText(
    "Keel could not load the reviewed position view.",
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
    has: page.getByText("NVIDIA common stock", { exact: true }),
  });
  await expect(nvda).toContainText("3 positions");
  await expect(errorState.locator(".unallocated-positions")).not.toContainText(
    "NVDA common stock",
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

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  const exposureView = page.locator(".investment-views");
  await expect(exposureView.locator(".exposure-group")).toHaveCount(12);
  await expect(exposureView.locator(".exposure-pagination")).toContainText(
    "Showing 12 of 25 exposures",
  );
  await expect(exposureView).not.toContainText("Demo Exposure 01");
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
  await expect(exposureView).toContainText("Demo Exposure 01");
  await expect(exposureView.locator(".exposure-pagination")).toHaveCount(0);
});
