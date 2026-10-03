import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { D1ExposureRepository } from "./exposures";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1InvestmentExposureViewRepository } from "./exposure-read-model";
import { D1AlphaRepository } from "./index";
import { D1PortfolioBaselineRepository } from "./portfolio-baseline";
import { D1PortfolioWatchRepository } from "./portfolio-watch";
import { D1PublicCompanyLinkRepository } from "./public-company-links";
import { companyExposureGroups } from "@keel/domain/exposure-read-model";

const reconciliationMigrationFile =
  "packages/database/migrations/0026_reconciled_holding_ownership.sql";
const retainedPublicIdentityMigrationFile =
  "packages/database/migrations/0027_retained_public_exposure_identity.sql";
const providerScopedIdentityMigrationFile =
  "packages/database/migrations/0028_provider_scoped_public_exposure.sql";
const structuredAssetIdentityMigrationFile =
  "packages/database/migrations/0029_structured_asset_exposure.sql";
const reconnectedPositionContinuityMigrationFile =
  "packages/database/migrations/0030_reconnected_position_continuity.sql";
const oneSidedPositionIdentityMigrationFile =
  "packages/database/migrations/0031_reconnected_position_continuity_one_sided_identity.sql";
const providerTemplateHoldingsMigrationFile =
  "packages/database/migrations/0032_provider_template_holdings.sql";
const exactReviewedPrivateExposuresMigrationFile =
  "packages/database/migrations/0036_exact_reviewed_private_exposures.sql";
const privateProviderPositionContinuityMigrationFile =
  "packages/database/migrations/0037_private_provider_position_continuity.sql";
const portfolioWatchExposureUniverseMigrationFile =
  "packages/database/migrations/0045_portfolio_watch_exposure_universe.sql";
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
  "packages/database/migrations/0038_reviewed_position_value_adjustments.sql",
  "packages/database/migrations/0039_reviewed_position_economics.sql",
  "packages/database/migrations/0058_net_invested_position_economics.sql",
  "packages/database/migrations/0040_holdings_read_performance.sql",
  "packages/database/migrations/0041_reported_position_economics.sql",
  reconciliationMigrationFile,
  retainedPublicIdentityMigrationFile,
  providerScopedIdentityMigrationFile,
  structuredAssetIdentityMigrationFile,
  reconnectedPositionContinuityMigrationFile,
  oneSidedPositionIdentityMigrationFile,
  providerTemplateHoldingsMigrationFile,
  exactReviewedPrivateExposuresMigrationFile,
  privateProviderPositionContinuityMigrationFile,
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
  "packages/database/migrations/0054_legal_entity_link_version_guard.sql",
  "packages/database/migrations/0055_exception_based_source_updates.sql",
  "packages/database/migrations/0059_automatic_investment_reviews.sql",
  "packages/database/migrations/0061_portfolio_watch_activity.sql",
  "packages/database/migrations/0062_reviewed_company_aliases.sql",
  "packages/database/migrations/0063_current_exposure_mapping_heads.sql",
  "packages/database/migrations/0072_reviewed_public_company_links.sql",
  "packages/database/migrations/0073_public_company_recommendations.sql",
  "packages/database/migrations/0070_private_purchase_details.sql",
  "packages/database/migrations/0074_purchase_fee_economics.sql",
  "packages/database/migrations/0064_watch_read_receipts.sql",
  "packages/database/migrations/0078_reviewed_position_links.sql",
  "packages/database/migrations/0079_unified_investment_details.sql",
  "packages/database/migrations/0080_renamed_investment_links.sql",
  "packages/database/seed/synthetic.sql",
] as const;

