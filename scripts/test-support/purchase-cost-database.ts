import { build } from "esbuild";
import { z } from "zod";
import type { PurchaseCostSetupOperation } from "./purchase-cost-worker";
import { createCostDatabase } from "./d1-cost";

const purchaseCostWorker = build({
  entryPoints: ["scripts/test-support/purchase-cost-worker.ts"],
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
const d1CostSchema = z.object({
  roundTrips: z.number().int().nonnegative(),
  statements: z.number().int().nonnegative(),
  rowsRead: z.number().int().nonnegative(),
  rowsWritten: z.number().int().nonnegative(),
});
const seedResultSchema = z.object({ importId: z.string().min(1) });
const purchaseHistoryResultSchema = z.object({
  deepHead: z.string().uuid(),
  acceptances: z
    .array(
      z.object({
        version: z.number().int().min(0).max(7),
        positionId: z.string().uuid(),
        receiptId: z.string().uuid(),
        cost: d1CostSchema,
      }),
    )
    .length(960),
  reads: z
    .array(
      z.object({
        version: z.number().int().min(0).max(7),
        positionCount: z.number().int().nonnegative(),
        cost: d1CostSchema,
      }),
    )
    .length(8),
  stored: z.object({
    receiptCount: z.number().int().nonnegative(),
    positionCount: z.number().int().nonnegative(),
  }),
});

export async function createPurchaseCostDatabase() {
  const fixture = await createCostDatabase(await purchaseCostWorker);
  const dispatch = async (operation: PurchaseCostSetupOperation) => {
    const response = await fixture.dispatchFetch(
      "https://synthetic-purchase-cost.invalid",
      {
        method: "POST",
        body: JSON.stringify(operation),
      },
    );
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  return {
    ...fixture,
    seed: async (subject?: string) =>
      seedResultSchema.parse(await dispatch({ operation: "seed", subject })),
    growLinkHistory: async (
      input: Omit<
        Extract<PurchaseCostSetupOperation, { operation: "link-history" }>,
        "operation"
      >,
    ) =>
      z
        .array(d1CostSchema)
        .length(input.count)
        .parse(await dispatch({ operation: "link-history", ...input })),
    measurePurchaseHistory: async (input: {
      subject: string;
      householdId: string;
      positions: { id: string; snapshotId: string }[];
    }) =>
      purchaseHistoryResultSchema.parse(
        await dispatch({ operation: "purchase-history", ...input }),
      ),
  };
}
