import { z } from "zod";

// These limits apply on both sides of the agent boundary. Documents are private
// evidence, not authority to change a holding or accept a legal entity.
export const MAX_LEGAL_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_LEGAL_DOCUMENT_PAGES = 150;
export const MAX_LEGAL_DOCUMENT_TEXT_BYTES = 1024 * 1024;
export const MAX_LEGAL_DOCUMENTS_PER_POSITION = 6;
export const MAX_LEGAL_DOCUMENTS_PER_RUN = 24;
export const MAX_LEGAL_DOCUMENT_RUN_BYTES = 64 * 1024 * 1024;
export const MAX_LEGAL_DOCUMENT_POSITION_BYTES = 16 * 1024 * 1024;
export const LEGAL_DOCUMENT_EXTRACTOR_VERSION = 2;
export const LEGAL_DOCUMENT_RECHECK_MS = 7 * 24 * 60 * 60 * 1_000;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
// SQLite orders the latest scan lexically. Canonicalize equivalent ISO forms
// (including the scanner's microseconds) before hashing or persisting a capture.
const ScanTimeSchema = z.iso
  .datetime()
  .transform((value) => new Date(value).toISOString());
export const LegalDocumentScanSchema = z
  .object({
    version: z.literal(1),
    engineVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/u),
    databaseVersion: z.number().int().positive(),
    databaseUpdatedAt: ScanTimeSchema,
    scannedAt: ScanTimeSchema,
    sha256: DigestSchema,
    outcome: z.enum(["clean", "blocked"]),
  })
  .strict()
  .refine((scan) => {
    const age = Date.parse(scan.scannedAt) - Date.parse(scan.databaseUpdatedAt);
    return age >= 0 && age <= 72 * 60 * 60 * 1_000;
  }, "The signature database must be fresh when the scan runs.");
export type LegalDocumentScan = z.infer<typeof LegalDocumentScanSchema>;
export const LegalDocumentProblemSchema = z.enum([
  "not_checked",
  "missing",
  "inaccessible",
  "unreadable",
  "name_not_found",
  "conflicting",
  "limit_reached",
  "extractor_unavailable",
  "page_changed",
  "other_structure",
  "security_blocked",
  "scanner_unavailable",
]);

export const LegalDocumentCitationSchema = z
  .object({
    legalName: z.string().trim().min(1).max(1_000),
    page: z.number().int().min(1).max(MAX_LEGAL_DOCUMENT_PAGES),
    quote: z.string().trim().min(1).max(2_000),
    role: z.enum(["issuer", "fund", "company_agreement", "series"]),
  })
  .strict()
  .superRefine((citation, context) => {
    // Whitespace is the only permitted normalization of the verbatim name.
    const whitespace = (value: string) => value.replace(/\s+/gu, " ").trim();
    if (!whitespace(citation.quote).includes(whitespace(citation.legalName))) {
      context.addIssue({
        code: "custom",
        message: "The citation must contain the exact reported name.",
      });
    }
  });

export const LegalDocumentExtractionSchema = z
  .object({
    // Existing immutable observations remain readable during rollout. The
    // collector rechecks older extractions under its ordinary run budget.
    version: z.union([
      z.literal(1),
      z.literal(LEGAL_DOCUMENT_EXTRACTOR_VERSION),
    ]),
    pageCount: z.number().int().min(0).max(MAX_LEGAL_DOCUMENT_PAGES),
    problem: LegalDocumentProblemSchema.nullable(),
    citations: z.array(LegalDocumentCitationSchema).max(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.problem === null) !== value.citations.length > 0 ||
      value.citations.some((citation) => citation.page > value.pageCount)
    ) {
      context.addIssue({
        code: "custom",
        message: "Document extraction state does not match its citations.",
      });
    }
  });

export const CapturedLegalDocumentSchema = z
  .object({
    // Hash of provider-owned document identity; never a bearer download URL.
    documentKey: DigestSchema,
    sha256: DigestSchema,
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine(
        (name) =>
          !name.includes("/") &&
          !name.includes("\\") &&
          ![...name].some((character) => character.charCodeAt(0) < 32),
      ),
    byteSize: z.number().int().positive().max(MAX_LEGAL_DOCUMENT_BYTES),
    checkedAt: z.iso.datetime(),
    extraction: LegalDocumentExtractionSchema,
    // Optional only to keep historical immutable captures readable. Absence
    // never grants download permission or permits new PDF extraction.
    scan: LegalDocumentScanSchema.optional(),
  })
  .strict()
  .refine(
    (document) =>
      document.scan === undefined ||
      (document.scan.sha256 === document.sha256 &&
        Date.parse(document.scan.scannedAt) <=
          Date.parse(document.checkedAt) + 60_000 &&
        (document.scan.outcome === "clean" ||
          (document.extraction.problem === "security_blocked" &&
            document.extraction.citations.length === 0))),
    "The scan must describe these exact bytes and block extraction when unsafe.",
  );

