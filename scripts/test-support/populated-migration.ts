import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Miniflare, Log, LogLevel } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { z } from "zod";
import { D1HoldingImportRepository } from "../../packages/database/src/holding-imports";
import { D1PositionPurchaseRepository } from "../../packages/database/src/position-purchases";
import { D1ManualHoldingRepository } from "../../packages/database/src/manual-holdings";
import { LegalDocumentTestD1 } from "./legal-documents";
import { syntheticWefunderImport } from "./wefunder-holdings";
import { copyCostSeed, costSeedInput, sealCostSeed } from "./d1-cost-seed";

const cell = z.union([z.string(), z.number().finite(), z.null()]);
const SchemaObject = z.object({
  type: z.string(),
  name: z.string(),
  sql: z.string().nullable(),
});
const FixtureSchema = z.object({
  frontier: z.enum(["0088", "0089"]),
  history: z.number().int().min(12).max(24),
  mainPositions: z.literal(120),
  unrelatedPositions: z.literal(120),
  tables: z.array(
    z.object({
      name: z.string(),
      columns: z.array(z.string()),
      rows: z.array(z.array(cell)),
      sha256: z.string(),
    }),
  ),
  triggers: z.array(z.object({ name: z.string(), sql: z.string() })),
  objects: z.array(SchemaObject),
  foreignKeys: z.array(
    z.object({
      child: z.string(),
      parent: z.string(),
      from: z.string(),
      indexed: z.boolean(),
    }),
  ),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  hash: z.string(),
});
export type PopulatedMigrationFixture = z.infer<typeof FixtureSchema>;
const runtimePlatformObjects = new WeakMap<
  D1Database,
  z.infer<typeof SchemaObject>[]
>();
const TableDigestSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  rows: z.number().int().nonnegative(),
});
const runtimeTableDigests = new WeakMap<
  D1Database,
  (
    tables: PopulatedMigrationFixture["tables"],
  ) => Promise<z.infer<typeof TableDigestSchema>[]>
>();
export const migrationDigest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const canonicalRows = (rows: unknown[][]) =>
  JSON.stringify(rows.map((row) => JSON.stringify(row)).sort());
const normalizedSql = (sql: unknown) =>
  String(sql)
    .split("\n")
    .filter((line) => !/^\s*--/u.test(line))
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .join("\n");
const time = "2026-08-20T12:00:00.000Z";

