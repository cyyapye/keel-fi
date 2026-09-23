import { expect, test } from "@playwright/test";
import { HoldingSchema } from "../packages/domain/src/index";
import {
  PurchaseReceiptSchema,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { navigateToScreen } from "./navigation";

test("optional purchase details preserve drafts, review and reload shares", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date("2026-09-20T12:00:00.000Z"));
  let receipt: PurchaseReceipt | null = null;
  let reject = false;
  const holding = () =>
    HoldingSchema.parse({
      id: "purchase-spv",
      companyId: "synthetic-company",
      positionName: "Synthetic Purchase SPV",
      exposureName: "Synthetic Purchase Company",
      ownerLabel: "Demo Family LLC",
      positionKind: "spv_interest",
      administratorNavMinor: 150000,
      administratorNavState: "reported",
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
      purchaseContext: {
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
      if (reject) {
        await route.fulfill({
          status: 409,
          json: { error: "The position changed. Review again." },
        });
        return;
      }
      const input = route.request().postDataJSON();
      receipt = PurchaseReceiptSchema.parse({
        id: `receipt-${receipt ? "2" : "1"}`,
        positionId: "purchase-spv",
        snapshotId: input.expectedSnapshotId,
        currency: "USD",
        details: input.details,
        acceptedAt: "2026-09-01T12:00:00.000Z",
      });
      await route.fulfill({ status: 201, json: receipt });
    },
  );
  await page.goto("/");
  await navigateToScreen(
    page,
    info.project.name === "mobile-chromium",
    "Holdings",
  );
  await page
    .getByRole("button", { name: /Synthetic Purchase Company 1 position/u })
    .click();
  await page
    .getByRole("button", {
      name: "View Synthetic Purchase SPV holding details",
    })
    .click();
  const section = page.getByRole("region", {
    name: "Purchase details",
    exact: true,
  });
  await expect(
    section.getByRole("button", { name: "Add purchase details" }),
  ).toBeVisible();
  await section.getByRole("button", { name: "Add purchase details" }).click();
  await expect(
    section.getByRole("textbox", { name: "Purchase source", exact: true }),
  ).toHaveValue("Synthetic import");
  await section
    .getByRole("textbox", { name: "Underlying share class", exact: true })
    .fill("Series B");
  await section
    .getByRole("textbox", { name: "Purchase price / share · USD", exact: true })
    .fill("12.50");
  await section
    .getByText("Capital and share calculation", { exact: true })
    .click();
  await section
    .getByRole("textbox", { name: "Gross cash contributed · USD", exact: true })
    .fill("1100");
  await section
    .getByRole("textbox", { name: "One-time fee · %", exact: true })
    .fill("10");
  await section.getByRole("combobox", { name: "Fee basis" }).click();
  await page.getByRole("option", { name: "Added to share capital" }).click();
  await section.getByRole("checkbox", { name: /No sales, splits/u }).check();
  await section.getByText("Valuation price evidence", { exact: true }).click();
  await section
    .getByRole("textbox", {
      name: "Valuation price / share · USD",
      exact: true,
    })
    .fill("20");
  await section
    .getByRole("textbox", { name: "Valuation share class", exact: true })
    .fill("Series B");
  await section
    .getByRole("textbox", { name: "Valuation source", exact: true })
    .fill("Synthetic GP statement");
  await section
    .getByRole("checkbox", { name: /These purchases cover/u })
    .check();
  // Use the shared accessible calendar.
  await section
    .getByRole("button", { name: "Valuation price as of", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tuesday, September 1, 2026", exact: true })
    .click();
  await section
    .getByRole("textbox", { name: "Valuation source", exact: true })
    .focus();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.soft(page).toHaveScreenshot("purchase-form.png", {
    animations: "disabled",
    fullPage: true,
  });
  await section
    .getByRole("button", { name: "Review purchase details", exact: true })
    .click();
  await expect(
    section.getByText("80 shares × $20", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.soft(page).toHaveScreenshot("purchase-review.png", {
    animations: "disabled",
    fullPage: true,
  });
  reject = true;
  await section
    .getByRole("button", { name: "Save purchase details", exact: true })
    .click();
  await expect(
    section.getByText("The position changed. Review again."),
  ).toBeVisible();
  await section.getByRole("button", { name: "Back to edit" }).click();
  await expect(
    section.getByRole("textbox", {
      name: "Purchase price / share · USD",
      exact: true,
    }),
  ).toHaveValue("12.50");
  reject = false;
  await section
    .getByRole("button", { name: "Review purchase details", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Save purchase details", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Edit purchases" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.soft(page).toHaveScreenshot("purchase-saved.png", {
    animations: "disabled",
    fullPage: true,
  });
  await page.reload();
  await navigateToScreen(
    page,
    info.project.name === "mobile-chromium",
    "Holdings",
  );
  await page
    .getByRole("button", { name: /Synthetic Purchase Company 1 position/u })
    .click();
  await page
    .getByRole("button", {
      name: "View Synthetic Purchase SPV holding details",
    })
    .click();
  await expect(
    section.getByText("80 shares × $20", { exact: false }),
  ).toBeVisible();
  await section.getByRole("button", { name: "Edit purchases" }).click();
  await section
    .getByRole("textbox", { name: "Purchase price / share · USD", exact: true })
    .fill("10");
  await section
    .getByRole("button", { name: "Review purchase details", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Save purchase details", exact: true })
    .click();
  await expect(
    section.getByText("100 shares × $20", { exact: false }),
  ).toBeVisible();
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
});
