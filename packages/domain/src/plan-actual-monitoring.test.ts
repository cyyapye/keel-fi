import { describe, expect, it } from "vitest";

import {
  evaluatePlanActualMonitoring,
  PLAN_ACTUAL_COOLDOWN_DAYS,
  type PlanActualMonitoringInput,
} from "./plan-actual-monitoring";

const evaluatedAt = "2026-08-16T12:00:00.000Z";
const sourceRevision = "a".repeat(64);

function input(
  overrides: Partial<PlanActualMonitoringInput> = {},
): PlanActualMonitoringInput {
  return {
    evaluatedAt,
    sourceRevision,
    plan: {
      id: "plan-synthetic",
      fiEligibleLiquidMinor: 20_000_000,
      protectedCashFloorMinor: 2_000_000,
      householdBurnMonthlyMinor: 1_000_000,
      businessBurnMonthlyMinor: 500_000,
    },
    cash: {
      enabled: true,
      baselineMinor: 10_000_000,
      actualMinor: 10_200_000,
      observedAt: "2026-08-10T12:00:00.000Z",
      pendingReviewCount: 0,
      unknownCount: 0,
    },
    debt: {
      enabled: true,
      priorMinor: 8_000_000,
      actualMinor: 8_200_000,
      observedAt: "2026-08-09T12:00:00.000Z",
      pendingReviewCount: 0,
      unknownCount: 0,
      overdueCount: 0,
    },
    burn: {
      enabled: true,
      status: "reviewed_no_change",
      actualHouseholdMonthlyMinor: 1_000_000,
      actualBusinessMonthlyMinor: 500_000,
      observedAt: "2026-08-08T12:00:00.000Z",
    },
    cooldowns: [],
    ...overrides,
  };
}

describe("plan-versus-actual monitoring policy", () => {
  it("returns a clear no-action state below every deterministic threshold", () => {
    const state = evaluatePlanActualMonitoring(input());

    expect(state).toMatchObject({
      status: "clear",
      coverage: {
        cash: "current",
        debt: "current",
        burn: "current",
        runway: "available",
      },
      actionItems: [],
      deferredItems: [],
    });
  });

  it("prioritizes review and freshness before value drift", () => {
    const state = evaluatePlanActualMonitoring(
      input({
        cash: {
          enabled: true,
          baselineMinor: 10_000_000,
          actualMinor: 2_000_000,
          observedAt: "2026-08-15T12:00:00.000Z",
          pendingReviewCount: 2,
          unknownCount: 0,
        },
        debt: {
          enabled: true,
          priorMinor: 8_000_000,
          actualMinor: 20_000_000,
          observedAt: "2026-06-01T12:00:00.000Z",
          pendingReviewCount: 0,
          unknownCount: 1,
          overdueCount: 0,
        },
        burn: {
          enabled: true,
          status: "pending_review",
          actualHouseholdMonthlyMinor: null,
          actualBusinessMonthlyMinor: null,
          observedAt: "2026-08-15T12:00:00.000Z",
        },
      }),
    );

    expect(state.actionItems.map((item) => item.key)).toEqual([
      "cash_review",
      "debt_freshness",
      "burn_review",
    ]);
    expect(state.coverage.runway).toBe("limited");
  });

  it("attributes material cash, debt, burn, and runway changes without mutating a plan", () => {
    const state = evaluatePlanActualMonitoring(
      input({
        cash: {
          enabled: true,
          baselineMinor: 10_000_000,
          actualMinor: 8_000_000,
          observedAt: "2026-08-15T12:00:00.000Z",
          pendingReviewCount: 0,
          unknownCount: 0,
        },
        debt: {
          enabled: true,
          priorMinor: 8_000_000,
          actualMinor: 9_000_000,
          observedAt: "2026-08-15T12:00:00.000Z",
          pendingReviewCount: 0,
          unknownCount: 0,
          overdueCount: 0,
        },
        burn: {
          enabled: true,
          status: "reviewed_material",
          actualHouseholdMonthlyMinor: 1_500_000,
          actualBusinessMonthlyMinor: 700_000,
          observedAt: "2026-08-15T12:00:00.000Z",
        },
      }),
    );

    expect(state.actionItems.map((item) => item.key)).toEqual([
      "cash_drift",
      "debt_drift",
      "burn_drift",
      "runway_drift",
    ]);
    expect(
      state.actionItems.find((item) => item.key === "cash_drift"),
    ).toMatchObject({
      plannedValueMinor: 10_000_000,
      actualValueMinor: 8_000_000,
      differenceMinor: -2_000_000,
      thresholdMinor: 500_000,
    });
    expect(
      state.actionItems.find((item) => item.key === "runway_drift"),
    ).toMatchObject({ plannedMonths: 12, actualMonths: 7 });
  });

  it("deduplicates one item per metric and honors only the exact-source cooldown", () => {
    const deferredUntil = "2026-08-23T12:00:00.000Z";
    const state = evaluatePlanActualMonitoring(
      input({
        cash: {
          enabled: true,
          baselineMinor: 10_000_000,
          actualMinor: 8_000_000,
          observedAt: "2026-08-15T12:00:00.000Z",
          pendingReviewCount: 0,
          unknownCount: 0,
        },
        cooldowns: [
          {
            itemKey: "cash_drift",
            sourceRevision,
            until: deferredUntil,
          },
          {
            itemKey: "debt_drift",
            sourceRevision: "b".repeat(64),
            until: deferredUntil,
          },
        ],
      }),
    );

    expect(PLAN_ACTUAL_COOLDOWN_DAYS).toBe(7);
    expect(state.actionItems.map((item) => item.key)).not.toContain(
      "cash_drift",
    );
    expect(state.deferredItems).toMatchObject([
      { key: "cash_drift", cooldownUntil: deferredUntil },
    ]);
  });

  it("keeps unconfigured sources explicit without manufacturing an alert", () => {
    const state = evaluatePlanActualMonitoring(
      input({
        cash: {
          enabled: false,
          baselineMinor: 0,
          actualMinor: null,
          observedAt: null,
          pendingReviewCount: 0,
          unknownCount: 0,
        },
        debt: {
          enabled: false,
          priorMinor: null,
          actualMinor: null,
          observedAt: null,
          pendingReviewCount: 0,
          unknownCount: 0,
          overdueCount: 0,
        },
        burn: {
          enabled: false,
          status: "unavailable",
          actualHouseholdMonthlyMinor: null,
          actualBusinessMonthlyMinor: null,
          observedAt: null,
        },
      }),
    );

    expect(state.status).toBe("limited");
    expect(state.actionItems).toEqual([]);
    expect(state.coverage).toEqual({
      cash: "not_configured",
      debt: "not_configured",
      burn: "not_configured",
      runway: "limited",
    });
  });
});
