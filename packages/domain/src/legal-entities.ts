import { z } from "zod";
import { AutomaticInvestmentReviewSchema } from "./automatic-investment-review";
import {
  InvestmentCompanyReceiptSchema,
  InvestmentReviewStateSchema,
} from "./investment-review";

import {
  LegalEntityNameEvidenceSchema,
  type LegalEntityNameEvidence,
} from "./position-read-model";
import { MAX_LEGAL_DOCUMENT_PAGES } from "./provider-legal-documents";

const IsoDateSchema = z.iso.date();
const IsoTimestampSchema = z.iso.datetime({ offset: true });
const NullableTextSchema = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();

export const LegalEntityTypeSchema = z.enum([
  "llc",
  "limited_partnership",
  "corporation",
  "partnership",
  "trust",
  "other",
]);

export const ExactLegalEntityTypeSchema = z.enum([
  "llc",
  "limited_partnership",
]);

export const MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES = 500;

export const LegalEntityRelationshipSchema = z.enum([
  "direct_interest",
  "ownership_entity",
  "operating_entity",
  "investment_vehicle",
  "other",
]);

export const LegalEntityInterestStatusSchema = z.enum([
  "current",
  "historical",
  "unknown",
]);

export const LegalEntitySourceReferenceSchema = z
  .object({
    kind: z.enum(["ownership_container", "holding_position"]),
    id: z.string().trim().min(1).max(500),
  })
  .strict();

const ReportedValueSchema = z
  .object({
    state: z.enum(["reported", "locked", "not_reported"]),
    minor: z.number().int().safe().nonnegative().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.state === "reported" && value.minor === null) ||
      (value.state !== "reported" && value.minor !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Legal entity source value does not match its state.",
        path: ["minor"],
      });
    }
  });

export const LegalEntitySourceFinancialsSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/u),
    commitmentMinor: z.number().int().safe().nonnegative().nullable(),
    fundedMinor: z.number().int().safe().nonnegative().nullable(),
    capitalBasis: z
      .enum(["gross_commitment", "net_invested"])
      .nullable()
      .optional(),
    grossCommitmentMinor: z
      .number()
      .int()
      .safe()
      .positive()
      .nullable()
      .optional(),
    setupFeePpm: z.number().int().min(0).max(1_000_000).nullable().optional(),
    currentValue: ReportedValueSchema,
    annualAdminFeePpm: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    adminFeeYears: z.number().int().min(1).max(100).nullable().optional(),
    carryPpm: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .strict();

export const LegalNameResolutionDetailsSchema = z
  .object({
    kind: z.enum([
      "document_choice",
      "document_entry",
      "document_correction",
      "document_structure",
    ]),
    documentId: z.string().uuid(),
    legalName: z
      .string()
      .trim()
      .min(1, "Enter the exact legal name.")
      .max(1_000),
    page: z
      .number()
      .int("Enter a whole page number.")
      .min(1, "Enter a page number from 1 to 150.")
      .max(MAX_LEGAL_DOCUMENT_PAGES, "Enter a page number from 1 to 150."),
    quote: NullableTextSchema(2_000),
    reason: NullableTextSchema(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const whitespace = (text: string) => text.replace(/\s+/gu, " ").trim();
    if (
      value.quote === null &&
      (value.kind === "document_choice" || value.kind === "document_structure")
    ) {
      context.addIssue({
        code: "custom",
        message: "The selected name must include its document excerpt.",
        path: ["quote"],
      });
    } else if (
      value.quote !== null &&
      !whitespace(value.quote).includes(whitespace(value.legalName))
    ) {
      context.addIssue({
        code: "custom",
        message: "Include the exact legal name in the document excerpt.",
        path: ["quote"],
      });
    }
    if (value.kind === "document_correction" && value.reason === null) {
      context.addIssue({
        code: "custom",
        message: "Explain the document-backed correction.",
        path: ["reason"],
      });
    }
  });

export const LegalNameResolutionInputSchema =
  LegalNameResolutionDetailsSchema.safeExtend({
    expectedEvidenceRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  });

export const LegalNameResolutionSchema =
  LegalNameResolutionDetailsSchema.safeExtend({
    fileName: z.string().trim().min(1).max(240),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    evidence: LegalEntityNameEvidenceSchema,
    // Older receipts did not capture the profile type at review time.
    reviewedEntityType: LegalEntityTypeSchema.optional(),
  });

// Called only for a single explicit review, never once per row on a GET path.
export async function legalNameEvidenceRevision(
  evidence: LegalEntityNameEvidence,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(LegalEntityNameEvidenceSchema.parse(evidence)),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const LegalEntitySourceSummarySchema = z
  .object({
    source: LegalEntitySourceReferenceSchema,
    sourceDisplayName: z.string().trim().min(1).max(1_000),
    legalEntityNameEvidence: LegalEntityNameEvidenceSchema,
    suggestedEntityType: ExactLegalEntityTypeSchema.nullable(),
    sourceLabel: z.string().trim().min(1).max(1_000),
    sourceAsOf: IsoDateSchema,
    relationship: LegalEntityRelationshipSchema,
    currentOwner: NullableTextSchema(1_000),
    interestStatus: LegalEntityInterestStatusSchema,
    openedOn: IsoDateSchema.nullable(),
    financials: LegalEntitySourceFinancialsSchema.nullable(),
    currentDecisionId: z.string().min(1).nullable(),
    nameResolution: LegalNameResolutionSchema.optional(),
    investmentReview: InvestmentReviewStateSchema.nullable().optional(),
    companyReview: InvestmentCompanyReceiptSchema.nullable().optional(),
    automaticReview: AutomaticInvestmentReviewSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const legalName = value.legalEntityNameEvidence.legalName;
    const expectedType =
      legalName === null ? null : exactLegalEntityTypeFromName(legalName);
    if (value.suggestedEntityType !== expectedType) {
      context.addIssue({
        code: "custom",
        message: "Entity type must match the evidenced legal name.",
        path: ["suggestedEntityType"],
      });
    }
  });

export const LegalEntityExactBatchPreviewSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    entityCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    existingEntityCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    newEntityCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    llcEntityCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    limitedPartnershipEntityCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    remainingCandidateCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.existingEntityCount + value.newEntityCount !==
      value.entityCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Exact legal entity counts must reconcile.",
        path: ["entityCount"],
      });
    }
    if (
      value.llcEntityCount + value.limitedPartnershipEntityCount !==
      value.entityCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Exact legal entity type counts must reconcile.",
        path: ["entityCount"],
      });
    }
    if (value.sourceCount < value.entityCount) {
      context.addIssue({
        code: "custom",
        message: "Each exact legal entity must have a source.",
        path: ["sourceCount"],
      });
    }
  });

