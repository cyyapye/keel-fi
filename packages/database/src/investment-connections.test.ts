import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { D1HoldingImportRepository } from "./holding-imports";
import { D1InvestmentConnectionsRepository } from "./investment-connections";

const accessSubject = "synthetic-access-subject";
const robinhoodItemKey = "a".repeat(64);
const fidelityItemKey = "b".repeat(64);
const secondRobinhoodItemKey = "e".repeat(64);

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
    const secondRobinhood = await repository.upsertConnection(
      accessSubject,
      "connector-secrets/synthetic-robinhood-second.enc",
      secondRobinhoodItemKey,
      "ins_robinhood",
      "Robinhood",
    );

    expect(fidelity.id).not.toBe(robinhood.id);
    expect(fidelity.connectorAccountId).not.toBe(robinhood.connectorAccountId);
    expect(secondRobinhood.id).not.toBe(robinhood.id);
    expect(secondRobinhood.connectorAccountId).not.toBe(
      robinhood.connectorAccountId,
    );
    await expect(
      repository.getState(accessSubject, true),
    ).resolves.toMatchObject({
      configured: true,
      connections: [
        {
          connectionId: robinhood.id,
          institutionKey: "ins_robinhood",
          institutionLabel: "Robinhood",
          status: "ready",
        },
        {
          connectionId: fidelity.id,
          institutionKey: "ins_fidelity",
          institutionLabel: "Fidelity",
          status: "ready",
        },
        {
          connectionId: secondRobinhood.id,
          institutionKey: "ins_robinhood",
          institutionLabel: "Robinhood",
          status: "ready",
        },
      ],
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
