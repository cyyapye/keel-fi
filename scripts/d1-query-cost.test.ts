import { build } from "esbuild";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCostDatabase } from "./test-support/d1-cost";
import {
  placeholderCount,
  productionQueries,
} from "./test-support/query-inventory";

const planResultsSchema = z.array(
  z.object({
    index: z.int().nonnegative(),
    success: z.boolean(),
    results: z.array(
      z.object({
        id: z.int(),
        parent: z.int(),
        notused: z.int(),
        detail: z.string(),
      }),
    ),
  }),
);

let fixture: Awaited<ReturnType<typeof createCostDatabase>>;
beforeAll(async () => {
  const worker = await build({
    entryPoints: ["scripts/test-support/query-plan-worker.ts"],
    bundle: true,
    write: false,
    platform: "neutral",
    format: "esm",
    target: "es2022",
  });
  fixture = await createCostDatabase(worker.outputFiles[0]!.text);
}, 30_000);
afterAll(async () => {
  await fixture?.close();
});

describe("complete production SQL inventory", () => {
  it("compiles every SQL factory and rejects unscoped base-table scans", async () => {
    const queries = productionQueries();
    expect(queries.length).toBeGreaterThan(450);
    const planBatchSize = 64;
    const inputs = queries.map((query, index) => ({
      index,
      sql: query.sql,
      bindings: Array<null>(placeholderCount(query.sql)).fill(null),
    }));
    const planResults: z.infer<typeof planResultsSchema> = [];
    let planBatchCount = 0;
    for (let index = 0; index < inputs.length; index += planBatchSize) {
      const batch = inputs.slice(index, index + planBatchSize);
      const response = await fixture.dispatchFetch(
        "https://synthetic-query-plans.invalid/",
        {
          method: "POST",
          body: JSON.stringify(batch),
        },
      );
      if (!response.ok)
        throw new Error(
          `EXPLAIN batch at query ${index}: ${await response.text()}`,
        );
      const results = planResultsSchema.parse(await response.json());
      expect(results.map((result) => result.index)).toEqual(
        batch.map((query) => query.index),
      );
      planResults.push(...results);
      planBatchCount++;
    }
    expect(planBatchCount).toBe(Math.ceil(queries.length / planBatchSize));
    expect(planResults).toHaveLength(queries.length);
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
    for (const [index, query] of queries.entries()) {
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
      const planResult = planResults[index]!;
      expect(
        planResult.success,
        `${query.file}:${query.line} ${query.method}`,
      ).toBe(true);
      const plan = planResult.results;
      if (/^\s*SELECT\b/iu.test(query.sql))
        expect(
          plan.length,
          `${query.file}:${query.line} empty SELECT plan`,
        ).toBeGreaterThan(0);
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
    // Seed the same holdout in one statement so setup does not dominate this
    // counter assertion when native unit and browser lanes share the CI host.
    await fixture.database
      .prepare(
        `WITH RECURSIVE holdout(id) AS (
          SELECT 0 UNION ALL SELECT id + 1 FROM holdout WHERE id < 119
        )
        INSERT INTO cost_counter_holdout (id, label)
        SELECT CAST(id AS TEXT), 'synthetic' FROM holdout`,
      )
      .run();
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
