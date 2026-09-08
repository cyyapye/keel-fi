import { expect, test, type Page } from "@playwright/test";
import type {
  LegalEntityInventory,
  LegalEntitySourceSummary,
} from "../packages/domain/src/legal-entities";
import {
  CreateDocumentInvestmentInputSchema,
  InvestmentOwnershipObservationSchema,
} from "../packages/domain/src/investment-review";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import {
  routeInvestmentReview,
  selectReviewSection,
} from "./investment-review-fixtures";

async function setup(page: Page, conflict = false, backgroundCount = 0) {
  const doc = {
    id: "11111111-1111-4111-8111-111111111111",
    fileName: "demo-growth-subscription.pdf",
    sha256: "a".repeat(64),
    page: 1,
    quote: "Fund: Demo Growth IV LLC",
    citations: [
      {
        legalName: "Demo Growth IV LLC",
        page: 1,
        quote: "Fund: Demo Growth IV LLC",
        role: "fund" as const,
      },
    ],
    companyCitations: [
      {
        companyName: "Demo Robotics Inc.",
        page: 2,
        quote: "Underlying Company: Demo Robotics Inc.",
        role: "underlying_company" as const,
      },
    ],
    scan: {
      version: 1 as const,
      engineVersion: "1.5.3",
      databaseVersion: 28000,
      databaseUpdatedAt: "2026-09-01T10:00:00.000Z",
      scannedAt: "2026-09-01T11:00:00.000Z",
      sha256: "a".repeat(64),
      outcome: "clean" as const,
    },
  };
  const source: LegalEntitySourceSummary = {
    source: { kind: "holding_position", id: "position_demo_growth_iv" },
    sourceDisplayName: "Demo Growth IV",
    sourceLabel: "Sydecar agreement",
    sourceAsOf: "2026-09-01",
    currentOwner: "Demo Family LLC",
    currentDecisionId: null,
    suggestedEntityType: conflict ? null : "llc",
    relationship: "investment_vehicle",
    interestStatus: "current",
    financials: null,
    openedOn: null,
    legalEntityNameEvidence: {
      state: "document_reported",
      legalName: "Demo Growth IV LLC",
      sourceField: "Agreement",
      documents: [doc],
    },
  };
  if (conflict)
    source.legalEntityNameEvidence = {
      state: "unavailable",
      legalName: null,
      sourceField: null,
      problem: "conflicting",
      documents: [
        doc,
        {
          ...doc,
          id: "22222222-2222-4222-8222-222222222222",
          fileName: "demo-cancelled-subscription.pdf",
          citations: [
            {
              legalName: "Demo Cancelled LLC",
              page: 1,
              quote: "Fund: Demo Cancelled LLC",
              role: "fund",
            },
          ],
        },
      ],
    };
  const inventory: LegalEntityInventory = {
    version: 3,
    asOf: "2026-09-01T12:00:00.000Z",
    entities: [],
    candidates: [
      source,
      ...Array.from({ length: backgroundCount }, (_, index) => ({
        ...source,
        source: {
          kind: "holding_position" as const,
          id: `demo_background_${index}`,
        },
        sourceDisplayName: `Demo A ${index} LLC`,
        suggestedEntityType: "llc" as const,
        legalEntityNameEvidence: {
          state: "provider_reported" as const,
          legalName: `Demo A ${index} LLC`,
          sourceField: "Fund Name",
        },
      })),
    ],
    excludedCandidates: [],
    exactBatch: {
      revision: "a".repeat(64),
      sourceCount: 1,
      entityCount: 1,
      existingEntityCount: 0,
      newEntityCount: 1,
      llcEntityCount: 1,
      limitedPartnershipEntityCount: 0,
      remainingCandidateCount: 0,
    },
  };
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/legal-entities", (route) =>
    route.fulfill({ json: inventory }),
  );
  const fixture = await routeInvestmentReview(page, source, {
    snapshotId: "snapshot_demo_growth_iv",
    committedMinor: 1_000_000,
    fundedMinor: 1_000_000,
    economics: {
      snapshotId: "snapshot_demo_growth_iv",
      currency: "USD",
      committedMinor: 1_000_000,
      fundedMinor: 1_000_000,
      acceptedTerms: null,
      reportedTerms: null,
    },
    companyChoices: [
      {
        documentId: doc.id,
        sha256: doc.sha256,
        companyName: "Demo Robotics Inc.",
        page: 2,
        quote: "Underlying Company: Demo Robotics Inc.",
      },
    ],
    otherPositions: [
      { id: "position_demo_growth_v", label: "Demo Growth V LLC" },
    ],
  });
  await page.goto("/holdings/entities");
  expect(fixture.reads()).toBe(0);
  const row = page.locator(".legal-entity-candidate").filter({
    has: page.getByRole("heading", { name: /^Demo Growth IV(?: LLC)?$/u }),
  });
  await row
    .getByRole("button", {
      name: conflict ? "Resolve name" : "Review details",
      exact: true,
    })
    .click();
  const review = page.getByRole("region", {
    name: "Investment review",
    exact: true,
  });
  await expect(review.locator(".section-navigation")).toBeVisible();
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  return {
    ...fixture,
    row: page.locator(".entity-review"),
    review,
    source,
    inventory,
  };
}

