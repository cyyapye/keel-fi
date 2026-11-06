import { expect, test, type Page } from "./api-mocked-test";
import { ManualHoldingInputSchema } from "../packages/domain/src/manual-holdings";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import {
  holding,
  manualFundWithEstimate,
  positionId,
} from "./manual-holding-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";

const options = {
  householdScope: "synthetic-household-scope",
  containers: [{ id: "manual-owner", label: "Demo Family LLC", version: 1 }],
  legalEntities: [{ id: "demo-trust", label: "Demo Trust", version: 2 }],
  companies: [
    {
      id: "demo-company",
      name: "Juniper Works",
      revision: "2026-10-01T12:00:00.000Z",
    },
  ],
};
async function select(page: Page, name: string, choice: string) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: choice, exact: true }).click();
}
async function fillIdentity(page: Page) {
  await page
    .getByLabel("Investment name", { exact: true })
    .fill("Synthetic Orchard Direct");
  await page.getByRole("radio", { name: "Direct", exact: true }).check();
  await select(page, "Held by", "Demo Family LLC");
}
async function capture(page: Page, name: string) {
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".manual-holding-workspace")).toHaveScreenshot(
    name,
    { animations: "disabled" },
  );
}
async function routeOverviewReads(page: Page) {
  await page.route("**/api/investment-connections", (route) =>
    route.fulfill({
      json: { version: 1, configured: true, connections: [], errorCode: null },
    }),
  );
  await page.route("**/api/cash-accounts", (route) =>
    route.fulfill({
      json: {
        version: 1,
        configured: true,
        status: "disconnected",
        connections: [],
        acceptedAccounts: [],
        pendingProposals: [],
        errorCode: null,
      },
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
  await page.route("**/api/portfolio-baseline", (route) =>
    route.fulfill({
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
          currentFiEligibleLiquidMinor: 0,
          protectedCashFloorMinor: 0,
          householdBurnMonthlyMinor: 0,
          businessBurnMonthlyMinor: 0,
          fiTargetMinor: 0,
          p25FiveYearLiquidityMinor: 0,
          p50FiveYearLiquidityMinor: 0,
          p75FiveYearLiquidityMinor: 0,
          forecastHorizonDate: "2031-11-01",
        },
        suggestedOtherFiEligibleLiquidMinor: 0,
        currentImpact: {
          fiEligibleLiquidMinor: 0,
          fiEligibleChangeMinor: 0,
          protectedRunwayMonths: 0,
          fiGapMinor: 0,
          lowerTotalAvailableMinor: 0,
          middleTotalAvailableMinor: 0,
          higherTotalAvailableMinor: 0,
          probabilityCrossingFiPpm: 0,
        },
        latestBaseline: null,
        hasSourceChanges: false,
        hasCashAccountChanges: false,
        requiresDuplicateReview: false,
        requiresCashOverlapReview: false,
        canConfirm: false,
      },
    }),
  );
}

async function registerManualHoldingRoutes(
  page: Page,
  currentHolding = holding,
  acceptedView = emptyInvestmentHoldingsView,
) {
  let accepted = false;
  await page.clock.setFixedTime(new Date("2026-11-01T18:45:00.000Z"));
  await routeHoldingsPage(page, () => ({
    householdName: "Demo Household",
    holdings: accepted ? [currentHolding()] : [],
    investmentHoldings: accepted ? acceptedView : emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  }));
  await page.route("**/api/manual-holdings/options", (route) =>
    route.fulfill({ json: options }),
  );
  await page.route(
    `**/api/investment-positions/${positionId}/history`,
    (route) => route.fulfill({ json: { entries: [], next: null } }),
  );
  return {
    accept: () => {
      accepted = true;
    },
  };
}

async function setup(page: Page, currentHolding = holding) {
  const fixture = await registerManualHoldingRoutes(page, currentHolding);
  const [optionsResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/manual-holdings/options",
    ),
    page.goto("/holdings/new"),
  ]);
  expect(optionsResponse.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Add holding", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Held by" })).toBeEnabled();
  await expect(
    page.getByText("Loading owner and company choices…", { exact: true }),
  ).toHaveCount(0);
  return fixture;
}

