import type { Holding } from "@keel/domain";
import type { PositionValuationEvidenceSchema } from "@keel/domain/position-purchases";
import {
  reviewedInvestmentFromReceipt,
  effectivePositionValuation,
} from "@keel/domain/position-purchases";
import {
  assessInvestmentCarry,
  reconcileHistoricalProceeds,
  summarizeInvestmentCarryCapital,
  type DistributionReview,
  type CarryAssessment,
  type HistoricalProceedsAssessment,
} from "@keel/domain/investment-details";
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
  if (retained) return retained;
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
    (p) =>
      p.positionId ===
        (holding.linkedReportedValue?.sourcePositionId ?? holding.id) &&
      p.markMicros !== null,
  );
  return {
    id: "gp",
    shareBasis: price?.shareBasis ?? null,
    priceSourcePositionId:
      price?.priceSourcePositionId ?? price?.positionId ?? null,
    origin: "gp",
    totalMinor: total,
    priceMicros: price?.markMicros ?? null,
    priceDate: price?.markDate ?? null,
    effectiveDate:
      adjustment?.effectiveDate ??
      (review
        ? (review.effectiveDate ?? "")
        : (context.sourceObservedOn ?? "")),
    shareClass:
      price?.shareClass ?? context.receipt?.details.lots[0]?.shareClass ?? null,
    carryStatus: review?.carryStatus ?? "unknown",
    sourceLabel:
      adjustment?.sourceLabel ??
      review?.sourceLabel ??
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
export function holdingValueSummary(
  holding: Holding,
  distributionReview?: DistributionReview,
) {
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
  const originalInvestment = reviewedInvestmentFromReceipt(receipt);
  const investment =
    originalInvestment && distributionReview
      ? { ...originalInvestment, distributionReview }
      : originalInvestment;
  const receiptReview =
    distributionReview ?? receipt?.details.distributionReview;
  const reviewed =
    investment &&
    (investment.appliesUntilSuperseded ||
      investment.snapshotId === context.snapshotId)
      ? { ...investment, ...(distributionReview ? { distributionReview } : {}) }
      : undefined;
  const valuationDate = record?.effectiveDate || null;
  const carry = assessInvestmentCarry({
    valueMinor: record?.valueMinor ?? null,
    carryStatus: record?.carryStatus ?? "unknown",
    valuationDate,
    investment: reviewed,
  });
  const after = carry.status === "available" ? carry : null;
  const capital = summarizeInvestmentCarryCapital({
    investment: reviewed,
    asOfDate:
      reviewed?.distributionReview?.coverage.throughDate ?? valuationDate,
  });
  const historical = reconcileHistoricalProceeds({
    review: receiptReview,
    providerSnapshotId: context.snapshotId,
    realizedValueMinor: holding.realizedValueMinor ?? null,
    includedRefundMinor: investment?.includedReturnedCapitalMinor ?? 0,
    excludedRefundMinor: investment?.additionalReturnedCapitalMinor ?? 0,
    refundReconciliationPending:
      investment?.returnedCapitalReconciliationPending ?? false,
    asOfDate: valuationDate,
  });
  const performance = (valueMinor: number) =>
    receiptReview && !reviewed
      ? null
      : calculatePositionPerformance({
          currentValueMinor: valueMinor,
          currentValueReported: true,
          realizedValueMinor: holding.realizedValueMinor ?? null,
          providerCostBasisMinor: holding.costBasisMinor ?? null,
          fundedMinor: holding.investedMinor ?? null,
          economicsContext: {
            ...(holding.positionEconomicsContext ?? {
              currency: context.currency,
              committedMinor: holding.investedMinor ?? 0,
              fundedMinor: holding.investedMinor ?? 0,
              acceptedTerms: null,
              reportedTerms: null,
            }),
            snapshotId: context.snapshotId,
            reviewedInvestment: investment,
          },
          allowFundedAmountEstimate: !holding.manualContext,
          valuationDate,
        });
  return {
    record,
    reviewed,
    after,
    carry,
    capital,
    historical,
    beforeReturn:
      record?.carryStatus === "before_carry"
        ? performance(record.valueMinor)
        : null,
    afterReturn: after ? performance(after.proceedsMinor) : null,
  };
}

type UnavailableReason =
  | Extract<CarryAssessment, { status: "unavailable" }>["reason"]
  | Extract<HistoricalProceedsAssessment, { status: "unavailable" }>["reason"];
export function carryUnavailableReason(reason: UnavailableReason): string {
  return (
    {
      missing_value: "The remaining value is unknown.",
      unknown_source_carry:
        "The source value does not specify carry treatment.",
      unknown_carry_rate: "The carry rate is unknown.",
      unknown_capital: "The contributed-capital hurdle is unknown.",
      incomplete_history: "Distribution history is incomplete.",
      unknown_distribution_value: "A historical distribution value is unknown.",
      unknown_prior_carry: "Carry already charged is unknown.",
      missing_valuation_date: "The valuation date is unknown.",
      history_coverage:
        "Distribution history does not cover this valuation date.",
      valuation_predates_distribution:
        "A distribution falls after this valuation date.",
      carry_exceeds_remaining_value:
        "Estimated carry exceeds the remaining value.",
      precision: "The amount exceeds supported precision.",
      unknown_refund_inclusion: "Refund inclusion is unknown.",
      unknown_provider_distributions:
        "The provider-reported distribution total is unknown.",
      provider_amount_mismatch:
        "Provider-reported distributions and complete distribution history do not reconcile. Review which distributions are already included before calculating total return.",
      provider_binding_stale:
        "Distribution inclusion needs review against the current provider statement.",
      unknown_provider_inclusion:
        "Distribution inclusion in provider-reported distributions is unknown.",
      unsupported_mixed_inclusion:
        "Provider-reported distributions include only some recorded distributions.",
    } satisfies Record<UnavailableReason, string>
  )[reason];
}
