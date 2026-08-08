import {
  decideSourceLifecycle,
  discoverCompanyWebCandidatesFromFeed,
  discoverCompanyWebCandidatesFromHtml,
  discoverCompanyWebCandidatesFromMarkdown,
  discoverCompanyWebCandidatesFromSitemap,
  evaluateSafeFetchResponse,
  evaluateSourceUrl,
  extractPublicCompanyEventsFromFeed,
  extractPublicCompanyEventsFromHtml,
  extractPublicCompanyEventsFromMarkdown,
  gradeDiscoveryCandidate,
  isWithinResponseByteLimit,
  MAX_COMPANY_WEB_DISCOVERY_CANDIDATES,
  MAX_OFFICIAL_COMPANY_RESPONSE_BYTES,
  normalizeContentType,
  PortfolioWatchSourceJobMessageSchema,
  type CompanyWebDiscoveryCandidate,
  type PortfolioWatchSourceJobMessage,
  type PublicCompanyEventObservation,
} from "@keel/connectors";
import {
  D1PortfolioWatchRepository,
  type PortfolioWatchSourceRecord,
} from "@keel/database";
import { z } from "zod";

import type { Env } from "./types";
import { DeploymentSmokeMessageSchema } from "./deployment-smoke";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type HostResolver = (host: string) => Promise<readonly string[]>;

export type ApprovedSourceFetchResult =
  | {
      ok: true;
      bytes: Uint8Array;
      text: string;
      contentType: string;
      status: number;
      sha256: string;
      etag: string | null;
      lastModified: string | null;
    }
  | {
      ok: false;
      reason: string;
      permanent: boolean;
      status: number | null;
      contentType: string | null;
      redirectUrl: string | null;
    };

const OFFICIAL_COMPANY_FETCH_TIMEOUT_MS = 10_000;
const DNS_JSON_RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

const DnsJsonSchema = z.object({
  Status: z.number().int(),
  Answer: z
    .array(
      z.object({
        type: z.number().int(),
        data: z.string(),
      }),
    )
    .optional(),
});

function sha256(bytes: Uint8Array): Promise<string> {
  const ownedBytes = Uint8Array.from(bytes);
  return crypto.subtle
    .digest("SHA-256", ownedBytes.buffer)
    .then((digest) =>
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    );
}

function normalizedCompanyIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /\b(?:incorporated|corporation|company|limited|inc|corp|llc|ltd)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function confirmsCompanyIdentity(
  document: string,
  companyName: string,
): boolean {
  const expected = normalizedCompanyIdentity(companyName);
  const haystack = normalizedCompanyIdentity(document.slice(0, 200_000));
  return expected.length >= 2 && haystack.includes(expected);
}

function ipv4Octets(value: string): readonly number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  return octets.every(
    (octet, index) =>
      /^\d{1,3}$/.test(parts[index] ?? "") &&
      Number.isInteger(octet) &&
      octet >= 0 &&
      octet <= 255,
  )
    ? octets
    : null;
}

export function isPublicIpAddress(value: string): boolean {
  const octets = ipv4Octets(value);
  if (octets !== null) {
    const [a = 0, b = 0] = octets;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }

  const address = value.toLowerCase();
  if (!/^[0-9a-f:]+$/.test(address) || !address.includes(":")) {
    return false;
  }
  return !(
    address === "::" ||
    address === "::1" ||
    address.startsWith("::ffff:") ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe8") ||
    address.startsWith("fe9") ||
    address.startsWith("fea") ||
    address.startsWith("feb") ||
    address.startsWith("ff") ||
    address.startsWith("2001:db8:")
  );
}

export async function resolvePublicHostWithDnsJson(
  host: string,
  fetchImpl: FetchLike = fetch,
): Promise<readonly string[]> {
  for (const resolver of DNS_JSON_RESOLVERS) {
    try {
      const answers = await Promise.all(
        ["A", "AAAA"].map(async (type) => {
          const query = new URL(resolver);
          query.searchParams.set("name", host);
          query.searchParams.set("type", type);
          const response = await fetchImpl(query, {
            headers: { Accept: "application/dns-json" },
            redirect: "manual",
          });
          if (!response.ok) {
            throw new Error("dns_lookup_failed");
          }
          const parsed = DnsJsonSchema.parse(await response.json());
          if (parsed.Status !== 0) {
            return [];
          }
          return (parsed.Answer ?? [])
            .filter((answer) => answer.type === 1 || answer.type === 28)
            .map((answer) => answer.data);
        }),
      );
      return [...new Set(answers.flat())];
    } catch {
      // A second public resolver avoids turning one provider outage into a
      // source-health failure. Both responses cross the same Zod boundary.
    }
  }
  throw new Error("dns_lookup_failed");
}

