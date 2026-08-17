import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { D1ExposureRepository } from "./exposures";
import { D1InvestmentExposureViewRepository } from "./exposure-read-model";
import { D1AlphaRepository } from "./index";

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
  "packages/database/seed/synthetic.sql",
] as const;

const accessSubject = "synthetic-access-subject";
const recordedAt = "2026-08-15T22:00:00.000Z";

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
}

class TestD1Database {
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }

  public async batch(
    statements: TestD1Statement[],
  ): Promise<{ meta: { changes: number } }[]> {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function seedManualConnection(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO investment_connections (
         id, household_id, adapter_type, protected_source_key,
         created_by_user_id, created_at, immutable
       ) VALUES (?, 'hh_demo', 'manual', ?, 'usr_demo', ?, 1)`,
    )
    .run("connection_exposure_test", hash("exposure-test-source"), recordedAt);
  database
    .prepare(
      `INSERT INTO investment_connection_versions (
         id, household_id, connection_id, version, institution_key,
         institution_label, lifecycle_state, credential_reference,
         supersedes_version_id, recorded_by_user_id, recorded_at, immutable
       ) VALUES (?, 'hh_demo', ?, 1, 'manual-test', 'Synthetic institutions',
         'pending', NULL, NULL, 'usr_demo', ?, 1)`,
    )
    .run("connection_exposure_test_v1", "connection_exposure_test", recordedAt);
}

function seedAcceptedPosition(
  database: DatabaseSync,
  input: {
    id: string;
    label: string;
    provider?: "angellist" | "manual";
    reportedExposureName?: string;
    positionKind: "direct" | "spv_interest" | "fund_interest";
    valueMinor: number | null;
    valueState: "reported" | "locked" | "not_reported";
    containerKind?: "brokerage" | "ira" | "entity";
  },
): void {
  const containerId = `container_${input.id}`;
  const importId = `import_${input.id}`;
  const rowId = `row_${input.id}`;
  const positionFingerprint = hash(`position:${input.id}`);
  const snapshotFingerprint = hash(`snapshot:${input.id}`);
  const sourceSha256 = hash(`source:${input.id}`);

  database
    .prepare(
      `INSERT INTO ownership_containers (
         id, household_id, connection_id, protected_account_key,
         created_by_user_id, created_at, immutable
       ) VALUES (?, 'hh_demo', 'connection_exposure_test', ?, 'usr_demo', ?, 1)`,
    )
    .run(containerId, hash(`container:${input.id}`), recordedAt);
  database
    .prepare(
      `INSERT INTO ownership_container_versions (
         id, household_id, container_id, version, display_label,
         container_kind, tax_treatment, supersedes_version_id,
         recorded_by_user_id, recorded_at, immutable
       ) VALUES (?, 'hh_demo', ?, 1, ?, ?, 'unknown', NULL, 'usr_demo', ?, 1)`,
    )
    .run(
      `${containerId}_v1`,
      containerId,
      `${input.label} account`,
      input.containerKind ?? "entity",
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO source_documents (
         id, household_id, object_key, file_name, content_type, byte_size,
         sha256, effective_date, retrieved_at, source_label, review_status,
         created_at
       ) VALUES (?, 'hh_demo', ?, 'synthetic.json', 'application/json', 256,
         ?, '2026-08-15', ?, 'Synthetic exposure test', 'accepted', ?)`,
    )
    .run(
      `document_${input.id}`,
      `holding-imports/${input.id}.json`,
      sourceSha256,
      recordedAt,
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_imports (
         id, household_id, source_document_id, provider, parser_schema,
         row_count, created_by, created_at
       ) VALUES (?, 'hh_demo', ?, 'angellist', 'synthetic_exposure_v1', 1,
         'usr_demo', ?)`,
    )
    .run(importId, `document_${input.id}`, recordedAt);
  database
    .prepare(
      `INSERT INTO holding_import_connections (
         id, household_id, import_id, connection_id, created_at, immutable
       ) VALUES (?, 'hh_demo', ?, 'connection_exposure_test', ?, 1)`,
    )
    .run(`import_connection_${input.id}`, importId, recordedAt);
  database
    .prepare(
      `INSERT INTO holding_import_coverages (
         id, household_id, import_id, container_id, completeness,
         evidence_sha256, observed_at, created_at, immutable
       ) VALUES (?, 'hh_demo', ?, ?, 'complete', ?, ?, ?, 1)`,
    )
    .run(
      `coverage_${input.id}`,
      importId,
      containerId,
      sourceSha256,
      recordedAt,
      recordedAt,
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
       ) VALUES (?, 'hh_demo', ?, 1, ?, ?, ?, 'Synthetic owner', ?, 'live',
         '2026-08-15', 0, 0, ?, ?, 0, ?, ?, ?, 'USD', 'ready', '[]', ?,
         NULL, NULL, NULL, ?)`,
    )
    .run(
      rowId,
      importId,
      positionFingerprint,
      snapshotFingerprint,
      input.label,
      input.reportedExposureName ?? input.label,
      input.valueMinor,
      input.valueState,
      input.valueMinor,
      input.valueState,
      input.positionKind === "direct" ? "equity" : "private interest",
      input.positionKind,
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_row_containers (
         id, household_id, import_row_id, container_id, created_at, immutable
       ) VALUES (?, 'hh_demo', ?, ?, ?, 1)`,
    )
    .run(`row_container_${input.id}`, rowId, containerId, recordedAt);
  database
    .prepare(
      `INSERT INTO holding_positions (
         id, household_id, provider, position_fingerprint, legal_vehicle_name,
         owner_label, position_kind, instrument_type, opened_on, currency,
         created_by, created_at
       ) VALUES (?, 'hh_demo', ?, ?, ?, 'Synthetic owner', ?, ?, NULL,
         'USD', 'usr_demo', ?)`,
    )
    .run(
      input.id,
      input.provider ?? "manual",
      positionFingerprint,
      input.label,
      input.positionKind,
      input.positionKind === "direct" ? "equity" : "private interest",
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_position_exposures (
         id, household_id, position_id, exposure_label, exposure_kind,
         company_id, created_at
       ) VALUES (?, 'hh_demo', ?, ?, 'unresolved', NULL, ?)`,
    )
    .run(
      `reported_exposure_${input.id}`,
      input.id,
      input.reportedExposureName ?? input.label,
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_position_ownerships (
         id, household_id, container_id, position_id, protected_position_key,
         association_basis, evidence_sha256, version,
         supersedes_ownership_id, accepted_by_user_id, accepted_at, immutable
       ) VALUES (?, 'hh_demo', ?, ?, ?, 'manual', ?, 1, NULL, 'usr_demo', ?, 1)`,
    )
    .run(
      `ownership_${input.id}`,
      containerId,
      input.id,
      positionFingerprint,
      sourceSha256,
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_row_decisions (
         id, household_id, import_row_id, reviewer_user_id, decision,
         matched_position_id, currency, reviewed_snapshot_fingerprint,
         rationale, decided_at
       ) VALUES (?, 'hh_demo', ?, 'usr_demo', 'accepted', ?, 'USD', ?,
         'Reviewed synthetic exposure test.', ?)`,
    )
    .run(
      `decision_${input.id}`,
      rowId,
      input.id,
      snapshotFingerprint,
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_position_snapshots (
         id, household_id, position_id, source_document_id,
         source_import_row_id, snapshot_fingerprint, provider_status,
         invested_minor, allocation_minor, unrealized_value_minor,
         unrealized_value_state, realized_value_minor, net_value_minor,
         net_value_state, instrument_type, currency, observed_at, created_at
       ) VALUES (?, 'hh_demo', ?, ?, ?, ?, 'live', 0, 0, ?, ?, 0, ?, ?, ?,
         'USD', ?, ?)`,
    )
    .run(
      `snapshot_${input.id}`,
      input.id,
      `document_${input.id}`,
      rowId,
      snapshotFingerprint,
      input.valueMinor,
      input.valueState,
      input.valueMinor,
      input.valueState,
      input.positionKind === "direct" ? "equity" : "private interest",
      recordedAt,
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_applications (
         id, household_id, import_row_id, decision_id, position_id,
         snapshot_id, outcome, applied_by, applied_at
       ) VALUES (?, 'hh_demo', ?, ?, ?, ?, 'created_position', 'usr_demo', ?)`,
    )
    .run(
      `application_${input.id}`,
      rowId,
      `decision_${input.id}`,
      input.id,
      `snapshot_${input.id}`,
      recordedAt,
    );
}

