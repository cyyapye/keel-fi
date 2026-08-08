import { describe, expect, it } from "vitest";

import {
  MAX_COMPANY_WEB_DISCOVERY_CANDIDATES,
  MAX_COMPANY_WEB_EVENT_TEXT_CHARS,
  MAX_OFFICIAL_COMPANY_RESPONSE_BYTES,
  PPM_MAX,
  PublicCompanyEventObservationSchema,
  canonicalizeCompanyWebsite,
  createSafeFetchRequestPolicy,
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
  isAllowedOfficialCompanyContentType,
  isWithinResponseByteLimit,
  normalizeApprovedWebsiteHost,
  normalizeContentType,
} from "./official-company-web";
import {
  ConnectorTypeSchema,
  PortfolioWatchSourceScanMessageSchema,
} from "./index";

const approvedHost = "example.com";

describe("official-company-web URL policy", () => {
  it("canonicalizes an HTTPS company homepage and binds its exact host", () => {
    expect(
      canonicalizeCompanyWebsite({
        companyId: "synthetic-company",
        homepageUrl: "HTTPS://EXAMPLE.COM/newsroom",
      }),
    ).toEqual({
      companyId: "synthetic-company",
      homepageUrl: "https://example.com/newsroom",
      approvedWebsiteHost: "example.com",
    });
  });

  it("permits only an exact approved HTTPS hostname", () => {
    expect(
      evaluateSourceUrl({
        rawUrl: "https://example.com/newsroom?tag=funding",
        approvedWebsiteHost: approvedHost,
      }),
    ).toMatchObject({
      accepted: true,
      source: { canonicalUrl: "https://example.com/newsroom?tag=funding" },
    });
    expect(
      evaluateSourceUrl({
        rawUrl: "https://news.example.com/newsroom",
        approvedWebsiteHost: approvedHost,
      }),
    ).toEqual({ accepted: false, reason: "host_not_approved" });
    expect(
      evaluateSourceUrl({
        rawUrl: "https://example.com.evil.test/newsroom",
        approvedWebsiteHost: approvedHost,
      }),
    ).toEqual({ accepted: false, reason: "host_not_approved" });
  });

  it.each([
    ["http://example.com/newsroom", "https_required"],
    ["https://example.com:444/newsroom", "non_default_port"],
    ["https://user:password@example.com/newsroom", "credentials_not_allowed"],
    ["https://example.com@evil.test/newsroom", "credentials_not_allowed"],
    ["https://example.com/newsroom#section", "fragment_not_allowed"],
    ["https://127.0.0.1/newsroom", "ip_literal_not_allowed"],
    ["https://[::1]/newsroom", "ip_literal_not_allowed"],
    ["https://0177.0.0.1/newsroom", "ip_literal_not_allowed"],
  ])("rejects URL trick %s", (rawUrl, reason) => {
    expect(
      evaluateSourceUrl({ rawUrl, approvedWebsiteHost: approvedHost }),
    ).toEqual({ accepted: false, reason });
  });

  it("rejects an invalid source authority rather than interpreting a URL as a host", () => {
    expect(normalizeApprovedWebsiteHost("https://example.com")).toBeNull();
    expect(normalizeApprovedWebsiteHost("example.com:443")).toBeNull();
    expect(normalizeApprovedWebsiteHost("example.com.")).toBeNull();
    expect(
      evaluateSourceUrl({
        rawUrl: "https://example.com/newsroom",
        approvedWebsiteHost: "https://example.com",
      }),
    ).toEqual({ accepted: false, reason: "invalid_approved_host" });
  });
});

