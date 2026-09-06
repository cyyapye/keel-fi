import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { D1InvestmentExposureViewRepository } from "./exposure-read-model";
import {
  D1HoldingImportRepository,
  type PlaidInvestmentsHoldingImportStageInput,
} from "./holding-imports";
import {
  __investmentConnectionsTest,
  D1InvestmentConnectionsRepository,
} from "./investment-connections";
import { D1PortfolioBaselineRepository } from "./portfolio-baseline";
import { D1InvestmentPositionViewRepository } from "./position-read-model";

const accessSubject = "synthetic-access-subject";
const robinhoodItemKey = "a".repeat(64);
const fidelityItemKey = "b".repeat(64);
const secondFidelityItemKey = "e".repeat(64);

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
  "packages/database/migrations/0038_reviewed_position_value_adjustments.sql",
  "packages/database/migrations/0039_reviewed_position_economics.sql",
  "packages/database/migrations/0040_holdings_read_performance.sql",
  "packages/database/migrations/0041_reported_position_economics.sql",
  "packages/database/migrations/0044_public_equity_sync_schedule.sql",
  "packages/database/migrations/0046_reviewed_legal_entity_inventory.sql",
  "packages/database/migrations/0047_provider_legal_document_evidence.sql",
  "packages/database/migrations/0048_private_document_access.sql",
  "packages/database/migrations/0049_legal_name_resolutions.sql",
  "packages/database/migrations/0050_agreement_rechecks.sql",
  "packages/database/seed/synthetic.sql",
] as const;

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
  private beforeBatchOnce: (() => void) | null = null;

  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }

  public beforeNextBatch(callback: () => void): void {
    this.beforeBatchOnce = callback;
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
    const beforeBatch = this.beforeBatchOnce;
    this.beforeBatchOnce = null;
    beforeBatch?.();
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

function sameSecurityInput(input: {
  connectionId: string;
  fingerprintCharacter: string;
  institutionLabel: string;
  accounts: readonly {
    accountKey: string;
    positionKey: string;
    label: string;
    kind: "brokerage" | "ira";
    taxTreatment: "taxable" | "tax_exempt";
    quantityMicros: number;
    marketValueMinor: number;
  }[];
}): PlaidInvestmentsHoldingImportStageInput {
  const fingerprint = input.fingerprintCharacter.repeat(64);
  const institutionSlug = input.institutionLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-");
  return {
    objectKey: `holding-imports/synthetic-${institutionSlug}-${input.fingerprintCharacter}.json`,
    sha256: fingerprint,
    byteSize: 2_048,
    normalizedFingerprint: fingerprint,
    effectiveDate: "2026-08-15",
    retrievedAt: "2026-08-15T12:00:00.000Z",
    rows: input.accounts.map((account, index) => ({
      rowNumber: index + 1,
      naturalKeySha256: account.positionKey,
      securityName: "Synthetic NVIDIA common stock",
      ticker: "NVDA",
      securityType: "equity",
      accountLabel: account.label,
      quantityMicros: account.quantityMicros,
      costBasisMinor: account.marketValueMinor - 10_000,
      marketValueMinor: account.marketValueMinor,
      observedOn: "2026-08-15",
      currency: "USD",
      issues: [],
    })),
    canonicalScope: {
      connection: { mode: "existing", connectionId: input.connectionId },
      containers: input.accounts.map((account) => ({
        protectedAccountKey: account.accountKey,
        displayLabel: account.label,
        containerKind: account.kind,
        taxTreatment: account.taxTreatment,
        completeness: "complete" as const,
      })),
      rows: input.accounts.map((account, index) => ({
        sourceRowNumber: index + 1,
        protectedAccountKey: account.accountKey,
        protectedPositionKey: account.positionKey,
        publicExposureIdentityKind: "cusip" as const,
        protectedExposureKey: "f".repeat(64),
      })),
    },
  };
}

describe("Plaid Investments connection state", () => {
  let sqlite: DatabaseSync;
  let database: TestD1Database;
  let repository: D1InvestmentConnectionsRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    database = new TestD1Database(sqlite);
    repository = new D1InvestmentConnectionsRepository(
      database as unknown as D1Database,
    );
  });

  afterEach(() => sqlite.close());

  it("reports deployment configuration separately from connection state", async () => {
    await expect(repository.getState(accessSubject, false)).resolves.toEqual({
      version: 1,
      configured: false,
      connections: [],
      errorCode: "configuration_required",
    });
    await expect(repository.getState(accessSubject, true)).resolves.toEqual({
      version: 1,
      configured: true,
      connections: [],
      errorCode: null,
    });
  });

  it("keeps multiple Plaid Items as independent institution connections", async () => {
    const robinhood = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood.enc",
      robinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );
    const fidelity = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity.enc",
      fidelityItemKey,
      "ins_fidelity",
      "Fidelity",
    );
    const secondFidelity = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity-second.enc",
      secondFidelityItemKey,
      "ins_fidelity",
      "Fidelity",
    );

    expect(fidelity.id).not.toBe(robinhood.id);
    expect(fidelity.connectorAccountId).not.toBe(robinhood.connectorAccountId);
    expect(secondFidelity.id).not.toBe(fidelity.id);
    expect(secondFidelity.connectorAccountId).not.toBe(
      fidelity.connectorAccountId,
    );
    await expect(
      repository.getState(accessSubject, true),
    ).resolves.toMatchObject({
      configured: true,
      connections: expect.arrayContaining([
        expect.objectContaining({
          connectionId: robinhood.id,
          institutionKey: "ins_robinhood",
          institutionLabel: "Robinhood",
          status: "ready",
        }),
        expect.objectContaining({
          connectionId: fidelity.id,
          institutionKey: "ins_fidelity",
          institutionLabel: "Fidelity",
          status: "ready",
        }),
        expect.objectContaining({
          connectionId: secondFidelity.id,
          institutionKey: "ins_fidelity",
          institutionLabel: "Fidelity",
          status: "ready",
        }),
      ]),
    });

    const reconnected = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood-new.enc",
      robinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );
    expect(reconnected).toMatchObject({
      id: robinhood.id,
      connectorAccountId: robinhood.connectorAccountId,
      previousSecretReference: "connector-secrets/synthetic-robinhood.enc",
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM investment_connection_versions
           WHERE connection_id = ?`,
        )
        .get(robinhood.id),
    ).toEqual({ count: 2 });
    await expect(
      repository.upsertConnection(
        accessSubject,
        "connector-secrets/synthetic-wrong-institution.enc",
        robinhoodItemKey,
        "ins_other",
        "Other institution",
      ),
    ).rejects.toThrow("institution identity changed");
  });

  it("scopes concurrent sync runs and completion to the selected connection", async () => {
    const robinhood = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood.enc",
      robinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );
    const fidelity = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity.enc",
      fidelityItemKey,
      "ins_fidelity",
      "Fidelity",
    );

    const robinhoodRun = await repository.beginSync(
      accessSubject,
      robinhood.id,
    );
    const duplicate = await repository.beginSync(accessSubject, robinhood.id);
    const fidelityRun = await repository.beginSync(accessSubject, fidelity.id);
    expect(duplicate).toMatchObject({ id: robinhoodRun.id, created: false });
    expect(fidelityRun).toMatchObject({ created: true });
    expect(fidelityRun.id).not.toBe(robinhoodRun.id);

    await repository.failSync(
      accessSubject,
      robinhoodRun.id,
      "provider_unavailable",
    );
    await repository.completeSync(accessSubject, fidelityRun.id, {
      discoveredCount: 0,
      proposedCount: 0,
      importId: null,
    });

    await expect(
      repository.getConnectionStatus(accessSubject, robinhood.id),
    ).resolves.toMatchObject({
      status: "needs_attention",
      latestRunStatus: "failed",
      errorCode: "provider_unavailable",
      lastSyncedAt: null,
    });
    await expect(
      repository.getConnectionStatus(accessSubject, fidelity.id),
    ).resolves.toMatchObject({
      status: "ready",
      latestRunStatus: "succeeded",
      errorCode: null,
      lastSyncedAt: expect.any(String),
    });
  });

  it("turns an abandoned investment check into a retryable failure", async () => {
    const robinhood = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood.enc",
      robinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );
    const abandoned = await repository.beginSync(accessSubject, robinhood.id);
    sqlite
      .prepare(
        `UPDATE connector_sync_runs
         SET started_at = ?
         WHERE id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", abandoned.id);

    await expect(
      repository.getConnectionStatus(accessSubject, robinhood.id),
    ).resolves.toMatchObject({
      status: "needs_attention",
      latestRunStatus: "failed",
      errorCode: "unexpected_failure",
    });

    const retry = await repository.beginSync(accessSubject, robinhood.id);
    expect(retry).toMatchObject({ created: true });
    expect(retry.id).not.toBe(abandoned.id);
    expect(
      sqlite
        .prepare(
          `SELECT status, error_code
           FROM connector_sync_runs
           WHERE id = ?`,
        )
        .get(abandoned.id),
    ).toEqual({ status: "failed", error_code: "unexpected_failure" });
  });

  it("claims at most one automatic sync attempt per connection every 24 hours", async () => {
    const robinhood = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood.enc",
      robinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );
    const syncedAfter = new Date(
      Date.now() - 24 * 60 * 60 * 1_000,
    ).toISOString();

    const first = await repository.beginAutomaticSync(
      accessSubject,
      robinhood.id,
      syncedAfter,
    );
    expect(first).toMatchObject({ created: true });
    await expect(
      repository.beginAutomaticSync(accessSubject, robinhood.id, syncedAfter),
    ).resolves.toBeNull();

    await repository.failSync(accessSubject, first!.id, "provider_unavailable");
    await expect(
      repository.beginAutomaticSync(accessSubject, robinhood.id, syncedAfter),
    ).resolves.toBeNull();

    const afterCooldown = await repository.beginAutomaticSync(
      accessSubject,
      robinhood.id,
      new Date(Date.now() + 1_000).toISOString(),
    );
    expect(afterCooldown).toMatchObject({ created: true });
    expect(
      sqlite
        .prepare(`SELECT cursor FROM connector_sync_runs WHERE id = ?`)
        .get(afterCooldown!.id),
    ).toEqual({ cursor: "investment-holdings-auto-v1" });
  });

  it("lists a bounded daily batch from more than 120 due investment connections", async () => {
    const connections = await Promise.all(
      Array.from({ length: 130 }, (_, index) => {
        const sequence = index + 1;
        return repository.upsertConnection(
          accessSubject,
          `connector-secrets/synthetic-scale-${sequence}.enc`,
          sequence.toString(16).padStart(64, "0"),
          `ins_synthetic_${sequence}`,
          `Synthetic brokerage ${sequence}`,
        );
      }),
    );
    const syncedAfter = "2026-08-27T13:00:00.000Z";

    const firstBatch = await repository.listDueAutomaticSyncConnectionIds(
      syncedAfter,
      100,
    );
    expect(firstBatch).toHaveLength(100);
    expect(new Set(firstBatch).size).toBe(100);
    expect(connections.map((connection) => connection.id)).toEqual(
      expect.arrayContaining([...firstBatch]),
    );

    await Promise.all(
      firstBatch.map((connectionId) =>
        repository.beginAutomaticSync(accessSubject, connectionId, syncedAfter),
      ),
    );
    const secondBatch = await repository.listDueAutomaticSyncConnectionIds(
      syncedAfter,
      100,
    );
    expect(secondBatch).toHaveLength(30);
    expect(secondBatch).toEqual(
      expect.arrayContaining(
        connections
          .map((connection) => connection.id)
          .filter((connectionId) => !firstBatch.includes(connectionId)),
      ),
    );

    const queryPlan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN ${__investmentConnectionsTest.dueAutomaticInvestmentConnectionsSql}`,
      )
      .all(syncedAfter, 100) as { detail: string }[];
    const details = queryPlan.map((row) => row.detail).join("\n");
    expect(details).toContain(
      "connector_sync_investment_connections_connection_created_idx",
    );
    expect(details).not.toMatch(/SCAN (later_link|later_state)/u);
  });

  it("resolves only an active scheduled investment connection owner", async () => {
    const fidelity = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity.enc",
      fidelityItemKey,
      "ins_fidelity",
      "Fidelity",
    );

    await expect(
      repository.findAutomaticSyncAccessSubject(fidelity.id),
    ).resolves.toBe(accessSubject);
    await repository.setConnectionPaused(accessSubject, fidelity.id, true);
    await expect(
      repository.findAutomaticSyncAccessSubject(fidelity.id),
    ).resolves.toBeNull();
  });

  it("does not claim an automatic sync when a connection pauses before the atomic write", async () => {
    const robinhood = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood.enc",
      robinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );
    database.beforeNextBatch(() => {
      sqlite
        .prepare(
          `UPDATE connector_accounts
           SET status = 'paused'
           WHERE id = ?`,
        )
        .run(robinhood.connectorAccountId);
    });

    await expect(
      repository.beginAutomaticSync(
        accessSubject,
        robinhood.id,
        new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
      ),
    ).resolves.toBeNull();
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM connector_sync_runs
           WHERE connector_account_id = ?`,
        )
        .get(robinhood.connectorAccountId),
    ).toEqual({ count: 0 });
  });

  it("pauses and resumes one connection through append-only lifecycle state", async () => {
    const fidelity = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity.enc",
      fidelityItemKey,
      "ins_fidelity",
      "Fidelity",
    );
    const run = await repository.beginSync(accessSubject, fidelity.id);
    await expect(
      repository.setConnectionPaused(accessSubject, fidelity.id, true),
    ).rejects.toThrow("in progress");
    await repository.completeSync(accessSubject, run.id, {
      discoveredCount: 0,
      proposedCount: 0,
      importId: null,
    });

    await repository.setConnectionPaused(accessSubject, fidelity.id, true);
    await expect(
      repository.getConnectionStatus(accessSubject, fidelity.id),
    ).resolves.toMatchObject({
      connectionId: fidelity.id,
      status: "paused",
      automaticUpdatesEnabled: false,
      lastSyncedAt: expect.any(String),
    });
    await expect(
      repository.getConnection(accessSubject, fidelity.id),
    ).resolves.toBeNull();
    await expect(
      repository.getConnection(accessSubject, fidelity.id, true),
    ).resolves.toMatchObject({ id: fidelity.id });
    await expect(
      repository.beginSync(accessSubject, fidelity.id),
    ).rejects.toThrow("not active");
    await expect(
      repository.claimPlaidWebhookDelivery({
        providerAccountKey: fidelityItemKey,
        signatureSha256: "c".repeat(64),
        bodySha256: "d".repeat(64),
        issuedAt: "2026-08-14T12:00:00.000Z",
        receivedAt: "2026-08-14T12:00:01.000Z",
      }),
    ).resolves.toEqual({ status: "unknown" });

    await repository.setConnectionPaused(accessSubject, fidelity.id, true);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM investment_connection_versions
           WHERE connection_id = ?`,
        )
        .get(fidelity.id),
    ).toEqual({ count: 2 });

    await repository.setConnectionPaused(accessSubject, fidelity.id, false);
    await expect(
      repository.getConnectionStatus(accessSubject, fidelity.id),
    ).resolves.toMatchObject({
      connectionId: fidelity.id,
      status: "ready",
      automaticUpdatesEnabled: true,
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM investment_connection_versions
           WHERE connection_id = ?`,
        )
        .get(fidelity.id),
    ).toEqual({ count: 3 });
  });

  it("stages a non-Robinhood Item and links its review evidence to one run", async () => {
    const robinhood = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood.enc",
      robinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );
    const fidelity = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity.enc",
      fidelityItemKey,
      "ins_fidelity",
      "Fidelity",
    );
    const run = await repository.beginSync(accessSubject, fidelity.id);
    const holdingRepository = new D1HoldingImportRepository(
      database as unknown as D1Database,
    );
    const staged = await holdingRepository.stagePlaidInvestmentsHoldingImport(
      accessSubject,
      {
        objectKey: "holding-imports/synthetic-fidelity.json",
        sha256: "8".repeat(64),
        byteSize: 1_024,
        normalizedFingerprint: "9".repeat(64),
        effectiveDate: "2026-08-08",
        retrievedAt: "2026-08-10T12:00:00.000Z",
        rows: [
          {
            rowNumber: 1,
            naturalKeySha256: "7".repeat(64),
            securityName: "Synthetic Public Company",
            ticker: "SYN",
            securityType: "equity",
            accountLabel: "Fidelity brokerage",
            quantityMicros: 1_500_000,
            costBasisMinor: 10_000,
            marketValueMinor: 12_000,
            observedOn: "2026-08-08",
            currency: "USD",
            issues: [],
          },
        ],
        canonicalScope: {
          connection: { mode: "existing", connectionId: fidelity.id },
          containers: [
            {
              protectedAccountKey: "6".repeat(64),
              displayLabel: "Fidelity brokerage",
              containerKind: "brokerage",
              taxTreatment: "taxable",
              completeness: "complete",
            },
          ],
          rows: [
            {
              sourceRowNumber: 1,
              protectedAccountKey: "6".repeat(64),
              protectedPositionKey: "7".repeat(64),
            },
          ],
        },
      },
    );
    const adjudication =
      await holdingRepository.autoAdjudicatePlaidInvestmentsHoldingImport(
        accessSubject,
        staged.preview.id,
      );
    const wrongRun = await repository.beginSync(accessSubject, robinhood.id);
    await expect(
      repository.completeSync(accessSubject, wrongRun.id, {
        discoveredCount: 1,
        proposedCount: 1,
        importId: staged.preview.id,
      }),
    ).rejects.toThrow("connector sync import household mismatch");
    await repository.failSync(accessSubject, wrongRun.id, "unexpected_failure");
    await repository.completeSync(accessSubject, run.id, {
      discoveredCount: 1,
      proposedCount: 1,
      importId: staged.preview.id,
      adjudication: {
        policyVersion: adjudication.policyVersion,
        autoAppliedCount: adjudication.autoAppliedCount,
        quarantinedCount: adjudication.quarantinedCount,
        preservedPositionCount: adjudication.preservedPositionCount,
        baselineRefreshStatus: "not_needed",
        portfolioBaselineId: null,
      },
    });

    expect(staged.preview.provider).toBe("plaid_investments");
    await expect(
      repository.getConnectionStatus(accessSubject, fidelity.id),
    ).resolves.toMatchObject({
      status: "ready",
      latestRunStatus: "succeeded",
      latestImportId: null,
      latestAdjudication: {
        importId: staged.preview.id,
        policyVersion: "plaid-investments-holdings-auto-v3",
        autoAppliedCount: 1,
        quarantinedCount: 0,
      },
    });
    expect(
      sqlite
        .prepare(
          `SELECT scope.connection_id, import.provider
           FROM connector_sync_imports link
           JOIN connector_sync_investment_connections scope
             ON scope.sync_run_id = link.sync_run_id
           JOIN holding_imports import ON import.id = link.holding_import_id
           WHERE link.sync_run_id = ?`,
        )
        .get(run.id),
    ).toEqual({
      connection_id: fidelity.id,
      provider: "plaid_investments",
    });
  });

  it("proves Fidelity account lineage, shared exposure, and baseline behavior end to end", async () => {
    const robinhood = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood.enc",
      robinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );
    const fidelity = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity.enc",
      fidelityItemKey,
      "ins_fidelity",
      "Fidelity",
    );
    const secondFidelity = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity-second.enc",
      secondFidelityItemKey,
      "ins_fidelity",
      "Fidelity",
    );
    const holdingImports = new D1HoldingImportRepository(
      database as unknown as D1Database,
    );
    const positionView = new D1InvestmentPositionViewRepository(
      database as unknown as D1Database,
    );
    const exposureView = new D1InvestmentExposureViewRepository(
      database as unknown as D1Database,
    );
    const baselines = new D1PortfolioBaselineRepository(
      database as unknown as D1Database,
    );
    const robinhoodAccount = {
      accountKey: "1".repeat(64),
      positionKey: "2".repeat(64),
      label: "Robinhood brokerage",
      kind: "brokerage" as const,
      taxTreatment: "taxable" as const,
      quantityMicros: 1_000_000,
      marketValueMinor: 100_000,
    };
    const fidelityBrokerage = {
      accountKey: "3".repeat(64),
      positionKey: "4".repeat(64),
      label: "Fidelity brokerage",
      kind: "brokerage" as const,
      taxTreatment: "taxable" as const,
      quantityMicros: 2_000_000,
      marketValueMinor: 200_000,
    };
    const fidelityIra = {
      accountKey: "5".repeat(64),
      positionKey: "6".repeat(64),
      label: "Fidelity Roth IRA",
      kind: "ira" as const,
      taxTreatment: "tax_exempt" as const,
      quantityMicros: 3_000_000,
      marketValueMinor: 300_000,
    };
    const robinhoodInput = sameSecurityInput({
      connectionId: robinhood.id,
      fingerprintCharacter: "7",
      institutionLabel: "Robinhood",
      accounts: [robinhoodAccount],
    });
    const fidelityInput = sameSecurityInput({
      connectionId: fidelity.id,
      fingerprintCharacter: "8",
      institutionLabel: "Fidelity",
      accounts: [fidelityBrokerage, fidelityIra],
    });

    for (const importInput of [robinhoodInput, fidelityInput]) {
      const staged = await holdingImports.stagePlaidInvestmentsHoldingImport(
        accessSubject,
        importInput,
      );
      await expect(
        holdingImports.autoAdjudicatePlaidInvestmentsHoldingImport(
          accessSubject,
          staged.preview.id,
        ),
      ).resolves.toMatchObject({
        autoAppliedCount: importInput.rows.length,
        quarantinedCount: 0,
        preservedPositionCount: 0,
      });
    }

    const initialPositions = await positionView.list(
      accessSubject,
      "2026-08-16T12:00:00.000Z",
    );
    expect(
      initialPositions.connections.map((connection) => connection.id),
    ).toEqual(expect.arrayContaining([fidelity.id, secondFidelity.id]));
    const provingPositions = initialPositions.connections
      .filter((connection) =>
        [robinhood.id, fidelity.id].includes(connection.id),
      )
      .flatMap((connection) =>
        connection.containers.flatMap((container) => container.positions),
      );
    expect(provingPositions).toHaveLength(3);
    expect(
      initialPositions.connections
        .find((connection) => connection.id === fidelity.id)
        ?.containers.map((container) => ({
          kind: container.kind,
          count: container.positions.length,
        })),
    ).toEqual([
      { kind: "brokerage", count: 1 },
      { kind: "ira", count: 1 },
    ]);
    const positionIds = provingPositions.map((position) => position.id).sort();
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_snapshots snapshot
           JOIN holding_positions position ON position.id = snapshot.position_id
           WHERE position.id IN (?, ?, ?)`,
        )
        .get(...positionIds),
    ).toEqual({ count: 3 });

    const initialExposures = await exposureView.list(
      accessSubject,
      "2026-08-16T12:00:00.000Z",
    );
    const sharedExposure = initialExposures.exposures.find(
      (group) =>
        group.contributions.filter((contribution) =>
          positionIds.includes(contribution.positionId),
        ).length === 3,
    );
    expect(sharedExposure).toMatchObject({
      exposure: {
        exposureKind: "public_instrument",
        resolutionMethod: "strong_identifier",
      },
      totals: [
        {
          currency: "USD",
          allocatedValueMinor: 600_000,
          knownValuePositionCount: 3,
          unknownValuePositionCount: 0,
        },
      ],
    });

    const initialBaseline = await baselines.getState(accessSubject);
    expect(initialBaseline).toMatchObject({
      status: "ready",
      summary: {
        positionCount: 3,
        publicMarketValueMinor: 600_000,
      },
      hasSourceChanges: true,
      canConfirm: true,
    });
    if (
      initialBaseline.sourceRevision === null ||
      initialBaseline.baseForecastSnapshotId === null ||
      initialBaseline.baseForecastSnapshotVersion === null
    ) {
      throw new Error("Expected a confirmable Fidelity proving baseline.");
    }
    await baselines.confirm(accessSubject, {
      sourceRevision: initialBaseline.sourceRevision,
      baseForecastSnapshotId: initialBaseline.baseForecastSnapshotId,
      baseForecastSnapshotVersion: initialBaseline.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor: 0,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Accepted the synthetic multi-institution proof.",
    });

    const repeated = await holdingImports.stagePlaidInvestmentsHoldingImport(
      accessSubject,
      fidelityInput,
    );
    expect(repeated.created).toBe(false);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_snapshots snapshot
           JOIN holding_positions position ON position.id = snapshot.position_id
           WHERE position.id IN (?, ?, ?)`,
        )
        .get(...positionIds),
    ).toEqual({ count: 3 });

    const changedInput = sameSecurityInput({
      connectionId: fidelity.id,
      fingerprintCharacter: "9",
      institutionLabel: "Fidelity",
      accounts: [
        {
          ...fidelityBrokerage,
          quantityMicros: 2_500_000,
          marketValueMinor: 250_000,
        },
        fidelityIra,
      ],
    });
    changedInput.effectiveDate = "2026-08-16";
    changedInput.retrievedAt = "2026-08-16T12:00:00.000Z";
    changedInput.rows.forEach((row) => {
      row.observedOn = "2026-08-16";
    });
    const changed = await holdingImports.stagePlaidInvestmentsHoldingImport(
      accessSubject,
      changedInput,
    );
    await expect(
      holdingImports.autoAdjudicatePlaidInvestmentsHoldingImport(
        accessSubject,
        changed.preview.id,
      ),
    ).resolves.toMatchObject({
      autoAppliedCount: 2,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_snapshots snapshot
           JOIN holding_positions position ON position.id = snapshot.position_id
           WHERE position.id IN (?, ?, ?)`,
        )
        .get(...positionIds),
    ).toEqual({ count: 5 });
    const changedBaseline = await baselines.getState(accessSubject);
    expect(changedBaseline).toMatchObject({
      status: "ready",
      summary: {
        positionCount: 3,
        publicMarketValueMinor: 650_000,
      },
      hasSourceChanges: true,
    });
    if (
      changedBaseline.sourceRevision === null ||
      changedBaseline.baseForecastSnapshotId === null ||
      changedBaseline.baseForecastSnapshotVersion === null
    ) {
      throw new Error("Expected a revised Fidelity proving baseline.");
    }
    await baselines.confirm(accessSubject, {
      sourceRevision: changedBaseline.sourceRevision,
      baseForecastSnapshotId: changedBaseline.baseForecastSnapshotId,
      baseForecastSnapshotVersion: changedBaseline.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor: 0,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Accepted the revised synthetic Fidelity observation.",
    });

    const partialInput = sameSecurityInput({
      connectionId: fidelity.id,
      fingerprintCharacter: "a",
      institutionLabel: "Fidelity",
      accounts: [fidelityIra],
    });
    partialInput.sha256 = "ab".repeat(32);
    partialInput.normalizedFingerprint = "ac".repeat(32);
    partialInput.effectiveDate = "2026-08-16";
    partialInput.retrievedAt = "2026-08-16T12:30:00.000Z";
    partialInput.rows[0]!.observedOn = "2026-08-16";
    partialInput.canonicalScope.containers = [
      {
        protectedAccountKey: fidelityBrokerage.accountKey,
        displayLabel: fidelityBrokerage.label,
        containerKind: fidelityBrokerage.kind,
        taxTreatment: fidelityBrokerage.taxTreatment,
        completeness: "partial",
      },
      {
        ...partialInput.canonicalScope.containers[0]!,
        completeness: "partial",
      },
    ];
    const partial = await holdingImports.stagePlaidInvestmentsHoldingImport(
      accessSubject,
      partialInput,
    );
    await expect(
      holdingImports.autoAdjudicatePlaidInvestmentsHoldingImport(
        accessSubject,
        partial.preview.id,
      ),
    ).resolves.toMatchObject({
      autoAppliedCount: 0,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_import_quarantines
           WHERE import_id = ? AND reason_code = 'position_not_reported'`,
        )
        .get(partial.preview.id),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM holding_position_snapshots snapshot
           JOIN holding_positions position ON position.id = snapshot.position_id
           WHERE position.id IN (?, ?, ?)`,
        )
        .get(...positionIds),
    ).toEqual({ count: 5 });
    await expect(baselines.getState(accessSubject)).resolves.toMatchObject({
      status: "current",
      summary: {
        positionCount: 3,
        publicMarketValueMinor: 650_000,
      },
    });

    const reconnected = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity-reconnected.enc",
      fidelityItemKey,
      "ins_fidelity",
      "Fidelity Investments",
    );
    expect(reconnected).toMatchObject({
      id: fidelity.id,
      previousSecretReference: "connector-secrets/synthetic-fidelity.enc",
    });
    const reconnectedPositions = await positionView.list(
      accessSubject,
      "2026-08-18T12:00:00.000Z",
    );
    expect(
      reconnectedPositions.connections
        .find((connection) => connection.id === fidelity.id)
        ?.containers.flatMap((container) => container.positions)
        .map((position) => position.id)
        .sort(),
    ).toEqual(
      initialPositions.connections
        .find((connection) => connection.id === fidelity.id)
        ?.containers.flatMap((container) => container.positions)
        .map((position) => position.id)
        .sort(),
    );

    const webhook = await repository.claimPlaidWebhookDelivery({
      providerAccountKey: fidelityItemKey,
      signatureSha256: "b".repeat(64),
      bodySha256: "c".repeat(64),
      issuedAt: "2026-08-18T12:00:00.000Z",
      receivedAt: "2026-08-18T12:00:01.000Z",
    });
    expect(webhook.status).toBe("claimed");

    await repository.setConnectionPaused(accessSubject, fidelity.id, true);
    await expect(
      repository.beginSync(accessSubject, fidelity.id),
    ).rejects.toThrow("not active");
    await expect(baselines.getState(accessSubject)).resolves.toMatchObject({
      status: "current",
      summary: {
        positionCount: 3,
        publicMarketValueMinor: 650_000,
      },
    });
    expect(
      (
        await positionView.list(accessSubject, "2026-08-18T12:00:00.000Z")
      ).connections.find((connection) => connection.id === fidelity.id),
    ).toMatchObject({ lifecycleState: "paused" });

    await repository.disconnectConnection(accessSubject, fidelity.id);
    await expect(baselines.getState(accessSubject)).resolves.toMatchObject({
      status: "current",
      summary: {
        positionCount: 3,
        publicMarketValueMinor: 650_000,
      },
    });
    expect(
      (
        await positionView.list(accessSubject, "2026-08-18T12:00:00.000Z")
      ).connections.find((connection) => connection.id === fidelity.id),
    ).toMatchObject({
      lifecycleState: "disconnected",
      containers: [
        expect.objectContaining({ positions: [expect.any(Object)] }),
        expect.objectContaining({ positions: [expect.any(Object)] }),
      ],
    });
    expect(
      sqlite
        .prepare(
          `SELECT credential_reference
           FROM investment_connection_versions
           WHERE connection_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM investment_connection_versions later
               WHERE later.supersedes_version_id =
                     investment_connection_versions.id
             )`,
        )
        .get(fidelity.id),
    ).toEqual({ credential_reference: null });
  });

  it("disconnects and routes webhooks by exact connection", async () => {
    const robinhood = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood.enc",
      robinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );
    const fidelity = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-fidelity.enc",
      fidelityItemKey,
      "ins_fidelity",
      "Fidelity",
    );

    const claim = await repository.claimPlaidWebhookDelivery({
      providerAccountKey: fidelityItemKey,
      signatureSha256: "c".repeat(64),
      bodySha256: "d".repeat(64),
      issuedAt: "2026-08-14T12:00:00.000Z",
      receivedAt: "2026-08-14T12:00:01.000Z",
    });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") {
      throw new Error("Expected a claimed webhook delivery.");
    }
    await expect(
      repository.getPlaidWebhookDelivery(claim.deliveryId),
    ).resolves.toEqual({
      id: claim.deliveryId,
      accessSubject,
      connectionId: fidelity.id,
      status: "received",
    });

    await repository.disconnectConnection(accessSubject, robinhood.id);
    await expect(
      repository.getConnection(accessSubject, robinhood.id),
    ).resolves.toBeNull();
    await expect(
      repository.getConnection(accessSubject, fidelity.id),
    ).resolves.toMatchObject({ id: fidelity.id });
    await expect(
      repository.beginSync(accessSubject, robinhood.id),
    ).rejects.toThrow("not active");
    await expect(
      repository.getConnectionStatus(accessSubject, robinhood.id),
    ).resolves.toMatchObject({ status: "disconnected" });
    await expect(
      repository.getConnectionStatus(accessSubject, fidelity.id),
    ).resolves.toMatchObject({ status: "ready" });
  });
});
