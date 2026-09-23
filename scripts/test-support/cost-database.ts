import { build } from "esbuild";
import { z } from "zod";
import type { CostFixtureSetupOperation } from "./cost-fixtures-worker";
import { createCostDatabase } from "./d1-cost";

const costFixtureWorker = build({
  entryPoints: ["scripts/test-support/cost-fixtures-worker.ts"],
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
const d1CostSchema = z
  .object({
    roundTrips: z.number().int().nonnegative(),
    statements: z.number().int().nonnegative(),
    rowsRead: z.number().int().nonnegative(),
    rowsWritten: z.number().int().nonnegative(),
  })
  .strict();
const setupResultSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("holdings"),
      importId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      operation: z.literal("portfolio-watch"),
      importId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      operation: z.literal("read-budgets"),
      importId: z.string().min(1),
      initialCapture: d1CostSchema,
      acceptedCapture: d1CostSchema,
      captureQueries: z
        .array(
          z
            .object({
              sql: z.string().min(1).max(170),
              calls: z.number().int().nonnegative(),
              rowsRead: z.number().int().nonnegative(),
              rowsWritten: z.number().int().nonnegative(),
            })
            .strict(),
        )
        .max(5),
      continuityCount: z.number().int().nonnegative(),
    })
    .strict(),
]);

export async function createCostFixtureDatabase(
  initialOperation?: CostFixtureSetupOperation,
) {
  const fixture = await createCostDatabase(await costFixtureWorker);
  const setup = async (operation: CostFixtureSetupOperation) => {
    const response = await fixture.dispatchFetch(
      "https://synthetic-cost-setup.invalid",
      {
        method: "POST",
        body: JSON.stringify(operation),
      },
    );
    if (!response.ok) throw new Error(await response.text());
    return setupResultSchema.parse(await response.json());
  };
  try {
    const initialResult = initialOperation
      ? await setup(initialOperation)
      : undefined;
    return { ...fixture, setup, initialResult };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
