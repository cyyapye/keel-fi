import { describe, expect, it } from "vitest";
import { projectOutlook, type Records } from "./outlook";

const baseline = {
  id: "baseline",
  recordedAt: "2026-01-01T00:00:00Z",
  sourceObservedAt: "2025-12-31",
  sourceRevision: "synthetic",
  liquidMinor: 120000,
  privatePaperMinor: 90000,
  unknownPositions: 0,
  unknownCashAccounts: 0,
  potentialDuplicates: 0,
  positionCount: 1,
};
const oldDebt = {
  id: "debt-a",
  key: "obligation",
  decision: "accepted" as const,
  decidedAt: "2026-01-01T00:00:00Z",
  effectiveDate: "2026-01-01",
  balanceMinor: 15000,
  paymentMinor: 2000,
  treatment: "reserve_from_liquidity" as const,
};
const records: Records = {
  baselines: [baseline],
  plans: [
    {
      id: "plan",
      effectiveAt: "2026-01-01",
      liquidMinor: 120000,
      floorMinor: 10000,
      householdBurnMinor: 8000,
      businessBurnMinor: 1000,
    },
  ],
  goals: [],
  decisions: [oldDebt, { ...oldDebt, id: "debt-b", balanceMinor: 10000 }],
};
const input = {
  through: "2027-01-01",
  annualNetWorthChangeMinor: 3000,
  targets: [
    { date: "2027-01-01", amountMinor: 206000 },
    { date: "2036-01-01", amountMinor: 240000 },
  ],
};
describe("owner goal outlook", () => {
  it("separates target-date wealth from today's gap and keeps private mark changes out of runway", () => {
    const before = projectOutlook(records, "2026-01-01", input);
    expect(before.wealth.trackedNetWorthMinor).toBe(200000);
    expect(before.netWorthTargets[0]).toMatchObject({
      currentShortfallMinor: 6000,
      projectedShortfallMinor: 3000,
      requiredAnnualNetIncreaseMinor: 6000,
    });
    expect(before.netWorthTargets[1]!.projectedNetWorthMinor).toBe(230016);
    expect(before.liquidity).toMatchObject({
      projectedEndMinor: 10000,
      lastsThroughDate: true,
      firstBelowReserveDate: null,
      maximumMonthlyBurnMinor: 9000,
    });
    const update = projectOutlook(
      {
        ...records,
        baselines: [{ ...baseline, id: "later", privatePaperMinor: 96000 }],
      },
      "2026-01-01",
      input,
    );
    expect(update.netWorthTargets[0]!.currentShortfallMinor).toBe(0);
    expect(update.liquidity).toEqual(before.liquidity);
    const stress = projectOutlook(records, "2026-01-01", {
      ...input,
      immediateCashOutflowMinor: 100,
    });
    expect(stress.liquidity).toMatchObject({
      firstBelowReserveDate: "2027-01-01",
      reserveShortfallMinor: 100,
      lastsThroughDate: false,
    });
  });
  it("keeps incomplete wealth, unverified debt and missing horizon models explicit", () => {
    for (const data of [
      { ...records, decisions: [] },
      { ...records, baselines: [{ ...baseline, unknownPositions: 1 }] },
      { ...records, baselines: [] },
      { ...records, decisions: Array.from({ length: 513 }, () => oldDebt) },
    ]) {
      const result = projectOutlook(data, "2026-01-01", input);
      expect(result.wealth.trackedNetWorthMinor).toBeNull();
      expect(result.netWorthTargets[0]!.projectedShortfallMinor).toBeNull();
      expect(result.wealth.reasons.length).toBeGreaterThan(0);
    }
    const explicit = projectOutlook(
      { ...records, decisions: [] },
      "2026-01-01",
      { ...input, assumeNoDebt: true },
    );
    expect(explicit.wealth).toMatchObject({
      trackedNetWorthMinor: 210000,
      assumedNoDebt: true,
      reviewedDebtMinor: null,
    });
    expect(
      projectOutlook(records, "2026-01-01", {
        through: input.through,
        targets: input.targets,
      }).netWorthTargets[0]!.projectedNetWorthMinor,
    ).toBeNull();
  });
});
