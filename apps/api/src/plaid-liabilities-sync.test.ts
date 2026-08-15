import type {
  LiabilitiesRepository,
  LiabilityConnection,
  LiabilityConnectionUpdate,
  LiabilityRefreshRun,
} from "@keel/database";
import type { LiabilitiesState } from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import {
  connectLiabilities,
  disconnectLiabilities,
  FetchPlaidLiabilitiesClient,
  type PlaidLiabilitiesClient,
} from "./plaid-liabilities-sync";
import type { Env } from "./types";

const credentialKey = btoa("l".repeat(32))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/u, "");

function syntheticResponse() {
  return {
    accounts: [
      {
        account_id: "synthetic-card",
        persistent_account_id: "synthetic-persistent-card",
        balances: {
          current: 2400,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        name: "Everyday card",
        official_name: "Synthetic card",
        subtype: "credit card",
        type: "credit",
      },
    ],
    item: {
      institution_id: "synthetic-bank",
      item_id: "synthetic-item",
    },
    liabilities: {
      credit: [
        {
          account_id: "synthetic-card",
          aprs: [{ apr_percentage: 21.99 }],
          is_overdue: false,
          last_statement_issue_date: "2026-08-01",
          minimum_payment_amount: 125,
          next_payment_due_date: "2026-09-01",
        },
      ],
      mortgage: null,
      student: null,
    },
    request_id: "synthetic-request",
  };
}

function memoryBucket() {
  const values = new Map<string, Uint8Array>();
  return {
    values,
    bucket: {
      put: vi.fn((key: string, value: Uint8Array) => {
        values.set(key, new Uint8Array(value));
        return Promise.resolve();
      }),
      get: vi.fn((key: string) => {
        const value = values.get(key);
        return Promise.resolve(
          value === undefined
            ? null
            : {
                arrayBuffer: () =>
                  Promise.resolve(
                    value.buffer.slice(
                      value.byteOffset,
                      value.byteOffset + value.byteLength,
                    ),
                  ),
              },
        );
      }),
      delete: vi.fn((key: string) => {
        values.delete(key);
        return Promise.resolve();
      }),
    } as unknown as R2Bucket,
  };
}

function state(): LiabilitiesState {
  return {
    version: 1,
    configured: true,
    status: "ready",
    connections: [],
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
}

function repository() {
  const repo = {
    secretReference: null as string | null,
    getState: vi.fn().mockResolvedValue(state()),
    upsertConnection: vi.fn(
      (
        _subject: string,
        institutionLabel: string,
        secretReference: string,
        providerAccountKey: string,
      ): Promise<LiabilityConnectionUpdate> => {
        const previousSecretReference = repo.secretReference;
        repo.secretReference = secretReference;
        return Promise.resolve({
          id: "synthetic-liability-connection",
          institutionLabel,
          secretReference,
          providerAccountKey,
          previousSecretReference,
        });
      },
    ),
    getConnection: vi.fn((): Promise<LiabilityConnection | null> =>
      Promise.resolve(
        repo.secretReference === null
          ? null
          : {
              id: "synthetic-liability-connection",
              institutionLabel: "Synthetic Community Bank",
              secretReference: repo.secretReference,
              providerAccountKey: "a".repeat(64),
            },
      ),
    ),
    revokeConnection: vi.fn(() => {
      repo.secretReference = null;
      return Promise.resolve();
    }),
    beginRefresh: vi.fn(
      (
        _subject: string,
        _connectionId: string,
        refreshKind: "initial" | "live",
      ): Promise<LiabilityRefreshRun> => {
        if (repo.secretReference === null) {
          return Promise.reject(new Error("not connected"));
        }
        return Promise.resolve({
          id: `synthetic-${refreshKind}-run`,
          refreshKind,
          connection: {
            id: "synthetic-liability-connection",
            institutionLabel: "Synthetic Community Bank",
            secretReference: repo.secretReference,
            providerAccountKey: "a".repeat(64),
          },
        });
      },
    ),
    stageProposal: vi.fn().mockResolvedValue({
      proposal: {
        id: "synthetic-liability-proposal",
        connectionId: "synthetic-liability-connection",
        institutionLabel: "Synthetic Community Bank",
        source: "plaid",
        status: "pending_review",
        refreshKind: "initial",
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
      },
    }),
    stageManualProposal: vi.fn(),
    completeRefresh: vi.fn().mockResolvedValue(undefined),
    failRefresh: vi.fn().mockResolvedValue(undefined),
    applyProposal: vi.fn(),
  } satisfies LiabilitiesRepository & { secretReference: string | null };
  return repo;
}

function env(bucket: R2Bucket): Env {
  return {
    CONNECTOR_CREDENTIAL_KEY: credentialKey,
    DB: {} as D1Database,
    DOCUMENTS: bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
    PLAID_CLIENT_ID: "synthetic-client-id",
    PLAID_ENVIRONMENT: "sandbox",
    PLAID_REDIRECT_URI: "https://keel.example/holdings",
    PLAID_SECRET: "synthetic-secret",
  };
}

describe("Plaid liabilities sync", () => {
  it("requests only supported liabilities without a webhook", async () => {
    const fetcher = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a JSON body.");
        }
        const body = JSON.parse(init.body) as Record<string, unknown>;
        expect(body).toMatchObject({
          products: ["liabilities"],
          account_filters: {
            credit: { account_subtypes: ["credit card", "paypal"] },
            loan: { account_subtypes: ["mortgage", "student"] },
          },
        });
        expect(body).not.toHaveProperty("webhook");
        expect(body).not.toHaveProperty("additional_consented_products");
        return Promise.resolve(
          Response.json({
            link_token: "link-synthetic-token",
            expiration: "2026-08-14T20:00:00Z",
            request_id: "synthetic-request",
          }),
        );
      },
    );
    const client = new FetchPlaidLiabilitiesClient(
      {
        clientId: "synthetic-client",
        secret: "synthetic-secret",
        environment: "sandbox",
        credentialKey,
        redirectUri: "https://keel.example/obligations",
      },
      fetcher,
    );

    await expect(
      client.createLinkToken("synthetic-access-subject"),
    ).resolves.toEqual({
      linkToken: "link-synthetic-token",
      expiration: "2026-08-14T20:00:00Z",
    });
  });

  it("encrypts credentials, retains bounded raw evidence, and stages review", async () => {
    const storage = memoryBucket();
    const repo = repository();
    const response = syntheticResponse();
    const bytes = new TextEncoder().encode(JSON.stringify(response));
    const client: PlaidLiabilitiesClient = {
      createLinkToken: vi.fn(),
      exchangeToken: vi.fn().mockResolvedValue({
        credential: {
          version: 1,
          accessToken: "synthetic-private-access-token",
          itemId: "synthetic-item",
          institutionId: "synthetic-bank",
        },
        institutionLabel: "Synthetic Community Bank",
      }),
      getLiabilities: vi.fn().mockResolvedValue({ bytes, parsed: response }),
      removeItem: vi.fn(),
    };

    await connectLiabilities({
      env: env(storage.bucket),
      repository: repo,
      client,
      accessSubject: "synthetic-access-subject",
      publicToken: "synthetic-public-token",
    });

    expect(repo.secretReference).toMatch(/^connector-secrets\//u);
    const encrypted = storage.values.get(repo.secretReference ?? "");
    expect(encrypted).toBeDefined();
    expect(new TextDecoder().decode(encrypted)).not.toContain(
      "synthetic-private-access-token",
    );
    expect(repo.stageProposal).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-initial-run",
      expect.objectContaining({
        objectKey: expect.stringMatching(/^liability-observations\//u),
        sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        normalized: expect.objectContaining({
          rows: [
            expect.objectContaining({
              balanceMinor: 240_000,
              paymentMinor: 12_500,
              interestRatePpm: 219_900,
            }),
          ],
        }),
      }),
    );
    expect(
      [...storage.values.keys()].some((key) =>
        key.startsWith("liability-observations/"),
      ),
    ).toBe(true);
  });

  it("removes the Plaid Item before deleting local access", async () => {
    const storage = memoryBucket();
    const repo = repository();
    const response = syntheticResponse();
    const bytes = new TextEncoder().encode(JSON.stringify(response));
    const removeItem = vi.fn().mockResolvedValue(undefined);
    const client: PlaidLiabilitiesClient = {
      createLinkToken: vi.fn(),
      exchangeToken: vi.fn().mockResolvedValue({
        credential: {
          version: 1,
          accessToken: "synthetic-private-access-token",
          itemId: "synthetic-item",
          institutionId: "synthetic-bank",
        },
        institutionLabel: "Synthetic Community Bank",
      }),
      getLiabilities: vi.fn().mockResolvedValue({ bytes, parsed: response }),
      removeItem,
    };
    const testEnv = env(storage.bucket);
    await connectLiabilities({
      env: testEnv,
      repository: repo,
      client,
      accessSubject: "synthetic-access-subject",
      publicToken: "synthetic-public-token",
    });
    const secretReference = repo.secretReference;
    await disconnectLiabilities({
      env: testEnv,
      repository: repo,
      client,
      accessSubject: "synthetic-access-subject",
      connectionId: "synthetic-liability-connection",
    });

    expect(removeItem).toHaveBeenCalledWith("synthetic-private-access-token");
    expect(repo.revokeConnection).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-liability-connection",
    );
    expect(storage.values.has(secretReference ?? "")).toBe(false);
  });

  it("removes newly exchanged access when a duplicate connection is rejected", async () => {
    const storage = memoryBucket();
    const repo = repository();
    repo.upsertConnection.mockRejectedValue(
      new Error("Disconnect this institution before connecting it again."),
    );
    const removeItem = vi.fn().mockResolvedValue(undefined);
    const client: PlaidLiabilitiesClient = {
      createLinkToken: vi.fn(),
      exchangeToken: vi.fn().mockResolvedValue({
        credential: {
          version: 1,
          accessToken: "synthetic-new-access-token",
          itemId: "synthetic-new-item",
          institutionId: "synthetic-bank",
        },
        institutionLabel: "Synthetic Community Bank",
      }),
      getLiabilities: vi.fn(),
      removeItem,
    };

    await expect(
      connectLiabilities({
        env: env(storage.bucket),
        repository: repo,
        client,
        accessSubject: "synthetic-access-subject",
        publicToken: "synthetic-public-token",
      }),
    ).rejects.toThrow("Disconnect this institution");
    expect(removeItem).toHaveBeenCalledWith("synthetic-new-access-token");
    expect(storage.values.size).toBe(0);
  });
});
