import type { AlphaData } from "../packages/domain/src/index";

const overviewPrimaryGoal: AlphaData["goals"][number] = {
  id: "goal_overview_synthetic",
  templateKey: "financial_independence",
  isPrimary: true,
  archivedAt: null,
  createdAt: "2026-07-01T09:00:00-07:00",
  versions: [
    {
      id: "goal_version_overview_synthetic",
      version: 1,
      name: "Financial independence",
      metricKey: "fi_eligible_liquid",
      metricLabel: "FI-eligible liquid assets",
      targetValueInteger: 325_000_000,
      targetUnit: "minor_units",
      targetDate: null,
      currentValueInteger: 182_500_000,
      currentValueSource: "Synthetic FI planning inputs",
      changeNote: "Stable visual fixture",
      createdAt: "2026-07-01T09:00:00-07:00",
      createdBy: "Demo Operator",
      forecast: {
        id: "goal_forecast_overview_synthetic",
        version: 1,
        modelStatus: "modeled",
        lowerValueInteger: 276_500_000,
        middleValueInteger: 392_500_000,
        higherValueInteger: 536_500_000,
        successProbabilityPpm: 640_000,
        unit: "minor_units",
        horizonDate: "2031-12-31",
        methodology: "Synthetic method",
        createdAt: "2026-07-01T09:00:00-07:00",
        createdBy: "Demo Operator",
      },
    },
  ],
};

const overviewLiquidityCurve: AlphaData["scenarios"][number]["liquidityCurve"] =
  [
    {
      year: 2027,
      p25Minor: 0,
      p50Minor: 18_000_000,
      p75Minor: 62_000_000,
      expectedMinor: 26_000_000,
      probabilityZeroPpm: 690_000,
    },
    {
      year: 2028,
      p25Minor: 12_000_000,
      p50Minor: 54_000_000,
      p75Minor: 128_000_000,
      expectedMinor: 71_000_000,
      probabilityZeroPpm: 420_000,
    },
    {
      year: 2029,
      p25Minor: 42_000_000,
      p50Minor: 108_000_000,
      p75Minor: 210_000_000,
      expectedMinor: 132_000_000,
      probabilityZeroPpm: 230_000,
    },
    {
      year: 2030,
      p25Minor: 72_000_000,
      p50Minor: 166_000_000,
      p75Minor: 286_000_000,
      expectedMinor: 195_000_000,
      probabilityZeroPpm: 120_000,
    },
    {
      year: 2031,
      p25Minor: 94_000_000,
      p50Minor: 210_000_000,
      p75Minor: 354_000_000,
      expectedMinor: 246_000_000,
      probabilityZeroPpm: 70_000,
    },
  ];

export function withStableOverviewValues(data: AlphaData): AlphaData {
  return {
    ...data,
    dashboard: {
      ...data.dashboard,
      fiEligibleLiquidMinor: 182_500_000,
      protectedRunwayMonths: 42,
      protectedCashFloorMinor: 10_300_000,
      householdBurnMonthlyMinor: 2_850_000,
      businessBurnMonthlyMinor: 1_250_000,
      fiTargetMinor: 325_000_000,
      fiGapMinor: 142_500_000,
      p25FiveYearLiquidityMinor: 94_000_000,
      p50FiveYearLiquidityMinor: 210_000_000,
      p75FiveYearLiquidityMinor: 354_000_000,
      probabilityCrossingFiPpm: 640_000,
    },
    goals: [
      overviewPrimaryGoal,
      ...data.goals.filter((goal) => !goal.isPrimary),
    ],
    scenarios: data.scenarios.map((scenario) =>
      scenario.name === "FI Underwriting"
        ? { ...scenario, liquidityCurve: overviewLiquidityCurve }
        : scenario,
    ),
  };
}
