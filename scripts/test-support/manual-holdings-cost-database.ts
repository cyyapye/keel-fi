import { build } from "esbuild";
import { z } from "zod";
import { createCostDatabase } from "./d1-cost";
import type { ManualHoldingCostBatch } from "./manual-holdings-cost-worker";

const worker = build({
  entryPoints: ["scripts/test-support/manual-holdings-cost-worker.ts"],
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
const costSchema = z
  .object({
    roundTrips: z.number().int().nonnegative(),
    statements: z.number().int().nonnegative(),
    rowsRead: z.number().int().nonnegative(),
    rowsWritten: z.number().int().nonnegative(),
  })
  .strict();

export async function createManualHoldingsCostDatabase() {
  const fixture = await createCostDatabase(await worker, {
    sharedMemoryParent:
      process.env.CI === "true"
        ? process.env.KEEL_PROVIDER_DAY_SCRATCH
        : undefined,
    checkProviderDayHeadroom: true,
  });
  return {
    database: fixture.database,
    storage: fixture.storage,
    close: fixture.close,
    createManualHoldings: async (batch: ManualHoldingCostBatch) => {
      const response = await fixture.dispatchFetch(
        "https://synthetic-manual-cost.invalid",
        { method: "POST", body: JSON.stringify(batch) },
      );
      if (!response.ok) throw new Error(await response.text());
      return costSchema.parse(await response.json());
    },
  };
}
