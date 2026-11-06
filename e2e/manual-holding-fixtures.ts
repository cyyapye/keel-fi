import { HoldingSchema } from "../packages/domain/src/index";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
import { createInvestmentExposureView } from "../packages/domain/src/exposure-read-model";
import { PurchaseReceiptSchema } from "../packages/domain/src/position-purchases";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";

export const positionId = "synthetic-manual-position";
export const holding = () =>
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
export function receiptWithCash(cashPaidMinor: number | null) {
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

export function manualFundWithEstimate() {
  const current = HoldingSchema.parse({
    ...holding(),
    positionKind: "fund_interest",
    positionName: "Synthetic Orchard Fund",
    investedMinor: 2_500_000,
  });
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
  return { current, view };
}
