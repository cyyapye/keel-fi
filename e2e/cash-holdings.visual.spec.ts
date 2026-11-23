import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./api-mocked-test";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { multiInstitutionInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { createInvestmentExposureView } from "../packages/domain/src/exposure-read-model";
import { InvestmentHoldingsViewSchema } from "../packages/domain/src/investment-holdings-view";
import type { AcceptedCashAccount } from "../packages/domain/src/index";
import { cashBalanceHistoryPage } from "../packages/domain/src/cash-balance-history";

const observedAt = "2026-11-08T12:00:00.000Z";
const digest = (n: number) => n.toString(16).padStart(64, "0");
function bankBalances(extra = false): AcceptedCashAccount[] {
  return [
    8240000,
    165000,
    2500,
    0,
    ...(extra ? [325, 110, 80, 215, 65, 435] : []),
  ].map((valueMinor, i) => ({
    id: `demo-bank-balance-${i}`,
    naturalKeySha256: digest(i + 1),
    connectionId: "demo-bank-connection",
    institutionLabel: i % 2 ? "Capital One" : "Robinhood",
    accountLabel:
      ["Savings", "Performance Savings", "Checking", "Checking"][i] ??
      `Demo reserve ${i}${i === 4 ? " · ExtremelyLongSyntheticAccountNameWithoutAnySpacesForResponsiveCoverage" : ""}`,
    subtype: i === 2 || i === 3 ? "checking" : "savings",
    valueMinor,
    valueState: "reported",
    balanceSource: "available",
    refreshKind: "live",
    observedAt,
    acceptedAt: observedAt,
  }));
}
function brokerageBalances(attention = false, zero = false) {
  const base = multiInstitutionInvestmentHoldingsView();
  const connection = base.positionView.connections.find(
    (c) => c.institutionKey === "ins_robinhood",
  )!;
  const container = connection.containers[0]!;
  const cash = container.positions.find(
    (p) => p.snapshot.instrumentType === "cash",
  )!;
  const positionView = {
    asOf: observedAt,
    connections: [
      {
        ...connection,
        containers: [36000, 15000, 1575, 1200].map((valueMinor, i) => ({
          ...container,
          id: `demo-cash-container-${i}`,
          label: ["Individual", "Brokerage", "IRA", "Roth IRA"][i]!,
          kind: i > 1 ? ("ira" as const) : ("brokerage" as const),
          positions: [
            {
              ...cash,
              id: `demo-cash-position-${i}`,
              source: {
                ...cash.source,
                freshness:
                  attention && i === 2
                    ? ("stale" as const)
                    : ("current" as const),
              },
              snapshot: {
                ...cash.snapshot,
                id: `demo-cash-snapshot-${i}`,
                fingerprint: digest(50 + i),
                observedAt,
                unrealizedValue: {
                  state: "reported" as const,
                  minor: zero ? 0 : valueMinor,
                },
                netValue: {
                  state: "reported" as const,
                  minor: zero ? 0 : valueMinor,
                },
              },
            },
          ],
        })),
      },
    ],
  };
  return InvestmentHoldingsViewSchema.parse({
    version: 1,
    authorizationStatus: "available",
    positionView,
    exposureView: createInvestmentExposureView(positionView, [], []),
  });
}

