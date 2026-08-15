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

  it("enables automatic updates on the next check for a migrated connection", async () => {
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
      status: "ready",
      automaticUpdatesEnabled: false,
    });
    await expect(
      repository.getConnection("synthetic-access-subject"),
    ).resolves.toMatchObject({ providerAccountKey: null });

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
  });
});
