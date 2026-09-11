import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCostDatabase } from "./test-support/d1-cost";
import {
  placeholderCount,
  productionQueries,
} from "./test-support/query-inventory";

let fixture: Awaited<ReturnType<typeof createCostDatabase>>;
beforeAll(async () => {
  fixture = await createCostDatabase();
}, 30_000);
afterAll(async () => {
  await fixture?.close();
});

describe("complete production SQL inventory", () => {
  it("compiles every SQL factory and rejects unscoped base-table scans", async () => {
    const queries = productionQueries();
    expect(queries.length).toBeGreaterThan(450);
    const objects = (
      await fixture.database
        .prepare(
          "SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table', 'view')",
        )
        .all<{ name: string; type: string; sql: string | null }>()
    ).results;
    const views = new Map(
      objects
        .filter((row) => row.type === "view")
        .map((row) => [row.name, row.sql ?? ""]),
    );
    const tables = new Set(
      objects.filter((row) => row.type === "table").map((row) => row.name),
    );
    const failures: string[] = [];
    for (const query of queries) {
      // Include referenced view bodies; otherwise a view can conceal its scan.
      let expanded = query.sql;
      const expandedViews = new Set<string>();
      for (let pass = 0; pass < views.size; pass++) {
        let changed = false;
        for (const [name, sql] of views) {
          if (
            !expandedViews.has(name) &&
            new RegExp(`\\b${name}\\b`, "u").test(expanded)
          ) {
            expanded += `\n${sql}`;
            expandedViews.add(name);
            changed = true;
          }
        }
        if (!changed) break;
      }
      const sources = new Set<string>();
      for (const match of expanded.matchAll(
        /\b(?:FROM|JOIN|UPDATE)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/giu,
      )) {
        if (tables.has(match[1]!)) {
          if (
            match[2] &&
            !/^(WHERE|SET|ON|JOIN|LEFT|RIGHT|INNER|CROSS|ORDER|GROUP|LIMIT|UNION|VALUES|SELECT)$/iu.test(
              match[2],
            )
          )
            sources.add(match[2]);
          else sources.add(match[1]!);
        }
      }
      const plan = (
        await fixture.database
          .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
          .bind(...Array<null>(placeholderCount(query.sql)).fill(null))
          .all<{ id: number; parent: number; detail: string }>()
      ).results;
      const derived = new Set(
        plan.flatMap(
          (step) =>
            /^(?:CO-ROUTINE|MATERIALIZE) (\w+)/u.exec(step.detail)?.slice(1) ??
            [],
        ),
      );
      for (const step of plan) {
        const scan = /^SCAN (\w+)/u.exec(step.detail);
        if (scan && sources.has(scan[1]!) && !derived.has(scan[1]!)) {
          if (
            query.file === "apps/api/src/deployment-smoke.ts" &&
            query.method === "runDeploymentSmoke" &&
            /ORDER BY id\s+LIMIT 1/u.test(query.sql) &&
            step.detail === "SCAN users USING INDEX sqlite_autoindex_users_1"
          )
            continue;
          // This protected deployment-only operation intentionally chooses one
          // user. Its deterministic ordering is indexed by the cost migration.
          failures.push(
            `${query.file}:${query.line} ${query.method}: ${step.detail}`,
          );
        }
        if (/AUTOMATIC/u.test(step.detail))
          failures.push(`${query.file}:${query.line}: ${step.detail}`);
      }
    }
    expect(failures).toEqual([]);
  }, 30_000);

  it("counts rows scanned even when a lookup returns nothing", async () => {
    await fixture.database
      .prepare(
        "CREATE TABLE cost_counter_holdout (id TEXT PRIMARY KEY, label TEXT NOT NULL)",
      )
      .run();
    await fixture.database.batch(
      Array.from({ length: 120 }, (_, index) =>
        fixture.database
          .prepare("INSERT INTO cost_counter_holdout VALUES (?, 'synthetic')")
          .bind(String(index)),
      ),
    );
    const scan = await fixture.database
      .prepare("SELECT id FROM cost_counter_holdout WHERE label = 'absent'")
      .all();
    const lookup = await fixture.database
      .prepare("SELECT id FROM cost_counter_holdout WHERE id = 'absent'")
      .all();
    expect(scan.results).toEqual([]);
    expect(lookup.results).toEqual([]);
    expect(scan.meta.rows_read).toBe(120);
    expect(lookup.meta.rows_read).toBe(0);
  });
});