export const LegalEntityProfileInputSchema = z
  .object({
    legalName: z.string().trim().min(1).max(1_000),
    entityType: LegalEntityTypeSchema,
    relationship: LegalEntityRelationshipSchema,
    currentOwner: NullableTextSchema(1_000),
    jurisdiction: NullableTextSchema(240),
    formedOn: IsoDateSchema.nullable(),
    einLastFour: z
      .string()
      .regex(/^\d{4}$/u)
      .nullable(),
    ownershipInterestPpm: z.number().int().min(0).max(1_000_000).nullable(),
    interestStatus: LegalEntityInterestStatusSchema,
    taxClassification: NullableTextSchema(240),
    notes: NullableTextSchema(2_000),
  })
  .strict();

export const LegalEntityRecordSchema = LegalEntityProfileInputSchema.extend({
  id: z.string().min(1),
  versionId: z.string().min(1),
  version: z.number().int().positive(),
  recordedAt: IsoTimestampSchema,
  sources: z.array(LegalEntitySourceSummarySchema),
}).strict();

export const LegalEntityInventorySchema = z
  .object({
    version: z.literal(3),
    asOf: IsoTimestampSchema,
    entities: z.array(LegalEntityRecordSchema),
    candidates: z.array(LegalEntitySourceSummarySchema),
    excludedCandidates: z.array(LegalEntitySourceSummarySchema),
    exactBatch: LegalEntityExactBatchPreviewSchema,
  })
  .strict();

export const CreateLegalEntityInputSchema = z
  .object({
    profile: LegalEntityProfileInputSchema,
    source: z
      .object({
        reference: LegalEntitySourceReferenceSchema,
        expectedDecisionId: z.string().min(1).nullable(),
        nameResolution: LegalNameResolutionInputSchema.optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const UpdateLegalEntityInputSchema = z
  .object({
    expectedVersionId: z.string().min(1),
    profile: LegalEntityProfileInputSchema,
  })
  .strict();

export const ReviewLegalEntitySourceInputSchema = z
  .object({
    source: LegalEntitySourceReferenceSchema,
    expectedDecisionId: z.string().min(1).nullable(),
    nameResolution: LegalNameResolutionInputSchema.optional(),
    decision: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("linked"),
          legalEntityId: z.string().min(1),
        })
        .strict(),
      z.object({ kind: z.literal("not_llc") }).strict(),
    ]),
  })
  .strict();

export const LegalEntitySourceReviewResultSchema = z
  .object({
    version: z.literal(1),
    decisionId: z.string().min(1),
  })
  .strict();

