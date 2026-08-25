import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
  type PlaidInvestmentsHoldingImportStageInput,
} from "./holding-imports";
import { D1AlphaRepository } from "./index";
import { D1CashAccountsRepository } from "./cash-accounts";
import { D1ExposureRepository } from "./exposures";
import { D1PortfolioBaselineRepository } from "./portfolio-baseline";

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
  "packages/database/migrations/0033_provider_portfolio_agents.sql",
  "packages/database/migrations/0034_mac_agent_credentials.sql",
  "packages/database/migrations/0035_nullable_private_investment_date.sql",
  "packages/database/migrations/0036_exact_reviewed_private_exposures.sql",
  "packages/database/migrations/0037_private_provider_position_continuity.sql",
  "packages/database/migrations/0038_reviewed_position_value_adjustments.sql",
  "packages/database/migrations/0040_holdings_read_performance.sql",
  "packages/database/seed/synthetic.sql",
] as const;

const robinhoodConnectionId = "connection_synthetic_robinhood";
const robinhoodAccountKey = "6".repeat(64);
const robinhoodPositionKey = "7".repeat(64);

describe("nullable private investment date migration", () => {
  it("preserves legacy rows and their review references", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec("PRAGMA foreign_keys = ON");
      migrationFiles
        .filter(
          (file) =>
            ![
              "packages/database/migrations/0035_nullable_private_investment_date.sql",
              "packages/database/migrations/0036_exact_reviewed_private_exposures.sql",
              "packages/database/migrations/0037_private_provider_position_continuity.sql",
              "packages/database/migrations/0038_reviewed_position_value_adjustments.sql",
              "packages/database/migrations/0040_holdings_read_performance.sql",
            ].includes(file),
        )
        .forEach((file) => {
          sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
        });

      sqlite
        .prepare(
          `INSERT INTO source_documents (
             id, household_id, object_key, file_name, content_type, byte_size,
             sha256, effective_date, retrieved_at, source_label, review_status,
             created_at
           ) VALUES (?, 'hh_demo', ?, ?, 'text/csv', 512, ?, ?, ?, ?,
             'pending_review', ?)`,
        )
        .run(
          "legacy_sydecar_document",
          "holding-imports/sydecar/legacy-synthetic.csv",
          "legacy-synthetic.csv",
          "0123456789abcdef".repeat(4),
          "2026-08-20",
          "2026-08-20T12:00:00.000Z",
          "Sydecar template",
          "2026-08-20T12:00:00.000Z",
        );
      sqlite
        .prepare(
          `INSERT INTO holding_imports (
             id, household_id, source_document_id, provider, parser_schema,
             row_count, created_by, created_at, normalized_fingerprint
           ) VALUES (?, 'hh_demo', ?, 'sydecar', ?, 1, 'usr_demo', ?, ?)`,
        )
        .run(
          "legacy_sydecar_import",
          "legacy_sydecar_document",
          "provider-holdings-template-v1",
          "2026-08-20T12:00:00.000Z",
          "d".repeat(64),
        );
      sqlite
        .prepare(
          `INSERT INTO holding_import_rows (
             id, household_id, import_id, source_row_number,
             position_fingerprint, snapshot_fingerprint, legal_vehicle_name,
             owner_label, exposure_label, provider_status, invested_on,
             invested_minor, allocation_minor, unrealized_value_minor,
             unrealized_value_state, realized_value_minor, net_value_minor,
             net_value_state, instrument_type, currency_hint, parse_status,
             issue_codes_json, created_at, position_kind
           ) VALUES (?, 'hh_demo', ?, 1, ?, ?, ?, ?, ?, 'live', ?, ?, ?, NULL,
             'not_reported', 0, NULL, 'not_reported', ?, 'USD', 'ready', '[]',
             ?, 'spv_interest')`,
        )
        .run(
          "legacy_sydecar_row",
          "legacy_sydecar_import",
          "1".repeat(64),
          "2".repeat(64),
          "Synthetic Legacy SPV",
          "Synthetic Investment Profile",
          "Synthetic Legacy Company",
          "2025-02-01",
          500_000,
          750_000,
          "Membership interest",
          "2026-08-20T12:00:00.000Z",
        );
      sqlite
        .prepare(
          `INSERT INTO holding_import_row_decisions (
             id, household_id, import_row_id, reviewer_user_id, decision,
             matched_position_id, currency, reviewed_snapshot_fingerprint,
             rationale, decided_at
           ) VALUES (?, 'hh_demo', ?, 'usr_demo', 'rejected', NULL, NULL, ?, ?, ?)`,
        )
        .run(
          "legacy_sydecar_decision",
          "legacy_sydecar_row",
          "2".repeat(64),
          "Synthetic migration review.",
          "2026-08-20T13:00:00.000Z",
        );

      sqlite.exec("BEGIN");
      try {
        sqlite.exec(
          readFileSync(
            resolve(
              process.cwd(),
              "packages/database/migrations/0035_nullable_private_investment_date.sql",
            ),
            "utf8",
          ),
        );
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }

      expect(
        sqlite
          .prepare(
            `SELECT invested_on, invested_on_state
             FROM holding_import_rows
             WHERE id = ?`,
          )
          .get("legacy_sydecar_row"),
      ).toEqual({
        invested_on: "2025-02-01",
        invested_on_state: "reported",
      });
      expect(
        sqlite
          .prepare(
            `SELECT import_row_id
             FROM holding_import_row_decisions
             WHERE id = ?`,
          )
          .get("legacy_sydecar_decision"),
      ).toEqual({ import_row_id: "legacy_sydecar_row" });
      expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(sqlite.prepare("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
    } finally {
      sqlite.close();
    }
  });
});

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

function seedRobinhoodInvestmentConnection(
  sqlite: DatabaseSync,
  connectionId = robinhoodConnectionId,
  sourceKey = "5".repeat(64),
  versionId = "connection_version_synthetic_robinhood",
): void {
  sqlite
    .prepare(
      `INSERT INTO investment_connections (
         id, household_id, adapter_type, protected_source_key,
         created_by_user_id, created_at, immutable
       ) VALUES (?, 'hh_demo', 'plaid-investments', ?, 'usr_demo', ?, 1)`,
    )
    .run(connectionId, sourceKey, "2026-08-01T12:00:00.000Z");
  sqlite
    .prepare(
      `INSERT INTO investment_connection_versions (
         id, household_id, connection_id, version, institution_key,
         institution_label, lifecycle_state, credential_reference,
         supersedes_version_id, recorded_by_user_id, recorded_at, immutable
       ) VALUES (?, 'hh_demo', ?, 1, 'plaid_investments', 'Robinhood', 'active',
         'connector-secrets/synthetic.enc', NULL, 'usr_demo', ?, 1)`,
    )
    .run(versionId, connectionId, "2026-08-01T12:00:00.000Z");
}

function stageInput(
  documentFingerprint: string,
  changes: Partial<HoldingImportStageInput["rows"][number]> = {},
): HoldingImportStageInput {
  return {
    objectKey: `holding-imports/${documentFingerprint.slice(0, 8)}`,
    sha256: documentFingerprint,
    byteSize: 1_024,
    effectiveDate: "2026-06-14",
    retrievedAt: "2026-06-14T12:00:00.000Z",
    rows: [
      {
        rowNumber: 3,
        naturalKeySha256: "a".repeat(64),
        companyOrFund: "Synthetic Navigation Systems",
        status: "Live",
        investDate: "2025-04-12",
        investedMinor: 2_500_000,
        unrealizedValueMinor: null,
        unrealizedValueState: "locked",
        realizedValueMinor: 0,
        netValueMinor: null,
        netValueState: "locked",
        multiplePpm: null,
        investmentEntity: "Synthetic Family Trust",
        lead: "Synthetic Ventures",
        investmentType: "Syndicate",
        source: null,
        round: "Seed",
        market: "Navigation",
        fundName: "Synthetic Navigation SPV",
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
        ...changes,
      },
    ],
    canonicalScope: {
      connection: {
        mode: "ensure",
        adapterType: "angellist-import",
        protectedSourceKey: "b".repeat(64),
        institutionKey: "angellist",
        institutionLabel: "AngelList",
        lifecycleState: "pending",
        credentialReference: null,
      },
      containers: [
        {
          protectedAccountKey: "c".repeat(64),
          displayLabel: "Ownership pending review",
          containerKind: "unresolved",
          taxTreatment: "unknown",
          completeness: "ambiguous",
        },
      ],
      rows: [
        {
          sourceRowNumber: 3,
          protectedAccountKey: "c".repeat(64),
          protectedPositionKey: "a".repeat(64),
        },
      ],
    },
  };
}

