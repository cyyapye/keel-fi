import { expect, test, type Page } from "@playwright/test";

import { routeHoldingsPage } from "./holdings-page-fixtures";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: emptyInvestmentHoldingsView });
  });
});

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
    {
      ...acceptedSavings,
      id: "cash_fact_prior_savings_missing",
      naturalKeySha256: "4".repeat(64),
      valueMinor: null,
      valueState: "not_reported",
      balanceSource: null,
      refreshKind: "live",
      observedAt,
      acceptedAt: "2026-08-14T16:05:00.000Z",
    },
  ],
  identityCandidates: [
    {
      connectionId,
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Reserve savings",
      subtype: "savings",
      priorNaturalKeySha256: "4".repeat(64),
      reportedNaturalKeySha256: "2".repeat(64),
      observedAt,
    },
  ],
  pendingProposals: [],
} as const;

const resolvedIdentityState = {
  ...appliedState,
  acceptedAccounts: appliedState.acceptedAccounts.filter(
    (account) => account.id !== "cash_fact_prior_savings_missing",
  ),
  identityCandidates: [],
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
  let identityReviewBody: Record<string, unknown> | null = null;
  let automaticRefreshRequests = 0;

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
  await page.route("**/api/cash-accounts", async (route) => {
    await route.fulfill({ json: cashState });
  });
  await page.route("**/api/cash-accounts/auto-refresh", async (route) => {
    automaticRefreshRequests += 1;
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
  await page.route("**/api/cash-account-identities/review", async (route) => {
    identityReviewBody = (await route.request().postDataJSON()) as Record<
      string,
      unknown
    >;
    cashState = resolvedIdentityState;
    await route.fulfill({ json: resolvedIdentityState, status: 201 });
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
        lastSyncedAt: "2026-08-14T15:00:00.000Z",
        automaticUpdatesEnabled: true,
        latestImportId: null,
        latestRunStatus: "succeeded",
        errorCode: null,
        latestAdjudication: null,
      },
    ],
    errorCode: null,
  };
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({ json: investmentConnectionsState });
  });
  await page.route("**/api/investment-connections/auto-sync", async (route) => {
    await route.fulfill({ json: investmentConnectionsState });
  });

  await page.goto("/holdings/sources");
  const cashSection = page.locator(".cash-accounts");
  await expect(
    page.getByRole("heading", { name: "Bank cash", exact: true }),
  ).toBeVisible();
  await expect(cashSection.locator(".cash-accounts__total")).toContainText(
    "Total cash$75k",
  );
  const acceptedSavingsRow = cashSection
    .locator(".cash-accounts__accepted-account")
    .filter({ hasText: "Reserve savings" });
  await expect(acceptedSavingsRow).toHaveCount(1);
  await expect(
    acceptedSavingsRow.locator(".cash-accounts__accepted-value"),
  ).toHaveText("$75,000.00");
  await expect(acceptedSavingsRow).toContainText(
    "Northstar Demo Bank · As of Aug 1, 2026",
  );
  await expect(cashSection).toContainText("four times per bank each month");
  await expect(cashSection).not.toContainText("Review waiting");
  await expect(cashSection).not.toContainText("ready to review");
  expect(automaticRefreshRequests).toBe(0);
  await page.addStyleTag({
    content: `
      /* Keep font-metric rounding from changing the screenshot frame by one pixel. */
      .cash-accounts {
        min-height: 359px;
      }

      @media (max-width: 620px) {
        .cash-accounts {
          min-height: 523px;
        }
      }
    `,
  });
  await expect(cashSection).toHaveScreenshot("cash-accounts-ready.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await page.getByRole("button", { name: "Review 3 balances" }).click();
  const reviewHeading = page.getByRole("heading", {
    name: "Northstar Demo Bank balances",
  });
  await expect(reviewHeading).toBeFocused();
  await expect
    .poll(async () => {
      const top = await reviewHeading.evaluate(
        (element) => element.getBoundingClientRect().top,
      );
      return top >= 0 && top < 160;
    })
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Review 3 balances" }),
  ).toHaveCount(0);
  await expect(cashSection).toContainText("Only USD cash balances");
  await expect(
    page.getByRole("checkbox", { name: "Approve balance" }),
  ).toHaveCount(2);
  const cashReview = page.locator(".cash-review");
  const changeNote = page.getByLabel("What changed");
  await changeNote.hover();
  await expect(changeNote).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
  await changeNote.focus();
  await expect(changeNote).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".cash-review__actions")).toHaveCSS(
    "border-top-color",
    "rgba(0, 0, 0, 0)",
  );
  await reviewHeading.focus();
  await page.mouse.move(0, 0);
  await page.addStyleTag({
    content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }

      /* Keep desktop font rounding from changing the review frame by one pixel. */
      @media (min-width: 621px) {
        .cash-review {
          min-height: 671px;
        }
      }
    `,
  });
  await expect(cashReview).toHaveScreenshot("cash-accounts-review.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Save decisions" }).click();
  await expect(cashSection.locator(".cash-accounts__total")).toContainText(
    "Total cash$100k",
  );
  await expect(
    cashSection.locator(".cash-accounts__accepted-value"),
  ).toHaveText(["$24,680.55", "$75,000.00", "Not reported"]);
  await expect(cashSection).toContainText(
    "Balance decisions saved. Confirm the FI baseline when ready.",
  );
  expect(applyBody).toEqual({
    changeNote: "Reviewed Northstar Demo Bank cash balances.",
    decisions: [
      { rowId: "cash_row_checking", decision: "accepted" },
      { rowId: "cash_row_savings", decision: "accepted" },
      { rowId: "cash_row_non_usd", decision: "excluded" },
    ],
  });

  await expect(
    page.getByRole("heading", { name: "Possible duplicate accounts" }),
  ).toBeVisible();
  await expect(cashSection).toContainText(
    "Confirm each match before the records are combined.",
  );
  await page.addStyleTag({
    content: `
      @media (min-width: 621px) {
        .cash-accounts {
          min-height: 442px;
        }
      }
    `,
  });
  await expect(cashSection).toHaveScreenshot(
    "cash-accounts-identity-review.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Same account" }).click();
  await expect(
    page.getByRole("heading", { name: "Possible duplicate accounts" }),
  ).toHaveCount(0);
  await expect(cashSection).toContainText(
    "Account records combined. Review the FI baseline when ready.",
  );
  await expect(
    cashSection
      .locator(".cash-accounts__accepted-list strong")
      .filter({ hasText: "Reserve savings" }),
  ).toHaveCount(1);
  expect(identityReviewBody).toEqual({
    connectionId,
    priorNaturalKeySha256: "4".repeat(64),
    reportedNaturalKeySha256: "2".repeat(64),
    decision: "same_account",
    changeNote: "Confirmed both records describe the same cash account.",
  });
});
