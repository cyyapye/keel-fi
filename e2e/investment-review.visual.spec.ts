import {
  documentedOwnershipReview,
  reviewAgreementSource,
} from "./investment-review-context";
import { expect, test, type Page } from "./api-mocked-test";
import type { LegalEntityInventory } from "../packages/domain/src/legal-entities";
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
    selectCompanyEvidence = false,
    entry = "review",
  }: {
    conflict?: boolean;
    backgroundCount?: number;
    selectCompanyEvidence?: boolean;
    entry?: "inventory" | "review";
  } = {},
) {
  const { doc, source } = reviewAgreementSource({ conflict });
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
  if (selectCompanyEvidence) {
    const companyEdit = review.getByRole("button", {
      name: "Edit company",
      exact: true,
    });
    if (await companyEdit.isVisible()) await companyEdit.click();

    await review
      .getByRole("combobox", { name: "Company evidence", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Demo Robotics Inc. · page 2", exact: true })
      .click();
  }
  return {
    ...fixture,
    row: page.locator(".entity-review"),
    review,
    source,
    inventory,
  };
}

test(
  "navigates both ways through pending reviews, including wrapping, reload and browser history",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const { inventory, row } = await setup(page, {
      backgroundCount: 3,
      entry: "inventory",
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
    await previous.click();
    await expect(title).toHaveText("Demo A 2 LLC");
    await next.click();
    await expect(title).toHaveText("Demo Growth IV");
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

test(
  "keeps K-1 shares optional, validates them separately, and retains a rejected draft",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const { context, review, writes, rejectWrites } = await setup(page);
    await selectReviewSection(page, "Ownership");
    await expect(
      review.getByRole("textbox", {
        name: "Ownership interest %",
        exact: true,
      }),
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
    await review
      .getByRole("button", { name: "Save ownership evidence" })
      .click();
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
    await review
      .getByRole("button", { name: "Save ownership evidence" })
      .click();
    await expect(
      review.getByRole("button", { name: "Add another observation" }),
    ).toBeVisible();
    await expect(
      review.getByRole("button", { name: "Save ownership evidence" }),
    ).toHaveCount(0);
    await expect(review.locator(".ownership-evidence")).toContainText(
      "2025 K-1",
    );
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
    context.review = documentedOwnershipReview(
      context.positionId,
      context.documents[0]!,
    );
    await page.reload();
    await selectReviewSection(page, "Ownership");
    await expect(
      review
        .locator(".ownership-evidence")
        .getByText(context.documents[0]!.fileName, { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".investment-review")).toHaveScreenshot(
      "investment-ownership-recorded.png",
      {
        animations: "disabled",
        caret: "hide",
      },
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  },
);

test(
  "uses responsive section navigation, keeps focus rings visible, and leaves unsourced terms blank",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { review, writes } = await setup(page, {
      selectCompanyEvidence: true,
    });
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

    await expect(navigation).toHaveScreenshot("investment-section-tabs.png", {
      animations: "disabled",
    });

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
      page.getByRole("link", {
        name: "View position in Holdings",
        exact: true,
      }),
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
  },
);

test(
  "shows saved document destinations after reload, preserves earlier assignments, and retains a rejected selection",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const { review, writes, context, rejectWrites, source } = await setup(
      page,
      {
        conflict: true,
      },
    );
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
    await expect(
      second.locator(".investment-review__assignment"),
    ).toContainText("General or parent agreement");
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
  },
);

test(
  "corrects investment amounts with review, reload, second save, rejection and source reset",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const fixture = await setup(page);
    await selectReviewSection(page, "Record actions");
    const panel = page.getByRole("region", {
      name: "Investment review",
      exact: true,
    });
    const open = async () =>
      panel
        .getByRole("button", { name: "Correct amount", exact: true })
        .click();
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

    await panel
      .getByRole("button", { name: "Save amount", exact: true })
      .click();
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
    await panel
      .getByRole("button", { name: "Save amount", exact: true })
      .click();
    await expect(panel).toContainText("This investment changed");
    await panel.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      panel.getByLabel("Correct investment amount", { exact: true }),
    ).toHaveValue("6800");
    fixture.rejectWrites(false);
    await panel
      .getByRole("button", { name: "Review amount", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Save amount", exact: true })
      .click();
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
    await panel
      .getByRole("button", { name: "Save amount", exact: true })
      .click();
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
  },
);
