import {
  FinancingAnnouncementFactsSchema,
  IsoTimestampSchema,
} from "@keel/domain";
import { z } from "zod";

import {
  extractFinancingAnnouncementFacts,
  isCompanyFinancingAnnouncementTitle,
} from "./financing-announcement";

/** One million represents complete confidence; grades never use floating point. */
export const PPM_MAX = 1_000_000;
export const PpmSchema = z.number().int().min(0).max(PPM_MAX);

/** The bounded maximum for one decompressed company-web document. */
export const MAX_OFFICIAL_COMPANY_RESPONSE_BYTES = 1_024 * 1_024;
/**
 * The end-to-end ceiling for new source URLs emitted from one fetched document.
 * It matches the D1 registration boundary so a link-rich root page cannot turn
 * a successful verification into a retrying queue failure.
 */
export const MAX_COMPANY_WEB_DISCOVERY_CANDIDATES = 40;
export const MAX_COMPANY_WEB_EVENT_TEXT_CHARS = 2_000;
export const MAX_COMPANY_WEB_DOCUMENT_CHARS =
  MAX_OFFICIAL_COMPANY_RESPONSE_BYTES;

export const OfficialCompanySourceStatusSchema = z.enum([
  "discovered",
  "verified",
  "active",
  "degraded",
  "quarantined",
]);

export const DiscoveryMethodSchema = z.enum([
  "homepage_link",
  "newsroom_link",
  "feed_autodiscovery",
  "sitemap",
  "standard_path",
]);

export const FetchOutcomeSchema = z.enum([
  "not_fetched",
  "ok",
  "stale",
  "parse_failed",
  "content_type_rejected",
  "oversized",
  "network_error",
]);

export const CompanyWebsiteInputSchema = z.object({
  companyId: z.string().trim().min(1).max(255),
  homepageUrl: z.string().trim().min(1).max(2_048),
});

export const CanonicalCompanyWebsiteSchema = z.object({
  companyId: z.string().min(1).max(255),
  homepageUrl: z.string().url().max(2_048),
  approvedWebsiteHost: z.string().min(1).max(253),
});

export const SourceUrlPolicyInputSchema = z.object({
  rawUrl: z.string().trim().min(1).max(2_048),
  approvedWebsiteHost: z.string().trim().min(1).max(253),
});

export const CanonicalSourceUrlSchema = z.object({
  canonicalUrl: z.string().url().max(2_048),
  host: z.string().min(1).max(253),
});

export const SourceUrlRejectionReasonSchema = z.enum([
  "invalid_url",
  "https_required",
  "non_default_port",
  "credentials_not_allowed",
  "fragment_not_allowed",
  "ip_literal_not_allowed",
  "invalid_approved_host",
  "host_not_approved",
]);

export const SourceUrlPolicyResultSchema = z.discriminatedUnion("accepted", [
  z.object({
    accepted: z.literal(true),
    source: CanonicalSourceUrlSchema,
  }),
  z.object({
    accepted: z.literal(false),
    reason: SourceUrlRejectionReasonSchema,
  }),
]);

export const DiscoveryCandidateInputSchema = z.object({
  candidateUrl: z.string().trim().min(1).max(2_048),
  approvedWebsiteHost: z.string().trim().min(1).max(253),
  discoveryMethod: DiscoveryMethodSchema,
  companyNameConfirmed: z.boolean(),
  fetchOutcome: FetchOutcomeSchema,
});

export const SourceGradeSchema = z.object({
  authorityPpm: PpmSchema,
  identityPpm: PpmSchema,
  securityPpm: PpmSchema,
  operationalPpm: PpmSchema,
});

export const DiscoveryCandidateGradeSchema = z.object({
  canonicalUrl: z.string().url().max(2_048).nullable(),
  urlPolicy: SourceUrlPolicyResultSchema,
  grade: SourceGradeSchema,
});

export const SourceLifecycleInputSchema = z.object({
  currentStatus: OfficialCompanySourceStatusSchema,
  grade: SourceGradeSchema,
});

export const SourceLifecycleDecisionSchema = z.object({
  nextStatus: OfficialCompanySourceStatusSchema,
  reason: z.enum([
    "unsafe_source",
    "ready_for_active_monitoring",
    "identity_and_authority_verified",
    "operationally_degraded",
    "insufficient_verification",
  ]),
});

export const SafeFetchRequestPolicySchema = z.object({
  method: z.literal("GET"),
  redirect: z.literal("manual"),
  credentials: z.literal("omit"),
  referrerPolicy: z.literal("no-referrer"),
  url: z.string().url().max(2_048),
  maxResponseBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_OFFICIAL_COMPANY_RESPONSE_BYTES),
  acceptedContentTypes: z.array(z.string().min(1)).min(1),
});

export const SafeFetchResponseInputSchema = z.object({
  status: z.number().int().min(100).max(599),
  responseUrl: z.string().trim().min(1).max(2_048),
  contentType: z.string().trim().max(255).nullable(),
  contentLength: z.number().int().nonnegative().nullable(),
  bytesRead: z.number().int().nonnegative(),
});