test("keeps type controls stationary across project-owned viewport and disclosure states", async ({
  page,
}, testInfo) => {
  await routeOverviewReads(page);
  const widths = testInfo.project.use.isMobile ? [412] : [838, 1280];
  const radios = page.getByRole("radiogroup", {
    name: "Investment type",
    exact: true,
  });
  const positions = () =>
    radios.getByRole("radio").evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x + window.scrollX, y: box.y + window.scrollY };
      }),
    );
  const transitions = [
    ["Direct", "SPV", "ArrowRight"],
    ["SPV", "Fund", "ArrowRight"],
    ["Fund", "Direct", "ArrowRight"],
    ["Direct", "Fund", "ArrowLeft"],
    ["Fund", "SPV", "ArrowLeft"],
    ["SPV", "Direct", "ArrowLeft"],
  ] as const;
  const cash = page.getByLabel("Cash paid · USD", { exact: true });
  const estimate = page.getByLabel("Estimated value · USD", { exact: true });
  const expand = page.getByRole("button", {
    name: "Add investment or valuation details",
    exact: true,
  });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 978 });
    await setup(page);
    await fillIdentity(page);
    await expand.click();
    await cash.fill("125.50");
    await estimate.fill("150");
    for (const detailsOpen of [true, false]) {
      await test.step(`${width}px with details ${detailsOpen ? "open" : "closed"}`, async () => {
        if (!detailsOpen) {
          await page
            .getByRole("button", {
              name: "Investment and valuation",
              exact: true,
            })
            .click();
          await expect(cash).not.toBeVisible();
        }
        await radios
          .getByRole("radio", { name: "Direct", exact: true })
          .check();
        const initial = await positions();
        expect(initial).toHaveLength(3);
        for (const [from, to, key] of width === 838 && detailsOpen
          ? transitions
          : transitions.slice(0, 2)) {
          await radios.getByRole("radio", { name: from, exact: true }).focus();
          await page.keyboard.press(key);
          const selected = radios.getByRole("radio", { name: to, exact: true });
          await expect(selected).toBeChecked();
          await expect(selected).toBeFocused();
          const current = await positions();
          expect(current).toHaveLength(initial.length);
          for (const [index, position] of current.entries()) {
            expect(
              Math.abs(position.x - initial[index]!.x),
              `${from} to ${to} moves radio ${index} horizontally`,
            ).toBeLessThanOrEqual(0.5);
            expect(
              Math.abs(position.y - initial[index]!.y),
              `${from} to ${to} moves radio ${index} vertically`,
            ).toBeLessThanOrEqual(0.5);
          }
          await expect(
            page.getByRole("textbox", {
              name: /^(Investment name|SPV legal name|Fund name)$/u,
            }),
          ).toHaveValue("Synthetic Orchard Direct");
          await expect(
            page.getByRole("combobox", { name: "Held by", exact: true }),
          ).toContainText("Demo Family LLC");
        }
        if (!detailsOpen) await expand.click();
        await expect(cash).toHaveValue("125.50");
        await expect(estimate).toHaveValue("150");
      });
    }
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/\/holdings$/u);
  }
});

