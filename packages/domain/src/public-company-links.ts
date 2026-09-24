import { z } from "zod";
import { companySuggestionKey } from "./company-identity";

const Id = z.string().min(1).max(500);
const Label = z.string().trim().min(1).max(1_000);

export const PublicCompanyLinkCatalogSchema = z.object({
  securities: z.array(
    z.object({
      exposureId: Id,
      name: Label,
      companyId: Id.nullable(),
      reviewId: Id.nullable(),
      positionCount: z.number().int().positive(),
    }),
  ),
  companies: z.array(z.object({ id: Id, name: Label })),
});

export const PublicCompanyLinkReviewSchema = z.object({
  exposureId: Id,
  companyId: Id,
  expectedReviewId: Id.nullable(),
  sourceUrl: z
    .url()
    .max(2_048)
    .refine(
      (value) => /^https?:\/\//iu.test(value),
      "Use an http or https URL.",
    ),
  reason: z.string().trim().min(1).max(1_000),
});

export const PublicCompanyLinkReceiptSchema = z.object({
  id: Id,
  exposureId: Id,
  companyId: Id,
  reviewedAt: z.iso.datetime({ offset: true }),
});

export type PublicCompanyLinkCatalog = z.infer<
  typeof PublicCompanyLinkCatalogSchema
>;
export type PublicCompanyLinkReview = z.infer<
  typeof PublicCompanyLinkReviewSchema
>;

export const PublicCompanyMatchSchema = z.object({
  id: Id,
  exposureId: Id,
  status: z.enum([
    "recommended",
    "ambiguous",
    "no_match",
    "unavailable",
    "pending",
  ]),
  companyId: Id.nullable(),
  companyName: Label.nullable(),
  reason: z.string().max(1_000),
  sourceUrl: z.url().nullable(),
  sourceTitle: z.string().max(500).nullable(),
});
export type PublicCompanyMatch = z.infer<typeof PublicCompanyMatchSchema>;
export type MatchCompany = {
  id: string;
  name: string;
  aliases: string[];
  websiteHost: string | null;
};
export const IssuerSearchResultsSchema = z
  .array(
    z.object({
      title: z.string().max(500),
      url: z.url().max(2_048),
      description: z.string().max(2_000),
    }),
  )
  .max(5);
export type IssuerSearchResults = z.infer<typeof IssuerSearchResultsSchema>;

export function issuerName(name: string): string {
  return name
    .replace(/\s*[-–—]\s*(?:ordinary|common|class|shares|stock)\b.*$/iu, "")
    .replace(
      /\s+(?:class\s+[a-z0-9]+|ordinary shares|common stock)(?:\s+shares)?$/iu,
      "",
    )
    .trim();
}
const key = (name: string) => companySuggestionKey(issuerName(name));
const containsName = (text: string, name: string) => {
  const value = companySuggestionKey(text);
  const wanted = key(name);
  return wanted.length >= 4 && ` ${value} `.includes(` ${wanted} `);
};

/** Names propose an identity; only the recorded approval accepts it. */
export function recommendPublicCompany(
  securityName: string,
  companies: readonly MatchCompany[],
  sources: IssuerSearchResults = [],
): Omit<PublicCompanyMatch, "id" | "exposureId"> {
  const empty = {
    companyId: null,
    companyName: null,
    sourceUrl: null,
    sourceTitle: null,
  };
  if (
    /\b(?:etf|fund|trust|warrant|option|depositary|adr)\b/iu.test(securityName)
  )
    return {
      ...empty,
      status: "no_match",
      reason: "This instrument needs its issuer confirmed before grouping.",
    };
  const exact = companies.filter((company) =>
    [company.name, ...company.aliases].some(
      (name) => key(name) === key(securityName),
    ),
  );
  const found = new Map<
    string,
    { company: MatchCompany; source: IssuerSearchResults[number] | null }
  >();
  for (const company of exact) found.set(company.id, { company, source: null });
  for (const source of sources) {
    const host = new URL(source.url).hostname
      .toLowerCase()
      .replace(/^www\./u, "");
    const text = `${source.title} ${source.description}`;
    if (!containsName(text, securityName)) continue;
    for (const company of companies) {
      const officialHost = company.websiteHost
        ?.toLowerCase()
        .replace(/^www\./u, "");
      const official =
        officialHost != null &&
        (host === officialHost || host.endsWith(`.${officialHost}`));
      const escape = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const issuerPattern = `${escape(key(securityName))}(?: (?:inc|incorporated|corp|corporation|ltd|limited|llc|plc))*`;
      const normalized = companySuggestionKey(source.description);
      const regulator = host === "sec.gov" || host.endsWith(".sec.gov");
      // Bind the alias/operator claim to the issuer itself, not another company
      // mentioned elsewhere in a search result.
      const explicitAlias =
        regulator &&
        [company.name, ...company.aliases].some((name) =>
          new RegExp(
            `(?:^| )${issuerPattern} (?:also )?(?:known as|doing business as|d b a|trading as|called) ${escape(key(name))}(?: |$)`,
            "u",
          ).test(normalized),
        );
      const issuerHeading = new RegExp(
        `^${issuerPattern}(?: (?:privacy policy|legal notice|terms of service|terms and conditions))?$`,
        "u",
      ).test(companySuggestionKey(source.title));
      const legalPage = /\/(?:legal|privacy|terms)(?:[/.-]|$)/iu.test(
        new URL(source.url).pathname,
      );
      const operatorStatement = [company.name, ...company.aliases].some(
        (name) =>
          new RegExp(
            `(?:^| )${issuerPattern}(?: ${escape(key(name))})? (?:we|us|our|operates this website|operates this service)(?: |$)`,
            "u",
          ).test(normalized),
      );
      if (
        (official && (issuerHeading || (legalPage && operatorStatement))) ||
        explicitAlias
      )
        found.set(company.id, { company, source });
    }
  }
  if (found.size !== 1)
    return {
      ...empty,
      status: found.size > 1 ? "ambiguous" : "no_match",
      reason:
        found.size > 1
          ? "More than one company matches the issuer evidence. Choose the correct company."
          : "Keel could not establish a confident issuer match from the available evidence.",
    };
  const { company, source } = [...found.values()][0]!;
  return {
    status: "recommended",
    companyId: company.id,
    companyName: company.name,
    reason: source
      ? `The issuer name appears in a source associated with ${company.name}.`
      : "The issuer name matches this company’s accepted name or alias after removing share-class labels and legal suffixes.",
    sourceUrl: source?.url ?? null,
    sourceTitle: source?.title ?? "Accepted company names",
  };
}

export const PublicCompanyLookupInputSchema = z
  .object({ exposureId: Id })
  .strict();
export const PublicCompanyApprovalInputSchema = z
  .object({ id: z.string().uuid() })
  .strict();
