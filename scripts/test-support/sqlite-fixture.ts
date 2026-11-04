import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

// Process-local, synthetic fixtures only. The key includes every ordered input;
// migration tests and the real D1 migration gate still replay migrations directly.
const snapshots = new Map<string, Buffer>();

export class FixtureDatabase extends DatabaseSync {
  private readonly compiled = new Map<string, StatementSync>();

  constructor(private readonly directory: string) {
    super(join(directory, "fixture.sqlite"));
    // Match the disposable in-memory fixtures' lack of crash durability while
    // retaining SQL transactions, rollback, constraints and foreign keys.
    this.exec(
      "PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON",
    );
    if (this.prepare("PRAGMA foreign_keys").get()!.foreign_keys !== 1) {
      this.close();
      throw new Error("SQLite fixture must enforce foreign keys");
    }
  }

  // Cursors and mutable statement options need independent handles from prepare().
  statement(sql: string): Pick<StatementSync, "get" | "all" | "run"> {
    let statement = this.compiled.get(sql);
    if (statement === undefined) {
      statement = this.prepare(sql);
      this.compiled.set(sql, statement);
    }
    return statement;
  }

  override exec(sql: string): void {
    if (sql !== "BEGIN" && sql !== "COMMIT" && sql !== "ROLLBACK") {
      this.compiled.clear();
    }
    super.exec(sql);
  }

  override close() {
    try {
      this.compiled.clear();
      super.close();
    } finally {
      rmSync(this.directory, { recursive: true, force: true });
    }
  }
}

/** Fresh mutable database from a complete, immutable migration/seed snapshot. */
export function createSqliteFixture(files: readonly string[]): FixtureDatabase {
  const sources = files.map((file) => readFileSync(file, "utf8"));
  const key = createHash("sha256")
    .update(JSON.stringify(files.map((file, index) => [file, sources[index]])))
    .digest("hex");
  let snapshot = snapshots.get(key);
  const directory = mkdtempSync(join(tmpdir(), "keel-sqlite-fixture-"));
  try {
    if (snapshot === undefined) {
      const source = new DatabaseSync(":memory:");
      try {
        source.exec("PRAGMA foreign_keys = ON");
        for (const sql of sources) source.exec(sql);
        const file = join(directory, "snapshot.sqlite");
        source.prepare("VACUUM INTO ?").run(file);
        snapshot = readFileSync(file);
        rmSync(file);
        snapshots.set(key, snapshot);
      } finally {
        source.close();
      }
    }
    writeFileSync(join(directory, "fixture.sqlite"), snapshot, { mode: 0o600 });
    return new FixtureDatabase(directory);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
