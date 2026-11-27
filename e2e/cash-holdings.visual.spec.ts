import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./api-mocked-test";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { multiInstitutionInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { createInvestmentExposureView } from "../packages/domain/src/exposure-read-model";
import { InvestmentHoldingsViewSchema } from "../packages/domain/src/investment-holdings-view";
import { cashBalanceHistoryPage } from "../packages/domain/src/cash-balance-history";

import {
  bankBalances,
  digest,
  observations,
  observedAt,
} from "./ui-catalogue/cash-history-fixture";

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
  let emptyHistory = false;
  let failOlder = false;
  let failRecent = false;
  let releaseInitialHistory: (() => void) | undefined;
  const initialHistory = new Promise<void>((resolve) => {
    releaseInitialHistory = resolve;
  });
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
    if (emptyHistory) accounts[0] = { ...accounts[0]!, valueMinor: 8_240_027 };
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
        emptyHistory
          ? []
          : params.get("kind") === "brokerage"
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
    "Total cash$84.6K",
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
  await expect(cash.locator(".record-row").first()).toContainText("$82,400.00");
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
  await expect(cash.locator(".cash-holdings__total")).toContainText("$84.6K");
  mode = "crowded";
  await page.reload();
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(4);
  const toggle = cash.getByRole("button", { name: "Show 10 small balances" });
  await expect(toggle).toBeVisible();
  expect(
    (await cash.getByRole("region", { name: "Brokerage cash" }).boundingBox())!
      .y,
  ).toBeLessThan((await toggle.boundingBox())!.y);
  await expect(cash).toContainText("Under $100 · $65 · Included in total");
  await capture("folded");
  const search = page.getByRole("searchbox", { name: "Search holdings" });
  await search.fill("Demo reserve 4");
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(1);
  await expect(cash).toContainText("Demo reserve 4");
  await expect(cash.locator(".cash-holdings__total")).toContainText("$84.6K");
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
    "Known cash$84.6K",
  );
  await expect(cash).toContainText("Balance unavailable · Excluded from total");
  await expect(cash).toContainText("Last reported Nov 8, 2026 · Still counted");
  await expect(cash.locator(".cash-holdings__account")).toHaveCount(6);
  await capture("unknown");
  mode = "zero";
  await page.reload();
  await expect(cash.locator(".cash-holdings__total")).toContainText(
    "Total cash$0",
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
    "Cash including reviewed values$84.6K",
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
  emptyHistory = true;
  await page.reload();
  await expect(first).toContainText("$82.4K");
  await first.click();
  await expect(cash).toContainText("No recorded balance history.");
  await cash.getByRole("button", { name: "View full history" }).click();
  await expect(cash.locator(".stat__value")).toHaveText("$82,400.27");
  await expect(cash).toContainText("No recorded balance history.");
  expect(errors).toEqual([]);
});
