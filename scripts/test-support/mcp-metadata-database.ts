import { build } from "esbuild";
import { z } from "zod";
import { createCostDatabase } from "./d1-cost";

const worker = build({
  entryPoints: ["scripts/test-support/mcp-metadata-worker.ts"],
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
    operation: z.literal("mcp-metadata-holding"),
    importId: z.string().min(1),
  })
  .strict();

export async function createMcpMetadataDatabase() {
  const fixture = await createCostDatabase(await worker);
  try {
    const response = await fixture.dispatchFetch(
      "https://synthetic-mcp-fixture.invalid",
      {
        method: "POST",
        body: JSON.stringify({ operation: "mcp-metadata-holding" }),
      },
    );
    if (!response.ok) throw new Error(await response.text());
    resultSchema.parse(await response.json());
    return fixture;
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
