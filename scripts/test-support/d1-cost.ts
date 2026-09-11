import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare, Log, LogLevel } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";

export { measureD1, emptyD1Cost, type D1Cost } from "./d1-meter";

export async function createCostDatabase(script?: string) {
  const runtime = new Miniflare({
    modules: true,
    log: new Log(LogLevel.NONE),
    script:
      script ??
      'export default { fetch() { return new Response("synthetic cost test"); } }',
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    compatibilityDate: "2026-07-28",
  });
  const database = (await runtime.getD1Database("DB")) as unknown as D1Database;
  const execute = (sql: string) =>
    database.batch(
      unstable_splitSqlQuery(sql).map((statement) =>
        database.prepare(statement),
      ),
    );
  try {
    const directory = resolve("packages/database/migrations");
    for (const file of readdirSync(directory)
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      await execute(readFileSync(resolve(directory, file), "utf8"));
    }
    await execute(
      readFileSync(resolve("packages/database/seed/synthetic.sql"), "utf8"),
    );
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
