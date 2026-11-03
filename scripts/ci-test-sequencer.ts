import path from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const seconds: Readonly<Record<string, number>> = {
  "provider-agent-d1-cost.test.ts": 448,
  "portfolio-watch-activity.test.ts": 255,
  "renamed-investments-d1-cost.test.ts": 200,
  "portfolio-baseline-d1-cost.test.ts": 107,
  "automatic-investment-review-d1-cost.test.ts": 104,
  "participation-d1-cost.test.ts": 104,
  "purchase-details-d1-cost.test.ts": 97,
  "keel-session-check.test.ts": 80,
  "portfolio-watch-d1-cost.test.ts": 79,
  "company-identity-d1-cost.test.ts": 63,
  "investment-events-d1-cost.test.ts": 56,
  "cash-request-d1-cost.test.ts": 42,
  "private-continuity-d1-cost.test.ts": 41,
  "d1-read-budgets.test.ts": 40,
  "holding-history-d1-cost.test.ts": 39,
  "d1-query-cost.test.ts": 24,
};

const runtimePaths = [
  "apps/api/src/d1-capacity.test.ts",
  "scripts/d1-capacity-r2.test.ts",
  "scripts/d1-query-cost.test.ts",
  "scripts/d1-read-budgets.test.ts",
  "scripts/keel-session-check.test.ts",
  "scripts/portfolio-watch-activity.test.ts",
  "scripts/public-company-worker-runtime.test.ts",
  "scripts/sql-replay.test.ts",
  "scripts/test-support/d1-cost.test.ts",
] as const;

type FilePriority = {
  readonly group: "deadline" | "runtime" | "ordinary";
  readonly hint: number;
};

const groupRank = { deadline: 2, runtime: 1, ordinary: 0 } as const;

function priority(moduleId: string): FilePriority {
  const name = path.basename(moduleId);
  if (moduleId.endsWith("/packages/database/src/d1-capacity.test.ts"))
    return { group: "deadline", hint: 1_007 };
  if (name === "runtime-work-inventory.test.ts")
    return { group: "deadline", hint: 1_006 };
  if (name === "automatic-investment-review-d1-cost.test.ts")
    return { group: "deadline", hint: 1_005 };
  if (name === "cash-accounts.test.ts")
    return { group: "deadline", hint: 1_004 };
  if (name === "cash-request-d1-cost.test.ts")
    return { group: "deadline", hint: 1_003 };
  if (moduleId.endsWith("/apps/api/src/position-purchases.test.ts"))
    return { group: "deadline", hint: 1_002 };
  if (name === "provider-agent-usage.test.ts")
    return { group: "deadline", hint: 1_001 };
  const costFixture = name.endsWith("-d1-cost.test.ts");
  return {
    group:
      costFixture || runtimePaths.some((file) => moduleId.endsWith(`/${file}`))
        ? "runtime"
        : "ordinary",
    hint: seconds[name] ?? (costFixture ? 1_000 : 0),
  };
}

export function prioritizeCostFiles<T extends { readonly moduleId: string }>(
  files: readonly T[],
): T[] {
  return [...files].sort((left, right) => {
    const before = priority(left.moduleId);
    const after = priority(right.moduleId);
    return (
      groupRank[after.group] - groupRank[before.group] ||
      after.hint - before.hint
    );
  });
}

export class CiTestSequencer extends BaseSequencer {
  override async sort(
    files: TestSpecification[],
  ): Promise<TestSpecification[]> {
    return prioritizeCostFiles(await super.sort(files));
  }
}
