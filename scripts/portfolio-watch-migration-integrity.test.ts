import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationFiles = [
  "packages/database/migrations/0001_keel_core.sql",
  "packages/database/migrations/0002_versioned_goals.sql",
  "packages/database/migrations/0003_evidence_applications.sql",
  "packages/database/migrations/0004_portfolio_watch.sql",
  "packages/database/migrations/0005_portfolio_watch_sources.sql",
  "packages/database/seed/synthetic.sql",
] as const;

const validSourceSql = `
  INSERT INTO portfolio_watch_sources (
    id, household_id, watch_target_id, company_id, source_kind, source_class,
    canonical_url, allowed_origin, allowed_path_prefix, status, authority_ppm,
    identity_confidence_ppm, operational_health_ppm, coverage_json,
    auto_activated_at, created_at, updated_at
  ) VALUES (
    'src_valid', 'hh_demo', 'watch_northstar', 'co_northstar',
    'official_company_web', 'official_company',
    'https://northstar-robotics.example/',
    'https://northstar-robotics.example', '/', 'active',
    1000000, 1000000, 1000000, '{}',
    '2026-08-07T00:00:00Z', '2026-08-07T00:00:00Z', '2026-08-07T00:00:00Z'
  );
`;

function observationSql(sourceDocumentId: string): string {
  return `
    INSERT INTO public_source_observations (
      id, household_id, company_id, evidence_event_id, source_document_id,
      source_class, source_url, source_title, published_at, retrieved_at,
      observed_fact, inference, source_reliability_ppm, model_confidence_ppm,
      valuation_low_minor, valuation_middle_minor, valuation_high_minor,
      limitations, fingerprint, created_at, source_id
    ) VALUES (
      'obs_test', 'hh_demo', 'co_northstar', 'evt_northstar_round',
      '${sourceDocumentId}', 'official_company',
      'https://northstar-robotics.example/news', 'Test source',
      '2026-08-07T00:00:00Z', '2026-08-07T00:00:00Z', 'Test fact',
      'Test inference', 1000000, 1000000, NULL, NULL, NULL, 'Test limit',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '2026-08-07T00:00:00Z', 'src_valid'
    );
  `;
}

function createMigratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of migrationFiles) {
    database.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
  }
  database.exec(validSourceSql);
  return database;
}

describe("Portfolio Watch source observation migration integrity", () => {
  it("accepts the evidence event's own document", () => {
    const database = createMigratedDatabase();
    try {
      database.exec(observationSql("doc_northstar_update"));
      const result = database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM public_source_observations WHERE id = 'obs_test'`,
        )
        .get() as { count: number };

      expect(result.count).toBe(1);
    } finally {
      database.close();
    }
  });

  it("rejects a different same-household document", () => {
    const database = createMigratedDatabase();
    try {
      expect(() => database.exec(observationSql("doc_harbor_notice"))).toThrow(
        "portfolio watch observation household or company mismatch",
      );
    } finally {
      database.close();
    }
  });
});
