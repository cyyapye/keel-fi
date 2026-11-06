import { HoldingSchema } from "../packages/domain/src/index";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
import {
  PurchaseReceiptSchema,
  reviewedInvestmentFromReceipt,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";

export function purchaseDetailReceipt() {
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
export function purchaseDetailProjection(
  receipt: PurchaseReceipt,
  relatedNames: string[] = [],
  staleProxy = false,
) {
  const holding = HoldingSchema.parse({
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
      ...(staleProxy &&
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
  const holdings = [
    holding,
    ...relatedNames.map((positionName, index) => ({
      ...holding,
      id: `synthetic-related-${index}`,
      positionName,
      purchaseContext: null,
      positionEconomicsContext: null,
      positionValueContext: null,
    })),
  ];
  const view = investmentHoldingsViewFor(holdings);
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
  return { holdings, investmentHoldings: view };
}
