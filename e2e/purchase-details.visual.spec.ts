import { expect, test, type Page } from "@playwright/test";
import { HoldingSchema } from "../packages/domain/src/index";
import {
  PurchaseReceiptSchema,
  AcceptPurchasesSchema,
  reviewedInvestmentFromReceipt,
  valuationSharesKey,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { AcceptValuationSchema } from "../packages/domain/src/valuation-record";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";

async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function screenshot(page: Page, name: string) {
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await expect(page.locator(".spv-holding")).toHaveScreenshot(name, {
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
function initialReceipt() {
  return PurchaseReceiptSchema.parse({
    id: "receipt-1",
    positionId: "synthetic-holding",
    snapshotId: "snapshot",
    currency: "USD",
    acceptedAt: "2026-10-01T12:00:00.000Z",
    details: {
      cashCoversPosition: true,
      coversPosition: true,
      investmentTerms: {
        ...unknownInvestmentTerms(),
        carryPpm: 150000,
        carryBasis: "gross_cash",
      },
      lots: [
        {
          id: "acquisition",
          purchasedOn: "2025-06-10",
          shareClass: "Preferred",
          priceMicros: 100_000_000,
          referencePriceMicros: null,
          grossCashMinor: 1_000_000,
          netCapitalMinor: 844_000,
          upfrontDeductionsMinor: 56_000,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: 84_400_000,
          sharesAsOf: "2026-01-01",
          sourceLabel: "Synthetic subscription",
          sourceUrl: null,
          mark: null,
          feesComplete: true,
          fees: [
            {
              id: "setup",
              kind: "one_time",
              label: "One-time fee",
              method: "paid",
              paidMinor: 20_000,
              ratePpm: 20_000,
              basis: "cash",
              basisMinor: null,
              prepaidMonths: null,
            },
            {
              id: "management",
              kind: "management",
              label: "Management fee",
              method: "paid",
              paidMinor: 36_000,
              ratePpm: 20_000,
              basis: "retained",
              basisMinor: null,
              prepaidMonths: 24,
            },
          ],
          capitalReturn: {
            amountMinor: 100_000,
            status: "received",
            effectiveDate: null,
            reportedDistributions: "excluded",
          },
        },
      ],
      valuation: {
        snapshotId: "snapshot",
        records: [
          {
            id: "gp",
            origin: "gp",
            totalMinor: 1_688_000,
            priceMicros: 200_000_000,
            effectiveDate: "2026-09-30",
            priceDate: "2026-09-30",
            shareClass: "Preferred",
            carryStatus: "before_carry",
            sourceLabel: "Synthetic GP",
            sourceUrl: null,
            sourceEvidenceId: null,
            sourcePositionId: null,
            sourceCapturedAt: null,
            watchEvidenceId: null,
          },
        ],
        selected: { recordId: "gp", method: "total", sharesKey: null },
      },
    },
  });
}
async function setup(
  page: Page,
  configure?: (receipt: PurchaseReceipt) => void,
) {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00.000Z"));
  let receipt = initialReceipt();
  configure?.(receipt);
  let reject = false,
    revision = 1;
  const history = [receipt];
  const holding = () =>
    HoldingSchema.parse({
      id: "synthetic-holding",
      companyId: "synthetic-company",
      positionName: "Demo Cedar SPV",
      exposureName: "Demo Cedar AI",
      ownerLabel: "Demo Family LLC",
      positionKind: "spv_interest",
      administratorNavMinor: 1_688_000,
      administratorNavState: "reported",
      externalMarkMinor: null,
      underwritingValueMinor: null,
      scenarioValueMinor: null,
      usableLiquidityMinor: null,
      sourceStatus: "verified",
      sourceLabel: "Synthetic GP",
      effectiveDate: "2026-09-30",
      retrievedAt: "2026-10-01T12:00:00.000Z",
      confidencePpm: null,
      investedMinor: 1_000_000,
      committedMinor: 1_000_000,
      realizedValueMinor: 0,
      instrumentType: "SPV interest",
      purchaseContext: {
        snapshotId: "snapshot",
        reportedValueMinor: 1_688_000,
        reportedSourceLabel: "Synthetic GP",
        sourceObservedOn: "2026-09-30",
        currency: "USD",
        openedOn: "2025-06-10",
        receipt,
      },
      positionValueContext: {
        snapshotId: "snapshot",
        currency: "USD",
        providerValueState: "reported",
        providerValueMinor: 1_688_000,
        acceptedAdjustment: null,
      },
      positionEconomicsContext: {
        snapshotId: "snapshot",
        currency: "USD",
        committedMinor: 1_000_000,
        fundedMinor: 1_000_000,
        acceptedTerms: null,
        reportedTerms: null,
        reviewedInvestment: reviewedInvestmentFromReceipt(receipt),
      },
    });
  const investmentHoldings = () => {
    const view = investmentHoldingsViewFor([holding()]);
    for (const connection of view.positionView.connections)
      for (const container of connection.containers)
        for (const position of container.positions)
          position.snapshot.id = receipt.snapshotId;
    for (const position of view.exposureView.positions) {
      position.snapshotId = receipt.snapshotId;
      position.reviewedInvestment = reviewedInvestmentFromReceipt(receipt);
    }
    return view;
  };
  await routeHoldingsPage(page, () => ({
    householdName: "Demo Household",
    holdings: [holding()],
    investmentHoldings: investmentHoldings(),
    acceptedCashAccounts: [],
    pendingImports: [],
  }));
  await page.route(
    "**/api/investment-positions/synthetic-holding/share-price-evidence",
    (route) =>
      route.fulfill({
        json: {
          prices: [
            {
              id: `proxy-price-${revision}`,
              positionId: "another-spv",
              positionLabel: "Other Cedar SPV",
              sourceLabel: "Tokenfolio",
              observedAt: "2026-09-30T12:00:00.000Z",
              capturedAt: "2026-10-01T12:00:00.000Z",
              markMicros: 210_000_000 + (revision - 1) * 1_000_000,
              markDate: "2026-09-30",
              costMicros: null,
              shareClass: "Preferred",
            },
          ],
          watch: [
            {
              id: "watch",
              title: "Synthetic Cedar funding update",
              url: "https://example.com/cedar",
              publishedAt: "2026-09-28",
              fact: "Synthetic financing evidence",
            },
          ],
        },
      }),
  );
  await page.route(
    "**/api/investment-positions/synthetic-holding/history",
    (route) =>
      route.fulfill({
        json: {
          entries: history.map((r, i) => ({
            kind: "investment",
            receipt: r,
            previous: history[i + 1] ?? null,
          })),
          next: null,
        },
      }),
  );
  await page.route(
    "**/api/investment-positions/synthetic-holding/links",
    (route) =>
      route.fulfill({
        json: {
          version: 1,
          positionId: "synthetic-holding",
          links: [],
          candidates: [],
          history: [],
        },
      }),
  );
  await page.route(
    "**/api/investment-positions/synthetic-holding/valuation",
    async (route) => {
      const input = AcceptValuationSchema.parse(route.request().postDataJSON());
      if (reject) {
        await route.fulfill({
          status: 409,
          json: {
            error: "This source price changed. Reload the available sources.",
          },
        });
        return;
      }
      const previous = receipt;
      receipt = PurchaseReceiptSchema.parse({
        ...receipt,
        id: `receipt-${history.length + 1}`,
        acceptedAt: `2026-10-01T12:00:${String(history.length).padStart(2, "0")}.000Z`,
        details: {
          ...receipt.details,
          valuation: {
            snapshotId: "snapshot",
            records: [
              ...(receipt.details.valuation?.records ?? []).filter(
                (r) => r.id !== input.record.id,
              ),
              input.record,
            ],
            selected: {
              recordId: input.record.id,
              method: input.method,
              sharesKey:
                input.method === "shares"
                  ? valuationSharesKey(receipt.details)
                  : null,
            },
          },
        },
      });
      expect(receipt.details.lots).toEqual(previous.details.lots);
      history.unshift(receipt);
      await route.fulfill({ status: 201, json: receipt });
    },
  );
  await page.route(
    "**/api/investment-positions/synthetic-holding/purchases",
    async (route) => {
      const input = AcceptPurchasesSchema.parse(route.request().postDataJSON());
      if (reject) {
        await route.fulfill({
          status: 500,
          json: { error: "Investment could not be saved." },
        });
        return;
      }
      receipt = PurchaseReceiptSchema.parse({
        ...receipt,
        id: `receipt-${history.length + 1}`,
        acceptedAt: `2026-10-01T12:00:${String(history.length).padStart(2, "0")}.000Z`,
        details: { ...input.details, valuation: receipt.details.valuation },
      });
      history.unshift(receipt);
      await route.fulfill({ status: 201, json: receipt });
    },
  );
  await page.goto("/holdings?position=synthetic-holding");
  await expect(
    page.getByRole("heading", { name: "Demo Cedar AI", exact: true }),
  ).toBeVisible();
  return {
    receipt: () => receipt,
    positions: () =>
      investmentHoldings().positionView.connections.flatMap((c) =>
        c.containers.flatMap((c) => c.positions),
      ),
    reject: (value: boolean) => {
      reject = value;
    },
    refreshPrice: () => {
      revision++;
    },
  };
}

test("holding summary pairs value and return and keeps fees in Investment", async ({
  page,
}) => {
  await setup(page);
  const before = page.getByRole("group", {
    name: "Reported value · Before carry",
    exact: true,
  });
  await expect(before).toContainText("$16,880.00");
  await expect(before).toContainText("+100.00%");
  const after = page.getByRole("group", {
    name: "Estimated value · After carry",
    exact: true,
  });
  await expect(after).toContainText("$15,698.00");
  await expect(after).toContainText("+85.99%");
  await expect(
    page.getByRole("group", { name: "Invested capital" }),
  ).toContainText("$8,440.00");
  await expect(page.getByRole("heading", { name: "Fees & carry" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Edit investment" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toHaveCount(1);
  await screenshot(page, "holding-summary.png");
  await page.getByRole("button", { name: "Calculation", exact: true }).click();
  await expect(page.locator(".holding-calculation")).toContainText("$1,182.00");
  await expect(page.locator(".holding-calculation")).toContainText(
    "Net capital$8,440.00",
  );
  await expect(page.locator(".holding-calculation")).toContainText(
    "÷ net capital",
  );
  await screenshot(page, "holding-calculation.png");
});

test("valuation choices compare both amounts and preserve investment shares after save", async ({
  page,
}) => {
  const state = await setup(page, (r) => {
    r.details.valuation!.records[0]!.totalMinor = 1_748_000;
  });
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await expect(
    page.getByRole("radio", { name: /Reported by GP/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: /Calculated from your shares/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", {
      name: "Choose the valuation shown for this holding",
    }),
  ).toContainText("84.4 shares in Investment × $200.00/share");
  await screenshot(page, "valuation-choice.png");
  await page.getByRole("radio", { name: /Reported by GP/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: /Calculated from your shares/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(state.receipt().details.valuation!.selected!.method).toBe("shares");
  expect(state.receipt().details.valuation!.records[0]!.totalMinor).toBe(
    1_748_000,
  );
  expect(state.receipt().details.lots[0]!.remainingSharesMicros).toBe(
    84_400_000,
  );
  await page.reload();
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await expect(
    page.getByRole("textbox", { name: "Position total · $" }),
  ).toHaveValue("17480");
  await page.getByRole("textbox", { name: "Position total · $" }).fill("19000");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await expect(
    page.getByRole("textbox", { name: "Position total · $" }),
  ).toHaveValue("17480");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  state.receipt().details.valuation!.records[0]!.priceDate = null;
  await page.reload();
  await page
    .getByRole("button", { name: "Sources & history", exact: true })
    .click();
  await page
    .locator(".holding-receipt-history")
    .getByRole("button")
    .first()
    .click();
  await expect(page.locator(".holding-receipt-history")).toContainText(
    "Sep 30, 2026 → Cleared",
  );
  await expect(
    page.locator(".holding-receipt-history .data-list"),
  ).not.toContainText("$200.00/share");
  await expect(page.locator(".holding-receipt-history")).not.toContainText(
    "1970",
  );
});

test("returns use complete fee estimates without treating unknown fees as zero", async ({
  page,
}) => {
  await setup(page, (r) => {
    const lot = r.details.lots[0]!;
    lot.netCapitalMinor = null;
    lot.upfrontDeductionsMinor = null;
    for (const fee of lot.fees!) {
      fee.method = "percentage";
      fee.paidMinor = null;
    }
  });
  await expect(
    page.getByRole("group", { name: "Invested capital" }),
  ).toContainText("Estimated net invested$8,440.00");
  await expect(
    page.getByRole("group", {
      name: "Reported value · Before carry",
      exact: true,
    }),
  ).toContainText("+100.00%");
  await expect(
    page.getByRole("group", {
      name: "Estimated value · After carry",
      exact: true,
    }),
  ).toContainText("+85.99%");
  await page.getByRole("button", { name: "Calculation", exact: true }).click();
  await expect(page.locator(".holding-calculation")).toContainText(
    "Estimated net capital$8,440.00",
  );
  await page.getByRole("button", { name: "Edit investment" }).click();
  await select(page, "Upfront fees", "Some fees are unknown");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".holding-value-return")).toHaveCount(0);
});

test("unknown refund inclusion withholds returns in the holding and exposure summaries", async ({
  page,
}) => {
  await setup(page, (r) => {
    r.details.lots[0]!.capitalReturn!.reportedDistributions = "unknown";
  });
  await expect(page.locator(".holding-value-return")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to holdings", exact: true })
    .click();
  await expect(page.locator(".exposure-group")).not.toContainText("%");
});

test("new acquisitions can be removed without discarding other investment edits", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Edit investment" }).click();
  await page
    .getByRole("textbox", { name: "Cash paid · $", exact: true })
    .fill("11000");
  await page
    .getByRole("button", { name: "Add acquisition", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Acquisition 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove acquisition 1", exact: true }),
  ).toHaveCount(0);
  await screenshot(page, "acquisition-draft.png");
  await page
    .getByRole("button", { name: "Remove acquisition 2", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add acquisition", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Cash paid · $", exact: true }),
  ).toHaveValue("11000");
  await expect(page.locator(".holding-acquisition")).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.receipt().details.lots[0]!.grossCashMinor).toBe(1_000_000);
});

test("saved history distinguishes same-day changes and avoids a duplicate current valuation", async ({
  page,
}) => {
  await setup(page);
  for (const value of ["18000", "19000"]) {
    await page.getByRole("button", { name: "Edit valuation" }).click();
    await page
      .getByRole("textbox", { name: "Position total · $", exact: true })
      .fill(value);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Edit valuation" }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Sources & history", exact: true })
    .click();
  const history = page.locator(".holding-receipt-history");
  await expect(history).toContainText(
    "Valuation · Synthetic GP $19,000.00 · before carry",
  );
  await expect(history).toContainText(
    "Valuation · Synthetic GP $18,000.00 · before carry",
  );
  await expect(history).toContainText("UTC");
  await expect(history).toContainText("12:00:01 PM UTC");
  await expect(history).toContainText("12:00:02 PM UTC");
  await expect(
    page.locator(".holding-history > div > .data-list"),
  ).not.toContainText("$19,000.00");
  await expect(
    page.getByRole("heading", {
      name: "Linked investment records",
      exact: true,
    }),
  ).toBeVisible();
  const disclosure = page.getByRole("button", {
    name: "Linked investment records",
    exact: true,
  });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  const newest = history.locator('[data-slot="collapsible"]').first();
  await newest.getByRole("button").click();
  await expect(newest).toContainText("$18,000.00 → $19,000.00");
  await expect(newest).not.toContainText("Cash paid");
  await expect(newest).not.toContainText("Shares");
  await screenshot(page, "holding-history.png");
});

test("one timeline refreshes after unlink, keeps failed decisions unapplied and omits unchanged investment fields", async ({
  page,
}) => {
  const state = await setup(page);
  const target = state.positions()[0]!;
  const source = {
    ...target,
    id: "synthetic-source",
    legalVehicleName: "Demo Cedar source",
    snapshot: { ...target.snapshot, id: "source-snapshot" },
  };
  let link = {
    id: "synthetic-link",
    sourcePositionId: source.id,
    targetPositionId: target.id,
    relationship: "same_investment",
    state: "linked",
    useSourceValue: true,
    companyRenamed: false,
    companyName: null,
    formerCompanyName: null,
    note: "",
    acceptedAt: "2026-10-01T12:00:10.000Z",
  };
  const initial = structuredClone(state.receipt());
  const changed = structuredClone(initial);
  changed.id = "changed-fee";
  changed.acceptedAt = "2026-10-01T12:00:20.000Z";
  changed.details.lots[0]!.fees![0]!.paidMinor = 25_000;
  const history: unknown[] = [
    { kind: "investment", receipt: changed, previous: initial },
    {
      kind: "link",
      receipt: link,
      sourceLabel: source.legalVehicleName,
      targetLabel: target.legalVehicleName,
    },
    { kind: "investment", receipt: initial, previous: null },
  ];
  await page.route(
    "**/api/investment-positions/synthetic-holding/history",
    (route) => route.fulfill({ json: { entries: history, next: null } }),
  );
  let reject = true,
    writes = 0;
  await page.route("**/api/investment-position-links", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { positions: [target, source], links: [link] },
      });
    writes++;
    if (reject)
      return route.fulfill({
        status: 409,
        json: { error: "The records changed. Reload and review again." },
      });
    link = {
      ...link,
      state: "unlinked",
      id: "synthetic-unlink",
      acceptedAt: "2026-10-01T12:00:30.000Z",
    };
    history.unshift({
      kind: "link",
      receipt: link,
      sourceLabel: source.legalVehicleName,
      targetLabel: target.legalVehicleName,
    });
    return route.fulfill({ status: 201, json: link });
  });
  await page
    .getByRole("button", { name: "Sources & history", exact: true })
    .click();
  const timeline = page.locator(".holding-receipt-history");
  await expect(
    timeline.getByRole("button", { name: /^Linked ·/ }),
  ).toBeVisible();
  const fee = timeline.locator('[data-slot="collapsible"]').first();
  await fee.getByRole("button").click();
  await expect(fee.locator(".data-list__item")).toHaveCount(1);
  await expect(fee).not.toContainText("Cash paid");
  await expect(fee).not.toContainText("Shares");
  const links = page.getByRole("region", {
    name: "Linked investment records",
    exact: true,
  });
  const disclosure = links.getByRole("button", {
    name: "Linked investment records",
    exact: true,
  });
  await disclosure.click();
  await expect(links.getByText("Review history", { exact: true })).toHaveCount(
    0,
  );
  await expect(links).not.toContainText("Keep this SPV as one investment");
  await links
    .getByRole("button", { name: "Unlink record", exact: true })
    .click();
  await expect(links).toContainText("stop using its reported value");
  await links.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(writes).toBe(0);
  await expect(
    links.getByRole("button", { name: "Unlink record", exact: true }),
  ).toBeFocused();
  await links
    .getByRole("button", { name: "Unlink record", exact: true })
    .click();
  await links.getByRole("button", { name: "Unlink", exact: true }).click();
  await expect(links.getByRole("alert")).toContainText("The records changed");
  await expect(
    timeline.getByRole("button", { name: /^Unlinked ·/ }),
  ).toHaveCount(0);
  reject = false;
  await links.getByRole("button", { name: "Unlink", exact: true }).click();
  await expect(
    timeline.getByRole("button", { name: /^Unlinked ·/ }),
  ).toBeVisible();
  await expect(disclosure).toBeFocused();
  await expect(
    links.getByRole("button", { name: "Unlink record", exact: true }),
  ).toHaveCount(0);
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await screenshot(page, "holding-unified-history.png");
});

test("sources restore GP facts and estimates without duplicate forms or acknowledgments", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await select(page, "Source", "Tokenfolio · Other SPV");
  await expect(
    page.getByRole("textbox", { name: "Position total · $" }),
  ).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "Edit valuation" }),
  ).toContainText("$17,724.00");
  await screenshot(page, "valuation-proxy.png");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Proxy estimate · Before carry" }),
  ).toContainText("$17,724.00");
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await select(page, "Source", "My estimate");
  await page.getByRole("textbox", { name: "Position total · $" }).fill("18000");
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await select(
    page,
    "Portfolio Watch evidence",
    "Synthetic Cedar funding update",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(
    state.receipt().details.valuation!.records.find((r) => r.id === "mine")
      ?.watchEvidenceId,
  ).toBe("watch");
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await select(page, "Source", "Synthetic GP");
  await expect(
    page.getByRole("textbox", { name: "Position total · $" }),
  ).toHaveValue("16880");
  await expect(
    page.getByRole("textbox", { name: "Share price · $" }),
  ).toHaveValue("200");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Reported value · Before carry" }),
  ).toContainText("+100.00%");
});

