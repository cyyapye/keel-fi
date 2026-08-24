import { z } from "zod";

import { PositionValueContextSchema } from "./position-value";

export const PARTS_PER_MILLION = 1_000_000;

export const MoneyMinorSchema = z.number().int().safe();
export const NonNegativeMoneyMinorSchema = MoneyMinorSchema.nonnegative();
export const ProbabilityPpmSchema = z
  .number()
  .int()
  .min(0)
  .max(PARTS_PER_MILLION);
export const IsoDateSchema = z.iso.date();
export const IsoTimestampSchema = z.iso.datetime({ offset: true });

export function addMinorUnits(...values: number[]): number {
  const result = values.reduce((sum, value) => {
    MoneyMinorSchema.parse(value);
    return sum + value;
  }, 0);

  return MoneyMinorSchema.parse(result);
}

export function subtractMinorUnits(
  minuend: number,
  subtrahend: number,
): number {
  MoneyMinorSchema.parse(minuend);
  MoneyMinorSchema.parse(subtrahend);
  return MoneyMinorSchema.parse(minuend - subtrahend);
}

export function multiplyMinorByPpm(
  minorUnits: number,
  probabilityPpm: number,
): number {
  MoneyMinorSchema.parse(minorUnits);
  ProbabilityPpmSchema.parse(probabilityPpm);

  const product = BigInt(minorUnits) * BigInt(probabilityPpm);
  const rounded =
    (product + BigInt(PARTS_PER_MILLION / 2)) / BigInt(PARTS_PER_MILLION);
  const result = Number(rounded);

  return MoneyMinorSchema.parse(result);
}

export type AnnualLiquidityDistribution = {
  year: number;
  p25Minor: number;
  p50Minor: number;
  p75Minor: number;
  expectedMinor: number;
  probabilityZeroPpm: number;
};

function nearestRank(sorted: readonly number[], percentile: 25 | 50 | 75) {
  const rank =
    (BigInt(percentile) * BigInt(sorted.length) + BigInt(99)) / BigInt(100);
  const index = Math.max(0, Number(rank) - 1);
  return sorted[index] ?? 0;
}

export function summarizeLiquidityPaths(
  years: readonly number[],
  cumulativePathsMinor: readonly (readonly number[])[],
): AnnualLiquidityDistribution[] {
  if (cumulativePathsMinor.length === 0) {
    throw new Error("At least one liquidity path is required.");
  }

  cumulativePathsMinor.forEach((path) => {
    if (path.length !== years.length) {
      throw new Error("Each liquidity path must contain one value per year.");
    }
    path.forEach((value) => NonNegativeMoneyMinorSchema.parse(value));
  });

  return years.map((year, yearIndex) => {
    const values = cumulativePathsMinor
      .map((path) => path[yearIndex] ?? 0)
      .sort((left, right) => left - right);
    const total = values.reduce((sum, value) => sum + BigInt(value), BigInt(0));
    const zeroCount = values.filter((value) => value === 0).length;

    return {
      year,
      p25Minor: nearestRank(values, 25),
      p50Minor: nearestRank(values, 50),
      p75Minor: nearestRank(values, 75),
      expectedMinor: Number(total / BigInt(values.length)),
      probabilityZeroPpm: Math.floor(
        (zeroCount * PARTS_PER_MILLION) / values.length,
      ),
    };
  });
}

export function probabilityMeetingThresholdPpm(
  endingLiquidAssetsMinor: readonly number[],
  thresholdMinor: number,
): number {
  NonNegativeMoneyMinorSchema.parse(thresholdMinor);
  if (endingLiquidAssetsMinor.length === 0) {
    throw new Error("At least one projected outcome is required.");
  }
  endingLiquidAssetsMinor.forEach((value) =>
    NonNegativeMoneyMinorSchema.parse(value),
  );

  const passing = endingLiquidAssetsMinor.filter(
    (value) => value >= thresholdMinor,
  ).length;
  return Math.floor(
    (passing * PARTS_PER_MILLION) / endingLiquidAssetsMinor.length,
  );
}

export const DashboardSchema = z.object({
  asOfDate: IsoDateSchema,
  forecastHorizonDate: IsoDateSchema,
  householdName: z.string().min(1),
  fiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  protectedRunwayMonths: z.number().int().nonnegative(),
  householdBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  businessBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  fiTargetMinor: NonNegativeMoneyMinorSchema,
  fiGapMinor: NonNegativeMoneyMinorSchema,
  p25FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  p50FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  p75FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  probabilityCrossingFiPpm: ProbabilityPpmSchema,
});

export const GoalTemplateKeySchema = z.enum([
  "financial_independence",
  "cash_runway",
  "major_purchase",
  "custom",
]);

export const GoalValueUnitSchema = z.enum([
  "minor_units",
  "months",
  "ppm",
  "count",
]);

export const GoalForecastModelStatusSchema = z.enum([
  "modeled",
  "not_configured",
]);

export const GoalForecastSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  modelStatus: GoalForecastModelStatusSchema,
  lowerValueInteger: z.number().int().safe().nonnegative().nullable(),
  middleValueInteger: z.number().int().safe().nonnegative().nullable(),
  higherValueInteger: z.number().int().safe().nonnegative().nullable(),
  successProbabilityPpm: ProbabilityPpmSchema.nullable(),
  unit: GoalValueUnitSchema,
  horizonDate: IsoDateSchema.nullable(),
  methodology: z.string().min(1),
  createdAt: IsoTimestampSchema,
  createdBy: z.string().min(1),
});

export const GoalVersionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  metricKey: z.string().min(1),
  metricLabel: z.string().min(1),
  targetValueInteger: z.number().int().safe().nonnegative().nullable(),
  targetUnit: GoalValueUnitSchema,
  targetDate: IsoDateSchema.nullable(),
  currentValueInteger: z.number().int().safe().nonnegative(),
  currentValueSource: z.string().min(1),
  changeNote: z.string().min(1),
  createdAt: IsoTimestampSchema,
  createdBy: z.string().min(1),
  forecast: GoalForecastSchema,
});

export const GoalSchema = z.object({
  id: z.string().min(1),
  templateKey: GoalTemplateKeySchema,
  isPrimary: z.boolean(),
  archivedAt: IsoTimestampSchema.nullable(),
  createdAt: IsoTimestampSchema,
  versions: z.array(GoalVersionSchema).min(1),
});

export const GoalDraftInputSchema = z
  .object({
    goalId: z.string().min(1).optional(),
    templateKey: GoalTemplateKeySchema,
    name: z.string().trim().min(1).max(120),
    metricKey: z.string().trim().min(1).max(80),
    metricLabel: z.string().trim().min(1).max(120),
    targetValueInteger: z.number().int().safe().nonnegative().nullable(),
    targetUnit: GoalValueUnitSchema,
    targetDate: IsoDateSchema.nullable(),
    currentValueInteger: z.number().int().safe().nonnegative(),
    makePrimary: z.boolean(),
    changeNote: z.string().trim().min(1).max(500),
  })
  .superRefine((value, context) => {
    const expectedUnit =
      value.templateKey === "cash_runway"
        ? "months"
        : value.templateKey === "financial_independence" ||
            value.templateKey === "major_purchase"
          ? "minor_units"
          : null;
    if (expectedUnit !== null && value.targetUnit !== expectedUnit) {
      context.addIssue({
        code: "custom",
        message: `This template measures values in ${expectedUnit}.`,
        path: ["targetUnit"],
      });
    }
  });

export const GoalForecastOutlookSchema = z.object({
  p25FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  p50FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  p75FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  horizonDate: IsoDateSchema,
});

export const GoalPreviewSchema = z.object({
  currentValueInteger: z.number().int().safe().nonnegative(),
  targetValueInteger: z.number().int().safe().nonnegative().nullable(),
  gapValueInteger: z.number().int().safe().nonnegative().nullable(),
  progressPpm: ProbabilityPpmSchema.nullable(),
  modelStatus: GoalForecastModelStatusSchema,
  lowerValueInteger: z.number().int().safe().nonnegative().nullable(),
  middleValueInteger: z.number().int().safe().nonnegative().nullable(),
  higherValueInteger: z.number().int().safe().nonnegative().nullable(),
  successProbabilityPpm: ProbabilityPpmSchema.nullable(),
  horizonDate: IsoDateSchema.nullable(),
  methodology: z.string().min(1),
});

function ratioPpm(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return PARTS_PER_MILLION;
  }
  const result =
    (BigInt(numerator) * BigInt(PARTS_PER_MILLION)) / BigInt(denominator);
  return ProbabilityPpmSchema.parse(
    Number(
      result > BigInt(PARTS_PER_MILLION) ? BigInt(PARTS_PER_MILLION) : result,
    ),
  );
}

export function estimateThresholdProbabilityPpm(
  targetValueInteger: number,
  lowerValueInteger: number,
  middleValueInteger: number,
  higherValueInteger: number,
): number {
  const values = [
    targetValueInteger,
    lowerValueInteger,
    middleValueInteger,
    higherValueInteger,
  ];
  values.forEach((value) => z.number().int().safe().nonnegative().parse(value));
  if (
    lowerValueInteger > middleValueInteger ||
    middleValueInteger > higherValueInteger
  ) {
    throw new Error("Forecast quantiles must be ordered.");
  }
  if (targetValueInteger === 0) {
    return PARTS_PER_MILLION;
  }

  const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
  const doubledHigher = BigInt(Math.max(higherValueInteger, 1)) * 2n;
  const finalX = Number(
    doubledHigher > maximumSafeInteger ? maximumSafeInteger : doubledHigher,
  );
  const points = [
    [0, PARTS_PER_MILLION],
    [lowerValueInteger, 750_000],
    [middleValueInteger, 500_000],
    [higherValueInteger, 250_000],
    [finalX, 0],
  ] as const;

  for (let index = 1; index < points.length; index += 1) {
    const prior = points[index - 1];
    const next = points[index];
    if (prior === undefined || next === undefined) {
      continue;
    }
    const [startValue, startProbability] = prior;
    const [endValue, endProbability] = next;
    if (endValue <= startValue || targetValueInteger > endValue) {
      continue;
    }
    const valueOffset = BigInt(targetValueInteger - startValue);
    const valueRange = BigInt(endValue - startValue);
    const probabilityRange = BigInt(startProbability - endProbability);
    return ProbabilityPpmSchema.parse(
      startProbability - Number((valueOffset * probabilityRange) / valueRange),
    );
  }

  return 0;
}

export function createGoalPreview(
  rawInput: z.input<typeof GoalDraftInputSchema>,
  rawOutlook: z.input<typeof GoalForecastOutlookSchema>,
): z.infer<typeof GoalPreviewSchema> {
  const input = GoalDraftInputSchema.parse(rawInput);
  const outlook = GoalForecastOutlookSchema.parse(rawOutlook);
  const target = input.targetValueInteger;
  const gap =
    target === null ? null : Math.max(target - input.currentValueInteger, 0);
  const progress =
    target === null ? null : ratioPpm(input.currentValueInteger, target);

  if (input.templateKey !== "financial_independence") {
    return GoalPreviewSchema.parse({
      currentValueInteger: input.currentValueInteger,
      targetValueInteger: target,
      gapValueInteger: gap,
      progressPpm: progress,
      modelStatus: "not_configured",
      lowerValueInteger: null,
      middleValueInteger: null,
      higherValueInteger: null,
      successProbabilityPpm: null,
      horizonDate: null,
      methodology:
        "Current progress is saved. Add scenario inputs before treating this goal as a forecast.",
    });
  }

  const lower = addMinorUnits(
    input.currentValueInteger,
    outlook.p25FiveYearLiquidityMinor,
  );
  const middle = addMinorUnits(
    input.currentValueInteger,
    outlook.p50FiveYearLiquidityMinor,
  );
  const higher = addMinorUnits(
    input.currentValueInteger,
    outlook.p75FiveYearLiquidityMinor,
  );

  return GoalPreviewSchema.parse({
    currentValueInteger: input.currentValueInteger,
    targetValueInteger: target,
    gapValueInteger: gap,
    progressPpm: progress,
    modelStatus: "modeled",
    lowerValueInteger: lower,
    middleValueInteger: middle,
    higherValueInteger: higher,
    successProbabilityPpm:
      target === null
        ? null
        : estimateThresholdProbabilityPpm(target, lower, middle, higher),
    horizonDate: outlook.horizonDate,
    methodology:
      "Five-year total available value combines the current baseline with the saved lower, middle, and higher liquidity outcomes.",
  });
}

export const HoldingSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1).nullable(),
  positionName: z.string().min(1),
  exposureName: z.string().min(1).nullable(),
  ownerLabel: z.string().min(1),
  positionKind: z.enum(["direct", "spv_interest", "fund_interest"]),
  administratorNavMinor: NonNegativeMoneyMinorSchema.nullable(),
  administratorNavState: z.enum(["reported", "locked", "not_set"]),
  externalMarkMinor: NonNegativeMoneyMinorSchema.nullable(),
  underwritingValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  scenarioValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  usableLiquidityMinor: NonNegativeMoneyMinorSchema.nullable(),
  sourceStatus: z.enum(["verified", "review_due", "proposed"]),
  sourceLabel: z.string().min(1),
  effectiveDate: IsoDateSchema,
  retrievedAt: IsoTimestampSchema,
  confidencePpm: ProbabilityPpmSchema.nullable(),
  ticker: z.string().min(1).max(32).nullable().default(null),
  quantityMicros: z
    .number()
    .int()
    .safe()
    .nonnegative()
    .nullable()
    .default(null),
  costBasisMinor: NonNegativeMoneyMinorSchema.nullable().default(null),
  positionValueContext: PositionValueContextSchema.nullable().optional(),
});

export const ProtectedIdentityKeySchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/u);

export const PrivateObjectReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u);

export const InvestmentAdapterTypeSchema = z.enum([
  "plaid-investments",
  "angellist-import",
  "manual",
]);

export const InvestmentConnectionLifecycleSchema = z.enum([
  "pending",
  "active",
  "paused",
  "disconnected",
]);

export const InvestmentConnectionSchema = z
  .object({
    id: z.string().min(1),
    householdId: z.string().min(1),
    adapterType: InvestmentAdapterTypeSchema,
    protectedSourceKey: ProtectedIdentityKeySchema,
    institutionKey: z.string().trim().min(1).max(200),
    institutionLabel: z.string().trim().min(1).max(512),
    lifecycleState: InvestmentConnectionLifecycleSchema,
    credentialReference: PrivateObjectReferenceSchema.nullable(),
    version: z.number().int().positive(),
    recordedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.adapterType !== "manual" &&
      ["active", "paused"].includes(value.lifecycleState) &&
      value.credentialReference === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialReference"],
        message: "Active provider connections require a private reference.",
      });
    }
    if (
      value.lifecycleState === "disconnected" &&
      value.credentialReference !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialReference"],
        message: "Disconnected connections cannot retain a private reference.",
      });
    }
  });

export const OwnershipContainerKindSchema = z.enum([
  "brokerage",
  "ira",
  "retirement",
  "trust",
  "entity",
  "unresolved",
  "other",
]);

export const OwnershipTaxTreatmentSchema = z.enum([
  "taxable",
  "tax_deferred",
  "tax_exempt",
  "unknown",
]);

