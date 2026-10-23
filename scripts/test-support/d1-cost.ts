import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare, Log, LogLevel } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { z } from "zod";
import { copyCostSeed, costSeedInput, sealCostSeed } from "./d1-cost-seed";

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

export async function createCostDatabase(
  script?: string,
  options: { seed?: string | null; persist?: string } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "keel-cost-d1-"));
  const persist = options.persist ?? join(directory, "d1");
  const seed =
    options.seed === undefined ? process.env.KEEL_TEST_D1_SEED : options.seed;
  let runtime: Miniflare | undefined;
  const close = async () => {
    try {
      await runtime?.dispose();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    if (seed)
      copyCostSeed(seed, persist, costSeedInput(costDatabaseBootstrap.body));
    runtime = new Miniflare({
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
      d1Persist: persist,
      compatibilityDate: "2026-07-28",
    });
    const database = await runtime.getD1Database("DB");
    const execute = (sql: string) =>
      database.batch(
        unstable_splitSqlQuery(sql).map((statement) =>
          database.prepare(statement),
        ),
      );
    if (!seed) {
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
    }
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
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function prepareCostDatabaseSeed(root: string) {
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
    throw new Error("D1 seed must use an owned directory");
  if (readdirSync(root).length !== 0)
    throw new Error("D1 seed directory must be empty");
  const fixture = await createCostDatabase(undefined, {
    seed: null,
    persist: join(root, "d1"),
  });
  await fixture.close();
  sealCostSeed(root, costSeedInput(costDatabaseBootstrap.body));
}