export function hasUsableMigrationForeignKeyIndex(
  db: DatabaseSync,
  child: string,
  column: string,
) {
  return db
    .prepare(`PRAGMA index_list(${identifier(child)})`)
    .all()
    .some((index) => {
      const name = String(index.name);
      if (
        db.prepare(`PRAGMA index_info(${identifier(name)})`).all()[0]?.name !==
        column
      )
        return false;
      if (index.partial === 0) return true;

      // Equality on the child key excludes NULL. Accept only that exact
      // partial predicate, and prove SQLite can use it without adding a filter
      // to the foreign-key lookup. Arbitrary partial indexes are insufficient.
      const sql = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?")
        .get(name)?.sql;
      const predicate = /\bWHERE\s+(.+)$/isu
        .exec(String(sql))?.[1]
        ?.trim()
        .replace(/;$/u, "")
        .replace(/\s+/gu, " ")
        .toUpperCase();
      if (
        ![column, identifier(column)].some(
          (key) => predicate === `${key} IS NOT NULL`.toUpperCase(),
        )
      )
        return false;
      const details = db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT rowid FROM ${identifier(child)} WHERE ${identifier(column)}=?`,
        )
        .all("synthetic-missing-reference")
        .map((row) => String(row.detail));
      return details.some(
        (detail) =>
          /\bSEARCH\b/u.test(detail) &&
          !/\bSCAN\b/u.test(detail) &&
          detail.includes(name),
      );
    });
}

class ManualFixtureD1 extends LegalDocumentTestD1 {
  override batch(statements: Parameters<LegalDocumentTestD1["batch"]>[0]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        /^\s*(SELECT|WITH|EXPLAIN|PRAGMA)\b/iu.test(statement.sql)
          ? {
              success: true,
              results: this.sqlite
                .prepare(statement.sql)
                .all(...statement.values),
              meta: { changes: 0 },
            }
          : { ...statement.execute(), results: [] },
      );
      this.sqlite.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function insertBaseline(
  db: DatabaseSync,
  round: number,
  positions: { position_id: string; snapshot_id: string }[],
) {
  const base = db
    .prepare(
      "SELECT * FROM forecast_snapshots WHERE scenario_id='scn_fi' ORDER BY version DESC LIMIT 1",
    )
    .get()!;
  const snapshotId = `synthetic_migration_forecast_${round}`;
  const data = {
    ...base,
    id: snapshotId,
    version: Number(base.version) + 1,
    input_hash: migrationDigest(`synthetic migration baseline ${round}`),
    trigger: "Portfolio baseline",
  };
  const columns = Object.keys(data);
  db.prepare(
    `INSERT INTO forecast_snapshots (${columns.map(identifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  ).run(
    ...columns.map(
      (column) => data[column as keyof typeof data] as SQLInputValue,
    ),
  );
  const baselineId = `synthetic_migration_baseline_${round}`;
  db.prepare(
    `INSERT INTO portfolio_baselines (id,household_id,source_revision,source_observed_at,position_count,public_market_value_minor,private_paper_value_minor,unknown_value_count,potential_duplicate_count,prior_fi_eligible_liquid_minor,fi_eligible_liquid_minor,base_forecast_snapshot_id,cash_flow_plan_id,forecast_snapshot_id,goal_version_id,change_note,created_by_user_id,created_at,immutable) VALUES (?,'hh_demo',?,'2026-08-20T00:00:00.000Z',?,0,0,?,0,182500000,182500000,?,'cf_fi',?,NULL,'Synthetic populated migration cost.','usr_demo',?,1)`,
  ).run(
    baselineId,
    migrationDigest(`baseline ${round}`),
    positions.length,
    positions.length,
    base.id!,
    snapshotId,
    time,
  );
  const insert = db.prepare(
    `INSERT INTO portfolio_baseline_items (id,household_id,baseline_id,position_id,snapshot_id,provider,classification,value_minor,value_state,observed_at,duplicate_key,created_at) VALUES (?,'hh_demo',?,?,?,'wefunder','private_paper',NULL,'not_reported','2026-08-20T00:00:00.000Z',NULL,?)`,
  );
  for (const [index, row] of positions.entries())
    insert.run(
      `synthetic_migration_baseline_item_${round}_${index}`,
      baselineId,
      row.position_id,
      row.snapshot_id,
      time,
    );
}

async function buildFixture(history: number, frontier: "0088" | "0089") {
  const oldFiles = migrationFiles("0088");
  const db = new DatabaseSync(":memory:");
  const statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  try {
    db.exec("PRAGMA foreign_keys=ON");
    if (db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1)
      throw new Error("SQLite fixture must enforce foreign keys");
    for (const file of [...oldFiles, "packages/database/seed/synthetic.sql"])
      db.exec(readFileSync(file, "utf8"));
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      let statement = statements.get(sql);
      if (statement === undefined) {
        statement = prepare(sql);
        statements.set(sql, statement);
      }
      return statement;
    };
    db.prepare(
      "INSERT INTO users(id,access_subject,email,display_name,created_at) VALUES ('usr_migration_foreign','synthetic-migration-foreign','migration-foreign@example.invalid','Synthetic Foreign User',?)",
    ).run(time);
    db.prepare(
      "INSERT INTO households(id,owner_user_id,name,base_currency,created_at) VALUES ('hh_migration_foreign','usr_migration_foreign','Synthetic unrelated household','USD',?)",
    ).run(time);
    const repository = new D1HoldingImportRepository(
      new LegalDocumentTestD1(db).asD1(),
    );
    const purchases = new D1PositionPurchaseRepository(
      new LegalDocumentTestD1(db).asD1(),
    );
    for (const [subject, rounds] of [
      ["synthetic-access-subject", history],
      ["synthetic-migration-foreign", 2],
    ] as const) {
      const template = await syntheticWefunderImport({
        count: 120,
        legalName: (index) =>
          `Synthetic Migration ${subject === "synthetic-access-subject" ? "Main" : "Foreign"} SPV ${index}`,
        investmentPrefix: `Synthetic Migration ${subject}`,
      });
      for (let round = 0; round < rounds; round++) {
        const input = {
          ...template,
          sha256: migrationDigest(`${subject}:120:${round}`),
          objectKey: `synthetic/migration/${subject}/${round}.csv`,
          rows: template.rows.map((row) => ({
            ...row,
            investedMinor: row.investedMinor + round,
          })),
        };
        const staged = await repository.stageHoldingImport(subject, input);
        await repository.applyHoldingImport(subject, staged.preview.id, {
          currency: "USD",
          decisions: staged.preview.rows.map((row) => ({
            rowId: row.id,
            decision: "accepted" as const,
            rationale: "Accepted synthetic populated migration fixture.",
          })),
        });
        if (subject === "synthetic-access-subject") {
          const positions = db
            .prepare(
              "SELECT a.position_id,a.snapshot_id FROM holding_import_applications a JOIN holding_import_rows r ON r.id=a.import_row_id WHERE r.import_id=? ORDER BY a.position_id",
            )
            .all(staged.preview.id) as {
            position_id: string;
            snapshot_id: string;
          }[];
          if (positions.length !== 120)
            throw new Error("Incomplete synthetic main import");
          for (const [index, row] of positions.entries()) {
            const prior = db
              .prepare(
                "SELECT review_id FROM holding_purchase_heads WHERE position_id=?",
              )
              .get(row.position_id);
            await purchases.acceptValuation(subject, row.position_id, {
              expectedSnapshotId: row.snapshot_id,
              expectedReceiptId:
                typeof prior?.review_id === "string" ? prior.review_id : null,
              method: "total",
              record: {
                id: `synthetic_migration_estimate_${round}_${index}`,
                origin: "judgment",
                totalMinor: 140000 + round,
                priceMicros: null,
                effectiveDate: "2026-08-20",
                priceDate: null,
                shareClass: null,
                carryStatus: "unknown",
                sourceLabel: "Synthetic migration estimate",
                sourceUrl: null,
                sourceEvidenceId: null,
                sourcePositionId: null,
                sourceCapturedAt: null,
                watchEvidenceId: null,
              },
            });
          }
          if (round === rounds - 1) insertBaseline(db, round, positions);
        }
      }
    }
    if (frontier === "0089") {
      statements.clear();
      const priorIndexes = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='index'")
          .all()
          .map((row) => String(row.name)),
      );
      for (const sql of unstable_splitSqlQuery(
        readFileSync(
          "scripts/test-support/synthetic-historical-foreign-key-indexes.sql",
          "utf8",
        ),
      ).filter((sql) => !sql.includes("manual_holding_submissions")))
        db.exec(sql);
      const auxiliaryIndexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all()
        .map((row) => String(row.name))
        .filter((name) => !priorIndexes.has(name));
      db.exec("BEGIN");
      db.exec(
        readFileSync(
          "packages/database/migrations/0089_manual_holdings.sql",
          "utf8",
        ),
      );
      db.exec("COMMIT");
      for (const name of auxiliaryIndexes)
        db.exec(`DROP INDEX IF EXISTS ${identifier(name)}`);
      statements.clear();
      await new D1ManualHoldingRepository(new ManualFixtureD1(db).asD1(), {
        put: () => Promise.resolve(null),
      }).create("synthetic-access-subject", {
        submissionId: "f0000000-0000-4000-8000-000000000001",
        classification: "private_paper",
        name: "Synthetic migration manual investment",
        kind: "spv_interest",
        owner: { mode: "new", label: "Synthetic migration manual owner" },
        company: { mode: "unassigned" },
        cashPaidMinor: null,
        investmentDate: null,
        valuation: { state: "unknown" },
      });
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Invalid old-schema fixture foreign keys");
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    const tables = names.map((name) => {
      const columns = db
        .prepare(`PRAGMA table_info(${identifier(name)})`)
        .all()
        .map((row) => String(row.name));
      const rows = db
        .prepare(
          `SELECT ${columns.map(identifier).join(",")} FROM ${identifier(name)}`,
        )
        .all()
        .map((row) => columns.map((column) => cell.parse(row[column])));
      return {
        name,
        columns,
        rows,
        sha256: migrationDigest(canonicalRows(rows)),
      };
    });
    const triggers = db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name",
      )
      .all();
    const foreignKeys = names.flatMap((child) =>
      db
        .prepare(`PRAGMA foreign_key_list(${identifier(child)})`)
        .all()
        .filter((row) =>
          [
            "holding_import_rows",
            "holding_position_snapshots",
            "portfolio_baseline_items",
          ].includes(String(row.table)),
        )
        .map((row) => ({
          child,
          parent: String(row.table),
          from: String(row.from),
          indexed: hasUsableMigrationForeignKeyIndex(
            db,
            child,
            String(row.from),
          ),
        })),
    );
    const objects = db
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all();
    const counts = Object.fromEntries(
      tables
        .filter((table) =>
          /holding_import_rows|holding_positions$|holding_position_snapshots|holding_import_applications|holding_purchase_reviews|portfolio_baseline_items|households/.test(
            table.name,
          ),
        )
        .map((table) => [table.name, table.rows.length]),
    );
    return FixtureSchema.parse({
      frontier,
      history,
      mainPositions: 120,
      unrelatedPositions: 120,
      tables,
      triggers,
      foreignKeys,
      objects,
      counts,
      hash: migrationDigest(
        JSON.stringify(tables.map(({ name, sha256 }) => ({ name, sha256 }))),
      ),
    });
  } finally {
    statements.clear();
    db.close();
  }
}

export function migrationFiles(frontier: string): string[] {
  return readdirSync("packages/database/migrations")
    .filter((file) => file.endsWith(".sql") && file.slice(0, 4) <= frontier)
    .sort()
    .map((file) => `packages/database/migrations/${file}`);
}

export async function populatedMigrationFixture(
  history: 12 | 24,
  frontier: "0088" | "0089",
) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
      "fixture",
      String(history),
      frontier,
    ],
    { maxBuffer: 32 * 1024 * 1024, timeout: 90_000 },
  );
  return FixtureSchema.parse(JSON.parse(stdout));
}

