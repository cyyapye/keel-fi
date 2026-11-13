import { z } from "zod";
import { ShareBasisSchema } from "../../packages/domain/src/valuation-record";
import { D1InvestmentConnectionsRepository } from "../../packages/database/src/investment-connections";
import { refreshAcceptedPortfolioBaseline } from "../../packages/database/src/portfolio-baseline";
import { measureD1 } from "./d1-meter";
import { baselineCostRepositories } from "./portfolio-baseline-cost";
import { setupProviderReconnectCost } from "./provider-reconnect-cost";
import { portfolioWatchSourceCost } from "./portfolio-watch-cost";
import {
  COST_SUBJECT,
  seedCostHoldings,
  seedCostProposals,
  seedCostWatchTargets,
  syntheticDigest,
} from "./cost-fixtures";

const setupOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("holdings"),
    subject: z.string().optional(),
    revision: z.number().int().positive().optional(),
    legacy: z.boolean().optional(),
    fixedTime: z.iso.datetime().optional(),
    interruptPricePropagation: z.boolean().optional(),
    interruptGpTotalPropagation: z.boolean().optional(),
    observations: z
      .object({
        positionCount: z.number().int().min(120).max(500).optional(),
        status: z.enum(["Live", "Realized"]).optional(),
        investedMinor: z.number().int().optional(),
        allocationMinor: z.number().int().optional(),
        sharePrices: z
          .object({
            costMicros: z.number().int().nullable(),
            markMicros: z.number().int().nullable(),
            markDate: z.iso.date().nullable(),
            shareClass: z.string().nullable(),
            shareBasis: ShareBasisSchema.nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .optional(),
  }),
  z.object({
    operation: z.literal("portfolio-watch"),
    nextCheckAt: z.string().datetime(),
  }),
  z
    .object({
      operation: z.literal("baseline-refresh"),
      missingPosition: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal("read-budgets") }).strict(),
  z.object({ operation: z.literal("forecast-history") }).strict(),
  z.object({ operation: z.literal("provider-reconnect") }).strict(),
  z.object({ operation: z.literal("portfolio-watch-day") }).strict(),
  z
    .object({
      operation: z.literal("position-link-history"),
      positions: z
        .array(
          z
            .object({
              id: z.string().min(1).max(256),
              snapshotId: z.string().min(1).max(256),
            })
            .strict(),
        )
        .length(120),
      reviewIds: z.array(z.string().uuid()).length(60),
    })
    .strict(),
  z.object({ operation: z.literal("watch-targets") }).strict(),
]);
export type CostFixtureSetupOperation = z.input<typeof setupOperationSchema>;

