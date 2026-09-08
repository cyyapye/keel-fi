import { z } from "zod";

import { PositionEconomicsContextSchema } from "./position-economics";
import { LegalNameDocumentReferenceSchema } from "./provider-legal-documents";

const Id = z.string().min(1).max(500);
const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const Percent = z.number().int().min(0).max(1_000_000).nullable();
const OptionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();

// Participation is a fact about a position, never the legal entity's lifecycle.
export const InvestmentParticipationSchema = z.enum([
  "pending",
  "current",
  "historical",
  "cancelled",
  "unknown",
]);

export const InvestmentOwnershipInputSchema = z
  .object({
    sourceKind: z.enum(["agreement", "k1", "user_reported"]),
    sourceLabel: z.string().trim().min(1).max(240),
    effectiveDate: z.iso.date().nullable(),
    taxYear: z.number().int().min(1900).max(9999).nullable(),
    ownershipPpm: Percent,
    profitBeginningPpm: Percent,
    profitEndingPpm: Percent,
    lossBeginningPpm: Percent,
    lossEndingPpm: Percent,
    capitalBeginningPpm: Percent,
    capitalEndingPpm: Percent,
    documentId: z.string().uuid().nullable(),
    page: z.number().int().min(1).max(150).nullable(),
    quote: OptionalText(2_000),
    supersedesObservationId: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const shares = [
      value.profitBeginningPpm,
      value.profitEndingPpm,
      value.lossBeginningPpm,
      value.lossEndingPpm,
      value.capitalBeginningPpm,
      value.capitalEndingPpm,
    ];
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
    if (value.sourceKind === "k1") {
      if (value.taxYear === null) issue("taxYear", "Enter the K-1 tax year.");
      if (value.ownershipPpm !== null)
        issue(
          "ownershipPpm",
          "Keep the K-1 profit, loss, and capital shares separate.",
        );
      if (shares.every((share) => share === null))
        issue(
          "capitalEndingPpm",
          "Enter at least one share reported on the K-1.",
        );
    } else {
      if (value.taxYear !== null || shares.some((share) => share !== null))
        issue("taxYear", "Tax-year shares belong to a K-1 observation.");
      if (value.ownershipPpm === null)
        issue("ownershipPpm", "Enter the reported ownership percentage.");
      if (value.effectiveDate === null)
        issue(
          "effectiveDate",
          "Enter the date for this ownership observation.",
        );
    }
    if (value.documentId !== null && value.page === null)
      issue("page", "Enter the supporting document page.");
    if (
      value.documentId === null &&
      (value.page !== null || value.quote !== null)
    )
      issue("documentId", "Choose the document for this citation.");
    if (value.sourceKind === "agreement" && value.documentId === null)
      issue("documentId", "Choose the supporting agreement.");
  });

export const InvestmentOwnershipObservationSchema =
  InvestmentOwnershipInputSchema.safeExtend({
    id: z.string().uuid(),
    recordedAt: z.iso.datetime({ offset: true }),
    // A typed/transcribed K-1 is not advertised as a verified stored document.
    evidenceBasis: z.enum(["document_review", "user_reported"]),
    documentSha256: Digest.nullable(),
  });