export const SafeFetchResponseDecisionSchema = z.object({
  accepted: z.boolean(),
  reason: z.enum([
    "accepted",
    "redirect_not_allowed",
    "non_success_status",
    "response_url_not_approved",
    "unsupported_content_type",
    "response_too_large",
  ]),
});

export const CompanyWebCandidateKindSchema = z.enum([
  "newsroom",
  "feed",
  "sitemap",
  "article",
]);

export const CompanyWebDiscoveryCandidateSchema = z.object({
  url: z.string().url().max(2_048),
  kind: CompanyWebCandidateKindSchema,
  discoveryMethod: DiscoveryMethodSchema,
});

export const CompanyWebDocumentInputSchema = z.object({
  source: CanonicalSourceUrlSchema,
  document: z.string().max(MAX_COMPANY_WEB_DOCUMENT_CHARS),
});

export const CompanyWebEventDocumentInputSchema = z
  .object({
    source: CanonicalSourceUrlSchema.extend({
      companyName: z.string().trim().min(1).max(500),
    }).strict(),
    document: z.string().max(MAX_COMPANY_WEB_DOCUMENT_CHARS),
  })
  .strict();

export const PublicCompanyEventTypeSchema = z.enum([
  "financing_announced",
  "acquisition_announced",
  "secondary_transaction_announced",
  "ipo_or_filing_announced",
  "shutdown_announced",
]);

/** A public observation only; financing facts never represent a holding mark. */
export const PublicCompanyEventObservationSchema = z
  .object({
    eventType: PublicCompanyEventTypeSchema,
    title: z.string().trim().min(1).max(500),
    canonicalUrl: z.string().url().max(2_048),
    publishedAt: IsoTimestampSchema.nullable(),
    evidenceText: z
      .string()
      .trim()
      .min(1)
      .max(MAX_COMPANY_WEB_EVENT_TEXT_CHARS),
    financingFacts: FinancingAnnouncementFactsSchema.nullable(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (
      observation.eventType !== "financing_announced" &&
      observation.financingFacts !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Only financing announcements may include financing facts.",
        path: ["financingFacts"],
      });
    }
  });

export type CanonicalCompanyWebsite = z.infer<
  typeof CanonicalCompanyWebsiteSchema
>;
export type CanonicalSourceUrl = z.infer<typeof CanonicalSourceUrlSchema>;
export type DiscoveryCandidateInput = z.infer<
  typeof DiscoveryCandidateInputSchema
>;
export type DiscoveryCandidateGrade = z.infer<
  typeof DiscoveryCandidateGradeSchema
>;
export type SourceGrade = z.infer<typeof SourceGradeSchema>;
export type SourceLifecycleDecision = z.infer<
  typeof SourceLifecycleDecisionSchema
>;
export type SafeFetchRequestPolicy = z.infer<
  typeof SafeFetchRequestPolicySchema
>;
export type SafeFetchResponseDecision = z.infer<
  typeof SafeFetchResponseDecisionSchema
>;
export type CompanyWebDiscoveryCandidate = z.infer<
  typeof CompanyWebDiscoveryCandidateSchema
>;
export type PublicCompanyEventObservation = z.infer<
  typeof PublicCompanyEventObservationSchema
>;

const DEFAULT_ACCEPTED_CONTENT_TYPES = [
  "text/html",
  "text/markdown",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
  "application/rss+xml",
  "application/atom+xml",
] as const;

const AUTHORITY_BY_DISCOVERY_METHOD: Record<
  z.infer<typeof DiscoveryMethodSchema>,
  number
> = {
  homepage_link: 1_000_000,
  newsroom_link: 950_000,
  feed_autodiscovery: 900_000,
  sitemap: 900_000,
  standard_path: 600_000,
};

function isIpv4Literal(host: string): boolean {
  const parts = host.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) {
        return false;
      }
      const value = Number(part);
      return value >= 0 && value <= 255;
    })
  );
}

function isIpLiteral(host: string): boolean {
  return (
    isIpv4Literal(host) ||
    (host.startsWith("[") && host.endsWith("]")) ||
    host.includes(":")
  );
}

/**
 * Produces the single ASCII hostname to which company-web discovery is bound.
 * This function deliberately accepts a hostname, not a URL, to prevent callers
 * from accidentally treating a path or a port as source authority.
 */
export function normalizeApprovedWebsiteHost(rawHost: string): string | null {
  const host = rawHost.trim().toLowerCase();
  if (
    host.length === 0 ||
    host.length > 253 ||
    host === "localhost" ||
    !host.includes(".") ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      host,
    ) ||
    isIpLiteral(host)
  ) {
    return null;
  }

  return host;
}

/** Creates a stable company homepage identity from an externally supplied URL. */
export function canonicalizeCompanyWebsite(
  input: z.input<typeof CompanyWebsiteInputSchema>,
): CanonicalCompanyWebsite {
  const parsed = CompanyWebsiteInputSchema.parse(input);
  let url: URL;
  try {
    url = new URL(parsed.homepageUrl);
  } catch {
    throw new Error("Company homepage must be a valid URL.");
  }

  const result = evaluateSourceUrl({
    rawUrl: parsed.homepageUrl,
    approvedWebsiteHost: url.hostname,
  });
  if (!result.accepted) {
    throw new Error(`Company homepage is not eligible: ${result.reason}.`);
  }

  return CanonicalCompanyWebsiteSchema.parse({
    companyId: parsed.companyId,
    homepageUrl: result.source.canonicalUrl,
    approvedWebsiteHost: result.source.host,
  });
}

