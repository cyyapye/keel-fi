import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const priorMigrationFiles = [
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
] as const;

const canonicalMigrationFile =
  "packages/database/migrations/0019_multi_source_holdings_contract.sql";
const containerScopedMigrationFile =
  "packages/database/migrations/0020_container_scoped_holding_ingestion.sql";
const contractMigrationFiles = [
  canonicalMigrationFile,
  containerScopedMigrationFile,
] as const;
const seedFile = "packages/database/seed/synthetic.sql";
const recordedAt = "2026-08-15T20:00:00.000Z";

function apply(database: DatabaseSync, files: readonly string[]) {
  for (const file of files) {
    database.exec(readFileSync(resolve(file), "utf8"));
  }
}

function applyInsideD1StyleTransaction(
  database: DatabaseSync,
  files: readonly string[],
) {
  database.exec("BEGIN");
  try {
    apply(database, files);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

const planningTables = [
  "holding_positions",
  "holding_position_snapshots",
  "portfolio_baselines",
  "portfolio_baseline_items",
  "portfolio_baseline_cash_items",
  "goals",
  "goal_versions",
  "goal_forecast_snapshots",
  "cash_flow_plans",
  "forecast_snapshots",
] as const;

function planningState(database: DatabaseSync) {
  return Object.fromEntries(
    planningTables.map((table) => [
      table,
      database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
    ]),
  );
}

function insertCanonicalStructure(database: DatabaseSync) {
  database.exec(`
    INSERT INTO investment_connections (
      id, household_id, adapter_type, protected_source_key,
      created_by_user_id, created_at, immutable
    ) VALUES (
      'investment_connection_synthetic', 'hh_demo', 'plaid-investments',
      '${"a".repeat(64)}', 'usr_demo', '${recordedAt}', 1
    );
    INSERT INTO investment_connection_versions (
      id, household_id, connection_id, version, institution_key,
      institution_label, lifecycle_state, credential_reference,
      supersedes_version_id, recorded_by_user_id, recorded_at, immutable
    ) VALUES (
      'investment_connection_version_synthetic', 'hh_demo',
      'investment_connection_synthetic', 1, 'synthetic-brokerage',
      'Synthetic Brokerage', 'active',
      'connector-secrets/synthetic-investments.json.enc', NULL,
      'usr_demo', '${recordedAt}', 1
    );
    INSERT INTO ownership_containers (
      id, household_id, connection_id, protected_account_key,
      created_by_user_id, created_at, immutable
    ) VALUES (
      'ownership_container_synthetic', 'hh_demo',
      'investment_connection_synthetic', '${"b".repeat(64)}',
      'usr_demo', '${recordedAt}', 1
    );
    INSERT INTO ownership_container_versions (
      id, household_id, container_id, version, display_label,
      container_kind, tax_treatment, supersedes_version_id,
      recorded_by_user_id, recorded_at, immutable
    ) VALUES (
      'ownership_container_version_synthetic', 'hh_demo',
      'ownership_container_synthetic', 1, 'Synthetic IRA', 'ira',
      'tax_exempt', NULL, 'usr_demo', '${recordedAt}', 1
    );
    INSERT INTO holding_positions (
      id, household_id, provider, position_fingerprint, legal_vehicle_name,
      owner_label, position_kind, instrument_type, opened_on, currency,
      created_by, created_at
    ) VALUES (
      'holding_position_synthetic_fund', 'hh_demo', 'manual',
      '${"c".repeat(64)}', 'Synthetic Multi-company Fund',
      'Synthetic IRA', 'fund_interest', 'fund interest', '2026-01-10',
      'USD', 'usr_demo', '${recordedAt}'
    );
    INSERT INTO holding_position_ownerships (
      id, household_id, container_id, position_id, protected_position_key,
      association_basis, evidence_sha256, version, supersedes_ownership_id,
      accepted_by_user_id, accepted_at, immutable
    ) VALUES (
      'holding_position_ownership_synthetic', 'hh_demo',
      'ownership_container_synthetic', 'holding_position_synthetic_fund',
      '${"d".repeat(64)}', 'manual', '${"e".repeat(64)}', 1, NULL,
      'usr_demo', '${recordedAt}', 1
    );
    INSERT INTO canonical_exposures (
      id, household_id, exposure_kind, canonical_name,
      protected_identity_key, company_id, resolution_method, evidence_sha256,
      created_by_user_id, created_at, immutable
    ) VALUES
      (
        'canonical_exposure_northstar', 'hh_demo', 'private_company',
        'Northstar Robotics', NULL, 'co_northstar', 'reviewed_company',
        '${"f".repeat(64)}', 'usr_demo', '${recordedAt}', 1
      ),
      (
        'canonical_exposure_harbor', 'hh_demo', 'private_company',
        'Harbor Health Systems', NULL, 'co_harbor', 'reviewed_company',
        '${"1".repeat(64)}', 'usr_demo', '${recordedAt}', 1
      ),
      (
        'canonical_exposure_lattice', 'hh_demo', 'private_company',
        'Lattice Grove Energy', NULL, 'co_lattice', 'reviewed_company',
        '${"2".repeat(64)}', 'usr_demo', '${recordedAt}', 1
      );
    INSERT INTO holding_position_exposure_mappings (
      id, household_id, position_id, exposure_id, relationship_kind,
      allocation_ppm, status, decision_source, decision_reference,
      evidence_sha256, effective_at, version, supersedes_mapping_id,
      accepted_by_user_id, accepted_at, immutable
    ) VALUES
      (
        'position_exposure_mapping_northstar_v1', 'hh_demo',
        'holding_position_synthetic_fund', 'canonical_exposure_northstar',
        'look_through', 600000, 'active', 'review',
        'synthetic exposure review', '${"3".repeat(64)}', '${recordedAt}',
        1, NULL, 'usr_demo', '${recordedAt}', 1
      ),
      (
        'position_exposure_mapping_harbor_v1', 'hh_demo',
        'holding_position_synthetic_fund', 'canonical_exposure_harbor',
        'look_through', 400000, 'active', 'review',
        'synthetic exposure review', '${"4".repeat(64)}', '${recordedAt}',
        1, NULL, 'usr_demo', '${recordedAt}', 1
      );
  `);
}

describe("multi-source holdings persistence contract", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
  });

  afterEach(() => database.close());

  it("applies forward without changing holdings or planning state", () => {
    apply(database, priorMigrationFiles);
    apply(database, [seedFile]);
    const before = planningState(database);

    apply(database, contractMigrationFiles);

    expect(planningState(database)).toEqual(before);
    expect(
      database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM investment_connections) AS connections,
             (SELECT COUNT(*) FROM ownership_containers) AS containers,
             (SELECT COUNT(*) FROM holding_position_ownerships) AS ownerships,
             (SELECT COUNT(*) FROM holding_import_coverages) AS coverages,
             (SELECT COUNT(*) FROM canonical_exposures) AS exposures,
             (SELECT COUNT(*) FROM holding_position_exposure_mappings) AS mappings`,
        )
        .get(),
    ).toEqual({
      connections: 0,
      containers: 0,
      ownerships: 0,
      coverages: 0,
      exposures: 0,
      mappings: 0,
    });
  });

  it("rebuilds inside a D1-style transaction and accepts zero-row observations", () => {
    apply(database, [...priorMigrationFiles, canonicalMigrationFile, seedFile]);
    database.exec(`
      INSERT INTO source_documents (
        id, household_id, object_key, file_name, content_type, byte_size,
        sha256, effective_date, retrieved_at, source_label, review_status,
        created_at
      ) VALUES (
        'source_document_before_m9_3', 'hh_demo',
        'holding-imports/before-m9-3.json', 'before-m9-3.json',
        'application/json', 512, '${"01".repeat(32)}', '2026-08-15',
        '${recordedAt}', 'Synthetic Investments', 'pending_review',
        '${recordedAt}'
      );
      INSERT INTO holding_imports (
        id, household_id, source_document_id, provider, parser_schema,
        normalized_fingerprint, row_count, created_by, created_at
      ) VALUES (
        'holding_import_before_m9_3', 'hh_demo',
        'source_document_before_m9_3', 'robinhood', 'synthetic-v1',
        '${"b".repeat(64)}', 1, 'usr_demo', '${recordedAt}'
      );
      INSERT INTO holding_import_rows (
        id, household_id, import_id, source_row_number, position_fingerprint,
        snapshot_fingerprint, legal_vehicle_name, owner_label, exposure_label,
        provider_status, invested_on, invested_minor, allocation_minor,
        unrealized_value_minor, unrealized_value_state, realized_value_minor,
        net_value_minor, net_value_state, instrument_type, currency_hint,
        parse_status, issue_codes_json, position_kind, quantity_micros, ticker,
        cost_basis_minor, created_at
      ) VALUES (
        'holding_import_row_before_m9_3', 'hh_demo',
        'holding_import_before_m9_3', 1, '${"c".repeat(64)}',
        '${"d".repeat(64)}', 'Synthetic Security', 'Synthetic Brokerage',
        'Synthetic Exposure', 'live', '2026-08-15', 100000, 100000,
        125000, 'reported', 0, 125000, 'reported', 'equity', 'USD', 'ready',
        '[]', 'direct', 1000000, 'SYN', 100000, '${recordedAt}'
      );
    `);

    applyInsideD1StyleTransaction(database, [containerScopedMigrationFile]);

    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database
        .prepare(
          `SELECT import_id FROM holding_import_rows
           WHERE id = 'holding_import_row_before_m9_3'`,
        )
        .get(),
    ).toEqual({ import_id: "holding_import_before_m9_3" });
    expect(() =>
      database.exec(`
        INSERT INTO source_documents (
          id, household_id, object_key, file_name, content_type, byte_size,
          sha256, effective_date, retrieved_at, source_label, review_status,
          created_at
        ) VALUES (
          'source_document_zero_row', 'hh_demo',
          'holding-imports/zero-row.json', 'zero-row.json', 'application/json',
          256, '${"e".repeat(64)}', '2026-08-15', '${recordedAt}',
          'Synthetic Investments', 'pending_review', '${recordedAt}'
        );
        INSERT INTO holding_imports (
          id, household_id, source_document_id, provider, parser_schema,
          normalized_fingerprint, row_count, created_by, created_at
        ) VALUES (
          'holding_import_zero_row', 'hh_demo', 'source_document_zero_row',
          'robinhood', 'synthetic-v1', '${"f".repeat(64)}', 0, 'usr_demo',
          '${recordedAt}'
        );
      `),
    ).not.toThrow();
  });

  it("replays from an empty database and accepts the complete relationship model", () => {
    apply(database, [
      ...priorMigrationFiles,
      ...contractMigrationFiles,
      seedFile,
    ]);
    insertCanonicalStructure(database);

    expect(
      database
        .prepare(
          `SELECT
             connection.adapter_type,
             connection_version.institution_label,
             container_version.container_kind,
             container_version.tax_treatment,
             ownership.protected_position_key
           FROM investment_connections connection
           JOIN investment_connection_versions connection_version
             ON connection_version.connection_id = connection.id
           JOIN ownership_containers container
             ON container.connection_id = connection.id
           JOIN ownership_container_versions container_version
             ON container_version.container_id = container.id
           JOIN holding_position_ownerships ownership
             ON ownership.container_id = container.id`,
        )
        .get(),
    ).toEqual({
      adapter_type: "plaid-investments",
      institution_label: "Synthetic Brokerage",
      container_kind: "ira",
      tax_treatment: "tax_exempt",
      protected_position_key: "d".repeat(64),
    });
    expect(
      database
        .prepare(
          `SELECT SUM(allocation_ppm) AS allocated_ppm
           FROM holding_position_exposure_mappings
           WHERE status = 'active'`,
        )
        .get(),
    ).toEqual({ allocated_ppm: 1_000_000 });
  });

  it("binds import rows and coverage to the exact connection and container", () => {
    apply(database, [
      ...priorMigrationFiles,
      ...contractMigrationFiles,
      seedFile,
    ]);
    insertCanonicalStructure(database);
    database.exec(`
      INSERT INTO source_documents (
        id, household_id, object_key, file_name, content_type, byte_size,
        sha256, effective_date, retrieved_at, source_label, review_status,
        created_at
      ) VALUES (
        'source_document_canonical_synthetic', 'hh_demo',
        'holding-imports/canonical-synthetic.json', 'canonical-synthetic.json',
        'application/json', 512, '${"5".repeat(64)}', '2026-08-15',
        '${recordedAt}', 'Synthetic Investments', 'pending_review',
        '${recordedAt}'
      );
      INSERT INTO holding_imports (
        id, household_id, source_document_id, provider, parser_schema,
        normalized_fingerprint, row_count, created_by, created_at
      ) VALUES (
        'holding_import_canonical_synthetic', 'hh_demo',
        'source_document_canonical_synthetic', 'robinhood',
        'synthetic-canonical-v1', '${"6".repeat(64)}', 1, 'usr_demo',
        '${recordedAt}'
      );
      INSERT INTO holding_import_rows (
        id, household_id, import_id, source_row_number, position_fingerprint,
        snapshot_fingerprint, legal_vehicle_name, owner_label, exposure_label,
        provider_status, invested_on, invested_minor, allocation_minor,
        unrealized_value_minor, unrealized_value_state, realized_value_minor,
        net_value_minor, net_value_state, instrument_type, currency_hint,
        parse_status, issue_codes_json, position_kind, quantity_micros, ticker,
        cost_basis_minor, created_at
      ) VALUES (
        'holding_import_row_canonical_synthetic', 'hh_demo',
        'holding_import_canonical_synthetic', 1, '${"7".repeat(64)}',
        '${"8".repeat(64)}', 'Synthetic Security', 'Synthetic IRA',
        'Synthetic Public Exposure', 'live', '2026-08-15', 100000, 100000,
        125000, 'reported', 0, 125000, 'reported', 'equity', 'USD', 'ready',
        '[]', 'direct', 1000000, 'SYN', 100000, '${recordedAt}'
      );
      INSERT INTO holding_import_connections (
        id, household_id, import_id, connection_id, created_at, immutable
      ) VALUES (
        'holding_import_connection_synthetic', 'hh_demo',
        'holding_import_canonical_synthetic', 'investment_connection_synthetic',
        '${recordedAt}', 1
      );
    `);

    expect(() =>
      database.exec(`
        INSERT INTO holding_import_row_containers (
          id, household_id, import_row_id, container_id, created_at, immutable
        ) VALUES (
          'holding_import_row_container_without_coverage', 'hh_demo',
          'holding_import_row_canonical_synthetic',
          'ownership_container_synthetic', '${recordedAt}', 1
        )
      `),
    ).toThrow(/holding import row coverage missing/u);

    database.exec(`
      INSERT INTO holding_import_coverages (
        id, household_id, import_id, container_id, completeness,
        evidence_sha256, observed_at, created_at, immutable
      ) VALUES (
        'holding_import_coverage_synthetic', 'hh_demo',
        'holding_import_canonical_synthetic', 'ownership_container_synthetic',
        'complete', '${"9".repeat(64)}', '${recordedAt}', '${recordedAt}', 1
      );
      INSERT INTO holding_import_row_containers (
        id, household_id, import_row_id, container_id, created_at, immutable
      ) VALUES (
        'holding_import_row_container_synthetic', 'hh_demo',
        'holding_import_row_canonical_synthetic',
        'ownership_container_synthetic', '${recordedAt}', 1
      );
    `);

    expect(
      database
        .prepare(
          `SELECT coverage.completeness
           FROM holding_import_coverages coverage
           JOIN holding_import_row_containers row_scope
             ON row_scope.container_id = coverage.container_id
           JOIN holding_import_connections source
             ON source.import_id = coverage.import_id
           WHERE source.connection_id = 'investment_connection_synthetic'`,
        )
        .get(),
    ).toEqual({ completeness: "complete" });
  });

  it("fails closed on raw identifiers and cross-household associations", () => {
    apply(database, [
      ...priorMigrationFiles,
      ...contractMigrationFiles,
      seedFile,
    ]);
    insertCanonicalStructure(database);
    database.exec(`
      INSERT INTO users (
        id, access_subject, email, display_name, created_at
      ) VALUES (
        'usr_other', 'synthetic-other-subject', 'other@example.invalid',
        'Other Demo Operator', '${recordedAt}'
      );
      INSERT INTO households (
        id, owner_user_id, name, base_currency, created_at
      ) VALUES (
        'hh_other', 'usr_other', 'Other Demo Household', 'USD', '${recordedAt}'
      );
    `);

    expect(() =>
      database.exec(`
        INSERT INTO investment_connections (
          id, household_id, adapter_type, protected_source_key,
          created_by_user_id, created_at, immutable
        ) VALUES (
          'investment_connection_raw', 'hh_demo', 'plaid-investments',
          'raw-provider-item-id', 'usr_demo', '${recordedAt}', 1
        )
      `),
    ).toThrow();
    expect(() =>
      database.exec(`
        INSERT INTO ownership_containers (
          id, household_id, connection_id, protected_account_key,
          created_by_user_id, created_at, immutable
        ) VALUES (
          'ownership_container_other', 'hh_other',
          'investment_connection_synthetic', '${"0".repeat(64)}',
          'usr_other', '${recordedAt}', 1
        )
      `),
    ).toThrow(/ownership container household mismatch/u);

    database.exec(`
      INSERT INTO investment_connections (
        id, household_id, adapter_type, protected_source_key,
        created_by_user_id, created_at, immutable
      ) VALUES (
        'investment_connection_same_label', 'hh_demo', 'plaid-investments',
        '${"0".repeat(64)}', 'usr_demo', '${recordedAt}', 1
      );
      INSERT INTO investment_connection_versions (
        id, household_id, connection_id, version, institution_key,
        institution_label, lifecycle_state, credential_reference,
        supersedes_version_id, recorded_by_user_id, recorded_at, immutable
      ) VALUES (
        'investment_connection_same_label_v1', 'hh_demo',
        'investment_connection_same_label', 1, 'synthetic-brokerage',
        'Synthetic Brokerage', 'active',
        'connector-secrets/synthetic-second.json.enc', NULL, 'usr_demo',
        '${recordedAt}', 1
      );
    `);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM investment_connection_versions
           WHERE institution_label = 'Synthetic Brokerage'`,
        )
        .get(),
    ).toEqual({ count: 2 });
  });

  it("keeps accepted records append-only and bounds current allocations", () => {
    apply(database, [
      ...priorMigrationFiles,
      ...contractMigrationFiles,
      seedFile,
    ]);
    insertCanonicalStructure(database);

    expect(() =>
      database.exec(`
        INSERT INTO holding_position_ownerships (
          id, household_id, container_id, position_id, protected_position_key,
          association_basis, evidence_sha256, version,
          supersedes_ownership_id, accepted_by_user_id, accepted_at, immutable
        ) VALUES (
          'holding_position_ownership_rejected_transition', 'hh_demo',
          'ownership_container_synthetic', 'holding_position_synthetic_fund',
          '${"7".repeat(64)}', 'reviewed_legacy', '${"8".repeat(64)}', 2,
          'holding_position_ownership_synthetic', 'usr_demo',
          '2026-08-15T21:00:00.000Z', 1
        )
      `),
    ).toThrow(/association_basis/u);

    expect(() =>
      database.exec(`
        UPDATE ownership_container_versions
        SET display_label = 'Changed label'
        WHERE id = 'ownership_container_version_synthetic'
      `),
    ).toThrow(/ownership container versions are immutable/u);
    database.exec(`
      INSERT INTO ownership_containers (
        id, household_id, connection_id, protected_account_key,
        created_by_user_id, created_at, immutable
      ) VALUES (
        'ownership_container_corrected', 'hh_demo',
        'investment_connection_synthetic', '${"9".repeat(64)}',
        'usr_demo', '2026-08-15T21:00:00.000Z', 1
      );
      INSERT INTO ownership_container_versions (
        id, household_id, container_id, version, display_label,
        container_kind, tax_treatment, supersedes_version_id,
        recorded_by_user_id, recorded_at, immutable
      ) VALUES (
        'ownership_container_corrected_v1', 'hh_demo',
        'ownership_container_corrected', 1, 'Reviewed owner entity', 'entity',
        'unknown', NULL, 'usr_demo', '2026-08-15T21:00:00.000Z', 1
      );
      INSERT INTO holding_position_ownerships (
        id, household_id, container_id, position_id, protected_position_key,
        association_basis, evidence_sha256, version,
        supersedes_ownership_id, accepted_by_user_id, accepted_at, immutable
      ) VALUES (
        'holding_position_ownership_synthetic_v2', 'hh_demo',
        'ownership_container_corrected', 'holding_position_synthetic_fund',
        '${"d".repeat(64)}', 'reviewed_import', '${"8".repeat(64)}', 2,
        'holding_position_ownership_synthetic', 'usr_demo',
        '2026-08-15T21:00:00.000Z', 1
      );
    `);
    expect(
      database
        .prepare(
          `SELECT current.container_id
           FROM holding_position_ownerships current
           WHERE current.position_id = 'holding_position_synthetic_fund'
             AND NOT EXISTS (
               SELECT 1
               FROM holding_position_ownerships later
               WHERE later.supersedes_ownership_id = current.id
             )`,
        )
        .get(),
    ).toEqual({ container_id: "ownership_container_corrected" });
    expect(() =>
      database.exec(`
        INSERT INTO holding_position_exposure_mappings (
          id, household_id, position_id, exposure_id, relationship_kind,
          allocation_ppm, status, decision_source, decision_reference,
          evidence_sha256, effective_at, version, supersedes_mapping_id,
          accepted_by_user_id, accepted_at, immutable
        ) VALUES (
          'position_exposure_mapping_lattice_too_much', 'hh_demo',
          'holding_position_synthetic_fund', 'canonical_exposure_lattice',
          'look_through', 1, 'active', 'review', 'synthetic exposure review',
          '${"a".repeat(64)}', '${recordedAt}', 1, NULL, 'usr_demo',
          '${recordedAt}', 1
        )
      `),
    ).toThrow(/allocations exceed one million ppm/u);

    database.exec(`
      INSERT INTO holding_position_exposure_mappings (
        id, household_id, position_id, exposure_id, relationship_kind,
        allocation_ppm, status, decision_source, decision_reference,
        evidence_sha256, effective_at, version, supersedes_mapping_id,
        accepted_by_user_id, accepted_at, immutable
      ) VALUES (
        'position_exposure_mapping_northstar_v2', 'hh_demo',
        'holding_position_synthetic_fund', 'canonical_exposure_northstar',
        'look_through', NULL, 'withdrawn', 'review',
        'synthetic mapping correction', '${"b".repeat(64)}',
        '2026-08-15T21:00:00.000Z', 2,
        'position_exposure_mapping_northstar_v1', 'usr_demo',
        '2026-08-15T21:00:00.000Z', 1
      );
      INSERT INTO holding_position_exposure_mappings (
        id, household_id, position_id, exposure_id, relationship_kind,
        allocation_ppm, status, decision_source, decision_reference,
        evidence_sha256, effective_at, version, supersedes_mapping_id,
        accepted_by_user_id, accepted_at, immutable
      ) VALUES (
        'position_exposure_mapping_lattice_v1', 'hh_demo',
        'holding_position_synthetic_fund', 'canonical_exposure_lattice',
        'look_through', 600000, 'active', 'review',
        'synthetic mapping correction', '${"c".repeat(64)}',
        '2026-08-15T21:00:00.000Z', 1, NULL, 'usr_demo',
        '2026-08-15T21:00:00.000Z', 1
      );
    `);

    expect(
      database
        .prepare(
          `SELECT SUM(current.allocation_ppm) AS allocated_ppm
           FROM holding_position_exposure_mappings current
           WHERE current.status = 'active'
             AND NOT EXISTS (
               SELECT 1
               FROM holding_position_exposure_mappings later
               WHERE later.supersedes_mapping_id = current.id
             )`,
        )
        .get(),
    ).toEqual({ allocated_ppm: 1_000_000 });
  });
});