const accessSubject = "synthetic-access-subject";
const recordedAt = "2026-08-15T22:00:00.000Z";

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
    return Promise.resolve(this.execute());
  }

  public execute(): { meta: { changes: number } } {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
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

  public batch(
    statements: TestD1Statement[],
  ): Promise<{ meta: { changes: number } }[]> {
    this.roundTripCount += 1;
    this.database.exec("BEGIN");
    try {
      const results: { meta: { changes: number } }[] = [];
      for (const statement of statements) {
        results.push(statement.execute());
      }
      this.database.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.database.exec("ROLLBACK");
      return Promise.reject(
        error instanceof Error ? error : new Error("Test D1 batch failed."),
      );
    }
  }

  public resetRoundTripCount(): void {
    this.roundTripCount = 0;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function withoutImmutableDeleteTriggers(
  database: DatabaseSync,
  triggerNames: readonly string[],
  action: () => void,
): void {
  const definitions = triggerNames.map((name) => {
    const row = database
      .prepare(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'trigger' AND name = ?`,
      )
      .get(name) as { sql: string } | undefined;
    if (row === undefined) {
      throw new Error(`Expected immutable delete trigger ${name}.`);
    }
    return row.sql;
  });
  triggerNames.forEach((name) => {
    database.exec(`DROP TRIGGER "${name}"`);
  });
  try {
    action();
  } finally {
    definitions.forEach((definition) => {
      database.exec(definition);
    });
  }
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

function seedPlaidInvestmentConnection(
  database: DatabaseSync,
  input: { id: string; label: string; lifecycle?: "active" | "pending" },
): void {
  database
    .prepare(
      `INSERT INTO investment_connections (
         id, household_id, adapter_type, protected_source_key,
         created_by_user_id, created_at, immutable
       ) VALUES (?, 'hh_demo', 'plaid-investments', ?, 'usr_demo', ?, 1)`,
    )
    .run(input.id, hash(`source:${input.id}`), recordedAt);
  database
    .prepare(
      `INSERT INTO investment_connection_versions (
         id, household_id, connection_id, version, institution_key,
         institution_label, lifecycle_state, credential_reference,
         supersedes_version_id, recorded_by_user_id, recorded_at, immutable
       ) VALUES (?, 'hh_demo', ?, 1, ?, ?, ?, ?, NULL, 'usr_demo', ?, 1)`,
    )
    .run(
      `${input.id}_v1`,
      input.id,
      `ins_${input.id}`,
      input.label,
      input.lifecycle ?? "active",
      input.lifecycle === "pending"
        ? null
        : `connector-secrets/${input.id}.json.enc`,
      recordedAt,
    );
}

function seedPrivateProviderConnection(
  database: DatabaseSync,
  input: {
    id: string;
    label: string;
    provider: "angellist" | "tokenfolio" | "sydecar";
    lifecycle?: "active" | "pending";
  },
): void {
  database
    .prepare(
      `INSERT INTO investment_connections (
         id, household_id, adapter_type, protected_source_key,
         created_by_user_id, created_at, immutable
       ) VALUES (?, 'hh_demo', ?, ?, 'usr_demo', ?, 1)`,
    )
    .run(
      input.id,
      input.provider === "angellist" ? "angellist-import" : "manual",
      hash(`source:${input.id}`),
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO investment_connection_versions (
         id, household_id, connection_id, version, institution_key,
         institution_label, lifecycle_state, credential_reference,
         supersedes_version_id, recorded_by_user_id, recorded_at, immutable
       ) VALUES (?, 'hh_demo', ?, 1, ?, ?, ?, ?, NULL, 'usr_demo', ?, 1)`,
    )
    .run(
      `${input.id}_v1`,
      input.id,
      input.provider,
      input.label,
      input.lifecycle ?? "active",
      input.lifecycle === "pending"
        ? null
        : `connector-secrets/${input.id}.json.enc`,
      recordedAt,
    );
}

function seedAcceptedPosition(
  database: DatabaseSync,
  input: {
    id: string;
    label: string;
    provider?:
      "angellist" | "manual" | "plaid_investments" | "sydecar" | "tokenfolio";
    reportedExposureName?: string;
    reportedCompanyId?: string;
    publicExposureIdentityKind?: "cusip" | "isin" | "sedol";
    protectedExposureKey?: string;
    ticker?: string;
    quantityMicros?: number;
    costBasisMinor?: number;
    investedMinor?: number;
    allocationMinor?: number;
    openedOn?: string | null;
    sourceLabel?: string;
    positionKind: "direct" | "spv_interest" | "fund_interest";
    valueMinor: number | null;
    valueState: "reported" | "locked" | "not_reported";
    containerKind?: "brokerage" | "ira" | "entity";
    connectionId?: string;
    containerLabel?: string;
    observedAt?: string;
    providerStatus?: "live" | "realized";
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
       ) VALUES (?, 'hh_demo', ?, ?, 'usr_demo', ?, 1)`,
    )
    .run(
      containerId,
      input.connectionId ?? "connection_exposure_test",
      hash(`container:${input.id}`),
      recordedAt,
    );
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
      input.containerLabel ?? `${input.label} account`,
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
         ?, '2026-08-15', ?, ?, 'accepted', ?)`,
    )
    .run(
      `document_${input.id}`,
      `holding-imports/${input.id}.json`,
      sourceSha256,
      recordedAt,
      input.sourceLabel ?? "Synthetic exposure test",
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_imports (
         id, household_id, source_document_id, provider, parser_schema,
         row_count, created_by, created_at
       ) VALUES (?, 'hh_demo', ?, ?, 'synthetic_exposure_v1', 1,
         'usr_demo', ?)`,
    )
    .run(
      importId,
      `document_${input.id}`,
      input.provider ?? "manual",
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_import_connections (
         id, household_id, import_id, connection_id, created_at, immutable
       ) VALUES (?, 'hh_demo', ?, ?, ?, 1)`,
    )
    .run(
      `import_connection_${input.id}`,
      importId,
      input.connectionId ?? "connection_exposure_test",
      recordedAt,
    );
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
         cost_basis_minor, public_exposure_identity_kind,
         protected_exposure_key, created_at
       ) VALUES (?, 'hh_demo', ?, 1, ?, ?, ?, 'Synthetic owner', ?, ?,
         ?, ?, ?, ?, ?, 0, ?, ?, ?, 'USD', 'ready', '[]', ?,
         ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rowId,
      importId,
      positionFingerprint,
      snapshotFingerprint,
      input.label,
      input.reportedExposureName ?? input.label,
      input.providerStatus ?? "live",
      input.openedOn === undefined ? "2026-08-15" : input.openedOn,
      input.investedMinor ?? 0,
      input.allocationMinor ?? input.investedMinor ?? 0,
      input.valueMinor,
      input.valueState,
      input.valueMinor,
      input.valueState,
      input.positionKind === "direct" ? "equity" : "private interest",
      input.positionKind,
      input.quantityMicros ?? null,
      input.ticker ?? null,
      input.costBasisMinor ?? null,
      input.publicExposureIdentityKind ?? null,
      input.protectedExposureKey ?? null,
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
       ) VALUES (?, 'hh_demo', ?, ?, ?, 'Synthetic owner', ?, ?, ?,
         'USD', 'usr_demo', ?)`,
    )
    .run(
      input.id,
      input.provider ?? "manual",
      positionFingerprint,
      input.label,
      input.positionKind,
      input.positionKind === "direct" ? "equity" : "private interest",
      input.openedOn ?? null,
      recordedAt,
    );
  database
    .prepare(
      `INSERT INTO holding_position_exposures (
         id, household_id, position_id, exposure_label, exposure_kind,
         company_id, created_at
       ) VALUES (?, 'hh_demo', ?, ?, ?, ?, ?)`,
    )
    .run(
      `reported_exposure_${input.id}`,
      input.id,
      input.reportedExposureName ?? input.label,
      input.reportedCompanyId === undefined ? "unresolved" : "company",
      input.reportedCompanyId ?? null,
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
         net_value_state, instrument_type, currency, observed_at,
         quantity_micros, ticker, cost_basis_minor, created_at
       ) VALUES (?, 'hh_demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?,
         'USD', ?, ?, ?, ?, ?)`,
    )
    .run(
      `snapshot_${input.id}`,
      input.id,
      `document_${input.id}`,
      rowId,
      snapshotFingerprint,
      input.providerStatus ?? "live",
      input.investedMinor ?? 0,
      input.allocationMinor ?? input.investedMinor ?? 0,
      input.valueMinor,
      input.valueState,
      input.valueMinor,
      input.valueState,
      input.positionKind === "direct" ? "equity" : "private interest",
      input.observedAt ?? recordedAt,
      input.quantityMicros ?? null,
      input.ticker ?? null,
      input.costBasisMinor ?? null,
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
      input.observedAt ?? recordedAt,
    );
}

describe("canonical exposure resolution and aggregation", () => {
  let sqlite: DatabaseSync;
  let database: TestD1Database;
  let repository: D1ExposureRepository;
  let readModel: D1InvestmentExposureViewRepository;
  let baselines: D1PortfolioBaselineRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    sqlite.exec(
      readFileSync(
        resolve(
          process.cwd(),
          "packages/database/migrations/0057_query_cost_bounds.sql",
        ),
        "utf8",
      ),
    );
    sqlite.exec(
      readFileSync(
        resolve(
          process.cwd(),
          "packages/database/migrations/0069_historical_private_position_continuity.sql",
        ),
        "utf8",
      ),
    );
    seedManualConnection(sqlite);
    database = new TestD1Database(sqlite);
    repository = new D1ExposureRepository(database as unknown as D1Database);
    readModel = new D1InvestmentExposureViewRepository(
      database as unknown as D1Database,
    );
    baselines = new D1PortfolioBaselineRepository(
      database as unknown as D1Database,
    );
  });

  afterEach(() => sqlite.close());

  it("reviews an issuer link without changing public or SPV mappings and rejects stale reviews", async () => {
    seedAcceptedPosition(sqlite, {
      id: "position_public_issuer",
      label: "Synthetic Listed Security",
      positionKind: "direct",
      valueMinor: 1_600_000,
      valueState: "reported",
    });
    seedAcceptedPosition(sqlite, {
      id: "position_spv_issuer",
      label: "Synthetic Issuer SPV",
      positionKind: "spv_interest",
      valueMinor: 2_000_000,
      valueState: "reported",
    });
    const privateExposure = await repository.resolveExposure(accessSubject, {
      exposureKind: "private_company",
      canonicalName: "Northstar Robotics",
      companyId: "co_northstar",
      evidenceSha256: hash("synthetic reviewed issuer"),
    });
    const publicExposure = await repository.resolveExposure(accessSubject, {
      exposureKind: "public_instrument",
      canonicalName: "Synthetic listed security",
      protectedIdentityKey: hash("synthetic strong security identifier"),
      evidenceSha256: hash("synthetic public security evidence"),
    });
    for (const [positionId, exposureId, relationshipKind] of [
      ["position_public_issuer", publicExposure.id, "direct"],
      ["position_spv_issuer", privateExposure.id, "look_through"],
    ] as const) {
      await repository.recordMapping(accessSubject, {
        positionId,
        exposureId,
        relationshipKind,
        allocationPpm: 1_000_000,
        status: "active",
        decisionSource: "review",
        decisionReference: "synthetic issuer mapping",
        evidenceSha256: hash(`synthetic ${positionId}`),
        effectiveAt: recordedAt,
      });
    }
    const links = new D1PublicCompanyLinkRepository(
      database as unknown as D1Database,
    );
    const before = await readModel.list(accessSubject);
    const mappingCountBefore = sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM holding_position_exposure_mappings",
      )
      .get() as { count: number };
    expect(companyExposureGroups(before)).toHaveLength(before.exposures.length);
    const catalog = await links.getCatalog(accessSubject);
    expect(
      catalog.securities.find((item) => item.exposureId === publicExposure.id),
    ).toMatchObject({ reviewId: null, positionCount: 1 });
    const search = vi.fn(() =>
      Promise.resolve([
        {
          title: "Synthetic listed security legal notice",
          url: "https://northstar-robotics.example/legal",
          description:
            "Synthetic listed security is issued by Northstar Robotics.",
        },
      ]),
    );
    // Enabling lookup must recover immediately from a cached no-provider result.
    const unavailable = await links.recommend(accessSubject, publicExposure.id);
    expect(unavailable.status).toBe("unavailable");
    // A completed provider failure from the prior runtime remains immutable,
    // but must not suppress the fixed lookup after deployment.
    const priorRun = sqlite
      .prepare("SELECT * FROM public_company_match_runs WHERE id = ?")
      .get(unavailable.id) as { cache_key: string };
    const priorKey = JSON.parse(priorRun.cache_key) as unknown[];
    priorKey[0] = "issuer-identity-v2";
    priorKey[1] = true;
    sqlite
      .prepare(
        `INSERT INTO public_company_match_runs
      (id, household_id, exposure_id, issuer_name, identity_revision, expected_review_id, cache_key, created_at, search_requested, result_json, evidence_json)
      SELECT ?, household_id, exposure_id, issuer_name, identity_revision, expected_review_id, ?, created_at, 1, result_json, evidence_json
      FROM public_company_match_runs WHERE id = ?`,
      )
      .run("legacy-runtime-failure", JSON.stringify(priorKey), unavailable.id);
    const simultaneous = await Promise.all([
      links.recommend(accessSubject, publicExposure.id, search),
      links.recommend(accessSubject, publicExposure.id, search),
    ]);
    const proposed = simultaneous.find(
      (result) => result.status === "recommended",
    )!;
    expect(new Set(simultaneous.map((result) => result.id)).size).toBe(1);
    expect(proposed).toMatchObject({
      status: "recommended",
      companyId: "co_northstar",
    });
    expect(
      await links.recommend(accessSubject, publicExposure.id, search),
    ).toEqual(proposed);
    expect(search).toHaveBeenCalledTimes(1);
    expect(
      (await links.getCatalog(accessSubject)).securities.find(
        (item) => item.exposureId === publicExposure.id,
      )?.companyId,
    ).toBeNull();
    sqlite.exec(
      "UPDATE companies SET updated_at = '2026-09-02' WHERE id = 'co_northstar'",
    );
    await expect(
      links.approveRecommendation(accessSubject, proposed.id),
    ).rejects.toThrow(/changed/u);
    const current = await links.recommend(
      accessSubject,
      publicExposure.id,
      search,
    );
    const approvals = await Promise.all([
      links.approveRecommendation(accessSubject, current.id),
      links.approveRecommendation(accessSubject, current.id),
    ]);
    const approved = approvals[0];
    expect(approvals[1]).toEqual(approved);
    expect(
      await links.approveRecommendation(accessSubject, current.id),
    ).toEqual(approved);
    expect(() =>
      sqlite
        .prepare(
          "UPDATE public_company_match_runs SET result_json = '{}' WHERE id = ?",
        )
        .run(current.id),
    ).toThrow(/immutable/u);
    const review = {
      exposureId: publicExposure.id,
      companyId: "co_northstar",
      expectedReviewId: approved.id,
      sourceUrl: "https://example.test/synthetic-issuer-filing",
      reason: "Synthetic filing identifies the issuer.",
    };
    await links.review(accessSubject, review);
    await expect(links.review(accessSubject, review)).rejects.toThrow(
      /changed/u,
    );
    const after = await readModel.list(accessSubject);
    const grouped = companyExposureGroups(after).find(
      (group) => group.exposure.id === privateExposure.id,
    );
    expect(
      grouped?.contributions.map((item) => item.positionId).sort(),
    ).toEqual(["position_public_issuer", "position_spv_issuer"]);
    expect(grouped?.totals).toMatchObject([
      { allocatedValueMinor: 3_600_000, knownValuePositionCount: 2 },
    ]);
    expect(after.exposures).toHaveLength(before.exposures.length);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM holding_position_exposure_mappings",
        )
        .get(),
    ).toEqual(mappingCountBefore);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM public_exposure_company_reviews",
        )
        .get(),
    ).toEqual({ count: 2 });
  });

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

  it("projects a tranche-aware private estimate from accepted Portfolio Watch facts", async () => {
    seedAcceptedPosition(sqlite, {
      id: "position_private_reference",
      label: "Synthetic GP-marked position",
      reportedExposureName: "Northstar Robotics",
      reportedCompanyId: "co_northstar",
      positionKind: "direct",
      investedMinor: 20_000_000,
      allocationMinor: 20_000_000,
      openedOn: "2023-03-10",
      sourceLabel: "Synthetic GP portal",
      valueMinor: 60_000_000,
      valueState: "reported",
    });
    seedAcceptedPosition(sqlite, {
      id: "position_private_target",
      label: "Synthetic earlier-round position",
      reportedExposureName: "Northstar Robotics",
      reportedCompanyId: "co_northstar",
      positionKind: "direct",
      investedMinor: 10_000_000,
      allocationMinor: 10_000_000,
      openedOn: "2024-06-15",
      valueMinor: null,
      valueState: "not_reported",
    });
    sqlite
      .prepare(
        `INSERT INTO canonical_exposures (
           id, household_id, exposure_kind, canonical_name,
           protected_identity_key, company_id, resolution_method,
           evidence_sha256, created_by_user_id, created_at, immutable
         ) VALUES (
           'exposure_private_mark_test', 'hh_demo', 'private_company',
           'Northstar Robotics', NULL, 'co_northstar', 'reviewed_company', ?,
           'usr_demo', ?, 1
         )`,
      )
      .run(hash("private mark exposure"), recordedAt);
    for (const [index, positionId] of [
      "position_private_reference",
      "position_private_target",
    ].entries()) {
      sqlite
        .prepare(
          `INSERT INTO holding_position_exposure_mappings (
             id, household_id, position_id, exposure_id, relationship_kind,
             allocation_ppm, status, decision_source, decision_reference,
             evidence_sha256, effective_at, version, supersedes_mapping_id,
             accepted_by_user_id, accepted_at, immutable
           ) VALUES (?, 'hh_demo', ?, 'exposure_private_mark_test', 'direct',
             1000000, 'active', 'review', 'Synthetic private company match',
             ?, ?, 1, NULL, 'usr_demo', ?, 1
           )`,
        )
        .run(
          `mapping_private_mark_${index + 1}`,
          positionId,
          hash(`private mark mapping ${index + 1}`),
          recordedAt,
          recordedAt,
        );
    }
    sqlite.exec(`
      INSERT INTO portfolio_watch_sources (
        id, household_id, watch_target_id, company_id, source_kind,
        source_class, canonical_url, allowed_origin, allowed_path_prefix,
        status, authority_ppm, identity_confidence_ppm,
        operational_health_ppm, coverage_json, auto_activated_at, created_at,
        updated_at
      ) VALUES (
        'source_private_mark_test', 'hh_demo', 'watch_northstar',
        'co_northstar', 'official_company_web', 'official_company',
        'https://northstar-robotics.example/news',
        'https://northstar-robotics.example', '/', 'active', 1000000,
        1000000, 1000000, '{}', '2026-08-20T00:00:00.000Z',
        '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
      );
    `);
    const watch = new D1PortfolioWatchRepository(
      database as unknown as D1Database,
    );
    const alpha = new D1AlphaRepository(database as unknown as D1Database);
    for (const [sequence, effectiveDate, valuationMinor] of [
      ["a", "2023-03-01", 50_000_000_000],
      ["b", "2024-06-01", 100_000_000_000],
    ] as const) {
      const title = `Synthetic Series ${sequence.toUpperCase()}`;
      const amountEvidence = "The company raised a synthetic round.";
      const valuationEvidence =
        "The company reported a synthetic post-money valuation.";
      await watch.recordObservation({
        sourceId: "source_private_mark_test",
        objectKey: `public-watch/source_private_mark_test/${sequence}`,
        contentType: "text/html",
        byteSize: 2_048,
        sha256: hash(`private mark source ${sequence}`),
        retrievedAt: "2026-08-20T12:00:00.000Z",
        sourceUrl: `https://northstar-robotics.example/news/series-${sequence}`,
        sourceTitle: title,
        publishedAt: `${effectiveDate}T12:00:00.000Z`,
        eventType: "financing_announced",
        observedFact: `${title} reported synthetic financing terms. ${amountEvidence} ${valuationEvidence}`,
        modelConfidencePpm: 1_000_000,
        financingFacts: {
          roundType: "series",
          roundLabel: `Series ${sequence.toUpperCase()}`,
          instrument: "equity",
          announcedAmount: {
            amountMinor: 10_000_000_000,
            currency: "USD",
            qualifier: "exact",
            evidenceText: amountEvidence,
          },
          companyValuation: {
            amountMinor: valuationMinor,
            currency: "USD",
            qualifier: "exact",
            evidenceText: valuationEvidence,
            basis: "post_money",
          },
          ambiguities: [],
        },
        fingerprint: hash(`private mark observation ${sequence}`),
      });
      const event = sqlite
        .prepare("SELECT id FROM evidence_events WHERE headline = ?")
        .get(title) as { id: string };
      await alpha.reviewEvidence(accessSubject, event.id, {
        decision: "accepted",
        rationale: "Accepted synthetic financing evidence for the estimate.",
      });
    }

    database.resetRoundTripCount();
    const projection = await readModel.list(
      accessSubject,
      "2026-08-21T12:00:00.000Z",
    );
    expect(database.roundTripCount).toBeLessThanOrEqual(8);
    expect(
      projection.positions.find(
        (position) => position.id === "position_private_target",
      ),
    ).toMatchObject({
      valueMinor: 15_000_000,
      valueSource: "portfolio_watch_estimate",
      privateValueEstimate: {
        referencePositionId: "position_private_reference",
        referenceRound: { effectiveDate: "2023-03-01" },
        positionRound: { effectiveDate: "2024-06-01" },
      },
    });
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

  it("keeps reconnect history append-only while projecting only the unique current position", async () => {
    const historyConnectionId =
      "reconciled-holding-connection-v1:hh_demo:plaid_investments";
    const currentConnectionId = "connection_synthetic_reconnected_brokerage";
    seedPlaidInvestmentConnection(sqlite, {
      id: historyConnectionId,
      label: "Investment reviewed history",
      lifecycle: "pending",
    });
    seedPlaidInvestmentConnection(sqlite, {
      id: currentConnectionId,
      label: "Synthetic Brokerage",
    });
    const shared = {
      label: "Synthetic Alphabet Class A",
      provider: "plaid_investments" as const,
      positionKind: "direct" as const,
      valueState: "reported" as const,
      containerKind: "brokerage" as const,
      containerLabel: "Synthetic brokerage",
      ticker: "GOOGL",
      quantityMicros: 32_116,
      costBasisMinor: 509,
    };
    seedAcceptedPosition(sqlite, {
      ...shared,
      id: "position_synthetic_alphabet_history",
      connectionId: historyConnectionId,
      valueMinor: 1_111,
      observedAt: "2026-08-15T00:00:00.000Z",
    });
    seedAcceptedPosition(sqlite, {
      ...shared,
      id: "position_synthetic_alphabet_current",
      connectionId: currentConnectionId,
      publicExposureIdentityKind: "cusip",
      protectedExposureKey: hash("cusip:synthetic-alphabet-current"),
      valueMinor: 1_100,
      observedAt: "2026-08-18T00:00:00.000Z",
    });

    const historyExposure = await repository.resolveExposure(accessSubject, {
      exposureKind: "public_instrument",
      canonicalName: shared.label,
      protectedIdentityKey: hash("old-item:synthetic-alphabet-security"),
      evidenceSha256: hash("old synthetic provider security evidence"),
    });
    const currentExposure = await repository.resolveExposure(accessSubject, {
      exposureKind: "public_instrument",
      canonicalName: shared.label,
      protectedIdentityKey: hash("new-item:synthetic-alphabet-security"),
      evidenceSha256: hash("new synthetic provider security evidence"),
    });
    for (const [positionId, exposureId, effectiveAt] of [
      [
        "position_synthetic_alphabet_history",
        historyExposure.id,
        "2026-08-15T00:00:00.000Z",
      ],
      [
        "position_synthetic_alphabet_current",
        currentExposure.id,
        "2026-08-18T00:00:00.000Z",
      ],
    ] as const) {
      await repository.recordMapping(accessSubject, {
        positionId,
        exposureId,
        relationshipKind: "direct",
        allocationPpm: 1_000_000,
        status: "active",
        decisionSource: "deterministic_policy",
        decisionReference: "public-provider-security-v1",
        evidenceSha256: hash(`mapping:${positionId}`),
        effectiveAt,
      });
    }

    const before = await readModel.list(
      accessSubject,
      "2026-08-18T12:00:00.000Z",
    );
    const beforeBaseline = await baselines.getState(accessSubject);
    expect(
      before.positions.filter((position) =>
        position.id.startsWith("position_synthetic_alphabet_"),
      ),
    ).toHaveLength(2);
    expect(
      before.exposures.filter((exposure) =>
        [historyExposure.id, currentExposure.id].includes(exposure.exposure.id),
      ),
    ).toHaveLength(2);

    await repository.reconcileRetainedPositionContinuity(accessSubject);
    await repository.reconcileRetainedPositionContinuity(accessSubject);

    const after = await readModel.list(
      accessSubject,
      "2026-08-18T12:00:00.000Z",
    );
    const afterBaseline = await baselines.getState(accessSubject);
    if (beforeBaseline.summary === null || afterBaseline.summary === null) {
      throw new Error("Expected reconnect baseline summaries.");
    }
    expect(
      after.positions.filter((position) =>
        position.id.startsWith("position_synthetic_alphabet_"),
      ),
    ).toEqual([
      expect.objectContaining({
        id: "position_synthetic_alphabet_current",
        valueMinor: 1_100,
        observedAt: "2026-08-18T00:00:00.000Z",
      }),
    ]);
    expect(
      after.exposures.filter((exposure) =>
        [historyExposure.id, currentExposure.id].includes(exposure.exposure.id),
      ),
    ).toEqual([
      expect.objectContaining({
        exposure: expect.objectContaining({ id: currentExposure.id }),
        contributions: [
          expect.objectContaining({
            positionId: "position_synthetic_alphabet_current",
            allocatedValueMinor: 1_100,
          }),
        ],
      }),
    ]);
    expect(afterBaseline.summary.positionCount).toBe(
      beforeBaseline.summary.positionCount - 1,
    );
    expect(afterBaseline.summary.publicMarketValueMinor).toBe(
      beforeBaseline.summary.publicMarketValueMinor - 1_111,
    );
    expect(
      sqlite
        .prepare(
          `SELECT predecessor_position_id, predecessor_snapshot_id,
                  successor_position_id, successor_snapshot_id,
                  resolution_method
           FROM holding_position_continuities`,
        )
        .all(),
    ).toEqual([
      {
        predecessor_position_id: "position_synthetic_alphabet_history",
        predecessor_snapshot_id: "snapshot_position_synthetic_alphabet_history",
        successor_position_id: "position_synthetic_alphabet_current",
        successor_snapshot_id: "snapshot_position_synthetic_alphabet_current",
        resolution_method: "exact_reconnect_snapshot_v1",
      },
    ]);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_snapshots
           WHERE position_id IN (?, ?)`,
        )
        .get(
          "position_synthetic_alphabet_history",
          "position_synthetic_alphabet_current",
        ),
    ).toEqual({ count: 2 });
    expect(() =>
      sqlite
        .prepare(
          `DELETE FROM holding_position_continuities
           WHERE predecessor_position_id = ?`,
        )
        .run("position_synthetic_alphabet_history"),
    ).toThrow(/holding position continuity is immutable/u);
  });

  it("replaces one exact retained private position with its live provider position without doubling value", async () => {
    const historyConnectionId =
      "reconciled-holding-connection-v1:hh_demo:angellist";
    const currentConnectionId = "connection_synthetic_live_angellist";
    seedPrivateProviderConnection(sqlite, {
      id: historyConnectionId,
      label: "AngelList reviewed history",
      lifecycle: "pending",
      provider: "angellist",
    });
    seedPrivateProviderConnection(sqlite, {
      id: currentConnectionId,
      label: "AngelList",
      provider: "angellist",
    });
    sqlite
      .prepare(
        `INSERT INTO companies (
           id, household_id, legal_name, website_host, status,
           created_at, updated_at
         ) VALUES (
           'co_synthetic_continuity', 'hh_demo',
           'Synthetic Continuity Systems', NULL, 'active', ?, ?
         )`,
      )
      .run(recordedAt, recordedAt);
    const shared = {
      containerLabel: "Synthetic Family Trust",
      label: "Synthetic Continuity Access SPV",
      positionKind: "spv_interest" as const,
      provider: "angellist" as const,
      reportedExposureName: "Synthetic Continuity Systems",
      valueMinor: 2_500_000,
      valueState: "reported" as const,
    };
    seedAcceptedPosition(sqlite, {
      ...shared,
      connectionId: historyConnectionId,
      id: "position_synthetic_private_history",
      observedAt: "2026-08-15T00:00:00.000Z",
    });
    seedAcceptedPosition(sqlite, {
      ...shared,
      connectionId: currentConnectionId,
      id: "position_synthetic_private_current",
      observedAt: "2026-08-23T00:00:00.000Z",
    });
    seedAcceptedPosition(sqlite, {
      ...shared,
      connectionId: currentConnectionId,
      id: "position_synthetic_private_second_spv",
      label: "Synthetic Continuity Access II SPV",
      observedAt: "2026-08-23T00:00:00.000Z",
      valueMinor: 1_500_000,
    });
    const exposure = await repository.resolveExposure(accessSubject, {
      exposureKind: "private_company",
      canonicalName: "Synthetic Continuity Systems",
      companyId: "co_synthetic_continuity",
      evidenceSha256: hash("synthetic private continuity evidence"),
    });
    for (const [positionId, effectiveAt] of [
      ["position_synthetic_private_history", "2026-08-15T00:00:00.000Z"],
      ["position_synthetic_private_current", "2026-08-23T00:00:00.000Z"],
      ["position_synthetic_private_second_spv", "2026-08-23T00:00:00.000Z"],
    ] as const) {
      await repository.recordMapping(accessSubject, {
        positionId,
        exposureId: exposure.id,
        relationshipKind: "look_through",
        allocationPpm: 1_000_000,
        status: "active",
        decisionSource: "review",
        decisionReference: "synthetic reviewed company",
        evidenceSha256: hash(`mapping:${positionId}`),
        effectiveAt,
      });
    }

    const before = await readModel.list(
      accessSubject,
      "2026-08-23T12:00:00.000Z",
    );
    expect(
      before.exposures.find((group) => group.exposure.id === exposure.id),
    ).toMatchObject({
      contributions: expect.arrayContaining([
        expect.objectContaining({
          positionId: "position_synthetic_private_current",
        }),
        expect.objectContaining({
          positionId: "position_synthetic_private_history",
        }),
        expect.objectContaining({
          positionId: "position_synthetic_private_second_spv",
        }),
      ]),
      totals: [{ allocatedValueMinor: 6_500_000 }],
    });

    await repository.reconcileRetainedPositionContinuity(accessSubject);
    await repository.reconcileRetainedPositionContinuity(accessSubject);

    const after = await readModel.list(
      accessSubject,
      "2026-08-23T12:00:00.000Z",
    );
    expect(
      after.positions.filter((position) =>
        position.id.startsWith("position_synthetic_private_"),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "position_synthetic_private_current",
          valueMinor: 2_500_000,
        }),
        expect.objectContaining({
          id: "position_synthetic_private_second_spv",
          valueMinor: 1_500_000,
        }),
      ]),
    );
    expect(
      after.positions.filter((position) =>
        position.id.startsWith("position_synthetic_private_"),
      ),
    ).toHaveLength(2);
    expect(
      after.exposures.find((group) => group.exposure.id === exposure.id),
    ).toMatchObject({
      contributions: expect.arrayContaining([
        expect.objectContaining({
          allocatedValueMinor: 2_500_000,
          positionId: "position_synthetic_private_current",
        }),
        expect.objectContaining({
          allocatedValueMinor: 1_500_000,
          positionId: "position_synthetic_private_second_spv",
        }),
      ]),
      totals: [{ allocatedValueMinor: 4_000_000 }],
    });
    expect(
      sqlite
        .prepare(
          `SELECT predecessor_position_id, successor_position_id,
                  resolution_method
           FROM holding_position_continuities
           WHERE predecessor_position_id =
                 'position_synthetic_private_history'`,
        )
        .get(),
    ).toEqual({
      predecessor_position_id: "position_synthetic_private_history",
      successor_position_id: "position_synthetic_private_current",
      resolution_method: "exact_reconnect_snapshot_v1",
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_snapshots
           WHERE position_id IN (
             'position_synthetic_private_history',
             'position_synthetic_private_current'
           )`,
        )
        .get(),
    ).toEqual({ count: 2 });
  });

  it.each([
    { from: "realized", to: "realized", changedAmounts: false },
    { from: "realized", to: "realized", changedAmounts: true },
    { from: "live", to: "realized", changedAmounts: true },
    { from: "live", to: "live", changedAmounts: true },
  ] as const)(
    "automatically reconciles $from to $to private history (changed amounts: $changedAmounts)",
    async ({ from, to, changedAmounts }) => {
      const historyConnectionId =
        "reconciled-holding-connection-v1:hh_demo:angellist";
      const currentConnectionId = "connection_synthetic_historical_angellist";
      seedPrivateProviderConnection(sqlite, {
        id: historyConnectionId,
        label: "Synthetic reviewed history",
        provider: "angellist",
        lifecycle: "pending",
      });
      seedPrivateProviderConnection(sqlite, {
        id: currentConnectionId,
        label: "Synthetic provider",
        provider: "angellist",
      });
      const shared = {
        containerLabel: "Synthetic Family Trust",
        label: "Synthetic Historical Access SPV",
        positionKind: "spv_interest" as const,
        provider: "angellist" as const,
        reportedExposureName: "Synthetic Historical Systems",
        openedOn: "2025-02-03",
        investedMinor: 70_000,
        allocationMinor: 90_000,
        valueMinor: 0,
        valueState: "reported" as const,
      };
      seedAcceptedPosition(sqlite, {
        ...shared,
        connectionId: historyConnectionId,
        id: "synthetic_history",
        providerStatus: from,
        observedAt: "2026-08-01T00:00:00.000Z",
      });
      seedAcceptedPosition(sqlite, {
        ...shared,
        connectionId: currentConnectionId,
        id: "synthetic_current",
        providerStatus: to,
        observedAt: "2026-09-01T00:00:00.000Z",
        ...(changedAmounts
          ? { investedMinor: 80_000, allocationMinor: 120_000 }
          : {}),
      });
      const snapshots = sqlite
        .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
        .all();
      const documents = sqlite
        .prepare("SELECT * FROM source_documents ORDER BY id")
        .all();
      const decisions = sqlite
        .prepare("SELECT * FROM holding_import_row_decisions ORDER BY id")
        .all();
      // Exercise deployment recovery, then repeated sync recovery on the same rows.
      sqlite.exec(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/database/migrations/0069_historical_private_position_continuity.sql",
          ),
          "utf8",
        ),
      );
      await repository.reconcileRetainedPositionContinuity(accessSubject);
      await repository.reconcileRetainedPositionContinuity(accessSubject);
      expect(
        sqlite
          .prepare(
            "SELECT predecessor_position_id, successor_position_id FROM holding_position_continuities",
          )
          .all(),
      ).toEqual([
        {
          predecessor_position_id: "synthetic_history",
          successor_position_id: "synthetic_current",
        },
      ]);
      const projection = await readModel.list(
        accessSubject,
        "2026-09-02T00:00:00.000Z",
      );
      expect(
        projection.positions.filter((position) =>
          position.id.startsWith("synthetic_"),
        ),
      ).toEqual(
        to === "live"
          ? [expect.objectContaining({ id: "synthetic_current" })]
          : [],
      );
      const inventory = await new D1InvestmentPositionViewRepository(
        database as unknown as D1Database,
      ).listForHousehold("hh_demo");
      expect(
        inventory.connections
          .flatMap((connection) =>
            connection.containers.flatMap((container) => container.positions),
          )
          .filter((position) => position.id.startsWith("synthetic_")),
      ).toEqual([
        expect.objectContaining({
          id: "synthetic_current",
          snapshot: expect.objectContaining({ providerStatus: to }),
        }),
      ]);
      expect(
        sqlite
          .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
          .all(),
      ).toEqual(snapshots);
      expect(
        sqlite.prepare("SELECT * FROM source_documents ORDER BY id").all(),
      ).toEqual(documents);
      expect(
        sqlite
          .prepare("SELECT * FROM holding_import_row_decisions ORDER BY id")
          .all(),
      ).toEqual(decisions);
    },
  );

  it.each([
    {
      label: "different owner",
      override: { containerLabel: "Synthetic Other Trust" },
    },
    {
      label: "different vehicle",
      override: { label: "Synthetic Separate SPV" },
    },
    {
      label: "different investment date",
      override: { openedOn: "2025-02-04" },
    },
    {
      label: "different company",
      override: { reportedExposureName: "Synthetic Other Systems" },
    },
  ])("keeps $label separate even when historical", async ({ override }) => {
    const historyConnectionId =
      "reconciled-holding-connection-v1:hh_demo:angellist";
    const currentConnectionId = "connection_synthetic_distinct_angellist";
    seedPrivateProviderConnection(sqlite, {
      id: historyConnectionId,
      label: "Synthetic reviewed history",
      provider: "angellist",
      lifecycle: "pending",
    });
    seedPrivateProviderConnection(sqlite, {
      id: currentConnectionId,
      label: "Synthetic provider",
      provider: "angellist",
    });
    const shared = {
      containerLabel: "Synthetic Family Trust",
      label: "Synthetic Historical Access SPV",
      positionKind: "spv_interest" as const,
      provider: "angellist" as const,
      providerStatus: "realized" as const,
      reportedExposureName: "Synthetic Historical Systems",
      openedOn: "2025-02-03",
      investedMinor: 70_000,
      valueMinor: 0,
      valueState: "reported" as const,
    };
    seedAcceptedPosition(sqlite, {
      ...shared,
      connectionId: historyConnectionId,
      id: "synthetic_distinct_history",
      observedAt: "2026-08-01T00:00:00.000Z",
    });
    seedAcceptedPosition(sqlite, {
      ...shared,
      ...override,
      connectionId: currentConnectionId,
      id: "synthetic_distinct_current",
      observedAt: "2026-09-01T00:00:00.000Z",
    });
    await repository.reconcileRetainedPositionContinuity(accessSubject);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) count FROM holding_position_continuities")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("leaves ambiguous private-provider continuity candidates separate", async () => {
    const historyConnectionId =
      "reconciled-holding-connection-v1:hh_demo:angellist";
    const currentConnectionId = "connection_synthetic_ambiguous_angellist";
    seedPrivateProviderConnection(sqlite, {
      id: historyConnectionId,
      label: "AngelList reviewed history",
      lifecycle: "pending",
      provider: "angellist",
    });
    seedPrivateProviderConnection(sqlite, {
      id: currentConnectionId,
      label: "AngelList",
      provider: "angellist",
    });
    const shared = {
      containerLabel: "Synthetic Family Trust",
      label: "Synthetic Ambiguous Access SPV",
      positionKind: "spv_interest" as const,
      provider: "angellist" as const,
      reportedExposureName: "Synthetic Ambiguous Systems",
      valueMinor: 1_000_000,
      valueState: "reported" as const,
    };
    seedAcceptedPosition(sqlite, {
      ...shared,
      connectionId: historyConnectionId,
      id: "position_synthetic_private_ambiguous_history",
      observedAt: "2026-08-15T00:00:00.000Z",
    });
    for (const suffix of ["one", "two"] as const) {
      seedAcceptedPosition(sqlite, {
        ...shared,
        connectionId: currentConnectionId,
        id: `position_synthetic_private_ambiguous_${suffix}`,
        observedAt: "2026-08-23T00:00:00.000Z",
      });
    }

    await repository.reconcileRetainedPositionContinuity(accessSubject);

    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_continuities
           WHERE predecessor_position_id =
                 'position_synthetic_private_ambiguous_history'`,
        )
        .get(),
    ).toEqual({ count: 0 });
    const projection = await readModel.list(
      accessSubject,
      "2026-08-23T12:00:00.000Z",
    );
    expect(
      projection.positions.filter((position) =>
        position.id.startsWith("position_synthetic_private_ambiguous_"),
      ),
    ).toHaveLength(3);
  });

  it("does not infer reconnect continuity when exact candidates are ambiguous", async () => {
    const historyConnectionId =
      "reconciled-holding-connection-v1:hh_demo:plaid_investments";
    seedPlaidInvestmentConnection(sqlite, {
      id: historyConnectionId,
      label: "Investment reviewed history",
      lifecycle: "pending",
    });
    seedPlaidInvestmentConnection(sqlite, {
      id: "connection_synthetic_candidate_one",
      label: "Synthetic Brokerage A",
    });
    seedPlaidInvestmentConnection(sqlite, {
      id: "connection_synthetic_candidate_two",
      label: "Synthetic Brokerage B",
    });
    for (const [id, connectionId, observedAt] of [
      [
        "position_synthetic_history_ambiguous",
        historyConnectionId,
        "2026-08-15T00:00:00.000Z",
      ],
      [
        "position_synthetic_current_ambiguous_one",
        "connection_synthetic_candidate_one",
        "2026-08-18T00:00:00.000Z",
      ],
      [
        "position_synthetic_current_ambiguous_two",
        "connection_synthetic_candidate_two",
        "2026-08-18T00:00:00.000Z",
      ],
    ] as const) {
      seedAcceptedPosition(sqlite, {
        id,
        connectionId,
        observedAt,
        label: "Synthetic duplicated equity",
        provider: "plaid_investments",
        positionKind: "direct",
        valueMinor: 1_000,
        valueState: "reported",
        containerKind: "brokerage",
        containerLabel: "Synthetic brokerage",
        ticker: "SYN",
        quantityMicros: 1_000_000,
        costBasisMinor: 700,
      });
    }
    for (const [id, connectionId, observedAt, protectedExposureKey] of [
      [
        "position_synthetic_history_conflicting_identity",
        historyConnectionId,
        "2026-08-15T00:00:00.000Z",
        hash("cusip:synthetic-old-identity"),
      ],
      [
        "position_synthetic_current_conflicting_identity",
        "connection_synthetic_candidate_one",
        "2026-08-18T00:00:00.000Z",
        hash("cusip:synthetic-new-identity"),
      ],
    ] as const) {
      seedAcceptedPosition(sqlite, {
        id,
        connectionId,
        observedAt,
        protectedExposureKey,
        publicExposureIdentityKind: "cusip",
        label: "Synthetic conflicting identity equity",
        provider: "plaid_investments",
        positionKind: "direct",
        valueMinor: 2_000,
        valueState: "reported",
        containerKind: "brokerage",
        containerLabel: "Synthetic brokerage",
        ticker: "CONFLICT",
        quantityMicros: 2_000_000,
        costBasisMinor: 1_400,
      });
    }

    await repository.reconcileRetainedPositionContinuity(accessSubject);

    expect(
      sqlite
        .prepare(`SELECT COUNT(*) AS count FROM holding_position_continuities`)
        .get(),
    ).toEqual({ count: 0 });
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO holding_position_continuities (
             id, household_id, predecessor_position_id,
             predecessor_snapshot_id, successor_position_id,
             successor_snapshot_id, resolution_method, recorded_by_user_id,
             recorded_at, immutable
           ) VALUES (?, 'hh_demo', ?, ?, ?, ?,
             'exact_reconnect_snapshot_v1', 'usr_demo', ?, 1)`,
        )
        .run(
          "synthetic-ambiguous-continuity",
          "position_synthetic_history_ambiguous",
          "snapshot_position_synthetic_history_ambiguous",
          "position_synthetic_current_ambiguous_one",
          "snapshot_position_synthetic_current_ambiguous_one",
          "2026-08-18T00:00:00.000Z",
        ),
    ).toThrow(/not a unique candidate/u);
    const projection = await readModel.list(
      accessSubject,
      "2026-08-18T12:00:00.000Z",
    );
    expect(
      projection.positions.filter(
        (position) =>
          position.id.includes("synthetic_") &&
          position.id.includes("ambiguous"),
      ),
    ).toHaveLength(3);
    expect(
      projection.positions.filter((position) =>
        position.id.includes("conflicting_identity"),
      ),
    ).toHaveLength(2);
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

  it("batch-assigns exact company labels across reviewed SPVs and leaves uncertain rows for review", async () => {
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
        positionCount: 5,
        companyCount: 2,
        existingCompanyCount: 1,
        newCompanyCount: 1,
        excludedPositionCount: 3,
      },
    });
    expect(pending.positions).toHaveLength(8);
    expect(pending.positions).toContainEqual(
      expect.objectContaining({ positionId: "position_manual_exact_text" }),
    );

    const result = await repository.applyPrivateExposureExactBatch(
      accessSubject,
      { expectedRevision: pending.exactBatch.revision },
    );
    expect(result).toEqual({
      version: 1,
      assignedPositionCount: 5,
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
         WHERE (
             mapping.position_id LIKE 'position_exact_%'
             OR mapping.position_id = 'position_manual_exact_text'
           )
           AND mapping.status = 'active'
           AND NOT EXISTS (
             SELECT 1
             FROM holding_position_exposure_mappings later
             WHERE later.supersedes_mapping_id = mapping.id
           )
         ORDER BY mapping.position_id`,
      )
      .all() as Array<Record<string, unknown>>;
    expect(assigned).toHaveLength(5);
    expect(
      assigned
        .filter((row) => String(row.position_id).includes("harbor"))
        .map((row) => row.company_id),
    ).toEqual(["co_harbor", "co_harbor"]);
    const altoCompanyIds = assigned
      .filter(
        (row) =>
          String(row.position_id).includes("alto") ||
          row.position_id === "position_manual_exact_text",
      )
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
            /^Reviewed exact company batch /u,
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

  it("defers failed retained documents for a day while advancing a 120-document backlog", async () => {
    for (let index = 0; index < 120; index++) {
      seedAcceptedPosition(sqlite, {
        id: `position_retained_failure_${index}`,
        label: "Synthetic retained security",
        provider: "plaid_investments",
        reportedExposureName: "Synthetic retained security",
        positionKind: "direct",
        valueMinor: 100_000,
        valueState: "reported",
        containerKind: "brokerage",
        ticker: "SYN",
      });
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(recordedAt));
      database.resetRoundTripCount();
      const initial =
        await repository.listRetainedPublicExposureDocuments(accessSubject);
      expect(initial).toHaveLength(120);
      expect(database.roundTripCount).toBe(2);
      const failed = initial.slice(0, 5).map((document) => document.importId);
      await repository.recordRetainedPublicExposureDocumentFailures(
        accessSubject,
        failed,
      );
      expect(database.roundTripCount).toBe(4);
      for (const elapsed of [0, 23 * 3_600_000]) {
        vi.setSystemTime(Date.parse(recordedAt) + elapsed);
        const next =
          await repository.listRetainedPublicExposureDocuments(accessSubject);
        expect(next).toHaveLength(115);
        expect(
          next.some((document) => failed.includes(document.importId)),
        ).toBe(false);
      }
      vi.setSystemTime(Date.parse(recordedAt) + 86_400_001);
      expect(
        await repository.listRetainedPublicExposureDocuments(accessSubject),
      ).toHaveLength(120);
      await repository.recordRetainedPublicExposureDocumentFailures(
        accessSubject,
        ["synthetic-unknown"],
      );
      expect(
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM retained_public_exposure_document_failures",
          )
          .get(),
      ).toEqual({ count: 5 });
      await expect(
        repository.recordRetainedPublicExposureDocumentFailures(
          "synthetic-unauthorized",
          failed,
        ),
      ).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("groups retained positions by global, source-scoped, or structured identity", async () => {
    for (const [id, containerKind] of [
      ["position_retained_public_brokerage", "brokerage"],
      ["position_retained_public_ira", "ira"],
      ["position_retained_provider_brokerage", "brokerage"],
      ["position_retained_provider_ira", "ira"],
      ["position_retained_provider_ineligible", "brokerage"],
      ["position_retained_cash_brokerage", "brokerage"],
      ["position_retained_cash_ira", "ira"],
      ["position_retained_crypto_brokerage", "brokerage"],
      ["position_retained_crypto_ira", "ira"],
    ] as const) {
      seedAcceptedPosition(sqlite, {
        id,
        label: "Synthetic Semiconductor Security",
        provider: "plaid_investments",
        reportedExposureName: "SYN · Synthetic Semiconductor Security",
        positionKind: "direct",
        valueMinor: 1_000_000,
        valueState: "reported",
        containerKind,
        ticker: "SYN",
      });
    }

    const initialDocuments = (
      await repository.listRetainedPublicExposureDocuments(accessSubject)
    ).map((document) => document.importId);
    expect(initialDocuments).toEqual(
      expect.arrayContaining([
        "import_position_retained_public_brokerage",
        "import_position_retained_public_ira",
        "import_position_retained_provider_brokerage",
        "import_position_retained_provider_ira",
        "import_position_retained_provider_ineligible",
        "import_position_retained_cash_brokerage",
        "import_position_retained_cash_ira",
        "import_position_retained_crypto_brokerage",
        "import_position_retained_crypto_ira",
      ]),
    );

    const protectedIdentityKey = hash("cusip:synthetic-semiconductor-security");
    const identities = [
      "position_retained_public_brokerage",
      "position_retained_public_ira",
    ].map((id) => ({
      importRowId: `row_${id}`,
      resolutionStatus: "strong_identifier" as const,
      identityKind: "cusip" as const,
      protectedIdentityKey,
      evidenceSha256: hash(`source:${id}`),
    }));
    const publicEvidence = [
      ...identities,
      ...[
        "position_retained_provider_brokerage",
        "position_retained_provider_ira",
        "position_retained_provider_ineligible",
        "position_retained_cash_brokerage",
        "position_retained_cash_ira",
        "position_retained_crypto_brokerage",
        "position_retained_crypto_ira",
      ].map((id) => ({
        importRowId: `row_${id}`,
        resolutionStatus: "no_strong_identifier" as const,
        evidenceSha256: hash(`source:${id}`),
      })),
    ];
    const providerIdentityKey = hash(
      "provider-security:synthetic-semiconductor-security",
    );
    const providerEvidence = [
      ...[
        "position_retained_provider_brokerage",
        "position_retained_provider_ira",
      ].map((id) => ({
        importRowId: `row_${id}`,
        resolutionStatus: "scoped_identifier" as const,
        protectedIdentityKey: providerIdentityKey,
        evidenceSha256: hash(`source:${id}`),
      })),
      {
        importRowId: "row_position_retained_provider_ineligible",
        resolutionStatus: "not_eligible" as const,
        evidenceSha256: hash("source:position_retained_provider_ineligible"),
      },
      ...[
        "position_retained_cash_brokerage",
        "position_retained_cash_ira",
        "position_retained_crypto_brokerage",
        "position_retained_crypto_ira",
      ].map((id) => ({
        importRowId: `row_${id}`,
        resolutionStatus: "not_eligible" as const,
        evidenceSha256: hash(`source:${id}`),
      })),
    ];
    const cashIdentityKey = hash("cash-currency:USD");
    const cryptoIdentityKey = hash("provider-crypto:synthetic-coin");
    const structuredAssetEvidence = [
      ...["position_retained_cash_brokerage", "position_retained_cash_ira"].map(
        (id) => ({
          importRowId: `row_${id}`,
          resolutionStatus: "structured_identifier" as const,
          identityKind: "cash_currency" as const,
          protectedIdentityKey: cashIdentityKey,
          currencyCode: "USD" as const,
          evidenceSha256: hash(`source:${id}`),
        }),
      ),
      ...[
        "position_retained_crypto_brokerage",
        "position_retained_crypto_ira",
      ].map((id) => ({
        importRowId: `row_${id}`,
        resolutionStatus: "structured_identifier" as const,
        identityKind: "provider_crypto" as const,
        protectedIdentityKey: cryptoIdentityKey,
        currencyCode: null,
        evidenceSha256: hash(`source:${id}`),
      })),
      {
        importRowId: "row_position_retained_provider_ineligible",
        resolutionStatus: "not_eligible" as const,
        evidenceSha256: hash("source:position_retained_provider_ineligible"),
      },
    ];
    await repository.recordRetainedPublicExposureEvidence(
      accessSubject,
      publicEvidence,
    );
    await repository.recordRetainedPublicExposureEvidence(
      accessSubject,
      publicEvidence,
    );
    await repository.recordRetainedProviderExposureEvidence(
      accessSubject,
      providerEvidence,
    );
    const afterProviderEvidence = (
      await repository.listRetainedPublicExposureDocuments(accessSubject)
    ).map((document) => document.importId);
    expect(afterProviderEvidence).toEqual(
      expect.arrayContaining([
        "import_position_retained_provider_ineligible",
        "import_position_retained_cash_brokerage",
        "import_position_retained_cash_ira",
        "import_position_retained_crypto_brokerage",
        "import_position_retained_crypto_ira",
      ]),
    );
    expect(afterProviderEvidence).not.toContain(
      "import_position_retained_public_brokerage",
    );
    expect(afterProviderEvidence).not.toContain(
      "import_position_retained_provider_brokerage",
    );
    await repository.recordRetainedStructuredAssetExposureEvidence(
      accessSubject,
      structuredAssetEvidence,
    );
    await repository.recordRetainedStructuredAssetExposureEvidence(
      accessSubject,
      structuredAssetEvidence,
    );
    await repository.recordRetainedProviderExposureEvidence(
      accessSubject,
      providerEvidence,
    );
    await repository.reconcileAcceptedPublicExposureHistory(accessSubject);
    await repository.reconcileAcceptedPublicExposureHistory(accessSubject);

    const projection = await readModel.list(
      accessSubject,
      "2026-08-16T12:00:00.000Z",
    );
    const publicExposure = projection.exposures.find(
      (group) => group.exposure.protectedIdentityKey === protectedIdentityKey,
    );
    expect(
      publicExposure?.contributions.map((row) => row.positionId).sort(),
    ).toEqual(
      [
        "position_retained_public_brokerage",
        "position_retained_public_ira",
      ].sort(),
    );
    expect(
      projection.positions.find(
        (position) => position.id === "position_retained_provider_ineligible",
      ),
    ).toMatchObject({ mappedExposureIds: [] });
    const providerExposure = projection.exposures.find(
      (group) => group.exposure.protectedIdentityKey === providerIdentityKey,
    );
    expect(
      providerExposure?.contributions.map((row) => row.positionId).sort(),
    ).toEqual(
      [
        "position_retained_provider_brokerage",
        "position_retained_provider_ira",
      ].sort(),
    );
    const cashExposure = projection.exposures.find(
      (group) => group.exposure.protectedIdentityKey === cashIdentityKey,
    );
    expect(cashExposure?.exposure.canonicalName).toBe("US Dollar");
    expect(
      cashExposure?.contributions.map((row) => row.positionId).sort(),
    ).toEqual(
      ["position_retained_cash_brokerage", "position_retained_cash_ira"].sort(),
    );
    const cryptoExposure = projection.exposures.find(
      (group) => group.exposure.protectedIdentityKey === cryptoIdentityKey,
    );
    expect(
      cryptoExposure?.contributions.map((row) => row.positionId).sort(),
    ).toEqual(
      [
        "position_retained_crypto_brokerage",
        "position_retained_crypto_ira",
      ].sort(),
    );
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_import_row_public_exposure_evidence
           WHERE protected_identity_key = ?`,
        )
        .get(protectedIdentityKey),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_import_row_public_exposure_evidence`,
        )
        .get(),
    ).toEqual({ count: 9 });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_import_row_provider_exposure_evidence`,
        )
        .get(),
    ).toEqual({ count: 7 });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_import_row_structured_asset_exposure_evidence`,
        )
        .get(),
    ).toEqual({ count: 5 });
    expect(
      await repository.listRetainedPublicExposureDocuments(accessSubject),
    ).toEqual([]);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_exposure_mappings mapping
           JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
           WHERE exposure.protected_identity_key = ?`,
        )
        .get(protectedIdentityKey),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_exposure_mappings mapping
           JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
           WHERE exposure.protected_identity_key = ?`,
        )
        .get(cashIdentityKey),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_exposure_mappings mapping
           JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
           WHERE exposure.protected_identity_key = ?`,
        )
        .get(cryptoIdentityKey),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_exposure_mappings mapping
           JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
           WHERE exposure.protected_identity_key = ?`,
        )
        .get(providerIdentityKey),
    ).toEqual({ count: 2 });
    await expect(
      repository.recordRetainedProviderExposureEvidence(accessSubject, [
        {
          importRowId: "row_position_retained_provider_ineligible",
          resolutionStatus: "scoped_identifier",
          protectedIdentityKey: providerIdentityKey,
          evidenceSha256: hash("wrong retained document"),
        },
      ]),
    ).rejects.toThrow("Provider-scoped exposure evidence changed.");
    await expect(
      repository.recordRetainedStructuredAssetExposureEvidence(accessSubject, [
        {
          importRowId: "row_position_retained_provider_ineligible",
          resolutionStatus: "structured_identifier",
          identityKind: "cash_currency",
          protectedIdentityKey: cashIdentityKey,
          currencyCode: "USD",
          evidenceSha256: hash("wrong retained document"),
        },
      ]),
    ).rejects.toThrow("Structured asset exposure evidence changed.");
  });

  it("reconciles and projects 120 public positions within indexed D1 budgets", async () => {
    for (let index = 0; index < 120; index += 1) {
      const id = `position_scale_${index.toString().padStart(3, "0")}`;
      seedAcceptedPosition(sqlite, {
        id,
        label: `Synthetic Scale Security ${index.toString().padStart(3, "0")}`,
        provider: "plaid_investments",
        publicExposureIdentityKind: "cusip",
        protectedExposureKey: hash(`scale-exposure:${index.toString()}`),
        positionKind: "direct",
        valueMinor: 100_000 + index,
        valueState: "reported",
        containerKind: "brokerage",
      });
    }

    database.resetRoundTripCount();
    await repository.reconcileAcceptedPublicExposureHistory(accessSubject);
    expect(database.roundTripCount).toBeLessThanOrEqual(10);
    expect(
      sqlite
        .prepare(
          `SELECT
             COUNT(*) AS mapping_count,
             COUNT(DISTINCT exposure_id) AS exposure_count
           FROM holding_position_exposure_mappings
           WHERE position_id GLOB 'position_scale_*'`,
        )
        .get(),
    ).toEqual({ mapping_count: 120, exposure_count: 120 });

    database.resetRoundTripCount();
    await repository.reconcileAcceptedPublicExposureHistory(accessSubject);
    expect(database.roundTripCount).toBeLessThanOrEqual(4);

    database.resetRoundTripCount();
    await readModel.list(accessSubject);
    expect(database.roundTripCount).toBeLessThanOrEqual(8);
    const exposureSql = database.preparedSql.find(
      (sql) =>
        sql.includes("FROM canonical_exposures") &&
        sql.includes("current_mapping.exposure_id"),
    );
    expect(exposureSql).toBeDefined();
    const plan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${exposureSql ?? "SELECT 1"}`)
      .all("hh_demo") as Array<{ detail: string }>;
    expect(
      plan.some((row) =>
        row.detail.includes(
          "holding_position_exposure_mappings_household_exposure_idx",
        ),
      ),
    ).toBe(true);
    const acceptedValuationSql = database.preparedSql.find((sql) =>
      sql.includes("FROM public_source_observations observation"),
    );
    expect(acceptedValuationSql).toBeDefined();
    const acceptedValuationPlan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${acceptedValuationSql ?? "SELECT 1"}`)
      .all("hh_demo") as Array<{ detail: string }>;
    const acceptedValuationPlanDetails = acceptedValuationPlan
      .map((row) => row.detail)
      .join("\n");
    expect(acceptedValuationPlanDetails).toContain(
      "evidence_events_household_status_idx",
    );
    expect(acceptedValuationPlanDetails).toContain(
      "sqlite_autoindex_public_source_observations_2",
    );
    expect(acceptedValuationPlanDetails).toContain(
      "sqlite_autoindex_evidence_claims_2",
    );
    expect(acceptedValuationPlanDetails).not.toContain("SCAN");

    database.resetRoundTripCount();
    const alphaSqlStart = database.preparedSql.length;
    const changesBefore = sqlite
      .prepare("SELECT total_changes() AS count")
      .get();
    const alpha = await new D1AlphaRepository(
      database as unknown as D1Database,
    ).getAlphaData(accessSubject);
    expect(
      alpha.holdings.filter((holding) =>
        holding.id.startsWith("position_scale_"),
      ),
    ).toHaveLength(120);
    expect(database.roundTripCount).toBe(13);
    expect(sqlite.prepare("SELECT total_changes() AS count").get()).toEqual(
      changesBefore,
    );
    const holdingsSql = database.preparedSql
      .slice(alphaSqlStart)
      .find(
        (sql) => sql.includes("SELECT * FROM (") && sql.includes("UNION ALL"),
      );
    expect(holdingsSql).toBeDefined();
    const holdingsPlan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${holdingsSql ?? "SELECT 1"}`)
      .all("hh_demo", "hh_demo") as Array<{ detail: string }>;
    expect(holdingsPlan.map((row) => row.detail)).not.toContain("SCAN mapping");
    expect(
      holdingsPlan.filter(
        (row) =>
          row.detail.startsWith("SEARCH mapping ") &&
          row.detail.includes("household_id=? AND position_id=?"),
      ),
    ).toHaveLength(2);
  });
});

