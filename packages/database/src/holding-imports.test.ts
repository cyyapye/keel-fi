import { createSqliteFixture } from "../../../scripts/test-support/sqlite-fixture";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  parseProviderHoldingsTemplateCsv,
  providerHoldingsTemplateCsv,
} from "@keel/connectors";

import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
  type PlaidInvestmentsHoldingImportStageInput,
} from "./holding-imports";
import { D1AlphaRepository } from "./index";
import { D1CashAccountsRepository } from "./cash-accounts";
import { D1ExposureRepository } from "./exposures";
import { D1InvestmentExposureViewRepository } from "./exposure-read-model";
import {
  D1PortfolioBaselineRepository,
  refreshAcceptedPortfolioBaseline,
} from "./portfolio-baseline";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1LegalEntityRepository } from "./legal-entities";

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
  "packages/database/migrations/0039_reviewed_position_economics.sql",
  "packages/database/migrations/0058_net_invested_position_economics.sql",
  "packages/database/migrations/0040_holdings_read_performance.sql",
  "packages/database/migrations/0041_reported_position_economics.sql",
  "packages/database/migrations/0046_reviewed_legal_entity_inventory.sql",
  "packages/database/migrations/0047_provider_legal_document_evidence.sql",
  "packages/database/migrations/0048_private_document_access.sql",
  "packages/database/migrations/0049_legal_name_resolutions.sql",
  "packages/database/migrations/0050_agreement_rechecks.sql",
  "packages/database/migrations/0051_legal_structure_review_guard.sql",
  "packages/database/migrations/0052_reviewed_structure_entity_type.sql",
  "packages/database/migrations/0053_connected_investment_reviews.sql",
  "packages/database/migrations/0055_exception_based_source_updates.sql",
  "packages/database/migrations/0056_exception_based_cash_balances.sql",
  "packages/database/migrations/0059_automatic_investment_reviews.sql",
  "packages/database/migrations/0062_reviewed_company_aliases.sql",
  "packages/database/migrations/0070_private_purchase_details.sql",
  "packages/database/migrations/0074_purchase_fee_economics.sql",
  "packages/database/migrations/0072_reviewed_public_company_links.sql",
  "packages/database/migrations/0064_watch_read_receipts.sql",
  "packages/database/migrations/0068_exception_baseline_empty.sql",
  "packages/database/migrations/0075_provider_share_prices.sql",
  "packages/database/migrations/0078_reviewed_position_links.sql",
  "packages/database/migrations/0079_unified_investment_details.sql",
  "packages/database/migrations/0080_renamed_investment_links.sql",
  "packages/database/migrations/0076_proxy_share_estimates.sql",
  "packages/database/migrations/0083_selected_position_valuations.sql",
  "packages/database/migrations/0086_live_price_proxies.sql",
  "packages/database/migrations/0087_wefunder_holdings.sql",
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
              "packages/database/migrations/0076_proxy_share_estimates.sql",
              "packages/database/migrations/0083_selected_position_valuations.sql",
              "packages/database/migrations/0086_live_price_proxies.sql",
              "packages/database/migrations/0078_reviewed_position_links.sql",
              "packages/database/migrations/0087_wefunder_holdings.sql",
              "packages/database/migrations/0079_unified_investment_details.sql",
              "packages/database/migrations/0080_renamed_investment_links.sql",
              "packages/database/migrations/0068_exception_baseline_empty.sql",
              "packages/database/migrations/0055_exception_based_source_updates.sql",
              "packages/database/migrations/0035_nullable_private_investment_date.sql",
              "packages/database/migrations/0036_exact_reviewed_private_exposures.sql",
              "packages/database/migrations/0037_private_provider_position_continuity.sql",
              "packages/database/migrations/0038_reviewed_position_value_adjustments.sql",
              "packages/database/migrations/0039_reviewed_position_economics.sql",
              "packages/database/migrations/0058_net_invested_position_economics.sql",
              "packages/database/migrations/0059_automatic_investment_reviews.sql",
              "packages/database/migrations/0062_reviewed_company_aliases.sql",
              "packages/database/migrations/0075_provider_share_prices.sql",
              "packages/database/migrations/0070_private_purchase_details.sql",
              "packages/database/migrations/0074_purchase_fee_economics.sql",
              "packages/database/migrations/0072_reviewed_public_company_links.sql",
              "packages/database/migrations/0040_holdings_read_performance.sql",
              "packages/database/migrations/0041_reported_position_economics.sql",
              "packages/database/migrations/0053_connected_investment_reviews.sql",
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
    private readonly recordRoundTrip: () => void = () => undefined,
  ) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    return new TestD1Statement(
      this.database,
      this.sql,
      values,
      this.recordRoundTrip,
    );
  }

  public first<T>(): Promise<T | null> {
    this.recordRoundTrip();
    return Promise.resolve(
      (this.database.prepare(this.sql).get(...this.values) as T) ?? null,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    this.recordRoundTrip();
    return Promise.resolve({
      results: this.database.prepare(this.sql).all(...this.values) as T[],
    });
  }

  public run(): Promise<{ meta: { changes: number } }> {
    this.recordRoundTrip();
    const result = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }

  public execute(): void {
    this.database.prepare(this.sql).run(...this.values);
  }
}

class TestD1Database {
  public roundTripCount = 0;
  public readonly preparedSql: string[] = [];

  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    this.preparedSql.push(sql);
    return new TestD1Statement(this.database, sql, [], () => {
      this.roundTripCount += 1;
    });
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
    this.roundTripCount += 1;
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

