import {
  CashAccountRepositoryError,
  type CashAccountsRepository,
} from "@keel/database";
import type { CashAccountsState } from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { PlaidCashClient } from "./plaid-cash-sync";
import type { Env } from "./types";

const cashState: CashAccountsState = {
  version: 1,
  configured: true,
  status: "ready",
  connections: [
    {
      id: "synthetic-cash-connection",
      institutionLabel: "First Synthetic Bank",
      status: "ready",
      lastCheckedAt: "2026-08-14T18:00:00.000Z",
      liveRefreshLimit: 4,
      liveRefreshesUsed: 1,
      liveRefreshesRemaining: 3,
    },
  ],
  acceptedAccounts: [],
  pendingProposals: [],
  errorCode: null,
};

function repository(
  overrides: Partial<CashAccountsRepository> = {},
): CashAccountsRepository {
  return {
    getState: vi.fn().mockResolvedValue(cashState),
    upsertConnection: vi.fn(),
    getConnection: vi.fn(),
    beginRefresh: vi.fn(),
    stageProposal: vi.fn(),
    completeRefresh: vi.fn(),
    failRefresh: vi.fn(),
    applyProposal: vi.fn().mockResolvedValue({
      proposalId: "synthetic-cash-proposal",
      acceptedCount: 1,
      excludedCount: 0,
      acceptedCashMinor: 123_456,
    }),
    ...overrides,
  };
}

function client(overrides: Partial<PlaidCashClient> = {}): PlaidCashClient {
  return {
    createLinkToken: vi.fn().mockResolvedValue({
      linkToken: "synthetic-link-token",
      expiration: "2026-08-14T20:00:00.000Z",
    }),
    exchangeToken: vi.fn(),
    getAccounts: vi.fn(),
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

describe("cash account API", () => {
  it("loads household-scoped status and creates a no-store Link token", async () => {
    const getState = vi.fn().mockResolvedValue(cashState);
    const createLinkToken = vi.fn().mockResolvedValue({
      linkToken: "synthetic-link-token",
      expiration: "2026-08-14T20:00:00.000Z",
    });
    const cashAccountsRepository = repository({ getState });
    const cashPlaidClient = client({ createLinkToken });
    const app = createApp({ cashAccountsRepository, cashPlaidClient });

    const statusResponse = await app.request("/api/cash-accounts", {}, env());
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    await expect(statusResponse.json()).resolves.toEqual(cashState);
    expect(getState).toHaveBeenCalledWith("synthetic-access-subject", true);

    const tokenResponse = await app.request(
      "/api/cash-accounts/link-token",
      { method: "POST" },
      env(),
    );
    expect(tokenResponse.status).toBe(200);
    await expect(tokenResponse.json()).resolves.toEqual({
      linkToken: "synthetic-link-token",
      expiration: "2026-08-14T20:00:00.000Z",
    });
    expect(createLinkToken).toHaveBeenCalledWith("synthetic-access-subject");
  });

  it("applies only a complete, validated cash review", async () => {
    const applyProposal = vi.fn().mockResolvedValue({
      proposalId: "synthetic-cash-proposal",
      acceptedCount: 1,
      excludedCount: 0,
      acceptedCashMinor: 123_456,
    });
    const cashAccountsRepository = repository({ applyProposal });
    const app = createApp({
      cashAccountsRepository,
      cashPlaidClient: client(),
    });
    const input = {
      changeNote: "Reviewed synthetic checking balance.",
      decisions: [
        { rowId: "synthetic-cash-row", decision: "accepted" as const },
      ],
    };
    const response = await app.request(
      "/api/cash-account-proposals/synthetic-cash-proposal/apply",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      env(),
    );

    expect(response.status).toBe(201);
    expect(applyProposal).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-cash-proposal",
      input,
    );
  });

  it("returns a bounded 429 before a fifth live provider call", async () => {
    const getAccounts = vi.fn();
    const cashAccountsRepository = repository({
      beginRefresh: vi
        .fn()
        .mockRejectedValue(
          new CashAccountRepositoryError(
            "monthly_limit_reached",
            "synthetic internal detail",
          ),
        ),
    });
    const cashPlaidClient = client({ getAccounts });
    const response = await createApp({
      cashAccountsRepository,
      cashPlaidClient,
    }).request(
      "/api/cash-accounts/connections/synthetic-cash-connection/refresh",
      { method: "POST" },
      env(),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "This institution has used its live balance checks this month.",
    });
    expect(getAccounts).not.toHaveBeenCalled();
  });

  it("returns a conflict before checking again while review is waiting", async () => {
    const getAccounts = vi.fn();
    const cashAccountsRepository = repository({
      beginRefresh: vi
        .fn()
        .mockRejectedValue(
          new CashAccountRepositoryError(
            "review_required",
            "synthetic internal detail",
          ),
        ),
    });
    const response = await createApp({
      cashAccountsRepository,
      cashPlaidClient: client({ getAccounts }),
    }).request(
      "/api/cash-accounts/connections/synthetic-cash-connection/refresh",
      { method: "POST" },
      env(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Review the waiting balances before checking this institution again.",
    });
    expect(getAccounts).not.toHaveBeenCalled();
  });
});