describe("holding ownership and exposure reconciliation migration", () => {
  it("repairs legacy reads, adds only high-confidence mappings, and prevents recurrence", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    try {
      migrationFiles
        .filter(
          (file) =>
            file !== reconciliationMigrationFile &&
            file !== retainedPublicIdentityMigrationFile &&
            file !== providerScopedIdentityMigrationFile &&
            file !== structuredAssetIdentityMigrationFile &&
            file !== reconnectedPositionContinuityMigrationFile &&
            file !== oneSidedPositionIdentityMigrationFile &&
            file !== privateProviderPositionContinuityMigrationFile &&
            file !== portfolioWatchExposureUniverseMigrationFile &&
            file !==
              "packages/database/migrations/0063_current_exposure_mapping_heads.sql" &&
            file !==
              "packages/database/migrations/0073_public_company_recommendations.sql" &&
            file !== "packages/database/seed/synthetic.sql",
        )
        .forEach((file) => {
          database.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
        });
      database.exec(
        readFileSync(
          resolve(process.cwd(), "packages/database/seed/synthetic.sql"),
          "utf8",
        ),
      );
      seedManualConnection(database);
      const legacyPublicExposureKey = hash("cusip:synthetic-legacy-public");
      seedAcceptedPosition(database, {
        id: "position_legacy_angellist_orphan",
        label: "Synthetic Legacy Private SPV",
        provider: "angellist",
        reportedExposureName: "Synthetic Legacy Private Company",
        positionKind: "spv_interest",
        valueMinor: 4_000_000,
        valueState: "reported",
      });
      seedAcceptedPosition(database, {
        id: "position_legacy_plaid_orphan",
        label: "Synthetic Legacy Public Security",
        provider: "plaid_investments",
        reportedExposureName: "SYN · Synthetic Legacy Public Security",
        positionKind: "direct",
        valueMinor: 2_000_000,
        valueState: "reported",
        containerKind: "brokerage",
        publicExposureIdentityKind: "cusip",
        protectedExposureKey: legacyPublicExposureKey,
        ticker: "SYN",
      });
      seedAcceptedPosition(database, {
        id: "position_legacy_manual_public_strong_id_unmapped",
        label: "Synthetic Legacy Public Security in Another Account",
        provider: "manual",
        reportedExposureName: "SYN · Synthetic Legacy Public Security",
        positionKind: "direct",
        valueMinor: 3_000_000,
        valueState: "reported",
        containerKind: "brokerage",
        publicExposureIdentityKind: "cusip",
        protectedExposureKey: legacyPublicExposureKey,
        ticker: "SYN",
      });
      seedAcceptedPosition(database, {
        id: "position_legacy_reviewed_company_unmapped",
        label: "Synthetic Legacy Harbor Access SPV",
        provider: "manual",
        reportedExposureName: "Harbor Health Systems",
        reportedCompanyId: "co_harbor",
        positionKind: "spv_interest",
        valueMinor: 5_000_000,
        valueState: "reported",
      });
      seedAcceptedPosition(database, {
        id: "position_legacy_ticker_only_unmapped",
        label: "Synthetic Ticker-only Security",
        provider: "plaid_investments",
        reportedExposureName: "SYN · Synthetic Ticker-only Security",
        positionKind: "direct",
        valueMinor: 1_000_000,
        valueState: "reported",
        containerKind: "brokerage",
        ticker: "SYN",
      });
      seedAcceptedPosition(database, {
        id: "position_manual_direct_reviewed_company_unmapped",
        label: "Synthetic Manual Direct Company Interest",
        provider: "manual",
        reportedExposureName: "Harbor Health Systems",
        reportedCompanyId: "co_harbor",
        positionKind: "direct",
        valueMinor: 6_000_000,
        valueState: "reported",
      });
      seedAcceptedPosition(database, {
        id: "position_angellist_fund_reviewed_company_unmapped",
        label: "Synthetic AngelList Diversified Fund",
        provider: "angellist",
        reportedExposureName: "Harbor Health Systems",
        reportedCompanyId: "co_harbor",
        positionKind: "fund_interest",
        valueMinor: 7_000_000,
        valueState: "reported",
      });
      const legacyPositionIds = [
        "position_legacy_angellist_orphan",
        "position_legacy_plaid_orphan",
        "position_legacy_manual_public_strong_id_unmapped",
        "position_legacy_reviewed_company_unmapped",
        "position_legacy_ticker_only_unmapped",
      ];
      withoutImmutableDeleteTriggers(
        database,
        [
          "holding_position_ownerships_no_delete",
          "holding_import_row_containers_no_delete",
          "holding_import_coverages_no_delete",
          "holding_import_connections_no_delete",
        ],
        () => {
          database
            .prepare(
              `DELETE FROM holding_import_row_containers
               WHERE import_row_id = ?`,
            )
            .run("row_position_legacy_ticker_only_unmapped");
          database
            .prepare(
              `DELETE FROM holding_import_coverages
               WHERE import_id = ?`,
            )
            .run("import_position_legacy_ticker_only_unmapped");
          database
            .prepare(
              `DELETE FROM holding_import_connections
               WHERE import_id = ?`,
            )
            .run("import_position_legacy_ticker_only_unmapped");
          database
            .prepare(
              `DELETE FROM holding_position_ownerships
               WHERE position_id IN (?, ?, ?, ?, ?)`,
            )
            .run(...legacyPositionIds);
        },
      );

      const d1 = new TestD1Database(database) as unknown as D1Database;
      const repository = new D1ExposureRepository(d1);
      const privateExposure = await repository.resolveExposure(accessSubject, {
        exposureKind: "private_company",
        canonicalName: "Synthetic Legacy Private Company",
        companyId: "co_harbor",
        evidenceSha256: hash("legacy private mapping evidence"),
      });
      const publicExposure = await repository.resolveExposure(accessSubject, {
        exposureKind: "public_instrument",
        canonicalName: "Synthetic Legacy Public Security",
        protectedIdentityKey: legacyPublicExposureKey,
        evidenceSha256: hash("legacy public mapping evidence"),
      });
      await repository.recordMapping(accessSubject, {
        positionId: "position_legacy_angellist_orphan",
        exposureId: privateExposure.id,
        relationshipKind: "look_through",
        allocationPpm: 1_000_000,
        status: "active",
        decisionSource: "review",
        decisionReference: "legacy reviewed SPV mapping",
        evidenceSha256: hash("legacy private mapping decision"),
        effectiveAt: recordedAt,
      });
      await repository.recordMapping(accessSubject, {
        positionId: "position_legacy_plaid_orphan",
        exposureId: publicExposure.id,
        relationshipKind: "direct",
        allocationPpm: 1_000_000,
        status: "active",
        decisionSource: "deterministic_policy",
        decisionReference: "public-strong-identifier-v1:cusip",
        evidenceSha256: hash("legacy public mapping decision"),
        effectiveAt: recordedAt,
      });

      // Keep the read-model schema current while proving the earlier ownership
      // repair against deliberately orphaned accepted positions.
      for (const file of [
        retainedPublicIdentityMigrationFile,
        providerScopedIdentityMigrationFile,
        structuredAssetIdentityMigrationFile,
        reconnectedPositionContinuityMigrationFile,
        oneSidedPositionIdentityMigrationFile,
      ]) {
        database.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
      }

      const exposureView = new D1InvestmentExposureViewRepository(d1);
      const baselines = new D1PortfolioBaselineRepository(d1);
      await expect(exposureView.list(accessSubject)).rejects.toThrow(
        "Exposure mapping is missing its authoritative accepted position.",
      );
      await expect(baselines.getState(accessSubject)).rejects.toThrow(
        "Exposure mapping is missing its authoritative accepted position.",
      );
      const topologyCountsBefore = database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM investment_connections) AS connections,
             (SELECT COUNT(*) FROM ownership_containers) AS containers`,
        )
        .get() as { connections: number; containers: number };

      database.exec(
        readFileSync(
          resolve(process.cwd(), reconciliationMigrationFile),
          "utf8",
        ),
      );

      const projection = await exposureView.list(
        accessSubject,
        "2026-08-16T12:00:00.000Z",
      );
      expect(
        projection.positions
          .filter((position) => legacyPositionIds.includes(position.id))
          .map((position) => position.id)
          .sort(),
      ).toEqual([...legacyPositionIds].sort());
      const baseline = await baselines.getState(accessSubject);
      expect(baseline.status).toBe("ready");
      expect(
        baseline.positions
          .filter((position) => legacyPositionIds.includes(position.id))
          .map((position) => position.id)
          .sort(),
      ).toEqual(["position_legacy_ticker_only_unmapped"]);
      expect(
        database
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM investment_connections) AS connections,
               (SELECT COUNT(*) FROM ownership_containers) AS containers`,
          )
          .get(),
      ).toEqual({
        connections: topologyCountsBefore.connections + 1,
        containers: topologyCountsBefore.containers + 1,
      });
      expect(
        database
          .prepare(
            `SELECT
               ownership.container_id AS ownership_container_id,
               row_scope.container_id AS row_container_id,
               container.connection_id AS container_connection_id,
               import_scope.connection_id AS import_connection_id
             FROM holding_position_ownerships ownership
             JOIN holding_import_applications application
               ON application.position_id = ownership.position_id
             JOIN holding_import_row_containers row_scope
               ON row_scope.import_row_id = application.import_row_id
             JOIN holding_import_rows row
               ON row.id = application.import_row_id
             JOIN holding_import_connections import_scope
               ON import_scope.import_id = row.import_id
             JOIN ownership_containers container
               ON container.id = ownership.container_id
             WHERE ownership.position_id = ?`,
          )
          .get("position_legacy_angellist_orphan"),
      ).toEqual({
        ownership_container_id: "container_position_legacy_angellist_orphan",
        row_container_id: "container_position_legacy_angellist_orphan",
        container_connection_id: "connection_exposure_test",
        import_connection_id: "connection_exposure_test",
      });
      const reconstructedScope = database
        .prepare(
          `SELECT
             import_scope.connection_id AS import_connection_id,
             container.connection_id AS container_connection_id,
             connection.adapter_type,
             row_scope.container_id AS row_container_id,
             coverage.container_id AS coverage_container_id,
             coverage.completeness,
             ownership.container_id AS ownership_container_id,
             ownership.association_basis,
             container_version.container_kind
           FROM holding_import_applications application
           JOIN holding_import_rows row
             ON row.id = application.import_row_id
           JOIN holding_import_connections import_scope
             ON import_scope.import_id = row.import_id
           JOIN investment_connections connection
             ON connection.id = import_scope.connection_id
           JOIN holding_import_row_containers row_scope
             ON row_scope.import_row_id = row.id
           JOIN ownership_containers container
             ON container.id = row_scope.container_id
           JOIN ownership_container_versions container_version
             ON container_version.container_id = container.id
            AND NOT EXISTS (
              SELECT 1
              FROM ownership_container_versions later
              WHERE later.supersedes_version_id = container_version.id
            )
           JOIN holding_import_coverages coverage
             ON coverage.import_id = row.import_id
            AND coverage.container_id = row_scope.container_id
           JOIN holding_position_ownerships ownership
             ON ownership.position_id = application.position_id
            AND ownership.container_id = row_scope.container_id
           WHERE application.position_id = ?`,
        )
        .get("position_legacy_ticker_only_unmapped") as {
        import_connection_id: string;
        container_connection_id: string;
        adapter_type: string;
        row_container_id: string;
        coverage_container_id: string;
        completeness: string;
        ownership_container_id: string;
        association_basis: string;
        container_kind: string;
      };
      expect(reconstructedScope).toMatchObject({
        adapter_type: "plaid-investments",
        completeness: "ambiguous",
        association_basis: "reviewed_import",
        container_kind: "unresolved",
      });
      expect(reconstructedScope.import_connection_id).toBe(
        reconstructedScope.container_connection_id,
      );
      expect(reconstructedScope.row_container_id).toBe(
        reconstructedScope.coverage_container_id,
      );
      expect(reconstructedScope.row_container_id).toBe(
        reconstructedScope.ownership_container_id,
      );
      expect(reconstructedScope.import_connection_id).not.toBe(
        "connection_exposure_test",
      );
      expect(reconstructedScope.row_container_id).not.toBe(
        "container_position_legacy_ticker_only_unmapped",
      );
      expect(
        projection.exposures
          .find((group) => group.exposure.id === publicExposure.id)
          ?.contributions.map((contribution) => contribution.positionId)
          .sort(),
      ).toEqual(
        [
          "position_legacy_plaid_orphan",
          "position_legacy_manual_public_strong_id_unmapped",
        ].sort(),
      );
      expect(
        projection.exposures
          .find((group) => group.exposure.id === privateExposure.id)
          ?.contributions.map((contribution) => contribution.positionId)
          .sort(),
      ).toEqual(
        [
          "position_legacy_angellist_orphan",
          "position_legacy_reviewed_company_unmapped",
        ].sort(),
      );
      expect(
        projection.positions.find(
          (position) => position.id === "position_legacy_ticker_only_unmapped",
        ),
      ).toMatchObject({ mappedExposureIds: [] });
      expect(
        projection.positions
          .filter((position) =>
            [
              "position_manual_direct_reviewed_company_unmapped",
              "position_angellist_fund_reviewed_company_unmapped",
            ].includes(position.id),
          )
          .map((position) => ({
            id: position.id,
            mappedExposureIds: position.mappedExposureIds,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      ).toEqual([
        {
          id: "position_angellist_fund_reviewed_company_unmapped",
          mappedExposureIds: [],
        },
        {
          id: "position_manual_direct_reviewed_company_unmapped",
          mappedExposureIds: [],
        },
      ]);
      expect(
        database
          .prepare(
            `SELECT
               COUNT(*) AS count,
               COUNT(DISTINCT association_basis) AS basis_count,
               MIN(association_basis) AS association_basis,
               MIN(version) AS minimum_version,
               MAX(version) AS maximum_version
             FROM holding_position_ownerships
             WHERE position_id IN (?, ?, ?, ?, ?)`,
          )
          .get(...legacyPositionIds),
      ).toEqual({
        count: 5,
        basis_count: 1,
        association_basis: "reviewed_import",
        minimum_version: 1,
        maximum_version: 1,
      });

      database
        .prepare(
          `INSERT INTO holding_positions (
             id, household_id, provider, position_fingerprint,
             legal_vehicle_name, owner_label, position_kind, instrument_type,
             opened_on, currency, created_by, created_at
           ) VALUES (
             'position_future_unowned_mapping', 'hh_demo', 'manual', ?,
             'Synthetic Future Unowned SPV', 'Synthetic owner',
             'spv_interest', 'private interest', NULL, 'USD', 'usr_demo', ?
           )`,
        )
        .run(hash("position:future-unowned-mapping"), recordedAt);
      await expect(
        repository.recordMapping(accessSubject, {
          positionId: "position_future_unowned_mapping",
          exposureId: privateExposure.id,
          relationshipKind: "look_through",
          allocationPpm: 1_000_000,
          status: "active",
          decisionSource: "review",
          decisionReference: "future invalid mapping",
          evidenceSha256: hash("future invalid mapping evidence"),
          effectiveAt: recordedAt,
        }),
      ).rejects.toThrow(
        "exposure mapping requires canonical position ownership",
      );
    } finally {
      database.close();
    }
  });
});

