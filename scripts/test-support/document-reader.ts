import { createHash } from "node:crypto";
import { extractLegalNameFromPages } from "../legal-document-extraction";
import { syntheticAgreementPdf } from "./legal-documents";

// A byte-boundary fixture, not a PDF parser. Only explicitly registered PDFs
// are accepted. Real Poppler and scanner wiring remain separate required gates.
export function documentReaderFixture() {
  const pagesByHash = new Map<string, readonly string[]>();
  const key = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  return {
    pdf(
      this: void,
      lines: readonly string[] = [
        "Subscription Agreement",
        "Issuer: Synthetic Atlas SPV LLC",
      ],
    ) {
      const bytes = syntheticAgreementPdf(lines);
      pagesByHash.set(key(bytes), [lines.join("\n")]);
      return bytes;
    },
    extract(this: void, bytes: Uint8Array) {
      const pages = pagesByHash.get(key(bytes));
      if (pages === undefined)
        throw new Error("Unregistered synthetic PDF bytes");
      return Promise.resolve(extractLegalNameFromPages(pages));
    },
  };
}
