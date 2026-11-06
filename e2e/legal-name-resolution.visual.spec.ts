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
import {
  routeInvestmentReview,
  selectReviewSection,
} from "./investment-review-fixtures";

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

async function setup(
  page: Page,
  evidence:
    "conflicting" | "name_not_found" | "legacy_name_not_found" = "conflicting",
) {
  const candidate = structuredClone(source);
  if (evidence !== "conflicting") {
    candidate.legalEntityNameEvidence = {
      state: "unavailable",
      legalName: null,
      sourceField: null,
      problem: "name_not_found",
      documents: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          fileName: "demo-subscription.pdf",
          sha256: "a".repeat(64),
          page: null,
          quote: null,
          ...(evidence === "legacy_name_not_found" ? {} : { citations: [] }),
          scan: {
            version: 2,
            sha256: "a".repeat(64),
            outcome: "clean",
            findings: [],
            engineVersion: "1.4.3",
            databaseVersion: 100,
            databaseUpdatedAt: "2026-09-01T10:00:00.000Z",
            scannedAt: "2026-09-01T11:00:00.000Z",
          },
        },
      ],
    };
  }
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
  await routeInvestmentReview(page, candidate);
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
    const target = inventory.entities.find(
      (entity) =>
        input.decision.kind === "linked" &&
        entity.id === input.decision.legalEntityId,
    );
    if (target === undefined) throw new Error("Missing review target");
    target.sources.push(reviewedSource(input.nameResolution));
    inventory.candidates = inventory.candidates.filter(
      (item) => item.source.id !== candidate.source.id,
    );
    return route.fulfill({
      status: 201,
      json: { version: 1, decisionId: "decision_demo" },
    });
  });
  await page.goto("/holdings/entities");
  await page.getByRole("button", { name: /^Needs your review/u }).click();
  // Match the existing legal-entity screenshots: sticky navigation is not
  // part of a tall form's element capture. Functional tests keep its layout.
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  const row = page
    .locator(".legal-entity-candidate:visible, .entity-review")
    .filter({ hasText: "Demo Climate" });
  await expect(
    row
      .getByText(evidence === "conflicting" ? "Names disagree" : "Review PDF", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator(".legal-entity-candidate:visible, .entity-review")
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

test(
  "compares exact alternatives without preselecting and saves a reviewed entity",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const { row, writes } = await setup(page);
    await row
      .getByRole("button", { name: "Resolve name", exact: true })
      .click();
    const resolver = row.getByRole("form", {
      name: "Resolve name for Demo Climate",
    });
    await expect(resolver.locator('input[type="radio"]:checked')).toHaveCount(
      0,
    );
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
    await row
      .getByRole("button", { name: "Resolve name", exact: true })
      .click();
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
    await editor
      .getByRole("button", { name: "Add entity", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit legal entity", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Review saved.", { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Back to legal entities", exact: true })
      .click();
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
    if (
      await page
        .getByRole("button", { name: "Back to legal entities", exact: true })
        .count()
    )
      await page
        .getByRole("button", { name: "Back to legal entities", exact: true })
        .click();
    await page.reload();
    await expect(
      page
        .locator(".legal-entity-row")
        .filter({ hasText: "Reviewed name: Demo Climate LLC" }),
    ).toBeVisible();
    await expect(
      page
        .locator(".legal-entity-candidate:visible, .entity-review")
        .filter({ hasText: "Demo Climate" }),
    ).toHaveCount(0);
    await noOverflow(page);
  },
);

test(
  "validates manual name_not_found entry without requiring an excerpt or reason",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const { row, writes } = await setup(page, "legacy_name_not_found");
    await row
      .getByRole("button", {
        name: "Review PDF",
        exact: true,
      })
      .click();

    await selectReviewSection(page, "Documents");
    await expect(row).toContainText(
      "Review the agreement and enter its exact name and page.",
    );
    await expect(row).not.toContainText("page and excerpt");
    await expect(row).toHaveScreenshot("legal-name-recovery-guidance.png", {
      animations: "disabled",
      caret: "hide",
    });
    await noOverflow(page);
    await selectReviewSection(page, "Identity");

    const resolver = row.getByRole("form");

    const submit = resolver.getByRole("button", {
      name: "Continue with this name",
    });
    const name = resolver.getByLabel("Exact legal name", { exact: true });
    const agreementPage = resolver.getByLabel("Agreement page", {
      exact: true,
    });
    await expect(resolver).toHaveAttribute("novalidate", "");
    await expect(submit).toBeDisabled();
    await expect(resolver.getByLabel("Reason for correction")).toHaveCount(0);
    await resolver.evaluate((form) => {
      form.dataset.invalidEvents = "0";
      form.addEventListener(
        "invalid",
        () => {
          form.dataset.invalidEvents = String(
            Number(form.dataset.invalidEvents) + 1,
          );
        },
        true,
      );
    });
    await name.press("Enter");
    await expect(resolver).toHaveAttribute("data-invalid-events", "0");
    await expect(row.locator(".legal-entity-editor")).toHaveCount(0);
    await name.fill("Demo Recognized LLC");
    await agreementPage.fill("4");
    // The only eligible supporting agreement is prefilled, not fabricated.
    await expect(
      resolver.getByRole("combobox", { name: "Supporting agreement" }),
    ).toContainText("demo-subscription.pdf");
    await expect(submit).toBeEnabled();
    await resolver
      .getByRole("combobox", { name: "Supporting agreement" })
      .click();
    await page
      .getByRole("option", { name: "demo-subscription.pdf", exact: true })
      .click();
    await expect(submit).toBeEnabled();
    const excerpt = resolver.getByLabel("Document excerpt");
    await agreementPage.fill("151");
    await expect(submit).toBeDisabled();
    await agreementPage.fill("4");
    await name.fill("   ");
    await expect(submit).toBeDisabled();
    await name.fill("Demo Recognized LLC");
    await excerpt.fill("Unrelated text");
    await expect(submit).toBeDisabled();
    await expect(excerpt).toHaveAttribute("aria-invalid", "true");
    await excerpt.fill("The issuer is Demo Recognized LLC.");
    await expect(submit).toBeEnabled();
    await excerpt.fill("");
    await expect(submit).toBeEnabled();
    // Do not capture a hover carried from a control that moved during editing.
    await page.mouse.move(0, 0);
    await expect(resolver).toHaveScreenshot("legal-name-entry.png", {
      animations: "disabled",
      caret: "hide",
    });
    await noOverflow(page);
    await submit.click();
    const editor = row.locator(".legal-entity-editor");
    await expect(editor).toBeVisible();
    const entityType = editor.getByRole("combobox", { name: "Entity type" });
    await expect(entityType).toBeEnabled();

    const add = editor.getByRole("button", {
      name: "Add entity",
      exact: true,
    });
    await expect(editor.locator("form")).toHaveAttribute("novalidate", "");
    await expect(add).toBeEnabled();
    await editor
      .getByRole("button", { name: "Additional details (optional)" })
      .click();
    await editor.getByLabel("EIN last four").fill("12");
    await expect(add).toBeDisabled();
    await expect(editor).toContainText("Enter exactly four digits");
    await editor.getByLabel("EIN last four").press("Enter");
    expect(writes).toHaveLength(0);
    await editor.getByLabel("EIN last four").fill("12345");
    await expect(add).toBeDisabled();
    await editor.getByLabel("EIN last four").fill("1234");
    await expect(editor.getByLabel("EIN last four")).toHaveValue("1234");
    await expect(add).toBeEnabled();
    // Participation and percentages now belong to the specific investment.
    // Their independent validation is covered in investment-review.visual.
    await expect(editor.getByLabel("Ownership interest")).toHaveCount(0);
    await expect(add).toBeEnabled();
    await add.click();
    await expect
      .poll(() => writes[0])
      .toMatchObject({
        profile: { entityType: "llc", relationship: "investment_vehicle" },
        source: {
          nameResolution: {
            kind: "document_entry",
            documentId: "11111111-1111-4111-8111-111111111111",
            legalName: "Demo Recognized LLC",
            page: 4,
            quote: null,
            reason: null,
          },
        },
      });
    if (
      await page
        .getByRole("button", { name: "Back to legal entities", exact: true })
        .count()
    )
      await page
        .getByRole("button", { name: "Back to legal entities", exact: true })
        .click();
    await page.reload();
    await expect(
      page.getByText(/Name entered by you: Demo Recognized LLC/),
    ).toBeVisible();

    await noOverflow(page);
  },
);

test(
  "keeps following content reachable in a 500-source queue with automatic observation",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push(new URL(request.url()).pathname);
    });
    const { inventory } = await setup(page, "name_not_found");
    const document = structuredClone(inventory.candidates[0]!);
    inventory.candidates = Array.from({ length: 498 }, (_, index) => ({
      ...structuredClone(source),
      source: { kind: "holding_position" as const, id: `demo-scale-${index}` },
      sourceDisplayName: `Demo ${String(index).padStart(3, "0")}`,
      suggestedEntityType: "llc" as const,
      legalEntityNameEvidence: {
        state: "provider_reported" as const,
        legalName: `Demo ${String(index).padStart(3, "0")} LLC`,
        sourceField: "Fund Name",
      },
    }));
    inventory.candidates.push(
      {
        ...structuredClone(source),
        source: { kind: "holding_position", id: "demo-conflict-last" },
      },
      document,
    );
    if (
      await page
        .getByRole("button", { name: "Back to legal entities", exact: true })
        .count()
    )
      await page
        .getByRole("button", { name: "Back to legal entities", exact: true })
        .click();
    await page.reload();
    await page.getByRole("button", { name: /^Needs your review/u }).click();
    const rows = page.locator(
      ".legal-entity-candidate:visible, .entity-review",
    );
    await expect(rows).toHaveCount(25);
    await expect(rows.nth(0)).toContainText("Review PDF");
    await expect(rows.nth(1)).toContainText("Names disagree");
    await expect(rows.nth(2)).toContainText("Demo 000 LLC");
    await expect(page.getByText("Showing 25 of 500 sources")).toBeVisible();
    const loadMore = page.getByRole("button", {
      name: "Load more sources",
      exact: true,
    });
    // Known entities and Add entity follow this queue, so scrolling must leave
    // them reachable even when IntersectionObserver is available.
    await loadMore.scrollIntoViewIfNeeded();
    await expect(rows).toHaveCount(25);
    await page
      .getByRole("button", { name: "Add entity", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(rows).toHaveCount(25);
    await loadMore.click();
    await expect(rows).toHaveCount(50);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await rows
      .nth(26)
      .getByRole("button", { name: "Review details", exact: true })
      .click();
    const draft = page
      .getByRole("tabpanel", { name: "Identity", exact: true })
      .getByLabel("Legal name", { exact: true });
    await draft.fill("Demo Draft Still Here LLC");
    await selectReviewSection(page, "Ownership");
    await selectReviewSection(page, "Identity");
    await expect(draft).toHaveValue("Demo Draft Still Here LLC");
    await page
      .getByRole("button", { name: "Back to legal entities", exact: true })
      .click();
    await expect(rows).toHaveCount(50);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThanOrEqual(scrollBefore - 5);
    expect(
      requests.filter((path) => path === "/api/legal-entities"),
    ).toHaveLength(2);
    expect(
      requests.filter((path) =>
        [
          "/api/holdings-page",
          "/api/alpha",
          "/api/investment-holdings",
        ].includes(path),
      ),
    ).toEqual([]);
    await noOverflow(page);
  },
);

test(
  "keeps a stale resolution unsaved, reloads evidence, then links the exact existing entity",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const { row, inventory, writes, reject } = await setup(page);
    reject(true);
    await row
      .getByRole("button", { name: "Resolve name", exact: true })
      .click();
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
    await expect(resolver).toBeVisible();
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
    await expect(
      page.getByRole("button", { name: "Edit legal entity", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Review saved.", { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Back to legal entities", exact: true })
      .click();
    await expect(
      page
        .locator(".legal-entity-candidate:visible")
        .filter({ hasText: "Demo Climate" }),
    ).toHaveCount(0);
    expect(inventory.entities).toHaveLength(1);
    expect(writes).toHaveLength(2);
    expect(inventory.entities[0]?.sources[0]?.nameResolution).toMatchObject({
      legalName: "Demo Climate, LLC",
      kind: "document_choice",
    });
  },
);
