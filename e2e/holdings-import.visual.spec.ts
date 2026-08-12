import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public-holdings/robinhood/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: false,
        status: "setup_required",
        lastSyncedAt: null,
        latestImportId: null,
        latestRunStatus: null,
        errorCode: "configuration_required",
      },
    });
  });
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

const robinhoodImportPreview = {
  id: "holding_import_synthetic_robinhood",
  provider: "robinhood",
  status: "pending_review",
  observedAt: "2026-08-10T16:00:00.000Z",
  summary: {
    rowCount: 3,
    administratorValueCount: 2,
    lockedValueCount: 0,
    createCount: 2,
    updateCount: 0,
    unchangedCount: 0,
    needsAttentionCount: 1,
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
      issues: ["Cost basis is not available for this position."],
    },
  ],
};

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

test("connects Robinhood and stages a review without inferring sales", async ({
  page,
}) => {
  const exchangeBodies: unknown[] = [];
  await page.unroute("**/api/public-holdings/robinhood/status");
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
  await page.route("**/api/public-holdings/robinhood/status", async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        configured: true,
        status: "disconnected",
        lastSyncedAt: null,
        latestImportId: null,
        latestRunStatus: null,
        errorCode: null,
      },
    });
  });
  await page.route(
    "**/api/public-holdings/robinhood/link-token",
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
    "**/api/public-holdings/robinhood/exchange",
    async (route) => {
      exchangeBodies.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          version: 1,
          configured: true,
          status: "ready",
          lastSyncedAt: "2026-08-10T16:00:00.000Z",
          latestImportId: robinhoodImportPreview.id,
          latestRunStatus: "succeeded",
          errorCode: null,
        },
      });
    },
  );
  await page.route(
    /\/api\/holding-imports\/holding_import_synthetic_robinhood$/,
    async (route) => {
      await route.fulfill({ json: robinhoodImportPreview });
    },
  );

  await page.goto("/holdings");
  await expect(
    page.getByRole("heading", { name: "Connect Robinhood" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connect Robinhood" }).click();

  await expect(page).toHaveURL(
    /\/holdings\/imports\/holding_import_synthetic_robinhood$/,
  );
  await expect(
    page.getByRole("heading", { name: "Review Robinhood import" }),
  ).toBeFocused();
  await expect(
    page.getByText(
      "Positions missing from this snapshot are not treated as sales.",
    ),
  ).toBeVisible();
  const summary = page.getByLabel("Import summary");
  await expect(summary).toContainText("3Positions");
  await expect(summary).toContainText("2Market values");
  await expect(summary).toContainText("1Need attention");
  await expect(page.getByText("12.345678")).toBeVisible();
  await expect(page.getByText("Cost basis is not available")).toBeVisible();

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
    "holdings-robinhood-review.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  await page
    .getByRole("checkbox", {
      name: "I confirm the Robinhood $ values are USD.",
    })
    .check();
  await page.getByRole("button", { name: "Apply 2 positions" }).click();
  await expect(
    page.getByText("Missing positions will not be recorded as sales."),
  ).toBeVisible();
  expect(exchangeBodies).toEqual([{ publicToken: "public-synthetic" }]);
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
    page.getByRole("heading", { name: "AngelList updates are ready" }),
  ).toBeVisible();
  await expect(page.getByLabel("Automatic updates")).toHaveValue("weekly");
  await expect(
    page.getByText(
      "Your Mac checks daily. Exports follow the interval below. Every CSV still waits for your review.",
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

  await page.getByLabel("Automatic updates").selectOption("daily");
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
