import { expect, test, type Page } from "@playwright/test";

const captureDesignReview = process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1";
const observedAt = "2026-08-14T16:00:00.000Z";
const connectionId = "liability_connection_demo_bank";
const proposalId = "liability_proposal_demo_bank";

const planning = {
  currentFiEligibleLiquidMinor: 182_500_000,
  protectedCashFloorMinor: 10_300_000,
  householdBurnMonthlyMinor: 2_850_000,
  businessBurnMonthlyMinor: 1_250_000,
  fiTargetMinor: 325_000_000,
} as const;

const proposal = {
  id: proposalId,
  connectionId,
  institutionLabel: "Northstar Demo Bank",
  source: "plaid",
  status: "pending_review",
  refreshKind: "live",
  observedAt,
  retrievedAt: observedAt,
  summary: {
    rowCount: 3,
    reportedCount: 2,
    needsAttentionCount: 1,
    notReportedCount: 0,
    totalReportedMinor: 5_040_000,
  },
  rows: [
    {
      id: "liability_row_card",
      naturalKeySha256: "1".repeat(64),
      source: "plaid",
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Everyday card",
      kind: "credit_card",
      classification: "revolving",
      balanceMinor: 240_000,
      valueState: "reported",
      paymentMinor: 12_500,
      interestRatePpm: 219_900,
      nextPaymentDueDate: "2026-09-01",
      isOverdue: false,
      effectiveDate: "2026-08-01",
      observedAt,
      priorBalanceMinor: 255_000,
      priorValueState: "reported",
      action: "update_obligation",
      issues: [],
    },
    {
      id: "liability_row_student",
      naturalKeySha256: "2".repeat(64),
      source: "plaid",
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Graduate loan",
      kind: "student_loan",
      classification: "scheduled",
      balanceMinor: 4_800_000,
      valueState: "reported",
      paymentMinor: 45_000,
      interestRatePpm: 62_500,
      nextPaymentDueDate: "2026-09-12",
      isOverdue: false,
      effectiveDate: "2026-08-01",
      observedAt,
      priorBalanceMinor: null,
      priorValueState: null,
      action: "new_obligation",
      issues: [],
    },
    {
      id: "liability_row_unsupported",
      naturalKeySha256: "3".repeat(64),
      source: "plaid",
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Foreign revolving line",
      kind: "credit_card",
      classification: "revolving",
      balanceMinor: null,
      valueState: "unsupported",
      paymentMinor: null,
      interestRatePpm: null,
      nextPaymentDueDate: null,
      isOverdue: null,
      effectiveDate: "2026-08-14",
      observedAt,
      priorBalanceMinor: null,
      priorValueState: null,
      action: "needs_attention",
      issues: ["Only USD liabilities are supported."],
    },
  ],
} as const;

const acceptedCard = {
  id: "liability_fact_card",
  naturalKeySha256: "1".repeat(64),
  connectionId,
  source: "plaid",
  institutionLabel: "Northstar Demo Bank",
  accountLabel: "Everyday card",
  kind: "credit_card",
  classification: "revolving",
  balanceMinor: 255_000,
  valueState: "reported",
  paymentMinor: 12_500,
  paymentTreatment: "reserve_from_liquidity",
  interestRatePpm: 219_900,
  nextPaymentDueDate: "2026-08-10",
  isOverdue: true,
  effectiveDate: "2026-07-01",
  observedAt: "2026-07-14T16:00:00.000Z",
  retrievedAt: "2026-07-14T16:00:00.000Z",
  acceptedAt: "2026-07-14T16:05:00.000Z",
  freshness: "current",
} as const;

const staleUnknownMortgage = {
  id: "liability_fact_mortgage",
  naturalKeySha256: "4".repeat(64),
  connectionId: null,
  source: "manual",
  institutionLabel: "Manual entry",
  accountLabel: "Family mortgage",
  kind: "mortgage",
  classification: "scheduled",
  balanceMinor: null,
  valueState: "unavailable",
  paymentMinor: null,
  paymentTreatment: "already_in_plan",
  interestRatePpm: null,
  nextPaymentDueDate: null,
  isOverdue: null,
  effectiveDate: "2026-05-01",
  observedAt: "2026-05-01T16:00:00.000Z",
  retrievedAt: "2026-05-01T16:00:00.000Z",
  acceptedAt: "2026-05-01T16:05:00.000Z",
  freshness: "stale",
} as const;

