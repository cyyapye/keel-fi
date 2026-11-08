import { expect, test, type Page } from "./api-mocked-test";
import { resolve } from "node:path";

import { routeHoldingsPage } from "./holdings-page-fixtures";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";

const investmentConnectionId = "11111111-1111-4111-8111-111111111111";

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

function investmentStatus(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    connectionId: investmentConnectionId,
    institutionKey: "ins_robinhood",
    institutionLabel: "Robinhood",
    status: "ready",
    lastSyncedAt: "2026-08-10T16:00:00.000Z",
    automaticUpdatesEnabled: true,
    latestImportId: null,
    latestRunStatus: "succeeded",
    errorCode: null,
    latestAdjudication: null,
    ...overrides,
  };
}

function investmentState(
  connections: readonly ReturnType<typeof investmentStatus>[],
) {
  return {
    version: 1,
    configured: true,
    connections,
    errorCode: null,
  };
}

const baselineState = {
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
    currentFiEligibleLiquidMinor: 182_500_000,
    protectedCashFloorMinor: 10_300_000,
    householdBurnMonthlyMinor: 2_850_000,
    businessBurnMonthlyMinor: 1_250_000,
    fiTargetMinor: 325_000_000,
    p25FiveYearLiquidityMinor: 94_000_000,
    p50FiveYearLiquidityMinor: 210_000_000,
    p75FiveYearLiquidityMinor: 354_000_000,
    forecastHorizonDate: "2031-12-31",
  },
  suggestedOtherFiEligibleLiquidMinor: 0,
  currentImpact: {
    fiEligibleLiquidMinor: 182_500_000,
    fiEligibleChangeMinor: 0,
    protectedRunwayMonths: 42,
    fiGapMinor: 142_500_000,
    lowerTotalAvailableMinor: 276_500_000,
    middleTotalAvailableMinor: 392_500_000,
    higherTotalAvailableMinor: 536_500_000,
    probabilityCrossingFiPpm: 640_000,
  },
  latestBaseline: null,
  hasSourceChanges: false,
  hasCashAccountChanges: false,
  requiresDuplicateReview: false,
  requiresCashOverlapReview: false,
  canConfirm: false,
};

test.beforeEach(async ({ page }) => {
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaFixture.holdings,
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: emptyInvestmentHoldingsView });
  });
  await page.route("**/api/private-exposure-reviews", async (route) => {
    await route.fulfill({
      json: {
        version: 2,
        positions: [],
        companies: [],
        exactBatch: {
          revision: "a".repeat(64),
          positionCount: 0,
          companyCount: 0,
          existingCompanyCount: 0,
          newCompanyCount: 0,
          excludedPositionCount: 0,
        },
      },
    });
  });
  await page.route("**/api/cash-accounts", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        status: "disconnected",
        connections: [],
        acceptedAccounts: [],
        pendingProposals: [],
        errorCode: null,
      },
    });
  });
  await page.route("**/api/portfolio-baseline", (route) =>
    route.fulfill({ json: baselineState }),
  );
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: false,
        connections: [],
        errorCode: "configuration_required",
      },
    });
  });
  await page.route(
    "**/api/automation/provider-holdings/*/status",
    async (route) => {
      const provider = new URL(route.request().url()).pathname
        .split("/")
        .at(-2);
      await route.fulfill({
        json: {
          version: 1,
          provider,
          status: "setup_required",
          interval: "daily",
          runStatus: null,
          lastSeenAt: null,
          lastCompletedAt: null,
          nextRunAt: null,
          latestImportId: null,
          errorCode: null,
        },
      });
    },
  );
});

const alphaFixture = {
  dashboard: {
    asOfDate: "2026-07-01",
    forecastHorizonDate: "2031-12-31",
    householdName: "Demo Household",
    fiEligibleLiquidMinor: 182_500_000,
    protectedRunwayMonths: 42,
    protectedCashFloorMinor: 10_300_000,
    householdBurnMonthlyMinor: 2_850_000,
    businessBurnMonthlyMinor: 1_250_000,
    fiTargetMinor: 325_000_000,
    fiGapMinor: 142_500_000,
    p25FiveYearLiquidityMinor: 94_000_000,
    p50FiveYearLiquidityMinor: 210_000_000,
    p75FiveYearLiquidityMinor: 354_000_000,
    probabilityCrossingFiPpm: 640_000,
  },
  goals: [
    {
      id: "goal_fi",
      templateKey: "financial_independence",
      isPrimary: true,
      archivedAt: null,
      createdAt: "2026-07-01T09:00:00-07:00",
      versions: [
        {
          id: "goalv_fi_1",
          version: 1,
          name: "Financial independence",
          metricKey: "fi_eligible_liquid",
          metricLabel: "FI-eligible liquid assets",
          targetValueInteger: 325_000_000,
          targetUnit: "minor_units",
          targetDate: null,
          currentValueInteger: 182_500_000,
          currentValueSource: "Synthetic FI planning inputs",
          changeNote: "Initial synthetic FI goal",
          createdAt: "2026-07-01T09:00:00-07:00",
          createdBy: "Demo Operator",
          forecast: {
            id: "goalsnap_fi_1",
            version: 1,
            modelStatus: "modeled",
            lowerValueInteger: 276_500_000,
            middleValueInteger: 392_500_000,
            higherValueInteger: 536_500_000,
            successProbabilityPpm: 640_000,
            unit: "minor_units",
            horizonDate: "2031-12-31",
            methodology: "Synthetic method",
            createdAt: "2026-07-01T09:00:00-07:00",
            createdBy: "Demo Operator",
          },
        },
      ],
    },
  ],
  holdings: [],
  evidenceInbox: [],
  portfolioWatch: { targets: [], observations: [] },
  scenarios: [],
  signalReconciliations: [],
  signalUpdateProposals: [],
  forecastHistory: [],
};