test("investment fee percentages preserve unknown refund dates and failed drafts", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Edit investment" }).click();
  await select(page, "Management fee entry", "Annual percentage");
  await expect(
    page.getByRole("textbox", { name: "Prepaid years", exact: true }),
  ).toHaveValue("2");
  await page
    .getByRole("textbox", { name: "Management fee · % / year", exact: true })
    .fill("3");
  state.reject(true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Investment could not be saved.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", {
      name: "Management fee · % / year",
      exact: true,
    }),
  ).toHaveValue("3");
  await screenshot(page, "investment-fee-error.png");
  state.reject(false);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(
    state.receipt().details.lots[0]!.fees!.find((f) => f.id === "management"),
  ).toMatchObject({
    method: "percentage",
    ratePpm: 30000,
    prepaidMonths: 24,
    basis: "retained",
  });
  expect(
    state.receipt().details.lots[0]!.capitalReturn!.effectiveDate,
  ).toBeNull();
  expect(state.receipt().details.valuation!.records[0]!.totalMinor).toBe(
    1688000,
  );
});

test("after carry totals remain selectable and known unpaid costs remain visible", async ({
  page,
}) => {
  await setup(page, (r) => {
    const record = r.details.valuation!.records[0]!;
    record.carryStatus = "after_carry";
    record.totalMinor = 1_200_000;
    r.details.lots[0]!.fees!.push({
      ...r.details.lots[0]!.fees![1]!,
      id: "due",
      paidMinor: 10_000,
      paymentStatus: "unpaid",
      dueDate: "2026-10-31",
    });
  });
  await expect(
    page.getByRole("group", { name: "Reported value · After carry" }),
  ).toContainText("$12,000.00");
  await expect(
    page.getByRole("group", { name: "Reported value · After carry" }),
  ).toContainText("Excludes $100.00 unpaid management fee");
  await screenshot(page, "holding-unpaid.png");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment details" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to holding", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await expect(
    page.getByRole("radio", { name: /Reported by GP/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: /Calculated from your shares/ }),
  ).toBeVisible();
  await screenshot(page, "valuation-after-carry-choice.png");
});

