import { expect, test } from "./api-mocked-test";
import {
  CompanyAliasProposalSchema,
  CompanyAliasReviewInputSchema,
  type CompanyIdentityCatalog,
} from "../packages/domain/src/company-identity";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";

test("reviews generic duplicate names, preserves a rejected draft and finds saved aliases after reload", async ({
  page,
}) => {
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  let catalog: CompanyIdentityCatalog = {
    revision: 1,
    companies: [
      { id: "demo-cedar", legalName: "Demo Cedar", aliases: [] },
      { id: "demo-inc", legalName: "Demo Cedar Inc.", aliases: [] },
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `demo-other-${index}`,
        legalName: `Demo Other Company ${index}`,
        aliases: [],
      })),
    ],
    suggestedGroups: [["demo-cedar", "demo-inc"]],
  };
  let reject = true;
  let saveCount = 0;
  await page.route("**/api/companies/identity", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.route("**/api/companies/aliases/preview", async (route) => {
    const proposal = CompanyAliasProposalSchema.parse(
      route.request().postDataJSON(),
    );
    await route.fulfill({
      json: {
        ...proposal,
        revision: "a".repeat(64),
        companyName: "Demo Cedar",
        sourceCompanyName:
          proposal.sourceCompanyId === null ? null : "Demo Cedar Inc.",
        aliases: [proposal.aliasName],
        positions:
          proposal.sourceCompanyId === null
            ? []
            : [
                { id: "demo-position-1", label: "Demo Growth I LLC" },
                { id: "demo-position-2", label: "Demo Growth II LP" },
              ],
      },
    });
  });
  await page.route("**/api/companies/aliases", async (route) => {
    const input = CompanyAliasReviewInputSchema.parse(
      route.request().postDataJSON(),
    );
    if (reject) {
      reject = false;
      await route.fulfill({
        status: 409,
        json: { error: "Company names changed. Review the updated grouping." },
      });
      return;
    }
    saveCount++;
    catalog = {
      ...catalog,
      revision: catalog.revision + 1,
      companies: catalog.companies
        .filter((c) => c.id !== input.sourceCompanyId)
        .map((c) =>
          c.id === input.companyId
            ? { ...c, aliases: [...(c.aliases ?? []), input.aliasName] }
            : c,
        ),
      suggestedGroups: [],
    };
    await route.fulfill({
      json: {
        ...input,
        revision: input.expectedRevision,
        expectedRevision: undefined,
        companyName: "Demo Cedar",
        sourceCompanyName:
          input.sourceCompanyId === null ? null : "Demo Cedar Inc.",
        aliases: [input.aliasName],
        positions:
          input.sourceCompanyId === null
            ? []
            : [
                { id: "demo-position-1", label: "Demo Growth I LLC" },
                { id: "demo-position-2", label: "Demo Growth II LP" },
              ],
        id: "11111111-1111-4111-8111-111111111111",
        recordedAt: "2026-09-01T12:00:00.000Z",
      },
    });
  });
  await page.goto("/holdings/entities?companies=1");
  await expect(
    page.getByRole("heading", { name: "Possible duplicates · 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review names", exact: true }).click();
  await page
    .getByRole("button", { name: "Review grouping", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm company name" }),
  ).toBeDisabled();
  await page
    .getByLabel("Why these names belong together")
    .fill("The reviewed subscription names the same operating company.");
  await page.getByText("Affected investments", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot("company-name-review.png", {
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirm company name" }).click();
  await expect(
    page.getByText("Company names changed. Review the updated grouping.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Why these names belong together")).toHaveValue(
    "The reviewed subscription names the same operating company.",
  );
  await page.getByRole("button", { name: "Review again", exact: true }).click();
  await page
    .getByRole("button", { name: "Review grouping", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm company name" }).click();
  await expect(
    page.getByText(
      "Demo Cedar Inc. now maps to Demo Cedar. 2 investments were relinked.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(saveCount).toBe(1);
  await page.reload();
  await page
    .getByRole("combobox", { name: "Group under", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Search companies", exact: true })
    .fill("cedar inc");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "Demo Cedar", exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: "Demo Cedar", exact: true }).click();
  await page
    .getByLabel("Alternative company name", { exact: true })
    .fill("Demo Cedar International, LLC");
  await page
    .getByRole("button", { name: "Review grouping", exact: true })
    .click();
  await page
    .getByLabel("Why these names belong together")
    .fill("Reviewed another legal name in the same agreement.");
  await page.getByRole("button", { name: "Confirm company name" }).click();
  await expect(
    page.getByText(
      "Demo Cedar International, LLC now maps to Demo Cedar. 0 investments were relinked.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(saveCount).toBe(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot("company-name-saved.png", {
    animations: "disabled",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("reviews an issuer link before grouping a public holding", async ({
  page,
}) => {
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/companies/identity", (route) =>
    route.fulfill({
      json: {
        revision: 1,
        companies: [
          {
            id: "company_northstar",
            legalName: "Northstar Robotics",
            aliases: [],
          },
        ],
        suggestedGroups: [],
      },
    }),
  );
  let reviewCount = 0;
  let reviewId: string | null = null;
  await page.route("**/api/companies/public-links", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          securities: [
            {
              exposureId: "exposure_nstr_public",
              name: "Northstar Class A",
              companyId: reviewId === null ? null : "company_northstar",
              reviewId,
              positionCount: 1,
            },
          ],
          companies: [{ id: "company_northstar", name: "Northstar Robotics" }],
        },
      });
      return;
    }
    const input = route.request().postDataJSON() as {
      companyId: string;
      exposureId: string;
      sourceUrl: string;
    };
    expect(input).toMatchObject({
      companyId: "company_northstar",
      exposureId: "exposure_nstr_public",
      sourceUrl: "https://example.test/synthetic-filing",
    });
    reviewCount += 1;
    reviewId = "11111111-1111-4111-8111-111111111111";
    await route.fulfill({
      status: 201,
      json: {
        id: reviewId,
        exposureId: input.exposureId,
        companyId: input.companyId,
        reviewedAt: "2026-09-01T12:00:00.000Z",
      },
    });
  });
  await page.goto("/holdings/entities?companies=1&public=exposure_nstr_public");
  const editor = page.getByRole("region", { name: "Link public holding" });
  await expect(
    editor.getByRole("heading", { name: "Link a public holding" }),
  ).toBeVisible();
  await editor.getByRole("combobox", { name: "Group under" }).click();
  await page.getByRole("option", { name: "Northstar Robotics" }).click();
  await editor
    .getByLabel("Issuer evidence URL")
    .fill("https://example.test/synthetic-filing");
  await editor
    .getByLabel("Why this security belongs to this company")
    .fill("The synthetic filing names Northstar Robotics as issuer.");
  await editor.getByRole("button", { name: "Review grouping" }).click();
  await expect(
    editor.getByRole("heading", {
      name: "Northstar Class A → Northstar Robotics",
    }),
  ).toBeVisible();
  await page.locator(".topbar").evaluate((element) => {
    (element as HTMLElement).style.position = "static";
  });
  await expect(editor).toHaveScreenshot("public-company-link-review.png", {
    animations: "disabled",
    caret: "hide",
  });
  await editor.getByRole("button", { name: "Confirm company link" }).click();
  await expect(editor).toContainText(
    "This security now appears with the company’s other positions.",
  );
  expect(reviewCount).toBe(1);
});
