import { build } from "esbuild";
import { expect, it } from "vitest";
import { createCostDatabase } from "./test-support/d1-cost";
import {
  addD1Cost,
  replaySql,
  type SqlReplayChunk,
} from "./test-support/sql-replay";
import { emptyD1Cost } from "./test-support/d1-meter";
import { createSqliteTrace } from "./test-support/sqlite-trace";

it("replays setup, atomic batches, bindings and reads with actual D1 index-write costs", async () => {
  const bundled = await build({
    entryPoints: ["scripts/test-support/sql-replay-worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
  });
  const fixture = await createCostDatabase(bundled.outputFiles[0]!.text);
  const trace = createSqliteTrace();
  try {
    const db = trace.database;
    await db
      .prepare("CREATE TABLE replay_probe (id TEXT PRIMARY KEY, value INTEGER)")
      .run();
    await db
      .prepare("CREATE INDEX replay_probe_value ON replay_probe(value)")
      .run();
    trace.reset();
    await db.batch([
      db
        .prepare("INSERT INTO replay_probe VALUES (?, ?)")
        .bind("synthetic-one", 7),
      db
        .prepare("INSERT INTO replay_probe VALUES (?, ?)")
        .bind("synthetic-two", null),
    ]);
    expect(
      await db.prepare("SELECT * FROM replay_probe ORDER BY id").all(),
    ).toMatchObject({
      results: [
        { id: "synthetic-one", value: 7 },
        { id: "synthetic-two", value: null },
      ],
    });
    await db
      .prepare("UPDATE replay_probe SET value = ? WHERE id = ?")
      .bind(8, "synthetic-one")
      .run();
    expect(
      await db
        .prepare("SELECT value FROM replay_probe WHERE id = ?")
        .bind("synthetic-one")
        .first("value"),
    ).toBe(8);
    const cost = await trace.replay((body) =>
      fixture.dispatchFetch("https://synthetic-replay.invalid", {
        method: "POST",
        body,
      }),
    );
    expect(cost.roundTrips).toBe(4);
    expect(cost.statements).toBe(5);
    // SQLite changed three table rows. Actual D1 must also bill index writes.
    expect(cost.rowsWritten).toBeGreaterThan(3);
    expect(cost.rowsRead).toBeGreaterThan(0);
    expect(
      await fixture.database
        .prepare("SELECT value FROM replay_probe WHERE id = ?")
        .bind("synthetic-one")
        .first("value"),
    ).toBe(8);
  } finally {
    trace.close();
    await fixture.close();
  }
}, 30_000);

it("rejects D1 result divergence instead of trusting the SQLite behavior oracle", async () => {
  const fixture = await createCostDatabase();
  try {
    await expect(
      replaySql(fixture.database, {
        queries: ["SELECT id FROM households WHERE id = ?"],
        steps: [
          {
            batch: false,
            statements: [{ query: 0, bindings: ["hh_demo"], rows: [] }],
          },
        ],
        offset: 500,
        measureFrom: 0,
      }),
    ).rejects.toThrow("D1/SQLite result mismatch at operation 500");
  } finally {
    await fixture.close();
  }
}, 30_000);

it("rejects incomplete replay, missing billing metadata and failed SQL traces", async () => {
  const trace = createSqliteTrace();
  try {
    await trace.database.prepare("SELECT 1 AS value").first();
    await expect(
      trace.replay(() =>
        Promise.resolve(
          Response.json({
            rowsRead: 0,
            rowsWritten: 0,
            statements: 0,
            roundTrips: 0,
            replayedSteps: 0,
            measuredSteps: 0,
          }),
        ),
      ),
    ).rejects.toThrow("Incomplete D1 replay");
    await expect(
      trace.replay(() =>
        Promise.resolve(Response.json({ replayedSteps: 1, measuredSteps: 1 })),
      ),
    ).rejects.toThrow("Invalid replay billing counters");
    expect(() =>
      trace.database.batch([
        trace.database.prepare(
          "INSERT INTO users VALUES ('synthetic-replay-user', 'synthetic-replay-subject', 'replay@example.invalid', 'Synthetic Replay', '2026-09-01')",
        ),
        trace.database.prepare("INSERT INTO missing_replay_table VALUES (1)"),
      ]),
    ).toThrow();
    expect(
      await trace.database
        .prepare("SELECT id FROM users WHERE id = 'synthetic-replay-user'")
        .first(),
    ).toBeNull();
    await expect(
      trace.replay(() => Promise.resolve(Response.json({}))),
    ).rejects.toThrow("Cannot replay a trace containing failed SQL");
  } finally {
    trace.close();
  }
});

it("batches only adjacent standalone reads without changing real billing or production round trips", async () => {
  const fixture = await createCostDatabase();
  try {
    await fixture.execute(
      "CREATE TABLE replay_reads (id TEXT PRIMARY KEY, value INTEGER); CREATE INDEX replay_reads_value ON replay_reads(value)",
    );
    const chunk: SqlReplayChunk = {
      queries: [
        "INSERT INTO replay_reads VALUES ('synthetic', 1)",
        "SELECT value FROM replay_reads",
        "UPDATE replay_reads SET value = 2 WHERE id = 'synthetic'",
      ],
      steps: [
        { batch: true, statements: [{ query: 0, bindings: [], rows: [] }] },
        ...Array.from({ length: 3 }, () => ({
          batch: false,
          statements: [{ query: 1, bindings: [], rows: [{ value: 1 }] }],
        })),
        { batch: false, statements: [{ query: 2, bindings: [], rows: [] }] },
        ...Array.from({ length: 2 }, () => ({
          batch: false,
          statements: [{ query: 1, bindings: [], rows: [{ value: 2 }] }],
        })),
        {
          batch: true,
          statements: [{ query: 1, bindings: [], rows: [{ value: 2 }] }],
        },
      ],
      offset: 0,
      measureFrom: 2,
    };
    const serial = emptyD1Cost();
    for (const [index, step] of chunk.steps.entries()) {
      addD1Cost(
        serial,
        await replaySql(fixture.database, {
          ...chunk,
          steps: [step],
          offset: index,
        }),
      );
    }
    await fixture.execute("DELETE FROM replay_reads");
    const grouped = await replaySql(fixture.database, chunk);
    expect(grouped).toMatchObject(serial);
    expect(grouped.roundTrips).toBe(6);
    expect(grouped.statements).toBe(6);
    expect(grouped.replayRoundTrips).toBe(6);
    expect(grouped.replayedSteps).toBe(8);
    expect(grouped.rowsWritten).toBeGreaterThan(1);
    await fixture.execute("DELETE FROM replay_reads");
    const divergent = structuredClone(chunk);
    divergent.steps[3]!.statements[0]!.rows = [{ value: 999 }];
    await expect(replaySql(fixture.database, divergent)).rejects.toThrow(
      "D1/SQLite result mismatch at operation 3",
    );
    await fixture.execute("DELETE FROM replay_reads");
    await expect(
      replaySql(fixture.database, {
        queries: [
          chunk.queries[0]!,
          "INSERT INTO missing_replay_table VALUES (1)",
        ],
        steps: [
          {
            batch: true,
            statements: [0, 1].map((query) => ({
              query,
              bindings: [],
              rows: [],
            })),
          },
        ],
        offset: 0,
        measureFrom: 0,
      }),
    ).rejects.toThrow();
    expect(
      await fixture.database
        .prepare("SELECT COUNT(*) AS count FROM replay_reads")
        .first("count"),
    ).toBe(0);
    const bounded = await replaySql(fixture.database, {
      queries: ["SELECT value FROM replay_reads"],
      steps: Array.from({ length: 205 }, () => ({
        batch: false,
        statements: [{ query: 0, bindings: [], rows: [] }],
      })),
      offset: 0,
      measureFrom: 0,
    });
    expect(bounded).toMatchObject({
      roundTrips: 205,
      statements: 205,
      measuredSteps: 205,
      replayRoundTrips: 3,
    });
  } finally {
    await fixture.close();
  }
}, 30_000);

it("coalesces proven zero-write updates while retaining actual writes, triggers and billing", async () => {
  const bundled = await build({
    entryPoints: ["scripts/test-support/sql-replay-worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
  });
  const fixture = await createCostDatabase(bundled.outputFiles[0]!.text);
  const trace = createSqliteTrace();
  try {
    const db = trace.database;
    await db
      .prepare(
        "CREATE TABLE replay_noop (id INTEGER PRIMARY KEY, value INTEGER)",
      )
      .run();
    await db
      .prepare("CREATE INDEX replay_noop_value ON replay_noop(value)")
      .run();
    await db.prepare("CREATE TABLE replay_audit (value INTEGER)").run();
    await db
      .prepare(
        "CREATE TRIGGER replay_change AFTER UPDATE ON replay_noop BEGIN INSERT INTO replay_audit VALUES (new.value); END",
      )
      .run();
    await db.prepare("INSERT INTO replay_noop VALUES (1, 0)").run();
    trace.reset();
    for (let index = 0; index < 120; index++) {
      const noChange = db
        .prepare("UPDATE replay_noop SET value = ? WHERE id = 2")
        .bind(index);
      if (index % 2 === 0) await db.batch([noChange]);
      else await noChange.run();
      await db.prepare("SELECT value FROM replay_noop WHERE id = 1").all();
      if (index % 40 === 0)
        await db
          .prepare("UPDATE replay_noop SET value = value + 1 WHERE id = 1")
          .run();
    }
    const dispatch = (body: string) =>
      fixture.dispatchFetch("https://synthetic-replay.invalid", {
        method: "POST",
        body,
      });
    const original = await trace.replay((body) => {
      const chunk = JSON.parse(body) as SqlReplayChunk;
      for (const step of chunk.steps)
        for (const statement of step.statements) delete statement.zeroWrite;
      return dispatch(JSON.stringify(chunk));
    });
    await fixture.execute("DROP TABLE replay_noop; DROP TABLE replay_audit");
    const grouped = await trace.replay(dispatch);
    const { replayRoundTrips: originalTransport, ...originalCost } = original;
    const { replayRoundTrips: groupedTransport, ...groupedCost } = grouped;
    expect(groupedCost).toEqual(originalCost);
    expect(grouped.roundTrips).toBe(243);
    expect(grouped.rowsWritten).toBeGreaterThan(3);
    expect(groupedTransport).toBeLessThan(originalTransport / 10);
    expect(
      (
        await fixture.database
          .prepare("SELECT * FROM replay_audit ORDER BY value")
          .all()
      ).results,
    ).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
    await expect(
      replaySql(fixture.database, {
        queries: ["UPDATE replay_noop SET value = 99 WHERE id = 1"],
        steps: [
          {
            batch: false,
            statements: [{ query: 0, bindings: [], rows: [], zeroWrite: true }],
          },
        ],
        offset: 0,
        measureFrom: 0,
      }),
    ).rejects.toThrow("D1 rejected the zero-write replay claim");
  } finally {
    trace.close();
    await fixture.close();
  }
}, 30_000);
