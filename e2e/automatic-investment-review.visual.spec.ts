import { expect, test, type Page } from "@playwright/test";
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
import {
  routeInvestmentReview,
  selectReviewSection,
} from "./investment-review-fixtures";

async function setup(page: Page, failed = false) {
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
      remainingCandidateCount: 120,
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
    if (failed)
      return route.fulfill({
        status: 503,
        json: {
          error:
            "Automatic review could not finish. Your saved records are available.",
        },
      });
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
        processedCount: 120,
        changedCount: first ? 120 : 0,
        resolvedCount: summary.issues.length ? 119 : 120,
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
  await page.goto("/holdings/entities");
  return {
    ...fixture,
    inventory,
    source,
    termWrites,
    resolves: () => resolves,
  };
}

test("automatically resolves 120 sources, shows only the missing term and preserves an editable record", async ({
  page,
}) => {
  const fixture = await setup(page);
  await expect(
    page.getByRole("heading", { name: /Needs your review/u }),
  ).toBeVisible();
  await expect(page.locator(".legal-entity-candidate")).toHaveCount(1);
  expect(fixture.resolves()).toBe(1);
  expect(fixture.reads()).toBe(0);
  await expect(
    page.getByText(
      "The agreement does not state the setup fee. Confirm it before applying the terms.",
    ),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("automatic-investment-exceptions.png");
  await page.getByRole("button", { name: "Review terms", exact: true }).click();
  const review = page.getByRole("region", {
    name: "Investment review",
    exact: true,
  });
  await expect(
    review.getByRole("heading", { name: "SPV economics" }),
  ).toBeVisible();
  await review
    .getByRole("button", { name: "Review fee & carry", exact: true })
    .click();
  await expect(
    review.getByLabel("Management fee rate", { exact: true }),
  ).toHaveValue("6");
  await expect(review.getByLabel("Fee term", { exact: true })).toHaveValue("1");
  await expect(review.getByLabel("Carry", { exact: true })).toHaveValue("17.5");
  await expect(review.getByLabel("Setup fee", { exact: true })).toHaveValue("");
  await expect(
    review.getByLabel("Gross commitment · USD", { exact: true }),
  ).toHaveValue("40000.00");
  await expect(review.locator(".position-economics__form")).toHaveScreenshot(
    "automatic-investment-missing-term.png",
  );
  await review.getByLabel("Setup fee", { exact: true }).fill("1.25");
  await review.getByLabel("Carry", { exact: true }).fill("12.5");
  await review
    .getByLabel("What changed", { exact: true })
    .fill("Confirmed the synthetic setup fee.");
  await review
    .getByRole("button", { name: "Review terms", exact: true })
    .click();
  await review
    .getByRole("button", { name: "Accept terms", exact: true })
    .click();
  await expect(
    review.getByRole("button", { name: "Update fee & carry", exact: true }),
  ).toBeVisible();
  expect(fixture.termWrites).toHaveLength(1);
  expect(fixture.writes).toHaveLength(0);
  await page
    .getByRole("button", { name: "Back to legal entities", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Needs your review/u }),
  ).toHaveCount(0);
  const row = page.locator(".legal-entity-row").filter({
    has: page.getByRole("heading", {
      name: "Synthetic Orchard 0 SPV LLC",
      exact: true,
    }),
  });
  await row.getByRole("button").click();
  await selectReviewSection(page, "Investment");
  await review
    .getByRole("button", { name: "Update fee & carry", exact: true })
    .click();
  await expect(review.getByLabel("Setup fee", { exact: true })).toHaveValue(
    "1.25",
  );
  await expect(review.getByLabel("Carry", { exact: true })).toHaveValue("12.5");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("keeps the inventory accessible after a failed automatic review without background retries", async ({
  page,
}) => {
  const fixture = await setup(page, true);
  await expect(
    page.getByText(
      "Automatic review could not finish. Your saved records are available.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add entity", exact: true }),
  ).toBeVisible();
  expect(fixture.resolves()).toBe(1);
  await expect(page).toHaveScreenshot("automatic-investment-retry.png");
  await page
    .getByRole("button", { name: "Retry automatic review", exact: true })
    .click();
  await expect.poll(fixture.resolves).toBe(2);
});
