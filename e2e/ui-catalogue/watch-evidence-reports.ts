import type { EvidenceInboxItem } from "../../packages/domain/src/index";

export const financingFactsFixture = {
  roundType: "series",
  roundLabel: "Series C",
  instrument: "equity",
  announcedAmount: {
    amountMinor: 6_200_000_000,
    currency: "USD",
    qualifier: "exact",
    evidenceText:
      "announced a US$62 million Series C financing at a US$310 million post-money company valuation",
  },
  companyValuation: {
    amountMinor: 31_000_000_000,
    currency: "USD",
    qualifier: "exact",
    basis: "post_money",
    evidenceText:
      "announced a US$62 million Series C financing at a US$310 million post-money company valuation",
  },
  ambiguities: [],
} satisfies NonNullable<EvidenceInboxItem["financingFacts"]>;

export const financingReport = {
  id: "evt_watch_harbor_series_c",
  companyName: "Harbor Health Systems",
  eventType: "financing_announced",
  headline: "Synthetic Series C financing announcement",
  detectedAt: "2026-08-02T12:00:00.000Z",
  effectiveDate: "2026-07-31",
  status: "pending_review",
  confidencePpm: 920_000,
  modelConfidencePpm: 610_000,
  sources: ["Official company website"],
  sourceUrl:
    "https://newsroom.harbor-health.example/updates/series-c-financing",
  sourceExcerpt: financingFactsFixture.announcedAmount.evidenceText,
  priorValue: "Not set",
  replacementValue: "Not set",
  forecastImpactMinor: 0,
  financingFacts: financingFactsFixture,
  application: null,
} satisfies EvidenceInboxItem;

export const clinicReport = {
  ...financingReport,
  id: "synthetic-news-event",
  eventType: "operating_update",
  headline:
    "Harbor opens a new clinic and expands its regional care network with additional locations planned for next year",
  sourceUrl: null,
  sourceExcerpt: null,
  financingFacts: null,
} satisfies EvidenceInboxItem;

// A separate statement in the inbox has an applicable mark. Watch's public
// company-event claims never establish this target.
export const markReport = {
  ...financingReport,
  id: "evt_harbor_statement_mark",
  eventType: "administrator_statement",
  headline: "Administrator reports a revised external mark",
  sources: ["Demo administrator statement"],
  modelConfidencePpm: null,
  sourceUrl: null,
  sourceExcerpt: null,
  priorValue: "$18,000.00",
  replacementValue: "$20,000.00",
  forecastImpactMinor: 120_000,
  financingFacts: null,
  application: {
    target: "external_mark",
    label: "External mark",
    applied: false,
  },
} satisfies EvidenceInboxItem;

export const inboxReports: EvidenceInboxItem[] = [
  clinicReport,
  financingReport,
  markReport,
];

export const watchObservations = [financingReport, clinicReport].map(
  (report) => ({
    id:
      report.id === financingReport.id
        ? "obs_watch_harbor_series_c"
        : "synthetic-news",
    evidenceEventId: report.id,
    companyId: "co_harbor",
    companyName: report.companyName,
    eventType: report.eventType,
    evidenceStatus: report.status,
    publishedAt: "2026-07-31T20:00:00.000Z",
    retrievedAt: report.detectedAt,
    sourceClass: "official_company" as const,
    sourceTitle: report.headline,
    sourceUrl:
      report.sourceUrl ??
      "https://newsroom.harbor-health.example/updates/clinic",
    sourceReliabilityPpm: report.confidencePpm,
    modelConfidencePpm: report.modelConfidencePpm,
    observedFact: report.sourceExcerpt ?? report.headline,
    inference:
      "This is a company-level public signal. It does not imply a holding value or liquidity outcome.",
    limitations:
      "Public company information does not establish security terms, ownership, dilution, fees, taxes, or liquidity for this holding.",
    financingFacts: report.financingFacts,
    valuationLowMinor: null,
    valuationMiddleMinor: null,
    valuationHighMinor: null,
  }),
);