export const ProviderLegalDocumentCaptureSchema = z
  .object({
    version: z.literal(1),
    naturalKeySha256: DigestSchema,
    ownershipLabel: z.string().trim().min(1).max(1_000),
    problem: LegalDocumentProblemSchema.nullable(),
    documents: z
      .array(CapturedLegalDocumentSchema)
      .max(MAX_LEGAL_DOCUMENTS_PER_POSITION),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.documents.map((document) => document.documentKey)).size !==
        value.documents.length ||
      value.documents.reduce(
        (total, document) => total + document.byteSize,
        0,
      ) > MAX_LEGAL_DOCUMENT_POSITION_BYTES ||
      (value.documents.length === 0 && value.problem === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A capture must have distinct documents or an explicit unavailable reason.",
      });
    }
  });

export const StoredLegalDocumentSchema = CapturedLegalDocumentSchema.safeExtend(
  {
    id: z.string().uuid(),
  },
).strict();

export const ProviderLegalDocumentManifestSchema = z
  .object({
    version: z.literal(1),
    captures: z
      .array(
        ProviderLegalDocumentCaptureSchema.safeExtend({
          documents: z
            .array(StoredLegalDocumentSchema)
            .max(MAX_LEGAL_DOCUMENTS_PER_POSITION),
        }),
      )
      .max(500),
  })
  .strict();

export const LEGAL_DOCUMENT_PROBLEM_COPY: Record<
  z.infer<typeof LegalDocumentProblemSchema>,
  string
> = {
  not_checked:
    "Agreements have not been checked yet. Queue a source update to check them.",
  missing:
    "No agreement was available for this investment. Request the subscription or operating agreement from the provider.",
  inaccessible:
    "The agreement could not be downloaded. Check document access with the provider, then queue another update.",
  unreadable:
    "The agreement could not be read. Request a searchable PDF from the provider.",
  name_not_found:
    "The agreement did not explicitly identify the investment vehicle. Request its exact legal name from the provider.",
  conflicting:
    "The agreements report different vehicle names. Confirm the correct name with the provider or your lawyer.",
  limit_reached:
    "The agreement check reached its safety limit. Another source update can continue; oversized documents need a smaller searchable copy.",
  extractor_unavailable:
    "The document reader is unavailable. The source agent needs its PDF reader installed.",
  page_changed:
    "The provider's document page could not be read. Its capture support needs an update.",
  other_structure:
    "The agreement describes a compartment or certificate structure. Ask the provider or your lawyer which legal entity and interest belong in this inventory.",
  security_blocked:
    "The agreement did not pass its security check. It is kept private and cannot be downloaded or read. Request a new copy from the provider.",
  scanner_unavailable:
    "The agreement's security check could not finish. It is kept private until a source update can check it again.",
};

export type LegalDocumentProblem = z.infer<typeof LegalDocumentProblemSchema>;
export type LegalDocumentCitation = z.infer<typeof LegalDocumentCitationSchema>;
export type LegalDocumentExtraction = z.infer<
  typeof LegalDocumentExtractionSchema
>;
export type CapturedLegalDocument = z.infer<typeof CapturedLegalDocumentSchema>;
export type StoredLegalDocument = z.infer<typeof StoredLegalDocumentSchema>;
export type ProviderLegalDocumentCapture = z.infer<
  typeof ProviderLegalDocumentCaptureSchema
>;
export type ProviderLegalDocumentManifest = z.infer<
  typeof ProviderLegalDocumentManifestSchema
>;

export const LegalNameDocumentReferenceSchema = z
  .object({
    id: z.string().uuid(),
    fileName: z.string().trim().min(1).max(240),
    sha256: DigestSchema,
    page: z.number().int().min(1).max(MAX_LEGAL_DOCUMENT_PAGES).nullable(),
    quote: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();
