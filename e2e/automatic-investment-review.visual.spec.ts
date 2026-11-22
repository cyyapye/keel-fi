import { expect, test, type Page } from "./api-mocked-test";
import {
  type LegalEntityInventory,
  type LegalEntitySourceSummary,
} from "../packages/domain/src/legal-entities";
import { AutomaticInvestmentReviewSchema } from "../packages/domain/src/automatic-investment-review";
import {
  AcceptPositionEconomicsInputSchema,
  PositionEconomicsTermsSchema,
} from "../packages/domain/src/position-economics";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { routeInvestmentReview } from "./investment-review-fixtures";

async function setup(page: Page) {
  const sources: LegalEntitySourceSummary[] = Array.from(
    { length: 120 },
    (_, index) => ({
      source: {
        kind: "holding_position",
        id: `synthetic-auto-position-${index}`,
      },
      sourceDisplayName: `Synthetic Orchard ${index}`,
      sourceLabel: "Sydecar agreement",
      sourceAsOf: "2026-09-01",
      currentOwner: "Synthetic Family LLC",
      currentDecisionId: null,
      suggestedEntityType: "llc",
      relationship: "investment_vehicle",
      interestStatus: "current",
      financials: null,
      openedOn: null,
      legalEntityNameEvidence: {
        state: "provider_reported",
        legalName: `Synthetic Orchard ${index} SPV LLC`,
        sourceField: "Agreement",
      },
    }),
  );
  const inventory: LegalEntityInventory = {
    version: 3,
    asOf: "2026-09-01T12:00:00.000Z",
    entities: [],
    candidates: sources,
    excludedCandidates: [],
    exactBatch: {
      revision: "a".repeat(64),
      sourceCount: 0,
      entityCount: 0,
      existingEntityCount: 0,
      newEntityCount: 0,
      llcEntityCount: 0,
      limitedPartnershipEntityCount: 0,
      remainingCandidateCount: sources.length,
    },
  };
  const source = sources[0]!;
  const summary = AutomaticInvestmentReviewSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    policyVersion: "investment-review-auto-v1",
    snapshotId: "synthetic-auto-snapshot",
    evaluatedAt: "2026-09-01T12:00:00.000Z",
    resolved: ["identity", "company", "participation", "documents"],
    issues: [
      {
        section: "economics",
        code: "missing",
        message:
          "The agreement does not state the setup fee. Confirm it before applying the terms.",
      },
    ],
  });
  const fixture = await routeInvestmentReview(page, source, {
    snapshotId: summary.snapshotId,
    committedMinor: 3_710_000,
    fundedMinor: 3_710_000,
    automaticReview: summary,
    economics: {
      snapshotId: summary.snapshotId,
      currency: "USD",
      committedMinor: 3_710_000,
      fundedMinor: 3_710_000,
      acceptedTerms: null,
      reportedTerms: {
        managementFeePpm: 60_000,
        carryPpm: 175_000,
        adminFeeYears: 1,
        setupFeePpm: null,
        grossCommitmentMinor: 4_000_000,
        netInvestedMinor: 3_710_000,
        sourceLabel: "Agreement",
        observedAt: "2026-09-01T12:00:00.000Z",
      },
    },
    mappings: [
      {
        id: "synthetic-auto-mapping",
        companyId: "synthetic-orchard-company",
        companyName: "Synthetic Orchard Inc.",
        status: "active",
        decisionSource: "deterministic_policy",
      },
    ],
  });
  await routeHoldingsPage(page, {
    householdName: "Synthetic Household",
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/legal-entities", (route) =>
    route.fulfill({ json: inventory }),
  );
  let resolves = 0;
  await page.route("**/api/legal-entities/resolve", async (route) => {
    resolves++;
    const first = inventory.entities.length === 0;
    if (first) {
      inventory.entities = sources.map((item, index) => {
        item.currentDecisionId = `synthetic-decision-${index}`;
        item.automaticReview =
          index === 0
            ? summary
            : {
                ...summary,
                resolved: [
                  "identity",
                  "company",
                  "participation",
                  "economics",
                  "documents",
                ],
                issues: [],
              };
        return {
          id: `synthetic-entity-${index}`,
          versionId: `synthetic-entity-version-${index}`,
          version: 1,
          recordedAt: inventory.asOf,
          legalName: item.legalEntityNameEvidence.legalName!,
          entityType: "llc",
          relationship: "investment_vehicle",
          currentOwner: item.currentOwner,
          jurisdiction: null,
          formedOn: null,
          einLastFour: null,
          ownershipInterestPpm: null,
          interestStatus: "current",
          taxClassification: null,
          notes: null,
          sources: [item],
        };
      });
      inventory.candidates = [];
      inventory.exactBatch.remainingCandidateCount = 0;
    }
    return route.fulfill({
      json: {
        processedCount: sources.length,
        changedCount: first ? sources.length : 0,
        resolvedCount: sources.length - (summary.issues.length ? 1 : 0),
        exceptionCount: summary.issues.length ? 1 : 0,
        nextPositionId: null,
      },
    });
  });
  const termWrites: unknown[] = [];
  await page.route("**/api/investment-positions/*/economics", async (route) => {
    const input = AcceptPositionEconomicsInputSchema.parse(
      route.request().postDataJSON(),
    );
    termWrites.push(input);
    const accepted = PositionEconomicsTermsSchema.parse({
      ...input,
      id: "synthetic-corrected-terms",
      positionId: source.source.id,
      acceptedAgainstSnapshotId: summary.snapshotId,
      commitmentMinorAtAcceptance: 3_710_000,
      fundedMinorAtAcceptance: 3_710_000,
      acceptedAt: inventory.asOf,
      decisionSource: "manual",
    });
    fixture.context.economics!.acceptedTerms = accepted;
    summary.resolved = [
      "identity",
      "company",
      "participation",
      "economics",
      "documents",
    ];
    summary.issues = [];
    source.automaticReview = summary;
    fixture.context.automaticReview = summary;
    return route.fulfill({ status: 201, json: accepted });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", {
      value: undefined,
      configurable: true,
    });
  });
  const automaticResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/legal-entities/resolve"),
  );
  await page.goto("/holdings/entities");
  await automaticResponse;
  return {
    ...fixture,
    inventory,
    source,
    termWrites,
    resolves: () => resolves,
  };
}

