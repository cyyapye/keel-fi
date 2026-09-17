import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { D1WatchWebsiteRepository } from "./watch-website";
import { __alphaRepositoryTest, D1AlphaRepository } from "./index";
import {
  __portfolioWatchTest,
  D1PortfolioWatchRepository,
  PortfolioWatchObservationInputSchema,
} from "./portfolio-watch";

const portfolioWatchExposureUniverseMigrationFile =
  "packages/database/migrations/0045_portfolio_watch_exposure_universe.sql";
const syntheticSeedFile = "packages/database/seed/synthetic.sql";
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
  "packages/database/migrations/0058_net_invested_position_economics.sql",
  "packages/database/migrations/0040_holdings_read_performance.sql",
  "packages/database/migrations/0041_reported_position_economics.sql",
  portfolioWatchExposureUniverseMigrationFile,
  "packages/database/migrations/0046_reviewed_legal_entity_inventory.sql",
  "packages/database/migrations/0033_provider_portfolio_agents.sql",
  "packages/database/migrations/0047_provider_legal_document_evidence.sql",
  "packages/database/migrations/0048_private_document_access.sql",
  "packages/database/migrations/0049_legal_name_resolutions.sql",
  "packages/database/migrations/0050_agreement_rechecks.sql",
  "packages/database/migrations/0051_legal_structure_review_guard.sql",
  "packages/database/migrations/0052_reviewed_structure_entity_type.sql",
  "packages/database/migrations/0053_connected_investment_reviews.sql",
  "packages/database/migrations/0059_automatic_investment_reviews.sql",
  syntheticSeedFile,
  "packages/database/migrations/0061_portfolio_watch_activity.sql",
  "packages/database/migrations/0062_reviewed_company_aliases.sql",
  "packages/database/migrations/0064_watch_read_receipts.sql",
  "packages/database/migrations/0065_watch_website_confirmation.sql",
] as const;

class TestD1Statement {
  private bindings: SQLInputValue[] = [];

  public constructor(
    private readonly statement: StatementSync,
    private readonly recordRoundTrip: () => void,
  ) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    this.bindings = values;
    return this;
  }

  public first<T>(columnName?: string): Promise<T | null> {
    this.recordRoundTrip();
    const row = this.statement.get(...this.bindings);
    if (row === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      (columnName === undefined ? row : row[columnName]) as T,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    this.recordRoundTrip();
    return Promise.resolve({
      results: this.statement.all(...this.bindings) as unknown as T[],
    });
  }

  public execute(recordRoundTrip = true): { success: true } {
    if (recordRoundTrip) {
      this.recordRoundTrip();
    }
    this.statement.run(...this.bindings);
    return { success: true };
  }
}

class TestD1Database {
  public roundTripCount = 0;

  public constructor(private readonly database: DatabaseSync) {}

  public prepare(query: string): TestD1Statement {
    return new TestD1Statement(this.database.prepare(query), () => {
      this.roundTripCount += 1;
    });
  }

  public batch(
    statements: readonly TestD1Statement[],
  ): Promise<{ success: true }[]> {
    this.roundTripCount += 1;
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute(false));
      this.database.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public resetRoundTripCount(): void {
    this.roundTripCount = 0;
  }
}

function createTestDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of migrationFiles) {
    database.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
  }
  database.exec(`
    UPDATE portfolio_watch_targets
    SET status = 'active'
    WHERE id = 'watch_northstar';

    INSERT INTO portfolio_watch_sources (
      id, household_id, watch_target_id, company_id, source_kind, source_class,
      canonical_url, allowed_origin, allowed_path_prefix, status,
      authority_ppm, identity_confidence_ppm, operational_health_ppm,
      coverage_json, auto_activated_at, created_at, updated_at
    ) VALUES (
      'source_financing_test', 'hh_demo', 'watch_northstar', 'co_northstar',
      'official_company_web', 'official_company',
      'https://northstar-robotics.example/news',
      'https://northstar-robotics.example', '/', 'active',
      1000000, 1000000, 1000000, '{}',
      '2026-08-07T00:00:00Z', '2026-08-07T00:00:00Z',
      '2026-08-07T00:00:00Z'
    );
  `);
  return database;
}

function createTestDatabaseBeforeExposureUniverse(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of migrationFiles) {
    if (
      file !== portfolioWatchExposureUniverseMigrationFile &&
      file !== syntheticSeedFile
    ) {
      database.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    }
  }
  database.exec(
    readFileSync(resolve(process.cwd(), syntheticSeedFile), "utf8"),
  );
  return database;
}