export const InvestmentDocumentAssignmentSchema = z
  .object({
    documentId: z.string().uuid(),
    sha256: Digest,
    relationship: z.enum([
      "supports",
      "general",
      "other_investment",
      "unassigned",
    ]),
    targetPositionId: Id.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.relationship === "other_investment"
        ? value.targetPositionId !== null
        : value.targetPositionId === null,
    "Choose the other investment, or leave this agreement unassigned.",
  );

export const InvestmentReviewStateSchema = z
  .object({
    id: z.string().uuid(),
    positionId: Id,
    version: z.number().int().positive(),
    participationStatus: InvestmentParticipationSchema,
    ownershipObservations: z
      .array(InvestmentOwnershipObservationSchema)
      .max(100),
    documentAssignments: z.array(InvestmentDocumentAssignmentSchema).max(100),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const ReviewInvestmentInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedReviewId: z.string().uuid().nullable(),
    expectedSnapshotId: Id.nullable(),
    expectedEvidenceRevision: Digest,
    participationStatus: InvestmentParticipationSchema,
    ownershipObservation: InvestmentOwnershipInputSchema.optional(),
    documentAssignments: z
      .array(InvestmentDocumentAssignmentSchema)
      .max(6)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.documentAssignments === undefined ||
      new Set(value.documentAssignments.map((item) => item.documentId)).size ===
        value.documentAssignments.length,
    "Review each agreement only once.",
  );

export const UnderlyingCompanyChoiceSchema = z
  .object({
    documentId: z.string().uuid(),
    sha256: Digest,
    companyName: z.string().trim().min(1).max(1_000),
    page: z.number().int().min(1).max(150),
    quote: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .refine(
    (value) =>
      value.quote
        .replace(/\s+/gu, " ")
        .includes(value.companyName.replace(/\s+/gu, " ")),
    "Include the exact company name in the excerpt.",
  );

export const CreateDocumentInvestmentInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedReviewId: z.string().uuid().nullable(),
    expectedSnapshotId: Id.nullable(),
    expectedEvidenceRevision: Digest,
    documentIds: z.array(z.string().uuid()).min(1).max(6),
    label: z.string().trim().min(1).max(1_000),
    participationStatus: z.enum(["pending", "cancelled", "unknown"]),
  })
  .strict()
  .refine(
    (value) => new Set(value.documentIds).size === value.documentIds.length,
    "Choose each document once.",
  );
export type CreateDocumentInvestmentInput = z.infer<
  typeof CreateDocumentInvestmentInputSchema
>;

export const InvestmentCompanyReviewInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedSnapshotId: Id.nullable(),
    expectedEvidenceRevision: Digest,
    expectedMappingIds: z.array(Id).max(100),
    company: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), companyId: Id }).strict(),
      z
        .object({
          mode: z.literal("new"),
          legalName: z.string().trim().min(1).max(1_000),
        })
        .strict(),
    ]),
    basis: z.enum(["document_choice", "document_correction", "user_confirmed"]),
    citation: UnderlyingCompanyChoiceSchema.nullable(),
    reason: OptionalText(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.basis === "user_confirmed") !== (value.citation === null))
      context.addIssue({
        code: "custom",
        path: ["citation"],
        message: "Choose the evidence for this company mapping.",
      });
    if (value.basis === "document_correction" && value.reason === null)
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Explain the correction to the reported company.",
      });
    if (
      new Set(value.expectedMappingIds).size !== value.expectedMappingIds.length
    )
      context.addIssue({
        code: "custom",
        path: ["expectedMappingIds"],
        message: "Mapping references must be distinct.",
      });
  });

export const InvestmentCompanyReceiptSchema =
  InvestmentCompanyReviewInputSchema.safeExtend({
    positionId: Id,
    companyId: Id,
    companyName: z.string().min(1).max(1_000),
    mappingId: Id,
    recordedAt: z.iso.datetime({ offset: true }),
    sourceDocument: LegalNameDocumentReferenceSchema.nullable(),
  });

export const InvestmentReviewContextSchema = z
  .object({
    positionId: Id,
    positionLabel: z.string().min(1).max(1_000),
    holderLabel: z.string().min(1).max(1_000),
    snapshotId: Id.nullable(),
    committedMinor: z.number().int().safe().nonnegative().nullable(),
    fundedMinor: z.number().int().safe().nonnegative().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    economics: PositionEconomicsContextSchema.nullable(),
    review: InvestmentReviewStateSchema.nullable(),
    defaultParticipationStatus: InvestmentParticipationSchema,
    // This is a review projection, not a PDF download/parse batch. Each capture
    // still has its original six-document security and resource budget.
    documents: z.array(LegalNameDocumentReferenceSchema).max(100),
    evidenceRevision: Digest,
    companyChoices: z.array(UnderlyingCompanyChoiceSchema).max(800),
    companies: z
      .array(
        z.object({ id: Id, legalName: z.string().min(1).max(1_000) }).strict(),
      )
      .max(5_000),
    mappings: z
      .array(
        z
          .object({
            id: Id,
            companyId: Id.nullable(),
            companyName: z.string().min(1).max(1_000),
            status: z.enum(["active", "withdrawn"]),
            decisionSource: z.string().nullable().optional(),
            acceptedAt: z.iso.datetime({ offset: true }).nullable().optional(),
          })
          .strict(),
      )
      .max(100),
    companyReceipt: InvestmentCompanyReceiptSchema.nullable(),
    // Potential assignment targets contain identifiers/labels, never copied money.
    otherPositions: z
      .array(z.object({ id: Id, label: z.string().min(1).max(1_000) }).strict())
      .max(5_000),
  })
  .strict();

export const CreateDocumentInvestmentResultSchema = z
  .object({ positionId: Id })
  .strict();

export type InvestmentParticipation = z.infer<
  typeof InvestmentParticipationSchema
>;
export type InvestmentOwnershipInput = z.infer<
  typeof InvestmentOwnershipInputSchema
>;
export type InvestmentReviewState = z.infer<typeof InvestmentReviewStateSchema>;
export type ReviewInvestmentInput = z.infer<typeof ReviewInvestmentInputSchema>;
export type InvestmentReviewContext = z.infer<
  typeof InvestmentReviewContextSchema
>;
export type InvestmentCompanyReviewInput = z.infer<
  typeof InvestmentCompanyReviewInputSchema
>;
export type InvestmentCompanyReceipt = z.infer<
  typeof InvestmentCompanyReceiptSchema
>;

export async function investmentEvidenceRevision(
  value: unknown,
): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}
