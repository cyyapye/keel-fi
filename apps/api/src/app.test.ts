import type { AlphaRepository } from "@keel/database";
import type { AlphaData } from "@keel/domain";
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
  scenarios: [],
  forecastHistory: [],
};

function testEnv(environment: Env["ENVIRONMENT"]): Env {
  return {
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: environment,
    INGESTION_QUEUE: {} as Queue,
  };
}

describe("Keel API", () => {
  it("fails closed in production without an Access assertion", async () => {
    const getAlphaData = vi.fn<AlphaRepository["getAlphaData"]>();
    const repository: AlphaRepository = {
      getAlphaData,
      scanPortfolioWatch: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
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

  it("serves database repository data in explicitly local mode", async () => {
    const getAlphaData = vi
      .fn<AlphaRepository["getAlphaData"]>()
      .mockResolvedValue(alphaData);
    const repository: AlphaRepository = {
      getAlphaData,
      scanPortfolioWatch: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
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
    const scanPortfolioWatch = vi
      .fn<AlphaRepository["scanPortfolioWatch"]>()
      .mockResolvedValue({
        checkedAt: "2026-08-01T12:00:00-07:00",
        discoveredCount: 1,
        proposedCount: 1,
      });
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      scanPortfolioWatch,
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
      reviewEvidence: vi.fn(),
      applyEvidence: vi.fn(),
    };

    const response = await createApp({ repository }).request(
      "/api/watch/scan",
      { method: "POST" },
      testEnv("local"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      discoveredCount: 1,
      proposedCount: 1,
    });
    expect(scanPortfolioWatch).toHaveBeenCalledWith("synthetic-access-subject");
  });

  it("records a validated review without applying the proposed fact", async () => {
    const reviewEvidence = vi
      .fn<AlphaRepository["reviewEvidence"]>()
      .mockResolvedValue(undefined);
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      scanPortfolioWatch: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
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
      scanPortfolioWatch: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
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
      scanPortfolioWatch: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario: vi.fn(),
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

  it("validates and records a new immutable goal version", async () => {
    const saveGoal = vi
      .fn<AlphaRepository["saveGoal"]>()
      .mockResolvedValue(undefined);
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      scanPortfolioWatch: vi.fn(),
      saveGoal,
      saveScenario: vi.fn(),
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
      scanPortfolioWatch: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario,
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
      scanPortfolioWatch: vi.fn(),
      saveGoal: vi.fn(),
      saveScenario,
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
});
