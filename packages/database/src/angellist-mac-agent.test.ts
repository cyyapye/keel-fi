import { resolve } from "node:path";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteFixture } from "../../../scripts/test-support/sqlite-fixture";

import { D1AngelListMacAgentRepository } from "./angellist-mac-agent";
import type { AngelListMacAgentRepositoryError } from "./angellist-mac-agent";

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
  "packages/database/migrations/0025_retired_asset_lots.sql",
  "packages/database/migrations/0041_reported_position_economics.sql",
  "packages/database/migrations/0046_reviewed_legal_entity_inventory.sql",
  "packages/database/migrations/0033_provider_portfolio_agents.sql",
  "packages/database/migrations/0047_provider_legal_document_evidence.sql",
  "packages/database/migrations/0048_private_document_access.sql",
  "packages/database/migrations/0049_legal_name_resolutions.sql",
  "packages/database/migrations/0050_agreement_rechecks.sql",
  "packages/database/migrations/0051_legal_structure_review_guard.sql",
  "packages/database/migrations/0052_reviewed_structure_entity_type.sql",
  "packages/database/migrations/0053_connected_investment_reviews.sql",
  "packages/database/seed/synthetic.sql",
] as const;

class TestD1Statement {
  private bindings: SQLInputValue[] = [];

  public constructor(private readonly statement: StatementSync) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    this.bindings = values;
    return this;
  }

  public first<T>(columnName?: string): Promise<T | null> {
    const row = this.statement.get(...this.bindings);
    if (row === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      (columnName === undefined ? row : row[columnName]) as T,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({
      results: this.statement.all(...this.bindings) as unknown as T[],
    });
  }

  public execute(): { success: true } {
    this.statement.run(...this.bindings);
    return { success: true };
  }
}

class TestD1Database {
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(query: string): TestD1Statement {
    return new TestD1Statement(this.database.prepare(query));
  }