function robinhoodStageInput(
  normalizedFingerprint = "9".repeat(64),
): PlaidInvestmentsHoldingImportStageInput {
  return {
    objectKey: "holding-imports/synthetic-robinhood.json",
    sha256: "8".repeat(64),
    byteSize: 2_048,
    normalizedFingerprint,
    effectiveDate: "2026-08-08",
    retrievedAt: "2026-08-10T12:00:00.000Z",
    rows: [
      {
        rowNumber: 1,
        naturalKeySha256: "7".repeat(64),
        securityName: "Synthetic Public Company",
        ticker: "SYN",
        securityType: "equity",
        accountLabel: "Robinhood brokerage",
        quantityMicros: 12_345_678,
        costBasisMinor: 100_000,
        marketValueMinor: 123_457,
        observedOn: "2026-08-08",
        currency: "USD",
        issues: [],
      },
    ],
    canonicalScope: {
      connection: {
        mode: "existing",
        connectionId: robinhoodConnectionId,
      },
      containers: [
        {
          protectedAccountKey: robinhoodAccountKey,
          displayLabel: "Robinhood brokerage",
          containerKind: "brokerage",
          taxTreatment: "taxable",
          completeness: "complete",
        },
      ],
      rows: [
        {
          sourceRowNumber: 1,
          protectedAccountKey: robinhoodAccountKey,
          protectedPositionKey: robinhoodPositionKey,
          publicExposureIdentityKind: "cusip",
          protectedExposureKey: "6".repeat(64),
        },
      ],
    },
  };
}

function providerTemplateStageInput(
  provider: "tokenfolio" | "sydecar",
): HoldingImportStageInput {
  const source = stageInput(
    provider === "tokenfolio" ? "4".repeat(64) : "5".repeat(64),
  );
  const sourceRow = source.rows[0];
  if (sourceRow === undefined) {
    throw new Error("Synthetic template fixture is missing its row.");
  }
  const tokenfolio = provider === "tokenfolio";
  return {
    ...source,
    provider,
    objectKey: `holding-imports/${provider}/synthetic.csv`,
    effectiveDate: "2026-08-20",
    retrievedAt: "2026-08-20T12:00:00.000Z",
    rows: [
      {
        ...sourceRow,
        rowNumber: 3,
        naturalKeySha256: tokenfolio ? "d".repeat(64) : "e".repeat(64),
        companyOrFund: tokenfolio
          ? "Synthetic Robotics"
          : "Example Climate Fund",
        fundName: tokenfolio
          ? "Synthetic Robotics direct shares"
          : "Example Climate Fund SPV I",
        investmentEntity: tokenfolio
          ? "Synthetic Family Trust"
          : "Synthetic Investment Profile",
        investDate: tokenfolio ? "2025-02-01" : null,
        investDateState: tokenfolio ? "reported" : "not_reported",
        investedMinor: tokenfolio ? 125_000 : 500_000,
        unrealizedValueMinor: tokenfolio ? 180_025 : null,
        unrealizedValueState: tokenfolio ? "reported" : "not_reported",
        netValueMinor: tokenfolio ? 180_025 : null,
        netValueState: tokenfolio ? "reported" : "not_reported",
        positionKind: tokenfolio ? "direct" : "spv_interest",
        dealMetadata: {
          ...sourceRow.dealMetadata,
          allocationMinor: tokenfolio ? 125_000 : 750_000,
          instrument: tokenfolio ? "Common stock" : "Membership interest",
        },
      },
    ],
    canonicalScope: {
      connection: {
        mode: "ensure",
        adapterType: "manual",
        protectedSourceKey: tokenfolio ? "8".repeat(64) : "9".repeat(64),
        institutionKey: provider,
        institutionLabel: tokenfolio ? "Tokenfolio" : "Sydecar",
        lifecycleState: "pending",
        credentialReference: null,
      },
      containers: [
        {
          protectedAccountKey: tokenfolio ? "6".repeat(64) : "7".repeat(64),
          displayLabel: tokenfolio
            ? "Synthetic Family Trust"
            : "Synthetic Investment Profile",
          containerKind: tokenfolio ? "trust" : "entity",
          taxTreatment: "unknown",
          completeness: "complete",
        },
      ],
      rows: [
        {
          sourceRowNumber: 3,
          protectedAccountKey: tokenfolio ? "6".repeat(64) : "7".repeat(64),
          protectedPositionKey: tokenfolio ? "d".repeat(64) : "e".repeat(64),
        },
      ],
    },
  };
}

