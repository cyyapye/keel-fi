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
  suggestedName: "Synthetic SPV, LLC",
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
  version: 1,
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
      suggestedName: "Possible Synthetic LLC",
      currentDecisionId: null,
    },
  ],
  excludedCandidates: [],
} satisfies LegalEntityInventory;

describe("legal entity CSV export", () => {
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
      commitment: "Synthetic SPV, LLC: USD 123.45",
      current_owner: "Not recorded",
      current_value: "Synthetic SPV, LLC: Locked",
      funded: "Synthetic SPV, LLC: Not recorded",
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
      "Possible Synthetic LLC",
    ]);

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
