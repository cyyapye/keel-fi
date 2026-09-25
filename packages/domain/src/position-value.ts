import { z } from "zod";

import { PrivatePositionValueEstimateSchema } from "./private-position-value-estimate";

const IsoDateSchema = z.iso.date();
const IsoTimestampSchema = z.iso.datetime({ offset: true });
const NonNegativeMoneyMinorSchema = z.number().int().safe().nonnegative();
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/u);

export const PositionValueSourceKindSchema = z.enum([
  "gp_update",
  "news_article",
  "other",
]);

const OptionalHttpsSourceUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.username === "" && url.password === ""
    );
  }, "Source URLs must use HTTPS without credentials.")
  .nullable();

export const PositionValueAdjustmentSchema = z.object({
  id: z.string().min(1),
  positionId: z.string().min(1),
  snapshotId: z.string().min(1),
  priorValueState: z.enum(["reported", "locked", "not_reported"]),
  priorValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  valueMinor: NonNegativeMoneyMinorSchema,
  currency: CurrencySchema,
  effectiveDate: IsoDateSchema,
  sourceKind: PositionValueSourceKindSchema,
  sourceLabel: z.string().trim().min(1).max(240),
  sourceUrl: OptionalHttpsSourceUrlSchema,
  commentary: z.string().trim().min(3).max(1_000),
  acceptedAt: IsoTimestampSchema,
});

export const PositionValueContextSchema = z.object({
  snapshotId: z.string().min(1),
  currency: CurrencySchema,
  providerValueState: z.enum(["reported", "locked", "not_reported"]),
  providerValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  acceptedAdjustment: PositionValueAdjustmentSchema.nullable(),
  projectedEstimate: PrivatePositionValueEstimateSchema.nullable().optional(),
});

export const AcceptPositionValueAdjustmentInputSchema = z
  .object({
    expectedSnapshotId: z.string().min(1),
    expectedAdjustmentId: z.string().min(1).nullable(),
    valueMinor: NonNegativeMoneyMinorSchema,
    currency: CurrencySchema,
    effectiveDate: IsoDateSchema,
    sourceKind: PositionValueSourceKindSchema,
    sourceLabel: z.string().trim().min(1).max(240),
    sourceUrl: OptionalHttpsSourceUrlSchema,
    commentary: z.string().trim().max(1_000).default(""),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.sourceKind !== "gp_update" || input.commentary.length > 0) &&
      input.commentary.length < 3
    ) {
      context.addIssue({
        code: "custom",
        message: "Explain what this value reflects (at least 3 characters).",
        path: ["commentary"],
      });
    }
    if (input.sourceKind === "news_article" && input.sourceUrl === null) {
      context.addIssue({
        code: "custom",
        message: "News evidence requires an HTTPS source URL.",
        path: ["sourceUrl"],
      });
    }
  })
  .transform((input) => ({
    ...input,
    commentary: input.commentary || "No additional notes supplied.",
  }));

export type PositionValueAdjustment = z.infer<
  typeof PositionValueAdjustmentSchema
>;
export type PositionValueSourceKind = z.infer<
  typeof PositionValueSourceKindSchema
>;
export type PositionValueContext = z.infer<typeof PositionValueContextSchema>;
export type AcceptPositionValueAdjustmentInput = z.infer<
  typeof AcceptPositionValueAdjustmentInputSchema
>;
