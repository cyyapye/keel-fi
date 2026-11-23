import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "./api-mocked-test";
import type { PositionEconomicsTerms } from "../packages/domain/src/position-economics";
import type { PositionValueAdjustment } from "../packages/domain/src/position-value";

import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { navigateToScreen } from "./navigation";

import {
  beaconValueContext,
  beaconEconomicsContext,
  summitEconomicsContext,
  alphaFixture,
} from "./holdings-detail-fixtures";

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
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

async function checkOverviewAndAssignMatch(
  page: Page,
  harborExposure: Locator,
  harborAction: Locator,
) {
  const northstarExposure = page.locator(".exposure-group").filter({
    has: page.getByText("Northstar Robotics", { exact: true }),
  });
  const publicExposure = page.locator(".exposure-group").filter({
    has: page.locator(
      '.exposure-group__summary strong[title="Synthetic Public Company"]',
    ),
  });
  await northstarExposure.locator(".exposure-group__summary").click();
  await publicExposure.locator(".exposure-group__summary").click();
  await expect(
    harborExposure.locator(".exposure-group__summary"),
  ).not.toContainText("%");
  await expect(
    harborExposure.locator(".exposure-group__performance"),
  ).toHaveCount(0);
  await expect(
    publicExposure.locator(".exposure-group__summary"),
  ).toContainText("Basis $183k · +30% total return");
  await expect(publicExposure.locator(".exposure-group__quote")).toHaveText(
    "$190.4/share · Aug 10, 2026",
  );
  await expect(publicExposure.getByText(/\$190\.4\/share/u)).toHaveCount(1);
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
        const styles = window.getComputedStyle(element);
        return {
          fitsWidth: element.scrollWidth <= element.clientWidth,
          fitsThreeLines:
            element.getBoundingClientRect().height <=
            Number.parseFloat(styles.lineHeight) * 3 + 1,
        };
      }),
    ),
  ).toEqual([
    { fitsWidth: true, fitsThreeLines: true },
    { fitsWidth: true, fitsThreeLines: true },
  ]);
  await expect(
    northstarExposure.locator(".exposure-group__summary"),
  ).toContainText("Basis $400k · +200% total return");

  await expect(harborAction).toHaveAttribute("data-slot", "text-link");
  await expect(harborAction.locator('svg[aria-hidden="true"]')).toBeVisible();
  await expect(harborAction).toHaveText("");
  const actionBounds = await harborAction.boundingBox();
  expect(actionBounds?.width).toBeGreaterThanOrEqual(44);
  expect(actionBounds?.height).toBeGreaterThanOrEqual(44);
  await expect(
    page.getByText("Beacon Demo SPV", { exact: true }),
  ).toBeVisible();
  await expect(harborExposure).not.toContainText("Demo Family LLC");
  await expect(
    page.getByRole("link", {
      name: "View Seed preferred holding details",
    }),
  ).toBeVisible();
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

  await page.reload();
  await expect(page).toHaveURL(/\/holdings$/u);
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
  const resolutionTab = page.getByRole("tab", { name: "Needs resolution (1)" });
  const resolution = page.getByRole("tabpanel", { name: /^Needs resolution/u });
  await resolutionTab.click();
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
  await page.getByRole("button", { name: "Assign 1 exact match" }).click();
  await expect(
    page.getByText(
      "1 position now groups under 1 company. Legal positions and values stayed unchanged.",
    ),
  ).toBeVisible();
  await expect(
    resolution.getByText("Awaiting valuation", { exact: true }),
  ).toBeVisible();
  await expect(
    resolution.getByRole("button", {
      name: "Choose company for Ridge Demo SPV",
    }),
  ).toHaveCount(0);
  if (process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1") {
    await page.locator(".investment-views").screenshot({
      path: test.info().outputPath("review-resolution-complete.png"),
      animations: "disabled",
      scale: "css",
      style: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
  }
  await page.getByRole("tab", { name: "All exposures" }).click();
  await expect(
    page.locator(".exposure-group").filter({
      has: page.getByText("Lattice Grove Energy", { exact: true }),
    }),
  ).toHaveCount(1);
  await expect
    .poll(async () => {
      if (await harborAction.isVisible()) {
        return true;
      }
      const isOpen =
        (await harborExposure
          .locator(".exposure-group__summary")
          .getAttribute("aria-expanded")) === "true";
      if (!isOpen) {
        await harborExposure.locator(".exposure-group__summary").click();
      }
      return harborAction.isVisible();
    })
    .toBe(true);
  await expect(harborAction).toBeVisible();
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
        purchaseFee: null,
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
  const allTab = exposureView.getByRole("tab", { name: "All exposures" });
  const resolutionTab = exposureView.getByRole("tab", {
    name: "Needs resolution (1)",
  });
  await expect(allTab).toHaveAttribute("aria-selected", "true");
  await expect(exposureView.locator(".exposure-group")).toHaveCount(4);
  await resolutionTab.click();
  const review = exposureView.getByRole("tabpanel", {
    name: /^Needs resolution/u,
  });
  const chooseCompany = review.getByRole("button", {
    name: "Choose company for Ridge Demo SPV",
  });
  await expect(chooseCompany).toBeVisible();
  await expect(
    review.getByRole("link", { name: "View Ridge Demo SPV holding details" }),
  ).toBeVisible();
  if (process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1") {
    await exposureView.screenshot({
      path: testInfo.outputPath("review-positions-with-assignment.png"),
      animations: "disabled",
      scale: "css",
      style: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
  }
  await chooseCompany.click();
  const assignment = review.getByRole("form", {
    name: "Assign Ridge Demo SPV exposure",
  });
  await expect(assignment).toBeVisible();
  await assignment
    .getByRole("radio", { name: "Create a reviewed company" })
    .check();
  const companyName = assignment.getByRole("textbox", { name: "Company name" });
  await companyName.fill("Synthetic Cedar Labs");
  await allTab.click();
  await expect(assignment).toBeHidden();
  await resolutionTab.click();
  await expect(companyName).toHaveValue("Synthetic Cedar Labs");
  await assignment.getByRole("button", { name: "Cancel" }).click();
  await expect(chooseCompany).toBeVisible();
  await allTab.click();
  const harborExposure = page.locator(".exposure-group").filter({
    has: page.getByText("Harbor Health Systems", { exact: true }),
  });
  const harborAction = page.getByRole("link", {
    name: "View Beacon Demo SPV holding details",
  });
  await harborExposure.locator(".exposure-group__summary").click();
  if (mobile) {
    await page.addStyleTag({
      content: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
  } else {
    await checkOverviewAndAssignMatch(page, harborExposure, harborAction);
  }
  await harborAction.click();
  const detailHeading = page.getByRole("heading", {
    level: 2,
    name: "Harbor Health Systems",
  });
  await expect(detailHeading).toBeFocused();
  await expect(detailHeading).toHaveCSS("box-shadow", "none");
  await expect(detailHeading).toHaveCSS("outline-style", "none");
  await expect(
    page.getByRole("button", { name: "Back to holdings" }),
  ).toHaveAttribute("data-slot", "text-link");
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holding-detail-summary.png",
    { animations: "disabled", caret: "hide" },
  );
  if (!mobile) {
    await page.getByRole("button", { name: /^Fees & carry/ }).click();
    await expect(page.getByText("Allocation", { exact: true })).toBeVisible();
    await expect(
      page.locator(".position-economics__rows").getByText("$100k"),
    ).toHaveCount(1);
    await expect(page.getByText("Source confidence")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
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
    await expect(
      page.getByText("SPV fee and carry terms accepted."),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Update fee & carry" }),
    ).toBeVisible();
    await expect(
      page.locator(".position-economics__rows").getByText("$98k"),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } else {
    await page.getByRole("button", { name: /^Value & return/ }).click();
    await page.getByRole("button", { name: "Add value evidence" }).click();
    await page.getByLabel("Value · $").fill("150000");
    const valueDateTrigger = page.getByRole("button", {
      name: "As of",
      exact: true,
    });
    await valueDateTrigger.click();
    const valueDateCalendar = page.getByRole("dialog", {
      name: "As of calendar",
    });
    await expect(valueDateCalendar).toBeVisible();
    await expect(valueDateCalendar).toContainText("August 2026");
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
    await page
      .getByLabel("Source link")
      .fill("https://news.example/harbor-mark");
    await page
      .getByLabel("What this value reflects")
      .fill("A secondary transaction supports this position mark.");
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Review value" }).click();
    await expect(
      page.locator(".position-value-adjustment__review"),
    ).toContainText("$125k → $150k");
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Accept value" }).click();
    await expect(
      page.getByText(
        "Reviewed value accepted. Exposure totals now use this mark.",
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^Ownership, sources & history/u })
      .click();
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
  }
  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(harborAction).toBeFocused();
  await expect(harborExposure).toContainText(mobile ? "$235,000" : "$210,000");
  await expect(
    harborExposure.locator(".exposure-group__summary"),
  ).not.toContainText("%");
  await expect(
    harborExposure.locator(".exposure-group__summary"),
  ).toHaveAttribute("aria-expanded", "true");
  if (mobile) {
    const adjustedBeaconPosition = harborExposure
      .locator(".exposure-group__positions article")
      .filter({ hasText: "Beacon Demo SPV" });
    await expect(
      adjustedBeaconPosition.locator(".position-row__value"),
    ).toHaveAttribute("title", "Reviewed mark as of Aug 18, 2026");
    await expect(adjustedBeaconPosition).toContainText("Reviewed mark");
  }
});
