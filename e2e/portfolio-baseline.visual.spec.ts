import {
  adjustOverlappingCash,
  reviewUpdatedCash,
} from "./portfolio-baseline-parity";
import {
  cashException,
  removedException,
  readyState,
  confirmationResult,
  automaticReadyState,
  automaticConfirmationResult,
} from "./portfolio-baseline-fixtures";
import { expect, test, type Page } from "@playwright/test";

import { routeHoldingsPage } from "./holdings-page-fixtures";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/investment-holdings", async (route) => {
    await route.fulfill({ json: emptyInvestmentHoldingsView });
  });
  await page.route("**/api/investment-connections/auto-sync", async (route) => {
    await route.fulfill({ json: investmentConnectionsState });
  });
});

const investmentConnectionsState = {
  version: 1,
  configured: true,
  connections: [
    {
      version: 1,
      connectionId: "11111111-1111-4111-8111-111111111111",
      institutionKey: "ins_robinhood",
      institutionLabel: "Robinhood",
      status: "ready",
      lastSyncedAt: "2026-08-13T16:00:00.000Z",
      automaticUpdatesEnabled: true,
      latestImportId: null,
      latestRunStatus: "succeeded",
      errorCode: null,
      latestAdjudication: null,
    },
  ],
  errorCode: null,
};

const scalePositions = Array.from({ length: 120 }, (_, index) => ({
  id: `holding_scale_${index.toString().padStart(3, "0")}`,
  positionName: `Synthetic Scale Holding ${index.toString().padStart(3, "0")}`,
  ownerLabel: "Synthetic brokerage",
  sourceLabel: "Plaid Investments",
  provider: "plaid_investments" as const,
  classification: "public_market" as const,
  valueMinor: 100_000 + index,
  valueState: "reported" as const,
  observedAt: "2026-08-18T16:00:00.000Z",
  ticker: `S${index.toString().padStart(3, "0")}`,
  isCashPosition: false,
  potentialDuplicate: false,
  duplicateWith: [],
}));

const scaleReadyState = {
  ...automaticReadyState,
  requiresDuplicateReview: true,
  sourceRevision: "c".repeat(64),
  observedAt: "2026-08-18T16:00:00.000Z",
  summary: {
    ...automaticReadyState.summary,
    positionCount: 120,
    publicMarketValueMinor: 12_007_140,
  },
  positions: scalePositions,
  suggestedOtherFiEligibleLiquidMinor: 0,
  latestBaseline: {
    ...automaticReadyState.latestBaseline,
    summary: {
      ...automaticReadyState.latestBaseline.summary,
      positionCount: 120,
      publicMarketValueMinor: 10_807_140,
    },
    fiEligibleLiquidMinor: 10_807_140,
    otherFiEligibleLiquidMinor: 0,
  },
  changes: {
    positions: scalePositions.map((current, index) => ({
      changeType: "updated" as const,
      current,
      previous: {
        valueMinor: 90_000 + index,
        valueState: "reported" as const,
        observedAt: "2026-08-17T16:00:00.000Z",
      },
    })),
    cashAccounts: [],
  },
} as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

