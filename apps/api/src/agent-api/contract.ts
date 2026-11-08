import { z } from "zod";

const id = z.string().min(1).max(256);
export const integer = z.int();
const amount = integer.nonnegative();
const date = z.iso.date();
const text = z.string();
export const pageQuery = z.strictObject({
  afterGoal: z
    .string()
    .regex(/^[1-9]\d{0,14}$/)
    .optional(),
});
export const marksQuery = z.strictObject({
  baselineId: id,
  after: id.optional(),
});
export const previewInput = z.strictObject({
  through: date,
  targets: z
    .array(
      z.strictObject({ date, amountMinor: amount.max(10_000_000_000_000) }),
    )
    .max(8)
    .optional(),
  annualNetWorthChangeMinor: integer
    .min(-10_000_000_000_000)
    .max(10_000_000_000_000)
    .optional(),
  immediateCashOutflowMinor: amount.max(10_000_000_000_000).optional(),
  assumeNoDebt: z.boolean().optional(),
});
export type PreviewInput = z.infer<typeof previewInput>;
export const goalRow = z.object({
  cursor: integer.positive(),
  goalId: id,
  versionId: id,
  name: text,
  metric: text,
  unit: z.enum(["minor_units", "months", "ppm", "count"]),
  primaryGoal: z.union([z.literal(0), z.literal(1)]),
  archivedAt: text.nullable(),
  target: amount.nullable(),
  targetDate: date.nullable(),
  current: amount,
  currentSource: text,
  recordedAt: text,
  forecastId: id.nullable(),
  forecastDate: date.nullable(),
  forecastMiddle: amount.nullable(),
  forecastMode: z.enum(["modeled", "not_configured"]).nullable(),
});
export const planRow = z.object({
  id,
  effectiveAt: text,
  liquidMinor: amount,
  floorMinor: amount,
  householdBurnMinor: amount,
  businessBurnMinor: amount,
});
export const baselineRow = z.object({
  id,
  recordedAt: text,
  sourceObservedAt: text,
  sourceRevision: text,
  liquidMinor: amount,
  privatePaperMinor: amount,
  unknownPositions: amount,
  unknownCashAccounts: amount,
  potentialDuplicates: amount,
  positionCount: amount,
});
export const debtRow = z.object({
  id,
  decision: z.enum(["accepted", "excluded"]),
  decidedAt: text,
  key: text,
  balanceMinor: amount.nullable(),
  paymentMinor: amount.nullable(),
  treatment: z
    .enum([
      "reserve_from_liquidity",
      "add_to_household_burn",
      "already_in_plan",
    ])
    .nullable(),
  effectiveDate: date,
});
const nullableAmount = integer.nullable();
const statusReason = z.enum([
  "no_accepted_baseline",
  "ambiguous_baseline_date",
  "incomplete_asset_values",
  "overlapping_positions",
  "no_reviewed_debt",
  "unknown_debt_balance",
  "debt_history_limit",
]);
const goal = goalRow
  .omit({
    cursor: true,
    archivedAt: true,
    primaryGoal: true,
    forecastMode: true,
  })
  .extend({
    isPrimary: z.boolean(),
    currentShortfall: nullableAmount,
    projectedShortfallAtTarget: nullableAmount,
  });
export const outlook = z.strictObject({
  version: z.literal("1"),
  currency: z.literal("USD"),
  evaluatedOn: date,
  baseline: baselineRow.nullable(),
  cashPlan: planRow.nullable(),
  wealth: z.strictObject({
    scope: z.literal("accepted_portfolio_baseline_less_reviewed_debt"),
    trackedNetWorthMinor: nullableAmount,
    reviewedDebtMinor: nullableAmount,
    reasons: z.array(statusReason),
    debtEvidence: z.array(z.object({ decisionId: id, effectiveDate: date })),
    assumedNoDebt: z.boolean(),
  }),
  goals: z.array(goal),
  nextAfterGoal: text.nullable(),
  netWorthTargets: z.array(
    z.object({
      goalId: id.nullable(),
      date,
      targetMinor: amount,
      currentShortfallMinor: nullableAmount,
      projectedNetWorthMinor: nullableAmount,
      projectedShortfallMinor: nullableAmount,
      requiredAnnualNetIncreaseMinor: nullableAmount,
      annualChangeAssumptionMinor: nullableAmount,
    }),
  ),
  liquidity: z.object({
    basis: z.literal("saved_fi_liquid_plan"),
    through: date,
    days: amount,
    startingLiquidMinor: nullableAmount,
    reserveMinor: nullableAmount,
    monthlyBurnMinor: nullableAmount,
    reservedDebtPaymentMinor: nullableAmount,
    immediateCashOutflowMinor: amount,
    projectedEndMinor: nullableAmount,
    reserveShortfallMinor: nullableAmount,
    lastsThroughDate: z.boolean().nullable(),
    maximumMonthlyBurnMinor: nullableAmount,
    monthlyBurnReductionNeededMinor: nullableAmount,
    obligationCoverage: z.enum([
      "reviewed_payments",
      "no_reviewed_debt",
      "debt_history_limit",
    ]),
    firstBelowReserveDate: date.nullable(),
  }),
  emailCoverage: z.literal("not_connected_by_this_api"),
});
export const mark = z.object({
  positionId: id,
  name: text,
  classification: z.enum(["private_paper", "public_market"]),
  provider: text,
  baselineValueMinor: nullableAmount,
  baselineSnapshotId: id,
  baselineObservedAt: text,
  latestSnapshotId: id.nullable(),
  latestSourceDocumentId: id.nullable(),
  latestObservedAt: text.nullable(),
  latestReportedUnrealizedMinor: nullableAmount,
  latestProviderStatus: text.nullable(),
  sourceChangedSinceBaseline: z.boolean(),
  acceptedQuoteId: id.nullable(),
  acceptedPriceMicros: nullableAmount,
  priceDate: date.nullable(),
  shareClass: text.nullable(),
  reviewedValuation: z
    .object({
      receiptId: id,
      source: text,
      origin: z.enum(["gp", "proxy", "judgment"]),
      amountMinor: amount,
      effectiveDate: date.nullable(),
      carry: z.enum(["before_carry", "after_carry", "unknown"]),
      evidenceId: text.nullable(),
    })
    .nullable(),
  latestPublicSignal: z
    .object({
      observationId: id,
      title: text,
      publishedAt: text,
      sourceUrl: z.url(),
    })
    .nullable(),
  publicSignalScope: z.enum([
    "single_mapped_company",
    "unmapped_or_multiple_companies",
  ]),
});
export const marksPage = z.strictObject({
  version: z.literal("1"),
  baselineId: id,
  sourceRevision: text,
  positions: z.array(mark),
  nextAfter: id.nullable(),
  emailCoverage: z.literal("not_connected_by_this_api"),
});
export const errorBody = z.object({
  code: z.enum([
    "invalid_request",
    "unauthenticated",
    "forbidden",
    "not_found",
    "data_unavailable",
  ]),
  error: text,
});