const pendingState = {
  version: 1,
  configured: true,
  status: "ready",
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
  acceptedLiabilities: [acceptedCard, staleUnknownMortgage],
  pendingProposals: [proposal],
  planning,
  impact: {
    liabilityCount: 2,
    totalOutstandingMinor: 255_000,
    unknownBalanceCount: 1,
    unknownPaymentCount: 1,
    overdueCount: 1,
    reservedPaymentMinor: 12_500,
    addedHouseholdBurnMinor: 0,
    netLiquidityMinor: 182_487_500,
    adjustedHouseholdBurnMonthlyMinor: 2_850_000,
    adjustedTotalBurnMonthlyMinor: 4_100_000,
    protectedRunwayMonths: 42,
    obligationAdjustedFiGapMinor: 142_512_500,
  },
  errorCode: null,
} as const;

const appliedState = {
  ...pendingState,
  acceptedLiabilities: [
    { ...acceptedCard, balanceMinor: 240_000, isOverdue: false },
    staleUnknownMortgage,
    {
      id: "liability_fact_student",
      naturalKeySha256: "2".repeat(64),
      connectionId,
      source: "plaid",
      institutionLabel: "Northstar Demo Bank",
      accountLabel: "Graduate loan",
      kind: "student_loan",
      classification: "scheduled",
      balanceMinor: 4_800_000,
      valueState: "reported",
      paymentMinor: 45_000,
      paymentTreatment: "add_to_household_burn",
      interestRatePpm: 62_500,
      nextPaymentDueDate: "2026-09-12",
      isOverdue: false,
      effectiveDate: "2026-08-01",
      observedAt,
      retrievedAt: observedAt,
      acceptedAt: "2026-08-14T16:05:00.000Z",
      freshness: "current",
    },
  ],
  pendingProposals: [],
  impact: {
    liabilityCount: 3,
    totalOutstandingMinor: 5_040_000,
    unknownBalanceCount: 1,
    unknownPaymentCount: 1,
    overdueCount: 0,
    reservedPaymentMinor: 12_500,
    addedHouseholdBurnMinor: 45_000,
    netLiquidityMinor: 182_487_500,
    adjustedHouseholdBurnMonthlyMinor: 2_895_000,
    adjustedTotalBurnMonthlyMinor: 4_145_000,
    protectedRunwayMonths: 41,
    obligationAdjustedFiGapMinor: 142_512_500,
  },
} as const;