describe("AngelList holding import persistence", () => {
  let sqlite: DatabaseSync;
  let repository: D1HoldingImportRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    seedRobinhoodInvestmentConnection(sqlite);
    repository = new D1HoldingImportRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  it("stages once, preserves a locked NAV, and applies an SPV position without quantity", async () => {
    const input = stageInput("f".repeat(64));
    const staged = await repository.stageHoldingImport(
      "synthetic-access-subject",
      input,
    );

    expect(staged.created).toBe(true);
    expect(staged.preview).toMatchObject({
      provider: "angellist",
      status: "pending_review",
      summary: {
        rowCount: 1,
        lockedValueCount: 1,
        createCount: 1,
      },
      rows: [
        {
          positionName: "Synthetic Navigation SPV",
          exposureName: "Synthetic Navigation Systems",
          administratorNavMinor: null,
          administratorNavState: "locked",
          action: "create_position",
        },
      ],
    });
    await expect(
      repository.listPendingHoldingImports("synthetic-access-subject"),
    ).resolves.toEqual([
      expect.objectContaining({
        id: staged.preview.id,
        provider: "angellist",
        status: "pending_review",
        rowCount: 1,
      }),
    ]);

    const duplicate = await repository.stageHoldingImport(
      "synthetic-access-subject",
      input,
    );
    expect(duplicate.created).toBe(false);
    expect(duplicate.preview.id).toBe(staged.preview.id);

    const decision = {
      currency: "USD" as const,
      decisions: [
        {
          rowId: staged.preview.rows[0]!.id,
          decision: "accepted" as const,
          rationale: "Reviewed synthetic AngelList position.",
        },
      ],
    };
    const applied = await repository.applyHoldingImport(
      "synthetic-access-subject",
      staged.preview.id,
      decision,
    );
    expect(applied).toEqual({
      importId: staged.preview.id,
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      rejectedCount: 0,
      lockedValueCount: 1,
    });
    await expect(
      repository.listPendingHoldingImports("synthetic-access-subject"),
    ).resolves.toEqual([]);
    await expect(
      repository.applyHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
        decision,
      ),
    ).resolves.toEqual(applied);

    const position = sqlite
      .prepare(
        `SELECT position_kind, legal_vehicle_name
         FROM holding_positions`,
      )
      .get() as { position_kind: string; legal_vehicle_name: string };
    expect(position).toEqual({
      position_kind: "spv_interest",
      legal_vehicle_name: "Synthetic Navigation SPV",
    });
    const positionColumns = sqlite
      .prepare("PRAGMA table_info(holding_positions)")
      .all() as Array<{ name: string }>;
    expect(positionColumns.map((column) => column.name)).not.toContain(
      "quantity_scaled",
    );

    const alpha = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(alpha.holdings).toHaveLength(1);
    expect(alpha.holdings.map((holding) => holding.id)).not.toEqual(
      expect.arrayContaining([
        "lot_harbor_spv",
        "lot_lattice_seriesa",
        "lot_northstar_seed",
      ]),
    );
    expect(alpha.holdings).toContainEqual(
      expect.objectContaining({
        id: expect.any(String),
        companyId: null,
        positionName: "Synthetic Navigation SPV",
        exposureName: "Synthetic Navigation Systems",
        ownerLabel: "Synthetic Family Trust",
        positionKind: "spv_interest",
        administratorNavMinor: null,
        administratorNavState: "locked",
        externalMarkMinor: null,
        underwritingValueMinor: null,
        scenarioValueMinor: null,
        usableLiquidityMinor: null,
        sourceLabel: "AngelList export",
        confidencePpm: null,
      }),
    );
  });

  it("automatically groups an accepted exact label under one existing reviewed company", async () => {
    const staged = await repository.stageHoldingImport(
      "synthetic-access-subject",
      stageInput("1".repeat(64), {
        companyOrFund: "  HARBOR   HEALTH SYSTEMS ",
        fundName: "Synthetic Harbor Access SPV",
      }),
    );

    await repository.applyHoldingImport(
      "synthetic-access-subject",
      staged.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: staged.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed synthetic Harbor position.",
          },
        ],
      },
    );

    expect(
      sqlite
        .prepare(
          `SELECT
             exposure.company_id,
             mapping.decision_source,
             mapping.decision_reference,
             mapping.relationship_kind,
             mapping.allocation_ppm
           FROM holding_positions position
           JOIN holding_position_exposure_mappings mapping
             ON mapping.position_id = position.id
           JOIN canonical_exposures exposure
             ON exposure.id = mapping.exposure_id
           WHERE position.legal_vehicle_name = 'Synthetic Harbor Access SPV'
             AND mapping.status = 'active'
             AND NOT EXISTS (
               SELECT 1
               FROM holding_position_exposure_mappings later
               WHERE later.supersedes_mapping_id = mapping.id
             )`,
        )
        .get(),
    ).toEqual({
      company_id: "co_harbor",
      decision_source: "deterministic_policy",
      decision_reference: "private-company-exact-reviewed-v1",
      relationship_kind: "look_through",
      allocation_ppm: 1_000_000,
    });
    await expect(
      new D1ExposureRepository(
        new TestD1Database(sqlite) as unknown as D1Database,
      ).getPrivateExposureReviewState("synthetic-access-subject"),
    ).resolves.toMatchObject({ positions: [] });
  });

  it.each(["tokenfolio", "sydecar"] as const)(
    "stages %s template evidence for review before accepting a provider-scoped position",
    async (provider) => {
      const staged = await repository.stageHoldingImport(
        "synthetic-access-subject",
        providerTemplateStageInput(provider),
      );
      expect(staged.preview).toMatchObject({
        provider,
        status: "pending_review",
        summary: { createCount: 1, rowCount: 1 },
        rows: [
          {
            investedOn: provider === "tokenfolio" ? "2025-02-01" : null,
            investedOnState:
              provider === "tokenfolio" ? "reported" : "not_reported",
          },
        ],
      });
      expect(
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM holding_positions WHERE provider = ?",
          )
          .get(provider),
      ).toEqual({ count: 0 });

      await repository.applyHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
        {
          currency: "USD",
          decisions: [
            {
              rowId: staged.preview.rows[0]!.id,
              decision: "accepted",
              rationale: `Reviewed synthetic ${provider} template position.`,
            },
          ],
        },
      );

      const expected =
        provider === "tokenfolio"
          ? {
              adapter_type: "manual",
              file_name: "tokenfolio-holdings.csv",
              institution_key: "tokenfolio",
              opened_on: "2025-02-01",
              position_kind: "direct",
              source_label: "Tokenfolio template",
            }
          : {
              adapter_type: "manual",
              file_name: "sydecar-holdings.csv",
              institution_key: "sydecar",
              opened_on: null,
              position_kind: "spv_interest",
              source_label: "Sydecar template",
            };
      expect(
        sqlite
          .prepare(
            `SELECT connection.adapter_type, version.institution_key,
                    position.position_kind, position.opened_on,
                    document.file_name, document.source_label
             FROM holding_positions position
             JOIN holding_position_ownerships ownership
               ON ownership.position_id = position.id
             JOIN ownership_containers container
               ON container.id = ownership.container_id
             JOIN investment_connections connection
               ON connection.id = container.connection_id
             JOIN investment_connection_versions version
               ON version.connection_id = connection.id
             JOIN holding_position_snapshots snapshot
               ON snapshot.position_id = position.id
             JOIN source_documents document
               ON document.id = snapshot.source_document_id
             WHERE position.provider = ?`,
          )
          .get(provider),
      ).toEqual(expected);

      const baselineState = await new D1PortfolioBaselineRepository(
        new TestD1Database(sqlite) as unknown as D1Database,
      ).getState("synthetic-access-subject");
      expect(baselineState.positions).toContainEqual(
        expect.objectContaining({
          provider,
          classification: "private_paper",
          sourceLabel: provider === "tokenfolio" ? "Tokenfolio" : "Sydecar",
        }),
      );

      const exposureReview = await new D1ExposureRepository(
        new TestD1Database(sqlite) as unknown as D1Database,
      ).getPrivateExposureReviewState("synthetic-access-subject");
      expect(exposureReview.positions).toContainEqual(
        expect.objectContaining({
          reportedExposureName:
            provider === "tokenfolio"
              ? "Synthetic Robotics"
              : "Example Climate Fund",
        }),
      );
    },
  );

  it("rejects a provider template staged under another source identity", async () => {
    const input = providerTemplateStageInput("tokenfolio");
    if (input.canonicalScope.connection.mode !== "ensure") {
      throw new Error("Synthetic template fixture must ensure its source.");
    }

    await expect(
      repository.stageHoldingImport("synthetic-access-subject", {
        ...input,
        canonicalScope: {
          ...input.canonicalScope,
          connection: {
            ...input.canonicalScope.connection,
            institutionKey: "sydecar",
            institutionLabel: "Sydecar",
          },
        },
      }),
    ).rejects.toThrow("source scope does not match its provider");
  });

  it("appends a revised snapshot and records a repeated observation as no change", async () => {
    const first = await repository.stageHoldingImport(
      "synthetic-access-subject",
      stageInput("1".repeat(64)),
    );
    await repository.applyHoldingImport(
      "synthetic-access-subject",
      first.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: first.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed initial synthetic position.",
          },
        ],
      },
    );

    const reportedChanges = {
      unrealizedValueMinor: 3_100_000,
      unrealizedValueState: "reported" as const,
      netValueMinor: 3_100_000,
      netValueState: "reported" as const,
      multiplePpm: 1_240_000,
    };
    const revised = await repository.stageHoldingImport(
      "synthetic-access-subject",
      stageInput("2".repeat(64), reportedChanges),
    );
    expect(revised.preview.rows[0]?.action).toBe("append_snapshot");
    const revisedResult = await repository.applyHoldingImport(
      "synthetic-access-subject",
      revised.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: revised.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed revised synthetic value.",
          },
        ],
      },
    );
    expect(revisedResult.updatedCount).toBe(1);

    const repeated = await repository.stageHoldingImport(
      "synthetic-access-subject",
      stageInput("3".repeat(64), reportedChanges),
    );
    expect(repeated.preview.rows[0]?.action).toBe("no_change");
    const repeatedResult = await repository.applyHoldingImport(
      "synthetic-access-subject",
      repeated.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: repeated.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Confirmed repeated synthetic observation.",
          },
        ],
      },
    );
    expect(repeatedResult.unchangedCount).toBe(1);

    const counts = sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM holding_positions) AS positions,
           (SELECT COUNT(*) FROM holding_position_snapshots) AS snapshots,
           (SELECT COUNT(*) FROM holding_import_applications) AS applications`,
      )
      .get() as { positions: number; snapshots: number; applications: number };
    expect(counts).toEqual({ positions: 1, snapshots: 2, applications: 3 });
  });

  it("reconciles a non-AngelList public position by strong identifier and remains idempotent", async () => {
    const staged = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      robinhoodStageInput(),
    );
    expect(staged).toMatchObject({
      created: true,
      preview: {
        provider: "plaid_investments",
        status: "pending_review",
        summary: {
          rowCount: 1,
          administratorValueCount: 1,
          createCount: 1,
        },
        rows: [
          {
            positionName: "Synthetic Public Company",
            exposureName: "SYN · Synthetic Public Company",
            ticker: "SYN",
            quantityMicros: 12_345_678,
            costBasisMinor: 100_000,
            administratorNavMinor: 123_457,
            action: "create_position",
          },
        ],
      },
    });

    const repeated = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      { ...robinhoodStageInput(), sha256: "6".repeat(64) },
    );
    expect(repeated.created).toBe(false);
    expect(repeated.preview.id).toBe(staged.preview.id);

    await repository.applyHoldingImport(
      "synthetic-access-subject",
      staged.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: staged.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed synthetic Robinhood position.",
          },
        ],
      },
    );

    const stored = sqlite
      .prepare(
        `SELECT
           position.position_kind,
           position.opened_on,
           snapshot.quantity_micros,
           snapshot.ticker,
           snapshot.cost_basis_minor
         FROM holding_positions position
         JOIN holding_position_snapshots snapshot
           ON snapshot.position_id = position.id
         WHERE position.provider = 'plaid_investments'`,
      )
      .get() as {
      position_kind: string;
      opened_on: string | null;
      quantity_micros: number;
      ticker: string;
      cost_basis_minor: number;
    };
    const exposure = sqlite
      .prepare(
        `SELECT
           canonical.exposure_kind, canonical.resolution_method,
           canonical.protected_identity_key,
           mapping.relationship_kind, mapping.allocation_ppm,
           mapping.decision_source, mapping.decision_reference
         FROM canonical_exposures canonical
         JOIN holding_position_exposure_mappings mapping
           ON mapping.exposure_id = canonical.id`,
      )
      .get();
    expect(stored).toEqual({
      position_kind: "direct",
      opened_on: null,
      quantity_micros: 12_345_678,
      ticker: "SYN",
      cost_basis_minor: 100_000,
    });
    expect(exposure).toEqual({
      exposure_kind: "public_instrument",
      resolution_method: "strong_identifier",
      protected_identity_key: "6".repeat(64),
      relationship_kind: "direct",
      allocation_ppm: 1_000_000,
      decision_source: "deterministic_policy",
      decision_reference: "public-strong-identifier-v1:cusip",
    });

    const alpha = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(alpha.holdings).toContainEqual(
      expect.objectContaining({
        exposureName: "SYN · Synthetic Public Company",
        positionKind: "direct",
        administratorNavMinor: 123_457,
        sourceLabel: "Plaid Investments",
        ticker: "SYN",
        quantityMicros: 12_345_678,
        costBasisMinor: 100_000,
      }),
    );

    const changedInput = robinhoodStageInput("a".repeat(64));
    changedInput.objectKey = "holding-imports/synthetic-robinhood-changed.json";
    changedInput.sha256 = "de".repeat(32);
    changedInput.effectiveDate = "2026-08-09";
    changedInput.retrievedAt = "2026-08-09T12:00:00.000Z";
    changedInput.rows[0] = {
      ...changedInput.rows[0]!,
      marketValueMinor: 130_000,
      observedOn: "2026-08-09",
    };
    const changed = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      changedInput,
    );
    expect(changed).toMatchObject({
      created: true,
      preview: { rows: [{ action: "append_snapshot" }] },
    });
    await repository.applyHoldingImport(
      "synthetic-access-subject",
      changed.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: changed.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed changed synthetic Robinhood position.",
          },
        ],
      },
    );

    const returnedInput = robinhoodStageInput();
    returnedInput.objectKey =
      "holding-imports/synthetic-robinhood-returned.json";
    returnedInput.sha256 = "ef".repeat(32);
    returnedInput.effectiveDate = "2026-08-10";
    returnedInput.retrievedAt = "2026-08-10T12:00:00.000Z";
    returnedInput.rows[0] = {
      ...returnedInput.rows[0]!,
      observedOn: "2026-08-10",
    };
    const returned = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      returnedInput,
    );
    expect(returned).toMatchObject({
      created: true,
      preview: { rows: [{ action: "append_snapshot" }] },
    });
    await repository.applyHoldingImport(
      "synthetic-access-subject",
      returned.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: returned.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed returned synthetic Robinhood position.",
          },
        ],
      },
    );

    const current = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(current.holdings).toContainEqual(
      expect.objectContaining({
        administratorNavMinor: 123_457,
        effectiveDate: "2026-08-10",
      }),
    );
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_exposure_mappings`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("retains a complete zero-row account observation", async () => {
    const input = robinhoodStageInput("0".repeat(64));
    input.objectKey = "holding-imports/synthetic-empty-robinhood.json";
    input.sha256 = "0".repeat(64);
    input.rows = [];
    input.canonicalScope.rows = [];

    const staged = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      input,
    );
    expect(staged.created).toBe(true);
    expect(staged.preview).toMatchObject({
      status: "pending_review",
      summary: { rowCount: 0 },
      coverage: [
        expect.objectContaining({
          completeness: "complete",
          reportedRowCount: 0,
        }),
      ],
    });

    await expect(
      repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
      ),
    ).resolves.toMatchObject({
      autoAppliedCount: 0,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    await expect(
      repository.getHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
      ),
    ).resolves.toMatchObject({ status: "applied", summary: { rowCount: 0 } });
  });

  it("reclassifies legacy crypto without creating an active FI exception", async () => {
    const legacyInput = robinhoodStageInput("b".repeat(64));
    legacyInput.objectKey = "holding-imports/synthetic-legacy-crypto.json";
    legacyInput.sha256 = "bc".repeat(32);
    legacyInput.rows[0] = {
      ...legacyInput.rows[0]!,
      naturalKeySha256: "c".repeat(64),
      securityName: "Synthetic Digital Asset",
      ticker: "SDA",
      securityType: "cryptocurrency",
      issues: ["cryptocurrency positions are not supported yet."],
    };
    const legacy = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      legacyInput,
    );
    await expect(
      repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        legacy.preview.id,
      ),
    ).resolves.toMatchObject({ autoAppliedCount: 0, quarantinedCount: 1 });

    const input = robinhoodStageInput("c".repeat(64));
    input.rows[0] = {
      ...input.rows[0]!,
      naturalKeySha256: "c".repeat(64),
      securityName: "Synthetic Digital Asset",
      ticker: "SDA",
      securityType: "cryptocurrency",
      issues: ["Crypto is recorded outside the FI plan."],
    };

    const staged = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      input,
    );
    const adjudication =
      await repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
      );

    expect(adjudication).toEqual({
      importId: staged.preview.id,
      policyVersion: "plaid-investments-holdings-auto-v3",
      autoAppliedCount: 1,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    await expect(
      repository.getHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
      ),
    ).resolves.toMatchObject({
      status: "applied",
      rows: [
        {
          ticker: "SDA",
          adjudicationStatus: "auto_applied",
          reasonCodes: expect.arrayContaining(["excluded_from_fi_planning"]),
        },
      ],
    });

    const alpha = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(alpha.holdings).toContainEqual(
      expect.objectContaining({
        positionName: "Synthetic Digital Asset",
        ticker: "SDA",
        sourceLabel: "Plaid Investments",
      }),
    );

    const omittedCryptoInput = robinhoodStageInput("d".repeat(64));
    omittedCryptoInput.objectKey =
      "holding-imports/synthetic-omitted-crypto.json";
    omittedCryptoInput.sha256 = "de".repeat(32);
    omittedCryptoInput.rows = [];
    omittedCryptoInput.canonicalScope.rows = [];
    const omittedCrypto = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      omittedCryptoInput,
    );
    await expect(
      repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        omittedCrypto.preview.id,
      ),
    ).resolves.toMatchObject({
      autoAppliedCount: 0,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });

    const laterInput = robinhoodStageInput("e".repeat(64));
    laterInput.objectKey = "holding-imports/synthetic-later-robinhood.json";
    laterInput.sha256 = "e".repeat(64);
    const later = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      laterInput,
    );
    await expect(
      repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        later.preview.id,
      ),
    ).resolves.toMatchObject({
      autoAppliedCount: 1,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    expect(
      (
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM holding_import_quarantines")
          .get() as { count: number }
      ).count,
    ).toBe(1);
  });

  it("auto-applies clear Robinhood rows and quarantines only ambiguous changes", async () => {
    const initialInput = robinhoodStageInput();
    initialInput.rows[0] = {
      ...initialInput.rows[0]!,
      costBasisMinor: null,
      issues: ["Cost basis is unavailable."],
    };
    initialInput.rows.push({
      ...initialInput.rows[0],
      rowNumber: 2,
      naturalKeySha256: "6".repeat(64),
      securityName: "Synthetic Index Fund",
      ticker: "SIX",
      quantityMicros: 2_000_000,
      costBasisMinor: 18_000,
      marketValueMinor: 20_000,
      issues: [],
    });
    initialInput.canonicalScope.rows.push({
      sourceRowNumber: 2,
      protectedAccountKey: robinhoodAccountKey,
      protectedPositionKey: "8".repeat(64),
    });
    const initial = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      initialInput,
    );
    const initialAdjudication =
      await repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        initial.preview.id,
      );
    expect(initialAdjudication).toEqual({
      importId: initial.preview.id,
      policyVersion: "plaid-investments-holdings-auto-v3",
      autoAppliedCount: 2,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    await expect(
      repository.getHoldingImport(
        "synthetic-access-subject",
        initial.preview.id,
      ),
    ).resolves.toMatchObject({
      status: "applied",
      summary: { autoAppliedCount: 2, quarantinedCount: 0 },
      rows: [
        {
          costBasisMinor: null,
          adjudicationStatus: "auto_applied",
          decisionSource: "policy",
          reasonCodes: expect.arrayContaining(["cost_basis_unavailable"]),
        },
        { adjudicationStatus: "auto_applied" },
      ],
    });

    const changedInput = robinhoodStageInput("a".repeat(64));
    changedInput.objectKey = "holding-imports/synthetic-robinhood-shift.json";
    changedInput.sha256 = "ab".repeat(32);
    changedInput.retrievedAt = "2026-08-11T12:00:00.000Z";
    changedInput.effectiveDate = "2026-08-11";
    changedInput.rows[0] = {
      ...changedInput.rows[0]!,
      marketValueMinor: 130_000,
      observedOn: "2026-08-11",
    };
    changedInput.rows.push({
      ...changedInput.rows[0],
      rowNumber: 2,
      naturalKeySha256: "5".repeat(64),
      securityName: "Synthetic Renamed Fund",
      ticker: "SRF",
      marketValueMinor: 21_000,
    });
    changedInput.canonicalScope.rows.push({
      sourceRowNumber: 2,
      protectedAccountKey: robinhoodAccountKey,
      protectedPositionKey: "9".repeat(64),
    });
    const changed = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      changedInput,
    );
    const changedAdjudication =
      await repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        changed.preview.id,
      );
    expect(changedAdjudication).toEqual({
      importId: changed.preview.id,
      policyVersion: "plaid-investments-holdings-auto-v3",
      autoAppliedCount: 1,
      quarantinedCount: 2,
      preservedPositionCount: 1,
    });
    const preview = await repository.getHoldingImport(
      "synthetic-access-subject",
      changed.preview.id,
    );
    expect(preview).toMatchObject({
      status: "quarantined",
      summary: {
        autoAppliedCount: 1,
        quarantinedCount: 2,
        preservedPositionCount: 1,
      },
      rows: [
        { ticker: "SYN", adjudicationStatus: "auto_applied" },
        {
          ticker: "SRF",
          action: "needs_attention",
          adjudicationStatus: "quarantined",
        },
      ],
    });
    await expect(
      repository.listPendingHoldingImports("synthetic-access-subject"),
    ).resolves.toContainEqual(
      expect.objectContaining({
        id: changed.preview.id,
        status: "quarantined",
      }),
    );

    const stored = sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM holding_positions
            WHERE provider = 'plaid_investments') AS positions,
           (SELECT COUNT(*) FROM holding_position_snapshots snapshot
            JOIN holding_positions position ON position.id = snapshot.position_id
            WHERE position.provider = 'plaid_investments') AS snapshots,
           (SELECT COUNT(*) FROM holding_import_row_decisions
            WHERE decision_source = 'policy') AS policy_decisions,
           (SELECT COUNT(*) FROM holding_import_quarantines) AS quarantines`,
      )
      .get() as {
      positions: number;
      snapshots: number;
      policy_decisions: number;
      quarantines: number;
    };
    expect(stored).toEqual({
      positions: 2,
      snapshots: 3,
      policy_decisions: 3,
      quarantines: 2,
    });
    expect(() =>
      sqlite
        .prepare("UPDATE holding_import_quarantines SET detail = 'changed'")
        .run(),
    ).toThrow("immutable");

    await expect(
      repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        changed.preview.id,
      ),
    ).resolves.toEqual(changedAdjudication);
  });

  it("keeps every accepted position unchanged when any account coverage is partial", async () => {
    const retirementAccountKey = "4".repeat(64);
    const retirementPositionKey = "3".repeat(64);
    const initialInput = robinhoodStageInput("e".repeat(64));
    initialInput.objectKey = "holding-imports/synthetic-multi-account.json";
    initialInput.sha256 = "e".repeat(64);
    initialInput.rows.push({
      ...initialInput.rows[0]!,
      rowNumber: 2,
      naturalKeySha256: "3".repeat(64),
      securityName: "Synthetic Retirement Fund",
      ticker: "SRF",
      accountLabel: "Robinhood Roth IRA",
      quantityMicros: 2_000_000,
      costBasisMinor: 18_000,
      marketValueMinor: 20_000,
    });
    initialInput.canonicalScope.containers.push({
      protectedAccountKey: retirementAccountKey,
      displayLabel: "Robinhood Roth IRA",
      containerKind: "ira",
      taxTreatment: "tax_exempt",
      completeness: "complete",
    });
    initialInput.canonicalScope.rows.push({
      sourceRowNumber: 2,
      protectedAccountKey: retirementAccountKey,
      protectedPositionKey: retirementPositionKey,
    });
    const initial = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      initialInput,
    );
    await expect(
      repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        initial.preview.id,
      ),
    ).resolves.toMatchObject({ autoAppliedCount: 2, quarantinedCount: 0 });

    const laterInput = robinhoodStageInput("f".repeat(64));
    laterInput.objectKey = "holding-imports/synthetic-partial-account.json";
    laterInput.sha256 = "f".repeat(64);
    laterInput.effectiveDate = "2026-08-12";
    laterInput.retrievedAt = "2026-08-12T12:00:00.000Z";
    laterInput.rows = [
      {
        ...initialInput.rows[1]!,
        rowNumber: 1,
        observedOn: "2026-08-12",
        marketValueMinor: 21_000,
      },
    ];
    laterInput.canonicalScope.containers = [
      {
        ...initialInput.canonicalScope.containers[0]!,
        completeness: "complete",
      },
      {
        ...initialInput.canonicalScope.containers[1]!,
        completeness: "partial",
      },
    ];
    laterInput.canonicalScope.rows = [
      {
        sourceRowNumber: 1,
        protectedAccountKey: retirementAccountKey,
        protectedPositionKey: retirementPositionKey,
      },
    ];
    const later = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      laterInput,
    );
    await expect(
      repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        later.preview.id,
      ),
    ).resolves.toMatchObject({
      autoAppliedCount: 0,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    await expect(
      repository.getHoldingImport("synthetic-access-subject", later.preview.id),
    ).resolves.toMatchObject({
      coverage: expect.arrayContaining([
        {
          containerId: expect.any(String),
          displayLabel: "Robinhood brokerage",
          completeness: "complete",
          reportedRowCount: 0,
        },
        {
          containerId: expect.any(String),
          displayLabel: "Robinhood Roth IRA",
          completeness: "partial",
          reportedRowCount: 1,
        },
      ]),
    });
    const omitted = sqlite
      .prepare(
        `SELECT ownership.container_id
         FROM holding_import_quarantines quarantine
         JOIN holding_position_ownerships ownership
           ON ownership.position_id = quarantine.position_id
         WHERE quarantine.import_id = ?
           AND quarantine.reason_code = 'position_not_reported'`,
      )
      .all(later.preview.id) as Array<{ container_id: string }>;
    expect(omitted).toHaveLength(0);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_snapshots snapshot
           JOIN holding_positions position ON position.id = snapshot.position_id
           WHERE position.provider = 'plaid_investments'`,
        )
        .get(),
    ).toEqual({ count: 2 });

    const failedConnectionId = "connection_synthetic_failed_institution";
    seedRobinhoodInvestmentConnection(
      sqlite,
      failedConnectionId,
      "2".repeat(64),
      "connection_version_synthetic_failed_institution",
    );
    const failedInput = robinhoodStageInput("1".repeat(64));
    failedInput.objectKey = "holding-imports/synthetic-failed-institution.json";
    failedInput.sha256 = "1".repeat(64);
    failedInput.rows = [];
    failedInput.canonicalScope = {
      connection: { mode: "existing", connectionId: failedConnectionId },
      containers: [
        {
          protectedAccountKey: "1".repeat(64),
          displayLabel: "Synthetic failed brokerage",
          containerKind: "brokerage",
          taxTreatment: "taxable",
          completeness: "failed",
        },
      ],
      rows: [],
    };
    const failed = await repository.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      failedInput,
    );
    await expect(
      repository.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        failed.preview.id,
      ),
    ).resolves.toMatchObject({
      autoAppliedCount: 0,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    await expect(
      repository.getHoldingImport(
        "synthetic-access-subject",
        failed.preview.id,
      ),
    ).resolves.toMatchObject({
      status: "pending_review",
      coverage: [
        expect.objectContaining({
          completeness: "failed",
          reportedRowCount: 0,
        }),
      ],
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_import_quarantines
           WHERE import_id = ?`,
        )
        .get(failed.preview.id),
    ).toEqual({ count: 0 });
  });
});

describe("reviewed portfolio baseline persistence", () => {
  let sqlite: DatabaseSync;
  let database: TestD1Database;
  let holdingImports: D1HoldingImportRepository;
  let baselines: D1PortfolioBaselineRepository;
  let cashAccounts: D1CashAccountsRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    seedRobinhoodInvestmentConnection(sqlite);
    database = new TestD1Database(sqlite);
    holdingImports = new D1HoldingImportRepository(
      database as unknown as D1Database,
    );
    baselines = new D1PortfolioBaselineRepository(
      database as unknown as D1Database,
    );
    cashAccounts = new D1CashAccountsRepository(
      database as unknown as D1Database,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    sqlite.close();
  });

  it("atomically appends a reviewed FI baseline without treating unknown values as money", async () => {
    const angelListInput = stageInput("4".repeat(64), {
      companyOrFund: "Synthetic Public Company",
      fundName: "Synthetic Public Company SPV",
      unrealizedValueMinor: 2_500_000,
      unrealizedValueState: "reported",
      netValueMinor: 2_500_000,
      netValueState: "reported",
      multiplePpm: 1_000_000,
    });
    const firstAngelListRow = angelListInput.rows[0]!;
    angelListInput.rows.push({
      ...firstAngelListRow,
      rowNumber: 4,
      naturalKeySha256: "5".repeat(64),
      companyOrFund: "Synthetic Hidden Systems",
      fundName: "Synthetic Hidden Systems SPV",
      unrealizedValueMinor: null,
      unrealizedValueState: "locked",
      netValueMinor: null,
      netValueState: "locked",
      multiplePpm: null,
    });
    angelListInput.canonicalScope.rows.push({
      sourceRowNumber: 4,
      protectedAccountKey: "c".repeat(64),
      protectedPositionKey: "d".repeat(64),
    });

    const angelList = await holdingImports.stageHoldingImport(
      "synthetic-access-subject",
      angelListInput,
    );
    await holdingImports.applyHoldingImport(
      "synthetic-access-subject",
      angelList.preview.id,
      {
        currency: "USD",
        decisions: angelList.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
          rationale: "Reviewed synthetic AngelList position.",
        })),
      },
    );

    const robinhoodInput = robinhoodStageInput();
    robinhoodInput.rows.push({
      ...robinhoodInput.rows[0]!,
      rowNumber: 2,
      naturalKeySha256: "6".repeat(64),
      securityName: "Brokerage cash",
      ticker: null,
      securityType: "cash",
      quantityMicros: 100_000_000,
      costBasisMinor: 100_000,
      marketValueMinor: 100_000,
    });
    robinhoodInput.canonicalScope.rows.push({
      sourceRowNumber: 2,
      protectedAccountKey: robinhoodAccountKey,
      protectedPositionKey: "8".repeat(64),
    });
    robinhoodInput.rows.push({
      ...robinhoodInput.rows[0]!,
      rowNumber: 3,
      naturalKeySha256: "b".repeat(64),
      securityName: "Synthetic Digital Asset",
      ticker: "SDA",
      securityType: "cryptocurrency",
      quantityMicros: 25_000_000,
      costBasisMinor: 2_000,
      marketValueMinor: 2_500,
      issues: ["Crypto is recorded outside the FI plan."],
    });
    robinhoodInput.canonicalScope.rows.push({
      sourceRowNumber: 3,
      protectedAccountKey: robinhoodAccountKey,
      protectedPositionKey: "9".repeat(64),
    });
    const robinhood = await holdingImports.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      robinhoodInput,
    );
    await holdingImports.applyHoldingImport(
      "synthetic-access-subject",
      robinhood.preview.id,
      {
        currency: "USD",
        decisions: robinhood.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
          rationale: "Reviewed synthetic Robinhood position.",
        })),
      },
    );

    const cashConnection = await cashAccounts.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "c".repeat(64),
    );
    const cashRun = await cashAccounts.beginRefresh(
      "synthetic-access-subject",
      cashConnection.id,
      "initial",
    );
    const cashStage = await cashAccounts.stageProposal(
      "synthetic-access-subject",
      cashRun.id,
      {
        objectKey: "cash-observations/synthetic-baseline.json",
        sourceSha256: "d".repeat(64),
        normalized: {
          normalizedFingerprint: "e".repeat(64),
          observedAt: "2026-08-14T18:00:00.000Z",
          rows: [
            {
              naturalKeySha256: "f".repeat(64),
              itemAccountKeySha256: "f".repeat(64),
              institutionLabel: "First Synthetic Bank",
              accountLabel: "Household checking",
              subtype: "checking",
              availableMinor: 300_000,
              currentMinor: 300_000,
              valueMinor: 300_000,
              valueState: "reported",
              balanceSource: "available",
              observedAt: "2026-08-14T18:00:00.000Z",
              issues: [],
            },
          ],
        },
      },
    );
    const cashProposal = cashStage.proposal;
    if (cashProposal === null) {
      throw new Error("Expected a synthetic cash proposal.");
    }
    await cashAccounts.completeRefresh(
      "synthetic-access-subject",
      cashRun.id,
      cashProposal.id,
      1,
    );
    await cashAccounts.applyProposal(
      "synthetic-access-subject",
      cashProposal.id,
      {
        changeNote: "Reviewed synthetic cash for the FI baseline.",
        decisions: cashProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const state = await baselines.getState("synthetic-access-subject");
    expect(state).toMatchObject({
      status: "ready",
      baseForecastSnapshotId: "snap_fi_v3",
      baseForecastSnapshotVersion: 3,
      summary: {
        positionCount: 4,
        publicMarketValueMinor: 223_457,
        privatePaperValueMinor: 2_500_000,
        cashAccountCount: 1,
        cashAccountValueMinor: 300_000,
        unknownCashAccountCount: 0,
        unknownValueCount: 1,
        potentialDuplicateCount: 0,
      },
      hasSourceChanges: true,
      hasCashAccountChanges: true,
      requiresDuplicateReview: false,
      requiresCashOverlapReview: false,
      canConfirm: true,
      suggestedOtherFiEligibleLiquidMinor: 0,
    });
    expect(state.cashAccounts).toEqual([
      expect.objectContaining({
        accountLabel: "Household checking",
        refreshKind: "initial",
      }),
    ]);
    expect(
      state.positions.filter((position) => position.potentialDuplicate),
    ).toHaveLength(0);
    expect(state.positions).not.toContainEqual(
      expect.objectContaining({ ticker: "SDA" }),
    );
    if (
      state.sourceRevision === null ||
      state.baseForecastSnapshotId === null ||
      state.baseForecastSnapshotVersion === null
    ) {
      throw new Error("Expected a confirmable synthetic baseline.");
    }

    const confirmation = {
      sourceRevision: state.sourceRevision,
      baseForecastSnapshotId: state.baseForecastSnapshotId,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor: 199_476_543,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Reviewed synced holdings for the FI plan.",
    };
    await expect(
      baselines.confirm("synthetic-access-subject", {
        ...confirmation,
        sourceRevision: "0".repeat(64),
      }),
    ).rejects.toThrow("stale");
    await expect(
      baselines.confirm("synthetic-access-subject", {
        ...confirmation,
      }),
    ).rejects.toThrow("cash overlaps");

    const confirmed = await baselines.confirm("synthetic-access-subject", {
      ...confirmation,
      cashOverlapReviewConfirmed: true,
    });
    expect(confirmed).toMatchObject({
      baseline: {
        sourceRevision: state.sourceRevision,
        priorFiEligibleLiquidMinor: 182_500_000,
        fiEligibleLiquidMinor: 200_000_000,
        otherFiEligibleLiquidMinor: 199_476_543,
        forecastSnapshotVersion: 4,
        goalVersion: 2,
      },
      impact: {
        fiEligibleChangeMinor: 17_500_000,
        protectedRunwayMonths: 46,
        fiGapMinor: 125_000_000,
        lowerTotalAvailableMinor: 294_000_000,
        middleTotalAvailableMinor: 410_000_000,
        higherTotalAvailableMinor: 554_000_000,
        probabilityCrossingFiPpm: 683_190,
      },
    });

    const stored = sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM portfolio_baselines) AS baselines,
           (SELECT COUNT(*) FROM portfolio_baseline_items) AS baseline_items,
           (SELECT COUNT(*) FROM portfolio_baseline_cash_items)
             AS baseline_cash_items,
           (SELECT COUNT(*) FROM cash_flow_plans WHERE scenario_id = 'scn_fi')
             AS fi_plans,
           (SELECT MAX(version) FROM forecast_snapshots
            WHERE scenario_id = 'scn_fi') AS latest_forecast_version,
           (SELECT probability_ppm FROM forecast_outputs
            WHERE forecast_snapshot_id = ?
              AND metric_key = 'probability_crossing_fi') AS crossing_ppm,
           (SELECT MAX(version) FROM goal_versions
            WHERE goal_id = 'goal_fi') AS latest_goal_version`,
      )
      .get(confirmed.baseline.forecastSnapshotId) as {
      baselines: number;
      baseline_items: number;
      baseline_cash_items: number;
      fi_plans: number;
      latest_forecast_version: number;
      crossing_ppm: number;
      latest_goal_version: number;
    };
    expect(stored).toEqual({
      baselines: 1,
      baseline_items: 4,
      baseline_cash_items: 1,
      fi_plans: 2,
      latest_forecast_version: 4,
      crossing_ppm: 683_190,
      latest_goal_version: 2,
    });
    expect(() =>
      sqlite.exec(`
        INSERT INTO portfolio_baseline_items (
          id, household_id, baseline_id, position_id, snapshot_id, provider,
          classification, value_minor, value_state, observed_at, duplicate_key,
          created_at
        )
        SELECT
          'duplicate_baseline_item', household_id, baseline_id, position_id,
          snapshot_id, provider, classification, value_minor, value_state,
          observed_at, duplicate_key, created_at
        FROM portfolio_baseline_items
        WHERE baseline_id = '${confirmed.baseline.id}'
        LIMIT 1
      `),
    ).toThrow(/UNIQUE constraint failed/u);
    sqlite.exec(`
      INSERT INTO holding_import_rows (
        id, household_id, import_id, source_row_number, position_fingerprint,
        snapshot_fingerprint, legal_vehicle_name, owner_label, exposure_label,
        provider_status, invested_on, invested_minor, allocation_minor,
        unrealized_value_minor, unrealized_value_state, realized_value_minor,
        net_value_minor, net_value_state, instrument_type, currency_hint,
        parse_status, issue_codes_json, position_kind, quantity_micros, ticker,
        cost_basis_minor, created_at
      )
      SELECT
        'unaccepted_baseline_row', household_id, import_id, 99,
        '${"5".repeat(64)}', '${"6".repeat(64)}',
        'Synthetic unaccepted position', owner_label, exposure_label,
        provider_status, invested_on, invested_minor, allocation_minor,
        unrealized_value_minor, unrealized_value_state, realized_value_minor,
        net_value_minor, net_value_state, instrument_type, currency_hint,
        parse_status, issue_codes_json, position_kind, quantity_micros, ticker,
        cost_basis_minor, created_at
      FROM holding_import_rows
      WHERE import_id IN (
        SELECT id FROM holding_imports WHERE provider = 'angellist'
      )
      LIMIT 1;

      INSERT INTO holding_positions (
        id, household_id, provider, position_fingerprint, legal_vehicle_name,
        owner_label, position_kind, instrument_type, opened_on, currency,
        created_by, created_at
      )
      SELECT
        'unaccepted_baseline_position', household_id, provider,
        '${"5".repeat(64)}', 'Synthetic unaccepted position', owner_label,
        position_kind, instrument_type, opened_on, currency, created_by,
        created_at
      FROM holding_positions
      WHERE provider = 'angellist'
      LIMIT 1;

      INSERT INTO holding_position_snapshots (
        id, household_id, position_id, source_document_id,
        source_import_row_id, snapshot_fingerprint, provider_status,
        invested_minor, allocation_minor, unrealized_value_minor,
        unrealized_value_state, realized_value_minor, net_value_minor,
        net_value_state, instrument_type, currency, observed_at, created_at,
        quantity_micros, ticker, cost_basis_minor
      )
      SELECT
        'unaccepted_baseline_snapshot', row.household_id,
        'unaccepted_baseline_position', import.source_document_id,
        'unaccepted_baseline_row', '${"6".repeat(64)}',
        snapshot.provider_status, snapshot.invested_minor,
        snapshot.allocation_minor, snapshot.unrealized_value_minor,
        snapshot.unrealized_value_state, snapshot.realized_value_minor,
        snapshot.net_value_minor, snapshot.net_value_state,
        snapshot.instrument_type, snapshot.currency, snapshot.observed_at,
        snapshot.created_at, snapshot.quantity_micros, snapshot.ticker,
        snapshot.cost_basis_minor
      FROM holding_import_rows row
      JOIN holding_imports import ON import.id = row.import_id
      JOIN holding_import_rows accepted_row
        ON accepted_row.import_id = row.import_id
       AND accepted_row.id <> row.id
      JOIN holding_position_snapshots snapshot
        ON snapshot.source_import_row_id = accepted_row.id
      WHERE row.id = 'unaccepted_baseline_row'
      LIMIT 1;
    `);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO portfolio_baseline_items (
             id, household_id, baseline_id, position_id, snapshot_id, provider,
             classification, value_minor, value_state, observed_at,
             duplicate_key, created_at
           )
           SELECT
             'unaccepted_baseline_item', 'hh_demo', ?, position.id, snapshot.id,
             'angellist', 'private_paper', snapshot.unrealized_value_minor,
             snapshot.unrealized_value_state, snapshot.observed_at, NULL,
             snapshot.created_at
           FROM holding_positions position
           JOIN holding_position_snapshots snapshot
             ON snapshot.position_id = position.id
           WHERE position.id = 'unaccepted_baseline_position'`,
        )
        .run(confirmed.baseline.id),
    ).toThrow(/not an accepted snapshot/u);

    const alpha = await new D1AlphaRepository(
      database as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(alpha.dashboard).toMatchObject({
      asOfDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      fiEligibleLiquidMinor: 200_000_000,
      protectedRunwayMonths: 46,
      fiGapMinor: 125_000_000,
      probabilityCrossingFiPpm: 683_190,
    });
    expect(alpha.goals[0]?.versions[0]).toMatchObject({
      version: 2,
      currentValueInteger: 200_000_000,
      currentValueSource: "Portfolio baseline",
      forecast: {
        lowerValueInteger: 294_000_000,
        middleValueInteger: 410_000_000,
        higherValueInteger: 554_000_000,
        successProbabilityPpm: 683_190,
      },
    });
    expect(alpha.forecastHistory[0]).toMatchObject({
      version: 4,
      trigger: "Portfolio baseline",
    });

    await expect(
      baselines.getState("synthetic-access-subject"),
    ).resolves.toMatchObject({
      status: "current",
      hasSourceChanges: false,
      hasCashAccountChanges: false,
      canConfirm: false,
      suggestedOtherFiEligibleLiquidMinor: 199_476_543,
      latestBaseline: { id: confirmed.baseline.id },
    });

    const angelListPosition = state.positions.find(
      (position) => position.provider === "angellist",
    );
    if (angelListPosition === undefined) {
      throw new Error("Expected a synthetic AngelList position.");
    }
    const exposureRepository = new D1ExposureRepository(
      database as unknown as D1Database,
    );
    const unresolvedExposure = await exposureRepository.resolveExposure(
      "synthetic-access-subject",
      {
        exposureKind: "unresolved",
        canonicalName: "Synthetic unresolved look-through",
        evidenceSha256: "3".repeat(64),
      },
    );
    await exposureRepository.recordMapping("synthetic-access-subject", {
      positionId: angelListPosition.id,
      exposureId: unresolvedExposure.id,
      relationshipKind: "look_through",
      allocationPpm: null,
      status: "active",
      decisionSource: "review",
      decisionReference: "synthetic relationship; allocation unknown",
      evidenceSha256: "4".repeat(64),
      effectiveAt: "2026-08-16T01:00:00.000Z",
    });
    const connectionVersion = sqlite
      .prepare(
        `SELECT id, version, institution_key, lifecycle_state,
                credential_reference
         FROM investment_connection_versions version
         WHERE connection_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM investment_connection_versions later
             WHERE later.supersedes_version_id = version.id
           )`,
      )
      .get(robinhoodConnectionId) as {
      id: string;
      version: number;
      institution_key: string;
      lifecycle_state: string;
      credential_reference: string | null;
    };
    sqlite
      .prepare(
        `INSERT INTO investment_connection_versions (
           id, household_id, connection_id, version, institution_key,
           institution_label, lifecycle_state, credential_reference,
           supersedes_version_id, recorded_by_user_id, recorded_at, immutable
         ) VALUES (?, 'hh_demo', ?, ?, ?, ?, ?, ?, ?, 'usr_demo', ?, 1)`,
      )
      .run(
        "synthetic_connection_label_change",
        robinhoodConnectionId,
        connectionVersion.version + 1,
        connectionVersion.institution_key,
        "Synthetic Brokerage Renamed",
        connectionVersion.lifecycle_state,
        connectionVersion.credential_reference,
        connectionVersion.id,
        "2026-08-16T01:05:00.000Z",
      );

    await expect(
      baselines.getState("synthetic-access-subject"),
    ).resolves.toMatchObject({
      status: "current",
      sourceRevision: confirmed.baseline.sourceRevision,
      hasSourceChanges: false,
      canConfirm: false,
      latestBaseline: { id: confirmed.baseline.id },
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS forecast_count
           FROM forecast_snapshots
           WHERE scenario_id = 'scn_fi'`,
        )
        .get(),
    ).toEqual({ forecast_count: stored.latest_forecast_version });

    const updatedCashRun = await cashAccounts.beginRefresh(
      "synthetic-access-subject",
      cashConnection.id,
      "live",
    );
    const updatedCashStage = await cashAccounts.stageProposal(
      "synthetic-access-subject",
      updatedCashRun.id,
      {
        objectKey: "cash-observations/synthetic-baseline-live.json",
        sourceSha256: "1".repeat(64),
        normalized: {
          normalizedFingerprint: "2".repeat(64),
          observedAt: "2026-08-14T20:00:00.000Z",
          rows: [
            {
              naturalKeySha256: "f".repeat(64),
              itemAccountKeySha256: "f".repeat(64),
              institutionLabel: "First Synthetic Bank",
              accountLabel: "Household checking",
              subtype: "checking",
              availableMinor: 350_000,
              currentMinor: 350_000,
              valueMinor: 350_000,
              valueState: "reported",
              balanceSource: "available",
              observedAt: "2026-08-14T20:00:00.000Z",
              issues: [],
            },
          ],
        },
      },
    );
    if (updatedCashStage.proposal === null) {
      throw new Error("Expected an updated synthetic cash proposal.");
    }
    await cashAccounts.completeRefresh(
      "synthetic-access-subject",
      updatedCashRun.id,
      updatedCashStage.proposal.id,
      1,
    );
    await cashAccounts.applyProposal(
      "synthetic-access-subject",
      updatedCashStage.proposal.id,
      {
        changeNote: "Reviewed the updated synthetic cash balance.",
        decisions: updatedCashStage.proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );
    await expect(
      baselines.getState("synthetic-access-subject"),
    ).resolves.toMatchObject({
      status: "ready",
      hasSourceChanges: true,
      hasCashAccountChanges: true,
      summary: { cashAccountValueMinor: 350_000 },
      latestBaseline: { id: confirmed.baseline.id },
    });

    expect(() =>
      sqlite
        .prepare("UPDATE portfolio_baselines SET change_note = 'changed'")
        .run(),
    ).toThrow("immutable");
    expect(() =>
      sqlite
        .prepare(
          `UPDATE cash_flow_plans
           SET fi_eligible_liquid_minor = 0
           WHERE id = (
             SELECT cash_flow_plan_id FROM portfolio_baselines LIMIT 1
           )`,
        )
        .run(),
    ).toThrow("immutable");
  });

  it("materializes a reviewed opaque identity rotation as one cash account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T19:00:00.000Z"));
    const holding = await holdingImports.stageHoldingImport(
      "synthetic-access-subject",
      stageInput("2".repeat(64)),
    );
    await holdingImports.applyHoldingImport(
      "synthetic-access-subject",
      holding.preview.id,
      {
        currency: "USD",
        decisions: holding.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
          rationale: "Reviewed a synthetic baseline prerequisite.",
        })),
      },
    );

    const connection = await cashAccounts.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "3".repeat(64),
    );
    const initial = await cashAccounts.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const initialProposal = (
      await cashAccounts.stageProposal("synthetic-access-subject", initial.id, {
        objectKey: "cash-observations/synthetic-identity-initial.json",
        sourceSha256: "4".repeat(64),
        normalized: {
          normalizedFingerprint: "5".repeat(64),
          observedAt: "2026-08-14T18:00:00.000Z",
          rows: [
            {
              naturalKeySha256: "6".repeat(64),
              itemAccountKeySha256: "7".repeat(64),
              institutionLabel: "First Synthetic Bank",
              accountLabel: "Household checking",
              subtype: "checking",
              availableMinor: 300_000,
              currentMinor: 300_000,
              valueMinor: 300_000,
              valueState: "reported",
              balanceSource: "available",
              observedAt: "2026-08-14T18:00:00.000Z",
              issues: [],
            },
          ],
        },
      })
    ).proposal;
    if (initialProposal === null) {
      throw new Error("Expected an initial synthetic cash proposal.");
    }
    await cashAccounts.completeRefresh(
      "synthetic-access-subject",
      initial.id,
      initialProposal.id,
      1,
    );
    await cashAccounts.applyProposal(
      "synthetic-access-subject",
      initialProposal.id,
      {
        changeNote: "Accepted the initial synthetic cash identity.",
        decisions: initialProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const live = await cashAccounts.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const proposalId = "cash_proposal_baseline_identity_split";
    const reportedRowId = "cash_row_baseline_identity_reported";
    const missingRowId = "cash_row_baseline_identity_missing";
    const observedAt = "2026-08-15T18:00:00.000Z";
    sqlite
      .prepare(
        `INSERT INTO cash_balance_proposals (
           id, household_id, connector_account_id, sync_run_id,
           source_object_key, source_sha256, normalized_fingerprint,
           refresh_kind, observed_at, retrieved_at, status, created_at
         ) VALUES (?, 'hh_demo', ?, ?, ?, ?, ?, 'live', ?, ?,
                   'pending_review', ?)`,
      )
      .run(
        proposalId,
        connection.id,
        live.id,
        "cash-observations/synthetic-baseline-identity-split.json",
        "8".repeat(64),
        "9".repeat(64),
        observedAt,
        observedAt,
        observedAt,
      );
    sqlite
      .prepare(
        `INSERT INTO cash_balance_proposal_rows (
           id, household_id, proposal_id, natural_key_sha256,
           item_account_key_sha256, institution_label, account_label, subtype,
           available_minor, current_minor, value_minor, value_state,
           balance_source, observed_at, issues_json, created_at
         ) VALUES (?, 'hh_demo', ?, ?, ?, 'First Synthetic Bank',
                   'Household checking', 'checking', 325000, 325000, 325000,
                   'reported', 'available', ?, '[]', ?)`,
      )
      .run(
        reportedRowId,
        proposalId,
        "a".repeat(64),
        "a".repeat(64),
        observedAt,
        observedAt,
      );
    sqlite
      .prepare(
        `INSERT INTO cash_balance_proposal_rows (
           id, household_id, proposal_id, natural_key_sha256,
           item_account_key_sha256, institution_label, account_label, subtype,
           available_minor, current_minor, value_minor, value_state,
           balance_source, observed_at, issues_json, created_at
         ) VALUES (?, 'hh_demo', ?, ?, NULL, 'First Synthetic Bank',
                   'Household checking', 'checking', NULL, NULL, NULL,
                   'not_reported', NULL, ?, ?, ?)`,
      )
      .run(
        missingRowId,
        proposalId,
        "6".repeat(64),
        observedAt,
        JSON.stringify([
          "This account was not reported in the latest balance check.",
        ]),
        observedAt,
      );
    await cashAccounts.completeRefresh(
      "synthetic-access-subject",
      live.id,
      proposalId,
      2,
    );
    await cashAccounts.applyProposal("synthetic-access-subject", proposalId, {
      changeNote: "Accepted the synthetic provider identity rotation.",
      decisions: [reportedRowId, missingRowId].map((rowId) => ({
        rowId,
        decision: "accepted",
      })),
    });
    await expect(
      cashAccounts.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      acceptedAccounts: expect.arrayContaining([
        expect.objectContaining({ valueState: "not_reported" }),
        expect.objectContaining({ valueState: "reported" }),
      ]),
      identityCandidates: [
        expect.objectContaining({ accountLabel: "Household checking" }),
      ],
    });
    await cashAccounts.reviewIdentity("synthetic-access-subject", {
      connectionId: connection.id,
      priorNaturalKeySha256: "6".repeat(64),
      reportedNaturalKeySha256: "a".repeat(64),
      decision: "same_account",
      changeNote: "Confirmed the synthetic records describe one account.",
    });

    const state = await baselines.getState("synthetic-access-subject");
    expect(state).toMatchObject({
      status: "ready",
      summary: {
        cashAccountCount: 1,
        cashAccountValueMinor: 325_000,
        unknownCashAccountCount: 0,
      },
    });
    expect(state.cashAccounts).toEqual([
      expect.objectContaining({
        accountLabel: "Household checking",
        valueMinor: 325_000,
        valueState: "reported",
        refreshKind: "live",
      }),
    ]);
    if (
      state.sourceRevision === null ||
      state.baseForecastSnapshotId === null ||
      state.baseForecastSnapshotVersion === null
    ) {
      throw new Error("Expected a confirmable synthetic baseline.");
    }

    const confirmed = await baselines.confirm("synthetic-access-subject", {
      sourceRevision: state.sourceRevision,
      baseForecastSnapshotId: state.baseForecastSnapshotId,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor: state.suggestedOtherFiEligibleLiquidMinor,
      duplicateReviewConfirmed: true,
      cashOverlapReviewConfirmed: true,
      changeNote: "Confirmed the reconciled synthetic cash identity.",
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM portfolio_baseline_cash_items
           WHERE baseline_id = ?`,
        )
        .get(confirmed.baseline.id),
    ).toEqual({ count: 1 });
  });
});
