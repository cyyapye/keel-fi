import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/api/src/app";
import type { Env } from "../apps/api/src/types";
import { AppAccessStore } from "../apps/api/src/app-access/store";
import {
  positionDetail,
  positionPage,
} from "../apps/api/src/agent-api/resources";
import { D1HoldingImportRepository } from "../packages/database/src/holding-imports";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { COST_SUBJECT, syntheticDigest } from "./test-support/cost-fixtures";
import { measureD1 } from "./test-support/d1-cost";
import { publicInventoryCostInput } from "./test-support/public-inventory-cost-worker";

it("exposes accepted fractional quantities and whole-position cost basis through MCP and HTTP without inferring missing values", async () => {
  const fixture = await createCostFixtureDatabase({ operation: "holdings" });
  try {
    const db = fixture.database;
    await db.batch([
      db.prepare(`INSERT INTO investment_connections(id,household_id,adapter_type,protected_source_key,created_by_user_id,created_at,immutable)
        VALUES ('synthetic_public_migration_hh_demo','hh_demo','plaid-investments','${"a".repeat(64)}','usr_demo','2026-08-01T12:00:00.000Z',1)`),
      db.prepare(`INSERT INTO investment_connection_versions(id,household_id,connection_id,version,institution_key,institution_label,lifecycle_state,credential_reference,supersedes_version_id,recorded_by_user_id,recorded_at,immutable)
        VALUES ('synthetic-public-v1','hh_demo','synthetic_public_migration_hh_demo',1,'synthetic_public','Synthetic Brokerage','active','synthetic-secret-reference',NULL,'usr_demo','2026-08-01T12:00:00.000Z',1)`),
    ]);
    const imports = new D1HoldingImportRepository(db);
    async function accept(round: number) {
      const input = publicInventoryCostInput(round, false);
      delete input.inventoryEvidence;
      input.rows = input.rows.map((row, index) => ({
        ...row,
        securityType: "equity",
        quantityMicros: round === 0 ? 1_000_000 : index === 2 ? 0 : 2_345_678,
        costBasisMinor:
          round === 0 ? 10000 : index === 1 ? null : index === 2 ? 0 : 23456,
        marketValueMinor: index === 2 && round > 0 ? 0 : 34567,
        issues: index === 1 && round > 0 ? ["Cost basis is unavailable."] : [],
      }));
      input.canonicalScope.rows[119] = {
        ...input.canonicalScope.rows[119]!,
        publicExposureIdentityKind: "cusip",
        protectedExposureKey: syntheticDigest(900),
      };
      const staged = await imports.stagePlaidInvestmentsHoldingImport(
        COST_SUBJECT,
        input,
      );
      await imports.applyHoldingImport(COST_SUBJECT, staged.preview.id, {
        currency: "USD",
        decisions: staged.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
          rationale: "Accept synthetic position economics.",
        })),
      });
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
    // Unrelated accepted portfolios must neither leak nor enlarge this read.
    await db.batch([
      db.prepare(
        "INSERT INTO users(id,access_subject,email,display_name,created_at) VALUES('economics-other-user','synthetic-economics-other','economics-other@synthetic.invalid','Synthetic other owner','2026-08-01')",
      ),
      db.prepare(
        "INSERT INTO households(id,owner_user_id,name,base_currency,created_at) VALUES('economics-other-household','economics-other-user','Synthetic other household','USD','2026-08-01')",
      ),
    ]);
    await fixture.setup({
      operation: "holdings",
      subject: "synthetic-economics-other",
    });
    // The same observation date with a newer accepted application must not return old economics.
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
