import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statfsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
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
const foreignKeysResultSchema = z
  .object({ foreignKeys: z.literal(1) })
  .strict();
const bootstrapWorker = `
import userWorker from "./user-worker.js";

const BOOTSTRAP_URL = ${JSON.stringify(bootstrapUrl)};
const MAX_BODY_BYTES = 2_000_000;

export default {
  async fetch(request, bindings, context) {
    if (request.url !== BOOTSTRAP_URL) {
      return userWorker.fetch(request, bindings, context);
    }
    if (request.method === "GET") {
      return Response.json({
        foreignKeys: await bindings.DB.prepare("PRAGMA foreign_keys").first("foreign_keys"),
      });
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

function costDatabaseSources() {
  const directory = "packages/database/migrations";
  const paths = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => directory + "/" + file);
  paths.push("packages/database/seed/synthetic.sql");
  const sources = paths.map((path) => readFileSync(resolve(path)));
  const fingerprint = costSeedInput(
    JSON.stringify([
      "keel-d1-cost-raw-sources-v1",
      paths.map((path, index) => [
        path,
        createHash("sha256").update(sources[index]!).digest("hex"),
      ]),
    ]),
  );
  return { sources, fingerprint };
}

async function costDatabaseBootstrap(sources: readonly Buffer[]) {
  const { unstable_splitSqlQuery } = await import("wrangler");
  const batches = sources.map((source) =>
    unstable_splitSqlQuery(source.toString("utf8")),
  );
  return {
    body: JSON.stringify(batches),
    batchCount: batches.length,
    statementCount: batches.reduce(
      (count, statements) => count + statements.length,
      0,
    ),
  };
}

function allocateCostDirectory(
  sharedMemoryParent?: string,
  checkProviderDayHeadroom = false,
) {
  if (sharedMemoryParent && process.platform === "linux") {
    try {
      const owner = lstatSync(sharedMemoryParent);
      const volume = statfsSync(sharedMemoryParent);
      // The manual fixture stayed below 85 MiB in the Linux trial. At admission,
      // allow another 128 MiB for an overlapping provider day.
      const extraHeadroom = checkProviderDayHeadroom ? 128 * 1024 ** 2 : 0;
      if (
        owner.isDirectory() &&
        owner.uid === process.getuid!() &&
        (owner.mode & 0o777) === 0o700 &&
        volume.type === 0x01021994 && // Linux TMPFS_MAGIC
        volume.bavail * volume.bsize >= 128 * 1024 ** 2 + extraHeadroom &&
        process.availableMemory() >= 512 * 1024 ** 2 + extraHeadroom
      ) {
        return {
          directory: mkdtempSync(join(sharedMemoryParent, "keel-cost-d1-")),
          storage: "tmpfs",
        };
      }
    } catch {
      // Choose storage before opening D1. Setup and replay errors must propagate.
    }
  }
  return {
    directory: mkdtempSync(join(tmpdir(), "keel-cost-d1-")),
    storage: "default",
  };
}

type CostDatabaseOptions = {
  seed?: string | null;
  resourcePersistencePath?: string;
  sharedMemoryParent?: string | undefined;
  checkProviderDayHeadroom?: boolean;
};

async function createCostRuntime(
  script: string | undefined,
  options: CostDatabaseOptions,
) {
  const { directory, storage } = allocateCostDirectory(
    options.resourcePersistencePath === undefined
      ? options.sharedMemoryParent
      : undefined,
    options.checkProviderDayHeadroom,
  );
  const resourcePersistencePath = options.resourcePersistencePath ?? directory;
  const persist = join(resourcePersistencePath, "d1");
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
    const inputs = costDatabaseSources();
    if (seed) copyCostSeed(seed, persist, inputs.fingerprint);
    runtime = new Miniflare(
      convertV4MiniflareOptions({
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
        resourcePersistencePath,
        compatibilityDate: "2026-07-28",
      }),
    );
    if (!seed) {
      const bootstrap = await costDatabaseBootstrap(inputs.sources);
      const response = await runtime.dispatchFetch(bootstrapUrl, {
        method: "POST",
        body: bootstrap.body,
      });
      if (!response.ok) {
        throw new Error(
          `Cost database bootstrap failed: ${await response.text()}`,
        );
      }
      const result = bootstrapResultSchema.parse(await response.json());
      if (
        result.batchCount !== bootstrap.batchCount ||
        result.statementCount !== bootstrap.statementCount
      )
        throw new Error("Cost database bootstrap was incomplete");
    }
    return {
      runtime,
      storage,
      seedInput: inputs.fingerprint,
      dispatchFetch: runtime.dispatchFetch.bind(runtime),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function createCostDatabase(
  script?: string,
  options: CostDatabaseOptions = {},
) {
  const fixture = await createCostRuntime(script, options);
  try {
    const database = await fixture.runtime.getD1Database("DB");
    if (
      (await database
        .prepare("PRAGMA foreign_keys")
        .first<number>("foreign_keys")) !== 1
    ) {
      throw new Error("Cost fixture must enforce foreign keys");
    }
    const execute = async (sql: string) => {
      const { unstable_splitSqlQuery } = await import("wrangler");
      return database.batch(
        unstable_splitSqlQuery(sql).map((statement) =>
          database.prepare(statement),
        ),
      );
    };
    return {
      database,
      storage: fixture.storage,
      seedInput: fixture.seedInput,
      execute,
      dispatchFetch: fixture.dispatchFetch,
      close: fixture.close,
    };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

export async function createCostWorker(
  script: string,
  options: CostDatabaseOptions = {},
) {
  const fixture = await createCostRuntime(script, options);
  try {
    const response = await fixture.dispatchFetch(bootstrapUrl);
    if (
      !response.ok ||
      !foreignKeysResultSchema.safeParse(await response.json()).success
    ) {
      throw new Error("Cost fixture must enforce foreign keys");
    }
    return {
      storage: fixture.storage,
      seedInput: fixture.seedInput,
      dispatchFetch: fixture.dispatchFetch,
      close: fixture.close,
    };
  } catch (error) {
    await fixture.close();
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
    resourcePersistencePath: root,
  });
  await fixture.close();
  sealCostSeed(root, fixture.seedInput);
}
