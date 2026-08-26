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

export function withStableOverviewValues(data: AlphaData): AlphaData {
  return {
    ...data,
    dashboard: {
      ...data.dashboard,
      fiEligibleLiquidMinor: 182_500_000,
      protectedRunwayMonths: 42,
      fiTargetMinor: 325_000_000,
      fiGapMinor: 142_500_000,
    },
    goals: [
      overviewPrimaryGoal,
      ...data.goals.filter((goal) => !goal.isPrimary),
    ],
  };
}