describe("official-company-web discovery grading", () => {
  it("keeps authority, identity, security, and operational grades separate", () => {
    expect(
      gradeDiscoveryCandidate({
        candidateUrl: "https://example.com/newsroom",
        approvedWebsiteHost: approvedHost,
        discoveryMethod: "newsroom_link",
        companyNameConfirmed: false,
        fetchOutcome: "stale",
      }),
    ).toMatchObject({
      canonicalUrl: "https://example.com/newsroom",
      grade: {
        authorityPpm: 950_000,
        identityPpm: 850_000,
        securityPpm: PPM_MAX,
        operationalPpm: 700_000,
      },
    });
  });

  it("makes unsafe cross-host candidates untrusted regardless of discovery signal", () => {
    const grade = gradeDiscoveryCandidate({
      candidateUrl: "https://evil.test/press",
      approvedWebsiteHost: approvedHost,
      discoveryMethod: "homepage_link",
      companyNameConfirmed: true,
      fetchOutcome: "ok",
    });

    expect(grade).toMatchObject({
      canonicalUrl: null,
      urlPolicy: { accepted: false, reason: "host_not_approved" },
      grade: { authorityPpm: PPM_MAX, identityPpm: 0, securityPpm: 0 },
    });
  });

  it("makes lifecycle decisions deterministically without a financial mutation path", () => {
    expect(
      decideSourceLifecycle({
        currentStatus: "discovered",
        grade: {
          authorityPpm: PPM_MAX,
          identityPpm: PPM_MAX,
          securityPpm: PPM_MAX,
          operationalPpm: PPM_MAX,
        },
      }),
    ).toEqual({
      nextStatus: "active",
      reason: "ready_for_active_monitoring",
    });
    expect(
      decideSourceLifecycle({
        currentStatus: "active",
        grade: {
          authorityPpm: 950_000,
          identityPpm: 900_000,
          securityPpm: PPM_MAX,
          operationalPpm: 700_000,
        },
      }),
    ).toEqual({
      nextStatus: "verified",
      reason: "identity_and_authority_verified",
    });
    expect(
      decideSourceLifecycle({
        currentStatus: "active",
        grade: {
          authorityPpm: PPM_MAX,
          identityPpm: PPM_MAX,
          securityPpm: 0,
          operationalPpm: PPM_MAX,
        },
      }),
    ).toEqual({ nextStatus: "quarantined", reason: "unsafe_source" });
  });
});

describe("official-company-web safe fetch helpers", () => {
  const source = {
    canonicalUrl: "https://example.com/newsroom",
    host: approvedHost,
  };

  it("uses a bounded, anonymous GET with manual redirect handling", () => {
    expect(createSafeFetchRequestPolicy(source)).toMatchObject({
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      maxResponseBytes: MAX_OFFICIAL_COMPANY_RESPONSE_BYTES,
    });
  });

  it("refuses a malformed source record before creating a request policy", () => {
    expect(() =>
      createSafeFetchRequestPolicy({
        canonicalUrl: "https://evil.test/newsroom",
        host: approvedHost,
      }),
    ).toThrow("Company-web source is not eligible: host_not_approved");
  });

  it("normalizes and allowlists HTML and XML-derived media types", () => {
    expect(normalizeContentType("Application/RSS+XML; charset=UTF-8")).toBe(
      "application/rss+xml",
    );
    expect(
      isAllowedOfficialCompanyContentType("text/html; charset=utf-8"),
    ).toBe(true);
    expect(isAllowedOfficialCompanyContentType("application/json")).toBe(false);
    expect(isAllowedOfficialCompanyContentType(null)).toBe(false);
  });

  it("rejects redirects, response host changes, unsupported types, and oversized bodies", () => {
    expect(
      evaluateSafeFetchResponse(source, {
        status: 302,
        responseUrl: "https://example.com/newsroom",
        contentType: "text/html",
        contentLength: 12,
        bytesRead: 12,
      }),
    ).toEqual({ accepted: false, reason: "redirect_not_allowed" });
    expect(
      evaluateSafeFetchResponse(source, {
        status: 200,
        responseUrl: "https://evil.test/newsroom",
        contentType: "text/html",
        contentLength: 12,
        bytesRead: 12,
      }),
    ).toEqual({ accepted: false, reason: "response_url_not_approved" });
    expect(
      evaluateSafeFetchResponse(source, {
        status: 200,
        responseUrl: "https://example.com/newsroom",
        contentType: "application/json",
        contentLength: 12,
        bytesRead: 12,
      }),
    ).toEqual({ accepted: false, reason: "unsupported_content_type" });
    expect(
      evaluateSafeFetchResponse(source, {
        status: 200,
        responseUrl: "https://example.com/newsroom",
        contentType: "text/html",
        contentLength: MAX_OFFICIAL_COMPANY_RESPONSE_BYTES + 1,
        bytesRead: 12,
      }),
    ).toEqual({ accepted: false, reason: "response_too_large" });
  });

  it("accepts bounded same-host HTML and guards the next streamed chunk", () => {
    expect(
      evaluateSafeFetchResponse(source, {
        status: 200,
        responseUrl: "https://example.com/newsroom",
        contentType: "text/html; charset=utf-8",
        contentLength: 12,
        bytesRead: 12,
      }),
    ).toEqual({ accepted: true, reason: "accepted" });
    expect(isWithinResponseByteLimit(1_000, 24)).toBe(true);
    expect(
      isWithinResponseByteLimit(MAX_OFFICIAL_COMPANY_RESPONSE_BYTES, 1),
    ).toBe(false);
  });
});

