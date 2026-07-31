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
  companyName: z.string().min(1),
  accountName: z.string().min(1),
  lotLabel: z.string().min(1),
  administratorNavMinor: NonNegativeMoneyMinorSchema,
  externalMarkMinor: NonNegativeMoneyMinorSchema,
  underwritingValueMinor: NonNegativeMoneyMinorSchema,
  scenarioValueMinor: NonNegativeMoneyMinorSchema,
  usableLiquidityMinor: NonNegativeMoneyMinorSchema,
  sourceStatus: z.enum(["verified", "review_due", "proposed"]),
  sourceLabel: z.string().min(1),
  effectiveDate: IsoDateSchema,
  retrievedAt: IsoTimestampSchema,
  confidencePpm: ProbabilityPpmSchema,
});

export const EvidenceInboxItemSchema = z.object({
  id: z.string().min(1),
  companyName: z.string().min(1),
  eventType: z.string().min(1),
  headline: z.string().min(1),
  detectedAt: IsoTimestampSchema,
  effectiveDate: IsoDateSchema,
  status: z.enum(["pending_review", "accepted", "rejected", "scenario_only"]),
  confidencePpm: ProbabilityPpmSchema,
  sources: z.array(z.string().min(1)).min(1),
  priorValue: z.string().min(1),
  replacementValue: z.string().min(1),
  forecastImpactMinor: MoneyMinorSchema,
});

export const ScenarioAssumptionSchema = z.object({
  id: z.string().min(1),
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
  scenarios: z.array(ScenarioSchema),
  forecastHistory: z.array(ForecastHistoryItemSchema),
});

export type AlphaData = z.infer<typeof AlphaDataSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type EvidenceInboxItem = z.infer<typeof EvidenceInboxItemSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type GoalDraftInput = z.infer<typeof GoalDraftInputSchema>;
export type GoalPreview = z.infer<typeof GoalPreviewSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
