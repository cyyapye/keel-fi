import { z } from "zod";
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
    observations: z
      .object({
        status: z.enum(["Live", "Realized"]).optional(),
        investedMinor: z.number().int().optional(),
        allocationMinor: z.number().int().optional(),
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
      const importId = await seedCostHoldings(
        bindings.DB,
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
            }
          : undefined,
      );
      result = { operation: operation.operation, importId };
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