test("source conflicts recover with current prices while preserving user input", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await select(page, "Source", "Tokenfolio · Other SPV");
  state.reject(true);
  state.refreshPrice();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reload sources" }),
  ).toBeVisible();
  state.reject(false);
  await page.getByRole("button", { name: "Reload sources" }).click();
  await page.getByRole("button", { name: "Use updated price" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(
    state.receipt().details.valuation!.records.find((r) => r.origin === "proxy")
      ?.priceMicros,
  ).toBe(211_000_000);
});

test("editing an existing partial investment preserves its recorded scope", async ({
  page,
}) => {
  const state = await setup(page, (receipt) => {
    receipt.details.coversPosition = false;
    receipt.details.cashCoversPosition = false;
    receipt.details.investmentTerms!.annualManagementFeePpm = 20_000;
    receipt.details.lots[0]!.fees = receipt.details.lots[0]!.fees!.filter(
      (f) => f.kind !== "management",
    );
  });
  await page.getByRole("button", { name: "Edit investment" }).click();
  await page
    .getByRole("textbox", { name: "Carry · %", exact: true })
    .fill("14");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(state.receipt().details.coversPosition).toBe(false);
  expect(state.receipt().details.cashCoversPosition).toBe(false);
  expect(
    state.receipt().details.lots[0]!.fees!.some((f) => f.kind === "management"),
  ).toBe(false);
  await page.getByRole("button", { name: "Edit investment" }).click();
  await select(page, "Management fee entry", "Annual percentage");
  await expect(
    page.getByRole("textbox", {
      name: "Management fee · % / year",
      exact: true,
    }),
  ).toHaveValue("2");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await select(page, "Source", "Tokenfolio · Other SPV");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
});
