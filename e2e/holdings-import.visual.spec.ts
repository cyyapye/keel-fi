import { expect, test } from "@playwright/test";

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
        status: "up_to_date",
        checkedAt: "2026-08-03T16:00:00.000Z",
        importId: null,
        errorCode: null,
        signInStatus: "connected",
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
    page.getByRole("heading", { name: "A new export is ready" }),
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

test("refreshes AngelList sign-in from a phone-safe Holdings flow", async ({
  page,
}) => {
  const refreshId = "11111111-1111-4111-8111-111111111111";
  const expiresAt = "2026-08-08T16:10:00.000Z";
  const submittedHandoffInputs: unknown[] = [];
  const submittedMagicLinks: unknown[] = [];
  let connected = false;

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
        status: connected ? "up_to_date" : "auth_required",
        checkedAt: "2026-08-08T16:00:00.000Z",
        importId: null,
        errorCode: connected ? null : "auth_required",
        signInStatus: connected ? "connected" : "needs_sign_in",
      },
    });
  });
  await page.route(
    /\/api\/automation\/angellist\/sign-in-refreshes(?:\/.*)?$/,
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/handoff-input")) {
        submittedHandoffInputs.push(request.postDataJSON());
        await route.fulfill({
          json: {
            version: 1,
            id: refreshId,
            status: "waiting_for_sign_in",
            expiresAt,
            liveViewUrl: null,
            liveViewExpiresAt: null,
          },
        });
        return;
      }
      if (path.endsWith("/magic-link")) {
        submittedMagicLinks.push(request.postDataJSON());
        connected = true;
        await route.fulfill({
          json: {
            version: 1,
            id: refreshId,
            status: "connected",
            expiresAt,
            liveViewUrl: null,
            liveViewExpiresAt: null,
          },
        });
        return;
      }
      if (request.method() === "POST") {
        await route.fulfill({
          json: {
            version: 1,
            id: refreshId,
            status: "waiting_for_sign_in",
            expiresAt,
            liveViewUrl: "https://live.browser.run/?token=synthetic-live-view",
            liveViewExpiresAt: "2099-08-08T16:05:00.000Z",
          },
          status: 201,
        });
        return;
      }
      await route.fulfill({
        json: {
          version: 1,
          id: refreshId,
          status: connected ? "connected" : "waiting_for_sign_in",
          expiresAt,
          liveViewUrl: null,
          liveViewExpiresAt: null,
        },
      });
    },
  );

  await page.goto("/holdings");
  await expect(
    page.getByRole("heading", { name: "AngelList sign-in needs attention" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start sign-in" }).click();

  await expect(
    page.getByRole("heading", { name: "Finish signing in to AngelList" }),
  ).toBeVisible();
  const liveViewLink = page.getByRole("link", {
    name: "Open AngelList sign-in",
  });
  await expect(liveViewLink).toHaveAttribute(
    "href",
    "https://live.browser.run/?token=synthetic-live-view",
  );
  await expect(liveViewLink).toHaveAttribute("target", "_blank");

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
    "holdings-angellist-sign-in-refresh.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  const handoffInput = page.getByLabel("Email or one-time code");
  await handoffInput.fill("operator@example.com");
  await page.getByRole("button", { name: "Type in AngelList" }).click();
  await expect(
    page.getByText("Text sent. Return to AngelList and tap Continue."),
  ).toBeVisible();
  expect(submittedHandoffInputs).toEqual([{ text: "operator@example.com" }]);
  await expect(handoffInput).toHaveValue("");

  const magicLink =
    "https://venture.angellist.com/users/sign_in?token=synthetic";
  await page.getByLabel("Magic link from email").fill(magicLink);
  await page.getByRole("button", { name: "Open magic link" }).click();

  await expect(
    page.getByRole("heading", { name: "AngelList sign-in refreshed" }),
  ).toBeVisible();
  await expect(
    page.getByText("New exports will still wait for your review."),
  ).toBeVisible();
  expect(submittedMagicLinks).toEqual([{ magicLink }]);
  await expect(page.getByLabel("Magic link from email")).toHaveCount(0);
});
