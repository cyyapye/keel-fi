import { expect, test, type Page } from "@playwright/test";

const observedAt = "2026-08-14T16:00:00.000Z";
const connectionId = "cash_connection_demo_bank";
const proposalId = "cash_proposal_demo_bank";

const proposal = {
  id: proposalId,
  connectionId,
  institutionLabel: "Northstar Demo Bank",
  status: "pending_review",
  refreshKind: "live",
  observedAt,
  retrievedAt: observedAt,
  summary: {
    rowCount: 3,
    reportedCount: 2,
    needsAttentionCount: 1,
    notReportedCount: 0,
    totalReportedMinor: 9_968_055,
  },
  rows: [
    {
      id: "cash_row_checking",
      naturalKeySha256: "1".repeat(64),
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Everyday checking",
      subtype: "checking",
      availableMinor: 2_468_055,
      currentMinor: 2_517_311,
      valueMinor: 2_468_055,
      valueState: "reported",
      balanceSource: "available",
      refreshKind: "live",
      observedAt,
      priorValueMinor: null,
      priorValueState: null,
      action: "new_account",
      issues: [],
    },
    {
      id: "cash_row_savings",
      naturalKeySha256: "2".repeat(64),
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Reserve savings",
      subtype: "savings",
      availableMinor: 7_500_000,
      currentMinor: 7_500_000,
      valueMinor: 7_500_000,
      valueState: "reported",
      balanceSource: "available",
      observedAt,
      priorValueMinor: 7_500_000,
      priorValueState: "reported",
      action: "no_change",
      issues: [],
    },
    {
      id: "cash_row_non_usd",
      naturalKeySha256: "3".repeat(64),
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Travel money market",
      subtype: "money market",
      availableMinor: null,
      currentMinor: null,
      valueMinor: null,
      valueState: "unsupported",
      balanceSource: null,
      observedAt,
      priorValueMinor: null,
      priorValueState: null,
      action: "needs_attention",
      issues: ["Only USD cash balances can enter the FI baseline."],
    },
  ],
} as const;

const acceptedSavings = {
  id: "cash_fact_savings",
  naturalKeySha256: "2".repeat(64),
  connectionId,
  institutionLabel: "Northstar Demo Bank",
  accountLabel: "Reserve savings",
  subtype: "savings",
  valueMinor: 7_500_000,
  valueState: "reported",
  balanceSource: "available",
  refreshKind: "initial",
  observedAt: "2026-08-01T16:00:00.000Z",
  acceptedAt: "2026-08-01T16:05:00.000Z",
} as const;

const pendingState = {
  version: 1,
  configured: true,
  status: "needs_attention",
  connections: [
    {
      id: connectionId,
      institutionLabel: "Northstar Demo Bank",
      status: "ready",
      lastCheckedAt: observedAt,
      liveRefreshLimit: 4,
      liveRefreshesUsed: 1,
      liveRefreshesRemaining: 3,
    },
  ],
  acceptedAccounts: [acceptedSavings],
  pendingProposals: [proposal],
  errorCode: null,
} as const;

const appliedState = {
  ...pendingState,
  status: "ready",
  acceptedAccounts: [
    {
      id: "cash_fact_checking",
      naturalKeySha256: "1".repeat(64),
      connectionId,
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Everyday checking",
      subtype: "checking",
      valueMinor: 2_468_055,
      valueState: "reported",
      balanceSource: "available",
      refreshKind: "live",
      observedAt,
      acceptedAt: "2026-08-14T16:05:00.000Z",
    },
    {
      ...acceptedSavings,
      refreshKind: "live",
      observedAt,
      acceptedAt: "2026-08-14T16:05:00.000Z",
    },
  ],
  pendingProposals: [],
} as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test("reviews dated cash balances before they enter the FI baseline", async ({
  page,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = await alphaResponse.json();
  let cashState: Record<string, unknown> = pendingState;
  let applyBody: Record<string, unknown> | null = null;

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.route("**/api/cash-accounts", async (route) => {
    await route.fulfill({ json: cashState });
  });
  await page.route(
    `**/api/cash-account-proposals/${proposalId}/apply`,
    async (route) => {
      applyBody = (await route.request().postDataJSON()) as Record<
        string,
        unknown
      >;
      cashState = appliedState;
      await route.fulfill({
        json: {
          proposalId,
          acceptedCount: 2,
          excludedCount: 1,
          acceptedCashMinor: 9_968_055,
        },
        status: 201,
      });
    },
  );
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
        lastSeenAt: "2026-08-14T15:00:00.000Z",
        lastCompletedAt: "2026-08-14T14:55:00.000Z",
        nextRunAt: "2026-08-21T16:00:00.000Z",
        latestImportId: null,
        errorCode: null,
      },
    });
  });
  await page.route("**/api/public-holdings/robinhood/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        status: "ready",
        lastSyncedAt: "2026-08-14T15:00:00.000Z",
        automaticUpdatesEnabled: true,
        latestImportId: null,
        latestRunStatus: "succeeded",
        errorCode: null,
      },
    });
  });

  await page.goto("/holdings");
  const cashSection = page.locator(".cash-accounts");
  await expect(
    page.getByRole("heading", { name: "Reviewed cash, on your terms" }),
  ).toBeVisible();
  await expect(cashSection).toContainText("$75k");
  await expect(cashSection).toContainText("3 live checks left this month");
  await expect(cashSection).toHaveScreenshot("cash-accounts-ready.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await page.getByRole("button", { name: "Review balances" }).click();
  await expect(
    page.getByRole("heading", { name: "Review Northstar Demo Bank" }),
  ).toBeFocused();
  await expect(cashSection).toContainText("Only USD cash balances");
  await expect(
    page.getByRole("checkbox", { name: "Use as reviewed cash" }),
  ).toHaveCount(2);
  const cashReview = page.locator(".cash-review");
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await cashReview.evaluate((element) =>
    element.scrollIntoView({ block: "start", behavior: "auto" }),
  );
  await expect(cashReview).toHaveScreenshot("cash-accounts-review.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Apply cash review" }).click();
  await expect(cashSection).toContainText("$100k");
  await expect(cashSection).not.toContainText("ready to review");
  expect(applyBody).toEqual({
    changeNote: "Reviewed Northstar Demo Bank cash balances.",
    decisions: [
      { rowId: "cash_row_checking", decision: "accepted" },
      { rowId: "cash_row_savings", decision: "accepted" },
      { rowId: "cash_row_non_usd", decision: "excluded" },
    ],
  });
});
