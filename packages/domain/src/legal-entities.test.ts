import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS,
  LegalEntityExportInputSchema,
  LegalEntityProfileInputSchema,
  exactLegalEntityTypeFromName,
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