export const OwnershipContainerSchema = z
  .object({
    id: z.string().min(1),
    householdId: z.string().min(1),
    connectionId: z.string().min(1),
    protectedAccountKey: ProtectedIdentityKeySchema,
    displayLabel: z.string().trim().min(1).max(512),
    containerKind: OwnershipContainerKindSchema,
    taxTreatment: OwnershipTaxTreatmentSchema,
    version: z.number().int().positive(),
    recordedAt: IsoTimestampSchema,
  })
  .strict();

export const OwnedPositionIdentitySchema = z
  .object({
    id: z.string().min(1),
    householdId: z.string().min(1),
    containerId: z.string().min(1),
    positionId: z.string().min(1),
    protectedPositionKey: ProtectedIdentityKeySchema,
    associationBasis: z.enum([
      "provider_provenance",
      "reviewed_import",
      "manual",
    ]),
    evidenceSha256: ProtectedIdentityKeySchema,
    version: z.number().int().positive(),
    supersedesOwnershipId: z.string().min(1).nullable(),
    acceptedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.version === 1) !== (value.supersedesOwnershipId === null)) {
      context.addIssue({
        code: "custom",
        path: ["supersedesOwnershipId"],
        message: "Ownership versions must form an explicit chain.",
      });
    }
  });

export const HoldingImportCoverageCompletenessSchema = z.enum([
  "complete",
  "partial",
  "unavailable",
  "malformed",
  "failed",
  "ambiguous",
]);

export const HoldingImportCoverageSchema = z
  .object({
    id: z.string().min(1),
    householdId: z.string().min(1),
    importId: z.string().min(1),
    connectionId: z.string().min(1),
    containerId: z.string().min(1),
    completeness: HoldingImportCoverageCompletenessSchema,
    evidenceSha256: ProtectedIdentityKeySchema,
    observedAt: IsoTimestampSchema,
  })
  .strict();

export const HoldingImportConnectionScopeSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("existing"),
      connectionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      mode: z.literal("ensure"),
      adapterType: InvestmentAdapterTypeSchema,
      protectedSourceKey: ProtectedIdentityKeySchema,
      institutionKey: z.string().trim().min(1).max(200),
      institutionLabel: z.string().trim().min(1).max(512),
      lifecycleState: InvestmentConnectionLifecycleSchema,
      credentialReference: PrivateObjectReferenceSchema.nullable(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.adapterType !== "manual" &&
        ["active", "paused"].includes(value.lifecycleState) &&
        value.credentialReference === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["credentialReference"],
          message: "Active provider connections require a private reference.",
        });
      }
      if (
        value.lifecycleState === "disconnected" &&
        value.credentialReference !== null
      ) {
        context.addIssue({
          code: "custom",
          path: ["credentialReference"],
          message:
            "Disconnected connections cannot retain a private reference.",
        });
      }
    }),
]);

export const HoldingImportContainerScopeSchema = z
  .object({
    protectedAccountKey: ProtectedIdentityKeySchema,
    displayLabel: z.string().trim().min(1).max(512),
    containerKind: OwnershipContainerKindSchema,
    taxTreatment: OwnershipTaxTreatmentSchema,
    completeness: HoldingImportCoverageCompletenessSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.containerKind === "unresolved" &&
      value.completeness === "complete"
    ) {
      context.addIssue({
        code: "custom",
        path: ["completeness"],
        message: "Unresolved containers cannot claim complete coverage.",
      });
    }
  });

export const HoldingImportRowScopeSchema = z
  .object({
    sourceRowNumber: z.number().int().positive().max(500),
    protectedAccountKey: ProtectedIdentityKeySchema,
    protectedPositionKey: ProtectedIdentityKeySchema,
    publicExposureIdentityKind: z
      .enum(["cusip", "isin", "sedol"])
      .nullable()
      .default(null),
    protectedExposureKey: ProtectedIdentityKeySchema.nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.publicExposureIdentityKind === null) !==
      (value.protectedExposureKey === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["protectedExposureKey"],
        message:
          "A public exposure key requires one validated strong identifier kind.",
      });
    }
  });

export const HoldingImportCanonicalScopeSchema = z
  .object({
    connection: HoldingImportConnectionScopeSchema,
    containers: z.array(HoldingImportContainerScopeSchema).min(1).max(100),
    rows: z.array(HoldingImportRowScopeSchema).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    const accountKeys = value.containers.map(
      (container) => container.protectedAccountKey,
    );
    if (new Set(accountKeys).size !== accountKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["containers"],
        message: "Holding import containers must be unique.",
      });
    }
    const sourceRows = value.rows.map((row) => row.sourceRowNumber);
    if (new Set(sourceRows).size !== sourceRows.length) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Holding import row scopes must be unique.",
      });
    }
    value.rows.forEach((row, index) => {
      if (!accountKeys.includes(row.protectedAccountKey)) {
        context.addIssue({
          code: "custom",
          path: ["rows", index, "protectedAccountKey"],
          message: "Holding import rows require a declared container.",
        });
      }
    });
  });

export const ScaledQuantitySchema = z
  .object({
    quantityScaled: z.number().int().safe().nonnegative(),
    quantityScale: z.number().int().safe().positive(),
  })
  .strict();

export const OwnedPositionSnapshotSchema = z
  .object({
    id: z.string().min(1),
    householdId: z.string().min(1),
    positionId: z.string().min(1),
    sourceImportRowId: z.string().min(1),
    acceptedDecisionId: z.string().min(1),
    effectiveDate: IsoDateSchema,
    observedAt: IsoTimestampSchema,
    quantity: ScaledQuantitySchema.nullable(),
    valueMinor: NonNegativeMoneyMinorSchema.nullable(),
    valueState: z.enum(["reported", "locked", "not_reported", "unavailable"]),
    costBasisMinor: NonNegativeMoneyMinorSchema.nullable(),
    currency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/u),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.valueState === "reported") !== (value.valueMinor !== null)) {
      context.addIssue({
        code: "custom",
        path: ["valueMinor"],
        message: "Only reported values can carry money.",
      });
    }
  });

export const CanonicalExposureKindSchema = z.enum([
  "public_instrument",
  "private_company",
  "fund",
  "unresolved",
]);

export const CanonicalExposureSchema = z
  .object({
    id: z.string().min(1),
    householdId: z.string().min(1),
    exposureKind: CanonicalExposureKindSchema,
    canonicalName: z.string().trim().min(1).max(1_000),
    protectedIdentityKey: ProtectedIdentityKeySchema.nullable(),
    companyId: z.string().min(1).nullable(),
    resolutionMethod: z.enum([
      "strong_identifier",
      "reviewed_company",
      "reviewed_fund",
      "unresolved",
    ]),
    evidenceSha256: ProtectedIdentityKeySchema,
    createdAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      (value.exposureKind === "public_instrument" &&
        value.resolutionMethod === "strong_identifier" &&
        value.protectedIdentityKey !== null &&
        value.companyId === null) ||
      (value.exposureKind === "private_company" &&
        value.resolutionMethod === "reviewed_company" &&
        value.companyId !== null) ||
      (value.exposureKind === "fund" &&
        value.resolutionMethod === "reviewed_fund" &&
        value.protectedIdentityKey !== null &&
        value.companyId === null) ||
      (value.exposureKind === "unresolved" &&
        value.resolutionMethod === "unresolved" &&
        value.protectedIdentityKey === null &&
        value.companyId === null);
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "Exposure identity and resolution method do not match.",
      });
    }
  });

export const PositionExposureMappingSchema = z
  .object({
    id: z.string().min(1),
    householdId: z.string().min(1),
    positionId: z.string().min(1),
    exposureId: z.string().min(1),
    relationshipKind: z.enum(["direct", "look_through"]),
    allocationPpm: ProbabilityPpmSchema.nullable(),
    status: z.enum(["active", "withdrawn"]),
    decisionSource: z.enum(["deterministic_policy", "review"]),
    decisionReference: z.string().trim().min(1).max(200),
    evidenceSha256: ProtectedIdentityKeySchema,
    effectiveAt: IsoTimestampSchema,
    version: z.number().int().positive(),
    supersedesMappingId: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.version === 1) !== (value.supersedesMappingId === null)) {
      context.addIssue({
        code: "custom",
        path: ["supersedesMappingId"],
        message: "Exposure mapping versions must form an explicit chain.",
      });
    }
    if (value.status === "withdrawn" && value.allocationPpm !== null) {
      context.addIssue({
        code: "custom",
        path: ["allocationPpm"],
        message: "Withdrawn mappings cannot carry an allocation.",
      });
    }
    if (
      value.status === "active" &&
      value.relationshipKind === "direct" &&
      value.allocationPpm !== 1_000_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["allocationPpm"],
        message: "Active direct mappings require full allocation.",
      });
    }
  });

export const PrivateExposureWebsiteHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu,
    "Enter a domain such as company.example.",
  );

export const PrivateExposureCompanySchema = z
  .object({
    id: z.string().min(1),
    legalName: z.string().trim().min(1).max(1_000),
    websiteHost: PrivateExposureWebsiteHostSchema.nullable(),
    status: z.enum(["active", "exited", "written_off"]),
  })
  .strict();

export const PrivateExposureReviewPositionSchema = z
  .object({
    positionId: z.string().min(1),
    snapshotId: z.string().min(1),
    legalVehicleName: z.string().trim().min(1).max(1_000),
    reportedExposureName: z.string().trim().min(1).max(1_000).nullable(),
    positionKind: z.enum(["direct", "spv_interest"]),
    ownerLabel: z.string().trim().min(1).max(1_000),
    observedAt: IsoTimestampSchema,
  })
  .strict();

export const PrivateExposureExactBatchPreviewSchema = z
  .object({
    revision: ProtectedIdentityKeySchema,
    positionCount: z.number().int().nonnegative().max(500),
    companyCount: z.number().int().nonnegative().max(500),
    existingCompanyCount: z.number().int().nonnegative().max(500),
    newCompanyCount: z.number().int().nonnegative().max(500),
    excludedPositionCount: z.number().int().nonnegative().max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.existingCompanyCount + value.newCompanyCount !==
      value.companyCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["companyCount"],
        message: "Exact company counts must reconcile.",
      });
    }
  });

export const PrivateExposureReviewStateSchema = z
  .object({
    version: z.literal(2),
    positions: z.array(PrivateExposureReviewPositionSchema).max(500),
    companies: z.array(PrivateExposureCompanySchema).max(1_000),
    exactBatch: PrivateExposureExactBatchPreviewSchema,
  })
  .strict();

export const PrivateExposureCompanySelectionSchema = z.discriminatedUnion(
  "mode",
  [
    z
      .object({
        mode: z.literal("existing"),
        companyId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        mode: z.literal("new"),
        legalName: z.string().trim().min(1).max(1_000),
        websiteHost: PrivateExposureWebsiteHostSchema.nullable(),
      })
      .strict(),
  ],
);

export const PrivateExposureResolutionInputSchema = z
  .object({
    expectedSnapshotId: z.string().min(1),
    company: PrivateExposureCompanySelectionSchema,
  })
  .strict();

export const PrivateExposureResolutionResultSchema = z
  .object({
    version: z.literal(1),
    positionId: z.string().min(1),
    companyId: z.string().min(1),
    companyName: z.string().trim().min(1).max(1_000),
    exposureId: z.string().min(1),
    mappingId: z.string().min(1),
  })
  .strict();

export const PrivateExposureExactBatchInputSchema = z
  .object({
    expectedRevision: ProtectedIdentityKeySchema,
  })
  .strict();

export const PrivateExposureExactBatchResultSchema = z
  .object({
    version: z.literal(1),
    assignedPositionCount: z.number().int().positive().max(500),
    companyCount: z.number().int().positive().max(500),
    existingCompanyCount: z.number().int().nonnegative().max(500),
    createdCompanyCount: z.number().int().nonnegative().max(500),
    remainingPositionCount: z.number().int().nonnegative().max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.existingCompanyCount + value.createdCompanyCount !==
      value.companyCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["companyCount"],
        message: "Applied company counts must reconcile.",
      });
    }
  });

export const HoldingImportProviderSchema = z.enum([
  "angellist",
  "tokenfolio",
  "sydecar",
  "plaid_investments",
]);

export const HoldingImportRowActionSchema = z.enum([
  "create_position",
  "append_snapshot",
  "no_change",
  "needs_attention",
]);

export const HoldingImportAdjudicationStatusSchema = z.enum([
  "pending_review",
  "auto_applied",
  "quarantined",
  "manually_resolved",
]);

export const HoldingImportRowPreviewSchema = z.object({
  id: z.string().min(1),
  sourceRowNumber: z.number().int().positive(),
  positionName: z.string().min(1),
  exposureName: z.string().min(1),
  ownerLabel: z.string().min(1),
  providerStatus: z.enum(["Live", "Realized"]),
  investedOn: IsoDateSchema.nullable(),
  investedOnState: z.enum(["reported", "not_reported"]).default("reported"),
  investedMinor: NonNegativeMoneyMinorSchema,
  administratorNavMinor: NonNegativeMoneyMinorSchema.nullable(),
  administratorNavState: z.enum(["reported", "locked", "not_reported"]),
  realizedValueMinor: NonNegativeMoneyMinorSchema,
  ticker: z.string().min(1).max(32).nullable().default(null),
  quantityMicros: z
    .number()
    .int()
    .safe()
    .nonnegative()
    .nullable()
    .default(null),
  costBasisMinor: NonNegativeMoneyMinorSchema.nullable().default(null),
  action: HoldingImportRowActionSchema,
  issues: z.array(z.string().min(1)),
  adjudicationStatus:
    HoldingImportAdjudicationStatusSchema.default("pending_review"),
  decisionSource: z.enum(["manual", "policy"]).nullable().default(null),
  reasonCodes: z.array(z.string().min(1).max(100)).default([]),
});

export const HoldingImportSummarySchema = z.object({
  id: z.string().min(1),
  provider: HoldingImportProviderSchema,
  status: z.enum(["pending_review", "quarantined"]),
  observedAt: IsoTimestampSchema,
  rowCount: z.number().int().nonnegative(),
  createdAt: IsoTimestampSchema,
});

export const HoldingImportSummariesSchema = z
  .array(HoldingImportSummarySchema)
  .max(20);

const AngelListCookieDomainSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?:\.)?(?:[a-z0-9-]+\.)*angellist\.com$/iu);

const AngelListBrowserOriginSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^(?:[a-z0-9-]+\.)*angellist\.com$/iu.test(url.hostname)
  ) {
    context.addIssue({
      code: "custom",
      message: "Browser state must be scoped to an AngelList HTTPS origin.",
    });
  }
});