/**
 * Applies hard, deterministic URL gates before a URL can become a candidate.
 * DNS/public-address checks happen in the fetch layer; this pure policy never
 * resolves or requests a URL.
 */
export function evaluateSourceUrl(
  input: z.input<typeof SourceUrlPolicyInputSchema>,
): z.infer<typeof SourceUrlPolicyResultSchema> {
  const parsed = SourceUrlPolicyInputSchema.parse(input);
  const approvedWebsiteHost = normalizeApprovedWebsiteHost(
    parsed.approvedWebsiteHost,
  );
  if (approvedWebsiteHost === null) {
    return { accepted: false, reason: "invalid_approved_host" };
  }

  let url: URL;
  try {
    url = new URL(parsed.rawUrl);
  } catch {
    return { accepted: false, reason: "invalid_url" };
  }

  if (url.protocol !== "https:") {
    return { accepted: false, reason: "https_required" };
  }
  if (url.port !== "") {
    return { accepted: false, reason: "non_default_port" };
  }
  if (url.username !== "" || url.password !== "") {
    return { accepted: false, reason: "credentials_not_allowed" };
  }
  if (url.hash !== "") {
    return { accepted: false, reason: "fragment_not_allowed" };
  }
  if (isIpLiteral(url.hostname)) {
    return { accepted: false, reason: "ip_literal_not_allowed" };
  }
  if (url.hostname !== approvedWebsiteHost) {
    return { accepted: false, reason: "host_not_approved" };
  }

  return {
    accepted: true,
    source: {
      canonicalUrl: url.toString(),
      host: url.hostname,
    },
  };
}

/** Grades each trust dimension independently so one strong signal cannot hide a failed gate. */
export function gradeDiscoveryCandidate(
  input: z.input<typeof DiscoveryCandidateInputSchema>,
): DiscoveryCandidateGrade {
  const parsed = DiscoveryCandidateInputSchema.parse(input);
  const urlPolicy = evaluateSourceUrl({
    rawUrl: parsed.candidateUrl,
    approvedWebsiteHost: parsed.approvedWebsiteHost,
  });
  const securityPpm = urlPolicy.accepted ? PPM_MAX : 0;
  const authorityPpm = AUTHORITY_BY_DISCOVERY_METHOD[parsed.discoveryMethod];
  const identityPpm = urlPolicy.accepted
    ? parsed.companyNameConfirmed
      ? PPM_MAX
      : 850_000
    : 0;
  const operationalPpm = operationalGrade(parsed.fetchOutcome);

  return DiscoveryCandidateGradeSchema.parse({
    canonicalUrl: urlPolicy.accepted ? urlPolicy.source.canonicalUrl : null,
    urlPolicy,
    grade: {
      authorityPpm,
      identityPpm,
      securityPpm,
      operationalPpm,
    },
  });
}

function operationalGrade(outcome: z.infer<typeof FetchOutcomeSchema>): number {
  switch (outcome) {
    case "ok":
      return PPM_MAX;
    case "stale":
      return 700_000;
    case "parse_failed":
      return 250_000;
    case "not_fetched":
    case "content_type_rejected":
    case "oversized":
    case "network_error":
      return 0;
  }
}

/** Determines lifecycle without accepting or altering any financial record. */
export function decideSourceLifecycle(
  input: z.input<typeof SourceLifecycleInputSchema>,
): SourceLifecycleDecision {
  const parsed = SourceLifecycleInputSchema.parse(input);
  const { authorityPpm, identityPpm, securityPpm, operationalPpm } =
    parsed.grade;

  if (securityPpm !== PPM_MAX) {
    return { nextStatus: "quarantined", reason: "unsafe_source" };
  }
  if (
    authorityPpm >= 900_000 &&
    identityPpm >= 900_000 &&
    operationalPpm >= 900_000
  ) {
    return {
      nextStatus: "active",
      reason: "ready_for_active_monitoring",
    };
  }
  if (
    authorityPpm >= 850_000 &&
    identityPpm >= 850_000 &&
    operationalPpm >= 700_000
  ) {
    return {
      nextStatus: "verified",
      reason: "identity_and_authority_verified",
    };
  }
  if (
    parsed.currentStatus === "active" ||
    parsed.currentStatus === "verified" ||
    parsed.currentStatus === "degraded"
  ) {
    return { nextStatus: "degraded", reason: "operationally_degraded" };
  }
  return { nextStatus: "discovered", reason: "insufficient_verification" };
}

/** Produces request options that callers must pass unchanged to their fetch implementation. */
export function createSafeFetchRequestPolicy(
  source: CanonicalSourceUrl,
): SafeFetchRequestPolicy {
  const parsedSource = parseApprovedCanonicalSource(source);
  return SafeFetchRequestPolicySchema.parse({
    method: "GET",
    redirect: "manual",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    url: parsedSource.canonicalUrl,
    maxResponseBytes: MAX_OFFICIAL_COMPANY_RESPONSE_BYTES,
    acceptedContentTypes: DEFAULT_ACCEPTED_CONTENT_TYPES,
  });
}

