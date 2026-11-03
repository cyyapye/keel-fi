import { expect, test, type Page } from "./api-mocked-test";
import type { Request } from "@playwright/test";
import { HoldingSchema } from "../packages/domain/src/index";
import {
  AcceptPurchasesSchema,
  PurchaseReceiptSchema,
} from "../packages/domain/src/position-purchases";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
import { createInvestmentExposureView } from "../packages/domain/src/exposure-read-model";
import {
  ManualHoldingIdentityInputSchema,
  ManualHoldingInputSchema,
} from "../packages/domain/src/manual-holdings";
import {
  emptyInvestmentHoldingsView,
  investmentHoldingsViewFor,
} from "./investment-holdings-fixtures";
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
const positionId = "synthetic-manual-position";
const holding = () =>
  HoldingSchema.parse({
    id: positionId,
    companyId: null,
    positionName: "Synthetic Orchard Direct",
    exposureName: null,
    ownerLabel: "Demo Family LLC",
    positionKind: "direct",
    administratorNavMinor: null,
    administratorNavState: "not_set",
    externalMarkMinor: null,
    underwritingValueMinor: null,
    scenarioValueMinor: null,
    usableLiquidityMinor: null,
    sourceStatus: "manual",
    sourceLabel: "Entered by you",
    effectiveDate: "2026-11-01",
    retrievedAt: "2026-11-01T18:45:00.000Z",
    confidencePpm: null,
    investedMinor: null,
    committedMinor: null,
    realizedValueMinor: null,
    ticker: null,
    manualContext: {
      version: 1,
      containerId: "manual-owner",
      containerVersion: 1,
      companyMappingIds: [],
      classification: "private_paper",
    },
    purchaseContext: {
      snapshotId: "manual-snapshot",
      currency: "USD",
      openedOn: null,
      receipt: null,
    },
  });
function receiptWithCash(cashPaidMinor: number | null) {
  return PurchaseReceiptSchema.parse({
    id: "manual-initial-investment",
    positionId,
    snapshotId: "manual-snapshot",
    currency: "USD",
    acceptedAt: "2026-11-01T18:20:00.000Z",
    details: {
      cashCoversPosition: false,
      coversPosition: false,
      investmentTerms: unknownInvestmentTerms(),
      lots: [
        {
          id: "manual-initial-lot",
          purchasedOn: null,
          shareClass: null,
          priceMicros: null,
          referencePriceMicros: null,
          grossCashMinor: cashPaidMinor,
          netCapitalMinor: null,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: null,
          sharesAsOf: null,
          sourceLabel: null,
          sourceUrl: null,
          mark: null,
        },
      ],
    },
  });
}

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