function failure(
  reason: string,
  permanent: boolean,
  response?: Response,
): ApprovedSourceFetchResult {
  let redirectUrl: string | null = null;
  const location = response?.headers.get("Location");
  if (location !== null && location !== undefined && response !== undefined) {
    try {
      redirectUrl = new URL(location, response.url).toString();
    } catch {
      redirectUrl = null;
    }
  }
  return {
    ok: false,
    reason,
    permanent,
    status: response?.status ?? null,
    contentType: response?.headers.get("Content-Type") ?? null,
    redirectUrl,
  };
}

export async function fetchApprovedCompanySource(
  source: PortfolioWatchSourceRecord,
  options: {
    fetchImpl?: FetchLike;
    resolveHost?: HostResolver;
    timeoutMs?: number;
  } = {},
): Promise<ApprovedSourceFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const policy = evaluateSourceUrl({
    rawUrl: source.canonicalUrl,
    approvedWebsiteHost: source.approvedWebsiteHost,
  });
  if (
    !policy.accepted ||
    new URL(source.canonicalUrl).origin !== source.allowedOrigin
  ) {
    return failure("source_policy_rejected", true);
  }

  let addresses: readonly string[];
  try {
    addresses = await (
      options.resolveHost ??
      ((host) => resolvePublicHostWithDnsJson(host, fetchImpl))
    )(source.approvedWebsiteHost);
  } catch {
    return failure("dns_lookup_failed", false);
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicIpAddress(address))
  ) {
    return failure("non_public_address", true);
  }

  const timeoutMs = options.timeoutMs ?? OFFICIAL_COMPANY_FETCH_TIMEOUT_MS;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(source.canonicalUrl, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: abortController.signal,
        headers: {
          Accept:
            "text/html,text/markdown,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8",
          "User-Agent": "Keel-Portfolio-Watch/0.1 (+https://keel.fi)",
        },
      });
    } catch {
      return failure(
        abortController.signal.aborted ? "request_timeout" : "network_error",
        false,
      );
    }

    const rawContentLength = response.headers.get("Content-Length");
    const contentLength =
      rawContentLength !== null && /^\d+$/.test(rawContentLength)
        ? Number(rawContentLength)
        : null;
    const responseUrl = response.url || source.canonicalUrl;
    const metadataDecision = evaluateSafeFetchResponse(
      { canonicalUrl: source.canonicalUrl, host: source.approvedWebsiteHost },
      {
        status: response.status,
        responseUrl,
        contentType: response.headers.get("Content-Type"),
        contentLength,
        bytesRead: 0,
      },
    );
    if (!metadataDecision.accepted) {
      return failure(
        metadataDecision.reason,
        metadataDecision.reason !== "non_success_status",
        response,
      );
    }
    if (response.body === null) {
      return failure("empty_response", false, response);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) {
          break;
        }
        if (!isWithinResponseByteLimit(bytesRead, item.value.byteLength)) {
          await reader.cancel();
          return failure("response_too_large", true, response);
        }
        chunks.push(item.value);
        bytesRead += item.value.byteLength;
      }
    } catch {
      return failure(
        abortController.signal.aborted ? "request_timeout" : "network_error",
        false,
        response,
      );
    }

    const bytes = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const contentType = normalizeContentType(
      response.headers.get("Content-Type"),
    );
    if (contentType === null) {
      return failure("unsupported_content_type", true, response);
    }
    return {
      ok: true,
      bytes,
      text: new TextDecoder().decode(bytes),
      contentType,
      status: response.status,
      sha256: await sha256(bytes),
      etag: response.headers.get("ETag"),
      lastModified: response.headers.get("Last-Modified"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isFeedContentType(contentType: string): boolean {
  return (
    contentType === "application/rss+xml" ||
    contentType === "application/atom+xml" ||
    contentType === "application/xml" ||
    contentType === "text/xml"
  );
}

function isMarkdownContentType(contentType: string): boolean {
  return contentType === "text/markdown";
}

function candidateInputs(
  source: PortfolioWatchSourceRecord,
  document: string,
  contentType: string,
  companyNameConfirmed: boolean,
) {
  const parsedSource = {
    canonicalUrl: source.canonicalUrl,
    host: source.approvedWebsiteHost,
  };
  const input = { source: parsedSource, document };
  const candidates: CompanyWebDiscoveryCandidate[] = isFeedContentType(
    contentType,
  )
    ? [
        ...discoverCompanyWebCandidatesFromFeed(input),
        ...discoverCompanyWebCandidatesFromSitemap(input),
      ]
    : isMarkdownContentType(contentType)
      ? discoverCompanyWebCandidatesFromMarkdown(input)
      : discoverCompanyWebCandidatesFromHtml(input);
  if (new URL(source.canonicalUrl).pathname === "/") {
    candidates.push(
      {
        url: new URL("/sitemap.xml", source.allowedOrigin).toString(),
        kind: "sitemap",
        discoveryMethod: "sitemap",
      },
      {
        url: new URL("/news", source.allowedOrigin).toString(),
        kind: "newsroom",
        discoveryMethod: "standard_path",
      },
      {
        url: new URL("/newsroom", source.allowedOrigin).toString(),
        kind: "newsroom",
        discoveryMethod: "standard_path",
      },
      {
        url: new URL("/blog", source.allowedOrigin).toString(),
        kind: "newsroom",
        discoveryMethod: "standard_path",
      },
      {
        url: new URL("/feed.xml", source.allowedOrigin).toString(),
        kind: "feed",
        discoveryMethod: "standard_path",
      },
      {
        url: new URL("/rss.xml", source.allowedOrigin).toString(),
        kind: "feed",
        discoveryMethod: "standard_path",
      },
    );
  }
  const uniqueCandidates = [
    ...new Map(
      candidates.map((candidate) => [candidate.url, candidate]),
    ).values(),
  ];
  return uniqueCandidates
    .slice(0, MAX_COMPANY_WEB_DISCOVERY_CANDIDATES)
    .map((candidate) => {
      const grade = gradeDiscoveryCandidate({
        candidateUrl: candidate.url,
        approvedWebsiteHost: source.approvedWebsiteHost,
        discoveryMethod: candidate.discoveryMethod,
        companyNameConfirmed,
        fetchOutcome: "not_fetched",
      }).grade;
      return {
        canonicalUrl: candidate.url,
        sourceKind:
          candidate.kind === "feed"
            ? ("official_rss" as const)
            : ("official_company_web" as const),
        discoveryMethod: candidate.discoveryMethod,
        grade,
      };
    });
}

function extractedEvents(
  source: PortfolioWatchSourceRecord,
  document: string,
  contentType: string,
): PublicCompanyEventObservation[] {
  const input = {
    source: {
      canonicalUrl: source.canonicalUrl,
      host: source.approvedWebsiteHost,
      companyName: source.companyName,
    },
    document,
  };
  return isFeedContentType(contentType)
    ? extractPublicCompanyEventsFromFeed(input)
    : isMarkdownContentType(contentType)
      ? extractPublicCompanyEventsFromMarkdown(input)
      : extractPublicCompanyEventsFromHtml(input);
}

export function inspectApprovedCompanyDocument(
  source: PortfolioWatchSourceRecord,
  document: string,
  contentType: string,
) {
  const companyNameConfirmed = confirmsCompanyIdentity(
    document,
    source.companyName,
  );
  return {
    companyNameConfirmed,
    candidates: candidateInputs(
      source,
      document,
      contentType,
      companyNameConfirmed,
    ),
    events: extractedEvents(source, document, contentType),
  };
}

function mappedEventType(
  eventType: PublicCompanyEventObservation["eventType"],
) {
  return {
    financing_announced: "financing_announced",
    acquisition_announced: "acquisition_announced",
    secondary_transaction_announced: "secondary_transaction_announced",
    ipo_or_filing_announced: "public_listing_announced",
    shutdown_announced: "operations_ended",
  }[eventType] as
    | "financing_announced"
    | "acquisition_announced"
    | "secondary_transaction_announced"
    | "public_listing_announced"
    | "operations_ended";
}

const FINANCING_FACTS_FINGERPRINT_VERSION = "financing-facts-v1";

function financingFactsFingerprintMaterial(
  facts: NonNullable<PublicCompanyEventObservation["financingFacts"]>,
): string {
  const moneyMaterial = (
    fact:
      | NonNullable<typeof facts.announcedAmount>
      | NonNullable<typeof facts.companyValuation>
      | null,
  ): string =>
    fact === null
      ? ""
      : [
          fact.amountMinor,
          fact.currency,
          fact.qualifier,
          "basis" in fact ? fact.basis : "",
        ].join(":");
  return [
    facts.roundType ?? "",
    facts.roundLabel ?? "",
    facts.instrument,
    moneyMaterial(facts.announcedAmount),
    moneyMaterial(facts.companyValuation),
    [...facts.ambiguities].sort().join(","),
  ].join("|");
}

function observationFingerprintMaterial(
  source: PortfolioWatchSourceRecord,
  event: PublicCompanyEventObservation,
): string {
  const factsVersion =
    event.eventType === "financing_announced" && event.financingFacts !== null
      ? `|${FINANCING_FACTS_FINGERPRINT_VERSION}|${financingFactsFingerprintMaterial(event.financingFacts)}`
      : "";
  return `${source.companyId}|${event.canonicalUrl}|${event.publishedAt}|${event.eventType}${factsVersion}`;
}

function boundedSourceExcerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const words = normalized.match(/\S+/gu) ?? [];
  let excerpt = "";
  for (const word of words.slice(0, 25)) {
    const candidate = excerpt.length === 0 ? word : `${excerpt} ${word}`;
    if (candidate.length > 240) {
      break;
    }
    excerpt = candidate;
  }
  return excerpt || normalized.slice(0, 240).trim();
}

function observedFactForEvent(event: PublicCompanyEventObservation): string {
  if (event.financingFacts === null) {
    return event.title;
  }
  const evidenceExcerpts = [
    event.financingFacts.announcedAmount?.evidenceText,
    event.financingFacts.companyValuation?.evidenceText,
  ].filter(
    (excerpt, index, excerpts): excerpt is string =>
      excerpt !== undefined && excerpts.indexOf(excerpt) === index,
  );
  return evidenceExcerpts.join(" ") || boundedSourceExcerpt(event.evidenceText);
}

function activeSourceLostIdentity(
  source: PortfolioWatchSourceRecord,
  identityConfirmed: boolean,
): boolean {
  return source.status === "active" && !identityConfirmed;
}

type ProcessSourceJobOptions = {
  fetchSource?: (
    source: PortfolioWatchSourceRecord,
  ) => Promise<ApprovedSourceFetchResult>;
  now?: () => string;
};

async function processSourceJob(
  message: PortfolioWatchSourceJobMessage,
  env: Env,
  options: ProcessSourceJobOptions = {},
): Promise<void> {
  const repository = new D1PortfolioWatchRepository(env.DB);
  const source = await repository.getSource(message.sourceId);
  if (source === null) {
    return;
  }
  if (
    (message.type === "portfolio_watch_source_scan" &&
      source.status !== "active") ||
    (message.type === "portfolio_watch_source_verify" &&
      !["discovered", "verified", "degraded"].includes(source.status))
  ) {
    return;
  }

  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  const fetched = await (options.fetchSource ?? fetchApprovedCompanySource)(
    source,
  );
  if (!fetched.ok) {
    const nextStatus = fetched.permanent
      ? "quarantined"
      : source.status === "active"
        ? "degraded"
        : "discovered";
    await repository.recordVerification({
      sourceId: source.id,
      nextStatus,
      reasonCode: fetched.reason,
      observedUrl: source.canonicalUrl,
      normalizedUrl: null,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
      redirectUrl: fetched.redirectUrl,
      securityPassed: !fetched.permanent,
      grade: {
        ...source.grade,
        securityPpm: fetched.permanent ? 0 : source.grade.securityPpm,
        operationalPpm: 0,
      },
      checkedAt,
      contentSha256: null,
      etag: null,
      lastModified: null,
      errorCode: fetched.reason,
    });
    return;
  }

  const identityConfirmed = confirmsCompanyIdentity(
    fetched.text,
    source.companyName,
  );
  if (activeSourceLostIdentity(source, identityConfirmed)) {
    await repository.recordVerification({
      sourceId: source.id,
      nextStatus: "quarantined",
      reasonCode: "identity_disappeared",
      observedUrl: source.canonicalUrl,
      normalizedUrl: source.canonicalUrl,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
      redirectUrl: null,
      securityPassed: true,
      grade: {
        ...source.grade,
        identityPpm: 0,
        operationalPpm: 1_000_000,
      },
      checkedAt,
      contentSha256: fetched.sha256,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      errorCode: "identity_disappeared",
    });
    return;
  }
  const grade = {
    authorityPpm: source.grade.authorityPpm,
    identityPpm:
      message.type === "portfolio_watch_source_scan"
        ? source.grade.identityPpm
        : identityConfirmed
          ? 1_000_000
          : 850_000,
    securityPpm: 1_000_000,
    operationalPpm: 1_000_000,
  };
  const lifecycle = decideSourceLifecycle({
    currentStatus: source.status,
    grade,
  });
  await repository.recordVerification({
    sourceId: source.id,
    nextStatus: lifecycle.nextStatus,
    reasonCode: lifecycle.reason,
    observedUrl: source.canonicalUrl,
    normalizedUrl: source.canonicalUrl,
    httpStatus: fetched.status,
    contentType: fetched.contentType,
    redirectUrl: null,
    securityPassed: true,
    grade,
    checkedAt,
    contentSha256: fetched.sha256,
    etag: fetched.etag,
    lastModified: fetched.lastModified,
    errorCode: null,
  });
  if (
    lifecycle.nextStatus === "quarantined" ||
    lifecycle.nextStatus === "degraded"
  ) {
    return;
  }

  let candidates;
  let events;
  try {
    const inspected = inspectApprovedCompanyDocument(
      source,
      fetched.text,
      fetched.contentType,
    );
    candidates = inspected.candidates;
    events = inspected.events;
  } catch {
    await repository.recordVerification({
      sourceId: source.id,
      nextStatus: "quarantined",
      reasonCode: "unsafe_or_malformed_document",
      observedUrl: source.canonicalUrl,
      normalizedUrl: source.canonicalUrl,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
      redirectUrl: null,
      securityPassed: false,
      grade: { ...grade, securityPpm: 0, operationalPpm: 0 },
      checkedAt,
      contentSha256: fetched.sha256,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      errorCode: "unsafe_or_malformed_document",
    });
    return;
  }

  const followupJobs = await repository.registerCandidates(
    source.id,
    candidates,
    checkedAt,
  );
  await Promise.all(
    followupJobs.map((job) =>
      env.INGESTION_QUEUE.send({
        ...job,
        messageId: crypto.randomUUID(),
        requestedAt: checkedAt,
      }),
    ),
  );

  if (lifecycle.nextStatus !== "active") {
    return;
  }

  let objectStored = false;
  const objectKey = `public-watch/${source.id}/${fetched.sha256}`;
  for (const event of events) {
    if (event.publishedAt === null) {
      continue;
    }
    const fingerprint = await sha256(
      new TextEncoder().encode(observationFingerprintMaterial(source, event)),
    );
    if (await repository.hasObservation(source.householdId, fingerprint)) {
      continue;
    }
    if (!objectStored) {
      await env.DOCUMENTS.put(objectKey, fetched.bytes, {
        httpMetadata: { contentType: fetched.contentType },
      });
      objectStored = true;
    }
    await repository.recordObservation({
      sourceId: source.id,
      objectKey,
      contentType: fetched.contentType,
      byteSize: fetched.bytes.byteLength,
      sha256: fetched.sha256,
      retrievedAt: checkedAt,
      sourceUrl: event.canonicalUrl,
      sourceTitle: event.title,
      publishedAt: event.publishedAt,
      eventType: mappedEventType(event.eventType),
      observedFact: observedFactForEvent(event),
      modelConfidencePpm: 900_000,
      financingFacts: event.financingFacts,
      fingerprint,
    });
  }
}

export async function handlePortfolioWatchQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  for (const queued of batch.messages) {
    if (DeploymentSmokeMessageSchema.safeParse(queued.body).success) {
      queued.ack();
      continue;
    }
    const parsed = PortfolioWatchSourceJobMessageSchema.safeParse(queued.body);
    if (!parsed.success) {
      queued.ack();
      continue;
    }
    try {
      await processSourceJob(parsed.data, env);
      queued.ack();
    } catch {
      queued.retry({ delaySeconds: 60 });
    }
  }
}

export const __portfolioWatchTest = {
  activeSourceLostIdentity,
  confirmsCompanyIdentity,
  candidateInputs,
  extractedEvents,
  maxResponseBytes: MAX_OFFICIAL_COMPANY_RESPONSE_BYTES,
  observationFingerprintMaterial,
  observedFactForEvent,
  processSourceJob,
};