/** Returns the media type without parameters, normalized for allowlist comparison. */
export function normalizeContentType(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "" || mediaType === undefined ? null : mediaType;
}

export function isAllowedOfficialCompanyContentType(
  value: string | null,
): boolean {
  const mediaType = normalizeContentType(value);
  return (
    mediaType !== null &&
    DEFAULT_ACCEPTED_CONTENT_TYPES.includes(
      mediaType as (typeof DEFAULT_ACCEPTED_CONTENT_TYPES)[number],
    )
  );
}

/**
 * Evaluates metadata while streaming; callers must invoke this before accepting
 * a body and stop reading once bytesRead exceeds maxResponseBytes.
 */
export function evaluateSafeFetchResponse(
  source: CanonicalSourceUrl,
  response: z.input<typeof SafeFetchResponseInputSchema>,
): SafeFetchResponseDecision {
  const parsedSource = parseApprovedCanonicalSource(source);
  const parsedResponse = SafeFetchResponseInputSchema.parse(response);
  const requestPolicy = createSafeFetchRequestPolicy(parsedSource);

  if (parsedResponse.status >= 300 && parsedResponse.status < 400) {
    return { accepted: false, reason: "redirect_not_allowed" };
  }
  if (parsedResponse.status < 200 || parsedResponse.status >= 300) {
    return { accepted: false, reason: "non_success_status" };
  }
  const responseUrl = evaluateSourceUrl({
    rawUrl: parsedResponse.responseUrl,
    approvedWebsiteHost: parsedSource.host,
  });
  if (!responseUrl.accepted) {
    return { accepted: false, reason: "response_url_not_approved" };
  }
  if (!isAllowedOfficialCompanyContentType(parsedResponse.contentType)) {
    return { accepted: false, reason: "unsupported_content_type" };
  }
  if (
    (parsedResponse.contentLength !== null &&
      parsedResponse.contentLength > requestPolicy.maxResponseBytes) ||
    parsedResponse.bytesRead > requestPolicy.maxResponseBytes
  ) {
    return { accepted: false, reason: "response_too_large" };
  }
  return { accepted: true, reason: "accepted" };
}

/** Checks a prospective streamed chunk without allocating or consuming it. */
export function isWithinResponseByteLimit(
  bytesRead: number,
  nextChunkBytes: number,
  maxResponseBytes = MAX_OFFICIAL_COMPANY_RESPONSE_BYTES,
): boolean {
  return (
    Number.isSafeInteger(bytesRead) &&
    Number.isSafeInteger(nextChunkBytes) &&
    Number.isSafeInteger(maxResponseBytes) &&
    bytesRead >= 0 &&
    nextChunkBytes >= 0 &&
    maxResponseBytes > 0 &&
    bytesRead <= maxResponseBytes &&
    nextChunkBytes <= maxResponseBytes - bytesRead
  );
}

const NEWSROOM_PATH_SEGMENTS = new Set([
  "news",
  "newsroom",
  "press",
  "blog",
  "updates",
  "stories",
  "insights",
]);

const FEED_PATH_PATTERN =
  /(?:^|\/)(?:feed|rss|atom)(?:\/|$)|\.(?:rss|atom|xml)$/i;
const EVENT_PATH_PATTERN =
  /(?:raise|series-|funding|financ|acqui|merger|ipo|public-offering|tender|employee-liquidity|secondary|shut|wind-down)/i;