test("cash accounts keep totals, bounded history and small-balance visibility understandable", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let mode: "normal" | "crowded" | "unknown" | "zero" | "empty" | "reviewed" =
    "normal";
  let historyRequests = 0;
  let failOlder = false;
  let failRecent = false;
  let releaseInitialHistory: (() => void) | undefined;
  const initialHistory = new Promise<void>((resolve) => {
    releaseInitialHistory = resolve;
  });
  const amounts = [
    4500000, 5000000, 5800000, 6400000, 6850000, 7000000, 7400000, 7600000,
    7800000, 7950000, 8100000, 8240000,
  ];
  const dates = [
    "2022-02-10",
    "2023-05-02",
    "2024-11-08",
    "2025-07-01",
    "2025-12-02",
    "2026-02-01",
    "2026-05-12",
    "2026-08-05",
    "2026-09-20",
    "2026-10-18",
    "2026-11-02",
    "2026-11-08",
  ];
  const observations = amounts.flatMap((valueMinor, i) =>
    [0, 1].map((repeat) => ({
      id: `demo-change-${i}-${repeat}`,
      valueMinor,
      observedAt: `${dates[i]}T12:00:00.000Z`,
      acceptedAt: `${dates[i]}T1${2 + repeat}:00:00.000Z`,
    })),
  );
  const fixture = () => {
    let data = brokerageBalances(mode === "unknown", mode === "zero");
    if (mode === "reviewed")
      data.exposureView.positions[0] = {
        ...data.exposureView.positions[0]!,
        valueSource: "reviewed_adjustment",
        valueSourceLabel: "Manual balance correction",
        valueMinor: 38000,
        unallocatedValueMinor: 38000,
      };
    let accounts = bankBalances(mode === "crowded" || mode === "unknown");
    if (mode === "unknown")
      accounts = accounts.map((a, i) =>
        i === 2
          ? {
              ...a,
              valueMinor: null,
              valueState: "not_reported",
              balanceSource: null,
            }
          : a,
      );
    if (mode === "zero")
      accounts = accounts.map((a) => ({ ...a, valueMinor: 0 }));
    if (mode === "empty") {
      accounts = [];
      const base = multiInstitutionInvestmentHoldingsView();
      const positionView = {
        ...base.positionView,
        connections: base.positionView.connections.map((connection) => ({
          ...connection,
          containers: connection.containers.map((container) => ({
            ...container,
            positions: container.positions.filter(
              (position) => position.snapshot.instrumentType !== "cash",
            ),
          })),
        })),
      };
      data = InvestmentHoldingsViewSchema.parse({
        ...base,
        positionView,
        exposureView: createInvestmentExposureView(positionView, [], []),
      });
    }
    return {
      householdName: "Demo Household",
      holdings: [],
      acceptedCashAccounts: accounts,
      pendingImports: [],
      investmentHoldings: data,
    };
  };
  await routeHoldingsPage(page, fixture);
  await page.route("**/api/portfolio-baseline", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Synthetic planning unavailable" },
    }),
  );
  await page.route("**/api/private-exposure-reviews", (route) =>
    route.fulfill({
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
    }),
  );
  await page.route("**/api/investment-connections", (route) =>
    route.fulfill({
      json: { version: 1, configured: false, connections: [], errorCode: null },
    }),
  );
  await page.route("**/api/investment-holdings", (route) =>
    route.fulfill({ json: fixture().investmentHoldings }),
  );
  await page.route("**/api/cash-balance-history?*", async (route) => {
    historyRequests++;
    await initialHistory;
    const params = new URL(route.request().url()).searchParams;
    if (failRecent || (failOlder && params.has("after"))) {
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic history unavailable" },
      });
      return;
    }
    await route.fulfill({
      json: cashBalanceHistoryPage(
        params.get("kind") === "brokerage"
          ? observations.map((entry, i) => ({
              ...entry,
              valueMinor: [
                14000, 15000, 16000, 20000, 21000, 22000, 23000, 26000, 28000,
                30000, 34000, 36000,
              ][Math.floor(i / 2)]!,
            }))
          : observations,
        Number(params.get("limit")),
        params.get("after") ?? undefined,
      ),
    });
  });
  const cash = page.locator(".cash-holdings");
  const capture = async (state: string, baseline = false) => {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    const geometry = await cash
      .locator(".cash-holdings__account-summary")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const name = node.children[0]!.getBoundingClientRect();
          const value = node.children[1]!.getBoundingClientRect();
          return {
            separate: name.right <= value.left,
            height: node.getBoundingClientRect().height,
          };
        }),
      );
    expect(geometry.every((row) => row.separate && row.height >= 44)).toBe(
      true,
    );
    const chrome = await page.addStyleTag({
      content: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
    try {
      if (baseline)
        await expect(cash).toHaveScreenshot(`cash-${state}.png`, {
          animations: "disabled",
          scale: "css",
        });
      const out = process.env.KEEL_CASH_REVIEW_DIR;
      if (out) {
        await mkdir(out, { recursive: true });
        await cash.screenshot({
          path: join(out, `${state}-${testInfo.project.name}.png`),
          animations: "disabled",
          scale: "css",
        });
      }
    } finally {
      await chrome.evaluate((element) => {
        element.parentNode?.removeChild(element);
      });
    }
  };
  await page.goto("/holdings");
  await expect(cash.locator(".cash-holdings__total")).toContainText(
    "Total cash$84,612.75",
  );
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(8);
  await expect(
    cash.getByRole("button", { name: /small balances/ }),
  ).toHaveCount(0);
  expect(historyRequests).toBe(0);
  await capture("current", true);
  const first = cash.locator(".cash-holdings__account-summary").first();
  // Exercise native keyboard navigation with the page chrome present.
  for (
    let n = 0;
    n < 80 && !(await first.evaluate((el) => el === document.activeElement));
    n++
  )
    await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(cash).toContainText("Loading balance history…");
  await capture("loading");
  releaseInitialHistory!();
  await expect(cash.locator(".cash-history__recent li")).toHaveCount(5);
  await expect(cash).toContainText("Latest 5 of 12 entries");
  await capture("recent", true);
  await cash.getByRole("button", { name: "View full history" }).click();
  await expect(
    cash.getByRole("button", { name: "← Back to cash" }),
  ).toBeFocused();
  await expect(cash.locator(".record-row")).toHaveCount(10);
  await expect(cash.locator(".cash-history__paging")).toContainText(
    "1–10 of 12 entries",
  );
  await capture("full", true);
  await page.keyboard.press("Tab");
  await expect(
    cash.getByRole("button", { name: "Older", exact: true }),
  ).toBeFocused();
  await capture("focus");
  failOlder = true;
  await page.keyboard.press("Enter");
  await expect(cash).toContainText(
    "Older entries could not be loaded. Showing 1–10 of 12 entries.",
  );
  await expect(cash.locator(".record-row")).toHaveCount(10);
  await capture("failure");
  failOlder = false;
  await cash.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(cash.locator(".record-row")).toHaveCount(2);
  await expect(cash.locator(".cash-history__paging")).toContainText(
    "11–12 of 12 entries",
  );
  await expect(
    cash.getByRole("button", { name: "Older", exact: true }),
  ).toBeDisabled();
  await expect(cash).toContainText("First recorded balance");
  await capture("last");
  await cash.getByRole("button", { name: "← Back to cash" }).click();
  await expect(
    cash.getByRole("button", { name: "View full history" }),
  ).toBeFocused();
  await expect(cash.locator(".cash-holdings__total")).toContainText(
    "$84,612.75",
  );
  mode = "crowded";
  await page.reload();
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(4);
  const toggle = cash.getByRole("button", { name: "Show 10 small balances" });
  await expect(toggle).toBeVisible();
  expect(
    (await cash.getByRole("region", { name: "Brokerage cash" }).boundingBox())!
      .y,
  ).toBeLessThan((await toggle.boundingBox())!.y);
  await expect(cash).toContainText("Under $100 · $65.05 · Included in total");
  await capture("folded");
  const search = page.getByRole("searchbox", { name: "Search holdings" });
  await search.fill("Demo reserve 4");
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(1);
  await expect(cash).toContainText("Demo reserve 4");
  await expect(cash.locator(".cash-holdings__total")).toContainText(
    "$84,625.05",
  );
  await search.press("Escape");
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(4);
  await toggle.click();
  await expect(
    cash.getByRole("button", { name: "Hide small balances" }),
  ).toBeFocused();
  await expect(
    cash.getByRole("button", { name: "Hide small balances" }),
  ).toBeInViewport();
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(14);
  await capture("expanded");
  mode = "unknown";
  await page.reload();
  await expect(cash.locator(".cash-holdings__total")).toContainText(
    "Known cash$84,600.05",
  );
  await expect(cash).toContainText("Balance unavailable · Excluded from total");
  await expect(cash).toContainText("Last reported Nov 8, 2026 · Still counted");
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(6);
  await capture("unknown");
  mode = "zero";
  await page.reload();
  await expect(cash.locator(".cash-holdings__total")).toContainText(
    "Total cash$0.00",
  );
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(8);
  await capture("zero");
  mode = "empty";
  await page.reload();
  await expect(cash).toContainText("No cash accounts connected.");
  await expect(cash.locator(".cash-holdings__total")).toContainText(
    "Not available",
  );
  await capture("empty");
  mode = "reviewed";
  await page.reload();
  await expect(cash.locator(".cash-holdings__total")).toContainText(
    "Cash including reviewed values$84,632.75",
  );
  const reviewed = cash
    .locator(".cash-holdings__account")
    .filter({ hasText: "Manual balance correction" });
  await reviewed.locator(".cash-holdings__account-summary").click();
  await expect(reviewed).toContainText("Reported balance history");
  await reviewed.getByRole("button", { name: "View full history" }).click();
  await expect(
    cash.getByRole("heading", { name: "Reported balance history" }),
  ).toBeVisible();
  await expect(cash).toContainText("Accepted cash value");
  await capture("reviewed");
  mode = "normal";
  failRecent = true;
  await page.reload();
  await first.click();
  await expect(cash).toContainText("Balance history could not be loaded.");
  failRecent = false;
  await cash.getByRole("button", { name: "Try again" }).click();
  await expect(cash.locator(".cash-history__recent li")).toHaveCount(5);
  await expect(
    cash.getByRole("button", { name: "View full history" }),
  ).toBeFocused();
  await page.setViewportSize({ width: 320, height: 900 });
  await capture("minimum");
  await cash.getByRole("button", { name: "View full history" }).click();
  await expect(cash.locator(".record-row")).toHaveCount(10);
  await capture("minimum-full");
  expect(errors).toEqual([]);
});
