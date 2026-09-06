import {
  LEGAL_DOCUMENT_EXTRACTOR_VERSION,
  LegalDocumentExtractionSchema,
  MAX_LEGAL_DOCUMENT_BYTES,
  MAX_LEGAL_DOCUMENT_PAGES,
  MAX_LEGAL_DOCUMENT_TEXT_BYTES,
  MAX_LEGAL_NAME_CITATIONS_PER_DOCUMENT,
  type LegalDocumentCitation,
  type LegalDocumentExtraction,
  type LegalDocumentProblem,
} from "../packages/domain/src/provider-legal-documents";
import { PdfSandboxError, readPdfInSandbox } from "./pdf-sandbox";

const compact = (value: string) => value.replace(/\s+/gu, " ").trim();
const entitySuffix =
  /\b(?:L\.?L\.?C\.?|L\.?P\.?|limited liability company|limited partnership)\.?$/iu;
const seriesQualification =
  /, established as a Series under the Parent LLC(?: Agreement\.)?$/u;

function failed(
  problem: LegalDocumentProblem,
  pageCount = 0,
): LegalDocumentExtraction {
  return {
    version: LEGAL_DOCUMENT_EXTRACTOR_VERSION,
    pageCount,
    problem,
    citations: [],
  };
}

// Deliberately recognize explicit vehicle roles, not arbitrary LLC-shaped text.
// A manager, subscriber, investor, filename or portfolio company is not a name
// source. New templates need a synthetic positive AND role-confusion regression.
export function extractLegalNameFromPages(
  pages: readonly string[],
): LegalDocumentExtraction {
  if (pages.length === 0 || pages.every((page) => compact(page).length === 0))
    return failed("unreadable");
  if (
    pages.length > MAX_LEGAL_DOCUMENT_PAGES ||
    Buffer.byteLength(pages.join("")) > MAX_LEGAL_DOCUMENT_TEXT_BYTES
  )
    return failed("limit_reached");
  const citations: LegalDocumentCitation[] = [];
  const titles: LegalDocumentCitation[] = [];
  pages.forEach((text, index) => {
    const lines = text.split(/\r?\n/u);
    lines.forEach((line, lineIndex) => {
      const label =
        /^\s*["“]?(?:Legal\s+)?(Issuer|Fund|Series)(?:\s+(?:Legal\s+)?Name)?["”]?\s*:\s*(.+?)\s*$/iu.exec(
          line,
        );
      if (label !== null) {
        // A provider's definitions may explicitly qualify a named series. The
        // qualification is not part of the name; no other prose is stripped.
        let value = compact(label[2] ?? "");
        let quote = compact(line);
        // The complete name is already on this line. Only the fixed parent-
        // agreement qualification may wrap; never reconstruct a split name or
        // absorb a following investor/manager definition into the vehicle.
        if (
          !seriesQualification.test(value) &&
          value.includes(", established as a Series under")
        ) {
          const nextLine = compact(lines[lineIndex + 1] ?? "");
          const continued = `${value} ${nextLine}`;
          if (seriesQualification.test(continued)) {
            value = continued;
            quote = `${quote} ${nextLine}`;
          }
        }
        const name = value.replace(seriesQualification, "");
        if (entitySuffix.test(name))
          citations.push({
            legalName: name,
            page: index + 1,
            quote,
            role: (label[1]?.toLowerCase() ?? "issuer") as
              "issuer" | "fund" | "series",
          });
      }
      if (
        /^\s*(?:AMENDED AND RESTATED\s+)?(?:LIMITED LIABILITY COMPANY|LIMITED PARTNERSHIP|OPERATING)\s+AGREEMENT\s*$/iu.test(
          line,
        )
      ) {
        // A standalone title + OF + complete vehicle line. Do not reconstruct
        // a split or truncated legal name, or take the first LLC in prose.
        const following = lines
          .slice(lineIndex + 1)
          .filter((part) => compact(part) !== "")
          .slice(0, 2);
        const name = compact(following[1] ?? "");
        if (
          /^of$/iu.test(compact(following[0] ?? "")) &&
          entitySuffix.test(name)
        ) {
          titles.push({
            legalName: name,
            page: index + 1,
            quote: compact([line, ...following].join(" ")),
            role: "company_agreement",
          });
        }
      }
    });
  });
  // A compartment represented by another company is not evidence that the
  // investor owns that representative's LLC interests. Never substitute it.
  if (
    pages.some((page) =>
      /as (?:a )?compartment of and duly represented by/iu.test(compact(page)),
    )
  )
    return failed("other_structure", pages.length);
  // Explicit definitions control over capitalized cover headings. A title of
  // an attached parent agreement must not replace the defined invested fund.
  const definesParent = pages.some((page) =>
    /["“]?(?:Parent|Master)\s+(?:LLC|LP|Agreement)["”]?\s*:/iu.test(page),
  );
  if (citations.length === 0 && !definesParent) citations.push(...titles);
  if (citations.length === 0) return failed("name_not_found", pages.length);
  // Preserve spelling, punctuation and case exactly. Even seemingly equivalent
  // variants must be resolved, not silently merged by a name heuristic.
  const alternatives = [
    ...new Map(
      citations.map((citation) => [citation.legalName, citation]),
    ).values(),
  ];
  if (alternatives.length > MAX_LEGAL_NAME_CITATIONS_PER_DOCUMENT)
    return failed("limit_reached", pages.length);
  return LegalDocumentExtractionSchema.parse({
    version: LEGAL_DOCUMENT_EXTRACTOR_VERSION,
    pageCount: pages.length,
    problem: alternatives.length > 1 ? "conflicting" : null,
    citations: alternatives.length > 1 ? alternatives : citations.slice(0, 1),
  });
}

export async function extractLegalNameFromPdf(
  bytes: Uint8Array,
): Promise<LegalDocumentExtraction> {
  if (bytes.byteLength > MAX_LEGAL_DOCUMENT_BYTES)
    return failed("limit_reached");
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    return failed("unreadable");
  try {
    const { pageCount, text, problem } = await readPdfInSandbox(bytes);
    if (problem !== null) return failed(problem);
    const pages = text.split("\f");
    if (pages.at(-1)?.trim() === "") pages.pop();
    if (pages.length !== pageCount) return failed("unreadable");
    return extractLegalNameFromPages(pages);
  } catch (error) {
    return failed(
      error instanceof PdfSandboxError ? error.problem : "unreadable",
    );
  }
}
