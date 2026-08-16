import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
  type RobinhoodHoldingImportStageInput,
} from "./holding-imports";
import {
  holdingPositionReadModeFromFlag,
  holdingPositionReadSource,
} from "./holding-position-compatibility";
import { D1AlphaRepository } from "./index";
import { D1PortfolioBaselineRepository } from "./portfolio-baseline";

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
  "packages/database/migrations/0019_multi_source_holdings_contract.sql",
] as const;

const legacyAssociationMigration =
  "packages/database/migrations/0020_legacy_holding_associations.sql";
const seedFile = "packages/database/seed/synthetic.sql";
const accessSubject = "synthetic-access-subject";

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

  public run(): Promise<{ meta: { changes: number } }> {
    const result = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }

  public execute(): void {
    this.database.prepare(this.sql).run(...this.values);
  }
}

class TestD1Database {
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
    this.database.exec("BEGIN");
    try {
      statements.forEach((statement) => statement.execute());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return Promise.resolve();
  }
}

function apply(database: DatabaseSync, files: readonly string[]) {
  for (const file of files) {
    database.exec(readFileSync(resolve(file), "utf8"));
  }
}

const planningTables = [
  "holding_positions",
  "holding_position_snapshots",
  "portfolio_baselines",
  "portfolio_baseline_items",
  "goals",
  "goal_versions",
  "goal_forecast_snapshots",
  "cash_flow_plans",
  "forecast_snapshots",
  "forecast_outputs",
] as const;

function planningState(database: DatabaseSync) {
  return Object.fromEntries(
    planningTables.map((table) => [
      table,
      database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
    ]),
  );
}

function angelListInput(): HoldingImportStageInput {
  const shared = {
    companyOrFund: "Synthetic Navigation Systems",
    status: "Live",
    investDate: "2025-04-12",
    investedMinor: 2_500_000,
    realizedValueMinor: 0,
    multiplePpm: 1_000_000,
    investmentEntity: "Synthetic Family Trust",
    lead: "Synthetic Ventures",
    investmentType: "Syndicate",
    source: null,
    round: "Seed",
    market: "Navigation",
    dealMetadata: {
      allocationMinor: 2_500_000,
      instrument: "safe",
      roundSizeMinor: 25_000_000,
      valuationOrCapType: "Post-money",
      valuationOrCapMinor: 100_000_000,
      discount: null,
      carry: "20%",
      shareClass: null,
    },
  } as const;
  return {
    objectKey: "holding-imports/synthetic-legacy-angellist.csv",
    sha256: "1".repeat(64),
    byteSize: 2_048,
    effectiveDate: "2026-08-10",
    retrievedAt: "2026-08-10T12:00:00.000Z",
    rows: [
      {
        ...shared,
        rowNumber: 3,
        naturalKeySha256: "2".repeat(64),
        fundName: "Synthetic Navigation SPV A",
        unrealizedValueMinor: 3_000_000,
        unrealizedValueState: "reported",
        netValueMinor: 3_000_000,
        netValueState: "reported",
      },
      {
        ...shared,
        rowNumber: 4,
        naturalKeySha256: "3".repeat(64),
        fundName: "Synthetic Navigation SPV B",
        unrealizedValueMinor: null,
        unrealizedValueState: "locked",
        netValueMinor: null,
        netValueState: "locked",
        multiplePpm: null,
      },
    ],
  };
}

function robinhoodInput(input: {
  readonly naturalKey: string;
  readonly normalizedFingerprint: string;
  readonly sha256: string;
  readonly name: string;
  readonly ticker: string;
  readonly valueMinor: number;
}): RobinhoodHoldingImportStageInput {
  return {
    objectKey: `holding-imports/${input.name.toLowerCase().replaceAll(" ", "-")}.json`,
    sha256: input.sha256,
    byteSize: 2_048,
    normalizedFingerprint: input.normalizedFingerprint,
    effectiveDate: "2026-08-11",
    retrievedAt: "2026-08-11T12:00:00.000Z",
    rows: [
      {
        rowNumber: 1,
        naturalKeySha256: input.naturalKey,
        securityName: input.name,
        ticker: input.ticker,
        securityType: "equity",
        accountLabel: "Robinhood brokerage",
        quantityMicros: 12_000_000,
        costBasisMinor: 100_000,
        marketValueMinor: input.valueMinor,
        observedOn: "2026-08-11",
        currency: "USD",
        issues: [],
      },
    ],
  };
}

async function acceptImport(
  repository: D1HoldingImportRepository,
  preview: Awaited<ReturnType<D1HoldingImportRepository["getHoldingImport"]>>,
) {
  await repository.applyHoldingImport(accessSubject, preview.id, {
    currency: "USD",
    decisions: preview.rows.map((row) => ({
      rowId: row.id,
      decision: "accepted" as const,
      rationale: "Reviewed synthetic legacy association fixture.",
    })),
  });
}

