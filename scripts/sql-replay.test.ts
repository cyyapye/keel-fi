import { build } from "esbuild";
import { expect, it } from "vitest";
import { createCostDatabase } from "./test-support/d1-cost";
import { replaySql } from "./test-support/sql-replay";
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
