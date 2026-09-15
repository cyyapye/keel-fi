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
import {
  agreementEconomicsLine,
  MAX_ECONOMICS_CITATIONS,
} from "../packages/domain/src/agreement-economics";

const compact = (value: string) => value.replace(/\s+/gu, " ").trim();
const entitySuffix =
  /\b(?:L\.?L\.?C\.?|L\.?P\.?|limited liability company|limited partnership)\.?$/iu;
const seriesQualification =
  /, established as a Series under the Parent LLC(?: Agreement\.)?$/u;

// A bounded definition paragraph, not a mention in risks, a manager's name,
// a list of possible investments, or a company guessed from the deal label.
function portfolioInvestmentDefinition(
  lines: readonly string[],
  start: number,
) {
  if (!/^\s*["“]?Portfolio Investment["”]?\s*:/iu.test(lines[start] ?? ""))
    return null;
  const paragraph = [lines[start]!];
  let end = start + 1;
  for (; end < lines.length && paragraph.length < 4; end++) {
    const next = lines[end]!;
    if (compact(next) === "" || /^\s*["“]?[^:\n]{1,100}["”]?\s*:/u.test(next))
      break;
    paragraph.push(next);
  }
  // Never accept a truncated paragraph after reaching the line budget.
  if (
    paragraph.length === 4 &&
    compact(lines[end] ?? "") !== "" &&
    !/^\s*["“]?[^:\n]{1,100}["”]?\s*:/u.test(lines[end]!)
  )
    return null;
  const quote = compact(paragraph.join(" "));
  const match =
    /^["“]?Portfolio Investment["”]?\s*:\s*The entity referred to as (.{1,1000})\.$/iu.exec(
      quote,
    );
  if (match === null || quote.length > 2_000) return null;
  let companyName = match[1]!;
  // The abbreviation's full stop belongs to the exact name; the sentence's
  // full stop after LLC/Corporation does not.
  if (/\b(?:Inc|Corp|Ltd|Co)$/u.test(companyName)) companyName += ".";
  if (
    !/\b(?:LLC|LP|Inc\.?|Corp\.?|Ltd\.?|Co\.?|Corporation|Limited|PBC)$/iu.test(
      companyName,
    ) ||
    /\b(?:manager|subscriber|investor|representative|either|or|through|including|comparable)\b/iu.test(
      companyName,
    ) ||
    (companyName.match(
      /\b(?:LLC|LP|Inc\.?|Corp\.?|Ltd\.?|Co\.?|Corporation|Limited|PBC)\b/giu,
    )?.length ?? 0) !== 1
  )
    return null;
  return { companyName, quote };
}

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
  const companyCitations: NonNullable<
    LegalDocumentExtraction["companyCitations"]
  > = [];
  const titles: LegalDocumentCitation[] = [];
  const economicsCitations = pages.flatMap((text, index) =>
    text
      .split(/\r?\n/u)
      .flatMap((line) => agreementEconomicsLine(line, index + 1)),
  );
  if (economicsCitations.length > MAX_ECONOMICS_CITATIONS)
    return failed("limit_reached", pages.length);
  const economics = {
    ...(economicsCitations.length === 0 ? {} : { economicsCitations }),
    ...(pages.some(
      (page) =>
        /\b(?:hurdle rate|preferred return|catch[- ]up|tiered carry|tiered management fee)\b/iu.test(
          page,
        ) ||
        page
          .split(/\r?\n/u)
          .some(
            (line) =>
              /\b(?:management fee|setup fee|carry|carried interest)\b.*\d.*%/iu.test(
                line,
              ) && agreementEconomicsLine(line, 1).length === 0,
          ),
    )
      ? { economicsProblem: "nonstandard_terms" as const }
      : {}),
  };
  pages.forEach((text, index) => {
    const lines = text.split(/\r?\n/u);
    lines.forEach((line, lineIndex) => {
      const investment = portfolioInvestmentDefinition(lines, lineIndex);
      if (investment !== null)
        companyCitations.push({
          ...investment,
          role: "portfolio_investment",
          page: index + 1,
        });
      const company =
        /^\s*["“]?(Underlying Company|Target Company|Portfolio Company)["”]?\s*:\s*([^\n]{1,1000}?)\s*$/iu.exec(
          line,
        );
      if (company !== null && compact(line).length <= 2_000) {
        companyCitations.push({
          companyName: compact(company[2] ?? ""),
          role: (company[1]?.toLowerCase().replace(" ", "_") ??
            "underlying_company") as
            "underlying_company" | "target_company" | "portfolio_company",
          page: index + 1,
          quote: compact(line),
        });
      }
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
  // Bounded evidence, never an unbounded list or a guessed choice among names.
  const companies = [
    ...new Map(
      companyCitations.map((citation) => [
        `${citation.companyName}:${citation.page}`,
        citation,
      ]),
    ).values(),
  ];
  if (companies.length > 8) return failed("limit_reached", pages.length);
  // A compartment represented by another company is not evidence that the
  // investor owns that representative's LLC interests. Never substitute it.
  const structurePage = pages.findIndex((page) =>
    /as (?:a )?compartment of and duly represented by/iu.test(compact(page)),
  );
  if (structurePage >= 0) {
    const text = pages[structurePage] ?? "";
    // Recognize the explicit party clause only. Never promote an arbitrary
    // LLC elsewhere on the page or the representative to the invested vehicle.
    const clause =
      /(?:^|\n)\s*([^\n]{1,1000}?),\s*as (?:a )?compartment of and duly represented by\s+([^\n]{1,1000}?),\s*as [Ii]ssuer\b\.?/u.exec(
        text,
      );
    const line =
      text.split(/\r?\n/u).find((value) => /compartment/iu.test(value)) ?? text;
    const quote = compact(clause?.[0] ?? line).slice(0, 2_000);
    const instrumentPage = pages.findIndex((page) =>
      /EQUITY CERTIFICATES SUBSCRIPTION AGREEMENT/iu.test(compact(page)),
    );
    return LegalDocumentExtractionSchema.parse({
      ...failed("other_structure", pages.length),
      ...economics,
      companyCitations: companies,
      structure: {
        kind: "compartment",
        page: structurePage + 1,
        quote,
        parties:
          clause === null ||
          compact(clause[0]).length > 2_000 ||
          !entitySuffix.test(compact(clause[2] ?? ""))
            ? []
            : [
                {
                  legalName: compact(clause[1] ?? ""),
                  role: "compartment",
                  page: structurePage + 1,
                  quote,
                },
                {
                  legalName: compact(clause[2] ?? ""),
                  role: "representative",
                  page: structurePage + 1,
                  quote,
                },
              ],
        instrument:
          instrumentPage < 0
            ? null
            : {
                label: "Equity certificates",
                page: instrumentPage + 1,
                quote: /EQUITY CERTIFICATES SUBSCRIPTION AGREEMENT/iu.exec(
                  compact(pages[instrumentPage] ?? ""),
                )?.[0],
              },
      },
    });
  }
  // Explicit definitions control over capitalized cover headings. A title of
  // an attached parent agreement must not replace the defined invested fund.
  const definesParent = pages.some((page) =>
    /["“]?(?:Parent|Master)\s+(?:LLC|LP|Agreement)["”]?\s*:/iu.test(page),
  );
  if (citations.length === 0 && !definesParent) citations.push(...titles);
  if (citations.length === 0)
    return {
      ...failed("name_not_found", pages.length),
      ...economics,
      companyCitations: companies,
    };
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
    companyCitations: companies,
    ...economics,
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