export const AngelListBrowserStorageStateSchema = z
  .object({
    cookies: z
      .array(
        z
          .object({
            name: z.string().min(1).max(256),
            value: z.string().max(16_384),
            domain: AngelListCookieDomainSchema,
            path: z.string().startsWith("/").max(2_048),
            expires: z.number().finite(),
            httpOnly: z.boolean(),
            secure: z.literal(true),
            sameSite: z.enum(["Strict", "Lax", "None"]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    origins: z
      .array(
        z
          .object({
            origin: AngelListBrowserOriginSchema,
            localStorage: z
              .array(
                z
                  .object({
                    name: z.string().min(1).max(1_024),
                    value: z.string().max(65_536),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export const AngelListAutomationErrorCodeSchema = z.enum([
  "auth_required",
  "browser_unavailable",
  "configuration_invalid",
  "download_failed",
  "export_invalid",
  "forbidden",
  "handoff_input_invalid",
  "magic_link_invalid",
  "refresh_invalid",
  "session_invalid",
  "staging_failed",
  "unexpected_failure",
]);

export const AngelListAutomationStatusSchema = z
  .object({
    version: z.literal(1),
    status: z.enum([
      "never_run",
      "review_ready",
      "up_to_date",
      "auth_required",
      "failed",
    ]),
    checkedAt: IsoTimestampSchema.nullable(),
    importId: z.string().min(1).nullable(),
    errorCode: AngelListAutomationErrorCodeSchema.nullable(),
  })
  .strict();

export const AngelListAutomationOverviewSchema =
  AngelListAutomationStatusSchema.extend({
    signInStatus: z.enum(["connected", "needs_sign_in"]),
  }).strict();

export const AngelListMacAgentIntervalSchema = z.enum([
  "off",
  "daily",
  "weekly",
]);

export const AngelListMacAgentErrorCodeSchema = z.enum([
  "angellist_sign_in_required",
  "export_unavailable",
  "download_failed",
  "keel_sign_in_required",
  "upload_failed",
  "unexpected_failure",
]);

export const AngelListMacAgentOverviewSchema = z
  .object({
    version: z.literal(1),
    status: z.enum([
      "setup_required",
      "offline",
      "ready",
      "running",
      "needs_attention",
    ]),
    interval: AngelListMacAgentIntervalSchema,
    runStatus: z.enum(["queued", "running"]).nullable(),
    lastSeenAt: IsoTimestampSchema.nullable(),
    lastCompletedAt: IsoTimestampSchema.nullable(),
    nextRunAt: IsoTimestampSchema.nullable(),
    latestImportId: z.string().min(1).nullable(),
    errorCode: AngelListMacAgentErrorCodeSchema.nullable(),
  })
  .strict();

export const AngelListMacAgentConfigInputSchema = z
  .object({
    interval: AngelListMacAgentIntervalSchema,
  })
  .strict();

export const AngelListMacAgentRunRequestSchema = z
  .object({
    version: z.literal(1),
    runId: z.uuid(),
    status: z.enum(["queued", "running"]),
  })
  .strict();

export const AngelListMacAgentLeaseSchema = z
  .object({
    version: z.literal(1),
    serverTime: IsoTimestampSchema,
    run: z
      .object({
        id: z.uuid(),
        leaseToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
        expiresAt: IsoTimestampSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export const AngelListMacAgentFailureInputSchema = z
  .object({
    errorCode: AngelListMacAgentErrorCodeSchema,
  })
  .strict();

export const MacAgentTargetSchema = z.enum([
  "angellist",
  "tokenfolio",
  "sydecar",
]);

export const MacAgentTokenSchema = z
  .string()
  .regex(/^keel_agent_v1_[A-Za-z0-9_-]{43}$/u);

export const MacAgentApiOriginSchema = z.url().transform((value, context) => {
  const url = new URL(value);
  const localHttp =
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (!localHttp && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    context.addIssue({
      code: "custom",
      message: "Portfolio agent API URL must be a secure origin.",
    });
    return z.NEVER;
  }
  return url.origin;
});

export const MacAgentAuthorizationSchema = z
  .object({
    version: z.literal(1),
    target: MacAgentTargetSchema,
    apiOrigin: MacAgentApiOriginSchema,
    token: MacAgentTokenSchema,
  })
  .strict();

export const ProviderPortfolioAgentProviderSchema = z.enum([
  "tokenfolio",
  "sydecar",
]);

export const ProviderPortfolioAgentErrorCodeSchema = z.enum([
  "provider_sign_in_required",
  "page_not_supported",
  "incomplete_snapshot",
  "identity_ambiguous",
  "keel_sign_in_required",
  "upload_failed",
  "unexpected_failure",
]);

export const ProviderPortfolioAgentOverviewSchema = z
  .object({
    version: z.literal(1),
    provider: ProviderPortfolioAgentProviderSchema,
    status: z.enum([
      "setup_required",
      "offline",
      "ready",
      "running",
      "needs_attention",
    ]),
    interval: AngelListMacAgentIntervalSchema,
    runStatus: z.enum(["queued", "running"]).nullable(),
    lastSeenAt: IsoTimestampSchema.nullable(),
    lastCompletedAt: IsoTimestampSchema.nullable(),
    nextRunAt: IsoTimestampSchema.nullable(),
    latestImportId: z.string().min(1).nullable(),
    errorCode: ProviderPortfolioAgentErrorCodeSchema.nullable(),
  })
  .strict();

export const ProviderPortfolioAgentConfigInputSchema = z
  .object({
    interval: AngelListMacAgentIntervalSchema,
  })
  .strict();

export const ProviderPortfolioAgentRunRequestSchema = z
  .object({
    version: z.literal(1),
    provider: ProviderPortfolioAgentProviderSchema,
    runId: z.uuid(),
    status: z.enum(["queued", "running"]),
  })
  .strict();

export const ProviderPortfolioAgentLeaseSchema = z
  .object({
    version: z.literal(1),
    provider: ProviderPortfolioAgentProviderSchema,
    serverTime: IsoTimestampSchema,
    run: z
      .object({
        id: z.uuid(),
        leaseToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
        expiresAt: IsoTimestampSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export const ProviderPortfolioAgentFailureInputSchema = z
  .object({
    errorCode: ProviderPortfolioAgentErrorCodeSchema,
  })
  .strict();

export const CloudflareLiveViewUrlSchema = z
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "live.browser.run" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      context.addIssue({
        code: "custom",
        message: "Live View must use Cloudflare's HTTPS host.",
      });
    }
  });

export const AngelListSignInRefreshSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    status: z.enum([
      "waiting_for_sign_in",
      "connected",
      "expired",
      "cancelled",
    ]),
    expiresAt: IsoTimestampSchema,
    liveViewUrl: CloudflareLiveViewUrlSchema.nullable(),
    liveViewExpiresAt: IsoTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status !== "waiting_for_sign_in" && value.liveViewUrl !== null) {
      context.addIssue({
        code: "custom",
        path: ["liveViewUrl"],
        message: "Completed refreshes cannot expose a Live View URL.",
      });
    }
    if ((value.liveViewUrl === null) !== (value.liveViewExpiresAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["liveViewExpiresAt"],
        message:
          "Live View URLs and their expiration must be returned together.",
      });
    }
  });

export const HoldingImportPreviewSchema = z.object({
  id: z.string().min(1),
  provider: HoldingImportProviderSchema,
  status: z.enum(["pending_review", "applied", "quarantined"]),
  observedAt: IsoTimestampSchema,
  summary: z.object({
    rowCount: z.number().int().nonnegative(),
    administratorValueCount: z.number().int().nonnegative(),
    lockedValueCount: z.number().int().nonnegative(),
    createCount: z.number().int().nonnegative(),
    updateCount: z.number().int().nonnegative(),
    unchangedCount: z.number().int().nonnegative(),
    needsAttentionCount: z.number().int().nonnegative(),
    autoAppliedCount: z.number().int().nonnegative().default(0),
    quarantinedCount: z.number().int().nonnegative().default(0),
    preservedPositionCount: z.number().int().nonnegative().default(0),
  }),
  coverage: z
    .array(
      z
        .object({
          containerId: z.string().min(1),
          displayLabel: z.string().min(1),
          completeness: HoldingImportCoverageCompletenessSchema,
          reportedRowCount: z.number().int().nonnegative(),
        })
        .strict(),
    )
    .max(100)
    .default([]),
  rows: z.array(HoldingImportRowPreviewSchema),
});

export const HoldingImportDecisionSchema = z.object({
  rowId: z.string().min(1),
  decision: z.enum(["accepted", "rejected"]),
  matchedPositionId: z.string().min(1).nullable().optional(),
  rationale: z.string().trim().min(1).max(500),
});

export const HoldingImportApplyInputSchema = z.object({
  currency: z.literal("USD"),
  decisions: z.array(HoldingImportDecisionSchema).min(1),
});

export const HoldingImportApplyResultSchema = z.object({
  importId: z.string().min(1),
  createdCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  lockedValueCount: z.number().int().nonnegative(),
});

const Sha256Schema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/u);

export const PortfolioBaselinePositionSchema = z.object({
  id: z.string().min(1),
  positionName: z.string().min(1),
  ownerLabel: z.string().min(1),
  sourceLabel: z.string().min(1),
  provider: HoldingImportProviderSchema,
  classification: z.enum(["public_market", "private_paper"]),
  valueMinor: NonNegativeMoneyMinorSchema.nullable(),
  valueState: z.enum(["reported", "locked", "not_reported"]),
  observedAt: IsoTimestampSchema,
  ticker: z.string().min(1).max(32).nullable(),
  isCashPosition: z.boolean(),
  potentialDuplicate: z.boolean(),
  duplicateWith: z.array(z.string().min(1)),
});

export const CashAccountSubtypeSchema = z.enum([
  "checking",
  "savings",
  "money market",
  "cash management",
  "other",
]);

export const CashAccountValueStateSchema = z.enum([
  "reported",
  "unavailable",
  "unsupported",
  "not_reported",
]);

export const AcceptedCashAccountValueStateSchema = z.enum([
  "reported",
  "not_reported",
]);

export const CashBalanceSourceSchema = z.enum(["available", "current"]);

export const CashAccountProposalRowSchema = z.object({
  id: z.string().min(1),
  naturalKeySha256: Sha256Schema,
  institutionLabel: z.string().min(1).max(512),
  accountLabel: z.string().min(1).max(512),
  subtype: CashAccountSubtypeSchema,
  availableMinor: MoneyMinorSchema.nullable(),
  currentMinor: MoneyMinorSchema.nullable(),
  valueMinor: NonNegativeMoneyMinorSchema.nullable(),
  valueState: CashAccountValueStateSchema,
  balanceSource: CashBalanceSourceSchema.nullable(),
  observedAt: IsoTimestampSchema,
  priorValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  priorValueState: CashAccountValueStateSchema.nullable(),
  action: z.enum([
    "new_account",
    "update_balance",
    "no_change",
    "not_reported",
    "needs_attention",
  ]),
  issues: z.array(z.string().min(1).max(240)).max(5),
});

export const CashBalanceProposalSummarySchema = z.object({
  rowCount: z.number().int().positive(),
  reportedCount: z.number().int().nonnegative(),
  needsAttentionCount: z.number().int().nonnegative(),
  notReportedCount: z.number().int().nonnegative(),
  totalReportedMinor: NonNegativeMoneyMinorSchema,
});

export const CashBalanceProposalSchema = z.object({
  id: z.string().min(1),
  connectionId: z.string().min(1),
  institutionLabel: z.string().min(1).max(512),
  status: z.literal("pending_review"),
  refreshKind: z.enum(["initial", "live"]),
  observedAt: IsoTimestampSchema,
  retrievedAt: IsoTimestampSchema,
  summary: CashBalanceProposalSummarySchema,
  rows: z.array(CashAccountProposalRowSchema).min(1).max(100),
});

export const AcceptedCashAccountSchema = z
  .object({
    id: z.string().min(1),
    naturalKeySha256: Sha256Schema,
    connectionId: z.string().min(1),
    institutionLabel: z.string().min(1).max(512),
    accountLabel: z.string().min(1).max(512),
    subtype: CashAccountSubtypeSchema,
    valueMinor: NonNegativeMoneyMinorSchema.nullable(),
    valueState: AcceptedCashAccountValueStateSchema,
    balanceSource: CashBalanceSourceSchema.nullable(),
    refreshKind: z.enum(["initial", "live"]),
    observedAt: IsoTimestampSchema,
    acceptedAt: IsoTimestampSchema,
  })
  .superRefine((account, context) => {
    const inconsistentReportedValue =
      account.valueState === "reported" &&
      (account.valueMinor === null || account.balanceSource === null);
    const inconsistentMissingValue =
      account.valueState === "not_reported" &&
      (account.valueMinor !== null || account.balanceSource !== null);
    if (inconsistentReportedValue || inconsistentMissingValue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Accepted cash value and source must match its state.",
        path: ["valueState"],
      });
    }
  });

export const CashAccountConnectionSchema = z.object({
  id: z.string().min(1),
  institutionLabel: z.string().min(1).max(512),
  status: z.enum(["ready", "needs_attention"]),
  lastCheckedAt: IsoTimestampSchema.nullable(),
  liveRefreshLimit: z.number().int().positive(),
  liveRefreshesUsed: z.number().int().nonnegative(),
  liveRefreshesRemaining: z.number().int().nonnegative(),
});

export const CashAccountIdentityCandidateSchema = z.object({
  connectionId: z.string().min(1),
  institutionLabel: z.string().min(1).max(512),
  accountLabel: z.string().min(1).max(512),
  subtype: CashAccountSubtypeSchema,
  priorNaturalKeySha256: Sha256Schema,
  reportedNaturalKeySha256: Sha256Schema,
  observedAt: IsoTimestampSchema,
});

export const CashAccountIdentityDecisionSchema = z.enum([
  "same_account",
  "separate_accounts",
]);

export const CashAccountIdentityReviewInputSchema = z
  .object({
    connectionId: z.string().min(1),
    priorNaturalKeySha256: Sha256Schema,
    reportedNaturalKeySha256: Sha256Schema,
    decision: CashAccountIdentityDecisionSchema,
    changeNote: z.string().trim().min(1).max(500),
  })
  .refine(
    (input) => input.priorNaturalKeySha256 !== input.reportedNaturalKeySha256,
    {
      message: "Cash account identity keys must differ.",
      path: ["reportedNaturalKeySha256"],
    },
  );

export const CashAccountsErrorCodeSchema = z.enum([
  "configuration_required",
  "connection_invalid",
  "monthly_limit_reached",
  "review_required",
  "provider_unavailable",
  "response_invalid",
  "staging_failed",
  "unexpected_failure",
]);

export const CashAccountsStateSchema = z.object({
  version: z.literal(1),
  configured: z.boolean(),
  status: z.enum([
    "setup_required",
    "disconnected",
    "ready",
    "needs_attention",
  ]),
  connections: z.array(CashAccountConnectionSchema).max(20),
  acceptedAccounts: z.array(AcceptedCashAccountSchema).max(100),
  identityCandidates: z
    .array(CashAccountIdentityCandidateSchema)
    .max(100)
    .default([]),
  pendingProposals: z.array(CashBalanceProposalSchema).max(20),
  errorCode: CashAccountsErrorCodeSchema.nullable(),
});

export const CashAccountLinkTokenSchema = z.object({
  linkToken: z.string().min(1).max(4_096),
  expiration: IsoTimestampSchema,
});

export const CashAccountExchangeInputSchema = z.object({
  publicToken: z.string().min(1).max(4_096),
});

export const CashAccountReviewDecisionSchema = z.object({
  rowId: z.string().min(1),
  decision: z.enum(["accepted", "excluded"]),
});

export const CashAccountApplyInputSchema = z.object({
  decisions: z.array(CashAccountReviewDecisionSchema).min(1).max(100),
  changeNote: z.string().trim().min(1).max(500),
});

export const CashAccountApplyResultSchema = z.object({
  proposalId: z.string().min(1),
  acceptedCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  acceptedCashMinor: NonNegativeMoneyMinorSchema,
});

export const LiabilitySourceSchema = z.enum(["plaid", "manual"]);

export const LiabilityKindSchema = z.enum([
  "credit_card",
  "mortgage",
  "student_loan",
  "other_revolving",
  "other_scheduled",
]);

export const LiabilityClassificationSchema = z.enum(["revolving", "scheduled"]);

export function liabilityClassification(
  kind: z.input<typeof LiabilityKindSchema>,
): z.infer<typeof LiabilityClassificationSchema> {
  return LiabilityClassificationSchema.parse(
    kind === "credit_card" || kind === "other_revolving"
      ? "revolving"
      : "scheduled",
  );
}

export const LiabilityValueStateSchema = z.enum([
  "reported",
  "unavailable",
  "unsupported",
  "not_reported",
]);

export const AcceptedLiabilityValueStateSchema = z.enum([
  "reported",
  "unavailable",
  "not_reported",
]);

export const LiabilityPaymentTreatmentSchema = z.enum([
  "reserve_from_liquidity",
  "add_to_household_burn",
  "already_in_plan",
]);

export const LiabilityProposalRowSchema = z
  .object({
    id: z.string().min(1),
    naturalKeySha256: Sha256Schema,
    source: LiabilitySourceSchema,
    institutionLabel: z.string().trim().min(1).max(512),
    accountLabel: z.string().trim().min(1).max(512),
    kind: LiabilityKindSchema,
    classification: LiabilityClassificationSchema,
    balanceMinor: NonNegativeMoneyMinorSchema.nullable(),
    valueState: LiabilityValueStateSchema,
    paymentMinor: NonNegativeMoneyMinorSchema.nullable(),
    interestRatePpm: ProbabilityPpmSchema.nullable(),
    nextPaymentDueDate: IsoDateSchema.nullable(),
    isOverdue: z.boolean().nullable(),
    effectiveDate: IsoDateSchema,
    observedAt: IsoTimestampSchema,
    priorBalanceMinor: NonNegativeMoneyMinorSchema.nullable(),
    priorValueState: LiabilityValueStateSchema.nullable(),
    action: z.enum([
      "new_obligation",
      "update_obligation",
      "no_change",
      "not_reported",
      "needs_attention",
    ]),
    issues: z.array(z.string().min(1).max(240)).max(5),
  })
  .superRefine((row, context) => {
    if (row.classification !== liabilityClassification(row.kind)) {
      context.addIssue({
        code: "custom",
        message: "Liability classification does not match its kind.",
        path: ["classification"],
      });
    }
    const balanceMatchesState =
      (row.valueState === "reported" && row.balanceMinor !== null) ||
      (row.valueState !== "reported" && row.balanceMinor === null);
    if (!balanceMatchesState) {
      context.addIssue({
        code: "custom",
        message: "Liability balance does not match its value state.",
        path: ["valueState"],
      });
    }
  });

export const LiabilityProposalSummarySchema = z.object({
  rowCount: z.number().int().positive(),
  reportedCount: z.number().int().nonnegative(),
  needsAttentionCount: z.number().int().nonnegative(),
  notReportedCount: z.number().int().nonnegative(),
  totalReportedMinor: NonNegativeMoneyMinorSchema,
});

export const LiabilityProposalSchema = z.object({
  id: z.string().min(1),
  connectionId: z.string().min(1).nullable(),
  institutionLabel: z.string().trim().min(1).max(512),
  source: LiabilitySourceSchema,
  status: z.literal("pending_review"),
  refreshKind: z.enum(["initial", "live", "manual"]),
  observedAt: IsoTimestampSchema,
  retrievedAt: IsoTimestampSchema,
  summary: LiabilityProposalSummarySchema,
  rows: z.array(LiabilityProposalRowSchema).min(1).max(100),
});

export const AcceptedLiabilitySchema = z
  .object({
    id: z.string().min(1),
    naturalKeySha256: Sha256Schema,
    connectionId: z.string().min(1).nullable(),
    source: LiabilitySourceSchema,
    institutionLabel: z.string().trim().min(1).max(512),
    accountLabel: z.string().trim().min(1).max(512),
    kind: LiabilityKindSchema,
    classification: LiabilityClassificationSchema,
    balanceMinor: NonNegativeMoneyMinorSchema.nullable(),
    valueState: AcceptedLiabilityValueStateSchema,
    paymentMinor: NonNegativeMoneyMinorSchema.nullable(),
    paymentTreatment: LiabilityPaymentTreatmentSchema,
    interestRatePpm: ProbabilityPpmSchema.nullable(),
    nextPaymentDueDate: IsoDateSchema.nullable(),
    isOverdue: z.boolean().nullable(),
    effectiveDate: IsoDateSchema,
    observedAt: IsoTimestampSchema,
    retrievedAt: IsoTimestampSchema,
    acceptedAt: IsoTimestampSchema,
    freshness: z.enum(["current", "stale"]),
  })
  .superRefine((liability, context) => {
    if (liability.classification !== liabilityClassification(liability.kind)) {
      context.addIssue({
        code: "custom",
        message: "Liability classification does not match its kind.",
        path: ["classification"],
      });
    }
    const balanceMatchesState =
      (liability.valueState === "reported" &&
        liability.balanceMinor !== null) ||
      (liability.valueState !== "reported" && liability.balanceMinor === null);
    if (!balanceMatchesState) {
      context.addIssue({
        code: "custom",
        message: "Accepted liability balance does not match its state.",
        path: ["valueState"],
      });
    }
    const treatmentMatchesClassification =
      liability.paymentTreatment === "already_in_plan" ||
      (liability.classification === "revolving" &&
        liability.paymentTreatment === "reserve_from_liquidity") ||
      (liability.classification === "scheduled" &&
        liability.paymentTreatment === "add_to_household_burn");
    if (!treatmentMatchesClassification || liability.paymentMinor === null) {
      if (liability.paymentTreatment !== "already_in_plan") {
        context.addIssue({
          code: "custom",
          message: "Payment treatment does not match the reviewed payment.",
          path: ["paymentTreatment"],
        });
      }
    }
    if ((liability.source === "manual") !== (liability.connectionId === null)) {
      context.addIssue({
        code: "custom",
        message: "Liability source does not match its connection.",
        path: ["connectionId"],
      });
    }
  });

export const LiabilityConnectionSchema = z.object({
  id: z.string().min(1),
  institutionLabel: z.string().trim().min(1).max(512),
  status: z.enum(["ready", "needs_attention"]),
  lastCheckedAt: IsoTimestampSchema.nullable(),
  liveRefreshLimit: z.number().int().positive(),
  liveRefreshesUsed: z.number().int().nonnegative(),
  liveRefreshesRemaining: z.number().int().nonnegative(),
});

export const LiabilityPlanningContextSchema = z.object({
  currentFiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  protectedCashFloorMinor: NonNegativeMoneyMinorSchema,
  householdBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  businessBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  fiTargetMinor: NonNegativeMoneyMinorSchema,
});

export const LiabilityImpactSchema = z.object({
  liabilityCount: z.number().int().nonnegative(),
  totalOutstandingMinor: NonNegativeMoneyMinorSchema,
  unknownBalanceCount: z.number().int().nonnegative(),
  unknownPaymentCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  reservedPaymentMinor: NonNegativeMoneyMinorSchema,
  addedHouseholdBurnMinor: NonNegativeMoneyMinorSchema,
  netLiquidityMinor: NonNegativeMoneyMinorSchema,
  adjustedHouseholdBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  adjustedTotalBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  protectedRunwayMonths: z.number().int().nonnegative(),
  obligationAdjustedFiGapMinor: NonNegativeMoneyMinorSchema,
});

export function createLiabilityImpact(
  rawContext: z.input<typeof LiabilityPlanningContextSchema>,
  rawLiabilities: readonly z.input<typeof AcceptedLiabilitySchema>[],
): z.infer<typeof LiabilityImpactSchema> {
  const context = LiabilityPlanningContextSchema.parse(rawContext);
  const liabilities = rawLiabilities.map((liability) =>
    AcceptedLiabilitySchema.parse(liability),
  );
  const totalOutstandingMinor = addMinorUnits(
    ...liabilities.map((liability) => liability.balanceMinor ?? 0),
  );
  const reservedPaymentMinor = addMinorUnits(
    ...liabilities
      .filter(
        (liability) => liability.paymentTreatment === "reserve_from_liquidity",
      )
      .map((liability) => liability.paymentMinor ?? 0),
  );
  const addedHouseholdBurnMinor = addMinorUnits(
    ...liabilities
      .filter(
        (liability) => liability.paymentTreatment === "add_to_household_burn",
      )
      .map((liability) => liability.paymentMinor ?? 0),
  );
  const netLiquidityMinor = Math.max(
    subtractMinorUnits(
      context.currentFiEligibleLiquidMinor,
      reservedPaymentMinor,
    ),
    0,
  );
  const adjustedHouseholdBurnMonthlyMinor = addMinorUnits(
    context.householdBurnMonthlyMinor,
    addedHouseholdBurnMinor,
  );
  const adjustedTotalBurnMonthlyMinor = addMinorUnits(
    adjustedHouseholdBurnMonthlyMinor,
    context.businessBurnMonthlyMinor,
  );
  const runwayBaseMinor = Math.max(
    subtractMinorUnits(netLiquidityMinor, context.protectedCashFloorMinor),
    0,
  );

  return LiabilityImpactSchema.parse({
    liabilityCount: liabilities.length,
    totalOutstandingMinor,
    unknownBalanceCount: liabilities.filter(
      (liability) => liability.balanceMinor === null,
    ).length,
    unknownPaymentCount: liabilities.filter(
      (liability) => liability.paymentMinor === null,
    ).length,
    overdueCount: liabilities.filter(
      (liability) => liability.isOverdue === true,
    ).length,
    reservedPaymentMinor,
    addedHouseholdBurnMinor,
    netLiquidityMinor,
    adjustedHouseholdBurnMonthlyMinor,
    adjustedTotalBurnMonthlyMinor,
    protectedRunwayMonths:
      adjustedTotalBurnMonthlyMinor === 0
        ? 0
        : Number(
            BigInt(runwayBaseMinor) / BigInt(adjustedTotalBurnMonthlyMinor),
          ),
    obligationAdjustedFiGapMinor: Math.max(
      subtractMinorUnits(context.fiTargetMinor, netLiquidityMinor),
      0,
    ),
  });
}

export const LiabilitiesErrorCodeSchema = z.enum([
  "configuration_required",
  "connection_invalid",
  "monthly_limit_reached",
  "review_required",
  "provider_unavailable",
  "response_invalid",
  "staging_failed",
  "unexpected_failure",
]);

export const LiabilitiesStateSchema = z.object({
  version: z.literal(1),
  configured: z.boolean(),
  status: z.enum([
    "setup_required",
    "disconnected",
    "ready",
    "needs_attention",
  ]),
  connections: z.array(LiabilityConnectionSchema).max(20),
  acceptedLiabilities: z.array(AcceptedLiabilitySchema).max(100),
  pendingProposals: z.array(LiabilityProposalSchema).max(20),
  planning: LiabilityPlanningContextSchema,
  impact: LiabilityImpactSchema,
  errorCode: LiabilitiesErrorCodeSchema.nullable(),
});

export const LiabilityLinkTokenSchema = z.object({
  linkToken: z.string().min(1).max(4_096),
  expiration: IsoTimestampSchema,
});

export const LiabilityExchangeInputSchema = z.object({
  publicToken: z.string().min(1).max(4_096),
});

export const ManualLiabilityInputSchema = z.object({
  institutionLabel: z.string().trim().min(1).max(512),
  accountLabel: z.string().trim().min(1).max(512),
  kind: LiabilityKindSchema,
  balanceMinor: NonNegativeMoneyMinorSchema.nullable(),
  paymentMinor: NonNegativeMoneyMinorSchema.nullable(),
  interestRatePpm: ProbabilityPpmSchema.nullable(),
  nextPaymentDueDate: IsoDateSchema.nullable(),
  isOverdue: z.boolean().nullable(),
  effectiveDate: IsoDateSchema,
});

export const LiabilityReviewDecisionSchema = z.object({
  rowId: z.string().min(1),
  decision: z.enum(["accepted", "excluded"]),
  paymentTreatment: LiabilityPaymentTreatmentSchema.nullable(),
});

export const LiabilityApplyInputSchema = z.object({
  decisions: z.array(LiabilityReviewDecisionSchema).min(1).max(100),
  changeNote: z.string().trim().min(1).max(500),
});

export const LiabilityApplyResultSchema = z.object({
  proposalId: z.string().min(1),
  acceptedCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  impact: LiabilityImpactSchema,
});

export const PortfolioBaselineCashAccountSchema = z
  .object({
    id: z.string().min(1),
    institutionLabel: z.string().min(1).max(512),
    accountLabel: z.string().min(1).max(512),
    subtype: CashAccountSubtypeSchema,
    valueMinor: NonNegativeMoneyMinorSchema.nullable(),
    valueState: AcceptedCashAccountValueStateSchema,
    refreshKind: z.enum(["initial", "live"]),
    observedAt: IsoTimestampSchema,
  })
  .superRefine((account, context) => {
    const valueMatchesState =
      (account.valueState === "reported" && account.valueMinor !== null) ||
      (account.valueState === "not_reported" && account.valueMinor === null);
    if (!valueMatchesState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Baseline cash value must match its reviewed state.",
        path: ["valueState"],
      });
    }
  });

export const PortfolioBaselineSummarySchema = z.object({
  positionCount: z.number().int().positive(),
  publicMarketValueMinor: NonNegativeMoneyMinorSchema,
  privatePaperValueMinor: NonNegativeMoneyMinorSchema,
  cashAccountCount: z.number().int().nonnegative(),
  cashAccountValueMinor: NonNegativeMoneyMinorSchema,
  unknownCashAccountCount: z.number().int().nonnegative(),
  unknownValueCount: z.number().int().nonnegative(),
  potentialDuplicateCount: z.number().int().nonnegative(),
});

export const PortfolioBaselinePlanningContextSchema = z.object({
  currentFiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  protectedCashFloorMinor: NonNegativeMoneyMinorSchema,
  householdBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  businessBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  fiTargetMinor: NonNegativeMoneyMinorSchema,
  p25FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  p50FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  p75FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  forecastHorizonDate: IsoDateSchema,
});

export const PortfolioBaselineImpactSchema = z.object({
  fiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  fiEligibleChangeMinor: MoneyMinorSchema,
  protectedRunwayMonths: z.number().int().nonnegative(),
  fiGapMinor: NonNegativeMoneyMinorSchema,
  lowerTotalAvailableMinor: NonNegativeMoneyMinorSchema,
  middleTotalAvailableMinor: NonNegativeMoneyMinorSchema,
  higherTotalAvailableMinor: NonNegativeMoneyMinorSchema,
  probabilityCrossingFiPpm: ProbabilityPpmSchema,
});

export function createPortfolioBaselineImpact(
  rawContext: z.input<typeof PortfolioBaselinePlanningContextSchema>,
  rawFiEligibleLiquidMinor: number,
): z.infer<typeof PortfolioBaselineImpactSchema> {
  const context = PortfolioBaselinePlanningContextSchema.parse(rawContext);
  const fiEligibleLiquidMinor = NonNegativeMoneyMinorSchema.parse(
    rawFiEligibleLiquidMinor,
  );
  const monthlyBurnMinor = addMinorUnits(
    context.householdBurnMonthlyMinor,
    context.businessBurnMonthlyMinor,
  );
  const runwayBaseMinor = Math.max(
    fiEligibleLiquidMinor - context.protectedCashFloorMinor,
    0,
  );
  const protectedRunwayMonths =
    monthlyBurnMinor === 0
      ? 0
      : Number(BigInt(runwayBaseMinor) / BigInt(monthlyBurnMinor));
  const lowerTotalAvailableMinor = addMinorUnits(
    fiEligibleLiquidMinor,
    context.p25FiveYearLiquidityMinor,
  );
  const middleTotalAvailableMinor = addMinorUnits(
    fiEligibleLiquidMinor,
    context.p50FiveYearLiquidityMinor,
  );
  const higherTotalAvailableMinor = addMinorUnits(
    fiEligibleLiquidMinor,
    context.p75FiveYearLiquidityMinor,
  );

  return PortfolioBaselineImpactSchema.parse({
    fiEligibleLiquidMinor,
    fiEligibleChangeMinor: subtractMinorUnits(
      fiEligibleLiquidMinor,
      context.currentFiEligibleLiquidMinor,
    ),
    protectedRunwayMonths,
    fiGapMinor: Math.max(context.fiTargetMinor - fiEligibleLiquidMinor, 0),
    lowerTotalAvailableMinor,
    middleTotalAvailableMinor,
    higherTotalAvailableMinor,
    probabilityCrossingFiPpm: estimateThresholdProbabilityPpm(
      context.fiTargetMinor,
      lowerTotalAvailableMinor,
      middleTotalAvailableMinor,
      higherTotalAvailableMinor,
    ),
  });
}

export const PortfolioBaselineRecordSchema = z.object({
  id: z.string().min(1),
  sourceRevision: Sha256Schema,
  observedAt: IsoTimestampSchema,
  summary: PortfolioBaselineSummarySchema,
  priorFiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  fiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  otherFiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  forecastSnapshotId: z.string().min(1),
  forecastSnapshotVersion: z.number().int().positive(),
  goalVersion: z.number().int().positive().nullable(),
  changeNote: z.string().min(1).max(500),
  createdAt: IsoTimestampSchema,
  createdBy: z.string().min(1),
});

export const PortfolioBaselineStateSchema = z.object({
  status: z.enum(["waiting_for_reviewed_holdings", "ready", "current"]),
  sourceRevision: Sha256Schema.nullable(),
  observedAt: IsoTimestampSchema.nullable(),
  baseForecastSnapshotId: z.string().min(1).nullable(),
  baseForecastSnapshotVersion: z.number().int().positive().nullable(),
  summary: PortfolioBaselineSummarySchema.nullable(),
  positions: z.array(PortfolioBaselinePositionSchema),
  cashAccounts: z.array(PortfolioBaselineCashAccountSchema),
  planning: PortfolioBaselinePlanningContextSchema,
  suggestedOtherFiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  currentImpact: PortfolioBaselineImpactSchema,
  latestBaseline: PortfolioBaselineRecordSchema.nullable(),
  hasSourceChanges: z.boolean(),
  hasCashAccountChanges: z.boolean(),
  requiresDuplicateReview: z.boolean(),
  requiresCashOverlapReview: z.boolean(),
  canConfirm: z.boolean(),
});

export const PortfolioBaselineConfirmInputSchema = z.object({
  sourceRevision: Sha256Schema,
  baseForecastSnapshotId: z.string().min(1),
  baseForecastSnapshotVersion: z.number().int().positive(),
  otherFiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  duplicateReviewConfirmed: z.boolean(),
  cashOverlapReviewConfirmed: z.boolean(),
  changeNote: z.string().trim().min(1).max(500),
});

export const PortfolioBaselineConfirmResultSchema = z.object({
  baseline: PortfolioBaselineRecordSchema,
  impact: PortfolioBaselineImpactSchema,
});

export const PlanInputValuesSchema = z.object({
  householdBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  businessBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  protectedCashFloorMinor: NonNegativeMoneyMinorSchema,
});

export const PlanInputImpactSchema = z.object({
  totalMonthlyBurnMinor: NonNegativeMoneyMinorSchema,
  liquidAfterCashFloorMinor: NonNegativeMoneyMinorSchema,
  protectedRunwayMonths: z.number().int().nonnegative(),
});

export function createPlanInputImpact(
  rawValues: z.input<typeof PlanInputValuesSchema>,
  rawFiEligibleLiquidMinor: number,
): z.infer<typeof PlanInputImpactSchema> {
  const values = PlanInputValuesSchema.parse(rawValues);
  const fiEligibleLiquidMinor = NonNegativeMoneyMinorSchema.parse(
    rawFiEligibleLiquidMinor,
  );
  const totalMonthlyBurnMinor = addMinorUnits(
    values.householdBurnMonthlyMinor,
    values.businessBurnMonthlyMinor,
  );
  const liquidAfterCashFloorMinor = Math.max(
    subtractMinorUnits(fiEligibleLiquidMinor, values.protectedCashFloorMinor),
    0,
  );
  const protectedRunwayMonths =
    totalMonthlyBurnMinor === 0
      ? 0
      : Number(
          BigInt(liquidAfterCashFloorMinor) / BigInt(totalMonthlyBurnMinor),
        );

  return PlanInputImpactSchema.parse({
    totalMonthlyBurnMinor,
    liquidAfterCashFloorMinor,
    protectedRunwayMonths,
  });
}

export const PlanInputStateSchema = z.object({
  baseCashFlowPlanId: z.string().min(1),
  baseForecastSnapshotId: z.string().min(1),
  baseForecastSnapshotVersion: z.number().int().positive(),
  values: PlanInputValuesSchema,
  fiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  fiTargetMinor: NonNegativeMoneyMinorSchema,
  forecastHorizonDate: IsoDateSchema,
  impact: PlanInputImpactSchema,
});

export const PlanInputSaveSchema = PlanInputValuesSchema.extend({
  baseCashFlowPlanId: z.string().min(1),
  baseForecastSnapshotId: z.string().min(1),
  baseForecastSnapshotVersion: z.number().int().positive(),
  changeNote: z.string().trim().min(1).max(500),
  cashFlowProposalId: z.string().min(1).optional(),
});

export const PlanInputSaveResultSchema = z.object({
  plan: PlanInputStateSchema,
  priorImpact: PlanInputImpactSchema,
  createdAt: IsoTimestampSchema,
  createdBy: z.string().min(1),
});

export const CASH_FLOW_POLICY_VERSION = "observed-cash-flow-v1";

export const CashFlowCategorySchema = z.enum([
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "HOME_IMPROVEMENT",
  "INCOME",
  "LOAN_PAYMENTS",
  "MEDICAL",
  "OTHER",
  "PERSONAL_CARE",
  "RENT_AND_UTILITIES",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "TRANSPORTATION",
  "TRAVEL",
]);

export const CashFlowTreatmentSchema = z.enum([
  "household",
  "business",
  "excluded",
  "debt_payment",
]);

export const CashFlowPlanningContextSchema = z.object({
  baseCashFlowPlanId: z.string().min(1),
  baseForecastSnapshotId: z.string().min(1),
  baseForecastSnapshotVersion: z.number().int().positive(),
  householdBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  businessBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  debtPaymentContextMonthlyMinor: NonNegativeMoneyMinorSchema,
  protectedCashFloorMinor: NonNegativeMoneyMinorSchema,
  fiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
});

export const CashFlowComparisonSchema = z.object({
  observedHouseholdMonthlyMinor: NonNegativeMoneyMinorSchema,
  observedBusinessMonthlyMinor: NonNegativeMoneyMinorSchema,
  proposedHouseholdBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  proposedBusinessBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  householdChangeMinor: MoneyMinorSchema,
  businessChangeMinor: MoneyMinorSchema,
  totalChangeMinor: MoneyMinorSchema,
  currentRunwayMonths: z.number().int().nonnegative(),
  proposedRunwayMonths: z.number().int().nonnegative(),
  material: z.boolean(),
});

function materialChangeThreshold(currentMinor: number, floorMinor: number) {
  const proportional = Number(
    (BigInt(currentMinor) * 100_000n + 999_999n) / 1_000_000n,
  );
  return Math.max(floorMinor, proportional);
}

export function createCashFlowComparison(
  rawPlanning: z.input<typeof CashFlowPlanningContextSchema>,
  rawObservedHouseholdMonthlyMinor: number,
  rawObservedBusinessMonthlyMinor: number,
  includeDebtPaymentContext = true,
): z.infer<typeof CashFlowComparisonSchema> {
  const planning = CashFlowPlanningContextSchema.parse(rawPlanning);
  const observedHouseholdMonthlyMinor = NonNegativeMoneyMinorSchema.parse(
    rawObservedHouseholdMonthlyMinor,
  );
  const observedBusinessMonthlyMinor = NonNegativeMoneyMinorSchema.parse(
    rawObservedBusinessMonthlyMinor,
  );
  const proposedHouseholdBurnMonthlyMinor = addMinorUnits(
    observedHouseholdMonthlyMinor,
    includeDebtPaymentContext ? planning.debtPaymentContextMonthlyMinor : 0,
  );
  const proposedBusinessBurnMonthlyMinor = observedBusinessMonthlyMinor;
  const householdChangeMinor = subtractMinorUnits(
    proposedHouseholdBurnMonthlyMinor,
    planning.householdBurnMonthlyMinor,
  );
  const businessChangeMinor = subtractMinorUnits(
    proposedBusinessBurnMonthlyMinor,
    planning.businessBurnMonthlyMinor,
  );
  const currentTotalMinor = addMinorUnits(
    planning.householdBurnMonthlyMinor,
    planning.businessBurnMonthlyMinor,
  );
  const proposedTotalMinor = addMinorUnits(
    proposedHouseholdBurnMonthlyMinor,
    proposedBusinessBurnMonthlyMinor,
  );
  const totalChangeMinor = subtractMinorUnits(
    proposedTotalMinor,
    currentTotalMinor,
  );
  const runwayBaseMinor = Math.max(
    subtractMinorUnits(
      planning.fiEligibleLiquidMinor,
      planning.protectedCashFloorMinor,
    ),
    0,
  );
  const runwayFor = (monthlyMinor: number) =>
    monthlyMinor === 0
      ? 0
      : Number(BigInt(runwayBaseMinor) / BigInt(monthlyMinor));
  const material =
    Math.abs(householdChangeMinor) >=
      materialChangeThreshold(planning.householdBurnMonthlyMinor, 25_000) ||
    Math.abs(businessChangeMinor) >=
      materialChangeThreshold(planning.businessBurnMonthlyMinor, 25_000) ||
    Math.abs(totalChangeMinor) >=
      materialChangeThreshold(currentTotalMinor, 50_000);

  return CashFlowComparisonSchema.parse({
    observedHouseholdMonthlyMinor,
    observedBusinessMonthlyMinor,
    proposedHouseholdBurnMonthlyMinor,
    proposedBusinessBurnMonthlyMinor,
    householdChangeMinor,
    businessChangeMinor,
    totalChangeMinor,
    currentRunwayMonths: runwayFor(currentTotalMinor),
    proposedRunwayMonths: runwayFor(proposedTotalMinor),
    material,
  });
}

export const CashFlowMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
  outflowMinor: NonNegativeMoneyMinorSchema,
  transactionCount: z.number().int().nonnegative(),
});

export const CashFlowProposalCategorySchema = z.object({
  id: z.string().min(1),
  category: CashFlowCategorySchema,
  label: z.string().min(1).max(80),
  totalMinor: NonNegativeMoneyMinorSchema,
  averageMonthlyMinor: NonNegativeMoneyMinorSchema,
  transactionCount: z.number().int().positive(),
  defaultTreatment: CashFlowTreatmentSchema,
  reviewedTreatment: CashFlowTreatmentSchema.nullable(),
});

export const CashFlowPlanSuggestionSchema = PlanInputValuesSchema.pick({
  householdBurnMonthlyMinor: true,
  businessBurnMonthlyMinor: true,
}).extend({
  proposalId: z.string().min(1),
  changeNote: z.string().min(1).max(500),
});

export const CashFlowProposalSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending_review", "ready_for_plan"]),
  observedAt: IsoTimestampSchema,
  periodStartMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
  periodEndMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
  transactionCount: z.number().int().positive(),
  pendingExcludedCount: z.number().int().nonnegative(),
  unsupportedExcludedCount: z.number().int().nonnegative(),
  unreviewedAccountExcludedCount: z.number().int().nonnegative(),
  coveredConnectionCount: z.number().int().positive(),
  planning: CashFlowPlanningContextSchema,
  comparison: CashFlowComparisonSchema,
  months: z.array(CashFlowMonthSchema).length(3),
  categories: z.array(CashFlowProposalCategorySchema).min(1).max(17),
  planSuggestion: CashFlowPlanSuggestionSchema.nullable(),
});

export const CashFlowConnectionSchema = z.object({
  id: z.string().min(1),
  institutionLabel: z.string().min(1).max(512),
  status: z.enum([
    "cash_review_required",
    "consent_required",
    "ready",
    "needs_attention",
  ]),
  acceptedAccountCount: z.number().int().nonnegative(),
  pricingConfirmedAt: IsoTimestampSchema.nullable(),
  lastCheckedAt: IsoTimestampSchema.nullable(),
  dailyCheckLimit: z.number().int().positive(),
  dailyChecksUsed: z.number().int().nonnegative(),
  dailyChecksRemaining: z.number().int().nonnegative(),
});

export const CashFlowErrorCodeSchema = z.enum([
  "configuration_required",
  "connection_invalid",
  "consent_required",
  "daily_limit_reached",
  "review_required",
  "provider_not_ready",
  "provider_unavailable",
  "response_invalid",
  "history_incomplete",
  "coverage_incomplete",
  "staging_failed",
  "unexpected_failure",
]);

export const CashFlowStateSchema = z.object({
  version: z.literal(1),
  configured: z.boolean(),
  status: z.enum([
    "setup_required",
    "disconnected",
    "waiting_for_cash_review",
    "consent_required",
    "ready",
    "review_required",
    "needs_attention",
  ]),
  latestOutcome: z.enum([
    "never_checked",
    "history_incomplete",
    "coverage_incomplete",
    "no_material_change",
    "proposal_ready",
  ]),
  connections: z.array(CashFlowConnectionSchema),
  pendingProposals: z.array(CashFlowProposalSchema).max(1),
  errorCode: CashFlowErrorCodeSchema.nullable(),
});

export const CashFlowSyncInputSchema = z
  .object({
    policyVersion: z.literal(CASH_FLOW_POLICY_VERSION),
    pricingConfirmed: z.boolean(),
  })
  .strict();

export const CashFlowReviewDecisionSchema = z.object({
  categoryId: z.string().min(1),
  treatment: CashFlowTreatmentSchema,
});

export const CashFlowReviewInputSchema = z
  .object({
    decisions: z.array(CashFlowReviewDecisionSchema).min(1).max(17),
    changeNote: z.string().trim().min(1).max(500),
  })
  .strict();

export const CashFlowReviewResultSchema = z.object({
  proposalId: z.string().min(1),
  comparison: CashFlowComparisonSchema,
  planSuggestion: CashFlowPlanSuggestionSchema.nullable(),
});

export const InvestmentSyncErrorCodeSchema = z.enum([
  "configuration_required",
  "connection_invalid",
  "provider_unavailable",
  "response_invalid",
  "holdings_incomplete",
  "staging_failed",
  "unexpected_failure",
]);

export const InvestmentAdjudicationSummarySchema = z
  .object({
    importId: z.string().min(1),
    policyVersion: z.string().min(1).max(100),
    autoAppliedCount: z.number().int().nonnegative(),
    quarantinedCount: z.number().int().nonnegative(),
    preservedPositionCount: z.number().int().nonnegative(),
    baselineRefreshStatus: z.enum([
      "not_needed",
      "refreshed",
      "manual_required",
    ]),
  })
  .strict();

export const InvestmentConnectionStatusSchema = z
  .object({
    version: z.literal(1),
    connectionId: z.string().min(1),
    institutionKey: z.string().min(1).max(200),
    institutionLabel: z.string().min(1).max(512),
    status: z.enum([
      "disconnected",
      "paused",
      "ready",
      "syncing",
      "needs_attention",
    ]),
    lastSyncedAt: IsoTimestampSchema.nullable(),
    automaticUpdatesEnabled: z.boolean().default(false),
    latestImportId: z.string().min(1).nullable(),
    latestRunStatus: z.enum(["running", "succeeded", "failed"]).nullable(),
    errorCode: InvestmentSyncErrorCodeSchema.nullable(),
    latestAdjudication:
      InvestmentAdjudicationSummarySchema.nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.errorCode === "configuration_required") {
      context.addIssue({
        code: "custom",
        message:
          "Connection status cannot carry the deployment configuration error.",
      });
    }
    if (
      (value.status === "syncing") !==
      (value.latestRunStatus === "running")
    ) {
      context.addIssue({
        code: "custom",
        message: "Investment running state is inconsistent.",
      });
    }
    if (
      (value.status === "needs_attention") !==
      (value.latestRunStatus === "failed")
    ) {
      context.addIssue({
        code: "custom",
        message: "Investment failure state is inconsistent.",
      });
    }
    if (value.status === "needs_attention" && value.errorCode === null) {
      context.addIssue({
        code: "custom",
        message: "Investment failure state requires an error code.",
      });
    }
  });

export const InvestmentConnectionsStateSchema = z
  .object({
    version: z.literal(1),
    configured: z.boolean(),
    connections: z.array(InvestmentConnectionStatusSchema).max(50),
    errorCode: z.literal("configuration_required").nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.configured !== (value.errorCode === null)) {
      context.addIssue({
        code: "custom",
        message: "Investments configuration state is inconsistent.",
      });
    }
  });

export const InvestmentLinkTokenSchema = z
  .object({
    linkToken: z.string().min(1).max(4_096),
    expiration: IsoTimestampSchema,
  })
  .strict();

export const InvestmentExchangeInputSchema = z
  .object({
    publicToken: z.string().min(1).max(4_096),
  })
  .strict();

export const InvestmentConnectionLifecycleActionInputSchema = z
  .object({
    action: z.enum(["pause", "resume"]),
  })
  .strict();

export const FinancingMoneyFactSchema = z
  .object({
    amountMinor: NonNegativeMoneyMinorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    qualifier: z.enum(["exact", "approximately", "at_least", "up_to"]),
    evidenceText: z.string().trim().min(1).max(240),
  })
  .strict();

export const FinancingValuationFactSchema = FinancingMoneyFactSchema.extend({
  basis: z.enum(["pre_money", "post_money", "undisclosed"]),
}).strict();

export const FinancingAnnouncementFactsSchema = z
  .object({
    roundType: z
      .enum([
        "pre_seed",
        "seed",
        "series",
        "growth",
        "strategic",
        "undisclosed",
      ])
      .nullable(),
    roundLabel: z.string().trim().min(1).max(80).nullable(),
    instrument: z.enum([
      "equity",
      "debt",
      "convertible",
      "mixed",
      "undisclosed",
    ]),
    announcedAmount: FinancingMoneyFactSchema.nullable(),
    companyValuation: FinancingValuationFactSchema.nullable(),
    ambiguities: z
      .array(
        z.enum([
          "currency_not_explicit",
          "multiple_funding_amounts",
          "multiple_valuations",
          "combined_tranches",
          "prior_round_reference",
        ]),
      )
      .max(8),
  })
  .strict()
  .refine(
    (facts) =>
      (facts.roundType !== null && facts.roundType !== "undisclosed") ||
      facts.roundLabel !== null ||
      facts.instrument !== "undisclosed" ||
      facts.announcedAmount !== null ||
      facts.companyValuation !== null ||
      facts.ambiguities.length > 0,
    { message: "Financing facts must contain at least one meaningful term." },
  );

export const HttpsSourceUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.username === "" && url.password === ""
    );
  }, "Source URLs must use HTTPS without credentials.");