export const LegalEntityExactBatchInputSchema = z
  .object({
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const LegalEntityExactBatchResultSchema = z
  .object({
    version: z.literal(1),
    reviewedSourceCount: z
      .number()
      .int()
      .positive()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    entityCount: z
      .number()
      .int()
      .positive()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    existingEntityCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    createdEntityCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES),
    remainingCandidateCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.existingEntityCount + value.createdEntityCount !==
      value.entityCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied legal entity counts must reconcile.",
        path: ["entityCount"],
      });
    }
    if (value.reviewedSourceCount < value.entityCount) {
      context.addIssue({
        code: "custom",
        message: "Each applied legal entity must have a source.",
        path: ["reviewedSourceCount"],
      });
    }
  });

export const LEGAL_ENTITY_EXPORT_FIELDS = [
  "legal_name",
  "source_record",
  "name_evidence",
  "entity_type",
  "relationship",
  "current_owner",
  "jurisdiction",
  "ownership_interest",
  "interest_status",
  "record_status",
  "source",
  "source_as_of",
  "missing_information",
  "formed_on",
  "ein_last_four",
  "tax_classification",
  "opened_on",
  "commitment",
  "funded",
  "current_value",
  "underlying_company",
  "company_evidence",
  "ownership_evidence",
  "fee_and_carry",
  "notes",
] as const;

export const LegalEntityExportFieldSchema = z.enum(LEGAL_ENTITY_EXPORT_FIELDS);

export const DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS = [
  "legal_name",
  "source_record",
  "name_evidence",
  "entity_type",
  "relationship",
  "current_owner",
  "jurisdiction",
  "ownership_interest",
  "interest_status",
  "record_status",
  "source",
  "source_as_of",
  "missing_information",
  "underlying_company",
  "ownership_evidence",
] as const satisfies readonly LegalEntityExportField[];

export const LEGAL_ENTITY_EXPORT_FIELD_LABELS: Readonly<
  Record<LegalEntityExportField, string>
> = {
  legal_name: "Legal name",
  source_record: "Source record",
  name_evidence: "Legal-name evidence",
  entity_type: "Entity type",
  relationship: "Relationship",
  current_owner: "Current titled owner",
  jurisdiction: "Formation jurisdiction",
  ownership_interest: "Ownership interest",
  interest_status: "Interest status",
  record_status: "Record status",
  source: "Source",
  source_as_of: "Source as of",
  missing_information: "Missing information",
  formed_on: "Formation date",
  ein_last_four: "EIN last four",
  tax_classification: "Tax classification",
  opened_on: "Acquired or opened",
  commitment: "Commitment",
  funded: "Funded amount",
  current_value: "Current value",
  underlying_company: "Underlying company",
  company_evidence: "Company mapping evidence",
  ownership_evidence: "Dated ownership evidence",
  fee_and_carry: "Reviewed fee and carry",
  notes: "Notes",
};

export const LegalEntityExportInputSchema = z
  .object({
    fields: z
      .array(LegalEntityExportFieldSchema)
      .min(1)
      .max(LEGAL_ENTITY_EXPORT_FIELDS.length)
      .superRefine((fields, context) => {
        if (new Set(fields).size !== fields.length) {
          context.addIssue({
            code: "custom",
            message: "Export fields must be unique.",
          });
        }
      }),
    includeNeedsReview: z.boolean(),
    includeHistorical: z.boolean(),
    includeOtherEntityTypes: z.boolean(),
  })
  .strict();

export const LegalEntityExportOptionsSchema = z
  .object({
    googleSheetsClientId: z
      .string()
      .max(256)
      .regex(/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/u)
      .nullable(),
  })
  .strict();

export const LegalEntityExportTableSchema = z
  .object({
    title: z.string().min(1).max(200),
    columns: z.array(z.string()).min(1).max(LEGAL_ENTITY_EXPORT_FIELDS.length),
    rows: z.array(z.array(z.string())),
  })
  .strict()
  .refine(
    (table) => table.rows.every((row) => row.length === table.columns.length),
    {
      message: "Every export row must match the selected columns.",
    },
  );

export type LegalEntityExportTable = z.infer<
  typeof LegalEntityExportTableSchema
>;

export function exactLegalEntityTypeFromName(
  rawValue: string,
): ExactLegalEntityType | null {
  const value = rawValue.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    /(?:^|[\s,])(?:P\.?\s*L\.?\s*L\.?\s*C\.?|L\.?\s*L\.?\s*C\.?|LIMITED LIABILITY COMPANY)\.?$/iu.test(
      value,
    )
  ) {
    return "llc";
  }
  if (/(?:^|[\s,])(?:L\.?\s*P\.?|LIMITED PARTNERSHIP)\.?$/iu.test(value)) {
    return "limited_partnership";
  }
  return null;
}

