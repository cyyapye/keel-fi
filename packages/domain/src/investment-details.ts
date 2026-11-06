import { z } from "zod";

const money = z.number().int().safe().nonnegative();
const rate = z.number().int().min(0).max(1_000_000);

const distributionEvidence = {
  sourceLabel: z.string().trim().min(1).max(500),
  sourceUrl: z.url().max(2048).nullable(),
  note: z.string().trim().max(2000),
};
const distributionEvent = {
  id: z.string().trim().min(1).max(100),
  receivedOn: z.iso.date(),
  investorValueMinor: money.nullable(),
  ...distributionEvidence,
};
export const DistributionReviewSchema = z
  .object({
    method: z.literal("capital_return_first_v1"),
    events: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("cash"), ...distributionEvent }).strict(),
          z
            .object({
              kind: z.literal("in_kind"),
              ...distributionEvent,
              securityLabel: z.string().trim().min(1).max(500).nullable(),
              quantityMicros: money.max(1_000_000_000_000).nullable(),
            })
            .strict(),
        ]),
      )
      .max(100),
    coverage: z
      .object({
        status: z.enum(["complete", "incomplete"]),
        throughDate: z.iso.date(),
      })
      .strict(),
    priorCarry: z.discriminatedUnion("status", [
      z.object({ status: z.literal("known"), amountMinor: money }).strict(),
      z.object({ status: z.literal("unknown") }).strict(),
    ]),
    provider: z
      .object({
        inclusion: z.enum(["all", "none", "unknown", "unsupported_mixed"]),
        sourceSnapshotId: z.string().min(1).max(200),
        realizedValueMinor: money,
      })
      .strict(),
    ...distributionEvidence,
  })
  .strict()
  .superRefine((review, ctx) => {
    const issue = (message: string, path: string[]) =>
      ctx.addIssue({ code: "custom", message, path });
    if (
      new Set(review.events.map((event) => event.id)).size !==
      review.events.length
    )
      issue("Each distribution needs a unique identifier.", ["events"]);
    if (
      review.events.some(
        (event) => event.receivedOn > review.coverage.throughDate,
      )
    )
      issue("History coverage must reach every recorded distribution.", [
        "coverage",
        "throughDate",
      ]);
    if (
      review.coverage.status === "complete" &&
      review.events.length === 0 &&
      (review.priorCarry.status !== "known" ||
        review.priorCarry.amountMinor !== 0)
    )
      issue("Complete empty history requires explicitly zero prior carry.", [
        "priorCarry",
      ]);
    const total = review.events.reduce(
      (sum, event) => sum + BigInt(event.investorValueMinor ?? 0),
      review.priorCarry.status === "known"
        ? BigInt(review.priorCarry.amountMinor)
        : 0n,
    );
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      issue("Distribution totals exceed supported precision.", ["events"]);
    if (new TextEncoder().encode(JSON.stringify(review)).byteLength > 65_536)
      issue("Distribution review exceeds 64 KiB.", ["events"]);
  });
export type DistributionReview = z.infer<typeof DistributionReviewSchema>;

// Reviewed terms are intentionally distinct from imported source observations.
// A missing rate is unknown, including when exact upfront cash is known.
export const InvestmentTermsSchema = z
  .object({
    importedAmountBasis: z.enum(["gross_cash", "net_capital", "unknown"]),
    annualManagementFeePpm: rate.nullable(),
    annualManagementBasis: z.enum(["gross_cash", "net_capital", "unknown"]),
    carryPpm: rate.nullable(),
    carryBasis: z.enum(["gross_cash", "net_capital", "unknown"]),
    reportedValueReview: z
      .object({
        sourceSnapshotId: z.string().min(1),
        valueMinor: money,
        sourceLabel: z.string().trim().min(1).max(500),
        effectiveDate: z.iso.date().nullable(),
        carryStatus: z.enum(["before_carry", "after_carry", "unknown"]),
      })
      .strict()
      .nullable(),
    note: z.string().trim().max(1000),
  })
  .strict();

