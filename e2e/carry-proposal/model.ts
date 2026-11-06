import { z } from "zod";
import {
  assessInvestmentCarry,
  DistributionReviewSchema,
  summarizeInvestmentCarryCapital,
  reconcileHistoricalProceeds,
  type ReviewedInvestment,
} from "../../packages/domain/src/investment-details";
import { calculatePositionPerformance } from "../../packages/domain/src/position-economics";

const CommonEventSchema = z.object({
  id: z.string(),
  receivedOn: z.string(),
  amount: z.string(),
  evidence: z.string(),
});
const EventSchema = z.discriminatedUnion("kind", [
  CommonEventSchema.extend({ kind: z.literal("cash") }),
  CommonEventSchema.extend({
    kind: z.literal("stock"),
    security: z.string(),
    quantity: z.string(),
  }),
]);
export const DraftSchema = z.object({
  events: z.array(EventSchema),
  coverage: z.enum(["complete", "partial", "unknown"]),
  throughDate: z.string(),
  priorCarryAmount: z.string(),
  providerInclusion: z.enum(["included", "excluded", "unknown", "mixed"]),
});
export type Distribution = z.infer<typeof EventSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type Source = {
  carry: "before_carry" | "after_carry" | "unknown";
  reportedDistributions: bigint;
};
export type Receipt = {
  id: string;
  recordedAt: string;
  label: string;
  snapshot: Draft;
};
export type Editor =
  | { phase: "closed" }
  | { phase: "editing" | "failed" | "saving"; draft: Draft };

export const facts = {
  capital: 3_000_000n,
  fees: 300_000n,
  netInvested: 2_700_000n,
  remaining: 4_000_000n,
  asOf: "2026-10-01",
  carryPpm: 200_000n,
};
export type CalculationFacts = typeof facts;
export const ordinary: Draft = {
  events: [
    {
      id: "demo-stock-1",
      kind: "stock",
      receivedOn: "2026-06-01",
      amount: "9000",
      security: "Demo common stock",
      quantity: "60",
      evidence: "Demo distribution notice",
    },
  ],
  coverage: "complete",
  throughDate: facts.asOf,
  priorCarryAmount: "0",
  providerInclusion: "included",
};

export function clone(draft: Draft): Draft {
  return structuredClone(draft);
}

export function cents(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match
    ? BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))
    : null;
}
export function money(amount: bigint): string {
  const sign = amount < 0n ? "−" : "";
  const value = amount < 0n ? -amount : amount;
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = value % 100n;
  return `${sign}$${whole}${fraction ? `.${fraction.toString().padStart(2, "0")}` : ""}`;
}
export function date(value: string): string {
  if (!value) return "Date unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function invalid(draft: Draft): string | null {
  if (!DraftSchema.safeParse(draft).success)
    return "Review the distribution fields.";
  for (const event of draft.events) {
    if (!validDate(event.receivedOn))
      return "Enter the date each distribution was received.";
    if (!event.evidence.trim())
      return "Name the evidence for each distribution.";
    if (event.amount.trim() && cents(event.amount) === null)
      return "Enter a nonnegative amount with at most two decimal places.";
    if (event.kind === "stock") {
      if (
        event.quantity.trim() &&
        (!/^(?:[1-9]\d*|0)(?:\.\d{1,6})?$/.test(event.quantity) ||
          BigInt(event.quantity.replace(".", "")) === 0n)
      )
        return "Enter a positive share quantity, or leave it blank when unknown.";
    }
  }
  if (!validDate(draft.throughDate))
    return "Enter the date covered by this distribution history.";
  if (draft.events.some((event) => event.receivedOn > draft.throughDate))
    return "The history date must cover every recorded distribution.";
  if (draft.priorCarryAmount.trim() && cents(draft.priorCarryAmount) === null)
    return "Enter a nonnegative carry amount with at most two decimal places.";
  if (
    draft.coverage === "complete" &&
    draft.events.length === 0 &&
    cents(draft.priorCarryAmount) !== 0n
  )
    return "Confirm zero carry already charged for a complete history with no distributions.";
  return null;
}