export function ownershipPercentTextToPpm(rawValue: string): number | null {
  const value = rawValue.trim();
  if (value.length === 0) {
    return null;
  }
  const match = /^(100(?:\.0{1,4})?|\d{1,2}(?:\.\d{1,4})?)$/u.exec(value);
  if (match === null) {
    throw new Error("Enter an ownership percentage from 0 to 100.");
  }
  const [wholeText = "0", fractionText = ""] = value.split(".");
  const ppm =
    Number.parseInt(wholeText, 10) * 10_000 +
    Number.parseInt(fractionText.padEnd(4, "0") || "0", 10);
  if (ppm > 1_000_000) {
    throw new Error("Enter an ownership percentage from 0 to 100.");
  }
  return ppm;
}

export function formatOwnershipInterestPpm(ppm: number): string {
  const parsed = z.number().int().min(0).max(1_000_000).parse(ppm);
  const whole = Math.floor(parsed / 10_000);
  const fraction = String(parsed % 10_000)
    .padStart(4, "0")
    .replace(/0+$/u, "");
  return `${whole}${fraction.length === 0 ? "" : `.${fraction}`}%`;
}

export type LegalEntityType = z.infer<typeof LegalEntityTypeSchema>;
export type LegalNameResolutionInput = z.infer<
  typeof LegalNameResolutionInputSchema
>;
export type LegalNameResolution = z.infer<typeof LegalNameResolutionSchema>;
export type ExactLegalEntityType = z.infer<typeof ExactLegalEntityTypeSchema>;
export type LegalEntityRelationship = z.infer<
  typeof LegalEntityRelationshipSchema
>;
export type LegalEntityInterestStatus = z.infer<
  typeof LegalEntityInterestStatusSchema
>;
export type LegalEntitySourceReference = z.infer<
  typeof LegalEntitySourceReferenceSchema
>;
export type LegalEntitySourceSummary = z.infer<
  typeof LegalEntitySourceSummarySchema
>;
export type LegalEntityProfileInput = z.infer<
  typeof LegalEntityProfileInputSchema
>;
export type LegalEntityRecord = z.infer<typeof LegalEntityRecordSchema>;
export type LegalEntityInventory = z.infer<typeof LegalEntityInventorySchema>;
export type CreateLegalEntityInput = z.infer<
  typeof CreateLegalEntityInputSchema
>;
export type UpdateLegalEntityInput = z.infer<
  typeof UpdateLegalEntityInputSchema
>;
export type ReviewLegalEntitySourceInput = z.infer<
  typeof ReviewLegalEntitySourceInputSchema
>;
export type LegalEntitySourceReviewResult = z.infer<
  typeof LegalEntitySourceReviewResultSchema
>;
export type LegalEntityExactBatchPreview = z.infer<
  typeof LegalEntityExactBatchPreviewSchema
>;
export type LegalEntityExactBatchInput = z.infer<
  typeof LegalEntityExactBatchInputSchema
>;
export type LegalEntityExactBatchResult = z.infer<
  typeof LegalEntityExactBatchResultSchema
>;
export type LegalEntityExportField = z.infer<
  typeof LegalEntityExportFieldSchema
>;
export type LegalEntityExportInput = z.infer<
  typeof LegalEntityExportInputSchema
>;

export function legalEntityReviewKind(source: LegalEntitySourceSummary) {
  const evidence = source.legalEntityNameEvidence;
  if (evidence.state !== "unavailable") return "found" as const;
  // Historical conflicts remain reviewable; new document-backed paths require
  // an explicit clean verdict. A blocked agreement is never a review choice.
  if (evidence.problem === "conflicting") return "conflict" as const;
  const readable = evidence.documents?.some(
    (document) => document.scan?.outcome === "clean",
  );
  if (readable && evidence.problem === "other_structure")
    return "structure" as const;
  if (
    readable &&
    [
      "name_not_found",
      "unreadable",
      "limit_reached",
      "extractor_unavailable",
    ].includes(evidence.problem ?? "")
  )
    return "document" as const;
  return "waiting" as const;
}

export function compareLegalEntityAttention(
  left: LegalEntitySourceSummary,
  right: LegalEntitySourceSummary,
): number {
  const rank = { document: 0, structure: 0, conflict: 1, found: 2, waiting: 3 };
  return (
    rank[legalEntityReviewKind(left)] - rank[legalEntityReviewKind(right)] ||
    (
      left.legalEntityNameEvidence.legalName ?? left.sourceDisplayName
    ).localeCompare(
      right.legalEntityNameEvidence.legalName ?? right.sourceDisplayName,
    ) ||
    left.source.kind.localeCompare(right.source.kind) ||
    left.source.id.localeCompare(right.source.id)
  );
}
