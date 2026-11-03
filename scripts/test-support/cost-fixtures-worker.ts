import { z } from "zod";
import { ShareBasisSchema } from "../../packages/domain/src/valuation-record";
import { D1InvestmentConnectionsRepository } from "../../packages/database/src/investment-connections";
import { D1ProviderPortfolioAgentRepository } from "../../packages/database/src/provider-portfolio-agent";
import { measureD1 } from "./d1-meter";
import { providerReconnectCost } from "./provider-reconnect-cost";
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
    observations: z
      .object({
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
  z.object({ operation: z.literal("read-budgets") }).strict(),
  z.object({ operation: z.literal("provider-reconnect") }).strict(),
  z.object({ operation: z.literal("portfolio-watch-day") }).strict(),
  z.object({ operation: z.literal("watch-targets") }).strict(),
]);
export type CostFixtureSetupOperation = z.input<typeof setupOperationSchema>;

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
      const database = operation.interruptPricePropagation
        ? new Proxy(bindings.DB, {
            get(target, key) {
              if (key === "prepare")
                return (sql: string) => {
                  if (sql.includes("SELECT link.household_id"))
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
          operation.interruptPricePropagation &&
          error instanceof Error &&
          error.message === "synthetic projection interruption"
        )
          return new Response(error.message, { status: 409 });
        throw error;
      } finally {
        globalThis.Date = originalDate;
      }
      result = { operation: operation.operation, importId };
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
      const agents = new D1ProviderPortfolioAgentRepository(
        bindings.DB,
        () => new Date("2026-10-01T12:00:00.000Z"),
      );
      await agents.register("synthetic-access-subject", "tokenfolio");
      await bindings.DB.batch([
        bindings.DB.prepare(
          "INSERT INTO users VALUES ('usr_foreign', 'synthetic-foreign', 'foreign@example.com', 'Synthetic foreign user', '2026-01-01T00:00:00Z')",
        ),
        bindings.DB.prepare(
          "INSERT INTO households VALUES ('hh_foreign', 'usr_foreign', 'Synthetic foreign household', 'USD', '2026-01-01T00:00:00Z')",
        ),
      ]);
      await agents.register("synthetic-foreign", "tokenfolio");
      result = {
        operation: operation.operation,
        results: await providerReconnectCost(bindings.DB),
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