const XML_DTD_OR_ENTITY_PATTERN = /<!\s*(?:doctype|entity)\b/i;
const HTML_TAG_PATTERN = /<(?:a|link)\b[^>]*>/gi;
const ATTRIBUTE_PATTERN =
  /([A-Za-z_:][A-Za-z0-9:_.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * Discovers safe, same-origin newsroom, feed, and article links from bounded
 * HTML. It ignores document <base> elements and resolves every link relative
 * to the approved source URL instead.
 */
export function discoverCompanyWebCandidatesFromHtml(
  input: z.input<typeof CompanyWebDocumentInputSchema>,
): CompanyWebDiscoveryCandidate[] {
  const parsed = parseCompanyWebDocumentInput(input);
  const candidates: CompanyWebDiscoveryCandidate[] = [];
  const seen = new Set<string>();

  for (const match of parsed.document.matchAll(HTML_TAG_PATTERN)) {
    const tag = match[0];
    const attributes = parseTagAttributes(tag);
    const href = attributes.href;
    if (href === undefined || href.length === 0) {
      continue;
    }

    const candidate = resolveCompanyWebCandidate({
      href,
      source: parsed.source,
      kind: candidateKindFromHtmlTag(tag, attributes),
    });
    if (candidate === null) {
      continue;
    }

    const key = `${candidate.kind}:${candidate.url}`;
    if (!seen.has(key)) {
      candidates.push(candidate);
      seen.add(key);
    }
  }

  const kindPriority: Record<
    z.infer<typeof CompanyWebCandidateKindSchema>,
    number
  > = { article: 1, feed: 2, sitemap: 2, newsroom: 3 };
  candidates.sort((left, right) => {
    const leftEvent = EVENT_PATH_PATTERN.test(new URL(left.url).pathname)
      ? 0
      : 1;
    const rightEvent = EVENT_PATH_PATTERN.test(new URL(right.url).pathname)
      ? 0
      : 1;
    return (
      leftEvent - rightEvent ||
      kindPriority[left.kind] - kindPriority[right.kind] ||
      left.url.localeCompare(right.url)
    );
  });
  return z
    .array(CompanyWebDiscoveryCandidateSchema)
    .max(MAX_COMPANY_WEB_DISCOVERY_CANDIDATES)
    .parse(candidates.slice(0, MAX_COMPANY_WEB_DISCOVERY_CANDIDATES));
}

/** Discovers safe same-origin newsroom, feed, and article links from Markdown. */
export function discoverCompanyWebCandidatesFromMarkdown(
  input: z.input<typeof CompanyWebDocumentInputSchema>,
): CompanyWebDiscoveryCandidate[] {
  const parsed = parseCompanyWebDocumentInput(input);
  const candidates: CompanyWebDiscoveryCandidate[] = [];
  const seen = new Set<string>();

  for (const match of parsed.document.matchAll(
    /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g,
  )) {
    const href = match[1];
    if (href === undefined) {
      continue;
    }
    let path: string;
    try {
      path = new URL(href, parsed.source.canonicalUrl).pathname;
    } catch {
      continue;
    }
    const segments = path.split("/").filter(Boolean);
    const hasNewsSegment = segments.some((segment) =>
      NEWSROOM_PATH_SEGMENTS.has(segment.toLowerCase()),
    );
    const feedPath = FEED_PATH_PATTERN.test(path);
    if (!hasNewsSegment && !feedPath) {
      continue;
    }
    const candidate = resolveCompanyWebCandidate({
      href,
      source: parsed.source,
      kind: feedPath ? "feed" : segments.length <= 1 ? "newsroom" : "article",
    });
    if (candidate === null || seen.has(candidate.url)) {
      continue;
    }
    candidates.push(candidate);
    seen.add(candidate.url);
  }

  candidates.sort((left, right) => {
    const leftEvent = EVENT_PATH_PATTERN.test(new URL(left.url).pathname)
      ? 0
      : 1;
    const rightEvent = EVENT_PATH_PATTERN.test(new URL(right.url).pathname)
      ? 0
      : 1;
    return leftEvent - rightEvent || left.url.localeCompare(right.url);
  });
  return z
    .array(CompanyWebDiscoveryCandidateSchema)
    .max(MAX_COMPANY_WEB_DISCOVERY_CANDIDATES)
    .parse(candidates.slice(0, MAX_COMPANY_WEB_DISCOVERY_CANDIDATES));
}

/**
 * Discovers same-origin article links from a bounded RSS or Atom document.
 * DTD and entity declarations are rejected before any tag extraction.
 */
export function discoverCompanyWebCandidatesFromFeed(
  input: z.input<typeof CompanyWebDocumentInputSchema>,
): CompanyWebDiscoveryCandidate[] {
  const parsed = parseCompanyWebDocumentInput(input);
  assertXmlHasNoDtdOrEntity(parsed.document);
  const candidates: CompanyWebDiscoveryCandidate[] = [];
  const seen = new Set<string>();

  for (const entry of extractFeedEntries(parsed.document)) {
    const url = extractFeedEntryUrl(entry);
    if (url === null) {
      continue;
    }
    const candidate = resolveCompanyWebCandidate({
      href: url,
      source: parsed.source,
      kind: "article",
      discoveryMethod: "feed_autodiscovery",
    });
    if (candidate === null || seen.has(candidate.url)) {
      continue;
    }
    candidates.push(candidate);
    seen.add(candidate.url);
    if (candidates.length === MAX_COMPANY_WEB_DISCOVERY_CANDIDATES) {
      break;
    }
  }

  return z.array(CompanyWebDiscoveryCandidateSchema).parse(candidates);
}

/** Discovers bounded same-origin pages from an XML sitemap. */
export function discoverCompanyWebCandidatesFromSitemap(
  input: z.input<typeof CompanyWebDocumentInputSchema>,
): CompanyWebDiscoveryCandidate[] {
  const parsed = parseCompanyWebDocumentInput(input);
  assertXmlHasNoDtdOrEntity(parsed.document);
  const candidates: CompanyWebDiscoveryCandidate[] = [];
  const seen = new Set<string>();

  for (const match of parsed.document.matchAll(
    /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi,
  )) {
    const href = match[1] === undefined ? null : decodeSafeXmlText(match[1]);
    if (href === null) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(href, parsed.source.canonicalUrl);
    } catch {
      continue;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const containsNewsPath = segments.some((segment) =>
      NEWSROOM_PATH_SEGMENTS.has(segment.toLowerCase()),
    );
    const sitemapPath = /(?:^|\/)sitemap[^/]*\.xml$/i.test(url.pathname);
    const feedPath = FEED_PATH_PATTERN.test(url.pathname);
    if (!containsNewsPath && !sitemapPath && !feedPath) {
      continue;
    }
    const candidate = resolveCompanyWebCandidate({
      href,
      source: parsed.source,
      kind: sitemapPath
        ? "sitemap"
        : feedPath
          ? "feed"
          : segments.length <= 1
            ? "newsroom"
            : "article",
      discoveryMethod: "sitemap",
    });
    if (candidate === null || seen.has(candidate.url)) {
      continue;
    }
    candidates.push(candidate);
    seen.add(candidate.url);
  }

  candidates.sort((left, right) => {
    const leftEvent = EVENT_PATH_PATTERN.test(new URL(left.url).pathname)
      ? 0
      : 1;
    const rightEvent = EVENT_PATH_PATTERN.test(new URL(right.url).pathname)
      ? 0
      : 1;
    return leftEvent - rightEvent || left.url.localeCompare(right.url);
  });
  return z
    .array(CompanyWebDiscoveryCandidateSchema)
    .max(MAX_COMPANY_WEB_DISCOVERY_CANDIDATES)
    .parse(candidates.slice(0, MAX_COMPANY_WEB_DISCOVERY_CANDIDATES));
}

/**
 * Extracts a bounded, factual public event observation from one HTML article.
 * Source-stated financing terms remain review evidence, never a holding mark.
 */
export function extractPublicCompanyEventsFromHtml(
  input: z.input<typeof CompanyWebEventDocumentInputSchema>,
): PublicCompanyEventObservation[] {
  const parsed = parseCompanyWebEventDocumentInput(input);
  const pageText = stripHtmlToText(parsed.document);
  const articleText =
    extractPreferredHtmlArticleText(parsed.document) ?? pageText;
  const title =
    extractHtmlMetaContent(parsed.document, "property", "og:title") ??
    extractHtmlTagText(parsed.document, "h1") ??
    extractHtmlTagText(parsed.document, "title");
  const canonicalUrl = extractSafeHtmlCanonicalUrl(parsed);
  if (title === null || canonicalUrl === null) {
    return [];
  }

  return createPublicCompanyEventObservations({
    title,
    companyName: parsed.source.companyName,
    canonicalUrl,
    publishedAt:
      extractPublishedTimestamp(
        extractHtmlMetaContent(
          parsed.document,
          "property",
          "article:published_time",
        ) ??
          extractHtmlMetaContent(parsed.document, "name", "date") ??
          extractHtmlTimeDatetime(parsed.document),
      ) ?? extractFirstCalendarTimestamp(articleText),
    evidenceText: articleText,
  });
}

/** Extracts one bounded factual observation from a Markdown article. */
export function extractPublicCompanyEventsFromMarkdown(
  input: z.input<typeof CompanyWebEventDocumentInputSchema>,
): PublicCompanyEventObservation[] {
  const parsed = parseCompanyWebEventDocumentInput(input);
  const titleMatch = /^#\s+(.+)$/m.exec(parsed.document);
  const title =
    titleMatch?.[1] === undefined ? null : clipText(titleMatch[1], 500);
  if (title === null) {
    return [];
  }
  return createPublicCompanyEventObservations({
    title,
    companyName: parsed.source.companyName,
    canonicalUrl: parsed.source.canonicalUrl,
    publishedAt: extractFirstCalendarTimestamp(parsed.document),
    evidenceText: parsed.document,
  });
}

/** Extracts bounded factual public event observations from RSS or Atom entries. */
export function extractPublicCompanyEventsFromFeed(
  input: z.input<typeof CompanyWebEventDocumentInputSchema>,
): PublicCompanyEventObservation[] {
  const parsed = parseCompanyWebEventDocumentInput(input);
  assertXmlHasNoDtdOrEntity(parsed.document);
  const observations: PublicCompanyEventObservation[] = [];
  const seen = new Set<string>();

  for (const entry of extractFeedEntries(parsed.document)) {
    const title = extractXmlTagText(entry, "title");
    const rawUrl = extractFeedEntryUrl(entry);
    if (title === null || rawUrl === null) {
      continue;
    }
    const canonical = resolveCompanyWebCandidate({
      href: rawUrl,
      source: parsed.source,
      kind: "article",
      discoveryMethod: "feed_autodiscovery",
    });
    if (canonical === null) {
      continue;
    }
    const eventObservations = createPublicCompanyEventObservations({
      title,
      companyName: parsed.source.companyName,
      canonicalUrl: canonical.url,
      publishedAt:
        extractPublishedTimestamp(
          extractXmlTagText(entry, "published") ??
            extractXmlTagText(entry, "pubDate") ??
            extractXmlTagText(entry, "updated"),
        ) ?? null,
      evidenceText:
        extractXmlTagText(entry, "description") ??
        extractXmlTagText(entry, "summary") ??
        extractXmlTagText(entry, "content") ??
        title,
    });
    for (const observation of eventObservations) {
      if (!seen.has(observation.canonicalUrl)) {
        observations.push(observation);
        seen.add(observation.canonicalUrl);
      }
    }
    if (observations.length === MAX_COMPANY_WEB_DISCOVERY_CANDIDATES) {
      break;
    }
  }

  return z.array(PublicCompanyEventObservationSchema).parse(observations);
}

function parseCompanyWebDocumentInput(
  input: z.input<typeof CompanyWebDocumentInputSchema>,
): z.infer<typeof CompanyWebDocumentInputSchema> {
  const parsed = CompanyWebDocumentInputSchema.parse(input);
  return {
    ...parsed,
    source: parseApprovedCanonicalSource(parsed.source),
  };
}

function parseCompanyWebEventDocumentInput(
  input: z.input<typeof CompanyWebEventDocumentInputSchema>,
): z.infer<typeof CompanyWebEventDocumentInputSchema> {
  const parsed = CompanyWebEventDocumentInputSchema.parse(input);
  return {
    ...parsed,
    source: {
      ...parseApprovedCanonicalSource(parsed.source),
      companyName: parsed.source.companyName,
    },
  };
}

function parseApprovedCanonicalSource(
  source: z.input<typeof CanonicalSourceUrlSchema>,
): CanonicalSourceUrl {
  const parsed = CanonicalSourceUrlSchema.parse(source);
  const policy = evaluateSourceUrl({
    rawUrl: parsed.canonicalUrl,
    approvedWebsiteHost: parsed.host,
  });
  if (!policy.accepted) {
    throw new Error(`Company-web source is not eligible: ${policy.reason}.`);
  }
  return policy.source;
}

function parseTagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (name !== undefined && value !== undefined) {
      attributes[name] = value;
    }
  }
  return attributes;
}

