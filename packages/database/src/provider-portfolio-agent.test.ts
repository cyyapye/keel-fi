import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { D1ProviderPortfolioAgentRepository } from "./provider-portfolio-agent";

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
  const database = new DatabaseSync(":memory:");
  const migrationDirectory = resolve(
    process.cwd(),
    "packages/database/migrations",
  );
  readdirSync(migrationDirectory)
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort()
    .forEach((file) => {
      database.exec(readFileSync(resolve(migrationDirectory, file), "utf8"));
    });
  database.exec(
    readFileSync(
      resolve(process.cwd(), "packages/database/seed/synthetic.sql"),
      "utf8",
    ),
  );
  return database;
}

function seedPendingImport(
  database: DatabaseSync,
  provider: "sydecar" | "tokenfolio",
): string {
  const importId = `import_${provider}_agent_test`;
  database
    .prepare(
      `INSERT INTO source_documents (
         id, household_id, object_key, file_name, content_type, byte_size,
         sha256, effective_date, retrieved_at, source_label, review_status,
         created_at
       ) VALUES (?, 'hh_demo', ?, ?, 'text/csv', 100, ?, '2026-08-21',
         '2026-08-21T12:00:00.000Z', ?, 'pending_review',
         '2026-08-21T12:00:00.000Z')`,
    )
    .run(
      `doc_${provider}_agent_test`,
      `holding-imports/${provider}/synthetic.csv`,
      `${provider}-holdings.csv`,
      provider === "tokenfolio" ? "d".repeat(64) : "e".repeat(64),
      `${provider} synthetic capture`,
    );
  database
    .prepare(
      `INSERT INTO holding_imports (
         id, household_id, source_document_id, provider, parser_schema,
         row_count, created_by, created_at
       ) VALUES (?, 'hh_demo', ?, ?, ?, 1, 'usr_demo',
         '2026-08-21T12:00:00.000Z')`,
    )
    .run(
      importId,
      `doc_${provider}_agent_test`,
      provider,
      `${provider}_keel_template_v1`,
    );
  return importId;
}

let database: DatabaseSync | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("provider portfolio Mac agent repository", () => {
  it("keeps provider schedules separate and completes only a review-gated import", async () => {
    database = createTestDatabase();
    const now = new Date("2026-08-21T12:00:00.000Z");
    const repository = new D1ProviderPortfolioAgentRepository(
      new TestD1Database(database) as unknown as D1Database,
      () => now,
    );

    await expect(
      repository.getOverview("synthetic-access-subject", "tokenfolio"),
    ).resolves.toMatchObject({
      provider: "tokenfolio",
      status: "setup_required",
      interval: "daily",
    });
    await repository.register("synthetic-access-subject", "tokenfolio");
    await repository.register("synthetic-access-subject", "sydecar");

    const requested = await repository.requestRun(
      "synthetic-access-subject",
      "tokenfolio",
    );
    const lease = await repository.lease(
      "synthetic-access-subject",
      "tokenfolio",
    );
    const importId = seedPendingImport(database, "tokenfolio");
    await expect(
      repository.complete(
        "synthetic-access-subject",
        "tokenfolio",
        requested.runId,
        lease.run?.leaseToken ?? "",
        importId,
      ),
    ).resolves.toMatchObject({
      provider: "tokenfolio",
      status: "ready",
      latestImportId: importId,
      lastCompletedAt: now.toISOString(),
    });
    await expect(
      repository.getOverview("synthetic-access-subject", "sydecar"),
    ).resolves.toMatchObject({
      provider: "sydecar",
      status: "ready",
      latestImportId: null,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM holding_positions").get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare("SELECT review_status FROM source_documents WHERE id = ?")
        .get("doc_tokenfolio_agent_test"),
    ).toEqual({ review_status: "pending_review" });
  });

  it("rejects a cross-provider completion and records bounded failures", async () => {
    database = createTestDatabase();
    const now = new Date("2026-08-21T12:00:00.000Z");
    const repository = new D1ProviderPortfolioAgentRepository(
      new TestD1Database(database) as unknown as D1Database,
      () => now,
    );
    await repository.register("synthetic-access-subject", "sydecar");
    const requested = await repository.requestRun(
      "synthetic-access-subject",
      "sydecar",
    );
    const lease = await repository.lease("synthetic-access-subject", "sydecar");
    const wrongImportId = seedPendingImport(database, "tokenfolio");

    await expect(
      repository.complete(
        "synthetic-access-subject",
        "sydecar",
        requested.runId,
        lease.run?.leaseToken ?? "",
        wrongImportId,
      ),
    ).rejects.toThrow("provider portfolio run import mismatch");
    await expect(
      repository.fail(
        "synthetic-access-subject",
        "sydecar",
        requested.runId,
        lease.run?.leaseToken ?? "",
        { errorCode: "incomplete_snapshot" },
      ),
    ).resolves.toMatchObject({
      provider: "sydecar",
      status: "needs_attention",
      errorCode: "incomplete_snapshot",
    });
  });
});
