import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { MAX_COMPANY_WEB_DISCOVERY_CANDIDATES } from "@keel/connectors";
import {
  D1AlphaRepository,
  type PortfolioWatchSourceRecord,
} from "@keel/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __portfolioWatchTest,
  fetchApprovedCompanySource,
  isPublicIpAddress,
  resolvePublicHostWithDnsJson,
} from "./portfolio-watch";
import type { Env } from "./types";

const migrationFiles = [
  "packages/database/migrations/0001_keel_core.sql",
  "packages/database/migrations/0002_versioned_goals.sql",
  "packages/database/migrations/0003_evidence_applications.sql",
  "packages/database/migrations/0004_portfolio_watch.sql",
  "packages/database/migrations/0005_portfolio_watch_sources.sql",
  "packages/database/migrations/0006_evidence_claim_integrity.sql",
  "packages/database/migrations/0007_holding_imports.sql",
  "packages/database/migrations/0008_signal_update_proposals.sql",
  "packages/database/migrations/0009_angellist_mac_agent.sql",
  "packages/database/migrations/0010_public_holdings.sql",
  "packages/database/migrations/0011_portfolio_baselines.sql",
  "packages/database/migrations/0012_append_only_cash_flow_plans.sql",
  "packages/database/migrations/0013_plaid_holdings_webhooks.sql",
  "packages/database/migrations/0014_robinhood_auto_adjudication.sql",
  "packages/database/migrations/0015_reviewed_cash_accounts.sql",
  "packages/database/migrations/0016_reviewed_liabilities.sql",
  "packages/database/migrations/0017_reviewed_cash_flow.sql",
  "packages/database/migrations/0018_reviewed_cash_account_identities.sql",
  "packages/database/migrations/0019_multi_source_holdings_contract.sql",
  "packages/database/migrations/0020_container_scoped_holding_ingestion.sql",
  "packages/database/migrations/0021_canonical_exposure_resolution.sql",
  "packages/database/migrations/0022_provider_neutral_investments.sql",
  "packages/database/migrations/0023_authoritative_portfolio_baselines.sql",
  "packages/database/migrations/0025_retired_asset_lots.sql",
  "packages/database/migrations/0026_reconciled_holding_ownership.sql",
  "packages/database/migrations/0027_retained_public_exposure_identity.sql",
  "packages/database/migrations/0028_provider_scoped_public_exposure.sql",
  "packages/database/migrations/0029_structured_asset_exposure.sql",
  "packages/database/migrations/0030_reconnected_position_continuity.sql",
  "packages/database/migrations/0031_reconnected_position_continuity_one_sided_identity.sql",
  "packages/database/migrations/0032_provider_template_holdings.sql",
  "packages/database/migrations/0038_reviewed_position_value_adjustments.sql",
  "packages/database/migrations/0039_reviewed_position_economics.sql",
  "packages/database/migrations/0040_holdings_read_performance.sql",
  "packages/database/seed/synthetic.sql",
] as const;

const financingSourceId = "source_worker_financing_test";
const financingHeadline = "Northstar Robotics raises Series B";

class TestD1Statement {
  private bindings: SQLInputValue[] = [];

  public constructor(private readonly statement: StatementSync) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    this.bindings = values;
    return this;
  }

  public first<T>(columnName?: string): Promise<T | null> {
    const row = this.statement.get(...this.bindings);
    if (row === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      (columnName === undefined ? row : row[columnName]) as T,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({
      results: this.statement.all(...this.bindings) as unknown as T[],
    });
  }

  public execute(): { success: true } {
    this.statement.run(...this.bindings);
    return { success: true };
  }
}

class TestD1Database {
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(query: string): TestD1Statement {
    return new TestD1Statement(this.database.prepare(query));
  }

  public batch(
    statements: readonly TestD1Statement[],
  ): Promise<{ success: true }[]> {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.database.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createMigratedTestDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of migrationFiles) {
    database.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
  }
  database.exec(`
    INSERT INTO portfolio_watch_sources (
      id, household_id, watch_target_id, company_id, source_kind, source_class,
      canonical_url, allowed_origin, allowed_path_prefix, status,
      authority_ppm, identity_confidence_ppm, operational_health_ppm,
      coverage_json, auto_activated_at, created_at, updated_at
    ) VALUES (
      '${financingSourceId}', 'hh_demo', 'watch_northstar', 'co_northstar',
      'official_company_web', 'official_company',
      'https://northstar-robotics.example/news/series-b',
      'https://northstar-robotics.example', '/news', 'active',
      1000000, 1000000, 1000000, '{}',
      '2026-08-07T00:00:00Z', '2026-08-07T00:00:00Z',
      '2026-08-07T00:00:00Z'
    );
  `);
  return database;
}

function tableSnapshot(database: DatabaseSync, table: string): string {
  return JSON.stringify(database.prepare(`SELECT * FROM ${table}`).all());
}

function tableCount(database: DatabaseSync, table: string): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number };
  return row.count;
}

