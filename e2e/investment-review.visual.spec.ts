import { expect, test, type Page } from "./api-mocked-test";
import {
  CreateLegalEntityInputSchema,
  type LegalEntityInventory,
  type LegalEntitySourceSummary,
} from "../packages/domain/src/legal-entities";
import {
  CreateDocumentInvestmentInputSchema,
  InvestmentOwnershipObservationSchema,
} from "../packages/domain/src/investment-review";
import { PositionEconomicsTermsSchema } from "../packages/domain/src/position-economics";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import {
  routeInvestmentReview,
  selectReviewSection,
} from "./investment-review-fixtures";

async function setup(
  page: Page,
  {
    conflict = false,
    backgroundCount = 0,
    netImported = false,
    purchaseFlow = false,
    entry = "review",
  }: {
    conflict?: boolean;
    backgroundCount?: number;
    netImported?: boolean;
    purchaseFlow?: boolean;
    entry?: "inventory" | "review";
  } = {},
) {
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
    sourceLabel: netImported ? "Tokenfolio template" : "Sydecar agreement",
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
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        ".topbar, .mobile-nav { visibility: hidden !important; }";
      document.head.appendChild(style);
    });
  });
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
    ...(purchaseFlow
      ? {
          positionKind: "spv_interest",
          purchaseContext: {
            snapshotId: "snapshot_demo_growth_iv",
            currency: "USD",
            openedOn: "2026-02-01",
            receipt: null,
          },
        }
      : {}),
    committedMinor: netImported ? 2_730_000 : 1_000_000,
    fundedMinor: netImported ? 2_730_000 : 1_000_000,
    economics: {
      snapshotId: "snapshot_demo_growth_iv",
      currency: "USD",
      committedMinor: netImported ? 2_730_000 : 1_000_000,
      fundedMinor: netImported ? 2_730_000 : 1_000_000,
      acceptedTerms: null,
      reportedTerms: null,
    },
    mappings: [
      {
        id: "mapping_demo_existing",
        companyId: "company_demo_existing",
        companyName: "Demo Earlier Company",
        status: "active",
        decisionSource: "review",
      },
    ],
    companies: [
      { id: "company_demo_existing", legalName: "Demo Earlier Company" },
    ],
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
  if (entry === "inventory") {
    await page.goto("/holdings/entities");
    await page.getByRole("button", { name: /^Needs your review/u }).click();
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
  } else {
    await page.goto(
      "/holdings/entities?review=holding_position%3Aposition_demo_growth_iv&tab=identity",
    );
  }
  const review = page.getByRole("region", {
    name: "Investment review",
    exact: true,
  });
  await expect(review.locator(".section-navigation")).toBeVisible();
  await expect(
    review.getByRole("heading", { name: "Underlying company", exact: true }),
  ).toBeVisible();
  const companyEdit = review.getByRole("button", {
    name: "Edit company",
    exact: true,
  });
  if (await companyEdit.isVisible()) await companyEdit.click();
  if (!conflict) {
    await review
      .getByRole("combobox", { name: "Company evidence", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Demo Robotics Inc. · page 2", exact: true })
      .click();
  }
  const snapshotStyle = await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  return {
    ...fixture,
    snapshotStyle,
    row: page.locator(".entity-review"),
    review,
    source,
    inventory,
  };
}

test(
  "keeps first-company assignment in Holdings instead of offering a second legal form",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const { context, review } = await setup(page);
    context.mappings = [];
    await page.reload();
    await expect(
      review.getByRole("link", {
        name: "Choose company in Holdings",
        exact: true,
      }),
    ).toHaveAttribute("href", "/holdings?position=position_demo_growth_iv");
    await expect(
      review.getByRole("combobox", { name: "Company evidence", exact: true }),
    ).toHaveCount(0);
    await expect(
      review.getByRole("tab", { name: "Investment", exact: true }),
    ).toHaveCount(0);
    context.positionKind = "fund_interest";
    await page.reload();
    await expect(
      review.getByRole("button", {
        name: "Participation & corporate events",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      review.getByRole("link", {
        name: "Choose company in Holdings",
        exact: true,
      }),
    ).toHaveCount(0);
  },
);

test("navigates both ways through pending reviews, including wrapping, reload and browser history", async ({
  page,
}, testInfo) => {
  const { inventory, row, snapshotStyle } = await setup(page, {
    backgroundCount: 3,
    entry: "inventory",
  });
  await snapshotStyle.evaluate((style) => {
    style.parentNode?.removeChild(style);
  });
  for (const candidate of inventory.candidates.slice(1))
    await routeInvestmentReview(page, candidate);
  const navigation = row.getByRole("navigation", {
    name: "Investments needing review",
  });
  const previous = navigation.getByRole("button", {
    name: "Previous needing review",
    exact: true,
  });
  const next = navigation.getByRole("button", {
    name: "Next needing review",
    exact: true,
  });
  const title = row.getByRole("heading", { level: 1 });
  await previous.scrollIntoViewIfNeeded();
  await expect(previous).toBeInViewport();
  await expect(next).toBeInViewport();
  expect((await navigation.boundingBox())!.y).toBeLessThan(
    (await title.boundingBox())!.y,
  );
  await expect(row.locator(".entity-review__navigation")).toHaveScreenshot(
    "investment-review-queue-navigation.png",
  );
  for (const name of [
    "Demo A 2 LLC",
    "Demo A 1 LLC",
    "Demo A 0 LLC",
    "Demo Growth IV",
  ]) {
    await previous.click();
    await expect(title).toHaveText(name);
  }
  for (const name of [
    "Demo A 0 LLC",
    "Demo A 1 LLC",
    "Demo A 2 LLC",
    "Demo Growth IV",
  ]) {
    await next.click();
    await expect(title).toHaveText(name);
  }
  await next.click();
  await expect(title).toHaveText("Demo A 0 LLC");
  await next.click();
  await expect(title).toHaveText("Demo A 1 LLC");
  await page.reload();
  await expect(title).toHaveText("Demo A 1 LLC");
  await next.click();
  await expect(title).toHaveText("Demo A 2 LLC");
  await page.goBack();
  await expect(title).toHaveText("Demo A 1 LLC");
  await page.goForward();
  await expect(title).toHaveText("Demo A 2 LLC");
  await next.press("Shift+Tab");
  await expect(previous).toBeFocused();
  await previous.press("Enter");
  await expect(title).toHaveText("Demo A 1 LLC");
  for (const section of ["Documents", "Ownership", "Identity"])
    await selectReviewSection(page, section);
  await previous.scrollIntoViewIfNeeded();
  await expect(previous).toBeVisible();
  await expect(next).toBeVisible();
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 320, height: 740 });
    for (const button of [previous, next]) {
      await expect(button).toBeInViewport();
      const bounds = (await button.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test(
  "navigates after a saved review leaves the queue and hides arrows for its only remaining item",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const { inventory, row } = await setup(page, {
      backgroundCount: 3,
      entry: "inventory",
    });
    for (const candidate of inventory.candidates.slice(1))
      await routeInvestmentReview(page, candidate);
    await page.route("**/api/legal-entities", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: inventory });
      const input = CreateLegalEntityInputSchema.parse(
        route.request().postDataJSON(),
      );
      const source = inventory.candidates.find(
        (item) => item.source.id === input.source?.reference.id,
      )!;
      const entity = {
        ...input.profile,
        id: "entity_demo_saved_queue_item",
        versionId: "entity_demo_saved_queue_item_v1",
        version: 1,
        recordedAt: inventory.asOf,
        sources: [
          { ...source, currentDecisionId: "decision_demo_saved_queue_item" },
        ],
      };
      inventory.entities.push(entity);
      inventory.candidates = inventory.candidates.filter(
        (item) => item !== source,
      );
      return route.fulfill({ status: 201, json: entity });
    });
    const next = row.getByRole("button", {
      name: "Next needing review",
      exact: true,
    });
    const previous = row.getByRole("button", {
      name: "Previous needing review",
      exact: true,
    });
    const title = row.getByRole("heading", { level: 1 });
    await next.click();
    await expect(title).toHaveText("Demo A 0 LLC");
    await next.click();
    await expect(title).toHaveText("Demo A 1 LLC");
    await row.getByRole("button", { name: "Add entity", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Edit legal entity", exact: true }),
    ).toBeVisible();
    await previous.click();
    await expect(title).toHaveText("Demo A 0 LLC");
    await page.goBack();
    await expect(title).toHaveText("Demo A 1 LLC");
    await next.click();
    await expect(title).toHaveText("Demo A 2 LLC");

    inventory.candidates = inventory.candidates.filter(
      (item) => item.source.id === "demo_background_2",
    );
    await page.reload();
    await expect(title).toHaveText("Demo A 2 LLC");
    await expect(next).toHaveCount(0);
    await expect(previous).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "Back to legal entities", exact: true }),
    ).toBeVisible();

    await page.goto(
      "/holdings/entities?review=entity%3Aentity_demo_saved_queue_item",
    );
    await expect(title).toHaveText("Demo A 1 LLC");
    await next.click();
    await expect(title).toHaveText("Demo A 2 LLC");

    inventory.candidates = [];
    await page.goto(
      "/holdings/entities?review=entity%3Aentity_demo_saved_queue_item",
    );
    await expect(title).toHaveText("Demo A 1 LLC");
    await expect(next).toHaveCount(0);
    await expect(previous).toHaveCount(0);
  },
);

