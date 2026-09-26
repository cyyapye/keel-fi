import { expect, test } from "@playwright/test";
import { HoldingSchema } from "../packages/domain/src/index";
import {
  PurchaseReceiptSchema,
  estimatePurchaseValue,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { navigateToScreen } from "./navigation";

test("optional purchase details save directly, preserve failed drafts and reload shares", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.clock.setFixedTime(new Date("2026-09-20T12:00:00.000Z"));
  let receipt: PurchaseReceipt | null = null;
  let reject = false;
  let attempts = 0;
  let proxyEvidence = false;
  let reportedValue = true;
  const holding = () =>
    HoldingSchema.parse({
      id: "purchase-spv",
      companyId: "synthetic-company",
      positionName: "Synthetic Purchase SPV",
      exposureName: "Synthetic Purchase Company",
      ownerLabel: "Demo Family LLC",
      positionKind: "spv_interest",
      administratorNavMinor: reportedValue ? 150000 : null,
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
    .fill("12.5");
  await section
    .getByText("Capital and share calculation", { exact: true })
    .click();
  await expect(
    section.getByRole("textbox", {
      name: "Purchase price / share · USD",
      exact: true,
    }),
  ).toHaveValue("12.50");
  await section
    .getByRole("textbox", { name: "Gross cash contributed · USD", exact: true })
    .fill("1100");
  await section
    .getByRole("textbox", { name: "One-time fee · %", exact: true })
    .fill("10");
  await section.getByRole("combobox", { name: "Fee basis" }).click();
  await page.getByRole("option", { name: "Added to share capital" }).click();
  await section.getByRole("checkbox", { name: /No sales, splits/u }).check();
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
  await section.getByRole("button", { name: "Remove purchase 1" }).click();
  await expect(
    section.getByRole("textbox", {
      name: "Purchase price / share · USD",
      exact: true,
    }),
  ).toHaveCount(0);
  await section.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    section.getByRole("textbox", {
      name: "Purchase price / share · USD",
      exact: true,
    }),
  ).toHaveValue("12.50");
  expect(attempts).toBe(0);
  reject = true;
  await section
    .getByRole("button", { name: "Save purchase details", exact: true })
    .click();
  await expect(
    section.getByText("The position changed. Review again."),
  ).toBeVisible();
  expect(attempts).toBe(1);
  await expect(
    section.getByRole("textbox", {
      name: "Purchase price / share · USD",
      exact: true,
    }),
  ).toHaveValue("12.50");
  reject = false;
  await section
    .getByRole("button", { name: "Save purchase details", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Edit purchases" }),
  ).toBeVisible();
  await expect(section).toContainText("Share price");
  await expect(section).toContainText("$12.50");
  await expect(
    section.getByText("Valuation price evidence", { exact: true }),
  ).toHaveCount(0);
  const valuation = page.getByRole("region", {
    name: "Position value",
    exact: true,
  });
  await expect(valuation).toHaveCount(1);
  const valueToggle = valuation.getByRole("button", {
    name: "Position value",
    exact: true,
  });
  await expect(valueToggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    valuation.getByRole("tab", { name: "Enter a reported value" }),
  ).toBeHidden();
  await valueToggle.click();
  await valuation.getByRole("tab", { name: "Enter a reported value" }).click();
  await expect(
    valuation.getByRole("button", { name: "Add value evidence" }),
  ).toHaveCount(0);
  await valuation
    .getByRole("textbox", { name: "Source name", exact: true })
    .fill("Synthetic reported total");
  await valuation.getByRole("textbox", { name: /Value · USD/u }).fill("1800");
  await expect(
    valuation.getByRole("button", { name: "Review value", exact: true }),
  ).toBeEnabled();
  await expect(
    valuation.getByRole("button", { name: "Supporting details (optional)" }),
  ).toHaveAttribute("aria-expanded", "false");
  await valueToggle.click();
  await expect(
    valuation.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await valueToggle.click();
  await expect(
    valuation.getByRole("textbox", { name: "Source name", exact: true }),
  ).toHaveValue("Synthetic reported total");
  await valuation.getByRole("tab", { name: "Calculate from shares" }).click();
  await expect(
    valuation.getByRole("button", { name: "Add share details" }),
  ).toHaveCount(0);
  await valuation
    .getByRole("button", { name: "Use this price", exact: true })
    .click();
  await expect(
    valuation.getByRole("textbox", {
      name: "Valuation price / share · USD",
      exact: true,
    }),
  ).toHaveValue("20.00");
  await expect(
    valuation.getByRole("button", { name: "Save valuation details" }),
  ).toBeDisabled();
  await valuation
    .getByRole("checkbox", {
      name: "I confirmed this price applies to the same underlying share class.",
    })
    .check();
  await expect(
    valuation.getByRole("button", { name: "Portfolio Watch context" }),
  ).toBeVisible();
  await valuation
    .getByRole("textbox", {
      name: "Valuation price / share · USD",
      exact: true,
    })
    .fill("20");
  await valuation
    .getByRole("textbox", { name: "Valuation share class", exact: true })
    .fill("Series B");
  await valuation
    .getByRole("textbox", { name: "Valuation source", exact: true })
    .fill("Synthetic GP statement");
  await valuation
    .getByRole("checkbox", { name: /These purchases cover/u })
    .check();
  // Use the shared accessible calendar.
  await valuation
    .getByRole("button", { name: "Valuation price as of", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tuesday, September 1, 2026", exact: true })
    .click();
  await valuation
    .getByRole("textbox", { name: "Valuation source", exact: true })
    .focus();
  await valuation
    .getByRole("checkbox", {
      name: "I confirmed this price applies to the same underlying share class.",
    })
    .check();

  await valuation.getByRole("tab", { name: "Enter a reported value" }).click();
  await expect(
    valuation.getByRole("textbox", { name: "Source name", exact: true }),
  ).toHaveValue("Synthetic reported total");
  const sectionCaptureStyle = await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await expect(valuation).toHaveScreenshot("position-value-reported.png", {
    animations: "disabled",
  });
  await valuation.getByRole("tab", { name: "Calculate from shares" }).click();
  await expect(
    valuation.getByRole("textbox", {
      name: "Valuation price / share · USD",
      exact: true,
    }),
  ).toHaveValue("20.00");
  await expect(valuation).toHaveScreenshot("position-value-shares.png", {
    animations: "disabled",
  });
  await sectionCaptureStyle.evaluate((element) => {
    element.parentNode?.removeChild(element);
  });
  reject = true;
  await valuation
    .getByRole("button", { name: "Save valuation details" })
    .click();
  await expect(
    valuation.getByText("The position changed. Review again."),
  ).toBeVisible();
  await expect(
    valuation.getByRole("textbox", {
      name: "Valuation price / share · USD",
      exact: true,
    }),
  ).toHaveValue("20.00");
  reject = false;
  await valuation
    .getByRole("button", { name: "Save valuation details" })
    .click();
  await expect(
    valuation.getByText("80 shares × $20.00", { exact: false }),
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
  // The deferred loading shell also has navigation. Wait for the real app so
  // replacing that shell cannot discard a just-opened mobile menu.
  await expect(
    page.getByRole("button", {
      name: /Synthetic Purchase Company 1 position/u,
    }),
  ).toBeVisible();
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
  await valueToggle.click();
  await valuation.getByRole("tab", { name: "Calculate from shares" }).click();
  await expect(
    valuation.getByText("80 shares × $20.00", { exact: false }),
  ).toBeVisible();
  await section.getByRole("button", { name: "Edit purchases" }).click();
  await section
    .getByRole("textbox", { name: "Purchase price / share · USD", exact: true })
    .fill("10");
  await section
    .getByRole("button", { name: "Save purchase details", exact: true })
    .click();
  await expect(
    valuation.getByText("100 shares × $20.00", { exact: false }),
  ).toBeVisible();
  await expect(section).toContainText("$10.00");
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
  proxyEvidence = true;
  await valuation
    .getByRole("button", { name: "Edit share calculation" })
    .click();
  await valuation
    .getByRole("button", { name: "Use as proxy estimate" })
    .click();
  await expect(
    valuation.getByRole("button", { name: "Use this price", exact: true }),
  ).toBeDisabled();
  await expect(
    valuation.getByRole("button", { name: "Save valuation details" }),
  ).toBeDisabled();
  await valuation
    .getByRole("textbox", { name: "Why this proxy is appropriate" })
    .fill("Closest available common-share price; preferred rights may differ.");
  await expect(
    valuation.getByRole("textbox", {
      name: "Valuation share class",
      exact: true,
    }),
  ).toHaveValue("Common");
  await expect(
    valuation.getByRole("checkbox", { name: /I confirmed this price/ }),
  ).toHaveCount(0);
  const proxyStyle = await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await expect(valuation).toHaveScreenshot("position-value-proxy-draft.png", {
    animations: "disabled",
  });
  reject = true;
  await valuation
    .getByRole("button", { name: "Save valuation details" })
    .click();
  await expect(
    valuation.getByText("The position changed. Review again."),
  ).toBeVisible();
  await expect(
    valuation.getByRole("textbox", { name: "Why this proxy is appropriate" }),
  ).toHaveValue(
    "Closest available common-share price; preferred rights may differ.",
  );
  reject = false;
  await valuation
    .getByRole("button", { name: "Save valuation details" })
    .click();
  await expect(
    valuation.getByText("Estimated value · proxy", { exact: true }),
  ).toBeVisible();
  await valuation.getByRole("button", { name: "Proxy assumptions" }).click();
  await expect(valuation).toContainText("Common applied to Series B");
  await expect(valuation).toContainText("mark date unknown");
  await expect(valuation).toHaveScreenshot("position-value-proxy-saved.png", {
    animations: "disabled",
  });
  await proxyStyle.evaluate((el) => el.parentNode?.removeChild(el));
  await expect(
    page.getByRole("region", { name: "Position summary" }),
  ).toContainText("Administrator NAV");
  expect(receipt!.details.lots[0]!.mark!.effectiveDate).toBeNull();
  expect(receipt!.details.lots[0]!.mark!.proxy!.confirmed).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: /Synthetic Purchase Company 1 position/u })
    .click();
  await page
    .getByRole("button", {
      name: "View Synthetic Purchase SPV holding details",
    })
    .click();
  await valueToggle.click();
  await valuation.getByRole("tab", { name: "Calculate from shares" }).click();
  await expect(
    valuation.getByText("Estimated value · proxy", { exact: true }),
  ).toBeVisible();
  await valuation
    .getByRole("button", { name: "Edit share calculation" })
    .click();
  await valuation
    .getByRole("textbox", { name: "Why this proxy is appropriate" })
    .fill("Updated proxy rationale after review.");
  await valuation
    .getByRole("button", { name: "Save valuation details" })
    .click();
  await valuation.getByRole("button", { name: "Proxy assumptions" }).click();
  await expect(valuation).toContainText(
    "Updated proxy rationale after review.",
  );
  reportedValue = false;
  await page.reload();
  await page
    .getByRole("button", { name: /Synthetic Purchase Company 1 position/u })
    .click();
  await page
    .getByRole("button", {
      name: "View Synthetic Purchase SPV holding details",
    })
    .click();
  const summary = page.getByRole("region", { name: "Position summary" });
  await expect(summary).toContainText("Estimated value · proxy");
  await expect(summary).toContainText("Estimated return · before carry");
});