  public batch(
    statements: readonly TestD1Statement[],
  ): Promise<{ success: true }[]> {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.database.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createTestDatabase(): DatabaseSync {
  return createSqliteFixture(
    migrationFiles.map((file) => resolve(process.cwd(), file)),
  );
}

function seedPendingImport(
  database: DatabaseSync,
  provider = "angellist",
): void {
  database.exec(`
    INSERT INTO source_documents (
      id, household_id, object_key, file_name, content_type, byte_size, sha256,
      effective_date, retrieved_at, source_label, review_status, created_at
    ) VALUES (
      'doc_mac_agent_test', 'hh_demo', 'holding-imports/synthetic.csv',
      'angellist-investments.csv', 'text/csv', 100,
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      '2026-08-09', '2026-08-09T12:00:00.000Z', 'AngelList export',
      'pending_review', '2026-08-09T12:00:00.000Z'
    );
  `);
  database
    .prepare(
      `INSERT INTO holding_imports (
      id, household_id, source_document_id, provider, parser_schema, row_count,
      created_by, created_at
      ) VALUES (
      'import_mac_agent_test', 'hh_demo', 'doc_mac_agent_test', ?,
      'angellist-investments-v1', 1, 'usr_demo',
      '2026-08-09T12:00:00.000Z'
      )`,
    )
    .run(provider);
}

let database: DatabaseSync | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("AngelList Mac agent repository", () => {
  it("queues, leases, and completes a review-gated import", async () => {
    database = createTestDatabase();
    const now = new Date("2026-08-09T12:00:00.000Z");
    const repository = new D1AngelListMacAgentRepository(
      new TestD1Database(database) as unknown as D1Database,
      () => now,
    );

    await expect(
      repository.getOverview("synthetic-access-subject"),
    ).resolves.toMatchObject({ status: "setup_required" });
    await expect(
      repository.register("synthetic-access-subject"),
    ).resolves.toMatchObject({
      status: "ready",
      interval: "weekly",
      lastSeenAt: now.toISOString(),
    });

    const requested = await repository.requestRun("synthetic-access-subject");
    expect(requested).toMatchObject({ status: "queued" });
    const lease = await repository.lease("synthetic-access-subject");
    expect(lease.run).toMatchObject({ id: requested.runId });
    expect(lease.run?.leaseToken).toHaveLength(43);

    seedPendingImport(database);
    const completed = await repository.complete(
      "synthetic-access-subject",
      requested.runId,
      lease.run?.leaseToken ?? "",
      "import_mac_agent_test",
    );
    expect(completed).toMatchObject({
      status: "ready",
      runStatus: null,
      latestImportId: "import_mac_agent_test",
      lastCompletedAt: now.toISOString(),
      errorCode: null,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM holding_positions").get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT review_status FROM source_documents WHERE id = 'doc_mac_agent_test'",
        )
        .get(),
    ).toEqual({ review_status: "pending_review" });
  });

  it("allows a daily-check grace period before reporting the Mac overdue", async () => {
    database = createTestDatabase();
    let now = new Date("2026-08-09T12:00:00.000Z");
    const repository = new D1AngelListMacAgentRepository(
      new TestD1Database(database) as unknown as D1Database,
      () => now,
    );

    await repository.register("synthetic-access-subject");
    now = new Date("2026-08-10T18:00:00.000Z");
    await expect(
      repository.getOverview("synthetic-access-subject"),
    ).resolves.toMatchObject({ status: "ready" });

    now = new Date("2026-08-11T01:00:00.001Z");
    await expect(
      repository.getOverview("synthetic-access-subject"),
    ).resolves.toMatchObject({ status: "offline" });
  });

  it("records a bounded failure and rejects a wrong lease token", async () => {
    database = createTestDatabase();
    const now = new Date("2026-08-09T12:00:00.000Z");
    const repository = new D1AngelListMacAgentRepository(
      new TestD1Database(database) as unknown as D1Database,
      () => now,
    );
    await repository.register("synthetic-access-subject");
    const requested = await repository.requestRun("synthetic-access-subject");
    const lease = await repository.lease("synthetic-access-subject");

    await expect(
      repository.fail(
        "synthetic-access-subject",
        requested.runId,
        "x".repeat(43),
        { errorCode: "angellist_sign_in_required" },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AngelListMacAgentRepositoryError>>({
        code: "lease_invalid",
      }),
    );

    await expect(
      repository.fail(
        "synthetic-access-subject",
        requested.runId,
        lease.run?.leaseToken ?? "",
        { errorCode: "angellist_sign_in_required" },
      ),
    ).resolves.toMatchObject({
      status: "needs_attention",
      errorCode: "angellist_sign_in_required",
      runStatus: null,
    });

    await expect(
      repository.requestRun("synthetic-access-subject"),
    ).resolves.toMatchObject({ status: "queued" });
    await expect(
      repository.getOverview("synthetic-access-subject"),
    ).resolves.toMatchObject({
      status: "running",
      errorCode: "angellist_sign_in_required",
      runStatus: "queued",
    });
  });

  it("rejects completion against a non-AngelList import", async () => {
    database = createTestDatabase();
    const now = new Date("2026-08-09T12:00:00.000Z");
    const repository = new D1AngelListMacAgentRepository(
      new TestD1Database(database) as unknown as D1Database,
      () => now,
    );
    await repository.register("synthetic-access-subject");
    const requested = await repository.requestRun("synthetic-access-subject");
    const lease = await repository.lease("synthetic-access-subject");
    seedPendingImport(database, "another-provider");

    await expect(
      repository.complete(
        "synthetic-access-subject",
        requested.runId,
        lease.run?.leaseToken ?? "",
        "import_mac_agent_test",
      ),
    ).rejects.toThrow("AngelList Mac run import mismatch");
    expect(
      database
        .prepare(
          "SELECT status, import_id FROM angellist_mac_runs WHERE id = ?",
        )
        .get(requested.runId),
    ).toEqual({ status: "leased", import_id: null });
  });

  it("creates a due scheduled run only when the Mac polls", async () => {
    database = createTestDatabase();
    const now = new Date("2026-08-09T12:00:00.000Z");
    const repository = new D1AngelListMacAgentRepository(
      new TestD1Database(database) as unknown as D1Database,
      () => now,
    );
    await repository.register("synthetic-access-subject");
    database.exec(`
      UPDATE angellist_mac_agents
      SET next_run_at = '2026-08-09T11:59:00.000Z';
    `);

    const lease = await repository.lease("synthetic-access-subject");
    expect(lease.run).not.toBeNull();
    expect(
      database
        .prepare(
          `SELECT request_kind, status FROM angellist_mac_runs
           WHERE id = ?`,
        )
        .get(lease.run?.id ?? ""),
    ).toEqual({ request_kind: "schedule", status: "leased" });
  });
});