export const EvidenceInboxItemSchema = z.object({
  id: z.string().min(1),
  companyName: z.string().min(1),
  eventType: z.string().min(1),
  headline: z.string().min(1),
  detectedAt: IsoTimestampSchema,
  effectiveDate: IsoDateSchema,
  status: z.enum(["pending_review", "accepted", "rejected", "scenario_only"]),
  confidencePpm: ProbabilityPpmSchema,
  modelConfidencePpm: ProbabilityPpmSchema.nullable(),
  sources: z.array(z.string().min(1)).min(1),
  sourceUrl: HttpsSourceUrlSchema.nullable(),
  sourceExcerpt: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .refine((value) => value.split(/\s+/u).length <= 25, {
      message: "Source excerpts must contain at most 25 words.",
    })
    .nullable(),
  priorValue: z.string().min(1),
  replacementValue: z.string().min(1),
  forecastImpactMinor: MoneyMinorSchema,
  financingFacts: FinancingAnnouncementFactsSchema.nullable(),
  application: z
    .object({
      target: z.enum(["external_mark", "usable_liquidity"]),
      label: z.string().min(1),
      applied: z.boolean(),
    })
    .nullable(),
});

export const PublicSourceClassSchema = z.enum([
  "official_company",
  "regulatory_filing",
  "reputable_reporting",
  "secondary_source",
]);