test(
  "uses the shared calendars with bounds, keyboard focus and field errors",
  {
    tag:
      process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1" ? [] : "@desktop-only",
  },
  async ({ page }, testInfo) => {
    await setup(page);
    await fillIdentity(page);
    await page
      .getByRole("button", {
        name: "Add investment or valuation details",
        exact: true,
      })
      .click();
    await page.getByLabel("Cash paid · USD", { exact: true }).fill("125.50");
    await page.getByLabel("Estimated value · USD", { exact: true }).fill("150");
    const investmentDate = page.getByRole("button", {
      name: "Investment date",
      exact: true,
    });
    const valuationDate = page.getByRole("button", {
      name: "Valuation date",
      exact: true,
    });
    await expect(investmentDate).toHaveText("Choose date");
    await expect(valuationDate).toHaveAttribute("aria-invalid", "true");
    const description = await investmentDate.getAttribute("aria-describedby");
    expect(description).toBeTruthy();
    await expect(
      page.locator(`[id=${JSON.stringify(description)}]`),
    ).toHaveText("Leave blank if unknown.");
    const errorIds = (
      await valuationDate.getAttribute("aria-describedby")
    )?.split(/\s+/u);
    expect(errorIds).toBeDefined();
    const errorTexts = await Promise.all(
      errorIds!.map((id) =>
        page.locator(`[id=${JSON.stringify(id)}]`).textContent(),
      ),
    );
    expect(errorTexts).toContain("Add the date this estimate applies to.");
    for (const name of ["Investment date", "Valuation date"]) {
      const trigger = page.getByRole("button", { name, exact: true });
      await trigger.click();
      const calendar = page.getByRole("dialog", {
        name: `${name} calendar`,
        exact: true,
      });
      await expect(calendar).toBeVisible();
      if (process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1") {
        await page.screenshot({
          path: testInfo.outputPath(
            name === "Investment date"
              ? "manual-investment-calendar-open.png"
              : "manual-valuation-calendar-open.png",
          ),
          animations: "disabled",
        });
      }
      await expect(
        calendar.getByRole("button", { name: "Next month", exact: true }),
      ).toBeDisabled();
      await expect(
        calendar.getByRole("button", {
          name: "Monday, November 2, 2026",
          exact: true,
        }),
      ).toBeDisabled();
      await calendar
        .getByRole("button", { name: "Previous month", exact: true })
        .click();
      await calendar
        .getByRole("button", {
          name: "Thursday, October 15, 2026",
          exact: true,
        })
        .click();
      await expect(calendar).not.toBeVisible();
      await expect(trigger).toHaveText("Oct 15, 2026");
      await expect(trigger).toBeFocused();
      await trigger.press("Enter");
      const selectedDay = calendar.getByRole("button", {
        name: "Thursday, October 15, 2026",
        exact: true,
      });
      await expect(selectedDay).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(
        calendar.getByRole("button", {
          name: "Friday, October 16, 2026",
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveText("Oct 16, 2026");
      await expect(trigger).toBeFocused();
      await trigger.click();
      await calendar
        .getByRole("button", { name: "Clear date", exact: true })
        .click();
      await expect(trigger).toHaveText("Choose date");
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(calendar).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
    await expect(valuationDate).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", { name: "Save holding", exact: true }),
    ).toBeDisabled();
    await valuationDate.click();
    await page
      .getByRole("button", { name: "Previous month", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Thursday, October 15, 2026", exact: true })
      .click();
    await expect(valuationDate).not.toHaveAttribute("aria-invalid", "true");
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let submitted = false;
    await page.route("**/api/manual-holdings", async (route) => {
      const input = ManualHoldingInputSchema.parse(
        route.request().postDataJSON(),
      );
      expect(input.investmentDate).toBeNull();
      expect(input.valuation).toMatchObject({ effectiveDate: "2026-10-15" });
      submitted = true;
      await pending;
      await route.fulfill({
        status: 400,
        json: {
          error: "The synthetic date submission needs a corrected selection.",
        },
      });
    });
    try {
      await page
        .getByRole("button", { name: "Save holding", exact: true })
        .click();
      await expect.poll(() => submitted).toBe(true);
      await expect(investmentDate).toBeDisabled();
      await expect(valuationDate).toBeDisabled();
    } finally {
      release?.();
    }
    await expect(
      page.getByText(
        "The synthetic date submission needs a corrected selection.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect(valuationDate).toHaveText("Oct 15, 2026");
    await expect(investmentDate).toHaveText("Choose date");
    await expect(
      page.getByLabel("Cash paid · USD", { exact: true }),
    ).toHaveValue("125.50");
  },
);

test("keeps identity required and financial facts optional with inline errors", async ({
  page,
  isMobile,
}) => {
  await setup(page);
  await expect(
    page.getByRole("button", { name: "Save holding", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Investment name", { exact: true }),
  ).toBeFocused();
  await capture(page, "manual-holding-initial.png");
  await page.getByRole("radio", { name: "SPV", exact: true }).check();
  await capture(page, "manual-holding-spv.png");
  await page.getByRole("radio", { name: "Direct", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("radio", { name: "Direct", exact: true }),
  ).toBeChecked();
  await fillIdentity(page);
  await expect(
    page.getByRole("button", { name: "Save holding", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", {
      name: "Add investment or valuation details",
      exact: true,
    })
    .click();
  await page.getByLabel("Cash paid · USD", { exact: true }).fill("25.999");
  await expect(
    page.getByLabel("Cash paid · USD", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Enter a USD amount with up to two decimal places.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save holding", exact: true }),
  ).toBeDisabled();
  await capture(page, "manual-holding-invalid.png");
  if (!isMobile) return;
  await page.getByLabel("Cash paid · USD", { exact: true }).fill("");
  await page
    .getByLabel("Estimated value · USD", { exact: true })
    .fill("30,000.01");
  await expect(
    page.getByText("Add the date this estimate applies to.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Valuation date", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Thursday, October 15, 2026", exact: true })
    .click();
  let seen = false;
  await page.route("**/api/manual-holdings", async (route) => {
    const input = ManualHoldingInputSchema.parse(
      route.request().postDataJSON(),
    );
    expect(input.cashPaidMinor).toBeNull();
    expect(input.investmentDate).toBeNull();
    expect(input.valuation).toEqual({
      state: "estimated",
      amountMinor: 3_000_001,
      effectiveDate: "2026-10-15",
      carryStatus: "unknown",
    });
    seen = true;
    await route.fulfill({
      status: 400,
      json: { error: "The synthetic owner needs a corrected selection." },
    });
  });
  await page.getByRole("button", { name: "Save holding", exact: true }).click();
  await expect.poll(() => seen).toBe(true);
  await expect(
    page.getByText("The synthetic owner needs a corrected selection.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Investment name", { exact: true })).toHaveValue(
    "Synthetic Orchard Direct",
  );
  await capture(page, "manual-holding-rejected.png");
});

test(
  "checks an uncertain save and retries the same submission only after a reliable no-match",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const fixture = await setup(page);
    await fillIdentity(page);
    const submissions: string[] = [];
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/manual-holdings", async (route) => {
      const input = ManualHoldingInputSchema.parse(
        route.request().postDataJSON(),
      );
      submissions.push(input.submissionId);
      if (submissions.length === 1) {
        await pending;
        await route.abort("failed");
      } else {
        fixture.accept();
        await route.fulfill({
          status: 201,
          json: {
            submissionId: input.submissionId,
            positionId,
            snapshotId: "manual-snapshot",
            purchaseReceiptId: "manual-receipt",
            identityVersion: 1,
          },
        });
      }
    });
    let checks = 0;
    await page.route("**/api/manual-holdings/submissions/*", async (route) => {
      checks += 1;
      await route.fulfill({ json: { receipt: null } });
    });
    await page
      .getByRole("button", { name: "Save holding", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Back to holdings", exact: true }),
    ).toBeDisabled();
    await capture(page, "manual-holding-saving.png");
    release?.();
    await expect(
      page.getByRole("button", { name: "Check holdings", exact: true }),
    ).toBeVisible();
    expect(submissions).toHaveLength(1);
    await capture(page, "manual-holding-unconfirmed.png");
    await page.reload();
    await expect(
      page.getByLabel("Investment name", { exact: true }),
    ).toHaveValue("Synthetic Orchard Direct");
    await expect(
      page.getByRole("button", { name: "Save holding", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Check holdings", exact: true }),
    ).toBeVisible();
    expect(submissions).toHaveLength(1);
    await page
      .getByRole("button", { name: "Check holdings", exact: true })
      .click();
    await expect(
      page.getByText(
        "No matching holding was found. Review this entry before trying again.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(checks).toBe(1);
    expect(submissions).toHaveLength(1);
    await expect(
      page.getByLabel("Investment name", { exact: true }),
    ).toHaveValue("Synthetic Orchard Direct");
    await capture(page, "manual-holding-no-match.png");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`position=${positionId}`));
    expect(submissions).toHaveLength(2);
    expect(submissions[0]).toBe(submissions[1]);
    await expect(
      page.getByRole("heading", {
        name: "Synthetic Orchard Direct",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Entered by you", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("$0", { exact: true })).toHaveCount(0);
  },
);

test(
  "finds a committed uncertain save without sending another POST",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const fixture = await setup(page);
    await fillIdentity(page);
    let submissionId = "";
    let posts = 0;
    await page.route("**/api/manual-holdings", async (route) => {
      submissionId = ManualHoldingInputSchema.parse(
        route.request().postDataJSON(),
      ).submissionId;
      posts += 1;
      fixture.accept();
      await route.abort("failed");
    });
    await page.route("**/api/manual-holdings/submissions/*", (route) =>
      route.fulfill({
        json: {
          receipt: {
            submissionId,
            positionId,
            snapshotId: "manual-snapshot",
            purchaseReceiptId: "manual-receipt",
            identityVersion: 1,
          },
        },
      }),
    );
    await page
      .getByRole("button", { name: "Save holding", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check holdings", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`position=${positionId}`));
    expect(posts).toBe(1);
  },
);

test(
  "restores drafts only within the authenticated household scope",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await setup(page);
    await fillIdentity(page);
    let householdScope = "synthetic-other-household";
    await page.route("**/api/manual-holdings/options", (route) =>
      route.fulfill({ json: { ...options, householdScope } }),
    );
    await page.reload();
    await expect(
      page.getByLabel("Investment name", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("radio", { name: "Direct", exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Save holding", exact: true }),
    ).toBeDisabled();
    householdScope = options.householdScope;
    await page.reload();
    await expect(
      page.getByLabel("Investment name", { exact: true }),
    ).toHaveValue("Synthetic Orchard Direct");
    await expect(
      page.getByRole("radio", { name: "Direct", exact: true }),
    ).toBeChecked();
  },
);

test(
  "opens the dedicated editor from empty and regular Holdings and restores trigger focus on cancel",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const { current, view } = manualFundWithEstimate();
    const fixture = await registerManualHoldingRoutes(
      page,
      () => current,
      view,
    );
    await routeOverviewReads(page);
    await page.goto("/holdings");
    const emptyAction = page.getByRole("button", {
      name: "Add holding",
      exact: true,
    });
    await expect(emptyAction).toHaveCount(1);
    await expect(page.locator(".holding-welcome p div")).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
    await emptyAction.click();
    await expect(page).toHaveURL(/\/holdings\/new$/u);
    await expect(
      page.getByLabel("Investment name", { exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/\/holdings$/u);
    await expect(emptyAction).toBeFocused();
    fixture.accept();
    await page.reload();
    await expect(
      page
        .locator(".unallocated-positions article")
        .filter({ hasText: current.positionName }),
    ).toBeVisible();
    await page
      .locator(".page-intro")
      .getByRole("button", { name: "Add holding", exact: true })
      .click();
    await expect(page).toHaveURL(/\/holdings\/new$/u);
    await expect(
      page.getByRole("heading", { name: "Add holding", exact: true }),
    ).toBeVisible();
  },
);
