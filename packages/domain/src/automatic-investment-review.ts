import { z } from "zod";
import type { LegalEntityNameEvidence } from "./position-read-model";
import type { InvestmentReviewContext } from "./investment-review";
import type { LegalNameDocumentReference } from "./provider-legal-documents";
import {
  AcceptPositionEconomicsInputSchema,
  calculatePositionEconomics,
  type AcceptPositionEconomicsInput,
  type PositionEconomicsContext,
  type ReportedPositionEconomicsTerms,
} from "./position-economics";

export const INVESTMENT_REVIEW_POLICY = "investment-review-auto-v1";
export const AUTOMATIC_INVESTMENT_BATCH_SIZE = 120;
export const AutomaticReviewSectionSchema = z.enum([
  "identity",
  "company",
  "participation",
  "economics",
  "documents",
]);
export type AutomaticReviewSection = z.infer<
  typeof AutomaticReviewSectionSchema
>;
export const AutomaticReviewIssueSchema = z
  .object({
    section: AutomaticReviewSectionSchema,
    code: z.enum([
      "missing",
      "conflicting",
      "unsupported",
      "ambiguous_identity",
      "stale",
      "document_check",
    ]),
    message: z.string().min(1).max(500),
  })
  .strict();
export type AutomaticReviewIssue = z.infer<typeof AutomaticReviewIssueSchema>;
export const AutomaticInvestmentReviewSchema = z
  .object({
    id: z.string().uuid(),
    policyVersion: z.literal(INVESTMENT_REVIEW_POLICY),
    snapshotId: z.string().min(1),
    evaluatedAt: z.iso.datetime({ offset: true }),
    resolved: z.array(AutomaticReviewSectionSchema).max(5),
    issues: z.array(AutomaticReviewIssueSchema).max(10),
  })
  .strict();
export type AutomaticInvestmentReview = z.infer<
  typeof AutomaticInvestmentReviewSchema
>;
export const ResolveInvestmentReviewsInputSchema = z
  .object({
    afterPositionId: z.string().min(1).max(500).nullable().default(null),
  })
  .strict();
export const ResolveInvestmentReviewsResultSchema = z
  .object({
    processedCount: z
      .number()
      .int()
      .min(0)
      .max(AUTOMATIC_INVESTMENT_BATCH_SIZE),
    changedCount: z.number().int().min(0).max(AUTOMATIC_INVESTMENT_BATCH_SIZE),
    resolvedCount: z.number().int().min(0).max(AUTOMATIC_INVESTMENT_BATCH_SIZE),
    exceptionCount: z
      .number()
      .int()
      .min(0)
      .max(AUTOMATIC_INVESTMENT_BATCH_SIZE),
    nextPositionId: z.string().min(1).max(500).nullable(),
  })
  .strict();
export type ResolveInvestmentReviewsResult = z.infer<
  typeof ResolveInvestmentReviewsResultSchema
>;

export function issue(
  section: AutomaticReviewSection,
  code: AutomaticReviewIssue["code"],
  message: string,
): AutomaticReviewIssue {
  return { section, code, message };
}

export function automaticLegalName(
  evidence: LegalEntityNameEvidence,
): string | null {
  if (evidence.state === "unavailable") return null;
  const documents = evidence.documents ?? [];
  if (
    documents.some(
      (doc) =>
        doc.scan?.outcome === "clean" &&
        doc.citations?.some(
          (citation) => citation.legalName !== evidence.legalName,
        ),
    )
  )
    return null;
  if (evidence.state === "provider_reported") return evidence.legalName;
  if (
    documents.length === 0 ||
    documents.some(
      (doc) =>
        doc.scan?.outcome !== "clean" ||
        (doc.extractionProblem != null &&
          doc.extractionProblem !== "name_not_found"),
    )
  )
    return null;
  const names = new Set(
    documents.flatMap(
      (doc) => doc.citations?.map((citation) => citation.legalName) ?? [],
    ),
  );
  return names.size === 1 && names.has(evidence.legalName)
    ? evidence.legalName
    : null;
}

export function automaticCompanyChoice(
  documents: readonly LegalNameDocumentReference[],
): InvestmentReviewContext["companyChoices"][number] | null {
  if (documents.some((doc) => doc.scan?.outcome !== "clean")) return null;
  const choices = documents.flatMap((doc) =>
    (doc.companyCitations ?? []).map((citation) => ({
      documentId: doc.id,
      sha256: doc.sha256,
      companyName: citation.companyName,
      page: citation.page,
      quote: citation.quote,
    })),
  );
  return new Set(choices.map((choice) => choice.companyName)).size === 1
    ? choices[0]!
    : null;
}