test(
  "sets the initial FI baseline while checking only manual cash",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const alphaResponse = await page.request.get("/api/alpha");
    expect(alphaResponse.ok()).toBe(true);
    const alphaFixture = await alphaResponse.json();
    let baselineReads = 0;
    let baselineState: Record<string, unknown> = readyState;
    let confirmationBody: Record<string, unknown> | null = null;

    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });
    await routeHoldingsPage(page, {
      householdName: alphaFixture.dashboard.householdName,
      holdings: alphaFixture.holdings,
      investmentHoldings: emptyInvestmentHoldingsView,
      acceptedCashAccounts: [],
      pendingImports: [],
    });
    await page.route("**/api/portfolio-baseline", async (route) => {
      baselineReads++;
      if (baselineReads === 1) {
        await route.fulfill({
          status: 503,
          json: { error: "The planning baseline is temporarily unavailable." },
        });
        return;
      }
      await route.fulfill({ json: baselineState });
    });
    await page.route("**/api/portfolio-baselines", async (route) => {
      confirmationBody = (await route.request().postDataJSON()) as Record<
        string,
        unknown
      >;
      baselineState = {
        ...readyState,
        status: "current",
        baseForecastSnapshotId: "snap_fi_v4",
        baseForecastSnapshotVersion: 4,
        planning: {
          ...readyState.planning,
          currentFiEligibleLiquidMinor: 38_768_055,
        },
        suggestedOtherFiEligibleLiquidMinor: 5_000_000,
        currentImpact: confirmationResult.impact,
        latestBaseline: confirmationResult.baseline,
        hasSourceChanges: false,
        hasCashAccountChanges: false,
        changes: { positions: [], cashAccounts: [] },
        canConfirm: false,
      };
      await route.fulfill({ json: confirmationResult, status: 201 });
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
          lastCompletedAt: "2026-08-13T15:58:00.000Z",
          nextRunAt: "2026-08-20T16:00:00.000Z",
          latestImportId: null,
          errorCode: null,
        },
      });
    });
    await page.route("**/api/investment-connections", async (route) => {
      await route.fulfill({ json: investmentConnectionsState });
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

    await page.goto("/holdings");
    const unavailable = page.locator(".portfolio-baseline--error");
    await expect(
      unavailable.getByRole("heading", {
        name: "Planning baseline unavailable",
      }),
    ).toBeVisible();
    await expect(unavailable).toContainText(
      "The planning baseline is temporarily unavailable.",
    );
    await expectNoHorizontalOverflow(page);
    await unavailable.getByRole("button", { name: "Try again" }).click();
    await expect(unavailable).toHaveCount(0);
    const summary = page.locator(".portfolio-baseline");
    await expect(
      page.getByRole("heading", {
        name: "Set the FI planning baseline",
      }),
    ).toBeVisible();
    expect(baselineReads).toBe(2);
    await expect(summary).not.toContainText("reviewed positions");
    const baselineLayout = await summary.evaluate((element) => {
      const button = element.querySelector<HTMLButtonElement>(".button");
      if (button === null) throw new Error("Missing baseline action");
      const sectionBounds = element.getBoundingClientRect();
      const buttonBounds = button.getBoundingClientRect();
      return {
        buttonWidth: buttonBounds.width,
        rightGap: sectionBounds.right - buttonBounds.right,
      };
    });
    expect(baselineLayout.buttonWidth).toBeLessThan(180);
    expect(baselineLayout.rightGap).toBeCloseTo(0, 0);
    // Retry occupies the same area as Set baseline. Capture its resting state.
    await page.mouse.move(0, 0);
    await expect(summary).toHaveScreenshot("portfolio-baseline-ready.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    });

    await page.getByRole("button", { name: "Set baseline" }).click();
    await expect(
      page.getByRole("textbox", { name: /^Cash held elsewhere/u }),
    ).toHaveValue("50,000.00");
    await expect(
      page.getByLabel("Proposed FI-eligible liquid calculation"),
    ).toContainText("$387,680.55");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByLabel("What changed")).toHaveValue(
      /5 (?:reviewed )?sources|3 holdings changed/u,
    );
    await expect(
      page.getByLabel("Baseline source changes").locator("article"),
    ).toHaveCount(5);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Set baseline" }).click();
    await expect(page.locator(".portfolio-baseline-review")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Planning baseline is current" }),
    ).toHaveCount(0);
    await expect(page.locator(".portfolio-baseline")).toHaveCount(0);
    expect(confirmationBody).toMatchObject({
      sourceRevision: readyState.sourceRevision,
      baseForecastSnapshotId: "snap_fi_v3",
      baseForecastSnapshotVersion: 3,
      otherFiEligibleLiquidMinor: 5_000_000,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: true,
    });
  },
);

