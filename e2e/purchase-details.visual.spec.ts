import { expect, test, type Page, type Locator } from "@playwright/test";
import { HoldingSchema } from "../packages/domain/src/index";
import {
  PurchaseReceiptSchema,
  estimatePurchaseValue,
  reviewedInvestmentFromReceipt,
  estimatePurchaseCapital,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";

async function screenshotHolding(page: Page, name: string) {
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await expect(page.locator(".holding-detail-workspace")).toHaveScreenshot(
    name,
    {
      animations: "disabled",
    },
  );
}

async function showPurchases(page: Page) {
  const toggle = page.getByRole("button", { name: /^Purchases & refunds/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}

async function showTerms(section: Locator) {
  const toggle = section.getByRole("button", {
    name: "Fees & carry",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}

test("allocation refunds preview upfront fees, preserve unknown capital and reconcile received cash", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.clock.setFixedTime(new Date("2026-09-20T12:00:00.000Z"));
  let receipt: PurchaseReceipt | null = null;
  let reject = false;
  const holding = () =>
    HoldingSchema.parse({
      id: "refund-spv",
      companyId: "synthetic-refund-company",
      positionName: "Synthetic Allocation SPV",
      exposureName: "Synthetic Allocation Company",
      ownerLabel: "Demo Family LLC",
      positionKind: "spv_interest",
      administratorNavMinor: 900000,
      administratorNavState: "reported",
      externalMarkMinor: null,
      underwritingValueMinor: null,
      scenarioValueMinor: null,
      usableLiquidityMinor: null,
      sourceStatus: "verified",
      sourceLabel: "Synthetic statement",
      effectiveDate: "2026-09-01",
      retrievedAt: "2026-09-01T12:00:00.000Z",
      confidencePpm: null,
      investedMinor: 640000,
      committedMinor: 640000,
      realizedValueMinor: 0,
      instrumentType: "SPV interest",
      positionValueContext: {
        snapshotId: "synthetic-refund-snapshot",
        currency: "USD",
        providerValueState: "not_reported",
        providerValueMinor: null,
        acceptedAdjustment: null,
        projectedEstimate: null,
      },
      positionEconomicsContext: {
        snapshotId: "synthetic-refund-snapshot",
        currency: "USD",
        committedMinor: 640000,
        fundedMinor: 640000,
        acceptedTerms: null,
        reportedTerms: null,
        reviewedInvestment: reviewedInvestmentFromReceipt(receipt),
      },
      purchaseContext: {
        snapshotId: "synthetic-refund-snapshot",
        currency: "USD",
        openedOn: "2026-03-01",
        receipt,
      },
    });
  await routeHoldingsPage(page, () => ({
    householdName: "Demo Household",
    holdings: [holding()],
    investmentHoldings: investmentHoldingsViewFor([holding()]),
    acceptedCashAccounts: [],
    pendingImports: [],
  }));
  await page.route(
    "**/api/investment-positions/refund-spv/share-price-evidence",
    (route) => route.fulfill({ json: { prices: [], watch: [] } }),
  );
  await page.route(
    "**/api/investment-positions/refund-spv/purchases",
    async (route) => {
      if (reject) {
        await route.fulfill({
          status: 409,
          json: { error: "The position changed. Review again." },
        });
        return;
      }
      const input = route.request().postDataJSON();
      receipt = PurchaseReceiptSchema.parse({
        id: `synthetic-refund-${receipt ? "changed" : "initial"}`,
        positionId: "refund-spv",
        snapshotId: input.expectedSnapshotId,
        currency: "USD",
        details: input.details,
        acceptedAt: "2026-09-20T12:00:00.000Z",
      });
      await route.fulfill({ status: 201, json: receipt });
    },
  );
  const openPosition = async () => {
    await page
      .getByRole("button", { name: /Synthetic Allocation Company 1 position/u })
      .click();
    await page
      .getByRole("button", {
        name: "View Synthetic Allocation SPV holding details",
      })
      .click();
  };
  await page.goto("/holdings");
  await openPosition();
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await screenshotHolding(page, "holding-purchases-empty.png");
  const section = page.getByRole("region", {
    name: "Investment details",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Edit purchases", exact: true })
    .click();
  const cash = section.getByRole("textbox", {
    name: "Cash paid · USD",
    exact: true,
  });
  const net = section.getByRole("textbox", {
    name: "Net capital invested · USD",
    exact: true,
  });
  const save = section.getByRole("button", {
    name: "Save investment details",
    exact: true,
  });
  await cash.fill("6400");
  await section
    .getByRole("button", { name: "Capital refund (optional)", exact: true })
    .click();
  await section
    .getByRole("textbox", { name: "Capital refund · USD", exact: true })
    .fill("1543.21");
  await section
    .getByRole("button", {
      name: "Underlying shares and source evidence (optional)",
      exact: true,
    })
    .click();
  await section
    .getByRole("textbox", { name: "One-time fee · %", exact: true })
    .fill("9");
  await section
    .getByRole("combobox", { name: "Fee basis", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Deducted from gross cash", exact: true })
    .click();
  await section
    .getByRole("checkbox", {
      name: "These purchases include all cash paid for this position.",
    })
    .check();
  const calculation = section.getByLabel("Purchase capital calculation");
  await expect(calculation).toContainText("4,856.79");
  await expect(calculation).toContainText("437.11");
  await expect(calculation).toContainText("4,419.68");
  await expect(calculation).toContainText("Expected");
  await expect(net).toHaveValue("");
  await expect(
    section.getByRole("textbox", {
      name: "Upfront deductions · USD",
      exact: true,
    }),
  ).toHaveValue("");
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(section).toHaveScreenshot("allocation-refund-estimate.png", {
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  if (info.project.name === "mobile-chromium")
    expect(
      await save.evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
  reject = true;
  await save.click();
  await expect(section).toContainText("The position changed. Review again.");
  await expect(
    section.getByRole("textbox", { name: "Capital refund · USD", exact: true }),
  ).toHaveValue("1543.21");
  reject = false;
  await save.click();
  expect(
    estimatePurchaseCapital(
      PurchaseReceiptSchema.parse(receipt).details.lots[0]!,
    )?.netCapitalMinor,
  ).toBe(441968);
  expect(reviewedInvestmentFromReceipt(receipt)).toMatchObject({
    cashPaidMinor: 640000,
    netCapitalMinor: null,
    returnedCapitalMinor: 0,
  });
  await page.getByRole("button", { name: /^Purchases & refunds/ }).click();
  await screenshotHolding(page, "holding-refund-expected-summary.png");
  await showPurchases(page);
  await section
    .locator(".purchase-summary__heading [data-slot=collapsible-trigger]")
    .click();
  await expect(section).toContainText("Estimated net capital");
  await page.reload();
  await openPosition();
  await page
    .getByRole("button", { name: "Edit purchases", exact: true })
    .click();
  await expect(net).toHaveValue("");
  await expect(save).toBeDisabled();
  await section
    .getByRole("combobox", { name: "Capital refund status", exact: true })
    .click();
  await page.getByRole("option", { name: "Received", exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(
    section.getByRole("button", {
      name: "Capital refund received on (optional)",
      exact: true,
    }),
  ).toContainText("Choose date");
  await expect(section).toContainText("Choose Unknown if unsure.");
  await expect(section).toContainText("Return stays unknown until you confirm");
  await expect(
    section
      .getByRole("button", {
        name: "Capital refund (optional)",
        exact: true,
      })
      .locator(".."),
  ).toHaveScreenshot("allocation-refund-received.png", {
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await save.click();
  await expect(
    page.getByRole("region", { name: "Position summary" }),
  ).toContainText("Unavailable");
  await expect(
    page.getByRole("button", { name: "Confirm refund", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Purchases & refunds/ }).click();
  await screenshotHolding(page, "holding-refund-needs-review.png");
  await page
    .getByRole("button", { name: "Confirm refund", exact: true })
    .click();
  await section
    .getByRole("combobox", {
      name: "Refund already in reported distributions?",
      exact: true,
    })
    .click();
  await page.getByRole("option", { name: "Not included", exact: true }).click();
  await net.fill("4419.68");
  await expect(section).not.toContainText("Estimated capital from upfront fee");
  await save.click();
  expect(
    PurchaseReceiptSchema.parse(receipt).details.lots[0]!.capitalReturn,
  ).toMatchObject({ status: "received", effectiveDate: null });
  expect(reviewedInvestmentFromReceipt(receipt)).toMatchObject({
    cashPaidMinor: 640000,
    returnedCapitalMinor: 154321,
    additionalReturnedCapitalMinor: 154321,
    netCapitalMinor: 441968,
    upfrontDeductionsMinor: 43711,
  });
  await showPurchases(page);
  await expect(section).toContainText("Cash retained: USD 4,856.79");
  await expect(section).not.toContainText("Estimated net capital");
  await page.reload();
  await openPosition();
  await showPurchases(page);
  await expect(section).toContainText("Received capital refunds: USD 1,543.21");
  await expect(section).toContainText("Date unknown");
});

test("unified investment details reconcile cash, retain failed drafts and share one saved record", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.clock.setFixedTime(new Date("2026-09-20T12:00:00.000Z"));
  let receipt: PurchaseReceipt | null = null;
  let reject = false;
  let attempts = 0;
  const proxyEvidence = false;
  const reportedValue = true;
  let currentValueSnapshotId = "snapshot_purchase-spv";
  const holding = () =>
    HoldingSchema.parse({
      id: "purchase-spv",
      companyId: "synthetic-company",
      positionName: "Synthetic Purchase SPV",
      exposureName: "Synthetic Purchase Company",
      ownerLabel: "Demo Family LLC",
      positionKind: "spv_interest",
      administratorNavMinor: reportedValue ? 420000 : null,
      administratorNavState: reportedValue ? "reported" : "not_set",
      shareValueEstimate: estimatePurchaseValue(
        receipt,
        "snapshot_purchase-spv",
      ),
      externalMarkMinor: null,
      underwritingValueMinor: null,
      scenarioValueMinor: null,
      usableLiquidityMinor: null,
      sourceStatus: "verified",
      sourceLabel: "Synthetic import",
      effectiveDate: "2026-09-01",
      retrievedAt: "2026-09-01T12:00:00.000Z",
      confidencePpm: null,
      investedMinor: 110000,
      committedMinor: 110000,
      realizedValueMinor: 0,
      instrumentType: "SPV interest",
      positionValueContext: {
        snapshotId: "snapshot_purchase-spv",
        currency: "USD",
        providerValueState: "not_reported",
        providerValueMinor: null,
        acceptedAdjustment: null,
        projectedEstimate: null,
      },
      positionEconomicsContext: {
        snapshotId: "snapshot_purchase-spv",
        currency: "USD",
        committedMinor: 211234,
        fundedMinor: 211234,
        acceptedTerms: null,
        reportedTerms: null,
        reviewedInvestment: reviewedInvestmentFromReceipt(receipt),
      },
      purchaseContext: {
        reportedValueSnapshotId: currentValueSnapshotId,
        reportedValueMinor: 420000,
        reportedSourceLabel: "Synthetic import",
        snapshotId: "snapshot_purchase-spv",
        currency: "USD",
        openedOn: "2026-01-01",
        receipt,
      },
    });
  await routeHoldingsPage(page, () => ({
    householdName: "Demo Household",
    holdings: [holding()],
    investmentHoldings: investmentHoldingsViewFor([holding()]),
    acceptedCashAccounts: [],
    pendingImports: [],
  }));
  await page.route(
    "**/api/investment-positions/purchase-spv/purchases",
    async (route) => {
      attempts++;
      if (reject) {
        await route.fulfill({
          status: 409,
          json: { error: "The position changed. Review again." },
        });
        return;
      }
      const input = route.request().postDataJSON();
      receipt = PurchaseReceiptSchema.parse({
        id: `receipt-${attempts}`,
        positionId: "purchase-spv",
        snapshotId: input.expectedSnapshotId,
        currency: "USD",
        details: input.details,
        acceptedAt: "2026-09-01T12:00:00.000Z",
      });
      await route.fulfill({ status: 201, json: receipt });
    },
  );
  await page.route(
    "**/api/investment-positions/purchase-spv/share-price-evidence",
    (route) =>
      route.fulfill({
        json: {
          prices: [
            {
              id: "synthetic-price",
              positionId: "other-spv",
              positionLabel: "Synthetic Related SPV",
              sourceLabel: "Tokenfolio",
              observedAt: "2026-09-01T00:00:00.000Z",
              capturedAt: "2026-09-02T12:00:00.000Z",
              costMicros: 10000000,
              markMicros: 20000000,
              markDate: proxyEvidence ? null : "2026-09-01",
              shareClass: proxyEvidence ? "Common" : "Series B",
            },
          ],
          watch: [
            {
              id: "synthetic-news",
              title: "Synthetic company financing",
              url: "https://example.com/financing",
              publishedAt: "2026-09-02T00:00:00.000Z",
              fact: "A financing was announced; company-level context only.",
            },
          ],
        },
      }),
  );
  await page.goto("/holdings");
  await page
    .getByRole("button", { name: /Synthetic Purchase Company 1 position/u })
    .click();
  await page
    .getByRole("button", {
      name: "View Synthetic Purchase SPV holding details",
    })
    .click();
  const section = page.getByRole("region", {
    name: "Investment details",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Edit purchases", exact: true })
    .click();
  await expect(
    section.getByRole("heading", { name: "Purchases", exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Purchase 1", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    section.getByRole("group", { name: "Purchase 1", exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: /Remove purchase/ }),
  ).toHaveCount(0);
  if (info.project.name === "mobile-chromium")
    expect(
      await section
        .getByRole("button", { name: "Add another purchase", exact: true })
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
  const cash = section.getByRole("textbox", {
    name: "Cash paid · USD",
    exact: true,
  });
  const deductions = section.getByRole("textbox", {
    name: "Upfront deductions · USD",
    exact: true,
  });
  const net = section.getByRole("textbox", {
    name: "Net capital invested · USD",
    exact: true,
  });
  const save = section.getByRole("button", {
    name: "Save investment details",
    exact: true,
  });
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await screenshotHolding(page, "holding-detail-editing.png");
  if (info.project.name === "mobile-chromium") {
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ ...viewport, width: 320 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.setViewportSize(viewport);
  }
  await cash.fill("2400");
  await net.fill("2112.34");
  await section
    .getByRole("checkbox", {
      name: "These purchases include all cash paid for this position.",
    })
    .check();
  await showTerms(section);
  await section.getByRole("textbox", { name: "Carry on gains · %" }).fill("20");
  await section.getByRole("combobox", { name: "Carry gains above" }).click();
  await page
    .getByRole("option", { name: "Net capital invested", exact: true })
    .click();
  await section
    .getByRole("combobox", { name: "Imported amount represents" })
    .click();
  await page
    .getByRole("option", { name: "Net capital invested", exact: true })
    .click();
  await section
    .getByRole("combobox", { name: "Reported value carry status" })
    .click();
  await page.getByRole("option", { name: "Before carry", exact: true }).click();
  await expect(
    section.getByRole("textbox", { name: "Annual management fee · %" }),
  ).toHaveValue("");
  await expect(section).toContainText("287.66");
  await expect(
    section.getByRole("textbox", { name: "Annual management fee · %" }),
  ).toHaveValue("");
  await expect(save).toBeEnabled();
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(section).toHaveScreenshot("investment-details-draft.png", {
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  if (info.project.name === "mobile-chromium")
    expect(
      await save.evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
  await deductions.fill("1");
  await expect(section).toContainText("do not reconcile");
  await expect(save).toBeDisabled();
  await deductions.fill("");
  reject = true;
  await save.click();
  await expect(section).toContainText("The position changed. Review again.");
  await expect(cash).toHaveValue("2400");
  await expect(net).toHaveValue("2112.34");
  reject = false;
  await save.click();
  expect(
    PurchaseReceiptSchema.parse(receipt).details.investmentTerms,
  ).toMatchObject({
    carryPpm: 200000,
    annualManagementFeePpm: null,
    importedAmountBasis: "net_capital",
  });
  expect(PurchaseReceiptSchema.parse(receipt).details.lots[0]).toMatchObject({
    grossCashMinor: 240000,
    netCapitalMinor: 211234,
    upfrontDeductionsMinor: null,
  });
  await showPurchases(page);
  await expect(
    section.getByRole("button", { name: "Edit investment details" }),
  ).toBeVisible();
  await expect(section).toContainText("2,400.00");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  // The navigation is hidden for capture, so its scroll offset would crop
  // a saved summary that is just shorter than the desktop viewport.
  await page.addStyleTag({
    content:
      ".purchase-details { scroll-margin-top: 0 !important; } html { text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }",
  });
  await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(section).toHaveScreenshot("investment-details-saved.png", {
    animations: "disabled",
  });
  await page.reload();
  await page
    .getByRole("button", { name: /Synthetic Purchase Company 1 position/u })
    .click();
  await page
    .getByRole("button", {
      name: "View Synthetic Purchase SPV holding details",
    })
    .click();
  const edit = page.getByRole("button", {
    name: "Edit purchases",
    exact: true,
  });
  await edit.click();
  await showTerms(section);
  await expect(save).toBeDisabled();
  await expect(deductions).toHaveValue("287.66");
  await section.getByRole("textbox", { name: "Carry on gains · %" }).fill("25");
  await save.click();
  expect(
    PurchaseReceiptSchema.parse(receipt).details.investmentTerms?.carryPpm,
  ).toBe(250000);
  await edit.click();
  await showTerms(section);
  await cash.fill("2600");
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await edit.click();
  await showTerms(section);
  await expect(cash).toHaveValue("2400");
  await expect(save).toBeDisabled();
  await expect(
    section.getByRole("button", { name: /Remove purchase/ }),
  ).toHaveCount(0);
  await section
    .getByRole("button", { name: "Add another purchase", exact: true })
    .click();
  await expect(
    section.getByRole("heading", { name: "Purchases", exact: true }),
  ).toBeVisible();
  const firstPurchase = section.getByRole("button", {
    name: "Purchase 1",
    exact: true,
  });
  const secondPurchase = section.getByRole("button", {
    name: "Purchase 2",
    exact: true,
  });
  await expect(firstPurchase).toHaveAttribute("aria-expanded", "false");
  await expect(secondPurchase).toHaveAttribute("aria-expanded", "false");
  await expect(cash).toHaveCount(0);
  await expect(
    section.getByRole("group", { name: /^Purchase 1\b/ }),
  ).toBeVisible();
  await expect(
    section.getByRole("group", { name: /^Purchase 2\b/ }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: /Remove purchase/ }),
  ).toHaveCount(2);
  if (info.project.name === "mobile-chromium") {
    expect(
      await firstPurchase.evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    expect(
      await section
        .getByRole("button", { name: "Remove purchase 2", exact: true })
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
  }
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(section.locator("form")).toHaveScreenshot(
    "investment-details-multiple-purchases.png",
    {
      animations: "disabled",
    },
  );
  await secondPurchase.press("Enter");
  await expect(secondPurchase).toHaveAttribute("aria-expanded", "true");
  await section
    .getByRole("textbox", { name: "Cash paid · USD", exact: true })
    .fill("1200");
  await section
    .getByRole("textbox", { name: "Upfront deductions · USD", exact: true })
    .fill("200");
  await expect(section).toContainText("3,600.00");
  await secondPurchase.click();
  await expect(secondPurchase).toHaveAttribute("aria-expanded", "false");
  await section
    .getByRole("button", { name: "Remove purchase 2", exact: true })
    .click();
  await expect(firstPurchase).toHaveAttribute("aria-expanded", "true");
  await expect(cash).toHaveValue("2400");
  await expect(
    section.getByRole("button", { name: /Remove purchase/ }),
  ).toHaveCount(0);
  await section.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(firstPurchase).toHaveAttribute("aria-expanded", "false");
  await expect(secondPurchase).toHaveAttribute("aria-expanded", "false");
  await secondPurchase.click();
  await expect(
    section.getByRole("textbox", { name: "Cash paid · USD", exact: true }),
  ).toHaveValue("1200");
  await save.click();
  expect(PurchaseReceiptSchema.parse(receipt).details.lots).toMatchObject([
    { grossCashMinor: 240000, netCapitalMinor: 211234 },
    { grossCashMinor: 120000, upfrontDeductionsMinor: 20000 },
  ]);
  await screenshotHolding(page, "holding-multiple-purchases.png");
  await section
    .getByRole("button", { name: "Edit purchase 2", exact: true })
    .click();
  await expect(firstPurchase).toHaveAttribute("aria-expanded", "false");
  await expect(secondPurchase).toHaveAttribute("aria-expanded", "true");
  await expect(
    section.getByRole("textbox", { name: "Cash paid · USD", exact: true }),
  ).toHaveValue("1200");
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await edit.click();
  await showTerms(section);
  await expect(save).toBeDisabled();
  await expect(firstPurchase).toHaveAttribute("aria-expanded", "false");
  await expect(secondPurchase).toHaveAttribute("aria-expanded", "false");
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Value & return", exact: true })
    .click();

  await page.getByRole("textbox", { name: /Value · USD/ }).fill("6000");
  await edit.click();
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Value · USD/ })).toHaveValue(
    "6000",
  );
  await page
    .locator(".position-value-adjustment")
    .getByRole("button", { name: "Reset", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Calculate from shares", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Share-based valuation" })
      .getByRole("link", { name: "Edit investment details" }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("region", { name: "Share-based valuation" })
      .getByRole("textbox")
      .count(),
  ).toBe(0);
  await page
    .getByRole("region", { name: "Share-based valuation" })
    .getByRole("link", { name: "Edit investment details" })
    .click();
  await expect(
    section.getByRole("heading", {
      name: "Edit investment details",
      exact: true,
    }),
  ).toBeFocused();
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  // A new source snapshot with the same mark must not inherit its carry status.
  currentValueSnapshotId = "synthetic-linked-refresh";
  await page.reload();
  await page
    .getByRole("button", { name: /Synthetic Purchase Company 1 position/u })
    .click();
  await page
    .getByRole("button", {
      name: "View Synthetic Purchase SPV holding details",
    })
    .click();
  await edit.click();
  await showTerms(section);
  await expect(
    section.getByRole("combobox", { name: "Reported value carry status" }),
  ).toContainText("Unknown");
  await expect(
    section.getByRole("textbox", { name: "Carry on gains · %" }),
  ).toHaveValue("25");
  await expect(save).toBeEnabled();
  for (let i = 0; i < 2; i++) {
    const purchase = section.locator("fieldset.purchase-fields").nth(i);
    await purchase
      .getByRole("button", { name: `Purchase ${i + 1}`, exact: true })
      .click();
    await purchase
      .getByRole("button", { name: /Underlying shares and source evidence/ })
      .click();
    await purchase
      .getByRole("textbox", { name: "Underlying share class", exact: true })
      .fill("Series B");
    await purchase
      .getByRole("textbox", { name: "Purchase source", exact: true })
      .fill(`Synthetic executed receipt ${i + 1}`);
    await purchase
      .getByRole("textbox", { name: "Purchase price / share · USD" })
      .fill("10");
    await purchase
      .getByRole("button", { name: /Remaining underlying shares/ })
      .click();
    await purchase
      .getByRole("checkbox", { name: /No sales, splits or conversions/ })
      .check();
    await purchase
      .getByRole("button", { name: "Valuation price evidence", exact: true })
      .click();
    await purchase
      .getByRole("button", { name: /Available share price evidence/ })
      .click();
    await purchase
      .getByRole("button", { name: "Use this price", exact: true })
      .click();
    await purchase
      .getByRole("checkbox", {
        name: "I confirmed this price applies to the same underlying share class.",
      })
      .check();
  }
  await section
    .getByRole("checkbox", {
      name: "These purchases cover all my remaining shares in this SPV.",
    })
    .check();
  await save.click();
  expect(
    PurchaseReceiptSchema.parse(receipt).details.investmentTerms
      ?.reportedValueReview,
  ).toMatchObject({
    sourceSnapshotId: "synthetic-linked-refresh",
    carryStatus: "unknown",
    effectiveDate: null,
  });
  await page.getByRole("button", { name: /^Fees & carry/ }).click();
  await expect(page.locator(".holding-investment-details")).toContainText(
    "6,224.68",
  );
  await page
    .getByRole("button", { name: "Value & return", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Calculate from shares", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Share-based valuation" }),
  ).toContainText("6,224.68");
});