  public resetRoundTripCount(): void {
    this.roundTripCount = 0;
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
          managementFeePpm: null,
          carryPpm: 200_000,
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
  provider: "tokenfolio" | "sydecar" | "wefunder",
): HoldingImportStageInput {
  const source = stageInput(
    provider === "tokenfolio" ? "4".repeat(64) : "5".repeat(64),
  );
  const sourceRow = source.rows[0];
  if (sourceRow === undefined) {
    throw new Error("Synthetic template fixture is missing its row.");
  }
  const tokenfolio = provider !== "sydecar";
  return {
    ...source,
    provider,
    formatVersion: tokenfolio ? 1 : 2,
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
          managementFeePpm: tokenfolio ? null : 20_000,
          carryPpm: tokenfolio ? null : 200_000,
        },
      },
    ],
    canonicalScope: {
      connection: {
        mode: "ensure",
        adapterType: "manual",
        protectedSourceKey: tokenfolio ? "8".repeat(64) : "9".repeat(64),
        institutionKey: provider,
        institutionLabel: {
          tokenfolio: "Tokenfolio",
          sydecar: "Sydecar",
          wefunder: "Wefunder",
        }[provider],
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
  let database: TestD1Database;
  let repository: D1HoldingImportRepository;

  beforeEach(() => {
    sqlite = createSqliteFixture(migrationFiles);
    seedRobinhoodInvestmentConnection(sqlite);
    database = new TestD1Database(sqlite);
    repository = new D1HoldingImportRepository(
      database as unknown as D1Database,
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  it.each([1, 120])(
    "links %i accepted Wefunder legal positions to an existing entity only after confirmation",
    async (count) => {
      const subject = "synthetic-access-subject";
      const d1 = database as unknown as D1Database;
      const positions = new D1InvestmentPositionViewRepository(d1);
      const entities = new D1LegalEntityRepository(d1);
      const emptyView = await positions.list(subject);
      const legalName = "Synthetic Named Vehicle LLC";
      const createEntity = (name: string) =>
        entities.create(
          subject,
          {
            source: null,
            profile: {
              legalName: name,
              entityType: "llc",
              relationship: "investment_vehicle",
              currentOwner: null,
              jurisdiction: null,
              formedOn: null,
              einLastFour: null,
              ownershipInterestPpm: null,
              interestStatus: "current",
              taxClassification: null,
              notes: null,
            },
          },
          emptyView,
        );
      const existing = await createEntity(legalName);
      const companyOnly = await createEntity(
        "Synthetic Operating Company 0 LLC",
      );
      const entityIdsBeforeImport = sqlite
        .prepare("SELECT id FROM legal_entities ORDER BY id")
        .all();
      const csv =
        providerHoldingsTemplateCsv("wefunder") +
        Array.from({ length: count }, (_, index) =>
          [
            `Synthetic Operating Company ${index} LLC`,
            legalName,
            "SPV",
            "Synthetic Family Trust",
            "Live",
            "",
            "2026-08-20",
            "$1250.00",
            "",
            "",
            "",
            "Membership interest",
          ].join(","),
        ).join("\n") +
        "\n";
      const parsed = await parseProviderHoldingsTemplateCsv(
        "wefunder",
        new TextEncoder().encode(csv),
      );
      const base = providerTemplateStageInput("wefunder");
      const staged = await repository.stageHoldingImport(subject, {
        ...base,
        ...parsed,
        sha256: createHash("sha256").update(csv).digest("hex"),
        byteSize: new TextEncoder().encode(csv).byteLength,
        canonicalScope: {
          ...base.canonicalScope,
          rows: parsed.rows.map((row) => ({
            sourceRowNumber: row.rowNumber,
            protectedAccountKey: "6".repeat(64),
            protectedPositionKey: row.naturalKeySha256,
          })),
        },
      });
      await new D1AlphaRepository(d1).reconcileHoldingImport(
        subject,
        staged.preview.id,
      );

      database.resetRoundTripCount();
      const view = await positions.list(subject);
      expect(database.roundTripCount).toBe(4);
      const imported = view.connections.flatMap((connection) =>
        connection.containers.flatMap((container) =>
          container.positions.filter(
            (position) => position.source.label === "Wefunder template",
          ),
        ),
      );
      expect(imported).toHaveLength(count);
      expect(
        imported.every(
          (position) =>
            position.legalEntityNameEvidence.state === "template_reported" &&
            position.legalEntityNameEvidence.legalName === legalName &&
            position.legalEntityNameEvidence.sourceField ===
              "Legal Position (Wefunder template)",
        ),
      ).toBe(true);
      const projectionSql = database.preparedSql
        .filter(
          (sql) =>
            sql.includes("FROM holding_positions position") &&
            sql.includes("prior_application"),
        )
        .at(-1)!;
      const plan = sqlite
        .prepare(`EXPLAIN QUERY PLAN ${projectionSql}`)
        .all("hh_demo") as Array<{ detail: string }>;
      expect(
        plan.some((row) => /SCAN (candidate|accepted_row)\b/u.test(row.detail)),
      ).toBe(false);

      const before = await entities.getState(subject, view);
      expect(
        before.entities.find((entity) => entity.id === existing.id)?.sources,
      ).toHaveLength(0);
      expect(before.exactBatch).toMatchObject({
        sourceCount: count,
        existingEntityCount: 1,
        newEntityCount: 0,
      });
      const snapshots = sqlite
        .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
        .all();
      await entities.applyExactBatch(
        subject,
        { expectedRevision: before.exactBatch.revision },
        view,
      );
      const reloaded = await entities.getState(
        subject,
        positions.list(subject),
      );
      expect(
        reloaded.entities
          .find((entity) => entity.id === existing.id)
          ?.sources.filter(
            (source) => source.source.kind === "holding_position",
          ),
      ).toHaveLength(count);
      expect(
        reloaded.entities.find((entity) => entity.id === companyOnly.id)
          ?.sources,
      ).toHaveLength(0);
      expect(
        sqlite
          .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
          .all(),
      ).toEqual(snapshots);
      expect(
        sqlite
          .prepare(
            "SELECT COUNT(*) count FROM legal_entity_source_decisions WHERE legal_entity_id = ? AND decision_source = 'manual'",
          )
          .get(existing.id),
      ).toEqual({ count });
      await new D1AlphaRepository(d1).reconcileHoldingImport(
        subject,
        staged.preview.id,
      );
      expect(
        sqlite
          .prepare(
            "SELECT COUNT(*) count FROM legal_entity_source_decisions WHERE legal_entity_id = ?",
          )
          .get(existing.id),
      ).toEqual({ count });
      expect(
        sqlite.prepare("SELECT id FROM legal_entities ORDER BY id").all(),
      ).toEqual(entityIdsBeforeImport);
    },
  );

  it("retains Tokenfolio per-share observations without accepting a financial record", async () => {
    const input = providerTemplateStageInput("tokenfolio");
    const sharePrices = {
      costMicros: 12345678,
      markMicros: 23456789,
      markDate: null,
      shareClass: null,
    };
    const captured = {
      ...input,
      formatVersion: 4 as const,
      rows: input.rows.map((row) => ({
        ...row,
        providerInvestmentId: "synthetic-price-investment",
        dealMetadata: { ...row.dealMetadata, sharePrices },
      })),
    };
    const staged = await repository.stageHoldingImport(
      "synthetic-access-subject",
      captured,
    );
    expect(
      JSON.parse(
        (
          sqlite
            .prepare(
              "SELECT evidence_json FROM holding_import_share_prices WHERE import_row_id=?",
            )
            .get(staged.preview.rows[0]!.id) as { evidence_json: string }
        ).evidence_json,
      ),
    ).toEqual(sharePrices);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) count FROM holding_positions WHERE provider='tokenfolio'",
        )
        .get(),
    ).toEqual({ count: 0 });
    await expect(
      repository.stageHoldingImport("synthetic-access-subject", {
        ...captured,
        formatVersion: 3,
      }),
    ).rejects.toThrow();
    expect(() =>
      sqlite.exec("UPDATE holding_import_share_prices SET evidence_json='{}'"),
    ).toThrow(/immutable/u);
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
          reportedManagementFeePpm: null,
          reportedCarryPpm: 200_000,
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
        positionEconomicsContext: expect.objectContaining({
          reportedTerms: {
            managementFeePpm: null,
            carryPpm: 200_000,
            sourceLabel: "AngelList export",
            observedAt: "2026-06-14T12:00:00.000Z",
          },
          acceptedTerms: null,
        }),
      }),
    );

    const positionView = await new D1InvestmentPositionViewRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).list("synthetic-access-subject", "2026-06-15T00:00:00.000Z");
    expect(
      positionView.connections
        .flatMap((connection) => connection.containers)
        .flatMap((container) => container.positions)[0]?.reportedEconomicsTerms,
    ).toEqual({
      managementFeePpm: null,
      carryPpm: 200_000,
      sourceLabel: "AngelList export",
      observedAt: "2026-06-14T12:00:00.000Z",
    });
  });

  it("enriches an accepted byte-identical AngelList export with newly parsed carry evidence", async () => {
    const withCarry = stageInput("0".repeat(64));
    const withoutCarry = {
      ...withCarry,
      rows: withCarry.rows.map((row) => ({
        ...row,
        dealMetadata: {
          ...row.dealMetadata,
          carryPpm: null,
        },
      })),
    };
    const staged = await repository.stageHoldingImport(
      "synthetic-access-subject",
      withoutCarry,
    );
    expect(staged.preview.rows[0]).toMatchObject({
      reportedManagementFeePpm: null,
      reportedCarryPpm: null,
    });
    await repository.applyHoldingImport(
      "synthetic-access-subject",
      staged.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: staged.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed synthetic legacy AngelList position.",
          },
        ],
      },
    );

    const duplicate = await repository.stageHoldingImport(
      "synthetic-access-subject",
      withCarry,
    );
    expect(duplicate).toMatchObject({
      created: false,
      preview: {
        id: staged.preview.id,
        status: "applied",
        rows: [
          {
            id: staged.preview.rows[0]!.id,
            reportedManagementFeePpm: null,
            reportedCarryPpm: 200_000,
          },
        ],
      },
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_import_row_reported_economics_evidence`,
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(() =>
      sqlite
        .prepare(
          `UPDATE holding_import_row_reported_economics_evidence
           SET carry_ppm = 150000`,
        )
        .run(),
    ).toThrow("immutable");
    expect(() =>
      sqlite
        .prepare("DELETE FROM holding_import_row_reported_economics_evidence")
        .run(),
    ).toThrow("immutable");

    const positionView = await new D1InvestmentPositionViewRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).list("synthetic-access-subject", "2026-06-15T00:00:00.000Z");
    expect(
      positionView.connections
        .flatMap((connection) => connection.containers)
        .flatMap((container) => container.positions)[0]?.reportedEconomicsTerms,
    ).toEqual({
      managementFeePpm: null,
      carryPpm: 200_000,
      sourceLabel: "AngelList export",
      observedAt: "2026-06-14T12:00:00.000Z",
    });
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

  it("rejects reported economics that the provider does not expose", async () => {
    const angelList = stageInput("1".repeat(64));
    await expect(
      repository.stageHoldingImport("synthetic-access-subject", {
        ...angelList,
        rows: angelList.rows.map((row) => ({
          ...row,
          dealMetadata: {
            ...row.dealMetadata,
            managementFeePpm: 10_000,
          },
        })),
      }),
    ).rejects.toThrow("AngelList export does not report management fees");

    const tokenfolio = providerTemplateStageInput("tokenfolio");
    await expect(
      repository.stageHoldingImport("synthetic-access-subject", {
        ...tokenfolio,
        rows: tokenfolio.rows.map((row) => ({
          ...row,
          positionKind: "spv_interest" as const,
          dealMetadata: {
            ...row.dealMetadata,
            carryPpm: 200_000,
          },
        })),
      }),
    ).rejects.toThrow("Tokenfolio capture does not report fee or carry");

    const sydecar = providerTemplateStageInput("sydecar");
    await expect(
      repository.stageHoldingImport("synthetic-access-subject", {
        ...sydecar,
        rows: sydecar.rows.map((row) => ({
          ...row,
          dealMetadata: {
            ...row.dealMetadata,
            managementFeePpm: null,
          },
        })),
      }),
    ).rejects.toThrow(
      "Sydecar version 2 rows require management fee and carry",
    );
  });

  it.each(["tokenfolio", "sydecar", "wefunder"] as const)(
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
            investedOn: provider !== "sydecar" ? "2025-02-01" : null,
            investedOnState:
              provider !== "sydecar" ? "reported" : "not_reported",
            reportedManagementFeePpm: provider !== "sydecar" ? null : 20_000,
            reportedCarryPpm: provider !== "sydecar" ? null : 200_000,
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
        provider !== "sydecar"
          ? {
              adapter_type: "manual",
              file_name: `${provider}-holdings.csv`,
              institution_key: provider,
              opened_on: "2025-02-01",
              position_kind: "direct",
              source_label:
                provider === "wefunder"
                  ? "Wefunder template"
                  : "Tokenfolio template",
              parser_schema: `${provider}_keel_template_v1`,
              management_fee_ppm: null,
              carry_ppm: null,
            }
          : {
              adapter_type: "manual",
              file_name: "sydecar-holdings.csv",
              institution_key: "sydecar",
              opened_on: null,
              position_kind: "spv_interest",
              source_label: "Sydecar template",
              parser_schema: "sydecar_keel_template_v2",
              management_fee_ppm: 20_000,
              carry_ppm: 200_000,
            };
      expect(
        sqlite
          .prepare(
            `SELECT connection.adapter_type, version.institution_key,
                    position.position_kind, position.opened_on,
                    document.file_name, document.source_label,
                    import.parser_schema, economics.management_fee_ppm,
                    economics.carry_ppm
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
             JOIN holding_import_rows row
               ON row.id = snapshot.source_import_row_id
             LEFT JOIN holding_import_row_reported_economics_evidence economics
               ON economics.import_row_id = row.id
             JOIN holding_imports import ON import.id = row.import_id
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
          sourceLabel: {
            tokenfolio: "Tokenfolio",
            sydecar: "Sydecar",
            wefunder: "Wefunder",
          }[provider],
        }),
      );

      if (provider === "wefunder") {
        const baseline = await new D1PortfolioBaselineRepository(
          new TestD1Database(sqlite) as unknown as D1Database,
        ).confirm("synthetic-access-subject", {
          sourceRevision: baselineState.sourceRevision!,
          baseForecastSnapshotId: baselineState.baseForecastSnapshotId!,
          baseForecastSnapshotVersion:
            baselineState.baseForecastSnapshotVersion!,
          otherFiEligibleLiquidMinor: 0,
          duplicateReviewConfirmed: true,
          cashOverlapReviewConfirmed: true,
          changeNote: "Reviewed synthetic Wefunder baseline.",
        });
        expect(
          sqlite
            .prepare(
              "SELECT provider FROM portfolio_baseline_items WHERE baseline_id = ? AND provider = 'wefunder'",
            )
            .all(baseline.baseline.id),
        ).toHaveLength(1);
        const beforeMigration = sqlite
          .prepare("SELECT * FROM portfolio_baseline_items ORDER BY id")
          .all();
        sqlite.exec(
          readFileSync(
            resolve(
              process.cwd(),
              "packages/database/migrations/0087_wefunder_holdings.sql",
            ),
            "utf8",
          ),
        );
        expect(
          sqlite
            .prepare("SELECT * FROM portfolio_baseline_items ORDER BY id")
            .all(),
        ).toEqual(beforeMigration);
        expect(() =>
          sqlite.exec("UPDATE portfolio_baseline_items SET value_minor = 0"),
        ).toThrow("immutable");
        expect(() =>
          sqlite.exec("DELETE FROM portfolio_baseline_items"),
        ).toThrow("immutable");
        expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        // Re-uploading the same evidence retains its original import and position.
        const repeated = await repository.stageHoldingImport(
          "synthetic-access-subject",
          providerTemplateStageInput(provider),
        );
        expect(repeated.created).toBe(false);
        expect(repeated.preview.id).toBe(staged.preview.id);
        expect(
          sqlite
            .prepare(
              "SELECT COUNT(*) count FROM holding_positions WHERE provider='wefunder'",
            )
            .get(),
        ).toEqual({ count: 1 });
      }

      const exposureReview = await new D1ExposureRepository(
        new TestD1Database(sqlite) as unknown as D1Database,
      ).getPrivateExposureReviewState("synthetic-access-subject");
      expect(exposureReview.positions).toContainEqual(
        expect.objectContaining({
          reportedExposureName:
            provider !== "sydecar"
              ? "Synthetic Robotics"
              : "Example Climate Fund",
        }),
      );

      const positionView = await new D1InvestmentPositionViewRepository(
        new TestD1Database(sqlite) as unknown as D1Database,
      ).list("synthetic-access-subject", "2026-08-21T00:00:00.000Z");
      const importedPosition = positionView.connections
        .flatMap((connection) => connection.containers)
        .flatMap((container) => container.positions)
        .find(
          (position) =>
            position.legalVehicleName ===
            (provider !== "sydecar"
              ? "Synthetic Robotics direct shares"
              : "Example Climate Fund SPV I"),
        );
      expect(importedPosition?.reportedEconomicsTerms).toEqual(
        provider === "sydecar"
          ? {
              managementFeePpm: 20_000,
              carryPpm: 200_000,
              sourceLabel: "Sydecar template",
              observedAt: "2026-08-20T12:00:00.000Z",
            }
          : null,
      );
    },
  );

  it("shows an existing reviewed company grouping on a repeated Sydecar position", async () => {
    const initial = await repository.stageHoldingImport(
      "synthetic-access-subject",
      providerTemplateStageInput("sydecar"),
    );
    await repository.applyHoldingImport(
      "synthetic-access-subject",
      initial.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: initial.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed the initial synthetic Sydecar position.",
          },
        ],
      },
    );

    const exposureRepository = new D1ExposureRepository(
      database as unknown as D1Database,
    );
    const reviewState = await exposureRepository.getPrivateExposureReviewState(
      "synthetic-access-subject",
    );
    const position = reviewState.positions.find(
      (candidate) => candidate.reportedExposureName === "Example Climate Fund",
    );
    expect(position).toBeDefined();
    await exposureRepository.assignPrivateCompanyExposure(
      "synthetic-access-subject",
      position!.positionId,
      {
        expectedSnapshotId: position!.snapshotId,
        company: { mode: "existing", companyId: "co_harbor" },
      },
    );

    const repeatedInput = providerTemplateStageInput("sydecar");
    const repeated = await repository.stageHoldingImport(
      "synthetic-access-subject",
      {
        ...repeatedInput,
        objectKey: "holding-imports/sydecar/synthetic-repeat.csv",
        sha256: "f0".repeat(32),
        retrievedAt: "2026-08-21T12:00:00.000Z",
      },
    );
    expect(repeated.preview.rows).toEqual([
      expect.objectContaining({
        action: "no_change",
        exposureName: "Example Climate Fund",
        currentExposureNames: ["Harbor Health Systems"],
      }),
    ]);
    await repository.applyHoldingImport(
      "synthetic-access-subject",
      repeated.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: repeated.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Confirmed the repeated synthetic Sydecar position.",
          },
        ],
      },
    );
    await expect(
      repository.getHoldingImport(
        "synthetic-access-subject",
        repeated.preview.id,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          action: "no_change",
          currentExposureNames: ["Harbor Health Systems"],
        },
      ],
    });
    await expect(
      exposureRepository.getPrivateExposureReviewState(
        "synthetic-access-subject",
      ),
    ).resolves.toMatchObject({ positions: [] });
  });

  it.each(["sydecar", "wefunder"] as const)(
    "previews 120 %s positions within a fixed D1 read budget",
    async (provider) => {
      const base = providerTemplateStageInput(provider);
      const baseRow = base.rows[0];
      const baseScopeRow = base.canonicalScope.rows[0];
      if (baseRow === undefined || baseScopeRow === undefined) {
        throw new Error("Synthetic Sydecar scale fixture is incomplete.");
      }
      const rows = Array.from({ length: 120 }, (_, index) => {
        const suffix = index.toString().padStart(3, "0");
        return {
          ...baseRow,
          rowNumber: index + 3,
          naturalKeySha256: (index + 1).toString(16).padStart(64, "0"),
          companyOrFund: `Synthetic Scale Company ${suffix}`,
          fundName: `Synthetic Scale SPV ${suffix}`,
        };
      });
      const staged = await repository.stageHoldingImport(
        "synthetic-access-subject",
        {
          ...base,
          objectKey: `holding-imports/${provider}/synthetic-scale.csv`,
          sha256: "a1".repeat(32),
          byteSize: 120_000,
          rows,
          canonicalScope: {
            ...base.canonicalScope,
            rows: rows.map((row) => ({
              sourceRowNumber: row.rowNumber,
              protectedAccountKey: baseScopeRow.protectedAccountKey,
              protectedPositionKey: row.naturalKeySha256,
            })),
          },
        },
      );

      database.resetRoundTripCount();
      const preview = await repository.getHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
      );
      expect(preview.rows).toHaveLength(120);
      expect(
        preview.rows.every((row) => row.currentExposureNames.length === 0),
      ).toBe(true);
      expect(database.roundTripCount).toBeLessThanOrEqual(5);

      const groupingSql = database.preparedSql
        .filter(
          (sql) =>
            sql.includes("row.id AS import_row_id") &&
            sql.includes("later_mapping.supersedes_mapping_id"),
        )
        .at(-1);
      expect(groupingSql).toBeDefined();
      const plan = sqlite
        .prepare(`EXPLAIN QUERY PLAN ${groupingSql ?? "SELECT 1"}`)
        .all(staged.preview.id, "hh_demo") as Array<{ detail: string }>;
      expect(
        plan.some((row) =>
          /SCAN (later_mapping|later_ownership)/u.test(row.detail),
        ),
      ).toBe(false);
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

describe("exception-based source updates", () => {
  let sqlite: DatabaseSync;
  let database: TestD1Database;
  let imports: D1HoldingImportRepository;
  let baselines: D1PortfolioBaselineRepository;
  const subject = "synthetic-access-subject";
  const clearInput = (hash: string, value = 125_000) => {
    const input = stageInput(hash, {
      unrealizedValueMinor: value,
      unrealizedValueState: "reported",
      netValueMinor: value,
      netValueState: "reported",
    });
    input.canonicalScope.containers[0]!.completeness = "complete";
    input.canonicalScope.containers[0]!.containerKind = "trust";
    input.canonicalScope.containers[0]!.displayLabel = "Synthetic Family Trust";
    return input;
  };
  beforeEach(() => {
    sqlite = createSqliteFixture(migrationFiles);
    database = new TestD1Database(sqlite);
    imports = new D1HoldingImportRepository(database as unknown as D1Database);
    baselines = new D1PortfolioBaselineRepository(
      database as unknown as D1Database,
    );
  });
  afterEach(() => sqlite.close());

  it("automatically accepts a clear private import and converges on repeated and concurrent deliveries", async () => {
    const staged = await imports.stageHoldingImport(
      subject,
      clearInput("1".repeat(64)),
    );
    const [first, concurrent] = await Promise.all([
      imports.autoAdjudicatePrivateHoldingImport(subject, staged.preview.id),
      imports.autoAdjudicatePrivateHoldingImport(subject, staged.preview.id),
    ]);
    expect(first.status).toBe("applied");
    expect(concurrent.status).toBe("applied");
    expect(first.rows[0]).toMatchObject({
      decisionSource: "policy",
      adjudicationStatus: "auto_applied",
    });
    await imports.autoAdjudicatePrivateHoldingImport(
      subject,
      staged.preview.id,
    );
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM holding_import_applications WHERE import_row_id = ?",
        )
        .get(first.rows[0]!.id),
    ).toEqual({ count: 1 });
  });

  it.each(["tokenfolio", "sydecar", "wefunder"] as const)(
    "accepts clear %s rows from partial coverage without inventing omissions",
    async (provider) => {
      const input = providerTemplateStageInput(provider);
      const staged = await imports.stageHoldingImport(subject, input);
      const result = await imports.autoAdjudicatePrivateHoldingImport(
        subject,
        staged.preview.id,
      );
      expect(result.status).toBe("applied");
      expect(result.summary).toMatchObject({
        autoAppliedCount: 1,
        preservedPositionCount: 0,
      });
      expect(result.rows[0]?.administratorNavState).toBe(
        input.rows[0]?.unrealizedValueState,
      );
    },
  );

  it("applies clear rows while keeping only duplicate rows for review, and retries exception decisions safely", async () => {
    const input = clearInput("2".repeat(64));
    input.rows.push(
      { ...input.rows[0]!, rowNumber: 4, fundName: "Synthetic Other SPV" },
      { ...input.rows[0]!, rowNumber: 5, fundName: "Synthetic Other SPV" },
    );
    input.canonicalScope.rows.push(
      {
        ...input.canonicalScope.rows[0]!,
        sourceRowNumber: 4,
        protectedPositionKey: "e".repeat(64),
      },
      {
        ...input.canonicalScope.rows[0]!,
        sourceRowNumber: 5,
        protectedPositionKey: "e".repeat(64),
      },
    );
    const staged = await imports.stageHoldingImport(subject, input);
    const result = await imports.autoAdjudicatePrivateHoldingImport(
      subject,
      staged.preview.id,
    );
    expect(result).toMatchObject({
      status: "quarantined",
      summary: { autoAppliedCount: 1, quarantinedCount: 2 },
    });
    const decisions = result.rows
      .filter((row) => row.decisionSource === null)
      .map((row) => ({
        rowId: row.id,
        decision: "rejected" as const,
        rationale: "Discard duplicate source rows.",
      }));
    await imports.applyHoldingImport(subject, result.id, {
      currency: "USD",
      decisions,
    });
    await imports.applyHoldingImport(subject, result.id, {
      currency: "USD",
      decisions,
    });
    expect((await imports.getHoldingImport(subject, result.id)).status).toBe(
      "applied",
    );
    expect(await imports.listPendingHoldingImports(subject)).toEqual([]);
  });

  it("does not infer a new position when a prior source identity disappeared", async () => {
    const first = await imports.stageHoldingImport(
      subject,
      clearInput("3".repeat(64)),
    );
    await imports.autoAdjudicatePrivateHoldingImport(subject, first.preview.id);
    const renamed = clearInput("4".repeat(64));
    renamed.canonicalScope.rows[0]!.protectedPositionKey = "f".repeat(64);
    const next = await imports.stageHoldingImport(subject, renamed);
    const result = await imports.autoAdjudicatePrivateHoldingImport(
      subject,
      next.preview.id,
    );
    expect(result).toMatchObject({
      status: "quarantined",
      summary: { autoAppliedCount: 0, quarantinedCount: 1 },
    });
    expect(result.rows[0]?.issues.join(" ")).toContain(
      "legal position and owner",
    );
  });

  it("ignores delayed private observations instead of replacing newer values", async () => {
    const newer = clearInput("5".repeat(64), 175_000);
    newer.effectiveDate = "2026-08-21";
    newer.retrievedAt = "2026-08-21T12:00:00.000Z";
    const first = await imports.stageHoldingImport(subject, newer);
    await imports.autoAdjudicatePrivateHoldingImport(subject, first.preview.id);
    const older = await imports.stageHoldingImport(
      subject,
      clearInput("6".repeat(64)),
    );
    const result = await imports.autoAdjudicatePrivateHoldingImport(
      subject,
      older.preview.id,
    );
    expect(result).toMatchObject({
      status: "applied",
      rows: [
        {
          adjudicationStatus: "ignored",
          reasonCodes: ["older_observation_ignored"],
        },
      ],
    });
    const state = await baselines.getState(subject);
    expect(
      state.positions.find((position) => position.provider === "angellist")
        ?.valueMinor,
    ).toBe(175_000);
  });

  it("remembers a manually confirmed instrument change on later source updates", async () => {
    const first = await imports.stageHoldingImport(
      subject,
      clearInput("ac".repeat(32)),
    );
    await imports.autoAdjudicatePrivateHoldingImport(subject, first.preview.id);
    const conversion = clearInput("bc".repeat(32));
    conversion.rows[0]!.dealMetadata.instrument = "preferred stock";
    conversion.effectiveDate = "2026-08-23";
    const changed = await imports.stageHoldingImport(subject, conversion);
    const exception = await imports.autoAdjudicatePrivateHoldingImport(
      subject,
      changed.preview.id,
    );
    expect(exception.status).toBe("quarantined");
    await imports.applyHoldingImport(subject, exception.id, {
      currency: "USD",
      decisions: [
        {
          rowId: exception.rows[0]!.id,
          decision: "accepted",
          rationale: "Confirmed the source conversion for this position.",
        },
      ],
    });
    const next = clearInput("cd".repeat(32), 200_000);
    next.rows[0]!.dealMetadata.instrument = "preferred stock";
    next.effectiveDate = "2026-08-24";
    const staged = await imports.stageHoldingImport(subject, next);
    expect(
      await imports.autoAdjudicatePrivateHoldingImport(
        subject,
        staged.preview.id,
      ),
    ).toMatchObject({
      status: "applied",
      summary: { autoAppliedCount: 1, quarantinedCount: 0 },
    });
  });

  it("refreshes the established FI baseline from automatically accepted cash without changing planning choices", async () => {
    const imported = await imports.stageHoldingImport(
      subject,
      clearInput("ac".repeat(32)),
    );
    await imports.autoAdjudicatePrivateHoldingImport(
      subject,
      imported.preview.id,
    );
    const cash = new D1CashAccountsRepository(
      database as unknown as D1Database,
    );
    const connection = await cash.upsertConnection(
      subject,
      "Synthetic Bank",
      "connector-secrets/synthetic.enc",
      "b".repeat(64),
    );
    const check = async (value: number, date: string, initial = false) => {
      const run = await cash.beginRefresh(
        subject,
        connection.id,
        initial ? "initial" : "live",
      );
      const result = await cash.stageProposal(subject, run.id, {
        objectKey: `cash-observations/synthetic-${run.id}.json`,
        sourceSha256: "c".repeat(64),
        normalized: {
          normalizedFingerprint: "d".repeat(64),
          observedAt: date,
          rows: [
            {
              naturalKeySha256: "a".repeat(64),
              itemAccountKeySha256: "a".repeat(64),
              institutionLabel: "Synthetic Bank",
              accountLabel: "Synthetic checking",
              subtype: "checking",
              availableMinor: value,
              currentMinor: value,
              valueMinor: value,
              valueState: "reported",
              balanceSource: "available",
              observedAt: date,
              issues: [],
            },
          ],
        },
      });
      await cash.completeRefresh(
        subject,
        run.id,
        result.proposal?.id ?? null,
        1,
      );
      return result.proposal!;
    };
    const cashProposal = await check(120_000, "2026-08-14T18:00:00.000Z", true);
    await cash.applyProposal(subject, cashProposal.id, {
      changeNote: "Included the synthetic cash account.",
      decisions: cashProposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
      })),
    });
    const baseline = baselines;
    const state = await baseline.getState("synthetic-access-subject");
    expect(state.status).toBe("ready");
    const initial = await baseline.confirm("synthetic-access-subject", {
      sourceRevision: state.sourceRevision!,
      baseForecastSnapshotId: state.baseForecastSnapshotId!,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion!,
      otherFiEligibleLiquidMinor: 0,
      duplicateReviewConfirmed: true,
      cashOverlapReviewConfirmed: true,
      changeNote: "Established the synthetic cash plan.",
    });
    await check(150_000, "2026-08-15T18:00:00.000Z");
    await cash.applyAutomaticUpdates("synthetic-access-subject");
    expect(
      (
        await refreshAcceptedPortfolioBaseline(
          baseline,
          "synthetic-access-subject",
        )
      ).status,
    ).toBe("refreshed");
    const updated = await baseline.getState("synthetic-access-subject");
    expect(updated.status).toBe("current");
    expect(updated.latestBaseline?.otherFiEligibleLiquidMinor).toBe(0);
    expect(updated.summary?.cashAccountValueMinor).toBe(150_000);
    expect(updated.planning.householdBurnMonthlyMinor).toBe(
      state.planning.householdBurnMonthlyMinor,
    );
    expect(updated.planning.fiTargetMinor).toBe(state.planning.fiTargetMinor);
    expect(
      sqlite
        .prepare(
          "SELECT prior_baseline_id FROM portfolio_baseline_policy_decisions",
        )
        .get(),
    ).toEqual({ prior_baseline_id: initial.baseline.id });
    expect(
      (
        await refreshAcceptedPortfolioBaseline(
          baseline,
          "synthetic-access-subject",
        )
      ).status,
    ).toBe("not_needed");
  });

  it("refreshes private value changes without another planning decision and records its policy", async () => {
    const initial = await imports.stageHoldingImport(
      subject,
      clearInput("7".repeat(64)),
    );
    await imports.autoAdjudicatePrivateHoldingImport(
      subject,
      initial.preview.id,
    );
    expect(
      await refreshAcceptedPortfolioBaseline(baselines, subject),
    ).toMatchObject({ status: "manual_required" });
    const state = await baselines.getState(subject);
    const confirmed = await baselines.confirm(subject, {
      sourceRevision: state.sourceRevision!,
      baseForecastSnapshotId: state.baseForecastSnapshotId!,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion!,
      otherFiEligibleLiquidMinor: 100_000,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: true,
      changeNote: "Set synthetic planning choices.",
    });
    const update = clearInput("8".repeat(64), 185_000);
    update.effectiveDate = "2026-08-22";
    const staged = await imports.stageHoldingImport(subject, update);
    await imports.autoAdjudicatePrivateHoldingImport(
      subject,
      staged.preview.id,
    );
    expect(
      await refreshAcceptedPortfolioBaseline(baselines, subject),
    ).toMatchObject({ status: "refreshed" });
    const current = await baselines.getState(subject);
    expect(current.status).toBe("current");
    expect(current.latestBaseline?.fiEligibleLiquidMinor).toBe(
      confirmed.baseline.fiEligibleLiquidMinor,
    );
    expect(current.latestBaseline?.otherFiEligibleLiquidMinor).toBe(100_000);
    expect(
      sqlite
        .prepare(
          "SELECT prior_baseline_id, policy_version FROM portfolio_baseline_policy_decisions",
        )
        .get(),
    ).toEqual({
      prior_baseline_id: confirmed.baseline.id,
      policy_version: "accepted-sources-auto-v1",
    });
    expect(await refreshAcceptedPortfolioBaseline(baselines, subject)).toEqual({
      status: "not_needed",
      baselineId: null,
    });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM portfolio_baseline_policy_decisions",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("keeps automatic adjudication round trips fixed for 120 distinct positions", async () => {
    const input = clearInput("9".repeat(64));
    const row = input.rows[0]!;
    const scope = input.canonicalScope.rows[0]!;
    input.rows = Array.from({ length: 120 }, (_, index) => ({
      ...row,
      rowNumber: index + 1,
      fundName: `Synthetic Vehicle ${index}`,
      companyOrFund: `Synthetic Company ${index}`,
    }));
    input.canonicalScope.rows = input.rows.map((item, index) => ({
      ...scope,
      sourceRowNumber: item.rowNumber,
      protectedPositionKey: (index + 1).toString(16).padStart(64, "0"),
    }));
    const staged = await imports.stageHoldingImport(subject, input);
    database.resetRoundTripCount();
    const result = await imports.autoAdjudicatePrivateHoldingImport(
      subject,
      staged.preview.id,
    );
    expect(result.summary.autoAppliedCount).toBe(120);
    expect(database.roundTripCount).toBeLessThanOrEqual(35);
    const query = database.preparedSql.find((sql) =>
      sql.includes("MAX(snapshot.observed_at)"),
    )!;
    const plan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .all(staged.preview.id, "hh_demo");
    expect(JSON.stringify(plan)).toContain(
      "holding_position_snapshots_observed_idx",
    );
    expect(JSON.stringify(plan)).not.toContain("SCAN snapshot");
  });
});

