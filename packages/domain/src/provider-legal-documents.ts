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
export const LEGAL_DOCUMENT_EXTRACTOR_VERSION = 5;
export const MAX_LEGAL_NAME_CITATIONS_PER_DOCUMENT = 8;
export const LEGAL_DOCUMENT_RECHECK_MS = 7 * 24 * 60 * 60 * 1_000;
export const LEGAL_DOCUMENT_SCANNER_VERSION = 2;

export const LegalDocumentScanReasonSchema = z.enum([
  "malware_signature",
  "encrypted",
  "scan_limit",
  "broken_executable",
  "heuristic",
  "unknown_alert",
]);
export type LegalDocumentScanReason = z.infer<
  typeof LegalDocumentScanReasonSchema
>;

export function legalDocumentScanReason(
  signature: string | null,
): LegalDocumentScanReason {
  if (signature === null) return "unknown_alert";
  if (signature.startsWith("Heuristics.Encrypted.")) return "encrypted";
  if (
    signature === "Heuristics.Limits.Exceeded" ||
    signature.startsWith("Heuristics.Limits.Exceeded.")
  )
    return "scan_limit";
  if (signature.startsWith("Heuristics.Broken.")) return "broken_executable";
  if (signature.startsWith("Heuristics.")) return "heuristic";
  return "malware_signature";
}

export const LegalDocumentScanFindingSchema = z
  .object({
    reason: LegalDocumentScanReasonSchema,
    // A scanner signature token, never a filename, URL, excerpt or raw output.
    signature: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/u)
      .nullable(),
  })
  .strict()
  .refine(
    (finding) => finding.reason === legalDocumentScanReason(finding.signature),
    "The reason must match the scanner signature.",
  );

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
// SQLite orders the latest scan lexically. Canonicalize equivalent ISO forms
// (including the scanner's microseconds) before hashing or persisting a capture.
const ScanTimeSchema = z.iso
  .datetime()
  .transform((value) => new Date(value).toISOString());
const LegalDocumentScanBaseSchema = z
  .object({
    engineVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/u),
    databaseVersion: z.number().int().positive(),
    databaseUpdatedAt: ScanTimeSchema,
    scannedAt: ScanTimeSchema,
    sha256: DigestSchema,
    outcome: z.enum(["clean", "blocked"]),
  })
  .strict();
export const LegalDocumentScanSchema = z
  .discriminatedUnion("version", [
    LegalDocumentScanBaseSchema.extend({ version: z.literal(1) }),
    LegalDocumentScanBaseSchema.extend({
      version: z.literal(LEGAL_DOCUMENT_SCANNER_VERSION),
      findings: z.array(LegalDocumentScanFindingSchema).max(8),
    }).superRefine((scan, context) => {
      if (
        (scan.outcome === "clean") !== (scan.findings.length === 0) ||
        new Set(scan.findings.map((finding) => finding.signature)).size !==
          scan.findings.length
      )
        context.addIssue({
          code: "custom",
          message: "Scan findings do not match the outcome.",
        });
    }),
  ])
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

