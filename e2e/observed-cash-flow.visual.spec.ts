import { expect, test, type Page } from "@playwright/test";

const planState = {
  baseCashFlowPlanId: "cash_plan_fi_v1",
  baseForecastSnapshotId: "snap_fi_v3",
  baseForecastSnapshotVersion: 3,
  values: {
    householdBurnMonthlyMinor: 2_850_000,
    businessBurnMonthlyMinor: 1_250_000,
    protectedCashFloorMinor: 10_300_000,
  },
  fiEligibleLiquidMinor: 182_500_000,
  fiTargetMinor: 325_000_000,
  forecastHorizonDate: "2031-12-31",
  impact: {
    totalMonthlyBurnMinor: 4_100_000,
    liquidAfterCashFloorMinor: 172_200_000,
    protectedRunwayMonths: 42,
  },
} as const;

const planning = {
  baseCashFlowPlanId: "cash_plan_fi_v1",
  baseForecastSnapshotId: "snap_fi_v3",
  baseForecastSnapshotVersion: 3,
  householdBurnMonthlyMinor: 2_850_000,
  businessBurnMonthlyMinor: 1_250_000,
  debtPaymentContextMonthlyMinor: 200_000,
  protectedCashFloorMinor: 10_300_000,
  fiEligibleLiquidMinor: 182_500_000,
} as const;

const categories = [
  {
    id: "cash_flow_category_food",
    category: "FOOD_AND_DRINK",
    label: "Food and drink",
    totalMinor: 9_000_000,
    averageMonthlyMinor: 3_000_000,
    transactionCount: 42,
    defaultTreatment: "household",
    reviewedTreatment: null,
  },
  {
    id: "cash_flow_category_services",
    category: "GENERAL_SERVICES",
    label: "General services",
    totalMinor: 4_500_000,
    averageMonthlyMinor: 1_500_000,
    transactionCount: 18,
    defaultTreatment: "household",
    reviewedTreatment: null,
  },
  {
    id: "cash_flow_category_loans",
    category: "LOAN_PAYMENTS",
    label: "Loan payments",
    totalMinor: 600_000,
    averageMonthlyMinor: 200_000,
    transactionCount: 3,
    defaultTreatment: "debt_payment",
    reviewedTreatment: null,
  },
] as const;

const baseProposal = {
  id: "cash_flow_proposal_demo",
  status: "pending_review",
  observedAt: "2026-08-15T16:00:00.000Z",
  periodStartMonth: "2026-05",
  periodEndMonth: "2026-07",
  transactionCount: 63,
  pendingExcludedCount: 2,
  unsupportedExcludedCount: 0,
  unreviewedAccountExcludedCount: 1,
  coveredConnectionCount: 1,
  planning,
  comparison: {
    observedHouseholdMonthlyMinor: 4_500_000,
    observedBusinessMonthlyMinor: 0,
    proposedHouseholdBurnMonthlyMinor: 4_700_000,
    proposedBusinessBurnMonthlyMinor: 0,
    householdChangeMinor: 1_850_000,
    businessChangeMinor: -1_250_000,
    totalChangeMinor: 600_000,
    currentRunwayMonths: 42,
    proposedRunwayMonths: 36,
    material: true,
  },
  months: [
    { month: "2026-05", outflowMinor: 4_650_000, transactionCount: 20 },
    { month: "2026-06", outflowMinor: 4_720_000, transactionCount: 22 },
    { month: "2026-07", outflowMinor: 4_730_000, transactionCount: 21 },
  ],
  categories,
  planSuggestion: null,
} as const;