const manualProposal = {
  id: "liability_proposal_manual",
  connectionId: null,
  institutionLabel: "Manual entry",
  source: "manual",
  status: "pending_review",
  refreshKind: "manual",
  observedAt,
  retrievedAt: observedAt,
  summary: {
    rowCount: 1,
    reportedCount: 0,
    needsAttentionCount: 0,
    notReportedCount: 0,
    totalReportedMinor: 0,
  },
  rows: [
    {
      id: "liability_row_manual",
      naturalKeySha256: "5".repeat(64),
      source: "manual",
      institutionLabel: "Manual entry",
      accountLabel: "Synthetic mortgage",
      kind: "mortgage",
      classification: "scheduled",
      balanceMinor: null,
      valueState: "unavailable",
      paymentMinor: 220_000,
      interestRatePpm: 51_250,
      nextPaymentDueDate: "2026-09-01",
      isOverdue: false,
      effectiveDate: "2026-08-14",
      observedAt,
      priorBalanceMinor: null,
      priorValueState: null,
      action: "new_obligation",
      issues: ["No outstanding balance was entered; the amount stays unknown."],
    },
  ],
} as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test(
  "reviews obligations and preserves unknown and stale states",
  { tag: captureDesignReview ? [] : "@mobile-only" },
  async ({ page, isMobile }, testInfo) => {
    const alphaResponse = await page.request.get("/api/alpha");
    expect(alphaResponse.ok()).toBe(true);
    const alphaFixture = await alphaResponse.json();
    let state: Record<string, unknown> = pendingState;
    let applyBody: Record<string, unknown> | null = null;
    let manualBody: Record<string, unknown> | null = null;

    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });
    await page.route("**/api/liabilities", async (route) => {
      await route.fulfill({ json: state });
    });
    await page.route(
      `**/api/liability-proposals/${proposalId}/apply`,
      async (route) => {
        applyBody = (await route.request().postDataJSON()) as Record<
          string,
          unknown
        >;
        state = appliedState;
        await route.fulfill({
          json: {
            proposalId,
            acceptedCount: 2,
            excludedCount: 1,
            impact: appliedState.impact,
          },
          status: 201,
        });
      },
    );
    await page.route("**/api/liability-proposals/manual", async (route) => {
      manualBody = (await route.request().postDataJSON()) as Record<
        string,
        unknown
      >;
      state = { ...appliedState, pendingProposals: [manualProposal] };
      await route.fulfill({ json: manualProposal, status: 201 });
    });

    await page.goto("/obligations");
    const pageContent = page.locator(".obligations-page");
    await expect(
      page.getByRole("heading", { name: "Accepted obligations" }),
    ).toBeVisible();
    await expect(pageContent).toContainText("Family mortgage");
    await expect(pageContent).toContainText("Unknown");
    await expect(page.getByText("Stale", { exact: true })).toBeVisible();
    await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
    await expect(pageContent).toContainText("3 checks left this month");
    await page.addStyleTag({
      content: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
    if (isMobile)
      await expect(pageContent).toHaveScreenshot("obligations-ready.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.025,
        threshold: 0.25,
      });
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Review obligations" }).click();
    const review = page.locator(".obligation-review");
    await expect(
      page.getByRole("heading", { name: "Review Northstar Demo Bank" }),
    ).toBeFocused();
    await expect(review).toContainText("Only USD liabilities are supported.");
    await expect(
      page.getByLabel("Planning treatment for Graduate loan"),
    ).toContainText("Add next payment to monthly burn");
    await review.evaluate((element) =>
      element.scrollIntoView({ block: "start", behavior: "auto" }),
    );
    if (isMobile)
      await expect(review).toHaveScreenshot("obligations-review.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.025,
        threshold: 0.25,
      });
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Apply review" }).click();
    await expect(pageContent).toContainText("Graduate loan");
    await expect(pageContent).not.toContainText(
      "Reported values are still proposals",
    );
    expect(applyBody).toEqual({
      changeNote:
        "Reviewed Northstar Demo Bank obligations and payment treatment.",
      decisions: [
        {
          rowId: "liability_row_card",
          decision: "accepted",
          paymentTreatment: "reserve_from_liquidity",
        },
        {
          rowId: "liability_row_student",
          decision: "accepted",
          paymentTreatment: "add_to_household_burn",
        },
        {
          rowId: "liability_row_unsupported",
          decision: "excluded",
          paymentTreatment: null,
        },
      ],
    });

    await page.clock.setFixedTime(new Date(observedAt));
    await page.getByRole("button", { name: "Add manually" }).click();
    const manual = page.locator(".manual-obligation");
    await manual.getByLabel("Institution").fill("Manual entry");
    await manual.getByLabel("Account label").fill("Synthetic mortgage");
    await manual.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "Mortgage" }).click();
    await manual.getByLabel("Next required payment").fill("2200");
    await manual.getByLabel("APR").fill("5.125");
    const dueDate = manual.getByRole("button", {
      name: "Next payment due",
      exact: true,
    });
    await dueDate.click();
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await page
      .getByRole("button", { name: "Tuesday, September 1, 2026", exact: true })
      .click();
    await dueDate.click();
    await page.getByRole("button", { name: "Clear date", exact: true }).click();
    await expect(dueDate).toHaveText("Choose date");
    await dueDate.click();
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await page
      .getByRole("button", { name: "Tuesday, September 1, 2026", exact: true })
      .click();
    await manual.getByRole("combobox", { name: "Payment status" }).click();
    await page.getByRole("option", { name: "Current" }).click();
    const effectiveDate = manual.getByRole("button", {
      name: "Values effective",
      exact: true,
    });
    await expect(effectiveDate).toHaveAttribute("aria-required", "true");
    await effectiveDate.click();
    await expect(
      page.getByRole("button", { name: "Clear date", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Thursday, August 13, 2026", exact: true })
      .click();
    await effectiveDate.click();
    await page
      .getByRole("button", { name: "Friday, August 14, 2026", exact: true })
      .click();
    if (captureDesignReview)
      await manual.screenshot({
        path: testInfo.outputPath("manual-obligation-dates.png"),
        animations: "disabled",
      });
    await manual.getByRole("button", { name: "Continue to review" }).click();
    await expect(
      page.getByRole("heading", { name: "Review Manual entry" }),
    ).toBeFocused();
    expect(manualBody).toEqual({
      institutionLabel: "Manual entry",
      accountLabel: "Synthetic mortgage",
      kind: "mortgage",
      balanceMinor: null,
      paymentMinor: 220_000,
      interestRatePpm: 51_250,
      nextPaymentDueDate: "2026-09-01",
      isOverdue: false,
      effectiveDate: "2026-08-14",
    });
  },
);
