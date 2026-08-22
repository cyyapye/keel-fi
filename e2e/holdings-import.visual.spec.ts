import { expect, test } from "@playwright/test";

import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";

const investmentConnectionId = "11111111-1111-4111-8111-111111111111";

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

test("imports Tokenfolio and Sydecar through provider-specific Keel templates", async ({
  page,
}) => {
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.route(/\/api\/holding-imports$/, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/automation/angellist/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        status: "ready",
        interval: "weekly",
        runStatus: null,
        lastSeenAt: "2026-08-20T16:00:00.000Z",
        lastCompletedAt: "2026-08-20T16:00:00.000Z",
        nextRunAt: "2026-08-27T16:00:00.000Z",
        latestImportId: null,
        errorCode: null,
      },
    });
  });
  await page.route("**/api/holding-imports/tokenfolio", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ json: tokenfolioImportPreview, status: 201 });
  });

  await page.goto("/holdings");
  await page.getByRole("button", { name: "Import holdings" }).click();
  await expect(
    page.getByRole("heading", { name: "Import holdings" }),
  ).toBeFocused();

  const source = page.getByLabel("Source");
  await source.selectOption("sydecar");
  await expect(
    page.getByRole("link", { name: "Download Sydecar template" }),
  ).toHaveAttribute("href", "/api/holding-import-templates/sydecar");
  await source.selectOption("tokenfolio");
  await expect(
    page.getByRole("link", { name: "Download Tokenfolio template" }),
  ).toHaveAttribute("href", "/api/holding-import-templates/tokenfolio");
  await expect(
    page.getByText(/Enter funded capital as Invested/),
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
    "holdings-import-tokenfolio-template.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page.getByLabel("Tokenfolio template").setInputFiles({
    name: "tokenfolio-holdings.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Keel Tokenfolio holdings template v1\nInvestment,Legal Position,Position Type,Held Through,Status,Investment Date,As Of Date,Invested USD,Committed USD,Current Value USD,Realized Value USD,Instrument\nSynthetic Robotics,Synthetic Robotics direct shares,Direct,Synthetic Family Trust,Live,2025-02-01,2026-08-20,$1250.00,,$1800.25,,Common stock\n",
    ),
  });
  await page.getByRole("button", { name: "Review file" }).click();

  await expect(
    page.getByRole("heading", { name: "Review Tokenfolio import" }),
  ).toBeFocused();
  const summary = page.getByLabel("Import summary");
  await expect(summary).toContainText("2Positions");
  await expect(summary).toContainText("1Current values");
  await expect(summary).toContainText("1Unavailable values");
  await expect(page.getByText("Not reported")).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "I confirm the template’s $ values are USD.",
    }),
  ).toBeVisible();
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holdings-import-tokenfolio-review.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
});

