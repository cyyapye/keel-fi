import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { createSqliteFixture } from "./sqlite-fixture";

it("isolates copied rows, schema and transactions while preserving constraints and cleanup", () => {
  const root = mkdtempSync(join(tmpdir(), "keel-fixture-input-"));
  const file = join(root, "seed.sql");
  writeFileSync(
    file,
    `
    CREATE TABLE parent (id INTEGER PRIMARY KEY, label TEXT UNIQUE);
    CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
    CREATE TABLE events (label TEXT);
    CREATE TRIGGER audit AFTER INSERT ON child BEGIN INSERT INTO events VALUES ('child'); END;
    CREATE VIEW labels AS SELECT label FROM parent;
    INSERT INTO parent VALUES (1, 'synthetic');
  `,
  );
  const first = createSqliteFixture([file]);
  const second = createSqliteFixture([file]);
  const directories = [first, second].map((database) =>
    dirname(database.prepare("PRAGMA database_list").get()!.file as string),
  );
  try {
    first.exec("BEGIN; INSERT INTO child VALUES (1, 1); ROLLBACK;");
    expect(first.prepare("SELECT * FROM events").all()).toEqual([]);
    expect(() => first.exec("INSERT INTO child VALUES (1, 2)")).toThrow();
    first.exec(
      "INSERT INTO child VALUES (1, 1); UPDATE parent SET label = 'changed'; CREATE TABLE extra (id INTEGER);",
    );
    expect(first.prepare("SELECT * FROM events").all()).toEqual([
      { label: "child" },
    ]);
    expect(second.prepare("SELECT * FROM labels").all()).toEqual([
      { label: "synthetic" },
    ]);
    expect(second.prepare("SELECT * FROM child").all()).toEqual([]);
    expect(() => second.prepare("SELECT * FROM extra")).toThrow();
    expect(() =>
      second.exec("INSERT INTO parent VALUES (2, 'synthetic')"),
    ).toThrow();
  } finally {
    first.close();
    second.close();
    rmSync(root, { recursive: true, force: true });
  }
  expect(directories.map((directory) => existsSync(directory))).toEqual([
    false,
    false,
  ]);
});

it("invalidates changed or reordered inputs and rejects incomplete migrations", () => {
  const root = mkdtempSync(join(tmpdir(), "keel-fixture-input-"));
  const schema = join(root, "schema.sql");
  const seed = join(root, "seed.sql");
  writeFileSync(schema, "CREATE TABLE items (id INTEGER PRIMARY KEY);");
  writeFileSync(seed, "INSERT INTO items VALUES (1);");
  try {
    const first = createSqliteFixture([schema, seed]);
    first.close();
    writeFileSync(seed, "INSERT INTO items VALUES (2);");
    const changed = createSqliteFixture([schema, seed]);
    try {
      expect(changed.prepare("SELECT * FROM items").all()).toEqual([{ id: 2 }]);
    } finally {
      changed.close();
    }
    expect(() => createSqliteFixture([seed, schema])).toThrow();
    writeFileSync(seed, "INVALID SYNTHETIC SQL");
    expect(() => createSqliteFixture([schema, seed])).toThrow();
    writeFileSync(seed, "INSERT INTO items VALUES (3);");
    const repaired = createSqliteFixture([schema, seed]);
    try {
      expect(repaired.prepare("SELECT * FROM items").all()).toEqual([
        { id: 3 },
      ]);
    } finally {
      repaired.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
