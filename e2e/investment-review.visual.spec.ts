import { expect, test, type Page } from "@playwright/test";
import type {
  LegalEntityInventory,
  LegalEntitySourceSummary,
} from "../packages/domain/src/legal-entities";
import { CreateDocumentInvestmentInputSchema } from "../packages/domain/src/investment-review";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { routeInvestmentReview } from "./investment-review-fixtures";

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
  const review = row.getByRole("region", {
    name: "Investment review",
    exact: true,
  });
  await expect(
    review.getByRole("button", { name: "Participation", exact: true }),
  ).toBeVisible();
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  return { ...fixture, row, review, source };
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
  await review
    .getByRole("button", { name: "Ownership evidence", exact: true })
    .click();
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
  await review
    .getByRole("button", { name: "Assign agreements", exact: true })
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
  await expect(
    row.getByRole("textbox", { name: "Legal name", exact: true }),
  ).toHaveValue("Demo Growth IV LLC");
  await expect(
    row.getByRole("heading", { name: "Resolve name", exact: true }),
  ).toHaveCount(0);
  await expect(
    review.getByRole("textbox", { name: "Ownership interest %", exact: true }),
  ).toHaveValue("12.5");
  // The source moves below the first page after its conflict is resolved. Its
  // active review remains mounted until closed, so independent drafts survive.
  await expect(page.locator(".legal-entity-candidate")).toHaveCount(26);
});

test("reviews company evidence and keeps ownership drafts across independent saves", async ({
  page,
}) => {
  const { review, writes } = await setup(page);
  await review
    .getByRole("button", { name: "Ownership evidence", exact: true })
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
  await review
    .getByRole("button", { name: "Participation", exact: true })
    .click();
  await review.getByRole("combobox", { name: "Participation status" }).click();
  await page.getByRole("option", { name: "Pending", exact: true }).click();
  await review.getByRole("button", { name: "Save participation" }).click();
  await expect(
    review.getByText("Investment review saved.", { exact: true }),
  ).toBeVisible();
  await expect(
    review.getByRole("textbox", { name: "Ownership interest %", exact: true }),
  ).toHaveValue("12.5");
  expect(writes[0]).toMatchObject({ participationStatus: "pending" });
  await review
    .getByRole("button", { name: "Ownership evidence", exact: true })
    .click();
  await review
    .getByRole("button", { name: "Underlying company", exact: true })
    .click();
  await expect(
    review.getByRole("button", { name: "Save company mapping" }),
  ).toBeDisabled();
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
  await review
    .getByRole("button", { name: "Ownership evidence", exact: true })
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
    review.getByRole("button", { name: "Save ownership evidence" }),
  ).toBeDisabled();
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
  await review
    .getByRole("button", { name: "Assign agreements", exact: true })
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
  await review
    .getByLabel("Investment label", { exact: true })
    .fill("Demo Cancelled Vehicle");
  await review
    .getByRole("combobox", { name: "Separate investment status" })
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