let database: DatabaseSync | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

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
        <p>Example Robotics raised US$125 million in Series B financing at a US$1.2 billion post-money valuation.</p>
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
    expect(events[0]?.financingFacts).toMatchObject({
      roundType: "series",
      roundLabel: "Series B",
      announcedAmount: {
        amountMinor: 12_500_000_000,
        currency: "USD",
      },
      companyValuation: {
        amountMinor: 120_000_000_000,
        currency: "USD",
        basis: "post_money",
      },
    });

    const enrichedFingerprintMaterial =
      __portfolioWatchTest.observationFingerprintMaterial(source, events[0]!);
    expect(enrichedFingerprintMaterial).toContain("financing-facts-v1");
    expect(
      __portfolioWatchTest.observationFingerprintMaterial(source, {
        ...events[0]!,
        financingFacts: null,
      }),
    ).not.toBe(enrichedFingerprintMaterial);
    expect(
      __portfolioWatchTest.observationFingerprintMaterial(source, {
        ...events[0]!,
        financingFacts: {
          ...events[0]!.financingFacts!,
          announcedAmount: {
            ...events[0]!.financingFacts!.announcedAmount!,
            amountMinor: 13_000_000_000,
          },
        },
      }),
    ).not.toBe(enrichedFingerprintMaterial);
  });

  it("persists fetched financing facts for Review without mutating financial state", async () => {
    database = createMigratedTestDatabase();
    const d1 = new TestD1Database(database);
    const document = `<!doctype html>
      <html><head>
        <meta property="og:title" content="${financingHeadline}" />
        <meta property="article:published_time" content="2026-08-07T10:00:00Z" />
        <link rel="canonical" href="/news/series-b" />
      </head><body><article>
        <h1>${financingHeadline}</h1>
        <p>Northstar Robotics raised US$125 million in Series B equity financing at a US$1.2 billion post-money valuation.</p>
      </article></body></html>`;
    const bytes = new TextEncoder().encode(document);
    const fetchSource = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        bytes,
        text: document,
        contentType: "text/html",
        status: 200,
        sha256: "d".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );
    const put = vi.fn(() => Promise.resolve({}));
    const send = vi.fn(() => Promise.resolve({}));
    const env: Env = {
      DB: d1 as unknown as D1Database,
      DOCUMENTS: { put } as unknown as R2Bucket,
      ENVIRONMENT: "local",
      INGESTION_QUEUE: { send } as unknown as Queue,
    };
    const message = {
      type: "portfolio_watch_source_scan" as const,
      messageId: "00000000-0000-4000-8000-000000000001",
      sourceId: financingSourceId,
      requestedAt: "2026-08-07T11:59:00Z",
    };
    const lotsBefore = tableSnapshot(database, "asset_lots");
    const marksBefore = tableSnapshot(database, "marks");
    const forecastsBefore = tableSnapshot(database, "forecast_snapshots");
    const applicationsBefore = tableSnapshot(database, "evidence_applications");
    const observationsBefore = tableCount(
      database,
      "public_source_observations",
    );
    const evidenceBefore = tableCount(database, "evidence_events");

    await __portfolioWatchTest.processSourceJob(message, env, {
      fetchSource,
      now: () => "2026-08-07T12:00:00Z",
    });

    expect(tableCount(database, "public_source_observations")).toBe(
      observationsBefore + 1,
    );
    expect(tableCount(database, "evidence_events")).toBe(evidenceBefore + 1);
    const alphaRepository = new D1AlphaRepository(d1 as unknown as D1Database);
    const alphaData = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const financingFacts = {
      roundType: "series" as const,
      roundLabel: "Series B",
      instrument: "equity" as const,
      announcedAmount: {
        amountMinor: 12_500_000_000,
        currency: "USD",
        qualifier: "exact" as const,
      },
      companyValuation: {
        amountMinor: 120_000_000_000,
        currency: "USD",
        qualifier: "exact" as const,
        basis: "post_money" as const,
      },
      ambiguities: [],
    };
    expect(
      alphaData.evidenceInbox.find(
        (item) => item.headline === financingHeadline,
      ),
    ).toMatchObject({
      status: "pending_review",
      confidencePpm: 1_000_000,
      modelConfidencePpm: 900_000,
      forecastImpactMinor: 0,
      financingFacts,
      application: null,
    });
    expect(
      alphaData.portfolioWatch.observations.find(
        (item) => item.sourceTitle === financingHeadline,
      ),
    ).toMatchObject({
      sourceReliabilityPpm: 1_000_000,
      modelConfidencePpm: 900_000,
      valuationLowMinor: null,
      valuationMiddleMinor: null,
      valuationHighMinor: null,
      financingFacts,
    });

    await __portfolioWatchTest.processSourceJob(message, env, {
      fetchSource,
      now: () => "2026-08-07T12:05:00Z",
    });

    expect(tableCount(database, "public_source_observations")).toBe(
      observationsBefore + 1,
    );
    expect(tableCount(database, "evidence_events")).toBe(evidenceBefore + 1);
    expect(fetchSource).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(1);
    expect(tableSnapshot(database, "asset_lots")).toBe(lotsBefore);
    expect(tableSnapshot(database, "marks")).toBe(marksBefore);
    expect(tableSnapshot(database, "forecast_snapshots")).toBe(forecastsBefore);
    expect(tableSnapshot(database, "evidence_applications")).toBe(
      applicationsBefore,
    );
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
