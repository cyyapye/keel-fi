import { expect, test, type Page } from "@playwright/test";

import { navigateToScreen } from "./navigation";

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
  holdings: [
    {
      id: "holding_demo_spv",
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
      sourceLabel: "AngelList export",
      effectiveDate: "2026-06-14",
      retrievedAt: "2026-06-14T12:00:00.000Z",
      confidencePpm: null,
    },
    {
      id: "holding_demo_direct",
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
    },
    {
      id: "holding_demo_locked",
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
    },
  ],
  evidenceInbox: [],
  portfolioWatch: { targets: [], observations: [] },
  scenarios: [],
  signalReconciliations: [],
  signalUpdateProposals: [],
  forecastHistory: [],
};

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
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });

  await page.goto("/");

  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Holdings/);

  const harborAction = page.getByRole("button", {
    name: "View Harbor Health Systems holding details",
  });
  await expect(harborAction.getByText("Harbor Health Systems")).toBeVisible();
  await expect(harborAction).not.toContainText("Beacon Demo SPV");
  await expect(harborAction).not.toContainText("Demo Family LLC");
  await expect(
    page.getByRole("button", {
      name: "View Northstar Robotics holding details",
    }),
  ).not.toContainText("Seed preferred");
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

  await harborAction.click();
  const detailHeading = page.getByRole("heading", {
    level: 2,
    name: "Harbor Health Systems",
  });
  await expect(detailHeading).toBeFocused();
  await expect(page.getByText("Legal SPV")).toBeVisible();
  await expect(page.getByText("Held through")).toBeVisible();
  await expect(page.getByText("Demo Family LLC")).toBeVisible();
  await expect(page.getByText("Administrator source")).toBeVisible();
  await expect(
    page.getByText("Administrator-reported value as of the source date."),
  ).toBeVisible();
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

  await page.getByRole("button", { name: "Back to holdings" }).click();
  await expect(harborAction).toBeFocused();

  await page
    .getByRole("button", {
      name: "View Lattice Grove Energy holding details",
    })
    .click();
  await expect(page.getByText("Locked by AngelList")).toBeVisible();
  await expect(
    page.getByText("AngelList did not disclose this value in the export."),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
