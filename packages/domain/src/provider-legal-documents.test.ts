import { describe, expect, it } from "vitest";
import {
  LEGAL_DOCUMENT_PROBLEM_COPY,
  LegalDocumentExtractionSchema,
  LegalDocumentScanSchema,
} from "./provider-legal-documents";

describe("document recovery guidance", () => {
  it("asks for the exact name and page without making an excerpt mandatory", () => {
    expect(LEGAL_DOCUMENT_PROBLEM_COPY.name_not_found).toContain(
      "Keel did not extract an exact vehicle name",
    );
    expect(LEGAL_DOCUMENT_PROBLEM_COPY.name_not_found).toContain("page");
    expect(LEGAL_DOCUMENT_PROBLEM_COPY.name_not_found).not.toMatch(
      /excerpt|reason for correction|name is absent|name is missing/iu,
    );
  });

  it("distinguishes absent documents from failed reads and failed extraction", () => {
    expect(LEGAL_DOCUMENT_PROBLEM_COPY.missing).toContain(
      "No agreement was available",
    );
    for (const problem of [
      "inaccessible",
      "unreadable",
      "name_not_found",
      "limit_reached",
      "extractor_unavailable",
      "page_changed",
      "security_blocked",
      "scanner_unavailable",
    ] as const) {
      expect(LEGAL_DOCUMENT_PROBLEM_COPY[problem]).not.toMatch(
        /no agreement|no legal name|name is absent|name is missing/iu,
      );
      expect(LEGAL_DOCUMENT_PROBLEM_COPY[problem]).not.toBe(
        LEGAL_DOCUMENT_PROBLEM_COPY.missing,
      );
    }
  });
});

describe("document security reasons", () => {
  const scan = {
    version: 2,
    engineVersion: "1.5.3",
    databaseVersion: 28000,
    databaseUpdatedAt: "2026-09-01T12:00:00.000Z",
    scannedAt: "2026-09-01T12:00:00.000Z",
    sha256: "a".repeat(64),
    outcome: "blocked",
    findings: [{ reason: "encrypted", signature: "Heuristics.Encrypted.PDF" }],
  };
  it("retains the specific alert while accepting historical binary verdicts", () => {
    expect(LegalDocumentScanSchema.safeParse(scan).success).toBe(true);
    const { findings, ...legacy } = scan;
    expect(findings).toHaveLength(1);
    expect(
      LegalDocumentScanSchema.safeParse({ ...legacy, version: 1 }).success,
    ).toBe(true);
  });
  it("rejects inconsistent, unbounded, or content-bearing scanner details", () => {
    for (const candidate of [
      { ...scan, outcome: "clean" },
      { ...scan, findings: [] },
      { ...scan, findings: Array.from({ length: 9 }, () => scan.findings[0]) },
      {
        ...scan,
        findings: [
          {
            reason: "malware_signature",
            signature: "Heuristics.Encrypted.PDF",
          },
        ],
      },
      {
        ...scan,
        findings: [
          { reason: "unknown_alert", signature: "private agreement text\n" },
        ],
      },
      { ...scan, version: 3 },
    ])
      expect(LegalDocumentScanSchema.safeParse(candidate).success).toBe(false);
    expect(
      LegalDocumentScanSchema.safeParse({
        ...scan,
        findings: [{ reason: "unknown_alert", signature: null }],
      }).success,
    ).toBe(true);
    expect(
      LegalDocumentScanSchema.safeParse({
        ...scan,
        outcome: "clean",
        findings: [],
      }).success,
    ).toBe(true);
  });
});

describe("conflicting legal-document evidence", () => {
  it("requires v7 for portfolio-investment definitions and retains v6 label citations", () => {
    const citation = {
      companyName: "Synthetic Orchard Global, LLC",
      page: 1,
      quote:
        "“Portfolio Investment”: The entity referred to as Synthetic Orchard Global, LLC.",
      role: "portfolio_investment",
    };
    const extraction = {
      pageCount: 1,
      problem: "name_not_found",
      citations: [],
      companyCitations: [citation],
    };
    expect(
      LegalDocumentExtractionSchema.safeParse({ ...extraction, version: 7 })
        .success,
    ).toBe(true);
    expect(
      LegalDocumentExtractionSchema.safeParse({ ...extraction, version: 6 })
        .success,
    ).toBe(false);
    expect(
      LegalDocumentExtractionSchema.safeParse({
        ...extraction,
        version: 6,
        companyCitations: [{ ...citation, role: "underlying_company" }],
      }).success,
    ).toBe(true);
  });
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

describe("source-reported compartment structures", () => {
  const quote =
    "Synthetic Series I, as a compartment of and duly represented by Synthetic Representative LLC, as Issuer.";
  const extraction = {
    version: 4,
    pageCount: 2,
    problem: "other_structure",
    citations: [],
    structure: {
      kind: "compartment",
      page: 1,
      quote,
      parties: [
        {
          legalName: "Synthetic Series I",
          role: "compartment",
          page: 1,
          quote,
        },
        {
          legalName: "Synthetic Representative LLC",
          role: "representative",
          page: 1,
          quote,
        },
      ],
      instrument: {
        label: "Equity certificates",
        page: 2,
        quote: "EQUITY CERTIFICATES SUBSCRIPTION AGREEMENT",
      },
    },
  };
  it("preserves exact names, roles and interest evidence, not an LLC conclusion", () => {
    expect(LegalDocumentExtractionSchema.parse(extraction)).toEqual(extraction);
  });
  it("rejects forged excerpts, invalid pages, unsafe states and unsupported versions", () => {
    for (const candidate of [
      { ...extraction, version: 3 },
      { ...extraction, version: 8 },
      { ...extraction, problem: null },
      { ...extraction, problem: "security_blocked" },
      { ...extraction, pageCount: 1 },
      { ...extraction, structure: { ...extraction.structure, page: 3 } },
      {
        ...extraction,
        structure: {
          ...extraction.structure,
          parties: [{ ...extraction.structure.parties[0], page: 3 }],
        },
      },
      {
        ...extraction,
        structure: {
          ...extraction.structure,
          parties: [
            { ...extraction.structure.parties[0], quote: "Unrelated text" },
          ],
        },
      },
    ])
      expect(LegalDocumentExtractionSchema.safeParse(candidate).success).toBe(
        false,
      );
  });
});