describe("Portfolio Watch source scan messages", () => {
  it("uses an approved source ID instead of an arbitrary URL", () => {
    const message = {
      messageId: "a9b33b14-2d43-49dc-99bc-39f98f8429fb",
      type: "portfolio_watch_source_scan" as const,
      sourceId: "source-1",
      requestedAt: "2026-08-07T12:00:00.000Z",
    };

    expect(PortfolioWatchSourceScanMessageSchema.parse(message)).toEqual(
      message,
    );
    expect(
      PortfolioWatchSourceScanMessageSchema.safeParse({
        ...message,
        url: "https://attacker.invalid/metadata",
      }).success,
    ).toBe(false);
    expect(ConnectorTypeSchema.parse("official-company-web")).toBe(
      "official-company-web",
    );
  });
});

describe("official-company-web bounded document discovery", () => {
  const source = {
    canonicalUrl: "https://example.com/",
    host: approvedHost,
  };

  it("discovers only same-origin newsroom, feed, and article candidates from HTML", () => {
    const candidates = discoverCompanyWebCandidatesFromHtml({
      source,
      document: `
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        <a href="/newsroom">Newsroom</a>
        <a href="/newsroom/example-raises-series-b">Funding news</a>
        <a href="https://evil.test/newsroom">Untrusted link</a>
        <a href="/careers">Careers</a>
      `,
    });

    expect(candidates).toEqual([
      {
        url: "https://example.com/newsroom/example-raises-series-b",
        kind: "article",
        discoveryMethod: "homepage_link",
      },
      {
        url: "https://example.com/feed.xml",
        kind: "feed",
        discoveryMethod: "feed_autodiscovery",
      },
      {
        url: "https://example.com/newsroom",
        kind: "newsroom",
        discoveryMethod: "homepage_link",
      },
    ]);
  });

  it("discovers bounded same-origin sitemap pages and rejects XML entities", () => {
    expect(
      discoverCompanyWebCandidatesFromSitemap({
        source,
        document: `<?xml version="1.0"?>
          <urlset>
            <url><loc>https://example.com/news/series-b</loc></url>
            <url><loc>https://attacker.invalid/news/forged</loc></url>
          </urlset>`,
      }),
    ).toEqual([
      {
        url: "https://example.com/news/series-b",
        kind: "article",
        discoveryMethod: "sitemap",
      },
    ]);
    expect(() =>
      discoverCompanyWebCandidatesFromSitemap({
        source,
        document:
          '<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]><urlset />',
      }),
    ).toThrow("DTD and entity");
  });

  it("discovers same-origin Markdown links and ignores unrelated or cross-host links", () => {
    expect(
      discoverCompanyWebCandidatesFromMarkdown({
        source,
        document: `# Example
          [Funding](/blog/example-raises-series-c)
          [Careers](/careers)
          [Forged](https://attacker.invalid/blog/raise)`,
      }),
    ).toEqual([
      {
        url: "https://example.com/blog/example-raises-series-c",
        kind: "article",
        discoveryMethod: "homepage_link",
      },
    ]);
  });

  it("bounds candidate output from hostile-sized link lists", () => {
    const document = Array.from(
      { length: MAX_COMPANY_WEB_DISCOVERY_CANDIDATES + 10 },
      (_, index) => `<a href="/news/article-${index}">Article</a>`,
    ).join("");

    expect(
      discoverCompanyWebCandidatesFromHtml({ source, document }),
    ).toHaveLength(MAX_COMPANY_WEB_DISCOVERY_CANDIDATES);
  });

  it("discovers only same-origin article links from RSS and rejects XML entity declarations", () => {
    const feed = `
      <rss><channel>
        <item><title>One</title><link>https://example.com/news/one</link></item>
        <item><title>Two</title><link>https://evil.test/news/two</link></item>
      </channel></rss>`;

    expect(
      discoverCompanyWebCandidatesFromFeed({ source, document: feed }),
    ).toEqual([
      {
        url: "https://example.com/news/one",
        kind: "article",
        discoveryMethod: "feed_autodiscovery",
      },
    ]);
    expect(() =>
      discoverCompanyWebCandidatesFromFeed({
        source,
        document:
          '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss />',
      }),
    ).toThrow("DTD and entity declarations");
  });

  it("discovers same-origin Atom alternate links", () => {
    expect(
      discoverCompanyWebCandidatesFromFeed({
        source,
        document: `
          <feed><entry>
            <title>Example update</title>
            <link rel="alternate" href="/news/atom-update" />
          </entry></feed>`,
      }),
    ).toEqual([
      {
        url: "https://example.com/news/atom-update",
        kind: "article",
        discoveryMethod: "feed_autodiscovery",
      },
    ]);
  });
});

