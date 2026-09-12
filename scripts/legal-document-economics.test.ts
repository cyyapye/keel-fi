import { describe, expect, it } from "vitest";
import { extractLegalNameFromPages } from "./legal-document-extraction";
import { automaticEconomics } from "../packages/domain/src/automatic-investment-review";
import {
  LegalDocumentExtractionSchema,
  LegalNameDocumentReferenceSchema,
} from "../packages/domain/src/provider-legal-documents";
import { syntheticDocumentScan } from "./test-support/legal-documents";

const terms = [
  "Issuer: Synthetic Orchard SPV LLC",
  "Gross commitment: USD 40,000.00",
  "Net invested capital: USD 37,100.00",
  "Management fee: 6% of gross commitment, one-time",
  "Setup fee: 1.25% of gross commitment",
  "Carry: 17.5% of exit gains",
];
const context = {
  snapshotId: "snapshot-synthetic",
  currency: "USD",
  committedMinor: 3_710_000,
  fundedMinor: 3_710_000,
  acceptedTerms: null,
  reportedTerms: null,
};
function document(lines = terms) {
  const extraction = extractLegalNameFromPages([lines.join("\n")]);
  const scan = syntheticDocumentScan();
  return LegalNameDocumentReferenceSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    fileName: "synthetic-fees.pdf",
    sha256: scan.sha256,
    page: 1,
    quote: "Issuer: Synthetic Orchard SPV LLC",
    citations: extraction.citations,
    economicsCitations: extraction.economicsCitations,
    economicsProblem: extraction.economicsProblem,
    observedAt: "2026-09-01T12:00:00.000Z",
    scan,
  });
}

describe("explicit agreement economics evidence", () => {
  it("retains exact cited fee, carry, and gross/net terms without requiring transcription", () => {
    const extraction = extractLegalNameFromPages([
      [
        "Issuer: Synthetic Orchard SPV LLC",
        "Underlying Company: Synthetic Orchard Inc.",
        "Gross commitment: USD 40,000.00",
        "Net invested capital: USD 37,100.00",
        "Management fee: 6% of gross commitment, one-time",
        "Setup fee: 1.25% of gross commitment",
        "Carry: 17.5% of exit gains",
      ].join("\n"),
    ]);
    expect(extraction).toMatchObject({
      economicsCitations: expect.arrayContaining([
        expect.objectContaining({
          field: "grossCommitmentMinor",
          value: 4_000_000,
          currency: "USD",
          page: 1,
        }),
        expect.objectContaining({
          field: "netInvestedMinor",
          value: 3_710_000,
          currency: "USD",
          page: 1,
        }),
        expect.objectContaining({
          field: "managementFeePpm",
          value: 60_000,
          basis: "gross_commitment",
          page: 1,
        }),
        expect.objectContaining({ field: "adminFeeYears", value: 1, page: 1 }),
        expect.objectContaining({
          field: "setupFeePpm",
          value: 12_500,
          basis: "gross_commitment",
          page: 1,
        }),
        expect.objectContaining({ field: "carryPpm", value: 175_000, page: 1 }),
      ]),
    });
  });

  it.each(["Setup fee:", "Management fee:", "Carry:", "Gross commitment:"])(
    "keeps %s unknown when the agreement does not state it",
    (prefix) => {
      const result = automaticEconomics(context, [
        document(terms.filter((line) => !line.startsWith(prefix))),
      ]);
      expect(result.input).toBeNull();
      expect(result.issue?.code).toBe("missing");
    },
  );

  it.each([
    "Management fee: 6% annually of gross commitment",
    "Management fee: 6% of committed capital, one-time",
    "Management fee: 6% of gross commitment, one-time subject to a cap",
    "Management fee: 1% or 6% of gross commitment",
    "Carried interest: 17.5% after a preferred return",
  ])("does not apply unsupported or incomplete economics: %s", (line) => {
    const changed = terms.filter(
      (item) =>
        !item.startsWith(
          line.startsWith("Carried") ? "Carry:" : "Management fee:",
        ),
    );
    const result = automaticEconomics(context, [document([...changed, line])]);
    expect(result.input).toBeNull();
    expect(result.issue).not.toBeNull();
  });

  it("preserves a conflicting conditional term even when another page gives a simple rate", () => {
    expect(
      automaticEconomics(context, [
        document([
          ...terms,
          "Management fee: 2% or 6% depending on closing date",
        ]),
      ]).issue?.code,
    ).toBe("unsupported");
  });

  it("requires amount reconciliation, matching currency, current document checks and consistent rates", () => {
    const doc = document();
    expect(automaticEconomics(context, [doc]).input).toMatchObject({
      capitalBasis: "net_invested",
      grossCommitmentMinor: 4_000_000,
      annualAdminFeePpm: 60_000,
      setupFeePpm: 12_500,
      carryPpm: 175_000,
    });
    expect(
      automaticEconomics({ ...context, committedMinor: 3_700_000 }, [doc]).issue
        ?.code,
    ).toBe("conflicting");
    expect(
      automaticEconomics({ ...context, currency: "EUR" }, [doc]).issue?.code,
    ).toBe("unsupported");
    expect(
      automaticEconomics(context, [
        { ...doc, scan: { ...doc.scan!, outcome: "blocked" } },
      ]).issue?.code,
    ).toBe("document_check");
    expect(
      automaticEconomics(context, [
        document([...terms, "Carry: 20% of exit gains"]),
      ]).issue?.code,
    ).toBe("conflicting");
    expect(
      automaticEconomics(context, [
        doc,
        {
          ...doc,
          economicsCitations: undefined,
          extractionProblem: "extractor_unavailable",
        },
      ]).issue?.code,
    ).toBe("document_check");
  });

  it("accepts explicit zero fees and a supported prepaid annual term using integer arithmetic", () => {
    const zero = document([
      terms[0]!,
      terms[1]!,
      "Management fee: 0%",
      "Setup fee: 0%",
      "Carry: 0%",
    ]);
    expect(
      automaticEconomics({ ...context, committedMinor: 4_000_000 }, [zero])
        .input,
    ).toMatchObject({ annualAdminFeePpm: 0, setupFeePpm: 0, carryPpm: 0 });
    const annual = document(
      terms.map((line) =>
        line.startsWith("Management fee:")
          ? "Management fee: 2% annually of gross commitment, prepaid for 3 years"
          : line,
      ),
    );
    expect(automaticEconomics(context, [annual]).input).toMatchObject({
      annualAdminFeePpm: 20_000,
      adminFeeYears: 3,
    });
  });

  it("rejects forged values, unsupported legacy extractor evidence and non-integer money", () => {
    const extraction = extractLegalNameFromPages([terms.join("\n")]);
    const forged = structuredClone(extraction);
    forged.economicsCitations![0]!.value++;
    expect(LegalDocumentExtractionSchema.safeParse(forged).success).toBe(false);
    expect(
      LegalDocumentExtractionSchema.safeParse({ ...extraction, version: 5 })
        .success,
    ).toBe(false);
    const invalid = document(
      terms.map((line) =>
        line.startsWith("Gross commitment:")
          ? "Gross commitment: USD 40,000.001"
          : line,
      ),
    );
    expect(automaticEconomics(context, [invalid]).input).toBeNull();
  });
});