describe("exact reviewed private exposure migration", () => {
  it("backfills only unique existing reviewed-company matches", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    try {
      migrationFiles
        .filter(
          (file) =>
            file !== exactReviewedPrivateExposuresMigrationFile &&
            file !== privateProviderPositionContinuityMigrationFile &&
            file !== "packages/database/seed/synthetic.sql",
        )
        .forEach((file) => {
          database.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
        });
      database.exec(
        readFileSync(
          resolve(process.cwd(), "packages/database/seed/synthetic.sql"),
          "utf8",
        ),
      );
      seedManualConnection(database);
      seedAcceptedPosition(database, {
        id: "position_exact_reviewed_harbor",
        label: "Synthetic Harbor Access SPV",
        provider: "angellist",
        reportedExposureName: "  HARBOR HEALTH SYSTEMS  ",
        positionKind: "spv_interest",
        valueMinor: 4_000_000,
        valueState: "reported",
      });
      seedAcceptedPosition(database, {
        id: "position_exact_unreviewed",
        label: "Synthetic New Company Access SPV",
        provider: "angellist",
        reportedExposureName: "Synthetic New Company",
        positionKind: "spv_interest",
        valueMinor: 2_000_000,
        valueState: "reported",
      });
      database
        .prepare(
          `INSERT INTO companies (
             id, household_id, legal_name, website_host, status,
             created_at, updated_at
           ) VALUES
             ('co_ambiguous_exact_a', 'hh_demo', 'Synthetic Ambiguous Exact',
              NULL, 'active', ?, ?),
             ('co_ambiguous_exact_b', 'hh_demo', 'synthetic ambiguous exact',
              NULL, 'active', ?, ?)`,
        )
        .run(recordedAt, recordedAt, recordedAt, recordedAt);
      seedAcceptedPosition(database, {
        id: "position_exact_ambiguous_reviewed",
        label: "Synthetic Ambiguous Access SPV",
        provider: "angellist",
        reportedExposureName: "Synthetic Ambiguous Exact",
        positionKind: "spv_interest",
        valueMinor: 3_000_000,
        valueState: "reported",
      });
      const companyCount = database
        .prepare("SELECT COUNT(*) AS count FROM companies")
        .get();

      const migration = readFileSync(
        resolve(process.cwd(), exactReviewedPrivateExposuresMigrationFile),
        "utf8",
      );
      database.exec(migration);
      database.exec(migration);

      expect(
        database
          .prepare(
            `SELECT
               mapping.position_id,
               exposure.company_id,
               mapping.decision_source,
               mapping.decision_reference,
               mapping.relationship_kind,
               mapping.allocation_ppm
             FROM holding_position_exposure_mappings mapping
             JOIN canonical_exposures exposure
               ON exposure.id = mapping.exposure_id
             WHERE mapping.position_id LIKE 'position_exact_%'
               AND mapping.status = 'active'
               AND NOT EXISTS (
                 SELECT 1
                 FROM holding_position_exposure_mappings later
                 WHERE later.supersedes_mapping_id = mapping.id
               )
             ORDER BY mapping.position_id`,
          )
          .all(),
      ).toEqual([
        {
          position_id: "position_exact_reviewed_harbor",
          company_id: "co_harbor",
          decision_source: "deterministic_policy",
          decision_reference: "private-company-exact-reviewed-v1",
          relationship_kind: "look_through",
          allocation_ppm: 1_000_000,
        },
      ]);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM companies").get(),
      ).toEqual(companyCount);
    } finally {
      database.close();
    }
  });
});

