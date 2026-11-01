import {
  PriceProxyStatusSchema,
  PurchaseReceiptSchema,
} from "./position-purchases";
import { z } from "zod";
import { AutomaticInvestmentReviewSchema } from "./automatic-investment-review";
import {
  InvestmentCompanyReceiptSchema,
  InvestmentReviewStateSchema,
  type InvestmentReviewState,
} from "./investment-review";
import {
  LegalDocumentProblemSchema,
  LegalNameDocumentReferenceSchema,
} from "./provider-legal-documents";

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

const ReportedLegalEntityNameSchema = z
  .object({
    state: z.enum([
      "provider_reported",
      "template_reported",
      "document_reported",
    ]),
    legalName: z.string().trim().min(1).max(1_000),
    sourceField: z.string().trim().min(1).max(240),
    documents: z.array(LegalNameDocumentReferenceSchema).max(100).optional(),
  })
  .strict();

const UnavailableLegalEntityNameSchema = z
  .object({
    state: z.literal("unavailable"),
    legalName: z.null(),
    sourceField: z.null(),
    problem: LegalDocumentProblemSchema.optional(),
    documents: z.array(LegalNameDocumentReferenceSchema).max(100).optional(),
  })
  .strict();

export const LegalEntityNameEvidenceSchema = z.discriminatedUnion("state", [
  ReportedLegalEntityNameSchema,
  UnavailableLegalEntityNameSchema,
]);

// Only fields that explicitly identify the legal vehicle are name evidence.
// Provider-generated deal labels and the investor's ownership label are not.
export function importedLegalEntityNameEvidence(
  provider: string,
  legalPosition: string,
): LegalEntityNameEvidence {
  if (provider === "angellist" || provider === "wefunder") {
    return LegalEntityNameEvidenceSchema.parse({
      state:
        provider === "wefunder" ? "template_reported" : "provider_reported",
      legalName: legalPosition,
      sourceField:
        provider === "wefunder"
          ? "Legal Position (Wefunder template)"
          : "Fund Name",
    });
  }
  return {
    state: "unavailable",
    legalName: null,
    sourceField: null,
    ...(["sydecar", "tokenfolio"].includes(provider)
      ? { problem: "not_checked" as const }
      : {}),
  };
}

export const InvestmentPositionSnapshotSchema = z.object({
  id: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  observedAt: IsoTimestampSchema,
  providerStatus: z.enum(["live", "realized"]),
  investedMinor: NonNegativeIntegerSchema,
  allocationMinor: NonNegativeIntegerSchema,
  investmentAmountMinor: NonNegativeIntegerSchema.optional(),
  unrealizedValue: NullableReportedValueSchema,
  realizedValueMinor: NonNegativeIntegerSchema,
  netValue: NullableReportedValueSchema,
  instrumentType: z.string().trim().min(1).max(1_000),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  quantityMicros: NonNegativeIntegerSchema.nullable(),
  ticker: z.string().trim().min(1).max(32).nullable(),
  costBasisMinor: NonNegativeIntegerSchema.nullable(),
});

export const LinkedReportedValueSchema = NullableReportedValueSchema.safeExtend(
  {
    reviewId: z.string(),
    sourcePositionId: z.string(),
    snapshotId: z.string(),
    sourceLabel: z.string(),
    observedAt: IsoTimestampSchema,
  },
);

export const InvestmentPositionRecordSchema = z.object({
  id: z.string().min(1),
  legalVehicleName: z.string().trim().min(1).max(1_000),
  legalEntityNameEvidence: LegalEntityNameEvidenceSchema,
  ownerLabel: z.string().trim().min(1).max(1_000).optional(),
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
  purchaseReceipt: PurchaseReceiptSchema.nullable().optional(),
  priceProxyStatus: PriceProxyStatusSchema.nullable().optional(),
  acceptedValueAdjustment: PositionValueAdjustmentSchema.nullable().optional(),
  acceptedEconomicsTerms: PositionEconomicsTermsSchema.nullable().optional(),
  reportedEconomicsTerms:
    ReportedPositionEconomicsTermsSchema.nullable().optional(),
  investmentReview: InvestmentReviewStateSchema.nullable().optional(),
  companyReview: InvestmentCompanyReceiptSchema.nullable().optional(),
  automaticReview: AutomaticInvestmentReviewSchema.nullable().optional(),
  linkedReportedValue: LinkedReportedValueSchema.nullable().optional(),
  renamedCompany: z
    .object({ name: z.string(), formerName: z.string(), reviewId: z.string() })
    .nullable()
    .optional(),
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
export type LegalEntityNameEvidence = z.infer<
  typeof LegalEntityNameEvidenceSchema
>;

// Pure projection of an explicit per-position document decision. Keep original
// provider captures untouched; unrelated/parent agreements do not identify this
// position. Incoming documents are already scoped by the indexed repository join.
export function reviewedInvestmentNameEvidence(
  evidence: LegalEntityNameEvidence,
  review: InvestmentReviewState | null,
  incoming: z.infer<typeof LegalNameDocumentReferenceSchema>[] = [],
): LegalEntityNameEvidence {
  if ((review?.documentAssignments.length ?? 0) === 0 && incoming.length === 0)
    return evidence;
  const excluded = new Set(
    review?.documentAssignments
      .filter((item) => item.relationship !== "supports")
      .map((item) => `${item.documentId}:${item.sha256}`),
  );
  const documents = [
    ...new Map(
      [...(evidence.documents ?? []), ...incoming]
        .filter((doc) => !excluded.has(`${doc.id}:${doc.sha256}`))
        .map((doc) => [doc.id, doc]),
    ).values(),
  ];
  const names = [
    ...new Set(
      documents.flatMap(
        (doc) => doc.citations?.map((citation) => citation.legalName) ?? [],
      ),
    ),
  ];
  const problem = documents.some((doc) => doc.scan?.outcome === "blocked")
    ? "security_blocked"
    : documents.some((doc) => doc.scan === undefined)
      ? "scanner_unavailable"
      : documents.some((doc) => doc.structure !== undefined)
        ? "other_structure"
        : (documents.find(
            (doc) =>
              doc.extractionProblem != null &&
              doc.extractionProblem !== "name_not_found" &&
              doc.extractionProblem !== "conflicting",
          )?.extractionProblem ??
          (evidence.state === "unavailable" &&
          evidence.problem !== undefined &&
          [
            "limit_reached",
            "page_changed",
            "inaccessible",
            "extractor_unavailable",
          ].includes(evidence.problem)
            ? evidence.problem
            : names.length > 1
              ? "conflicting"
              : names.length === 0
                ? "name_not_found"
                : null));
  return LegalEntityNameEvidenceSchema.parse(
    problem === null
      ? {
          state: "document_reported",
          legalName: names[0],
          sourceField: "Assigned agreement",
          documents,
        }
      : {
          state: "unavailable",
          legalName: null,
          sourceField: null,
          problem,
          documents,
        },
  );
}
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

export function reportedPositionValue(position: InvestmentPositionRecord) {
  return position.linkedReportedValue ?? position.snapshot.unrealizedValue;
}
