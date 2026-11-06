import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteFixture } from "../../../scripts/test-support/sqlite-fixture";

import { D1AngelListMacAgentRepository } from "./angellist-mac-agent";
import { D1MacAgentCredentialRepository } from "./mac-agent-credentials";
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
    return Promise.resolve(
      row === undefined
        ? null
        : ((columnName === undefined ? row : row[columnName]) as T),
    );
  }

  public execute(): { success: true } {
    this.statement.run(...this.bindings);
    return { success: true };
  }
}

class TestD1Database {
  public failNextBatch = false;
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(query: string): TestD1Statement {
    return new TestD1Statement(this.database.prepare(query));
  }

  public batch(
    statements: readonly TestD1Statement[],
  ): Promise<{ success: true }[]> {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      return Promise.reject(new Error("synthetic D1 write failure"));
    }
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
  const migrationDirectory = resolve(
    process.cwd(),
    "packages/database/migrations",
  );
  return createSqliteFixture([
    ...readdirSync(migrationDirectory)
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort()
      .map((file) => resolve(migrationDirectory, file)),
    resolve(process.cwd(), "packages/database/seed/synthetic.sql"),
  ]);
}

let database: DatabaseSync | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("Mac agent credential repository", () => {
  it("throttles activity writes while checking revocation on every request", async () => {
    database = createTestDatabase();
    let now = new Date("2026-09-01T12:00:00Z");
    const measured = new TestD1Database(database);
    const d1 = measured as unknown as D1Database;
    await new D1AngelListMacAgentRepository(d1, () => now).register(
      "synthetic-access-subject",
    );
    const repository = new D1MacAgentCredentialRepository(d1, () => now);
    const token = await repository.issueToken(
      "synthetic-access-subject",
      "angellist",
    );
    await repository.authenticate("angellist", token);
    const changes = () =>
      Number(database!.prepare("SELECT total_changes() AS count").get()!.count);
    const initial = changes();
    now = new Date("2026-09-01T12:04:59Z");
    await expect(repository.authenticate("angellist", token)).resolves.toBe(
      "synthetic-access-subject",
    );
    expect(changes()).toBe(initial);
    now = new Date("2026-09-01T12:05:00Z");
    await repository.authenticate("angellist", token);
    expect(changes() - initial).toBe(1);
    // Rotating inside the heartbeat interval must still invalidate the old
    // credential as soon as the replacement proves it works.
    now = new Date("2026-09-01T12:05:01Z");
    const replacement = await repository.rotateToken(
      "synthetic-access-subject",
      "angellist",
      token,
    );
    measured.failNextBatch = true;
    await expect(
      repository.authenticate("angellist", replacement),
    ).rejects.toThrow("synthetic D1 write failure");
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM mac_agent_credentials WHERE last_used_at IS NULL AND revoked_at IS NULL",
        )
        .get(),
    ).toEqual({ count: 1 });
    await expect(repository.authenticate("angellist", token)).resolves.toBe(
      "synthetic-access-subject",
    );
    await expect(
      repository.authenticate("angellist", replacement),
    ).resolves.toBe("synthetic-access-subject");
    await expect(
      repository.authenticate("angellist", token),
    ).resolves.toBeNull();
  });

  it("stores only a digest and scopes authentication to one target", async () => {
    database = createTestDatabase();
    const now = new Date("2026-08-21T12:00:00.000Z");
    const d1 = new TestD1Database(database) as unknown as D1Database;
    await new D1AngelListMacAgentRepository(d1, () => now).register(
      "synthetic-access-subject",
    );
    const repository = new D1MacAgentCredentialRepository(d1, () => now);

    const token = await repository.issueToken(
      "synthetic-access-subject",
      "angellist",
    );

    expect(token).toMatch(/^keel_agent_v1_[A-Za-z0-9_-]{43}$/u);
    expect(
      database
        .prepare(
          `SELECT token_sha256, last_used_at, revoked_at
           FROM mac_agent_credentials`,
        )
        .get(),
    ).toMatchObject({
      token_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      last_used_at: null,
      revoked_at: null,
    });
    expect(
      JSON.stringify(
        database.prepare("SELECT * FROM mac_agent_credentials").get(),
      ),
    ).not.toContain(token);
    await expect(repository.authenticate("sydecar", token)).resolves.toBeNull();
    await expect(repository.authenticate("angellist", token)).resolves.toBe(
      "synthetic-access-subject",
    );
    expect(
      database.prepare("SELECT last_used_at FROM mac_agent_credentials").get(),
    ).toEqual({ last_used_at: now.toISOString() });
  });

  it("revokes the previous token when setup is run again", async () => {
    database = createTestDatabase();
    let now = new Date("2026-08-21T12:00:00.000Z");
    const d1 = new TestD1Database(database) as unknown as D1Database;
    await new D1ProviderPortfolioAgentRepository(d1, () => now).register(
      "synthetic-access-subject",
      "tokenfolio",
    );
    const repository = new D1MacAgentCredentialRepository(d1, () => now);
    const first = await repository.issueToken(
      "synthetic-access-subject",
      "tokenfolio",
    );
    now = new Date("2026-08-21T12:05:00.000Z");
    const second = await repository.issueToken(
      "synthetic-access-subject",
      "tokenfolio",
    );

    expect(second).not.toBe(first);
    await expect(
      repository.authenticate("tokenfolio", first),
    ).resolves.toBeNull();
    await expect(repository.authenticate("tokenfolio", second)).resolves.toBe(
      "synthetic-access-subject",
    );
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM mac_agent_credentials
           WHERE target = 'tokenfolio' AND revoked_at IS NULL`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("keeps the current token until its automatically rotated replacement works", async () => {
    database = createTestDatabase();
    let now = new Date("2026-08-26T12:00:00.000Z");
    const d1 = new TestD1Database(database) as unknown as D1Database;
    await new D1AngelListMacAgentRepository(d1, () => now).register(
      "synthetic-access-subject",
    );
    const repository = new D1MacAgentCredentialRepository(d1, () => now);
    const current = await repository.issueToken(
      "synthetic-access-subject",
      "angellist",
    );
    now = new Date("2026-08-26T12:05:00.000Z");
    const replacement = await repository.rotateToken(
      "synthetic-access-subject",
      "angellist",
      current,
    );

    expect(replacement).not.toBe(current);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM mac_agent_credentials
           WHERE target = 'angellist' AND revoked_at IS NULL`,
        )
        .get(),
    ).toEqual({ count: 2 });
    await expect(repository.authenticate("angellist", current)).resolves.toBe(
      "synthetic-access-subject",
    );
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM mac_agent_credentials
           WHERE target = 'angellist' AND revoked_at IS NULL`,
        )
        .get(),
    ).toEqual({ count: 2 });

    now = new Date("2026-08-26T12:06:00.000Z");
    await expect(
      repository.authenticate("angellist", replacement),
    ).resolves.toBe("synthetic-access-subject");
    await expect(
      repository.authenticate("angellist", current),
    ).resolves.toBeNull();
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM mac_agent_credentials
           WHERE target = 'angellist' AND revoked_at IS NULL`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("refuses credentials for an unregistered target", async () => {
    database = createTestDatabase();
    const repository = new D1MacAgentCredentialRepository(
      new TestD1Database(database) as unknown as D1Database,
    );

    await expect(
      repository.issueToken("synthetic-access-subject", "sydecar"),
    ).rejects.toThrow("Mac agent credential target is not registered");
  });
});
