import { expect, test, type Page } from "./api-mocked-test";
import type {
  LegalEntityInventory,
  LegalEntitySourceSummary,
} from "../packages/domain/src/legal-entities";
import {
  InvestmentConnectionsStateSchema,
  PortfolioBaselineStateSchema,
  PrivateExposureReviewStateSchema,
} from "../packages/domain/src";
import { blockedAgreementSource } from "./agreement-security-fixtures";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { routeInvestmentReview } from "./investment-review-fixtures";

const emptyPortfolioBaseline = PortfolioBaselineStateSchema.parse({
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
});

const emptyInvestmentConnections = InvestmentConnectionsStateSchema.parse({
  version: 1,
  configured: false,
  connections: [],
  errorCode: "configuration_required",
});

const emptyPrivateExposureReviews = PrivateExposureReviewStateSchema.parse({
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
});

async function setup(page: Page, candidates: LegalEntitySourceSummary[]) {
  const inventory: LegalEntityInventory = {
    version: 3,
    asOf: "2026-09-01T12:00:00.000Z",
    entities: [],
    candidates,
    excludedCandidates: [],
    exactBatch: {
      revision: "a".repeat(64),
      sourceCount: 0,
      entityCount: 0,
      existingEntityCount: 0,
      newEntityCount: 0,
      llcEntityCount: 0,
      limitedPartnershipEntityCount: 0,
      remainingCandidateCount: candidates.length,
    },
  };
  await page.clock.setFixedTime(new Date(inventory.asOf));
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/portfolio-baseline", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: emptyPortfolioBaseline })
      : route.fallback(),
  );
  await page.route("**/api/investment-connections", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: emptyInvestmentConnections })
      : route.fallback(),
  );
  await page.route("**/api/private-exposure-reviews", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: emptyPrivateExposureReviews })
      : route.fallback(),
  );
  await page.route("**/api/legal-entities", (route) =>
    route.fulfill({ json: inventory }),
  );
  for (const source of candidates) await routeInvestmentReview(page, source);
  const downloads: string[] = [];
  await page.route("**/api/legal-entity-documents/*", (route) => {
    downloads.push(route.request().url());
    return route.fulfill({ status: 423, json: { error: "Blocked" } });
  });
  await page.goto("/holdings");
  await page.getByRole("link", { name: "Legal entities", exact: true }).click();
  await expect(page).toHaveURL(/\/holdings\/entities$/u);
  await page.getByRole("button", { name: /^Needs your review/u }).click();
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  const rows = page.locator(".legal-entity-candidate");
  await expect(rows).toHaveCount(candidates.length);
  const workspace = page.locator(".entity-review");
  const open = async (name: string) => {
    if (await workspace.isVisible())
      await workspace
        .getByRole("button", { name: "Back to legal entities", exact: true })
        .click();
    const triage = page.getByRole("button", { name: /^Needs your review/u });
    if ((await triage.getAttribute("aria-expanded")) === "false")
      await triage.click();
    await rows
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .getByRole("button", { name: "View source options", exact: true })
      .click();
    await expect(
      workspace.getByRole("tabpanel", {
        name: "Documents",
        exact: true,
      }),
    ).toBeVisible();
    await expect(workspace.getByRole("article")).toHaveCount(1);
  };
  return { rows, workspace, open, downloads };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
}

test("offers a targeted retry for legacy and incomplete checks, and explains a busy source", async ({
  page,
}) => {
  const { workspace, open, downloads } = await setup(page, [
    blockedAgreementSource(4, "Demo Legacy"),
    blockedAgreementSource(5, "Demo Scanner Setup", undefined, true),
    blockedAgreementSource(3, "Demo Energy", {
      reason: "malware_signature",
      signature: "Win.Test.EICAR_HDB-1",
    }),
  ]);
  const requests: unknown[] = [];
  let busy = true;
  await page.route("**/api/legal-entity-documents/*/recheck", (route) => {
    requests.push({
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    return route.fulfill(
      busy
        ? {
            status: 409,
            json: {
              error:
                "A source update is already queued or running. Wait for it to finish, then recheck this agreement.",
            },
          }
        : {
            status: 202,
            json: {
              version: 1,
              provider: "sydecar",
              runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              status: "queued",
            },
          },
    );
  });
  await open("Demo Energy");
  await expect(workspace).toContainText("Keep this agreement blocked");
  await expect(
    workspace.getByRole("button", { name: "demo-3-agreement.pdf" }),
  ).toHaveCount(0);
  await expect(
    workspace.getByRole("button", { name: "Recheck agreement" }),
  ).toBeEnabled();
  await expect(
    workspace.getByRole("button", { name: "Review details" }),
  ).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(workspace).toHaveScreenshot("agreement-security-threat.png", {
    animations: "disabled",
    caret: "hide",
  });
  await noOverflow(page);
  await open("Demo Scanner Setup");
  await expect(workspace).toContainText("Security check incomplete");
  await expect(
    workspace.getByRole("button", { name: "Recheck agreement" }),
  ).toBeEnabled();
  await open("Demo Legacy");
  await expect(workspace).toContainText("Alert reason unavailable");
  await workspace.getByRole("button", { name: "Recheck agreement" }).click();
  await expect(workspace).toContainText("Wait for it to finish");
  busy = false;
  await workspace.getByRole("button", { name: "Recheck agreement" }).click();
  await expect(
    workspace.getByRole("button", { name: "Check queued" }),
  ).toBeDisabled();
  await expect(workspace).toContainText(
    "The agreement stays blocked until it passes",
  );
  await expect(
    workspace.getByRole("link", { name: "View source progress" }),
  ).toHaveAttribute("href", "/holdings/sources");
  expect(requests).toEqual([
    { method: "POST", body: { provider: "sydecar" } },
    { method: "POST", body: { provider: "sydecar" } },
  ]);
  expect(downloads).toEqual([]);
  await page.mouse.move(0, 0);
  await expect(workspace).toHaveScreenshot("agreement-security-recheck.png", {
    animations: "disabled",
    caret: "hide",
  });
  await noOverflow(page);
});
