import { expect, test, type Page } from "@playwright/test";

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
      },
    });
  });
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

const sydecarImportPreview = {
  id: "holding_import_synthetic_sydecar",
  provider: "sydecar",
  status: "pending_review",
  observedAt: "2026-08-20T00:00:00.000Z",
  summary: {
    rowCount: 1,
    administratorValueCount: 0,
    lockedValueCount: 0,
    createCount: 0,
    updateCount: 0,
    unchangedCount: 1,
    needsAttentionCount: 0,
    autoAppliedCount: 0,
    quarantinedCount: 0,
    preservedPositionCount: 0,
  },
  rows: [
    {
      id: "sydecar_row_1",
      sourceRowNumber: 3,
      positionName: "Synthetic Climate SPV I",
      exposureName: "Synthetic Climate I",
      ownerLabel: "Synthetic Investment Profile",
      providerStatus: "Live",
      investedOn: null,
      investedOnState: "not_reported",
      investedMinor: 500_000,
      administratorNavMinor: null,
      administratorNavState: "not_reported",
      realizedValueMinor: 0,
      reportedManagementFeePpm: 20_000,
      reportedCarryPpm: 200_000,
      currentExposureNames: ["Synthetic Climate Systems"],
      action: "no_change",
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
    quarantinedCount: 2,
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
  page,
}) => {
  await page.route("**/api/alpha", (route) =>
    route.fulfill({ json: alphaFixture }),
  );
  for (const [provider, fixture] of [
    ["tokenfolio", tokenfolioImportPreview],
    ["sydecar", sydecarImportPreview],
  ] as const) {
    await page.route(`**/api/holding-imports/${provider}`, (route) => {
      expect(route.request().method()).toBe("POST");
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
    const label = provider === "tokenfolio" ? "Tokenfolio" : "Sydecar";
    await page.getByRole("option", { name: label, exact: true }).click();
    await expect(
      page.getByRole("link", { name: `Download ${label} template` }),
    ).toHaveAttribute("href", `/api/holding-import-templates/${provider}`);
    if (provider === "tokenfolio")
      await expect(page.locator(".holding-import-workspace")).toHaveScreenshot(
        "holdings-import-tokenfolio-template.png",
        { animations: "disabled", maxDiffPixelRatio: 0.025 },
      );
    await page.locator('input[type="file"]').setInputFiles({
      name: `${provider}-holdings.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from("synthetic template"),
    });
    await page
      .getByRole("button", { name: "Import file", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Update complete" }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByText("No further review is needed.")).toBeVisible();
    await expect(page.locator(".holding-import-workspace")).toHaveScreenshot(
      `holdings-import-${provider}-complete.png`,
      { animations: "disabled", maxDiffPixelRatio: 0.025 },
    );
    await expectNoHorizontalOverflow(page);
  }
});

test("uses one setup command interface for every portfolio agent", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
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
  const expectedCommands = ["angellist", "tokenfolio", "sydecar"].map(
    (provider) =>
      `make provider-agent-setup PROVIDER=${provider} KEEL_URL=${keelOrigin}`,
  );

  await expect(
    page.getByRole("button", { name: "Copy setup command" }),
  ).toHaveCount(3);
  await expect(page.getByText("Set up on this Mac")).toHaveCount(0);
  await expect(page.locator("code")).toHaveCount(0);

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

  const copyButtons = page.getByRole("button", { name: "Copy setup command" });
  for (const [index, expectedCommand] of expectedCommands.entries()) {
    await copyButtons.nth(index).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      expectedCommand,
    );
  }
  await expect(page.getByText("Copied. Paste in Terminal.")).toHaveCount(3);

  const providerRows = page.locator(".provider-agent-row");
  for (const index of [0, 1]) {
    const buttonBox = await providerRows
      .nth(index)
      .getByRole("button")
      .boundingBox();
    const noticeBox = await providerRows
      .nth(index)
      .getByText("Copied. Paste in Terminal.")
      .boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(noticeBox).not.toBeNull();
    expect(Math.abs((buttonBox?.x ?? 0) - (noticeBox?.x ?? 0))).toBeLessThan(1);
  }
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

test("shows only unresolved private positions and safely retries their decisions", async ({
  page,
}) => {
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
  await page.route(`**/api/holding-imports/${preview.id}/reconcile`, (route) =>
    route.fulfill({ json: preview }),
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
  await expect(page.locator(".holding-import-workspace")).toHaveScreenshot(
    "holdings-import-exceptions.png",
    { animations: "disabled", maxDiffPixelRatio: 0.025 },
  );
  await page
    .getByLabel(`Accept update for ${preview.rows[0]!.positionName}`)
    .check();
  await page
    .getByRole("button", { name: "Apply 1 and dismiss the rest" })
    .click();
  await expect(page.getByText("The update changed. Try again.")).toBeVisible();
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
});

test("automatically processes an older pending import without opening its review", async ({
  page,
}) => {
  const preview = {
    ...importPreview,
    status: "applied",
    summary: { ...importPreview.summary, autoAppliedCount: 72 },
    rows: importPreview.rows.map((row) => ({
      ...row,
      decisionSource: "policy",
      adjudicationStatus: "auto_applied",
    })),
  };
  let processed = false;
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings: alphaFixture.holdings,
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [
      {
        id: preview.id,
        provider: "angellist",
        status: "pending_review",
        rowCount: 72,
        observedAt: preview.observedAt,
        createdAt: preview.observedAt,
      },
    ],
  });
  await page.route("**/api/alpha", (route) =>
    route.fulfill({ json: alphaFixture }),
  );
  await page.route(
    `**/api/holding-imports/${preview.id}/reconcile`,
    (route) => {
      processed = true;
      return route.fulfill({ json: preview });
    },
  );
  await page.goto("/holdings/sources");
  await expect.poll(() => processed).toBe(true);
  await expect(
    page.getByRole("button", { name: /Review AngelList import/ }),
  ).toHaveCount(0);
  await expect(page.locator(".holding-import-workspace")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("connects Robinhood through Investments and isolates exceptions", async ({
  page,
}) => {
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
  await page.route("**/api/investment-connections/exchange", async (route) => {
    exchangeBodies.push(route.request().postDataJSON());
    await route.fulfill({
      json: investmentStatus({
        lastSyncedAt: "2026-08-10T16:00:00.000Z",
        latestImportId: robinhoodImportPreview.id,
        latestAdjudication: {
          importId: robinhoodImportPreview.id,
          policyVersion: "plaid-investments-holdings-auto-v3",
          autoAppliedCount: 2,
          quarantinedCount: 2,
          preservedPositionCount: 1,
          baselineRefreshStatus: "refreshed",
        },
      }),
    });
  });
  await page.route(
    /\/api\/holding-imports\/holding_import_synthetic_robinhood$/,
    async (route) => {
      await route.fulfill({ json: robinhoodImportPreview });
    },
  );

  await page.goto("/holdings/sources");
  await expect(page.getByRole("heading", { name: "Brokerages" })).toBeVisible();
  await page.getByRole("button", { name: "Add brokerage" }).click();

  await expect(page).toHaveURL(
    /\/holdings\/imports\/holding_import_synthetic_robinhood$/,
  );
  await expect(
    page.getByRole("heading", { name: "Uncertain records stayed unchanged" }),
  ).toBeFocused();
  await expect(
    page.getByText(
      "Keel kept the last accepted values and did not infer sales.",
    ),
  ).toBeVisible();
  const summary = page.getByLabel("Automatic review summary");
  await expect(summary).toContainText("2Applied");
  await expect(summary).toContainText("2Exceptions");
  await expect(summary).toContainText("1Prior positions kept");
  await expect(page.getByText("The position identity conflicts")).toBeVisible();

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
    "holdings-robinhood-exceptions.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await expect(
    page.getByRole("button", { name: "Back to holdings" }),
  ).toBeVisible();
  expect(exchangeBodies).toEqual([{ publicToken: "public-synthetic" }]);
});

test("shows one Robinhood exception entry point", async ({ page }) => {
  await page.unroute("**/api/investment-connections");
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.route("**/api/holding-imports", async (route) => {
    await route.fulfill({
      json: [
        {
          id: robinhoodImportPreview.id,
          provider: "plaid_investments",
          status: "quarantined",
          observedAt: robinhoodImportPreview.observedAt,
          rowCount: robinhoodImportPreview.summary.rowCount,
          createdAt: "2026-08-10T16:01:00.000Z",
        },
      ],
    });
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
    await route.fulfill({
      json: investmentState([
        investmentStatus({
          latestImportId: robinhoodImportPreview.id,
          latestAdjudication: {
            importId: robinhoodImportPreview.id,
            policyVersion: "plaid-investments-holdings-auto-v3",
            autoAppliedCount: 2,
            quarantinedCount: 2,
            preservedPositionCount: 1,
            baselineRefreshStatus: "refreshed",
          },
        }),
      ]),
    });
  });

  await page.goto("/holdings/sources");
  const robinhoodCard = page
    .locator(".investment-institution")
    .filter({ hasText: "Robinhood" });
  await expect(robinhoodCard).toContainText("2 waiting for review");
  await expect(
    page.getByRole("button", { name: "Review 2 items" }),
  ).toHaveCount(1);
  await expect(page.locator(".holding-import-pending")).toHaveCount(0);
  await expect(robinhoodCard).toHaveScreenshot(
    "holdings-robinhood-single-exception.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
});

test("shows automatic Robinhood checks with exception-only review", async ({
  page,
}) => {
  let disconnectCalls = 0;
  await page.unroute("**/api/investment-connections");
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
        lastSeenAt: "2026-08-13T16:00:00.000Z",
        lastCompletedAt: "2026-08-10T16:00:00.000Z",
        nextRunAt: "2026-08-17T16:00:00.000Z",
        latestImportId: null,
        errorCode: null,
      },
    });
  });
  const automaticInvestmentState = investmentState([
    investmentStatus({
      lastSyncedAt: "2026-08-14T16:00:00.000Z",
      latestAdjudication: {
        importId: "holding_import_synthetic_applied",
        policyVersion: "plaid-investments-holdings-auto-v3",
        autoAppliedCount: 3,
        quarantinedCount: 0,
        preservedPositionCount: 0,
        baselineRefreshStatus: "refreshed",
      },
    }),
  ]);
  await page.route("**/api/investment-connections", async (route) => {
    await route.fulfill({ json: automaticInvestmentState });
  });
  await page.route("**/api/investment-connections/auto-sync", async (route) => {
    await route.fulfill({ json: automaticInvestmentState });
  });
  await page.route(
    `**/api/investment-connections/${investmentConnectionId}`,
    async (route) => {
      expect(route.request().method()).toBe("DELETE");
      disconnectCalls += 1;
      await route.fulfill({
        json: investmentStatus({
          status: "disconnected",
          lastSyncedAt: null,
          automaticUpdatesEnabled: false,
          latestRunStatus: null,
        }),
      });
    },
  );

  await page.goto("/holdings/sources");
  const robinhoodCard = page
    .locator(".investment-institution")
    .filter({ hasText: "Robinhood" });
  await expect(
    robinhoodCard.getByRole("heading", { name: "Robinhood" }),
  ).toBeVisible();
  await expect(robinhoodCard).toContainText("Up to date");
  await expect(page.getByRole("button", { name: "Check now" })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    page.getByText(
      "Provider access will be removed. Reviewed history stays in Keel.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep connected" }),
  ).toBeVisible();
  await expect(robinhoodCard).toHaveScreenshot(
    "holdings-robinhood-disconnect-confirmation.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  await page.getByRole("button", { name: "Keep connected" }).click();
  await expect(robinhoodCard).toContainText("0 accounts");

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
    "holdings-robinhood-automatic.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    page.getByText("Robinhood disconnected. Reviewed history remains visible."),
  ).toBeVisible();
  await expect(robinhoodCard).toBeVisible();
  await expect(robinhoodCard).toContainText("Disconnected");
  await expect(robinhoodCard).toContainText(
    "This Plaid connection ended. Reviewed positions and planning history remain available.",
  );
  await expect(
    robinhoodCard.getByRole("button", { name: "Connect again" }),
  ).toHaveCount(0);
  expect(disconnectCalls).toBe(1);
});

test("requests an AngelList update from the phone-safe Holdings flow", async ({
  page,
}) => {
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

  await page.goto("/holdings/sources");
  await expect(
    page.getByRole("heading", { name: "AngelList is working" }),
  ).toBeVisible();
  const intervalSelect = page
    .locator(".angellist-agent")
    .getByRole("combobox", { name: "Automatic updates" });
  await expect(intervalSelect).toHaveText("Weekly");
  await expect(
    page.getByText(
      "Updates follow your schedule. Only uncertain positions need review.",
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

  await page.getByRole("button", { name: "Queue update" }).click();
  await expect(
    page.getByRole("heading", { name: "AngelList update is queued" }),
  ).toBeVisible();
  await expect(
    page.getByText("AngelList update queued for the agent’s next daily check."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Update queued" }),
  ).toBeDisabled();
});

test("shows clear health and repair actions for portfolio agents", async ({
  page,
}) => {
  let tokenfolioUpdateRequested = false;
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
        status: "needs_attention",
        interval: "daily",
        runStatus: null,
        lastSeenAt: "2026-08-21T12:00:00.000Z",
        lastCompletedAt: "2026-08-20T12:00:00.000Z",
        nextRunAt: "2026-08-22T12:00:00.000Z",
        latestImportId: "import_synthetic_angellist",
        errorCode: "angellist_sign_in_required",
      },
    });
  });
  await page.unroute("**/api/automation/provider-holdings/*/status");
  await page.route(
    "**/api/automation/provider-holdings/*/status",
    async (route) => {
      const provider = new URL(route.request().url()).pathname
        .split("/")
        .at(-2);
      await route.fulfill({
        json:
          provider === "tokenfolio"
            ? {
                version: 1,
                provider,
                status: "needs_attention",
                interval: "daily",
                runStatus: null,
                lastSeenAt: "2026-08-21T12:00:00.000Z",
                lastCompletedAt: "2026-08-20T12:00:00.000Z",
                nextRunAt: "2026-08-22T12:00:00.000Z",
                latestImportId: "import_synthetic_tokenfolio",
                errorCode: "unexpected_failure",
              }
            : {
                version: 1,
                provider,
                status: "needs_attention",
                interval: "daily",
                runStatus: null,
                lastSeenAt: "2026-08-21T12:00:00.000Z",
                lastCompletedAt: "2026-08-20T12:00:00.000Z",
                nextRunAt: "2026-08-22T12:00:00.000Z",
                latestImportId: "import_synthetic_sydecar",
                errorCode: "incomplete_snapshot",
              },
      });
    },
  );
  await page.route(
    "**/api/automation/provider-holdings/tokenfolio/run",
    async (route) => {
      tokenfolioUpdateRequested = true;
      await route.fulfill({
        status: 202,
        json: {
          version: 1,
          provider: "tokenfolio",
          runId: "33333333-3333-4333-8333-333333333333",
          status: "queued",
        },
      });
    },
  );

  await page.goto("/holdings/sources");
  await expect(
    page.getByRole("heading", {
      name: "AngelList needs reconnecting",
    }),
  ).toBeVisible();
  await expect(
    page.locator(".provider-agent-row").filter({ hasText: "Tokenfolio" }),
  ).toContainText("Paused — update failed");
  await expect(
    page.locator(".provider-agent-row").filter({ hasText: "Sydecar" }),
  ).toContainText("Paused — totals did not reconcile");
  await expect(
    page.getByRole("button", { name: /Reconnect (AngelList|Sydecar)/u }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Reconnect Sydecar" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try update" })).toHaveCount(2);
  await expect(
    page.getByText("Copy repair command", { exact: true }),
  ).toHaveCount(0);
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
    "holdings-provider-agents.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page
    .locator(".provider-agent-row")
    .filter({ hasText: "Tokenfolio" })
    .getByRole("button", { name: "Try update" })
    .click();
  await expect(
    page
      .locator(".provider-agent-row")
      .filter({ hasText: "Tokenfolio" })
      .getByRole("heading", { name: "Update queued" }),
  ).toBeVisible();
  expect(tokenfolioUpdateRequested).toBe(true);
});

test("keeps unverified sign-ins and page-reading failures separate", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-04T12:01:00.000Z") });
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const sydecarSessionId = "44444444-4444-4444-8444-444444444444";
  let sessionStatus: "opened" | "failed" = "opened";
  let sydecarSessionStatus: "requested" | "cancelled" = "requested";
  let sydecarReconnectRequested = false;
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.route("**/api/alpha", (route) =>
    route.fulfill({ json: alphaFixture }),
  );
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
          status: "needs_attention",
          interval: "daily",
          runStatus: null,
          lastSeenAt: "2026-09-04T12:00:00.000Z",
          lastCompletedAt: "2026-09-03T12:00:00.000Z",
          nextRunAt: "2026-09-05T12:00:00.000Z",
          latestImportId: null,
          errorCode:
            provider === "tokenfolio"
              ? "provider_sign_in_required"
              : "page_not_supported",
        },
      });
    },
  );
  const session = () => ({
    version: 1,
    id: sessionId,
    provider: "tokenfolio",
    status: sessionStatus,
    requestedAt: "2026-09-04T12:00:00.000Z",
    expiresAt: "2026-09-04T12:15:00.000Z",
    openedAt: sessionStatus === "opened" ? "2026-09-04T12:01:00.000Z" : null,
    connectedAt: null,
    errorCode:
      sessionStatus === "failed" ? "provider_sign_in_incomplete" : null,
  });
  await page.route(
    "**/api/automation/provider-browser/tokenfolio/reconnect",
    (route) => route.fulfill({ status: 202, json: session() }),
  );
  await page.route(
    `**/api/automation/provider-browser/sessions/${sessionId}`,
    (route) => route.fulfill({ json: session() }),
  );
  const sydecarSession = () => ({
    ...session(),
    id: sydecarSessionId,
    provider: "sydecar",
    status: sydecarSessionStatus,
    openedAt: null,
    errorCode: null,
  });
  await page.route(
    "**/api/automation/provider-browser/sydecar/reconnect",
    (route) => {
      sydecarReconnectRequested = true;
      return route.fulfill({ status: 202, json: sydecarSession() });
    },
  );
  await page.route(
    `**/api/automation/provider-browser/sessions/${sydecarSessionId}`,
    (route) => {
      if (route.request().method() === "DELETE") {
        sydecarSessionStatus = "cancelled";
      }
      return route.fulfill({ json: sydecarSession() });
    },
  );
  await page.goto("/holdings/sources");
  const sources = page.locator(".provider-agents");
  const sydecar = sources
    .locator(".provider-agent-row")
    .filter({ hasText: "Sydecar" });
  await expect(
    sydecar.getByRole("heading", { name: "Could not read Sydecar" }),
  ).toBeVisible();
  await expect(
    sydecar.getByRole("button", { name: "Try update" }),
  ).toBeVisible();
  await expect(
    sydecar.getByRole("button", { name: "Reconnect Sydecar" }),
  ).toBeVisible();
  await expect(
    sydecar.getByRole("button", { name: "Reconnect Sydecar" }),
  ).toHaveClass(/button--secondary/u);
  await expect(sydecar.getByRole("button", { name: "Try update" })).toHaveClass(
    /button--primary/u,
  );
  expect(sydecarReconnectRequested).toBe(false);
  await page.getByRole("button", { name: "Reconnect Tokenfolio" }).click();
  await expect(
    sources.getByText(
      "Finish signing in to Tokenfolio. Keel will check the saved sign-in before confirming.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(sources.getByText(/Tokenfolio reconnected/u)).toHaveCount(0);
  sessionStatus = "failed";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(5_100);
  await expect(
    sources.getByText(
      "The sign-in did not stay available for automatic updates. Keel has not marked it connected.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(sources.getByText(/Tokenfolio reconnected/u)).toHaveCount(0);
  await expect(
    sources.getByText("Your saved provider session was not changed."),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.mouse.move(0, 0);
  await expect(sources).toHaveScreenshot(
    "holdings-provider-session-unverified.png",
    { animations: "disabled", caret: "hide" },
  );
  await sydecar.getByRole("button", { name: "Reconnect Sydecar" }).click();
  await expect(sydecar.getByText("Preparing a private browser…")).toBeVisible();
  expect(sydecarReconnectRequested).toBe(true);
  await expect(
    sydecar.getByRole("button", { name: "Try update" }),
  ).toBeDisabled();
  await sydecar.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    sydecar.getByRole("button", { name: "Reconnect Sydecar" }),
  ).toBeVisible();
  await expect(
    sydecar.getByRole("button", { name: "Try update" }),
  ).toBeEnabled();
});

for (const provider of ["tokenfolio", "sydecar"] as const) {
  test(`${provider} disables reconnect while a page-failure retry is being queued`, async ({
    page,
  }) => {
    const label = provider === "tokenfolio" ? "Tokenfolio" : "Sydecar";
    let queued = false;
    let reconnectRequests = 0;
    let finishUpdate = () => {};
    const responseReady = new Promise<void>((resolve) => {
      finishUpdate = resolve;
    });
    await page.route("**/api/alpha", (route) =>
      route.fulfill({ json: alphaFixture }),
    );
    await page.route("**/api/automation/provider-holdings/*/status", (route) =>
      route.fulfill({
        json: {
          version: 1,
          provider: new URL(route.request().url()).pathname.split("/").at(-2),
          status: queued ? "running" : "needs_attention",
          interval: "daily",
          runStatus: queued ? "queued" : null,
          lastSeenAt: "2026-09-04T12:00:00.000Z",
          lastCompletedAt: "2026-09-03T12:00:00.000Z",
          nextRunAt: "2026-09-05T12:00:00.000Z",
          latestImportId: null,
          errorCode: "page_not_supported",
        },
      }),
    );
    await page.route(
      `**/api/automation/provider-holdings/${provider}/run`,
      async (route) => {
        await responseReady;
        queued = true;
        await route.fulfill({
          status: 202,
          json: {
            version: 1,
            provider,
            runId: "55555555-5555-4555-8555-555555555555",
            status: "queued",
          },
        });
      },
    );
    await page.route(
      "**/api/automation/provider-browser/*/reconnect",
      (route) => {
        reconnectRequests += 1;
        return route.fulfill({
          status: 503,
          json: { error: "Unexpected reconnect" },
        });
      },
    );
    await page.goto("/holdings/sources");
    const source = page
      .locator(".provider-agent-row")
      .filter({ hasText: label });
    const reconnect = source.getByRole("button", {
      name: `Reconnect ${label}`,
    });
    await expect(reconnect).toBeEnabled();
    try {
      await source.getByRole("button", { name: "Try update" }).click();
      await expect(
        source.getByRole("button", { name: "Requesting…" }),
      ).toBeDisabled();
      await expect(reconnect).toBeDisabled();
      expect(reconnectRequests).toBe(0);
    } finally {
      finishUpdate();
    }
    await expect(
      source.getByRole("heading", { name: "Update queued" }),
    ).toBeVisible();
  });
}

test("starts a provider-scoped browser reconnect without terminal handoff", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-08-26T12:00:00.000Z") });
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

  await page.clock.pauseAt(new Date("2026-08-26T12:00:20.000Z"));
  await page.waitForLoadState("networkidle");
  const firstAttempts = await page.evaluate(
    () =>
      (Reflect.get(window, "__syntheticReconnectAttempts") as number[]).length,
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
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(1);
  expect(alphaChecks).toBe(0);

  sessionStatus = "opened";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(5_100);
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
});

test("keeps invalid AngelList agent responses out of user-facing copy", async ({
  page,
}) => {
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.route("**/api/holding-imports", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/automation/angellist/status", async (route) => {
    await route.fulfill({ json: { version: 1, status: "unexpected" } });
  });

  await page.goto("/holdings/sources");

  await expect(page.getByRole("alert")).toHaveText(
    "Keel could not check AngelList updates. Try again shortly.",
  );
  await expect(page.locator("body")).not.toContainText("invalid_value");
  await expect(page.locator("body")).not.toContainText("unrecognized_keys");
});