describe("canonical exposure resolution and aggregation", () => {
  let sqlite: DatabaseSync;
  let repository: D1ExposureRepository;
  let readModel: D1InvestmentExposureViewRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    seedManualConnection(sqlite);
    const database = new TestD1Database(sqlite) as unknown as D1Database;
    repository = new D1ExposureRepository(database);
    readModel = new D1InvestmentExposureViewRepository(database);
  });

  afterEach(() => sqlite.close());

  it("retires the three preview demo lots without deleting accepted history", async () => {
    const alpha = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData(accessSubject);
    expect(alpha.holdings.map((holding) => holding.id)).not.toEqual(
      expect.arrayContaining([
        "lot_harbor_spv",
        "lot_lattice_seriesa",
        "lot_northstar_seed",
      ]),
    );
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM asset_lots
           WHERE id IN (
             'lot_harbor_spv',
             'lot_lattice_seriesa',
             'lot_northstar_seed'
           )`,
        )
        .get(),
    ).toEqual({ count: 3 });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM asset_lot_retirements
           WHERE reason = 'preview_demo_cleanup'`,
        )
        .get(),
    ).toEqual({ count: 3 });
    expect(() =>
      sqlite
        .prepare(
          `UPDATE asset_lot_retirements
           SET retired_at = '2026-08-17T00:00:00.000Z'
           WHERE asset_lot_id = 'lot_harbor_spv'`,
        )
        .run(),
    ).toThrow(/asset lot retirements are immutable/u);
    expect(() =>
      sqlite
        .prepare(
          `DELETE FROM asset_lot_retirements
           WHERE asset_lot_id = 'lot_harbor_spv'`,
        )
        .run(),
    ).toThrow(/asset lot retirements are immutable/u);
  });

  it("groups one public security across three accounts without merging positions", async () => {
    seedAcceptedPosition(sqlite, {
      id: "position_nvda_robinhood",
      label: "NVDA shares in Robinhood",
      positionKind: "direct",
      valueMinor: 1_000_000,
      valueState: "reported",
      containerKind: "brokerage",
    });
    seedAcceptedPosition(sqlite, {
      id: "position_nvda_fidelity_brokerage",
      label: "NVDA shares in Fidelity brokerage",
      positionKind: "direct",
      valueMinor: 2_000_000,
      valueState: "reported",
      containerKind: "brokerage",
    });
    seedAcceptedPosition(sqlite, {
      id: "position_nvda_fidelity_ira",
      label: "NVDA shares in Fidelity IRA",
      positionKind: "direct",
      valueMinor: 3_000_000,
      valueState: "reported",
      containerKind: "ira",
    });

    const exposure = await repository.resolveExposure(accessSubject, {
      exposureKind: "public_instrument",
      canonicalName: "NVIDIA common equity",
      protectedIdentityKey: hash("cusip:67066G104"),
      evidenceSha256: hash("synthetic NVDA identity evidence"),
    });
    const repeated = await repository.resolveExposure(accessSubject, {
      exposureKind: "public_instrument",
      canonicalName: "NVIDIA Corporation common stock",
      protectedIdentityKey: hash("cusip:67066G104"),
      evidenceSha256: hash("later synthetic NVDA identity evidence"),
    });
    expect(repeated.id).toBe(exposure.id);

    for (const positionId of [
      "position_nvda_robinhood",
      "position_nvda_fidelity_brokerage",
      "position_nvda_fidelity_ira",
    ]) {
      await repository.recordMapping(accessSubject, {
        positionId,
        exposureId: exposure.id,
        relationshipKind: "direct",
        allocationPpm: 1_000_000,
        status: "active",
        decisionSource: "deterministic_policy",
        decisionReference: "public-strong-identifier-v1:cusip",
        evidenceSha256: hash(`evidence:${positionId}`),
        effectiveAt: recordedAt,
      });
    }

    const projection = await readModel.list(
      accessSubject,
      "2026-08-16T12:00:00.000Z",
    );
    const grouped = projection.exposures.find(
      (candidate) => candidate.exposure.id === exposure.id,
    );
    expect(grouped).toMatchObject({
      contributions: [
        { allocatedValueMinor: 2_000_000 },
        { allocatedValueMinor: 3_000_000 },
        { allocatedValueMinor: 1_000_000 },
      ],
      totals: [
        {
          currency: "USD",
          allocatedValueMinor: 6_000_000,
          knownValuePositionCount: 3,
          unknownValuePositionCount: 0,
        },
      ],
    });
    expect(
      projection.positions.filter((position) =>
        position.mappedExposureIds.includes(exposure.id),
      ),
    ).toHaveLength(3);
    expect(
      projection.positions.find(
        (position) => position.id === "position_nvda_fidelity_ira",
      ),
    ).toMatchObject({
      connectionId: "connection_exposure_test",
      containerKind: "ira",
      snapshotId: "snapshot_position_nvda_fidelity_ira",
      mappings: [
        {
          decisionSource: "deterministic_policy",
          decisionReference: "public-strong-identifier-v1:cusip",
        },
      ],
    });
  });

  it("groups reviewed SPVs and leaves unknown fund allocations on the position", async () => {
    sqlite
      .prepare(
        `INSERT INTO companies (
           id, household_id, legal_name, website_host, status, created_at,
           updated_at
         ) VALUES ('co_anthropic_test', 'hh_demo', 'Anthropic',
           'anthropic.com', 'active', ?, ?)`,
      )
      .run(recordedAt, recordedAt);
    seedAcceptedPosition(sqlite, {
      id: "position_anthropic_spv_a",
      label: "Synthetic Anthropic SPV A",
      positionKind: "spv_interest",
      valueMinor: 4_000_000,
      valueState: "reported",
    });
    seedAcceptedPosition(sqlite, {
      id: "position_anthropic_spv_b",
      label: "Synthetic Anthropic SPV B",
      positionKind: "spv_interest",
      valueMinor: 6_000_000,
      valueState: "reported",
    });
    seedAcceptedPosition(sqlite, {
      id: "position_multi_company_spv",
      label: "Synthetic multi-company SPV",
      positionKind: "fund_interest",
      valueMinor: 5_000_000,
      valueState: "reported",
    });

    const anthropic = await repository.resolveExposure(accessSubject, {
      exposureKind: "private_company",
      canonicalName: "Anthropic",
      companyId: "co_anthropic_test",
      evidenceSha256: hash("reviewed Anthropic company evidence"),
    });
    for (const positionId of [
      "position_anthropic_spv_a",
      "position_anthropic_spv_b",
    ]) {
      await repository.recordMapping(accessSubject, {
        positionId,
        exposureId: anthropic.id,
        relationshipKind: "look_through",
        allocationPpm: 1_000_000,
        status: "active",
        decisionSource: "review",
        decisionReference: "synthetic reviewed SPV relationship",
        evidenceSha256: hash(`mapping:${positionId}`),
        effectiveAt: recordedAt,
      });
    }
    const [northstar, harbor] = await Promise.all([
      repository.resolveExposure(accessSubject, {
        exposureKind: "private_company",
        canonicalName: "Northstar Robotics",
        companyId: "co_northstar",
        evidenceSha256: hash("reviewed Northstar company evidence"),
      }),
      repository.resolveExposure(accessSubject, {
        exposureKind: "private_company",
        canonicalName: "Harbor Health Systems",
        companyId: "co_harbor",
        evidenceSha256: hash("reviewed Harbor company evidence"),
      }),
    ]);
    for (const exposure of [northstar, harbor]) {
      await repository.recordMapping(accessSubject, {
        positionId: "position_multi_company_spv",
        exposureId: exposure.id,
        relationshipKind: "look_through",
        allocationPpm: null,
        status: "active",
        decisionSource: "review",
        decisionReference: "relationship known; allocation unknown",
        evidenceSha256: hash(`unknown:${exposure.id}`),
        effectiveAt: recordedAt,
      });
    }

    const projection = await readModel.list(
      accessSubject,
      "2026-08-16T12:00:00.000Z",
    );
    expect(
      projection.exposures.find(
        (candidate) => candidate.exposure.id === anthropic.id,
      ),
    ).toMatchObject({
      contributions: [{}, {}],
      totals: [{ allocatedValueMinor: 10_000_000 }],
    });
    for (const exposure of [northstar, harbor]) {
      expect(
        projection.exposures.find(
          (candidate) => candidate.exposure.id === exposure.id,
        ),
      ).toMatchObject({
        contributions: [{ allocationPpm: null, allocatedValueMinor: null }],
        totals: [
          {
            allocatedValueMinor: 0,
            knownValuePositionCount: 0,
            unknownValuePositionCount: 1,
          },
        ],
      });
    }
    const multiCompanyPosition = projection.positions.find(
      (position) => position.id === "position_multi_company_spv",
    );
    expect(multiCompanyPosition).toMatchObject({
      knownAllocationPpm: 0,
      hasUnknownAllocation: true,
      allocatedValueMinor: 0,
      unallocatedValueMinor: 5_000_000,
    });
    expect(multiCompanyPosition?.mappedExposureIds).toHaveLength(2);
    expect(multiCompanyPosition?.mappedExposureIds).toEqual(
      expect.arrayContaining([northstar.id, harbor.id]),
    );
  });

  it("versions corrections and rejects allocations that manufacture value", async () => {
    seedAcceptedPosition(sqlite, {
      id: "position_reviewed_fund",
      label: "Synthetic reviewed fund",
      positionKind: "fund_interest",
      valueMinor: 9_000_000,
      valueState: "reported",
    });
    const fund = await repository.resolveExposure(accessSubject, {
      exposureKind: "fund",
      canonicalName: "Synthetic diversified fund",
      protectedIdentityKey: hash("reviewed synthetic fund identity"),
      evidenceSha256: hash("reviewed synthetic fund evidence"),
    });
    const unresolved = await repository.resolveExposure(accessSubject, {
      exposureKind: "unresolved",
      canonicalName: "Unresolved provider relationship",
      evidenceSha256: hash("unresolved relationship evidence"),
    });
    const otherFund = await repository.resolveExposure(accessSubject, {
      exposureKind: "fund",
      canonicalName: "Synthetic second fund",
      protectedIdentityKey: hash("reviewed synthetic second fund identity"),
      evidenceSha256: hash("reviewed synthetic second fund evidence"),
    });
    const first = await repository.recordMapping(accessSubject, {
      positionId: "position_reviewed_fund",
      exposureId: fund.id,
      relationshipKind: "look_through",
      allocationPpm: 600_000,
      status: "active",
      decisionSource: "review",
      decisionReference: "initial reviewed allocation",
      evidenceSha256: hash("initial allocation evidence"),
      effectiveAt: recordedAt,
    });
    const retry = await repository.recordMapping(accessSubject, {
      positionId: "position_reviewed_fund",
      exposureId: fund.id,
      relationshipKind: "look_through",
      allocationPpm: 600_000,
      status: "active",
      decisionSource: "review",
      decisionReference: "same allocation with later evidence",
      evidenceSha256: hash("later equivalent evidence"),
      effectiveAt: "2026-08-15T23:00:00.000Z",
    });
    expect(retry.id).toBe(first.id);

    const corrected = await repository.recordMapping(accessSubject, {
      positionId: "position_reviewed_fund",
      exposureId: fund.id,
      relationshipKind: "look_through",
      allocationPpm: 400_000,
      status: "active",
      decisionSource: "review",
      decisionReference: "corrected reviewed allocation",
      evidenceSha256: hash("corrected allocation evidence"),
      effectiveAt: "2026-08-15T23:00:00.000Z",
    });
    expect(corrected).toMatchObject({
      version: 2,
      supersedesMappingId: first.id,
    });
    await expect(
      repository.recordMapping(accessSubject, {
        positionId: "position_reviewed_fund",
        exposureId: otherFund.id,
        relationshipKind: "look_through",
        allocationPpm: 700_000,
        status: "active",
        decisionSource: "review",
        decisionReference: "invalid over-allocation",
        evidenceSha256: hash("over-allocation evidence"),
        effectiveAt: "2026-08-15T23:00:00.000Z",
      }),
    ).rejects.toThrow(/allocations exceed one million ppm/u);
    await expect(
      repository.recordMapping(accessSubject, {
        positionId: "position_reviewed_fund",
        exposureId: unresolved.id,
        relationshipKind: "look_through",
        allocationPpm: 700_000,
        status: "active",
        decisionSource: "review",
        decisionReference: "invalid unresolved allocation",
        evidenceSha256: hash("invalid allocation evidence"),
        effectiveAt: "2026-08-15T23:00:00.000Z",
      }),
    ).rejects.toThrow(/Unresolved exposures cannot receive allocated value/u);
    await expect(
      repository.recordMapping(accessSubject, {
        positionId: "position_reviewed_fund",
        exposureId: unresolved.id,
        relationshipKind: "direct",
        allocationPpm: 500_000,
        status: "active",
        decisionSource: "review",
        decisionReference: "invalid direct allocation",
        evidenceSha256: hash("invalid direct evidence"),
        effectiveAt: "2026-08-15T23:00:00.000Z",
      }),
    ).rejects.toThrow(/Active direct mappings require full allocation/u);

    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_exposure_mappings
           WHERE position_id = 'position_reviewed_fund'
             AND exposure_id = ?`,
        )
        .get(fund.id),
    ).toEqual({ count: 2 });
  });

  it("assigns two reviewed AngelList SPVs to one company exposure", async () => {
    seedAcceptedPosition(sqlite, {
      id: "position_synthetic_beacon_spv",
      label: "Synthetic Beacon SPV",
      provider: "angellist",
      reportedExposureName: "Harbor Health Systems",
      positionKind: "spv_interest",
      valueMinor: 4_000_000,
      valueState: "reported",
    });
    seedAcceptedPosition(sqlite, {
      id: "position_synthetic_summit_spv",
      label: "Synthetic Summit SPV",
      provider: "angellist",
      reportedExposureName: "Harbor Health Systems",
      positionKind: "spv_interest",
      valueMinor: 6_000_000,
      valueState: "reported",
    });

    const pending =
      await repository.getPrivateExposureReviewState(accessSubject);
    expect(pending.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          positionId: "position_synthetic_beacon_spv",
          reportedExposureName: "Harbor Health Systems",
        }),
        expect.objectContaining({
          positionId: "position_synthetic_summit_spv",
          reportedExposureName: "Harbor Health Systems",
        }),
      ]),
    );
    expect(pending.companies).toContainEqual(
      expect.objectContaining({
        id: "co_harbor",
        legalName: "Harbor Health Systems",
      }),
    );

    for (const positionId of [
      "position_synthetic_beacon_spv",
      "position_synthetic_summit_spv",
    ]) {
      await repository.assignPrivateCompanyExposure(accessSubject, positionId, {
        expectedSnapshotId: `snapshot_${positionId}`,
        company: { mode: "existing", companyId: "co_harbor" },
      });
    }

    const projection = await readModel.list(
      accessSubject,
      "2026-08-16T12:00:00.000Z",
    );
    const harbor = projection.exposures.find(
      (group) => group.exposure.companyId === "co_harbor",
    );
    expect(harbor).toMatchObject({
      exposure: {
        canonicalName: "Harbor Health Systems",
        resolutionMethod: "reviewed_company",
      },
      contributions: [
        { relationshipKind: "look_through", allocationPpm: 1_000_000 },
        { relationshipKind: "look_through", allocationPpm: 1_000_000 },
      ],
      totals: [{ allocatedValueMinor: 10_000_000 }],
    });
    expect(
      projection.positions.filter((position) =>
        position.mappedExposureIds.includes(harbor?.exposure.id ?? ""),
      ),
    ).toHaveLength(2);
    await expect(
      repository.getPrivateExposureReviewState(accessSubject),
    ).resolves.toMatchObject({ positions: [] });

    const alpha = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData(accessSubject);
    expect(
      alpha.holdings
        .filter((holding) => holding.id.startsWith("position_synthetic_"))
        .map((holding) => holding.companyId),
    ).toEqual(["co_harbor", "co_harbor"]);
  });

  it("batch-assigns exact AngelList company labels and leaves uncertain rows for review", async () => {
    for (const [id, label, reportedExposureName] of [
      [
        "position_exact_harbor_a",
        "Synthetic Harbor Access I SPV",
        "Harbor Health Systems",
      ],
      [
        "position_exact_harbor_b",
        "Synthetic Harbor Access II SPV",
        "  HARBOR   HEALTH SYSTEMS ",
      ],
      [
        "position_exact_alto_a",
        "Synthetic Alto Access I SPV",
        "Synthetic Alto Pharmacy",
      ],
      [
        "position_exact_alto_b",
        "Synthetic Alto Access II SPV",
        "Synthetic Alto Pharmacy",
      ],
      [
        "position_vehicle_name_only",
        "Synthetic Vehicle Name SPV",
        "Synthetic Vehicle Name SPV",
      ],
      [
        "position_ambiguous_company",
        "Synthetic Ambiguous Access SPV",
        "Synthetic Ambiguous Company",
      ],
      [
        "position_multiple_labels",
        "Synthetic Multiple Labels SPV",
        "Synthetic First Company",
      ],
    ] as const) {
      seedAcceptedPosition(sqlite, {
        id,
        label,
        provider: "angellist",
        reportedExposureName,
        positionKind: "spv_interest",
        valueMinor: 1_000_000,
        valueState: "reported",
      });
    }
    seedAcceptedPosition(sqlite, {
      id: "position_manual_exact_text",
      label: "Synthetic Manual Access SPV",
      provider: "manual",
      reportedExposureName: "Synthetic Alto Pharmacy",
      positionKind: "spv_interest",
      valueMinor: 1_000_000,
      valueState: "reported",
    });
    sqlite
      .prepare(
        `INSERT INTO companies (
           id, household_id, legal_name, website_host, status,
           created_at, updated_at
         ) VALUES
           ('co_ambiguous_a', 'hh_demo', 'Synthetic Ambiguous Company', NULL,
            'active', ?, ?),
           ('co_ambiguous_b', 'hh_demo', 'synthetic ambiguous company', NULL,
            'active', ?, ?)`,
      )
      .run(recordedAt, recordedAt, recordedAt, recordedAt);
    sqlite
      .prepare(
        `INSERT INTO holding_position_exposures (
           id, household_id, position_id, exposure_label, exposure_kind,
           company_id, created_at
         ) VALUES (
           'reported_exposure_position_multiple_labels_second',
           'hh_demo', 'position_multiple_labels', 'Synthetic Second Company',
           'unresolved', NULL, ?
         )`,
      )
      .run(recordedAt);

    const pending =
      await repository.getPrivateExposureReviewState(accessSubject);
    expect(pending).toMatchObject({
      version: 2,
      exactBatch: {
        positionCount: 4,
        companyCount: 2,
        existingCompanyCount: 1,
        newCompanyCount: 1,
        excludedPositionCount: 3,
      },
    });
    expect(pending.positions).toHaveLength(7);
    expect(pending.positions).not.toContainEqual(
      expect.objectContaining({ positionId: "position_manual_exact_text" }),
    );

    const result = await repository.applyPrivateExposureExactBatch(
      accessSubject,
      { expectedRevision: pending.exactBatch.revision },
    );
    expect(result).toEqual({
      version: 1,
      assignedPositionCount: 4,
      companyCount: 2,
      existingCompanyCount: 1,
      createdCompanyCount: 1,
      remainingPositionCount: 3,
    });

    const assigned = sqlite
      .prepare(
        `SELECT
           mapping.position_id,
           exposure.company_id,
           exposure.canonical_name,
           mapping.relationship_kind,
           mapping.allocation_ppm,
           mapping.decision_source,
           mapping.decision_reference
         FROM holding_position_exposure_mappings mapping
         JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
         WHERE mapping.position_id LIKE 'position_exact_%'
           AND mapping.status = 'active'
           AND NOT EXISTS (
             SELECT 1
             FROM holding_position_exposure_mappings later
             WHERE later.supersedes_mapping_id = mapping.id
           )
         ORDER BY mapping.position_id`,
      )
      .all() as Array<Record<string, unknown>>;
    expect(assigned).toHaveLength(4);
    expect(
      assigned
        .filter((row) => String(row.position_id).includes("harbor"))
        .map((row) => row.company_id),
    ).toEqual(["co_harbor", "co_harbor"]);
    const altoCompanyIds = assigned
      .filter((row) => String(row.position_id).includes("alto"))
      .map((row) => row.company_id);
    expect(new Set(altoCompanyIds).size).toBe(1);
    expect(altoCompanyIds[0]).not.toBeNull();
    expect(assigned).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonical_name: "Synthetic Alto Pharmacy",
          relationship_kind: "look_through",
          allocation_ppm: 1_000_000,
          decision_source: "review",
          decision_reference: expect.stringMatching(
            /^Reviewed exact AngelList company batch /u,
          ),
        }),
      ]),
    );
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM companies
           WHERE household_id = 'hh_demo'
             AND legal_name = 'Synthetic Vehicle Name SPV'`,
        )
        .get(),
    ).toEqual({ count: 0 });

    const remaining =
      await repository.getPrivateExposureReviewState(accessSubject);
    expect(remaining.positions.map((position) => position.positionId)).toEqual(
      expect.arrayContaining([
        "position_vehicle_name_only",
        "position_ambiguous_company",
        "position_multiple_labels",
      ]),
    );
    expect(remaining.exactBatch).toMatchObject({
      positionCount: 0,
      excludedPositionCount: 3,
    });
    const mappingCountBeforeStaleRetry = sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM holding_position_exposure_mappings",
      )
      .get();
    await expect(
      repository.applyPrivateExposureExactBatch(accessSubject, {
        expectedRevision: pending.exactBatch.revision,
      }),
    ).rejects.toMatchObject({ code: "stale" });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM holding_position_exposure_mappings",
        )
        .get(),
    ).toEqual(mappingCountBeforeStaleRetry);
  });

  it("never treats matching provider text as a company decision", async () => {
    seedAcceptedPosition(sqlite, {
      id: "position_synthetic_unresolved_spv",
      label: "Synthetic Horizon SPV",
      provider: "angellist",
      reportedExposureName: "Harbor Health Systems",
      positionKind: "spv_interest",
      valueMinor: null,
      valueState: "locked",
    });

    await expect(
      repository.assignPrivateCompanyExposure(
        accessSubject,
        "position_synthetic_unresolved_spv",
        {
          expectedSnapshotId: "stale_snapshot",
          company: { mode: "existing", companyId: "co_harbor" },
        },
      ),
    ).rejects.toMatchObject({ code: "stale" });
    await expect(
      repository.assignPrivateCompanyExposure(
        accessSubject,
        "position_synthetic_unresolved_spv",
        {
          expectedSnapshotId: "snapshot_position_synthetic_unresolved_spv",
          company: {
            mode: "new",
            legalName: "Harbor Health Systems",
            websiteHost: "harbor-health.example",
          },
        },
      ),
    ).rejects.toMatchObject({ code: "company_conflict" });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_exposure_mappings
           WHERE position_id = 'position_synthetic_unresolved_spv'`,
        )
        .get(),
    ).toEqual({ count: 0 });

    sqlite
      .prepare(
        `INSERT INTO users (
           id, access_subject, email, display_name, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "usr_other_household",
        "synthetic-other-access-subject",
        "other-household@example.test",
        "Other household owner",
        recordedAt,
      );
    sqlite
      .prepare(
        `INSERT INTO households (
           id, owner_user_id, name, base_currency, created_at
         ) VALUES (?, ?, ?, 'USD', ?)`,
      )
      .run(
        "hh_other_household",
        "usr_other_household",
        "Other synthetic household",
        recordedAt,
      );
    sqlite
      .prepare(
        `INSERT INTO companies (
           id, household_id, legal_name, website_host, status,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        "co_other_household",
        "hh_other_household",
        "Other Household Company",
        "other-household.example",
        recordedAt,
        recordedAt,
      );
    await expect(
      repository.assignPrivateCompanyExposure(
        accessSubject,
        "position_synthetic_unresolved_spv",
        {
          expectedSnapshotId: "snapshot_position_synthetic_unresolved_spv",
          company: { mode: "existing", companyId: "co_other_household" },
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_company" });

    const created = await repository.assignPrivateCompanyExposure(
      accessSubject,
      "position_synthetic_unresolved_spv",
      {
        expectedSnapshotId: "snapshot_position_synthetic_unresolved_spv",
        company: {
          mode: "new",
          legalName: "Synthetic Horizon Labs",
          websiteHost: "horizon-labs.example",
        },
      },
    );
    expect(created).toMatchObject({
      positionId: "position_synthetic_unresolved_spv",
      companyName: "Synthetic Horizon Labs",
    });
    expect(
      sqlite
        .prepare(
          `SELECT legal_name, website_host
           FROM companies
           WHERE id = ?`,
        )
        .get(created.companyId),
    ).toEqual({
      legal_name: "Synthetic Horizon Labs",
      website_host: "horizon-labs.example",
    });
    await expect(
      repository.assignPrivateCompanyExposure(
        accessSubject,
        "position_synthetic_unresolved_spv",
        {
          expectedSnapshotId: "snapshot_position_synthetic_unresolved_spv",
          company: { mode: "existing", companyId: "co_harbor" },
        },
      ),
    ).rejects.toMatchObject({ code: "already_resolved" });
  });
});

describe("preview asset-lot retirement migration", () => {
  it("backfills retirement records when the legacy preview lots already exist", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/database/migrations/0001_keel_core.sql",
          ),
          "utf8",
        ),
      );
      database.exec(`
        INSERT INTO users (
          id, access_subject, email, display_name, created_at
        ) VALUES (
          'usr_cleanup', 'cleanup-access-subject', 'cleanup@example.test',
          'Cleanup owner', '${recordedAt}'
        );
        INSERT INTO households (
          id, owner_user_id, name, base_currency, created_at
        ) VALUES (
          'hh_cleanup', 'usr_cleanup', 'Cleanup household', 'USD',
          '${recordedAt}'
        );
        INSERT INTO companies (
          id, household_id, legal_name, website_host, status,
          created_at, updated_at
        ) VALUES (
          'co_cleanup', 'hh_cleanup', 'Synthetic cleanup company', NULL,
          'active', '${recordedAt}', '${recordedAt}'
        );
        INSERT INTO asset_accounts (
          id, household_id, name, account_type, administrator_label, created_at
        ) VALUES (
          'acct_cleanup', 'hh_cleanup', 'Cleanup account', 'direct', NULL,
          '${recordedAt}'
        );
        INSERT INTO asset_lots (
          id, household_id, company_id, asset_account_id, private_vehicle_id,
          lot_label, security_type, quantity_scaled, quantity_scale,
          acquisition_date, cost_basis_minor, currency, created_at
        ) VALUES
          (
            'lot_harbor_spv', 'hh_cleanup', 'co_cleanup', 'acct_cleanup', NULL,
            'Cleanup lot one', 'preferred_equity', 1, 0, '2026-01-01', 0,
            'USD', '${recordedAt}'
          ),
          (
            'lot_lattice_seriesa', 'hh_cleanup', 'co_cleanup', 'acct_cleanup',
            NULL, 'Cleanup lot two', 'preferred_equity', 1, 0, '2026-01-01',
            0, 'USD', '${recordedAt}'
          ),
          (
            'lot_northstar_seed', 'hh_cleanup', 'co_cleanup', 'acct_cleanup',
            NULL, 'Cleanup lot three', 'preferred_equity', 1, 0, '2026-01-01',
            0, 'USD', '${recordedAt}'
          );
      `);
      database.exec(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/database/migrations/0025_retired_asset_lots.sql",
          ),
          "utf8",
        ),
      );

      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM asset_lot_retirements
             WHERE household_id = 'hh_cleanup'
               AND reason = 'preview_demo_cleanup'`,
          )
          .get(),
      ).toEqual({ count: 3 });
    } finally {
      database.close();
    }
  });
});
