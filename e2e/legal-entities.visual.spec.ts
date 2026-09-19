import { expect, test, type Page } from "@playwright/test";
import type * as CollectionSearch from "../apps/web/src/collection-search";
import type {
  LegalEntityExportInput,
  LegalEntityInventory,
  LegalEntityRecord,
  LegalEntitySourceSummary,
} from "../packages/domain/src/legal-entities";
import { legalEntityExportTable } from "../apps/api/src/legal-entity-export";

import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import {
  routeInvestmentReview,
  selectReviewSection,
} from "./investment-review-fixtures";

// Keep the existing manual-review fixtures fixed; automatic transitions have
// their own browser suite and real D1 integration tests.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/legal-entities/resolve", (route) =>
    route.fulfill({
      json: {
        processedCount: 0,
        changedCount: 0,
        resolvedCount: 0,
        exceptionCount: 0,
        nextPositionId: null,
      },
    }),
  );
});

const positionSource = {
  source: { kind: "holding_position" as const, id: "position_demo_venture" },
  sourceDisplayName: "Demo Robotics",
  legalEntityNameEvidence: {
    state: "document_reported" as const,
    legalName: "Demo Venture SPV LLC",
    sourceField: "Agreement, page 2",
    documents: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        fileName: "demo-subscription-agreement.pdf",
        sha256: "a".repeat(64),
        page: 2,
        quote: "Issuer: Demo Venture SPV LLC",
      },
    ],
  },
  suggestedEntityType: "llc" as const,
  sourceLabel: "Reviewed venture export",
  sourceAsOf: "2026-08-31",
  relationship: "investment_vehicle" as const,
  currentOwner: "Demo Family Holdings LLC",
  interestStatus: "current" as const,
  openedOn: "2024-06-14",
  financials: {
    currency: "USD",
    commitmentMinor: 2_500_000,
    fundedMinor: 1_750_000,
    currentValue: { state: "locked" as const, minor: null },
  },
  currentDecisionId: null,
};

const limitedPartnershipSources = [
  {
    source: {
      kind: "holding_position",
      id: "position_demo_seed_fund_a",
    },
    sourceDisplayName: "Demo Health",
    legalEntityNameEvidence: {
      state: "provider_reported",
      legalName: "Demo Seed Fund I, LP",
      sourceField: "Fund Name",
    },
    suggestedEntityType: "limited_partnership",
    sourceLabel: "Reviewed venture export",
    sourceAsOf: "2026-08-30",
    relationship: "investment_vehicle",
    currentOwner: "Demo Family Holdings LLC",
    interestStatus: "current",
    openedOn: "2023-04-10",
    financials: null,
    currentDecisionId: null,
  },
  {
    source: {
      kind: "holding_position",
      id: "position_demo_seed_fund_b",
    },
    sourceDisplayName: "Demo Energy",
    legalEntityNameEvidence: {
      state: "document_reported",
      legalName: "Demo Seed Fund I, LP",
      sourceField: "Schedule K-1",
    },
    suggestedEntityType: "limited_partnership",
    sourceLabel: "Reviewed tax export",
    sourceAsOf: "2026-08-29",
    relationship: "investment_vehicle",
    currentOwner: "Demo Family Holdings LLC",
    interestStatus: "current",
    openedOn: "2023-04-10",
    financials: null,
    currentDecisionId: null,
  },
] satisfies LegalEntitySourceSummary[];

