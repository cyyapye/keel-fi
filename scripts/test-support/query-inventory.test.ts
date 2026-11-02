import { describe, expect, it } from "vitest";
import { sourceQueries } from "./query-inventory";

describe("SQL factory discovery", () => {
  it("accounts for unchanged instrumentation forwarding while retaining every caller SQL", () => {
    const queries = sourceQueries(
      "synthetic-adapter.ts",
      `const measured = {
        prepare: (sql: string) => wrap(database.prepare(sql)),
        withSession: () => ({
          prepare: (sql: string) => wrap(session.prepare(sql)),
        }),
      };
      measured.prepare("SELECT id FROM synthetic_rows WHERE id = ?");
      measured.withSession().prepare("SELECT id FROM synthetic_rows");`,
    );
    expect(queries.map(({ sql }) => sql)).toEqual([
      "SELECT id FROM synthetic_rows WHERE id = ?",
      "SELECT id FROM synthetic_rows",
    ]);
  });

  it("rejects the original unbounded dynamic SQL factory", () => {
    expect(() =>
      sourceQueries(
        "synthetic-unsafe.ts",
        "function unsafe(sql: string) { return database.prepare(sql); }",
      ),
    ).toThrow("Unaccounted SQL factory");
  });

  it("rejects transformed SQL and unresolved caller SQL rather than treating factories as adapters", () => {
    for (const contents of [
      'const measured = { prepare: (sql: string) => wrap(database.prepare(sql + " ORDER BY id")) };',
      "const factory = { query: (sql: string) => wrap(database.prepare(sql)) };",
      "const measured = { prepare: (sql: string) => wrap(database.prepare(sql)) }; measured.prepare(externalSql);",
    ]) {
      expect(() => sourceQueries("synthetic-unsafe.ts", contents)).toThrow(
        "Unaccounted SQL factory",
      );
    }
  });
});