function seedPrivateExposureUniverse(
  database: DatabaseSync,
  companyCount: number,
  options: { withWebsiteHosts?: boolean } = {},
): void {
  const websiteHostExpression =
    options.withWebsiteHosts === false
      ? "NULL"
      : "printf('watch-scale-%03d.example', value)";
  database.exec(`
    UPDATE portfolio_watch_targets SET status = 'paused';

    INSERT INTO investment_connections (
      id, household_id, adapter_type, protected_source_key,
      created_by_user_id, created_at, immutable
    ) VALUES (
      'watch_scale_connection', 'hh_demo', 'manual',
      printf('%064x', 7001), 'usr_demo', '2026-08-29T12:00:00.000Z', 1
    );

    INSERT INTO investment_connection_versions (
      id, household_id, connection_id, version, institution_key,
      institution_label, lifecycle_state, credential_reference,
      supersedes_version_id, recorded_by_user_id, recorded_at, immutable
    ) VALUES (
      'watch_scale_connection_v1', 'hh_demo', 'watch_scale_connection', 1,
      'watch-scale', 'Synthetic watch scale', 'active', NULL, NULL,
      'usr_demo', '2026-08-29T12:00:00.000Z', 1
    );

    INSERT INTO ownership_containers (
      id, household_id, connection_id, protected_account_key,
      created_by_user_id, created_at, immutable
    ) VALUES (
      'watch_scale_container', 'hh_demo', 'watch_scale_connection',
      printf('%064x', 7002), 'usr_demo', '2026-08-29T12:00:00.000Z', 1
    );

    INSERT INTO ownership_container_versions (
      id, household_id, container_id, version, display_label,
      container_kind, tax_treatment, supersedes_version_id,
      recorded_by_user_id, recorded_at, immutable
    ) VALUES (
      'watch_scale_container_v1', 'hh_demo', 'watch_scale_container', 1,
      'Synthetic private positions', 'other', 'unknown', NULL, 'usr_demo',
      '2026-08-29T12:00:00.000Z', 1
    );

    WITH RECURSIVE scale(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM scale WHERE value < ${companyCount}
    )
    INSERT INTO companies (
      id, household_id, legal_name, website_host, status, created_at,
      updated_at
    )
    SELECT
      printf('co_watch_scale_%03d', value),
      'hh_demo',
      printf('Synthetic Watch Company %03d', value),
      ${websiteHostExpression},
      'active',
      '2026-08-29T12:00:00.000Z',
      '2026-08-29T12:00:00.000Z'
    FROM scale;

    WITH RECURSIVE scale(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM scale WHERE value < ${companyCount}
    )
    INSERT INTO holding_positions (
      id, household_id, provider, position_fingerprint, legal_vehicle_name,
      owner_label, position_kind, instrument_type, opened_on, currency,
      created_by, created_at
    )
    SELECT
      printf('position_watch_scale_%03d', value),
      'hh_demo',
      'angellist',
      printf('%064x', 8000 + value),
      printf('Synthetic SPV %03d', value),
      'Synthetic owner',
      'spv_interest',
      'private_equity',
      '2026-01-01',
      'USD',
      'usr_demo',
      '2026-08-29T12:00:00.000Z'
    FROM scale;

    WITH RECURSIVE scale(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM scale WHERE value < ${companyCount}
    )
    INSERT INTO holding_position_ownerships (
      id, household_id, container_id, position_id, protected_position_key,
      association_basis, evidence_sha256, version, supersedes_ownership_id,
      accepted_by_user_id, accepted_at, immutable
    )
    SELECT
      printf('ownership_watch_scale_%03d', value),
      'hh_demo',
      'watch_scale_container',
      printf('position_watch_scale_%03d', value),
      printf('%064x', 8000 + value),
      'reviewed_import',
      printf('%064x', 9000 + value),
      1,
      NULL,
      'usr_demo',
      '2026-08-29T12:00:00.000Z',
      1
    FROM scale;

    WITH RECURSIVE scale(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM scale WHERE value < ${companyCount}
    )
    INSERT INTO canonical_exposures (
      id, household_id, exposure_kind, canonical_name,
      protected_identity_key, company_id, resolution_method,
      evidence_sha256, created_by_user_id, created_at, immutable
    )
    SELECT
      printf('exposure_watch_scale_%03d', value),
      'hh_demo',
      'private_company',
      printf('Synthetic Watch Company %03d', value),
      NULL,
      printf('co_watch_scale_%03d', value),
      'reviewed_company',
      printf('%064x', 9000 + value),
      'usr_demo',
      '2026-08-29T12:00:00.000Z',
      1
    FROM scale;

    WITH RECURSIVE scale(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM scale WHERE value < ${companyCount}
    )
    INSERT INTO holding_position_exposure_mappings (
      id, household_id, position_id, exposure_id, relationship_kind,
      allocation_ppm, status, decision_source, decision_reference,
      evidence_sha256, effective_at, version, supersedes_mapping_id,
      accepted_by_user_id, accepted_at, immutable
    )
    SELECT
      printf('mapping_watch_scale_%03d', value),
      'hh_demo',
      printf('position_watch_scale_%03d', value),
      printf('exposure_watch_scale_%03d', value),
      'look_through',
      1000000,
      'active',
      'review',
      'Synthetic reviewed private-company exposure',
      printf('%064x', 9000 + value),
      '2026-08-29T12:00:00.000Z',
      1,
      NULL,
      'usr_demo',
      '2026-08-29T12:00:00.000Z',
      1
    FROM scale;
  `);
}

function tableSnapshot(database: DatabaseSync, table: string): string {
  return JSON.stringify(database.prepare(`SELECT * FROM ${table}`).all());
}

