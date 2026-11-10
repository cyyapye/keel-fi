import path from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// Whole-file wall times from OVH run 42805759768. These are scheduling
// hints only: neither test selection nor within-file execution changes.
// Start expensive files early so stale timings cannot defer a large fixture
// behind cheaper files on a clean checkout with no Vitest timing cache.
const seconds: Readonly<Record<string, number>> = {
  "provider-agent-d1-cost.test.ts": 112,
  "public-source-reviews-d1-cost.test.ts": 215,
  "portfolio-watch-activity.test.ts": 89,
  "renamed-investments-d1-cost.test.ts": 32,
  "portfolio-baseline-d1-cost.test.ts": 21,
  "automatic-investment-review-d1-cost.test.ts": 71,
  "participation-d1-cost.test.ts": 16,
  "purchase-details-d1-cost.test.ts": 51,
  "keel-session-check.test.ts": 8,
  "portfolio-watch-d1-cost.test.ts": 11,
  "company-identity-d1-cost.test.ts": 9,
  "investment-events-d1-cost.test.ts": 7,
  "cash-request-d1-cost.test.ts": 13,
  "private-continuity-d1-cost.test.ts": 7,
  "d1-read-budgets.test.ts": 10,
  "holding-history-d1-cost.test.ts": 8,
  "d1-query-cost.test.ts": 4,
  "cash-balance-history-cost.test.ts": 11,
  "lint-typecheck.test.ts": 36,
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
  return seconds[name] ?? (name.endsWith("-cost.test.ts") ? 1_000 : 0);
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