const quote = (value: z.infer<typeof cell>) =>
  value === null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${value.replaceAll("'", "''")}'`;
function fixtureInserts(fixture: PopulatedMigrationFixture): string[] {
  return fixture.tables.flatMap((table) => {
    const prefix = `INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(",")}) VALUES `;
    const statements: string[] = [];
    let values: string[] = [];
    let bytes = prefix.length;
    for (const row of table.rows) {
      const next = `(${row.map(quote).join(",")})`;
      if (bytes + next.length > 48_000 && values.length) {
        statements.push(prefix + values.join(","));
        values = [];
        bytes = prefix.length;
      }
      values.push(next);
      bytes += next.length + 1;
    }
    if (values.length) statements.push(prefix + values.join(","));
    return statements;
  });
}

const CounterSchema = z.object({
  statement: z.number().int().nonnegative(),
  rowsRead: z.number().int().nonnegative().safe(),
  rowsWritten: z.number().int().nonnegative().safe(),
});
export type MigrationCounters = z.infer<typeof CounterSchema>;
const worker = `import { createHash } from 'node:crypto';
export default { async fetch(request, env) {
  const body = await request.json();
  if (body.kind === 'bootstrap') {
    for (const batch of body.batches) await env.DB.batch(batch.map(sql => env.DB.prepare(sql)));
    return Response.json({ok:true});
  }
  const results = await env.DB.batch(body.sql.map(sql => env.DB.prepare(sql)));
  if (body.kind === 'digests') {
    return Response.json(results.map((result, index) => ({
      rows: result.results.length,
      sha256: createHash('sha256').update(JSON.stringify(result.results.map(row => JSON.stringify(body.columns[index].map(column => row[column]))).sort())).digest('hex'),
    })));
  }
  return Response.json(results.map((result, statement) => ({statement, rowsRead:result.meta.rows_read, rowsWritten:result.meta.rows_written})));
} };`;

