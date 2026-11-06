import { z } from "zod";
import {
  ReviewedInvestmentSchema,
  reconcileHistoricalProceeds,
} from "./investment-details";

const PARTS_PER_MILLION = 1_000_000n;
const IsoTimestampSchema = z.iso.datetime({ offset: true });
const NonNegativeMoneyMinorSchema = z.number().int().safe().nonnegative();
const PositiveMoneyMinorSchema = z.number().int().safe().positive();
const ProbabilityPpmSchema = z.number().int().min(0).max(1_000_000);

export const PurchaseFeeSchema = z
  .object({
    receiptId: z.string().min(1),
    ratePpm: ProbabilityPpmSchema,
    basis: z.enum(["gross_cash", "net_capital"]),
    label: z.string().trim().min(1).max(500),
  })
  .strict();

const FeeTermsSchema = z.object({
  purchaseFee: PurchaseFeeSchema.nullable().optional(),
  // Missing fields describe reviews made before net capital and setup fees
  // were supported. New reviews explicitly supply all three fields.
  capitalBasis: z.enum(["gross_commitment", "net_invested"]).optional(),
  grossCommitmentMinor: PositiveMoneyMinorSchema.nullable().optional(),
  setupFeePpm: ProbabilityPpmSchema.nullable().optional(),
  annualAdminFeePpm: ProbabilityPpmSchema,
  adminFeeYears: z.number().int().min(1).max(100),
  carryPpm: ProbabilityPpmSchema,
});

function validateFeeTerms(
  input: z.infer<typeof FeeTermsSchema>,
  context: z.RefinementCtx,
) {
  if (
    BigInt(input.annualAdminFeePpm) * BigInt(input.adminFeeYears) +
      BigInt(input.setupFeePpm ?? 0) >
    PARTS_PER_MILLION
  ) {
    context.addIssue({
      code: "custom",
      message: "Management and setup fees together cannot exceed 100%.",
      path: ["setupFeePpm"],
    });
  }
  if (input.capitalBasis === "net_invested") {
    if (input.setupFeePpm == null) {
      context.addIssue({
        code: "custom",
        message: "Enter the setup fee, including zero if there is none.",
        path: ["setupFeePpm"],
      });
    }
    if (input.grossCommitmentMinor == null) {
      context.addIssue({
        code: "custom",
        message: "Enter the gross commitment before fees.",
        path: ["grossCommitmentMinor"],
      });
    }
  } else if (input.grossCommitmentMinor != null) {
    context.addIssue({
      code: "custom",
      message: "Gross imports already supply the commitment.",
      path: ["grossCommitmentMinor"],
    });
  }
}

export const PositionEconomicsTermsSchema = FeeTermsSchema.extend({
  id: z.string().min(1),
  positionId: z.string().min(1),
  acceptedAgainstSnapshotId: z.string().min(1),
  commitmentMinorAtAcceptance: PositiveMoneyMinorSchema,
  fundedMinorAtAcceptance: NonNegativeMoneyMinorSchema,
  note: z.string().trim().min(3).max(500),
  acceptedAt: IsoTimestampSchema,
  decisionSource: z.enum(["manual", "policy"]).optional(),
}).superRefine(validateFeeTerms);

