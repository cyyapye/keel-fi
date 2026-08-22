import {
  ANGELLIST_INVESTMENTS_CSV_HEADERS,
  ANGELLIST_INVESTMENTS_CSV_PREAMBLE,
  providerHoldingsTemplateCsv,
} from "@keel/connectors";
import type {
  AlphaRepository,
  AngelListMacAgentRepository,
  MacAgentCredentialRepository,
  PlanInputsRepository,
  PortfolioBaselineRepository,
  ProviderPortfolioAgentRepository,
} from "@keel/database";
import type {
  AlphaData,
  AngelListMacAgentOverview,
  HoldingImportPreview,
  PlanInputSaveResult,
  PlanInputState,
  PortfolioBaselineConfirmResult,
  PortfolioBaselineState,
  ProviderPortfolioAgentOverview,
} from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { Env } from "./types";

const alphaData: AlphaData = {
  dashboard: {
    asOfDate: "2026-07-01",
    forecastHorizonDate: "2031-12-31",
    householdName: "Demo Household",
    fiEligibleLiquidMinor: 182_500_000,
    protectedRunwayMonths: 42,
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
    {
      id: "goal_fi",
      templateKey: "financial_independence",
      isPrimary: true,
      archivedAt: null,
      createdAt: "2026-07-01T09:00:00-07:00",
      versions: [
        {
          id: "goalv_fi_1",
          version: 1,
          name: "Financial independence",
          metricKey: "fi_eligible_liquid",
          metricLabel: "FI-eligible liquid assets",
          targetValueInteger: 325_000_000,
          targetUnit: "minor_units",
          targetDate: null,
          currentValueInteger: 182_500_000,
          currentValueSource: "Synthetic FI planning inputs",
          changeNote: "Initial synthetic FI goal",
          createdAt: "2026-07-01T09:00:00-07:00",
          createdBy: "Demo Operator",
          forecast: {
            id: "goalsnap_fi_1",
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
    },
  ],
  holdings: [],
  evidenceInbox: [],
  portfolioWatch: { targets: [], observations: [] },
  signalReconciliations: [],
  signalUpdateProposals: [],
  scenarios: [],
  forecastHistory: [],
};

const holdingImportPreview: HoldingImportPreview = {
  id: "import_synthetic_angellist",
  provider: "angellist",
  status: "pending_review",
  observedAt: "2026-06-14T00:00:00.000Z",
  summary: {
    rowCount: 1,
    administratorValueCount: 1,
    lockedValueCount: 0,
    createCount: 1,
    updateCount: 0,
    unchangedCount: 0,
    needsAttentionCount: 0,
    autoAppliedCount: 0,
    quarantinedCount: 0,
    preservedPositionCount: 0,
  },
  coverage: [],
  rows: [
    {
      id: "import_row_synthetic",
      sourceRowNumber: 3,
      positionName: "Synthetic Finch SPV",
      exposureName: "Synthetic Finch Labs",
      ownerLabel: "Synthetic Demo LLC",
      providerStatus: "Live",
      investedOn: "2026-06-14",
      investedOnState: "reported",
      investedMinor: 10_000,
      administratorNavMinor: 12_500,
      administratorNavState: "reported",
      realizedValueMinor: 0,
      ticker: null,
      quantityMicros: null,
      costBasisMinor: null,
      action: "create_position",
      issues: [],
      adjudicationStatus: "pending_review",
      decisionSource: null,
      reasonCodes: [],
    },
  ],
};

function syntheticAngelListCsv(): string {
  const row = [
    "Synthetic Finch Labs",
    "Live",
    "6/14/2026",
    "$100.00",
    "$125.00",
    "$0.00",
    "$125.00",
    "1.25",
    "Synthetic Demo LLC",
    "",
    "Syndicate",
    "",
    "Seed",
    "Software",
    "Synthetic Finch SPV",
    "$500.00",
    "safe",
    "",
    "Post-money",
    "$5000000.00",
    "",
    "20%",
    "",
  ];
  return [
    ANGELLIST_INVESTMENTS_CSV_PREAMBLE,
    ANGELLIST_INVESTMENTS_CSV_HEADERS.join(","),
    row.join(","),
  ].join("\n");
}

function syntheticProviderTemplateCsv(
  provider: "tokenfolio" | "sydecar",
  asOfDate = "2026-08-20",
): string {
  const row = [
    provider === "tokenfolio" ? "Synthetic Robotics" : "Example Climate Fund",
    provider === "tokenfolio"
      ? "Synthetic Robotics direct shares"
      : "Example Climate Fund SPV I",
    provider === "tokenfolio" ? "Direct" : "SPV",
    provider === "tokenfolio"
      ? "Synthetic Family Trust"
      : "Synthetic Investment Profile",
    "Live",
    "2025-02-01",
    asOfDate,
    provider === "tokenfolio" ? "$1250.00" : "$5000.00",
    provider === "tokenfolio" ? "" : "$7500.00",
    provider === "tokenfolio" ? "$1800.25" : "",
    "",
    provider === "tokenfolio" ? "Common stock" : "Membership interest",
  ];
  return `${providerHoldingsTemplateCsv(provider)}${row.join(",")}\n`;
}

function testEnv(environment: Env["ENVIRONMENT"]): Env {
  return {
    CONNECTOR_CREDENTIAL_KEY: btoa("k".repeat(32))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, ""),
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: environment,
    INGESTION_QUEUE: {} as Queue,
  };
}

const readyAgentOverview: AngelListMacAgentOverview = {
  version: 1,
  status: "ready",
  interval: "weekly",
  runStatus: null,
  lastSeenAt: "2026-08-09T12:00:00.000Z",
  lastCompletedAt: null,
  nextRunAt: "2026-08-16T12:00:00.000Z",
  latestImportId: null,
  errorCode: null,
};

const readyProviderAgentOverview: ProviderPortfolioAgentOverview = {
  version: 1,
  provider: "tokenfolio",
  status: "ready",
  interval: "daily",
  runStatus: null,
  lastSeenAt: "2026-08-21T12:00:00.000Z",
  lastCompletedAt: null,
  nextRunAt: "2026-08-22T12:00:00.000Z",
  latestImportId: null,
  errorCode: null,
};

const portfolioBaselineState: PortfolioBaselineState = {
  status: "ready",
  sourceRevision: "a".repeat(64),
  observedAt: "2026-08-10T16:00:00.000Z",
  baseForecastSnapshotId: "snap_fi_v3",
  baseForecastSnapshotVersion: 3,
  summary: {
    positionCount: 1,
    publicMarketValueMinor: 23_800_000,
    privatePaperValueMinor: 0,
    cashAccountCount: 0,
    cashAccountValueMinor: 0,
    unknownCashAccountCount: 0,
    unknownValueCount: 0,
    potentialDuplicateCount: 0,
  },
  positions: [
    {
      id: "holding_demo_robinhood",
      positionName: "Synthetic Public Company",
      ownerLabel: "Demo Brokerage",
      sourceLabel: "Robinhood",
      provider: "plaid_investments",
      classification: "public_market",
      valueMinor: 23_800_000,
      valueState: "reported",
      observedAt: "2026-08-10T16:00:00.000Z",
      ticker: "SYN",
      isCashPosition: false,
      potentialDuplicate: false,
      duplicateWith: [],
    },
  ],
  cashAccounts: [],
  planning: {
    currentFiEligibleLiquidMinor: 182_500_000,
    protectedCashFloorMinor: 10_300_000,
    householdBurnMonthlyMinor: 2_850_000,
    businessBurnMonthlyMinor: 1_250_000,
    fiTargetMinor: 325_000_000,
    p25FiveYearLiquidityMinor: 94_000_000,
    p50FiveYearLiquidityMinor: 210_000_000,
    p75FiveYearLiquidityMinor: 354_000_000,
    forecastHorizonDate: "2031-12-31",
  },
  suggestedOtherFiEligibleLiquidMinor: 0,
  currentImpact: {
    fiEligibleLiquidMinor: 182_500_000,
    fiEligibleChangeMinor: 0,
    protectedRunwayMonths: 42,
    fiGapMinor: 142_500_000,
    lowerTotalAvailableMinor: 276_500_000,
    middleTotalAvailableMinor: 392_500_000,
    higherTotalAvailableMinor: 536_500_000,
    probabilityCrossingFiPpm: 645_475,
  },
  latestBaseline: null,
  hasSourceChanges: true,
  hasCashAccountChanges: false,
  requiresDuplicateReview: false,
  requiresCashOverlapReview: false,
  canConfirm: true,
};

const portfolioBaselineResult: PortfolioBaselineConfirmResult = {
  baseline: {
    id: "baseline_synthetic",
    sourceRevision: "a".repeat(64),
    observedAt: "2026-08-10T16:00:00.000Z",
    summary: portfolioBaselineState.summary!,
    priorFiEligibleLiquidMinor: 182_500_000,
    fiEligibleLiquidMinor: 200_000_000,
    otherFiEligibleLiquidMinor: 176_200_000,
    forecastSnapshotId: "snap_fi_v4",
    forecastSnapshotVersion: 4,
    goalVersion: 2,
    changeNote: "Reviewed synced holdings for the FI plan.",
    createdAt: "2026-08-13T12:00:00.000Z",
    createdBy: "Demo Operator",
  },
  impact: {
    fiEligibleLiquidMinor: 200_000_000,
    fiEligibleChangeMinor: 17_500_000,
    protectedRunwayMonths: 46,
    fiGapMinor: 125_000_000,
    lowerTotalAvailableMinor: 294_000_000,
    middleTotalAvailableMinor: 410_000_000,
    higherTotalAvailableMinor: 554_000_000,
    probabilityCrossingFiPpm: 683_190,
  },
};

const planInputState: PlanInputState = {
  baseCashFlowPlanId: "cf_fi",
  baseForecastSnapshotId: "snap_fi_v3",
  baseForecastSnapshotVersion: 3,
  values: {
    householdBurnMonthlyMinor: 2_850_000,
    businessBurnMonthlyMinor: 1_250_000,
    protectedCashFloorMinor: 10_300_000,
  },
  fiEligibleLiquidMinor: 182_500_000,
  fiTargetMinor: 325_000_000,
  forecastHorizonDate: "2031-12-31",
  impact: {
    totalMonthlyBurnMinor: 4_100_000,
    liquidAfterCashFloorMinor: 172_200_000,
    protectedRunwayMonths: 42,
  },
};

const planInputResult: PlanInputSaveResult = {
  plan: {
    ...planInputState,
    baseCashFlowPlanId: "cf_fi_v2",
    baseForecastSnapshotId: "snap_fi_v4",
    baseForecastSnapshotVersion: 4,
    values: {
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
      protectedCashFloorMinor: 15_000_000,
    },
    impact: {
      totalMonthlyBurnMinor: 4_500_000,
      liquidAfterCashFloorMinor: 167_500_000,
      protectedRunwayMonths: 37,
    },
  },
  priorImpact: planInputState.impact,
  createdAt: "2026-08-14T12:00:00.000Z",
  createdBy: "Demo Operator",
};

function macAgentRepository(
  overrides: Partial<AngelListMacAgentRepository> = {},
): AngelListMacAgentRepository {
  return {
    getOverview: vi.fn().mockResolvedValue(readyAgentOverview),
    register: vi.fn().mockResolvedValue(readyAgentOverview),
    configure: vi.fn().mockResolvedValue(readyAgentOverview),
    requestRun: vi.fn().mockResolvedValue({
      version: 1,
      runId: "11111111-1111-4111-8111-111111111111",
      status: "queued",
    }),
    lease: vi.fn().mockResolvedValue({
      version: 1,
      serverTime: "2026-08-09T12:00:00.000Z",
      run: null,
    }),
    assertLease: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(readyAgentOverview),
    fail: vi.fn().mockResolvedValue(readyAgentOverview),
    ...overrides,
  };
}

function providerAgentRepository(
  overrides: Partial<ProviderPortfolioAgentRepository> = {},
): ProviderPortfolioAgentRepository {
  return {
    getOverview: vi.fn().mockResolvedValue(readyProviderAgentOverview),
    register: vi.fn().mockResolvedValue(readyProviderAgentOverview),
    configure: vi.fn().mockResolvedValue(readyProviderAgentOverview),
    requestRun: vi.fn().mockResolvedValue({
      version: 1,
      provider: "tokenfolio",
      runId: "11111111-1111-4111-8111-111111111111",
      status: "queued",
    }),
    lease: vi.fn().mockResolvedValue({
      version: 1,
      provider: "tokenfolio",
      serverTime: "2026-08-21T12:00:00.000Z",
      run: null,
    }),
    assertLease: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(readyProviderAgentOverview),
    fail: vi.fn().mockResolvedValue(readyProviderAgentOverview),
    ...overrides,
  };
}

function macAgentCredentialRepository(
  overrides: Partial<MacAgentCredentialRepository> = {},
): MacAgentCredentialRepository {
  return {
    issueToken: vi.fn().mockResolvedValue(`keel_agent_v1_${"a".repeat(43)}`),
    authenticate: vi.fn().mockResolvedValue("synthetic-access-subject"),
    ...overrides,
  };
}

describe("Keel API", () => {
  it("fails closed in production without an Access assertion", async () => {
    const getAlphaData = vi.fn<AlphaRepository["getAlphaData"]>();
    const repository: AlphaRepository = {
      getAlphaData,
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const response = await createApp({ repository }).request(
      "/api/alpha",
      {},
      testEnv("production"),
    );

    expect(response.status).toBe(401);
    expect(getAlphaData).not.toHaveBeenCalled();
  });

  it("fails closed when an Access assertion cannot be verified", async () => {
    const getAlphaData = vi.fn<AlphaRepository["getAlphaData"]>();
    const repository: AlphaRepository = {
      getAlphaData,
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const response = await createApp({
      repository,
      verifyAccess: vi.fn(() => Promise.reject(new Error("Invalid token"))),
    }).request(
      "/api/alpha",
      { headers: { "Cf-Access-Jwt-Assertion": "invalid" } },
      testEnv("production"),
    );

    expect(response.status).toBe(401);
    expect(getAlphaData).not.toHaveBeenCalled();
  });

  it("rejects a verified service identity from user API routes", async () => {
    const getAlphaData = vi.fn<AlphaRepository["getAlphaData"]>();
    const repository: AlphaRepository = {
      getAlphaData,
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const response = await createApp({
      repository,
      verifyAccess: vi.fn(() =>
        Promise.resolve({
          kind: "service" as const,
          subject: `${"a".repeat(32)}.access`,
          email: null,
        }),
      ),
    }).request(
      "/api/alpha",
      { headers: { "Cf-Access-Jwt-Assertion": "valid-service-token" } },
      testEnv("preview"),
    );

    expect(response.status).toBe(403);
    expect(getAlphaData).not.toHaveBeenCalled();
  });

  it("serves database repository data in explicitly local mode", async () => {
    const getAlphaData = vi
      .fn<AlphaRepository["getAlphaData"]>()
      .mockResolvedValue(alphaData);
    const repository: AlphaRepository = {
      getAlphaData,
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const response = await createApp({ repository }).request(
      "/api/alpha",
      {},
      testEnv("local"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dashboard: { protectedRunwayMonths: 42 },
    });
    expect(getAlphaData).toHaveBeenCalledWith("synthetic-access-subject");
  });

  it("loads the reviewed-holdings portfolio baseline state", async () => {
    const getState = vi
      .fn<PortfolioBaselineRepository["getState"]>()
      .mockResolvedValue(portfolioBaselineState);
    const portfolioBaselineRepository: PortfolioBaselineRepository = {
      getState,
      confirm: vi.fn(),
    };

    const response = await createApp({ portfolioBaselineRepository }).request(
      "/api/portfolio-baseline",
      {},
      testEnv("local"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(portfolioBaselineState);
    expect(getState).toHaveBeenCalledWith("synthetic-access-subject");
  });

  it("confirms a validated portfolio baseline through its explicit endpoint", async () => {
    const confirm = vi
      .fn<PortfolioBaselineRepository["confirm"]>()
      .mockResolvedValue(portfolioBaselineResult);
    const portfolioBaselineRepository: PortfolioBaselineRepository = {
      getState: vi.fn(),
      confirm,
    };
    const input = {
      sourceRevision: portfolioBaselineState.sourceRevision,
      baseForecastSnapshotId: portfolioBaselineState.baseForecastSnapshotId,
      baseForecastSnapshotVersion:
        portfolioBaselineState.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor: 176_200_000,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Reviewed synced holdings for the FI plan.",
    };

    const response = await createApp({ portfolioBaselineRepository }).request(
      "/api/portfolio-baselines",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(portfolioBaselineResult);
    expect(confirm).toHaveBeenCalledWith("synthetic-access-subject", input);
  });

  it("rejects stale portfolio baseline confirmation without retrying", async () => {
    const confirm = vi
      .fn<PortfolioBaselineRepository["confirm"]>()
      .mockRejectedValue(new Error("Portfolio baseline source is stale."));
    const portfolioBaselineRepository: PortfolioBaselineRepository = {
      getState: vi.fn(),
      confirm,
    };

    const response = await createApp({ portfolioBaselineRepository }).request(
      "/api/portfolio-baselines",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceRevision: portfolioBaselineState.sourceRevision,
          baseForecastSnapshotId: portfolioBaselineState.baseForecastSnapshotId,
          baseForecastSnapshotVersion:
            portfolioBaselineState.baseForecastSnapshotVersion,
          otherFiEligibleLiquidMinor: 176_200_000,
          duplicateReviewConfirmed: false,
          cashOverlapReviewConfirmed: false,
          changeNote: "Reviewed synced holdings for the FI plan.",
        }),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "The portfolio or forecast changed. Review the latest baseline before confirming.",
    });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("loads the accepted runway plan", async () => {
    const getState = vi
      .fn<PlanInputsRepository["getState"]>()
      .mockResolvedValue(planInputState);
    const planInputsRepository: PlanInputsRepository = {
      getState,
      save: vi.fn(),
    };

    const response = await createApp({ planInputsRepository }).request(
      "/api/plan-inputs",
      {},
      testEnv("local"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(planInputState);
    expect(getState).toHaveBeenCalledWith("synthetic-access-subject");
  });

  it("appends validated runway plan inputs", async () => {
    const save = vi
      .fn<PlanInputsRepository["save"]>()
      .mockResolvedValue(planInputResult);
    const planInputsRepository: PlanInputsRepository = {
      getState: vi.fn(),
      save,
    };
    const input = {
      baseCashFlowPlanId: planInputState.baseCashFlowPlanId,
      baseForecastSnapshotId: planInputState.baseForecastSnapshotId,
      baseForecastSnapshotVersion: planInputState.baseForecastSnapshotVersion,
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
      protectedCashFloorMinor: 15_000_000,
      changeNote: "Updated synthetic runway inputs.",
    };

    const response = await createApp({ planInputsRepository }).request(
      "/api/plan-inputs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(planInputResult);
    expect(save).toHaveBeenCalledWith("synthetic-access-subject", input);
  });

  it("fails closed for invalid or stale runway plan saves", async () => {
    const save = vi
      .fn<PlanInputsRepository["save"]>()
      .mockRejectedValue(new Error("Plan inputs are stale."));
    const planInputsRepository: PlanInputsRepository = {
      getState: vi.fn(),
      save,
    };
    const staleInput = {
      baseCashFlowPlanId: planInputState.baseCashFlowPlanId,
      baseForecastSnapshotId: planInputState.baseForecastSnapshotId,
      baseForecastSnapshotVersion: planInputState.baseForecastSnapshotVersion,
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
      protectedCashFloorMinor: 15_000_000,
      changeNote: "Updated synthetic runway inputs.",
    };

    const invalid = await createApp({ planInputsRepository }).request(
      "/api/plan-inputs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...staleInput, householdBurnMonthlyMinor: -1 }),
      },
      testEnv("local"),
    );
    expect(invalid.status).toBe(400);
    expect(save).not.toHaveBeenCalled();

    const stale = await createApp({ planInputsRepository }).request(
      "/api/plan-inputs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(staleInput),
      },
      testEnv("local"),
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({
      error:
        "The plan or forecast changed. Reload the latest plan before saving.",
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it("runs a household-scoped public-source scan", async () => {
    const preparePortfolioWatchScan = vi
      .fn<AlphaRepository["preparePortfolioWatchScan"]>()
      .mockResolvedValue({
        checkedAt: "2026-08-01T12:00:00-07:00",
        jobs: [
          {
            type: "portfolio_watch_source_verify",
            sourceId: "source-1",
          },
        ],
      });
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      preparePortfolioWatchScan,
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };

    const env = testEnv("local");
    const send = vi
      .fn<Queue["send"]>()
      .mockResolvedValue({} as Awaited<ReturnType<Queue["send"]>>);
    env.INGESTION_QUEUE = { send } as unknown as Queue;
    const response = await createApp({ repository }).request(
      "/api/watch/scan",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      queuedCount: 1,
      discoveredCount: 0,
      proposedCount: 0,
    });
    expect(preparePortfolioWatchScan).toHaveBeenCalledWith(
      "synthetic-access-subject",
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "portfolio_watch_source_verify",
        sourceId: "source-1",
      }),
    );
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty("url");
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty("householdId");
  });

  it("stages a bounded AngelList CSV in private storage before review", async () => {
    const stageHoldingImport = vi
      .fn<AlphaRepository["stageHoldingImport"]>()
      .mockResolvedValue({ created: true, preview: holdingImportPreview });
    const repository: AlphaRepository = {
      getAlphaData: vi.fn(),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport,
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const put = vi.fn().mockResolvedValue({});
    const remove = vi.fn().mockResolvedValue(undefined);
    const env = testEnv("local");
    env.DOCUMENTS = { put, delete: remove } as unknown as R2Bucket;
    const formData = new FormData();
    formData.set(
      "file",
      new File(
        [syntheticAngelListCsv()],
        "synthetic_angellist_investments_2026_06_14.csv",
        { type: "text/csv" },
      ),
    );

    const response = await createApp({ repository }).request(
      "/api/holding-imports/angellist",
      { method: "POST", body: formData },
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(holdingImportPreview);
    expect(put).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(stageHoldingImport).toHaveBeenCalledWith(
      "synthetic-access-subject",
      expect.objectContaining({
        byteSize: new TextEncoder().encode(syntheticAngelListCsv()).byteLength,
        effectiveDate: "2026-06-14",
        canonicalScope: expect.objectContaining({
          connection: expect.objectContaining({
            mode: "ensure",
            adapterType: "angellist-import",
          }),
          containers: [
            expect.objectContaining({
              displayLabel: "Synthetic Demo LLC",
              completeness: "complete",
            }),
          ],
        }),
        rows: [
          expect.objectContaining({
            companyOrFund: "Synthetic Finch Labs",
            fundName: "Synthetic Finch SPV",
          }),
        ],
      }),
    );
  });

  it.each(["tokenfolio", "sydecar"] as const)(
    "stages a bounded %s template in private storage before review",
    async (provider) => {
      const providerPreview: HoldingImportPreview = {
        ...holdingImportPreview,
        id: `import_synthetic_${provider}`,
        provider,
        observedAt: "2026-08-20T00:00:00.000Z",
      };
      const stageHoldingImport = vi
        .fn<AlphaRepository["stageHoldingImport"]>()
        .mockResolvedValue({ created: true, preview: providerPreview });
      const repository: AlphaRepository = {
        getAlphaData: vi.fn(),
        preparePortfolioWatchScan: vi.fn(),
        stageHoldingImport,
        getHoldingImport: vi.fn(),
        listPendingHoldingImports: vi.fn(),
        applyHoldingImport: vi.fn(),
        saveGoal: vi.fn(),
        saveScenario: vi.fn(),
        createSignalUpdateProposal: vi.fn(),
        reviewEvidence: vi.fn(),
        applyEvidence: vi.fn(),
      };
      const put = vi.fn().mockResolvedValue({});
      const remove = vi.fn().mockResolvedValue(undefined);
      const env = testEnv("local");
      env.DOCUMENTS = { put, delete: remove } as unknown as R2Bucket;
      const template = syntheticProviderTemplateCsv(provider);
      const formData = new FormData();
      formData.set(
        "file",
        new File([template], `${provider}-holdings.csv`, { type: "text/csv" }),
      );

      const response = await createApp({ repository }).request(
        `/api/holding-imports/${provider}`,
        { method: "POST", body: formData },
        env,
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual(providerPreview);
      expect(put).toHaveBeenCalledOnce();
      expect(remove).not.toHaveBeenCalled();
      expect(stageHoldingImport).toHaveBeenCalledWith(
        "synthetic-access-subject",
        expect.objectContaining({
          provider,
          effectiveDate: "2026-08-20",
          byteSize: new TextEncoder().encode(template).byteLength,
          canonicalScope: expect.objectContaining({
            connection: expect.objectContaining({
              adapterType: "manual",
              institutionKey: provider,
              mode: "ensure",
            }),
            containers: [expect.objectContaining({ completeness: "partial" })],
          }),
          rows: [
            expect.objectContaining({
              companyOrFund:
                provider === "tokenfolio"
                  ? "Synthetic Robotics"
                  : "Example Climate Fund",
              positionKind:
                provider === "tokenfolio" ? "direct" : "spv_interest",
            }),
          ],
        }),
      );
    },
  );

  it.each(["tokenfolio", "sydecar"] as const)(
    "downloads the versioned %s template without caching it",
    async (provider) => {
      const response = await createApp().request(
        `/api/holding-import-templates/${provider}`,
        {},
        testEnv("local"),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Content-Disposition")).toBe(
        `attachment; filename="${provider}-holdings.csv"`,
      );
      await expect(response.text()).resolves.toBe(
        providerHoldingsTemplateCsv(provider),
      );
    },
  );

  it("rejects a provider template dated in the future before storage", async () => {
    const repository = {
      getAlphaData: vi.fn(),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    } satisfies AlphaRepository;
    const put = vi.fn().mockResolvedValue({});
    const env = testEnv("local");
    env.DOCUMENTS = {
      put,
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket;
    const formData = new FormData();
    formData.set(
      "file",
      new File(
        [syntheticProviderTemplateCsv("tokenfolio", "2099-01-01")],
        "tokenfolio-holdings.csv",
        { type: "text/csv" },
      ),
    );

    const response = await createApp({ repository }).request(
      "/api/holding-imports/tokenfolio",
      { method: "POST", body: formData },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Tokenfolio template As Of Date cannot be in the future.",
    });
    expect(put).not.toHaveBeenCalled();
    expect(repository.stageHoldingImport).not.toHaveBeenCalled();
  });

  it("lists only the authenticated household's pending holding imports", async () => {
    const pendingImports = [
      {
        id: holdingImportPreview.id,
        provider: "angellist" as const,
        status: "pending_review" as const,
        observedAt: holdingImportPreview.observedAt,
        rowCount: holdingImportPreview.summary.rowCount,
        createdAt: "2026-06-14T12:01:00.000Z",
      },
    ];
    const listPendingHoldingImports = vi
      .fn<AlphaRepository["listPendingHoldingImports"]>()
      .mockResolvedValue(pendingImports);
    const repository: AlphaRepository = {
      getAlphaData: vi.fn(),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports,
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };

    const response = await createApp({ repository }).request(
      "/api/holding-imports",
      {},
      testEnv("local"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(pendingImports);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(listPendingHoldingImports).toHaveBeenCalledWith(
      "synthetic-access-subject",
    );
  });

  it("does not expose the retired magic-link route or log its body", async () => {
    const submittedLink =
      "https://example.com/sign-in?token=synthetic-sensitive-link";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const response = await createApp().request(
        "/api/automation/angellist/sign-in-refreshes/11111111-1111-4111-8111-111111111111/magic-link",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ magicLink: submittedLink }),
        },
        testEnv("local"),
      );

      expect(response.status).toBe(404);
      expect(JSON.stringify(info.mock.calls)).not.toContain(submittedLink);
      expect(JSON.stringify(info.mock.calls)).not.toContain(
        "synthetic-sensitive-link",
      );
    } finally {
      info.mockRestore();
    }
  });

  it("applies only a complete validated holding-import review", async () => {
    const applyHoldingImport = vi
      .fn<AlphaRepository["applyHoldingImport"]>()
      .mockResolvedValue({
        importId: holdingImportPreview.id,
        createdCount: 1,
        updatedCount: 0,
        unchangedCount: 0,
        rejectedCount: 0,
        lockedValueCount: 0,
      });
    const repository: AlphaRepository = {
      getAlphaData: vi.fn(),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport,
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const decision = {
      rowId: "import_row_synthetic",
      decision: "accepted" as const,
      rationale: "Accepted after reviewing the synthetic import.",
    };

    const response = await createApp({ repository }).request(
      `/api/holding-imports/${holdingImportPreview.id}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: "USD", decisions: [decision] }),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(200);
    expect(applyHoldingImport).toHaveBeenCalledWith(
      "synthetic-access-subject",
      holdingImportPreview.id,
      { currency: "USD", decisions: [decision] },
    );
  });

  it("records a validated review without applying the proposed fact", async () => {
    const reviewEvidence = vi
      .fn<AlphaRepository["reviewEvidence"]>()
      .mockResolvedValue(undefined);
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence,
      applyEvidence: vi.fn(),
    };
    const response = await createApp({ repository }).request(
      "/api/evidence/evt_demo/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "scenario_only",
          rationale: "Use only in the synthetic upside case.",
        }),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(204);
    expect(reviewEvidence).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "evt_demo",
      {
        decision: "scenario_only",
        rationale: "Use only in the synthetic upside case.",
      },
    );
  });

  it("applies a deterministic accepted evidence change through its explicit endpoint", async () => {
    const applyEvidence = vi
      .fn<AlphaRepository["applyEvidence"]>()
      .mockResolvedValue(undefined);
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence,
    };
    const response = await createApp({ repository }).request(
      "/api/evidence/evt_demo/apply",
      { method: "POST" },
      testEnv("local"),
    );

    expect(response.status).toBe(204);
    expect(applyEvidence).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "evt_demo",
    );
  });

  it("returns a conflict when evidence has an inconsistent review state", async () => {
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi
        .fn<AlphaRepository["applyEvidence"]>()
        .mockRejectedValue(
          new Error("Pending evidence already has a review decision."),
        ),
    };
    const response = await createApp({ repository }).request(
      "/api/evidence/evt_demo/apply",
      { method: "POST" },
      testEnv("local"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Evidence cannot be applied automatically.",
    });
  });

  it("creates a validated signal update proposal without applying it", async () => {
    const input = {
      groupId: "co_northstar:series-c",
      reconciliationRevision: "a".repeat(64),
      scenarioId: "scn_sandbox",
      baseForecastSnapshotId: "snap_sandbox_v1",
      rationale: "Model the reviewed company valuation separately.",
    };
    const createSignalUpdateProposal = vi
      .fn<AlphaRepository["createSignalUpdateProposal"]>()
      .mockResolvedValue({
        id: "proposal_1",
        groupId: input.groupId,
        reconciliationRevision: input.reconciliationRevision,
        companyId: "co_northstar",
        companyName: "Northstar Robotics",
        scenarioId: input.scenarioId,
        scenarioName: "Sandbox",
        baseForecastSnapshotId: input.baseForecastSnapshotId,
        baseForecastSnapshotVersion: 1,
        evidenceEventIds: ["evt_company", "evt_filing"],
        proposedCompanyValuation: {
          amountMinor: 100_000_000_000,
          currency: "USD",
          qualifier: "exact",
          evidenceText: "The Series C reported a USD 1 billion valuation.",
          basis: "post_money",
        },
        rationale: input.rationale,
        createdAt: "2026-08-08T12:00:00Z",
        createdBy: "Demo Operator",
        isCurrent: true,
      });
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal,
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };

    const response = await createApp({ repository }).request(
      "/api/signal-update-proposals",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "proposal_1",
      isCurrent: true,
    });
    expect(createSignalUpdateProposal).toHaveBeenCalledWith(
      "synthetic-access-subject",
      input,
    );
  });

  it("validates and records a new immutable goal version", async () => {
    const saveGoal = vi
      .fn<AlphaRepository["saveGoal"]>()
      .mockResolvedValue(undefined);
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal,
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const input = {
      goalId: "goal_fi",
      templateKey: "financial_independence" as const,
      name: "Financial independence",
      metricKey: "fi_eligible_liquid",
      metricLabel: "FI-eligible liquid assets",
      targetValueInteger: 350_000_000,
      targetUnit: "minor_units" as const,
      targetDate: null,
      currentValueInteger: 190_000_000,
      makePrimary: true,
      changeNote: "Raised the target.",
    };

    const response = await createApp({ repository }).request(
      "/api/goals",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(204);
    expect(saveGoal).toHaveBeenCalledWith("synthetic-access-subject", input);
  });

  it("validates and records a new scenario version", async () => {
    const saveScenario = vi
      .fn<AlphaRepository["saveScenario"]>()
      .mockResolvedValue(undefined);
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario,
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const input = {
      scenarioId: "scn_fi",
      assumptions: [
        {
          id: "asm_probability",
          key: "liquidity_probability",
          value: 500_000,
        },
        { id: "asm_delay", key: "timing_delay_months", value: 12 },
      ],
      changeNote: "Test scenario sensitivity",
    };

    const response = await createApp({ repository }).request(
      "/api/scenarios",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(204);
    expect(saveScenario).toHaveBeenCalledWith(
      "synthetic-access-subject",
      input,
    );
  });

  it("rejects invalid scenario input before reaching the repository", async () => {
    const saveScenario = vi.fn<AlphaRepository["saveScenario"]>();
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport: vi.fn(),
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario,
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };

    const response = await createApp({ repository }).request(
      "/api/scenarios",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: "scn_fi",
          assumptions: [],
          changeNote: "",
        }),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(400);
    expect(saveScenario).not.toHaveBeenCalled();
  });

  it("issues a target-scoped Mac credential during one-time browser setup", async () => {
    const register = vi
      .fn<AngelListMacAgentRepository["register"]>()
      .mockResolvedValue(readyAgentOverview);
    const issueToken = vi
      .fn<MacAgentCredentialRepository["issueToken"]>()
      .mockResolvedValue(`keel_agent_v1_${"c".repeat(43)}`);
    const app = createApp({
      angelListMacAgentRepository: macAgentRepository({ register }),
      macAgentCredentialRepository: macAgentCredentialRepository({
        issueToken,
      }),
    });
    const rejected = await app.request(
      "/api/automation/angellist/mac-agent/authorize",
      { method: "POST" },
      testEnv("local"),
    );
    expect(rejected.status).toBe(403);
    expect(register).not.toHaveBeenCalled();

    const response = await app.request(
      "/api/automation/angellist/mac-agent/authorize",
      { method: "POST", headers: { "X-Keel-Mac-Setup": "1" } },
      testEnv("local"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      version: 1,
      target: "angellist",
      apiOrigin: "http://localhost",
      token: `keel_agent_v1_${"c".repeat(43)}`,
    });
    expect(register).toHaveBeenCalledWith("synthetic-access-subject");
    expect(issueToken).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "angellist",
    );
  });

  it("authenticates only exact machine routes on the dedicated agent origin", async () => {
    const authenticate = vi
      .fn<MacAgentCredentialRepository["authenticate"]>()
      .mockResolvedValue("synthetic-access-subject");
    const lease = vi
      .fn<ProviderPortfolioAgentRepository["lease"]>()
      .mockResolvedValue({
        version: 1,
        provider: "tokenfolio",
        serverTime: "2026-08-21T12:00:00.000Z",
        run: null,
      });
    const app = createApp({
      macAgentCredentialRepository: macAgentCredentialRepository({
        authenticate,
      }),
      providerPortfolioAgentRepository: providerAgentRepository({ lease }),
    });
    const token = `keel_agent_v1_${"d".repeat(43)}`;
    const env = {
      ...testEnv("preview"),
      MAC_AGENT_API_ORIGIN: "https://keel-preview-agents.example.com",
    };

    const response = await app.request(
      "https://keel-preview-agents.example.com/api/automation/provider-holdings/tokenfolio/mac-agent/lease",
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith("tokenfolio", token);
    expect(lease).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "tokenfolio",
    );

    const queued = await app.request(
      "https://keel-preview-agents.example.com/api/automation/provider-holdings/tokenfolio/mac-agent/run",
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(queued.status).toBe(202);

    const status = await app.request(
      "https://keel-preview-agents.example.com/api/automation/provider-holdings/tokenfolio/status",
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(status.status).toBe(401);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("rejects a machine token sent through the user origin", async () => {
    const authenticate = vi
      .fn<MacAgentCredentialRepository["authenticate"]>()
      .mockResolvedValue("synthetic-access-subject");
    const token = `keel_agent_v1_${"e".repeat(43)}`;
    const response = await createApp({
      macAgentCredentialRepository: macAgentCredentialRepository({
        authenticate,
      }),
    }).request(
      "https://keel-preview.example.com/api/automation/angellist/mac-agent/lease",
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      {
        ...testEnv("preview"),
        MAC_AGENT_API_ORIGIN: "https://keel-preview-agents.example.com",
      },
    );

    expect(response.status).toBe(404);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns Mac agent status and queues a phone request", async () => {
    const requestRun = vi
      .fn<AngelListMacAgentRepository["requestRun"]>()
      .mockResolvedValue({
        version: 1,
        runId: "11111111-1111-4111-8111-111111111111",
        status: "queued",
      });
    const agentRepository = macAgentRepository({ requestRun });
    const app = createApp({ angelListMacAgentRepository: agentRepository });

    const status = await app.request(
      "/api/automation/angellist/status",
      undefined,
      testEnv("local"),
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual(readyAgentOverview);

    const requested = await app.request(
      "/api/automation/angellist/run",
      { method: "POST" },
      testEnv("local"),
    );
    expect(requested.status).toBe(202);
    expect(requestRun).toHaveBeenCalledWith("synthetic-access-subject");
  });

  it("validates the Mac agent interval before repository access", async () => {
    const configure = vi.fn<AngelListMacAgentRepository["configure"]>();
    const response = await createApp({
      angelListMacAgentRepository: macAgentRepository({ configure }),
    }).request(
      "/api/automation/angellist/mac-agent/config",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval: "hourly" }),
      },
      testEnv("local"),
    );

    expect(response.status).toBe(400);
    expect(configure).not.toHaveBeenCalled();
  });

  it("stages a leased Mac export for review before completing the run", async () => {
    const stageHoldingImport = vi
      .fn<AlphaRepository["stageHoldingImport"]>()
      .mockResolvedValue({ created: true, preview: holdingImportPreview });
    const repository: AlphaRepository = {
      getAlphaData: vi.fn(),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport,
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const assertLease = vi
      .fn<AngelListMacAgentRepository["assertLease"]>()
      .mockResolvedValue(undefined);
    const complete = vi
      .fn<AngelListMacAgentRepository["complete"]>()
      .mockResolvedValue({
        ...readyAgentOverview,
        latestImportId: holdingImportPreview.id,
      });
    const agentRepository = macAgentRepository({ assertLease, complete });
    const put = vi.fn().mockResolvedValue(undefined);
    const env = {
      ...testEnv("local"),
      DOCUMENTS: { put } as unknown as R2Bucket,
    };
    const body = new FormData();
    body.append(
      "file",
      new File([syntheticAngelListCsv()], "investments_2026_08_09.csv", {
        type: "text/csv",
      }),
    );
    const leaseToken = "a".repeat(43);

    const response = await createApp({
      angelListMacAgentRepository: agentRepository,
      repository,
    }).request(
      "/api/automation/angellist/mac-agent/runs/11111111-1111-4111-8111-111111111111/complete",
      {
        method: "POST",
        headers: { "X-Keel-Agent-Lease": leaseToken },
        body,
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(assertLease).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "11111111-1111-4111-8111-111111111111",
      leaseToken,
    );
    expect(stageHoldingImport).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "11111111-1111-4111-8111-111111111111",
      leaseToken,
      holdingImportPreview.id,
    );
  });

  it("keeps provider-agent status and update requests provider-scoped", async () => {
    const requestRun = vi
      .fn<ProviderPortfolioAgentRepository["requestRun"]>()
      .mockResolvedValue({
        version: 1,
        provider: "sydecar",
        runId: "22222222-2222-4222-8222-222222222222",
        status: "queued",
      });
    const getOverview = vi
      .fn<ProviderPortfolioAgentRepository["getOverview"]>()
      .mockResolvedValue({
        ...readyProviderAgentOverview,
        provider: "sydecar",
      });
    const app = createApp({
      providerPortfolioAgentRepository: providerAgentRepository({
        getOverview,
        requestRun,
      }),
    });

    const status = await app.request(
      "/api/automation/provider-holdings/sydecar/status",
      undefined,
      testEnv("local"),
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      provider: "sydecar",
      status: "ready",
    });
    expect(getOverview).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "sydecar",
    );

    const requested = await app.request(
      "/api/automation/provider-holdings/sydecar/run",
      { method: "POST" },
      testEnv("local"),
    );
    expect(requested.status).toBe(202);
    expect(requestRun).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "sydecar",
    );

    const unsupported = await app.request(
      "/api/automation/provider-holdings/unknown/status",
      undefined,
      testEnv("local"),
    );
    expect(unsupported.status).toBe(404);
  });

  it("stages a leased provider capture for review before completing its run", async () => {
    const tokenfolioPreview: HoldingImportPreview = {
      ...holdingImportPreview,
      id: "import_synthetic_tokenfolio",
      provider: "tokenfolio",
      rows: holdingImportPreview.rows.map((row) => ({
        ...row,
        administratorNavMinor: 180_025,
      })),
    };
    const stageHoldingImport = vi
      .fn<AlphaRepository["stageHoldingImport"]>()
      .mockResolvedValue({ created: true, preview: tokenfolioPreview });
    const repository: AlphaRepository = {
      getAlphaData: vi.fn(),
      preparePortfolioWatchScan: vi.fn(),
      stageHoldingImport,
      getHoldingImport: vi.fn(),
      listPendingHoldingImports: vi.fn(),
      applyHoldingImport: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      createSignalUpdateProposal: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };
    const assertLease = vi
      .fn<ProviderPortfolioAgentRepository["assertLease"]>()
      .mockResolvedValue(undefined);
    const complete = vi
      .fn<ProviderPortfolioAgentRepository["complete"]>()
      .mockResolvedValue({
        ...readyProviderAgentOverview,
        latestImportId: tokenfolioPreview.id,
      });
    const put = vi.fn().mockResolvedValue(undefined);
    const env = {
      ...testEnv("local"),
      DOCUMENTS: { put } as unknown as R2Bucket,
    };
    const body = new FormData();
    body.append(
      "file",
      new File(
        [syntheticProviderTemplateCsv("tokenfolio")],
        "keel-tokenfolio-capture-2026-08-21.csv",
        { type: "text/csv" },
      ),
    );
    const leaseToken = "b".repeat(43);
    const runId = "33333333-3333-4333-8333-333333333333";

    const response = await createApp({
      providerPortfolioAgentRepository: providerAgentRepository({
        assertLease,
        complete,
      }),
      repository,
    }).request(
      `/api/automation/provider-holdings/tokenfolio/mac-agent/runs/${runId}/complete`,
      {
        method: "POST",
        headers: { "X-Keel-Agent-Lease": leaseToken },
        body,
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(assertLease).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "tokenfolio",
      runId,
      leaseToken,
    );
    expect(stageHoldingImport).toHaveBeenCalledWith(
      "synthetic-access-subject",
      expect.objectContaining({ provider: "tokenfolio" }),
    );
    expect(complete).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "tokenfolio",
      runId,
      leaseToken,
      tokenfolioPreview.id,
    );
  });
});
