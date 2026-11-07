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
export const ValuationRecordSchema = z
  .object({
    shareBasis: ShareBasisSchema.nullable().optional(),
    priceSourcePositionId: text.nullable().optional(),
    followSource: z.boolean().optional(),
    crossClassProxy: z.boolean().optional(),
    id: z.string().min(1).max(200),
    origin: z.enum(["gp", "proxy", "judgment"]),
    totalMinor: money.nullable(),
    priceMicros: z
      .number()
      .int()
      .safe()
      .positive()
      .max(1_000_000_000_000)
      .nullable(),
    effectiveDate: z.iso.date(),
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
export type ValuationState = z.infer<typeof ValuationStateSchema>;
export type AcceptValuation = z.infer<typeof AcceptValuationSchema>;