export const ReportedPositionEconomicsTermsSchema = z
  .object({
    managementFeePpm: ProbabilityPpmSchema.nullable(),
    carryPpm: ProbabilityPpmSchema.nullable(),
    adminFeeYears: z.number().int().min(1).max(100).nullable().optional(),
    setupFeePpm: ProbabilityPpmSchema.nullable().optional(),
    grossCommitmentMinor: PositiveMoneyMinorSchema.nullable().optional(),
    netInvestedMinor: PositiveMoneyMinorSchema.nullable().optional(),
    sourceLabel: z.string().trim().min(1).max(1_000),
    observedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((terms, context) => {
    if (terms.managementFeePpm === null && terms.carryPpm === null) {
      context.addIssue({
        code: "custom",
        message: "At least one reported position economics term is required.",
        path: ["managementFeePpm"],
      });
    }
  });

export const PositionEconomicsContextSchema = z.object({
  reviewedInvestment: ReviewedInvestmentSchema.optional(),
  snapshotId: z.string().min(1),
  amountCorrectionNote: z.string().max(500).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  committedMinor: NonNegativeMoneyMinorSchema,
  fundedMinor: NonNegativeMoneyMinorSchema,
  acceptedTerms: PositionEconomicsTermsSchema.nullable(),
  reportedTerms: ReportedPositionEconomicsTermsSchema.nullable().default(null),
});

export const AcceptPositionEconomicsInputSchema = FeeTermsSchema.extend({
  setupFeePpm: ProbabilityPpmSchema.optional(),
  expectedSnapshotId: z.string().min(1),
  expectedCommitmentMinor: PositiveMoneyMinorSchema.optional(),
  expectedTermsId: z.string().min(1).nullable(),
  note: z.string().trim().min(3).max(500),
})
  .strict()
  .superRefine(validateFeeTerms);

export const CalculatedPositionEconomicsSchema = z.object({
  committedMinor: NonNegativeMoneyMinorSchema,
  fundedMinor: NonNegativeMoneyMinorSchema,
  upfrontAdminFeeMinor: NonNegativeMoneyMinorSchema,
  setupFeeMinor: NonNegativeMoneyMinorSchema,
  purchaseFeeMinor: NonNegativeMoneyMinorSchema.default(0),
  positionCostBasisMinor: NonNegativeMoneyMinorSchema,
  totalAdminFeePpm: ProbabilityPpmSchema,
  setupFeePpm: ProbabilityPpmSchema,
  carryPpm: ProbabilityPpmSchema,
});

export type PositionEconomicsTerms = z.infer<
  typeof PositionEconomicsTermsSchema
>;
export type PositionEconomicsContext = z.infer<
  typeof PositionEconomicsContextSchema
>;
export type ReportedPositionEconomicsTerms = z.infer<
  typeof ReportedPositionEconomicsTermsSchema
>;
export type AcceptPositionEconomicsInput = z.infer<
  typeof AcceptPositionEconomicsInputSchema
>;
export type CalculatedPositionEconomics = z.infer<
  typeof CalculatedPositionEconomicsSchema
>;

function safeNonNegativeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${label} exceeds safe integer limits.`);
  }
  return result;
}

export function calculatePositionEconomics(
  context: PositionEconomicsContext,
): CalculatedPositionEconomics | null {
  const parsed = PositionEconomicsContextSchema.parse(context);
  if (
    parsed.reviewedInvestment !== undefined ||
    parsed.acceptedTerms === null
  ) {
    return null;
  }
  if (
    parsed.acceptedTerms.acceptedAgainstSnapshotId !== parsed.snapshotId ||
    parsed.acceptedTerms.commitmentMinorAtAcceptance !==
      parsed.committedMinor ||
    parsed.acceptedTerms.fundedMinorAtAcceptance !== parsed.fundedMinor
  ) {
    return null;
  }

  const totalAdminFeePpm =
    BigInt(parsed.acceptedTerms.annualAdminFeePpm) *
    BigInt(parsed.acceptedTerms.adminFeeYears);
  const setupFeePpm = BigInt(parsed.acceptedTerms.setupFeePpm ?? 0);
  const netImport = parsed.acceptedTerms.capitalBasis === "net_invested";
  const grossMinor = BigInt(
    netImport
      ? parsed.acceptedTerms.grossCommitmentMinor!
      : parsed.committedMinor,
  );
  const feeMinor = (rate: bigint) =>
    (grossMinor * rate + PARTS_PER_MILLION / 2n) / PARTS_PER_MILLION;
  const upfrontAdminFeeMinor = feeMinor(totalAdminFeePpm);
  // Round the combined fee once; assign any remaining minor unit to setup so
  // the displayed breakdown always sums to gross capital, even at 100% fees.
  const totalFeeMinor = feeMinor(totalAdminFeePpm + setupFeePpm);
  const cashForPurchase = grossMinor - totalFeeMinor;
  const purchaseFee = parsed.acceptedTerms.purchaseFee;
  const purchaseRate = BigInt(purchaseFee?.ratePpm ?? 0);
  const purchaseNet =
    purchaseFee?.basis === "net_capital"
      ? (cashForPurchase * PARTS_PER_MILLION +
          (PARTS_PER_MILLION + purchaseRate) / 2n) /
        (PARTS_PER_MILLION + purchaseRate)
      : cashForPurchase -
        (cashForPurchase * purchaseRate + PARTS_PER_MILLION / 2n) /
          PARTS_PER_MILLION;
  const purchaseFeeMinor = cashForPurchase - purchaseNet;
  const positionCostBasisMinor = purchaseNet;
  if (netImport && positionCostBasisMinor !== BigInt(parsed.committedMinor)) {
    return null;
  }

  return CalculatedPositionEconomicsSchema.parse({
    committedMinor: safeNonNegativeNumber(grossMinor, "Gross commitment"),
    fundedMinor: parsed.fundedMinor,
    upfrontAdminFeeMinor: safeNonNegativeNumber(
      upfrontAdminFeeMinor,
      "Upfront admin fee",
    ),
    setupFeeMinor: safeNonNegativeNumber(
      totalFeeMinor - upfrontAdminFeeMinor,
      "Setup fee",
    ),
    purchaseFeeMinor: safeNonNegativeNumber(purchaseFeeMinor, "Purchase fee"),
    positionCostBasisMinor: safeNonNegativeNumber(
      positionCostBasisMinor,
      "Position cost basis",
    ),
    setupFeePpm: Number(setupFeePpm),
    totalAdminFeePpm: safeNonNegativeNumber(
      totalAdminFeePpm,
      "Total admin fee",
    ),
    carryPpm: parsed.acceptedTerms.carryPpm,
  });
}

export type PositionPerformance = {
  costBasisMinor: number | null;
  costBasisSource:
    | "provider"
    | "reviewed_spv_terms"
    | "reviewed_spv_estimate"
    | "funded_amount_estimate"
    | null;
  totalValueMinor: number | null;
  totalGainMinor: number | null;
  totalReturnPpm: number | null;
};

/** Contribution basis for existing tranche-ratio valuation estimates, not returns. */
export function positionContributionBasis(input: {
  providerCostBasisMinor: number | null;
  fundedMinor: number | null;
  economicsContext: PositionEconomicsContext | null;
}): number | null {
  const context = input.economicsContext;
  const reviewed = context?.reviewedInvestment;
  if (reviewed)
    return reviewed.appliesUntilSuperseded ||
      reviewed.snapshotId === context?.snapshotId
      ? reviewed.cashPaidMinor
      : null;
  if (context?.acceptedTerms?.capitalBasis === "net_invested") {
    const economics = calculatePositionEconomics(context);
    return economics &&
      (context.fundedMinor === context.committedMinor ||
        context.fundedMinor === economics.committedMinor)
      ? economics.committedMinor
      : null;
  }
  const basis =
    context?.fundedMinor ?? input.providerCostBasisMinor ?? input.fundedMinor;
  return basis !== null && basis > 0 ? basis : null;
}

export function calculatePositionPerformance(input: {
  currentValueMinor: number | null;
  currentValueReported: boolean;
  realizedValueMinor: number;
  providerCostBasisMinor: number | null;
  fundedMinor: number | null;
  economicsContext: PositionEconomicsContext | null;
  allowFundedAmountEstimate: boolean;
  valuationDate?: string | null;
}): PositionPerformance {
  const economics =
    input.economicsContext === null
      ? null
      : calculatePositionEconomics(input.economicsContext);
  // SPV performance compares value with capital actually invested after upfront
  // deductions and received refunds. A commitment or unclassified cash amount
  // cannot establish net capital for a partially funded or unreviewed position.
  const funded = input.economicsContext?.fundedMinor ?? input.fundedMinor;
  const reviewed = input.economicsContext?.reviewedInvestment;
  const currentReview =
    reviewed &&
    (reviewed.appliesUntilSuperseded ||
      reviewed.snapshotId === input.economicsContext?.snapshotId)
      ? reviewed
      : null;
  const netCapital =
    reviewed !== undefined
      ? (currentReview?.netCapitalMinor ??
        currentReview?.estimatedNetCapitalMinor ??
        null)
      : economics !== null &&
          (funded === input.economicsContext?.committedMinor ||
            funded === economics.committedMinor)
        ? economics.positionCostBasisMinor
        : null;
  const privatePosition =
    input.economicsContext !== null ||
    (input.allowFundedAmountEstimate && input.providerCostBasisMinor === null);
  // Preserve the existing direct-investment estimate when no SPV economics
  // context exists. An SPV with unknown deductions cannot use that fallback.
  const privateBasis =
    netCapital ??
    (input.economicsContext === null && input.allowFundedAmountEstimate
      ? funded
      : null);
  const costBasisMinor = privatePosition
    ? privateBasis !== null && privateBasis > 0
      ? privateBasis
      : null
    : input.providerCostBasisMinor;
  const costBasisSource =
    costBasisMinor === null
      ? null
      : privatePosition
        ? input.economicsContext === null
          ? ("funded_amount_estimate" as const)
          : currentReview?.netCapitalMinor == null &&
              currentReview?.estimatedNetCapitalMinor != null
            ? ("reviewed_spv_estimate" as const)
            : ("reviewed_spv_terms" as const)
        : ("provider" as const);
  if (!input.currentValueReported || input.currentValueMinor === null) {
    return {
      costBasisMinor,
      costBasisSource,
      totalValueMinor: null,
      totalGainMinor: null,
      totalReturnPpm: null,
    };
  }

  const historical = reconcileHistoricalProceeds({
    review: currentReview?.distributionReview,
    providerSnapshotId: input.economicsContext?.snapshotId ?? "",
    realizedValueMinor: input.realizedValueMinor,
    includedRefundMinor: currentReview?.includedReturnedCapitalMinor ?? 0,
    excludedRefundMinor: currentReview?.additionalReturnedCapitalMinor ?? 0,
    refundReconciliationPending:
      currentReview?.returnedCapitalReconciliationPending ?? false,
    asOfDate: input.valuationDate ?? null,
  });
  if (historical.status === "unavailable")
    return {
      costBasisMinor,
      costBasisSource,
      totalValueMinor: null,
      totalGainMinor: null,
      totalReturnPpm: null,
    };
  const totalValue =
    BigInt(input.currentValueMinor) + BigInt(historical.netDistributionsMinor);
  const totalValueMinor = safeNonNegativeNumber(
    totalValue,
    "Position total value",
  );
  if (costBasisMinor === null)
    return {
      costBasisMinor,
      costBasisSource,
      totalValueMinor,
      totalGainMinor: null,
      totalReturnPpm: null,
    };

  const gain = totalValue - BigInt(costBasisMinor);
  const totalGainMinor = Number(gain);
  if (!Number.isSafeInteger(totalGainMinor)) {
    throw new Error("Position total gain exceeds safe integer limits.");
  }
  const totalReturnPpm =
    costBasisMinor === 0
      ? null
      : Number((gain * PARTS_PER_MILLION) / BigInt(costBasisMinor));
  if (totalReturnPpm !== null && !Number.isSafeInteger(totalReturnPpm)) {
    throw new Error("Position total return exceeds safe integer limits.");
  }

  return {
    costBasisMinor,
    costBasisSource,
    totalValueMinor,
    totalGainMinor,
    totalReturnPpm,
  };
}