export const PortfolioWatchCoverageStatusSchema = z.enum([
  "active",
  "discovering",
  "degraded",
  "unavailable",
]);

export const PortfolioWatchTargetSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  companyName: z.string().min(1),
  officialHost: z.string().min(1),
  status: z.enum(["active", "paused"]),
  coverageStatus: PortfolioWatchCoverageStatusSchema,
  lastCheckedAt: IsoTimestampSchema.nullable(),
  latestObservationAt: IsoTimestampSchema.nullable(),
});

export const PublicSourceObservationSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  companyName: z.string().min(1),
  evidenceEventId: z.string().min(1),
  evidenceStatus: z.enum([
    "pending_review",
    "accepted",
    "rejected",
    "scenario_only",
  ]),
  sourceClass: PublicSourceClassSchema,
  sourceUrl: HttpsSourceUrlSchema,
  sourceTitle: z.string().min(1),
  publishedAt: IsoTimestampSchema,
  retrievedAt: IsoTimestampSchema,
  observedFact: z.string().min(1),
  inference: z.string().min(1),
  sourceReliabilityPpm: ProbabilityPpmSchema,
  modelConfidencePpm: ProbabilityPpmSchema,
  valuationLowMinor: NonNegativeMoneyMinorSchema.nullable(),
  valuationMiddleMinor: NonNegativeMoneyMinorSchema.nullable(),
  valuationHighMinor: NonNegativeMoneyMinorSchema.nullable(),
  financingFacts: FinancingAnnouncementFactsSchema.nullable(),
  limitations: z.string().min(1),
});