async function installLegacyFixture(
  sqlite: DatabaseSync,
  database: TestD1Database,
) {
  const imports = new D1HoldingImportRepository(
    database as unknown as D1Database,
  );
  const angelList = await imports.stageHoldingImport(
    accessSubject,
    angelListInput(),
  );
  await acceptImport(imports, angelList.preview);

  const proven = await imports.stageRobinhoodHoldingImport(
    accessSubject,
    robinhoodInput({
      naturalKey: "4".repeat(64),
      normalizedFingerprint: "5".repeat(64),
      sha256: "6".repeat(64),
      name: "Synthetic Proven Security",
      ticker: "SPS",
      valueMinor: 125_000,
    }),
  );
  await acceptImport(imports, proven.preview);
  sqlite.exec(`
    INSERT INTO connector_accounts (
      id, household_id, connector_type, display_label, secret_reference,
      status, last_synced_at, created_at, provider_account_key
    ) VALUES (
      'connector_robinhood_proven', 'hh_demo', 'plaid-investments',
      'Robinhood', 'connector-secrets/synthetic-robinhood.enc', 'active',
      '2026-08-11T12:00:00.000Z', '2026-08-11T11:00:00.000Z',
      '${"7".repeat(64)}'
    );
    INSERT INTO connector_sync_runs (
      id, household_id, connector_account_id, status, started_at, finished_at,
      cursor, discovered_count, proposed_count
    ) VALUES (
      'sync_robinhood_proven', 'hh_demo', 'connector_robinhood_proven',
      'succeeded', '2026-08-11T11:55:00.000Z',
      '2026-08-11T12:00:00.000Z', NULL, 1, 1
    );
    INSERT INTO connector_sync_imports (
      id, household_id, sync_run_id, holding_import_id, created_at
    ) VALUES (
      'sync_import_robinhood_proven', 'hh_demo', 'sync_robinhood_proven',
      '${proven.preview.id}', '2026-08-11T12:00:00.000Z'
    );
  `);

  const ambiguous = await imports.stageRobinhoodHoldingImport(
    accessSubject,
    robinhoodInput({
      naturalKey: "8".repeat(64),
      normalizedFingerprint: "9".repeat(64),
      sha256: "d".repeat(64),
      name: "Synthetic Unresolved Security",
      ticker: "SUS",
      valueMinor: 75_000,
    }),
  );
  await acceptImport(imports, ambiguous.preview);

  const baselines = new D1PortfolioBaselineRepository(
    database as unknown as D1Database,
  );
  const state = await baselines.getState(accessSubject);
  if (
    state.sourceRevision === null ||
    state.baseForecastSnapshotId === null ||
    state.baseForecastSnapshotVersion === null
  ) {
    throw new Error("Expected a confirmable synthetic legacy baseline.");
  }
  await baselines.confirm(accessSubject, {
    sourceRevision: state.sourceRevision,
    baseForecastSnapshotId: state.baseForecastSnapshotId,
    baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
    otherFiEligibleLiquidMinor: state.suggestedOtherFiEligibleLiquidMinor,
    duplicateReviewConfirmed: true,
    cashOverlapReviewConfirmed: true,
    changeNote: "Confirmed the synthetic pre-migration baseline.",
  });
}