const runtimeOptions = {
  script: worker,
  modules: true as const,
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
  compatibilityDate: "2026-07-28",
};

function populatedMigrationBootstrap(fixture: PopulatedMigrationFixture) {
  return JSON.stringify({
    kind: "bootstrap",
    batches: [
      ...migrationFiles(fixture.frontier).map((file) =>
        unstable_splitSqlQuery(readFileSync(file, "utf8")),
      ),
      fixture.triggers.map(({ name }) => `DROP TRIGGER ${identifier(name)}`),
      [
        "PRAGMA defer_foreign_keys=ON",
        ...fixtureInserts(fixture),
        "PRAGMA defer_foreign_keys=OFF",
      ],
      fixture.triggers.map(({ sql }) => sql),
    ],
  });
}

type PopulatedMigrationSeed = {
  directory: string;
  platformSchemaObjects: z.infer<typeof SchemaObject>[];
  close: () => void;
};

function populatedMigrationSeedInput(
  fixture: PopulatedMigrationFixture,
  platformSchemaObjects: z.infer<typeof SchemaObject>[],
) {
  return costSeedInput(
    JSON.stringify({
      frontier: fixture.frontier,
      history: fixture.history,
      objects: fixture.objects,
      runtimeOptions,
      platformSchemaObjects,
    }) + populatedMigrationBootstrap(fixture),
  );
}

