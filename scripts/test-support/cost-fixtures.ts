import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
} from "../../packages/database/src/holding-imports";

export const COST_SUBJECT = "synthetic-access-subject";
export const COST_TIME = "2026-09-01T12:00:00.000Z";
export const syntheticDigest = (number: number) =>
  number.toString(16).padStart(64, "0");

export async function seedCostHoldings(
  db: D1Database,
  subject = COST_SUBJECT,
  revision = 1,
  legacy = false,
  observations: {
    positionCount?: number;
    instrument?: string;
    status?: "Live" | "Realized";
    investedMinor?: number;
    allocationMinor?: number;
    sharePrices?: {
      costMicros: number | null;
      markMicros: number | null;
      markDate: string | null;
      shareClass: string | null;
      shareBasis?: { key: string; unitsPerOriginal: number } | null;
    };
  } = {},
) {
  const legacyConnectionId = "reconciled-holding-connection-v1:hh_demo:sydecar";
  if (legacy)
    await db.batch([
      db
        .prepare(
          `INSERT INTO investment_connections
      (id, household_id, adapter_type, protected_source_key, created_by_user_id, created_at, immutable)
      VALUES (?, 'hh_demo', 'manual', ?, 'usr_demo', ?, 1)`,
        )
        .bind(legacyConnectionId, "8".repeat(64), COST_TIME),
      db
        .prepare(
          `INSERT INTO investment_connection_versions
      (id, household_id, connection_id, version, institution_key, institution_label, lifecycle_state,
       credential_reference, supersedes_version_id, recorded_by_user_id, recorded_at, immutable)
      VALUES (?, 'hh_demo', ?, 1, 'sydecar', 'Sydecar', 'pending', NULL, NULL, 'usr_demo', ?, 1)`,
        )
        .bind(crypto.randomUUID(), legacyConnectionId, COST_TIME),
    ]);
  const rows: HoldingImportStageInput["rows"] = Array.from(
    { length: observations.positionCount ?? 120 },
    (_, index) => ({
      rowNumber: index + 3,
      ...(observations.sharePrices
        ? { providerInvestmentId: `synthetic-price-${index}` }
        : {}),
      naturalKeySha256: syntheticDigest(index + 1),
      companyOrFund: `Synthetic cost company ${index}`,
      fundName: `Synthetic cost SPV ${index}`,
      status: observations.status ?? "Live",
      investDate: "2025-04-12",
      investDateState: "reported",
      investedMinor: observations.investedMinor ?? 100_000,
      unrealizedValueMinor: 100_000 + revision,
      unrealizedValueState: "reported",
      realizedValueMinor: 0,
      netValueMinor: 100_000 + revision,
      netValueState: "reported",
      multiplePpm: null,
      investmentEntity: `Synthetic cost owner ${index % 100}`,
      lead: null,
      investmentType: "Syndicate",
      source: null,
      round: "Seed",
      market: null,
      positionKind: "spv_interest",
      dealMetadata: {
        ...(observations.sharePrices
          ? { sharePrices: observations.sharePrices }
          : {}),
        allocationMinor: observations.allocationMinor ?? 100_000,
        instrument: observations.instrument ?? "Membership interest",
        roundSizeMinor: null,
        valuationOrCapType: null,
        valuationOrCapMinor: null,
        discount: null,
        carry: null,
        managementFeePpm: observations.sharePrices ? null : 0,
        carryPpm: observations.sharePrices ? null : 0,
        shareClass: null,
      },
    }),
  );
  const input: HoldingImportStageInput = {
    provider: observations.sharePrices ? "tokenfolio" : "sydecar",
    formatVersion: observations.sharePrices ? 4 : 2,
    objectKey: `synthetic-cost/${subject}/${revision}.csv`,
    sha256: syntheticDigest(revision + 20_000),
    byteSize: 120_000,
    effectiveDate: "2026-09-01",
    retrievedAt: COST_TIME,
    rows,
    canonicalScope: {
      connection: {
        mode: "ensure",
        adapterType: "manual",
        protectedSourceKey: "9".repeat(64),
        institutionKey: observations.sharePrices ? "tokenfolio" : "sydecar",
        institutionLabel: observations.sharePrices ? "Tokenfolio" : "Sydecar",
        lifecycleState: "pending",
        credentialReference: null,
      },
      containers: Array.from(
        { length: Math.min(100, rows.length) },
        (_, index) => ({
          protectedAccountKey: syntheticDigest(index + 1_000),
          displayLabel: `Synthetic cost owner ${index}`,
          containerKind: "entity",
          taxTreatment: "unknown",
          completeness: "complete",
        }),
      ),
      rows: rows.map((row, index) => ({
        sourceRowNumber: row.rowNumber,
        protectedAccountKey: syntheticDigest((index % 100) + 1_000),
        protectedPositionKey: legacy
          ? syntheticDigest(index + 100_000)
          : row.naturalKeySha256,
      })),
    },
  };
  if (legacy && input.canonicalScope.connection.mode === "ensure")
    input.canonicalScope.connection.protectedSourceKey = "8".repeat(64);
  const repository = new D1HoldingImportRepository(db);
  const staged = await repository.stageHoldingImport(subject, input);
  await repository.applyHoldingImport(subject, staged.preview.id, {
    currency: "USD",
    decisions: staged.preview.rows.map((row) => ({
      rowId: row.id,
      decision: "accepted",
      rationale: "Synthetic cost fixture review.",
    })),
  });
  return staged.preview.id;
}

