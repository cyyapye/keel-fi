import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { D1AngelListMacAgentRepository } from "./angellist-mac-agent";
import { D1ProviderBrowserSessionRepository } from "./provider-browser-sessions";
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

let database: DatabaseSync | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("provider browser session repository", () => {
  it("consumes one provider-scoped HTTPS session and retains review boundaries", async () => {
    database = createTestDatabase();
    const d1 = new TestD1Database(database) as unknown as D1Database;
    const now = new Date("2026-08-26T12:00:00.000Z");
    await new D1AngelListMacAgentRepository(d1, () => now).register(
      "synthetic-access-subject",
    );
    const repository = new D1ProviderBrowserSessionRepository(d1, () => now);

    const requested = await repository.create(
      "synthetic-access-subject",
      "angellist",
    );
    expect(requested).toMatchObject({
      provider: "angellist",
      status: "requested",
      expiresAt: "2026-08-26T12:15:00.000Z",
    });
    await expect(
      repository.create("synthetic-access-subject", "angellist"),
    ).resolves.toEqual(requested);

    const lease = await repository.lease(
      "synthetic-access-subject",
      "angellist",
    );
    const leaseToken = lease.session?.leaseToken ?? "";
    await expect(
      repository.ready("synthetic-access-subject", "angellist", requested.id, {
        leaseToken,
        liveUrl: `https://synthetic-session.trycloudflare.com/${"c".repeat(43)}.html`,
      }),
    ).resolves.toMatchObject({ status: "ready" });

    await expect(
      repository.consume("synthetic-access-subject", requested.id),
    ).resolves.toBe(
      `https://synthetic-session.trycloudflare.com/${"c".repeat(43)}.html`,
    );
    expect(
      database
        .prepare(
          `SELECT status, live_url
           FROM provider_browser_sessions
           WHERE id = ?`,
        )
        .get(requested.id),
    ).toEqual({ status: "opened", live_url: null });
    await expect(
      repository.consume("synthetic-access-subject", requested.id),
    ).rejects.toMatchObject({ code: "session_not_ready" });
    await expect(
      repository.complete(
        "synthetic-access-subject",
        "angellist",
        requested.id,
        { leaseToken },
      ),
    ).resolves.toMatchObject({
      provider: "angellist",
      status: "connected",
      openedAt: now.toISOString(),
      connectedAt: now.toISOString(),
    });

    expect(
      database
        .prepare(
          `SELECT live_url, lease_token_sha256
           FROM provider_browser_sessions
           WHERE id = ?`,
        )
        .get(requested.id),
    ).toEqual({ live_url: null, lease_token_sha256: null });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM holding_positions").get(),
    ).toEqual({ count: 0 });
  });

  it("keeps providers separate and destroys expired stream state", async () => {
    database = createTestDatabase();
    const d1 = new TestD1Database(database) as unknown as D1Database;
    let now = new Date("2026-08-26T12:00:00.000Z");
    const providerAgents = new D1ProviderPortfolioAgentRepository(
      d1,
      () => now,
    );
    await providerAgents.register("synthetic-access-subject", "tokenfolio");
    await providerAgents.register("synthetic-access-subject", "sydecar");
    const repository = new D1ProviderBrowserSessionRepository(d1, () => now);

    const [tokenfolio, sydecar] = await Promise.all([
      repository.create("synthetic-access-subject", "tokenfolio"),
      repository.create("synthetic-access-subject", "sydecar"),
    ]);
    expect(tokenfolio.id).not.toBe(sydecar.id);
    const lease = await repository.lease(
      "synthetic-access-subject",
      "tokenfolio",
    );
    await repository.ready(
      "synthetic-access-subject",
      "tokenfolio",
      tokenfolio.id,
      {
        leaseToken: lease.session?.leaseToken ?? "",
        liveUrl: `https://synthetic-tokenfolio.trycloudflare.com/${"d".repeat(43)}.html`,
      },
    );

    now = new Date("2026-08-26T12:16:00.000Z");
    await expect(
      repository.get("synthetic-access-subject", tokenfolio.id),
    ).resolves.toMatchObject({ status: "expired" });
    await expect(
      repository.get("synthetic-access-subject", sydecar.id),
    ).resolves.toMatchObject({ status: "expired" });
    expect(
      database
        .prepare(
          `SELECT live_url, lease_token_sha256
           FROM provider_browser_sessions
           WHERE id = ?`,
        )
        .get(tokenfolio.id),
    ).toEqual({ live_url: null, lease_token_sha256: null });
  });
});
