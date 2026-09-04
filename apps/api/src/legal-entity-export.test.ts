import { describe, expect, it } from "vitest";

import type {
  LegalEntityInventory,
  LegalEntitySourceSummary,
} from "@keel/domain/legal-entities";

import {
  legalEntityExportCsv,
  legalEntityExportRows,
} from "./legal-entity-export";

const source = {
  source: { kind: "holding_position", id: "position-synthetic" },
  sourceDisplayName: "Synthetic Robotics",
  legalEntityNameEvidence: {
    state: "provider_reported",
    legalName: "Synthetic SPV, LLC",
    sourceField: "Fund Name",
  },
  suggestedEntityType: "llc",
  sourceLabel: 'Reviewed export "Alpha"',
  sourceAsOf: "2026-08-31",
  relationship: "investment_vehicle",
  currentOwner: null,
  interestStatus: "current",
  openedOn: "2024-01-15",
  financials: {
    currency: "USD",
    commitmentMinor: 12_345,
    fundedMinor: null,
    currentValue: { state: "locked", minor: null },
  },
  currentDecisionId: "decision-synthetic",
} satisfies LegalEntitySourceSummary;

const inventory = {
  version: 3,
  asOf: "2026-09-01T12:00:00.000Z",
  entities: [
    {
      id: "entity-synthetic",
      versionId: "version-synthetic",
      version: 1,
      recordedAt: "2026-09-01T12:00:00.000Z",
      legalName: "=Synthetic Holdings LLC",
      entityType: "llc",
      relationship: "ownership_entity",
      currentOwner: null,
      jurisdiction: "Delaware",
      formedOn: null,
      einLastFour: null,
      ownershipInterestPpm: 500_000,
      interestStatus: "current",
      taxClassification: null,
      notes: "Counsel, review",
      sources: [source],
    },
    {
      id: "entity-historical",
      versionId: "version-historical",
      version: 1,
      recordedAt: "2026-08-01T12:00:00.000Z",
      legalName: "Former Synthetic LLC",
      entityType: "llc",
      relationship: "direct_interest",
      currentOwner: "Demo Household",
      jurisdiction: "California",
      formedOn: null,
      einLastFour: null,
      ownershipInterestPpm: null,
      interestStatus: "historical",
      taxClassification: null,
      notes: null,
      sources: [],
    },
    {
      id: "entity-corporation",
      versionId: "version-corporation",
      version: 1,
      recordedAt: "2026-08-01T12:00:00.000Z",
      legalName: "Synthetic Corporation",
      entityType: "corporation",
      relationship: "operating_entity",
      currentOwner: null,
      jurisdiction: null,
      formedOn: null,
      einLastFour: null,
      ownershipInterestPpm: null,
      interestStatus: "current",
      taxClassification: null,
      notes: null,
      sources: [],
    },
  ],
  candidates: [
    {
      ...source,
      source: { kind: "ownership_container", id: "container-synthetic" },
      sourceDisplayName: "Possible Synthetic LLC",
      legalEntityNameEvidence: {
        state: "unavailable",
        legalName: null,
        sourceField: null,
      },
      suggestedEntityType: null,
      currentDecisionId: null,
    },
  ],
  excludedCandidates: [],
  exactBatch: {
    revision: "a".repeat(64),
    sourceCount: 1,
    entityCount: 1,
    existingEntityCount: 0,
    newEntityCount: 1,
    llcEntityCount: 1,
    limitedPartnershipEntityCount: 0,
    remainingCandidateCount: 0,
  },
} satisfies LegalEntityInventory;

describe("legal entity CSV export", () => {
  it("includes exact document/page evidence and explicit unresolved structure without a guessed name", () => {
    const documentSource: LegalEntitySourceSummary = {
      ...source,
      legalEntityNameEvidence: {
        state: "document_reported",
        legalName: "Synthetic SPV, LLC",
        sourceField: "Agreement, page 2",
        documents: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            fileName: "synthetic-agreement.pdf",
            sha256: "a".repeat(64),
            page: 2,
            quote: "Issuer: Synthetic SPV, LLC",
          },
        ],
      },
    };
    const unresolved: LegalEntitySourceSummary = {
      ...source,
      legalEntityNameEvidence: {
        state: "unavailable",
        legalName: null,
        sourceField: null,
        problem: "other_structure",
      },
      suggestedEntityType: null,
    };
    const rows = legalEntityExportRows(
      { ...inventory, entities: [], candidates: [documentSource, unresolved] },
      {
        fields: ["legal_name", "name_evidence"],
        includeNeedsReview: true,
        includeHistorical: false,
        includeOtherEntityTypes: false,
      },
    );
    expect(
      rows.find((row) => row.legal_name === "Synthetic SPV, LLC")
        ?.name_evidence,
    ).toContain("synthetic-agreement.pdf, page 2");
    expect(
      rows.find((row) => row.legal_name === "Synthetic SPV, LLC")
        ?.name_evidence,
    ).toContain("Issuer: Synthetic SPV, LLC");
    expect(rows.find((row) => row.legal_name === "")?.name_evidence).toContain(
      "compartment or certificate structure",
    );
    expect(JSON.stringify(rows)).not.toContain("https:");
  });
  it("uses selected field order, quotes cells, and neutralizes formulas", () => {
    const csv = legalEntityExportCsv(inventory, {
      fields: ["legal_name", "source", "notes"],
      includeNeedsReview: false,
      includeHistorical: false,
      includeOtherEntityTypes: false,
    });

    expect(csv.startsWith('\uFEFF"Legal name","Source","Notes"\r\n')).toBe(
      true,
    );
    expect(csv).toContain('"\'=Synthetic Holdings LLC"');
    expect(csv).toContain('"Reviewed export ""Alpha"""');
    expect(csv).toContain('"Counsel, review"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("keeps missing, locked, and unreported values explicit", () => {
    const [row] = legalEntityExportRows(inventory, {
      fields: ["legal_name"],
      includeNeedsReview: false,
      includeHistorical: false,
      includeOtherEntityTypes: false,
    });

    expect(row).toMatchObject({
      commitment: "Synthetic Robotics: USD 123.45",
      current_owner: "Not recorded",
      current_value: "Synthetic Robotics: Locked",
      funded: "Synthetic Robotics: Not recorded",
      ownership_interest: "50%",
    });
    expect(row?.missing_information).toBe(
      "Current titled owner; Formation date; EIN last four; Tax classification",
    );
  });

  it("applies historical, type, and needs-review scope independently", () => {
    const defaultRows = legalEntityExportRows(inventory, {
      fields: ["legal_name"],
      includeNeedsReview: true,
      includeHistorical: false,
      includeOtherEntityTypes: false,
    });
    expect(defaultRows.map((row) => row.legal_name)).toEqual([
      "=Synthetic Holdings LLC",
      "",
    ]);
    const unresolved = defaultRows.find((row) => row.legal_name === "");
    expect(unresolved).toMatchObject({
      source_record: "Possible Synthetic LLC",
      record_status: "Legal name unavailable",
      entity_type: "Not reported",
    });
    expect(unresolved?.missing_information).toContain("Legal name");

    const expandedRows = legalEntityExportRows(inventory, {
      fields: ["legal_name"],
      includeNeedsReview: false,
      includeHistorical: true,
      includeOtherEntityTypes: true,
    });
    expect(expandedRows.map((row) => row.legal_name)).toEqual([
      "=Synthetic Holdings LLC",
      "Former Synthetic LLC",
      "Synthetic Corporation",
    ]);
  });
});
