import { expect, test, type Page } from "@playwright/test";
import type { AlphaData } from "../packages/domain/src/index";
import type { PositionEconomicsTerms } from "../packages/domain/src/position-economics";
import type { PositionValueAdjustment } from "../packages/domain/src/position-value";

import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { navigateToScreen } from "./navigation";

const beaconValueContext = {
  snapshotId: "snapshot_holding_demo_spv",
  currency: "USD",
  providerValueState: "reported",
  providerValueMinor: 12_500_000,
  acceptedAdjustment: null,
} as const;

const beaconEconomicsContext = {
  snapshotId: "snapshot_holding_demo_spv",
  currency: "USD",
  committedMinor: 10_000_000,
  fundedMinor: 10_000_000,
  reportedTerms: {
    managementFeePpm: 20_000,
    carryPpm: 200_000,
    sourceLabel: "Sydecar template",
    observedAt: "2026-06-14T12:00:00.000Z",
  },
  acceptedTerms: null,
} as const;

const summitEconomicsContext = {
  snapshotId: "snapshot_holding_demo_spv_second",
  currency: "USD",
  committedMinor: 8_500_000,
  fundedMinor: 8_500_000,
  reportedTerms: {
    managementFeePpm: null,
    carryPpm: 200_000,
    sourceLabel: "AngelList export",
    observedAt: "2026-06-14T12:00:00.000Z",
  },
  acceptedTerms: null,
} as const;

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
  holdings: [
    {
      id: "holding_demo_spv",
      companyId: "company_harbor_synthetic",
      positionName: "Beacon Demo SPV",
      exposureName: "Harbor Health Systems",
      ownerLabel: "Demo Family LLC",
      positionKind: "spv_interest",
      administratorNavMinor: 12_500_000,
      administratorNavState: "reported",
      externalMarkMinor: null,
      underwritingValueMinor: null,
      scenarioValueMinor: null,
      usableLiquidityMinor: null,
      sourceStatus: "verified",
      sourceLabel: "Sydecar template",
      effectiveDate: "2026-06-14",
      retrievedAt: "2026-06-14T12:00:00.000Z",
      confidencePpm: null,
      ticker: null,
      quantityMicros: null,
      costBasisMinor: null,
      investedMinor: 10_000_000,
      committedMinor: 10_000_000,
      realizedValueMinor: 0,
      instrumentType: "spv interest",
      positionEconomicsContext: beaconEconomicsContext,
      positionValueContext: beaconValueContext,
    },
    {
      id: "holding_demo_spv_second",
      companyId: "company_harbor_synthetic",
      positionName: "Summit Demo SPV",
      exposureName: "Harbor Health Systems",
      ownerLabel: "Demo Family LLC",
      positionKind: "spv_interest",
      administratorNavMinor: 8_500_000,
      administratorNavState: "reported",
      externalMarkMinor: null,
      underwritingValueMinor: null,
      scenarioValueMinor: null,
      usableLiquidityMinor: null,
      sourceStatus: "verified",
      sourceLabel: "AngelList export",
      effectiveDate: "2026-06-14",
      retrievedAt: "2026-06-14T12:00:00.000Z",
      confidencePpm: null,
      ticker: null,
      quantityMicros: null,
      costBasisMinor: null,
      investedMinor: 8_500_000,
      committedMinor: 8_500_000,
      realizedValueMinor: 0,
      instrumentType: "spv interest",
      positionEconomicsContext: summitEconomicsContext,
    },
    {
      id: "holding_demo_direct",
      companyId: "company_northstar_synthetic",
      positionName: "Seed preferred",
      exposureName: "Northstar Robotics",
      ownerLabel: "Demo Brokerage",
      positionKind: "direct",
      administratorNavMinor: 120_000_000,
      administratorNavState: "reported",
      externalMarkMinor: 170_000_000,
      underwritingValueMinor: 78_000_000,
      scenarioValueMinor: 150_000_000,
      usableLiquidityMinor: 0,
      sourceStatus: "verified",
      sourceLabel: "Synthetic company update",
      effectiveDate: "2026-07-18",
      retrievedAt: "2026-07-18T09:00:00.000Z",
      confidencePpm: 760_000,
      ticker: null,
      quantityMicros: null,
      costBasisMinor: null,
      investedMinor: 40_000_000,
      realizedValueMinor: 0,
      instrumentType: "preferred equity",
    },
    {
      id: "holding_demo_locked",
      companyId: null,
      positionName: "Ridge Demo SPV",
      exposureName: "Lattice Grove Energy",
      ownerLabel: "Demo Operator",
      positionKind: "spv_interest",
      administratorNavMinor: null,
      administratorNavState: "locked",
      externalMarkMinor: null,
      underwritingValueMinor: null,
      scenarioValueMinor: null,
      usableLiquidityMinor: null,
      sourceStatus: "verified",
      sourceLabel: "AngelList export",
      effectiveDate: "2026-06-14",
      retrievedAt: "2026-06-14T12:00:00.000Z",
      confidencePpm: null,
      ticker: null,
      quantityMicros: null,
      costBasisMinor: null,
    },
    {
      id: "holding_demo_robinhood",
      companyId: null,
      positionName: "SYN · Synthetic Public Company",
      exposureName: "Synthetic Public Company",
      ownerLabel: "Robinhood individual account",
      positionKind: "direct",
      administratorNavMinor: 23_800_000,
      administratorNavState: "reported",
      externalMarkMinor: null,
      underwritingValueMinor: null,
      scenarioValueMinor: null,
      usableLiquidityMinor: null,
      sourceStatus: "verified",
      sourceLabel: "Plaid Investments",
      effectiveDate: "2026-08-10",
      retrievedAt: "2026-08-10T16:00:00.000Z",
      confidencePpm: null,
      ticker: "SYN",
      quantityMicros: 1_250_000_000,
      costBasisMinor: 18_250_000,
    },
  ],
  evidenceInbox: [],
  portfolioWatch: { targets: [], observations: [] },
  scenarios: [],
  signalReconciliations: [],
  signalUpdateProposals: [],
  forecastHistory: [],
} satisfies AlphaData;

