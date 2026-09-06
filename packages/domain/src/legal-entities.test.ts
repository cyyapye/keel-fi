import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS,
  LegalEntitySourceSummarySchema,
  LegalEntityExportInputSchema,
  LegalEntityProfileInputSchema,
  LegalNameResolutionInputSchema,
  LegalNameResolutionSchema,
  exactLegalEntityTypeFromName,
  legalEntityReviewKind,
  compareLegalEntityAttention,
  type LegalEntitySourceSummary,
  formatOwnershipInterestPpm,
  ownershipPercentTextToPpm,
} from "./legal-entities";

describe("legal entity contracts", () => {
  it("prioritizes actionable document review, conflicts, found names, then waiting sources", () => {
    const base: LegalEntitySourceSummary = {
      source: { kind: "holding_position", id: "synthetic" },
      sourceDisplayName: "Synthetic investment",
      sourceLabel: "Synthetic agreement",
      sourceAsOf: "2026-09-01",
      suggestedEntityType: null,
      relationship: "investment_vehicle",
      currentOwner: null,
      currentDecisionId: null,
      interestStatus: "current",
      openedOn: null,
      financials: null,
      legalEntityNameEvidence: {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        problem: "extractor_unavailable",
        documents: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            fileName: "synthetic.pdf",
            sha256: "a".repeat(64),
            page: null,
            quote: null,
            scan: {
              version: 2,
              sha256: "a".repeat(64),
              outcome: "clean",
              findings: [],
              engineVersion: "1.4.3",
              databaseVersion: 100,
              databaseUpdatedAt: "2026-09-01T10:00:00.000Z",
              scannedAt: "2026-09-01T11:00:00.000Z",
            },
          },
        ],
      },
    };
    const manual = { ...base, source: { ...base.source, id: "manual" } };
    const conflict: LegalEntitySourceSummary = {
      ...base,
      source: { ...base.source, id: "conflict" },
      legalEntityNameEvidence: {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        documents: base.legalEntityNameEvidence.documents,
        problem: "conflicting",
      },
    };
    const found: LegalEntitySourceSummary = {
      ...base,
      source: { ...base.source, id: "found" },
      legalEntityNameEvidence: {
        state: "provider_reported",
        legalName: "Synthetic LLC",
        sourceField: "Fund Name",
      },
    };
    const waiting: LegalEntitySourceSummary = {
      ...base,
      source: { ...base.source, id: "waiting" },
      legalEntityNameEvidence: {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        problem: "security_blocked",
      },
    };
    expect(legalEntityReviewKind(manual)).toBe("document");
    expect(legalEntityReviewKind(waiting)).toBe("waiting");
    expect(
      [waiting, found, conflict, manual]
        .sort(compareLegalEntityAttention)
        .map((item) => item.source.id),
    ).toEqual(["manual", "conflict", "found", "waiting"]);
    const unscanned = structuredClone(manual);
    delete unscanned.legalEntityNameEvidence.documents![0]!.scan;
    expect(legalEntityReviewKind(unscanned)).toBe("waiting");
  });
  it("requires a correction reason and validates an optional exact-name excerpt", () => {
    const input = {
      kind: "document_correction",
      documentId: "11111111-1111-4111-8111-111111111111",
      legalName: "Synthetic Exact LLC",
      page: 1,
      quote: "Issuer: Synthetic Exact LLC",
      reason: "The executed agreement identifies the vehicle.",
      expectedEvidenceRevision: "a".repeat(64),
    };
    expect(LegalNameResolutionInputSchema.safeParse(input).success).toBe(true);
    expect(
      LegalNameResolutionInputSchema.safeParse({ ...input, quote: null })
        .success,
    ).toBe(true);
    for (const mutation of [
      { reason: null },
      { quote: "An unrelated reference" },
      { page: 0 },
      { page: 151 },
      { documentId: "other-source" },
      { expectedEvidenceRevision: "missing" },
    ]) {
      expect(
        LegalNameResolutionInputSchema.safeParse({ ...input, ...mutation })
          .success,
      ).toBe(false);
    }
  });
  it("accepts a user-entered name with only a document and page, without weakening extracted choices", () => {
    const input = {
      kind: "document_entry",
      documentId: "11111111-1111-4111-8111-111111111111",
      legalName: "Synthetic Exact LLC",
      page: 1,
      quote: null,
      reason: null,
      expectedEvidenceRevision: "a".repeat(64),
    };
    expect(LegalNameResolutionInputSchema.parse(input)).toEqual(input);
    for (const mutation of [
      { legalName: "   " },
      { page: 0 },
      { page: 1.5 },
      { page: 151 },
      { documentId: "" },
      { expectedEvidenceRevision: "" },
      { quote: "Unrelated text" },
      { quote: "Synthetic Exact LLC".repeat(200) },
      { kind: "document_choice" },
      { kind: "document_structure" },
      { kind: "document_correction" },
      { reviewedEntityType: "llc" }, // Only the server records the reviewed type.
    ])
      expect(
        LegalNameResolutionInputSchema.safeParse({ ...input, ...mutation })
          .success,
      ).toBe(false);
    expect(
      LegalNameResolutionInputSchema.safeParse({
        ...input,
        quote: "Issuer: Synthetic Exact LLC",
      }).success,
    ).toBe(true);
  });
  it("reads legacy name receipts and validates a recorded reviewer classification", () => {
    const receipt = {
      kind: "document_entry",
      documentId: "11111111-1111-4111-8111-111111111111",
      legalName: "Synthetic Series IX",
      page: 1,
      quote: null,
      reason: null,
      fileName: "synthetic-agreement.pdf",
      sha256: "a".repeat(64),
      evidence: {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        problem: "other_structure",
      },
    };
    expect(LegalNameResolutionSchema.parse(receipt)).toEqual(receipt);
    expect(
      LegalNameResolutionSchema.parse({
        ...receipt,
        reviewedEntityType: "corporation",
      }).reviewedEntityType,
    ).toBe("corporation");
    expect(
      LegalNameResolutionSchema.safeParse({
        ...receipt,
        reviewedEntityType: "guessed",
      }).success,
    ).toBe(false);
  });
  it("parses ownership percentages without floating-point arithmetic", () => {
    expect(ownershipPercentTextToPpm("")).toBeNull();
    expect(ownershipPercentTextToPpm("0")).toBe(0);
    expect(ownershipPercentTextToPpm("12.3456")).toBe(123_456);
    expect(ownershipPercentTextToPpm("100.0000")).toBe(1_000_000);
    expect(formatOwnershipInterestPpm(123_456)).toBe("12.3456%");
    expect(formatOwnershipInterestPpm(1_000_000)).toBe("100%");
  });

  it("rejects ambiguous or out-of-range ownership text", () => {
    expect(() => ownershipPercentTextToPpm("12.34567")).toThrow(
      "from 0 to 100",
    );
    expect(() => ownershipPercentTextToPpm("100.01")).toThrow("from 0 to 100");
    expect(() => ownershipPercentTextToPpm("1e2")).toThrow("from 0 to 100");
  });

  it("preserves unknown profile fields instead of coercing them", () => {
    expect(
      LegalEntityProfileInputSchema.parse({
        legalName: "Synthetic Holdings LLC",
        entityType: "llc",
        relationship: "ownership_entity",
        currentOwner: null,
        jurisdiction: null,
        formedOn: null,
        einLastFour: null,
        ownershipInterestPpm: null,
        interestStatus: "unknown",
        taxClassification: null,
        notes: null,
      }),
    ).toMatchObject({
      currentOwner: null,
      jurisdiction: null,
      ownershipInterestPpm: null,
    });
  });

  it("classifies only explicit LLC and limited-partnership endings", () => {
    expect(exactLegalEntityTypeFromName("Synthetic Holdings LLC")).toBe("llc");
    expect(exactLegalEntityTypeFromName("Synthetic Holdings, L.L.C.")).toBe(
      "llc",
    );
    expect(exactLegalEntityTypeFromName("Synthetic Medical PLLC")).toBe("llc");
    expect(
      exactLegalEntityTypeFromName(
        "Synthetic Holdings Limited Liability Company",
      ),
    ).toBe("llc");
    expect(
      exactLegalEntityTypeFromName("AL Fund I, a series of Hack VC, LP"),
    ).toBe("limited_partnership");
    expect(exactLegalEntityTypeFromName("Synthetic Fund, L.P.")).toBe(
      "limited_partnership",
    );
    expect(
      exactLegalEntityTypeFromName("Synthetic Fund Limited Partnership"),
    ).toBe("limited_partnership");
    expect(
      exactLegalEntityTypeFromName("Synthetic Operating Account"),
    ).toBeNull();
    expect(exactLegalEntityTypeFromName("Synthetic SELLC Account")).toBeNull();
    expect(exactLegalEntityTypeFromName("LP Fund Holdings")).toBeNull();
  });

  it("requires legal names to carry provider or document evidence", () => {
    const base = {
      source: { kind: "holding_position" as const, id: "position-synthetic" },
      sourceDisplayName: "Synthetic investment",
      suggestedEntityType: "llc" as const,
      sourceLabel: "Synthetic export",
      sourceAsOf: "2026-08-31",
      relationship: "investment_vehicle" as const,
      currentOwner: null,
      interestStatus: "current" as const,
      openedOn: null,
      financials: null,
      currentDecisionId: null,
    };
    expect(
      LegalEntitySourceSummarySchema.parse({
        ...base,
        legalEntityNameEvidence: {
          state: "document_reported",
          legalName: "Synthetic Vehicle LLC",
          sourceField: "Schedule K-1",
        },
      }).legalEntityNameEvidence,
    ).toMatchObject({ state: "document_reported" });
    expect(
      LegalEntitySourceSummarySchema.safeParse({
        ...base,
        legalEntityNameEvidence: {
          state: "unavailable",
          legalName: "Synthetic Vehicle LLC",
          sourceField: null,
        },
      }).success,
    ).toBe(false);
  });

  it("validates a unique, non-empty export field selection", () => {
    expect(
      LegalEntityExportInputSchema.safeParse({
        fields: DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS,
        includeNeedsReview: true,
        includeHistorical: false,
        includeOtherEntityTypes: false,
      }).success,
    ).toBe(true);
    expect(
      LegalEntityExportInputSchema.safeParse({
        fields: [],
        includeNeedsReview: true,
        includeHistorical: false,
        includeOtherEntityTypes: false,
      }).success,
    ).toBe(false);
    expect(
      LegalEntityExportInputSchema.safeParse({
        fields: ["legal_name", "legal_name"],
        includeNeedsReview: true,
        includeHistorical: false,
        includeOtherEntityTypes: false,
      }).success,
    ).toBe(false);
  });
});
