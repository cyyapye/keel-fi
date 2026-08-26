import { z } from "zod";

import { PositionValueAdjustmentSchema } from "./position-value";
import {
  PositionEconomicsTermsSchema,
  ReportedPositionEconomicsTermsSchema,
} from "./position-economics";

const IsoDateSchema = z.iso.date();
const IsoTimestampSchema = z.iso.datetime({ offset: true });
const NonNegativeIntegerSchema = z.number().int().safe().nonnegative();
const NullableReportedValueSchema = z
  .object({
    state: z.enum(["reported", "locked", "not_reported"]),
    minor: NonNegativeIntegerSchema.nullable(),
  })
  .superRefine((value, context) => {
    const matchesState =
      (value.state === "reported" && value.minor !== null) ||
      (value.state !== "reported" && value.minor === null);
    if (!matchesState) {
      context.addIssue({
        code: "custom",
        message: "Position value does not match its reported state.",
        path: ["minor"],
      });
    }
  });

const PriorPositionValueSchema = NullableReportedValueSchema.extend({
  observedAt: IsoTimestampSchema,
});

export const InvestmentCoverageCompletenessSchema = z.enum([
  "complete",
  "partial",
  "unavailable",
  "malformed",
  "failed",
  "ambiguous",
]);

export const InvestmentSourceFreshnessSchema = z.enum(["current", "stale"]);

export const InvestmentPositionSnapshotSchema = z.object({
  id: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  observedAt: IsoTimestampSchema,
  providerStatus: z.enum(["live", "realized"]),
  investedMinor: NonNegativeIntegerSchema,
  allocationMinor: NonNegativeIntegerSchema,
  unrealizedValue: NullableReportedValueSchema,
  realizedValueMinor: NonNegativeIntegerSchema,
  netValue: NullableReportedValueSchema,
  instrumentType: z.string().trim().min(1).max(1_000),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  quantityMicros: NonNegativeIntegerSchema.nullable(),
  ticker: z.string().trim().min(1).max(32).nullable(),
  costBasisMinor: NonNegativeIntegerSchema.nullable(),
});

export const InvestmentPositionRecordSchema = z.object({
  id: z.string().min(1),
  legalVehicleName: z.string().trim().min(1).max(1_000),
  reportedExposureName: z.string().trim().min(1).max(1_000).nullable(),
  kind: z.enum(["direct", "spv_interest", "fund_interest"]),
  openedOn: IsoDateSchema.nullable(),
  reviewStatus: z.literal("accepted"),
  acceptedAt: IsoTimestampSchema,
  ownershipVersion: z.number().int().positive(),
  ownershipBasis: z.enum(["provider_provenance", "reviewed_import", "manual"]),
  source: z.object({
    label: z.string().trim().min(1).max(1_000),
    effectiveDate: IsoDateSchema,
    retrievedAt: IsoTimestampSchema,
    freshness: InvestmentSourceFreshnessSchema,
  }),
  snapshot: InvestmentPositionSnapshotSchema,
  acceptedValueAdjustment: PositionValueAdjustmentSchema.nullable().optional(),
  acceptedEconomicsTerms: PositionEconomicsTermsSchema.nullable().optional(),
  reportedEconomicsTerms:
    ReportedPositionEconomicsTermsSchema.nullable().optional(),
  priorValue: PriorPositionValueSchema.nullable().optional(),
});

export const InvestmentPositionContainerSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(512),
  kind: z.enum([
    "brokerage",
    "ira",
    "retirement",
    "trust",
    "entity",
    "unresolved",
    "other",
  ]),
  taxTreatment: z.enum(["taxable", "tax_deferred", "tax_exempt", "unknown"]),
  coverage: z
    .object({
      completeness: InvestmentCoverageCompletenessSchema,
      observedAt: IsoTimestampSchema,
      freshness: InvestmentSourceFreshnessSchema,
    })
    .nullable(),
  positions: z.array(InvestmentPositionRecordSchema),
});

export const InvestmentPositionConnectionSchema = z.object({
  id: z.string().min(1),
  purpose: z.enum(["source", "reviewed_history"]),
  adapterType: z.enum(["plaid-investments", "angellist-import", "manual"]),
  institutionKey: z.string().trim().min(1).max(200),
  institutionLabel: z.string().trim().min(1).max(512),
  lifecycleState: z.enum(["pending", "active", "paused", "disconnected"]),
  containers: z.array(InvestmentPositionContainerSchema),
});

export const InvestmentPositionViewSchema = z.object({
  asOf: IsoTimestampSchema,
  connections: z.array(InvestmentPositionConnectionSchema),
});

export type InvestmentCoverageCompleteness = z.infer<
  typeof InvestmentCoverageCompletenessSchema
>;
export type InvestmentPositionConnection = z.infer<
  typeof InvestmentPositionConnectionSchema
>;
export type InvestmentPositionContainer = z.infer<
  typeof InvestmentPositionContainerSchema
>;
export type InvestmentPositionRecord = z.infer<
  typeof InvestmentPositionRecordSchema
>;
export type InvestmentPositionView = z.infer<
  typeof InvestmentPositionViewSchema
>;
export type InvestmentSourceFreshness = z.infer<
  typeof InvestmentSourceFreshnessSchema
>;

export const INVESTMENT_POSITION_STALE_AFTER_DAYS = 90;

export function investmentSourceFreshness(
  observedAt: string,
  asOf: string,
): InvestmentSourceFreshness {
  const observedTime = Date.parse(IsoTimestampSchema.parse(observedAt));
  const asOfTime = Date.parse(IsoTimestampSchema.parse(asOf));
  if (observedTime > asOfTime) {
    throw new Error("Investment source observation cannot be in the future.");
  }
  const staleAfterMs =
    INVESTMENT_POSITION_STALE_AFTER_DAYS * 24 * 60 * 60 * 1_000;
  return asOfTime - observedTime > staleAfterMs ? "stale" : "current";
}
