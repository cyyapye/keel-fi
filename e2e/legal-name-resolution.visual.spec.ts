import { expect, test, type Page } from "@playwright/test";
import {
  CreateLegalEntityInputSchema,
  ReviewLegalEntitySourceInputSchema,
  type CreateLegalEntityInput,
  type LegalEntityInventory,
  type LegalEntityRecord,
  type LegalEntitySourceSummary,
  type LegalNameResolutionInput,
} from "../packages/domain/src/legal-entities";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";

const source: LegalEntitySourceSummary = {
  source: { kind: "holding_position", id: "position_demo_conflict" },
  sourceDisplayName: "Demo Climate",
  sourceLabel: "Sydecar agreement",
  sourceAsOf: "2026-09-01",
  currentOwner: null,
  currentDecisionId: null,
  suggestedEntityType: null,
  relationship: "investment_vehicle",
  interestStatus: "current",
  financials: null,
  openedOn: null,
  legalEntityNameEvidence: {
    state: "unavailable",
    legalName: null,
    sourceField: null,
    problem: "conflicting",
    documents: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        fileName: "demo-subscription.pdf",
        sha256: "a".repeat(64),
        page: 2,
        quote: "Issuer: Demo Climate, LLC",
        citations: [
          {
            legalName: "Demo Climate, LLC",
            page: 2,
            quote: "Issuer: Demo Climate, LLC",
            role: "issuer",
          },
        ],
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        fileName: "demo-operating-agreement.pdf",
        sha256: "b".repeat(64),
        page: 1,
        quote: "Fund: Demo Climate LLC",
        citations: [
          {
            legalName: "Demo Climate LLC",
            page: 1,
            quote: "Fund: Demo Climate LLC",
            role: "fund",
          },
        ],
      },
    ],
  },
};
const existing: LegalEntityRecord = {
  id: "entity_demo_climate",
  versionId: "entity_demo_climate_v1",
  version: 1,
  legalName: "Demo Climate, LLC",
  entityType: "llc",
  relationship: "investment_vehicle",
  currentOwner: null,
  jurisdiction: null,
  formedOn: null,
  einLastFour: null,
  ownershipInterestPpm: null,
  interestStatus: "current",
  taxClassification: null,
  notes: null,
  recordedAt: "2026-09-01T12:00:00.000Z",
  sources: [],
};

async function setup(page: Page, legacy = false) {
  const candidate = structuredClone(source);
  if (legacy)
    for (const document of candidate.legalEntityNameEvidence.documents ?? [])
      delete document.citations;
  const inventory: LegalEntityInventory = {
    version: 3,
    asOf: "2026-09-01T12:00:00.000Z",
    entities: [structuredClone(existing)],
    candidates: [
      candidate,
      {
        ...structuredClone(source),
        source: { kind: "holding_position", id: "position_demo_blocked" },
        sourceDisplayName: "Demo Blocked",
        legalEntityNameEvidence: {
          state: "unavailable",
          legalName: null,
          sourceField: null,
          problem: "security_blocked",
        },
      },
    ],
    excludedCandidates: [],
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
  const writes: unknown[] = [];
  let rejectWrite = false;
  const reviewedSource = (
    resolution: LegalNameResolutionInput | undefined,
  ): LegalEntitySourceSummary => {
    if (resolution === undefined) throw new Error("Missing review receipt");
    const document = candidate.legalEntityNameEvidence.documents?.find(
      (item) => item.id === resolution.documentId,
    );
    if (document === undefined) throw new Error("Missing supporting agreement");
    return {
      ...candidate,
      currentDecisionId: "decision_demo",
      nameResolution: {
        kind: resolution.kind,
        documentId: document.id,
        legalName: resolution.legalName,
        page: resolution.page,
        quote: resolution.quote,
        reason: resolution.reason,
        fileName: document.fileName,
        sha256: document.sha256,
        evidence: candidate.legalEntityNameEvidence,
      },
    };
  };
  await page.clock.setFixedTime(new Date("2026-09-01T12:00:00.000Z"));
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/legal-entities", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: inventory });
    const input = CreateLegalEntityInputSchema.parse(
      route.request().postDataJSON(),
    );
    writes.push(input);
    if (rejectWrite)
      return route.fulfill({
        status: 409,
        json: {
          error:
            "The agreement evidence changed. Reload and compare the current names before saving.",
        },
      });
    const entity = {
      ...existing,
      ...input.profile,
      id: "new_demo_entity",
      sources: [reviewedSource(input.source?.nameResolution)],
    };
    inventory.entities.push(entity);
    inventory.candidates = inventory.candidates.filter(
      (item) => item.source.id !== candidate.source.id,
    );
    return route.fulfill({ status: 201, json: entity });
  });
  await page.route("**/api/legal-entity-sources/review", async (route) => {
    const input = ReviewLegalEntitySourceInputSchema.parse(
      route.request().postDataJSON(),
    );
    writes.push(input);
    if (rejectWrite)
      return route.fulfill({
        status: 409,
        json: {
          error:
            "The agreement evidence changed. Reload and compare the current names before saving.",
        },
      });
    inventory.entities[0]?.sources.push(reviewedSource(input.nameResolution));
    inventory.candidates = inventory.candidates.filter(
      (item) => item.source.id !== candidate.source.id,
    );
    return route.fulfill({
      status: 201,
      json: { version: 1, decisionId: "decision_demo" },
    });
  });
  await page.goto("/holdings/entities");
  // Match the existing legal-entity screenshots: sticky navigation is not
  // part of a tall form's element capture. Functional tests keep its layout.
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  const row = page
    .locator(".legal-entity-candidate")
    .filter({ hasText: "Demo Climate" });
  await expect(row.getByText("Names disagree", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".legal-entity-candidate")
      .filter({ hasText: "Demo Blocked" })
      .getByRole("button", { name: "Resolve name" }),
  ).toHaveCount(0);
  return {
    inventory,
    writes,
    row,
    reject: (value: boolean) => {
      rejectWrite = value;
    },
  };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
}

