import { build } from "esbuild";
import { z } from "zod";
import { createCostWorker } from "./d1-cost";
import { reconnectCostResultSchema } from "./provider-reconnect-cost";

const worker = build({
  entryPoints: ["scripts/test-support/provider-reconnect-cost-worker.ts"],
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
const resultSchema = z
  .object({
    operation: z.literal("provider-reconnect"),
    results: reconnectCostResultSchema,
  })
  .strict();

export async function createProviderReconnectCostDatabase() {
  const fixture = await createCostWorker(await worker);
  try {
    const response = await fixture.dispatchFetch(
      "https://synthetic-reconnect-cost.invalid",
      {
        method: "POST",
        body: JSON.stringify({ operation: "provider-reconnect" }),
      },
    );
    if (!response.ok) throw new Error(await response.text());
    return {
      ...fixture,
      initialResult: resultSchema.parse(await response.json()),
    };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