const reasons = {
  missing_value: "The remaining value is unknown.",
  unknown_source_carry: "The source value does not specify carry treatment.",
  unknown_carry_rate: "The carry rate is unknown.",
  unknown_capital: "The contributed-capital hurdle is unknown.",
  incomplete_history: "Distribution history is incomplete.",
  unknown_distribution_value: "A historical distribution value is unknown.",
  unknown_prior_carry: "Carry already charged is unknown.",
  missing_valuation_date: "The valuation date is unknown.",
  history_coverage: "Distribution history does not cover this valuation date.",
  valuation_predates_distribution:
    "A distribution falls after this valuation date.",
  carry_exceeds_remaining_value:
    "Estimated carry exceeds the remaining value. The supported estimate is unavailable.",
  precision: "The amount exceeds supported precision.",
  unknown_refund_inclusion: "Refund inclusion is unknown.",
  provider_amount_mismatch:
    "The provider total and complete distribution history do not reconcile. Review inclusion before calculating return.",
  provider_binding_stale:
    "Distribution inclusion needs review against the current provider statement.",
  unknown_provider_inclusion:
    "Return unavailable until distribution inclusion in the provider total is known.",
  unsupported_mixed_inclusion:
    "Return unavailable because mixed provider inclusion is not supported. Review which distributions the provider includes.",
};
function minor(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("The amount exceeds supported precision.");
  return Number(value);
}
export function investmentFromDraft(
  draft: Draft,
  source: Source,
  inputs: CalculationFacts = facts,
): ReviewedInvestment {
  const error = invalid(draft);
  if (error) throw new Error(error);
  const distributionReview = DistributionReviewSchema.parse({
    method: "capital_return_first_v1",
    events: draft.events.map((event) => {
      const common = {
        id: event.id,
        receivedOn: event.receivedOn,
        investorValueMinor: event.amount.trim()
          ? minor(cents(event.amount)!)
          : null,
        sourceLabel: event.evidence,
        sourceUrl: null,
        note: "",
      };
      return event.kind === "cash"
        ? { ...common, kind: "cash" }
        : {
            ...common,
            kind: "in_kind",
            securityLabel: event.security.trim() || null,
            quantityMicros: event.quantity.trim()
              ? minor(
                  BigInt(event.quantity.replace(".", "")) *
                    10n **
                      BigInt(6 - (event.quantity.split(".")[1]?.length ?? 0)),
                )
              : null,
          };
    }),
    coverage: {
      status: draft.coverage === "complete" ? "complete" : "incomplete",
      throughDate: draft.throughDate,
    },
    priorCarry: !draft.priorCarryAmount.trim()
      ? { status: "unknown" }
      : {
          status: "known",
          amountMinor: minor(cents(draft.priorCarryAmount)!),
        },
    provider: {
      inclusion: {
        included: "all",
        excluded: "none",
        unknown: "unknown",
        mixed: "unsupported_mixed",
      }[draft.providerInclusion],
      sourceSnapshotId: "demo-position-snapshot",
      realizedValueMinor: minor(source.reportedDistributions),
    },
    sourceLabel: "Demo distribution history review",
    sourceUrl: null,
    note: "",
  });
  return {
    snapshotId: "demo-position-snapshot",
    receiptId: "demo-investment-receipt",
    cashPaidMinor: minor(inputs.capital),
    upfrontDeductionsMinor: minor(inputs.fees),
    netCapitalMinor: minor(inputs.netInvested),
    distributionReview,
    terms: {
      importedAmountBasis: "gross_cash",
      annualManagementFeePpm: null,
      annualManagementBasis: "unknown",
      carryPpm: minor(inputs.carryPpm),
      carryBasis: "gross_cash",
      reportedValueReview: null,
      note: "",
    },
  };
}
export function calculate(
  draft: Draft,
  source: Source,
  inputs: CalculationFacts = facts,
) {
  const empty = {
    received: null,
    unreturned: null,
    carry: null,
    after: null,
    beforeReturn: null,
    afterReturn: null,
  };
  const inputError = invalid(draft);
  if (inputError)
    return { ...empty, inputError, carryReason: null, returnReason: null };
  let investment: ReviewedInvestment;
  try {
    investment = investmentFromDraft(draft, source, inputs);
  } catch {
    return {
      ...empty,
      inputError: "Review the distribution fields and supported amounts.",
      carryReason: null,
      returnReason: null,
    };
  }
  const carry = assessInvestmentCarry({
    valueMinor: minor(inputs.remaining),
    carryStatus: source.carry,
    valuationDate: inputs.asOf,
    investment,
  });
  const capital = summarizeInvestmentCarryCapital({
    investment,
    asOfDate: draft.throughDate,
  });
  const historical = reconcileHistoricalProceeds({
    review: investment.distributionReview,
    providerSnapshotId: investment.snapshotId,
    realizedValueMinor: minor(source.reportedDistributions),
    includedRefundMinor: 0,
    excludedRefundMinor: 0,
    refundReconciliationPending: false,
    asOfDate: inputs.asOf,
  });
  const performance = (valueMinor: number | null) =>
    calculatePositionPerformance({
      currentValueMinor: valueMinor,
      currentValueReported: valueMinor !== null,
      realizedValueMinor: minor(source.reportedDistributions),
      providerCostBasisMinor: null,
      fundedMinor: minor(inputs.capital),
      economicsContext: {
        snapshotId: investment.snapshotId,
        currency: "USD",
        committedMinor: minor(inputs.capital),
        fundedMinor: minor(inputs.capital),
        acceptedTerms: null,
        reportedTerms: null,
        reviewedInvestment: investment,
      },
      allowFundedAmountEstimate: false,
      valuationDate: inputs.asOf,
    }).totalReturnPpm;
  return {
    inputError: null,
    received:
      capital.investorDistributionsMinor === null
        ? null
        : BigInt(capital.investorDistributionsMinor),
    unreturned:
      capital.capitalRemainingMinor === null
        ? null
        : BigInt(capital.capitalRemainingMinor),
    carry:
      carry.status === "available" && carry.carryMinor !== null
        ? BigInt(carry.carryMinor)
        : null,
    after: carry.status === "available" ? BigInt(carry.proceedsMinor) : null,
    carryReason: carry.status === "unavailable" ? reasons[carry.reason] : null,
    returnReason:
      historical.status === "unavailable" ? reasons[historical.reason] : null,
    beforeReturn:
      source.carry === "before_carry"
        ? percent(performance(minor(inputs.remaining)))
        : null,
    afterReturn: percent(
      performance(carry.status === "available" ? carry.proceedsMinor : null),
    ),
  };
}
function percent(ppm: number | null): string | null {
  if (ppm === null) return null;
  const value = BigInt(ppm);
  const sign = value < 0n ? "−" : "+";
  const magnitude = value < 0n ? -value : value;
  const tenths = (magnitude + 500n) / 1000n;
  return `${sign}${tenths / 10n}.${tenths % 10n}%`;
}