test(
  "automatically resolves 120 legal records without making missing fees a review task",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const fixture = await setup(page);
    await expect(
      page.getByRole("heading", { name: /Needs your review/u }),
    ).toHaveCount(0);
    await expect(page.locator(".legal-entity-candidate")).toHaveCount(0);
    await expect(page.locator(".legal-entity-row")).toHaveCount(25);
    expect(fixture.inventory.entities).toHaveLength(120);
    expect(fixture.resolves()).toBe(1);
    expect(fixture.reads()).toBe(0);
    await expect(page).toHaveScreenshot("automatic-investment-exceptions.png");
    await page.addStyleTag({
      content: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
    const row = page.locator(".legal-entity-row").filter({
      has: page.getByRole("heading", {
        name: "Synthetic Orchard 0 SPV LLC",
        exact: true,
      }),
    });
    await row
      .getByRole("link", { name: "Open Synthetic Orchard 0 SPV LLC details" })
      .click();
    const review = page.getByRole("region", {
      name: "Investment review",
      exact: true,
    });
    await expect(
      review.getByText("Review complete", { exact: true }),
    ).toBeVisible();
    await expect(
      review.getByRole("tab", { name: "Investment", exact: true }),
    ).toHaveCount(0);
    await expect(
      review.getByRole("button", { name: "Edit company", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "View position in Holdings",
        exact: true,
      }),
    ).toHaveAttribute("href", "/holdings?position=synthetic-auto-position-0");
    await expect(
      review.locator(".position-economics, .position-purchases"),
    ).toHaveCount(0);
    await expect(review).toHaveScreenshot(
      "automatic-investment-missing-term.png",
    );
    expect(fixture.termWrites).toHaveLength(0);
    expect(fixture.writes).toHaveLength(0);
  },
);