const initialInventory = {
  version: 3,
  asOf: "2026-09-01T12:00:00.000Z",
  entities: [
    {
      id: "legal_entity_demo_family_holdings",
      versionId: "legal_entity_version_demo_family_holdings_v1",
      version: 1,
      recordedAt: "2026-08-30T17:00:00.000Z",
      legalName: "Demo Family Holdings LLC",
      entityType: "llc",
      relationship: "ownership_entity",
      currentOwner: "Demo Operator",
      jurisdiction: "Delaware, US",
      formedOn: "2024-03-12",
      einLastFour: "4821",
      ownershipInterestPpm: 1_000_000,
      interestStatus: "current",
      taxClassification: "Partnership",
      notes: "Synthetic entity prepared for counsel review.",
      sources: [],
    },
    {
      id: "legal_entity_demo_studio",
      versionId: "legal_entity_version_demo_studio_v1",
      version: 1,
      recordedAt: "2026-08-30T17:05:00.000Z",
      legalName: "Demo Studio LLC",
      entityType: "llc",
      relationship: "operating_entity",
      currentOwner: null,
      jurisdiction: "California, US",
      formedOn: null,
      einLastFour: null,
      ownershipInterestPpm: 650_000,
      interestStatus: "current",
      taxClassification: null,
      notes: null,
      sources: [],
    },
  ],
  candidates: [
    positionSource,
    ...limitedPartnershipSources,
    {
      source: { kind: "holding_position", id: "position_demo_sydecar" },
      sourceDisplayName: "Demo Climate",
      legalEntityNameEvidence: {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        problem: "missing",
      },
      suggestedEntityType: null,
      sourceLabel: "Sydecar template",
      sourceAsOf: "2026-08-29",
      relationship: "investment_vehicle",
      currentOwner: "Demo Family Holdings LLC",
      interestStatus: "current",
      openedOn: null,
      financials: null,
      currentDecisionId: null,
    },
    {
      source: { kind: "holding_position", id: "position_demo_tokenfolio" },
      sourceDisplayName: "Demo Pharmacy",
      legalEntityNameEvidence: {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        problem: "other_structure",
        documents: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            fileName: "demo-certificate-subscription-agreement.pdf",
            sha256: "b".repeat(64),
            page: null,
            quote: null,
          },
        ],
      },
      suggestedEntityType: null,
      sourceLabel: "Tokenfolio template",
      sourceAsOf: "2026-08-28",
      relationship: "investment_vehicle",
      currentOwner: "Demo Family Holdings LLC",
      interestStatus: "current",
      openedOn: null,
      financials: null,
      currentDecisionId: null,
    },
  ],
  excludedCandidates: [
    {
      source: {
        kind: "holding_position",
        id: "position_demo_prior_vehicle",
      },
      sourceDisplayName: "Demo Prior Vehicle",
      legalEntityNameEvidence: {
        state: "provider_reported",
        legalName: "Demo Prior Vehicle LLC",
        sourceField: "Fund Name",
      },
      suggestedEntityType: "llc",
      sourceLabel: "Reviewed venture export",
      sourceAsOf: "2026-08-28",
      relationship: "ownership_entity",
      currentOwner: null,
      interestStatus: "current",
      openedOn: null,
      financials: null,
      currentDecisionId: "decision_demo_brokerage_not_llc",
    },
  ],
  exactBatch: {
    revision: "a".repeat(64),
    sourceCount: 3,
    entityCount: 2,
    existingEntityCount: 0,
    newEntityCount: 2,
    llcEntityCount: 1,
    limitedPartnershipEntityCount: 1,
    remainingCandidateCount: 2,
  },
} satisfies LegalEntityInventory;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test("keeps the initial review action and first source in the viewport", async ({
  page,
  isMobile,
}, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 393, height: 680 });
  await page.clock.setFixedTime(new Date("2026-09-01T12:00:00.000Z"));
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/legal-entities", (route) =>
    route.fulfill({ json: initialInventory }),
  );
  await page.route("**/api/legal-entity-export/options", (route) =>
    route.fulfill({ json: { googleSheetsClientId: null } }),
  );
  await page.goto("/holdings/entities");
  const batchAction = page.getByRole("button", {
    name: "Add or link 3 sources",
    exact: true,
  });
  await expect(batchAction).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("initial-viewport.png") });
  await expect(batchAction).toBeInViewport({ ratio: 1 });
  await expect(
    page.locator(".legal-entity-candidate h3").first(),
  ).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot("legal-entities-initial.png");

  const details = page.getByRole("button", { name: "Batch details" });
  expect((await details.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await details.click();
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText(/duplicate source rows share one record/u),
  ).toBeVisible();
  await expect(
    page.getByText(/2 source records remain outside this batch/u),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".legal-entity-exact-batch")).toHaveScreenshot(
    "legal-entities-batch-details.png",
  );
  if (isMobile) {
    await details.click();
    await page.setViewportSize({ width: 320, height: 680 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(batchAction).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page);
  }
});