test(
  "keeps a possible overlap behind an explicit baseline decision",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const alphaResponse = await page.request.get("/api/alpha");
    expect(alphaResponse.ok()).toBe(true);
    const alphaFixture = await alphaResponse.json();
    let baselineState: Record<string, unknown> = {
      ...automaticReadyState,
      requiresDuplicateReview: true,
    };
    const confirmationBodies: unknown[] = [];

    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });
    await routeHoldingsPage(page, {
      householdName: alphaFixture.dashboard.householdName,
      holdings: alphaFixture.holdings,
      investmentHoldings: emptyInvestmentHoldingsView,
      acceptedCashAccounts: [],
      pendingImports: [],
    });
    await page.route("**/api/portfolio-baseline", async (route) => {
      await route.fulfill({ json: baselineState });
    });
    await page.route("**/api/portfolio-baselines", async (route) => {
      expect(route.request().method()).toBe("POST");
      confirmationBodies.push(route.request().postDataJSON());
      baselineState = {
        ...automaticReadyState,
        status: "current",
        baseForecastSnapshotId: "snap_fi_v4",
        baseForecastSnapshotVersion: 4,
        planning: {
          ...automaticReadyState.planning,
          currentFiEligibleLiquidMinor: 26_300_000,
        },
        currentImpact: automaticConfirmationResult.impact,
        latestBaseline: automaticConfirmationResult.baseline,
        hasSourceChanges: false,
        hasCashAccountChanges: false,
        changes: { positions: [], cashAccounts: [] },
        canConfirm: false,
      };
      await route.fulfill({ json: automaticConfirmationResult, status: 201 });
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
          lastCompletedAt: "2026-08-13T15:58:00.000Z",
          nextRunAt: "2026-08-20T16:00:00.000Z",
          latestImportId: null,
          errorCode: null,
        },
      });
    });
    await page.route("**/api/investment-connections", async (route) => {
      await route.fulfill({ json: investmentConnectionsState });
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

    await page.clock.install();
    await page.goto("/holdings");
    await expect(
      page.getByRole("heading", { name: "1 baseline change is ready" }),
    ).toBeVisible();
    await page.clock.fastForward(60_000);
    await expect(
      page.getByRole("button", { name: "Review changes" }),
    ).toBeVisible();
    expect(confirmationBodies).toHaveLength(0);
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(
      page.getByRole("heading", { name: "Review 1 baseline change" }),
    ).toBeFocused();
    await expect(page.getByLabel("What changed")).toHaveValue(
      "Synthetic Public Company: $228,000.00 → $238,000.00; FI-eligible liquid: $1,825,000.00 → $263,000.00",
    );
    const review = page.locator(".portfolio-baseline-review");
    await page.addStyleTag({
      content:
        ".topbar { position: absolute !important; visibility: hidden !important; }",
    });
    await review.evaluate((element) =>
      element.scrollIntoView({ block: "start", behavior: "auto" }),
    );
    await expect(review).toHaveScreenshot("portfolio-baseline-review.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    });
    const apply = page.getByRole("button", { name: "Apply changes" });
    await apply.focus();
    await expectNoHorizontalOverflow(page);
    await page.clock.fastForward(60_000);
    expect(confirmationBodies).toHaveLength(0);
    await apply.click();
    await expect(review).toHaveCount(0);
    expect(confirmationBodies).toHaveLength(1);
    expect(confirmationBodies[0]).toMatchObject({
      sourceRevision: automaticReadyState.sourceRevision,
      baseForecastSnapshotId: "snap_fi_v3",
      baseForecastSnapshotVersion: 3,
      otherFiEligibleLiquidMinor: 2_500_000,
      duplicateReviewConfirmed: true,
      cashOverlapReviewConfirmed: false,
      changeNote:
        "Synthetic Public Company: $228,000.00 → $238,000.00; FI-eligible liquid: $1,825,000.00 → $263,000.00",
    });
  },
);

test(
  "keeps a 120-source baseline review DOM bounded",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const alphaResponse = await page.request.get("/api/alpha");
    expect(alphaResponse.ok()).toBe(true);
    const alphaFixture = await alphaResponse.json();

    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });
    await routeHoldingsPage(page, {
      householdName: alphaFixture.dashboard.householdName,
      holdings: alphaFixture.holdings,
      investmentHoldings: emptyInvestmentHoldingsView,
      acceptedCashAccounts: [],
      pendingImports: [],
    });
    await page.route("**/api/portfolio-baseline", async (route) => {
      await route.fulfill({
        json: {
          ...scaleReadyState,
          automaticUpdateCount: 0,
          exceptions: scalePositions.map((position) => ({
            key: `position:${position.id}`,
            kind: "position",
            name: position.positionName,
            context: position.ownerLabel,
            reason: "removed",
            previousValueMinor: position.valueMinor,
            proposedValueMinor: null,
            previousObservedAt: position.observedAt,
            fiEligibleChangeMinor: -position.valueMinor,
          })),
        },
      });
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
          lastSeenAt: "2026-08-18T16:00:00.000Z",
          lastCompletedAt: "2026-08-18T15:58:00.000Z",
          nextRunAt: "2026-08-25T16:00:00.000Z",
          latestImportId: null,
          errorCode: null,
        },
      });
    });
    await page.route("**/api/investment-connections", async (route) => {
      await route.fulfill({ json: investmentConnectionsState });
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

    await page.goto("/holdings");
    await expect(
      page.getByRole("heading", { name: "120 sources need your decision" }),
    ).toBeVisible();
    const rows = page.locator(".portfolio-baseline-review article");
    await expect(rows).toHaveCount(12);
    await page.getByRole("button", { name: "Show more" }).click();
    await expect(rows).toHaveCount(24);
    await expectNoHorizontalOverflow(page);
  },
);

