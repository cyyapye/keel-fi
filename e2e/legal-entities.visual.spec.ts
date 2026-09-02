import { expect, test, type Page } from "@playwright/test";
import type {
  LegalEntityInventory,
  LegalEntityRecord,
} from "../packages/domain/src/legal-entities";

import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";

const positionSource = {
  source: { kind: "holding_position" as const, id: "position_demo_venture" },
  suggestedName: "Demo Venture SPV LLC",
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

const initialInventory = {
  version: 1,
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
    {
      source: {
        kind: "ownership_container",
        id: "container_demo_operating",
      },
      suggestedName: "Demo Operating Account",
      sourceLabel: "Reviewed banking records",
      sourceAsOf: "2026-08-29",
      relationship: "ownership_entity",
      currentOwner: null,
      interestStatus: "unknown",
      openedOn: null,
      financials: null,
      currentDecisionId: null,
    },
  ],
  excludedCandidates: [
    {
      source: {
        kind: "ownership_container",
        id: "container_demo_brokerage",
      },
      suggestedName: "Demo Brokerage",
      sourceLabel: "Reviewed brokerage records",
      sourceAsOf: "2026-08-28",
      relationship: "ownership_entity",
      currentOwner: null,
      interestStatus: "current",
      openedOn: null,
      financials: null,
      currentDecisionId: "decision_demo_brokerage_not_llc",
    },
  ],
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
    };
    await route.fulfill({ json: created, status: 201 });
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
  ).toHaveCount(11);
  await expect(
    page.getByLabel("Include sources that need review"),
  ).toBeChecked();
  await expect(
    page.getByText("2 reviewed LLCs · 2 awaiting review"),
  ).toBeVisible();
  await expect(page.locator(".legal-entities")).toContainText("Not recorded");
  await expect(
    page.getByText("Needs review", { exact: true }).first(),
  ).toBeVisible();
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
  await candidate.getByRole("button", { name: "Add as LLC" }).click();
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
    11,
  );
  await expect(page).toHaveURL(/\/holdings\/entities$/u);
});
