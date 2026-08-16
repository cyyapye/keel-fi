import { expect, test, type Page } from "@playwright/test";

const sourceRevision = "a".repeat(64);
const evaluatedAt = "2026-08-16T12:00:00.000Z";

const baseItem = {
  severity: "decision",
  observedAt: "2026-08-15T12:00:00.000Z",
  thresholdMinor: 5_000_000,
  plannedMonths: null,
  actualMonths: null,
  sourceRevision,
  cooldownUntil: null,
} as const;

const cashItem = {
  ...baseItem,
  key: "cash_drift",
  metric: "cash",
  title: "Reviewed cash moved beyond the plan guardrail",
  reason:
    "Reviewed cash differs from the accepted portfolio baseline by at least the larger of 5% or $5,000.",
  nextAction: "Reconcile cash and baseline",
  route: "holdings",
  plannedValueMinor: 80_000_000,
  actualValueMinor: 68_000_000,
  differenceMinor: -12_000_000,
} as const;

const actionItems = [
  cashItem,
  {
    ...baseItem,
    key: "debt_drift",
    metric: "debt",
    title: "Reviewed debt changed materially",
    reason:
      "Accepted debt changed by at least the larger of 5% or $5,000 since its prior reviewed state.",
    nextAction: "Review debt impact",
    route: "obligations",
    plannedValueMinor: 24_000_000,
    actualValueMinor: 31_000_000,
    differenceMinor: 7_000_000,
  },
  {
    ...baseItem,
    key: "burn_drift",
    metric: "burn",
    title: "Reviewed burn differs from the saved plan",
    reason:
      "Reviewed monthly burn differs by at least the larger of 10% or $500. This is a comparison, not a plan change.",
    nextAction: "Review plan inputs",
    route: "scenarios",
    plannedValueMinor: 4_100_000,
    actualValueMinor: 4_900_000,
    differenceMinor: 800_000,
    thresholdMinor: 500_000,
  },
  {
    ...baseItem,
    key: "runway_drift",
    metric: "runway",
    title: "Current cash and burn changed protected runway",
    reason:
      "Reviewed actuals move protected runway by at least three whole months. No forecast was changed.",
    nextAction: "Review the runway decision",
    route: "scenarios",
    plannedValueMinor: null,
    actualValueMinor: null,
    differenceMinor: null,
    thresholdMinor: null,
    plannedMonths: 42,
    actualMonths: 32,
  },
] as const;

const monitoringBase = {
  version: 1,
  policyVersion: "plan-actual-v1",
  evaluatedAt,
  sourceRevision,
  planId: "cash_plan_fi_v1",
  coverage: {
    cash: "current",
    debt: "current",
    burn: "current",
    runway: "available",
  },
} as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

async function hideStickyTopbar(page: Page) {
  await page.addStyleTag({
    content:
      ".topbar { position: absolute !important; visibility: hidden !important; }",
  });
}

test("keeps material plan drift actionable without changing the plan", async ({
  page,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = await alphaResponse.json();
  let monitoringState: object = {
    ...monitoringBase,
    status: "needs_action",
    actionItems: [...actionItems],
    deferredItems: [],
  };

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.route("**/api/plan-actual-monitoring", async (route) => {
    await route.fulfill({ json: monitoringState });
  });
  await page.route("**/api/plan-actual-monitoring/snooze", async (route) => {
    const deferredCash = {
      ...cashItem,
      cooldownUntil: "2026-08-23T12:00:00.000Z",
    };
    monitoringState = {
      ...monitoringBase,
      status: "needs_action",
      actionItems: actionItems.slice(1),
      deferredItems: [deferredCash],
    };
    await route.fulfill({ status: 201, json: monitoringState });
  });

  await page.goto("/");
  await hideStickyTopbar(page);
  const monitoring = page.locator(".plan-monitoring");
  await expect(
    monitoring.getByRole("heading", { name: "4 decisions to review" }),
  ).toBeVisible();
  await expect(
    monitoring.getByText("Nothing here changes your saved plan or forecast."),
  ).toBeVisible();
  await expect(monitoring).toHaveScreenshot("plan-actual-actions.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  const targetSizes = await monitoring
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width };
      }),
    );
  expect(
    targetSizes.every(({ height, width }) => height >= 44 && width >= 44),
  ).toBe(true);
  await expectNoHorizontalOverflow(page);

  await monitoring
    .getByRole("button", { name: "Reconcile cash and baseline" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Holdings" }),
  ).toBeVisible();

  await page.goto("/");
  const restoredMonitoring = page.locator(".plan-monitoring");
  await restoredMonitoring
    .getByRole("button", { name: "Review in 7 days" })
    .first()
    .click();
  await expect(
    restoredMonitoring.getByRole("heading", { name: "3 decisions to review" }),
  ).toBeFocused();
  await expect(restoredMonitoring.getByRole("status")).toHaveText(
    "Moved to review later for 7 days.",
  );

  monitoringState = {
    ...monitoringBase,
    status: "clear",
    actionItems: [],
    deferredItems: [],
  };
  await page.reload();
  await hideStickyTopbar(page);
  await expect(
    page.getByRole("heading", {
      name: "Reviewed actuals are within the plan guardrails",
    }),
  ).toBeVisible();
  await expect(page.locator(".plan-monitoring")).toHaveScreenshot(
    "plan-actual-clear.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );

  monitoringState = {
    ...monitoringBase,
    status: "limited",
    coverage: {
      cash: "not_configured",
      debt: "current",
      burn: "not_configured",
      runway: "limited",
    },
    actionItems: [],
    deferredItems: [],
  };
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Monitoring is ready for connected actuals",
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
