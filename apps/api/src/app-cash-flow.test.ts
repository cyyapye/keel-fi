import {
  CashFlowRepositoryError,
  type CashFlowRepository,
} from "@keel/database";
import { CashFlowReviewResultSchema, type CashFlowState } from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { PlaidCashFlowClient } from "./plaid-cash-flow-sync";
import type { Env } from "./types";

const state: CashFlowState = {
  version: 1,
  configured: true,
  status: "consent_required",
  latestOutcome: "never_checked",
  connections: [
    {
      id: "cash_connection",
      institutionLabel: "Synthetic Community Bank",
      status: "consent_required",
      acceptedAccountCount: 1,
      pricingConfirmedAt: null,
      lastCheckedAt: null,
      dailyCheckLimit: 4,
      dailyChecksUsed: 0,
      dailyChecksRemaining: 4,
    },
  ],
  pendingProposals: [],
  errorCode: null,
};

function repository(
  overrides: Partial<CashFlowRepository> = {},
): CashFlowRepository {
  return {
    getState: vi.fn().mockResolvedValue(state),
    beginSync: vi.fn(),
    completeSync: vi.fn(),
    failSync: vi.fn(),
    reviewProposal: vi.fn().mockResolvedValue({
      proposalId: "cash_flow_proposal",
      comparison: {
        observedHouseholdMonthlyMinor: 3_000_000,
        observedBusinessMonthlyMinor: 1_500_000,
        proposedHouseholdBurnMonthlyMinor: 3_000_000,
        proposedBusinessBurnMonthlyMinor: 1_500_000,
        householdChangeMinor: 150_000,
        businessChangeMinor: 250_000,
        totalChangeMinor: 400_000,
        currentRunwayMonths: 42,
        proposedRunwayMonths: 38,
        material: true,
      },
      planSuggestion: {
        proposalId: "cash_flow_proposal",
        householdBurnMonthlyMinor: 3_000_000,
        businessBurnMonthlyMinor: 1_500_000,
        changeNote: "Observed cash flow review: Synthetic review.",
      },
    }),
    ...overrides,
  };
}

function client(
  overrides: Partial<PlaidCashFlowClient> = {},
): PlaidCashFlowClient {
  return {
    syncTransactions: vi.fn(),
    ...overrides,
  };
}

function env(): Env {
  return {
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
  };
}

describe("observed cash-flow API", () => {
  it("loads household state without caching", async () => {
    const getState = vi.fn().mockResolvedValue(state);
    const response = await createApp({
      cashFlowRepository: repository({ getState }),
      cashFlowPlaidClient: client(),
    }).request("/api/cash-flow", {}, env());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(state);
    expect(getState).toHaveBeenCalledWith("synthetic-access-subject", true);
  });

  it("requires a complete category review and returns a plan draft only", async () => {
    const reviewProposal = vi.fn().mockResolvedValue({
      proposalId: "cash_flow_proposal",
      comparison: {
        observedHouseholdMonthlyMinor: 3_000_000,
        observedBusinessMonthlyMinor: 1_500_000,
        proposedHouseholdBurnMonthlyMinor: 3_000_000,
        proposedBusinessBurnMonthlyMinor: 1_500_000,
        householdChangeMinor: 150_000,
        businessChangeMinor: 250_000,
        totalChangeMinor: 400_000,
        currentRunwayMonths: 42,
        proposedRunwayMonths: 38,
        material: true,
      },
      planSuggestion: {
        proposalId: "cash_flow_proposal",
        householdBurnMonthlyMinor: 3_000_000,
        businessBurnMonthlyMinor: 1_500_000,
        changeNote: "Observed cash flow review: Synthetic review.",
      },
    });
    const input = {
      decisions: [
        { categoryId: "category_food", treatment: "household" as const },
      ],
      changeNote: "Synthetic review.",
    };
    const response = await createApp({
      cashFlowRepository: repository({ reviewProposal }),
      cashFlowPlaidClient: client(),
    }).request(
      "/api/cash-flow-proposals/cash_flow_proposal/review",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
      env(),
    );

    expect(response.status).toBe(201);
    expect(reviewProposal).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "cash_flow_proposal",
      input,
    );
    const result = CashFlowReviewResultSchema.parse(await response.json());
    expect(result.planSuggestion).toMatchObject({
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
    });
    expect(result).not.toHaveProperty("plan");
  });

  it("stops at the daily limit before reading a credential or calling Plaid", async () => {
    const syncTransactions = vi.fn();
    const beginSync = vi
      .fn()
      .mockRejectedValue(
        new CashFlowRepositoryError(
          "daily_limit_reached",
          "synthetic internal detail",
        ),
      );
    const response = await createApp({
      cashFlowRepository: repository({ beginSync }),
      cashFlowPlaidClient: client({ syncTransactions }),
    }).request(
      "/api/cash-flow/connections/cash_connection/sync",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          policyVersion: "observed-cash-flow-v1",
          pricingConfirmed: true,
        }),
      },
      env(),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "This institution has used its cash-flow checks for today.",
    });
    expect(syncTransactions).not.toHaveBeenCalled();
  });
});
