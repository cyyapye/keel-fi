import { expect, test, type Page } from "@playwright/test";
import type { AlphaData } from "../packages/domain/src/index";

import { withStableOverviewValues } from "./overview-alpha-fixture";

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

async function waitForOverviewLayout(page: Page) {
  // The lazy portfolio section sits above monitoring. Its loaded metrics mark
  // the layout expansion that must finish before an element screenshot scrolls.
  await expect(page.locator(".portfolio-snapshot__metrics")).toBeVisible();
}

test("keeps material plan drift actionable without changing the plan", async ({
  page,
  isMobile,
}) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const alphaFixture = withStableOverviewValues(
    (await alphaResponse.json()) as AlphaData,
  );
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
  await waitForOverviewLayout(page);
  await hideStickyTopbar(page);
  const monitoring = page.locator(".plan-monitoring");
  const monitoringSummary = monitoring.getByRole("button", {
    name: /Monitoring needs attention/u,
  });
  await expect(monitoringSummary).toHaveAttribute("aria-expanded", "false");
  await expect(monitoringSummary).toContainText("4 decisions to review");
  await expect(monitoringSummary).toContainText("Needs attention");
  await expect(monitoringSummary).not.toHaveAttribute("data-panel-open", "");
  const summaryHierarchy = await monitoringSummary.evaluate((summary) => {
    const eyebrow = summary.querySelector(".eyebrow");
    const title = summary.querySelector(
      ".plan-monitoring__summary-text strong",
    );
    const detail = summary.querySelector(
      ".plan-monitoring__summary-text small",
    );
    if (eyebrow === null || title === null || detail === null) return null;
    const eyebrowBounds = eyebrow.getBoundingClientRect();
    const titleBounds = title.getBoundingClientRect();
    const detailBounds = detail.getBoundingClientRect();
    return {
      detailTop: detailBounds.top,
      eyebrowBottom: eyebrowBounds.bottom,
      eyebrowLeft: eyebrowBounds.left,
      titleBottom: titleBounds.bottom,
      titleLeft: titleBounds.left,
      titleTop: titleBounds.top,
    };
  });
  expect(summaryHierarchy).not.toBeNull();
  expect(
    Math.abs(summaryHierarchy!.eyebrowLeft - summaryHierarchy!.titleLeft),
  ).toBeLessThanOrEqual(1);
  expect(summaryHierarchy!.titleTop).toBeGreaterThanOrEqual(
    summaryHierarchy!.eyebrowBottom,
  );
  expect(summaryHierarchy!.detailTop).toBeGreaterThanOrEqual(
    summaryHierarchy!.titleBottom,
  );
  expect(
    await monitoringSummary.evaluate((summary) => {
      const status = summary.querySelector(".plan-monitoring__indicator");
      const indicator = summary.querySelector(".plan-monitoring__toggle-mark");
      if (status === null || indicator === null) {
        return Number.POSITIVE_INFINITY;
      }
      const statusBounds = status.getBoundingClientRect();
      const indicatorBounds = indicator.getBoundingClientRect();
      return Math.abs(
        statusBounds.top +
          statusBounds.height / 2 -
          (indicatorBounds.top + indicatorBounds.height / 2),
      );
    }),
  ).toBeLessThanOrEqual(1);
  await expect(monitoring.locator(".plan-monitoring__details")).toHaveCount(0);
  await expect(
    monitoring.getByRole("heading", { name: "4 decisions to review" }),
  ).toHaveCount(0);
  await expect(
    monitoring.getByText("Nothing here changes your saved plan or forecast."),
  ).toHaveCount(0);
  await expect(
    monitoring.getByRole("button", { name: "Reconcile cash and baseline" }),
  ).toHaveCount(0);
  expect(
    await monitoring.evaluate(
      (element) =>
        element.previousElementSibling?.querySelector("h2")?.textContent,
    ),
  ).toBe("What the saved plan says");
  await expect(monitoring).toHaveScreenshot("plan-actual-attention.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });

  await monitoringSummary.click();
  await expect(monitoringSummary).toHaveAttribute("aria-expanded", "true");
  await expect(monitoringSummary).toHaveAttribute("data-panel-open", "");
  const disclosureMotion = await monitoring
    .locator('[data-slot="collapsible-content"]')
    .evaluate((panel) => {
      const style = window.getComputedStyle(panel);
      return {
        duration: style.transitionDuration,
        property: style.transitionProperty,
      };
    });
  expect(disclosureMotion.property).toContain("height");
  expect(disclosureMotion.duration).not.toBe("0s");
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
  await waitForOverviewLayout(page);
  const restoredMonitoring = page.locator(".plan-monitoring");
  const restoredSummary = restoredMonitoring.getByRole("button", {
    name: /Monitoring needs attention/u,
  });
  await restoredSummary.click();
  await restoredMonitoring
    .getByRole("button", { name: "Review in 7 days" })
    .first()
    .click();
  await expect(restoredSummary).toBeFocused();
  await expect(restoredSummary).toContainText("3 decisions to review");
  await expect(restoredMonitoring.getByRole("status")).toHaveText(
    "Moved to review later for 7 days.",
  );

  if (!isMobile) {
    monitoringState = {
      ...monitoringBase,
      status: "clear",
      actionItems: [],
      deferredItems: [],
    };
    await page.reload();
    await waitForOverviewLayout(page);
    await hideStickyTopbar(page);
    const clearMonitoring = page.locator(".plan-monitoring");
    const clearSummary = clearMonitoring.getByRole("button", {
      name: /Monitoring is healthy/u,
    });
    await expect(clearSummary).toHaveAttribute("aria-expanded", "false");
    await expect(clearSummary).toContainText(
      "Reviewed actuals are within plan guardrails",
    );
    await expect(clearSummary).toContainText("Healthy");
    await expect(
      page.getByRole("heading", {
        name: "Reviewed actuals are within the plan guardrails",
      }),
    ).toHaveCount(0);
    await expect(clearMonitoring).toHaveScreenshot("plan-actual-clear.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    });
    await clearSummary.click();
    await expect(
      clearMonitoring.getByRole("heading", {
        name: "Reviewed actuals are within the plan guardrails",
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    return;
  }

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
  await waitForOverviewLayout(page);
  const limitedMonitoring = page.locator(".plan-monitoring");
  const limitedSummary = limitedMonitoring.getByRole("button", {
    name: /Monitoring is limited/u,
  });
  await expect(limitedSummary).toHaveAttribute("aria-expanded", "false");
  await expect(limitedSummary).toContainText(
    "More reviewed actuals are needed",
  );
  await expect(
    limitedMonitoring.getByRole("heading", {
      name: "Monitoring is ready for connected actuals",
    }),
  ).toHaveCount(0);
  await expect(limitedMonitoring).toHaveScreenshot("plan-actual-limited.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  const goalSignal = page.locator(".goal-signal");
  const goalStats = goalSignal.locator(
    ".goal-signal__stats [data-slot='stat']",
  );
  await expect(goalStats).toHaveCount(2);
  await expect(goalSignal).toContainText("Goal target");
  await expect(goalSignal).not.toContainText("Protected runway");
  await expect(goalSignal).not.toContainText("FI-eligible liquid");

  const portfolioBase = page.locator(".portfolio-outlook__base");
  await expect(portfolioBase).toContainText("Current base");
  await expect(portfolioBase).toContainText("Protected runway");
  await expect(portfolioBase).toContainText("FI-eligible liquid");
  await expectNoHorizontalOverflow(page);
});