describe("private provider position continuity migration", () => {
  it("backfills 90 exact provider matches and remains retry safe", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    try {
      migrationFiles
        .filter(
          (file) =>
            file !== privateProviderPositionContinuityMigrationFile &&
            file !== "packages/database/seed/synthetic.sql",
        )
        .forEach((file) => {
          database.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
        });
      database.exec(
        readFileSync(
          resolve(process.cwd(), "packages/database/seed/synthetic.sql"),
          "utf8",
        ),
      );

      const matchesPerProvider = 30;
      for (const provider of ["angellist", "tokenfolio", "sydecar"] as const) {
        const historyConnectionId = `reconciled-holding-connection-v1:hh_demo:${provider}`;
        const currentConnectionId = `connection_synthetic_current_${provider}`;
        seedPrivateProviderConnection(database, {
          id: historyConnectionId,
          label: `${provider} reviewed history`,
          lifecycle: "pending",
          provider,
        });
        seedPrivateProviderConnection(database, {
          id: currentConnectionId,
          label: provider,
          provider,
        });
        for (let index = 1; index <= matchesPerProvider; index += 1) {
          const shared = {
            containerLabel: `Synthetic ${provider} family trust`,
            label: `Synthetic ${provider} access SPV ${index}`,
            positionKind: "spv_interest" as const,
            provider,
            reportedExposureName: `Synthetic ${provider} systems ${index}`,
            valueMinor: 1_000_000 + index,
            valueState: "reported" as const,
          };
          seedAcceptedPosition(database, {
            ...shared,
            connectionId: historyConnectionId,
            id: `position_synthetic_${provider}_${index}_history`,
            observedAt: "2026-08-15T00:00:00.000Z",
          });
          seedAcceptedPosition(database, {
            ...shared,
            connectionId: currentConnectionId,
            id: `position_synthetic_${provider}_${index}_current`,
            observedAt: "2026-08-23T00:00:00.000Z",
          });
        }
      }

      const d1 = new TestD1Database(database) as unknown as D1Database;
      const exposureView = new D1InvestmentExposureViewRepository(d1);
      const before = await exposureView.list(
        accessSubject,
        "2026-08-23T12:00:00.000Z",
      );
      expect(
        before.positions.filter((position) =>
          position.id.startsWith("position_synthetic_"),
        ),
      ).toHaveLength(180);

      const migrationSql = readFileSync(
        resolve(process.cwd(), privateProviderPositionContinuityMigrationFile),
        "utf8",
      );
      database.exec(migrationSql);
      database.exec(migrationSql);

      const after = await exposureView.list(
        accessSubject,
        "2026-08-23T12:00:00.000Z",
      );
      expect(
        after.positions.filter(
          (position) =>
            position.id.startsWith("position_synthetic_") &&
            position.id.endsWith("_current"),
        ),
      ).toHaveLength(90);
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM holding_position_continuities
             WHERE predecessor_position_id LIKE 'position_synthetic_%_history'`,
          )
          .get(),
      ).toEqual({ count: 90 });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM holding_position_continuities
             WHERE predecessor_position_id LIKE 'position_synthetic_%_history'
               AND replace(predecessor_position_id, '_history', '') <>
                   replace(successor_position_id, '_current', '')`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM holding_position_snapshots
             WHERE position_id LIKE 'position_synthetic_%'`,
          )
          .get(),
      ).toEqual({ count: 180 });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
    } finally {
      database.close();
    }
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
