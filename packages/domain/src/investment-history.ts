import { z } from "zod";

const id = z.string().min(1).max(512);
const integer = z.number().int().safe();
const timestamp = z.iso.datetime({ offset: true });
export const InvestmentTransactionTypeSchema = z.enum([
  "buy",
  "sell",
  "cash",
  "fee",
  "transfer",
  "cancel",
]);
export const InvestmentHistoryQuerySchema = z
  .strictObject({
    positionId: id.optional(),
    accountId: id.optional(),
    from: z.iso.date().optional(),
    through: z.iso.date().optional(),
    type: InvestmentTransactionTypeSchema.optional(),
    after: z.string().min(1).max(2048).optional(),
    readContextId: id.optional(),
    sort: z.enum(["highest_basis", "oldest"]).optional(),
  })
  .refine((q) => Boolean(q.positionId) !== Boolean(q.accountId), {
    message: "Supply exactly one positionId or accountId.",
  })
  .refine((q) => !q.from || !q.through || q.from <= q.through, {
    message: "The start date must not follow the end date.",
  });
export type InvestmentHistoryQuery = z.infer<
  typeof InvestmentHistoryQuerySchema
>;

export const InvestmentHistoryCoverageSchema = z.object({
  status: z.enum([
    "complete",
    "partial",
    "unavailable",
    "failed",
    "not_synced",
  ]),
  requestedFrom: z.iso.date().nullable(),
  requestedThrough: z.iso.date().nullable(),
  lastSuccessfulSyncAt: timestamp.nullable(),
  evidenceId: id.optional(),
  missingPeriods: z.array(
    z.object({ from: z.iso.date(), through: z.iso.date() }),
  ),
  scope: z.literal("provider_reported_window"),
});
export const InvestmentHistoryContextSchema = z.object({
  readContextId: id.nullable(),
  accountId: id,
  positionId: id.nullable(),
  capturedAt: timestamp.nullable(),
  providerUpdatedAt: timestamp.nullable(),
  quantityEffectiveOn: z.iso.date().nullable(),
  priceAsOf: z.iso.date().nullable(),
  holdingsSnapshotId: id.nullable(),
  coverage: InvestmentHistoryCoverageSchema,
  lastAttemptStatus: z.enum(["succeeded", "failed", "not_synced"]),
});
export type InvestmentHistoryContext = z.infer<
  typeof InvestmentHistoryContextSchema
>;

export const InvestmentTransactionSchema = z.object({
  id,
  providerTransactionId: id,
  presence: z
    .enum(["reported", "not_in_latest_complete_report", "not_checked"])
    .optional(),
  lastSeenEvidenceId: id.optional(),
  accountId: id,
  positionId: id.nullable(),
  securityId: id.nullable(),
  securityName: z.string().max(1000).nullable(),
  ticker: z.string().max(32).nullable(),
  type: InvestmentTransactionTypeSchema,
  subtype: z.string().max(256),
  postedOn: z.iso.date(),
  initiatedAt: timestamp.nullable(),
  initiationPrecision: z.literal("provider_supplied_unknown"),
  quantityMicros: integer.nullable(),
  sourceQuantityDecimal: z.string().max(128).nullable().optional(),
  quantityPrecision: z
    .enum(["exact_millionths", "rounded_to_millionths", "unknown"])
    .optional(),
  unitPriceMicros: integer.nonnegative().nullable(),
  feesMinor: integer.nonnegative().nullable(),
  cashDeltaMinor: integer.nullable(),
  currency: z.literal("USD"),
  evidenceId: id,
  receivedAt: timestamp,
  revision: integer.positive(),
  previous: z
    .object({
      evidenceId: id,
      quantityMicros: integer.nullable(),
      cashDeltaMinor: integer.nullable(),
      postedOn: z.iso.date(),
    })
    .nullable(),
});
export type InvestmentTransaction = z.infer<typeof InvestmentTransactionSchema>;
export const InvestmentTransactionsPageSchema = z.object({
  context: InvestmentHistoryContextSchema,
  items: z.array(InvestmentTransactionSchema).max(50),
  nextAfter: z.string().nullable(),
});

export const InvestmentTaxLotSchema = z.object({
  id,
  providerLotId: id.nullable(),
  positionId: id,
  accountId: id,
  origin: z.literal("broker_reported"),
  acquiredAt: timestamp.nullable(),
  acquisitionPrecision: z.literal("provider_supplied_unknown"),
  quantityMicros: integer.nonnegative().nullable(),
  sourceQuantityDecimal: z.string().max(128).nullable().optional(),
  quantityPrecision: z
    .enum(["exact_millionths", "rounded_to_millionths", "unknown"])
    .optional(),
  purchasePriceMicros: integer.nonnegative().nullable(),
  costBasisMinor: integer.nonnegative().nullable(),
  basisPerUnitMicros: integer.nonnegative().nullable(),
  positionType: z.enum(["LONG", "SHORT"]).nullable(),
  currency: z.literal("USD"),
  evidenceId: id,
});
export type InvestmentTaxLot = z.infer<typeof InvestmentTaxLotSchema>;
export const InvestmentTaxLotsPageSchema = z.object({
  context: InvestmentHistoryContextSchema,
  coverage: z.object({
    status: z.enum(["complete", "partial", "unavailable", "not_synced"]),
    reportedQuantityMicros: integer.nonnegative().nullable(),
    coveredQuantityMicros: integer.nonnegative().nullable(),
    knownBasisMinor: integer.nonnegative().nullable(),
    allBasisKnown: z.boolean(),
    reason: z
      .enum([
        "none",
        "not_provided",
        "invalid_evidence",
        "capture_limit",
        "quantity_mismatch",
        "unknown_basis",
        "unsupported_lot_type",
      ])
      .optional(),
  }),
  items: z.array(InvestmentTaxLotSchema).max(50),
  nextAfter: z.string().nullable(),
});