let database: DatabaseSync | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("Portfolio Watch exposure universe", () => {
  it("backfills current exposures and makes their reviewed homepages due without a manual scan", async () => {
    database = createTestDatabaseBeforeExposureUniverse();
    seedPrivateExposureUniverse(database, 1);

    database.exec(
      readFileSync(
        resolve(process.cwd(), portfolioWatchExposureUniverseMigrationFile),
        "utf8",
      ),
    );

    const targetId = "watch-current-exposure-v1:co_watch_scale_001";
    const sourceId = `source-homepage-v1:${targetId}`;
    expect(
      database
        .prepare(
          `SELECT target.status, source.id AS source_id, source.status AS source_status
           FROM portfolio_watch_targets target
           JOIN portfolio_watch_sources source
             ON source.watch_target_id = target.id
           JOIN portfolio_watch_source_sync_state sync
             ON sync.source_id = source.id
           WHERE target.id = ?`,
        )
        .get(targetId),
    ).toEqual({
      status: "active",
      source_id: sourceId,
      source_status: "discovered",
    });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM portfolio_watch_targets
           WHERE id IN ('watch_northstar', 'watch_harbor', 'watch_lattice')
             AND status = 'paused'`,
        )
        .get(),
    ).toEqual({ count: 3 });

    const dueJobs = await new D1PortfolioWatchRepository(
      new TestD1Database(database) as unknown as D1Database,
    ).listDueSourceJobs("2099-01-01T00:00:00.000Z", 100);
    expect(dueJobs).toContainEqual({
      type: "portfolio_watch_source_verify",
      sourceId,
    });
  });

  it("adds, hides, and restores one target from current private-company exposures", async () => {
    database = createTestDatabase();
    seedPrivateExposureUniverse(database, 1);

    const targetId = "watch-current-exposure-v1:co_watch_scale_001";
    expect(
      database
        .prepare(
          `SELECT id, status FROM portfolio_watch_targets
           WHERE company_id = 'co_watch_scale_001'`,
        )
        .get(),
    ).toEqual({ id: targetId, status: "active" });

    const sourceId = `source-homepage-v1:${targetId}`;
    expect(
      database
        .prepare(
          `SELECT id, status, canonical_url, allowed_origin
           FROM portfolio_watch_sources
           WHERE watch_target_id = ?`,
        )
        .get(targetId),
    ).toEqual({
      id: sourceId,
      status: "discovered",
      canonical_url: "https://watch-scale-001.example/",
      allowed_origin: "https://watch-scale-001.example",
    });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS event_count
           FROM portfolio_watch_source_verification_events
           WHERE source_id = ? AND event_type = 'discovered'
             AND reason_code = 'configured_homepage'`,
        )
        .get(sourceId),
    ).toEqual({ event_count: 1 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS sync_count
           FROM portfolio_watch_source_sync_state
           WHERE source_id = ?`,
        )
        .get(sourceId),
    ).toEqual({ sync_count: 1 });

    database
      .prepare(
        `UPDATE portfolio_watch_targets SET status = 'active' WHERE id = ?`,
      )
      .run(targetId);
    expect(
      database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM portfolio_watch_sources
              WHERE watch_target_id = ?) AS source_count,
             (SELECT COUNT(*)
              FROM portfolio_watch_source_verification_events
              WHERE source_id = ?) AS event_count,
             (SELECT COUNT(*) FROM portfolio_watch_source_sync_state
              WHERE source_id = ?) AS sync_count`,
        )
        .get(targetId, sourceId, sourceId),
    ).toEqual({ source_count: 1, event_count: 1, sync_count: 1 });

    const dueJobs = await new D1PortfolioWatchRepository(
      new TestD1Database(database) as unknown as D1Database,
    ).listDueSourceJobs("2099-01-01T00:00:00.000Z", 100);
    expect(dueJobs).toContainEqual({
      type: "portfolio_watch_source_verify",
      sourceId,
    });

    database.exec(`
      INSERT INTO holding_position_exposure_mappings (
        id, household_id, position_id, exposure_id, relationship_kind,
        allocation_ppm, status, decision_source, decision_reference,
        evidence_sha256, effective_at, version, supersedes_mapping_id,
        accepted_by_user_id, accepted_at, immutable
      ) VALUES (
        'mapping_watch_scale_001_v2', 'hh_demo',
        'position_watch_scale_001', 'exposure_watch_scale_001',
        'look_through', NULL, 'withdrawn', 'review',
        'Synthetic exposure removed after review', printf('%064x', 9001),
        '2026-08-29T13:00:00.000Z', 2, 'mapping_watch_scale_001',
        'usr_demo', '2026-08-29T13:00:00.000Z', 1
      );
    `);

    expect(
      database
        .prepare(
          `SELECT status FROM portfolio_watch_targets
           WHERE id = ?`,
        )
        .get(targetId),
    ).toEqual({ status: "paused" });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM portfolio_watch_sources
           WHERE watch_target_id = ?`,
        )
        .get(targetId),
    ).toEqual({ count: 1 });

    const hidden = await new D1AlphaRepository(
      new TestD1Database(database) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(hidden.portfolioWatch.targets).toEqual([]);

    database.exec(`
      INSERT INTO holding_positions (
        id, household_id, provider, position_fingerprint, legal_vehicle_name,
        owner_label, position_kind, instrument_type, opened_on, currency,
        created_by, created_at
      ) VALUES (
        'position_watch_scale_returned', 'hh_demo', 'angellist',
        printf('%064x', 9991), 'Synthetic returned SPV', 'Synthetic owner',
        'spv_interest', 'private_equity', '2026-02-01', 'USD', 'usr_demo',
        '2026-08-29T14:00:00.000Z'
      );
      INSERT INTO holding_position_ownerships (
        id, household_id, container_id, position_id, protected_position_key,
        association_basis, evidence_sha256, version,
        supersedes_ownership_id, accepted_by_user_id, accepted_at, immutable
      ) VALUES (
        'ownership_watch_scale_returned', 'hh_demo', 'watch_scale_container',
        'position_watch_scale_returned', printf('%064x', 9991),
        'reviewed_import', printf('%064x', 9992), 1, NULL, 'usr_demo',
        '2026-08-29T14:00:00.000Z', 1
      );
      INSERT INTO holding_position_exposure_mappings (
        id, household_id, position_id, exposure_id, relationship_kind,
        allocation_ppm, status, decision_source, decision_reference,
        evidence_sha256, effective_at, version, supersedes_mapping_id,
        accepted_by_user_id, accepted_at, immutable
      ) VALUES (
        'mapping_watch_scale_returned', 'hh_demo',
        'position_watch_scale_returned', 'exposure_watch_scale_001',
        'look_through', 1000000, 'active', 'review',
        'Synthetic returned private-company exposure', printf('%064x', 9992),
        '2026-08-29T14:00:00.000Z', 1, NULL, 'usr_demo',
        '2026-08-29T14:00:00.000Z', 1
      );
    `);

    expect(
      database
        .prepare(
          `SELECT id, status FROM portfolio_watch_targets
           WHERE company_id = 'co_watch_scale_001'`,
        )
        .get(),
    ).toEqual({ id: targetId, status: "active" });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM portfolio_watch_targets
           WHERE company_id = 'co_watch_scale_001'`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("keeps a current exposure visible when no reviewed website host exists", async () => {
    database = createTestDatabase();
    seedPrivateExposureUniverse(database, 1, { withWebsiteHosts: false });

    expect(
      database
        .prepare(
          `SELECT status FROM portfolio_watch_targets
           WHERE company_id = 'co_watch_scale_001'`,
        )
        .get(),
    ).toEqual({ status: "active" });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM portfolio_watch_sources
           WHERE watch_target_id =
             'watch-current-exposure-v1:co_watch_scale_001'`,
        )
        .get(),
    ).toEqual({ count: 0 });

    const alphaData = await new D1AlphaRepository(
      new TestD1Database(database) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(alphaData.portfolioWatch.targets).toContainEqual({
      id: "watch-current-exposure-v1:co_watch_scale_001",
      companyId: "co_watch_scale_001",
      companyName: "Synthetic Watch Company 001",
      officialHost: null,
      status: "active",
      coverageStatus: "unavailable",
      lastCheckedAt: null,
      latestObservationAt: null,
    });
  });

  it("reads more than 120 derived targets in one indexed D1 round trip", async () => {
    database = createTestDatabase();
    seedPrivateExposureUniverse(database, 125);
    const d1 = new TestD1Database(database);

    d1.resetRoundTripCount();
    const targets = await d1
      .prepare(__alphaRepositoryTest.portfolioWatchTargetsSql)
      .bind("hh_demo")
      .all<{ id: string; status: "active" }>();

    expect(targets.results).toHaveLength(125);
    expect(new Set(targets.results.map((target) => target.id)).size).toBe(125);
    expect(targets.results.every((target) => target.status === "active")).toBe(
      true,
    );
    expect(d1.roundTripCount).toBe(1);
    expect(
      database
        .prepare(
          `SELECT
             COUNT(DISTINCT source.id) AS source_count,
             COUNT(DISTINCT sync.source_id) AS sync_count
           FROM portfolio_watch_sources source
           JOIN portfolio_watch_source_sync_state sync
             ON sync.source_id = source.id
           WHERE source.watch_target_id LIKE 'watch-current-exposure-v1:%'`,
        )
        .get(),
    ).toEqual({ source_count: 125, sync_count: 125 });

    const queryPlan = database
      .prepare(
        `EXPLAIN QUERY PLAN ${__alphaRepositoryTest.portfolioWatchTargetsSql}`,
      )
      .all("hh_demo") as { detail: string }[];
    const details = queryPlan.map((row) => row.detail).join("\n");
    expect(details).toContain("portfolio_watch_targets_page_idx");
    expect(details).toContain("portfolio_watch_sources_target_status_idx");
    expect(details).toContain("public_source_observations_company_idx");
    expect(details).not.toMatch(/SCAN (source|observation)/u);
  });
});

describe("reviewed Watch websites", () => {
  it("keeps the source limit atomic when a company already has a full source list", async () => {
    database = createTestDatabase();
    seedPrivateExposureUniverse(database, 125, { withWebsiteHosts: false });
    const target = database
      .prepare(
        "SELECT id FROM portfolio_watch_targets WHERE company_id = 'co_watch_scale_001'",
      )
      .get() as { id: string };
    database
      .prepare(
        `WITH RECURSIVE pages(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM pages WHERE n < 50)
         INSERT INTO portfolio_watch_sources (
           id, household_id, watch_target_id, company_id, source_kind, source_class,
           canonical_url, allowed_origin, allowed_path_prefix, status, authority_ppm,
           identity_confidence_ppm, operational_health_ppm, coverage_json, created_at, updated_at
         ) SELECT 'website-limit-' || n, 'hh_demo', ?, 'co_watch_scale_001',
           'official_company_web', 'official_company', 'https://watch-scale-001.example/news/' || n,
           'https://watch-scale-001.example', '/', 'discovered', 1000000, 1000000, 0, '{}',
           '2026-09-16T13:00:00.000Z', '2026-09-16T13:00:00.000Z' FROM pages`,
      )
      .run(target.id);
    const repository = new D1WatchWebsiteRepository(
      new TestD1Database(database) as unknown as D1Database,
    );
    await expect(
      repository.confirm("synthetic-access-subject", target.id, {
        decisionId: crypto.randomUUID(),
        companyName: "Synthetic Watch Company 001",
        websiteUrl: "https://watch-scale-001.example/",
        rationale:
          "The official website identifies Synthetic Watch Company 001.",
      }),
    ).rejects.toThrow("Watch source limit reached");
    expect(
      database
        .prepare(
          "SELECT website_host FROM companies WHERE id = 'co_watch_scale_001'",
        )
        .get(),
    ).toEqual({ website_host: null });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM portfolio_watch_website_decisions",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM portfolio_watch_sources WHERE watch_target_id = ?",
        )
        .get(target.id),
    ).toEqual({ count: 50 });
  });

  it("records an identity decision before scheduling verification and rejects stale or unrelated writes", async () => {
    database = createTestDatabase();
    seedPrivateExposureUniverse(database, 125, { withWebsiteHosts: false });
    const measured = new TestD1Database(database);
    const repository = new D1WatchWebsiteRepository(
      measured as unknown as D1Database,
    );
    const target = database
      .prepare(
        "SELECT id FROM portfolio_watch_targets WHERE company_id = 'co_watch_scale_001'",
      )
      .get() as { id: string };
    expect(target).toBeDefined();
    const input = {
      decisionId: crypto.randomUUID(),
      companyName: "Synthetic Watch Company 001",
      websiteUrl: "https://watch-scale-001.example/",
      rationale: "The official website identifies Synthetic Watch Company 001.",
    };
    const receipt = await repository.confirm(
      "synthetic-access-subject",
      target.id,
      input,
      "2026-09-16T13:00:00.000Z",
    );
    expect(receipt.officialHost).toBe("watch-scale-001.example");
    expect(measured.roundTripCount).toBe(3);
    expect(
      await repository.confirm("synthetic-access-subject", target.id, input),
    ).toEqual(receipt);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM portfolio_watch_website_decisions",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          "SELECT status, operational_health_ppm FROM portfolio_watch_sources WHERE watch_target_id = ?",
        )
        .get(target.id),
    ).toEqual({ status: "discovered", operational_health_ppm: 0 });
    expect(
      database
        .prepare(
          "SELECT last_completed_success_at FROM portfolio_watch_source_sync_state WHERE source_id IN (SELECT id FROM portfolio_watch_sources WHERE watch_target_id = ?)",
        )
        .get(target.id),
    ).toEqual({ last_completed_success_at: null });
    await expect(
      repository.confirm("synthetic-access-subject", target.id, {
        ...input,
        decisionId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("watch_website_changed");
    await expect(
      repository.confirm("unrelated-user", target.id, input),
    ).rejects.toThrow("watch_target_not_found");
    await expect(
      repository.confirm("synthetic-access-subject", target.id, {
        ...input,
        websiteUrl: "https://127.0.0.1/",
      }),
    ).rejects.toThrow("not eligible");
    expect(() =>
      database!.exec(
        "UPDATE portfolio_watch_website_decisions SET rationale = 'changed'",
      ),
    ).toThrow("append-only");
    expect(() =>
      database!.exec("DELETE FROM portfolio_watch_website_decisions"),
    ).toThrow("append-only");
  });
});

describe("Portfolio Watch scheduling", () => {
  it("keeps a company with more than 120 pages within its two-check budget", async () => {
    database = createTestDatabase();
    const insertSource = database.prepare(
      `INSERT INTO portfolio_watch_sources (
         id, household_id, watch_target_id, company_id, source_kind,
         source_class, canonical_url, allowed_origin, allowed_path_prefix,
         status, authority_ppm, identity_confidence_ppm,
         operational_health_ppm, coverage_json, auto_activated_at,
         created_at, updated_at
       ) VALUES (?, 'hh_demo', 'watch_northstar', 'co_northstar',
         'official_company_web', 'official_company', ?, ?, '/', ?, 1000000,
         1000000, 1000000, '{}', ?, '2026-08-01T00:00:00Z',
         '2026-08-01T00:00:00Z')`,
    );
    const insertSync = database.prepare(
      `INSERT INTO portfolio_watch_source_sync_state (
         source_id, next_check_at, consecutive_failure_count, updated_at
       ) VALUES (?, '2026-08-01T00:00:00Z', 0, '2026-08-01T00:00:00Z')`,
    );
    database.exec("BEGIN");
    for (let index = 1; index <= 130; index += 1) {
      const suffix = index.toString().padStart(3, "0");
      const sourceId = `source_scale_${suffix}`;
      const origin = `https://synthetic-${suffix}.example`;
      const status = index % 2 === 0 ? "active" : "degraded";
      insertSource.run(
        sourceId,
        `${origin}/news`,
        origin,
        status,
        status === "active" ? "2026-08-01T00:00:00Z" : null,
      );
      insertSync.run(sourceId);
    }
    database.exec("COMMIT");

    const repository = new D1PortfolioWatchRepository(
      new TestD1Database(database) as unknown as D1Database,
    );
    const firstBatch = await repository.listDueSourceJobs(
      "2026-08-28T13:00:00Z",
      100,
    );
    expect(firstBatch).toHaveLength(2);
    expect(new Set(firstBatch.map((job) => job.sourceId)).size).toBe(2);
    expect(firstBatch).toContainEqual({
      type: "portfolio_watch_source_verify",
      sourceId: "source_scale_001",
    });
    expect(firstBatch).toContainEqual({
      type: "portfolio_watch_source_scan",
      sourceId: "source_scale_002",
    });

    const queryPlan = database
      .prepare(`EXPLAIN QUERY PLAN ${__portfolioWatchTest.dueSourceJobsSql}`)
      .all("2026-08-28T13:00:00Z", 100) as { detail: string }[];
    const details = queryPlan.map((row) => row.detail).join("\n");
    expect(details).toContain("portfolio_watch_source_sync_due_idx");
  });

  it("checks healthy sources weekly and keeps failed sources retryable", async () => {
    database = createTestDatabase();
    const repository = new D1PortfolioWatchRepository(
      new TestD1Database(database) as unknown as D1Database,
    );
    const common = {
      sourceId: "source_financing_test",
      observedUrl: "https://northstar-robotics.example/news",
      normalizedUrl: "https://northstar-robotics.example/news",
      httpStatus: 200,
      contentType: "text/html",
      redirectUrl: null,
      securityPassed: true,
      grade: {
        authorityPpm: 1_000_000,
        identityPpm: 1_000_000,
        securityPpm: 1_000_000,
        operationalPpm: 1_000_000,
      },
      contentSha256: "a".repeat(64),
      etag: null,
      lastModified: null,
    } as const;

    await repository.recordVerification({
      ...common,
      nextStatus: "active",
      reasonCode: "all_hard_gates_passed",
      checkedAt: "2026-08-07T12:00:00Z",
      errorCode: null,
    });
    expect(
      database
        .prepare(
          `SELECT next_check_at FROM portfolio_watch_source_sync_state
           WHERE source_id = 'source_financing_test'`,
        )
        .get(),
    ).toEqual({ next_check_at: "2026-08-14T12:00:00.000Z" });

    await repository.recordVerification({
      ...common,
      nextStatus: "degraded",
      reasonCode: "fetch_failed",
      checkedAt: "2026-08-08T12:00:00Z",
      grade: { ...common.grade, operationalPpm: 0 },
      contentSha256: null,
      errorCode: "fetch_failed",
    });
    expect(
      database
        .prepare(
          `SELECT next_check_at, consecutive_failure_count
           FROM portfolio_watch_source_sync_state
           WHERE source_id = 'source_financing_test'`,
        )
        .get(),
    ).toEqual({
      next_check_at: "2026-08-08T13:00:00.000Z",
      consecutive_failure_count: 1,
    });
  });
});