test(
  "automatically refreshes routine private changes without a baseline review",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const alphaResponse = await page.request.get("/api/alpha");
    const alphaFixture = {
      ...(await alphaResponse.json()),
      holdings: [],
    };
    const source = {
      ...automaticReadyState,
      changes: {
        positions: [
          {
            changeType: "updated",
            current: automaticReadyState.positions[1],
            previous: {
              valueMinor: 120_000,
              valueState: "reported",
              observedAt: "2026-08-08T16:00:00.000Z",
            },
          },
        ],
        cashAccounts: [],
      },
    };
    const current = {
      ...source,
      status: "current",
      canConfirm: false,
      hasSourceChanges: false,
      changes: { positions: [], cashAccounts: [] },
    };
    let refreshCount = 0;
    let confirmationCount = 0;
    await routeHoldingsPage(page, {
      householdName: alphaFixture.dashboard.householdName,
      holdings: alphaFixture.holdings,
      investmentHoldings: emptyInvestmentHoldingsView,
      acceptedCashAccounts: [],
      pendingImports: [],
    });
    await page.route("**/api/alpha", (route) =>
      route.fulfill({ json: alphaFixture }),
    );
    await page.route("**/api/portfolio-baseline", (route) =>
      route.fulfill({ json: source }),
    );
    await page.route("**/api/portfolio-baselines", (route) => {
      confirmationCount += 1;
      return route.fulfill({ status: 500 });
    });
    let releaseRefresh!: () => void;
    const refreshResponse = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    await page.route("**/api/portfolio-baseline/refresh", async (route) => {
      expect(route.request().method()).toBe("POST");
      refreshCount += 1;
      await refreshResponse;
      await route.fulfill({ json: current });
    });
    const updating = page
      .getByRole("status")
      .filter({ hasText: "Updating planning values…" });
    try {
      await page.goto("/holdings");
      await expect.poll(() => refreshCount).toBe(1);
      await expect(updating).toBeVisible();
    } finally {
      releaseRefresh();
    }
    await expect(updating).toHaveCount(0);
    await expect(
      page.locator(".portfolio-baseline, .portfolio-baseline-review"),
    ).toHaveCount(0);
    expect(refreshCount).toBe(1);
    expect(confirmationCount).toBe(0);
    await expectNoHorizontalOverflow(page);
    await expect(page.locator("main")).toHaveScreenshot(
      "portfolio-baseline-automatic.png",
      { animations: "disabled", maxDiffPixelRatio: 0.025 },
    );
  },
);

