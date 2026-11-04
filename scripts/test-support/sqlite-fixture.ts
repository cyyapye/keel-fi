import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { fixtureSourceKey, providedFixtureBytes } from "./sqlite-snapshot";

// Each isolated worker keeps immutable fixture bytes; every caller gets its own database.
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

function removeFixtureImage(path: string, fd: number) {
  const opened = fstatSync(fd);
  const entry = lstatSync(path);
  if (
    entry.dev !== opened.dev ||
    entry.ino !== opened.ino ||
    opened.nlink !== 1
  ) {
    throw new Error("SQLite fixture image changed during export");
  }
  unlinkSync(path);
}

/** Materialize the ordinary in-memory replay without sharing a mutable database. */
export function withFixtureImage<T>(
  directory: string,
  sources: readonly Buffer[],
  readImage: (fd: number) => T,
): T {
  const source = new DatabaseSync(":memory:");
  try {
    source.exec("PRAGMA foreign_keys = ON");
    for (const sql of sources) source.exec(sql.toString("utf8"));
    const path = join(directory, "snapshot.sqlite");
    // Reserve an empty, private target. VACUUM INTO refuses a nonempty database.
    const fd = openSync(path, "wx+", 0o600);
    try {
      source.prepare("VACUUM INTO ?").run(path);
      return readImage(fd);
    } finally {
      try {
        removeFixtureImage(path, fd);
      } finally {
        closeSync(fd);
      }
    }
  } finally {
    source.close();
  }
}

/** Fresh mutable database from a complete, immutable migration/seed snapshot. */
export function createSqliteFixture(files: readonly string[]): FixtureDatabase {
  const sources = files.map((file) => readFileSync(file));
  const key = fixtureSourceKey(files, sources);
  let snapshot = snapshots.get(key);
  const directory = mkdtempSync(join(tmpdir(), "keel-sqlite-fixture-"));
  try {
    if (snapshot === undefined) {
      snapshot =
        providedFixtureBytes(key) ??
        withFixtureImage(directory, sources, (fd) => readFileSync(fd));
      snapshots.set(key, snapshot);
    }
    writeFileSync(join(directory, "fixture.sqlite"), snapshot, { mode: 0o600 });
    return new FixtureDatabase(directory);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