test("compares exact alternatives without preselecting and saves a reviewed entity", async ({
  page,
}) => {
  const { row, writes } = await setup(page);
  await row.getByRole("button", { name: "Resolve name", exact: true }).click();
  const resolver = row.getByRole("form", {
    name: "Resolve name for Demo Climate",
  });
  await expect(resolver.locator('input[type="radio"]:checked')).toHaveCount(0);
  await expect(
    resolver.getByRole("button", { name: "Continue with this name" }),
  ).toBeDisabled();
  await expect(row).toHaveScreenshot("legal-name-resolution.png", {
    animations: "disabled",
    caret: "hide",
  });
  await noOverflow(page);
  await resolver.getByRole("button", { name: "Keep unresolved" }).click();
  expect(writes).toEqual([]);
  await row.getByRole("button", { name: "Resolve name", exact: true }).click();
  await resolver.getByRole("radio", { name: /^Demo Climate LLC /u }).check();
  await resolver
    .getByRole("button", { name: "Continue with this name" })
    .click();
  const editor = page.locator(".legal-entity-editor");
  await expect(editor.getByLabel("Legal name", { exact: true })).toHaveValue(
    "Demo Climate LLC",
  );
  await expect(
    editor.getByLabel("Legal name", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await editor.getByRole("button", { name: "Add entity", exact: true }).click();
  expect(
    (writes[0] as CreateLegalEntityInput).source?.nameResolution,
  ).toMatchObject({
    kind: "document_choice",
    legalName: "Demo Climate LLC",
    documentId: "22222222-2222-4222-8222-222222222222",
    page: 1,
    quote: "Fund: Demo Climate LLC",
    expectedEvidenceRevision: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
  await page.reload();
  await expect(
    page
      .locator(".legal-entity-row")
      .filter({ hasText: "Reviewed name: Demo Climate LLC" }),
  ).toBeVisible();
  await expect(
    page.locator(".legal-entity-candidate").filter({ hasText: "Demo Climate" }),
  ).toHaveCount(0);
  await noOverflow(page);
});

test("supports a document-backed correction for a legacy conflict with no saved choices", async ({
  page,
}) => {
  const { row, writes } = await setup(page, true);
  await row.getByRole("button", { name: "Resolve name", exact: true }).click();
  const resolver = row.getByRole("form");
  await expect(resolver).toContainText("No alternatives were saved");
  await resolver
    .getByRole("radio", { name: /Enter a document-backed correction/u })
    .check();
  await resolver
    .getByRole("combobox", { name: "Supporting agreement" })
    .click();
  await page
    .getByRole("option", { name: "demo-subscription.pdf", exact: true })
    .click();
  await resolver
    .getByLabel("Exact legal name", { exact: true })
    .fill("Demo Climate Series I LLC");
  await resolver.getByLabel("Agreement page", { exact: true }).fill("2");
  await resolver
    .getByLabel("Document excerpt")
    .fill("Issuer: Demo Climate Series I LLC");
  await resolver
    .getByLabel("Reason for correction")
    .fill("The executed subscription names the invested series.");
  await expect(resolver).toHaveScreenshot("legal-name-correction.png", {
    animations: "disabled",
    caret: "hide",
  });
  await noOverflow(page);
  await resolver
    .getByRole("button", { name: "Continue with this name" })
    .click();
  await page
    .locator(".legal-entity-editor")
    .getByRole("button", { name: "Add entity", exact: true })
    .click();
  expect(
    (writes[0] as CreateLegalEntityInput).source?.nameResolution,
  ).toMatchObject({
    kind: "document_correction",
    legalName: "Demo Climate Series I LLC",
    reason: "The executed subscription names the invested series.",
  });
  await expect(
    page.getByText(
      /Your document-backed correction: Demo Climate Series I LLC/u,
    ),
  ).toBeVisible();
});

test("keeps a stale resolution unsaved, reloads evidence, then links the exact existing entity", async ({
  page,
}) => {
  const { row, inventory, writes, reject } = await setup(page);
  reject(true);
  await row.getByRole("button", { name: "Resolve name", exact: true }).click();
  const resolver = row.getByRole("form");
  await resolver.getByRole("radio", { name: /^Demo Climate, LLC /u }).check();
  await resolver.getByRole("combobox", { name: "Save to" }).click();
  await page
    .getByRole("option", {
      name: "Link existing: Demo Climate, LLC",
      exact: true,
    })
    .click();
  await resolver
    .getByRole("button", { name: "Link entity", exact: true })
    .click();
  await expect(resolver).toContainText("The agreement evidence changed.");
  expect(inventory.entities[0]?.sources).toHaveLength(0);
  await resolver.getByRole("button", { name: "Reload evidence" }).click();
  await row.getByRole("button", { name: "Resolve name", exact: true }).click();
  await expect(resolver.locator('input[type="radio"]:checked')).toHaveCount(0);
  reject(false);
  await resolver.getByRole("radio", { name: /^Demo Climate, LLC /u }).check();
  await resolver.getByRole("combobox", { name: "Save to" }).click();
  await page
    .getByRole("option", {
      name: "Link existing: Demo Climate, LLC",
      exact: true,
    })
    .click();
  await resolver
    .getByRole("button", { name: "Link entity", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(inventory.entities).toHaveLength(1);
  expect(writes).toHaveLength(2);
  expect(inventory.entities[0]?.sources[0]?.nameResolution).toMatchObject({
    legalName: "Demo Climate, LLC",
    kind: "document_choice",
  });
});