export const ReviewedInvestmentSchema = z.object({
  appliesUntilSuperseded: z.literal(true).optional(),
  snapshotId: z.string().min(1),
  receiptId: z.string().min(1),
  cashPaidMinor: money.nullable(),
  additionalPaidFeesMinor: money.nullable().optional(),
  upfrontDeductionsMinor: money.nullable(),
  returnedCapitalMinor: money.optional(),
  additionalReturnedCapitalMinor: money.optional(),
  includedReturnedCapitalMinor: money.optional(),
  returnedCapitalReconciliationPending: z.boolean().optional(),
  netCapitalMinor: money.nullable(),
  // A projection from complete reviewed fee terms, never an accepted allocation.
  estimatedNetCapitalMinor: money.nullable().optional(),
  distributionReview: DistributionReviewSchema.optional(),
  terms: InvestmentTermsSchema,
});

export type InvestmentTerms = z.infer<typeof InvestmentTermsSchema>;
export type ReviewedInvestment = z.infer<typeof ReviewedInvestmentSchema>;

export const unknownInvestmentTerms = (): InvestmentTerms => ({
  importedAmountBasis: "unknown",
  annualManagementFeePpm: null,
  annualManagementBasis: "unknown",
  carryPpm: null,
  carryBasis: "unknown",
  reportedValueReview: null,
  note: "",
});

/** Exact cash reconciliation. Rates describe components and never replace totals. */
export function reconcileInvestmentCapital(input: {
  grossCashMinor: number | null;
  netCapitalMinor: number | null;
  upfrontDeductionsMinor: number | null;
}) {
  let gross = input.grossCashMinor;
  let net = input.netCapitalMinor;
  let deductions = input.upfrontDeductionsMinor;
  if (
    [gross, net, deductions].some(
      (n) => n !== null && (!Number.isSafeInteger(n) || n < 0),
    )
  )
    return {
      grossCashMinor: gross,
      netCapitalMinor: net,
      upfrontDeductionsMinor: deductions,
      conflict: true,
    };
  if (gross !== null && net !== null)
    deductions ??= Number(BigInt(gross) - BigInt(net));
  else if (gross !== null && deductions !== null)
    net = Number(BigInt(gross) - BigInt(deductions));
  else if (net !== null && deductions !== null) {
    const sum = BigInt(net) + BigInt(deductions);
    gross = sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : NaN;
  }
  const values = [gross, net, deductions];
  const conflict =
    values.some((n) => n !== null && (!Number.isSafeInteger(n) || n < 0)) ||
    (gross !== null &&
      net !== null &&
      deductions !== null &&
      BigInt(gross) !== BigInt(net) + BigInt(deductions));
  return {
    grossCashMinor: gross,
    netCapitalMinor: net,
    upfrontDeductionsMinor: deductions,
    conflict,
  };
}

export type CarryAssessment =
  | {
      status: "available";
      method:
        | "cumulative"
        | "legacy_remaining_only"
        | "reported_after_carry"
        | "zero_carry";
      carryMinor: number | null;
      proceedsMinor: number;
      alreadyAfterCarry: boolean;
    }
  | {
      status: "unavailable";
      reason:
        | "missing_value"
        | "unknown_source_carry"
        | "unknown_carry_rate"
        | "unknown_capital"
        | "incomplete_history"
        | "unknown_distribution_value"
        | "unknown_prior_carry"
        | "missing_valuation_date"
        | "history_coverage"
        | "valuation_predates_distribution"
        | "carry_exceeds_remaining_value"
        | "precision";
    };

export type CarryCapitalSummary = {
  capitalBasisMinor: number | null;
  investorDistributionsMinor: number | null;
  capitalRemainingMinor: number | null;
  historyReason:
    | NonNullable<ReturnType<typeof distributionHistoryFailure>>
    | "unreviewed_history"
    | null;
};

