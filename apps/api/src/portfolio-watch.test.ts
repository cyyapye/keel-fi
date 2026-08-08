import { MAX_COMPANY_WEB_DISCOVERY_CANDIDATES } from "@keel/connectors";
import type { PortfolioWatchSourceRecord } from "@keel/database";
import { describe, expect, it, vi } from "vitest";

import {
  __portfolioWatchTest,
  fetchApprovedCompanySource,
  isPublicIpAddress,
  resolvePublicHostWithDnsJson,
} from "./portfolio-watch";

const source: PortfolioWatchSourceRecord = {
  id: "synthetic-source",
  householdId: "synthetic-household",
  watchTargetId: "synthetic-watch-target",
  companyId: "synthetic-company",
  companyName: "Example Robotics",
  approvedWebsiteHost: "example.com",
  sourceKind: "official_company_web",
  canonicalUrl: "https://example.com/newsroom",
  allowedOrigin: "https://example.com",
  allowedPathPrefix: "/newsroom",
  status: "active",
  grade: {
    authorityPpm: 1_000_000,
    identityPpm: 1_000_000,
    securityPpm: 1_000_000,
    operationalPpm: 1_000_000,
  },
};

describe("Portfolio Watch network boundary", () => {
  it("recognizes public addresses and rejects local, private, and documentation ranges", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("192.0.2.10")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("fd00::1")).toBe(false);
  });

  it("stops before fetch when DNS includes a non-public address", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchApprovedCompanySource(source, {
      fetchImpl,
      resolveHost: () => Promise.resolve(["93.184.216.34", "127.0.0.1"]),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "non_public_address",
      permanent: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to a second validated public DNS resolver", async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url =
        input instanceof URL
          ? input
          : new URL(typeof input === "string" ? input : input.url);
      if (url.hostname === "cloudflare-dns.com") {
        return Promise.reject(new Error("primary resolver unavailable"));
      }
      const type = url.searchParams.get("type");
      return Promise.resolve(
        Response.json({
          Status: 0,
          Answer:
            type === "A"
              ? [{ type: 1, data: "93.184.216.34" }]
              : [{ type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" }],
        }),
      );
    });

    await expect(
      resolvePublicHostWithDnsJson("example.com", fetchImpl),
    ).resolves.toEqual(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("rejects redirects and oversized responses without consuming their bodies", async () => {
    const redirected = await fetchApprovedCompanySource(source, {
      resolveHost: () => Promise.resolve(["93.184.216.34"]),
      fetchImpl: () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { Location: "https://example.com/elsewhere" },
          }),
        ),
    });
    expect(redirected).toMatchObject({
      ok: false,
      reason: "redirect_not_allowed",
    });

    const oversized = await fetchApprovedCompanySource(source, {
      resolveHost: () => Promise.resolve(["93.184.216.34"]),
      fetchImpl: () =>
        Promise.resolve(
          new Response("not read", {
            status: 200,
            headers: {
              "Content-Type": "text/html",
              "Content-Length": String(
                __portfolioWatchTest.maxResponseBytes + 1,
              ),
            },
          }),
        ),
    });
    expect(oversized).toMatchObject({
      ok: false,
      reason: "response_too_large",
    });
  });

  it("aborts a stalled source request at its deadline", async () => {
    const result = await fetchApprovedCompanySource(source, {
      resolveHost: () => Promise.resolve(["93.184.216.34"]),
      timeoutMs: 1,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("request aborted"));
          });
        }),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "request_timeout",
      permanent: false,
    });
  });

  it("accepts bounded official HTML and produces only factual public events", async () => {
    const document = `<!doctype html>
      <html><head>
        <meta property="og:title" content="Example Robotics raises Series B" />
        <meta property="article:published_time" content="2026-08-01T10:00:00Z" />
        <link rel="canonical" href="/newsroom/series-b" />
      </head><body>
        <h1>Example Robotics raises Series B</h1>
        <a href="/newsroom/series-b">Announcement</a>
        <p>Example Robotics announced financing for product development.</p>
      </body></html>`;
    const result = await fetchApprovedCompanySource(source, {
      resolveHost: () => Promise.resolve(["93.184.216.34"]),
      fetchImpl: () =>
        Promise.resolve(
          new Response(document, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        ),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected accepted source response.");
    }
    const events = __portfolioWatchTest.extractedEvents(
      source,
      result.text,
      result.contentType,
    );
    expect(events).toEqual([
      expect.objectContaining({
        eventType: "financing_announced",
        canonicalUrl: "https://example.com/newsroom/series-b",
        publishedAt: "2026-08-01T10:00:00.000Z",
      }),
    ]);
    expect(events[0]).not.toHaveProperty("valuation");
    expect(events[0]).not.toHaveProperty("holdingId");
  });

  it("caps root-page candidates after adding standard source paths", () => {
    const rootSource = { ...source, canonicalUrl: "https://example.com/" };
    const document = Array.from(
      { length: MAX_COMPANY_WEB_DISCOVERY_CANDIDATES },
      (_, index) => `<a href="/news/article-${index}">Article</a>`,
    ).join("");

    expect(
      __portfolioWatchTest.candidateInputs(
        rootSource,
        document,
        "text/html",
        true,
      ),
    ).toHaveLength(MAX_COMPANY_WEB_DISCOVERY_CANDIDATES);
  });

  it("quarantines an active source when its company identity disappears", () => {
    expect(__portfolioWatchTest.activeSourceLostIdentity(source, false)).toBe(
      true,
    );
    expect(__portfolioWatchTest.activeSourceLostIdentity(source, true)).toBe(
      false,
    );
    expect(
      __portfolioWatchTest.activeSourceLostIdentity(
        { ...source, status: "verified" },
        false,
      ),
    ).toBe(false);
  });
});
