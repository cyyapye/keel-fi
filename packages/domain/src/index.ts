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
  householdName: z.string().min(1),
  fiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
  protectedRunwayMonths: z.number().int().nonnegative(),
  householdBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  businessBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
  fiTargetMinor: NonNegativeMoneyMinorSchema,
  fiGapMinor: NonNegativeMoneyMinorSchema,
  p25FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  p50FiveYearLiquidityMinor: NonNegativeMoneyMinorSchema,
  probabilityCrossingFiPpm: ProbabilityPpmSchema,
});

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
  holdings: z.array(HoldingSchema),
  evidenceInbox: z.array(EvidenceInboxItemSchema),
  scenarios: z.array(ScenarioSchema),
  forecastHistory: z.array(ForecastHistoryItemSchema),
});

export type AlphaData = z.infer<typeof AlphaDataSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type EvidenceInboxItem = z.infer<typeof EvidenceInboxItemSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