async function seedForecastHistory(database: D1Database) {
  const snapshot = await database
    .prepare(
      "SELECT * FROM forecast_snapshots WHERE household_id = 'hh_demo' ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .first<Record<string, string | number | null>>();
  if (!snapshot) throw new Error("Synthetic forecast missing");
  const children = await Promise.all(
    ["company_forecasts", "liquidity_curves", "forecast_outputs"].map(
      async (table) => ({
        table,
        rows: (
          await database
            .prepare(`SELECT * FROM ${table} WHERE forecast_snapshot_id = ?`)
            .bind(snapshot.id)
            .all<Record<string, string | number | null>>()
        ).results,
      }),
    ),
  );
  const writes: D1PreparedStatement[] = [];
  const insert = (
    table: string,
    row: Record<string, string | number | null>,
  ) => {
    writes.push(
      database
        .prepare(
          `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.keys(
            row,
          )
            .map(() => "?")
            .join(", ")})`,
        )
        .bind(...Object.values(row)),
    );
  };
  for (let index = 0; index < 120; index++) {
    const id = `synthetic-cost-history-${index}`;
    insert("forecast_snapshots", {
      ...snapshot,
      id,
      version: Number(snapshot.version) + index + 1,
      input_hash: syntheticDigest(50_000 + index),
    });
    for (const child of children)
      for (const row of child.rows) {
        insert(child.table, {
          ...row,
          id: `${row.id}-cost-${index}`,
          forecast_snapshot_id: id,
        });
      }
  }
  await database.batch(writes);
}

// Synthetic fixture setup runs beside D1 to avoid repeated Node-to-D1 RPC
// overhead. Read-budget captures remain explicitly metered and return their
// real D1 counters. This worker is test support and has no app runtime.
export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    const parsed = setupOperationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const operation = parsed.data;
    let result: Record<string, unknown>;
    if (operation.operation === "holdings") {
      const observations = operation.observations;
      const database =
        operation.interruptPricePropagation ||
        operation.interruptGpTotalPropagation
          ? new Proxy(bindings.DB, {
              get(target, key) {
                if (key === "prepare")
                  return (sql: string) => {
                    if (sql.includes("SELECT link.household_id"))
                      if (operation.interruptPricePropagation)
                        throw new Error("synthetic projection interruption");
                    if (
                      operation.interruptGpTotalPropagation &&
                      sql.includes("SELECT h.household_id,u.id user_id")
                    )
                      throw new Error("synthetic projection interruption");
                    return target.prepare(sql);
                  };
                const value: unknown = Reflect.get(target, key);
                return typeof value === "function"
                  ? (value as (...args: unknown[]) => unknown).bind(target)
                  : value;
              },
            })
          : bindings.DB;
      // Preserve tied application timestamps when fixture setup moves beside
      // D1. This clock is scoped to a sequential synthetic setup request.
      const originalDate = Date;
      const fixedTime = operation.fixedTime;
      if (fixedTime)
        globalThis.Date = new Proxy(originalDate, {
          construct(target, args): Date {
            return Reflect.construct(
              target,
              args.length ? args : [fixedTime],
            ) as Date;
          },
          get(target, key, receiver): unknown {
            return key === "now"
              ? () => originalDate.parse(fixedTime)
              : Reflect.get(target, key, receiver);
          },
        });
      let importId: string;
      try {
        importId = await seedCostHoldings(
          database,
          operation.subject,
          operation.revision,
          operation.legacy,
          observations
            ? {
                ...(observations.positionCount === undefined
                  ? {}
                  : { positionCount: observations.positionCount }),
                ...(observations.status === undefined
                  ? {}
                  : { status: observations.status }),
                ...(observations.investedMinor === undefined
                  ? {}
                  : { investedMinor: observations.investedMinor }),
                ...(observations.allocationMinor === undefined
                  ? {}
                  : { allocationMinor: observations.allocationMinor }),
                ...(observations.sharePrices === undefined
                  ? {}
                  : {
                      sharePrices: {
                        costMicros: observations.sharePrices.costMicros,
                        markMicros: observations.sharePrices.markMicros,
                        markDate: observations.sharePrices.markDate,
                        shareClass: observations.sharePrices.shareClass,
                        ...(observations.sharePrices.shareBasis === undefined
                          ? {}
                          : {
                              shareBasis: observations.sharePrices.shareBasis,
                            }),
                      },
                    }),
              }
            : undefined,
        );
      } catch (error) {
        if (
          (operation.interruptPricePropagation ||
            operation.interruptGpTotalPropagation) &&
          error instanceof Error &&
          error.message === "synthetic projection interruption"
        )
          return new Response(error.message, { status: 409 });
        throw error;
      } finally {
        globalThis.Date = originalDate;
      }
      result = { operation: operation.operation, importId };
    } else if (operation.operation === "baseline-refresh") {
      const measured = measureD1(bindings.DB);
      const { baseline } = baselineCostRepositories(
        measured.database,
        () => operation.missingPosition,
      );
      const refresh = await refreshAcceptedPortfolioBaseline(
        baseline,
        COST_SUBJECT,
      );
      result = {
        operation: operation.operation,
        ...refresh,
        cost: measured.cost,
      };
    } else if (operation.operation === "position-link-history") {
      const statements = [];
      for (let index = 0; index < operation.positions.length; index += 2) {
        const source = operation.positions[index]!;
        const target = operation.positions[index + 1]!;
        statements.push(
          bindings.DB.prepare(
            `INSERT INTO holding_position_link_reviews(id,household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,source_participation_review_id,target_participation_review_id,prior_id,relationship,state,use_source_value,note,reviewer_user_id,accepted_at)
          VALUES(?,'hh_demo',?,?,?,?,NULL,NULL,(SELECT review_id FROM holding_position_link_heads WHERE source_position_id=?),'same_investment','linked',1,'Synthetic cost history','usr_demo','2026-09-20T12:00:00.000Z')`,
          ).bind(
            operation.reviewIds[index / 2]!,
            source.id,
            target.id,
            source.snapshotId,
            target.snapshotId,
            source.id,
          ),
        );
      }
      const applied = await bindings.DB.batch(statements);
      result = {
        operation: operation.operation,
        statementCount: applied.length,
      };
    } else if (operation.operation === "forecast-history") {
      await seedForecastHistory(bindings.DB);
      result = { operation: operation.operation, completed: true };
    } else if (operation.operation === "watch-targets") {
      await seedCostWatchTargets(bindings.DB);
      result = { operation: operation.operation, completed: true };
    } else if (operation.operation === "portfolio-watch") {
      const importId = await seedCostHoldings(bindings.DB);
      await seedCostWatchTargets(bindings.DB);
      await bindings.DB.prepare(
        "UPDATE portfolio_watch_source_sync_state SET next_check_at = ?",
      )
        .bind(operation.nextCheckAt)
        .run();
      result = { operation: operation.operation, importId };
    } else if (operation.operation === "portfolio-watch-day") {
      result = {
        operation: operation.operation,
        results: await portfolioWatchSourceCost(bindings.DB),
      };
    } else if (operation.operation === "provider-reconnect") {
      result = {
        operation: operation.operation,
        results: await setupProviderReconnectCost(bindings.DB),
      };
    } else {
      const measured = measureD1(bindings.DB);
      await seedCostHoldings(measured.database, COST_SUBJECT, 1, true);
      const initialCapture = { ...measured.cost };
      measured.reset();
      const importId = await seedCostHoldings(
        measured.database,
        COST_SUBJECT,
        2,
      );
      const acceptedCapture = { ...measured.cost };
      const captureQueries = [...measured.byQuery]
        .sort((a, b) => b[1].rowsRead - a[1].rowsRead)
        .slice(0, 5)
        .map(([sql, cost]) => ({ sql: sql.slice(0, 170), ...cost }));
      const continuityCount = await bindings.DB.prepare(
        "SELECT COUNT(*) AS count FROM holding_position_continuities",
      ).first<number>("count");
      await seedCostProposals(bindings.DB);
      await seedCostWatchTargets(bindings.DB);
      const connections = new D1InvestmentConnectionsRepository(bindings.DB);
      for (let index = 0; index < 50; index++) {
        await connections.upsertConnection(
          COST_SUBJECT,
          "connector-secrets/synthetic.enc",
          syntheticDigest(40_000 + index),
          `ins-synthetic-${index}`,
          `Synthetic institution ${index}`,
        );
      }
      result = {
        operation: operation.operation,
        importId,
        initialCapture,
        acceptedCapture,
        captureQueries,
        continuityCount,
      };
    }
    return Response.json(result);
  },
};
