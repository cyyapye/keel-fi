import { expect, it } from "vitest";
import { build } from "esbuild";
import { createCostDatabase } from "./test-support/d1-cost";
import { z } from "zod";
import {
  InvestmentTransactionsPageSchema,
  InvestmentTransactionSchema,
  InvestmentTaxLotsPageSchema,
} from "../packages/domain/src/investment-history";
import { D1InvestmentHistoryRepository } from "../packages/database/src/investment-history";
const bundle = build({
  entryPoints: ["scripts/test-support/investment-history-sync-worker.ts"],
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
const result = z.object({
  transactionRequests: z.number(),
  statusRequests: z.number(),
  quantity: z.number(),
  connectionId: z.string(),
  syncCost: z.object({
    rowsRead: z.number(),
    rowsWritten: z.number(),
    roundTrips: z.number(),
  }),
  rawPagesPreserved: z.boolean(),
  historyCost: z.object({ rowsRead: z.number(), rowsWritten: z.number() }),
  reservation: z.object({ reserved: z.number(), bound: z.number() }),
  activity: InvestmentTransactionsPageSchema,
  targets: z.array(InvestmentTransactionSchema),
  lots: InvestmentTaxLotsPageSchema,
});
it("bounds history discovery in the real sync path, retains lots and last successful activity through an outage, and admits a fixed virtual-day capacity atomically", async () => {
  const fixture = await createCostDatabase(await bundle);
  try {
    const sync = async (mode: string) => {
      const response = await fixture.dispatchFetch(
        "https://synthetic-history-sync.invalid",
        { method: "POST", body: JSON.stringify({ mode }) },
      );
      const text = await response.text();
      expect(response.status, text).toBe(200);
      return result.parse(JSON.parse(text));
    };
    const initial = await sync("success");
    expect(initial.transactionRequests).toBe(1);
    expect(initial.statusRequests).toBe(3);
    expect(initial.activity.items).toHaveLength(30);
    expect(initial.activity.context.coverage.status).toBe("complete");
    expect(initial.lots.coverage.status).toBe("complete");
    expect(initial.quantity).toBe(10_000_000);
    expect(initial.syncCost.rowsWritten).toBeLessThan(20000);
    const failed = await sync("outage");
    expect(failed.transactionRequests).toBe(1);
    expect(failed.activity.items).toHaveLength(30);
    expect(failed.activity.context.lastAttemptStatus).toBe("failed");
    expect(failed.activity.context.coverage.lastSuccessfulSyncAt).toBe(
      initial.activity.context.coverage.lastSuccessfulSyncAt,
    );
    expect(failed.quantity).toBe(initial.quantity);
    const corrected = await sync("correction");
    expect(
      corrected.targets.find((t) => t.providerTransactionId.endsWith("-0")),
    ).toMatchObject({
      revision: 2,
      quantityMicros: 4_000_000,
      presence: "reported",
    });
    expect(
      corrected.targets.find((t) => t.providerTransactionId.endsWith("-1")),
    ).toMatchObject({ revision: 1, presence: "not_in_latest_complete_report" });
    expect(failed.targets.every((t) => t.presence === "reported")).toBe(true);
    expect(corrected.quantity).toBe(initial.quantity);
    console.info(
      JSON.stringify({
        historyBudgetDiagnostics: [initial, failed, corrected].map((run) => ({
          cost: run.historyCost,
          reservation: run.reservation,
        })),
      }),
    );
    for (const run of [initial, failed, corrected]) {
      expect(run.rawPagesPreserved).toBe(true);
      expect(run.historyCost.rowsWritten).toBeLessThanOrEqual(
        run.reservation.bound,
      );
      expect(run.reservation.bound).toBeLessThanOrEqual(
        run.reservation.reserved,
      );
    }
    expect(
      initial.historyCost.rowsWritten +
        failed.historyCost.rowsWritten +
        corrected.historyCost.rowsWritten,
    ).toBeLessThanOrEqual(4000);
    const bounded = await createCostDatabase(await bundle);
    try {
      const response = await bounded.dispatchFetch(
        "https://synthetic-history-sync.invalid",
        { method: "POST", body: JSON.stringify({ mode: "bounded" }) },
      );
      const maximum = result.parse(await response.json());
      expect(maximum.transactionRequests).toBe(2);
      expect(maximum.rawPagesPreserved).toBe(true);
      expect(maximum.activity.context.coverage.status).toBe("partial");
      expect(maximum.historyCost.rowsWritten).toBeLessThanOrEqual(
        maximum.reservation.bound,
      );
      expect(maximum.reservation.reserved).toBeLessThanOrEqual(4000);
      console.info(
        JSON.stringify({
          investmentHistoryMaximumBudget: maximum.historyCost,
          reservation: maximum.reservation,
        }),
      );
    } finally {
      await bounded.close();
    }
    const repo = new D1InvestmentHistoryRepository(fixture.database);
    const account = await fixture.database
      .prepare(
        "SELECT id FROM connector_accounts WHERE household_id='hh_demo' LIMIT 1",
      )
      .first<{ id: string }>();
    await fixture.database.batch(
      Array.from({ length: 12 }, (_, index) =>
        fixture.database
          .prepare(
            `INSERT INTO connector_sync_runs(id,household_id,connector_account_id,status,started_at,finished_at,discovered_count,proposed_count)
      VALUES(?,'hh_demo',?,'succeeded','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z',0,0)`,
          )
          .bind("synthetic-history-admission-" + index, account!.id),
      ),
    );
    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        repo.admit(
          "synthetic-access-subject",
          initial.connectionId,
          "synthetic-history-admission-" + index,
          "2026-10-01T12:00:00Z",
          { baseWriteCost: 14, maxTransactions: 0 },
        ),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(3);
    expect(
      await repo.admit(
        "synthetic-access-subject",
        initial.connectionId,
        "synthetic-history-admission-0",
        "2026-10-01T12:01:00Z",
      ),
    ).toBeNull();
    expect(
      await repo.admit(
        "synthetic-access-subject",
        initial.connectionId,
        "synthetic-history-admission-" + claims.findIndex((claim) => !claim),
        "2026-10-02T12:00:00Z",
      ),
    ).not.toBeNull();
    console.info(
      JSON.stringify({
        investmentHistorySyncBudget: {
          initial: initial.syncCost,
          failure: failed.syncCost,
          correction: corrected.syncCost,
          historyOnly: [
            initial.historyCost,
            failed.historyCost,
            corrected.historyCost,
          ],
          maximumAdditionalDailyWrites: 4000,
          additionalProviderCallsPerCapture: 3,
          maxCapturesPerUtcDay: 3,
        },
      }),
    );
  } finally {
    await fixture.close();
  }
}, 45_000);