export const InvestmentReconciliationSchema = z.object({
  context: InvestmentHistoryContextSchema,
  status: z.enum([
    "not_synced",
    "insufficient_coverage",
    "insufficient_timing",
    "pending_snapshot",
    "unexplained_difference",
    "reconciled",
  ]),
  reason: z.string().max(1000),
  openingSnapshotId: id.nullable(),
  closingSnapshotId: id.nullable(),
  openingQuantityMicros: integer.nullable(),
  activityQuantityMicros: integer.nullable(),
  expectedQuantityMicros: integer.nullable(),
  reportedQuantityMicros: integer.nullable(),
  unexplainedQuantityMicros: integer.nullable(),
  cashStatus: z.literal("not_established"),
  basisStatus: z.literal("broker_reported_not_reconstructed"),
});
export type InvestmentReconciliation = z.infer<
  typeof InvestmentReconciliationSchema
>;

/** Only comparable effective dates and a complete interval can establish inclusion.
 * Provider refresh/price/capture timestamps are deliberately not substitutes. */
export function reconcileInvestmentQuantity(input: {
  context: InvestmentHistoryContext;
  openingSnapshotId: string | null;
  openingOn: string | null;
  openingQuantityMicros: number | null;
  closingOn: string | null;
  closingQuantityMicros: number | null;
  quantityDateBasis: "posting_date" | "unknown";
  transactions: Pick<
    InvestmentTransaction,
    "postedOn" | "type" | "quantityMicros"
  >[];
}): InvestmentReconciliation {
  const result: InvestmentReconciliation = {
    context: input.context,
    status: "insufficient_timing",
    reason:
      "The quantity effective date is not supplied. A price or refresh date cannot establish trade inclusion.",
    openingSnapshotId: input.openingSnapshotId,
    closingSnapshotId: input.context.holdingsSnapshotId,
    openingQuantityMicros: input.openingQuantityMicros,
    activityQuantityMicros: null,
    expectedQuantityMicros: null,
    reportedQuantityMicros: input.closingQuantityMicros,
    unexplainedQuantityMicros: null,
    cashStatus: "not_established",
    basisStatus: "broker_reported_not_reconstructed",
  };
  const coverage = input.context.coverage;
  if (
    coverage.status !== "complete" ||
    input.openingQuantityMicros === null ||
    input.closingQuantityMicros === null
  ) {
    result.status = "insufficient_coverage";
    result.reason =
      "A complete activity interval and comparable opening and closing quantities are needed.";
  } else if (
    input.openingOn &&
    input.closingOn &&
    input.quantityDateBasis === "posting_date"
  ) {
    if (
      !coverage.requestedFrom ||
      !coverage.requestedThrough ||
      coverage.requestedFrom > input.openingOn ||
      coverage.requestedThrough < input.closingOn ||
      coverage.missingPeriods.length
    ) {
      result.status = "insufficient_coverage";
      result.reason =
        "The activity coverage does not cover the complete comparison interval.";
    } else {
      const rows = input.transactions.filter(
        (t) => t.postedOn > input.openingOn! && t.postedOn <= input.closingOn!,
      );
      if (
        rows.some(
          (t) =>
            t.type === "cancel" ||
            t.type === "transfer" ||
            t.quantityMicros === null,
        )
      ) {
        result.status = "insufficient_coverage";
        result.reason =
          "An unsupported transfer, cancellation, or unknown quantity prevents reconciliation.";
      } else {
        const net = rows.reduce((s, t) => s + BigInt(t.quantityMicros!), 0n);
        const expected = BigInt(input.openingQuantityMicros) + net;
        const difference = BigInt(input.closingQuantityMicros) - expected;
        result.activityQuantityMicros = integer.parse(Number(net));
        result.expectedQuantityMicros = integer.parse(Number(expected));
        result.unexplainedQuantityMicros = integer.parse(Number(difference));
        result.status =
          difference === 0n ? "reconciled" : "unexplained_difference";
        result.reason =
          difference === 0n
            ? "The covered activity explains the reported share change."
            : "The recorded activity does not explain the entire reported share change.";
      }
    }
  }
  return InvestmentReconciliationSchema.parse(result);
}
