import { expect, it } from "vitest";
import { build } from "esbuild";
import { z } from "zod";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import { AppAccessStore } from "../apps/api/src/app-access/store";
import { createApp } from "../apps/api/src/app";
import type { Env } from "../apps/api/src/types";
import { D1InvestmentHistoryRepository } from "../packages/database/src/investment-history";
import {
  InvestmentTransactionsPageSchema,
  InvestmentTaxLotsPageSchema,
  InvestmentReconciliationSchema,
} from "../packages/domain/src/investment-history";
import { COST_SUBJECT } from "./test-support/cost-fixtures";
const bundle = build({
  entryPoints: ["scripts/test-support/investment-history-worker.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["browser", "module", "main"],
  external: ["node:*", "cloudflare:*"],
  logLevel: "silent",
}).then((result) => result.outputFiles[0]!.text);

it("keeps corrected investment activity and reported lots scoped, paginated, read-only and independent of growing history through HTTP and MCP", async () => {
  const fixture = await createCostDatabase(await bundle);
  try {
    const setup = async (body: object) => {
      const response = await fixture.dispatchFetch(
        "https://synthetic-history.invalid",
        { method: "POST", body: JSON.stringify(body) },
      );
      const text = await response.text();
      expect(response.status, text).toBe(200);
      return z
        .object({
          positions: z.array(z.string()).length(120),
          foreignPosition: z.string(),
          accountId: z.string(),
        })
        .parse(JSON.parse(text));
    };
    const identities = await setup({ action: "seed" });
    await setup({ action: "history", from: 1, through: 12 });
    const meter = measureD1(fixture.database),
      store = new AppAccessStore(fixture.database),
      owner = await store.owner(COST_SUBJECT);
    const key = await store.createKey(
      owner,
      "Synthetic investment history reader",
      ["holdings:read", "cash:read", "evidence:read"],
      30,
      false,
    );
    const narrow = await store.createKey(
      owner,
      "Synthetic holdings-only reader",
      ["holdings:read"],
      30,
      false,
    );
    const app = createApp(),
      origin = "https://api.keel.invalid",
      env = {
        ENVIRONMENT: "preview",
        DB: meter.database,
        APP_ACCESS_API_ORIGIN: origin,
        APP_ACCESS_WEB_ORIGIN: "https://keel.invalid",
      } as unknown as Env;
    const headers = {
      Authorization: "Bearer " + key.key,
      "Content-Type": "application/json",
    };
    const get = async (
      path: string,
      query: Record<string, string>,
      schema: z.ZodType,
    ) => {
      meter.reset();
      const response = await app.request(
        origin +
          "/api/v1/" +
          path +
          "?" +
          new URLSearchParams(query).toString(),
        { headers },
        env,
      );
      const text = await response.text();
      expect(response.status, text).toBe(200);
      const data = schema.parse(JSON.parse(text));
      expect(meter.cost.rowsWritten).toBe(0);
      expect(meter.cost.roundTrips).toBeLessThanOrEqual(3);
      expect(meter.cost.rowsRead).toBeLessThan(1200);
      return { data, cost: meter.cost.rowsRead };
    };
    const repository = new D1InvestmentHistoryRepository(meter.database);
    const positionId = identities.positions[0]!;
    const rec12 = await repository.reconciliation("hh_demo", { positionId });
    expect(rec12!.status).toBe("insufficient_timing");
    const revision = rec12!.context.readContextId!;
    const first = await get(
      "investment-transactions",
      { positionId, readContextId: revision },
      InvestmentTransactionsPageSchema,
    );
    const firstPage = InvestmentTransactionsPageSchema.parse(first.data);
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.items[0]!.revision).toBe(12);
    expect(firstPage.items[0]!.previous).not.toBeNull();
    const second = InvestmentTransactionsPageSchema.parse(
      (
        await get(
          "investment-transactions",
          { positionId, readContextId: revision, after: firstPage.nextAfter! },
          InvestmentTransactionsPageSchema,
        )
      ).data,
    );
    expect(
      new Set([...firstPage.items, ...second.items].map((t) => t.id)).size,
    ).toBe(100);
    const lots = InvestmentTaxLotsPageSchema.parse(
      (
        await get(
          "tax-lots",
          { positionId, readContextId: revision },
          InvestmentTaxLotsPageSchema,
        )
      ).data,
    );
    expect(lots.items).toHaveLength(50);
    expect(lots.items[0]!.costBasisMinor).toBe(10119);
    expect(lots.coverage.status).toBe("partial");
    const oldest = InvestmentTaxLotsPageSchema.parse(
      (
        await get(
          "tax-lots",
          { positionId, readContextId: revision, sort: "oldest" },
          InvestmentTaxLotsPageSchema,
        )
      ).data,
    );
    expect(oldest.items[0]!.costBasisMinor).toBe(10000);
    expect(oldest.items[1]!.costBasisMinor).toBe(10001);
    const lotNext = InvestmentTaxLotsPageSchema.parse(
      (
        await get(
          "tax-lots",
          { positionId, readContextId: revision, after: lots.nextAfter! },
          InvestmentTaxLotsPageSchema,
        )
      ).data,
    );
    expect(
      new Set([...lots.items, ...lotNext.items].map((l) => l.id)).size,
    ).toBe(100);
    const empty = InvestmentTransactionsPageSchema.parse(
      (
        await get(
          "investment-transactions",
          { accountId: identities.accountId, type: "sell" },
          InvestmentTransactionsPageSchema,
        )
      ).data,
    );
    expect(empty.items).toEqual([]);
    const wrong = await app.request(
      origin + "/api/v1/tax-lots?positionId=" + identities.foreignPosition,
      { headers },
      env,
    );
    expect(wrong.status).toBe(404);
    const limited = await app.request(
      origin + "/api/v1/investment-transactions?positionId=" + positionId,
      { headers: { Authorization: "Bearer " + narrow.key } },
      env,
    );
    expect(limited.status).toBe(403);
    const toolResponse = await app.request(
      origin + "/mcp",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "listTaxLots",
            arguments: { positionId, readContextId: revision },
          },
        }),
      },
      env,
    );
    const rpc = z
      .object({
        result: z.object({
          isError: z.literal(false),
          content: z.array(z.object({ text: z.string() })),
        }),
      })
      .parse(await toolResponse.json());
    expect(
      InvestmentTaxLotsPageSchema.parse(
        JSON.parse(rpc.result.content[0]!.text).data,
      ).context.readContextId,
    ).toBe(revision);
    await expect(
      fixture.database
        .prepare(
          "UPDATE investment_transaction_observations SET fingerprint='changed'",
        )
        .run(),
    ).rejects.toThrow(/immutable/);
    await expect(
      fixture.database.prepare("DELETE FROM investment_tax_lots").run(),
    ).rejects.toThrow(/immutable/);
    await setup({ action: "history", from: 13, through: 24 });
    const stale = await app.request(
      origin +
        "/api/v1/tax-lots?" +
        new URLSearchParams({ positionId, readContextId: revision }).toString(),
      { headers },
      env,
    );
    expect(stale.status).toBe(409);
    const grown = await get(
      "investment-transactions",
      { positionId },
      InvestmentTransactionsPageSchema,
    );
    expect(grown.cost).toBeLessThanOrEqual(first.cost + 20);
    expect(
      InvestmentTransactionsPageSchema.parse(grown.data).items[0]!.revision,
    ).toBe(24);
    await get(
      "investment-reconciliation",
      { positionId },
      InvestmentReconciliationSchema,
    );
    const plans = await fixture.database
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM investment_transaction_heads WHERE container_id=? AND position_id=? AND (posted_on,transaction_key)<(?,?) ORDER BY posted_on DESC,transaction_key DESC LIMIT 51",
      )
      .bind(identities.accountId.slice(10), positionId, "2026-08-11", "z")
      .all<{ detail: string }>();
    expect(
      plans.results.some((r) =>
        r.detail.includes("investment_transaction_position_page"),
      ),
    ).toBe(true);
    expect(plans.results.some((r) => /SCAN/.test(r.detail))).toBe(false);
    console.info(
      JSON.stringify({
        investmentHistoryReadBudget: {
          items: 120,
          historyPerItem: [12, 24],
          firstRowsRead: first.cost,
          grownRowsRead: grown.cost,
          foreignHousehold: true,
          writes: 0,
        },
      }),
    );
  } finally {
    await fixture.close();
  }
}, 60_000);
