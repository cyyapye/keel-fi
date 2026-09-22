import path from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// Whole-file wall times from successful OVH run 35690710837. These are only
// scheduling hints: neither test selection nor within-file execution changes.
// Start expensive files first so one large fixture cannot leave the second
// worker idle at the end of a clean CI checkout with no Vitest timing cache.
const seconds: Readonly<Record<string, number>> = {
  "provider-agent-d1-cost.test.ts": 448,
  "portfolio-watch-activity.test.ts": 255,
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

export function prioritizeCostFiles<T extends { readonly moduleId: string }>(
  files: readonly T[],
): T[] {
  return [...files].sort(
    (left, right) =>
      (seconds[path.basename(right.moduleId)] ?? 0) -
      (seconds[path.basename(left.moduleId)] ?? 0),
  );
}

export class CiTestSequencer extends BaseSequencer {
  override async sort(
    files: TestSpecification[],
  ): Promise<TestSpecification[]> {
    return prioritizeCostFiles(await super.sort(files));
  }
}
