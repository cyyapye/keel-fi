import {
  ANGELLIST_INVESTMENTS_CSV_HEADERS,
  ANGELLIST_INVESTMENTS_CSV_PREAMBLE,
} from "@keel/connectors";
import type {
  AlphaRepository,
  AngelListMacAgentRepository,
} from "@keel/database";
import type {
  AlphaData,
  AngelListMacAgentOverview,
  HoldingImportPreview,
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
  },
  rows: [
    {
      id: "import_row_synthetic",
      sourceRowNumber: 3,
      positionName: "Synthetic Finch SPV",
      exposureName: "Synthetic Finch Labs",
      ownerLabel: "Synthetic Demo LLC",
      providerStatus: "Live",
      investedOn: "2026-06-14",
      investedMinor: 10_000,
      administratorNavMinor: 12_500,
      administratorNavState: "reported",
      realizedValueMinor: 0,
      ticker: null,
      quantityMicros: null,
      costBasisMinor: null,
      action: "create_position",
      issues: [],
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

function testEnv(environment: Env["ENVIRONMENT"]): Env {
  return {
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
        rows: [
          expect.objectContaining({
            companyOrFund: "Synthetic Finch Labs",
            fundName: "Synthetic Finch SPV",
          }),
        ],
      }),
    );
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
});
