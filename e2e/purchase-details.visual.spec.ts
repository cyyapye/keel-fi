import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  HoldingImportPreviewSchema,
  HoldingSchema,
} from "../packages/domain/src/index";
import { HoldingsPageSchema } from "../packages/domain/src/holdings-page";
import { providerHoldingsTemplateCsv } from "../packages/connectors/src/provider-holdings-template-csv";
import {
  PurchaseReceiptSchema,
  InvestmentHistorySchema,
  AcceptPurchasesSchema,
  reviewedInvestmentFromReceipt,
  selectedPositionValuation,
  valuationSharesKey,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { AcceptValuationSchema } from "../packages/domain/src/valuation-record";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";

test.use({ timezoneId: "UTC" });

async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function screenshot(page: Page, name: string) {
  await expect(page.locator(".spv-holding")).toHaveScreenshot(name, {
    animations: "disabled",
    stylePath: fileURLToPath(
      new URL("./purchase-details.capture.css", import.meta.url),
    ),
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function expectFocusedControlUsable(control: Locator) {
  await expect(control).toBeFocused();
  await expect(control).toBeVisible();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const label = element
          .closest("label")
          ?.querySelector('[data-slot="field-label"]');
        const labelBox = label?.getBoundingClientRect();
        const contained = (bounds: DOMRect) =>
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left >= 0 &&
          bounds.top >= 0 &&
          bounds.right <= innerWidth &&
          bounds.bottom <= innerHeight;
        const overlaps = (a: DOMRect, b: DOMRect) =>
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top;
        const navigation = [
          ...document.querySelectorAll(".topbar, .mobile-nav"),
        ].filter((node) => {
          const style = getComputedStyle(node);
          return style.visibility !== "hidden" && style.display !== "none";
        });
        const style = getComputedStyle(element);
        return {
          controlInViewport: contained(box),
          labelInViewport: !labelBox || contained(labelBox),
          controlClearOfNavigation: navigation.every(
            (node) => !overlaps(box, node.getBoundingClientRect()),
          ),
          labelClearOfNavigation: navigation.every(
            (node) =>
              !labelBox || !overlaps(labelBox, node.getBoundingClientRect()),
          ),
          hitTarget: element.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ),
          ),
          focusVisible: element.matches(":focus-visible"),
          outlineVisible:
            style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
          mobileTargetSize: innerWidth >= 768 || box.height >= 44,
          noHorizontalOverflow:
            document.documentElement.scrollWidth <= innerWidth,
        };
      }),
    )
    .toEqual({
      controlInViewport: true,
      labelInViewport: true,
      controlClearOfNavigation: true,
      labelClearOfNavigation: true,
      hitTarget: true,
      focusVisible: true,
      outlineVisible: true,
      mobileTargetSize: true,
      noHorizontalOverflow: true,
    });
}

async function checkBasisKeyboardNavigation(
  page: Page,
  options: {
    previous: Locator;
    basis: Locator;
    following: Locator[];
  },
) {
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".topbar")).toHaveCSS("visibility", "visible");
  await options.previous.click();
  if ((await options.previous.getAttribute("role")) === "combobox") {
    await expect(options.previous).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(options.previous).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("listbox")).toBeHidden();
  }
  await expect(options.previous).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    options.basis.locator("..").locator('[data-slot="field-label"]'),
  ).toBeVisible();
  await expectFocusedControlUsable(options.basis);
  await page.keyboard.press("Tab");
  await expect(options.following[0]!).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expectFocusedControlUsable(options.basis);
  for (const control of options.following) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }
  await expectFocusedControlUsable(options.following.at(-1)!);
}

type PreparedSpv = {
  positionId: string;
  snapshotId: string;
  receipt: PurchaseReceipt;
};

