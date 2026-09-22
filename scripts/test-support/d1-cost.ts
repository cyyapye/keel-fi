import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare, Log, LogLevel } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { z } from "zod";

export { measureD1, emptyD1Cost, type D1Cost } from "./d1-meter";

const defaultWorker =
  'export default { fetch() { return new Response("synthetic cost test"); } }';
const bootstrapUrl = "https://d1-cost-bootstrap.invalid/__keel_bootstrap";
const bootstrapResultSchema = z.object({
  batchCount: z.number().int(),
  statementCount: z.number().int(),
});
const bootstrapWorker = `
import userWorker from "./user-worker.js";

const BOOTSTRAP_URL = ${JSON.stringify(bootstrapUrl)};
const MAX_BODY_BYTES = 2_000_000;

export default {
  async fetch(request, bindings, context) {
    if (request.url !== BOOTSTRAP_URL) {
      return userWorker.fetch(request, bindings, context);
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return new Response("Cost database bootstrap payload is too large", { status: 413 });
    }
    try {
      const batches = JSON.parse(text);
      if (!Array.isArray(batches) || batches.length < 2 || batches.length > 100) {
        throw new Error("Invalid cost database bootstrap batches");
      }
      let statementCount = 0;
      for (const statements of batches) {
        if (!Array.isArray(statements) || statements.length === 0) {
          throw new Error("Invalid cost database bootstrap batch");
        }
        statementCount += statements.length;
        if (statementCount > 4_000 || statements.some((sql) => typeof sql !== "string")) {
          throw new Error("Invalid cost database bootstrap statements");
        }
        await bindings.DB.batch(
          statements.map((statement) => bindings.DB.prepare(statement)),
        );
      }
      return Response.json({ batchCount: batches.length, statementCount });
    } catch (error) {
      return new Response(String(error), { status: 400 });
    }
  },
};
`;

const costDatabaseBootstrap = (() => {
  const directory = resolve("packages/database/migrations");
  const migrations = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) =>
      unstable_splitSqlQuery(readFileSync(resolve(directory, file), "utf8")),
    );
  const seed = unstable_splitSqlQuery(
    readFileSync(resolve("packages/database/seed/synthetic.sql"), "utf8"),
  );
  return {
    body: JSON.stringify([...migrations, seed]),
    batchCount: migrations.length + 1,
    statementCount:
      migrations.reduce((count, statements) => count + statements.length, 0) +
      seed.length,
  };
})();

export async function createCostDatabase(script?: string) {
  const runtime = new Miniflare({
    modules: [
      {
        type: "ESModule",
        path: "bootstrap-worker.js",
        contents: bootstrapWorker,
      },
      {
        type: "ESModule",
        path: "user-worker.js",
        contents: script ?? defaultWorker,
      },
    ],
    log: new Log(LogLevel.NONE),
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    compatibilityDate: "2026-07-28",
  });
  const database = await runtime.getD1Database("DB");
  const execute = (sql: string) =>
    database.batch(
      unstable_splitSqlQuery(sql).map((statement) =>
        database.prepare(statement),
      ),
    );
  try {
    const response = await runtime.dispatchFetch(bootstrapUrl, {
      method: "POST",
      body: costDatabaseBootstrap.body,
    });
    if (!response.ok) {
      throw new Error(
        `Cost database bootstrap failed: ${await response.text()}`,
      );
    }
    const result = bootstrapResultSchema.parse(await response.json());
    if (
      result.batchCount !== costDatabaseBootstrap.batchCount ||
      result.statementCount !== costDatabaseBootstrap.statementCount
    )
      throw new Error("Cost database bootstrap was incomplete");
    if (
      (await database
        .prepare("PRAGMA foreign_keys")
        .first<number>("foreign_keys")) !== 1
    ) {
      throw new Error("Cost fixture must enforce foreign keys");
    }
    return {
      database,
      execute,
      dispatchFetch: runtime.dispatchFetch.bind(runtime),
      close: () => runtime.dispose(),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
