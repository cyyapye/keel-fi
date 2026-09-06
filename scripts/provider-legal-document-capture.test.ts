import { describe, expect, it } from "vitest";
import {
  agreementUrl,
  readAgreementResponse,
} from "./provider-legal-document-capture";
import { syntheticAgreementPdf } from "./test-support/legal-documents";
import {
  LegalDocumentExtractionSchema,
  LegalDocumentScanSchema,
} from "../packages/domain/src/provider-legal-documents";
import { syntheticDocumentScan } from "./test-support/legal-documents";

describe("agreement download boundary", () => {
  it("rejects stale and future-dated signature databases, not just a claimed clean verdict", () => {
    const scan = syntheticDocumentScan();
    expect(LegalDocumentScanSchema.safeParse(scan).success).toBe(true);
    expect(
      LegalDocumentScanSchema.safeParse({
        ...scan,
        databaseUpdatedAt: "2026-08-28T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      LegalDocumentScanSchema.safeParse({
        ...scan,
        databaseUpdatedAt: "2026-09-02T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
  it("reads previous extraction observations but rejects unknown future versions", () => {
    const extraction = {
      pageCount: 0,
      problem: "name_not_found",
      citations: [],
    };
    expect(
      LegalDocumentExtractionSchema.safeParse({ ...extraction, version: 1 })
        .success,
    ).toBe(true);
    expect(
      LegalDocumentExtractionSchema.safeParse({ ...extraction, version: 2 })
        .success,
    ).toBe(true);
    expect(
      LegalDocumentExtractionSchema.safeParse({ ...extraction, version: 3 })
        .success,
    ).toBe(true);
    expect(
      LegalDocumentExtractionSchema.safeParse({ ...extraction, version: 4 })
        .success,
    ).toBe(true);
    expect(
      LegalDocumentExtractionSchema.safeParse({ ...extraction, version: 5 })
        .success,
    ).toBe(false);
  });
  it.each([
    [
      "sydecar",
      "https://storage.googleapis.com/sydecar-prod-documents/synthetic/agreement.pdf?synthetic=redacted",
    ],
    [
      "tokenfolio",
      "https://firebasestorage.googleapis.com/v0/b/tokenfolio-343020.appspot.com/o/synthetic%2Fagreement.pdf?synthetic=redacted",
    ],
  ] as const)(
    "allows only %s's observed private document store",
    (provider, url) => {
      expect(agreementUrl(provider, url).protocol).toBe("https:");
    },
  );
  it.each([
    "http://storage.googleapis.com/sydecar-prod-documents/one.pdf",
    "https://storage.googleapis.com/another-bucket/one.pdf",
    "https://storage.googleapis.com.evil.example/sydecar-prod-documents/one.pdf",
    "https://user:password@storage.googleapis.com/sydecar-prod-documents/one.pdf",
    "https://storage.googleapis.com:8443/sydecar-prod-documents/one.pdf",
    "http://127.0.0.1/private.pdf",
    "file:///private/agreement.pdf",
  ])("rejects unknown origins, buckets, credentials and protocols", (url) => {
    expect(() => agreementUrl("sydecar", url)).toThrow();
  });
  it("bounds streaming bytes even without a trustworthy length header", async () => {
    const bytes = syntheticAgreementPdf();
    expect(
      Uint8Array.from(await readAgreementResponse(new Response(bytes))),
    ).toEqual(bytes);
    await expect(
      readAgreementResponse(new Response(bytes), 20),
    ).rejects.toThrow("limit_reached");
    await expect(
      readAgreementResponse(
        new Response(bytes, { headers: { "Content-Length": "999999999" } }),
      ),
    ).rejects.toThrow("limit_reached");
    await expect(
      readAgreementResponse(new Response("Sign in")),
    ).rejects.toThrow("unreadable");
    await expect(
      readAgreementResponse(new Response(null, { status: 403 })),
    ).rejects.toThrow("inaccessible");
  });
});