test("uses one setup command interface for every local portfolio agent", async ({
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

  await page.goto("/holdings");
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

test("reviews a scheduled AngelList export from a persistent phone-safe route", async ({
  page,
}) => {
  const applyBodies: unknown[] = [];
  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
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
  await page.route(/\/api\/holding-imports$/, async (route) => {
    await route.fulfill({
      json: [
        {
          id: importPreview.id,
          provider: "angellist",
          status: "pending_review",
          observedAt: importPreview.observedAt,
          rowCount: importPreview.summary.rowCount,
          createdAt: "2026-06-14T12:05:00.000Z",
        },
      ],
    });
  });
  await page.route(
    /\/api\/holding-imports\/holding_import_synthetic_angellist$/,
    async (route) => {
      await route.fulfill({ json: importPreview });
    },
  );
  await page.route(
    /\/api\/holding-imports\/holding_import_synthetic_angellist\/apply$/,
    async (route) => {
      applyBodies.push(route.request().postDataJSON());
      if (applyBodies.length === 1) {
        await route.fulfill({
          json: { error: "The reviewed import could not be applied." },
          status: 409,
        });
        return;
      }
      await route.fulfill({
        json: {
          importId: importPreview.id,
          createdCount: 69,
          updatedCount: 1,
          unchangedCount: 1,
          rejectedCount: 1,
          lockedValueCount: 22,
        },
      });
    },
  );

  await page.goto("/holdings");

  await expect(
    page.getByText("Nothing changes until you review it."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A holding update is ready" }),
  ).toBeVisible();

  await page.addStyleTag({
    content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
  });
  await expect(page.locator(".screen-stack")).toHaveScreenshot(
    "holdings-import-pending.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page
    .getByRole("button", { name: /Review AngelList import dated/ })
    .click();
  await expect(page).toHaveURL(
    /\/holdings\/imports\/holding_import_synthetic_angellist$/,
  );
  await expect(
    page.getByRole("heading", { name: "Review AngelList import" }),
  ).toBeVisible();

  await page.reload();

  const summary = page.getByLabel("Import summary");
  await expect(summary).toContainText("72Positions");
  await expect(summary).toContainText("50Administrator values");
  await expect(summary).toContainText("22Locked values");
  await expect(page.getByText("Locked by AngelList").first()).toBeVisible();
  await expect(
    page.getByText("Keel will not treat them as zero."),
  ).toBeVisible();

  const applyButton = page.getByRole("button", { name: "Apply 71 positions" });
  await expect(applyButton).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I confirm the export’s $ values are USD.",
    })
    .check();
  await expect(applyButton).toBeEnabled();
  await applyButton.click();

  await expect(
    page.getByRole("heading", { name: "Apply the reviewed import?" }),
  ).toBeFocused();
  await expect(page.getByText(/No forecast, underwriting value/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm & apply" }),
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
    "holdings-import-review.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page.getByRole("button", { name: "Confirm & apply" }).click();
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByRole("alert")).toContainText(
    "Nothing changed. Try again.",
  );
  await expect(
    page.getByRole("heading", { name: "Review AngelList import" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Confirm & apply" }).click();
  await expect(
    page.getByRole("heading", { name: "70 changes applied" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Reviewed 72 AngelList positions.",
  );

  expect(applyBodies).toHaveLength(2);
  expect(applyBodies[1]).toMatchObject({
    currency: "USD",
    decisions: expect.arrayContaining([
      expect.objectContaining({
        rowId: "import_row_3",
        decision: "accepted",
      }),
      expect.objectContaining({
        rowId: "import_row_4",
        decision: "rejected",
      }),
    ]),
  });
  expect((applyBodies[1] as { decisions: unknown[] }).decisions).toHaveLength(
    72,
  );
});

test("connects Robinhood through Investments and isolates exceptions", async ({
  page,
}) => {
  const exchangeBodies: unknown[] = [];
  await page.unroute("**/api/investment-connections");
  await page.unroute("**/api/investment-holdings");
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

  await page.goto("/holdings");
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

  await page.goto("/holdings");
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

  await page.goto("/holdings");
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

test("requests a Mac AngelList update from the phone-safe Holdings flow", async ({
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

  await page.goto("/holdings");
  await expect(
    page.getByRole("heading", { name: "AngelList is working" }),
  ).toBeVisible();
  const intervalSelect = page
    .locator(".angellist-agent")
    .getByRole("combobox", { name: "Automatic updates" });
  await expect(intervalSelect).toHaveText("Weekly");
  await expect(
    page.getByText("New exports follow your schedule and wait for review."),
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
    page.getByText("AngelList update queued for your Mac’s next daily check."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Update queued" }),
  ).toBeDisabled();
});

test("shows clear health and repair actions for local portfolio agents", async ({
  page,
}) => {
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
        errorCode: "keel_sign_in_required",
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
                status: "ready",
                interval: "daily",
                runStatus: null,
                lastSeenAt: "2026-08-21T12:00:00.000Z",
                lastCompletedAt: "2026-08-21T12:00:00.000Z",
                nextRunAt: "2026-08-22T12:00:00.000Z",
                latestImportId: "import_synthetic_tokenfolio",
                errorCode: null,
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

  await page.goto("/holdings");
  await expect(
    page.getByRole("heading", {
      name: "AngelList is paused — Mac access needs renewal",
    }),
  ).toBeVisible();
  await expect(
    page.locator(".provider-agent-row").filter({ hasText: "Tokenfolio" }),
  ).toContainText("Working");
  await expect(
    page.locator(".provider-agent-row").filter({ hasText: "Sydecar" }),
  ).toContainText("Paused — totals did not reconcile");
  await expect(
    page.getByRole("button", { name: "Copy repair command" }),
  ).toHaveCount(2);
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

  await page.goto("/holdings");

  await expect(page.getByRole("alert")).toHaveText(
    "Keel could not check AngelList updates. Try again shortly.",
  );
  await expect(page.locator("body")).not.toContainText("invalid_value");
  await expect(page.locator("body")).not.toContainText("unrecognized_keys");
});