describe("reviewed portfolio baseline persistence", () => {
  let sqlite: DatabaseSync;
  let database: TestD1Database;
  let holdingImports: D1HoldingImportRepository;
  let baselines: D1PortfolioBaselineRepository;
  let cashAccounts: D1CashAccountsRepository;

  beforeEach(() => {
    sqlite = createSqliteFixture(migrationFiles);
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

  it("refreshes 120 sources around exceptions, retains their values, and resolves only the selected source", async () => {
    const subject = "synthetic-access-subject";
    const initialInput = robinhoodStageInput();
    initialInput.rows = Array.from({ length: 120 }, (_, index) => ({
      ...initialInput.rows[0]!,
      rowNumber: index + 1,
      naturalKeySha256: (index + 1).toString(16).padStart(64, "0"),
      securityName: `Synthetic Plan Holding ${index}`,
      ticker: `S${index}`,
      marketValueMinor: 100_000,
    }));
    initialInput.canonicalScope.rows = initialInput.rows.map((row) => ({
      sourceRowNumber: row.rowNumber,
      protectedAccountKey: robinhoodAccountKey,
      protectedPositionKey: row.naturalKeySha256,
      publicExposureIdentityKind: "cusip",
      protectedExposureKey: row.naturalKeySha256,
    }));
    const applyImport = async (
      input: PlaidInvestmentsHoldingImportStageInput,
    ) => {
      const staged = await holdingImports.stagePlaidInvestmentsHoldingImport(
        subject,
        input,
      );
      await holdingImports.applyHoldingImport(subject, staged.preview.id, {
        currency: "USD",
        decisions: staged.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
          rationale: "Reviewed synthetic source.",
        })),
      });
    };
    await applyImport(initialInput);
    const inputFor = (
      state: Awaited<ReturnType<typeof baselines.getState>>,
    ) => ({
      sourceRevision: state.sourceRevision!,
      baseForecastSnapshotId: state.baseForecastSnapshotId!,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion!,
      otherFiEligibleLiquidMinor: state.suggestedOtherFiEligibleLiquidMinor,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: true,
      changeNote: "Reviewed synthetic planning exception.",
    });
    const initialState = await baselines.getState(subject);
    await baselines.confirm(subject, {
      ...inputFor(initialState),
      otherFiEligibleLiquidMinor: 50_000,
    });
    const nextInput = structuredClone(initialInput);
    nextInput.sha256 = "ab".repeat(32);
    nextInput.normalizedFingerprint = "b".repeat(64);
    nextInput.effectiveDate = "2026-08-09";
    nextInput.rows = nextInput.rows.map((row) => ({
      ...row,
      observedOn: "2026-08-09",
      marketValueMinor: row.rowNumber === 1 ? 110_000 : row.marketValueMinor,
    }));
    nextInput.rows.push({
      ...nextInput.rows[0]!,
      rowNumber: 121,
      naturalKeySha256: "c".repeat(64),
      securityName: "Synthetic Brokerage Cash",
      ticker: null,
      securityType: "cash",
      marketValueMinor: 50_000,
    });
    nextInput.canonicalScope.rows.push({
      sourceRowNumber: 121,
      protectedAccountKey: robinhoodAccountKey,
      protectedPositionKey: "c".repeat(64),
    });
    nextInput.rows.push({
      ...nextInput.rows[0]!,
      rowNumber: 122,
      naturalKeySha256: "d".repeat(64),
      securityName: "Synthetic Separate Holding",
      ticker: "NEW",
      marketValueMinor: 75_000,
    });
    nextInput.canonicalScope.rows.push({
      sourceRowNumber: 122,
      protectedAccountKey: robinhoodAccountKey,
      protectedPositionKey: "d".repeat(64),
      publicExposureIdentityKind: "cusip",
      protectedExposureKey: "d".repeat(64),
    });
    await applyImport(nextInput);
    const exposures = new D1InvestmentExposureViewRepository(
      database as unknown as D1Database,
    );
    let removeAll = false;
    let unavailable = false;
    const filtered = new D1PortfolioBaselineRepository(
      database as unknown as D1Database,
      {
        list: async (accessSubject) => {
          const view = await exposures.list(accessSubject);
          return {
            ...view,
            positions: view.positions
              .filter((position) => !removeAll && position.ticker !== "S1")
              .map((position) =>
                unavailable && position.ticker === "S2"
                  ? {
                      ...position,
                      valueMinor: null,
                      valueState: "not_reported" as const,
                    }
                  : position,
              ),
          };
        },
      },
    );
    const pending = await filtered.getState(subject);
    expect(pending.exceptions?.map((item) => item.reason).sort()).toEqual([
      "cash_overlap",
      "overlap",
      "removed",
    ]);
    expect(pending.automaticUpdateCount).toBeGreaterThan(0);
    database.resetRoundTripCount();
    const racingRefreshes = await Promise.all([
      refreshAcceptedPortfolioBaseline(filtered, subject),
      refreshAcceptedPortfolioBaseline(filtered, subject),
    ]);
    expect(racingRefreshes.map((result) => result.status).sort()).toEqual([
      "manual_required",
      "refreshed",
    ]);
    // Two bounded attempts plus one projection read after the losing race.
    expect(database.roundTripCount).toBeLessThanOrEqual(106);
    let partial = await filtered.getState(subject);
    expect(partial.status).toBe("ready");
    expect(partial.automaticUpdateCount).toBe(0);
    expect(partial.latestBaseline?.fiEligibleLiquidMinor).toBe(12_060_000);
    expect(partial.latestBaseline?.summary.positionCount).toBe(120);
    expect(partial.exceptions).toHaveLength(3);
    const overlap = partial.exceptions!.find(
      (item) => item.reason === "overlap",
    )!;
    await filtered.confirm(subject, {
      ...inputFor(partial),
      reviewedExceptionKeys: [overlap.key],
      duplicateReviewConfirmed: true,
    });
    partial = await filtered.getState(subject);
    expect(partial.exceptions).toHaveLength(2);
    expect(partial.latestBaseline?.fiEligibleLiquidMinor).toBe(12_135_000);
    // The forward migration preserves populated baselines and their child references.
    sqlite.exec("BEGIN");
    sqlite.exec(
      readFileSync(
        resolve(
          "packages/database/migrations/0068_exception_baseline_empty.sql",
        ),
        "utf8",
      ),
    );
    sqlite.exec("COMMIT");
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const countBefore = sqlite
      .prepare("SELECT count(*) AS count FROM portfolio_baselines")
      .get();
    expect(
      await refreshAcceptedPortfolioBaseline(filtered, subject),
    ).toMatchObject({ status: "manual_required" });
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM portfolio_baselines").get(),
    ).toEqual(countBefore);
    const removed = partial.exceptions!.find(
      (item) => item.reason === "removed",
    )!;
    expect(removed).toMatchObject({
      name: "Synthetic Plan Holding 1",
      previousValueMinor: 100_000,
      fiEligibleChangeMinor: -100_000,
    });
    await expect(
      filtered.confirm(subject, {
        ...inputFor(pending),
        reviewedExceptionKeys: [removed.key],
      }),
    ).rejects.toThrow("stale");
    await expect(
      filtered.confirm(subject, {
        ...inputFor(partial),
        reviewedExceptionKeys: ["position:unknown"],
      }),
    ).rejects.toThrow("stale");
    await filtered.confirm(subject, {
      ...inputFor(partial),
      reviewedExceptionKeys: [removed.key],
    });
    const oneLeft = await filtered.getState(subject);
    expect(oneLeft.exceptions).toHaveLength(1);
    expect(oneLeft.latestBaseline?.fiEligibleLiquidMinor).toBe(12_035_000);
    await filtered.confirm(subject, {
      ...inputFor(oneLeft),
      reviewedExceptionKeys: [oneLeft.exceptions![0]!.key],
      otherFiEligibleLiquidMinor: 0,
    });
    const complete = await filtered.getState(subject);
    expect(complete.status).toBe("current");
    expect(complete.latestBaseline?.fiEligibleLiquidMinor).toBe(12_035_000);
    expect(complete.latestBaseline?.otherFiEligibleLiquidMinor).toBe(0);
    unavailable = true;
    const uncertain = await filtered.getState(subject);
    expect(uncertain.exceptions).toHaveLength(1);
    expect(uncertain.exceptions![0]).toMatchObject({
      reason: "unavailable",
      previousValueMinor: 100_000,
    });
    expect(
      (await refreshAcceptedPortfolioBaseline(filtered, subject)).status,
    ).toBe("manual_required");
    await filtered.confirm(subject, {
      ...inputFor(uncertain),
      reviewedExceptionKeys: [uncertain.exceptions![0]!.key],
    });
    const excluded = await filtered.getState(subject);
    expect(excluded.status).toBe("current");
    expect(excluded.latestBaseline?.fiEligibleLiquidMinor).toBe(11_935_000);
    unavailable = false;
    expect(
      (await refreshAcceptedPortfolioBaseline(filtered, subject)).status,
    ).toBe("refreshed");
    expect(
      (await filtered.getState(subject)).latestBaseline?.fiEligibleLiquidMinor,
    ).toBe(12_035_000);
    removeAll = true;
    const empty = await filtered.getState(subject);
    expect(empty.exceptions).toHaveLength(121);
    await filtered.confirm(subject, {
      ...inputFor(empty),
      reviewedExceptionKeys: empty.exceptions!.map((item) => item.key),
    });
    const emptyCurrent = await filtered.getState(subject);
    expect(emptyCurrent.status).toBe("current");
    expect(emptyCurrent.latestBaseline?.summary.positionCount).toBe(0);
    expect(emptyCurrent.latestBaseline?.fiEligibleLiquidMinor).toBe(0);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    // Full 120-source history and exception replay exceeds the default 5s on
    // the shared CI runner; round-trip budgets above still gate database work.
  }, 15_000);

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
      changes: {
        positions: expect.arrayContaining([
          expect.objectContaining({ changeType: "added", previous: null }),
        ]),
        cashAccounts: [
          expect.objectContaining({ changeType: "added", previous: null }),
        ],
      },
    });
    expect(state.changes.positions).toHaveLength(4);
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
      protectedCashFloorMinor: 10_300_000,
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
      changes: { positions: [], cashAccounts: [] },
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
      changes: { positions: [], cashAccounts: [] },
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
      changes: {
        positions: [],
        cashAccounts: [
          {
            changeType: "updated",
            current: expect.objectContaining({ valueMinor: 350_000 }),
            previous: expect.objectContaining({ valueMinor: 300_000 }),
          },
        ],
      },
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

  it("projects one delta from 120 reviewed positions within a fixed read budget", async () => {
    const base = providerTemplateStageInput("tokenfolio");
    const baseRow = base.rows[0];
    const baseScopeRow = base.canonicalScope.rows[0];
    if (baseRow === undefined || baseScopeRow === undefined) {
      throw new Error("Synthetic baseline scale fixture is incomplete.");
    }
    const rows = Array.from({ length: 120 }, (_, index) => {
      const suffix = index.toString().padStart(3, "0");
      const valueMinor = 100_000 + index;
      return {
        ...baseRow,
        rowNumber: index + 3,
        naturalKeySha256: (index + 1).toString(16).padStart(64, "0"),
        companyOrFund: `Synthetic Baseline Company ${suffix}`,
        fundName: `Synthetic Baseline Shares ${suffix}`,
        unrealizedValueMinor: valueMinor,
        unrealizedValueState: "reported" as const,
        netValueMinor: valueMinor,
        netValueState: "reported" as const,
      };
    });
    const scopeRows = rows.map((row) => ({
      sourceRowNumber: row.rowNumber,
      protectedAccountKey: baseScopeRow.protectedAccountKey,
      protectedPositionKey: row.naturalKeySha256,
    }));
    const initial = await holdingImports.stageHoldingImport(
      "synthetic-access-subject",
      {
        ...base,
        objectKey: "holding-imports/tokenfolio/synthetic-baseline-scale.csv",
        sha256: "a1".repeat(32),
        byteSize: 120_000,
        rows,
        canonicalScope: {
          ...base.canonicalScope,
          rows: scopeRows,
        },
      },
    );
    await holdingImports.applyHoldingImport(
      "synthetic-access-subject",
      initial.preview.id,
      {
        currency: "USD",
        decisions: initial.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
          rationale: "Reviewed synthetic scale position.",
        })),
      },
    );

    const initialState = await baselines.getState("synthetic-access-subject");
    expect(initialState.changes.positions).toHaveLength(120);
    if (
      initialState.sourceRevision === null ||
      initialState.baseForecastSnapshotId === null ||
      initialState.baseForecastSnapshotVersion === null
    ) {
      throw new Error("Expected a confirmable scale baseline.");
    }
    const confirmed = await baselines.confirm("synthetic-access-subject", {
      sourceRevision: initialState.sourceRevision,
      baseForecastSnapshotId: initialState.baseForecastSnapshotId,
      baseForecastSnapshotVersion: initialState.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor: 0,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Set the synthetic scale baseline.",
    });

    const updatedRows = rows.map((row, index) =>
      index === 61
        ? {
            ...row,
            unrealizedValueMinor: (row.unrealizedValueMinor ?? 0) + 10_000,
            netValueMinor: (row.netValueMinor ?? 0) + 10_000,
          }
        : row,
    );
    const updated = await holdingImports.stageHoldingImport(
      "synthetic-access-subject",
      {
        ...base,
        objectKey:
          "holding-imports/tokenfolio/synthetic-baseline-scale-updated.csv",
        sha256: "b2".repeat(32),
        byteSize: 120_000,
        rows: updatedRows,
        canonicalScope: {
          ...base.canonicalScope,
          rows: scopeRows,
        },
      },
    );
    const applied = await holdingImports.applyHoldingImport(
      "synthetic-access-subject",
      updated.preview.id,
      {
        currency: "USD",
        decisions: updated.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
          rationale: "Reviewed synthetic scale refresh.",
        })),
      },
    );
    expect(applied).toMatchObject({ updatedCount: 1, unchangedCount: 119 });

    database.resetRoundTripCount();
    const changedState = await baselines.getState("synthetic-access-subject");
    expect(changedState.positions).toHaveLength(120);
    expect(changedState.changes.positions).toEqual([
      expect.objectContaining({
        changeType: "updated",
        current: expect.objectContaining({
          positionName: "Synthetic Baseline Company 061",
          valueMinor: 110_061,
        }),
        previous: expect.objectContaining({ valueMinor: 100_061 }),
      }),
    ]);
    expect(changedState.changes.cashAccounts).toEqual([]);
    expect(database.roundTripCount).toBeLessThanOrEqual(14);

    const baselineItemsSql = database.preparedSql
      .filter(
        (sql) =>
          sql.includes("FROM portfolio_baseline_items") &&
          sql.includes("FROM portfolio_baseline_cash_items"),
      )
      .at(-1);
    expect(baselineItemsSql).toBeDefined();
    const baselineItemsPlan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${baselineItemsSql ?? "SELECT 1"}`)
      .all(
        "hh_demo",
        confirmed.baseline.id,
        "hh_demo",
        confirmed.baseline.id,
      ) as Array<{ detail: string }>;
    expect(
      baselineItemsPlan.some((row) =>
        row.detail.includes(
          "SEARCH item USING INDEX sqlite_autoindex_portfolio_baseline_items_2 (baseline_id=?)",
        ),
      ),
    ).toBe(true);
    expect(
      baselineItemsPlan.some((row) =>
        row.detail.includes("portfolio_baseline_cash_items_baseline_idx"),
      ),
    ).toBe(true);
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
    // Reproduce the historical accepted split that existed before exception-based acceptance.
    // New reviews resolve the identity before accepting; this case protects legacy readback.
    for (const rowId of [reportedRowId, missingRowId]) {
      sqlite
        .prepare(
          `INSERT INTO cash_balance_review_decisions
        (id, household_id, proposal_id, proposal_row_id, reviewer_user_id, decision, change_note, decided_at, immutable)
        VALUES (?, 'hh_demo', ?, ?, 'usr_demo', 'accepted', 'Historical synthetic cash review.', ?, 1)`,
        )
        .run(
          `legacy_decision_${rowId}`,
          proposalId,
          rowId,
          new Date().toISOString(),
        );
    }
    sqlite
      .prepare(
        "UPDATE cash_balance_proposals SET status = 'applied' WHERE id = ?",
      )
      .run(proposalId);

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
