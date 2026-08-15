import {
  LiabilityRepositoryError,
  type LiabilitiesRepository,
} from "@keel/database";
import type { LiabilitiesState } from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { PlaidLiabilitiesClient } from "./plaid-liabilities-sync";
import type { Env } from "./types";

const liabilitiesState: LiabilitiesState = {
  version: 1,
  configured: true,
  status: "ready",
  connections: [
    {
      id: "synthetic-liability-connection",
      institutionLabel: "Synthetic Community Bank",
      status: "ready",
      lastCheckedAt: "2026-08-14T18:00:00.000Z",
      liveRefreshLimit: 4,
      liveRefreshesUsed: 1,
      liveRefreshesRemaining: 3,
    },
  ],
  acceptedLiabilities: [],
  pendingProposals: [],
  planning: {
    currentFiEligibleLiquidMinor: 182_500_000,
    protectedCashFloorMinor: 10_300_000,
    householdBurnMonthlyMinor: 2_850_000,
    businessBurnMonthlyMinor: 1_250_000,
    fiTargetMinor: 325_000_000,
  },
  impact: {
    liabilityCount: 0,
    totalOutstandingMinor: 0,
    unknownBalanceCount: 0,
    unknownPaymentCount: 0,
    overdueCount: 0,
    reservedPaymentMinor: 0,
    addedHouseholdBurnMinor: 0,
    netLiquidityMinor: 182_500_000,
    adjustedHouseholdBurnMonthlyMinor: 2_850_000,
    adjustedTotalBurnMonthlyMinor: 4_100_000,
    protectedRunwayMonths: 42,
    obligationAdjustedFiGapMinor: 142_500_000,
  },
  errorCode: null,
};

function repository(
  overrides: Partial<LiabilitiesRepository> = {},
): LiabilitiesRepository {
  return {
    getState: vi.fn().mockResolvedValue(liabilitiesState),
    upsertConnection: vi.fn(),
    getConnection: vi.fn(),
    revokeConnection: vi.fn(),
    beginRefresh: vi.fn(),
    stageProposal: vi.fn(),
    stageManualProposal: vi.fn().mockResolvedValue({
      id: "synthetic-manual-proposal",
      connectionId: null,
      institutionLabel: "Manual entry",
      source: "manual",
      status: "pending_review",
      refreshKind: "manual",
      observedAt: "2026-08-14T18:00:00.000Z",
      retrievedAt: "2026-08-14T18:00:00.000Z",
      summary: {
        rowCount: 1,
        reportedCount: 1,
        needsAttentionCount: 0,
        notReportedCount: 0,
        totalReportedMinor: 240_000,
      },
      rows: [],
    }),
    completeRefresh: vi.fn(),
    failRefresh: vi.fn(),
    applyProposal: vi.fn().mockResolvedValue({
      proposalId: "synthetic-liability-proposal",
      acceptedCount: 1,
      excludedCount: 0,
      impact: liabilitiesState.impact,
    }),
    ...overrides,
  };
}

function client(
  overrides: Partial<PlaidLiabilitiesClient> = {},
): PlaidLiabilitiesClient {
  return {
    createLinkToken: vi.fn().mockResolvedValue({
      linkToken: "synthetic-link-token",
      expiration: "2026-08-14T20:00:00.000Z",
    }),
    exchangeToken: vi.fn(),
    getLiabilities: vi.fn(),
    removeItem: vi.fn(),
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

describe("liabilities API", () => {
  it("loads household-scoped status and creates a no-store Link token", async () => {
    const getState = vi.fn().mockResolvedValue(liabilitiesState);
    const createLinkToken = vi.fn().mockResolvedValue({
      linkToken: "synthetic-link-token",
      expiration: "2026-08-14T20:00:00.000Z",
    });
    const app = createApp({
      liabilitiesRepository: repository({ getState }),
      liabilitiesPlaidClient: client({ createLinkToken }),
    });

    const status = await app.request("/api/liabilities", {}, env());
    expect(status.status).toBe(200);
    expect(status.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(status.json()).resolves.toEqual(liabilitiesState);
    expect(getState).toHaveBeenCalledWith("synthetic-access-subject", true);

    const token = await app.request(
      "/api/liabilities/link-token",
      { method: "POST" },
      env(),
    );
    expect(token.status).toBe(200);
    expect(createLinkToken).toHaveBeenCalledWith("synthetic-access-subject");
  });

  it("stages manual fallback before applying an explicit treatment", async () => {
    const stageManualProposal = vi.fn().mockResolvedValue({ id: "manual-1" });
    const applyProposal = vi.fn().mockResolvedValue({
      proposalId: "manual-1",
      acceptedCount: 1,
      excludedCount: 0,
      impact: liabilitiesState.impact,
    });
    const app = createApp({
      liabilitiesRepository: repository({
        stageManualProposal,
        applyProposal,
      }),
      liabilitiesPlaidClient: client(),
    });
    const manualInput = {
      institutionLabel: "Manual entry",
      accountLabel: "Synthetic card",
      kind: "credit_card",
      balanceMinor: 240_000,
      paymentMinor: 12_500,
      interestRatePpm: 219_900,
      nextPaymentDueDate: "2026-09-01",
      isOverdue: false,
      effectiveDate: "2026-08-14",
    };
    const staged = await app.request(
      "/api/liability-proposals/manual",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manualInput),
      },
      env(),
    );
    expect(staged.status).toBe(201);
    expect(stageManualProposal).toHaveBeenCalledWith(
      "synthetic-access-subject",
      manualInput,
    );

    const reviewInput = {
      changeNote: "Reviewed the synthetic card and next payment.",
      decisions: [
        {
          rowId: "row-1",
          decision: "accepted",
          paymentTreatment: "reserve_from_liquidity",
        },
      ],
    };
    const applied = await app.request(
      "/api/liability-proposals/manual-1/apply",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewInput),
      },
      env(),
    );
    expect(applied.status).toBe(201);
    expect(applyProposal).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "manual-1",
      reviewInput,
    );
  });

  it("stops before a fifth provider call or while review is waiting", async () => {
    const getLiabilities = vi.fn();
    for (const [code, status] of [
      ["monthly_limit_reached", 429],
      ["review_required", 409],
    ] as const) {
      const app = createApp({
        liabilitiesRepository: repository({
          beginRefresh: vi
            .fn()
            .mockRejectedValue(
              new LiabilityRepositoryError(code, "synthetic detail"),
            ),
        }),
        liabilitiesPlaidClient: client({ getLiabilities }),
      });
      const response = await app.request(
        "/api/liabilities/connections/synthetic-liability-connection/refresh",
        { method: "POST" },
        env(),
      );
      expect(response.status).toBe(status);
    }
    expect(getLiabilities).not.toHaveBeenCalled();
  });
});