test("opens the supported entity name after moving a different investment's agreement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", {
      value: undefined,
      configurable: true,
    });
  });
  const { review, row, source, context } = await setup(page, true, 40);
  await expect(page.locator(".legal-entity-candidate")).toHaveCount(25);
  await selectReviewSection(page, "Ownership");
  await review
    .getByRole("button", { name: "Add ownership evidence", exact: true })
    .click();
  await expect(
    review.getByLabel("Source description", { exact: true }),
  ).toHaveCount(0);
  await review
    .getByRole("textbox", { name: "Ownership interest %", exact: true })
    .fill("12.5");
  await page.route(
    "**/api/investment-positions/*/related-investments",
    async (route) => {
      const input = CreateDocumentInvestmentInputSchema.parse(
        route.request().postDataJSON(),
      );
      expect(input.documentIds).toEqual([
        "22222222-2222-4222-8222-222222222222",
      ]);
      source.legalEntityNameEvidence = {
        state: "document_reported",
        legalName: "Demo Growth IV LLC",
        sourceField: "Assigned agreement",
        documents: [context.documents[0]!],
      };
      source.suggestedEntityType = "llc";
      return route.fulfill({
        status: 201,
        json: { positionId: "position_demo_cancelled" },
      });
    },
  );
  await selectReviewSection(page, "Documents");
  await review
    .getByRole("combobox", { name: "These agreements belong to" })
    .click();
  await page
    .getByRole("option", { name: "A separate investment", exact: true })
    .click();
  await review
    .getByRole("checkbox", {
      name: "demo-cancelled-subscription.pdf",
      exact: true,
    })
    .check();
  await review
    .getByLabel("Investment label", { exact: true })
    .fill("Demo Cancelled Vehicle");
  await review
    .getByRole("button", { name: "Create separate investment", exact: true })
    .click();
  await selectReviewSection(page, "Identity");
  await expect(
    row.getByRole("textbox", { name: "Legal name", exact: true }),
  ).toHaveValue("Demo Growth IV LLC");
  await expect(
    row.getByRole("heading", { name: "Resolve name", exact: true }),
  ).toHaveCount(0);
  await selectReviewSection(page, "Ownership");
  await expect(
    review.getByRole("textbox", { name: "Ownership interest %", exact: true }),
  ).toHaveValue("12.5");
  // Reordering the background list does not remount the dedicated review.
  await expect(page.locator(".legal-entity-candidate")).toHaveCount(25);
});

