import { test, expect, type Page } from "./api-mocked-test";
import {
  alphaFixture,
  emptyPrivateExposureReviews,
  emptyPortfolioBaseline,
} from "./holdings-detail-fixtures";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import {
  historyPositionId,
  historyReconciliation,
  historyActivity,
  historyLots,
} from "./investment-history-fixtures";

async function mobileGeometry(
  page: Page,
  feature: ReturnType<Page["getByRole"]>,
  mobile: boolean,
) {
  if (!mobile) return;
  const controls = await feature
    .locator("button:visible")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          width: rect.width,
          left: rect.left,
          right: rect.right,
        };
      }),
    );
  const width = page.viewportSize()!.width;
  expect(controls.every((rect) => rect.height >= 44 && rect.width >= 44)).toBe(
    true,
  );
  expect(controls.every((rect) => rect.left >= 0 && rect.right <= width)).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function openHolding(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
  const original = alphaFixture.holdings.find(
    (h) => h.id === historyPositionId,
  )!;
  const holdings = [
    {
      ...original,
      administratorNavMinor: 1980000,
      quantityMicros: 110_000_000,
      costBasisMinor: 1300000,
      effectiveDate: "2026-11-10",
      retrievedAt: "2026-11-11T06:00:00Z",
    },
  ];
  await page.route("**/api/alpha", (route) =>
    route.fulfill({ json: { ...alphaFixture, holdings } }),
  );
  await routeHoldingsPage(page, {
    householdName: alphaFixture.dashboard.householdName,
    holdings,
    investmentHoldings: investmentHoldingsViewFor(holdings),
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/investment-holdings", (route) =>
    route.fulfill({ json: investmentHoldingsViewFor(holdings) }),
  );
  await page.route("**/api/investment-connections", (route) =>
    route.fulfill({
      json: { version: 1, configured: true, connections: [], errorCode: null },
    }),
  );
  await page.route("**/api/private-exposure-reviews", (route) =>
    route.fulfill({ json: emptyPrivateExposureReviews }),
  );
  await page.route("**/api/holding-imports", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/portfolio-baseline", (route) =>
    route.fulfill({ json: emptyPortfolioBaseline }),
  );
  await page.goto("/holdings");
  const group = page.locator(".exposure-group").first();
  await group.locator(".exposure-group__summary").click();
  await group.getByRole("button", { name: /holding details$/ }).click();
  const feature = page.getByRole("region", {
    name: "Investment activity and tax lots",
  });
  await expect(
    feature.getByRole("heading", {
      name: "Whether trades are reflected in the reported share count is unknown.",
    }),
  ).toBeVisible();
  return feature;
}

test("inspects source-backed activity, remaining lots and account-only events without changing holdings", async ({
  page,
}, testInfo) => {
  const calls: string[] = [];
  await page.route("**/api/v1/investment-reconciliation?*", (route) =>
    route.fulfill({ json: historyReconciliation }),
  );
  await page.route("**/api/v1/investment-transactions?*", (route) => {
    const q = new URL(route.request().url()).searchParams;
    calls.push(q.toString());
    expect(q.get("readContextId")).toBe(historyActivity.context.readContextId);
    const accountFee = {
      ...historyActivity.items[0]!,
      id: "synthetic-account-fee",
      providerTransactionId: "synthetic-fee",
      positionId: null,
      securityId: null,
      securityName: null,
      ticker: null,
      type: "fee",
      subtype: "account fee",
      quantityMicros: 0,
      unitPriceMicros: 0,
      feesMinor: null,
      cashDeltaMinor: -500,
      revision: 1,
      previous: null,
    };
    let items = q.has("accountId")
      ? [...historyActivity.items, accountFee]
      : historyActivity.items;
    if (q.get("type")) items = items.filter((t) => t.type === q.get("type"));
    if (q.get("from"))
      items = items.filter((t) => t.postedOn >= q.get("from")!);
    return route.fulfill({ json: { ...historyActivity, items } });
  });
  await page.route("**/api/v1/tax-lots?*", (route) => {
    const q = new URL(route.request().url()).searchParams;
    expect(q.get("readContextId")).toBe(historyLots.context.readContextId);
    return route.fulfill({
      json: {
        ...historyLots,
        items:
          q.get("sort") === "oldest"
            ? [...historyLots.items].reverse()
            : historyLots.items,
      },
    });
  });
  const feature = await openHolding(page);
  const initialSummary = await page.locator(".holding-summary").textContent();
  await expect(feature.getByText("Buy · SYN", { exact: true })).toBeVisible();
  const purchase = feature
    .locator('[data-slot="record-item"]')
    .filter({ has: page.getByText("Buy · SYN", { exact: true }) });
  await purchase.getByRole("button", { name: "Details", exact: true }).click();
  await expect(purchase).toContainText("Previous version: 38 shares");
  await expect(purchase).toContainText("Exact execution time is not provided");
  await mobileGeometry(
    page,
    feature,
    testInfo.project.name === "mobile-chromium",
  );
  await expect(feature).toHaveScreenshot("investment-history-activity.png", {
    stylePath: "e2e/purchase-details.capture.css",
  });
  await feature.getByRole("combobox", { name: "Activity type" }).click();
  await page.getByRole("option", { name: "Purchases", exact: true }).click();
  await expect(feature.locator('[data-slot="record-item"]')).toHaveCount(1);
  await expect(page).toHaveScreenshot("investment-history-holding-detail.png", {
    fullPage: true,
    stylePath: "e2e/purchase-details.capture.css",
  });
  const lots = feature.getByRole("tab", { name: "Tax lots", exact: true });
  const activityTab = feature.getByRole("tab", {
    name: "Activity",
    exact: true,
  });
  for (
    let step = 0;
    step < 60 &&
    !(await activityTab.evaluate(
      (element) => element === document.activeElement,
    ));
    step++
  )
    await page.keyboard.press("Tab");
  await expect(activityTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(lots).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    feature.getByText("110 of 110 reported shares covered by lots.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    feature.locator('[data-slot="record-item"]').first(),
  ).toContainText("Nov 6");
  await expect(
    feature.getByRole("combobox", { name: "Sort tax lots" }),
  ).toContainText("Highest basis per share");
  await mobileGeometry(
    page,
    feature,
    testInfo.project.name === "mobile-chromium",
  );
  await expect(feature).toHaveScreenshot("investment-history-lots.png", {
    stylePath: "e2e/purchase-details.capture.css",
  });
  await feature.getByRole("combobox", { name: "Sort tax lots" }).click();
  await page
    .getByRole("option", { name: "Oldest acquisition", exact: true })
    .click();
  await expect(
    feature.locator('[data-slot="record-item"]').first(),
  ).toContainText("Jun 10");
  await feature
    .getByRole("button", { name: "View account activity", exact: true })
    .click();
  await expect(
    feature.getByRole("heading", {
      name: "Entire account activity",
      exact: true,
    }),
  ).toBeVisible();
  await expect(feature.getByText("Fee", { exact: true })).toBeVisible();
  await mobileGeometry(
    page,
    feature,
    testInfo.project.name === "mobile-chromium",
  );
  await page.mouse.move(0, 0);
  await expect(feature).toHaveScreenshot("investment-history-account.png", {
    stylePath: "e2e/purchase-details.capture.css",
  });
  await feature.getByRole("button", { name: "From", exact: true }).click();
  await page
    .getByRole("button", { name: "Tuesday, November 10, 2026", exact: true })
    .click();
  await feature
    .getByRole("button", { name: "Apply dates", exact: true })
    .click();
  await expect(feature.getByText("Buy · SYN", { exact: true })).toHaveCount(0);
  expect(calls.some((q) => q.includes("accountId="))).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".holding-summary")).toHaveText(initialSummary!);
});