function candidateKindFromHtmlTag(
  tag: string,
  attributes: Record<string, string>,
): z.infer<typeof CompanyWebCandidateKindSchema> | null {
  const href = attributes.href;
  if (href === undefined) {
    return null;
  }
  const rel = attributes.rel?.toLowerCase().split(/\s+/) ?? [];
  const type = attributes.type?.toLowerCase() ?? "";
  if (
    type.includes("rss") ||
    type.includes("atom") ||
    (rel.includes("alternate") && FEED_PATH_PATTERN.test(href)) ||
    FEED_PATH_PATTERN.test(href)
  ) {
    return "feed";
  }

  const path = safePathname(href);
  if (path === null) {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  const hasNewsSegment = segments.some((segment) =>
    NEWSROOM_PATH_SEGMENTS.has(segment.toLowerCase()),
  );
  if (!hasNewsSegment) {
    return null;
  }
  if (
    segments.length <= 1 ||
    (segments.length === 2 && tag.startsWith("<link"))
  ) {
    return "newsroom";
  }
  return "article";
}

function safePathname(href: string): string | null {
  try {
    return new URL(href, "https://example.invalid/").pathname;
  } catch {
    return null;
  }
}

function resolveCompanyWebCandidate({
  href,
  source,
  kind,
  discoveryMethod = kind === "feed" ? "feed_autodiscovery" : "homepage_link",
}: {
  href: string;
  source: CanonicalSourceUrl;
  kind: z.infer<typeof CompanyWebCandidateKindSchema> | null;
  discoveryMethod?: z.infer<typeof DiscoveryMethodSchema>;
}): CompanyWebDiscoveryCandidate | null {
  if (kind === null) {
    return null;
  }
  let rawUrl: string;
  try {
    rawUrl = new URL(href, source.canonicalUrl).toString();
  } catch {
    return null;
  }
  const policy = evaluateSourceUrl({
    rawUrl,
    approvedWebsiteHost: source.host,
  });
  if (!policy.accepted) {
    return null;
  }
  return CompanyWebDiscoveryCandidateSchema.parse({
    url: policy.source.canonicalUrl,
    kind,
    discoveryMethod,
  });
}

function assertXmlHasNoDtdOrEntity(xml: string): void {
  if (XML_DTD_OR_ENTITY_PATTERN.test(xml)) {
    throw new Error("XML DTD and entity declarations are not allowed.");
  }
}

function extractFeedEntries(xml: string): string[] {
  const entries = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi),
    ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi),
  ]
    .map((match) => match[1])
    .filter((entry): entry is string => entry !== undefined);
  return entries.slice(0, MAX_COMPANY_WEB_DISCOVERY_CANDIDATES);
}

