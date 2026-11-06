import path from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// Whole-file wall times from successful OVH run 35690710837, plus the rename
// fixture's completed 200-second execution in run 37951901830. These are only
// scheduling hints: neither test selection nor within-file execution changes.
// Start expensive files first so one large fixture cannot leave the second
// worker idle at the end of a clean CI checkout with no Vitest timing cache.
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

function priority(moduleId: string): number {
  const name = path.basename(moduleId);
  // These complete-graph/day assertions have strict wall-clock deadlines.
  // Admit them before browser startup competes for CPU; keep every operation,
  // file and deadline, rather than letting the unmeasured tail starve them.
  // Keep the short graph scan in the initial worker slots, before the slower
  // D1 cases have spawned their workerd processes.
  if (name === "runtime-work-inventory.test.ts") return 1_006;
  if (name === "automatic-investment-review-d1-cost.test.ts") return 1_005;
  if (name === "cash-accounts.test.ts") return 1_004;
  if (name === "cash-request-d1-cost.test.ts") return 1_003;
  if (moduleId.endsWith("/apps/api/src/position-routes.test.ts")) return 1_002;
  if (name === "provider-agent-usage.test.ts") return 1_001;
  // New D1 scale cases can dominate the tail before an OVH timing exists.
  // Admit unmeasured cost fixtures first; never rely on a complete hint list.
  return seconds[name] ?? (name.endsWith("-d1-cost.test.ts") ? 1_000 : 0);
}

export function prioritizeCostFiles<T extends { readonly moduleId: string }>(
  files: readonly T[],
): T[] {
  return [...files].sort(
    (left, right) => priority(right.moduleId) - priority(left.moduleId),
  );
}

export class CiTestSequencer extends BaseSequencer {
  override async sort(
    files: TestSpecification[],
  ): Promise<TestSpecification[]> {
    return prioritizeCostFiles(await super.sort(files));
  }
}