test("shows incomplete lot coverage and recovers an expired read without retry loops", async ({
  page,
}, testInfo) => {
  let expired = true,
    partial = false,
    emptyActivity = false,
    reads = 0;
  const activityRequests: URLSearchParams[] = [];
  let releaseInitial!: () => void;
  const initialResponse = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  await page.route("**/api/v1/investment-reconciliation?*", (route) =>
    route.fulfill({ json: historyReconciliation }),
  );
  await page.route("**/api/v1/investment-transactions?*", async (route) => {
    reads++;
    const query = new URL(route.request().url()).searchParams;
    activityRequests.push(query);
    if (reads === 1) await initialResponse;
    return expired
      ? route.fulfill({
          status: 409,
          json: { code: "stale_revision", error: "History changed" },
        })
      : route.fulfill({
          json: emptyActivity
            ? { ...historyActivity, items: [] }
            : {
                ...historyActivity,
                items: historyActivity.items.filter(
                  (record) =>
                    (!query.has("type") || record.type === query.get("type")) &&
                    (!query.has("from") ||
                      record.postedOn >= query.get("from")!) &&
                    (!query.has("through") ||
                      record.postedOn <= query.get("through")!),
                ),
              },
        });
  });
  await page.route("**/api/v1/tax-lots?*", (route) =>
    route.fulfill({
      json: partial
        ? {
            ...historyLots,
            coverage: {
              ...historyLots.coverage,
              status: "partial",
              coveredQuantityMicros: 70_000_000,
            },
            items: [historyLots.items[1]],
          }
        : {
            ...historyLots,
            coverage: {
              status: "unavailable",
              reportedQuantityMicros: 110_000_000,
              coveredQuantityMicros: null,
              knownBasisMinor: null,
              allBasisKnown: false,
            },
            items: [],
          },
    }),
  );
  const feature = await openHolding(page);
  await expect(
    feature.getByText("Loading activity…", { exact: true }),
  ).toBeVisible();
  await expect(feature).toHaveScreenshot("investment-history-loading.png", {
    stylePath: "e2e/purchase-details.capture.css",
  });
  releaseInitial();
  await expect(feature.getByRole("alert")).toContainText("History changed");
  await page.waitForTimeout(250);
  expect(reads).toBe(1);
  await feature.getByRole("combobox", { name: "Activity type" }).click();
  await page.getByRole("option", { name: "Purchases", exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  await feature.getByRole("button", { name: "From", exact: true }).click();
  await page
    .getByRole("button", { name: "Monday, November 9, 2026", exact: true })
    .click();
  await feature.getByRole("button", { name: "Through", exact: true }).click();
  await page
    .getByRole("button", { name: "Wednesday, November 11, 2026", exact: true })
    .click();
  await feature
    .getByRole("button", { name: "Apply dates", exact: true })
    .click();
  await expect.poll(() => reads).toBe(3);
  await expect(feature.getByRole("alert")).toContainText("History changed");
  await expect(feature).toHaveScreenshot("investment-history-conflict.png", {
    stylePath: "e2e/purchase-details.capture.css",
  });
  expired = false;
  await feature
    .getByRole("button", { name: "Reload history", exact: true })
    .click();
  await expect(feature.getByText("Buy · SYN", { exact: true })).toBeVisible();
  expect(reads).toBe(4);
  expect(activityRequests.at(-1)!.get("type")).toBe("buy");
  expect(activityRequests.at(-1)!.get("from")).toBe("2026-11-09");
  expect(activityRequests.at(-1)!.get("through")).toBe("2026-11-11");
  await expect(
    feature.getByRole("combobox", { name: "Activity type" }),
  ).toContainText("Purchases");
  await expect(
    feature.getByRole("button", { name: "From", exact: true }),
  ).toContainText("Nov 9, 2026");
  await expect(
    feature.getByRole("button", { name: "Through", exact: true }),
  ).toContainText("Nov 11, 2026");
  await feature.getByRole("tab", { name: "Tax lots", exact: true }).click();
  await expect(
    feature.getByText("The broker did not provide tax lots.", { exact: true }),
  ).toBeVisible();
  await expect(feature.getByText("0 shares", { exact: false })).toHaveCount(0);
  await expect(feature).toHaveScreenshot(
    "investment-history-unavailable-lots.png",
  );
  partial = true;
  await feature.getByRole("tab", { name: "Activity", exact: true }).click();
  await feature.getByRole("tab", { name: "Tax lots", exact: true }).click();
  await expect(
    feature.getByText("Higher-cost lots may be missing.", { exact: false }),
  ).toBeVisible();
  await expect(feature).toHaveScreenshot(
    "investment-history-partial-lots.png",
    { stylePath: "e2e/purchase-details.capture.css" },
  );
  emptyActivity = true;
  await feature.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(
    feature.getByText("No transactions reported for this filter.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(feature).toHaveScreenshot("investment-history-empty.png", {
    stylePath: "e2e/purchase-details.capture.css",
  });
  const targets = await feature
    .locator("button:visible")
    .evaluateAll((buttons) =>
      buttons.map((b) => b.getBoundingClientRect().height),
    );
  if (testInfo.project.name === "mobile-chromium")
    expect(targets.every((height) => height >= 44)).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
