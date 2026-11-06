import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { HoldingImportPreviewSchema } from "../packages/domain/src/index";
import { HoldingsPageSchema } from "../packages/domain/src/holdings-page";
import { providerHoldingsTemplateCsv } from "../packages/connectors/src/provider-holdings-template-csv";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
import {
  PurchaseReceiptSchema,
  InvestmentHistorySchema,
  AcceptPurchasesSchema,
  selectedPositionValuation,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { AcceptValuationSchema } from "../packages/domain/src/valuation-record";

test.use({ timezoneId: "UTC" });

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
    {
      factor: "5",
      price: "40",
      unitsPerOriginal: 5,
      priceMicros: 40_000_000,
    },
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