const connection = {
  id: "cash_connection_demo",
  institutionLabel: "Northstar Demo Bank",
  status: "ready",
  acceptedAccountCount: 2,
  pricingConfirmedAt: "2026-08-15T15:00:00.000Z",
  lastCheckedAt: "2026-08-15T16:00:00.000Z",
  dailyCheckLimit: 4,
  dailyChecksUsed: 1,
  dailyChecksRemaining: 3,
} as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test("reviews observed burn and prepares the existing runway plan", async ({
  page,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = await alphaResponse.json();
  let reviewed = false;

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.route("**/api/plan-inputs", async (route) => {
    await route.fulfill({ json: planState });
  });
  await page.route("**/api/cash-flow", async (route) => {
    const reviewedProposal = {
      ...baseProposal,
      status: "ready_for_plan" as const,
      categories: categories.map((category) => ({
        ...category,
        reviewedTreatment:
          category.category === "GENERAL_SERVICES"
            ? ("business" as const)
            : category.defaultTreatment,
      })),
      comparison: {
        observedHouseholdMonthlyMinor: 3_000_000,
        observedBusinessMonthlyMinor: 1_500_000,
        proposedHouseholdBurnMonthlyMinor: 3_200_000,
        proposedBusinessBurnMonthlyMinor: 1_500_000,
        householdChangeMinor: 350_000,
        businessChangeMinor: 250_000,
        totalChangeMinor: 600_000,
        currentRunwayMonths: 42,
        proposedRunwayMonths: 36,
        material: true,
      },
      planSuggestion: {
        proposalId: "cash_flow_proposal_demo",
        householdBurnMonthlyMinor: 3_200_000,
        businessBurnMonthlyMinor: 1_500_000,
        changeNote: "Observed cash flow review: Reviewed demo categories.",
      },
    };
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        status: "review_required",
        latestOutcome: "proposal_ready",
        connections: [connection],
        pendingProposals: [reviewed ? reviewedProposal : baseProposal],
        errorCode: null,
      },
    });
  });
  await page.route("**/api/cash-flow-proposals/*/review", async (route) => {
    reviewed = true;
    await route.fulfill({
      status: 201,
      json: {
        proposalId: "cash_flow_proposal_demo",
        comparison: {
          observedHouseholdMonthlyMinor: 3_000_000,
          observedBusinessMonthlyMinor: 1_500_000,
          proposedHouseholdBurnMonthlyMinor: 3_200_000,
          proposedBusinessBurnMonthlyMinor: 1_500_000,
          householdChangeMinor: 350_000,
          businessChangeMinor: 250_000,
          totalChangeMinor: 600_000,
          currentRunwayMonths: 42,
          proposedRunwayMonths: 36,
          material: true,
        },
        planSuggestion: {
          proposalId: "cash_flow_proposal_demo",
          householdBurnMonthlyMinor: 3_200_000,
          businessBurnMonthlyMinor: 1_500_000,
          changeNote: "Observed cash flow review: Reviewed demo categories.",
        },
      },
    });
  });

  await page.goto("/scenarios");
  await page.addStyleTag({
    content:
      ".topbar { position: absolute !important; visibility: hidden !important; }",
  });
  const review = page.locator(".cash-flow-review");
  await expect(
    review.getByRole("heading", { name: "Compare burn" }),
  ).toBeVisible();
  await expect(review.getByText("Review needed")).toBeVisible();
  await expect(review.getByText("36 mo", { exact: true })).toBeVisible();
  await review
    .getByRole("combobox", { name: "General services treatment" })
    .click();
  await page.getByRole("option", { name: "Business burn" }).click();
  await expect(review).toHaveScreenshot("observed-cash-flow-review.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await review.getByRole("button", { name: "Prepare plan draft" }).click();
  await expect(review.getByText("Plan draft ready")).toBeVisible();
  const editor = page.locator(".plan-inputs-editor");
  await expect(editor.getByText("Unsaved draft")).toBeVisible();
  await expect(
    editor.getByRole("textbox", { name: /Household burn/ }),
  ).toHaveValue("32,000");
  await expect(
    editor.getByRole("textbox", { name: /Business burn/ }),
  ).toHaveValue("15,000");
  await expect(editor).toHaveScreenshot("plan-inputs-from-cash-flow.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  await expectNoHorizontalOverflow(page);
});

test(
  "confirms the shared bank deletion boundary before disconnect",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const alphaResponse = await page.request.get("/api/alpha");
    expect(alphaResponse.ok()).toBe(true);
    const alphaFixture = await alphaResponse.json();

    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });
    await page.route("**/api/plan-inputs", async (route) => {
      await route.fulfill({ json: planState });
    });
    await page.route("**/api/cash-flow", async (route) => {
      await route.fulfill({
        json: {
          version: 1,
          configured: true,
          status: "ready",
          latestOutcome: "no_material_change",
          connections: [connection],
          pendingProposals: [],
          errorCode: null,
        },
      });
    });

    let disconnectRequests = 0;
    await page.route("**/api/cash-accounts/connections/*", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      disconnectRequests += 1;
      return route.abort();
    });

    await page.goto("/scenarios");
    await page.addStyleTag({
      content:
        ".topbar { position: absolute !important; visibility: hidden !important; }",
    });
    const panel = page.locator(".cash-flow");
    await expect(panel.getByText("No proposal")).toBeVisible();
    await panel.getByRole("button", { name: "Disconnect" }).click();
    await expect(
      panel.getByText("This removes all Plaid access", { exact: false }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Disconnect bank" }),
    ).toBeVisible();
    await expect(panel).toHaveScreenshot("observed-cash-flow-disconnect.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    });
    await expectNoHorizontalOverflow(page);
    expect(disconnectRequests).toBe(0);
  },
);