const reviewedCompanyFixtures = [
  {
    id: "company_harbor_synthetic",
    legalName: "Harbor Health Systems",
    websiteHost: "harbor-health.example",
    status: "active",
  },
  {
    id: "company_lattice_synthetic",
    legalName: "Lattice Grove Energy",
    websiteHost: "lattice-grove.example",
    status: "active",
  },
  ...Array.from({ length: 48 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");

    return {
      id: `company_review_${suffix}_synthetic`,
      legalName: `Synthetic Review Company ${suffix}`,
      websiteHost: `review-${suffix}.example`,
      status: "active",
    };
  }),
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test("leads with the investment and opens a truthful holding detail", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  let exposureResolved = false;
  let acceptedValueAdjustment: PositionValueAdjustment | null = null;
  let acceptedEconomicsTerms: PositionEconomicsTerms | null = null;
  const currentHoldings = () =>
    alphaFixture.holdings.map((holding) => {
      if (holding.id === "holding_demo_spv") {
        return {
          ...holding,
          externalMarkMinor: acceptedValueAdjustment?.valueMinor ?? null,
          positionValueContext: {
            ...beaconValueContext,
            acceptedAdjustment: acceptedValueAdjustment,
          },
          positionEconomicsContext: {
            ...beaconEconomicsContext,
            acceptedTerms: acceptedEconomicsTerms,
          },
        };
      }
      if (holding.id === "holding_demo_spv_second") {
        return {
          ...holding,
          positionEconomicsContext: summitEconomicsContext,
        };
      }
      if (holding.id === "holding_demo_locked") {
        return {
          ...holding,
          companyId: exposureResolved ? "company_lattice_synthetic" : null,
        };
      }
      return holding;
    });
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({
      json: {
        ...alphaFixture,
        holdings: currentHoldings(),
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
        lastSeenAt: "2026-08-09T16:00:00.000Z",
        lastCompletedAt: null,
        nextRunAt: "2026-08-16T16:00:00.000Z",
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
  await page.route("**/api/holding-imports", async (route) => {
    await route.fulfill({ json: [] });
  });
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
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({
      json: investmentHoldingsViewFor(currentHoldings()),
    });
  });
  await routeHoldingsPage(page, () => ({
    householdName: alphaFixture.dashboard.householdName,
    holdings: currentHoldings(),
    investmentHoldings: investmentHoldingsViewFor(currentHoldings()),
    acceptedCashAccounts: [],
    pendingImports: [],
  }));
  await page.route(
    "**/api/investment-positions/holding_demo_spv/value-adjustments",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        expectedSnapshotId: "snapshot_holding_demo_spv",
        expectedAdjustmentId: null,
        valueMinor: 15_000_000,
        currency: "USD",
        effectiveDate: "2026-08-18",
        sourceKind: "news_article",
        sourceLabel: "Synthetic Health Journal",
        sourceUrl: "https://news.example/harbor-mark",
        commentary: "A secondary transaction supports this position mark.",
      });
      acceptedValueAdjustment = {
        id: "adjustment_holding_demo_spv",
        positionId: "holding_demo_spv",
        snapshotId: "snapshot_holding_demo_spv",
        priorValueState: "reported",
        priorValueMinor: 12_500_000,
        valueMinor: 15_000_000,
        currency: "USD",
        effectiveDate: "2026-08-18",
        sourceKind: "news_article",
        sourceLabel: "Synthetic Health Journal",
        sourceUrl: "https://news.example/harbor-mark",
        commentary: "A secondary transaction supports this position mark.",
        acceptedAt: "2026-08-19T12:00:00.000Z",
      };
      await route.fulfill({ status: 201, json: acceptedValueAdjustment });
    },
  );
  await page.route(
    "**/api/investment-positions/holding_demo_spv/economics",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        expectedSnapshotId: "snapshot_holding_demo_spv",
        expectedCommitmentMinor: 10_000_000,
        expectedTermsId: null,
        capitalBasis: "gross_commitment",
        grossCommitmentMinor: null,
        setupFeePpm: 0,
        annualAdminFeePpm: 20_000,
        adminFeeYears: 1,
        carryPpm: 200_000,
        note: "Reviewed synthetic SPV subscription terms.",
      });
      acceptedEconomicsTerms = {
        id: "economics_holding_demo_spv",
        positionId: "holding_demo_spv",
        acceptedAgainstSnapshotId: "snapshot_holding_demo_spv",
        commitmentMinorAtAcceptance: 10_000_000,
        fundedMinorAtAcceptance: 10_000_000,
        capitalBasis: "gross_commitment",
        grossCommitmentMinor: null,
        setupFeePpm: 0,
        annualAdminFeePpm: 20_000,
        adminFeeYears: 1,
        carryPpm: 200_000,
        note: "Reviewed synthetic SPV subscription terms.",
        acceptedAt: "2026-08-24T12:00:00.000Z",
      };
      await route.fulfill({ status: 201, json: acceptedEconomicsTerms });
    },
  );
  await page.route("**/api/private-exposure-reviews", async (route) => {
    await route.fulfill({
      json: {
        version: 2,
        positions: exposureResolved
          ? []
          : [
              {
                positionId: "holding_demo_locked",
                snapshotId: "snapshot_holding_demo_locked",
                legalVehicleName: "Ridge Demo SPV",
                reportedExposureName: "Lattice Grove Energy",
                positionKind: "spv_interest",
                ownerLabel: "Demo Operator",
                observedAt: "2026-06-14T12:00:00.000Z",
              },
            ],
        companies: reviewedCompanyFixtures,
        exactBatch: {
          revision: (exposureResolved ? "b" : "a").repeat(64),
          positionCount: exposureResolved ? 0 : 1,
          companyCount: exposureResolved ? 0 : 1,
          existingCompanyCount: exposureResolved ? 0 : 1,
          newCompanyCount: 0,
          excludedPositionCount: 0,
        },
      },
    });
  });
  await page.route(
    "**/api/private-exposure-reviews/exact-batch",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: "a".repeat(64),
      });
      exposureResolved = true;
      await route.fulfill({
        status: 201,
        json: {
          version: 1,
          assignedPositionCount: 1,
          companyCount: 1,
          existingCompanyCount: 1,
          createdCompanyCount: 0,
          remainingPositionCount: 0,
        },
      });
    },
  );
  await page.route(
    "**/api/private-exposure-reviews/*/assign",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        expectedSnapshotId: "snapshot_holding_demo_locked",
        company: {
          mode: "existing",
          companyId: "company_lattice_synthetic",
        },
      });
      exposureResolved = true;
      await route.fulfill({
        status: 201,
        json: {
          version: 1,
          positionId: "holding_demo_locked",
          companyId: "company_lattice_synthetic",
          companyName: "Lattice Grove Energy",
          exposureId: "exposure_holding_demo_locked",
          mappingId: "mapping_holding_demo_locked",
        },
      });
    },
  );
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

  await page.clock.setFixedTime(new Date("2026-08-24T12:00:00.000Z"));
  await page.goto("/");

  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  const exposureView = page.locator(".investment-views");
  await expect(exposureView.getByRole("tab")).toHaveCount(0);
  await expect(
    exposureView.locator(".investment-views__heading"),
  ).toContainText("3 exposures");
  await expect(
    exposureView.locator(".investment-views__heading"),
  ).toContainText("5 legal positions");
  const harborExposure = page.locator(".exposure-group").filter({
    has: page.getByText("Harbor Health Systems", { exact: true }),
  });
  const northstarExposure = page.locator(".exposure-group").filter({
    has: page.getByText("Northstar Robotics", { exact: true }),
  });
  const publicExposure = page.locator(".exposure-group").filter({
    has: page.locator(
      '.exposure-group__summary strong[title="Synthetic Public Company"]',
    ),
  });
  await harborExposure.locator(".exposure-group__summary").click();
  await northstarExposure.locator(".exposure-group__summary").click();
  await publicExposure.locator(".exposure-group__summary").click();
  await expect(
    harborExposure.locator(".exposure-group__summary"),
  ).toContainText("$185k · +14%");
  await expect(
    publicExposure.locator(".exposure-group__summary"),
  ).toContainText("$183k · $190.4 · +30%");
  await expect(
    publicExposure.locator(
      ".exposure-group__summary .exposure-group__market-meta",
    ),
  ).toHaveAttribute("title", "Share price as of Aug 10, 2026");
  await expect(
    publicExposure.locator(".exposure-group__summary"),
  ).not.toContainText("Cost basis");
  await expect(
    publicExposure.locator(".exposure-group__summary"),
  ).not.toContainText("Return");
  await expect(
    harborExposure.locator(".exposure-group__summary"),
  ).not.toContainText("Cost basis");
  await expect(
    harborExposure.locator(".exposure-group__summary"),
  ).not.toContainText("Return");
  expect(
    await page.locator(".exposure-group__performance").evaluateAll((elements) =>
      elements.map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      }),
    ),
  ).toEqual([1, 1, 1]);
  await expect(
    northstarExposure.locator(".exposure-group__summary"),
  ).toContainText("$400k · +200%");
  const harborAction = page.getByRole("button", {
    name: "View Beacon Demo SPV holding details",
  });
  await expect(harborAction).toHaveAttribute("data-slot", "text-link");
  await expect(harborAction.getByText("View details")).toBeVisible();
  await expect(
    page.getByText("Beacon Demo SPV", { exact: true }),
  ).toBeVisible();
  await expect(harborExposure).not.toContainText("Demo Family LLC");
  await expect(
    page.getByRole("button", {
      name: "View Seed preferred holding details",
    }),
  ).toContainText("View details");
  await expect(
    page.getByRole("heading", { name: "Company holdings" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Administrator-reported value as of the source date."),
  ).toHaveCount(0);
  await expect(page.getByText("Verified")).toHaveCount(0);
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
    "holdings-overview.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page.reload({ waitUntil: "networkidle" });
  await navigateToScreen(page, mobile, /Holdings/);
  await page.addStyleTag({
    content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
  });
  await expect(harborExposure).toContainText("2 positions");
  await harborExposure.locator(".exposure-group__summary").click();
  await expect(harborExposure.getByText("Beacon Demo SPV")).toBeVisible();
  await expect(harborExposure.getByText("Summit Demo SPV")).toBeVisible();
  await expect(
    page.locator(".exposure-group").filter({
      has: page.getByText("Lattice Grove Energy", { exact: true }),
    }),
  ).toHaveCount(0);
  await expect(
    page.locator(".unallocated-positions").getByText("Ridge Demo SPV"),
  ).toBeVisible();
  await expect(page.locator(".unallocated-positions__status")).toContainText(
    "Company unresolved",
  );
  const chooseCompany = page.getByRole("button", {
    name: "Choose company for Ridge Demo SPV",
  });
  await expect(chooseCompany).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holdings-reviewed-private-exposures.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await chooseCompany.click();
  const exposureReview = page.getByRole("form", {
    name: "Assign Ridge Demo SPV exposure",
  });
  await expect(
    exposureReview.getByRole("heading", {
      name: "Choose the underlying company",
    }),
  ).toBeVisible();
  await expect(exposureReview).toContainText(
    "The legal position and value stay unchanged.",
  );
  const companySelect = exposureReview.getByRole("combobox", {
    name: "Company",
    exact: true,
  });
  await companySelect.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    window.scrollBy({
      top: rect.bottom - window.innerHeight + 16,
    });
  });
  await companySelect.click();
  const companyList = page.locator(".select-list");
  await expect(companyList).toBeVisible();
  const companyListMetrics = await companyList.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return {
      bottom: rect.bottom,
      clientHeight: element.clientHeight,
      overflowY: window.getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      top: rect.top,
      viewportHeight: window.innerHeight,
    };
  });
  expect(companyListMetrics.top).toBeGreaterThanOrEqual(0);
  expect(companyListMetrics.bottom).toBeLessThanOrEqual(
    companyListMetrics.viewportHeight,
  );
  expect(companyListMetrics.overflowY).toBe("auto");
  expect(companyListMetrics.scrollHeight).toBeGreaterThan(
    companyListMetrics.clientHeight,
  );
  await companyList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const companyListBottom = await companyList.evaluate(
    (element) => element.scrollTop,
  );
  expect(companyListBottom).toBeGreaterThan(0);
  await companyList.hover();
  await page.mouse.wheel(0, -480);
  await expect
    .poll(() => companyList.evaluate((element) => element.scrollTop))
    .toBeLessThan(companyListBottom);
  await companyList.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.mouse.move(1, 1);
  await page.keyboard.press("Home");
  await expect(page).toHaveScreenshot(
    "holdings-private-exposure-company-menu.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await page
    .getByRole("option", {
      name: "Lattice Grove Energy · lattice-grove.example",
    })
    .click();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holdings-private-exposure-review.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await exposureReview.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Assign 1 exact match" }).click();
  await expect(
    page.getByText(
      "1 position now groups under 1 company. Legal positions and values stayed unchanged.",
    ),
  ).toBeVisible();
  const latticeExposure = page.locator(".exposure-group").filter({
    has: page.getByText("Lattice Grove Energy", { exact: true }),
  });
  await expect(latticeExposure).toContainText("1 position");
  await latticeExposure.locator(".exposure-group__summary").click();
  await expect(latticeExposure.getByText("Ridge Demo SPV")).toBeVisible();
  await expect(
    page.locator(".unallocated-positions").getByText("Ridge Demo SPV"),
  ).toHaveCount(0);

  const summitAction = page.getByRole("button", {
    name: "View Summit Demo SPV holding details",
  });
  await summitAction.click();
  await expect(
    page.getByText("Summit Demo SPV", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Management fee is not included in this source.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".position-economics__values").getByText("20.0%", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review fee & carry" }).click();
  await expect(page.getByLabel("Management fee rate")).toHaveValue("");
  await expect(page.getByLabel("Fee term")).toHaveValue("");
  await expect(page.getByLabel("Carry")).toHaveValue("20");
  await expect(
    page.getByText(
      "Management fee is not included in this source. Confirm it against the deal documents before accepting.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review terms" }),
  ).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-spv-economics-carry-only-form.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(page.locator(".holding-detail-workspace")).toHaveCount(0);
  await expect(harborExposure).toBeVisible();
  const reopenedHarborAction = harborExposure.getByRole("button", {
    name: "View Beacon Demo SPV holding details",
  });
  await expect
    .poll(async () => {
      if (await reopenedHarborAction.isVisible()) {
        return true;
      }
      const isOpen =
        (await harborExposure
          .locator(".exposure-group__summary")
          .getAttribute("aria-expanded")) === "true";
      if (!isOpen) {
        await harborExposure.locator(".exposure-group__summary").click();
      }
      return reopenedHarborAction.isVisible();
    })
    .toBe(true);
  await expect(reopenedHarborAction).toBeVisible();

  await reopenedHarborAction.click();
  const detailHeading = page.getByRole("heading", {
    level: 2,
    name: "Harbor Health Systems",
  });
  await expect(detailHeading).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Back to holdings" }),
  ).toHaveAttribute("data-slot", "text-link");
  await expect(page.getByText("Legal SPV")).toBeVisible();
  await expect(page.getByText("Held through")).toBeVisible();
  await expect(page.getByText("Demo Family LLC")).toBeVisible();
  await expect(page.getByText("Imported source")).toBeVisible();
  await expect(
    page.getByText(
      "Reviewed value copied into the provider template as of the source date.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Imported amount", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".position-economics__values").getByText("$100k"),
  ).toHaveCount(2);
  await expect(page.getByText("Source confidence")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-detail.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page.getByRole("button", { name: "Review fee & carry" }).click();
  const adminFeeRate = page.getByLabel("Management fee rate");
  await expect(adminFeeRate).toHaveAttribute("data-slot", "input");
  await expect(adminFeeRate).toHaveValue("2");
  await expect(page.getByLabel("Fee term")).toHaveValue("");
  await expect(page.getByLabel("Carry")).toHaveValue("20");
  await adminFeeRate.focus();
  await expect(adminFeeRate).toHaveCSS("box-shadow", "none");
  await expect(
    page.getByLabel("Management fee rate").locator("xpath=.."),
  ).toHaveCSS("border-bottom-color", "rgb(38, 34, 56)");
  await page
    .getByRole("combobox", { name: "Imported amount", exact: true })
    .click();
  await page
    .getByRole("option", {
      name: "Before fees · gross commitment",
      exact: true,
    })
    .click();
  await page.getByLabel("Fee term").fill("1");
  await page
    .getByLabel("What changed")
    .fill("Reviewed synthetic SPV subscription terms.");
  await expect(
    page.getByRole("button", { name: "Review terms", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Setup fee", { exact: true }).fill("0");
  await adminFeeRate.focus();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-spv-economics-form.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await page.getByRole("button", { name: "Review terms" }).click();
  const economicsReview = page.locator(".position-economics__review");
  await expect(economicsReview).toContainText("2.0% · $2k");
  await expect(economicsReview).toContainText("$100k");
  await expect(economicsReview).toContainText("$98k");
  await expect(economicsReview).toContainText("20.0%");
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-spv-economics-review.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await page.getByRole("button", { name: "Accept terms" }).click();
  await expect(page.getByText("SPV fee and carry terms accepted.")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Update fee & carry" }),
  ).toBeVisible();
  await expect(
    page.locator(".position-economics__values").getByText("$98k"),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-spv-economics-accepted.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page.getByRole("button", { name: "Add value evidence" }).click();
  await page.getByLabel("Value · USD").fill("150000");
  await page.getByRole("button", { name: "As of", exact: true }).click();
  const valueDateCalendar = page.getByRole("dialog", {
    name: "As of calendar",
  });
  await expect(valueDateCalendar).toBeVisible();
  await expect(valueDateCalendar).toContainText("August 2026");
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-value-evidence-calendar.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await valueDateCalendar
    .getByRole("button", { name: "Tuesday, August 18, 2026" })
    .click();
  await expect(
    page.getByRole("button", { name: "As of", exact: true }),
  ).toContainText("Aug 18, 2026");
  await page
    .getByRole("combobox", { name: "Position value source type" })
    .click();
  await page.getByRole("option", { name: "News article" }).click();
  await page.getByLabel("Source name").fill("Synthetic Health Journal");
  await page.getByLabel("Source link").fill("https://news.example/harbor-mark");
  await page
    .getByLabel("What this value reflects")
    .fill("A secondary transaction supports this position mark.");
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-value-evidence-form.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await page.getByRole("button", { name: "Review value" }).click();
  await expect(
    page.locator(".position-value-adjustment__review"),
  ).toContainText("$125k → $150k");
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-value-evidence-review.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await page.getByRole("button", { name: "Accept value" }).click();
  await expect(
    page.getByText(
      "Reviewed value accepted. Exposure totals now use this mark.",
    ),
  ).toBeVisible();
  const reviewedMark = page.locator(".holding-reviewed-mark");
  await expect(reviewedMark).toContainText("Synthetic Health Journal");
  await expect(reviewedMark).toContainText("$150k");
  await expect(
    reviewedMark.getByRole("link", { name: "Open source" }),
  ).toHaveAttribute("href", "https://news.example/harbor-mark");
  await expect(
    reviewedMark.getByRole("link", { name: "Open source" }),
  ).toHaveAttribute("data-slot", "text-link");
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-value-evidence-accepted.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(harborAction).toBeFocused();
  await expect(harborExposure).toContainText("$240k");
  await expect(
    harborExposure.locator(".exposure-group__summary"),
  ).toContainText("$183k · +28%");
  await expect(
    harborExposure.locator(".exposure-group__summary"),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    latticeExposure.locator(".exposure-group__summary"),
  ).toHaveAttribute("aria-expanded", "false");
  const adjustedBeaconPosition = harborExposure
    .locator(".exposure-group__positions article")
    .filter({ hasText: "Beacon Demo SPV" });
  await expect(
    adjustedBeaconPosition.locator(".position-row__value"),
  ).toHaveAttribute("title", "Reviewed mark as of Aug 18, 2026");
  await expect(adjustedBeaconPosition).not.toContainText("Reviewed mark");

  await latticeExposure.locator(".exposure-group__summary").click();
  await page
    .getByRole("button", {
      name: "View Ridge Demo SPV holding details",
    })
    .click();
  await expect(page.getByText("Locked by AngelList")).toBeVisible();
  await expect(
    page.getByText("AngelList did not disclose this value in the export."),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Back to holdings" }).click();
  await publicExposure.locator(".exposure-group__summary").click();
  await page
    .getByRole("button", {
      name: "View SYN holding details",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Brokerage source" }),
  ).toBeVisible();
  await expect(page.getByText("1,250")).toBeVisible();
  await expect(
    page.getByText("Brokerage-reported market value as of the source date."),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-detail-robinhood.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
});
