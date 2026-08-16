import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { D1HoldingImportRepository } from "./holding-imports";
import { D1PublicHoldingsRepository } from "./public-holdings";

const providerAccountKey = "a".repeat(64);
const replacementProviderAccountKey = "b".repeat(64);

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

describe("Robinhood public-holdings connection state", () => {
  let sqlite: DatabaseSync;
  let database: TestD1Database;
  let repository: D1PublicHoldingsRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    database = new TestD1Database(sqlite);
    repository = new D1PublicHoldingsRepository(
      database as unknown as D1Database,
    );
  });

  afterEach(() => sqlite.close());

  it("fails closed until a migrated connector gains a canonical connection", async () => {
    sqlite
      .prepare(
        `INSERT INTO connector_accounts (
           id, household_id, connector_type, display_label, secret_reference,
           status, last_synced_at, provider_account_key, created_at
         ) VALUES (?, ?, ?, ?, ?, 'active', NULL, NULL, ?)`,
      )
      .run(
        "synthetic-legacy-connection",
        "hh_demo",
        "plaid-investments",
        "Robinhood",
        "connector-secrets/synthetic-legacy.enc",
        "2026-08-01T12:00:00.000Z",
      );

    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      status: "disconnected",
      automaticUpdatesEnabled: false,
    });
    await expect(
      repository.getConnection("synthetic-access-subject"),
    ).resolves.toBeNull();

    await repository.bindProviderAccountKey(
      "synthetic-access-subject",
      "synthetic-legacy-connection",
      providerAccountKey,
    );
    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({ automaticUpdatesEnabled: true });
  });

  it("moves from setup to connected sync and exposes only a pending review", async () => {
    await expect(
      repository.getStatus("synthetic-access-subject", false),
    ).resolves.toMatchObject({
      configured: false,
      status: "setup_required",
      errorCode: "configuration_required",
    });
    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      configured: true,
      status: "disconnected",
    });

    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "connector-secrets/synthetic-one.enc",
      providerAccountKey,
    );
    expect(connection.previousSecretReference).toBeNull();
    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      status: "ready",
      lastSyncedAt: null,
      automaticUpdatesEnabled: true,
    });

    const run = await repository.beginSync("synthetic-access-subject");
    expect(run.created).toBe(true);
    const duplicateRun = await repository.beginSync("synthetic-access-subject");
    expect(duplicateRun).toMatchObject({ id: run.id, created: false });
    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({ status: "syncing", latestRunStatus: "running" });

    const holdingRepository = new D1HoldingImportRepository(
      database as unknown as D1Database,
    );
    const staged = await holdingRepository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      {
        objectKey: "holding-imports/synthetic-robinhood.json",
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
            accountLabel: "Robinhood brokerage",
            quantityMicros: 1_500_000,
            costBasisMinor: 10_000,
            marketValueMinor: 12_000,
            observedOn: "2026-08-08",
            currency: "USD",
            issues: [],
          },
        ],
        canonicalScope: {
          connection: {
            mode: "existing",
            connectionId: connection.investmentConnectionId,
          },
          containers: [
            {
              protectedAccountKey: "6".repeat(64),
              displayLabel: "Robinhood brokerage",
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
      await holdingRepository.autoAdjudicateRobinhoodHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
      );
    await repository.completeSync("synthetic-access-subject", run.id, {
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

    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      status: "ready",
      latestRunStatus: "succeeded",
      latestImportId: null,
      lastSyncedAt: expect.any(String),
      latestAdjudication: {
        importId: staged.preview.id,
        policyVersion: "robinhood-holdings-auto-v2",
        autoAppliedCount: 1,
        quarantinedCount: 0,
        preservedPositionCount: 0,
        baselineRefreshStatus: "not_needed",
      },
    });

    const replacement = await repository.upsertConnection(
      "synthetic-access-subject",
      "connector-secrets/synthetic-two.enc",
      replacementProviderAccountKey,
    );
    expect(replacement.previousSecretReference).toBe(
      "connector-secrets/synthetic-one.enc",
    );
    expect(replacement.investmentConnectionId).not.toBe(
      connection.investmentConnectionId,
    );
    expect(
      sqlite
        .prepare(
          `SELECT lifecycle_state, credential_reference
           FROM investment_connection_versions
           WHERE connection_id = ?
           ORDER BY version DESC
           LIMIT 1`,
        )
        .get(connection.investmentConnectionId),
    ).toEqual({ lifecycle_state: "disconnected", credential_reference: null });
    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      status: "ready",
      lastSyncedAt: null,
      latestImportId: null,
      latestRunStatus: null,
      latestAdjudication: null,
    });
    expect(
      sqlite
        .prepare(
          `SELECT connection_id
           FROM connector_sync_investment_connections
           WHERE sync_run_id = ?`,
        )
        .get(run.id),
    ).toEqual({ connection_id: connection.investmentConnectionId });

    const replacementRun = await repository.beginSync(
      "synthetic-access-subject",
    );
    expect(replacementRun.connection.investmentConnectionId).toBe(
      replacement.investmentConnectionId,
    );
  });

  it("releases only the replaced connection's in-flight sync", async () => {
    const initial = await repository.upsertConnection(
      "synthetic-access-subject",
      "connector-secrets/synthetic-running.enc",
      providerAccountKey,
    );
    const initialRun = await repository.beginSync("synthetic-access-subject");

    const replacement = await repository.upsertConnection(
      "synthetic-access-subject",
      "connector-secrets/synthetic-replacement.enc",
      replacementProviderAccountKey,
    );
    expect(replacement.investmentConnectionId).not.toBe(
      initial.investmentConnectionId,
    );
    expect(
      sqlite
        .prepare(
          `SELECT status, error_code
           FROM connector_sync_runs
           WHERE id = ?`,
        )
        .get(initialRun.id),
    ).toEqual({ status: "failed", error_code: "connection_invalid" });

    const replacementRun = await repository.beginSync(
      "synthetic-access-subject",
    );
    expect(replacementRun).toMatchObject({
      created: true,
      connection: {
        investmentConnectionId: replacement.investmentConnectionId,
      },
    });

    await repository.completeSync("synthetic-access-subject", initialRun.id, {
      discoveredCount: 0,
      proposedCount: 0,
      importId: null,
    });
    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      status: "syncing",
      lastSyncedAt: null,
      latestRunStatus: "running",
    });
  });

  it("reconnects a stable Item through append-only state and disconnects access", async () => {
    const initial = await repository.upsertConnection(
      "synthetic-access-subject",
      "connector-secrets/synthetic-one.enc",
      providerAccountKey,
    );
    const reconnected = await repository.upsertConnection(
      "synthetic-access-subject",
      "connector-secrets/synthetic-two.enc",
      providerAccountKey,
    );

    expect(reconnected.investmentConnectionId).toBe(
      initial.investmentConnectionId,
    );
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM investment_connection_versions
           WHERE connection_id = ?`,
        )
        .get(initial.investmentConnectionId),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM connector_investment_connection_versions
           WHERE connector_account_id = ?`,
        )
        .get(initial.id),
    ).toEqual({ count: 1 });

    await repository.disconnectConnection(
      "synthetic-access-subject",
      initial.id,
    );
    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      status: "disconnected",
      automaticUpdatesEnabled: false,
    });
    await expect(
      repository.getConnection("synthetic-access-subject"),
    ).resolves.toBeNull();
    await expect(
      repository.beginSync("synthetic-access-subject"),
    ).rejects.toThrow("not connected");
    expect(
      sqlite
        .prepare(
          `SELECT lifecycle_state, credential_reference
           FROM investment_connection_versions
           WHERE connection_id = ?
           ORDER BY version DESC
           LIMIT 1`,
        )
        .get(initial.investmentConnectionId),
    ).toEqual({ lifecycle_state: "disconnected", credential_reference: null });

    await expect(
      repository.disconnectConnection("synthetic-access-subject", initial.id),
    ).resolves.toBeUndefined();
  });

  it("records a bounded failure without leaking provider details", async () => {
    await repository.upsertConnection(
      "synthetic-access-subject",
      "connector-secrets/synthetic.enc",
      providerAccountKey,
    );
    const run = await repository.beginSync("synthetic-access-subject");
    await repository.failSync(
      "synthetic-access-subject",
      run.id,
      "provider_unavailable",
    );

    await expect(
      repository.getStatus("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      status: "needs_attention",
      latestRunStatus: "failed",
      errorCode: "provider_unavailable",
    });
  });

  it("claims signed deliveries by opaque account key and advances their lifecycle", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "connector-secrets/synthetic.enc",
      providerAccountKey,
    );
    expect(connection.providerAccountKey).toBe(providerAccountKey);

    const claim = await repository.claimPlaidWebhookDelivery({
      providerAccountKey,
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
      accessSubject: "synthetic-access-subject",
      status: "received",
    });
    await expect(
      repository.markPlaidWebhookDelivery(claim.deliveryId, "queued"),
    ).resolves.toBe(true);
    await expect(
      repository.markPlaidWebhookDelivery(claim.deliveryId, "processing"),
    ).resolves.toBe(true);
    await expect(
      repository.markPlaidWebhookDelivery(claim.deliveryId, "processed"),
    ).resolves.toBe(true);
    await expect(
      repository.markPlaidWebhookDelivery(claim.deliveryId, "processed"),
    ).resolves.toBe(false);
    await expect(
      repository.getPlaidWebhookDelivery(claim.deliveryId),
    ).resolves.toMatchObject({ status: "processed" });

    await expect(
      repository.claimPlaidWebhookDelivery({
        providerAccountKey,
        signatureSha256: "c".repeat(64),
        bodySha256: "d".repeat(64),
        issuedAt: "2026-08-14T12:00:00.000Z",
        receivedAt: "2026-08-14T12:00:02.000Z",
      }),
    ).resolves.toEqual({
      status: "duplicate",
      deliveryId: claim.deliveryId,
    });

    await expect(
      repository.claimPlaidWebhookDelivery({
        providerAccountKey: "e".repeat(64),
        signatureSha256: "f".repeat(64),
        bodySha256: "0".repeat(64),
        issuedAt: "2026-08-14T12:00:00.000Z",
        receivedAt: "2026-08-14T12:00:02.000Z",
      }),
    ).resolves.toEqual({ status: "unknown" });

    await repository.upsertConnection(
      "synthetic-access-subject",
      "connector-secrets/synthetic-reconnected.enc",
      replacementProviderAccountKey,
    );
    await expect(
      repository.getPlaidWebhookDelivery(claim.deliveryId),
    ).resolves.toBeNull();
    await expect(
      repository.claimPlaidWebhookDelivery({
        providerAccountKey,
        signatureSha256: "c".repeat(64),
        bodySha256: "d".repeat(64),
        issuedAt: "2026-08-14T12:00:00.000Z",
        receivedAt: "2026-08-14T12:00:03.000Z",
      }),
    ).resolves.toEqual({ status: "unknown" });
  });
});