export const SignalReportRelationshipSchema = z.enum([
  "corroborating",
  "conflicting",
  "superseded",
  "unconfirmed",
]);

export const SignalReconciliationStatusSchema = z.enum([
  "corroborated",
  "conflicting",
  "unconfirmed",
]);

export const SignalReconciliationReportSchema = z.object({
  observationId: z.string().min(1),
  evidenceEventId: z.string().min(1),
  sourceTitle: z.string().min(1),
  sourceUrl: HttpsSourceUrlSchema,
  sourceClass: PublicSourceClassSchema,
  publishedAt: IsoTimestampSchema,
  retrievedAt: IsoTimestampSchema,
  evidenceStatus: z.enum([
    "pending_review",
    "accepted",
    "rejected",
    "scenario_only",
  ]),
  sourceReliabilityPpm: ProbabilityPpmSchema,
  modelConfidencePpm: ProbabilityPpmSchema,
  relationship: SignalReportRelationshipSchema,
  reviewOrder: z.number().int().positive(),
  financingFacts: FinancingAnnouncementFactsSchema,
});

export const SignalReconciliationGroupSchema = z.object({
  id: z.string().min(1).max(240),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  companyId: z.string().min(1),
  companyName: z.string().min(1),
  roundKey: z.string().min(1).max(120),
  roundLabel: z.string().min(1).max(120),
  status: SignalReconciliationStatusSchema,
  reviewRank: z.number().int().positive(),
  reviewReason: z.string().min(1).max(240),
  pendingReviewCount: z.number().int().nonnegative(),
  recommendedReviewEventIds: z.array(z.string().min(1)),
  canCreateProposal: z.boolean(),
  proposedCompanyValuation: FinancingValuationFactSchema.nullable(),
  reports: z.array(SignalReconciliationReportSchema).min(1),
});

export const SignalReconciliationDraftSchema =
  SignalReconciliationGroupSchema.omit({ revision: true });

export const SignalUpdateProposalSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1).max(240),
  reconciliationRevision: z.string().regex(/^[a-f0-9]{64}$/),
  companyId: z.string().min(1),
  companyName: z.string().min(1),
  scenarioId: z.string().min(1),
  scenarioName: z.string().min(1),
  baseForecastSnapshotId: z.string().min(1),
  baseForecastSnapshotVersion: z.number().int().positive(),
  evidenceEventIds: z.array(z.string().min(1)).min(1),
  proposedCompanyValuation: FinancingValuationFactSchema,
  rationale: z.string().trim().min(3).max(500),
  createdAt: IsoTimestampSchema,
  createdBy: z.string().min(1),
  isCurrent: z.boolean(),
});

export const CreateSignalUpdateProposalInputSchema = z
  .object({
    groupId: z.string().min(1).max(240),
    reconciliationRevision: z.string().regex(/^[a-f0-9]{64}$/),
    scenarioId: z.string().min(1),
    baseForecastSnapshotId: z.string().min(1),
    rationale: z.string().trim().min(3).max(500),
  })
  .strict();

type FinancingFacts = z.infer<typeof FinancingAnnouncementFactsSchema>;
type FinancingValuationFactValue = z.infer<typeof FinancingValuationFactSchema>;
type PublicSourceObservationValue = z.infer<
  typeof PublicSourceObservationSchema
>;
type SignalReconciliationDraftValue = z.infer<
  typeof SignalReconciliationDraftSchema
>;

const blockingFinancingAmbiguities = new Set<
  FinancingFacts["ambiguities"][number]
>([
  "currency_not_explicit",
  "multiple_funding_amounts",
  "multiple_valuations",
  "combined_tranches",
  "prior_round_reference",
]);

function normalizeFinancingRound(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\b(financing|funding|round)\b/gu, " ")
    .trim()
    .replace(/\s+/gu, "-");
}

function financingRoundKey(facts: FinancingFacts): string {
  const label =
    facts.roundLabel === null ? "" : normalizeFinancingRound(facts.roundLabel);
  if (label.length > 0) {
    return label;
  }
  if (facts.roundType !== null && facts.roundType !== "undisclosed") {
    return facts.roundType.replaceAll("_", "-");
  }
  return "financing-round-not-specified";
}

function financingRoundLabel(facts: FinancingFacts): string {
  if (facts.roundLabel !== null) {
    return facts.roundLabel;
  }
  switch (facts.roundType) {
    case "pre_seed":
      return "Pre-seed";
    case "seed":
      return "Seed";
    case "series":
      return "Series financing";
    case "growth":
      return "Growth financing";
    case "strategic":
      return "Strategic financing";
    default:
      return "Financing round not specified";
  }
}

function moneyFactsConflict(
  left: FinancingValuationFactValue | FinancingFacts["announcedAmount"],
  right: FinancingValuationFactValue | FinancingFacts["announcedAmount"],
): boolean {
  if (left === null || right === null) {
    return false;
  }
  return (
    left.amountMinor !== right.amountMinor || left.currency !== right.currency
  );
}

function financingFactsConflict(
  left: FinancingFacts,
  right: FinancingFacts,
): boolean {
  const instrumentsConflict =
    left.instrument !== "undisclosed" &&
    right.instrument !== "undisclosed" &&
    left.instrument !== right.instrument;
  const roundTypesConflict =
    left.roundType !== null &&
    right.roundType !== null &&
    left.roundType !== "undisclosed" &&
    right.roundType !== "undisclosed" &&
    left.roundType !== right.roundType;
  const valuationBasisConflicts =
    left.companyValuation !== null &&
    right.companyValuation !== null &&
    left.companyValuation.basis !== "undisclosed" &&
    right.companyValuation.basis !== "undisclosed" &&
    left.companyValuation.basis !== right.companyValuation.basis;

  return (
    instrumentsConflict ||
    roundTypesConflict ||
    moneyFactsConflict(left.announcedAmount, right.announcedAmount) ||
    moneyFactsConflict(left.companyValuation, right.companyValuation) ||
    valuationBasisConflicts
  );
}

function hasPairwiseConflict(
  observations: PublicSourceObservationValue[],
): boolean {
  return observations.some((left, leftIndex) =>
    observations
      .slice(leftIndex + 1)
      .some((right) =>
        financingFactsConflict(
          left.financingFacts as FinancingFacts,
          right.financingFacts as FinancingFacts,
        ),
      ),
  );
}

function hasBlockingAmbiguity(facts: FinancingFacts): boolean {
  return facts.ambiguities.some((ambiguity) =>
    blockingFinancingAmbiguities.has(ambiguity),
  );
}

function compareObservationRecency(
  left: PublicSourceObservationValue,
  right: PublicSourceObservationValue,
): number {
  return (
    Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
    Date.parse(right.retrievedAt) - Date.parse(left.retrievedAt) ||
    right.id.localeCompare(left.id)
  );
}

function compareObservationPriority(
  left: PublicSourceObservationValue,
  right: PublicSourceObservationValue,
): number {
  if (left.sourceReliabilityPpm !== right.sourceReliabilityPpm) {
    return right.sourceReliabilityPpm - left.sourceReliabilityPpm;
  }
  return compareObservationRecency(left, right);
}

function sameValuation(
  left: FinancingValuationFactValue,
  right: FinancingValuationFactValue,
): boolean {
  return (
    left.amountMinor === right.amountMinor &&
    left.currency === right.currency &&
    (left.basis === right.basis ||
      left.basis === "undisclosed" ||
      right.basis === "undisclosed")
  );
}