/** Missing fields remain missing; only a complete, reconciled contract changes capital. */
export function automaticEconomics(
  context: PositionEconomicsContext,
  documents: readonly LegalNameDocumentReference[],
): {
  input: AcceptPositionEconomicsInput | null;
  issue: AutomaticReviewIssue | null;
  reported: ReportedPositionEconomicsTerms | null;
} {
  const citations = documents
    .filter((doc) => doc.scan?.outcome === "clean")
    .flatMap((doc) => doc.economicsCitations ?? []);
  const values = (field: string) => [
    ...new Set(
      citations
        .filter((citation) => citation.field === field)
        .map((citation) => citation.value),
    ),
  ];
  const one = (field: string) =>
    values(field).length === 1 ? values(field)[0]! : null;
  const reportedManagement = context.reportedTerms?.managementFeePpm ?? null;
  const reportedCarry = context.reportedTerms?.carryPpm ?? null;
  const managementFeePpm = one("managementFeePpm") ?? reportedManagement;
  const carryPpm = one("carryPpm") ?? reportedCarry;
  const observedAt =
    documents.find((doc) => doc.economicsCitations?.length)?.observedAt ??
    context.reportedTerms?.observedAt;
  const reported =
    (managementFeePpm === null && carryPpm === null) || observedAt === undefined
      ? context.reportedTerms
      : {
          managementFeePpm,
          carryPpm,
          sourceLabel:
            citations.length > 0
              ? "Agreement"
              : context.reportedTerms!.sourceLabel,
          observedAt,
          adminFeeYears: one("adminFeeYears"),
          setupFeePpm: one("setupFeePpm"),
          grossCommitmentMinor: one("grossCommitmentMinor"),
          netInvestedMinor: one("netInvestedMinor"),
        };
  const blocked = (code: AutomaticReviewIssue["code"], message: string) => ({
    input: null,
    issue: issue("economics", code, message),
    reported,
  });
  if (documents.some((doc) => doc.economicsProblem !== undefined))
    return blocked(
      "unsupported",
      "The agreement has additional fee or carry conditions.",
    );
  if (
    documents.some(
      (doc) =>
        doc.scan?.outcome !== "clean" ||
        (doc.extractionProblem != null &&
          doc.extractionProblem !== "name_not_found"),
    )
  )
    return blocked(
      "document_check",
      "Check the agreement before using its fee terms.",
    );
  if (
    citations.some((citation) => values(citation.field).length > 1) ||
    (reportedManagement !== null &&
      one("managementFeePpm") !== null &&
      reportedManagement !== one("managementFeePpm")) ||
    (reportedCarry !== null &&
      one("carryPpm") !== null &&
      reportedCarry !== one("carryPpm"))
  )
    return blocked(
      "conflicting",
      "Sources disagree on fee, carry, or contributed capital.",
    );
  const adminFeeYears = one("adminFeeYears");
  const setupFeePpm = one("setupFeePpm");
  const gross = one("grossCommitmentMinor");
  const net = one("netInvestedMinor");
  if (
    managementFeePpm === null ||
    carryPpm === null ||
    adminFeeYears === null ||
    setupFeePpm === null ||
    gross === null
  )
    return blocked(
      "missing",
      "Some fee terms or the gross commitment are not stated in the source.",
    );
  if (
    citations.some(
      (citation) =>
        citation.currency !== undefined &&
        citation.currency !== context.currency,
    ) ||
    citations.some(
      (citation) =>
        ["managementFeePpm", "setupFeePpm"].includes(citation.field) &&
        citation.basis !== "gross_commitment",
    )
  )
    return blocked(
      "unsupported",
      "Confirm the fee basis and currency before applying these terms.",
    );
  const capitalBasis =
    gross === context.committedMinor
      ? "gross_commitment"
      : net === context.committedMinor
        ? "net_invested"
        : null;
  if (capitalBasis === null)
    return blocked(
      "conflicting",
      "The agreement does not reconcile to the imported investment amount.",
    );
  const parsed = AcceptPositionEconomicsInputSchema.safeParse({
    expectedSnapshotId: context.snapshotId,
    expectedTermsId: context.acceptedTerms?.id ?? null,
    capitalBasis,
    grossCommitmentMinor: capitalBasis === "net_invested" ? gross : null,
    annualAdminFeePpm: managementFeePpm,
    adminFeeYears,
    setupFeePpm,
    carryPpm,
    note: "Automatically accepted from matching, explicitly stated agreement terms.",
  });
  if (!parsed.success)
    return blocked(
      "conflicting",
      "The fee terms do not reconcile. Check the agreement.",
    );
  const calculated = calculatePositionEconomics({
    ...context,
    acceptedTerms: {
      ...parsed.data,
      id: "automatic-preview",
      positionId: "automatic-preview",
      acceptedAgainstSnapshotId: context.snapshotId,
      commitmentMinorAtAcceptance: context.committedMinor,
      fundedMinorAtAcceptance: context.fundedMinor,
      acceptedAt: "1970-01-01T00:00:00.000Z",
    },
  });
  if (
    calculated === null ||
    (net !== null && calculated.positionCostBasisMinor !== net)
  )
    return blocked(
      "conflicting",
      "Gross commitment less fees does not match net invested capital.",
    );
  return { input: parsed.data, issue: null, reported };
}