test(
  "updates routine sources and reviews only one exception at a time",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const alphaFixture = await (await page.request.get("/api/alpha")).json();
    let baselineState = {
      ...automaticReadyState,
      exceptions: [cashException, removedException],
      automaticUpdateCount: 1,
      planning: {
        ...automaticReadyState.planning,
        currentFiEligibleLiquidMinor: 26_300_000,
      },
    } as Record<string, unknown>;
    let refreshCount = 0;
    let failNext = true;
    const decisions: Record<string, unknown>[] = [];
    await routeHoldingsPage(page, {
      householdName: alphaFixture.dashboard.householdName,
      holdings: alphaFixture.holdings,
      investmentHoldings: emptyInvestmentHoldingsView,
      acceptedCashAccounts: [],
      pendingImports: [],
    });
    await page.route("**/api/alpha", (route) =>
      route.fulfill({ json: alphaFixture }),
    );
    await page.route("**/api/portfolio-baseline", (route) =>
      route.fulfill({ json: baselineState }),
    );
    await page.route("**/api/portfolio-baseline/refresh", (route) => {
      refreshCount++;
      baselineState = {
        ...baselineState,
        automaticUpdateCount: 0,
        changes: { positions: [], cashAccounts: [] },
        latestBaseline: {
          ...automaticReadyState.latestBaseline,
          id: "synthetic-partial-baseline",
        },
      };
      return route.fulfill({ json: baselineState });
    });
    await page.route("**/api/portfolio-baselines", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (failNext) {
        failNext = false;
        baselineState = {
          ...baselineState,
          sourceRevision: "e".repeat(64),
          baseForecastSnapshotVersion: 6,
          baseForecastSnapshotId: "synthetic-forecast-6",
          planning: {
            ...automaticReadyState.planning,
            currentFiEligibleLiquidMinor: 26_400_000,
          },
        };
      }
      if (body.sourceRevision !== baselineState.sourceRevision) {
        await route.fulfill({
          status: 409,
          json: {
            error:
              "The portfolio or forecast changed. Review the latest baseline before confirming.",
          },
        });
        return;
      }
      decisions.push(body);
      const remaining = (
        baselineState.exceptions as (typeof cashException)[]
      ).filter(
        (item) => !(body.reviewedExceptionKeys as string[]).includes(item.key),
      );
      baselineState = {
        ...baselineState,
        exceptions: remaining,
        status: remaining.length === 0 ? "current" : "ready",
        baseForecastSnapshotVersion: 5 + decisions.length,
        suggestedOtherFiEligibleLiquidMinor: body.otherFiEligibleLiquidMinor,
        latestBaseline: {
          ...automaticConfirmationResult.baseline,
          id: `synthetic-reviewed-${decisions.length}`,
        },
      };
      await route.fulfill({ status: 201, json: automaticConfirmationResult });
    });
    await page.goto("/holdings");
    await expect(
      page.getByRole("heading", { name: "2 sources need your decision" }),
    ).toBeVisible({ timeout: 15_000 });
    expect(refreshCount).toBe(1);
    await expect(
      page.getByText("Synthetic Public Company", { exact: true }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expect(page.locator(".portfolio-baseline-review")).toHaveScreenshot(
      "portfolio-baseline-exceptions.png",
      { animations: "disabled" },
    );
    await adjustOverlappingCash(page);
    await expectNoHorizontalOverflow(page);
    await expect(page.locator(".portfolio-baseline-review")).toHaveScreenshot(
      "portfolio-baseline-exception-decision.png",
      { animations: "disabled" },
    );
    await page
      .getByRole("button", { name: "Include cash with this amount" })
      .click();
    await expect(
      page.getByText(
        "The portfolio or forecast changed. Review the latest baseline before confirming.",
      ),
    ).toBeVisible();
    await expect(
      page.getByLabel("Cash held elsewhere", { exact: true }),
    ).toHaveValue("20,000.00");
    await reviewUpdatedCash(page);
    await page
      .getByRole("button", { name: "Include cash with this amount" })
      .click();
    await expect(
      page.getByRole("heading", { name: "1 source needs your decision" }),
    ).toBeVisible();
    expect(decisions[0]).toMatchObject({
      sourceRevision: "e".repeat(64),
      baseForecastSnapshotVersion: 6,
      reviewedExceptionKeys: [cashException.key],
      otherFiEligibleLiquidMinor: 2_000_000,
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "1 source needs your decision" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review Synthetic missing holding" })
      .click();
    await expect(page.getByText("$1,000.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Decide later" }).click();
    expect(decisions).toHaveLength(1);
    await page
      .getByRole("button", { name: "Review Synthetic missing holding" })
      .click();
    await page.getByRole("button", { name: "Remove from plan" }).click();
    await expect(page.locator(".portfolio-baseline-review")).toHaveCount(0);
    expect(decisions[1]).toMatchObject({
      reviewedExceptionKeys: [removedException.key],
    });
    expect(refreshCount).toBe(1);
  },
);