function proposedValuation(
  observations: PublicSourceObservationValue[],
): FinancingValuationFactValue | null {
  const candidates = observations
    .filter(
      (observation) =>
        observation.financingFacts !== null &&
        !hasBlockingAmbiguity(observation.financingFacts) &&
        observation.financingFacts.companyValuation !== null,
    )
    .sort(compareObservationPriority);
  const first = candidates[0]?.financingFacts?.companyValuation ?? null;
  if (first === null) {
    return null;
  }
  return candidates.every((candidate) => {
    const valuation = candidate.financingFacts?.companyValuation;
    return valuation === null || valuation === undefined
      ? true
      : sameValuation(first, valuation);
  })
    ? first
    : null;
}

function reviewReason(
  status: z.infer<typeof SignalReconciliationStatusSchema>,
): string {
  switch (status) {
    case "conflicting":
      return "Resolve the differing terms before drafting an update.";
    case "corroborated":
      return "Review the matching reports together, strongest source first.";
    case "unconfirmed":
      return "Confirm the current report before drafting an update.";
  }
}

export function signalReconciliationRevisionMaterial(
  group: SignalReconciliationDraftValue,
): string {
  return JSON.stringify({
    id: group.id,
    reports: [...group.reports]
      .sort((left, right) =>
        left.evidenceEventId.localeCompare(right.evidenceEventId),
      )
      .map((report) => ({
        evidenceEventId: report.evidenceEventId,
        evidenceStatus: report.evidenceStatus,
        publishedAt: report.publishedAt,
        retrievedAt: report.retrievedAt,
        sourceUrl: report.sourceUrl,
        financingFacts: report.financingFacts,
      })),
  });
}

export function reconcileFinancingSignals(
  rawObservations: readonly PublicSourceObservationValue[],
): SignalReconciliationDraftValue[] {
  const observations = z
    .array(PublicSourceObservationSchema)
    .parse(rawObservations)
    .filter((observation) => observation.financingFacts !== null);
  const grouped = new Map<string, PublicSourceObservationValue[]>();

  observations.forEach((observation) => {
    const facts = observation.financingFacts as FinancingFacts;
    const roundKey = financingRoundKey(facts);
    const groupId = `${observation.companyId}:${roundKey}`;
    grouped.set(groupId, [...(grouped.get(groupId) ?? []), observation]);
  });

  const drafts = [...grouped.entries()].map(([groupId, groupObservations]) => {
    const newestByUrl = new Map<string, PublicSourceObservationValue>();
    groupObservations.forEach((observation) => {
      const current = newestByUrl.get(observation.sourceUrl);
      if (
        current === undefined ||
        compareObservationRecency(observation, current) < 0
      ) {
        newestByUrl.set(observation.sourceUrl, observation);
      }
    });
    const supersededIds = new Set(
      groupObservations
        .filter(
          (observation) =>
            newestByUrl.get(observation.sourceUrl)?.id !== observation.id,
        )
        .map((observation) => observation.id),
    );
    const active = groupObservations.filter(
      (observation) => !supersededIds.has(observation.id),
    );
    const participating = active.filter(
      (observation) => observation.evidenceStatus !== "rejected",
    );
    const conflicting = hasPairwiseConflict(participating);
    const corroborated =
      participating.length > 1 &&
      !conflicting &&
      participating.every(
        (observation) =>
          observation.financingFacts !== null &&
          !hasBlockingAmbiguity(observation.financingFacts),
      );
    const status = conflicting
      ? ("conflicting" as const)
      : corroborated
        ? ("corroborated" as const)
        : ("unconfirmed" as const);
    const activeConflicts = new Set(
      active
        .filter((observation) =>
          participating.some(
            (candidate) =>
              candidate.id !== observation.id &&
              financingFactsConflict(
                observation.financingFacts as FinancingFacts,
                candidate.financingFacts as FinancingFacts,
              ),
          ),
        )
        .map((observation) => observation.id),
    );
    const relationshipFor = (
      observation: PublicSourceObservationValue,
    ): z.infer<typeof SignalReportRelationshipSchema> => {
      if (supersededIds.has(observation.id)) {
        return "superseded";
      }
      if (status === "conflicting" || activeConflicts.has(observation.id)) {
        return "conflicting";
      }
      return status === "corroborated" ? "corroborating" : "unconfirmed";
    };
    const ordered = [...groupObservations].sort((left, right) => {
      const leftRelationship = relationshipFor(left);
      const rightRelationship = relationshipFor(right);
      const relationshipPriority = {
        conflicting: 0,
        corroborating: 1,
        unconfirmed: 1,
        superseded: 2,
      } as const;
      if (
        relationshipPriority[leftRelationship] !==
        relationshipPriority[rightRelationship]
      ) {
        return (
          relationshipPriority[leftRelationship] -
          relationshipPriority[rightRelationship]
        );
      }
      const leftPending = left.evidenceStatus === "pending_review" ? 0 : 1;
      const rightPending = right.evidenceStatus === "pending_review" ? 0 : 1;
      return (
        leftPending - rightPending || compareObservationPriority(left, right)
      );
    });
    const reports = ordered.map((observation, index) => ({
      observationId: observation.id,
      evidenceEventId: observation.evidenceEventId,
      sourceTitle: observation.sourceTitle,
      sourceUrl: observation.sourceUrl,
      sourceClass: observation.sourceClass,
      publishedAt: observation.publishedAt,
      retrievedAt: observation.retrievedAt,
      evidenceStatus: observation.evidenceStatus,
      sourceReliabilityPpm: observation.sourceReliabilityPpm,
      modelConfidencePpm: observation.modelConfidencePpm,
      relationship: relationshipFor(observation),
      reviewOrder: index + 1,
      financingFacts: observation.financingFacts as FinancingFacts,
    }));
    const pendingReviewCount = active.filter(
      (observation) => observation.evidenceStatus === "pending_review",
    ).length;
    const valuation = proposedValuation(participating);
    const canCreateProposal =
      participating.length > 0 &&
      pendingReviewCount === 0 &&
      !conflicting &&
      participating.some(
        (observation) =>
          observation.evidenceStatus === "accepted" ||
          observation.evidenceStatus === "scenario_only",
      ) &&
      participating.every(
        (observation) =>
          observation.financingFacts !== null &&
          !hasBlockingAmbiguity(observation.financingFacts),
      ) &&
      valuation !== null;
    const canonicalObservation =
      [...active].sort(compareObservationPriority)[0] ??
      [...groupObservations].sort(compareObservationPriority)[0];
    const canonicalFacts =
      canonicalObservation?.financingFacts as FinancingFacts;

    return SignalReconciliationDraftSchema.parse({
      id: groupId,
      companyId: canonicalObservation?.companyId,
      companyName: canonicalObservation?.companyName,
      roundKey: financingRoundKey(canonicalFacts),
      roundLabel: financingRoundLabel(canonicalFacts),
      status,
      reviewRank: 1,
      reviewReason: reviewReason(status),
      pendingReviewCount,
      recommendedReviewEventIds: reports
        .filter(
          (report) =>
            report.evidenceStatus === "pending_review" &&
            report.relationship !== "superseded",
        )
        .map((report) => report.evidenceEventId),
      canCreateProposal,
      proposedCompanyValuation: valuation,
      reports,
    });
  });

  const statusPriority = {
    conflicting: 0,
    corroborated: 1,
    unconfirmed: 2,
  } as const;
  return drafts
    .sort((left, right) => {
      const leftReviewed = left.pendingReviewCount === 0 ? 1 : 0;
      const rightReviewed = right.pendingReviewCount === 0 ? 1 : 0;
      return (
        leftReviewed - rightReviewed ||
        statusPriority[left.status] - statusPriority[right.status] ||
        Math.max(
          ...right.reports.map((report) => report.sourceReliabilityPpm),
        ) -
          Math.max(
            ...left.reports.map((report) => report.sourceReliabilityPpm),
          ) ||
        left.id.localeCompare(right.id)
      );
    })
    .map((group, index) => ({ ...group, reviewRank: index + 1 }));
}

export const PortfolioWatchSchema = z.object({
  targets: z.array(PortfolioWatchTargetSchema),
  observations: z.array(PublicSourceObservationSchema),
});

export const PortfolioWatchScanResultSchema = z.object({
  checkedAt: IsoTimestampSchema,
  queuedCount: z.number().int().nonnegative(),
  discoveredCount: z.number().int().nonnegative(),
  proposedCount: z.number().int().nonnegative(),
});

export const ScenarioAssumptionSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().int().safe(),
  unit: z.enum(["ppm", "months", "minor_units"]),
  provenance: z.string().min(1),
});

export const LiquidityPointSchema = z.object({
  year: z.number().int(),
  p25Minor: NonNegativeMoneyMinorSchema,
  p50Minor: NonNegativeMoneyMinorSchema,
  p75Minor: NonNegativeMoneyMinorSchema,
  expectedMinor: NonNegativeMoneyMinorSchema,
  probabilityZeroPpm: ProbabilityPpmSchema,
});

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  isSandbox: z.boolean(),
  latestSnapshotId: z.string().min(1).nullable().default(null),
  latestSnapshotVersion: z.number().int().positive().nullable().default(null),
  conditionalValueMinor: NonNegativeMoneyMinorSchema,
  timingAdjustedLiquidityMinor: NonNegativeMoneyMinorSchema,
  assumptions: z.array(ScenarioAssumptionSchema),
  liquidityCurve: z.array(LiquidityPointSchema).min(1),
});

export const ScenarioDraftAssumptionSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  value: z.number().int().safe().nonnegative(),
});

export const ScenarioDraftInputSchema = z.object({
  scenarioId: z.string().min(1),
  assumptions: z.array(ScenarioDraftAssumptionSchema).min(1),
  changeNote: z.string().trim().min(1).max(500),
});

export const ScenarioProjectionSchema = z.object({
  conditionalValueMinor: NonNegativeMoneyMinorSchema,
  timingAdjustedLiquidityMinor: NonNegativeMoneyMinorSchema,
  liquidityScalePpm: z.number().int().safe().nonnegative(),
  liquidityCurve: z.array(LiquidityPointSchema).min(1),
});

function multiplyIntegerByPpm(value: number, ppm: number): number {
  z.number().int().safe().nonnegative().parse(value);
  z.number().int().safe().nonnegative().parse(ppm);
  const result = (BigInt(value) * BigInt(ppm)) / BigInt(PARTS_PER_MILLION);
  return z.number().int().safe().nonnegative().parse(Number(result));
}

function delayWindowPpm(delayMonths: number): number {
  const boundedDelay = Math.min(Math.max(delayMonths, 0), 60);
  return Math.floor(((60 - boundedDelay) * PARTS_PER_MILLION) / 60);
}

export function scenarioLiquidityFactorPpm(
  probabilityPpm: number,
  delayMonths: number,
): number {
  ProbabilityPpmSchema.parse(probabilityPpm);
  z.number().int().safe().nonnegative().parse(delayMonths);
  return multiplyIntegerByPpm(probabilityPpm, delayWindowPpm(delayMonths));
}

export function scenarioSensitivityScalePpm(
  baseProbabilityPpm: number,
  baseDelayMonths: number,
  draftProbabilityPpm: number,
  draftDelayMonths: number,
): number {
  ProbabilityPpmSchema.parse(baseProbabilityPpm);
  ProbabilityPpmSchema.parse(draftProbabilityPpm);
  z.number().int().safe().nonnegative().parse(baseDelayMonths);
  z.number().int().safe().nonnegative().parse(draftDelayMonths);

  const baseFactor = scenarioLiquidityFactorPpm(
    baseProbabilityPpm,
    baseDelayMonths,
  );
  const draftFactor = scenarioLiquidityFactorPpm(
    draftProbabilityPpm,
    draftDelayMonths,
  );

  if (baseFactor === 0) {
    return draftFactor === 0 ? PARTS_PER_MILLION : draftFactor;
  }

  const scale = Number(
    (BigInt(draftFactor) * BigInt(PARTS_PER_MILLION)) / BigInt(baseFactor),
  );
  return Math.min(scale, 10 * PARTS_PER_MILLION);
}

export function multiplyMinorByScalePpm(
  minorUnits: number,
  scalePpm: number,
): number {
  NonNegativeMoneyMinorSchema.parse(minorUnits);
  z.number().int().safe().nonnegative().parse(scalePpm);
  const result =
    (BigInt(minorUnits) * BigInt(scalePpm)) / BigInt(PARTS_PER_MILLION);
  return NonNegativeMoneyMinorSchema.parse(Number(result));
}

export function projectScenarioValue(
  conditionalValueMinor: number,
  timingAdjustedLiquidityMinor: number,
  baseFactorPpm: number,
  draftFactorPpm: number,
  scalePpm: number,
): number {
  NonNegativeMoneyMinorSchema.parse(conditionalValueMinor);
  NonNegativeMoneyMinorSchema.parse(timingAdjustedLiquidityMinor);
  z.number().int().safe().nonnegative().parse(baseFactorPpm);
  z.number().int().safe().nonnegative().parse(draftFactorPpm);
  z.number().int().safe().nonnegative().parse(scalePpm);

  if (baseFactorPpm === 0 && draftFactorPpm > 0) {
    return multiplyMinorByPpm(conditionalValueMinor, draftFactorPpm);
  }
  return multiplyMinorByScalePpm(timingAdjustedLiquidityMinor, scalePpm);
}

export function projectScenarioProbabilityPpm(
  probabilityPpm: number,
  scalePpm: number,
): number {
  ProbabilityPpmSchema.parse(probabilityPpm);
  z.number().int().safe().nonnegative().parse(scalePpm);
  return Math.min(
    PARTS_PER_MILLION,
    multiplyIntegerByPpm(probabilityPpm, scalePpm),
  );
}

export function projectScenarioZeroProbabilityPpm(
  probabilityZeroPpm: number,
  scalePpm: number,
): number {
  ProbabilityPpmSchema.parse(probabilityZeroPpm);
  return (
    PARTS_PER_MILLION -
    projectScenarioProbabilityPpm(
      PARTS_PER_MILLION - probabilityZeroPpm,
      scalePpm,
    )
  );
}

export function projectScenario(
  rawBase: z.input<typeof ScenarioSchema>,
  rawInput: z.input<typeof ScenarioDraftInputSchema>,
): z.infer<typeof ScenarioProjectionSchema> {
  const base = ScenarioSchema.parse(rawBase);
  const input = ScenarioDraftInputSchema.parse(rawInput);
  if (base.id !== input.scenarioId) {
    throw new Error("Scenario draft does not match the selected scenario.");
  }

  const draftById = new Map(
    input.assumptions.map((assumption) => [assumption.id, assumption.value]),
  );
  const draftByKey = new Map(
    input.assumptions.map((assumption) => [assumption.key, assumption.value]),
  );
  const assumptions = base.assumptions.map((assumption) => ({
    ...assumption,
    value:
      draftById.get(assumption.id) ??
      draftByKey.get(assumption.key) ??
      assumption.value,
  }));
  const probability = assumptions.find(
    (assumption) => assumption.key === "liquidity_probability",
  );
  const delay = assumptions.find(
    (assumption) => assumption.key === "timing_delay_months",
  );
  const baseProbability = base.assumptions.find(
    (assumption) => assumption.key === "liquidity_probability",
  );
  const baseDelay = base.assumptions.find(
    (assumption) => assumption.key === "timing_delay_months",
  );

  if (
    probability === undefined ||
    delay === undefined ||
    baseProbability === undefined ||
    baseDelay === undefined
  ) {
    throw new Error(
      "Scenario requires liquidity probability and timing delay assumptions.",
    );
  }

  const scalePpm = scenarioSensitivityScalePpm(
    baseProbability.value,
    baseDelay.value,
    probability.value,
    delay.value,
  );
  const baseFactorPpm = scenarioLiquidityFactorPpm(
    baseProbability.value,
    baseDelay.value,
  );
  const draftFactorPpm = scenarioLiquidityFactorPpm(
    probability.value,
    delay.value,
  );

  return ScenarioProjectionSchema.parse({
    conditionalValueMinor: base.conditionalValueMinor,
    timingAdjustedLiquidityMinor: projectScenarioValue(
      base.conditionalValueMinor,
      base.timingAdjustedLiquidityMinor,
      baseFactorPpm,
      draftFactorPpm,
      scalePpm,
    ),
    liquidityScalePpm: scalePpm,
    liquidityCurve: base.liquidityCurve.map((point) => ({
      ...point,
      p25Minor: multiplyMinorByScalePpm(point.p25Minor, scalePpm),
      p50Minor: multiplyMinorByScalePpm(point.p50Minor, scalePpm),
      p75Minor: multiplyMinorByScalePpm(point.p75Minor, scalePpm),
      expectedMinor: multiplyMinorByScalePpm(point.expectedMinor, scalePpm),
      probabilityZeroPpm: projectScenarioZeroProbabilityPpm(
        point.probabilityZeroPpm,
        scalePpm,
      ),
    })),
  });
}

