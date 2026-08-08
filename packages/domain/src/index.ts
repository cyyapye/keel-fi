import { z } from "zod";

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
});

export const HoldingImportRowActionSchema = z.enum([
  "create_position",
  "append_snapshot",
  "no_change",
  "needs_attention",
]);

export const HoldingImportRowPreviewSchema = z.object({
  id: z.string().min(1),
  sourceRowNumber: z.number().int().min(3),
  positionName: z.string().min(1),
  exposureName: z.string().min(1),
  ownerLabel: z.string().min(1),
  providerStatus: z.enum(["Live", "Realized"]),
  investedOn: IsoDateSchema,
  investedMinor: NonNegativeMoneyMinorSchema,
  administratorNavMinor: NonNegativeMoneyMinorSchema.nullable(),
  administratorNavState: z.enum(["reported", "locked", "not_reported"]),
  realizedValueMinor: NonNegativeMoneyMinorSchema,
  action: HoldingImportRowActionSchema,
  issues: z.array(z.string().min(1)),
});

export const HoldingImportPreviewSchema = z.object({
  id: z.string().min(1),
  provider: z.literal("angellist"),
  status: z.enum(["pending_review", "applied"]),
  observedAt: IsoTimestampSchema,
  summary: z.object({
    rowCount: z.number().int().nonnegative(),
    administratorValueCount: z.number().int().nonnegative(),
    lockedValueCount: z.number().int().nonnegative(),
    createCount: z.number().int().nonnegative(),
    updateCount: z.number().int().nonnegative(),
    unchangedCount: z.number().int().nonnegative(),
    needsAttentionCount: z.number().int().nonnegative(),
  }),
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
  scenarios: z.array(ScenarioSchema),
  forecastHistory: z.array(ForecastHistoryItemSchema),
});

export type AlphaData = z.infer<typeof AlphaDataSchema>;
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
export type HoldingImportApplyInput = z.infer<
  typeof HoldingImportApplyInputSchema
>;
export type HoldingImportApplyResult = z.infer<
  typeof HoldingImportApplyResultSchema
>;
export type HoldingImportPreview = z.infer<typeof HoldingImportPreviewSchema>;
export type HoldingImportRowPreview = z.infer<
  typeof HoldingImportRowPreviewSchema
>;
export type PortfolioWatchScanResult = z.infer<
  typeof PortfolioWatchScanResultSchema
>;
export type PublicSourceObservation = z.infer<
  typeof PublicSourceObservationSchema
>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioDraftInput = z.infer<typeof ScenarioDraftInputSchema>;
export type ScenarioProjection = z.infer<typeof ScenarioProjectionSchema>;
