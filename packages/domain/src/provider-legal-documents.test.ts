import { describe, expect, it } from "vitest";
import { LegalDocumentExtractionSchema } from "./provider-legal-documents";

describe("conflicting legal-document evidence", () => {
  const first = {
    legalName: "Synthetic Vehicle LLC",
    page: 1,
    quote: "Issuer: Synthetic Vehicle LLC",
    role: "issuer",
  };
  const second = {
    legalName: "Synthetic Vehicle, LLC",
    page: 2,
    quote: "Fund: Synthetic Vehicle, LLC",
    role: "fund",
  };
  it("reads immutable legacy conflicts and requires alternatives in new ones", () => {
    expect(
      LegalDocumentExtractionSchema.safeParse({
        version: 2,
        pageCount: 2,
        problem: "conflicting",
        citations: [],
      }).success,
    ).toBe(true);
    expect(
      LegalDocumentExtractionSchema.safeParse({
        version: 3,
        pageCount: 2,
        problem: "conflicting",
        citations: [],
      }).success,
    ).toBe(false);
    expect(
      LegalDocumentExtractionSchema.safeParse({
        version: 3,
        pageCount: 2,
        problem: "conflicting",
        citations: [first, second],
      }).success,
    ).toBe(true);
  });
  it("never calls different alternatives a resolved name or exposes unsafe citations", () => {
    expect(
      LegalDocumentExtractionSchema.safeParse({
        version: 3,
        pageCount: 2,
        problem: null,
        citations: [first, second],
      }).success,
    ).toBe(false);
    expect(
      LegalDocumentExtractionSchema.safeParse({
        version: 3,
        pageCount: 2,
        problem: "security_blocked",
        citations: [first],
      }).success,
    ).toBe(false);
    expect(
      LegalDocumentExtractionSchema.safeParse({
        version: 3,
        pageCount: 1,
        problem: "conflicting",
        citations: [first, second],
      }).success,
    ).toBe(false);
  });
});
