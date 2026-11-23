import { z } from "zod";
import { HttpsSourceUrlSchema } from "./source-url";

const money = z.number().int().safe().nonnegative().max(10_000_000_000_000);
const text = z.string().trim().min(1).max(500);
// A stable issuer basis, not a security class. A split changes the ratio, never
// the stored dollar balance or the original quantity. Replays are idempotent.
export const ShareBasisSchema = z
  .object({
    key: text,
    unitsPerOriginal: z.number().int().positive().max(1_000_000),
  })
  .strict();
export const SourcePriceMetadataSchema = z
  .object({
    policy: z.literal("accepted-source-continuation-v1"),
    quoteId: text.nullable(),
    // Omitted on older receipts whose single quote anchors both fields.
    shareBasisQuoteId: text.nullable().optional(),
    shareClass: text.nullable(),
    shareBasis: ShareBasisSchema.nullable(),
  })
  .strict();
export const PriceMetadataSchema = SourcePriceMetadataSchema.extend({
  quoteId: text,
  shareBasisQuoteId: text.optional(),
  shareClass: text,
  shareBasis: ShareBasisSchema,
});
export const ValuationRecordSchema = z
  .object({
    shareBasis: ShareBasisSchema.nullable().optional(),
    priceSourcePositionId: text.nullable().optional(),
    followSource: z.boolean().optional(),
    crossClassProxy: z.boolean().optional(),
    sourceContinuation: PriceMetadataSchema.optional(),
    id: z.string().min(1).max(200),
    origin: z.enum(["gp", "proxy", "judgment", "at_cost"]),
    totalMinor: money.nullable(),
    priceMicros: z
      .number()
      .int()
      .safe()
      .positive()
      .max(1_000_000_000_000)
      .nullable(),
    effectiveDate: z.iso.date().nullable(),
    priceDate: z.iso.date().nullable(),
    shareClass: text.nullable(),
    carryStatus: z.enum(["before_carry", "after_carry", "unknown"]),
    sourceLabel: text,
    sourceUrl: HttpsSourceUrlSchema.nullable(),
    sourceEvidenceId: text.nullable(),
    sourcePositionId: text.nullable(),
    sourceCapturedAt: z.iso.datetime().nullable(),
    watchEvidenceId: text.nullable(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.effectiveDate === null && record.origin !== "at_cost")
      ctx.addIssue({
        code: "custom",
        path: ["effectiveDate"],
        message: "Enter the valuation date.",
      });
    if (record.sourceContinuation && !record.followSource)
      ctx.addIssue({
        code: "custom",
        message: "Source metadata assumptions require a followed price source.",
      });
    if (
      record.followSource &&
      (record.origin !== "proxy" ||
        !record.priceSourcePositionId ||
        record.priceSourcePositionId !== record.sourcePositionId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose an accepted price source to follow.",
      });
    if (record.totalMinor === null && record.priceMicros === null)
      ctx.addIssue({
        code: "custom",
        message: "Enter a position total or share price.",
      });
    if (
      record.origin === "proxy" &&
      (record.totalMinor !== null ||
        !record.sourceEvidenceId ||
        !record.sourcePositionId ||
        !record.sourceCapturedAt)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A proxy uses a source share price, never another position's total.",
      });
    if (record.origin !== "judgment" && record.watchEvidenceId)
      ctx.addIssue({
        code: "custom",
        message: "Portfolio Watch supports your estimate, not a GP report.",
      });
  });
export const ValuationSelectionSchema = z
  .object({
    recordId: z.string().min(1).max(200),
    method: z.enum(["total", "shares"]),
    sharesKey: z.string().max(12_000).nullable(),
  })
  .strict();
export const ValuationStateSchema = z
  .object({
    reportedTotalRefresh: z
      .object({
        policy: z.literal("accepted-gp-total-v1"),
        priorReceiptId: text,
        sourcePositionId: text,
        sourceSnapshotId: text,
        sourceApplicationId: text,
        linkReviewId: text,
      })
      .strict()
      .optional(),
    calculation: z
      .object({
        policy: z.literal("linked-price-proxy-v1"),
        quoteId: text,
        quantityReceiptId: text,
        valueMinor: money,
        quantityMicros: z.number().int().safe().nonnegative(),
        estimatedShares: z.boolean(),
      })
      .strict()
      .optional(),
    snapshotId: z.string().min(1),
    records: z.array(ValuationRecordSchema).max(30),
    selected: ValuationSelectionSchema.nullable(),
  })
  .strict()
  .superRefine((state, ctx) => {
    if (new Set(state.records.map((r) => r.id)).size !== state.records.length)
      ctx.addIssue({
        code: "custom",
        message: "Valuation source identifiers must be unique.",
      });
    if (
      state.selected &&
      !state.records.some((r) => r.id === state.selected!.recordId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Select an available valuation.",
      });
  });
export const AcceptValuationSchema = z
  .object({
    expectedSnapshotId: z.string().min(1),
    expectedReceiptId: z.string().min(1).nullable(),
    expectedTermsId: z.string().min(1).nullable().optional(),
    record: ValuationRecordSchema,
    method: z.enum(["total", "shares"]),
  })
  .strict();
export type ValuationRecord = z.infer<typeof ValuationRecordSchema>;
/** Preserve reviewed metadata as assumptions, separately from the raw quote. */
export function continuedPriceMetadata(
  prior: ValuationRecord | undefined,
  quote: Pick<ValuationRecord, "priceDate" | "shareClass" | "shareBasis">,
  sourceMetadata?: z.infer<typeof SourcePriceMetadataSchema>,
) {
  if (
    !prior?.followSource ||
    (quote.priceDate && quote.shareClass && quote.shareBasis)
  )
    return undefined;
  // Source heads survive interrupted propagation and temporary deselection.
  // Only an already accepted followed relationship may reuse assumptions.
  const previous = prior.sourceContinuation;
  const shareClass =
    sourceMetadata?.shareClass ?? prior.shareClass ?? previous?.shareClass;
  const shareBasis =
    sourceMetadata?.shareBasis ?? prior.shareBasis ?? previous?.shareBasis;
  const quoteId =
    sourceMetadata?.quoteId ??
    (prior.shareClass ? prior.sourceEvidenceId : previous?.quoteId);
  const basisQuoteId =
    sourceMetadata?.shareBasisQuoteId ??
    (prior.shareBasis
      ? prior.sourceEvidenceId
      : (previous?.shareBasisQuoteId ?? previous?.quoteId));
  if (!shareClass || !shareBasis || !quoteId || !basisQuoteId) return undefined;
  return {
    policy: "accepted-source-continuation-v1" as const,
    quoteId,
    ...(basisQuoteId !== quoteId ? { shareBasisQuoteId: basisQuoteId } : {}),
    shareClass,
    shareBasis,
  };
}
export type ValuationState = z.infer<typeof ValuationStateSchema>;
export type AcceptValuation = z.infer<typeof AcceptValuationSchema>;
