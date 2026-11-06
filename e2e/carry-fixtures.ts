import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import { providerHoldingsTemplateCsv } from "../packages/connectors/src/provider-holdings-template-csv";
import {
  HoldingImportPreviewSchema,
  HoldingSchema,
  type Holding,
} from "../packages/domain/src/index";
import { HoldingsPageSchema } from "../packages/domain/src/holdings-page";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
import {
  AcceptPurchasesSchema,
  PurchaseReceiptSchema,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import {
  AcceptValuationSchema,
  type ValuationRecord,
} from "../packages/domain/src/valuation-record";

export type PreparedCarryPosition = {
  holding: Holding;
  positionId: string;
  snapshotId: string;
  receipt: PurchaseReceipt;
};

export async function prepareCarryPosition(
  request: APIRequestContext,
  options: {
    providerRealizedValueMinor: 0 | 900_000;
    carryStatus: ValuationRecord["carryStatus"];
    undatedProviderReview?: boolean;
  },
): Promise<PreparedCarryPosition> {
  const suffix = randomUUID();
  const positionName = `Synthetic carry SPV ${suffix}`;
  const ownerLabel = `Synthetic carry trust ${suffix}`;
  const csv =
    providerHoldingsTemplateCsv("wefunder") +
    [
      `Synthetic carry company ${suffix}`,
      positionName,
      "SPV",
      ownerLabel,
      "Live",
      "2025-06-10",
      "2026-10-01",
      "$30000.00",
      "$30000.00",
      "$40000.00",
      options.providerRealizedValueMinor === 900_000 ? "$9000.00" : "$0.00",
      "Preferred",
    ].join(",") +
    "\n";
  const imported = await request.post("/api/holding-imports/wefunder", {
    multipart: {
      file: {
        name: `synthetic-carry-${suffix}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      },
    },
  });
  expect(imported.status(), await imported.text()).toBe(201);
  const preview = HoldingImportPreviewSchema.parse(await imported.json());
  expect(preview).toMatchObject({
    provider: "wefunder",
    status: "applied",
    summary: {
      rowCount: 1,
      createCount: 1,
      autoAppliedCount: 1,
      needsAttentionCount: 0,
      quarantinedCount: 0,
    },
  });
  expect(preview.rows).toHaveLength(1);
  expect(preview.rows[0]).toMatchObject({
    positionName,
    ownerLabel,
    realizedValueMinor: options.providerRealizedValueMinor,
    decisionSource: "policy",
    adjudicationStatus: "auto_applied",
  });
  const importReadback = await request.get(
    `/api/holding-imports/${encodeURIComponent(preview.id)}`,
  );
  expect(importReadback.status(), await importReadback.text()).toBe(200);
  expect(HoldingImportPreviewSchema.parse(await importReadback.json())).toEqual(
    preview,
  );

  const initialResponse = await request.get("/api/holdings-page");
  expect(initialResponse.status(), await initialResponse.text()).toBe(200);
  const initialPage = HoldingsPageSchema.parse(await initialResponse.json());
  const importedHolding = HoldingSchema.parse(
    initialPage.holdings.find(
      (holding) => holding.positionName === positionName,
    ),
  );
  expect(importedHolding).toMatchObject({
    ownerLabel,
    positionKind: "spv_interest",
    investedMinor: 3_000_000,
    administratorNavMinor: 4_000_000,
    realizedValueMinor: options.providerRealizedValueMinor,
  });
  const context = importedHolding.purchaseContext;
  if (!context)
    throw new Error("Synthetic carry position has no purchase context.");
  const positionId = importedHolding.id;
  const snapshotId = context.snapshotId;
  const expectedTermsId =
    importedHolding.positionEconomicsContext?.acceptedTerms?.id ?? null;
  const purchases = AcceptPurchasesSchema.parse({
    expectedSnapshotId: snapshotId,
    expectedReceiptId: context.receipt?.id ?? null,
    expectedTermsId,
    details: {
      investmentTerms: {
        ...unknownInvestmentTerms(),
        importedAmountBasis: "gross_cash",
        carryPpm: 200_000,
        carryBasis: "gross_cash",
        ...(options.undatedProviderReview
          ? {
              reportedValueReview: {
                valueMinor: 4_000_000,
                sourceSnapshotId: context.reportedValueSnapshotId ?? snapshotId,
                sourceLabel: "Synthetic undated GP review",
                effectiveDate: null,
                carryStatus: options.carryStatus,
              },
            }
          : {}),
      },
      cashCoversPosition: true,
      coversPosition: true,
      lots: [
        {
          id: "synthetic-carry-acquisition",
          purchasedOn: "2025-06-10",
          shareClass: "Preferred",
          priceMicros: null,
          referencePriceMicros: null,
          grossCashMinor: 3_000_000,
          netCapitalMinor: 2_700_000,
          upfrontDeductionsMinor: 300_000,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          originalSharesUnchanged: false,
          remainingSharesMicros: 200_000_000,
          sharesAsOf: "2026-10-01",
          sourceLabel: "Synthetic carry subscription",
          sourceUrl: null,
          mark: null,
          fees: [
            {
              id: "synthetic-carry-upfront-fee",
              coveredLotIds: ["synthetic-carry-acquisition"],
              treatment: "upfront",
              paymentStatus: "paid",
              dueDate: null,
              kind: "one_time",
              label: "Synthetic upfront deductions",
              method: "paid",
              paidMinor: 300_000,
              ratePpm: null,
              basis: "cash",
              basisMinor: null,
              prepaidMonths: null,
            },
          ],
          feesComplete: true,
          quantityDetails: {
            status: "confirmed",
            derivation: "Synthetic remaining-share statement",
            evidence: "Synthetic remaining-share statement dated 2026-10-01",
            shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
          },
        },
      ],
    },
  });
  const accepted = await request.post(
    `/api/investment-positions/${encodeURIComponent(positionId)}/purchases`,
    { data: purchases },
  );
  expect(accepted.status(), await accepted.text()).toBe(201);
  const purchaseReceipt = PurchaseReceiptSchema.parse(await accepted.json());
  expect(purchaseReceipt).toMatchObject({
    positionId,
    snapshotId,
    details: purchases.details,
  });
  expect(purchaseReceipt.details.distributionReview).toBeUndefined();

  let receipt = purchaseReceipt;
  if (!options.undatedProviderReview) {
    const valuation = AcceptValuationSchema.parse({
      expectedSnapshotId: snapshotId,
      expectedReceiptId: purchaseReceipt.id,
      expectedTermsId,
      method: "total",
      record: {
        id: "gp",
        origin: "gp",
        totalMinor: 4_000_000,
        priceMicros: null,
        effectiveDate: "2026-10-01",
        priceDate: null,
        shareClass: null,
        shareBasis: null,
        carryStatus: options.carryStatus,
        sourceLabel: "Synthetic carry GP statement",
        sourceUrl: null,
        sourceEvidenceId: null,
        sourcePositionId: null,
        sourceCapturedAt: null,
        watchEvidenceId: null,
      },
    });
    const valued = await request.post(
      `/api/investment-positions/${encodeURIComponent(positionId)}/valuation`,
      { data: valuation },
    );
    expect(valued.status(), await valued.text()).toBe(201);
    receipt = PurchaseReceiptSchema.parse(await valued.json());
    expect(receipt.id).not.toBe(purchaseReceipt.id);
    expect(receipt).toMatchObject({
      positionId,
      snapshotId,
      details: {
        ...purchases.details,
        investmentSnapshotId: snapshotId,
        valuation: {
          snapshotId,
          selected: { recordId: "gp", method: "total", sharesKey: null },
          records: [valuation.record],
        },
      },
    });
  }
  expect(receipt.details.distributionReview).toBeUndefined();

  const finalResponse = await request.get("/api/holdings-page");
  expect(finalResponse.status(), await finalResponse.text()).toBe(200);
  const finalPage = HoldingsPageSchema.parse(await finalResponse.json());
  const holding = HoldingSchema.parse(
    finalPage.holdings.find((item) => item.id === positionId),
  );
  expect(holding.purchaseContext).toMatchObject({ snapshotId, receipt });
  expect(holding.realizedValueMinor).toBe(options.providerRealizedValueMinor);
  return { holding, positionId, snapshotId, receipt };
}