describe("official-company-web factual event extraction", () => {
  const source = {
    canonicalUrl: "https://example.com/newsroom/series-b",
    host: approvedHost,
  };

  it("requires a financingFacts field and rejects facts on non-financing events", () => {
    const base = {
      eventType: "acquisition_announced" as const,
      title: "Example acquires SampleCo",
      canonicalUrl: "https://example.com/news/acquisition",
      publishedAt: "2026-07-01T10:30:00.000Z",
      evidenceText: "Example acquires SampleCo.",
    };
    expect(PublicCompanyEventObservationSchema.safeParse(base).success).toBe(
      false,
    );
    expect(
      PublicCompanyEventObservationSchema.safeParse({
        ...base,
        financingFacts: {
          roundType: "seed",
          roundLabel: "Seed",
          instrument: "undisclosed",
          announcedAmount: null,
          companyValuation: null,
          ambiguities: [],
        },
      }).success,
    ).toBe(false);
  });

  it("extracts a bounded financing observation with review-only financing facts", () => {
    const events = extractPublicCompanyEventsFromHtml({
      source,
      document: `
        <html><head>
          <title>Example raises Series B to expand its product</title>
          <link rel="canonical" href="/newsroom/series-b">
          <meta property="article:published_time" content="2026-07-01T10:30:00-07:00">
        </head><body><article>${"Product investment update ".repeat(200)}</article></body></html>`,
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventType: "financing_announced",
        title: "Example raises Series B to expand its product",
        canonicalUrl: "https://example.com/newsroom/series-b",
        publishedAt: "2026-07-01T17:30:00.000Z",
      }),
    ]);
    expect(events[0]?.evidenceText.length).toBeLessThanOrEqual(
      MAX_COMPANY_WEB_EVENT_TEXT_CHARS,
    );
    expect(Object.keys(events[0] ?? {})).toEqual([
      "eventType",
      "title",
      "canonicalUrl",
      "publishedAt",
      "evidenceText",
      "financingFacts",
    ]);
    expect(events[0]?.financingFacts).toMatchObject({
      roundType: "series",
      roundLabel: "Series B",
      announcedAmount: null,
      companyValuation: null,
    });
  });

  it("prefers article text when page chrome exceeds the evidence bound", () => {
    const events = extractPublicCompanyEventsFromHtml({
      source,
      document: `<html><head>
        <title>Example raises Series C financing</title>
        <link rel="canonical" href="/newsroom/series-c">
      </head><body>
        <nav>${"Navigation and cookie preference text. ".repeat(100)}</nav>
        <article>
          <h1>Example raises Series C financing</h1>
          <p>August 6, 2026</p>
          <p>Example raised US$250 million in Series C financing at a US$1.5 billion post-money valuation.</p>
        </article>
      </body></html>`,
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventType: "financing_announced",
        publishedAt: "2026-08-06T00:00:00.000Z",
        financingFacts: expect.objectContaining({
          announcedAmount: expect.objectContaining({
            amountMinor: 25_000_000_000,
            currency: "USD",
          }),
          companyValuation: expect.objectContaining({
            amountMinor: 150_000_000_000,
            currency: "USD",
            basis: "post_money",
          }),
        }),
      }),
    ]);
    expect(events[0]?.evidenceText).not.toContain("Navigation");
  });

  it("uses the first visible calendar date when article metadata omits one", () => {
    expect(
      extractPublicCompanyEventsFromHtml({
        source,
        document: `<html><head>
          <title>Example raises Series H funding</title>
          <link rel="canonical" href="/newsroom/series-h" />
        </head><body><main>
          <h1>Example raises Series H funding</h1>
          <p>May 28, 2026</p>
          <p>Example announced new financing.</p>
        </main></body></html>`,
      }),
    ).toEqual([
      expect.objectContaining({
        eventType: "financing_announced",
        publishedAt: "2026-05-28T00:00:00.000Z",
      }),
    ]);
  });

  it("classifies acquisition, IPO/filing, and shutdown announcements from feed entries", () => {
    const events = extractPublicCompanyEventsFromFeed({
      source,
      document: `
        <rss><channel>
          <item><title>Example acquires SampleCo</title><link>https://example.com/news/acquisition</link><pubDate>Tue, 01 Jul 2026 10:30:00 -0700</pubDate></item>
          <item><title>Example files Form S-1</title><link>https://example.com/news/s-1</link><pubDate>2026-07-02T10:30:00Z</pubDate></item>
          <item><title>Example is winding down operations</title><link>https://example.com/news/wind-down</link><pubDate>2026-07-03T10:30:00Z</pubDate></item>
        </channel></rss>`,
    });

    expect(events.map((event) => event.eventType)).toEqual([
      "acquisition_announced",
      "ipo_or_filing_announced",
      "shutdown_announced",
    ]);
    expect(events.map((event) => event.publishedAt)).toEqual([
      "2026-07-01T17:30:00.000Z",
      "2026-07-02T10:30:00.000Z",
      "2026-07-03T10:30:00.000Z",
    ]);
    expect(events.every((event) => event.financingFacts === null)).toBe(true);
  });

  it("classifies an official employee tender offer as a secondary transaction", () => {
    expect(
      extractPublicCompanyEventsFromHtml({
        source,
        document: `<html><head>
          <title>Example announces tender offer for employee liquidity</title>
          <link rel="canonical" href="/news/employee-tender" />
          <meta property="article:published_time" content="2026-08-01T10:00:00Z" />
        </head><body><h1>Example announces tender offer</h1></body></html>`,
      }),
    ).toEqual([
      expect.objectContaining({
        eventType: "secondary_transaction_announced",
      }),
    ]);
  });

  it("extracts a dated financing event from Markdown", () => {
    expect(
      extractPublicCompanyEventsFromMarkdown({
        source: {
          canonicalUrl: "https://example.com/blog/series-c",
          host: approvedHost,
        },
        document: `# Example raises Series C funding

          June 16, 2025

          Example announced new financing.`,
      }),
    ).toEqual([
      expect.objectContaining({
        eventType: "financing_announced",
        publishedAt: "2025-06-16T00:00:00.000Z",
      }),
    ]);
  });

  it("extracts a financing observation from an Atom entry", () => {
    expect(
      extractPublicCompanyEventsFromFeed({
        source,
        document: `
          <feed><entry>
            <title>Example raises new financing</title>
            <link href="/news/atom-financing" rel="alternate" />
            <published>2026-07-04T10:30:00Z</published>
          </entry></feed>`,
      }),
    ).toEqual([
      expect.objectContaining({
        eventType: "financing_announced",
        canonicalUrl: "https://example.com/news/atom-financing",
        publishedAt: "2026-07-04T10:30:00.000Z",
      }),
    ]);
  });

  it("does not emit an event when an HTML canonical link crosses the approved host", () => {
    expect(
      extractPublicCompanyEventsFromHtml({
        source,
        document: `
          <title>Example raises a Series C</title>
          <link rel="canonical" href="https://evil.test/newsroom/series-c">
        `,
      }),
    ).toEqual([]);
  });

  it("rejects XML entity declarations before extracting an event", () => {
    expect(() =>
      extractPublicCompanyEventsFromFeed({
        source,
        document:
          '<!ENTITY xxe SYSTEM "file:///etc/passwd"><rss><channel /></rss>',
      }),
    ).toThrow("DTD and entity declarations");
  });
});
