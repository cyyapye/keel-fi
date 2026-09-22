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
const seedResultSchema = z.object({ ids: z.array(z.string().uuid()) });
const completedResultSchema = z.object({ completed: z.literal(true) });

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
