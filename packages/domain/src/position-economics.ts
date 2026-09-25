import { z } from "zod";

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
  snapshotId: z.string().min(1),
  amountCorrectionNote: z.string().max(500).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  committedMinor: PositiveMoneyMinorSchema,
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
  // Investor return includes fees paid. Net share capital is not cash outlay.
  // A fully funded net import can be reconciled to its reviewed gross amount;
  // a partial net import cannot establish gross paid-in cash on its own.
  const netImport =
    input.economicsContext?.acceptedTerms?.capitalBasis === "net_invested";
  const funded = input.economicsContext?.fundedMinor ?? input.fundedMinor;
  const contributed = netImport
    ? economics !== null &&
      (funded === input.economicsContext?.committedMinor ||
        funded === economics.committedMinor)
      ? economics.committedMinor
      : null
    : funded;
  const privatePosition =
    input.economicsContext !== null ||
    (input.allowFundedAmountEstimate && input.providerCostBasisMinor === null);
  const costBasisMinor = privatePosition
    ? contributed !== null && contributed > 0
      ? contributed
      : null
    : input.providerCostBasisMinor;
  const costBasisSource =
    costBasisMinor === null
      ? null
      : privatePosition
        ? economics !== null
          ? ("reviewed_spv_terms" as const)
          : ("funded_amount_estimate" as const)
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