const lockedIndexes = new Set([
  1,
  ...Array.from({ length: 21 }, (_, index) => index + 51),
]);

function exactMinorUnits(multiplier: number, minorUnits: number): number {
  return Number(BigInt(multiplier) * BigInt(minorUnits));
}

const previewRows = Array.from({ length: 72 }, (_, index) => {
  const locked = lockedIndexes.has(index);
  const action =
    index === 1
      ? "append_snapshot"
      : index === 2
        ? "no_change"
        : index === 3
          ? "needs_attention"
          : "create_position";
  const positionNames = [
    "Beacon Demo SPV",
    "Ridge Demo SPV",
    "Northstar Demo Fund",
    "Unclear Demo SPV",
  ];
  const exposureNames = [
    "Harbor Health Systems",
    "Lattice Grove Energy",
    "Northstar Robotics",
    "Delta Systems",
  ];

  return {
    id: `import_row_${index + 1}`,
    sourceRowNumber: index + 3,
    positionName: positionNames[index] ?? `Demo Syndicate ${index + 1}`,
    exposureName: exposureNames[index] ?? `Synthetic Company ${index + 1}`,
    ownerLabel: index % 2 === 0 ? "Demo Family LLC" : "Demo Operator",
    providerStatus: index % 5 === 0 ? "Realized" : "Live",
    investedOn: "2024-06-15",
    investedMinor: exactMinorUnits(index + 2, 5_000_000),
    administratorNavMinor: locked
      ? null
      : exactMinorUnits(index + 3, 6_000_000),
    administratorNavState: locked ? "locked" : "reported",
    realizedValueMinor:
      index % 5 === 0 ? exactMinorUnits(index + 1, 1_000_000) : 0,
    reportedManagementFeePpm: null,
    reportedCarryPpm: index === 0 ? 200_000 : null,
    action,
    issues:
      action === "needs_attention"
        ? ["A deterministic holding match is not available."]
        : [],
  };
});

const importPreview = {
  id: "holding_import_synthetic_angellist",
  provider: "angellist",
  status: "pending_review",
  observedAt: "2026-06-14T12:00:00.000Z",
  summary: {
    rowCount: 72,
    administratorValueCount: 50,
    lockedValueCount: 22,
    createCount: 69,
    updateCount: 1,
    unchangedCount: 1,
    needsAttentionCount: 1,
  },
  rows: previewRows,
};

const tokenfolioImportPreview = {
  id: "holding_import_synthetic_tokenfolio",
  provider: "tokenfolio",
  status: "pending_review",
  observedAt: "2026-08-20T00:00:00.000Z",
  summary: {
    rowCount: 2,
    administratorValueCount: 1,
    lockedValueCount: 0,
    createCount: 2,
    updateCount: 0,
    unchangedCount: 0,
    needsAttentionCount: 0,
    autoAppliedCount: 0,
    quarantinedCount: 0,
    preservedPositionCount: 0,
  },
  rows: [
    {
      id: "tokenfolio_row_1",
      sourceRowNumber: 3,
      positionName: "Synthetic Robotics direct shares",
      exposureName: "Synthetic Robotics",
      ownerLabel: "Synthetic Family Trust",
      providerStatus: "Live",
      investedOn: "2025-02-01",
      investedMinor: 125_000,
      administratorNavMinor: 180_025,
      administratorNavState: "reported",
      realizedValueMinor: 0,
      action: "create_position",
      issues: [],
    },
    {
      id: "tokenfolio_row_2",
      sourceRowNumber: 4,
      positionName: "Example Climate Fund SPV I",
      exposureName: "Example Climate Fund",
      ownerLabel: "Synthetic Investment Profile",
      providerStatus: "Live",
      investedOn: "2025-04-12",
      investedMinor: 500_000,
      administratorNavMinor: null,
      administratorNavState: "not_reported",
      realizedValueMinor: 0,
      action: "create_position",
      issues: [],
    },
  ],
};

