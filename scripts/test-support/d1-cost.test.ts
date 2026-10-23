import { expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCostDatabase,
  prepareCostDatabaseSeed,
  measureD1,
} from "./d1-cost";

const bootstrapUrl = "https://d1-cost-bootstrap.invalid/__keel_bootstrap";

it("creates isolated complete D1 fixtures and fails closed between bootstrap batches", async () => {
  const first = await createCostDatabase(`
    export default {
      fetch(request) {
        return new Response(new URL(request.url).pathname);
      },
    };
  `);
  try {
    expect(
      await (
        await first.dispatchFetch("https://synthetic-worker.invalid/forwarded")
      ).text(),
    ).toBe("/forwarded");
    expect(
      await first.database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'investment_event_revisions'",
        )
        .first("count"),
    ).toBe(1);
    expect(
      await first.database
        .prepare(
          "SELECT COUNT(*) AS count FROM users WHERE access_subject = 'synthetic-access-subject'",
        )
        .first("count"),
    ).toBe(1);
    await expect(
      first.database
        .prepare(
          "INSERT INTO households VALUES ('invalid-household', 'missing-user', 'Invalid', 'USD', '2026-09-01T00:00:00.000Z')",
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      first.database
        .prepare("INSERT INTO users SELECT * FROM users WHERE id = 'usr_demo'")
        .run(),
    ).rejects.toThrow();

    const failed = await first.dispatchFetch(bootstrapUrl, {
      method: "POST",
      body: JSON.stringify([
        ["CREATE TABLE bootstrap_before (id TEXT PRIMARY KEY)"],
        ["INVALID SYNTHETIC SQL"],
        ["CREATE TABLE bootstrap_after (id TEXT PRIMARY KEY)"],
      ]),
    });
    expect(failed.status).toBe(400);
    const bootstrapTables = await first.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'bootstrap_%' ORDER BY name",
      )
      .all<{ name: string }>();
    expect(bootstrapTables.results).toEqual([{ name: "bootstrap_before" }]);

    const second = await createCostDatabase();
    try {
      expect(
        (
          await second.database
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'bootstrap_%'",
            )
            .all()
        ).results,
      ).toEqual([]);
      expect(
        await second.database
          .prepare("SELECT COUNT(*) AS count FROM users")
          .first("count"),
      ).toBe(1);
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
  }
}, 30_000);

it("reuses a closed sealed D1 seed with fresh state and rejects altered inputs or files", async () => {
  const root = mkdtempSync(join(tmpdir(), "keel-cost-seed-test-"));
  try {
    await prepareCostDatabaseSeed(root);
    const original = await createCostDatabase(undefined, { seed: null });
    const first = await createCostDatabase(undefined, { seed: root });
    try {
      const query =
        "SELECT type, name, sql FROM sqlite_master ORDER BY type, name";
      expect((await first.database.prepare(query).all()).results).toEqual(
        (await original.database.prepare(query).all()).results,
      );
      const measure = async (database: D1Database) => {
        const meter = measureD1(database);
        const result = await meter.database
          .prepare("SELECT * FROM users ORDER BY id")
          .all();
        return { rows: result.results, cost: meter.cost };
      };
      expect(await measure(first.database)).toEqual(
        await measure(original.database),
      );
      await first.execute(
        "CREATE TABLE seed_probe (id INTEGER PRIMARY KEY); INSERT INTO seed_probe VALUES (1)",
      );
      const second = await createCostDatabase(undefined, { seed: root });
      try {
        expect(
          (
            await second.database
              .prepare(
                "SELECT name FROM sqlite_master WHERE name = 'seed_probe'",
              )
              .all()
          ).results,
        ).toEqual([]);
      } finally {
        await second.close();
      }
    } finally {
      await original.close();
      await first.close();
    }
    const path = join(root, "seal.json");
    const seal = readFileSync(path, "utf8");
    const stale = JSON.parse(seal) as { input: string };
    stale.input = "0".repeat(64);
    writeFileSync(path, JSON.stringify(stale));
    await expect(createCostDatabase(undefined, { seed: root })).rejects.toThrow(
      "D1 seed is stale or modified",
    );
    writeFileSync(path, seal);
    const file = (JSON.parse(seal) as { files: { path: string }[] }).files[0]!
      .path;
    const databasePath = join(root, "d1", file);
    const bytes = readFileSync(databasePath);
    writeFileSync(
      databasePath,
      Buffer.concat([bytes, Buffer.from("synthetic mutation")]),
    );
    await expect(createCostDatabase(undefined, { seed: root })).rejects.toThrow(
      "D1 seed is stale or modified",
    );
    rmSync(databasePath);
    symlinkSync(path, databasePath);
    await expect(createCostDatabase(undefined, { seed: root })).rejects.toThrow(
      "D1 seed must not contain symlinks",
    );
    await expect(prepareCostDatabaseSeed(root)).rejects.toThrow(
      "D1 seed directory must be empty",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
