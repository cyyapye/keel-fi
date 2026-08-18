import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { D1InvestmentPositionViewRepository } from "./position-read-model";

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
  "packages/database/seed/synthetic.sql",
] as const;

type TestHousehold = {
  readonly id: string;
  readonly userId: string;
};

type AcceptedPositionInput = {
  readonly household: TestHousehold;
  readonly connectionId: string;
  readonly containerId: string;
  readonly positionId: string;
  readonly positionFingerprint: string;
  readonly observationId: string;
  readonly observationDigest: string;
  readonly snapshotFingerprint?: string;
  readonly reuseSnapshotId?: string;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly acceptedAt: string;
  readonly completeness:
    | "complete"
    | "partial"
    | "unavailable"
    | "malformed"
    | "failed"
    | "ambiguous";
  readonly unrealizedValueMinor: number | null;
  readonly unrealizedValueState: "reported" | "locked" | "not_reported";
  readonly netValueMinor: number | null;
  readonly netValueState: "reported" | "locked" | "not_reported";
  readonly createPosition: boolean;
  readonly acceptObservation: boolean;
};

class TestD1Statement {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: readonly SQLInputValue[] = [],
  ) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    return new TestD1Statement(this.database, this.sql, values);
  }

  public first<T>(): Promise<T | null> {
    return Promise.resolve(
      (this.database.prepare(this.sql).get(...this.values) as T) ?? null,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({
      results: this.database.prepare(this.sql).all(...this.values) as T[],
    });
  }
}

class TestD1Database {
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }
}

function digest(digit: string): string {
  return digit.repeat(64);
}

function addHousehold(
  database: DatabaseSync,
  household: TestHousehold,
  accessSubject: string,
) {
  database
    .prepare(
      `INSERT INTO users (
         id, access_subject, email, display_name, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      household.userId,
      accessSubject,
      `${household.userId}@example.invalid`,
      "Other Synthetic Operator",
      "2026-08-01T00:00:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO households (
         id, owner_user_id, name, base_currency, created_at
       ) VALUES (?, ?, ?, 'USD', ?)`,
    )
    .run(
      household.id,
      household.userId,
      "Other Synthetic Household",
      "2026-08-01T00:00:00.000Z",
    );
}

function addConnection(
  database: DatabaseSync,
  household: TestHousehold,
  input: {
    readonly id: string;
    readonly adapterType?: "plaid-investments" | "angellist-import" | "manual";
    readonly protectedSourceKey: string;
    readonly institutionKey: string;
    readonly institutionLabel: string;
    readonly credentialReference?: string | null;
    readonly lifecycleState?: "pending" | "active";
  },
) {
  database
    .prepare(
      `INSERT INTO investment_connections (
         id, household_id, adapter_type, protected_source_key,
         created_by_user_id, created_at, immutable
       ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      input.id,
      household.id,
      input.adapterType ?? "plaid-investments",
      input.protectedSourceKey,
      household.userId,
      "2026-08-01T00:00:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO investment_connection_versions (
         id, household_id, connection_id, version, institution_key,
         institution_label, lifecycle_state, credential_reference,
         supersedes_version_id, recorded_by_user_id, recorded_at, immutable
       ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, ?, 1)`,
    )
    .run(
      `${input.id}_v1`,
      household.id,
      input.id,
      input.institutionKey,
      input.institutionLabel,
      input.lifecycleState ?? "active",
      input.credentialReference === undefined
        ? `connector-secrets/${input.id}.json.enc`
        : input.credentialReference,
      household.userId,
      "2026-08-01T00:00:00.000Z",
    );
}

function addContainer(
  database: DatabaseSync,
  household: TestHousehold,
  input: {
    readonly id: string;
    readonly connectionId: string;
    readonly protectedAccountKey: string;
    readonly label: string;
    readonly kind: "brokerage" | "ira" | "unresolved";
    readonly taxTreatment: "taxable" | "tax_exempt" | "unknown";
  },
) {
  database
    .prepare(
      `INSERT INTO ownership_containers (
         id, household_id, connection_id, protected_account_key,
         created_by_user_id, created_at, immutable
       ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      input.id,
      household.id,
      input.connectionId,
      input.protectedAccountKey,
      household.userId,
      "2026-08-01T00:00:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO ownership_container_versions (
         id, household_id, container_id, version, display_label,
         container_kind, tax_treatment, supersedes_version_id,
         recorded_by_user_id, recorded_at, immutable
       ) VALUES (?, ?, ?, 1, ?, ?, ?, NULL, ?, ?, 1)`,
    )
    .run(
      `${input.id}_v1`,
      household.id,
      input.id,
      input.label,
      input.kind,
      input.taxTreatment,
      household.userId,
      "2026-08-01T00:00:00.000Z",
    );
}