function extractFeedEntryUrl(entry: string): string | null {
  const atomLinks = [...entry.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  for (const match of atomLinks) {
    const attributes = parseTagAttributes(match[1] ?? "");
    const rel = attributes.rel?.toLowerCase();
    if (
      (rel === undefined || rel === "alternate") &&
      attributes.href !== undefined
    ) {
      return decodeSafeXmlText(attributes.href);
    }
  }
  return extractXmlTagText(entry, "link");
}

function extractSafeHtmlCanonicalUrl(
  input: z.infer<typeof CompanyWebDocumentInputSchema>,
): string | null {
  for (const match of input.document.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    if (
      attributes.rel?.toLowerCase().split(/\s+/).includes("canonical") &&
      attributes.href !== undefined
    ) {
      const canonical = resolveCompanyWebCandidate({
        href: attributes.href,
        source: input.source,
        kind: "article",
      });
      return canonical?.url ?? null;
    }
  }
  return input.source.canonicalUrl;
}

function extractHtmlMetaContent(
  html: string,
  attribute: "name" | "property",
  expectedValue: string,
): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    if (attributes[attribute]?.toLowerCase() === expectedValue.toLowerCase()) {
      return attributes.content === undefined
        ? null
        : clipText(attributes.content, 500);
    }
  }
  return null;
}

