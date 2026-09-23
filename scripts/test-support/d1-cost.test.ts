import { expect, it } from "vitest";
import { createCostDatabase } from "./d1-cost";

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
