import type { LegalEntitySourceSummary } from "../packages/domain/src/legal-entities";
import {
  InvestmentReviewContextSchema,
  InvestmentReviewStateSchema,
  type InvestmentReviewContext,
} from "../packages/domain/src/investment-review";

export function reviewAgreementSource({
  conflict,
  netImported = false,
}: {
  conflict: boolean;
  netImported?: boolean;
}) {
  const doc = {
    id: "11111111-1111-4111-8111-111111111111",
    fileName: "demo-growth-subscription.pdf",
    sha256: "a".repeat(64),
    page: 1,
    quote: "Fund: Demo Growth IV LLC",
    citations: [
      {
        legalName: "Demo Growth IV LLC",
        page: 1,
        quote: "Fund: Demo Growth IV LLC",
        role: "fund" as const,
      },
    ],
    companyCitations: [
      {
        companyName: "Demo Robotics Inc.",
        page: 2,
        quote: "Underlying Company: Demo Robotics Inc.",
        role: "underlying_company" as const,
      },
    ],
    scan: {
      version: 1 as const,
      engineVersion: "1.5.3",
      databaseVersion: 28000,
      databaseUpdatedAt: "2026-09-01T10:00:00.000Z",
      scannedAt: "2026-09-01T11:00:00.000Z",
      sha256: "a".repeat(64),
      outcome: "clean" as const,
    },
  };
  const source: LegalEntitySourceSummary = {
    source: { kind: "holding_position", id: "position_demo_growth_iv" },
    sourceDisplayName: "Demo Growth IV",
    sourceLabel: netImported ? "Tokenfolio template" : "Sydecar agreement",
    sourceAsOf: "2026-09-01",
    currentOwner: "Demo Family LLC",
    currentDecisionId: null,
    suggestedEntityType: conflict ? null : "llc",
    relationship: "investment_vehicle",
    interestStatus: "current",
    financials: null,
    openedOn: null,
    legalEntityNameEvidence: {
      state: "document_reported",
      legalName: "Demo Growth IV LLC",
      sourceField: "Agreement",
      documents: [doc],
    },
  };
  if (conflict)
    source.legalEntityNameEvidence = {
      state: "unavailable",
      legalName: null,
      sourceField: null,
      problem: "conflicting",
      documents: [
        doc,
        {
          ...doc,
          id: "22222222-2222-4222-8222-222222222222",
          fileName: "demo-cancelled-subscription.pdf",
          citations: [
            {
              legalName: "Demo Cancelled LLC",
              page: 1,
              quote: "Fund: Demo Cancelled LLC",
              role: "fund",
            },
          ],
        },
      ],
    };
  return { doc, source };
}

export function investmentReviewContext(
  source: LegalEntitySourceSummary,
  overrides: Partial<InvestmentReviewContext> = {},
) {
  return InvestmentReviewContextSchema.parse({
    positionId: source.source.id,
    positionLabel: source.sourceDisplayName,
    holderLabel: source.currentOwner ?? "Not recorded",
    snapshotId: null,
    committedMinor: null,
    fundedMinor: null,
    currency: "USD",
    economics: null,
    review: null,
    defaultParticipationStatus: source.interestStatus,
    documents: source.legalEntityNameEvidence.documents ?? [],
    evidenceRevision: "a".repeat(64),
    companyChoices: [],
    companies: [],
    mappings: [],
    companyReceipt: null,
    otherPositions: [],
    ...overrides,
  });
}

export function documentedOwnershipReview(
  positionId: string,
  document: InvestmentReviewContext["documents"][number],
) {
  const recordedAt = "2026-09-01T12:00:00.000Z";
  return InvestmentReviewStateSchema.parse({
    id: "33333333-3333-4333-8333-333333333333",
    positionId,
    version: 1,
    participationStatus: "current",
    documentAssignments: [],
    recordedAt,
    ownershipObservations: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        recordedAt,
        sourceKind: "agreement",
        sourceLabel: document.fileName,
        effectiveDate: "2026-08-15",
        taxYear: null,
        ownershipPpm: 125_000,
        profitBeginningPpm: null,
        profitEndingPpm: null,
        lossBeginningPpm: null,
        lossEndingPpm: null,
        capitalBeginningPpm: null,
        capitalEndingPpm: null,
        documentId: document.id,
        documentSha256: document.sha256,
        page: 2,
        quote: null,
        evidenceBasis: "document_review",
        supersedesObservationId: null,
      },
    ],
  });
}