export const ForecastHistoryItemSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  scenarioName: z.string().min(1),
  createdAt: IsoTimestampSchema,
  createdBy: z.string().min(1),
  trigger: z.string().min(1),
  attributedChange: z.string().min(1),
  priorP50Minor: NonNegativeMoneyMinorSchema.nullable(),
  p50Minor: NonNegativeMoneyMinorSchema,
});

export const AlphaDataSchema = z.object({
  dashboard: DashboardSchema,
  goals: z.array(GoalSchema).min(1),
  holdings: z.array(HoldingSchema),
  evidenceInbox: z.array(EvidenceInboxItemSchema),
  portfolioWatch: PortfolioWatchSchema,
  signalReconciliations: z.array(SignalReconciliationGroupSchema),
  signalUpdateProposals: z.array(SignalUpdateProposalSchema),
  scenarios: z.array(ScenarioSchema),
  forecastHistory: z.array(ForecastHistoryItemSchema),
});

export type AlphaData = z.infer<typeof AlphaDataSchema>;
export type AcceptedCashAccount = z.infer<typeof AcceptedCashAccountSchema>;
export type AcceptedLiability = z.infer<typeof AcceptedLiabilitySchema>;
export type CashAccountApplyInput = z.infer<typeof CashAccountApplyInputSchema>;
export type CashAccountApplyResult = z.infer<
  typeof CashAccountApplyResultSchema
>;
export type CashAccountConnection = z.infer<typeof CashAccountConnectionSchema>;
export type CashAccountIdentityCandidate = z.infer<
  typeof CashAccountIdentityCandidateSchema
>;
export type CashAccountIdentityDecision = z.infer<
  typeof CashAccountIdentityDecisionSchema
>;
export type CashAccountIdentityReviewInput = z.infer<
  typeof CashAccountIdentityReviewInputSchema
>;
export type CashAccountExchangeInput = z.infer<
  typeof CashAccountExchangeInputSchema
>;
export type CashAccountLinkToken = z.infer<typeof CashAccountLinkTokenSchema>;
export type CashAccountProposalRow = z.infer<
  typeof CashAccountProposalRowSchema
>;
export type CashAccountsErrorCode = z.infer<typeof CashAccountsErrorCodeSchema>;
export type CashAccountsState = z.infer<typeof CashAccountsStateSchema>;
export type CashAccountSubtype = z.infer<typeof CashAccountSubtypeSchema>;
export type CashAccountValueState = z.infer<typeof CashAccountValueStateSchema>;
export type CashBalanceProposal = z.infer<typeof CashBalanceProposalSchema>;
export type CashBalanceSource = z.infer<typeof CashBalanceSourceSchema>;
export type CashFlowCategory = z.infer<typeof CashFlowCategorySchema>;
export type CashFlowComparison = z.infer<typeof CashFlowComparisonSchema>;
export type CashFlowConnection = z.infer<typeof CashFlowConnectionSchema>;
export type CashFlowErrorCode = z.infer<typeof CashFlowErrorCodeSchema>;
export type CashFlowMonth = z.infer<typeof CashFlowMonthSchema>;
export type CashFlowPlanSuggestion = z.infer<
  typeof CashFlowPlanSuggestionSchema
>;
export type CashFlowPlanningContext = z.infer<
  typeof CashFlowPlanningContextSchema
>;
export type CashFlowProposal = z.infer<typeof CashFlowProposalSchema>;
export type CashFlowProposalCategory = z.infer<
  typeof CashFlowProposalCategorySchema
>;
export type CashFlowReviewInput = z.infer<typeof CashFlowReviewInputSchema>;
export type CashFlowReviewResult = z.infer<typeof CashFlowReviewResultSchema>;
export type CashFlowState = z.infer<typeof CashFlowStateSchema>;
export type CashFlowSyncInput = z.infer<typeof CashFlowSyncInputSchema>;
export type CashFlowTreatment = z.infer<typeof CashFlowTreatmentSchema>;
export type CreateSignalUpdateProposalInput = z.infer<
  typeof CreateSignalUpdateProposalInputSchema
>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type EvidenceInboxItem = z.infer<typeof EvidenceInboxItemSchema>;
export type FinancingAnnouncementFacts = z.infer<
  typeof FinancingAnnouncementFactsSchema
>;
export type FinancingMoneyFact = z.infer<typeof FinancingMoneyFactSchema>;
export type FinancingValuationFact = z.infer<
  typeof FinancingValuationFactSchema
>;
export type Goal = z.infer<typeof GoalSchema>;
export type GoalDraftInput = z.infer<typeof GoalDraftInputSchema>;
export type GoalPreview = z.infer<typeof GoalPreviewSchema>;
export type Holding = z.infer<typeof HoldingSchema>;
export type CanonicalExposure = z.infer<typeof CanonicalExposureSchema>;
export type HoldingImportCanonicalScope = z.infer<
  typeof HoldingImportCanonicalScopeSchema
>;
export type HoldingImportConnectionScope = z.infer<
  typeof HoldingImportConnectionScopeSchema
>;
export type HoldingImportContainerScope = z.infer<
  typeof HoldingImportContainerScopeSchema
>;
export type HoldingImportCoverage = z.infer<typeof HoldingImportCoverageSchema>;
export type HoldingImportRowScope = z.infer<typeof HoldingImportRowScopeSchema>;
export type InvestmentConnection = z.infer<typeof InvestmentConnectionSchema>;
export type OwnedPositionIdentity = z.infer<typeof OwnedPositionIdentitySchema>;
export type OwnedPositionSnapshot = z.infer<typeof OwnedPositionSnapshotSchema>;
export type OwnershipContainer = z.infer<typeof OwnershipContainerSchema>;
export type PositionExposureMapping = z.infer<
  typeof PositionExposureMappingSchema
>;
export type PrivateExposureCompany = z.infer<
  typeof PrivateExposureCompanySchema
>;
export type PrivateExposureExactBatchInput = z.infer<
  typeof PrivateExposureExactBatchInputSchema
>;
export type PrivateExposureExactBatchPreview = z.infer<
  typeof PrivateExposureExactBatchPreviewSchema
>;
export type PrivateExposureExactBatchResult = z.infer<
  typeof PrivateExposureExactBatchResultSchema
>;
export type PrivateExposureReviewPosition = z.infer<
  typeof PrivateExposureReviewPositionSchema
>;
export type PrivateExposureReviewState = z.infer<
  typeof PrivateExposureReviewStateSchema
>;
export type PrivateExposureResolutionInput = z.infer<
  typeof PrivateExposureResolutionInputSchema
>;
export type PrivateExposureResolutionResult = z.infer<
  typeof PrivateExposureResolutionResultSchema
>;
export type ScaledQuantity = z.infer<typeof ScaledQuantitySchema>;
export type HoldingImportApplyInput = z.infer<
  typeof HoldingImportApplyInputSchema
>;
export type HoldingImportApplyResult = z.infer<
  typeof HoldingImportApplyResultSchema
>;
export type HoldingImportPreview = z.infer<typeof HoldingImportPreviewSchema>;
export type HoldingImportSummary = z.infer<typeof HoldingImportSummarySchema>;
export type LiabilitiesErrorCode = z.infer<typeof LiabilitiesErrorCodeSchema>;
export type LiabilitiesState = z.infer<typeof LiabilitiesStateSchema>;
export type LiabilityApplyInput = z.infer<typeof LiabilityApplyInputSchema>;
export type LiabilityApplyResult = z.infer<typeof LiabilityApplyResultSchema>;
export type LiabilityClassification = z.infer<
  typeof LiabilityClassificationSchema
>;
export type LiabilityConnection = z.infer<typeof LiabilityConnectionSchema>;
export type LiabilityExchangeInput = z.infer<
  typeof LiabilityExchangeInputSchema
>;
export type LiabilityImpact = z.infer<typeof LiabilityImpactSchema>;
export type LiabilityKind = z.infer<typeof LiabilityKindSchema>;
export type LiabilityLinkToken = z.infer<typeof LiabilityLinkTokenSchema>;
export type LiabilityPaymentTreatment = z.infer<
  typeof LiabilityPaymentTreatmentSchema
>;
export type LiabilityProposal = z.infer<typeof LiabilityProposalSchema>;
export type LiabilityProposalRow = z.infer<typeof LiabilityProposalRowSchema>;
export type LiabilitySource = z.infer<typeof LiabilitySourceSchema>;
export type LiabilityValueState = z.infer<typeof LiabilityValueStateSchema>;
export type ManualLiabilityInput = z.infer<typeof ManualLiabilityInputSchema>;
export type InvestmentAdjudicationSummary = z.infer<
  typeof InvestmentAdjudicationSummarySchema
>;
export type PortfolioBaselineConfirmInput = z.infer<
  typeof PortfolioBaselineConfirmInputSchema
>;
export type PortfolioBaselineConfirmResult = z.infer<
  typeof PortfolioBaselineConfirmResultSchema
>;
export type PortfolioBaselineCashAccount = z.infer<
  typeof PortfolioBaselineCashAccountSchema
>;
export type PortfolioBaselineImpact = z.infer<
  typeof PortfolioBaselineImpactSchema
>;
export type PortfolioBaselinePosition = z.infer<
  typeof PortfolioBaselinePositionSchema
>;
export type PortfolioBaselineRecord = z.infer<
  typeof PortfolioBaselineRecordSchema
>;
export type PortfolioBaselineState = z.infer<
  typeof PortfolioBaselineStateSchema
>;
export type PortfolioBaselineSummary = z.infer<
  typeof PortfolioBaselineSummarySchema
>;
export type PlanInputImpact = z.infer<typeof PlanInputImpactSchema>;
export type PlanInputSave = z.infer<typeof PlanInputSaveSchema>;
export type PlanInputSaveResult = z.infer<typeof PlanInputSaveResultSchema>;
export type PlanInputState = z.infer<typeof PlanInputStateSchema>;
export type PlanInputValues = z.infer<typeof PlanInputValuesSchema>;
export type InvestmentExchangeInput = z.infer<
  typeof InvestmentExchangeInputSchema
>;
export type InvestmentLinkToken = z.infer<typeof InvestmentLinkTokenSchema>;
export type InvestmentSyncErrorCode = z.infer<
  typeof InvestmentSyncErrorCodeSchema
>;
export type InvestmentConnectionStatus = z.infer<
  typeof InvestmentConnectionStatusSchema
>;
export type InvestmentConnectionLifecycleActionInput = z.infer<
  typeof InvestmentConnectionLifecycleActionInputSchema
>;
export type InvestmentConnectionsState = z.infer<
  typeof InvestmentConnectionsStateSchema
>;
export type AngelListBrowserStorageState = z.infer<
  typeof AngelListBrowserStorageStateSchema
>;
export type AngelListAutomationErrorCode = z.infer<
  typeof AngelListAutomationErrorCodeSchema
>;
export type AngelListAutomationStatus = z.infer<
  typeof AngelListAutomationStatusSchema
>;
export type AngelListAutomationOverview = z.infer<
  typeof AngelListAutomationOverviewSchema
>;
export type AngelListMacAgentConfigInput = z.infer<
  typeof AngelListMacAgentConfigInputSchema
>;
export type AngelListMacAgentErrorCode = z.infer<
  typeof AngelListMacAgentErrorCodeSchema
>;
export type AngelListMacAgentFailureInput = z.infer<
  typeof AngelListMacAgentFailureInputSchema
>;
export type AngelListMacAgentInterval = z.infer<
  typeof AngelListMacAgentIntervalSchema
>;
export type AngelListMacAgentLease = z.infer<
  typeof AngelListMacAgentLeaseSchema
>;
export type AngelListMacAgentOverview = z.infer<
  typeof AngelListMacAgentOverviewSchema
>;
export type AngelListMacAgentRunRequest = z.infer<
  typeof AngelListMacAgentRunRequestSchema
>;
export type MacAgentApiOrigin = z.infer<typeof MacAgentApiOriginSchema>;
export type MacAgentAuthorization = z.infer<typeof MacAgentAuthorizationSchema>;
export type MacAgentTarget = z.infer<typeof MacAgentTargetSchema>;
export type MacAgentToken = z.infer<typeof MacAgentTokenSchema>;
export type ProviderPortfolioAgentConfigInput = z.infer<
  typeof ProviderPortfolioAgentConfigInputSchema
>;
export type ProviderPortfolioAgentErrorCode = z.infer<
  typeof ProviderPortfolioAgentErrorCodeSchema
>;
export type ProviderPortfolioAgentFailureInput = z.infer<
  typeof ProviderPortfolioAgentFailureInputSchema
>;
export type ProviderPortfolioAgentLease = z.infer<
  typeof ProviderPortfolioAgentLeaseSchema
>;
export type ProviderPortfolioAgentOverview = z.infer<
  typeof ProviderPortfolioAgentOverviewSchema
>;
export type ProviderPortfolioAgentProvider = z.infer<
  typeof ProviderPortfolioAgentProviderSchema
>;
export type ProviderPortfolioAgentRunRequest = z.infer<
  typeof ProviderPortfolioAgentRunRequestSchema
>;
export type AngelListSignInRefresh = z.infer<
  typeof AngelListSignInRefreshSchema
>;
export type HoldingImportRowPreview = z.infer<
  typeof HoldingImportRowPreviewSchema
>;
export type PortfolioWatchScanResult = z.infer<
  typeof PortfolioWatchScanResultSchema
>;
export type PublicSourceObservation = z.infer<
  typeof PublicSourceObservationSchema
>;
export type SignalReconciliationDraft = z.infer<
  typeof SignalReconciliationDraftSchema
>;
export type SignalReconciliationGroup = z.infer<
  typeof SignalReconciliationGroupSchema
>;
export type SignalUpdateProposal = z.infer<typeof SignalUpdateProposalSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioDraftInput = z.infer<typeof ScenarioDraftInputSchema>;
export type ScenarioProjection = z.infer<typeof ScenarioProjectionSchema>;