describe("Portfolio Watch financing fact persistence", () => {
  it("round-trips typed facts through evidence JSON without applying financial changes", async () => {
    database = createTestDatabase();
    const d1 = new TestD1Database(database);
    const watchRepository = new D1PortfolioWatchRepository(
      d1 as unknown as D1Database,
    );
    const lotsBefore = tableSnapshot(database, "asset_lots");
    const marksBefore = tableSnapshot(database, "marks");
    const forecastsBefore = tableSnapshot(database, "forecast_snapshots");
    const applicationsBefore = tableSnapshot(database, "evidence_applications");

    const financingFacts = {
      roundType: "series" as const,
      roundLabel: "Series C",
      instrument: "mixed" as const,
      announcedAmount: {
        amountMinor: 125_000_000_00,
        currency: "USD",
        qualifier: "exact" as const,
        evidenceText: "The company announced US$125 million in new funding.",
      },
      companyValuation: {
        amountMinor: 1_250_000_000_00,
        currency: "USD",
        qualifier: "approximately" as const,
        evidenceText: "The round values the company at about US$1.25 billion.",
        basis: "post_money" as const,
      },
      ambiguities: ["combined_tranches" as const],
    };
    const recorded = await watchRepository.recordObservation({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/document-sha",
      contentType: "text/html",
      byteSize: 4_096,
      sha256: "a".repeat(64),
      retrievedAt: "2026-08-07T12:00:00Z",
      sourceUrl: "https://northstar-robotics.example/news/series-c",
      sourceTitle: "Northstar Robotics announces Series C",
      publishedAt: "2026-08-07T10:00:00Z",
      eventType: "financing_announced",
      observedFact:
        "Northstar Robotics announced a Series C financing. The company announced US$125 million in new funding. The round values the company at about US$1.25 billion.",
      modelConfidencePpm: 940_000,
      financingFacts,
      fingerprint: "b".repeat(64),
    });

    expect(recorded).toBe(true);
    const claim = database
      .prepare(
        `SELECT claim.field_path, claim.claim_value_json
         FROM evidence_claims claim
         JOIN evidence_events event ON event.id = claim.evidence_event_id
         WHERE event.headline = ?`,
      )
      .get("Northstar Robotics announces Series C") as {
      field_path: string;
      claim_value_json: string;
    };
    expect(claim.field_path).toBe("company_event.financing_terms");
    expect(JSON.parse(claim.claim_value_json)).toMatchObject({
      financingFacts,
    });

    const storedObservation = database
      .prepare(
        `SELECT valuation_low_minor, valuation_middle_minor,
                valuation_high_minor
         FROM public_source_observations WHERE fingerprint = ?`,
      )
      .get("b".repeat(64));
    expect(storedObservation).toEqual({
      valuation_low_minor: null,
      valuation_middle_minor: null,
      valuation_high_minor: null,
    });

    const alphaRepository = new D1AlphaRepository(d1 as unknown as D1Database);
    const alphaData = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const inboxItem = alphaData.evidenceInbox.find(
      (item) => item.headline === "Northstar Robotics announces Series C",
    );
    const observation = alphaData.portfolioWatch.observations.find(
      (item) => item.sourceTitle === "Northstar Robotics announces Series C",
    );
    expect(inboxItem).toMatchObject({
      status: "pending_review",
      confidencePpm: 1_000_000,
      modelConfidencePpm: 940_000,
      sourceUrl: "https://northstar-robotics.example/news/series-c",
      sourceExcerpt: "The company announced US$125 million in new funding.",
      forecastImpactMinor: 0,
      financingFacts,
      application: null,
    });
    expect(observation).toMatchObject({
      financingFacts,
      valuationLowMinor: null,
      valuationMiddleMinor: null,
      valuationHighMinor: null,
    });
    if (inboxItem === undefined) {
      throw new Error("Expected the financing evidence inbox item.");
    }
    await expect(
      alphaRepository.applyEvidence("synthetic-access-subject", inboxItem.id),
    ).rejects.toThrow("no deterministic direct application");
    expect(
      alphaData.evidenceInbox.find((item) => item.id === "evt_northstar_round"),
    ).toMatchObject({
      financingFacts: null,
      sourceUrl: null,
      sourceExcerpt: null,
    });

    expect(tableSnapshot(database, "asset_lots")).toBe(lotsBefore);
    expect(tableSnapshot(database, "marks")).toBe(marksBefore);
    expect(tableSnapshot(database, "forecast_snapshots")).toBe(forecastsBefore);
    expect(tableSnapshot(database, "evidence_applications")).toBe(
      applicationsBefore,
    );
  });

  it("creates an append-only proposal against exact signal and scenario versions", async () => {
    database = createTestDatabase();
    const d1 = new TestD1Database(database);
    const watchRepository = new D1PortfolioWatchRepository(
      d1 as unknown as D1Database,
    );
    const alphaRepository = new D1AlphaRepository(d1 as unknown as D1Database);
    const valuationEvidence =
      "The Series C values Northstar Robotics at USD 1 billion post-money.";
    const financingFacts = {
      roundType: "series" as const,
      roundLabel: "Series C",
      instrument: "equity" as const,
      announcedAmount: null,
      companyValuation: {
        amountMinor: 100_000_000_000,
        currency: "USD",
        qualifier: "exact" as const,
        evidenceText: valuationEvidence,
        basis: "post_money" as const,
      },
      ambiguities: [],
    };

    for (const [suffix, publishedAt] of [
      ["company", "2026-08-07T10:00:00Z"],
      ["filing", "2026-08-07T11:00:00Z"],
    ] as const) {
      await watchRepository.recordObservation({
        sourceId: "source_financing_test",
        objectKey: `public-watch/source_financing_test/${suffix}`,
        contentType: "text/html",
        byteSize: 2_048,
        sha256: suffix === "company" ? "e".repeat(64) : "f".repeat(64),
        retrievedAt: publishedAt,
        sourceUrl: `https://northstar-robotics.example/news/series-c-${suffix}`,
        sourceTitle: `Northstar Robotics Series C ${suffix} report`,
        publishedAt,
        eventType: "financing_announced",
        observedFact: valuationEvidence,
        modelConfidencePpm: 940_000,
        financingFacts,
        fingerprint: suffix === "company" ? "1".repeat(64) : "2".repeat(64),
      });
    }

    const pendingAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const pendingGroup = pendingAlpha.signalReconciliations.find(
      (group) => group.id === "co_northstar:series-c",
    );
    expect(pendingGroup).toMatchObject({
      status: "corroborated",
      pendingReviewCount: 2,
      canCreateProposal: false,
    });
    if (pendingGroup === undefined) {
      throw new Error("Expected the synthetic Series C reconciliation.");
    }

    for (const eventId of pendingGroup.recommendedReviewEventIds) {
      await alphaRepository.reviewEvidence(
        "synthetic-access-subject",
        eventId,
        {
          decision: "scenario_only",
          rationale: "Use as reviewed synthetic scenario context.",
        },
      );
    }

    const reviewedAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const reviewedGroup = reviewedAlpha.signalReconciliations.find(
      (group) => group.id === pendingGroup.id,
    );
    const sandbox = reviewedAlpha.scenarios.find(
      (scenario) => scenario.id === "scn_sandbox",
    );
    expect(reviewedGroup).toMatchObject({
      pendingReviewCount: 0,
      canCreateProposal: true,
      proposedCompanyValuation: { amountMinor: 100_000_000_000 },
    });
    if (
      reviewedGroup === undefined ||
      sandbox === undefined ||
      sandbox.latestSnapshotId === null ||
      sandbox.latestSnapshotVersion === null
    ) {
      throw new Error("Expected a proposal-ready group and scenario version.");
    }

    const marksBefore = tableSnapshot(database, "marks");
    const snapshotsBefore = tableSnapshot(database, "forecast_snapshots");
    const proposal = await alphaRepository.createSignalUpdateProposal(
      "synthetic-access-subject",
      {
        groupId: reviewedGroup.id,
        reconciliationRevision: reviewedGroup.revision,
        scenarioId: sandbox.id,
        baseForecastSnapshotId: sandbox.latestSnapshotId,
        rationale: "Model the reviewed company valuation separately.",
      },
    );

    expect(proposal).toMatchObject({
      groupId: reviewedGroup.id,
      scenarioId: "scn_sandbox",
      baseForecastSnapshotVersion: sandbox.latestSnapshotVersion,
      proposedCompanyValuation: { amountMinor: 100_000_000_000 },
      isCurrent: true,
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM signal_update_proposal_evidence WHERE proposal_id = ?",
        )
        .get(proposal.id),
    ).toEqual({ count: 2 });
    expect(tableSnapshot(database, "marks")).toBe(marksBefore);
    expect(tableSnapshot(database, "forecast_snapshots")).toBe(snapshotsBefore);

    await watchRepository.recordObservation({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/company-follow-up",
      contentType: "text/html",
      byteSize: 2_048,
      sha256: "9".repeat(64),
      retrievedAt: "2026-08-07T12:00:00Z",
      sourceUrl: "https://northstar-robotics.example/news/series-c-follow-up",
      sourceTitle: "Northstar Robotics Series C follow-up",
      publishedAt: "2026-08-07T12:00:00Z",
      eventType: "financing_announced",
      observedFact: valuationEvidence,
      modelConfidencePpm: 940_000,
      financingFacts,
      fingerprint: "3".repeat(64),
    });
    const changedSignalAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const changedSignalGroup = changedSignalAlpha.signalReconciliations.find(
      (group) => group.id === reviewedGroup.id,
    );
    expect(changedSignalGroup).toMatchObject({
      pendingReviewCount: 1,
      canCreateProposal: false,
    });
    expect(
      changedSignalAlpha.signalUpdateProposals.find(
        (candidate) => candidate.id === proposal.id,
      ),
    ).toMatchObject({ isCurrent: false });
    await expect(
      alphaRepository.createSignalUpdateProposal("synthetic-access-subject", {
        groupId: reviewedGroup.id,
        reconciliationRevision: reviewedGroup.revision,
        scenarioId: sandbox.id,
        baseForecastSnapshotId: sandbox.latestSnapshotId,
        rationale: "This stale signal request must not create a proposal.",
      }),
    ).rejects.toThrow("Signal reconciliation is stale");
    if (changedSignalGroup === undefined) {
      throw new Error("Expected the changed synthetic reconciliation.");
    }
    for (const eventId of changedSignalGroup.recommendedReviewEventIds) {
      await alphaRepository.reviewEvidence(
        "synthetic-access-subject",
        eventId,
        {
          decision: "scenario_only",
          rationale: "Review the synthetic follow-up report.",
        },
      );
    }
    const refreshedSignalAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const refreshedSignalGroup =
      refreshedSignalAlpha.signalReconciliations.find(
        (group) => group.id === reviewedGroup.id,
      );
    expect(refreshedSignalGroup).toMatchObject({
      pendingReviewCount: 0,
      canCreateProposal: true,
    });
    if (refreshedSignalGroup === undefined) {
      throw new Error("Expected the reviewed synthetic reconciliation.");
    }

    await alphaRepository.saveScenario("synthetic-access-subject", {
      scenarioId: sandbox.id,
      assumptions: sandbox.assumptions.map((assumption) => ({
        id: assumption.id,
        key: assumption.key,
        value: assumption.value,
      })),
      changeNote: "Advance the synthetic sandbox version.",
    });
    const advancedAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    expect(
      advancedAlpha.signalUpdateProposals.find(
        (candidate) => candidate.id === proposal.id,
      ),
    ).toMatchObject({ isCurrent: false });
    await expect(
      alphaRepository.createSignalUpdateProposal("synthetic-access-subject", {
        groupId: refreshedSignalGroup.id,
        reconciliationRevision: refreshedSignalGroup.revision,
        scenarioId: sandbox.id,
        baseForecastSnapshotId: sandbox.latestSnapshotId,
        rationale: "This stale request must not create another proposal.",
      }),
    ).rejects.toThrow("base scenario is stale");
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM signal_update_proposals")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("rejects financing facts on a non-financing event", () => {
    expect(() =>
      PortfolioWatchObservationInputSchema.parse({
        sourceId: "source_financing_test",
        objectKey: "public-watch/source_financing_test/document-sha",
        contentType: "text/html",
        byteSize: 4_096,
        sha256: "a".repeat(64),
        retrievedAt: "2026-08-07T12:00:00Z",
        sourceUrl: "https://northstar-robotics.example/news/update",
        sourceTitle: "Northstar Robotics update",
        publishedAt: "2026-08-07T10:00:00Z",
        eventType: "company_update",
        observedFact: "Northstar Robotics shared an update.",
        modelConfidencePpm: 940_000,
        financingFacts: {
          roundType: null,
          roundLabel: null,
          instrument: "equity",
          announcedAmount: null,
          companyValuation: null,
          ambiguities: [],
        },
        fingerprint: "b".repeat(64),
      }),
    ).toThrow("Only financing announcements");
  });

  it("rejects financing evidence excerpts unrelated to the retained observation", () => {
    expect(() =>
      PortfolioWatchObservationInputSchema.parse({
        sourceId: "source_financing_test",
        objectKey: "public-watch/source_financing_test/document-sha",
        contentType: "text/html",
        byteSize: 4_096,
        sha256: "a".repeat(64),
        retrievedAt: "2026-08-07T12:00:00Z",
        sourceUrl: "https://northstar-robotics.example/news/series-b",
        sourceTitle: "Northstar Robotics announces Series B",
        publishedAt: "2026-08-07T10:00:00Z",
        eventType: "financing_announced",
        observedFact:
          "Northstar Robotics announced a Series B financing with terms to be reviewed.",
        modelConfidencePpm: 940_000,
        financingFacts: {
          roundType: "series",
          roundLabel: "Series B",
          instrument: "equity",
          announcedAmount: {
            amountMinor: 125_000_000_00,
            currency: "USD",
            qualifier: "exact",
            evidenceText: "An unrelated company raised US$125 million.",
          },
          companyValuation: null,
          ambiguities: [],
        },
        fingerprint: "b".repeat(64),
      }),
    ).toThrow(
      "Financing evidence text must appear in the retained source title or observed fact.",
    );
  });

  it("accepts a title-only amount using the parser's title punctuation", () => {
    const result = PortfolioWatchObservationInputSchema.safeParse({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/title-only-sha",
      contentType: "text/html",
      byteSize: 2_048,
      sha256: "c".repeat(64),
      retrievedAt: "2026-08-07T12:00:00Z",
      sourceUrl: "https://northstar-robotics.example/news/series-b",
      sourceTitle: "Northstar Robotics raises US$125 million",
      publishedAt: "2026-08-07T10:00:00Z",
      eventType: "financing_announced",
      observedFact: "The financing will support product development.",
      modelConfidencePpm: 940_000,
      financingFacts: {
        roundType: "series",
        roundLabel: "Series B",
        instrument: "equity",
        announcedAmount: {
          amountMinor: 125_000_000_00,
          currency: "USD",
          qualifier: "exact",
          evidenceText: "Northstar Robotics raises US$125 million.",
        },
        companyValuation: null,
        ambiguities: [],
      },
      fingerprint: "d".repeat(64),
    });

    expect(result.success).toBe(true);
  });

  it("hydrates valuation and bounded observation excerpt fallbacks", async () => {
    database = createTestDatabase();
    const d1 = new TestD1Database(database);
    const watchRepository = new D1PortfolioWatchRepository(
      d1 as unknown as D1Database,
    );
    const valuationEvidence =
      "The financing values Northstar Robotics at about US$900 million post-money.";
    const fallbackObservedFact =
      "Synthetic financing update adds operating runway and product investment while management continues hiring across engineering sales support finance legal security research design partnerships and customer success teams worldwide.";

    await watchRepository.recordObservation({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/valuation-sha",
      contentType: "text/html",
      byteSize: 2_048,
      sha256: "c".repeat(64),
      retrievedAt: "2026-08-07T12:01:00Z",
      sourceUrl: "https://northstar-robotics.example/news/growth-valuation",
      sourceTitle: "Northstar Robotics announces growth financing",
      publishedAt: "2026-08-07T10:01:00Z",
      eventType: "financing_announced",
      observedFact: valuationEvidence,
      modelConfidencePpm: 930_000,
      financingFacts: {
        roundType: "growth",
        roundLabel: "Growth financing",
        instrument: "equity",
        announcedAmount: null,
        companyValuation: {
          amountMinor: 900_000_000_00,
          currency: "USD",
          qualifier: "approximately",
          evidenceText: valuationEvidence,
          basis: "post_money",
        },
        ambiguities: [],
      },
      fingerprint: "c".repeat(64),
    });
    await watchRepository.recordObservation({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/fallback-sha",
      contentType: "text/html",
      byteSize: 2_048,
      sha256: "d".repeat(64),
      retrievedAt: "2026-08-07T12:02:00Z",
      sourceUrl: "https://northstar-robotics.example/news/strategic-round",
      sourceTitle: "Northstar Robotics announces strategic financing",
      publishedAt: "2026-08-07T10:02:00Z",
      eventType: "financing_announced",
      observedFact: fallbackObservedFact,
      modelConfidencePpm: 920_000,
      financingFacts: {
        roundType: "strategic",
        roundLabel: "Strategic financing",
        instrument: "equity",
        announcedAmount: null,
        companyValuation: null,
        ambiguities: [],
      },
      fingerprint: "d".repeat(64),
    });

    const alphaData = await new D1AlphaRepository(
      d1 as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(
      alphaData.evidenceInbox.find(
        (item) =>
          item.headline === "Northstar Robotics announces growth financing",
      ),
    ).toMatchObject({
      sourceUrl: "https://northstar-robotics.example/news/growth-valuation",
      sourceExcerpt: valuationEvidence,
    });
    const fallbackItem = alphaData.evidenceInbox.find(
      (item) =>
        item.headline === "Northstar Robotics announces strategic financing",
    );
    expect(fallbackItem).toMatchObject({
      sourceUrl: "https://northstar-robotics.example/news/strategic-round",
      sourceExcerpt: fallbackObservedFact.split(/\s+/u).slice(0, 25).join(" "),
    });
    expect(fallbackItem?.sourceExcerpt?.split(/\s+/u)).toHaveLength(25);
    expect(fallbackItem?.sourceExcerpt?.length).toBeLessThanOrEqual(240);
  });

  it("does not hydrate mismatched legacy observation or claim provenance", async () => {
    database = createTestDatabase();
    database.exec(`
      INSERT INTO users (id, access_subject, email, display_name, created_at)
      VALUES ('user_other', 'other-subject', 'other@example.invalid', 'Other Demo', '2026-08-07T12:00:00Z');
      INSERT INTO households (id, owner_user_id, name, base_currency, created_at)
      VALUES ('hh_other', 'user_other', 'Other Demo', 'USD', '2026-08-07T12:00:00Z');
    `);
    database
      .prepare(
        `INSERT INTO evidence_claims (
           id, household_id, evidence_event_id, field_path, claim_value_json,
           unit, provenance, created_at
         ) VALUES (?, 'hh_other', 'evt_northstar_round',
           'company_event.financing_terms', ?, NULL, ?, ?)`,
      )
      .run(
        "claim_other_household",
        JSON.stringify({
          title: "Mismatched synthetic financing",
          publishedAt: "2026-08-07T10:00:00Z",
          sourceUrl: "https://northstar-robotics.example/news/mismatch",
          financingFacts: {
            roundType: "series",
            roundLabel: "Series C",
            instrument: "equity",
            announcedAmount: {
              amountMinor: 12_500_000_000,
              currency: "USD",
              qualifier: "exact",
              evidenceText: "Northstar Robotics raised US$125 million.",
            },
            companyValuation: null,
            ambiguities: [],
          },
        }),
        "Mismatched synthetic source",
        "2026-08-07T12:00:00Z",
      );
    database.exec(`
      INSERT INTO public_source_observations (
        id, household_id, company_id, evidence_event_id, source_document_id,
        source_class, source_url, source_title, published_at, retrieved_at,
        observed_fact, inference, source_reliability_ppm,
        model_confidence_ppm, valuation_low_minor, valuation_middle_minor,
        valuation_high_minor, limitations, fingerprint, created_at
      ) VALUES (
        'obs_other_household', 'hh_other', 'co_northstar',
        'evt_northstar_round', 'doc_northstar_update', 'official_company',
        'https://northstar-robotics.example/news/mismatch',
        'Mismatched synthetic financing', '2026-08-07T10:00:00Z',
        '2026-08-07T12:00:00Z',
        'Northstar Robotics raised US$125 million.',
        'Mismatched legacy observation.', 900000, 800000,
        NULL, NULL, NULL, 'Mismatched tenant provenance.',
        'legacy-mismatched-fingerprint', '2026-08-07T12:00:00Z'
      );
    `);

    const alphaData = await new D1AlphaRepository(
      new TestD1Database(database) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(
      alphaData.evidenceInbox.find((item) => item.id === "evt_northstar_round"),
    ).toMatchObject({
      financingFacts: null,
      sourceUrl: null,
      sourceExcerpt: null,
    });
  });

  it.each([
    {
      description: "after an earlier direct-value claim",
      financingCreatedAt: "2026-07-18T12:11:00-07:00",
    },
    {
      description: "before a later direct-value claim",
      financingCreatedAt: "2026-07-18T12:09:00-07:00",
    },
  ])(
    "refuses direct application when financing terms are recorded $description",
    async ({ financingCreatedAt }) => {
      database = createTestDatabase();
      database.exec(`
        INSERT INTO evidence_claims (
          id, household_id, evidence_event_id, field_path, claim_value_json,
          unit, provenance, created_at
        ) VALUES (
          'claim_ns_financing_integrity', 'hh_demo', 'evt_northstar_round',
          'company_event.financing_terms',
          '{"financingFacts":{"roundType":"series","roundLabel":"Series B","instrument":"equity","announcedAmount":null,"companyValuation":null,"ambiguities":[]}}',
          NULL, 'Synthetic financing terms', '${financingCreatedAt}'
        );
      `);
      const d1 = new TestD1Database(database);
      const alphaRepository = new D1AlphaRepository(
        d1 as unknown as D1Database,
      );
      const marksBefore = tableSnapshot(database, "marks");
      const decisionsBefore = tableSnapshot(database, "review_decisions");
      const applicationsBefore = tableSnapshot(
        database,
        "evidence_applications",
      );
      const alphaData = await alphaRepository.getAlphaData(
        "synthetic-access-subject",
      );
      expect(
        alphaData.evidenceInbox.find(
          (item) => item.id === "evt_northstar_round",
        ),
      ).toMatchObject({
        application: null,
        sourceUrl: null,
        sourceExcerpt: null,
      });

      await expect(
        alphaRepository.applyEvidence(
          "synthetic-access-subject",
          "evt_northstar_round",
        ),
      ).rejects.toThrow("no deterministic direct application");

      expect(tableSnapshot(database, "marks")).toBe(marksBefore);
      expect(tableSnapshot(database, "review_decisions")).toBe(decisionsBefore);
      expect(tableSnapshot(database, "evidence_applications")).toBe(
        applicationsBefore,
      );
    },
  );
});
