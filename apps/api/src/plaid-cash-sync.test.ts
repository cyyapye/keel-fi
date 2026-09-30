import type {
  CashAccountConnection,
  CashAccountConnectionUpdate,
  CashAccountRefreshRun,
  CashAccountsRepository,
} from "@keel/database";
import type { CashAccountsState } from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import {
  cashRefreshUsagePlan,
  cashProviderKey,
  cashProviderScopedKey,
  connectCashAccount,
  disconnectCashAccount,
  FetchPlaidCashClient,
  refreshCashAccount,
  refreshDueCashAccounts,
  type PlaidCashClient,
} from "./plaid-cash-sync";
import type { Env } from "./types";

const credentialKey = btoa("c".repeat(32))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/u, "");

function syntheticCashResponse() {
  return {
    accounts: [
      {
        account_id: "synthetic-account",
        persistent_account_id: "synthetic-persistent-account",
        balances: {
          available: 1234.56,
          current: 1250,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        name: "Household checking",
        official_name: "Synthetic checking",
        subtype: "checking",
        type: "depository",
      },
    ],
    item: {
      institution_id: "synthetic-bank",
      item_id: "synthetic-item",
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

function state(): CashAccountsState {
  return {
    version: 1,
    configured: true,
    status: "ready",
    connections: [],
    acceptedAccounts: [],
    identityCandidates: [],
    pendingProposals: [],
    errorCode: null,
  };
}

function cashRepository() {
  const repository = {
    secretReference: null as string | null,
    getState: vi.fn().mockResolvedValue(state()),
    upsertConnection: vi.fn(
      (
        _accessSubject: string,
        institutionLabel: string,
        secretReference: string,
        providerAccountKey: string,
      ): Promise<CashAccountConnectionUpdate> => {
        const previousSecretReference = repository.secretReference;
        repository.secretReference = secretReference;
        return Promise.resolve({
          id: "synthetic-cash-connection",
          institutionLabel,
          secretReference,
          providerAccountKey,
          previousSecretReference,
        });
      },
    ),
    getConnection: vi.fn((): Promise<CashAccountConnection | null> =>
      Promise.resolve(
        repository.secretReference === null
          ? null
          : {
              id: "synthetic-cash-connection",
              institutionLabel: "First Synthetic Bank",
              secretReference: repository.secretReference,
              providerAccountKey: "a".repeat(64),
            },
      ),
    ),
    beginDisconnect: vi.fn((): Promise<CashAccountConnection> => {
      if (repository.secretReference === null) {
        return Promise.reject(new Error("not connected"));
      }
      return Promise.resolve({
        id: "synthetic-cash-connection",
        institutionLabel: "First Synthetic Bank",
        secretReference: repository.secretReference,
        providerAccountKey: "a".repeat(64),
      });
    }),
    cancelDisconnect: vi.fn().mockResolvedValue(undefined),
    completeDisconnect: vi.fn(() => {
      repository.secretReference = null;
      return Promise.resolve();
    }),
    beginRefresh: vi.fn(
      (
        _accessSubject: string,
        _connectionId: string,
        refreshKind: "initial" | "live",
      ): Promise<CashAccountRefreshRun> => {
        if (repository.secretReference === null) {
          return Promise.reject(new Error("not connected"));
        }
        return Promise.resolve({
          id: `synthetic-${refreshKind}-run`,
          refreshKind,
          connection: {
            id: "synthetic-cash-connection",
            institutionLabel: "First Synthetic Bank",
            secretReference: repository.secretReference,
            providerAccountKey: "a".repeat(64),
          },
        });
      },
    ),
    beginAutomaticRefresh: vi.fn().mockResolvedValue(null),
    stageProposal: vi.fn().mockResolvedValue({
      proposal: {
        id: "synthetic-cash-proposal",
        connectionId: "synthetic-cash-connection",
        institutionLabel: "First Synthetic Bank",
        status: "pending_review",
        refreshKind: "initial",
        observedAt: "2026-08-14T18:00:00.000Z",
        retrievedAt: "2026-08-14T18:00:00.000Z",
        summary: {
          rowCount: 1,
          reportedCount: 1,
          needsAttentionCount: 0,
          notReportedCount: 0,
          totalReportedMinor: 123_456,
        },
        rows: [],
      },
    }),
    completeRefresh: vi.fn().mockResolvedValue(undefined),
    failRefresh: vi.fn().mockResolvedValue(undefined),
    applyAutomaticUpdates: vi.fn().mockResolvedValue(undefined),
    applyProposal: vi.fn(),
    reviewIdentity: vi.fn().mockResolvedValue(undefined),
  } satisfies CashAccountsRepository & { secretReference: string | null };
  return repository;
}

function testEnv(bucket: R2Bucket): Env {
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

describe("Plaid cash account sync", () => {
  it("recognizes Plaid balance limits separately from exhausted free credits", async () => {
    for (const [plaidCode, expectedCode] of [
      ["BALANCE_LIMIT", "provider_rate_limited"],
      ["NEW_BALANCE_RATE_LIMIT", "provider_rate_limited"],
      ["CREDITS_EXHAUSTED", "free_usage_exhausted"],
    ] as const) {
      const client = new FetchPlaidCashClient(
        {
          clientId: "synthetic-client",
          secret: "synthetic-secret",
          environment: "sandbox",
          credentialKey,
          redirectUri: "https://keel.example/holdings",
        },
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { error_type: "RATE_LIMIT_EXCEEDED", error_code: plaidCode },
              { status: 429 },
            ),
          ),
      );
      await expect(
        client.getAccounts("synthetic-access-token", "live"),
      ).rejects.toMatchObject({
        code: expectedCode,
      });
    }
  });

  it("uses an explicit free plan and otherwise defaults to the paid cost guard", () => {
    const env = testEnv({} as R2Bucket);
    expect(cashRefreshUsagePlan(env)).toBe("paid");
    env.PLAID_CASH_USAGE_PLAN = "free";
    expect(cashRefreshUsagePlan(env)).toBe("free");
  });

  it("checks a free-plan connection after one day", async () => {
    const repository = cashRepository();
    repository.getState.mockResolvedValue({
      ...state(),
      connections: [
        {
          id: "synthetic-cash-connection",
          institutionLabel: "First Synthetic Bank",
          status: "ready",
          lastCheckedAt: "2026-08-15T18:00:00.000Z",
          liveRefreshLimit: 31,
          liveRefreshesUsed: 1,
          liveRefreshesRemaining: 30,
        },
      ],
    });
    const env = testEnv({} as R2Bucket);
    env.PLAID_CASH_USAGE_PLAN = "free";
    await refreshDueCashAccounts({
      env,
      repository,
      client: {} as PlaidCashClient,
      accessSubject: "synthetic-access-subject",
      now: new Date("2026-08-17T18:00:00.000Z"),
    });
    expect(repository.beginAutomaticRefresh).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-cash-connection",
      "2026-08-16T18:00:00.000Z",
    );
  });
  it("scopes provider account and transaction keys to one Plaid Item", async () => {
    const storage = memoryBucket();
    const env = testEnv(storage.bucket);
    const [firstItem, secondItem] = await Promise.all([
      cashProviderKey(env, "item", "synthetic-item-one"),
      cashProviderKey(env, "item", "synthetic-item-two"),
    ]);
    const [firstAccount, secondAccount, firstTransaction] = await Promise.all([
      cashProviderScopedKey(env, "account", firstItem, "same-provider-id"),
      cashProviderScopedKey(env, "account", secondItem, "same-provider-id"),
      cashProviderScopedKey(env, "transaction", firstItem, "same-provider-id"),
    ]);

    expect(firstAccount).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstAccount).not.toBe(secondAccount);
    expect(firstAccount).not.toBe(firstTransaction);
  });

  it("requests only the cash scope and defers transaction activation", async () => {
    const fetcher = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a JSON body.");
        }
        expect(JSON.parse(init.body)).toMatchObject({
          products: ["auth"],
          additional_consented_products: ["transactions"],
          account_filters: {
            depository: {
              account_subtypes: [
                "checking",
                "savings",
                "money market",
                "cash management",
              ],
            },
          },
        });
        expect(JSON.parse(init.body)).not.toHaveProperty("webhook");
        return Promise.resolve(
          Response.json({
            link_token: "link-synthetic-token",
            expiration: "2026-08-14T20:00:00Z",
            request_id: "synthetic-request",
          }),
        );
      },
    );
    const client = new FetchPlaidCashClient(
      {
        clientId: "synthetic-client",
        secret: "synthetic-secret",
        environment: "sandbox",
        credentialKey,
        redirectUri: "https://keel.example/holdings",
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

  it("uses the free account endpoint initially and the live endpoint explicitly", async () => {
    const paths: string[] = [];
    const response = syntheticCashResponse();
    const fetcher = vi.fn((input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      paths.push(new URL(url).pathname);
      return Promise.resolve(Response.json(response));
    });
    const client = new FetchPlaidCashClient(
      {
        clientId: "synthetic-client",
        secret: "synthetic-secret",
        environment: "sandbox",
        credentialKey,
        redirectUri: "https://keel.example/holdings",
      },
      fetcher,
    );

    await client.getAccounts("synthetic-access-token", "initial");
    await client.getAccounts("synthetic-access-token", "live");
    expect(paths).toEqual(["/accounts/get", "/accounts/balance/get"]);
  });

  it("encrypts credentials, retains the raw response privately, and stages review", async () => {
    const storage = memoryBucket();
    const repository = cashRepository();
    const response = syntheticCashResponse();
    const responseBytes = new TextEncoder().encode(JSON.stringify(response));
    const client: PlaidCashClient = {
      createLinkToken: vi.fn(),
      exchangeToken: vi.fn().mockResolvedValue({
        credential: {
          version: 1,
          accessToken: "synthetic-private-access-token",
          itemId: "synthetic-item",
          institutionId: "synthetic-bank",
        },
        institutionLabel: "First Synthetic Bank",
      }),
      getAccounts: vi.fn().mockResolvedValue({
        bytes: responseBytes,
        parsed: response,
      }),
      removeItem: vi.fn(),
    };

    await connectCashAccount({
      env: testEnv(storage.bucket),
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      publicToken: "synthetic-public-token",
    });

    expect(repository.secretReference).toMatch(/^connector-secrets\//u);
    const encrypted = storage.values.get(repository.secretReference ?? "");
    expect(encrypted).toBeDefined();
    expect(new TextDecoder().decode(encrypted)).not.toContain(
      "synthetic-private-access-token",
    );
    expect(repository.stageProposal).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-initial-run",
      expect.objectContaining({
        objectKey: expect.stringMatching(/^cash-observations\//u),
        sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        normalized: expect.objectContaining({
          rows: [
            expect.objectContaining({
              valueMinor: 123_456,
              balanceSource: "available",
            }),
          ],
        }),
      }),
    );
    expect(repository.completeRefresh).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-initial-run",
      "synthetic-cash-proposal",
      1,
    );
    expect(repository.failRefresh).not.toHaveBeenCalled();
    expect(
      [...storage.values.keys()].some((key) =>
        key.startsWith("cash-observations/"),
      ),
    ).toBe(true);
  });

  it("records a failed provider attempt without deleting the connection", async () => {
    const storage = memoryBucket();
    const repository = cashRepository();
    const client: PlaidCashClient = {
      createLinkToken: vi.fn(),
      exchangeToken: vi.fn().mockResolvedValue({
        credential: {
          version: 1,
          accessToken: "synthetic-private-access-token",
          itemId: "synthetic-item",
          institutionId: "synthetic-bank",
        },
        institutionLabel: "First Synthetic Bank",
      }),
      getAccounts: vi.fn().mockRejectedValue(new Error("provider detail")),
      removeItem: vi.fn(),
    };
    const env = testEnv(storage.bucket);

    await expect(
      connectCashAccount({
        env,
        repository,
        client,
        accessSubject: "synthetic-access-subject",
        publicToken: "synthetic-public-token",
      }),
    ).rejects.toThrow("provider detail");
    expect(repository.failRefresh).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-initial-run",
      "unexpected_failure",
    );
    expect(repository.secretReference).toMatch(/^connector-secrets\//u);

    client.getAccounts = vi.fn().mockResolvedValue({
      bytes: new TextEncoder().encode(JSON.stringify(syntheticCashResponse())),
      parsed: syntheticCashResponse(),
    });
    await refreshCashAccount({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      connectionId: "synthetic-cash-connection",
      refreshKind: "live",
    });
    expect(repository.beginRefresh).toHaveBeenLastCalledWith(
      "synthetic-access-subject",
      "synthetic-cash-connection",
      "live",
    );
  });

  it("checks only connections admitted by the automatic weekly guard", async () => {
    const storage = memoryBucket();
    const repository = cashRepository();
    const response = syntheticCashResponse();
    const getAccounts = vi.fn().mockResolvedValue({
      bytes: new TextEncoder().encode(JSON.stringify(response)),
      parsed: response,
    });
    const client: PlaidCashClient = {
      createLinkToken: vi.fn(),
      exchangeToken: vi.fn().mockResolvedValue({
        credential: {
          version: 1,
          accessToken: "synthetic-private-access-token",
          itemId: "synthetic-item",
          institutionId: "synthetic-bank",
        },
        institutionLabel: "First Synthetic Bank",
      }),
      getAccounts,
      removeItem: vi.fn(),
    };
    const env = testEnv(storage.bucket);
    await connectCashAccount({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      publicToken: "synthetic-public-token",
    });
    getAccounts.mockClear();
    repository.getState.mockResolvedValue({
      ...state(),
      connections: [
        {
          id: "synthetic-cash-connection",
          institutionLabel: "First Synthetic Bank",
          status: "ready",
          lastCheckedAt: "2026-08-01T18:00:00.000Z",
          liveRefreshLimit: 4,
          liveRefreshesUsed: 0,
          liveRefreshesRemaining: 4,
        },
      ],
    });
    repository.beginAutomaticRefresh.mockResolvedValue({
      id: "synthetic-automatic-run",
      refreshKind: "live",
      connection: {
        id: "synthetic-cash-connection",
        institutionLabel: "First Synthetic Bank",
        secretReference: repository.secretReference!,
        providerAccountKey: "a".repeat(64),
      },
    });

    await refreshDueCashAccounts({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      now: new Date("2026-08-17T18:00:00.000Z"),
    });

    expect(repository.beginAutomaticRefresh).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-cash-connection",
      "2026-08-10T18:00:00.000Z",
    );
    expect(getAccounts).toHaveBeenCalledTimes(1);
    expect(repository.completeRefresh).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-automatic-run",
      "synthetic-cash-proposal",
      1,
    );
  });

  it("removes the Plaid Item and encrypted credential before disconnecting", async () => {
    const storage = memoryBucket();
    const repository = cashRepository();
    const removeItem = vi.fn().mockResolvedValue(undefined);
    const response = syntheticCashResponse();
    const client: PlaidCashClient = {
      createLinkToken: vi.fn(),
      exchangeToken: vi.fn().mockResolvedValue({
        credential: {
          version: 1,
          accessToken: "synthetic-private-access-token",
          itemId: "synthetic-item",
          institutionId: "synthetic-bank",
        },
        institutionLabel: "First Synthetic Bank",
      }),
      getAccounts: vi.fn().mockResolvedValue({
        bytes: new TextEncoder().encode(JSON.stringify(response)),
        parsed: response,
      }),
      removeItem,
    };
    const env = testEnv(storage.bucket);
    await connectCashAccount({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      publicToken: "synthetic-public-token",
    });
    const secretReference = repository.secretReference;
    expect(secretReference).not.toBeNull();

    await disconnectCashAccount({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      connectionId: "synthetic-cash-connection",
    });

    expect(removeItem).toHaveBeenCalledWith("synthetic-private-access-token");
    expect(repository.completeDisconnect).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-cash-connection",
    );
    expect(storage.values.has(secretReference ?? "")).toBe(false);
    expect(repository.secretReference).toBeNull();
  });
});
