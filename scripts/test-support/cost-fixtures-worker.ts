import { z } from "zod";
import { seedCostHoldings, seedCostWatchTargets } from "./cost-fixtures";

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
]);
export type CostFixtureSetupOperation = z.input<typeof setupOperationSchema>;

// Synthetic-only unmeasured fixture setup runs beside D1 to avoid repeated
// Node-to-D1 RPC overhead. This worker is test support and has no app runtime.
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
    let importId: string;
    if (operation.operation === "holdings") {
      const observations = operation.observations;
      importId = await seedCostHoldings(
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
    } else {
      importId = await seedCostHoldings(bindings.DB);
      await seedCostWatchTargets(bindings.DB);
      await bindings.DB.prepare(
        "UPDATE portfolio_watch_source_sync_state SET next_check_at = ?",
      )
        .bind(operation.nextCheckAt)
        .run();
    }
    return Response.json({ importId });
  },
};
