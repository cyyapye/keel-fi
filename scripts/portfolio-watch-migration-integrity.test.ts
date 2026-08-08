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
  "packages/database/migrations/0006_evidence_claim_integrity.sql",
  "packages/database/migrations/0007_holding_imports.sql",
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

describe("Evidence claim review integrity migration", () => {
  it("allows pending claim correction and profile-style cleanup before review", () => {
    const database = createMigratedDatabase();
    try {
      database.exec(`
        INSERT INTO evidence_claims (
          id, household_id, evidence_event_id, field_path, claim_value_json,
          unit, provenance, created_at
        ) VALUES (
          'claim_pending_note', 'hh_demo', 'evt_northstar_round',
          'company_event.synthetic_note', '{"status":"draft"}', NULL,
          'Synthetic pre-review note', '2026-08-07T00:00:00Z'
        );
        UPDATE evidence_claims
        SET claim_value_json = '{"status":"corrected"}'
        WHERE id = 'claim_pending_note';
        DELETE FROM evidence_claims WHERE id = 'claim_pending_note';
        DELETE FROM evidence_claims
        WHERE evidence_event_id = 'evt_northstar_round';
        DELETE FROM evidence_events WHERE id = 'evt_northstar_round';
      `);

      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM evidence_events WHERE id = 'evt_northstar_round'`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("rejects claim update, deletion, and late insertion after review", () => {
    const database = createMigratedDatabase();
    try {
      database.exec(`
        INSERT INTO review_decisions (
          id, household_id, evidence_event_id, reviewer_user_id, decision,
          rationale, prior_value_json, replacement_value_json, decided_at
        ) VALUES (
          'decision_northstar_integrity', 'hh_demo', 'evt_northstar_round',
          'usr_demo', 'scenario_only', 'Synthetic integrity decision.',
          '{"externalMarkMinor":142000000}',
          '{"externalMarkMinor":168000000}',
          '2026-08-07T00:00:00Z'
        );
      `);

      expect(() =>
        database.exec(`
          UPDATE evidence_claims
          SET claim_value_json = '169000000'
          WHERE id = 'claim_ns_mark';
        `),
      ).toThrow("evidence claims are immutable after review");
      expect(() =>
        database.exec("DELETE FROM evidence_claims WHERE id = 'claim_ns_mark'"),
      ).toThrow("evidence claims are immutable after review");
      expect(() =>
        database.exec(`
          INSERT INTO evidence_claims (
            id, household_id, evidence_event_id, field_path, claim_value_json,
            unit, provenance, created_at
          ) VALUES (
            'claim_late_note', 'hh_demo', 'evt_northstar_round',
            'company_event.synthetic_note', '{"status":"late"}', NULL,
            'Synthetic late note', '2026-08-07T00:01:00Z'
          );
        `),
      ).toThrow("evidence claims are immutable after review");
    } finally {
      database.close();
    }
  });
});
