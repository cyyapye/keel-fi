import { expect, test, type Page } from "@playwright/test";
import type {
  LegalEntityInventory,
  LegalEntityRecord,
  LegalEntitySourceSummary,
} from "../packages/domain/src/legal-entities";

import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";

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

test("reviews legal entities and exports selected counsel fields", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let inventory: LegalEntityInventory = structuredClone(initialInventory);
  let createBody: Record<string, unknown> | null = null;
  let exactBatchBody: Record<string, unknown> | null = null;
  let exportBody: Record<string, unknown> | null = null;

  await page.clock.setFixedTime(new Date("2026-09-01T12:00:00.000Z"));
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
  await page.getByRole("button", { name: "Legal entities" }).click();
  await expect(page).toHaveURL(/\/holdings\/entities$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Legal entities" }),
  ).toBeVisible();
  await expect(page.locator(".page-intro")).toContainText(
    "This inventory does not transfer an entity to a trust.",
  );
  await expect(
    page.locator(
      '.legal-entity-export__field-grid input[type="checkbox"]:checked',
    ),
  ).toHaveCount(13);
  await expect(
    page.getByLabel("Legal-name evidence", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("Include unresolved source records"),
  ).toBeChecked();
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
    "No agreement was available for this investment.",
  );
  await expect(
    unresolvedSydecar.getByRole("button", { name: "Review details" }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".legal-entity-candidate")
      .filter({ hasText: "Demo Pharmacy" }),
  ).toContainText("compartment or certificate structure");
  const evidence = page
    .locator(".legal-entity-candidate")
    .filter({ hasText: "Demo Venture SPV LLC" });
  await evidence
    .getByRole("button", { name: "Agreement evidence · 1" })
    .click();
  await expect(evidence).toContainText("Issuer: Demo Venture SPV LLC");
  const agreement = evidence.getByRole("button", {
    name: "demo-subscription-agreement.pdf · page 2",
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
  await expectNoHorizontalOverflow(page);
  agreementBlocked = false;
  agreementAvailable = true;
  // Refresh after a successful later check; a 423 must not leave a clickable
  // download action that suggests the original can be opened while blocked.
  await page.reload();
  await evidence
    .getByRole("button", { name: "Agreement evidence · 1" })
    .click();
  const agreementDownload = page.waitForEvent("download");
  await agreement.click();
  expect((await agreementDownload).suggestedFilename()).toBe(
    "demo-subscription-agreement.pdf",
  );
  await expect(evidence.locator(".form-message")).toHaveCount(0);
  expect(downloadMethods).toEqual(["POST", "POST", "POST"]);
  await expectNoHorizontalOverflow(page);

  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await expect(page.locator(".holdings-screen")).toHaveScreenshot(
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
  await expect(page.getByLabel("Legal name")).toHaveValue(
    "Demo Venture SPV LLC",
  );
  await page.getByLabel("Formation jurisdiction").fill("Delaware, US");
  await page.getByLabel("Ownership interest").fill("12.5");
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
  await expect(
    page.getByText("The reviewed legal entity inventory was updated."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "Demo Venture SPV LLC" }),
  ).toBeVisible();
  expect(createBody).toMatchObject({
    profile: {
      legalName: "Demo Venture SPV LLC",
      entityType: "llc",
      jurisdiction: "Delaware, US",
      ownershipInterestPpm: 125_000,
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
  await page.getByRole("button", { name: /Download CSV/u }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "keel-legal-entities-2026-09-01.csv",
  );
  expect(exportBody).toMatchObject({
    includeNeedsReview: true,
    includeHistorical: false,
    includeOtherEntityTypes: false,
  });
  expect((exportBody as unknown as { fields: unknown[] }).fields).toHaveLength(
    13,
  );
  await expect(page).toHaveURL(/\/holdings\/entities$/u);
});
