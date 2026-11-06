import { build } from "esbuild";
import { z } from "zod";
import type { AutomaticInvestmentSetupOperation } from "./automatic-investment-cost-worker";
import { createCostDatabase } from "./d1-cost";

const automaticInvestmentCostWorker = build({
  entryPoints: ["scripts/test-support/automatic-investment-cost-worker.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["browser", "module", "main"],
  external: ["node:*", "cloudflare:*"],
  plugins: [
    {
      name: "tree-shake-unused-node-builtins",
      setup(context) {
        context.onResolve({ filter: /^node:/ }, (args) => ({
          path: args.path,
          external: true,
          sideEffects: false,
        }));
      },
    },
  ],
  logLevel: "silent",
}).then((bundled) => bundled.outputFiles[0]!.text);
const wefunderImportResultSchema = z
  .object({
    importId: z.string().min(1),
    status: z.literal("applied"),
    rowCount: z.literal(120),
  })
  .strict();
const seedResultSchema = z.object({ ids: z.array(z.string().uuid()) });
const completedResultSchema = z.object({ completed: z.literal(true) });
const sourceCaptureCostSchema = z.object({
  sourceWrites: z.number().int().nonnegative(),
  captureWrites: z.number().int().nonnegative(),
  resolvedCount: z.number().int().nonnegative(),
  exceptionCount: z.number().int().nonnegative(),
  review: z.object({
    roundTrips: z.number().int().nonnegative(),
    statements: z.number().int().nonnegative(),
    rowsRead: z.number().int().nonnegative(),
    rowsWritten: z.number().int().nonnegative(),
  }),
});

export async function createAutomaticInvestmentCostDatabase() {
  const fixture = await createCostDatabase(await automaticInvestmentCostWorker);
  const dispatch = async (operation: AutomaticInvestmentSetupOperation) => {
    const response = await fixture.dispatchFetch(
      "https://synthetic-automatic-investment-setup.invalid",
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
    stageWefunderImport: async (scenario: "initial" | "grown" | "empty") =>
      wefunderImportResultSchema.parse(
        await dispatch({ operation: "wefunder-import", scenario }),
      ),
    measureSourceCapture: async () =>
      sourceCaptureCostSchema.parse(
        await dispatch({ operation: "source-capture-cost" }),
      ),
    seed: async (
      input: Omit<
        Extract<AutomaticInvestmentSetupOperation, { operation: "seed" }>,
        "operation"
      >,
    ) =>
      seedResultSchema.parse(await dispatch({ operation: "seed", ...input }))
        .ids,
    resolveAutomaticReviews: async (subject: string) => {
      completedResultSchema.parse(
        await dispatch({ operation: "resolve-automatic-reviews", subject }),
      );
    },
    reviewParticipation: async (input: {
      ids: string[];
      subject: string;
      historicalCount: number;
      amountMinor: number;
    }) => {
      completedResultSchema.parse(
        await dispatch({ operation: "participation-reviews", ...input }),
      );
    },
    growAutomaticReviewHistory: async (ids: string[]) => {
      completedResultSchema.parse(
        await dispatch({ operation: "automatic-review-history", ids }),
      );
    },
  };
}
