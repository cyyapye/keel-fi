import { expect, it } from "vitest";
import { build } from "esbuild";
import { z } from "zod";
import { createApp } from "../apps/api/src/app";
import type { Env } from "../apps/api/src/types";
import { AppAccessStore } from "../apps/api/src/app-access/store";
import {
  positionDetail,
  positionPage,
} from "../apps/api/src/agent-api/resources";
import { COST_SUBJECT } from "./test-support/cost-fixtures";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";

const worker = build({
  entryPoints: ["scripts/test-support/owner-position-economics-worker.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["browser", "module", "main"],
  external: ["node:*", "cloudflare:*"],
  logLevel: "silent",
}).then((bundled) => bundled.outputFiles[0]!.text);

it("exposes accepted fractional quantities and whole-position cost basis through MCP and HTTP without inferring missing values", async () => {
  const fixture = await createCostDatabase(await worker);
  try {
    const db = fixture.database;
    async function accept(round: 0 | 1) {
      const response = await fixture.dispatchFetch(
        "https://synthetic-position-setup.invalid",
        {
          method: "POST",
          body: JSON.stringify({ round }),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ round, complete: true });
    }
    await accept(0);
    const meter = measureD1(db),
      store = new AppAccessStore(db);
    const key = await store.createKey(
      await store.owner(COST_SUBJECT),
      "Synthetic position reader",
      ["holdings:read"],
      30,
      false,
    );
    const app = createApp(),
      origin = "https://api.keel.invalid";
    const env = {
      ENVIRONMENT: "preview",
      DB: meter.database,
      APP_ACCESS_API_ORIGIN: origin,
      APP_ACCESS_WEB_ORIGIN: "https://keel.invalid",
    } as unknown as Env;
    const headers = {
      Authorization: "Bearer " + key.key,
      "Content-Type": "application/json",
    };
    async function call<T>(name: string, args: object, schema: z.ZodType<T>) {
      meter.reset();
      const response = await app.request(
        origin + "/mcp",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args, _meta: { progressToken: 1 } },
          }),
        },
        env,
      );
      expect(response.status).toBe(200);
      const rpc = z
        .object({
          result: z.object({
            isError: z.literal(false),
            content: z.array(z.object({ text: z.string() })).length(1),
          }),
        })
        .parse(await response.json());
      const result = z
        .object({ status: z.literal(200), data: schema })
        .parse(JSON.parse(rpc.result.content[0]!.text));
      expect(meter.cost.rowsWritten).toBe(0);
      expect(meter.cost.roundTrips).toBeLessThanOrEqual(3);
      expect(meter.cost.rowsRead).toBeLessThan(1300);
      return { data: result.data, cost: meter.cost.rowsRead };
    }
    async function allPositions() {
      const items: z.infer<typeof positionPage>["items"] = [];
      let after: string | null = null;
      do {
        const page: { data: z.infer<typeof positionPage>; cost: number } =
          await call("listPositions", after ? { after } : {}, positionPage);
        items.push(...page.data.items);
        after = page.data.nextAfter;
      } while (after);
      return items;
    }
    const first = await allPositions();
    expect(
      first.filter((p) => p.provider === "plaid_investments"),
    ).toHaveLength(120);
    const target = first.find((p) => p.ticker === "S0")!;
    expect(target).toMatchObject({
      quantityMicros: 1_000_000,
      costBasisMinor: 10000,
    });
    const before = await call(
      "getPosition",
      { positionId: target.id },
      positionDetail,
    );
    // The same observation date with a newer accepted application must not return old economics.
    // Setup also adds 120 unrelated accepted positions, which must remain isolated.
    await accept(1);
    const current = await allPositions();
    expect(current).toHaveLength(first.length);
    const updated = current.find((p) => p.id === target.id)!;
    expect(updated).toMatchObject({
      ticker: "S0",
      quantityMicros: 2_345_678,
      costBasisMinor: 23456,
      currency: "USD",
      ownership: "recorded",
    });
    expect(updated.observedAt).toBe(target.observedAt);
    expect(updated.latestSnapshotId).not.toBe(target.latestSnapshotId);
    expect(updated.evidenceId).not.toBe(target.evidenceId);
    expect(current.find((p) => p.ticker === "S1")).toMatchObject({
      quantityMicros: 2_345_678,
      costBasisMinor: null,
    });
    expect(current.find((p) => p.ticker === "S2")).toMatchObject({
      quantityMicros: 0,
      costBasisMinor: 0,
    });
    expect(current.find((p) => p.provider === "sydecar")).toMatchObject({
      ticker: null,
      quantityMicros: null,
      costBasisMinor: null,
    });
    const detail = await call(
      "getPosition",
      { positionId: target.id },
      positionDetail,
    );
    expect(detail.data).toMatchObject(updated);
    expect(detail.cost).toBeLessThanOrEqual(before.cost + 2);
    meter.reset();
    const http = await app.request(
      origin + "/api/v1/positions/" + encodeURIComponent(target.id),
      { headers },
      env,
    );
    expect(http.status).toBe(200);
    expect(positionDetail.parse(await http.json())).toEqual(detail.data);
    expect(meter.cost).toMatchObject({ rowsWritten: 0, roundTrips: 2 });
    // Inspect the executed projection, including its correlated ownership lookup.
    for (const sql of meter.queries) {
      const plan = await db
        .prepare("EXPLAIN QUERY PLAN " + sql)
        .bind(...Array.from(sql.matchAll(/\?/g), () => null))
        .all<{ detail: string }>();
      for (const row of plan.results)
        expect(row.detail, sql).not.toMatch(/^SCAN (?:p|s|h|iv|ih|o|k|a)\b/);
    }
  } finally {
    await fixture.close();
  }
}, 30000);
