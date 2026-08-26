import { z } from "zod";

const PARTS_PER_MILLION = 1_000_000n;
const IsoTimestampSchema = z.iso.datetime({ offset: true });
const NonNegativeMoneyMinorSchema = z.number().int().safe().nonnegative();
const PositiveMoneyMinorSchema = z.number().int().safe().positive();
const ProbabilityPpmSchema = z.number().int().min(0).max(1_000_000);

export const PositionEconomicsTermsSchema = z.object({
  id: z.string().min(1),
  positionId: z.string().min(1),
  acceptedAgainstSnapshotId: z.string().min(1),
  commitmentMinorAtAcceptance: PositiveMoneyMinorSchema,
  fundedMinorAtAcceptance: NonNegativeMoneyMinorSchema,
  annualAdminFeePpm: ProbabilityPpmSchema,
  adminFeeYears: z.number().int().min(1).max(100),
  carryPpm: ProbabilityPpmSchema,
  note: z.string().trim().min(3).max(500),
  acceptedAt: IsoTimestampSchema,
});

export const ReportedPositionEconomicsTermsSchema = z
  .object({
    managementFeePpm: ProbabilityPpmSchema.nullable(),
    carryPpm: ProbabilityPpmSchema.nullable(),
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
  snapshotId: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  committedMinor: PositiveMoneyMinorSchema,
  fundedMinor: NonNegativeMoneyMinorSchema,
  acceptedTerms: PositionEconomicsTermsSchema.nullable(),
  reportedTerms: ReportedPositionEconomicsTermsSchema.nullable().default(null),
});

export const AcceptPositionEconomicsInputSchema = z
  .object({
    expectedSnapshotId: z.string().min(1),
    expectedTermsId: z.string().min(1).nullable(),
    annualAdminFeePpm: ProbabilityPpmSchema,
    adminFeeYears: z.number().int().min(1).max(100),
    carryPpm: ProbabilityPpmSchema,
    note: z.string().trim().min(3).max(500),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      BigInt(input.annualAdminFeePpm) * BigInt(input.adminFeeYears) >
      PARTS_PER_MILLION
    ) {
      context.addIssue({
        code: "custom",
        message: "The total upfront admin fee cannot exceed 100%.",
        path: ["adminFeeYears"],
      });
    }
  });

export const CalculatedPositionEconomicsSchema = z.object({
  committedMinor: NonNegativeMoneyMinorSchema,
  fundedMinor: NonNegativeMoneyMinorSchema,
  upfrontAdminFeeMinor: NonNegativeMoneyMinorSchema,
  positionCostBasisMinor: NonNegativeMoneyMinorSchema,
  totalAdminFeePpm: ProbabilityPpmSchema,
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
  if (parsed.acceptedTerms === null) {
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
  if (totalAdminFeePpm > PARTS_PER_MILLION) {
    throw new Error("The total upfront admin fee cannot exceed 100%.");
  }
  const upfrontAdminFeeMinor =
    (BigInt(parsed.committedMinor) * totalAdminFeePpm +
      PARTS_PER_MILLION / 2n) /
    PARTS_PER_MILLION;
  const feeAppliedToCommitmentMinor =
    upfrontAdminFeeMinor > BigInt(parsed.committedMinor)
      ? BigInt(parsed.committedMinor)
      : upfrontAdminFeeMinor;

  return CalculatedPositionEconomicsSchema.parse({
    committedMinor: parsed.committedMinor,
    fundedMinor: parsed.fundedMinor,
    upfrontAdminFeeMinor: safeNonNegativeNumber(
      upfrontAdminFeeMinor,
      "Upfront admin fee",
    ),
    positionCostBasisMinor: safeNonNegativeNumber(
      BigInt(parsed.committedMinor) - feeAppliedToCommitmentMinor,
      "Position cost basis",
    ),
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
    "provider" | "reviewed_spv_terms" | "funded_amount_estimate" | null;
  totalValueMinor: number | null;
  totalGainMinor: number | null;
  totalReturnPpm: number | null;
};

export function calculatePositionPerformance(input: {
  currentValueMinor: number | null;
  currentValueReported: boolean;
  realizedValueMinor: number;
  providerCostBasisMinor: number | null;
  fundedMinor: number | null;
  economicsContext: PositionEconomicsContext | null;
  allowFundedAmountEstimate: boolean;
}): PositionPerformance {
  const economics =
    input.economicsContext === null
      ? null
      : calculatePositionEconomics(input.economicsContext);
  const costBasisMinor =
    economics?.positionCostBasisMinor ??
    input.providerCostBasisMinor ??
    (input.allowFundedAmountEstimate && (input.fundedMinor ?? 0) > 0
      ? input.fundedMinor
      : null);
  const costBasisSource =
    economics !== null
      ? ("reviewed_spv_terms" as const)
      : input.providerCostBasisMinor !== null
        ? ("provider" as const)
        : input.allowFundedAmountEstimate && (input.fundedMinor ?? 0) > 0
          ? ("funded_amount_estimate" as const)
          : null;
  if (!input.currentValueReported || input.currentValueMinor === null) {
    return {
      costBasisMinor,
      costBasisSource,
      totalValueMinor: null,
      totalGainMinor: null,
      totalReturnPpm: null,
    };
  }

  const totalValue =
    BigInt(input.currentValueMinor) + BigInt(input.realizedValueMinor);
  const totalValueMinor = safeNonNegativeNumber(
    totalValue,
    "Position total value",
  );
  if (costBasisMinor === null) {
    return {
      costBasisMinor: null,
      costBasisSource: null,
      totalValueMinor,
      totalGainMinor: null,
      totalReturnPpm: null,
    };
  }

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