test("distinguishes an earlier company mapping from agreement evidence and never preselects a saved entity", async ({
  page,
}) => {
  const { context, inventory } = await setup(page);
  context.companyChoices = [];
  context.mappings = [
    {
      id: "mapping_demo_old",
      companyId: "company_demo",
      companyName: "Demo Legacy Company",
      status: "active",
      decisionSource: "review",
      acceptedAt: "2026-08-01T12:00:00.000Z",
    },
  ];
  const saved = {
    id: "entity_demo_match",
    versionId: "entity_demo_match_v1",
    version: 1,
    legalName: "Demo Growth IV LLC",
    entityType: "llc" as const,
    relationship: "investment_vehicle" as const,
    currentOwner: null,
    jurisdiction: null,
    formedOn: null,
    einLastFour: null,
    ownershipInterestPpm: null,
    interestStatus: "current" as const,
    taxClassification: null,
    notes: null,
    recordedAt: "2026-09-01T12:00:00.000Z",
    sources: [],
  };
  inventory.entities = [
    {
      ...saved,
      id: "entity_demo_unrelated",
      legalName: "Demo Unrelated Vehicle LLC",
    },
    saved,
  ];
  await page.reload(); // Direct links must reopen the same investment and tab.
  const workspace = page.locator(".entity-review");
  await expect(
    workspace.getByText("Currently mapped to Demo Legacy Company", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(workspace.getByText(/Earlier reviewed mapping/)).toBeVisible();
  await expect(
    workspace.getByText(/No supporting company citation was extracted/),
  ).toBeVisible();
  await workspace
    .getByRole("radio", { name: "Link existing entity", exact: true })
    .check();
  const picker = workspace.getByRole("combobox", {
    name: "Existing legal entity",
    exact: true,
  });
  await expect(picker).toContainText("Choose an entity");
  await expect(
    workspace.getByRole("button", { name: "Link entity", exact: true }),
  ).toBeDisabled();
  await picker.click();
  await expect(
    page.getByRole("option", {
      name: "Demo Unrelated Vehicle LLC",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("option", { name: "Demo Growth IV LLC", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Link entity", exact: true }),
  ).toBeEnabled();
  await expect(workspace).toHaveScreenshot("investment-existing-link.png", {
    animations: "disabled",
    caret: "hide",
  });
});

test("reviews company evidence and keeps ownership drafts across independent saves", async ({
  page,
}) => {
  const { review, writes } = await setup(page);
  await selectReviewSection(page, "Ownership");
  await review
    .getByRole("button", { name: "Add ownership evidence", exact: true })
    .click();
  for (const value of ["101", "-1", "1.12345", "abc"]) {
    await review
      .getByRole("textbox", { name: "Ownership interest %", exact: true })
      .fill(value);
    await expect(
      review.getByRole("button", { name: "Save ownership evidence" }),
    ).toBeDisabled();
  }
  await review
    .getByRole("textbox", { name: "Ownership interest %", exact: true })
    .fill("12.5");
  await expect(
    review.getByRole("button", { name: "Save ownership evidence" }),
  ).toBeDisabled();
  await selectReviewSection(page, "Investment");
  await review
    .getByRole("combobox", { name: "This investment’s status" })
    .click();
  await page.getByRole("option", { name: "Pending", exact: true }).click();
  await review.getByRole("button", { name: "Save participation" }).click();
  await expect(
    review.getByRole("button", { name: "Save participation", exact: true }),
  ).toBeDisabled();
  await expect(
    review.getByText("Investment review saved.", { exact: true }),
  ).toHaveCount(0);
  await selectReviewSection(page, "Ownership");
  await expect(
    review.getByRole("textbox", { name: "Ownership interest %", exact: true }),
  ).toHaveValue("12.5");
  expect(writes[0]).toMatchObject({ participationStatus: "pending" });
  await selectReviewSection(page, "Ownership");
  await selectReviewSection(page, "Identity");
  await review
    .getByRole("button", { name: "Underlying company", exact: true })
    .click();
  await expect(
    review.getByRole("button", { name: "Save company mapping" }),
  ).toBeEnabled();
  await expect(
    review.getByRole("combobox", { name: "Company evidence" }),
  ).toContainText("Demo Robotics Inc.");
  await review.getByRole("combobox", { name: "Company evidence" }).click();
  await page
    .getByRole("option", { name: "Demo Robotics Inc. · page 2", exact: true })
    .click();
  await expect(
    review.getByText("Underlying Company: Demo Robotics Inc.", { exact: true }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  await expect
    .poll(() =>
      review
        .getByRole("button", { name: "Save company mapping" })
        .evaluate((element) => element.matches(":hover")),
    )
    .toBe(false);
  await expect(review).toHaveScreenshot("investment-company-review.png", {
    animations: "disabled",
    caret: "hide",
  });
  await review.getByRole("button", { name: "Save company mapping" }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({
    basis: "document_choice",
    company: { mode: "new", legalName: "Demo Robotics Inc." },
    citation: { documentId: "11111111-1111-4111-8111-111111111111", page: 2 },
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("keeps K-1 shares optional, validates them separately, and retains a rejected draft", async ({
  page,
}) => {
  const { review, writes, rejectWrites } = await setup(page);
  await selectReviewSection(page, "Ownership");
  await expect(
    review.getByRole("textbox", { name: "Ownership interest %", exact: true }),
  ).toHaveCount(0);
  await expect(review).toHaveScreenshot("investment-ownership-optional.png", {
    animations: "disabled",
  });
  await review
    .getByRole("button", { name: "Add ownership evidence", exact: true })
    .click();
  await review.getByRole("combobox", { name: "Ownership source" }).click();
  await page.getByRole("option", { name: "K-1", exact: true }).click();
  await review.getByLabel("Tax year", { exact: true }).fill("2025");
  await expect(
    review.getByRole("button", { name: "Save ownership evidence" }),
  ).toBeDisabled();
  await review
    .getByRole("textbox", { name: "Capital · ending %", exact: true })
    .fill("101");
  await expect(
    review.getByRole("button", { name: "Save ownership evidence" }),
  ).toBeDisabled();
  await review
    .getByRole("textbox", { name: "Capital · ending %", exact: true })
    .fill("0");
  await expect(
    review.getByRole("button", { name: "Save ownership evidence" }),
  ).toBeEnabled();
  await expect(review).toHaveScreenshot("investment-ownership-review.png", {
    animations: "disabled",
    caret: "hide",
  });
  rejectWrites(true);
  await review.getByRole("button", { name: "Save ownership evidence" }).click();
  await expect(
    review.getByText("This investment changed.", { exact: false }),
  ).toBeVisible();
  await expect(
    review.getByRole("textbox", { name: "Capital · ending %", exact: true }),
  ).toHaveValue("0");
  expect(writes[0]).toMatchObject({
    ownershipObservation: {
      sourceKind: "k1",
      sourceLabel: "K-1",
      taxYear: 2025,
      ownershipPpm: null,
      capitalBeginningPpm: null,
      capitalEndingPpm: 0,
      documentId: null,
    },
  });
  rejectWrites(false);
  await review.getByRole("button", { name: "Save ownership evidence" }).click();
  await expect(
    review.getByRole("button", { name: "Add another observation" }),
  ).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Save ownership evidence" }),
  ).toHaveCount(0);
  await expect(review.locator(".ownership-evidence")).toContainText("2025 K-1");
  await expect(review.locator(".ownership-evidence")).toContainText(
    "Not reported",
  );
  await expect(review.locator(".ownership-evidence")).toContainText("0%");
  await expect(review).toHaveScreenshot(
    "investment-ownership-k1-recorded.png",
    { animations: "disabled", caret: "hide" },
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("creates a separate cancelled investment with selected agreements, not copied amounts", async ({
  page,
}) => {
  const { review } = await setup(page);
  let submitted: unknown;
  await page.route(
    "**/api/investment-positions/*/related-investments",
    async (route) => {
      submitted = CreateDocumentInvestmentInputSchema.parse(
        route.request().postDataJSON(),
      );
      return route.fulfill({
        status: 201,
        json: { positionId: "position_demo_cancelled" },
      });
    },
  );
  await selectReviewSection(page, "Documents");
  await expect(
    review.getByRole("combobox", { name: "New investment’s status" }),
  ).toHaveCount(0);
  await review
    .getByRole("combobox", { name: "These agreements belong to" })
    .click();
  await page
    .getByRole("option", { name: "A separate investment", exact: true })
    .click();
  const button = review.getByRole("button", {
    name: "Create separate investment",
    exact: true,
  });
  await expect(button).toBeDisabled();
  await review
    .getByRole("checkbox", {
      name: "demo-growth-subscription.pdf",
      exact: true,
    })
    .check();
  await expect(
    review.getByLabel("Investment label", { exact: true }),
  ).toHaveValue("Demo Growth IV LLC");
  await expect(
    review.getByRole("combobox", { name: "New investment’s status" }),
  ).toContainText("Not confirmed");
  await review
    .getByLabel("Investment label", { exact: true })
    .fill("Demo Cancelled Vehicle");
  await review
    .getByRole("combobox", { name: "New investment’s status" })
    .click();
  await page.getByRole("option", { name: "Cancelled", exact: true }).click();
  await expect(review).toHaveScreenshot("investment-document-assignment.png", {
    animations: "disabled",
    caret: "hide",
  });
  await button.click();
  await expect.poll(() => submitted).toBeTruthy();
  expect(submitted).toMatchObject({
    label: "Demo Cancelled Vehicle",
    participationStatus: "cancelled",
    documentIds: ["11111111-1111-4111-8111-111111111111"],
  });
  expect(submitted).not.toHaveProperty("committedMinor");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("uses responsive section navigation, keeps focus rings visible, and leaves unsourced terms blank", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { review, writes } = await setup(page);
  const navigation = review.locator(".section-navigation");
  await expect(navigation).toContainText("Optional");
  if (isMobile) {
    await expect(
      review.getByRole("tab", { name: "Identity", exact: true }),
    ).toBeHidden();
    const dropdown = review.getByRole("combobox", { name: "Review sections" });
    await dropdown.click();
    await expect(
      page.getByRole("option", { name: /^Ownership Optional/u }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("investment-section-menu.png", {
      animations: "disabled",
      caret: "hide",
    });
    await page.keyboard.press("Escape");
  } else {
    await expect(
      review.getByRole("combobox", { name: "Review sections" }),
    ).toBeHidden();
    await expect(
      review.getByRole("tab", { name: "Identity", exact: true }),
    ).toBeVisible();
  }
  await expect(review.locator(".legal-entity-editor__actions")).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await review
    .getByRole("button", { name: "Underlying company", exact: true })
    .click();
  await review.getByRole("combobox", { name: "Company evidence" }).click();
  await page
    .getByRole("option", { name: "Confirm a company yourself", exact: true })
    .click();
  const companyName = review.getByRole("textbox", {
    name: "Company name",
    exact: true,
  });
  await companyName.fill("Demo Focus Company");
  await companyName.focus();
  // Finish font layout before anchoring the viewport to the focused control.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await companyName.evaluate((input) =>
    input.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await expect(companyName).toHaveCSS("outline-style", "solid");
  // The open shared disclosure must not crop any edge of the focus outline.
  await expect
    .poll(() =>
      companyName.evaluate((input) => {
        const field = input.getBoundingClientRect();
        let parent = input.parentElement;
        while (parent && parent !== document.body) {
          const style = getComputedStyle(parent);
          if (
            [style.overflowX, style.overflowY].some((value) =>
              ["hidden", "clip", "auto", "scroll"].includes(value),
            )
          ) {
            const rect = parent.getBoundingClientRect();
            if (
              rect.left > field.left - 3 ||
              rect.right < field.right + 3 ||
              rect.top > field.top - 3 ||
              rect.bottom < field.bottom + 3
            )
              return false;
          }
          parent = parent.parentElement;
        }
        return true;
      }),
    )
    .toBe(true);
  await expect(page).toHaveScreenshot("investment-company-focus.png", {
    animations: "disabled",
    caret: "hide",
  });
  await selectReviewSection(page, "Investment");
  await review
    .getByRole("button", { name: "Add fee & carry", exact: true })
    .click();
  for (const label of ["Admin fee rate", "Fee term", "Carry"]) {
    await expect(review.getByLabel(label)).toHaveValue("");
    await expect(
      review.getByLabel(label).locator("xpath=ancestor::label"),
    ).toHaveClass(/field--filled/u);
  }
  await expect(
    review.getByLabel("What changed").locator("xpath=ancestor::label"),
  ).toHaveClass(/field--filled/u);
  await expect(review.locator(".position-economics__form")).toHaveScreenshot(
    "investment-fee-carry-fields.png",
    { animations: "disabled", caret: "hide" },
  );
  await expect(
    review.getByRole("button", { name: "Review terms", exact: true }),
  ).toBeDisabled();
  await selectReviewSection(page, "Identity");
  await expect(companyName).toHaveValue("Demo Focus Company");
  expect(writes).toHaveLength(0);
  await review
    .getByRole("button", { name: "Save company mapping", exact: true })
    .click();
  await expect(
    review.getByRole("button", { name: "Save company mapping", exact: true }),
  ).toBeDisabled();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    basis: "user_confirmed",
    company: { mode: "new", legalName: "Demo Focus Company" },
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("shows saved document destinations after reload, preserves earlier assignments, and retains a rejected selection", async ({
  page,
}) => {
  const { review, writes, context, rejectWrites } = await setup(page, true);
  await selectReviewSection(page, "Documents");
  let first = review.getByRole("article", {
    name: "demo-growth-subscription.pdf",
    exact: true,
  });
  const save = review.getByRole("button", {
    name: "Save document assignment",
    exact: true,
  });
  await expect(first).toContainText("Not assigned");
  await first.getByRole("checkbox").check();
  rejectWrites(true);
  await save.click();
  await expect(
    review.getByText("This investment changed.", { exact: false }),
  ).toBeVisible();
  await expect(first.getByRole("checkbox")).toBeChecked();
  rejectWrites(false);
  await save.click();
  await expect(first.getByRole("checkbox")).not.toBeChecked();
  await expect(first.locator(".investment-review__assignment")).toContainText(
    "This investment",
  );
  await expect(
    review.locator(".investment-review__assignment-count"),
  ).toHaveText("1 of 2 assigned · 1 still to assign");
  await expect(review.locator(".section-navigation")).toContainText(
    "Assign agreements",
  );
  await expect(save).toBeDisabled();
  expect(context.review?.documentAssignments).toHaveLength(1);
  await page.reload();
  await selectReviewSection(page, "Documents");
  first = page.getByRole("article", {
    name: "demo-growth-subscription.pdf",
    exact: true,
  });
  await expect(first.locator(".investment-review__assignment")).toContainText(
    "This investment",
  );
  await first.getByRole("checkbox").check();
  await expect(save).toBeDisabled();
  await first.getByRole("checkbox").uncheck();
  await expect(
    review.locator("form:has(.investment-review__documents)"),
  ).toHaveScreenshot("investment-document-assignment-saved.png", {
    animations: "disabled",
    caret: "hide",
  });
  const second = page.getByRole("article", {
    name: "demo-cancelled-subscription.pdf",
    exact: true,
  });
  await second.getByRole("checkbox").check();
  await review
    .getByRole("combobox", { name: "These agreements belong to" })
    .click();
  await page
    .getByRole("option", { name: "General or parent agreement", exact: true })
    .click();
  await save.click();
  await expect(second.locator(".investment-review__assignment")).toContainText(
    "General or parent agreement",
  );
  await expect(first.locator(".investment-review__assignment")).toContainText(
    "This investment",
  );
  await expect(
    review.locator(".investment-review__assignment-count"),
  ).toHaveText("2 of 2 assigned · All agreements assigned");
  expect(context.review?.documentAssignments).toHaveLength(2);
  expect(writes).toHaveLength(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("presents ownership values with source and date rather than a bullet list", async ({
  page,
}) => {
  const { context } = await setup(page);
  const doc = context.documents[0]!;
  context.review = {
    id: "33333333-3333-4333-8333-333333333333",
    positionId: context.positionId,
    version: 1,
    participationStatus: "current",
    documentAssignments: [],
    recordedAt: "2026-09-01T12:00:00.000Z",
    ownershipObservations: [
      InvestmentOwnershipObservationSchema.parse({
        id: "44444444-4444-4444-8444-444444444444",
        recordedAt: "2026-09-01T12:00:00.000Z",
        sourceKind: "agreement",
        sourceLabel: doc.fileName,
        effectiveDate: "2026-08-15",
        taxYear: null,
        ownershipPpm: 125_000,
        profitBeginningPpm: null,
        profitEndingPpm: null,
        lossBeginningPpm: null,
        lossEndingPpm: null,
        capitalBeginningPpm: null,
        capitalEndingPpm: null,
        documentId: doc.id,
        documentSha256: doc.sha256,
        page: 2,
        quote: null,
        evidenceBasis: "document_review",
        supersedesObservationId: null,
      }),
    ],
  };
  await page.reload();
  await selectReviewSection(page, "Ownership");
  const entries = page.locator(".ownership-evidence");
  await expect(entries.locator("article")).toHaveCount(1);
  await expect(entries.locator("ul, li")).toHaveCount(0);
  await expect(entries).toContainText("12.5%");
  await expect(entries).toContainText("As of Aug 15, 2026");
  await expect(entries).toContainText("Document reviewed · page 2");
  await expect(entries.getByText(doc.fileName, { exact: true })).toHaveCount(1);
  await expect(page.locator(".investment-review")).toHaveScreenshot(
    "investment-ownership-recorded.png",
    { animations: "disabled", caret: "hide" },
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("shows saving on the clicked button then disables unchanged submission without success banners", async ({
  page,
}) => {
  const { review, writes } = await setup(page);
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/investment-positions/*/review", async (route) => {
    if (route.request().method() === "POST") await pending;
    await route.fallback();
  });
  await selectReviewSection(page, "Investment");
  await review
    .getByRole("button", { name: "Save participation", exact: true })
    .click();
  await expect(
    review.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  release();
  await expect(
    review.getByRole("button", { name: "Save participation", exact: true }),
  ).toBeDisabled();
  await expect.poll(() => writes.length).toBe(1);
  await expect(review.locator(".section-navigation")).toContainText("Reviewed");
  await expect(
    page.getByText(/^(Review saved\.|Investment review saved\.)$/u),
  ).toHaveCount(0);
  expect(writes[0]).not.toHaveProperty("ownershipObservation");
  await selectReviewSection(page, "Ownership");
  await expect(
    review.getByRole("button", { name: "Add ownership evidence", exact: true }),
  ).toBeVisible();
});