function extractHtmlTagText(html: string, tag: string): string | null {
  const match = new RegExp(
    `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,
    "i",
  ).exec(html);
  return match?.[1] === undefined
    ? null
    : clipText(stripHtmlToText(match[1]), 500);
}

function extractPreferredHtmlArticleText(html: string): string | null {
  for (const tag of ["article", "main"] as const) {
    const match = new RegExp(
      `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,
      "i",
    ).exec(html);
    if (match?.[1] === undefined) {
      continue;
    }
    const text = stripHtmlToText(match[1]);
    if (text.length > 0) {
      return text;
    }
  }
  return null;
}

function extractHtmlTimeDatetime(html: string): string | null {
  for (const match of html.matchAll(/<time\b[^>]*>/gi)) {
    const datetime = parseTagAttributes(match[0]).datetime;
    if (datetime !== undefined) {
      return datetime;
    }
  }
  return null;
}

function extractXmlTagText(xml: string, tag: string): string | null {
  const match = new RegExp(
    `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,
    "i",
  ).exec(xml);
  return match?.[1] === undefined
    ? null
    : clipText(decodeSafeXmlText(match[1]), 500);
}

function decodeSafeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function stripHtmlToText(html: string): string {
  return decodeSafeXmlText(
    html
      .replace(
        /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi,
        " ",
      )
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractPublishedTimestamp(value: string | null): string | null {
  if (value === null || value.trim().length === 0) {
    return null;
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    return null;
  }
  const normalized = timestamp.toISOString();
  return IsoTimestampSchema.safeParse(normalized).success ? normalized : null;
}

function extractFirstCalendarTimestamp(document: string): string | null {
  const excerpt = document.slice(0, 8_000);
  const monthName =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const namedDate = new RegExp(
    `\\b(?:${monthName}\\s+\\d{1,2},\\s+\\d{4}|\\d{1,2}\\s+${monthName}\\s+\\d{4})\\b`,
    "i",
  ).exec(excerpt)?.[0];
  if (namedDate !== undefined) {
    return extractPublishedTimestamp(`${namedDate} UTC`);
  }
  const isoDate = /\b\d{4}-\d{2}-\d{2}\b/.exec(excerpt)?.[0];
  return extractPublishedTimestamp(isoDate ?? null);
}

function classifyPublicCompanyEvent(
  title: string,
  companyName: string,
): z.infer<typeof PublicCompanyEventTypeSchema> | null {
  // Classification is title-bound so a newsroom index cannot become a false
  // event merely because one of many linked summaries contains a keyword.
  const text = title.toLowerCase();
  if (
    /\b(?:shuts? down|shutting down|ceases? operations|winds? down|winding down|closing operations)\b/.test(
      text,
    )
  ) {
    return "shutdown_announced";
  }
  if (
    /\b(?:tender offer|employee liquidity|secondary (?:sale|transaction)|share repurchase)\b/.test(
      text,
    )
  ) {
    return "secondary_transaction_announced";
  }
  if (
    /\b(?:acquires?|acquired|acquisition|to acquire|being acquired)\b/.test(
      text,
    )
  ) {
    return "acquisition_announced";
  }
  if (
    /\b(?:ipo|initial public offering|registration statement|form s-1|\bs-1\b|files? for an? (?:initial )?public offering)\b/.test(
      text,
    )
  ) {
    return "ipo_or_filing_announced";
  }
  if (
    isCompanyFinancingAnnouncementTitle({
      title,
      expectedCompanyName: companyName,
    })
  ) {
    return "financing_announced";
  }
  return null;
}

function createPublicCompanyEventObservations({
  title,
  companyName,
  canonicalUrl,
  publishedAt,
  evidenceText,
}: {
  title: string;
  companyName: string;
  canonicalUrl: string;
  publishedAt: string | null;
  evidenceText: string;
}): PublicCompanyEventObservation[] {
  const normalizedTitle = clipText(title, 500);
  const normalizedEvidenceText = clipText(
    evidenceText,
    MAX_COMPANY_WEB_EVENT_TEXT_CHARS,
  );
  if (normalizedTitle.length === 0 || normalizedEvidenceText.length === 0) {
    return [];
  }
  const eventType = classifyPublicCompanyEvent(normalizedTitle, companyName);
  if (eventType === null) {
    return [];
  }
  const financingFacts =
    eventType === "financing_announced"
      ? extractFinancingAnnouncementFacts({
          title: normalizedTitle,
          evidenceText: normalizedEvidenceText,
          expectedCompanyName: companyName,
        })
      : null;
  return [
    PublicCompanyEventObservationSchema.parse({
      eventType,
      title: normalizedTitle,
      canonicalUrl,
      publishedAt,
      evidenceText: normalizedEvidenceText,
      financingFacts,
    }),
  ];
}

function clipText(value: string, maximumLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maximumLength);
}
