import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { D1ProviderPortfolioAgentRepository } from "./provider-portfolio-agent";
import { D1ProviderBrowserSessionRepository } from "./provider-browser-sessions";

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

describe("Sydecar session renewal admission", () => {
  async function fixture() {
    database = createTestDatabase();
    const sql = database;
    const d1 = new TestD1Database(sql) as unknown as D1Database;
    const clock = { now: Date.parse("2026-08-21T12:00:00.000Z") };
    const repository = new D1ProviderPortfolioAgentRepository(
      d1,
      () => new Date(clock.now),
    );
    const reconnects = new D1ProviderBrowserSessionRepository(
      d1,
      () => new Date(clock.now),
    );
    await repository.register("synthetic-access-subject", "sydecar");
    await repository.requestRun("synthetic-access-subject", "sydecar");
    const run = (await repository.lease("synthetic-access-subject", "sydecar"))
      .run!;
    await repository.complete(
      "synthetic-access-subject",
      "sydecar",
      run.id,
      run.leaseToken,
      seedPendingImport(sql, "sydecar"),
    );
    return { sql, clock, repository, reconnects };
  }
  const subject = "synthetic-access-subject";
  const hour = 3_600_000;

  it.each(["reported failure", "expired lease"] as const)(
    "bounds renewal attempts across recovery captures after %s",
    async (outcome) => {
      const { clock, repository } = await fixture();
      const start = clock.now + 6 * hour;
      const attemptedHours: number[] = [];
      for (let elapsed = 0; elapsed < 24; elapsed++) {
        clock.now = start + elapsed * hour;
        const { renewal } = await repository.leaseSessionRenewal(subject);
        if (renewal !== null) {
          attemptedHours.push(elapsed);
          if (outcome === "reported failure") {
            await repository.finishSessionRenewal(subject, renewal.leaseToken, {
              errorCode: "unexpected_failure",
            });
          }
        }
        // Recover through the real capture completion path after any five-minute
        // maintenance lease has expired. Repeated captures must not admit an
        // hourly stream of failed browser work by clearing its attempt counter.
        clock.now += 10 * 60_000;
        await repository.requestRun(subject, "sydecar");
        const run = (await repository.lease(subject, "sydecar")).run!;
        await repository.complete(
          subject,
          "sydecar",
          run.id,
          run.leaseToken,
          "import_sydecar_agent_test",
        );
      }
      expect(attemptedHours).toEqual([0, 7, 14, 21]);
    },
  );

  it("does not postpone an earlier renewal after successful manual captures", async () => {
    const { clock, repository } = await fixture();
    const start = clock.now;
    for (const offset of [4 * hour, 5 * hour]) {
      clock.now = start + offset;
      await repository.requestRun(subject, "sydecar");
      const run = (await repository.lease(subject, "sydecar")).run!;
      await repository.complete(
        subject,
        "sydecar",
        run.id,
        run.leaseToken,
        "import_sydecar_agent_test",
      );
    }
    clock.now = start + 6 * hour;
    const lease = await repository.leaseSessionRenewal(subject);
    expect(lease.renewal).not.toBeNull();
    await repository.finishSessionRenewal(
      subject,
      lease.renewal!.leaseToken,
      null,
    );
    clock.now = start + 7 * hour;
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    clock.now = start + 12 * hour;
    expect(
      (await repository.leaseSessionRenewal(subject)).renewal,
    ).not.toBeNull();
  });

  it("starts a new renewal window after a completed fresh reconnect", async () => {
    const { clock, repository, reconnects } = await fixture();
    const start = clock.now;
    clock.now = start + 5 * hour;
    const session = await reconnects.create(subject, "sydecar");
    const leaseToken = (await reconnects.lease(subject, "sydecar")).session!
      .leaseToken;
    await reconnects.ready(subject, "sydecar", session.id, {
      leaseToken,
      liveUrl: `https://synthetic-reconnect.trycloudflare.com/${"c".repeat(43)}.html`,
    });
    await reconnects.consume(subject, session.id);
    await reconnects.complete(subject, "sydecar", session.id, { leaseToken });
    clock.now = start + 6 * hour;
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    clock.now = start + 11 * hour;
    expect(
      (await repository.leaseSessionRenewal(subject)).renewal,
    ).not.toBeNull();
  });

  it("does not write before due, admits one racing caller, and keeps the financial schedule unchanged", async () => {
    const { sql, clock, repository } = await fixture();
    const before = await repository.getOverview(subject, "sydecar");
    clock.now += hour;
    const changes = sql.prepare("SELECT total_changes() AS n").get()!.n;
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    expect(sql.prepare("SELECT total_changes() AS n").get()!.n).toBe(changes);
    clock.now += 5 * hour;
    const races = await Promise.all(
      Array.from({ length: 8 }, () => repository.leaseSessionRenewal(subject)),
    );
    const leases = races.flatMap((result) =>
      result.renewal === null ? [] : [result.renewal],
    );
    expect(leases).toHaveLength(1);
    await repository.finishSessionRenewal(subject, leases[0]!.leaseToken, null);
    const finishedChanges = sql.prepare("SELECT total_changes() AS n").get()!.n;
    await repository.finishSessionRenewal(subject, leases[0]!.leaseToken, null);
    await repository.finishSessionRenewal(subject, leases[0]!.leaseToken, {
      errorCode: "provider_sign_in_required",
    });
    expect(sql.prepare("SELECT total_changes() AS n").get()!.n).toBe(
      finishedChanges,
    );
    const after = await repository.getOverview(subject, "sydecar");
    expect(after.lastCompletedAt).toBe(before.lastCompletedAt);
    expect(after.nextRunAt).toBe(before.nextRunAt);
    expect(after.errorCode).toBeNull();
    expect(
      sql.prepare("SELECT count(*) AS n FROM provider_portfolio_runs").get()!.n,
    ).toBe(1);
  });

  it("excludes captures and interactive reconnects while the renewal owns the browser", async () => {
    const { clock, repository, reconnects } = await fixture();
    clock.now += 6 * hour;
    const renewal = (await repository.leaseSessionRenewal(subject)).renewal!;
    await repository.requestRun(subject, "sydecar");
    await reconnects.create(subject, "sydecar");
    expect((await repository.lease(subject, "sydecar")).run).toBeNull();
    expect((await reconnects.lease(subject, "sydecar")).session).toBeNull();
    await repository.finishSessionRenewal(subject, renewal.leaseToken, null);
    expect((await reconnects.lease(subject, "sydecar")).session).not.toBeNull();
  });

  it("gives already queued captures and reconnects priority over maintenance", async () => {
    const { clock, repository, reconnects } = await fixture();
    clock.now += 6 * hour;
    await repository.requestRun(subject, "sydecar");
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    const run = (await repository.lease(subject, "sydecar")).run!;
    await repository.fail(subject, "sydecar", run.id, run.leaseToken, {
      errorCode: "unexpected_failure",
    });
    await reconnects.create(subject, "sydecar");
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
  });

  it("bounds failures and crash retries, rejects stale completions, and honors off", async () => {
    const { clock, repository } = await fixture();
    clock.now += 6 * hour;
    await repository.configure(subject, "sydecar", { interval: "off" });
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    await repository.configure(subject, "sydecar", { interval: "daily" });
    const first = (await repository.leaseSessionRenewal(subject)).renewal!;
    clock.now += hour;
    const second = (await repository.leaseSessionRenewal(subject)).renewal!;
    await expect(
      repository.finishSessionRenewal(subject, first.leaseToken, null),
    ).rejects.toThrow("lease_invalid");
    await repository.finishSessionRenewal(subject, second.leaseToken, {
      errorCode: "unexpected_failure",
    });
    clock.now += hour;
    const third = (await repository.leaseSessionRenewal(subject)).renewal!;
    await repository.finishSessionRenewal(subject, third.leaseToken, {
      errorCode: "unexpected_failure",
    });
    clock.now += hour;
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    expect((await repository.getOverview(subject, "sydecar")).errorCode).toBe(
      "unexpected_failure",
    );
  });

  it("surfaces three crashed renewal attempts once instead of silently stopping", async () => {
    const { sql, clock, repository } = await fixture();
    clock.now += 6 * hour;
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        (await repository.leaseSessionRenewal(subject)).renewal,
      ).not.toBeNull();
      clock.now += hour;
    }
    const before = Number(sql.prepare("SELECT total_changes() AS n").get()!.n);
    const cleanup = await Promise.all(
      Array.from({ length: 8 }, () => repository.leaseSessionRenewal(subject)),
    );
    expect(cleanup.every((result) => result.renewal === null)).toBe(true);
    expect((await repository.getOverview(subject, "sydecar")).errorCode).toBe(
      "unexpected_failure",
    );
    const changes = sql.prepare("SELECT total_changes() AS n").get()!.n;
    expect(Number(changes) - before).toBe(2);
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    expect(sql.prepare("SELECT total_changes() AS n").get()!.n).toBe(changes);
  });

  it("recovers after three typed transport failures while provider lifetime remains usable", async () => {
    const { sql, clock, repository } = await fixture();
    clock.now += 6 * hour;
    const refreshExpiresAt = new Date(clock.now + 12 * hour).toISOString();
    for (let attempt = 0; attempt < 3; attempt++) {
      const renewal = (await repository.leaseSessionRenewal(subject)).renewal!;
      await repository.finishSessionRenewal(subject, renewal.leaseToken, {
        errorCode: "unexpected_failure",
        reason: "transport",
        refreshExpiresAt,
      });
      clock.now += hour;
    }
    // A failed capture is a separate error: verifying authorization must not
    // imply its holdings import succeeded or hide that failure from the user.
    await repository.requestRun(subject, "sydecar");
    const capture = (await repository.lease(subject, "sydecar")).run!;
    await repository.fail(subject, "sydecar", capture.id, capture.leaseToken, {
      errorCode: "unexpected_failure",
    });
    const recovery = (await repository.leaseSessionRenewal(subject)).renewal!;
    expect(recovery).not.toBeNull();
    const verifiedExpiry = new Date(clock.now + 8 * hour).toISOString();
    clock.now += 30_000; // graceful shutdown and completion delivery
    await repository.finishSessionRenewal(subject, recovery.leaseToken, null, {
      refreshExpiresAt: verifiedExpiry,
    });
    expect((await repository.getOverview(subject, "sydecar")).errorCode).toBe(
      "unexpected_failure",
    );
    expect(
      sql
        .prepare("SELECT last_verified_at FROM provider_session_renewals")
        .get()!.last_verified_at,
    ).toBe(new Date(clock.now).toISOString());
    clock.now += 3 * hour;
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    clock.now += hour;
    expect(
      (await repository.leaseSessionRenewal(subject)).renewal,
    ).not.toBeNull();
  });

  it("atomically caps rolling-day recovery at nine attempts despite concurrent callers and capture resets", async () => {
    const { sql, clock, repository } = await fixture();
    clock.now += 6 * hour;
    const due = clock.now;
    for (let attempt = 0; attempt < 9; attempt++) {
      const contenders = await Promise.all(
        Array.from({ length: 8 }, () =>
          repository.leaseSessionRenewal(subject),
        ),
      );
      const winners = contenders.flatMap((result) =>
        result.renewal === null ? [] : [result.renewal],
      );
      expect(winners).toHaveLength(1);
      await repository.finishSessionRenewal(subject, winners[0]!.leaseToken, {
        errorCode: "unexpected_failure",
        reason: "unavailable",
        refreshExpiresAt: new Date(clock.now + 12 * hour).toISOString(),
      });
      // Even a separately verified capture resetting the consecutive counter
      // must not reset the independent rolling admission history.
      sql.prepare("UPDATE provider_session_renewals SET attempts = 0").run();
      clock.now += hour;
    }
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    expect(
      sql
        .prepare("SELECT COUNT(*) AS n FROM provider_session_renewal_attempts")
        .get()!.n,
    ).toBe(9);
    const plan = sql
      .prepare(
        "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM provider_session_renewal_attempts WHERE agent_id = ? AND attempted_at > ?",
      )
      .all("synthetic", new Date(due).toISOString());
    expect(JSON.stringify(plan)).toContain(
      "COVERING INDEX provider_session_renewal_attempts_window",
    );
    clock.now = due + 24 * hour;
    expect(
      (await repository.leaseSessionRenewal(subject)).renewal,
    ).not.toBeNull();
    expect(
      sql
        .prepare("SELECT COUNT(*) AS n FROM provider_session_renewal_attempts")
        .get()!.n,
    ).toBe(9);
  });

  it("keeps crashed recovery leases bounded and ignores late duplicate metadata", async () => {
    const { clock, repository } = await fixture();
    clock.now += 6 * hour;
    for (let attempt = 0; attempt < 2; attempt++) {
      const renewal = (await repository.leaseSessionRenewal(subject)).renewal!;
      await repository.finishSessionRenewal(subject, renewal.leaseToken, {
        errorCode: "unexpected_failure",
        reason: "transport",
        refreshExpiresAt: new Date(clock.now + 12 * hour).toISOString(),
      });
      clock.now += hour;
    }
    const third = (await repository.leaseSessionRenewal(subject)).renewal!;
    clock.now += hour;
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    await expect(
      repository.finishSessionRenewal(subject, third.leaseToken, null, {
        refreshExpiresAt: new Date(clock.now + 12 * hour).toISOString(),
      }),
    ).resolves.toBeUndefined(); // crash cleanup owns the idempotent outcome
  });

  it("stops typed recovery at observed expiry without misclassifying it as a rejected login", async () => {
    const { clock, repository } = await fixture();
    clock.now += 6 * hour;
    const refreshExpiresAt = new Date(clock.now + 3 * hour).toISOString();
    for (let attempt = 0; attempt < 3; attempt++) {
      const renewal = (await repository.leaseSessionRenewal(subject)).renewal!;
      await repository.finishSessionRenewal(subject, renewal.leaseToken, {
        errorCode: "unexpected_failure",
        reason: "unavailable",
        refreshExpiresAt,
      });
      clock.now += hour;
    }
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    expect((await repository.getOverview(subject, "sydecar")).errorCode).toBe(
      "unexpected_failure",
    );
  });

  it("stops after provider authorization rejection instead of retrying a lost login", async () => {
    const { sql, clock, repository } = await fixture();
    clock.now += 6 * hour;
    const renewal = (await repository.leaseSessionRenewal(subject)).renewal!;
    const before = Number(sql.prepare("SELECT total_changes() AS n").get()!.n);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.finishSessionRenewal(subject, renewal.leaseToken, {
          errorCode: "provider_sign_in_required",
        }),
      ),
    );
    expect(
      Number(sql.prepare("SELECT total_changes() AS n").get()!.n) - before,
    ).toBe(2);
    clock.now += hour;
    expect((await repository.leaseSessionRenewal(subject)).renewal).toBeNull();
    expect((await repository.getOverview(subject, "sydecar")).errorCode).toBe(
      "provider_sign_in_required",
    );
  });
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
