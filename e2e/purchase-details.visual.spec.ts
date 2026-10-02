import { expect, test } from "@playwright/test";
import { HoldingSchema } from "../packages/domain/src/index";
import {
  PurchaseReceiptSchema,
  estimatePurchaseValue,
  reviewedInvestmentFromReceipt,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";

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
  await section.getByRole("button", { name: "Add investment details" }).click();
  await expect(
    section.getByRole("heading", { name: "Purchases · 1", exact: true }),
  ).toBeVisible();
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
  await cash.fill("2400");
  await net.fill("2112.34");
  await section
    .getByRole("checkbox", {
      name: "These purchases include all cash paid for this position.",
    })
    .check();
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
  await expect(section).toContainText("Annual management fees are unknown");
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
  await expect(
    section.getByRole("button", { name: "Edit investment details" }),
  ).toBeVisible();
  await expect(section).toContainText("2,400.00");
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
  const edit = section.getByRole("button", {
    name: "Edit investment details",
    exact: true,
  });
  await edit.click();
  await expect(save).toBeDisabled();
  await expect(deductions).toHaveValue("287.66");
  await section.getByRole("textbox", { name: "Carry on gains · %" }).fill("25");
  await save.click();
  expect(
    PurchaseReceiptSchema.parse(receipt).details.investmentTerms?.carryPpm,
  ).toBe(250000);
  await edit.click();
  await cash.fill("2600");
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await edit.click();
  await expect(cash).toHaveValue("2400");
  await expect(save).toBeDisabled();
  await expect(
    section.getByRole("button", { name: /Remove purchase/ }),
  ).toHaveCount(0);
  await section
    .getByRole("button", { name: "Add another purchase", exact: true })
    .click();
  await expect(
    section.getByRole("heading", { name: "Purchases · 2", exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: /Remove purchase/ }),
  ).toHaveCount(2);
  await expect(
    section.locator(".purchase-collection-heading"),
  ).toHaveScreenshot("investment-details-multiple-purchases.png", {
    animations: "disabled",
  });
  await section
    .getByRole("textbox", { name: "Cash paid · USD", exact: true })
    .nth(1)
    .fill("1200");
  await section
    .getByRole("textbox", { name: "Upfront deductions · USD", exact: true })
    .nth(1)
    .fill("200");
  await expect(section).toContainText("3,600.00");
  await section
    .getByRole("button", { name: "Remove purchase 2", exact: true })
    .click();
  await expect(
    section.getByRole("heading", { name: "Purchases · 1", exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: /Remove purchase/ }),
  ).toHaveCount(0);
  await section.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    section.getByRole("heading", { name: "Purchases · 2", exact: true }),
  ).toBeVisible();
  await expect(
    section
      .getByRole("textbox", { name: "Cash paid · USD", exact: true })
      .nth(1),
  ).toHaveValue("1200");
  await save.click();
  expect(PurchaseReceiptSchema.parse(receipt).details.lots).toHaveLength(2);
  await edit.click();
  await expect(save).toBeDisabled();
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByText("Position value", { exact: true }).click();
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
  await expect(section).toContainText("6,224.68");
  await page.getByText("Position value", { exact: true }).click();
  await page
    .getByRole("tab", { name: "Calculate from shares", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Share-based valuation" }),
  ).toContainText("6,224.68");
});
