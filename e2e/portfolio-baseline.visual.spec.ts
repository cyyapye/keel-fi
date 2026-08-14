import { expect, test, type Page } from "@playwright/test";

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
    unknownValueCount: 1,
    potentialDuplicateCount: 2,
  },
  positions: [
    {
      id: "holding_demo_robinhood",
      positionName: "Synthetic Public Company",
      ownerLabel: "Robinhood individual account",
      sourceLabel: "Robinhood",
      provider: "robinhood",
      classification: "public_market",
      valueMinor: 23_800_000,
      valueState: "reported",
      observedAt: "2026-08-10T16:00:00.000Z",
      ticker: "SYN",
      potentialDuplicate: true,
      duplicateWith: ["Synthetic Public Company"],
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
      potentialDuplicate: true,
      duplicateWith: ["Synthetic Public Company"],
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
      potentialDuplicate: false,
      duplicateWith: [],
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
  requiresDuplicateReview: true,
  canConfirm: true,
} as const;

const confirmationResult = {
  baseline: {
    id: "baseline_synthetic",
    sourceRevision: readyState.sourceRevision,
    observedAt: readyState.observedAt,
    summary: readyState.summary,
    priorFiEligibleLiquidMinor: 182_500_000,
    fiEligibleLiquidMinor: 200_000_000,
    forecastSnapshotId: "snap_fi_v4",
    forecastSnapshotVersion: 4,
    goalVersion: 2,
    changeNote: "Reviewed synced holdings for the FI plan.",
    createdAt: "2026-08-13T19:00:00.000Z",
    createdBy: "Demo Operator",
  },
  impact: {
    fiEligibleLiquidMinor: 200_000_000,
    fiEligibleChangeMinor: 17_500_000,
    protectedRunwayMonths: 46,
    fiGapMinor: 125_000_000,
    lowerTotalAvailableMinor: 294_000_000,
    middleTotalAvailableMinor: 410_000_000,
    higherTotalAvailableMinor: 554_000_000,
    probabilityCrossingFiPpm: 683_190,
  },
} as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test("reviews synced holdings before refreshing the FI forecast", async ({
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
        currentFiEligibleLiquidMinor: 200_000_000,
      },
      currentImpact: confirmationResult.impact,
      latestBaseline: confirmationResult.baseline,
      hasSourceChanges: false,
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
  await page.route("**/api/public-holdings/robinhood/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        status: "ready",
        lastSyncedAt: "2026-08-13T16:00:00.000Z",
        latestImportId: null,
        latestRunStatus: "succeeded",
        errorCode: null,
      },
    });
  });

  await page.goto("/holdings");
  const summary = page.locator(".portfolio-baseline");
  await expect(
    page.getByRole("heading", {
      name: "Reviewed holdings are ready for planning",
    }),
  ).toBeVisible();
  await expect(summary).toHaveScreenshot("portfolio-baseline-ready.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await page.getByRole("button", { name: "Review baseline" }).click();
  await page.getByLabel("FI-eligible liquid amount").fill("2,000,000.00");
  await page
    .getByLabel(/I reviewed the 2 possible overlapping positions/u)
    .check();
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
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Confirm baseline" }).click();
  await expect(
    page.getByRole("heading", { name: "Planning baseline is current" }),
  ).toBeVisible();
  expect(confirmationBody).toMatchObject({
    sourceRevision: readyState.sourceRevision,
    baseForecastSnapshotId: "snap_fi_v3",
    baseForecastSnapshotVersion: 3,
    fiEligibleLiquidMinor: 200_000_000,
    duplicateReviewConfirmed: true,
  });
});