export async function seedCostProposals(db: D1Database) {
  const numbers = JSON.stringify(
    Array.from({ length: 120 }, (_, index) => index),
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO connector_accounts (id, household_id, connector_type, display_label,
      secret_reference, status, last_synced_at, provider_account_key, created_at)
      SELECT CASE WHEN value = 0 THEN 'cost-cash' ELSE 'cost-cash-' || value END,
        'hh_demo', 'plaid-cash', 'Synthetic cost bank ' || value,
        'connector-secrets/synthetic.enc', 'active', NULL, printf('%064x', value + 30000), ?
      FROM json_each(?)`,
      )
      .bind(
        COST_TIME,
        JSON.stringify(Array.from({ length: 20 }, (_, index) => index)),
      ),
    db
      .prepare(
        `INSERT INTO connector_sync_runs (id, household_id, connector_account_id,
      status, started_at, finished_at, cursor, discovered_count, proposed_count, error_code)
      SELECT 'cost-cash-run-' || value, 'hh_demo', CASE WHEN value % 20 = 0 THEN 'cost-cash' ELSE 'cost-cash-' || (value % 20) END, 'succeeded', ?, ?,
        'cash-initial-v1', 1, 1, NULL FROM json_each(?)`,
      )
      .bind(COST_TIME, COST_TIME, numbers),
    db
      .prepare(
        `INSERT INTO cash_balance_proposals (id, household_id, connector_account_id, sync_run_id,
      source_object_key, source_sha256, normalized_fingerprint, refresh_kind, observed_at,
      retrieved_at, status, created_at)
      SELECT 'cost-cash-proposal-' || value, 'hh_demo', CASE WHEN value % 20 = 0 THEN 'cost-cash' ELSE 'cost-cash-' || (value % 20) END, 'cost-cash-run-' || value,
        'synthetic/cash/' || value, printf('%064x', value), printf('%064x', value),
        'initial', CASE WHEN value < 20 THEN ? ELSE '2026-08-01T00:00:00.000Z' END, ?, CASE WHEN value < 20 THEN 'pending_review' ELSE 'applied' END, ? FROM json_each(?)`,
      )
      .bind(COST_TIME, COST_TIME, COST_TIME, numbers),
    db
      .prepare(
        `INSERT INTO cash_balance_proposal_rows (id, household_id, proposal_id,
      natural_key_sha256, institution_label, account_label, subtype, available_minor,
      current_minor, value_minor, value_state, balance_source, observed_at, issues_json, created_at)
      SELECT 'cost-cash-row-' || value, 'hh_demo', 'cost-cash-proposal-' || (value % 20),
        printf('%064x', value), 'Synthetic cost bank', 'Synthetic account ' || value, 'checking',
        100000, 100000, 100000, 'reported', 'available', ?, '[]', ? FROM json_each(?)`,
      )
      .bind(COST_TIME, COST_TIME, numbers),
    db
      .prepare(
        `INSERT INTO liability_proposals (id, household_id, connector_account_id, sync_run_id,
      source, source_object_key, source_sha256, normalized_fingerprint, refresh_kind,
      observed_at, retrieved_at, status, created_at)
      SELECT 'cost-debt-proposal-' || value, 'hh_demo', NULL, NULL, 'manual', NULL, NULL,
        printf('%064x', value), 'manual', ?, ?, CASE WHEN value < 20 THEN 'pending_review' ELSE 'applied' END, ? FROM json_each(?)`,
      )
      .bind(COST_TIME, COST_TIME, COST_TIME, numbers),
    db
      .prepare(
        `INSERT INTO liability_proposal_rows (id, household_id, proposal_id, natural_key_sha256,
      source, institution_label, account_label, kind, classification, balance_minor, value_state,
      payment_minor, interest_rate_ppm, next_payment_due_date, is_overdue, effective_date,
      observed_at, issues_json, created_at)
      SELECT 'cost-debt-row-' || value, 'hh_demo', 'cost-debt-proposal-' || (value % 20),
        printf('%064x', value), 'manual', 'Synthetic lender', 'Synthetic debt ' || value,
        'mortgage', 'scheduled', 100000, 'reported', 100, NULL, NULL, NULL,
        '2026-09-01', ?, '[]', ? FROM json_each(?)`,
      )
      .bind(COST_TIME, COST_TIME, numbers),
  ]);
}

export async function seedCostWatchTargets(db: D1Database) {
  const positions = (
    await db
      .prepare(
        `SELECT position.id, position.position_fingerprint
    FROM holding_positions position WHERE position.household_id = 'hh_demo'
      AND position.legal_vehicle_name LIKE 'Synthetic cost SPV %'
      AND NOT EXISTS (SELECT 1 FROM holding_position_continuities continuity
        WHERE continuity.predecessor_position_id = position.id)`,
      )
      .all<{ id: string; position_fingerprint: string }>()
  ).results;
  if (positions.length !== 120)
    throw new Error("Expected 120 current synthetic positions");
  const input = JSON.stringify(
    positions.map((position, index) => ({
      positionId: position.id,
      index,
      companyId: `cost-company-${index}`,
      exposureId: `cost-exposure-${index}`,
    })),
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO companies (id, household_id, legal_name, website_host, status, created_at, updated_at)
      SELECT json_extract(value, '$.companyId'), 'hh_demo', 'Synthetic cost company ' || json_extract(value, '$.index'),
        'synthetic-cost-' || json_extract(value, '$.index') || '.example.com', 'active', ?, ?
      FROM json_each(?)`,
      )
      .bind(COST_TIME, COST_TIME, input),
    db
      .prepare(
        `INSERT INTO canonical_exposures (id, household_id, exposure_kind, canonical_name,
      protected_identity_key, company_id, resolution_method, evidence_sha256, created_by_user_id, created_at, immutable)
      SELECT json_extract(value, '$.exposureId'), 'hh_demo', 'private_company',
        'Synthetic cost company ' || json_extract(value, '$.index'), NULL, json_extract(value, '$.companyId'),
        'reviewed_company', ?, 'usr_demo', ?, 1 FROM json_each(?)`,
      )
      .bind(syntheticDigest(60_000), COST_TIME, input),
    db
      .prepare(
        `INSERT INTO holding_position_exposure_mappings
      (id, household_id, position_id, exposure_id, relationship_kind, allocation_ppm, status,
       decision_source, decision_reference, evidence_sha256, effective_at, version, supersedes_mapping_id,
       accepted_by_user_id, accepted_at, immutable)
      SELECT mapping.id || ':cost-withdrawn', mapping.household_id, mapping.position_id, mapping.exposure_id,
        mapping.relationship_kind, NULL, 'withdrawn', 'review', 'Synthetic fixture company review',
        mapping.evidence_sha256, mapping.effective_at, mapping.version + 1, mapping.id,
        'usr_demo', mapping.accepted_at, 1
      FROM holding_position_exposure_mappings mapping JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
      WHERE mapping.household_id = 'hh_demo' AND mapping.status = 'active' AND exposure.exposure_kind = 'unresolved'
        AND mapping.position_id IN (SELECT json_extract(value, '$.positionId') FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM holding_position_exposure_mappings later WHERE later.supersedes_mapping_id = mapping.id)`,
      )
      .bind(input),
    db
      .prepare(
        `INSERT INTO holding_position_exposure_mappings
      (id, household_id, position_id, exposure_id, relationship_kind, allocation_ppm, status,
       decision_source, decision_reference, evidence_sha256, effective_at, version, supersedes_mapping_id,
       accepted_by_user_id, accepted_at, immutable)
      SELECT 'cost-mapping-' || json_extract(value, '$.index'), 'hh_demo', json_extract(value, '$.positionId'),
        json_extract(value, '$.exposureId'), 'look_through', 1000000, 'active', 'review',
        'Synthetic fixture company review', ?, ?, 1, NULL, 'usr_demo', ?, 1 FROM json_each(?)`,
      )
      .bind(syntheticDigest(60_000), COST_TIME, COST_TIME, input),
  ]);
}