const robinhoodImportPreview = {
  id: "holding_import_synthetic_robinhood",
  provider: "plaid_investments",
  status: "quarantined",
  observedAt: "2026-08-10T16:00:00.000Z",
  summary: {
    rowCount: 3,
    administratorValueCount: 2,
    lockedValueCount: 0,
    createCount: 2,
    updateCount: 0,
    unchangedCount: 0,
    needsAttentionCount: 1,
    autoAppliedCount: 2,
    quarantinedCount: 1,
    preservedPositionCount: 1,
  },
  rows: [
    {
      id: "robinhood_row_1",
      sourceRowNumber: 1,
      positionName: "SYN · Synthetic Public Company",
      exposureName: "Synthetic Public Company",
      ownerLabel: "Robinhood individual account",
      providerStatus: "Live",
      investedOn: "2026-08-10",
      investedMinor: 18_250_000,
      administratorNavMinor: 23_800_000,
      administratorNavState: "reported",
      realizedValueMinor: 0,
      ticker: "SYN",
      quantityMicros: 12_345_678,
      costBasisMinor: 18_250_000,
      action: "create_position",
      issues: [],
      adjudicationStatus: "auto_applied",
      decisionSource: "policy",
      reasonCodes: [
        "supported_usd_long_position",
        "new_position_identity_clear",
      ],
    },
    {
      id: "robinhood_row_2",
      sourceRowNumber: 2,
      positionName: "DEMO · Demo Index ETF",
      exposureName: "Demo Index ETF",
      ownerLabel: "Robinhood individual account",
      providerStatus: "Live",
      investedOn: "2026-08-10",
      investedMinor: 9_500_000,
      administratorNavMinor: 10_120_000,
      administratorNavState: "reported",
      realizedValueMinor: 0,
      ticker: "DEMO",
      quantityMicros: 8_000_000,
      costBasisMinor: 9_500_000,
      action: "create_position",
      issues: [],
      adjudicationStatus: "auto_applied",
      decisionSource: "policy",
      reasonCodes: [
        "supported_usd_long_position",
        "new_position_identity_clear",
      ],
    },
    {
      id: "robinhood_row_3",
      acceptanceBlocked: true,
      sourceRowNumber: 3,
      positionName: "CASH · Cash",
      exposureName: "Cash",
      ownerLabel: "Robinhood individual account",
      providerStatus: "Live",
      investedOn: "2026-08-10",
      investedMinor: 0,
      administratorNavMinor: null,
      administratorNavState: "not_reported",
      realizedValueMinor: 0,
      ticker: null,
      quantityMicros: 2_000_000,
      costBasisMinor: null,
      action: "needs_attention",
      issues: ["The position identity conflicts with the prior snapshot."],
      adjudicationStatus: "quarantined",
      decisionSource: null,
      reasonCodes: [],
    },
  ],
};

