import { describe, expect, it, vi } from "vitest";
import {
  extractLegalNameFromPages,
  extractLegalNameFromPdf,
} from "./legal-document-extraction";
import { syntheticAgreementPdf } from "./test-support/legal-documents";

describe("local legal document extraction", () => {
  it("preserves a complete exact vehicle name and page citation", () => {
    expect(
      extractLegalNameFromPages([
        "Investor: Synthetic Family LLC",
        "Issuer: Synthetic Atlas, a series of Synthetic Ventures LLC",
      ]),
    ).toMatchObject({
      problem: null,
      pageCount: 2,
      citations: [
        {
          legalName: "Synthetic Atlas, a series of Synthetic Ventures LLC",
          page: 2,
          quote: "Issuer: Synthetic Atlas, a series of Synthetic Ventures LLC",
          role: "issuer",
        },
      ],
    });
  });
  it("reads an explicit governing-agreement title without deriving names", () => {
    expect(
      extractLegalNameFromPages([
        "LIMITED LIABILITY COMPANY AGREEMENT\n\nOF\n\nSynthetic Atlas SPV LLC\nManager: Synthetic Administrator LLC",
      ]),
    ).toMatchObject({
      problem: null,
      citations: [
        { legalName: "Synthetic Atlas SPV LLC", role: "company_agreement" },
      ],
    });
  });
  it.each([
    "Investor: Synthetic Investor LLC\nManager: Synthetic Administrator LLC\nPortfolio Company: Synthetic Labs LLC",
    "Entity: Synthetic Investor LLC\nInvestment: Synthetic Atlas",
    "Subscription Agreement\nThe company Synthetic Atlas LLC is managed by Synthetic Manager LLC.",
    "LIMITED LIABILITY COMPANY AGREEMENT\nOF\nSynthetic Very Long\nVehicle LLC",
    "Filename: Synthetic Atlas LLC.pdf",
    "LIMITED LIABILITY COMPANY AGREEMENT\nOF\nSYNTHETIC PARENT LLC\n“Parent LLC”: Synthetic Parent LLC\nThe invested series is defined in a separate agreement.",
  ])(
    "does not treat labels, investor/manager names or truncated names as vehicle evidence",
    (text) => {
      expect(extractLegalNameFromPages([text])).toMatchObject({
        problem: "name_not_found",
        citations: [],
      });
    },
  );
  it("does not silently normalize conflicting punctuation or case", () => {
    expect(
      extractLegalNameFromPages([
        "Issuer: Synthetic Atlas, LLC",
        "Issuer: Synthetic Atlas LLC",
      ]),
    ).toMatchObject({ problem: "conflicting", citations: [] });
  });
  it("uses the exact defined fund, not its uppercase cover, parent or administrator", () => {
    expect(
      extractLegalNameFromPages([
        "LIMITED LIABILITY COMPANY AGREEMENT\nOF\nSYNTHETIC FIRST, A SERIES OF SYNTHETIC PARENT LLC",
        "“Fund”: Synthetic First, a Series of Synthetic Parent LLC, established as a Series under the Parent LLC\nAgreement.\n“Administrator”: Synthetic Admin LLC\n“Parent LLC”: Synthetic Parent LLC.",
      ]),
    ).toMatchObject({
      problem: null,
      citations: [
        {
          legalName: "Synthetic First, a Series of Synthetic Parent LLC",
          page: 2,
          role: "fund",
        },
      ],
    });
  });
  it("keeps compartment/certificate structures distinct from their representative LLC", () => {
    expect(
      extractLegalNameFromPages([
        "Synthetic Series VII, as a compartment of and duly represented by Synthetic Representative LLC, as Issuer.\nEQUITY CERTIFICATES SUBSCRIPTION AGREEMENT",
      ]),
    ).toMatchObject({ problem: "other_structure", citations: [] });
  });
  it.each([
    ["Parent", "LLC Agreement."],
    ["the", "Parent LLC Agreement."],
  ])(
    "reads a complete source name when only its parent qualification wraps after %s",
    (ending, nextLine) => {
      const name = "Synthetic Atlas, a Series of Synthetic Parent LLC";
      const prefix = ending === "Parent" ? "under the Parent" : "under the";
      const definition = `“Fund”: ${name}, established as a Series ${prefix}\n${nextLine}`;
      expect(extractLegalNameFromPages([definition])).toMatchObject({
        version: 2,
        problem: null,
        citations: [
          {
            legalName: name,
            page: 1,
            role: "fund",
            quote: definition.replace("\n", " "),
          },
        ],
      });
    },
  );
  it.each([
    "“Fund”: Synthetic Atlas, a Series of\nSynthetic Parent LLC, established as a Series under the Parent LLC Agreement.",
    "“Fund”: Synthetic Atlas LLC, established as a Series under the\n“Manager”: Synthetic Manager LLC",
  ])(
    "does not join a split name or another role to complete a qualification",
    (text) => {
      expect(extractLegalNameFromPages([text])).toMatchObject({
        problem: "name_not_found",
        citations: [],
      });
    },
  );
  it("keeps scans and safety limits explicit", async () => {
    expect(extractLegalNameFromPages([" "])).toMatchObject({
      problem: "unreadable",
    });
    expect(
      extractLegalNameFromPages(Array.from({ length: 151 }, () => "text")),
    ).toMatchObject({ problem: "limit_reached" });
    expect(
      await extractLegalNameFromPdf(
        new TextEncoder().encode("<html>Sign in</html>"),
      ),
    ).toMatchObject({ problem: "unreadable" });
    expect(
      await extractLegalNameFromPdf(new Uint8Array(8 * 1024 * 1024 + 1)),
    ).toMatchObject({ problem: "limit_reached" });
  });
  it("fails closed when sandbox configuration is missing, even if host Poppler exists", async () => {
    vi.stubEnv(
      "KEEL_PDF_SANDBOX_CONFIG",
      "/nonexistent/synthetic-pdf-sandbox.json",
    );
    try {
      expect(
        await extractLegalNameFromPdf(syntheticAgreementPdf()),
      ).toMatchObject({
        problem: "extractor_unavailable",
        citations: [],
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("extracts a synthetic PDF with the real isolated reader", async () => {
    expect(
      await extractLegalNameFromPdf(syntheticAgreementPdf()),
    ).toMatchObject({
      problem: null,
      pageCount: 1,
      citations: [{ legalName: "Synthetic Atlas SPV LLC", page: 1 }],
    });
  });
});