const LegalDocumentNamedExcerptSchema = z
  .object({
    legalName: z.string().trim().min(1).max(1_000),
    page: z.number().int().min(1).max(MAX_LEGAL_DOCUMENT_PAGES),
    quote: z.string().trim().min(1).max(2_000),
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

export const LegalDocumentCitationSchema =
  LegalDocumentNamedExcerptSchema.safeExtend({
    role: z.enum(["issuer", "fund", "company_agreement", "series"]),
  });

// A target-company claim is distinct from the fund/issuer legal name. Merely
// mentioning a company in a risk factor or comparable-company table is not one.
export const UnderlyingCompanyCitationSchema = z
  .object({
    companyName: z.string().trim().min(1).max(1_000),
    role: z.enum(["underlying_company", "target_company", "portfolio_company"]),
    page: z.number().int().min(1).max(MAX_LEGAL_DOCUMENT_PAGES),
    quote: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .refine(
    (value) =>
      value.quote
        .replace(/\s+/gu, " ")
        .includes(value.companyName.replace(/\s+/gu, " ")),
    "The citation must contain the exact reported company name.",
  );

// Party names describe the agreement, not an assertion of direct ownership.
export const LegalDocumentStructureSchema = z
  .object({
    kind: z.literal("compartment"),
    page: z.number().int().min(1).max(MAX_LEGAL_DOCUMENT_PAGES),
    quote: z.string().trim().min(1).max(2_000),
    parties: z
      .array(
        LegalDocumentNamedExcerptSchema.safeExtend({
          role: z.enum(["compartment", "issuer", "representative"]),
        }),
      )
      .max(MAX_LEGAL_NAME_CITATIONS_PER_DOCUMENT),
    instrument: z
      .object({
        label: z.literal("Equity certificates"),
        page: z.number().int().min(1).max(MAX_LEGAL_DOCUMENT_PAGES),
        quote: z.string().trim().min(1).max(2_000),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const LegalDocumentExtractionSchema = z
  .object({
    // Existing immutable observations remain readable during rollout. The
    // collector rechecks older extractions under its ordinary run budget.
    version: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(LEGAL_DOCUMENT_EXTRACTOR_VERSION),
    ]),
    pageCount: z.number().int().min(0).max(MAX_LEGAL_DOCUMENT_PAGES),
    problem: LegalDocumentProblemSchema.nullable(),
    citations: z
      .array(LegalDocumentCitationSchema)
      .max(MAX_LEGAL_NAME_CITATIONS_PER_DOCUMENT),
    structure: LegalDocumentStructureSchema.optional(),
    companyCitations: z
      .array(UnderlyingCompanyCitationSchema)
      .max(8)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const names = new Set(
      value.citations.map((citation) => citation.legalName),
    );
    const validState =
      value.problem === null
        ? names.size === 1
        : value.problem === "conflicting"
          ? names.size > 1 ||
            (value.version < 3 && value.citations.length === 0)
          : value.citations.length === 0;
    if (
      !validState ||
      ((value.companyCitations?.length ?? 0) > 0 &&
        (value.version < 5 ||
          value.problem === "security_blocked" ||
          value.problem === "scanner_unavailable" ||
          value.companyCitations?.some(
            (citation) => citation.page > value.pageCount,
          ))) ||
      value.citations.some((citation) => citation.page > value.pageCount) ||
      (value.structure !== undefined &&
        (value.version < 4 ||
          value.problem !== "other_structure" ||
          value.structure.page > value.pageCount ||
          value.structure.parties.some(
            (party) => party.page > value.pageCount,
          ) ||
          (value.structure.instrument !== null &&
            value.structure.instrument.page > value.pageCount)))
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

export const SourceInvestmentReferenceSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/u),
    association: z.enum([
      "investment_page",
      "document_investment_id",
      "display_label",
    ]),
  })
  .strict();

export const ProviderLegalDocumentCaptureSchema = z
  .object({
    version: z.literal(1),
    naturalKeySha256: DigestSchema,
    ownershipLabel: z.string().trim().min(1).max(1_000),
    sourceInvestment: SourceInvestmentReferenceSchema.optional(),
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
    "Keel did not extract an exact vehicle name. Review the agreement and enter its exact name and page.",
  conflicting:
    "Compare the names reported in the agreements and choose the one for this investment.",
  limit_reached:
    "The agreement check reached its safety limit. Another source update can continue; oversized documents need a smaller searchable copy.",
  extractor_unavailable:
    "The document reader is unavailable. The source agent needs its PDF reader installed.",
  page_changed:
    "The provider's document page could not be read. Its capture support needs an update.",
  other_structure:
    "The agreement describes a compartment structure. Review the named parties and the interest; a representative is not automatically the entity you invested in.",
  security_blocked:
    "The agreement is blocked by its security check. See the agreement details for the reason and next step.",
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
    // Optional for previously saved references; never infer names from quotes.
    citations: z
      .array(LegalDocumentCitationSchema)
      .max(MAX_LEGAL_NAME_CITATIONS_PER_DOCUMENT)
      .optional(),
    structure: LegalDocumentStructureSchema.optional(),
    companyCitations: z
      .array(UnderlyingCompanyCitationSchema)
      .max(8)
      .optional(),
    extractorVersion: z
      .number()
      .int()
      .min(1)
      .max(LEGAL_DOCUMENT_EXTRACTOR_VERSION)
      .optional(),
    extractionProblem: LegalDocumentProblemSchema.nullable().optional(),
    scan: LegalDocumentScanSchema.optional(),
    provider: z.enum(["sydecar", "tokenfolio"]).optional(),
    sourceInvestment: SourceInvestmentReferenceSchema.optional(),
    observedAt: z.iso.datetime().optional(),
  })
  .strict()
  .refine(
    (document) =>
      document.scan === undefined || document.scan.sha256 === document.sha256,
    "The scan must describe this agreement's exact bytes.",
  );

export const LEGAL_DOCUMENT_SCAN_REASON_COPY: Record<
  LegalDocumentScanReason,
  { label: string; detail: string }
> = {
  encrypted: {
    label: "Encrypted content",
    detail:
      "The scanner could not inspect encrypted content in this agreement. Request an unencrypted copy from the provider.",
  },
  scan_limit: {
    label: "Scan limit reached",
    detail:
      "The security check exceeded a scanning limit. This does not establish malware. Keel needs to investigate the limit before releasing the agreement.",
  },
  malware_signature: {
    label: "Scanner threat match",
    detail:
      "The scanner reported a threat match. Keep this agreement blocked while the match is investigated or request a replacement from the provider.",
  },
  broken_executable: {
    label: "Suspicious embedded content",
    detail:
      "The scanner flagged broken executable content. Keep this agreement blocked and request a replacement or an investigation.",
  },
  heuristic: {
    label: "Suspicious content",
    detail:
      "The scanner raised a heuristic alert. It needs investigation; this is not a confirmed malware diagnosis.",
  },
  unknown_alert: {
    label: "Alert reason unavailable",
    detail:
      "The earlier check did not retain a usable alert reason. Recheck this agreement to get a specific result.",
  },
};
