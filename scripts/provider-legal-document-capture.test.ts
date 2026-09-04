import { describe, expect, it } from "vitest";
import {
  agreementUrl,
  readAgreementResponse,
} from "./provider-legal-document-capture";
import { syntheticAgreementPdf } from "./test-support/legal-documents";

describe("agreement download boundary", () => {
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