test("imports provider templates without asking to approve clear positions", async ({
  isMobile,
  page,
}) => {
  await page.route("**/api/alpha", (route) =>
    route.fulfill({ json: alphaFixture }),
  );
  const provider = isMobile ? "wefunder" : "tokenfolio";
  const fixture = isMobile
    ? {
        ...tokenfolioImportPreview,
        id: "holding_import_synthetic_wefunder",
        provider,
      }
    : tokenfolioImportPreview;
  let uploads = 0;
  await page.route(`**/api/holding-imports/${provider}`, (route) => {
    uploads += 1;
    expect(route.request().method()).toBe("POST");
    const body = route.request().postData();
    expect(body).toContain(`filename="${provider}-holdings.csv"`);
    expect(body).toContain("synthetic template");
    return route.fulfill({
      status: 201,
      json: {
        ...fixture,
        status: "applied",
        summary: {
          ...fixture.summary,
          autoAppliedCount: fixture.rows.length,
        },
        rows: fixture.rows.map((row) => ({
          ...row,
          decisionSource: "policy",
          adjudicationStatus: "auto_applied",
        })),
      },
    });
  });
  await page.goto("/holdings/sources");
  await page.getByRole("button", { name: "Import holdings" }).click();
  await page.getByLabel("Source").click();
  const label = isMobile ? "Wefunder" : "Tokenfolio";
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(
    page.getByRole("link", { name: `Download ${label} template` }),
  ).toHaveAttribute("href", `/api/holding-import-templates/${provider}`);
  await expect(page.locator(".holding-import-workspace")).toHaveScreenshot(
    `holdings-import-${provider}-template.png`,
    { animations: "disabled", maxDiffPixelRatio: 0.025 },
  );
  await expect(
    page.getByRole("button", { name: "Import file", exact: true }),
  ).toBeDisabled();
  expect(uploads).toBe(0);
  const fileTarget = await page.locator('input[type="file"]').boundingBox();
  expect(fileTarget).not.toBeNull();
  if (isMobile) {
    expect(fileTarget!.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: `${provider}-holdings.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic template"),
  });
  await expect(
    page.getByRole("button", { name: "Import file", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Import file", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Update complete" }),
  ).toBeVisible();
  expect(uploads).toBe(1);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("No further review is needed.")).toBeVisible();
  await expect(page.locator(".holding-import-workspace")).toHaveScreenshot(
    `holdings-import-${provider}-complete.png`,
    { animations: "disabled", maxDiffPixelRatio: 0.025 },
  );
  await expectNoHorizontalOverflow(page);
});

test(
  "orders sources by liquidity and groups private investment setup",
  { tag: "@desktop-only" },
  async ({ page }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });
    await page.route("**/api/holding-imports", async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route("**/api/automation/angellist/status", async (route) => {
      await route.fulfill({
        json: {
          version: 1,
          status: "setup_required",
          interval: "daily",
          runStatus: null,
          lastSeenAt: null,
          lastCompletedAt: null,
          nextRunAt: null,
          latestImportId: null,
          errorCode: null,
        },
      });
    });

    await page.goto("/holdings/sources");
    const keelOrigin = new URL(page.url()).origin;

    await expect(
      page.getByRole("button", { name: "Copy setup command" }),
    ).toHaveCount(3);
    await expect(page.getByText("Set up on this Mac")).toHaveCount(0);
    await expect(page.locator("code")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Add a bank",
      "Brokerages",
      "Private investments",
    ]);
    const privateInvestments = page.getByRole("region", {
      name: "Private investments",
    });
    const providerRows = privateInvestments.getByRole("article");
    await expect(providerRows).toHaveCount(3);
    await expect(providerRows.nth(0)).toHaveAccessibleName("AngelList");
    await expect(providerRows.nth(1)).toHaveAccessibleName("Tokenfolio");
    await expect(providerRows.nth(2)).toHaveAccessibleName("Sydecar");

    const viewportWidths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(viewportWidths.scroll).toBe(viewportWidths.client);

    await page.addStyleTag({
      content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
    });
    await expect(page.locator(".screen-stack")).toHaveScreenshot(
      "holdings-provider-agent-setup.png",
      {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.025,
        threshold: 0.25,
      },
    );

    const setup = privateInvestments.getByRole("article", {
      name: "Tokenfolio",
    });
    await setup.getByRole("button", { name: "Copy setup command" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `make provider-agent-setup PROVIDER=tokenfolio KEEL_URL=${keelOrigin}`,
    );
    await expect(setup.getByText("Copied. Paste in Terminal.")).toBeVisible();
  },
);

test("adds a new security without preselecting an unrelated prior holding", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-08-10T16:00:00.000Z") });
  const prior = {
    positionId: "position_synthetic_orbital",
    containerId: "container_synthetic_brokerage",
    name: "Orbital Systems",
    accountLabel: "Synthetic brokerage",
    ticker: "ORBT",
    instrumentType: "equity",
    snapshotId: "snapshot_synthetic_orbital",
    observedAt: "2026-08-01T12:00:00.000Z",
    quantityMicros: 40_000_000,
    valueMinor: 650_000,
  };
  const row = {
    ...robinhoodImportPreview.rows[0]!,
    id: "row_synthetic_photon",
    positionName: "PHOT · Photon Components",
    exposureName: "Photon Components",
    ownerLabel: "Synthetic brokerage",
    ticker: "PHOT",
    quantityMicros: 15_000_000,
    investedMinor: 225_000,
    administratorNavMinor: 225_000,
    costBasisMinor: null,
    action: "needs_attention",
    adjudicationStatus: "quarantined",
    decisionSource: null,
    reasonCodes: [],
    containerId: prior.containerId,
    instrumentType: "equity",
    positionId: null,
    currentSnapshotId: null,
    identityReviewId: null,
    acceptanceBlocked: false,
  };
  let added = false;
  const bodies: unknown[] = [];
  let releaseSave: () => void = () => undefined;
  const saveGate = new Promise<void>((complete) => {
    releaseSave = complete;
  });
  const comparisons: Array<string | null> = [];
  const preview = () => ({
    ...robinhoodImportPreview,
    id: "import_synthetic_new_security",
    status: added ? "applied" : "quarantined",
    summary: {
      ...robinhoodImportPreview.summary,
      rowCount: 1,
      createCount: 1,
      administratorValueCount: 1,
      autoAppliedCount: 0,
      quarantinedCount: added ? 0 : 1,
      needsAttentionCount: added ? 0 : 1,
    },
    rows: [
      {
        ...row,
        ...(added
          ? {
              adjudicationStatus: "manually_resolved",
              decisionSource: "manual",
              identityReviewId: "review_synthetic_photon",
              sourceReview: {
                id: "review_synthetic_photon",
                decision: "separate",
                priorPositionId: null,
                decisionSource: "manual",
                createdAt: "2026-08-10T16:00:00.000Z",
                appliesToThisReport: true,
                importId: "import_synthetic_new_security",
                rowId: row.id,
              },
            }
          : {}),
      },
    ],
    priorPositions: [prior],
    preservedPositions: [prior],
  });
  await page.route(/\/api\/investment-connections(?:\/auto-sync)?$/u, (route) =>
    route.fulfill({
      json: investmentState([
        investmentStatus({
          institutionLabel: "Synthetic brokerage",
          latestImportId: preview().id,
          latestAdjudication: {
            importId: preview().id,
            policyVersion: "plaid-investments-holdings-auto-v4",
            autoAppliedCount: 0,
            quarantinedCount: added ? 0 : 1,
            preservedPositionCount: 1,
            preservedObservedAt: prior.observedAt,
            baselineRefreshStatus: "not_needed",
          },
        }),
      ]),
    }),
  );
  await page.route(`**/api/holding-imports/${preview().id}`, (route) =>
    route.fulfill({ json: preview() }),
  );
  await page.route(
    `**/api/holding-imports/${preview().id}/exposures/refresh`,
    (route) => route.fulfill({ json: preview() }),
  );
  await page.route(
    `**/api/holding-imports/${preview().id}/rows/${row.id}/review*`,
    async (route) => {
      if (route.request().method() === "POST") {
        bodies.push(route.request().postDataJSON());
        if (bodies.length === 1) {
          await saveGate;
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic save failure." },
          });
        }
        added = true;
        return route.fulfill({ json: preview() });
      }
      const id = new URL(route.request().url()).searchParams.get(
        "priorPositionId",
      );
      comparisons.push(id);
      return route.fulfill({
        json: {
          rowId: row.id,
          priorPositionId: id,
          currentTotalMinor: 650_000,
          sameTotalMinor: id ? 225_000 : null,
          separateTotalMinor: 875_000,
          ignoreTotalMinor: 650_000,
        },
      });
    },
  );
  await page.route("**/api/portfolio-baseline/refresh", (route) =>
    route.fulfill({ json: baselineState }),
  );
  await page.goto("/holdings/sources");
  await page.getByRole("button", { name: "Resolve 1 decision" }).click();
  const form = page.locator(".public-source-decision");
  const capture = async (state: string) => {
    const root = process.env.KEEL_SOURCE_REVIEW_DIR;
    if (root)
      await page.locator(".public-source-update").screenshot({
        path: resolve(
          root,
          `new-security-${state}-${test.info().project.name}.png`,
        ),
        animations: "disabled",
        scale: "css",
        style: ".topbar,.mobile-nav{visibility:hidden!important}",
      });
  };
  await expect(form).toBeVisible();
  await expect(form.getByText(prior.name, { exact: true })).toHaveCount(0);
  await expect(
    form.getByRole("button", { name: "Confirm same holding", exact: true }),
  ).toHaveCount(0);
  await expect(
    form.getByText("Your existing holdings stay unchanged."),
  ).toBeVisible();
  const add = form.getByRole("button", { name: "Add PHOT", exact: true });
  await expect(add).toBeEnabled();
  expect(comparisons.length).toBeGreaterThan(0);
  expect(comparisons.every((id) => id === null)).toBe(true);
  for (let step = 0; step < 80; step++) {
    if (await add.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(add).toBeFocused();
  const box = await add.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
  await capture("initial");
  await expect(form).toHaveScreenshot("brokerage-new-holding.png", {
    animations: "disabled",
    stylePath: resolve("e2e/purchase-details.capture.css"),
  });
  await form
    .getByRole("button", { name: "Match to an existing holding" })
    .click();
  await form
    .getByRole("combobox", { name: "Prior holding", exact: true })
    .click();
  await page.getByRole("option", { name: /Orbital Systems/u }).click();
  await expect(form.getByText(prior.name, { exact: true })).toBeVisible();
  await expect(
    form.getByText(
      "You chose Orbital Systems to compare with PHOT. Confirm a match only if they are the same holding.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    form.getByRole("button", { name: "Confirm same holding", exact: true }),
  ).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  expect(bodies).toEqual([]);
  await capture("explicit-comparison");
  await form
    .getByRole("button", { name: "Add as a new holding instead" })
    .click();
  await expect(form.getByText(prior.name, { exact: true })).toHaveCount(0);
  await expect(add).toBeEnabled();
  await add.click();
  await expect(
    form.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await capture("saving");
  releaseSave();
  await expect(
    form.getByText(
      "Keel could not confirm whether this decision was saved. Check its status before saving again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(add).toBeDisabled();
  expect(bodies).toHaveLength(1);
  await capture("failure");
  await form
    .getByRole("button", { name: "Check decision status", exact: true })
    .click();
  await expect(add).toBeEnabled();
  expect(bodies).toHaveLength(1);
  await add.click();
  await expect(
    page.getByText("Added as a separate holding. Your decision is saved.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(bodies).toEqual([
    {
      decision: "separate",
      expectedReviewId: null,
      expectedSourceSnapshotId: null,
      priorPositionId: null,
      expectedPriorSnapshotId: null,
    },
    {
      decision: "separate",
      expectedReviewId: null,
      expectedSourceSnapshotId: null,
      priorPositionId: null,
      expectedPriorSnapshotId: null,
    },
  ]);
  await capture("saved");
});

function exceptionPreview() {
  return {
    ...importPreview,
    status: "quarantined",
    summary: {
      ...importPreview.summary,
      autoAppliedCount: 70,
      quarantinedCount: 2,
      preservedPositionCount: 0,
    },
    rows: importPreview.rows.map((row, index) => ({
      ...row,
      decisionSource: index === 0 || index === 3 ? null : "policy",
      adjudicationStatus:
        index === 0 || index === 3 ? "quarantined" : "auto_applied",
      issues:
        index === 0
          ? [
              "Check the legal position and owner. This may overlap a previously recorded position.",
            ]
          : row.issues,
    })),
  };
}

test(
  "shows only unresolved private positions and safely retries their decisions",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const preview = exceptionPreview();
    const bodies: Array<{
      decisions: Array<{ rowId: string; decision: string }>;
    }> = [];
    await page.route("**/api/alpha", (route) =>
      route.fulfill({ json: alphaFixture }),
    );
    await page.route(`**/api/holding-imports/${preview.id}`, (route) =>
      route.fulfill({ json: preview }),
    );
    await page.route(
      `**/api/holding-imports/${preview.id}/reconcile`,
      (route) => route.fulfill({ json: preview }),
    );
    await page.route(`**/api/holding-imports/${preview.id}/apply`, (route) => {
      bodies.push(route.request().postDataJSON());
      return bodies.length === 1
        ? route.fulfill({
            status: 409,
            json: { error: "The update changed. Try again." },
          })
        : route.fulfill({
            json: {
              importId: preview.id,
              createdCount: 69,
              updatedCount: 1,
              unchangedCount: 1,
              rejectedCount: 1,
              lockedValueCount: 22,
            },
          });
    });
    await page.goto(`/holdings/imports/${preview.id}`);
    await expect(
      page.getByRole("heading", { name: "2 positions need attention" }),
    ).toBeVisible();
    await expect(page.locator(".import-table tbody tr")).toHaveCount(2);
    await expect(
      page.getByText("70 positions recorded automatically", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText(preview.rows[1]!.positionName, { exact: true }),
    ).toHaveCount(0);
    // Capture the tall component without the viewport navigation overlay.
    const snapshotStyle = await page.addStyleTag({
      content: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
    await expect(page.locator(".holding-import-workspace")).toHaveScreenshot(
      "holdings-import-exceptions.png",
      { animations: "disabled", maxDiffPixelRatio: 0.025 },
    );
    await snapshotStyle.evaluate((style) => {
      style.textContent = "";
    });
    await page
      .getByRole("checkbox", {
        name: `Accept update for ${preview.rows[0]!.positionName}`,
      })
      .check();
    await page
      .getByRole("button", { name: "Apply 1 and dismiss the rest" })
      .click();
    await expect(
      page.getByText("The update changed. Try again."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Apply 1 and dismiss the rest" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Exceptions resolved" }),
    ).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(
      bodies[1]?.decisions.map(({ rowId, decision }) => ({ rowId, decision })),
    ).toEqual([
      { rowId: preview.rows[0]!.id, decision: "accepted" },
      { rowId: preview.rows[3]!.id, decision: "rejected" },
    ]);
    await expectNoHorizontalOverflow(page);
  },
);

test(
  "connects Robinhood through Investments and isolates exceptions",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const exchangeBodies: unknown[] = [];
    await page.unroute("**/api/investment-connections");
    await page.unroute("**/api/investment-holdings");
    await routeHoldingsPage(page, {
      householdName: alphaFixture.dashboard.householdName,
      holdings: alphaFixture.holdings,
      investmentHoldings: {
        ...emptyInvestmentHoldingsView,
        authorizationStatus: "available",
      },
      acceptedCashAccounts: [],
      pendingImports: [],
    });
    await page.addInitScript(() => {
      (
        window as unknown as {
          Plaid: {
            create: (input: { onSuccess: (token: string) => void }) => {
              destroy: () => void;
              open: () => void;
            };
          };
        }
      ).Plaid = {
        create: ({ onSuccess }) => ({
          destroy: () => undefined,
          open: () => window.setTimeout(() => onSuccess("public-synthetic"), 0),
        }),
      };
    });
    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });
    await page.route("**/api/holding-imports", async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route("**/api/automation/angellist/status", async (route) => {
      await route.fulfill({
        json: {
          version: 1,
          status: "ready",
          interval: "weekly",
          runStatus: null,
          lastSeenAt: "2026-08-09T16:00:00.000Z",
          lastCompletedAt: "2026-08-03T16:00:00.000Z",
          nextRunAt: "2026-08-16T16:00:00.000Z",
          latestImportId: null,
          errorCode: null,
        },
      });
    });
    await page.route("**/api/investment-connections", async (route) => {
      await route.fulfill({ json: investmentState([]) });
    });
    await page.route("**/api/investment-holdings", async (route) => {
      await route.fulfill({
        json: {
          ...emptyInvestmentHoldingsView,
          authorizationStatus: "available",
        },
      });
    });
    await page.route(
      "**/api/investment-connections/link-token",
      async (route) => {
        await route.fulfill({
          json: {
            linkToken: "link-synthetic",
            expiration: "2026-08-10T16:30:00.000Z",
          },
        });
      },
    );
    await page.route(
      "**/api/investment-connections/exchange",
      async (route) => {
        exchangeBodies.push(route.request().postDataJSON());
        await route.fulfill({
          json: investmentStatus({
            lastSyncedAt: "2026-08-10T16:00:00.000Z",
            latestImportId: robinhoodImportPreview.id,
            latestAdjudication: {
              importId: robinhoodImportPreview.id,
              policyVersion: "plaid-investments-holdings-auto-v4",
              autoAppliedCount: 2,
              quarantinedCount: 1,
              preservedPositionCount: 1,
              baselineRefreshStatus: "refreshed",
            },
          }),
        });
      },
    );
    await page.route(
      /\/api\/holding-imports\/holding_import_synthetic_robinhood$/,
      async (route) => {
        await route.fulfill({ json: robinhoodImportPreview });
      },
    );

    await page.route(
      "**/api/holding-imports/holding_import_synthetic_robinhood/rows/*/review*",
      (route) =>
        route.fulfill({
          json: {
            rowId: "robinhood_row_3",
            priorPositionId: null,
            currentTotalMinor: null,
            sameTotalMinor: null,
            separateTotalMinor: null,
            ignoreTotalMinor: null,
          },
        }),
    );
    await page.goto("/holdings/sources");
    await expect(
      page.getByRole("heading", { name: "Brokerages" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add brokerage" }).click();

    await expect(page).toHaveURL(/\/holdings\/sources$/u);
    await expect(
      page.getByText(
        "2 positions updated automatically. 1 decision needs you.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("1 prior holding kept at its dated value.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("The position identity conflicts", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm same holding", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add as a new holding", exact: true }),
    ).toBeDisabled();
    const viewportWidths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(viewportWidths.scroll).toBe(viewportWidths.client);
    await page.addStyleTag({
      content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
    });
    const reviewRoot = process.env.KEEL_SOURCE_REVIEW_DIR;
    if (reviewRoot)
      await page.locator(".public-source-update").screenshot({
        path: resolve(
          reviewRoot,
          `invalid-source-${test.info().project.name}.png`,
        ),
        animations: "disabled",
        scale: "css",
      });
    await expect(page.locator(".screen-stack")).toHaveScreenshot(
      "holdings-robinhood-exceptions.png",
      {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.025,
        threshold: 0.25,
      },
    );

    await expect(page.getByRole("button", { name: "Check now" })).toBeVisible();
    expect(exchangeBodies).toEqual([{ publicToken: "public-synthetic" }]);
  },
);

test(
  "requests an AngelList update from the phone-safe Holdings flow",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const intervalUpdates: unknown[] = [];
    let interval = "weekly";
    let running = false;

    const overview = () => ({
      version: 1,
      status: running ? "running" : "ready",
      interval,
      runStatus: running ? "queued" : null,
      lastSeenAt: "2026-08-09T16:00:00.000Z",
      lastCompletedAt: "2026-08-08T16:00:00.000Z",
      nextRunAt:
        interval === "off"
          ? null
          : interval === "daily"
            ? "2026-08-10T16:00:00.000Z"
            : "2026-08-16T16:00:00.000Z",
      latestImportId: null,
      errorCode: null,
    });

    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });
    await page.route("**/api/holding-imports", async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route("**/api/automation/angellist/status", async (route) => {
      await route.fulfill({ json: overview() });
    });
    await page.route(
      "**/api/automation/angellist/mac-agent/config",
      async (route) => {
        const body = route.request().postDataJSON() as { interval: string };
        intervalUpdates.push(body);
        interval = body.interval;
        await route.fulfill({ json: overview() });
      },
    );
    await page.route("**/api/automation/angellist/run", async (route) => {
      running = true;
      await route.fulfill({
        json: {
          version: 1,
          runId: "11111111-1111-4111-8111-111111111111",
          status: "queued",
        },
        status: 202,
      });
    });
    await page.route(
      "**/api/automation/provider-holdings/*/status",
      async (route) => {
        const provider = new URL(route.request().url()).pathname
          .split("/")
          .at(-2);
        await route.fulfill({
          json: { ...overview(), provider, interval: "daily" },
        });
      },
    );

    await page.goto("/holdings/sources");
    const privateInvestments = page.getByRole("region", {
      name: "Private investments",
    });
    await expect(
      privateInvestments.getByRole("heading", { name: "Working" }),
    ).toHaveCount(3);
    const angelList = privateInvestments.getByRole("article", {
      name: "AngelList Working",
    });
    const intervalSelect = angelList.getByRole("combobox", {
      name: "Automatic updates",
    });
    await expect(intervalSelect).toHaveText("Weekly");
    await expect(
      privateInvestments.getByText(
        "Clear positions update automatically. Only uncertain positions need review.",
      ),
    ).toBeVisible();

    const viewportWidths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(viewportWidths.scroll).toBe(viewportWidths.client);

    await page.addStyleTag({
      content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
    });
    await expect(page.locator(".screen-stack")).toHaveScreenshot(
      "holdings-angellist-mac-agent.png",
      {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.025,
        threshold: 0.25,
      },
    );

    await intervalSelect.click();
    await page.getByRole("option", { name: "Daily" }).click();
    await expect(page.getByText("AngelList will update daily.")).toBeVisible();
    expect(intervalUpdates).toEqual([{ interval: "daily" }]);

    await privateInvestments
      .getByRole("article", { name: "AngelList Working" })
      .getByRole("button", { name: "Queue update" })
      .click();
    await expect(
      privateInvestments
        .getByRole("article", { name: "AngelList Update queued" })
        .getByRole("heading", { name: "Update queued" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "AngelList update queued for the agent’s next daily check.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Update queued" }),
    ).toBeDisabled();
  },
);

test(
  "starts a provider-scoped browser reconnect without terminal handoff",
  { tag: "@desktop-only" },
  async ({ page }) => {
    await page.clock.install({ time: new Date("2026-08-26T11:00:00.000Z") });
    let reconnectChecks = 0;
    let alphaChecks = 0;
    const sessionId = "22222222-2222-4222-8222-222222222222";
    let sessionStatus: "ready" | "opened" | "connected" = "ready";
    await page.addInitScript(() => {
      window.open = () => null;
      const attempts: number[] = [];
      Object.defineProperty(window, "__syntheticReconnectAttempts", {
        value: attempts,
      });
      const request = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes("/api/automation/provider-browser/sessions/"))
          attempts.push(Date.now());
        return request(input, init);
      };
    });
    await page.route("**/api/alpha", async (route) => {
      alphaChecks++;
      await route.fulfill({ json: alphaFixture });
    });
    await page.route("**/api/holding-imports", async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route("**/api/automation/angellist/status", async (route) => {
      await route.fulfill({
        json: {
          version: 1,
          status: "needs_attention",
          interval: "daily",
          runStatus: null,
          lastSeenAt: "2026-08-26T12:00:00.000Z",
          lastCompletedAt: "2026-08-25T12:00:00.000Z",
          nextRunAt: "2026-08-27T12:00:00.000Z",
          latestImportId: "import_synthetic_angellist",
          errorCode: "angellist_sign_in_required",
        },
      });
    });
    await page.route(
      "**/api/automation/provider-holdings/*/status",
      async (route) => {
        const provider = new URL(route.request().url()).pathname
          .split("/")
          .at(-2);
        await route.fulfill({
          json: {
            version: 1,
            provider,
            status: "ready",
            interval: "daily",
            runStatus: null,
            lastSeenAt: "2026-08-26T12:00:00.000Z",
            lastCompletedAt: "2026-08-25T12:00:00.000Z",
            nextRunAt: "2026-08-27T12:00:00.000Z",
            latestImportId: null,
            errorCode: null,
          },
        });
      },
    );
    await page.route(
      "**/api/automation/provider-browser/angellist/reconnect",
      async (route) => {
        expect(route.request().method()).toBe("POST");
        // Start the session clock only after its initiating request reaches Keel.
        await page.clock.pauseAt(new Date("2026-08-26T12:00:00.000Z"));
        await route.fulfill({
          status: 202,
          json: {
            version: 1,
            id: sessionId,
            provider: "angellist",
            status: "requested",
            requestedAt: "2026-08-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:15:00.000Z",
            openedAt: null,
            connectedAt: null,
            errorCode: null,
          },
        });
      },
    );
    await page.route(
      `**/api/automation/provider-browser/sessions/${sessionId}`,
      async (route) => {
        reconnectChecks++;
        await route.fulfill({
          json: {
            version: 1,
            id: sessionId,
            provider: "angellist",
            status: sessionStatus,
            requestedAt: "2026-08-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:15:00.000Z",
            openedAt:
              sessionStatus === "ready" ? null : "2026-08-26T12:01:00.000Z",
            connectedAt:
              sessionStatus === "connected" ? "2026-08-26T12:02:00.000Z" : null,
            errorCode: null,
          },
        });
      },
    );

    await page.goto("/holdings/sources");
    await page.getByRole("button", { name: "Reconnect AngelList" }).click();
    await expect(page.getByText("Preparing a private browser…")).toBeVisible();
    await page.clock.runFor(5_100);
    const openLink = page.getByRole("link", { name: "Open AngelList" });
    await expect(openLink).toHaveAttribute(
      "href",
      `/api/automation/provider-browser/sessions/${sessionId}/open`,
    );
    await expect(openLink).toHaveAttribute("data-slot", "button-link");
    await expect(page.locator("body")).not.toContainText("SSH");
    await expect(page.locator("body")).not.toContainText("VNC");
    await expect(page.locator("body")).not.toContainText("Paste in Terminal");

    const firstAttempts = await page.evaluate(
      () =>
        (Reflect.get(window, "__syntheticReconnectAttempts") as number[])
          .length,
    );
    await page.clock.runFor(1_000);
    expect(
      await page.evaluate(
        () =>
          (Reflect.get(window, "__syntheticReconnectAttempts") as number[])
            .length,
      ),
      "Reconnect checks must wait five seconds",
    ).toBe(firstAttempts);

    // Returned status objects and focus events must not restart the effect or
    // bypass the shared five-second clock. Hidden tabs do no background work.
    const firstCount = reconnectChecks;
    for (let index = 0; index < 10; index++) {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.clock.runFor(100);
    }
    expect(reconnectChecks - firstCount).toBeLessThanOrEqual(1);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hiddenCount = reconnectChecks;
    await page.clock.runFor(60_000);
    expect(reconnectChecks).toBe(hiddenCount);
    sessionStatus = "opened";
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(1);
    expect(alphaChecks).toBe(0);
    await expect(
      page.getByText(
        "Finish signing in to AngelList. When the private screen closes, return to Keel.",
        { exact: true },
      ),
    ).toBeVisible();

    sessionStatus = "connected";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(5_100);
    await expect(
      page.getByText(
        "AngelList reconnected. Clear positions update automatically; exceptions stay available for review.",
        { exact: true },
      ),
    ).toBeVisible();

    const completedCount = reconnectChecks;
    await page.clock.runFor(60_000);
    expect(reconnectChecks).toBe(completedCount);
    await page.getByText("Troubleshooting", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Copy AngelList repair command" }),
    ).toBeVisible();
  },
);