function addPositionObservation(
  database: DatabaseSync,
  input: AcceptedPositionInput,
) {
  const importId = `import_${input.observationId}`;
  const rowId = `row_${input.observationId}`;
  const documentId = `document_${input.observationId}`;
  const snapshotId = input.reuseSnapshotId ?? `snapshot_${input.observationId}`;
  const snapshotFingerprint =
    input.snapshotFingerprint ?? input.observationDigest;
  const effectiveDate = input.observedAt.slice(0, 10);

  database
    .prepare(
      `INSERT INTO source_documents (
         id, household_id, object_key, file_name, content_type, byte_size,
         sha256, effective_date, retrieved_at, source_label, review_status,
         created_at
       ) VALUES (?, ?, ?, ?, 'application/json', 512, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      documentId,
      input.household.id,
      `holding-imports/${input.observationId}.json`,
      `${input.observationId}.json`,
      input.observationDigest,
      effectiveDate,
      input.retrievedAt,
      "Synthetic Investments",
      input.acceptObservation ? "accepted" : "pending_review",
      input.retrievedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_imports (
         id, household_id, source_document_id, provider, parser_schema,
         normalized_fingerprint, row_count, created_by, created_at
       ) VALUES (?, ?, ?, 'plaid_investments', 'synthetic-position-view-v1', ?, 1, ?, ?)`,
    )
    .run(
      importId,
      input.household.id,
      documentId,
      input.observationDigest,
      input.household.userId,
      input.retrievedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_rows (
         id, household_id, import_id, source_row_number,
         position_fingerprint, snapshot_fingerprint, legal_vehicle_name,
         owner_label, exposure_label, provider_status, invested_on,
         invested_minor, allocation_minor, unrealized_value_minor,
         unrealized_value_state, realized_value_minor, net_value_minor,
         net_value_state, instrument_type, currency_hint, parse_status,
         issue_codes_json, position_kind, quantity_micros, ticker,
         cost_basis_minor, created_at
       ) VALUES (
         ?, ?, ?, 1, ?, ?, 'Synthetic Security', 'Synthetic Account',
         'Synthetic Security', 'live', ?, 100000, 100000, ?, ?, 0, ?, ?,
         'equity', 'USD', 'ready', '[]', 'direct', 1000000, 'SYN', 100000, ?
       )`,
    )
    .run(
      rowId,
      input.household.id,
      importId,
      input.positionFingerprint,
      snapshotFingerprint,
      effectiveDate,
      input.unrealizedValueMinor,
      input.unrealizedValueState,
      input.netValueMinor,
      input.netValueState,
      input.retrievedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_connections (
         id, household_id, import_id, connection_id, created_at, immutable
       ) VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(
      `import_connection_${input.observationId}`,
      input.household.id,
      importId,
      input.connectionId,
      input.retrievedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_coverages (
         id, household_id, import_id, container_id, completeness,
         evidence_sha256, observed_at, created_at, immutable
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      `coverage_${input.observationId}`,
      input.household.id,
      importId,
      input.containerId,
      input.completeness,
      input.observationDigest,
      input.observedAt,
      input.retrievedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_row_containers (
         id, household_id, import_row_id, container_id, created_at, immutable
       ) VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(
      `row_container_${input.observationId}`,
      input.household.id,
      rowId,
      input.containerId,
      input.retrievedAt,
    );

  if (input.createPosition) {
    database
      .prepare(
        `INSERT INTO holding_positions (
           id, household_id, provider, position_fingerprint,
           legal_vehicle_name, owner_label, position_kind, instrument_type,
           opened_on, currency, created_by, created_at
         ) VALUES (
           ?, ?, 'plaid_investments', ?, 'Synthetic Security', 'Synthetic Account',
           'direct', 'equity', '2026-01-15', 'USD', ?, ?
         )`,
      )
      .run(
        input.positionId,
        input.household.id,
        input.positionFingerprint,
        input.household.userId,
        input.retrievedAt,
      );
    database
      .prepare(
        `INSERT INTO holding_position_ownerships (
           id, household_id, container_id, position_id,
           protected_position_key, association_basis, evidence_sha256,
           version, supersedes_ownership_id, accepted_by_user_id, accepted_at,
           immutable
         ) VALUES (?, ?, ?, ?, ?, 'provider_provenance', ?, 1, NULL, ?, ?, 1)`,
      )
      .run(
        `ownership_${input.positionId}`,
        input.household.id,
        input.containerId,
        input.positionId,
        input.positionFingerprint,
        input.observationDigest,
        input.household.userId,
        input.acceptedAt,
      );
  }

  if (!input.acceptObservation) {
    return;
  }

  database
    .prepare(
      `INSERT INTO holding_import_row_decisions (
         id, household_id, import_row_id, reviewer_user_id, decision,
         matched_position_id, currency, reviewed_snapshot_fingerprint,
         rationale, decision_source, policy_version, reason_codes_json,
         decided_at
       ) VALUES (
         ?, ?, ?, ?, 'accepted', ?, 'USD', ?, 'Accepted synthetic position.',
         'manual', NULL, '[]', ?
       )`,
    )
    .run(
      `decision_${input.observationId}`,
      input.household.id,
      rowId,
      input.household.userId,
      input.positionId,
      snapshotFingerprint,
      input.acceptedAt,
    );
  if (input.reuseSnapshotId === undefined) {
    database
      .prepare(
        `INSERT INTO holding_position_snapshots (
           id, household_id, position_id, source_document_id,
           source_import_row_id, snapshot_fingerprint, provider_status,
           invested_minor, allocation_minor, unrealized_value_minor,
           unrealized_value_state, realized_value_minor, net_value_minor,
           net_value_state, instrument_type, currency, observed_at,
           quantity_micros, ticker, cost_basis_minor, created_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, 'live', 100000, 100000, ?, ?, 0, ?, ?, 'equity',
           'USD', ?, 1000000, 'SYN', 100000, ?
         )`,
      )
      .run(
        snapshotId,
        input.household.id,
        input.positionId,
        documentId,
        rowId,
        snapshotFingerprint,
        input.unrealizedValueMinor,
        input.unrealizedValueState,
        input.netValueMinor,
        input.netValueState,
        input.observedAt,
        input.acceptedAt,
      );
  }
  database
    .prepare(
      `INSERT INTO holding_import_applications (
         id, household_id, import_row_id, decision_id, position_id,
         snapshot_id, outcome, applied_by, applied_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `application_${input.observationId}`,
      input.household.id,
      rowId,
      `decision_${input.observationId}`,
      input.positionId,
      snapshotId,
      input.reuseSnapshotId === undefined
        ? input.createPosition
          ? "created_position"
          : "appended_snapshot"
        : "no_change",
      input.household.userId,
      input.acceptedAt,
    );
}

function addZeroRowCoverage(
  database: DatabaseSync,
  input: {
    readonly household: TestHousehold;
    readonly connectionId: string;
    readonly containerId: string;
    readonly observationId: string;
    readonly observationDigest: string;
    readonly observedAt: string;
    readonly retrievedAt: string;
    readonly completeness?: "complete" | "ambiguous";
  },
) {
  const documentId = `document_${input.observationId}`;
  const importId = `import_${input.observationId}`;
  const effectiveDate = input.observedAt.slice(0, 10);

  database
    .prepare(
      `INSERT INTO source_documents (
         id, household_id, object_key, file_name, content_type, byte_size,
         sha256, effective_date, retrieved_at, source_label, review_status,
         created_at
       ) VALUES (?, ?, ?, ?, 'application/json', 256, ?, ?, ?, ?, 'accepted', ?)`,
    )
    .run(
      documentId,
      input.household.id,
      `holding-imports/${input.observationId}.json`,
      `${input.observationId}.json`,
      input.observationDigest,
      effectiveDate,
      input.retrievedAt,
      "Synthetic Investments",
      input.retrievedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_imports (
         id, household_id, source_document_id, provider, parser_schema,
         normalized_fingerprint, row_count, created_by, created_at
       ) VALUES (?, ?, ?, 'plaid_investments', 'synthetic-position-view-v1', ?, 0, ?, ?)`,
    )
    .run(
      importId,
      input.household.id,
      documentId,
      input.observationDigest,
      input.household.userId,
      input.retrievedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_connections (
         id, household_id, import_id, connection_id, created_at, immutable
       ) VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(
      `import_connection_${input.observationId}`,
      input.household.id,
      importId,
      input.connectionId,
      input.retrievedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_coverages (
         id, household_id, import_id, container_id, completeness,
         evidence_sha256, observed_at, created_at, immutable
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      `coverage_${input.observationId}`,
      input.household.id,
      importId,
      input.containerId,
      input.completeness ?? "complete",
      input.observationDigest,
      input.observedAt,
      input.retrievedAt,
    );
}

function tableCounts(database: DatabaseSync) {
  return database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM holding_positions) AS positions,
         (SELECT COUNT(*) FROM holding_position_snapshots) AS snapshots,
         (SELECT COUNT(*) FROM portfolio_baselines) AS baselines,
         (SELECT COUNT(*) FROM goals) AS goals,
         (SELECT COUNT(*) FROM forecast_snapshots) AS forecasts`,
    )
    .get();
}

describe("canonical investment position view", () => {
  let sqlite: DatabaseSync;
  let repository: D1InvestmentPositionViewRepository;
  const demoHousehold = { id: "hh_demo", userId: "usr_demo" } as const;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of migrationFiles) {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    }
    repository = new D1InvestmentPositionViewRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    );
  });

  afterEach(() => sqlite.close());

  it("returns an empty read model and fails closed for an unknown subject", async () => {
    await expect(
      repository.list("synthetic-access-subject", "2026-08-16T12:00:00.000Z"),
    ).resolves.toEqual({
      asOf: "2026-08-16T12:00:00.000Z",
      connections: [],
    });
    await expect(
      repository.list("missing-subject", "2026-08-16T12:00:00.000Z"),
    ).rejects.toThrow(/Household not found/u);
  });

  it("derives reviewed-history purpose only from the reserved connection id", async () => {
    addConnection(sqlite, demoHousehold, {
      id: "connection_with_history_text",
      protectedSourceKey: digest("7"),
      institutionKey: "reviewed-history:angellist",
      institutionLabel: "Synthetic reviewed history text",
    });
    addContainer(sqlite, demoHousehold, {
      id: "container_unresolved_source",
      connectionId: "connection_with_history_text",
      protectedAccountKey: digest("6"),
      label: "Synthetic unresolved source account",
      kind: "unresolved",
      taxTreatment: "unknown",
    });
    addZeroRowCoverage(sqlite, {
      household: demoHousehold,
      connectionId: "connection_with_history_text",
      containerId: "container_unresolved_source",
      observationId: "unresolved_source",
      observationDigest: digest("5"),
      observedAt: "2026-08-15T12:00:00.000Z",
      retrievedAt: "2026-08-15T12:05:00.000Z",
      completeness: "ambiguous",
    });
    addConnection(sqlite, demoHousehold, {
      id: "reconciled-holding-connection-v1:hh_demo:angellist",
      adapterType: "angellist-import",
      protectedSourceKey: digest("8"),
      institutionKey: "synthetic-history",
      institutionLabel: "Synthetic reconciled history",
      credentialReference: null,
      lifecycleState: "pending",
    });

    const view = await repository.list(
      "synthetic-access-subject",
      "2026-08-16T12:00:00.000Z",
    );

    expect(
      view.connections.find(
        (connection) => connection.id === "connection_with_history_text",
      ),
    ).toMatchObject({
      purpose: "source",
      containers: [
        {
          id: "container_unresolved_source",
          kind: "unresolved",
          coverage: { completeness: "ambiguous" },
        },
      ],
    });
    expect(
      view.connections.find((connection) =>
        connection.id.startsWith("reconciled-holding-connection-v1:"),
      )?.purpose,
    ).toBe("reviewed_history");
  });

  it("keeps positions separate across institutions, logins, and containers while selecting exact accepted snapshots", async () => {
    addConnection(sqlite, demoHousehold, {
      id: "connection_primary",
      protectedSourceKey: digest("a"),
      institutionKey: "ins_synthetic",
      institutionLabel: "Synthetic Brokerage",
    });
    addConnection(sqlite, demoHousehold, {
      id: "connection_second_login",
      protectedSourceKey: digest("b"),
      institutionKey: "ins_synthetic",
      institutionLabel: "Synthetic Brokerage",
    });
    addConnection(sqlite, demoHousehold, {
      id: "connection_other_institution",
      protectedSourceKey: digest("0"),
      institutionKey: "ins_other_synthetic",
      institutionLabel: "Other Synthetic Custodian",
    });
    addContainer(sqlite, demoHousehold, {
      id: "container_taxable",
      connectionId: "connection_primary",
      protectedAccountKey: digest("c"),
      label: "Synthetic Taxable",
      kind: "brokerage",
      taxTreatment: "taxable",
    });
    addContainer(sqlite, demoHousehold, {
      id: "container_ira",
      connectionId: "connection_primary",
      protectedAccountKey: digest("d"),
      label: "Synthetic IRA",
      kind: "ira",
      taxTreatment: "tax_exempt",
    });
    addContainer(sqlite, demoHousehold, {
      id: "container_second_login",
      connectionId: "connection_second_login",
      protectedAccountKey: digest("e"),
      label: "Synthetic Taxable",
      kind: "brokerage",
      taxTreatment: "taxable",
    });
    addContainer(sqlite, demoHousehold, {
      id: "container_empty",
      connectionId: "connection_second_login",
      protectedAccountKey: digest("f"),
      label: "Synthetic Empty Account",
      kind: "brokerage",
      taxTreatment: "taxable",
    });
    addContainer(sqlite, demoHousehold, {
      id: "container_other_institution",
      connectionId: "connection_other_institution",
      protectedAccountKey: digest("a"),
      label: "Other Synthetic Brokerage",
      kind: "brokerage",
      taxTreatment: "taxable",
    });
    addZeroRowCoverage(sqlite, {
      household: demoHousehold,
      connectionId: "connection_second_login",
      containerId: "container_empty",
      observationId: "empty_complete",
      observationDigest: digest("9"),
      observedAt: "2026-08-16T09:00:00.000Z",
      retrievedAt: "2026-08-16T09:05:00.000Z",
    });

    addPositionObservation(sqlite, {
      household: demoHousehold,
      connectionId: "connection_primary",
      containerId: "container_taxable",
      positionId: "position_taxable_syn",
      positionFingerprint: digest("1"),
      observationId: "taxable_v1",
      observationDigest: digest("2"),
      observedAt: "2026-08-10T12:00:00.000Z",
      retrievedAt: "2026-08-10T12:05:00.000Z",
      acceptedAt: "2026-08-10T12:10:00.000Z",
      completeness: "complete",
      unrealizedValueMinor: 125_000,
      unrealizedValueState: "reported",
      netValueMinor: 125_000,
      netValueState: "reported",
      createPosition: true,
      acceptObservation: true,
    });
    addPositionObservation(sqlite, {
      household: demoHousehold,
      connectionId: "connection_primary",
      containerId: "container_taxable",
      positionId: "position_taxable_syn",
      positionFingerprint: digest("1"),
      observationId: "taxable_v2",
      observationDigest: digest("3"),
      observedAt: "2026-08-15T12:00:00.000Z",
      retrievedAt: "2026-08-15T12:05:00.000Z",
      acceptedAt: "2026-08-15T12:10:00.000Z",
      completeness: "partial",
      unrealizedValueMinor: 150_000,
      unrealizedValueState: "reported",
      netValueMinor: 150_000,
      netValueState: "reported",
      createPosition: false,
      acceptObservation: true,
    });
    addPositionObservation(sqlite, {
      household: demoHousehold,
      connectionId: "connection_primary",
      containerId: "container_taxable",
      positionId: "position_taxable_syn",
      positionFingerprint: digest("1"),
      observationId: "taxable_reversion",
      observationDigest: digest("4"),
      snapshotFingerprint: digest("2"),
      reuseSnapshotId: "snapshot_taxable_v1",
      observedAt: "2026-08-16T10:00:00.000Z",
      retrievedAt: "2026-08-16T10:05:00.000Z",
      acceptedAt: "2026-08-16T10:10:00.000Z",
      completeness: "complete",
      unrealizedValueMinor: 125_000,
      unrealizedValueState: "reported",
      netValueMinor: 125_000,
      netValueState: "reported",
      createPosition: false,
      acceptObservation: true,
    });
    addPositionObservation(sqlite, {
      household: demoHousehold,
      connectionId: "connection_primary",
      containerId: "container_taxable",
      positionId: "position_taxable_syn",
      positionFingerprint: digest("1"),
      observationId: "taxable_pending",
      observationDigest: digest("8"),
      observedAt: "2026-08-16T11:00:00.000Z",
      retrievedAt: "2026-08-16T11:05:00.000Z",
      acceptedAt: "2026-08-16T11:10:00.000Z",
      completeness: "ambiguous",
      unrealizedValueMinor: 999_000,
      unrealizedValueState: "reported",
      netValueMinor: 999_000,
      netValueState: "reported",
      createPosition: false,
      acceptObservation: false,
    });
    addPositionObservation(sqlite, {
      household: demoHousehold,
      connectionId: "connection_primary",
      containerId: "container_ira",
      positionId: "position_ira_syn",
      positionFingerprint: digest("4"),
      observationId: "ira_v1",
      observationDigest: digest("5"),
      observedAt: "2026-04-01T12:00:00.000Z",
      retrievedAt: "2026-04-01T12:05:00.000Z",
      acceptedAt: "2026-04-01T12:10:00.000Z",
      completeness: "failed",
      unrealizedValueMinor: null,
      unrealizedValueState: "locked",
      netValueMinor: null,
      netValueState: "locked",
      createPosition: true,
      acceptObservation: true,
    });
    addPositionObservation(sqlite, {
      household: demoHousehold,
      connectionId: "connection_second_login",
      containerId: "container_second_login",
      positionId: "position_second_login_syn",
      positionFingerprint: digest("6"),
      observationId: "second_login_v1",
      observationDigest: digest("7"),
      observedAt: "2026-08-14T12:00:00.000Z",
      retrievedAt: "2026-08-14T12:05:00.000Z",
      acceptedAt: "2026-08-14T12:10:00.000Z",
      completeness: "ambiguous",
      unrealizedValueMinor: 175_000,
      unrealizedValueState: "reported",
      netValueMinor: 175_000,
      netValueState: "reported",
      createPosition: true,
      acceptObservation: true,
    });
    addPositionObservation(sqlite, {
      household: demoHousehold,
      connectionId: "connection_other_institution",
      containerId: "container_other_institution",
      positionId: "position_other_institution_syn",
      positionFingerprint: digest("b"),
      observationId: "other_institution_v1",
      observationDigest: digest("6"),
      observedAt: "2026-08-13T12:00:00.000Z",
      retrievedAt: "2026-08-13T12:05:00.000Z",
      acceptedAt: "2026-08-13T12:10:00.000Z",
      completeness: "complete",
      unrealizedValueMinor: 110_000,
      unrealizedValueState: "reported",
      netValueMinor: 110_000,
      netValueState: "reported",
      createPosition: true,
      acceptObservation: true,
    });

    sqlite.exec(`
      INSERT INTO investment_connection_versions (
        id, household_id, connection_id, version, institution_key,
        institution_label, lifecycle_state, credential_reference,
        supersedes_version_id, recorded_by_user_id, recorded_at, immutable
      ) VALUES (
        'connection_primary_v2', 'hh_demo', 'connection_primary', 2,
        'ins_synthetic', 'Synthetic Brokerage Updated', 'paused',
        'connector-secrets/connection_primary-v2.json.enc',
        'connection_primary_v1', 'usr_demo', '2026-08-15T13:00:00.000Z', 1
      );
      INSERT INTO ownership_container_versions (
        id, household_id, container_id, version, display_label,
        container_kind, tax_treatment, supersedes_version_id,
        recorded_by_user_id, recorded_at, immutable
      ) VALUES (
        'container_taxable_v2', 'hh_demo', 'container_taxable', 2,
        'Synthetic Joint Taxable', 'brokerage', 'taxable',
        'container_taxable_v1', 'usr_demo', '2026-08-15T13:00:00.000Z', 1
      );
    `);

    const before = tableCounts(sqlite);
    const view = await repository.list(
      "synthetic-access-subject",
      "2026-08-16T12:00:00.000Z",
    );

    expect(view.connections).toHaveLength(3);
    expect(view.connections.map((connection) => connection.id)).toEqual([
      "connection_other_institution",
      "connection_second_login",
      "connection_primary",
    ]);
    const primary = view.connections.find(
      (connection) => connection.id === "connection_primary",
    );
    expect(primary).toMatchObject({
      institutionLabel: "Synthetic Brokerage Updated",
      lifecycleState: "paused",
    });
    expect(primary?.containers).toHaveLength(2);
    const taxable = primary?.containers.find(
      (container) => container.id === "container_taxable",
    );
    expect(taxable).toMatchObject({
      label: "Synthetic Joint Taxable",
      coverage: {
        completeness: "ambiguous",
        freshness: "current",
      },
    });
    expect(taxable?.positions).toHaveLength(1);
    expect(taxable?.positions[0]).toMatchObject({
      id: "position_taxable_syn",
      reviewStatus: "accepted",
      acceptedAt: "2026-08-16T10:10:00.000Z",
      source: {
        retrievedAt: "2026-08-16T10:05:00.000Z",
        freshness: "current",
      },
      snapshot: {
        id: "snapshot_taxable_v1",
        unrealizedValue: { state: "reported", minor: 125_000 },
      },
    });
    const ira = primary?.containers.find(
      (container) => container.id === "container_ira",
    );
    expect(ira).toMatchObject({
      coverage: { completeness: "failed", freshness: "stale" },
      positions: [
        {
          source: { freshness: "stale" },
          snapshot: {
            unrealizedValue: { state: "locked", minor: null },
            netValue: { state: "locked", minor: null },
          },
        },
      ],
    });
    expect(
      view.connections.flatMap((connection) =>
        connection.containers.flatMap((container) => container.positions),
      ),
    ).toHaveLength(4);
    expect(
      view.connections.find(
        (connection) => connection.id === "connection_other_institution",
      ),
    ).toMatchObject({
      institutionKey: "ins_other_synthetic",
      institutionLabel: "Other Synthetic Custodian",
      containers: [
        {
          id: "container_other_institution",
          positions: [{ id: "position_other_institution_syn" }],
        },
      ],
    });
    const secondLogin = view.connections.find(
      (connection) => connection.id === "connection_second_login",
    );
    expect(secondLogin?.containers).toContainEqual({
      id: "container_empty",
      label: "Synthetic Empty Account",
      kind: "brokerage",
      taxTreatment: "taxable",
      coverage: {
        completeness: "complete",
        observedAt: "2026-08-16T09:00:00.000Z",
        freshness: "current",
      },
      positions: [],
    });
    expect(tableCounts(sqlite)).toEqual(before);
    expect(JSON.stringify(view)).not.toContain(digest("a"));
    expect(JSON.stringify(view)).not.toContain("connector-secrets");
  });

  it("isolates households even when institution and position labels match", async () => {
    const otherHousehold = { id: "hh_other", userId: "usr_other" } as const;
    addHousehold(sqlite, otherHousehold, "synthetic-other-subject");
    addConnection(sqlite, otherHousehold, {
      id: "connection_other",
      protectedSourceKey: digest("8"),
      institutionKey: "ins_synthetic",
      institutionLabel: "Synthetic Brokerage",
    });
    addContainer(sqlite, otherHousehold, {
      id: "container_other",
      connectionId: "connection_other",
      protectedAccountKey: digest("9"),
      label: "Synthetic Taxable",
      kind: "brokerage",
      taxTreatment: "taxable",
    });
    addPositionObservation(sqlite, {
      household: otherHousehold,
      connectionId: "connection_other",
      containerId: "container_other",
      positionId: "position_other_syn",
      positionFingerprint: digest("a"),
      observationId: "other_v1",
      observationDigest: digest("b"),
      observedAt: "2026-08-15T12:00:00.000Z",
      retrievedAt: "2026-08-15T12:05:00.000Z",
      acceptedAt: "2026-08-15T12:10:00.000Z",
      completeness: "complete",
      unrealizedValueMinor: 999_000,
      unrealizedValueState: "reported",
      netValueMinor: 999_000,
      netValueState: "reported",
      createPosition: true,
      acceptObservation: true,
    });

    await expect(
      repository.list("synthetic-access-subject", "2026-08-16T12:00:00.000Z"),
    ).resolves.toEqual({
      asOf: "2026-08-16T12:00:00.000Z",
      connections: [],
    });
    const other = await repository.list(
      "synthetic-other-subject",
      "2026-08-16T12:00:00.000Z",
    );
    expect(other.connections).toHaveLength(1);
    expect(other.connections[0]?.containers[0]?.positions[0]?.id).toBe(
      "position_other_syn",
    );
  });
});