async function prepareSyntheticSpv(
  page: Page,
  scenario: "quantity" | "price",
): Promise<PreparedSpv> {
  const suffix = `${scenario}-${test.info().project.name}-${test.info().retry}-${randomUUID()}`;
  const positionName = `Synthetic basis SPV ${suffix}`;
  const csv =
    providerHoldingsTemplateCsv("wefunder") +
    [
      `Synthetic basis company ${suffix}`,
      positionName,
      "SPV",
      `Synthetic basis trust ${suffix}`,
      "Live",
      "2025-06-10",
      "2026-09-30",
      "$8440.00",
      "$8440.00",
      "$16880.00",
      "$0.00",
      "Preferred",
    ].join(",") +
    "\n";
  const imported = await page.request.post("/api/holding-imports/wefunder", {
    multipart: {
      file: {
        name: `synthetic-${suffix}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      },
    },
  });
  expect(imported.status(), await imported.text()).toBe(201);
  const preview = HoldingImportPreviewSchema.parse(await imported.json());
  expect(preview).toMatchObject({
    status: "applied",
    summary: { rowCount: 1, autoAppliedCount: 1 },
  });
  expect(preview.rows).toHaveLength(1);
  expect(preview.rows[0]).toMatchObject({
    decisionSource: "policy",
    adjudicationStatus: "auto_applied",
  });
  const importedReadback = await page.request.get(
    `/api/holding-imports/${encodeURIComponent(preview.id)}`,
  );
  expect(importedReadback.ok()).toBe(true);
  expect(
    HoldingImportPreviewSchema.parse(await importedReadback.json()),
  ).toEqual(preview);

  const response = await page.request.get("/api/holdings-page");
  expect(response.ok()).toBe(true);
  const holdings = HoldingsPageSchema.parse(await response.json());
  const holding = holdings.holdings.find(
    (item) => item.positionName === positionName,
  );
  expect(holding?.positionKind).toBe("spv_interest");
  const context = holding?.purchaseContext;
  expect(context).toBeTruthy();
  const positionId = holding!.id;
  const snapshotId = context!.snapshotId;
  const expectedTermsId =
    holding!.positionEconomicsContext?.acceptedTerms?.id ?? null;
  const purchases = AcceptPurchasesSchema.parse({
    expectedSnapshotId: snapshotId,
    expectedReceiptId: context!.receipt?.id ?? null,
    expectedTermsId,
    details: {
      investmentTerms: unknownInvestmentTerms(),
      cashCoversPosition: true,
      coversPosition: true,
      lots: [
        {
          id: "synthetic-basis-acquisition",
          purchasedOn: "2025-06-10",
          shareClass: "Preferred",
          priceMicros: 100_000_000,
          referencePriceMicros: null,
          grossCashMinor: 844_000,
          netCapitalMinor: 844_000,
          upfrontDeductionsMinor: 0,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros:
            scenario === "quantity" ? 84_400_000 : 422_000_000,
          sharesAsOf: "2026-01-01",
          sourceLabel: "Synthetic basis subscription",
          sourceUrl: null,
          mark: null,
          fees: [],
          feesComplete: true,
          quantityDetails: {
            status: "estimated",
            derivation: "Synthetic allocation estimate",
            evidence: "Synthetic split notice",
            shareBasis: {
              key: "issuer-original",
              unitsPerOriginal: scenario === "quantity" ? 1 : 5,
            },
          },
        },
      ],
    },
  });
  const accepted = await page.request.post(
    `/api/investment-positions/${encodeURIComponent(positionId)}/purchases`,
    { data: purchases },
  );
  expect(accepted.status()).toBe(201);
  let receipt = PurchaseReceiptSchema.parse(await accepted.json());
  if (scenario === "price") {
    const valuation = AcceptValuationSchema.parse({
      expectedSnapshotId: snapshotId,
      expectedReceiptId: receipt.id,
      expectedTermsId,
      method: "shares",
      record: {
        id: "gp",
        origin: "gp",
        totalMinor: null,
        priceMicros: 200_000_000,
        effectiveDate: "2026-09-30",
        priceDate: "2026-09-30",
        shareClass: "Preferred",
        shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
        carryStatus: "before_carry",
        sourceLabel: "Synthetic basis GP",
        sourceUrl: null,
        sourceEvidenceId: null,
        sourcePositionId: null,
        sourceCapturedAt: null,
        watchEvidenceId: null,
      },
    });
    const valued = await page.request.post(
      `/api/investment-positions/${encodeURIComponent(positionId)}/valuation`,
      { data: valuation },
    );
    expect(valued.status()).toBe(201);
    receipt = PurchaseReceiptSchema.parse(await valued.json());
  }
  await page.goto(`/holdings?position=${encodeURIComponent(positionId)}`);
  await expect(page.locator(".spv-holding")).toBeVisible();
  return { positionId, snapshotId, receipt };
}

async function readStoredReceipt(
  page: Page,
  positionId: string,
): Promise<PurchaseReceipt> {
  const response = await page.request.get("/api/holdings-page");
  expect(response.ok()).toBe(true);
  const holdings = HoldingsPageSchema.parse(await response.json());
  const holding = holdings.holdings.find((item) => item.id === positionId);
  return PurchaseReceiptSchema.parse(holding?.purchaseContext?.receipt);
}

async function expectStoredReceiptHistory(
  page: Page,
  positionId: string,
  receipts: PurchaseReceipt[],
) {
  expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(
    receipts.length,
  );
  const response = await page.request.get(
    `/api/investment-positions/${encodeURIComponent(positionId)}/history`,
  );
  expect(response.ok()).toBe(true);
  const history = InvestmentHistorySchema.parse(await response.json());
  for (const [index, receipt] of receipts.entries()) {
    const entry = history.entries.find(
      (item) => item.kind === "investment" && item.receipt.id === receipt.id,
    );
    expect(entry?.kind).toBe("investment");
    if (entry?.kind !== "investment")
      throw new Error("Saved investment receipt is missing from history.");
    expect(entry.receipt).toEqual(receipt);
    if (index > 0) expect(entry.previous).toEqual(receipts[index - 1]);
  }
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
  relatedNames: string[] = [],
  proxyOptions: {
    priceDate?: string | null;
    shareClass?: string;
    stale?: boolean;
  } = {},
) {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00.000Z"));
  let receipt = initialReceipt();
  configure?.(receipt);
  let reject = false,
    revision = 1;
  const history = [receipt];
  let pendingSave: Promise<void> | null = null;
  let releaseSave: (() => void) | undefined;
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
        ...(proxyOptions.stale &&
        receipt.details.valuation?.selected?.recordId.startsWith("proxy:")
          ? {
              priceProxyStatus: {
                stale: true,
                lastObservationAt: "2026-10-02T12:00:00.000Z",
                lastSuccessfulSyncAt: "2026-10-01T12:00:00.000Z",
              },
            }
          : {}),
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
  const holdings = () => [
    holding(),
    ...relatedNames.map((positionName, index) => ({
      ...holding(),
      id: `synthetic-related-${index}`,
      positionName,
      purchaseContext: null,
      positionEconomicsContext: null,
      positionValueContext: null,
    })),
  ];
  const investmentHoldings = () => {
    const view = investmentHoldingsViewFor(holdings());
    for (const connection of view.positionView.connections)
      for (const container of connection.containers)
        for (const position of container.positions)
          if (position.id === receipt.positionId)
            position.snapshot.id = receipt.snapshotId;
    for (const position of view.exposureView.positions) {
      if (position.id === receipt.positionId) {
        position.snapshotId = receipt.snapshotId;
        position.reviewedInvestment = reviewedInvestmentFromReceipt(receipt);
      }
    }
    return view;
  };
  await routeHoldingsPage(page, () => ({
    householdName: "Demo Household",
    holdings: holdings(),
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
              markDate:
                proxyOptions.priceDate !== undefined
                  ? proxyOptions.priceDate
                  : "2026-09-30",
              costMicros: null,
              shareClass: proxyOptions.shareClass ?? "Preferred",
              shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
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
      if (pendingSave) await pendingSave;
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
      if (pendingSave) await pendingSave;
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
    pauseSave: () => {
      pendingSave = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
    },
    resumeSave: () => {
      releaseSave?.();
      pendingSave = null;
    },
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
  const relatedNames = [
    "Demo Cedar Growth I SPV",
    "Demo Cedar Growth II SPV",
    "Demo Cedar Artificial Intelligence and Enterprise Infrastructure Opportunity III SPV",
  ];
  await setup(page, undefined, relatedNames);
  const related = page.getByRole("list", { name: "Also held through" });
  await expect(related.getByRole("listitem")).toHaveCount(3);
  for (const [index, name] of relatedNames.entries()) {
    const link = related.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute(
      "href",
      `/holdings?position=synthetic-related-${index}`,
    );
    await expect(link).toHaveCSS("white-space", "normal");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(
      page.viewportSize()!.width <= 620 ? 44 : 40,
    );
  }
  const rows = await related.getByRole("listitem").all();
  for (let i = 1; i < rows.length; i++) {
    expect((await rows[i]!.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await rows[i - 1]!.boundingBox())!.y +
        (await rows[i - 1]!.boundingBox())!.height,
    );
  }
  const before = page.getByRole("group", {
    name: "Reported remaining value · Before carry",
    exact: true,
  });
  await expect(before).toContainText("$16,880.00");
  await expect(before).toContainText("+100.00%");
  const after = page.getByRole("group", {
    name: "Estimated remaining value · After carry",
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
      name: "Reported remaining value · Before carry",
      exact: true,
    }),
  ).toContainText("+100.00%");
  await expect(
    page.getByRole("group", {
      name: "Estimated remaining value · After carry",
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
  await expect(
    page.getByRole("group", { name: "Invested capital" }),
  ).toContainText("Cash retained · includes fees$9,000.00");
  await screenshot(page, "investment-retained-cash.png");
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
  await expect(history.locator("time")).toHaveText([
    "Oct 1, 2026, 12:00 PM",
    "Oct 1, 2026, 12:00 PM",
    "Oct 1, 2026, 12:00 PM",
  ]);
  await expect(history.locator("time").first()).toHaveAttribute(
    "datetime",
    "2026-10-01T12:00:02.000Z",
  );
  await expect(page.locator(".holding-history > div > p")).toHaveText(
    "Synthetic GP · Sep 30, 2026",
  );
  await expect(page.locator(".holding-history > div > .data-list")).toHaveCount(
    0,
  );
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
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/investment-position-links", async (route) => {
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
    await pending;
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
  const info = links.getByRole("button", {
    name: "About unlinking Demo Cedar source",
    exact: true,
  });
  await info.press("Enter");
  await expect(
    page.getByRole("dialog", {
      name: "About unlinking Demo Cedar source",
      exact: true,
    }),
  ).toContainText("This link will stop supplying reported value.");
  await page.keyboard.press("Escape");
  expect(writes).toBe(0);
  await expect(info).toBeFocused();
  const unlink = links.getByRole("button", {
    name: "Unlink record",
    exact: true,
  });
  await unlink.click();
  await expect(links.getByRole("alert")).toContainText("The records changed");
  expect(writes).toBe(1);
  await expect(
    timeline.getByRole("button", { name: /^Unlinked ·/ }),
  ).toHaveCount(0);
  reject = false;
  await unlink.click();
  await expect(
    links.getByRole("button", { name: "Unlinking…", exact: true }),
  ).toBeDisabled();
  await expect(info).toBeDisabled();
  expect(writes).toBe(2);
  release();
  await expect(
    timeline.getByRole("button", { name: /^Unlinked ·/ }),
  ).toBeVisible();
  await expect(
    timeline.getByRole("button", { name: /^Investment · One-time fee/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(disclosure).toBeFocused();
  expect(writes).toBe(2);
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
  const state = await setup(page, (r) => {
    r.details.lots[0]!.quantityDetails = {
      status: "estimated",
      derivation: "Synthetic net allocation divided by entry price",
      evidence: "Synthetic subscription",
      shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
    };
    r.details.valuation!.records[0]!.shareBasis = {
      key: "issuer-original",
      unitsPerOriginal: 1,
    };
  });
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
    page.getByRole("group", {
      name: "Tokenfolio proxy remaining value · Before carry",
    }),
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
    page.getByRole("group", {
      name: "Reported remaining value · Before carry",
    }),
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
    page.getByRole("group", { name: "Reported remaining value · After carry" }),
  ).toContainText("$12,000.00");
  await expect(
    page.getByRole("group", { name: "Reported remaining value · After carry" }),
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
  const state = await setup(page, (r) => {
    r.details.lots[0]!.quantityDetails = {
      status: "estimated",
      derivation: "Synthetic net allocation divided by entry price",
      evidence: "Synthetic subscription",
      shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
    };
    r.details.valuation!.records[0]!.shareBasis = {
      key: "issuer-original",
      unitsPerOriginal: 1,
    };
  });
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

// The full timezone/DST matrix lives in format.test.ts; retain actual browser
// timezone selection, displayed history, datetime attributes and source dates.
for (const scenario of [
  {
    zone: "America/Los_Angeles",
    times: ["2026-10-03T01:15:42.000Z"],
    expected: ["Oct 2, 2026, 6:15 PM"],
  },
]) {
  test.describe(`local history in ${scenario.zone}`, () => {
    test.use({ timezoneId: scenario.zone });
    test("converts saved instants while preserving source calendar dates", async ({
      page,
    }) => {
      const state = await setup(page);
      const receipts = scenario.times.map((acceptedAt, index) => ({
        ...state.receipt(),
        id: `local-${index}`,
        acceptedAt,
      }));
      await page.route(
        "**/api/investment-positions/synthetic-holding/history",
        (route) =>
          route.fulfill({
            json: {
              entries: receipts.map((receipt) => ({
                kind: "investment",
                receipt,
                previous: receipt,
              })),
              next: null,
            },
          }),
      );
      await expect(page.locator(".holding-value-summary")).toContainText(
        "Sep 30, 2026",
      );
      await page
        .getByRole("button", { name: "Sources & history", exact: true })
        .click();
      const entries = page.locator(".holding-receipt-history time");
      await expect(entries).toHaveText(scenario.expected);
      for (const [index, instant] of scenario.times.entries())
        await expect(entries.nth(index)).toHaveAttribute("datetime", instant);
    });
  });
}

test("cross-class proxies disclose estimated shares, retain failed drafts and persist the selected method", async ({
  page,
}) => {
  const state = await setup(
    page,
    (r) => {
      r.details.lots[0]!.quantityDetails = {
        status: "estimated",
        derivation: "Synthetic net allocation divided by entry price",
        evidence: "Synthetic subscription",
        shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
      };
      r.details.valuation!.records[0]!.shareBasis = {
        key: "issuer-original",
        unitsPerOriginal: 1,
      };
    },
    [],
    { shareClass: "Common", stale: true },
  );
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await select(page, "Source", "Tokenfolio · Other SPV");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await expect(
    page.getByRole("form", { name: "Edit valuation" }),
  ).toContainText("Explicitly accept it as an indicative cross-class proxy");
  await screenshot(page, "valuation-proxy-cross-class.png");
  await select(
    page,
    "Different share class",
    "Use as an indicative cross-class proxy",
  );
  await expect(save).toBeEnabled();
  state.reject(true);
  await save.click();
  await expect(page.getByRole("alert")).toContainText(
    "This source price changed",
  );
  await expect(
    page.getByRole("combobox", { name: "Different share class" }),
  ).toContainText("Use as an indicative cross-class proxy");
  await expect(save).toBeDisabled();
  await screenshot(page, "valuation-proxy-failed.png");
  state.reject(false);
  await page
    .getByRole("button", { name: "Reload sources", exact: true })
    .click();
  await expect(save).toBeEnabled();
  state.pauseSave();
  await save.click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await screenshot(page, "valuation-proxy-saving.png");
  state.resumeSave();
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toBeVisible();
  expect(
    state
      .receipt()
      .details.valuation!.records.find((r) => r.origin === "proxy"),
  ).toMatchObject({
    followSource: true,
    crossClassProxy: true,
    priceSourcePositionId: "another-spv",
  });
  await page.reload();
  const summary = page.getByRole("group", {
    name: "Tokenfolio proxy remaining value · Before carry",
    exact: true,
  });
  await expect(summary).toContainText("$17,724.00");
  await expect(summary).toContainText("Estimated shares");
  await expect(summary).toContainText(
    "Stale source · Last valid estimate retained.",
  );
  await expect(
    page.getByRole("group", {
      name: "Estimated remaining value · After carry",
      exact: true,
    }),
  ).toContainText("$16,415.40");
  await screenshot(page, "valuation-proxy-saved.png");
  await page.getByRole("button", { name: "Edit investment" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Quantity status", exact: true }),
  ).toContainText("Estimated shares");
  await expect(
    page.getByRole("textbox", { name: "Quantity derivation", exact: true }),
  ).toHaveValue("Synthetic net allocation divided by entry price");
  await expect(
    page.getByRole("textbox", { name: "Quantity evidence", exact: true }),
  ).toHaveValue("Synthetic subscription");
  await expect(
    page.getByRole("textbox", { name: "Quantity share basis", exact: true }),
  ).toHaveValue("1");
});

test("custom quantity share bases save, reload and preserve equivalent proxy values", async ({
  page,
}) => {
  const state = await setup(page, (r) => {
    r.details.lots[0]!.quantityDetails = {
      status: "estimated",
      derivation: "Synthetic allocation estimate",
      evidence: "Synthetic split notice",
      shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
    };
  });
  const basis = page.getByRole("textbox", {
    name: "Quantity share basis",
    exact: true,
  });
  const shares = page.getByRole("textbox", { name: "Shares", exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await page.getByRole("button", { name: "Edit investment" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toBeVisible();
  for (const invalid of [
    "",
    "0",
    "-1",
    "1.5",
    "abc",
    "1e1",
    "0x5",
    "1000001",
  ]) {
    await basis.fill(invalid);
    await expect(basis).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
    expect(state.receipt().id).toBe("receipt-1");
  }
  await basis.fill("");
  await expect(basis).toHaveValue("");
  await expect(save).toBeDisabled();
  await basis.fill("5");
  await shares.fill("422");
  await checkBasisKeyboardNavigation(page, {
    previous: page.getByRole("combobox", {
      name: "Quantity status",
      exact: true,
    }),
    basis,
    following: [
      page.getByRole("textbox", { name: "Quantity derivation", exact: true }),
      page.getByRole("textbox", { name: "Quantity evidence", exact: true }),
      page.getByRole("textbox", { name: "Purchase source", exact: true }),
      page.getByRole("button", { name: "Add acquisition", exact: true }),
      page.getByRole("textbox", { name: "Carry · %", exact: true }),
      page.getByRole("combobox", { name: "Carry gains above", exact: true }),
      save,
    ],
  });
  state.reject(true);
  await save.click();
  await expect(page.getByRole("alert")).toContainText(
    "Investment could not be saved",
  );
  await expect(basis).toHaveValue("5");
  await expect(shares).toHaveValue("422");
  state.reject(false);
  state.pauseSave();
  await save.click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(basis).toBeDisabled();
  state.resumeSave();
  await expect(
    page.getByRole("button", { name: "Edit investment" }),
  ).toBeVisible();
  expect(state.receipt().details.lots[0]!.quantityDetails).toMatchObject({
    status: "estimated",
    evidence: "Synthetic split notice",
    shareBasis: { key: "issuer-original", unitsPerOriginal: 5 },
  });
  expect(state.receipt().details.lots[0]!.remainingSharesMicros).toBe(
    422_000_000,
  );
  await page.reload();
  await page.getByRole("button", { name: "Edit investment" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("5");
  await expect(
    page.getByRole("combobox", { name: "Quantity status", exact: true }),
  ).toContainText("Estimated shares");
  await basis.fill("10");
  await shares.fill("844");
  await save.click();
  await expect(
    page.getByRole("button", { name: "Edit investment" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Edit investment" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("10");
  await expect(shares).toHaveValue("844");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await select(page, "Source", "Tokenfolio · Other SPV");
  const preview = page.getByRole("form", { name: "Edit valuation" });
  await expect(preview).toContainText("$17,724.00");
  await expect(preview).toContainText("Estimated shares");
  await save.click();
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("group", {
      name: "Tokenfolio proxy remaining value · Before carry",
      exact: true,
    }),
  ).toContainText("$17,724.00");
});

test("custom price share bases save, reload and preserve equivalent valuations", async ({
  page,
}) => {
  const state = await setup(page, (r) => {
    r.details.lots[0]!.remainingSharesMicros = 422_000_000;
    r.details.lots[0]!.quantityDetails = {
      status: "estimated",
      derivation: "Synthetic allocation estimate",
      evidence: "Synthetic split notice",
      shareBasis: { key: "issuer-original", unitsPerOriginal: 5 },
    };
    r.details.valuation!.records[0]!.shareBasis = {
      key: "issuer-original",
      unitsPerOriginal: 1,
    };
    r.details.valuation!.records[0]!.totalMinor = null;
    r.details.valuation!.selected = {
      recordId: "gp",
      method: "shares",
      sharesKey: valuationSharesKey(r.details),
    };
  });
  const basis = page.getByRole("textbox", {
    name: "Price share basis",
    exact: true,
  });
  const price = page.getByRole("textbox", {
    name: "Share price · $",
    exact: true,
  });
  const save = page.getByRole("button", { name: "Save", exact: true });
  const summary = page.getByRole("group", {
    name: "Estimated remaining value · Before carry",
    exact: true,
  });
  await expect(summary).toContainText("$16,880.00");
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toBeVisible();
  for (const invalid of ["0", "-1", "1.5", "abc", "1e1", "0x5", "1000001"]) {
    await basis.fill(invalid);
    await expect(basis).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
    expect(state.receipt().id).toBe("receipt-1");
  }
  await basis.fill("5");
  await price.fill("40");
  await checkBasisKeyboardNavigation(page, {
    previous: page.getByRole("textbox", { name: "Share class", exact: true }),
    basis,
    following: [
      page.getByRole("textbox", { name: "Source name", exact: true }),
      page.getByRole("textbox", { name: "Source link", exact: true }),
      save,
    ],
  });
  state.reject(true);
  await save.click();
  await expect(page.getByRole("alert")).toContainText(
    "This source price changed",
  );
  await expect(basis).toHaveValue("5");
  await expect(price).toHaveValue("40");
  state.reject(false);
  await page
    .getByRole("button", { name: "Reload sources", exact: true })
    .click();
  await expect(save).toBeEnabled();
  state.pauseSave();
  await save.click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(basis).toBeDisabled();
  state.resumeSave();
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toBeVisible();
  expect(state.receipt().details.valuation!.records[0]).toMatchObject({
    priceMicros: 40_000_000,
    shareBasis: { key: "issuer-original", unitsPerOriginal: 5 },
  });
  await page.reload();
  await expect(summary).toContainText("$16,880.00");
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("5");
  await expect(price).toHaveValue("40");
  await basis.fill("10");
  await price.fill("20");
  await expect(page.locator(".holding-valuation-preview")).toContainText(
    "Estimated shares",
  );
  await save.click();
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toBeVisible();
  await page.reload();
  await expect(summary).toContainText("$16,880.00");
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("10");
  await expect(price).toHaveValue("20");
  await page.getByRole("textbox", { name: "Position total · $" }).fill("16880");
  await basis.fill("");
  await save.click();
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toBeVisible();
  expect(state.receipt().details.valuation!.records[0]!.shareBasis).toBeNull();
  await page.reload();
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("");
});

test("custom quantity factors persist through the API and D1 with immutable receipts", async ({
  page,
}) => {
  const prepared = await prepareSyntheticSpv(page, "quantity");
  const receipts = [prepared.receipt];
  const basis = page.getByRole("textbox", {
    name: "Quantity share basis",
    exact: true,
  });
  const shares = page.getByRole("textbox", { name: "Shares", exact: true });
  await page
    .getByRole("button", { name: "Edit investment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  for (const change of [
    {
      factor: "5",
      shares: "422",
      unitsPerOriginal: 5,
      remainingSharesMicros: 422_000_000,
    },
    {
      factor: "10",
      shares: "844",
      unitsPerOriginal: 10,
      remainingSharesMicros: 844_000_000,
    },
  ]) {
    await basis.fill(change.factor);
    await shares.fill(change.shares);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Edit investment", exact: true }),
    ).toBeVisible();
    await page.reload();
    const receipt = await readStoredReceipt(page, prepared.positionId);
    receipts.push(receipt);
    expect(receipt).toMatchObject({
      positionId: prepared.positionId,
      snapshotId: prepared.snapshotId,
    });
    expect(receipt.details.lots).toHaveLength(1);
    expect(receipt.details.lots[0]).toMatchObject({
      grossCashMinor: 844_000,
      netCapitalMinor: 844_000,
      upfrontDeductionsMinor: 0,
      remainingSharesMicros: change.remainingSharesMicros,
      quantityDetails: {
        status: "estimated",
        derivation: "Synthetic allocation estimate",
        evidence: "Synthetic split notice",
        shareBasis: {
          key: "issuer-original",
          unitsPerOriginal: change.unitsPerOriginal,
        },
      },
    });
    expect(receipt.details.investmentTerms).toMatchObject({
      carryPpm: null,
      carryBasis: "unknown",
    });
    await page
      .getByRole("button", { name: "Edit investment", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Source details", exact: true })
      .click();
    await expect(basis).toHaveValue(change.factor);
    await expect(shares).toHaveValue(change.shares);
    await expect(
      page.getByRole("combobox", { name: "Quantity status", exact: true }),
    ).toContainText("Estimated shares");
    await expect(
      page.getByRole("textbox", { name: "Quantity derivation", exact: true }),
    ).toHaveValue("Synthetic allocation estimate");
    await expect(
      page.getByRole("textbox", { name: "Quantity evidence", exact: true }),
    ).toHaveValue("Synthetic split notice");
    await expectStoredReceiptHistory(page, prepared.positionId, receipts);
  }
});

test("custom price factors persist through the API and D1 with equivalent valuations", async ({
  page,
}) => {
  const prepared = await prepareSyntheticSpv(page, "price");
  const receipts = [prepared.receipt];
  const basis = page.getByRole("textbox", {
    name: "Price share basis",
    exact: true,
  });
  const price = page.getByRole("textbox", {
    name: "Share price · $",
    exact: true,
  });
  const summary = page.getByRole("group", {
    name: "Estimated remaining value · Before carry",
    exact: true,
  });
  await expect(summary).toContainText("$16,880.00");
  await page
    .getByRole("button", { name: "Edit valuation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  for (const change of [
    { factor: "5", price: "40", unitsPerOriginal: 5, priceMicros: 40_000_000 },
    {
      factor: "10",
      price: "20",
      unitsPerOriginal: 10,
      priceMicros: 20_000_000,
    },
  ]) {
    await basis.fill(change.factor);
    await price.fill(change.price);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Edit valuation", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(summary).toContainText("$16,880.00");
    const receipt = await readStoredReceipt(page, prepared.positionId);
    receipts.push(receipt);
    expect(receipt.details.lots).toEqual(prepared.receipt.details.lots);
    expect(receipt.details.investmentTerms).toMatchObject({
      carryPpm: null,
      carryBasis: "unknown",
    });
    expect(receipt.details.valuation?.selected).toMatchObject({
      recordId: "gp",
      method: "shares",
    });
    expect(
      receipt.details.valuation?.records.find((record) => record.id === "gp"),
    ).toMatchObject({
      totalMinor: null,
      priceMicros: change.priceMicros,
      priceDate: "2026-09-30",
      shareBasis: {
        key: "issuer-original",
        unitsPerOriginal: change.unitsPerOriginal,
      },
    });
    expect(
      selectedPositionValuation(receipt, prepared.snapshotId)?.valueMinor,
    ).toBe(1_688_000);
    await page
      .getByRole("button", { name: "Edit valuation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Source details", exact: true })
      .click();
    await expect(basis).toHaveValue(change.factor);
    await expect(price).toHaveValue(change.price);
    await expectStoredReceiptHistory(page, prepared.positionId, receipts);
  }
});

test("missing price dates name the source problem without blaming saved shares", async ({
  page,
}) => {
  await setup(
    page,
    (r) => {
      r.details.lots[0]!.quantityDetails = {
        status: "estimated",
        derivation: "Synthetic allocation",
        evidence: null,
        shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
      };
      r.details.valuation!.records[0]!.shareBasis = {
        key: "issuer-original",
        unitsPerOriginal: 1,
      };
    },
    [],
    { priceDate: null },
  );
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await select(page, "Source", "Tokenfolio · Other SPV");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("form", { name: "Edit valuation" }),
  ).toContainText("The source price has no date.");
  await expect(
    page.getByRole("form", { name: "Edit valuation" }),
  ).not.toContainText("needs dated shares");
  await screenshot(page, "valuation-proxy-missing-date.png");
});
