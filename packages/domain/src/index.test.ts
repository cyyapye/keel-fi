import { describe, expect, it } from "vitest";

import {
  createGoalPreview,
  estimateThresholdProbabilityPpm,
  multiplyMinorByPpm,
  projectScenario,
  probabilityMeetingThresholdPpm,
  summarizeLiquidityPaths,
} from "./index";

describe("deterministic financial calculations", () => {
  it("multiplies money by integer parts per million without floating point", () => {
    expect(multiplyMinorByPpm(12_345, 333_333)).toBe(4_115);
    expect(multiplyMinorByPpm(10_001, 500_000)).toBe(5_001);
  });

  it("summarizes annual cumulative liquidity paths", () => {
    const summary = summarizeLiquidityPaths(
      [2027, 2028],
      [
        [0, 100_00],
        [0, 200_00],
        [100_00, 400_00],
        [300_00, 800_00],
      ],
    );

    expect(summary[0]).toEqual({
      year: 2027,
      p25Minor: 0,
      p50Minor: 0,
      p75Minor: 100_00,
      expectedMinor: 100_00,
      probabilityZeroPpm: 500_000,
    });
    expect(summary[1]?.p50Minor).toBe(200_00);
  });

  it("computes threshold probability as integer ppm", () => {
    expect(
      probabilityMeetingThresholdPpm(
        [1_000_00, 2_000_00, 3_000_00, 4_000_00],
        3_000_00,
      ),
    ).toBe(500_000);
  });

  it("estimates a threshold probability from ordered outcome bands", () => {
    expect(
      estimateThresholdProbabilityPpm(
        325_000_000,
        276_500_000,
        392_500_000,
        536_500_000,
      ),
    ).toBe(645_475);
  });

  it("builds FI goal forecasts from current value plus saved liquidity", () => {
    expect(
      createGoalPreview(
        {
          templateKey: "financial_independence",
          name: "Financial independence",
          metricKey: "fi_eligible_liquid",
          metricLabel: "FI-eligible liquid assets",
          targetValueInteger: 325_000_000,
          targetUnit: "minor_units",
          targetDate: null,
          currentValueInteger: 182_500_000,
          makePrimary: true,
          changeNote: "Preview synthetic goal",
        },
        {
          p25FiveYearLiquidityMinor: 94_000_000,
          p50FiveYearLiquidityMinor: 210_000_000,
          p75FiveYearLiquidityMinor: 354_000_000,
          horizonDate: "2031-12-31",
        },
      ),
    ).toMatchObject({
      modelStatus: "modeled",
      lowerValueInteger: 276_500_000,
      middleValueInteger: 392_500_000,
      higherValueInteger: 536_500_000,
      successProbabilityPpm: 645_475,
    });
  });

  it("does not invent a forecast for an unconfigured goal template", () => {
    expect(
      createGoalPreview(
        {
          templateKey: "cash_runway",
          name: "Protect runway",
          metricKey: "protected_runway_months",
          metricLabel: "Months of protected runway",
          targetValueInteger: 36,
          targetUnit: "months",
          targetDate: null,
          currentValueInteger: 42,
          makePrimary: false,
          changeNote: "Preview synthetic goal",
        },
        {
          p25FiveYearLiquidityMinor: 94_000_000,
          p50FiveYearLiquidityMinor: 210_000_000,
          p75FiveYearLiquidityMinor: 354_000_000,
          horizonDate: "2031-12-31",
        },
      ),
    ).toMatchObject({
      modelStatus: "not_configured",
      progressPpm: 1_000_000,
      lowerValueInteger: null,
      successProbabilityPpm: null,
    });
  });

  it("projects scenario drafts with integer sensitivity and preserves no-op values", () => {
    const base = {
      id: "scn_fi",
      name: "FI Underwriting",
      description: "Synthetic FI scenario",
      isSandbox: false,
      conditionalValueMinor: 168_000_000,
      timingAdjustedLiquidityMinor: 92_500_000,
      assumptions: [
        {
          id: "asm_probability",
          key: "liquidity_probability",
          label: "Liquidity probability",
          value: 430_000,
          unit: "ppm" as const,
          provenance: "Synthetic policy",
        },
        {
          id: "asm_delay",
          key: "timing_delay_months",
          label: "Timing delay",
          value: 18,
          unit: "months" as const,
          provenance: "Synthetic policy",
        },
      ],
      liquidityCurve: [
        {
          year: 2031,
          p25Minor: 94_000_000,
          p50Minor: 210_000_000,
          p75Minor: 354_000_000,
          expectedMinor: 246_000_000,
          probabilityZeroPpm: 70_000,
        },
      ],
    };
    const unchanged = projectScenario(base, {
      scenarioId: "scn_fi",
      assumptions: [
        {
          id: "asm_probability",
          key: "liquidity_probability",
          value: 430_000,
        },
        { id: "asm_delay", key: "timing_delay_months", value: 18 },
      ],
      changeNote: "No-op preview",
    });
    expect(unchanged.timingAdjustedLiquidityMinor).toBe(92_500_000);
    expect(unchanged.liquidityCurve[0]?.p50Minor).toBe(210_000_000);

    const upside = projectScenario(base, {
      scenarioId: "scn_fi",
      assumptions: [
        {
          id: "asm_probability",
          key: "liquidity_probability",
          value: 800_000,
        },
        { id: "asm_delay", key: "timing_delay_months", value: 6 },
      ],
      changeNote: "Test upside sensitivity",
    });
    expect(upside.liquidityScalePpm).toBeGreaterThan(1_000_000);
    expect(upside.timingAdjustedLiquidityMinor).toBeGreaterThan(
      unchanged.timingAdjustedLiquidityMinor,
    );
    expect(upside.liquidityCurve[0]?.p50Minor).toBeGreaterThan(210_000_000);
  });
});