async function setup(page: Page, currentHolding = holding) {
  let accepted = false;
  await page.clock.setFixedTime(new Date("2026-11-01T18:45:00.000Z"));
  await routeHoldingsPage(page, () => ({
    householdName: "Demo Household",
    holdings: accepted ? [currentHolding()] : [],
    investmentHoldings: emptyInvestmentHoldingsView,
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
  await page.goto("/holdings/new");
  await expect(
    page.getByRole("heading", { name: "Add holding", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Loading owner and company choices…", { exact: true }),
  ).toHaveCount(0);
  return {
    accept: () => {
      accepted = true;
    },
  };
}

test("keeps type controls stationary across project-owned viewport and disclosure states", async ({
  page,
}, testInfo) => {
  await routeOverviewReads(page);
  const widths = testInfo.project.use.isMobile ? [412] : [838, 1280];
  for (const width of widths) {
    for (const detailsOpen of [false, true]) {
      await test.step(`${width}px with details ${detailsOpen ? "open" : "closed"}`, async () => {
        await page.setViewportSize({ width, height: 978 });
        await setup(page);
        await fillIdentity(page);
        await page
          .getByRole("button", {
            name: "Add investment or valuation details",
            exact: true,
          })
          .click();
        await page
          .getByLabel("Cash paid · USD", { exact: true })
          .fill("125.50");
        await page
          .getByLabel("Estimated value · USD", { exact: true })
          .fill("150");
        if (!detailsOpen) {
          await page
            .getByRole("button", {
              name: "Investment and valuation",
              exact: true,
            })
            .click();
          await expect(
            page.getByLabel("Cash paid · USD", { exact: true }),
          ).not.toBeVisible();
        }
        const radios = page.getByRole("radiogroup", {
          name: "Investment type",
          exact: true,
        });
        const initial = await radios
          .getByRole("radio")
          .evaluateAll((elements) =>
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
        for (const [from, to, key] of transitions) {
          await page.getByRole("radio", { name: from, exact: true }).focus();
          await page.keyboard.press(key);
          const selected = page.getByRole("radio", { name: to, exact: true });
          await expect(selected).toBeChecked();
          await expect(selected).toBeFocused();
          const positions = await radios
            .getByRole("radio")
            .evaluateAll((elements) =>
              elements.map((element) => {
                const box = element.getBoundingClientRect();
                return { x: box.x + window.scrollX, y: box.y + window.scrollY };
              }),
            );
          expect(positions).toHaveLength(initial.length);
          for (const [index, position] of positions.entries()) {
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
        if (!detailsOpen) {
          await page
            .getByRole("button", {
              name: "Add investment or valuation details",
              exact: true,
            })
            .click();
        }
        await expect(
          page.getByLabel("Cash paid · USD", { exact: true }),
        ).toHaveValue("125.50");
        await expect(
          page.getByLabel("Estimated value · USD", { exact: true }),
        ).toHaveValue("150");
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(page).toHaveURL(/\/holdings$/u);
      });
    }
  }
});

test("uses the shared calendars with bounds, keyboard focus and field errors", async ({
  page,
}, testInfo) => {
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
  await expect(page.locator(`[id=${JSON.stringify(description)}]`)).toHaveText(
    "Leave blank if unknown.",
  );
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
    await page.screenshot({
      path: testInfo.outputPath(
        name === "Investment date"
          ? "manual-investment-calendar-open.png"
          : "manual-valuation-calendar-open.png",
      ),
      animations: "disabled",
    });
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
  await expect(page.getByLabel("Cash paid · USD", { exact: true })).toHaveValue(
    "125.50",
  );
});

test("keeps identity required and financial facts optional with inline errors", async ({
  page,
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

test("checks an uncertain save and retries the same submission only after a reliable no-match", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Save holding", exact: true }).click();
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
  await expect(page.getByLabel("Investment name", { exact: true })).toHaveValue(
    "Synthetic Orchard Direct",
  );
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
  await expect(page.getByLabel("Investment name", { exact: true })).toHaveValue(
    "Synthetic Orchard Direct",
  );
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
  await expect(page.getByText("Entered by you", { exact: true })).toBeVisible();
  await expect(page.getByText("$0", { exact: true })).toHaveCount(0);
});

test("finds a committed uncertain save without sending another POST", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Save holding", exact: true }).click();
  await page
    .getByRole("button", { name: "Check holdings", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`position=${positionId}`));
  expect(posts).toBe(1);
});

test("retains a rejected identity draft and requires reopening a stale revision", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.accept();
  await page.goto(`/holdings?position=${positionId}`);
  await page
    .getByRole("button", { name: "Edit holding details", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Investment name", { exact: true })
    .fill("Synthetic revised legal name");
  await capture(page, "manual-holding-identity-edit.png");
  let posts = 0;
  await page.route(
    `**/api/manual-holdings/${positionId}/identity`,
    async (route) => {
      const input = ManualHoldingIdentityInputSchema.parse(
        route.request().postDataJSON(),
      );
      expect(input.expectedVersion).toBe(1);
      expect(input.expectedMappingIds).toEqual([]);
      posts += 1;
      await route.fulfill({
        status: 409,
        json: { code: "stale", error: "The company grouping changed." },
      });
    },
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText(/Cancel and reopen holding details/u),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Investment name", { exact: true })).toHaveValue(
    "Synthetic revised legal name",
  );
  await capture(page, "manual-holding-identity-stale.png");
  await page.reload();
  await page
    .getByRole("button", { name: "Edit holding details", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Investment name", { exact: true })).toHaveValue(
    "Synthetic revised legal name",
  );
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit holding details", exact: true })
    .click();
  await expect(page.getByLabel("Investment name", { exact: true })).toHaveValue(
    "Synthetic Orchard Direct",
  );
});

test("restores drafts only within the authenticated household scope", async ({
  page,
}) => {
  await setup(page);
  await fillIdentity(page);
  let householdScope = "synthetic-other-household";
  await page.route("**/api/manual-holdings/options", (route) =>
    route.fulfill({ json: { ...options, householdScope } }),
  );
  await page.reload();
  await expect(page.getByLabel("Investment name", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("radio", { name: "Direct", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Save holding", exact: true }),
  ).toBeDisabled();
  householdScope = options.householdScope;
  await page.reload();
  await expect(page.getByLabel("Investment name", { exact: true })).toHaveValue(
    "Synthetic Orchard Direct",
  );
  await expect(
    page.getByRole("radio", { name: "Direct", exact: true }),
  ).toBeChecked();
});

test("searches more than 120 long owner and company labels with a bounded option list", async ({
  page,
}) => {
  await setup(page);
  const containers = Array.from({ length: 125 }, (_, index) => ({
    id: `synthetic-owner-${index}`,
    label: `Synthetic owner ${index} with a deliberately long legal account label for responsive selection`,
    version: 9,
  }));
  const companies = Array.from({ length: 125 }, (_, index) => ({
    id: `synthetic-company-${index}`,
    name: `Synthetic company ${index} with a deliberately long organization name for responsive selection`,
    revision: "synthetic-company-revision",
  }));
  const reads = new Set<Request>();
  const abortedReads = new Set<Request>();
  page.on("requestfailed", (request) => {
    if (
      request.url().endsWith("/api/manual-holdings/options") &&
      request.failure()?.errorText === "net::ERR_ABORTED"
    )
      abortedReads.add(request);
  });
  await page.route("**/api/manual-holdings/options", (route) => {
    reads.add(route.request());
    return route.fulfill({
      json: {
        householdScope: options.householdScope,
        containers,
        legalEntities: [],
        companies,
      },
    });
  });
  await page.reload();
  await page.getByRole("combobox", { name: "Held by", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(100);
  await expect(
    page.getByText(
      "Showing the first 100 matches. Keep typing to narrow the list.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Add an owner or account…", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Search owners and accounts", exact: true })
    .fill("owner 124");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page
    .getByRole("option", { name: containers[124]!.label, exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Company · optional", exact: true })
    .click();
  await expect(page.getByRole("option")).toHaveCount(100);
  await page
    .getByRole("combobox", { name: "Search companies", exact: true })
    .fill("no synthetic match");
  await expect(
    page.getByText("No matching companies.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Search companies", exact: true })
    .fill("company 124");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page
    .getByRole("option", { name: companies[124]!.name, exact: true })
    .click();
  await page
    .getByLabel("Investment name", { exact: true })
    .fill("Synthetic long-label investment");
  await page.getByRole("radio", { name: "Direct", exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Save holding", exact: true }),
  ).toBeEnabled();
  // Development StrictMode may abort its first mount probe. The working
  // editor still consumes one options response, independent of item count.
  expect(reads.size).toBeLessThanOrEqual(2);
  expect(
    [...reads].filter((request) => abortedReads.has(request)),
  ).toHaveLength(reads.size - 1);
  expect(
    [...reads].filter((request) => !abortedReads.has(request)),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("opens the dedicated editor from empty and regular Holdings and restores trigger focus on cancel", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const fixture = await setup(page);
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
  await page
    .locator(".page-intro")
    .getByRole("button", { name: "Add holding", exact: true })
    .click();
  await expect(page).toHaveURL(/\/holdings\/new$/u);
  await expect(
    page.getByRole("heading", { name: "Add holding", exact: true }),
  ).toBeVisible();
});

test("keeps a Fund company grouping distinct from unknown allocation", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("radio", { name: "Fund", exact: true }).check();
  await page
    .getByLabel("Fund name", { exact: true })
    .fill("Synthetic Orchard Fund");
  await select(page, "Held by", "Demo Family LLC");
  await select(page, "Company · optional", "Juniper Works");
  await expect(
    page.getByText("An underlying company. Fund allocation stays unknown.", {
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, "manual-holding-fund-company.png");
  let posted = false;
  await page.route("**/api/manual-holdings", async (route) => {
    const input = ManualHoldingInputSchema.parse(
      route.request().postDataJSON(),
    );
    expect(input.kind).toBe("fund_interest");
    expect(input.company).toEqual({
      mode: "existing",
      companyId: "demo-company",
      revision: "2026-10-01T12:00:00.000Z",
    });
    expect(input.cashPaidMinor).toBeNull();
    expect(input.valuation).toEqual({ state: "unknown" });
    posted = true;
    await route.fulfill({
      status: 400,
      json: { error: "Synthetic request rejected for readback." },
    });
  });
  await page.getByRole("button", { name: "Save holding", exact: true }).click();
  await expect.poll(() => posted).toBe(true);
});

test("preserves multiple current company groupings when only the legal name changes", async ({
  page,
}) => {
  const fixture = await setup(page, () => {
    const current = holding();
    return HoldingSchema.parse({
      ...current,
      companyId: null,
      manualContext: {
        ...current.manualContext,
        companyMappingIds: ["synthetic-mapping-one", "synthetic-mapping-two"],
      },
    });
  });
  fixture.accept();
  await page.goto(`/holdings?position=${positionId}`);
  await page
    .getByRole("button", { name: "Edit holding details", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Company · optional", exact: true }),
  ).toContainText("Keep current company groupings");
  await page
    .getByLabel("Investment name", { exact: true })
    .fill("Synthetic revised legal name");
  let posted = false;
  await page.route(
    `**/api/manual-holdings/${positionId}/identity`,
    async (route) => {
      const input = ManualHoldingIdentityInputSchema.parse(
        route.request().postDataJSON(),
      );
      expect(input.expectedMappingIds).toEqual([
        "synthetic-mapping-one",
        "synthetic-mapping-two",
      ]);
      expect(input.company).toEqual({ mode: "unchanged" });
      posted = true;
      await route.fulfill({
        status: 400,
        json: { error: "Synthetic identity rejected for readback." },
      });
    },
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => posted).toBe(true);
});

test("shows manual creation and only actual identity corrections in normal History", async ({
  page,
}) => {
  const initialInvestment = receiptWithCash(2_500_000);
  const initial = {
    name: "Synthetic Orchard Direct",
    kind: "direct",
    ownerLabel: "Demo Family LLC",
    companies: [],
  };
  const grouped = {
    name: "Synthetic Orchard Fund",
    kind: "fund_interest",
    ownerLabel: "Demo Trust",
    companies: [
      { id: "company-one", name: "Juniper Works" },
      { id: "company-two", name: "Synthetic Cedar" },
    ],
  };
  const final = {
    ...grouped,
    name: "Synthetic Orchard Fund Revised",
    companies: [...grouped.companies].reverse(),
  };
  const fixture = await setup(page, () =>
    HoldingSchema.parse({
      ...holding(),
      positionName: final.name,
      positionKind: final.kind,
      ownerLabel: final.ownerLabel,
      investedMinor: 2_500_000,
      purchaseContext: {
        snapshotId: "manual-snapshot",
        currency: "USD",
        openedOn: null,
        receipt: initialInvestment,
      },
    }),
  );
  await page.route(
    `**/api/investment-positions/${positionId}/history`,
    (route) =>
      route.fulfill({
        json: {
          entries: [
            {
              kind: "identity",
              receipt: {
                id: "identity-three",
                acceptedAt: "2026-11-01T18:40:00.000Z",
                value: final,
              },
              previous: grouped,
            },
            {
              kind: "identity",
              receipt: {
                id: "identity-two",
                acceptedAt: "2026-11-01T18:30:00.000Z",
                value: grouped,
              },
              previous: initial,
            },
            {
              kind: "identity",
              receipt: {
                id: "identity-one",
                acceptedAt: "2026-11-01T18:20:00.000Z",
                value: initial,
                initialInvestment,
              },
              previous: null,
            },
          ],
          next: null,
        },
      }),
  );
  await page.route("**/api/investment-position-links", (route) =>
    route.fulfill({ json: { positions: [], links: [] } }),
  );
  fixture.accept();
  await page.goto(`/holdings?position=${positionId}`);
  await page
    .getByRole("button", { name: "Sources & history", exact: true })
    .click();
  const history = page.locator(".holding-receipt-history");
  await expect(
    history.getByText("Holding created", { exact: true }),
  ).toBeVisible();
  const corrections = history.getByRole("button", {
    name: /Holding details corrected/u,
  });
  await expect(corrections).toHaveCount(2);
  await corrections.nth(0).click();
  await corrections.nth(1).click();
  await expect(history.getByText("Name", { exact: true })).toHaveCount(2);
  await expect(
    history.getByText("Investment type", { exact: true }),
  ).toHaveCount(1);
  await expect(history.getByText("Held by", { exact: true })).toHaveCount(1);
  await expect(history.getByText("Company", { exact: true })).toHaveCount(1);
  await expect(history).toContainText("Direct → Fund");
  await expect(history).toContainText("Demo Family LLC → Demo Trust");
  await expect(history).toContainText(
    "Unassigned → Juniper Works, Synthetic Cedar",
  );
  await expect(history).not.toContainText("Cleared");
  await history.getByRole("button", { name: /Holding created/u }).click();
  await expect(history.getByText("Cash paid", { exact: true })).toHaveCount(1);
  await expect(history.getByText("$25,000.00", { exact: true })).toBeVisible();
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await expect(page.locator(".holding-history")).toHaveScreenshot(
    "manual-holding-identity-history.png",
    { animations: "disabled" },
  );
});

test("reads current receipt cash instead of immutable initial cash after partial contributions change or clear", async ({
  page,
}) => {
  let receipt = receiptWithCash(2_500_000);
  const fixture = await setup(page, () =>
    HoldingSchema.parse({
      ...holding(),
      positionKind: "spv_interest",
      investedMinor: 2_500_000,
      purchaseContext: {
        snapshotId: "manual-snapshot",
        currency: "USD",
        openedOn: null,
        receipt,
      },
    }),
  );
  fixture.accept();
  let saves = 0;
  await page.route(
    `**/api/investment-positions/${positionId}/purchases`,
    async (route) => {
      const input = AcceptPurchasesSchema.parse(route.request().postDataJSON());
      expect(input.details.cashCoversPosition).toBe(false);
      saves += 1;
      receipt = PurchaseReceiptSchema.parse({
        ...receipt,
        id: `manual-cash-edit-${saves}`,
        details: input.details,
      });
      await route.fulfill({ json: receipt });
    },
  );
  await page.goto(`/holdings?position=${positionId}`);
  const detail = page.locator(".spv-holding");
  await expect(
    detail.getByRole("group", { name: "Cash paid", exact: true }),
  ).toContainText("$25,000.00");
  for (const value of ["26000", ""]) {
    await page
      .getByRole("button", { name: "Edit investment", exact: true })
      .click();
    await page.getByLabel("Cash paid · $", { exact: true }).fill(value);
    await detail
      .locator(".holding-investment")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: value ? "Edit investment" : "Add investment details",
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    if (value) {
      await expect(
        detail.getByRole("group", { name: "Cash paid", exact: true }),
      ).toContainText("$26,000.00");
      expect(receipt.details.lots[0]?.grossCashMinor).toBe(2_600_000);
    } else {
      await expect(
        detail.getByRole("group", { name: "Cash paid", exact: true }),
      ).toHaveCount(0);
      await expect(detail.getByText("$0.00", { exact: true })).toHaveCount(0);
      expect(receipt.details.lots[0]?.grossCashMinor).toBeNull();
    }
    await expect(detail.getByText("$25,000.00", { exact: true })).toHaveCount(
      0,
    );
    expect(receipt.details.cashCoversPosition).toBe(false);
  }
  expect(saves).toBe(2);
});

test("preserves a current single-company Fund grouping when only the name changes", async ({
  page,
}) => {
  const fixture = await setup(page, () => {
    const current = holding();
    return HoldingSchema.parse({
      ...current,
      companyId: "demo-company",
      positionKind: "fund_interest",
      manualContext: {
        ...current.manualContext,
        companyMappingIds: ["synthetic-fund-partial-400000-mapping"],
      },
    });
  });
  fixture.accept();
  await page.goto(`/holdings?position=${positionId}`);
  await page
    .getByRole("button", { name: "Edit holding details", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Company · optional", exact: true }),
  ).toContainText("Juniper Works");
  await page
    .getByLabel("Fund name", { exact: true })
    .fill("Synthetic renamed Fund");
  let posted = false;
  await page.route(
    `**/api/manual-holdings/${positionId}/identity`,
    async (route) => {
      const input = ManualHoldingIdentityInputSchema.parse(
        route.request().postDataJSON(),
      );
      expect(input.expectedMappingIds).toEqual([
        "synthetic-fund-partial-400000-mapping",
      ]);
      expect(input.company).toEqual({ mode: "unchanged" });
      posted = true;
      await route.fulfill({
        status: 400,
        json: { error: "Synthetic identity rejected for readback." },
      });
    },
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => posted).toBe(true);
});

test("does not present source cash as basis or return in manual inventory rows", async ({
  page,
}) => {
  const current = HoldingSchema.parse({
    ...holding(),
    positionKind: "fund_interest",
    investedMinor: 2_500_000,
  });
  await setup(page, () => current);
  await routeOverviewReads(page);
  const view = investmentHoldingsViewFor([current]);
  for (const connection of view.positionView.connections) {
    connection.adapterType = "manual";
    connection.institutionLabel = "Entered by you";
    for (const container of connection.containers)
      for (const position of container.positions) {
        position.manualContext = current.manualContext;
        position.ownershipBasis = "manual";
        position.snapshot.investedMinor = 2_500_000;
        position.snapshot.allocationMinor = null;
        position.snapshot.realizedValueMinor = null;
        const receipt = receiptWithCash(2_500_000);
        position.purchaseReceipt = PurchaseReceiptSchema.parse({
          ...receipt,
          snapshotId: position.snapshot.id,
          details: {
            ...receipt.details,
            investmentSnapshotId: position.snapshot.id,
            valuation: {
              snapshotId: position.snapshot.id,
              records: [
                {
                  id: "mine",
                  origin: "judgment",
                  totalMinor: 3_000_000,
                  priceMicros: null,
                  priceDate: null,
                  effectiveDate: "2026-10-15",
                  shareClass: null,
                  carryStatus: "before_carry",
                  sourceLabel: "Your estimate",
                  sourceUrl: null,
                  sourceEvidenceId: null,
                  sourcePositionId: null,
                  sourceCapturedAt: null,
                  watchEvidenceId: null,
                },
              ],
              selected: { recordId: "mine", method: "total", sharesKey: null },
            },
          },
        });
      }
  }
  view.exposureView = createInvestmentExposureView(view.positionView, [], []);
  expect(view.exposureView.positions[0]?.valueMinor).toBe(3_000_000);
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: [current],
    investmentHoldings: view,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.goto("/holdings");
  const row = page
    .locator(".unallocated-positions article")
    .filter({ hasText: current.positionName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("$30k");
  await expect(row).not.toContainText("Basis");
  await expect(row).not.toContainText("total return");
});

test("keeps company mappings unchanged when a mapped Direct holding is changed to Fund", async ({
  page,
}) => {
  const fixture = await setup(page, () => {
    const current = holding();
    return HoldingSchema.parse({
      ...current,
      companyId: "demo-company",
      manualContext: {
        ...current.manualContext,
        companyMappingIds: ["synthetic-direct-company-mapping"],
      },
    });
  });
  fixture.accept();
  await page.goto(`/holdings?position=${positionId}`);
  await page
    .getByRole("button", { name: "Edit holding details", exact: true })
    .click();
  await page.getByRole("radio", { name: "Fund", exact: true }).check();
  let posted = false;
  await page.route(
    `**/api/manual-holdings/${positionId}/identity`,
    async (route) => {
      const input = ManualHoldingIdentityInputSchema.parse(
        route.request().postDataJSON(),
      );
      expect(input.kind).toBe("fund_interest");
      expect(input.company).toEqual({ mode: "unchanged" });
      expect(input.expectedMappingIds).toEqual([
        "synthetic-direct-company-mapping",
      ]);
      posted = true;
      await route.fulfill({
        status: 400,
        json: { error: "Synthetic identity rejected for readback." },
      });
    },
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => posted).toBe(true);
});