describe("legacy holding association migration", () => {
  let sqlite: DatabaseSync;
  let database: TestD1Database;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    database = new TestD1Database(sqlite);
  });

  afterEach(() => sqlite.close());

  it("associates every shipped position without changing money or planning history", async () => {
    apply(sqlite, [...priorMigrationFiles, seedFile]);
    await installLegacyFixture(sqlite, database);
    const beforePlanning = planningState(sqlite);
    const beforeAlpha = await new D1AlphaRepository(
      database as unknown as D1Database,
    ).getAlphaData(accessSubject);
    const beforeBaseline = await new D1PortfolioBaselineRepository(
      database as unknown as D1Database,
    ).getState(accessSubject);

    apply(sqlite, [legacyAssociationMigration]);

    expect(planningState(sqlite)).toEqual(beforePlanning);
    const legacyAlpha = await new D1AlphaRepository(
      database as unknown as D1Database,
      { holdingPositionReadMode: "legacy" },
    ).getAlphaData(accessSubject);
    const compatibleAlpha = await new D1AlphaRepository(
      database as unknown as D1Database,
      { holdingPositionReadMode: "compatibility" },
    ).getAlphaData(accessSubject);
    expect(legacyAlpha).toEqual(beforeAlpha);
    expect(compatibleAlpha).toEqual(beforeAlpha);

    const legacyBaseline = await new D1PortfolioBaselineRepository(
      database as unknown as D1Database,
      { holdingPositionReadMode: "legacy" },
    ).getState(accessSubject);
    const compatibleBaseline = await new D1PortfolioBaselineRepository(
      database as unknown as D1Database,
      { holdingPositionReadMode: "compatibility" },
    ).getState(accessSubject);
    expect(legacyBaseline).toEqual(beforeBaseline);
    expect(compatibleBaseline).toEqual(beforeBaseline);

    expect(
      sqlite
        .prepare(
          `SELECT
             (SELECT COUNT(*)
              FROM holding_positions position
              WHERE position.provider IN ('angellist', 'robinhood')
                AND NOT EXISTS (
                  SELECT 1 FROM current_holding_position_ownerships ownership
                  WHERE ownership.position_id = position.id
                )) AS orphaned,
             (SELECT COUNT(*) FROM (
                SELECT position_id
                FROM current_holding_position_ownerships
                GROUP BY position_id
                HAVING COUNT(*) <> 1
              )) AS multiply_assigned,
             (SELECT COUNT(*)
              FROM current_holding_position_ownerships ownership
              JOIN holding_positions position ON position.id = ownership.position_id
              JOIN ownership_containers container ON container.id = ownership.container_id
              JOIN investment_connections connection
                ON connection.id = container.connection_id
              WHERE ownership.household_id <> position.household_id
                 OR ownership.household_id <> container.household_id
                 OR ownership.household_id <> connection.household_id) AS mismatched,
             (SELECT COUNT(*) FROM holding_import_coverages) AS coverages`,
        )
        .get(),
    ).toEqual({
      orphaned: 0,
      multiply_assigned: 0,
      mismatched: 0,
      coverages: 0,
    });

    const compatibleRows = sqlite
      .prepare(
        `SELECT legal_vehicle_name, provider, association_basis,
                protected_source_key, container_id, container_label,
                container_kind, tax_treatment, association_state,
                omission_eligible
         FROM holding_position_compatibility
         ORDER BY provider, legal_vehicle_name`,
      )
      .all() as Array<Record<string, string | number>>;
    expect(compatibleRows).toHaveLength(4);
    expect(compatibleRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legal_vehicle_name: "Synthetic Proven Security",
          provider: "robinhood",
          association_basis: "provider_provenance",
          protected_source_key: "7".repeat(64),
          container_kind: "unresolved",
          tax_treatment: "unknown",
          association_state: "unresolved",
          omission_eligible: 0,
        }),
        expect.objectContaining({
          legal_vehicle_name: "Synthetic Unresolved Security",
          provider: "robinhood",
          association_basis: "reviewed_legacy",
          container_kind: "unresolved",
          omission_eligible: 0,
        }),
      ]),
    );
    const angelListRows = compatibleRows.filter(
      (row) => row.provider === "angellist",
    );
    expect(angelListRows).toHaveLength(2);
    expect(new Set(angelListRows.map((row) => row.container_id)).size).toBe(2);
    expect(angelListRows.map((row) => row.legal_vehicle_name).sort()).toEqual([
      "Synthetic Navigation SPV A",
      "Synthetic Navigation SPV B",
    ]);
    expect(
      angelListRows.every(
        (row) =>
          row.container_label === "Synthetic Family Trust" &&
          row.container_kind === "unresolved" &&
          row.omission_eligible === 0,
      ),
    ).toBe(true);
  });

  it("replays fresh, associates later legacy writes, and can disable compatibility reads", async () => {
    apply(sqlite, [
      ...priorMigrationFiles,
      legacyAssociationMigration,
      seedFile,
    ]);
    const imports = new D1HoldingImportRepository(
      database as unknown as D1Database,
    );
    const staged = await imports.stageHoldingImport(
      accessSubject,
      angelListInput(),
    );
    await acceptImport(imports, staged.preview);
    apply(sqlite, [seedFile]);

    expect(
      sqlite
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM holding_positions) AS positions,
             (SELECT COUNT(*) FROM current_holding_position_ownerships) AS ownerships,
             (SELECT COUNT(*) FROM holding_position_compatibility) AS compatible,
             (SELECT SUM(omission_eligible)
              FROM holding_position_compatibility) AS omission_eligible`,
        )
        .get(),
    ).toEqual({
      positions: 2,
      ownerships: 2,
      compatible: 2,
      omission_eligible: 0,
    });

    const legacy = await new D1AlphaRepository(
      database as unknown as D1Database,
      { holdingPositionReadMode: "legacy" },
    ).getAlphaData(accessSubject);
    const compatible = await new D1AlphaRepository(
      database as unknown as D1Database,
      { holdingPositionReadMode: "compatibility" },
    ).getAlphaData(accessSubject);
    expect(compatible).toEqual(legacy);
  });
});

describe("holding compatibility read configuration", () => {
  it("enables only an explicit validated flag and otherwise stays legacy", () => {
    expect(holdingPositionReadModeFromFlag("true")).toBe("compatibility");
    expect(holdingPositionReadModeFromFlag("false")).toBe("legacy");
    expect(holdingPositionReadModeFromFlag(undefined)).toBe("legacy");
    expect(holdingPositionReadSource("compatibility")).toBe(
      "holding_position_compatibility",
    );
    expect(() => holdingPositionReadModeFromFlag("yes")).toThrow();
  });
});