function investmentCarryBasis(
  investment: ReviewedInvestment | undefined,
): number | null {
  const cash =
    investment?.cashPaidMinor == null
      ? null
      : BigInt(investment.cashPaidMinor) -
        BigInt(investment.additionalPaidFeesMinor ?? 0) -
        BigInt(investment.returnedCapitalMinor ?? 0);
  const basis =
    investment?.terms.carryBasis === "gross_cash"
      ? cash
      : investment?.terms.carryBasis === "net_capital"
        ? (investment.netCapitalMinor ??
          investment.estimatedNetCapitalMinor ??
          null)
        : null;
  return basis !== null && BigInt(basis) >= 0n ? Number(basis) : null;
}

export function summarizeInvestmentCarryCapital(input: {
  investment: ReviewedInvestment | undefined;
  asOfDate: string | null;
}): CarryCapitalSummary {
  const capitalBasisMinor = investmentCarryBasis(input.investment);
  const review = input.investment?.distributionReview;
  const historyReason = review
    ? distributionHistoryFailure(review, input.asOfDate)
    : "unreviewed_history";
  const investorDistributionsMinor =
    review && historyReason === null
      ? Number(
          review.events.reduce(
            (sum, event) => sum + BigInt(event.investorValueMinor!),
            0n,
          ),
        )
      : null;
  const remaining =
    capitalBasisMinor !== null && investorDistributionsMinor !== null
      ? BigInt(capitalBasisMinor) - BigInt(investorDistributionsMinor)
      : null;
  return {
    capitalBasisMinor,
    investorDistributionsMinor,
    capitalRemainingMinor:
      remaining === null ? null : Number(remaining > 0n ? remaining : 0n),
    historyReason,
  };
}

export function assessInvestmentCarry(input: {
  valueMinor: number | null;
  carryStatus: "before_carry" | "after_carry" | "unknown";
  valuationDate: string | null;
  investment: ReviewedInvestment | undefined;
}): CarryAssessment {
  const unavailable = (
    reason: Extract<CarryAssessment, { status: "unavailable" }>["reason"],
  ): CarryAssessment => ({ status: "unavailable", reason });
  if (input.valueMinor === null) return unavailable("missing_value");
  if (input.carryStatus === "unknown")
    return unavailable("unknown_source_carry");
  if (input.carryStatus === "after_carry")
    return {
      status: "available",
      method: "reported_after_carry",
      carryMinor: null,
      proceedsMinor: input.valueMinor,
      alreadyAfterCarry: true,
    };
  const investment = input.investment;
  const rate = investment?.terms.carryPpm;
  if (rate == null) return unavailable("unknown_carry_rate");
  if (rate === 0)
    return {
      status: "available",
      method: "zero_carry",
      carryMinor: 0,
      proceedsMinor: input.valueMinor,
      alreadyAfterCarry: false,
    };
  const basis = investmentCarryBasis(investment);
  if (basis === null) return unavailable("unknown_capital");
  const review = investment?.distributionReview;
  let historical = 0n,
    priorCarry = 0n;
  if (review) {
    const failure = distributionHistoryFailure(review, input.valuationDate);
    if (failure) return unavailable(failure);
    if (review.priorCarry.status === "unknown")
      return unavailable("unknown_prior_carry");
    priorCarry = BigInt(review.priorCarry.amountMinor);
    historical = review.events.reduce(
      (sum, event) => sum + BigInt(event.investorValueMinor!),
      priorCarry,
    );
  }
  const gain = BigInt(input.valueMinor) + historical - BigInt(basis);
  const totalCarry =
    gain > 0n ? (gain * BigInt(rate) + 500_000n) / 1_000_000n : 0n;
  const incremental = totalCarry > priorCarry ? totalCarry - priorCarry : 0n;
  if (incremental > BigInt(input.valueMinor))
    return unavailable("carry_exceeds_remaining_value");
  if (incremental > BigInt(Number.MAX_SAFE_INTEGER))
    return unavailable("precision");
  return {
    status: "available",
    method: review ? "cumulative" : "legacy_remaining_only",
    carryMinor: Number(incremental),
    proceedsMinor: Number(BigInt(input.valueMinor) - incremental),
    alreadyAfterCarry: false,
  };
}