test("opens the supported entity name after moving a different investment's agreement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", {
      value: undefined,
      configurable: true,
    });
  });
  const { review, row, source, context } = await setup(page, {
    conflict: true,
    backgroundCount: 40,
    entry: "inventory",
  });
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
    .getByRole("button", { name: "Change assignments", exact: true })
    .click();
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

test(
  "distinguishes an earlier company mapping from agreement evidence and never preselects a saved entity",
  { tag: "@desktop-only" },
  async ({ page }) => {
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
    ).toHaveCount(0);
    await expect(
      workspace.getByRole("button", { name: "Edit company", exact: true }),
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
  },
);

test(
  "opens a company conflict, preserves a failed correction and reads back the saved agreement choice",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const { context, source, row, rejectWrites, writes, reads } =
      await setup(page);
    context.mappings = [
      {
        id: "mapping_demo_old",
        companyId: "company_demo_old",
        companyName: "Demo Legacy Company",
        status: "active",
        decisionSource: "review",
        acceptedAt: "2026-08-01T12:00:00.000Z",
      },
    ];
    context.companies = [
      { id: "company_demo_old", legalName: "Demo Legacy Company" },
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `company_demo_search_${index}`,
        legalName: `Demo Search Company ${index}`,
      })),
      { id: "company_demo_canonical", legalName: "Demo Robotics" },
    ];
    const choice = context.companyChoices[0]!;
    choice.quote =
      "“Portfolio Investment”: The entity referred to as Demo Robotics Inc.";
    context.documents[0]!.companyCitations = [
      {
        companyName: choice.companyName,
        page: choice.page,
        quote: choice.quote,
        role: "portfolio_investment",
      },
    ];
    context.automaticReview = {
      id: "22222222-2222-4222-8222-222222222222",
      policyVersion: "investment-review-auto-v1",
      snapshotId: context.snapshotId!,
      evaluatedAt: "2026-09-01T12:00:00.000Z",
      resolved: ["participation", "documents"],
      issues: [
        {
          section: "company",
          code: "conflicting",
          message:
            "An agreement names a different company from your saved mapping. Review the company link.",
        },
      ],
    };
    source.automaticReview = context.automaticReview;
    await page.reload();
    await page.addStyleTag({
      content: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
    await expect(
      row.getByRole("combobox", { name: "Company evidence", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByText(context.automaticReview.issues[0]!.message, {
        exact: true,
      }),
    ).toBeVisible();
    await row
      .getByRole("combobox", { name: "Company evidence", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Demo Robotics Inc. · page 2", exact: true })
      .click();
    await expect(row.getByText(choice.quote, { exact: true })).toBeVisible();
    const companyPicker = row.getByRole("combobox", {
      name: "Company",
      exact: true,
    });
    await companyPicker.click();
    const search = page.getByPlaceholder("Search companies…", { exact: true });
    await expect(search).toBeFocused();
    await expect(page.getByRole("option")).toHaveCount(100);
    const readsBeforeSearch = reads();
    await search.fill("no such synthetic company");
    await expect(
      page.getByText("No companies found. Clear search to add one.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(0);
    await search.press("Escape");
    await expect(companyPicker).toBeFocused();
    await expect(companyPicker).toContainText("Add a company");
    await companyPicker.click();
    await expect(search).toHaveValue("");
    await search.fill("rÓbOtics");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.mouse.move(0, 0);
    await expect(page.getByRole("listbox").locator("..")).toHaveScreenshot(
      "investment-company-search.png",
      { animations: "disabled", caret: "hide" },
    );
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(companyPicker).toContainText("Demo Robotics");
    expect(reads()).toBe(readsBeforeSearch);
    await page.mouse.move(0, 0);
    await expect(row).toHaveScreenshot("investment-company-conflict.png", {
      animations: "disabled",
      caret: "hide",
    });
    rejectWrites(true);
    await row
      .getByRole("button", { name: "Save company mapping", exact: true })
      .click();
    await expect(row.getByRole("alert")).toContainText(
      "This investment changed. Reload details before saving.",
    );
    await expect(
      row.getByRole("combobox", { name: "Company evidence", exact: true }),
    ).toContainText("Demo Robotics Inc.");
    await expect(companyPicker).toContainText("Demo Robotics");
    rejectWrites(false);
    await row
      .getByRole("button", { name: "Save company mapping", exact: true })
      .click();
    await expect(
      row.getByText("Currently mapped to Demo Robotics", { exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Edit company", exact: true }),
    ).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      basis: "document_link",
      company: { mode: "existing", companyId: "company_demo_canonical" },
      citation: choice,
    });
    await page.reload();
    await expect(
      row.getByText("Currently mapped to Demo Robotics", { exact: true }),
    ).toBeVisible();
    await expect(
      row.getByText(/An agreement names a different company/),
    ).toHaveCount(0);
    await row
      .getByRole("button", { name: "Edit company", exact: true })
      .click();
    await expect(
      row.getByRole("button", { name: "Save company mapping", exact: true }),
    ).toBeDisabled();
    await expect(companyPicker).toContainText("Demo Robotics");
    await expect(
      row.getByRole("combobox", { name: "Company evidence", exact: true }),
    ).toContainText("Demo Robotics Inc.");
    // A later explicit confirmation is a new decision and is read back independently.
    await row
      .getByRole("combobox", { name: "Company evidence", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Confirm a company yourself", exact: true })
      .click();
    await row
      .getByRole("button", { name: "Save company mapping", exact: true })
      .click();
    await expect(
      row.getByRole("button", { name: "Edit company", exact: true }),
    ).toBeVisible();
    expect(writes).toHaveLength(3);
    await page.reload();
    await expect(row.getByText(/Confirmed by you/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  },
);

test("reviews company evidence and keeps ownership drafts across independent saves", async ({
  page,
}) => {
  const { review, writes } = await setup(page);
  await selectReviewSection(page, "Ownership");
  await review
    .getByRole("button", { name: "Add ownership evidence", exact: true })
    .click();
  for (const value of ["101"]) {
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
  await selectReviewSection(page, "Record actions");
  await review.getByRole("combobox", { name: "Your participation" }).click();
  await page.getByRole("option", { name: "Pending", exact: true }).click();
  await review.getByRole("button", { name: "Save participation" }).click();
  await expect(
    review.getByRole("button", { name: "Change status", exact: true }),
  ).toBeVisible();
  await review
    .getByRole("button", { name: "Change status", exact: true })
    .click();
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
  await expect(
    review.getByText("Currently mapped to Demo Robotics Inc.", { exact: true }),
  ).toBeVisible();
  await review
    .getByRole("button", { name: "Edit company", exact: true })
    .click();
  await expect(
    review.getByRole("combobox", { name: "Company", exact: true }),
  ).toContainText("Demo Robotics Inc.");
  await expect(
    review.getByText(
      "This company already exists. Choose it from the company list.",
      { exact: true },
    ),
  ).toHaveCount(0);
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

test(
  "creates a separate cancelled investment with selected agreements, not copied amounts",
  { tag: "@mobile-only" },
  async ({ page }) => {
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
    await review
      .getByRole("button", { name: "Change assignment", exact: true })
      .click();
    await review
      .getByRole("checkbox", {
        name: "demo-growth-subscription.pdf",
        exact: true,
      })
      .uncheck();
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
    await expect(review).toHaveScreenshot(
      "investment-document-assignment.png",
      {
        animations: "disabled",
        caret: "hide",
      },
    );
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
  },
);

test("uses responsive section navigation, keeps focus rings visible, and leaves unsourced terms blank", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { review, writes } = await setup(page);
  const navigation = review.locator(".section-navigation");
  await expect(navigation).toContainText("Optional");
  await expect(
    review.getByRole("combobox", { name: "Review sections" }),
  ).toBeHidden();
  for (const label of ["Identity", "Documents", "Ownership"]) {
    await expect(
      review.getByRole("tab", { name: label, exact: true }),
    ).toBeVisible();
  }
  if (isMobile) {
    await expect(navigation).toHaveScreenshot("investment-section-tabs.png", {
      animations: "disabled",
    });
  }
  await expect(review.locator(".legal-entity-editor__actions")).toHaveCSS(
    "border-top-width",
    "0px",
  );
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
  await expect(
    review.getByRole("tab", { name: "Investment", exact: true }),
  ).toHaveCount(0);
  await expect(
    review.locator(".position-economics, .position-purchases"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "View position in Holdings", exact: true }),
  ).toHaveAttribute("href", "/holdings?position=position_demo_growth_iv");
  await selectReviewSection(page, "Identity");
  await expect(companyName).toHaveValue("Demo Focus Company");
  expect(writes).toHaveLength(0);
  await review
    .getByRole("button", { name: "Save company mapping", exact: true })
    .click();
  await expect(
    review.getByRole("button", { name: "Edit company", exact: true }),
  ).toBeVisible();
  await review
    .getByRole("button", { name: "Edit company", exact: true })
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
  const { review, writes, context, rejectWrites, source } = await setup(page, {
    conflict: true,
  });
  await selectReviewSection(page, "Documents");
  let first = review.getByRole("article", {
    name: "demo-growth-subscription.pdf",
    exact: true,
  });
  const save = review.getByRole("button", {
    name: "Save document assignment",
    exact: true,
  });
  await expect(first).toContainText("No explicit assignment");
  await first
    .getByRole("button", { name: "Change assignment", exact: true })
    .click();
  rejectWrites(true);
  await save.click();
  await expect(
    review.getByText("This investment changed.", { exact: false }),
  ).toBeVisible();
  await expect(first.getByRole("checkbox")).toBeChecked();
  rejectWrites(false);
  await save.click();
  await expect(first.getByRole("checkbox")).toHaveCount(0);
  await expect(first.locator(".investment-review__assignment")).toContainText(
    "Assigned to Demo Growth IV",
  );
  await expect(
    review.locator(".investment-review__assignment-count"),
  ).toHaveText("1 of 2 explicitly assigned · 1 still to assign");
  await expect(review.locator(".section-navigation")).toContainText(
    "Assign agreements",
  );
  await expect(save).toHaveCount(0);
  expect(context.review?.documentAssignments).toHaveLength(1);
  await page.reload();
  await selectReviewSection(page, "Documents");
  first = page.getByRole("article", {
    name: "demo-growth-subscription.pdf",
    exact: true,
  });
  await expect(first.locator(".investment-review__assignment")).toContainText(
    "Assigned to Demo Growth IV",
  );
  await first
    .getByRole("button", { name: "Change assignment", exact: true })
    .click();
  await expect(save).toBeDisabled();
  await first.getByRole("checkbox").uncheck();
  await expect(
    review.locator("form:has(.legal-entity-documents--review)"),
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
    "Assigned to Demo Growth IV",
  );
  await expect(
    review.locator(".investment-review__assignment-count"),
  ).toHaveText("2 of 2 explicitly assigned · All agreements assigned");
  expect(context.review?.documentAssignments).toHaveLength(2);
  expect(writes).toHaveLength(3);
  // The legal-name projection excludes the parent agreement after review.
  // The Documents tab must still expose its saved assignment after reload.
  source.legalEntityNameEvidence.documents = [context.documents[0]!];
  await page.reload();
  await selectReviewSection(page, "Documents");
  await expect(second).toBeVisible();
  await expect(second).toContainText("General or parent agreement");
  await second
    .getByRole("button", { name: "Change assignment", exact: true })
    .click();
  await expect(
    review.getByRole("combobox", { name: "These agreements belong to" }),
  ).toContainText("General or parent agreement");
  await expect(save).toBeDisabled();
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

test("shows reviewed facts before editing and keeps optional ownership out of completion", async ({
  page,
  isMobile,
}) => {
  const { inventory, source, context, row, review, writes } = await setup(page);
  inventory.entities = [
    {
      id: "entity_demo_reviewed",
      versionId: "entity_demo_reviewed_v1",
      version: 1,
      legalName: "Demo Growth IV LLC",
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
      recordedAt: inventory.asOf,
      sources: [source],
    },
  ];
  inventory.candidates = [];
  context.mappings = [
    {
      id: "mapping_demo_reviewed",
      companyId: "company_demo_reviewed",
      companyName: "Demo Robotics Inc.",
      status: "active",
      decisionSource: "review",
      acceptedAt: inventory.asOf,
    },
  ];
  context.companies = [
    { id: "company_demo_reviewed", legalName: "Demo Robotics Inc." },
  ];
  context.companyChoices = [];
  context.review = {
    id: "33333333-3333-4333-8333-333333333333",
    positionId: context.positionId,
    version: 1,
    participationStatus: "current",
    documentAssignments: [],
    ownershipObservations: [],
    recordedAt: inventory.asOf,
  };
  context.economics!.acceptedTerms = PositionEconomicsTermsSchema.parse({
    id: "terms_demo_reviewed",
    positionId: context.positionId,
    acceptedAgainstSnapshotId: context.snapshotId,
    commitmentMinorAtAcceptance: context.committedMinor,
    fundedMinorAtAcceptance: context.fundedMinor,
    capitalBasis: "gross_commitment",
    grossCommitmentMinor: null,
    setupFeePpm: 0,
    annualAdminFeePpm: 20_000,
    adminFeeYears: 1,
    carryPpm: 150_000,
    note: "Synthetic reviewed agreement",
    acceptedAt: inventory.asOf,
  });
  await page.reload();
  await expect(
    review.getByText("Review complete", { exact: true }),
  ).toBeVisible();
  await expect(review.getByText(/Review the remaining questions/u)).toHaveCount(
    0,
  );
  await expect(review.getByRole("textbox")).toHaveCount(0);
  await expect(review.getByText(/Earlier reviewed mapping/u)).toBeVisible();
  await expect(row).toHaveScreenshot("investment-reviewed-identity.png", {
    animations: "disabled",
  });
  await row
    .getByRole("button", { name: "Edit legal entity", exact: true })
    .click();
  await expect(row.getByLabel("Legal name", { exact: true })).toHaveValue(
    "Demo Growth IV LLC",
  );
  await row.getByLabel("Legal name", { exact: true }).fill("Demo Unsaved LLC");
  await row
    .locator(".legal-entity-editor")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    row.getByText("Demo Growth IV LLC", { exact: true }),
  ).toBeVisible();
  await selectReviewSection(page, "Record actions");
  await expect(
    review.getByRole("combobox", { name: "Your participation" }),
  ).toHaveCount(0);
  await expect(
    review.getByRole("heading", { name: "Source commitment", exact: true }),
  ).toBeVisible();
  await expect(row).toHaveScreenshot("investment-reviewed-amounts.png", {
    animations: "disabled",
  });
  await selectReviewSection(page, "Documents");
  await expect(
    review.getByRole("article", {
      name: "demo-growth-subscription.pdf",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(review.getByRole("checkbox")).toHaveCount(0);
  await expect(
    review.getByRole("button", { name: "Save document assignment" }),
  ).toHaveCount(0);
  await expect(review.getByText(/still to assign/u)).toHaveCount(0);
  await expect(row).toHaveScreenshot("investment-reviewed-documents.png", {
    animations: "disabled",
  });
  await review
    .getByRole("button", { name: "Source evidence · page 1", exact: true })
    .click();
  await expect(
    review.getByText("Fund: Demo Growth IV LLC", { exact: true }),
  ).toBeVisible();
  await selectReviewSection(page, "Ownership");
  await expect(
    review
      .getByRole("tabpanel", { name: "Ownership", exact: true })
      .getByText("Demo Family LLC", { exact: true }),
  ).toBeVisible();
  await expect(
    review.getByText(/Legal vehicle not yet confirmed/u),
  ).toHaveCount(0);
  await expect(row).toHaveScreenshot("investment-reviewed-ownership.png", {
    animations: "disabled",
  });
  expect(writes).toHaveLength(0);
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 740 });
    for (const label of ["Identity", "Documents", "Ownership"]) {
      await selectReviewSection(page, label);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("saves historical closure details, keeps failed drafts, and moves only ended participation into history", async ({
  page,
  isMobile,
}) => {
  await page.clock.install({ time: new Date("2026-09-18T12:00:00.000Z") });
  const { context, inventory, source, review, rejectWrites, writes } =
    await setup(page);
  if (!isMobile) {
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/investment-positions/*/review", async (route) => {
      if (route.request().method() === "POST") await pending;
      await route.fallback();
    });
    await selectReviewSection(page, "Record actions");
    await review
      .getByRole("button", { name: "Save participation", exact: true })
      .click();
    await expect(
      review.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      review.getByRole("button", { name: "Change status", exact: true }),
    ).toBeVisible();
    await review
      .getByRole("button", { name: "Change status", exact: true })
      .click();
    await expect(
      review.getByRole("button", { name: "Save participation", exact: true }),
    ).toBeDisabled();
    await expect.poll(() => writes.length).toBe(1);
    await expect(
      review.locator(".investment-review__record-disclosure").first(),
    ).toContainText("Current");
    await expect(
      page.getByText(/^(Review saved\.|Investment review saved\.)$/u),
    ).toHaveCount(0);
    expect(writes[0]).not.toHaveProperty("ownershipObservation");
    await selectReviewSection(page, "Ownership");
    await expect(
      review.getByRole("button", {
        name: "Add ownership evidence",
        exact: true,
      }),
    ).toBeVisible();
  }
  await selectReviewSection(page, "Record actions");
  await review
    .getByRole("combobox", { name: "Your participation", exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: "Exited", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "Historical", exact: true }).click();
  await expect(
    review.getByText(/Excluded from current holdings and totals/u),
  ).toBeVisible();
  await review.getByRole("button", { name: "Ended date", exact: true }).click();
  await page
    .getByRole("button", { name: "Friday, September 18, 2026", exact: true })
    .click();
  await review
    .getByRole("combobox", { name: "Closure reason (optional)", exact: true })
    .click();
  await page.getByRole("option", { name: "Unwound", exact: true }).click();
  const note = review.getByRole("textbox", {
    name: "Closure note (optional)",
    exact: true,
  });
  await note.pressSequentially("Fully refunded after unwind.");
  await expect(note).toHaveValue("Fully refunded after unwind.");
  await review
    .getByRole("combobox", { name: "Related replacement", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Demo Growth V LLC", exact: true })
    .click();
  await expect(review).toHaveScreenshot(
    "investment-historical-closure-form.png",
    { animations: "disabled", caret: "hide" },
  );
  rejectWrites(true);
  await review
    .getByRole("button", { name: "Save participation", exact: true })
    .click();
  await expect(review.getByText(/This investment changed/u)).toBeVisible();
  await expect(note).toHaveValue("Fully refunded after unwind.");
  rejectWrites(false);
  await review
    .getByRole("button", { name: "Save participation", exact: true })
    .click();
  await expect(
    review.getByRole("button", { name: "Change status", exact: true }),
  ).toBeVisible();
  expect(writes.at(-1)).toMatchObject({
    participationStatus: "historical",
    closure: {
      endedOn: "2026-09-18",
      reason: "unwound",
      note: "Fully refunded after unwind.",
      replacementPositionId: "position_demo_growth_v",
    },
  });
  await page.reload();
  await selectReviewSection(page, "Record actions");
  await expect(
    review.getByText("Fully refunded after unwind.", { exact: true }),
  ).toBeVisible();
  await expect(
    review.getByRole("link", { name: "Demo Growth V LLC", exact: true }),
  ).toHaveAttribute(
    "href",
    /review=holding_position%3Aposition_demo_growth_v/u,
  );
  await expect(review).toHaveScreenshot(
    "investment-historical-closure-saved.png",
    { animations: "disabled", caret: "hide" },
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  if (isMobile) return;
  await review
    .getByRole("button", { name: "Change status", exact: true })
    .click();
  await expect(
    review.getByRole("button", { name: "Save participation", exact: true }),
  ).toBeDisabled();
  await note.fill("Transferred proceeds reviewed separately.");
  await review
    .getByRole("button", { name: "Save participation", exact: true })
    .click();
  await expect(
    review.getByText("Transferred proceeds reviewed separately.", {
      exact: true,
    }),
  ).toBeVisible();
  inventory.entities = [
    {
      id: "entity_demo_history",
      versionId: "entity_demo_history_v1",
      version: 1,
      legalName: "Demo Growth IV LLC",
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
      recordedAt: inventory.asOf,
      sources: [source],
    },
  ];
  inventory.candidates = [];
  await page.goto("/holdings/entities");
  await expect(
    page.getByRole("button", { name: /Historical interests · 1/u }),
  ).toBeVisible();
  expect(inventory.entities[0]!.interestStatus).toBe("current");
  expect(context.committedMinor).toBe(1_000_000);
});

test("corrects investment amounts with review, reload, second save, rejection and source reset", async ({
  page,
  isMobile,
}) => {
  const fixture = await setup(page);
  await selectReviewSection(page, "Record actions");
  const panel = page.getByRole("region", {
    name: "Investment review",
    exact: true,
  });
  const open = async () =>
    panel.getByRole("button", { name: "Correct amount", exact: true }).click();
  await open();
  await expect(
    panel.getByRole("button", { name: "Review amount", exact: true }),
  ).toBeDisabled();
  await panel
    .getByLabel("Correct investment amount", { exact: true })
    .fill("6400");
  await panel
    .getByLabel("Reason for correction")
    .fill("Personal commitment from the synthetic agreement");
  await page.mouse.move(0, 0);
  await expect(
    panel.locator('[aria-label="Investment amount correction"]'),
  ).toHaveScreenshot("investment-amount-correction-form.png");
  await panel
    .getByRole("button", { name: "Review amount", exact: true })
    .click();
  expect(fixture.writes).toHaveLength(0);
  await page.mouse.move(0, 0);
  await expect(
    panel.locator('[aria-label="Investment amount correction"]'),
  ).toHaveScreenshot("investment-amount-correction-review.png");
  if (isMobile) return;
  await panel.getByRole("button", { name: "Save amount", exact: true }).click();
  await expect(
    panel.locator(".investment-review__section").filter({
      has: page.getByRole("heading", {
        name: "Source commitment",
        exact: true,
      }),
    }),
  ).toContainText("6,400.00");
  await page.reload();
  await selectReviewSection(page, "Record actions");
  await expect(
    panel.locator(".investment-review__section").filter({
      has: page.getByRole("heading", {
        name: "Source commitment",
        exact: true,
      }),
    }),
  ).toContainText("6,400.00");
  await open();
  await expect(
    panel.getByLabel("Correct investment amount", { exact: true }),
  ).toHaveValue("6400.00");
  await panel
    .getByLabel("Correct investment amount", { exact: true })
    .fill("6800");
  await panel
    .getByLabel("Reason for correction")
    .fill("Amended synthetic subscription");
  await panel
    .getByRole("button", { name: "Review amount", exact: true })
    .click();
  fixture.rejectWrites(true);
  await panel.getByRole("button", { name: "Save amount", exact: true }).click();
  await expect(panel).toContainText("This investment changed");
  await panel.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    panel.getByLabel("Correct investment amount", { exact: true }),
  ).toHaveValue("6800");
  fixture.rejectWrites(false);
  await panel
    .getByRole("button", { name: "Review amount", exact: true })
    .click();
  await panel.getByRole("button", { name: "Save amount", exact: true }).click();
  await expect(
    panel.locator(".investment-review__section").filter({
      has: page.getByRole("heading", {
        name: "Source commitment",
        exact: true,
      }),
    }),
  ).toContainText("6,800.00");
  await expect(
    panel.locator(".investment-review__section").filter({
      has: page.getByRole("heading", {
        name: "Source commitment",
        exact: true,
      }),
    }),
  ).toHaveScreenshot("investment-amount-corrected.png");
  await open();
  await panel
    .getByRole("button", { name: "Use source amount", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Review amount", exact: true })
    .click();
  await panel.getByRole("button", { name: "Save amount", exact: true }).click();
  await expect(
    panel.locator(".investment-review__section").filter({
      has: page.getByRole("heading", {
        name: "Source commitment",
        exact: true,
      }),
    }),
  ).toContainText("10,000.00");
  expect(fixture.context.review?.amountCorrection).toBeNull();
  expect(fixture.context.fundedMinor).toBe(1_000_000);
});

test("records a continuing SPV conversion, retains rejected evidence and amends conditional rights", async ({
  page,
  isMobile,
}) => {
  const fixture = await setup(page);
  await selectReviewSection(page, "Record actions");
  const section = page.getByRole("region", {
    name: "Mergers and conversions",
    exact: true,
  });
  await section
    .getByRole("button", { name: "Record event", exact: true })
    .click();
  await section.getByLabel("Notice text", { exact: true })
    .fill(`Synthetic Robotics has merged with Synthetic Successor Holdings.
September 1, 2026
This is not an exit that gives LPs liquidity.
For Demo Growth IV, here are the transaction terms:
The SPV received 1,234 acquirer Series A shares, valued at $42.31 per share.
The SPV will receive an additional 321 shares upon release of earnout.
The SPV received 88 closing warrant shares.`);
  await section
    .getByRole("button", { name: "Review extracted details" })
    .click();
  await expect(section.getByLabel("Successor company or issuer")).toHaveValue(
    "Synthetic Successor Holdings",
  );
  await expect(
    section.getByLabel("Component 2 quantity (optional)"),
  ).toHaveValue("321");
  await expect(section).toHaveScreenshot("investment-event-details.png", {
    animations: "disabled",
  });
  await section
    .getByRole("button", { name: "Review event", exact: true })
    .click();
  // Settle the whole section before hovering Save. Otherwise the element
  // screenshot scrolls it into view and moves the button away from the pointer.
  await section.scrollIntoViewIfNeeded();
  await section
    .getByRole("button", { name: "Save event", exact: true })
    .hover();
  await expect
    .poll(() =>
      section
        .getByRole("button", { name: "Save event", exact: true })
        .evaluate((element) => element.matches(":hover")),
    )
    .toBe(true);
  await expect(section).toHaveScreenshot("investment-event-review.png", {
    animations: "disabled",
  });
  if (!isMobile) return;
  fixture.rejectWrites(true);
  await section
    .getByRole("button", { name: "Save event", exact: true })
    .click();
  await expect(
    fixture.review.getByText(/This investment changed/u),
  ).toBeVisible();
  await expect(section.getByText("1234 units", { exact: false })).toBeVisible();
  fixture.rejectWrites(false);
  await section
    .getByRole("button", { name: "Save event", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Update event", exact: true }),
  ).toBeVisible();
  await expect(section).toHaveScreenshot("investment-event-saved.png", {
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await selectReviewSection(page, "Record actions");
  await expect(
    section.getByRole("button", { name: "Update event", exact: true }),
  ).toBeVisible();
  await section
    .getByRole("button", { name: "Update event", exact: true })
    .click();
  await section.getByRole("combobox", { name: "Component 2 status" }).click();
  await page.getByRole("option", { name: "Released", exact: true }).click();
  await section
    .getByRole("button", { name: "Review event", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Save event", exact: true })
    .click();
  await expect(section.getByText(/Revision 2/u)).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Update event", exact: true }),
  ).toHaveCount(1);
  expect(fixture.context.investmentEvents).toHaveLength(2);
  expect(fixture.context.committedMinor).toBe(1_000_000);
});
