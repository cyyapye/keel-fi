import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS,
  LegalEntityExportInputSchema,
  LegalEntityProfileInputSchema,
  formatOwnershipInterestPpm,
  ownershipPercentTextToPpm,
} from "./legal-entities";

describe("legal entity contracts", () => {
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