test("searches the full legal inventory, reveals historical matches and refreshes after a saved rename", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let reads = 0;
  let writes = 0;
  const relatedSource = {
    ...positionSource,
    source: { kind: "holding_position" as const, id: "position_demo_related" },
    sourceDisplayName: "Demo Nebula Robotics",
  };
  let inventory: LegalEntityInventory = {
    ...initialInventory,
    entities: [
      ...Array.from({ length: 140 }, (_, index) => ({
        ...initialInventory.entities[0]!,
        id: `search_entity_${index}`,
        legalName:
          index === 139
            ? "Café Horizon Holdings LLC"
            : `Synthetic ${String(index).padStart(3, "0")} LLC`,
        sources: index === 138 ? [relatedSource] : [],
      })),
      {
        ...initialInventory.entities[0]!,
        id: "search_entity_historical",
        legalName: "Demo Horizon Legacy LLC",
        interestStatus: "historical",
      },
    ],
    candidates: [
      { ...positionSource, sourceDisplayName: "Demo Horizon Robotics" },
    ],
    excludedCandidates: [
      {
        ...initialInventory.excludedCandidates[0]!,
        sourceDisplayName: "Demo Horizon Prior Vehicle",
      },
    ],
    exactBatch: {
      revision: "a".repeat(64),
      sourceCount: 0,
      entityCount: 0,
      existingEntityCount: 0,
      newEntityCount: 0,
      llcEntityCount: 0,
      limitedPartnershipEntityCount: 0,
      remainingCandidateCount: 1,
    },
  };
  await page.route("**/api/legal-entities", (route) => {
    reads += 1;
    return route.fulfill({ json: inventory });
  });
  await page.route("**/api/legal-entities/search_entity_139", (route) => {
    writes += 1;
    const input = route.request().postDataJSON() as {
      profile: LegalEntityRecord;
    };
    const current = inventory.entities.find(
      (entity) => entity.id === "search_entity_139",
    )!;
    const saved = {
      ...current,
      ...input.profile,
      version: current.version + 1,
      versionId: "search_entity_139_v2",
    };
    inventory = {
      ...inventory,
      entities: inventory.entities.map((entity) =>
        entity.id === saved.id ? saved : entity,
      ),
    };
    return route.fulfill({ json: saved });
  });
  await page.goto("/holdings/entities");
  const search = page.getByRole("searchbox", { name: "Search legal entities" });
  await expect(
    page.locator(".legal-entities__known .legal-entity-row"),
  ).toHaveCount(25);
  await expect(
    page.getByRole("heading", {
      name: "Café Horizon Holdings LLC",
      exact: true,
    }),
  ).toHaveCount(0);
  await search.fill(" CAFE,  horizon ");
  await expect(
    page.locator(".legal-entities__known .legal-entity-row"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: "Café Horizon Holdings LLC",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".legal-entity-row h3 mark").first()).toHaveText(
    "Café",
  );
  expect(reads).toBe(1);
  expect(writes).toBe(0);
  await search.fill("horizon");
  await expect(
    page.locator(".legal-entities__search [role=status]"),
  ).toHaveText("4 results · Includes historical interests");
  await expect(
    page.locator(".legal-entities__candidates .legal-entity-candidate"),
  ).toHaveCount(1);
  await expect(
    page.locator(".legal-entities__history .legal-entity-row"),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".legal-entities__history")
      .getByText("Demo Horizon Legacy LLC", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".legal-entities__excluded .legal-entity-candidate"),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".legal-entities__excluded")
      .getByText("Excluded", { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot("legal-entities-search.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  });
  await search.fill("Nebula");
  await expect(
    page.locator(".legal-entities__known .legal-entity-row"),
  ).toHaveCount(1);
  await expect(
    page.locator(".legal-entities__known .legal-entity-row"),
  ).toContainText("Synthetic 138 LLC");
  await search.fill("no matching synthetic entity");
  await expect(
    page.locator(".legal-entities__search [role=status]"),
  ).toContainText("0 results");
  await expect(
    page.getByRole("heading", { name: "No matching current entities" }),
  ).toBeVisible();
  expect(reads).toBe(1);
  expect(writes).toBe(0);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(
    page.locator(".legal-entities__known .legal-entity-row"),
  ).toHaveCount(25);
  await search.fill("cafe horizon");
  await page
    .locator(".legal-entities__known .legal-entity-row")
    .getByRole("button", { name: "Review details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to legal entities", exact: true })
    .click();
  await expect(search).toHaveValue("cafe horizon");
  await page
    .locator(".legal-entities__known .legal-entity-row")
    .getByRole("button", { name: "Review details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit legal entity", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Legal name", exact: true })
    .fill("Demo Aurora Holdings LLC");
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit legal entity", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to legal entities", exact: true })
    .click();
  await expect(search).toHaveValue("cafe horizon");
  await expect(
    page.locator(".legal-entities__known .legal-entity-row"),
  ).toHaveCount(0);
  await search.fill("aurora");
  await expect(
    page.getByRole("heading", {
      name: "Demo Aurora Holdings LLC",
      exact: true,
    }),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(reads).toBe(2);
  const timings = await page.evaluate(async (data) => {
    const moduleUrl = "/src/collection-search.ts";
    const { buildLegalEntitySearchIndex, searchLegalEntities } = (await import(
      moduleUrl
    )) as typeof CollectionSearch;
    return [120, 1_000].map((size) => {
      const scaled = {
        ...data,
        entities: Array.from({ length: size }, (_, index) => ({
          ...data.entities[0]!,
          id: `benchmark_${index}`,
          legalName: `Demo Benchmark ${index} LLC`,
        })),
      };
      const buildStart = performance.now();
      const index = buildLegalEntitySearchIndex(scaled);
      const buildMs = performance.now() - buildStart;
      const durations: number[] = [];
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const started = performance.now();
        searchLegalEntities(
          index,
          ["benchmark 119", "demo", "no matching record"][attempt % 3]!,
        );
        durations.push(performance.now() - started);
      }
      durations.sort((left, right) => left - right);
      return {
        size,
        buildMs,
        p95SearchMs: durations[56],
        maxSearchMs: durations.at(-1),
      };
    });
  }, inventory);
  await testInfo.attach("legal-entity-search-timings.json", {
    body: JSON.stringify(timings),
    contentType: "application/json",
  });
  for (const timing of timings) expect(timing.p95SearchMs).toBeLessThan(50);
  expect(errors).toEqual([]);
});

test("reviews legal entities and exports selected counsel fields", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let inventory: LegalEntityInventory = structuredClone(initialInventory);
  let createBody: Record<string, unknown> | null = null;
  let exactBatchBody: Record<string, unknown> | null = null;
  let exportBody: Record<string, unknown> | null = null;
  await page.route("**/api/legal-entity-export/options", (route) =>
    route.fulfill({ json: { googleSheetsClientId: null } }),
  );

  await page.clock.setFixedTime(new Date("2026-09-01T12:00:00.000Z"));
  await routeInvestmentReview(page, positionSource);
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
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
          fiEligibleLiquidMinor: 0,
          protectedCashFloorMinor: 0,
          householdBurnMonthlyMinor: 0,
          businessBurnMonthlyMinor: 0,
          fiTargetMinor: 0,
        },
      },
    });
  });
  await page.route("**/api/legal-entities", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: inventory });
      return;
    }
    createBody = (await route.request().postDataJSON()) as Record<
      string,
      unknown
    >;
    const input = createBody as {
      profile: Omit<
        LegalEntityRecord,
        "id" | "recordedAt" | "sources" | "version" | "versionId"
      >;
      source: {
        reference: typeof positionSource.source;
        expectedDecisionId: string | null;
      } | null;
    };
    const created: LegalEntityRecord = {
      id: "legal_entity_demo_venture",
      versionId: "legal_entity_version_demo_venture_v1",
      version: 1,
      recordedAt: "2026-09-01T12:00:00.000Z",
      ...input.profile,
      sources: [
        { ...positionSource, currentDecisionId: "decision_demo_venture" },
      ],
    };
    inventory = {
      ...inventory,
      entities: [...inventory.entities, created],
      candidates: inventory.candidates.filter(
        (candidate) => candidate.source.id !== input.source?.reference.id,
      ),
      exactBatch: {
        revision: "b".repeat(64),
        sourceCount: 2,
        entityCount: 1,
        existingEntityCount: 0,
        newEntityCount: 1,
        llcEntityCount: 0,
        limitedPartnershipEntityCount: 1,
        remainingCandidateCount: 2,
      },
    };
    await route.fulfill({ json: created, status: 201 });
  });
  await page.route("**/api/legal-entity-sources/exact-batch", async (route) => {
    exactBatchBody = (await route.request().postDataJSON()) as Record<
      string,
      unknown
    >;
    const created: LegalEntityRecord = {
      id: "legal_entity_demo_seed_fund",
      versionId: "legal_entity_version_demo_seed_fund_v1",
      version: 1,
      recordedAt: "2026-09-01T12:00:00.000Z",
      legalName: "Demo Seed Fund I, LP",
      entityType: "limited_partnership",
      relationship: "investment_vehicle",
      currentOwner: "Demo Family Holdings LLC",
      jurisdiction: null,
      formedOn: null,
      einLastFour: null,
      ownershipInterestPpm: null,
      interestStatus: "current",
      taxClassification: null,
      notes: null,
      sources: limitedPartnershipSources.map((source, index) => ({
        ...source,
        currentDecisionId: `decision_demo_seed_fund_${index + 1}`,
      })),
    };
    const reviewedSourceIds = new Set(
      limitedPartnershipSources.map((source) => source.source.id),
    );
    inventory = {
      ...inventory,
      entities: [...inventory.entities, created],
      candidates: inventory.candidates.filter(
        (candidate) => !reviewedSourceIds.has(candidate.source.id),
      ),
      exactBatch: {
        revision: "c".repeat(64),
        sourceCount: 0,
        entityCount: 0,
        existingEntityCount: 0,
        newEntityCount: 0,
        llcEntityCount: 0,
        limitedPartnershipEntityCount: 0,
        remainingCandidateCount: 2,
      },
    };
    await route.fulfill({
      json: {
        version: 1,
        reviewedSourceCount: 2,
        entityCount: 1,
        existingEntityCount: 0,
        createdEntityCount: 1,
        remainingCandidateCount: 2,
      },
      status: 201,
    });
  });
  await page.route("**/api/legal-entity-export", async (route) => {
    exportBody = (await route.request().postDataJSON()) as Record<
      string,
      unknown
    >;
    await route.fulfill({
      body: '\uFEFF"Legal name","Entity type"\r\n"Demo Family Holdings LLC","LLC"\r\n',
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition":
          'attachment; filename="keel-legal-entities-2026-09-01.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
      status: 200,
    });
  });

  await page.goto("/holdings");
  await page.getByRole("link", { name: "Legal entities", exact: true }).click();
  await expect(page).toHaveURL(/\/holdings\/entities$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Legal entities" }),
  ).toBeVisible();
  await expect(page.locator(".page-intro")).toContainText(
    "This inventory does not transfer interests to a trust.",
  );
  const exportButton = page.getByRole("button", {
    name: "Export",
    exact: true,
  });
  await expect(exportButton).toBeInViewport();
  await expect(exportButton).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("heading", { name: "Export legal entities" }),
  ).toBeHidden();
  await exportButton.click();
  await expect(exportButton).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText("You can import the CSV into Google Sheets."),
  ).toBeVisible();
  await expect(
    page.locator(
      '.legal-entity-export__field-grid input[type="checkbox"]:checked',
    ),
  ).toHaveCount(16);
  await expect(
    page.getByLabel("Legal-name evidence", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("Include unresolved source records"),
  ).toBeChecked();
  const exportSnapshotStyle = await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await page.mouse.move(0, 0);
  await expect(page.locator(".legal-entity-export")).toHaveScreenshot(
    "legal-entity-export.png",
    {
      animations: "disabled",
      caret: "hide",
    },
  );
  await exportSnapshotStyle.evaluate((style) => {
    style.textContent = "";
  });
  await expectNoHorizontalOverflow(page);
  await expect(
    page.getByText(
      "2 reviewed LLCs · 3 source names to review · 2 missing legal names",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add or link 3 sources" }),
  ).toBeVisible();
  await expect(page.locator(".legal-entities")).toContainText("Not recorded");
  await expect(
    page.getByText("Needs review", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Name unavailable", { exact: true })).toHaveCount(
    2,
  );
  const unresolvedSydecar = page
    .locator(".legal-entity-candidate")
    .filter({ hasText: "Demo Climate" });
  await expect(unresolvedSydecar).toContainText(
    "Open source options to see what is missing.",
  );
  await expect(
    unresolvedSydecar.getByRole("button", { name: "Review details" }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".legal-entity-candidate")
      .filter({ hasText: "Demo Pharmacy" }),
  ).toContainText("Open source options");
  await page
    .locator(".legal-entity-candidate")
    .filter({ hasText: "Demo Venture SPV LLC" })
    .getByRole("button", { name: "Review details", exact: true })
    .click();
  await selectReviewSection(page, "Documents");
  const evidence = page.locator(".entity-review");
  await evidence
    .getByRole("button", { name: "Source evidence · page 2" })
    .click();
  await expect(evidence).toContainText("Issuer: Demo Venture SPV LLC");
  const agreement = evidence.getByRole("button", {
    name: "demo-subscription-agreement.pdf",
  });
  let agreementAvailable = false;
  let agreementBlocked = false;
  const downloadMethods: string[] = [];
  const downloadedNames: string[] = [];
  page.on("download", (download) => {
    downloadedNames.push(download.suggestedFilename());
  });
  await page.route("**/api/legal-entity-documents/*", (route) => {
    downloadMethods.push(route.request().method());
    return agreementBlocked
      ? route.fulfill({ status: 423, json: { error: "security check" } })
      : agreementAvailable
        ? route.fulfill({
            contentType: "application/pdf",
            headers: {
              "Content-Disposition": 'attachment; filename="agreement.pdf"',
            },
            body: "%PDF-1.4 synthetic test download",
          })
        : route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  await agreement.click();
  await expect(evidence).toContainText(
    "The agreement could not be downloaded. Try again or check source access.",
  );
  expect(downloadedNames).toEqual([]);
  // Capture the settled error, not a hover left behind by the async button's
  // disable/re-enable cycle (mobile emulation can retain it after a click).
  await expect(agreement).toBeEnabled();
  await page.mouse.move(0, 0);
  await expect
    .poll(() => agreement.evaluate((element) => element.matches(":hover")))
    .toBe(false);
  const reviewSnapshotStyle = await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await expect(evidence).toHaveScreenshot(
    "legal-agreement-download-error.png",
    {
      animations: "disabled",
      caret: "hide",
    },
  );
  await expectNoHorizontalOverflow(page);
  agreementBlocked = true;
  await agreement.click();
  await expect(evidence).toContainText(
    "Download blocked. Recheck this agreement for the current security result.",
  );
  expect(downloadedNames).toEqual([]);
  await expect(agreement).toHaveCount(0);
  await expect(
    evidence.getByRole("button", { name: "Recheck agreement" }),
  ).toBeEnabled();
  await page.mouse.move(0, 0);
  await expect(evidence).toHaveScreenshot(
    "legal-agreement-security-check.png",
    { animations: "disabled", caret: "hide" },
  );
  await reviewSnapshotStyle.evaluate((style) => {
    style.parentNode?.removeChild(style);
  });
  await expectNoHorizontalOverflow(page);
  agreementBlocked = false;
  agreementAvailable = true;
  // Refresh after a successful later check; a 423 must not leave a clickable
  // download action that suggests the original can be opened while blocked.
  await page.reload();
  await evidence
    .getByRole("button", { name: "Source evidence · page 2" })
    .click();
  const agreementDownload = page.waitForEvent("download");
  await agreement.click();
  expect((await agreementDownload).suggestedFilename()).toBe(
    "demo-subscription-agreement.pdf",
  );
  await expect(
    evidence.locator(".legal-entity-documents .form-message"),
  ).toHaveCount(0);
  expect(downloadMethods).toEqual(["POST", "POST", "POST"]);
  await expectNoHorizontalOverflow(page);

  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await page
    .getByRole("button", { name: "Back to legal entities", exact: true })
    .click();
  await expect(page.locator(".content")).toHaveScreenshot(
    "legal-entities.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  const candidate = page
    .locator(".legal-entity-candidate")
    .filter({ hasText: "Demo Venture SPV LLC" });
  await candidate.getByRole("button", { name: "Review details" }).click();
  const editor = page.locator(".legal-entity-editor");
  await expect(
    editor.getByRole("heading", { name: "Add legal entity" }),
  ).toBeVisible();
  await expect(editor.getByLabel("Legal name")).toHaveValue(
    "Demo Venture SPV LLC",
  );
  await editor
    .getByRole("button", { name: "Additional details (optional)" })
    .click();
  await editor.getByLabel("Formation jurisdiction").fill("Delaware, US");
  if (test.info().project.name === "chromium") {
    // Read both controls in one frame: scrolling can move the page between
    // separate boundingBox calls even when the fields are exactly aligned.
    await expect
      .poll(() =>
        editor
          .getByLabel("EIN last four")
          .or(editor.getByLabel("Tax classification"))
          .evaluateAll((controls) => {
            if (controls.length !== 2) return false;
            const [ein, tax] = controls.map((control) =>
              control.getBoundingClientRect(),
            );
            return (
              ein !== undefined &&
              tax !== undefined &&
              ein.height > 0 &&
              tax.height > 0 &&
              ein.y === tax.y
            );
          }),
      )
      .toBe(true);
  }
  await expect(editor.getByLabel("Ownership interest")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  await editor.scrollIntoViewIfNeeded();
  await expect(editor).toHaveScreenshot("legal-entity-editor.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  await expectNoHorizontalOverflow(page);

  await editor.getByRole("button", { name: "Add entity" }).click();
  await page
    .getByRole("button", { name: "Edit legal entity", exact: true })
    .click();
  await expect(
    editor.getByRole("heading", { name: "Edit legal entity" }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Save version", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Review saved.", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to legal entities", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 3, name: "Demo Venture SPV LLC" }),
  ).toBeVisible();
  expect(createBody).toMatchObject({
    profile: {
      legalName: "Demo Venture SPV LLC",
      entityType: "llc",
      jurisdiction: "Delaware, US",
      ownershipInterestPpm: null,
    },
    source: {
      reference: positionSource.source,
      expectedDecisionId: null,
    },
  });

  await page.getByRole("button", { name: "Add or link 2 sources" }).click();
  await expect(
    page.getByText(
      "2 sources were reviewed into 1 legal entity. 2 source records remain unresolved.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "Demo Seed Fund I, LP" }),
  ).toBeVisible();
  expect(exactBatchBody).toEqual({ expectedRevision: "b".repeat(64) });
  await expect(
    page.locator(".legal-entity-candidate").filter({ hasText: "Demo Climate" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  await page.getByRole("button", { name: /Download CSV/u }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "keel-legal-entities-2026-09-01.csv",
  );
  expect(exportBody).toMatchObject({
    includeNeedsReview: true,
    includeHistorical: false,
    includeOtherEntityTypes: true,
  });
  expect((exportBody as unknown as { fields: unknown[] }).fields).toHaveLength(
    16,
  );
  expect((exportBody as unknown as { fields: unknown[] }).fields).toContain(
    "closure_details",
  );
  await expect(page).toHaveURL(/\/holdings\/entities$/u);
});

test("opens Holdings sections directly and returns from nested workspaces", async ({
  page,
}) => {
  let holdingsRequests = 0;
  let entityRequests = 0;
  await routeHoldingsPage(page, () => {
    holdingsRequests += 1;
    return {
      householdName: "Demo Household",
      holdings: [],
      investmentHoldings: emptyInvestmentHoldingsView,
      acceptedCashAccounts: [],
      pendingImports: [],
    };
  });
  await page.route("**/api/legal-entities", (route) => {
    entityRequests += 1;
    return route.fulfill({ json: initialInventory });
  });
  await page.goto("/holdings/entities");
  const sections = page.getByRole("navigation", { name: "Holdings sections" });
  const entities = sections.getByRole("link", { name: "Legal entities" });
  const sources = sections.getByRole("link", { name: "Sources" });
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeVisible();
  expect(holdingsRequests).toBe(0);
  expect(entityRequests).toBe(1);
  await entities.click();
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeVisible();
  expect(entityRequests).toBe(1);
  await expect(entities).toHaveAttribute("aria-current", "page");
  for (const link of await sections.getByRole("link").all()) {
    await expect(link).toBeInViewport();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  await sources.click();
  await expect(page).toHaveURL(/\/holdings\/sources$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Holding sources" }),
  ).toBeVisible();
  await expect(sources).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", { name: "Import holdings", exact: true })
    .click();
  await expect(page.locator(".holding-import-workspace")).toBeVisible();
  await sources.click();
  await expect(page.locator(".holding-import-workspace")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "Holding sources" }),
  ).toBeVisible();

  await entities.press("Enter");
  await expect(page).toHaveURL(/\/holdings\/entities$/u);
  await expect(entities).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(sources).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(entities).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Add entity", exact: true }).click();
  const requestsBeforeReturning = entityRequests;
  await expect(page).toHaveURL(/review=new/u);
  await entities.click();
  await expect(page).toHaveURL(/\/holdings\/entities$/u);
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeVisible();
  expect(entityRequests).toBe(requestsBeforeReturning);
  await sections.getByRole("link", { name: "Holdings", exact: true }).click();
  await expect(page).toHaveURL(/\/holdings$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Holdings", exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("keeps export above 140 entities and preserves choices through collapse and failures", async ({
  page,
}) => {
  const inventory = {
    ...initialInventory,
    candidates: [],
    excludedCandidates: [],
    entities: Array.from({ length: 140 }, (_, index) => ({
      ...initialInventory.entities[0]!,
      id: `synthetic-scale-${index}`,
      legalName: `Synthetic ${String(index).padStart(3, "0")} LLC`,
    })),
  };
  let optionRequests = 0;
  let exportRequests = 0;
  await page.route("**/api/legal-entities", (route) =>
    route.fulfill({ json: inventory }),
  );
  await page.route("**/api/legal-entity-export/options", (route) => {
    optionRequests += 1;
    return route.fulfill({ json: { googleSheetsClientId: null } });
  });
  await page.route("**/api/legal-entity-export", (route) => {
    exportRequests += 1;
    return route.fulfill({
      status: 503,
      json: { error: "The export could not be prepared. Try again." },
    });
  });
  await page.goto("/holdings/entities");
  const toggle = page.getByRole("button", { name: "Export", exact: true });
  await expect(toggle).toBeInViewport();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(optionRequests).toBe(0);
  expect(await page.locator(".legal-entity-row").count()).toBeLessThan(140);
  await toggle.press("Enter");
  await expect(
    page.getByText("You can import the CSV into Google Sheets."),
  ).toBeVisible();
  await page.getByLabel("Notes", { exact: true }).check();
  await page.getByLabel("Include non-LLC entities").uncheck();
  await toggle.click();
  await expect(
    page.getByRole("heading", { name: "Export legal entities" }),
  ).toBeHidden();
  await toggle.click();
  await expect(page.getByLabel("Notes", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Include non-LLC entities")).not.toBeChecked();
  expect(optionRequests).toBe(1);
  const download = page.getByRole("button", { name: /Download CSV/u });
  const options = page.locator(".legal-entity-export");
  const inventoryList = page.locator(".legal-entities__known");
  await expect
    .poll(async () => {
      const [action, panel, list] = await Promise.all([
        download.boundingBox(),
        options.boundingBox(),
        inventoryList.boundingBox(),
      ]);
      return (
        action !== null &&
        panel !== null &&
        list !== null &&
        action.y < list.y &&
        panel.y + panel.height <= list.y
      );
    })
    .toBe(true);
  await download.click();
  await expect(
    page.getByText("The export could not be prepared. Try again."),
  ).toBeVisible();
  await expect(page.getByLabel("Notes", { exact: true })).toBeChecked();
  expect(exportRequests).toBe(1);
  for (const checkbox of await page
    .locator('.legal-entity-export__field-grid input[type="checkbox"]')
    .all())
    await checkbox.uncheck();
  await expect(download).toBeDisabled();
  await expect(page.getByText("Choose at least one column.")).toBeVisible();
  await page.getByRole("button", { name: "Use recommended fields" }).click();
  await expect(download).toBeEnabled();
  await expect(
    page.locator(".legal-entity-export__field-grid input:checked"),
  ).toHaveCount(16);
  await expectNoHorizontalOverflow(page);
});

async function routeGoogleExport(
  page: Page,
  outcome:
    "success" | "popup_closed" | "popup_failed_to_open" | "denied" = "success",
) {
  await page.route("**/api/legal-entities", (route) =>
    route.fulfill({ json: initialInventory }),
  );
  await page.route("**/api/legal-entity-export/options", (route) =>
    route.fulfill({
      json: {
        googleSheetsClientId: "synthetic-client.apps.googleusercontent.com",
      },
    }),
  );
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.google = { accounts: { oauth2: { initTokenClient: (config) => ({ requestAccessToken: () => {
      if (config.client_id !== 'synthetic-client.apps.googleusercontent.com' || config.scope !== 'https://www.googleapis.com/auth/drive.file' || config.include_granted_scopes !== false) throw new Error('Unexpected Google authorization scope');
      if (${JSON.stringify(outcome)} === 'denied') config.callback({ error: 'access_denied' });
      else if (${JSON.stringify(outcome)} !== 'success') config.error_callback({ type: ${JSON.stringify(outcome)} });
      else config.callback({ access_token: 'synthetic-oauth-token', expires_in: 3600, scope: config.scope });
    } }) } } };`,
    }),
  );
}

test("creates a Google Sheet from selected records and columns and prevents unchanged resubmission", async ({
  page,
}) => {
  await routeGoogleExport(page);
  let tableInput: LegalEntityExportInput | null = null;
  let createCalls = 0;
  let googleBody: {
    sheets: Array<{
      data: Array<{
        rowData: Array<{
          values: Array<{ userEnteredValue: { stringValue: string } }>;
        }>;
      }>;
    }>;
  } | null = null;
  await page.route("**/api/legal-entity-export", async (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    tableInput = route.request().postDataJSON() as LegalEntityExportInput;
    await route.fulfill({
      json: legalEntityExportTable(initialInventory, tableInput),
    });
  });
  await page.route(
    "https://sheets.googleapis.com/v4/spreadsheets",
    async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization,Content-Type",
          },
        });
        return;
      }
      createCalls += 1;
      expect(route.request().headers().authorization).toBe(
        "Bearer synthetic-oauth-token",
      );
      googleBody = route.request().postDataJSON() as typeof googleBody;
      await route.fulfill({
        json: { spreadsheetId: "synthetic_sheet_123" },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    },
  );
  await page.goto("/holdings/entities");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const create = page.getByRole("button", {
    name: "Create Google Sheet",
    exact: true,
  });
  await expect(create).toBeEnabled();
  const exportSnapshotStyle = await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await page.mouse.move(0, 0);
  await expect(page.locator(".legal-entity-export")).toHaveScreenshot(
    "legal-entity-google-export.png",
    {
      animations: "disabled",
      caret: "hide",
    },
  );
  await exportSnapshotStyle.evaluate((style) => {
    style.textContent = "";
  });
  await page.getByLabel("Include unresolved source records").uncheck();
  await page.getByLabel("Notes", { exact: true }).check();
  await create.click();
  await expect(
    page.getByRole("link", { name: "Open Google Sheet" }),
  ).toHaveAttribute(
    "href",
    "https://docs.google.com/spreadsheets/d/synthetic_sheet_123/edit",
  );
  await expect(
    page.getByRole("button", { name: "Google Sheet created", exact: true }),
  ).toBeDisabled();
  expect(createCalls).toBe(1);
  expect(tableInput).toMatchObject({
    includeNeedsReview: false,
    fields: expect.arrayContaining(["notes"]),
  });
  const rows = googleBody!.sheets[0]!.data[0]!.rowData;
  expect(rows).toHaveLength(3);
  expect(rows[0]!.values).toHaveLength(17);
  expect(rows[1]!.values[0]!.userEnteredValue).toEqual({
    stringValue: "Demo Family Holdings LLC",
  });
  await page.getByLabel("Include unresolved source records").check();
  await expect(create).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});

for (const outcome of [
  "popup_closed",
  "popup_failed_to_open",
  "denied",
] as const) {
  test(`preserves export choices when Google authorization returns ${outcome}`, async ({
    page,
  }) => {
    await routeGoogleExport(page, outcome);
    const writes: string[] = [];
    await page.route("**/api/legal-entity-export", (route) => {
      writes.push(route.request().url());
      return route.abort();
    });
    await page.route("https://sheets.googleapis.com/**", (route) => {
      writes.push(route.request().url());
      return route.abort();
    });
    await page.goto("/holdings/entities");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByLabel("Notes", { exact: true }).check();
    await page
      .getByRole("button", { name: "Create Google Sheet", exact: true })
      .click();
    await expect(
      page.getByText(
        outcome === "denied"
          ? "Allow Keel to create the Google Sheet, or download CSV instead."
          : outcome === "popup_closed"
            ? "Google sign-in was closed. Your export choices are unchanged."
            : "Google sign-in could not open. Allow pop-ups for Keel and try again.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Notes", { exact: true })).toBeChecked();
    await expect(
      page.getByRole("button", { name: /Download CSV/u }),
    ).toBeEnabled();
    expect(writes).toEqual([]);
  });
}
