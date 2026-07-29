import type { AlphaRepository } from "@keel/database";
import type { AlphaData } from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { Env } from "./types";

const alphaData: AlphaData = {
  dashboard: {
    asOfDate: "2026-07-01",
    householdName: "Demo Household",
    fiEligibleLiquidMinor: 182_500_000,
    protectedRunwayMonths: 42,
    householdBurnMonthlyMinor: 2_850_000,
    businessBurnMonthlyMinor: 1_250_000,
    fiTargetMinor: 325_000_000,
    fiGapMinor: 142_500_000,
    p25FiveYearLiquidityMinor: 94_000_000,
    p50FiveYearLiquidityMinor: 210_000_000,
    probabilityCrossingFiPpm: 640_000,
  },
  holdings: [],
  evidenceInbox: [],
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
      reviewEvidence: vi.fn(),
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
      reviewEvidence: vi.fn(),
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

  it("records a validated review without applying the proposed fact", async () => {
    const reviewEvidence = vi
      .fn<AlphaRepository["reviewEvidence"]>()
      .mockResolvedValue(undefined);
    const repository: AlphaRepository = {
      getAlphaData: vi
        .fn<AlphaRepository["getAlphaData"]>()
        .mockResolvedValue(alphaData),
      reviewEvidence,
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
});