export async function preparePopulatedMigrationSeed(
  fixture: PopulatedMigrationFixture,
): Promise<PopulatedMigrationSeed> {
  const directory = mkdtempSync(join(tmpdir(), "keel-migration-seed-"));
  try {
    const source = await populatedMigrationDatabase(fixture, {
      persist: join(directory, "d1"),
    });
    let platformSchemaObjects: z.infer<typeof SchemaObject>[];
    try {
      platformSchemaObjects = z
        .array(SchemaObject)
        .parse(source.platformSchemaObjects);
    } finally {
      await source.close();
    }
    sealCostSeed(
      directory,
      populatedMigrationSeedInput(fixture, platformSchemaObjects),
    );
    return {
      directory,
      platformSchemaObjects,
      close: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function populatedMigrationDatabase(
  fixture: PopulatedMigrationFixture,
  options: { persist?: string; seed?: PopulatedMigrationSeed } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "keel-populated-migration-"));
  let runtime: Miniflare | undefined;
  const close = async () => {
    try {
      await runtime?.dispose();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    if (options.seed && options.persist)
      throw new Error("A migration seed must use a fresh owned destination");
    const persist = options.persist ?? join(directory, "d1");
    const carriedPlatformObjects = options.seed
      ? z.array(SchemaObject).parse(options.seed.platformSchemaObjects)
      : undefined;
    if (options.seed)
      copyCostSeed(
        options.seed.directory,
        persist,
        populatedMigrationSeedInput(fixture, carriedPlatformObjects!),
      );
    runtime = new Miniflare({
      ...runtimeOptions,
      log: new Log(LogLevel.NONE),
      d1Persist: persist,
    });
    const database = await runtime.getD1Database("DB");
    // Miniflare adds bookmark schema after evaluating the first query's SQL.
    await database.prepare("SELECT 1").first();
    const platformSchemaObjects =
      carriedPlatformObjects ??
      z
        .array(SchemaObject)
        .parse(
          (
            await database
              .prepare(
                "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
              )
              .all()
          ).results,
        );
    if (
      platformSchemaObjects.some((platform) =>
        fixture.objects.some((object) => object.name === platform.name),
      )
    )
      throw new Error(
        "Application schema collides with pristine D1 platform schema",
      );
    runtimePlatformObjects.set(database, platformSchemaObjects);
    runtimeTableDigests.set(database, async (tables) => {
      const response = await runtime!.dispatchFetch(
        "https://synthetic-populated-migration.invalid",
        {
          method: "POST",
          body: JSON.stringify({
            kind: "digests",
            sql: tables.map(
              (table) =>
                `SELECT ${table.columns.map(identifier).join(",")} FROM ${identifier(table.name)}`,
            ),
            columns: tables.map((table) => table.columns),
          }),
        },
      );
      if (!response.ok)
        throw new Error(`Preservation read failed with ${response.status}`);
      return z.array(TableDigestSchema).parse(await response.json());
    });
    if (!options.seed) {
      const bootstrap = await runtime.dispatchFetch(
        "https://synthetic-populated-migration.invalid",
        {
          method: "POST",
          body: populatedMigrationBootstrap(fixture),
        },
      );
      if (!bootstrap.ok)
        throw new Error(`Old-schema bootstrap failed with ${bootstrap.status}`);
    }
    if (
      (await database.prepare("PRAGMA foreign_keys").first("foreign_keys")) !==
      1
    )
      throw new Error("D1 foreign keys must be enabled");
    return {
      database,
      platformSchemaObjects,
      close,
      async execute(sql: string[]) {
        const response = await runtime!.dispatchFetch(
          "https://synthetic-populated-migration.invalid",
          { method: "POST", body: JSON.stringify({ kind: "measured", sql }) },
        );
        if (!response.ok)
          throw new Error(`Measured migration failed with ${response.status}`);
        const records = z.array(CounterSchema).parse(await response.json());
        if (records.length !== sql.length)
          throw new Error("Missing migration statement counters");
        return {
          records,
          ...records.reduce(
            (sum, record) => ({
              rowsRead: sum.rowsRead + record.rowsRead,
              rowsWritten: sum.rowsWritten + record.rowsWritten,
            }),
            { rowsRead: 0, rowsWritten: 0 },
          ),
          statements: records.length,
        };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function preserveMigrationFixture(
  database: D1Database,
  fixture: PopulatedMigrationFixture,
  exactObjects = false,
) {
  const readDigests = runtimeTableDigests.get(database);
  const digests = readDigests
    ? await readDigests(fixture.tables)
    : (
        await database.batch<Record<string, unknown>>(
          fixture.tables.map((table) =>
            database.prepare(
              `SELECT ${table.columns.map(identifier).join(",")} FROM ${identifier(table.name)}`,
            ),
          ),
        )
      ).map((result, index) => ({
        rows: result.results.length,
        sha256: migrationDigest(
          canonicalRows(
            result.results.map((row) =>
              fixture.tables[index]!.columns.map((column) => row[column]),
            ),
          ),
        ),
      }));
  if (digests.length !== fixture.tables.length)
    throw new Error("Missing preservation table digests");
  for (const [index, table] of fixture.tables.entries()) {
    if (
      digests[index]!.rows !== table.rows.length ||
      digests[index]!.sha256 !== table.sha256
    )
      throw new Error(`Old rows changed in ${table.name}`);
  }
  const check = await database.prepare("PRAGMA foreign_key_check").all();
  if (check.results.length)
    throw new Error("Migration introduced foreign-key violations");
  const objects = (
    await database
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all()
  ).results;
  const expectedObjects = [
    ...fixture.objects,
    ...(runtimePlatformObjects.get(database) ?? []),
  ];
  const changed = expectedObjects.find(
    (old) =>
      !objects.some(
        (row) =>
          row.type === old.type &&
          row.name === old.name &&
          (!exactObjects || normalizedSql(row.sql) === normalizedSql(old.sql)),
      ),
  );
  if (changed)
    throw new Error(
      `Migration lost or changed old schema object ${changed.type} ${changed.name}`,
    );
  if (exactObjects && objects.length !== expectedObjects.length) {
    const extra = objects.filter(
      (row) =>
        !expectedObjects.some(
          (old) => row.type === old.type && row.name === old.name,
        ),
    );
    throw new Error(
      `Migration changed complete schema object set: ${extra.map((row) => `${String(row.type)} ${String(row.name)} ${normalizedSql(row.sql)}`).join(", ")}`,
    );
  }
  return {
    tablesPreserved: fixture.tables.length,
    schemaObjectsPreserved: fixture.objects.length,
    foreignKeyViolations: 0 as const,
  };
}

export async function immutableMigrationProbes(
  database: D1Database,
  fixture: PopulatedMigrationFixture,
) {
  for (const [name, sql] of [
    [
      "holding_position_snapshots",
      "UPDATE holding_position_snapshots SET invested_minor=0 WHERE id=?",
    ],
    [
      "holding_purchase_reviews",
      "UPDATE holding_purchase_reviews SET receipt_json='{}' WHERE id=?",
    ],
    [
      "portfolio_baseline_items",
      "DELETE FROM portfolio_baseline_items WHERE id=?",
    ],
  ]) {
    const table = fixture.tables.find((table) => table.name === name)!;
    const id = table.rows[0]?.[table.columns.indexOf("id")];
    if (typeof id !== "string")
      throw new Error(`Missing immutable fixture ${name}`);
    let failure = "";
    try {
      await database.prepare(sql!).bind(id).run();
    } catch (error) {
      failure = String(error);
    }
    if (!/immutable/iu.test(failure))
      throw new Error(`Immutable record mutation accepted in ${name}`);
  }
  return 3 as const;
}

export async function migrationForeignKeyPlans(
  database: D1Database,
  fixture: PopulatedMigrationFixture,
) {
  const lookups = fixture.foreignKeys.flatMap((fk) => {
    const table = fixture.tables.find((table) => table.name === fk.child)!;
    const column = table.columns.indexOf(fk.from);
    const positive = table.rows.find((row) => row[column] !== null)?.[column];
    return [
      "synthetic-missing-reference",
      ...(positive === undefined ? [] : [positive]),
    ].map((value) => ({ ...fk, value }));
  });
  const results = await database.batch<Record<string, unknown>>(
    lookups.map((lookup) =>
      database
        .prepare(
          `EXPLAIN QUERY PLAN SELECT rowid FROM ${identifier(lookup.child)} WHERE ${identifier(lookup.from)}=?`,
        )
        .bind(lookup.value),
    ),
  );
  return lookups.map((lookup, index) => ({
    ...lookup,
    details: results[index]!.results.map((row) => String(row.detail)),
  }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv[2] === "fixture"
) {
  let uuid = 0;
  Object.defineProperty(crypto, "randomUUID", {
    value: () =>
      `10000000-0000-4000-8000-${(++uuid).toString(16).padStart(12, "0")}`,
  });
  const originalDate = Date;
  globalThis.Date = new Proxy(originalDate, {
    construct(target, args: unknown[]) {
      return Reflect.construct(target, args.length ? args : [time]) as Date;
    },
    get(target, key, receiver) {
      return key === "now"
        ? () => originalDate.parse(time)
        : (Reflect.get(target, key, receiver) as unknown);
    },
  });
  const history = z
    .union([z.literal(12), z.literal(24)])
    .parse(Number(process.argv[3]));
  const frontier = z.enum(["0088", "0089"]).parse(process.argv[4]);
  console.log(JSON.stringify(await buildFixture(history, frontier)));
}