function distributionHistoryFailure(
  review: DistributionReview,
  valuationDate: string | null,
) {
  if (review.coverage.status !== "complete")
    return "incomplete_history" as const;
  if (review.events.some((event) => event.investorValueMinor === null))
    return "unknown_distribution_value" as const;
  if (!valuationDate) return "missing_valuation_date" as const;
  if (review.coverage.throughDate < valuationDate)
    return "history_coverage" as const;
  if (review.events.some((event) => event.receivedOn > valuationDate))
    return "valuation_predates_distribution" as const;
  return null;
}

export type HistoricalProceedsAssessment =
  | {
      status: "available";
      netDistributionsMinor: number;
      paidInDistributionsMinor: number;
    }
  | {
      status: "unavailable";
      reason:
        | "incomplete_history"
        | "unknown_distribution_value"
        | "missing_valuation_date"
        | "history_coverage"
        | "valuation_predates_distribution"
        | "unknown_refund_inclusion"
        | "provider_amount_mismatch"
        | "provider_binding_stale"
        | "unknown_provider_inclusion"
        | "unsupported_mixed_inclusion"
        | "precision";
    };

export function reconcileHistoricalProceeds(input: {
  review: DistributionReview | undefined;
  providerSnapshotId: string;
  realizedValueMinor: number;
  includedRefundMinor: number;
  excludedRefundMinor: number;
  refundReconciliationPending: boolean;
  asOfDate: string | null;
}): HistoricalProceedsAssessment {
  const unavailable = (
    reason: Extract<
      HistoricalProceedsAssessment,
      { status: "unavailable" }
    >["reason"],
  ): HistoricalProceedsAssessment => ({
    status: "unavailable" as const,
    reason,
  });
  if (input.refundReconciliationPending)
    return unavailable("unknown_refund_inclusion");
  const realized = BigInt(input.realizedValueMinor),
    includedRefund = BigInt(input.includedRefundMinor);
  if (includedRefund > realized) return unavailable("provider_amount_mismatch");
  let additional = 0n;
  if (input.review) {
    const review = input.review;
    const failure = distributionHistoryFailure(review, input.asOfDate);
    if (failure) return unavailable(failure);
    if (
      review.provider.sourceSnapshotId !== input.providerSnapshotId ||
      review.provider.realizedValueMinor !== input.realizedValueMinor
    )
      return unavailable("provider_binding_stale");
    if (
      review.provider.inclusion === "unknown" ||
      review.provider.inclusion === "unsupported_mixed"
    )
      return unavailable(
        review.provider.inclusion === "unknown"
          ? "unknown_provider_inclusion"
          : "unsupported_mixed_inclusion",
      );
    const total = review.events.reduce(
      (sum, event) => sum + BigInt(event.investorValueMinor!),
      0n,
    );
    if (
      realized !==
      includedRefund + (review.provider.inclusion === "all" ? total : 0n)
    )
      return unavailable("provider_amount_mismatch");
    if (review.provider.inclusion === "none") additional = total;
  }
  const netDistributions = realized - includedRefund + additional;
  const paidInDistributions =
    realized + additional + BigInt(input.excludedRefundMinor);
  if (
    netDistributions > BigInt(Number.MAX_SAFE_INTEGER) ||
    paidInDistributions > BigInt(Number.MAX_SAFE_INTEGER)
  )
    return unavailable("precision");
  return {
    status: "available" as const,
    netDistributionsMinor: Number(netDistributions),
    paidInDistributionsMinor: Number(paidInDistributions),
  };
}
