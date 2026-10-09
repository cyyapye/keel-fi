import type { Holding } from "@keel/domain";
import type { PositionValuationEvidenceSchema } from "@keel/domain/position-purchases";
import {
  reviewedInvestmentFromReceipt,
  effectivePositionValuation,
} from "@keel/domain/position-purchases";
import { estimateProceedsAfterCarry } from "@keel/domain/investment-details";
import { calculatePositionPerformance } from "@keel/domain/position-economics";
import type { ValuationRecord } from "@keel/domain/valuation-record";
type Evidence = ReturnType<typeof PositionValuationEvidenceSchema.parse>;
export function gpRecord(
  holding: Holding,
  evidence?: Evidence | null,
): ValuationRecord {
  const context = holding.purchaseContext!;
  const retained =
    context.receipt?.details.valuation?.snapshotId === context.snapshotId
      ? context.receipt?.details.valuation?.records.find((r) => r.id === "gp")
      : undefined;
  if (retained && !evidence) return retained;
  const adjustment = holding.positionValueContext?.acceptedAdjustment;
  const total = adjustment?.valueMinor ?? context.reportedValueMinor ?? null;
  const priorReview =
    context.receipt?.details.investmentTerms?.reportedValueReview;
  const review =
    (context.receipt?.details.investmentSnapshotId ??
      context.receipt?.snapshotId) === context.snapshotId &&
    priorReview?.valueMinor === total &&
    priorReview.sourceSnapshotId ===
      (context.reportedValueSnapshotId ?? context.snapshotId)
      ? priorReview
      : undefined;
  const price = evidence?.prices.find(
    (p) => p.positionId === holding.id && p.markMicros !== null,
  );
  return {
    id: "gp",
    origin: "gp",
    totalMinor: total,
    priceMicros: price?.markMicros ?? null,
    priceDate: price?.markDate ?? null,
    effectiveDate:
      adjustment?.effectiveDate ??
      review?.effectiveDate ??
      context.sourceObservedOn ??
      "",
    shareClass:
      price?.shareClass ?? context.receipt?.details.lots[0]?.shareClass ?? null,
    carryStatus: review?.carryStatus ?? "unknown",
    sourceLabel:
      adjustment?.sourceLabel ??
      context.reportedSourceLabel ??
      holding.sourceLabel,
    sourceUrl: adjustment?.sourceUrl ?? null,
    sourceEvidenceId: price?.id ?? null,
    sourcePositionId: price?.positionId ?? null,
    sourceCapturedAt: price?.capturedAt ?? null,
    watchEvidenceId: null,
  };
}
export function signedReturn(ppm: number) {
  const n = BigInt(ppm);
  const absolute = n < 0n ? -n : n;
  return `${n < 0n ? "−" : "+"}${absolute / 10000n}.${((absolute % 10000n) / 100n).toString().padStart(2, "0")}%`;
}
export function holdingValueSummary(holding: Holding) {
  const context = holding.purchaseContext!;
  const receipt = context.receipt;
  const selected = effectivePositionValuation(receipt, context.snapshotId);
  const fallback = gpRecord(holding);
  const record =
    selected ??
    (fallback.totalMinor !== null
      ? {
          ...fallback,
          valueMinor: fallback.totalMinor,
          method: "total" as const,
          quantityMicros: null,
        }
      : null);
  const investment = reviewedInvestmentFromReceipt(receipt);
  const reviewed =
    investment?.snapshotId === context.snapshotId ? investment : undefined;
  const after = record
    ? estimateProceedsAfterCarry({
        valueMinor: record.valueMinor,
        carryStatus: record.carryStatus,
        cashPaidMinor:
          reviewed?.cashPaidMinor == null
            ? null
            : Number(
                BigInt(reviewed.cashPaidMinor) -
                  BigInt(reviewed.additionalPaidFeesMinor ?? 0) -
                  BigInt(reviewed.returnedCapitalMinor ?? 0),
              ),
        netCapitalMinor:
          reviewed?.netCapitalMinor ??
          reviewed?.estimatedNetCapitalMinor ??
          null,
        carryPpm: reviewed?.terms.carryPpm ?? null,
        carryBasis: reviewed?.terms.carryBasis ?? "unknown",
      })
    : null;
  const performance = (valueMinor: number) =>
    calculatePositionPerformance({
      currentValueMinor: valueMinor,
      currentValueReported: true,
      realizedValueMinor: holding.realizedValueMinor ?? 0,
      providerCostBasisMinor: holding.costBasisMinor ?? null,
      fundedMinor: holding.investedMinor ?? null,
      economicsContext: holding.positionEconomicsContext ?? null,
      allowFundedAmountEstimate: true,
    });
  return {
    record,
    reviewed,
    after,
    beforeReturn:
      record?.carryStatus === "before_carry"
        ? performance(record.valueMinor)
        : null,
    afterReturn: after ? performance(after.proceedsMinor) : null,
  };
}
