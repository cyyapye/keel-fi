import type {
  InvestmentConnection,
  InvestmentConnectionUpdate,
  InvestmentSyncRun,
} from "@keel/database";
import type { InvestmentConnectionStatus } from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import { plaidInvestmentsSourceKey } from "./investment-identity";
import {
  buildPlaidInvestmentsCanonicalScope,
  connectInvestmentConnection,
  createInvestmentReconnectLinkToken,
  disconnectInvestmentConnection,
  FetchPlaidInvestmentsClient,
  syncInvestmentConnection,
  type PlaidInvestmentsClient,
} from "./plaid-investments-sync";
import type { Env } from "./types";

const credentialKey = btoa("k".repeat(32))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/u, "");

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function legacyCredentialEnvelope(
  accessSubject: string,
  objectKey: string,
): Promise<Uint8Array> {
  const iv = new Uint8Array(12).fill(7);
  const rawKey = Uint8Array.from(atob(credentialKey), (character) =>
    character.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(
        JSON.stringify(["robinhood-credential-v1", accessSubject, objectKey]),
      ),
    },
    key,
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        accessToken: "synthetic-legacy-access-token",
        itemId: "synthetic-legacy-item",
        institutionId: "synthetic-robinhood",
      }),
    ),
  );
  return new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      iv: base64UrlEncode(iv),
      ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    }),
  );
}

function syntheticHoldingsResponse() {
  return {
    accounts: [
      {
        account_id: "synthetic-account",
        persistent_account_id: "synthetic-persistent-account",
        name: "Synthetic Brokerage",
        official_name: "Synthetic Brokerage Account",
        subtype: "brokerage",
        type: "investment",
      },
    ],
    holdings: [
      {
        account_id: "synthetic-account",
        security_id: "synthetic-security",
        institution_value: 125,
        cost_basis: 100,
        quantity: 1.25,
        institution_price_as_of: "2026-08-08",
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      },
    ],
    securities: [
      {
        security_id: "synthetic-security",
        name: "Synthetic Public Company",
        ticker_symbol: "SYN",
        type: "equity",
        cusip: "000000000",
        isin: null,
        sedol: null,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      },
    ],
    item: {
      institution_id: "synthetic-robinhood",
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

function status(
  overrides: Partial<InvestmentConnectionStatus> = {},
): InvestmentConnectionStatus {
  return {
    version: 1,
    connectionId: "synthetic-investment-connection",
    institutionKey: "synthetic-robinhood",
    institutionLabel: "Robinhood",
    status: "ready",
    lastSyncedAt: null,
    automaticUpdatesEnabled: true,
    latestImportId: null,
    latestRunStatus: null,
    errorCode: null,
    latestAdjudication: null,
    ...overrides,
  };
}

function publicRepository() {
  const repository = {
    secretReference: null as string | null,
    providerAccountKey: null as string | null,
    getState: vi.fn().mockResolvedValue({
      version: 1,
      configured: true,
      connections: [status()],
      errorCode: null,
    }),
    getConnectionStatus: vi.fn().mockResolvedValue(status()),
    getConnection: vi.fn((): Promise<InvestmentConnection | null> =>
      Promise.resolve(
        repository.secretReference === null
          ? null
          : {
              id: "synthetic-investment-connection",
              connectorAccountId: "synthetic-connection",
              secretReference: repository.secretReference,
              providerAccountKey: repository.providerAccountKey,
              institutionKey: "synthetic-robinhood",
              institutionLabel: "Robinhood",
            },
      ),
    ),
    upsertConnection: vi.fn(
      (
        _accessSubject: string,
        secretReference: string,
        nextProviderAccountKey: string,
        institutionKey: string,
        institutionLabel: string,
      ): Promise<InvestmentConnectionUpdate> => {
        const previousSecretReference = repository.secretReference;
        repository.secretReference = secretReference;
        repository.providerAccountKey = nextProviderAccountKey;
        return Promise.resolve({
          id: "synthetic-investment-connection",
          connectorAccountId: "synthetic-connection",
          secretReference,
          providerAccountKey: nextProviderAccountKey,
          institutionKey,
          institutionLabel,
          previousSecretReference,
        });
      },
    ),
    disconnectConnection: vi.fn(() => {
      repository.secretReference = null;
      repository.providerAccountKey = null;
      return Promise.resolve();
    }),
    setConnectionPaused: vi.fn().mockResolvedValue(undefined),
    claimPlaidWebhookDelivery: vi.fn(),
    getPlaidWebhookDelivery: vi.fn(),
    markPlaidWebhookDelivery: vi.fn(),
    beginSync: vi.fn((): Promise<InvestmentSyncRun> => {
      if (repository.secretReference === null) {
        return Promise.reject(new Error("not connected"));
      }
      return Promise.resolve({
        id: "synthetic-run",
        created: true,
        connection: {
          id: "synthetic-investment-connection",
          connectorAccountId: "synthetic-connection",
          secretReference: repository.secretReference,
          providerAccountKey: repository.providerAccountKey,
          institutionKey: "synthetic-robinhood",
          institutionLabel: "Robinhood",
        },
      });
    }),
    completeSync: vi.fn().mockResolvedValue(undefined),
    failSync: vi.fn().mockResolvedValue(undefined),
  };
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
    PLAID_WEBHOOK_URL: "https://keel-webhooks.example/webhooks/plaid",
  };
}

describe("Plaid Investments sync", () => {
  it("keeps container and position identity stable across opaque provider ID changes", async () => {
    const env = testEnv(memoryBucket().bucket);
    const firstResponse = syntheticHoldingsResponse();
    const expectedSourceKey = await plaidInvestmentsSourceKey(
      env,
      firstResponse.item.item_id,
    );
    const first = await buildPlaidInvestmentsCanonicalScope({
      env,
      connectionId: "synthetic-investment-connection",
      expectedSourceKey,
      institutionKey: "synthetic-robinhood",
      institutionLabel: "Robinhood",
      response: firstResponse,
    });
    const changedResponse = {
      ...firstResponse,
      accounts: [
        {
          ...firstResponse.accounts[0]!,
          account_id: "synthetic-rotated-account-id",
        },
      ],
      holdings: [
        {
          ...firstResponse.holdings[0]!,
          account_id: "synthetic-rotated-account-id",
          security_id: "synthetic-rotated-security-id",
        },
      ],
      securities: [
        {
          ...firstResponse.securities[0]!,
          security_id: "synthetic-rotated-security-id",
        },
      ],
    };
    const changed = await buildPlaidInvestmentsCanonicalScope({
      env,
      connectionId: "synthetic-investment-connection",
      expectedSourceKey,
      institutionKey: "synthetic-robinhood",
      institutionLabel: "Robinhood",
      response: changedResponse,
    });

    expect(changed.containers[0]?.protectedAccountKey).toBe(
      first.containers[0]?.protectedAccountKey,
    );
    expect(changed.rows[0]?.protectedPositionKey).toBe(
      first.rows[0]?.protectedPositionKey,
    );
    expect(changed.rows[0]?.protectedExposureKey).toBe(
      first.rows[0]?.protectedExposureKey,
    );

    const tickerOnly = await buildPlaidInvestmentsCanonicalScope({
      env,
      connectionId: "synthetic-investment-connection",
      expectedSourceKey,
      institutionKey: "synthetic-robinhood",
      institutionLabel: "Robinhood",
      response: {
        ...firstResponse,
        securities: [
          {
            ...firstResponse.securities[0]!,
            cusip: "not-a-cusip",
            isin: null,
            sedol: null,
          },
        ],
      },
    });
    expect(tickerOnly.rows[0]).toMatchObject({
      publicExposureIdentityKind: null,
      protectedExposureKey: null,
    });
  });

  it("keeps multiple accounts from one Item as distinct ownership containers", async () => {
    const env = testEnv(memoryBucket().bucket);
    const response = syntheticHoldingsResponse();
    const multiAccountResponse = {
      ...response,
      accounts: [
        response.accounts[0]!,
        {
          ...response.accounts[0]!,
          account_id: "synthetic-ira-account",
          persistent_account_id: "synthetic-persistent-ira-account",
          name: "Synthetic Roth IRA",
          official_name: "Synthetic Roth IRA Account",
          subtype: "roth ira",
        },
      ],
      holdings: [
        response.holdings[0]!,
        {
          ...response.holdings[0]!,
          account_id: "synthetic-ira-account",
        },
      ],
    };
    const scope = await buildPlaidInvestmentsCanonicalScope({
      env,
      connectionId: "synthetic-investment-connection",
      expectedSourceKey: await plaidInvestmentsSourceKey(
        env,
        multiAccountResponse.item.item_id,
      ),
      institutionKey: "synthetic-robinhood",
      institutionLabel: "Robinhood",
      response: multiAccountResponse,
    });

    expect(scope.containers).toHaveLength(2);
    expect(scope.containers.map((container) => container.displayLabel)).toEqual(
      ["Robinhood brokerage", "Robinhood Roth IRA"],
    );
    expect(scope.containers[0]?.protectedAccountKey).not.toBe(
      scope.containers[1]?.protectedAccountKey,
    );
    expect(scope.rows).toHaveLength(2);
    expect(scope.rows[0]?.protectedPositionKey).not.toBe(
      scope.rows[1]?.protectedPositionKey,
    );
    expect(scope.rows[0]?.protectedExposureKey).toBe(
      scope.rows[1]?.protectedExposureKey,
    );
  });

  it("does not rebind the Workers runtime fetch receiver", async () => {
    let requestCount = 0;
    const runtimeFetch = function (
      this: unknown,
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> {
      if (this instanceof FetchPlaidInvestmentsClient) {
        throw new TypeError("Illegal invocation");
      }
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      expect(new URL(url).pathname).toBe("/link/token/create");
      expect(init?.method).toBe("POST");
      if (typeof init?.body !== "string") {
        throw new TypeError("Expected a JSON request body.");
      }
      expect(JSON.parse(init.body)).toMatchObject({
        webhook: "https://keel-webhooks.example/webhooks/plaid",
      });
      requestCount += 1;
      return Promise.resolve(
        Response.json({
          link_token: "link-synthetic-token",
          expiration: "2026-08-14T00:00:00Z",
          request_id: "synthetic-request",
        }),
      );
    } as typeof fetch;
    vi.stubGlobal("fetch", runtimeFetch);

    try {
      const client = new FetchPlaidInvestmentsClient({
        clientId: "synthetic-client",
        secret: "synthetic-secret",
        environment: "sandbox",
        credentialKey,
        redirectUri: "https://keel.example/holdings",
        webhookUrl: "https://keel-webhooks.example/webhooks/plaid",
      });

      await expect(
        client.createLinkToken("synthetic-access-subject"),
      ).resolves.toEqual({
        linkToken: "link-synthetic-token",
        expiration: "2026-08-14T00:00:00Z",
      });
      expect(requestCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates an exact-Item update token without requesting a new product", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const fetcher = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a JSON request body.");
        }
        requestBody = JSON.parse(init.body) as Record<string, unknown>;
        return Promise.resolve(
          Response.json({
            link_token: "link-synthetic-update-token",
            expiration: "2026-08-16T12:30:00Z",
            request_id: "synthetic-request",
          }),
        );
      },
    ) as unknown as typeof fetch;
    const client = new FetchPlaidInvestmentsClient(
      {
        clientId: "synthetic-client",
        secret: "synthetic-secret",
        environment: "sandbox",
        credentialKey,
        redirectUri: "https://keel.example/holdings",
        webhookUrl: "https://keel-webhooks.example/webhooks/plaid",
      },
      fetcher,
    );

    await expect(
      client.createLinkToken(
        "synthetic-access-subject",
        "synthetic-private-access-token",
      ),
    ).resolves.toEqual({
      linkToken: "link-synthetic-update-token",
      expiration: "2026-08-16T12:30:00Z",
    });
    expect(requestBody).toMatchObject({
      access_token: "synthetic-private-access-token",
    });
    expect(requestBody).not.toHaveProperty("products");
    expect(requestBody).not.toHaveProperty("account_filters");
  });

  it("accepts validated Investments metadata from a synthetic Fidelity variant", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn((url: string | URL | Request) => {
      const rawUrl =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      const path = new URL(rawUrl).pathname;
      calls.push(path);
      const body =
        path === "/item/public_token/exchange"
          ? {
              access_token: "synthetic-access-token",
              item_id: "synthetic-item",
              request_id: "synthetic-request",
            }
          : path === "/item/get"
            ? {
                item: {
                  institution_id: "synthetic-fidelity-investments",
                  item_id: "synthetic-item",
                },
                request_id: "synthetic-request",
              }
            : path === "/institutions/get_by_id"
              ? {
                  institution: {
                    institution_id: "synthetic-fidelity-investments",
                    name: "Synthetic Fidelity Investments",
                    products: ["investments"],
                  },
                  request_id: "synthetic-request",
                }
              : { removed: true, request_id: "synthetic-request" };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const client = new FetchPlaidInvestmentsClient(
      {
        clientId: "synthetic-client",
        secret: "synthetic-secret",
        environment: "sandbox",
        credentialKey,
        redirectUri: "https://keel.example/holdings",
        webhookUrl: "https://keel-webhooks.example/webhooks/plaid",
      },
      fetcher,
    );

    await expect(
      client.exchangeInvestmentToken("synthetic-public-token"),
    ).resolves.toEqual({
      version: 1,
      accessToken: "synthetic-access-token",
      itemId: "synthetic-item",
      institutionKey: "synthetic-fidelity-investments",
      institutionLabel: "Synthetic Fidelity Investments",
    });
    expect(calls).toEqual([
      "/item/public_token/exchange",
      "/item/get",
      "/institutions/get_by_id",
    ]);
  });

  it("accepts validated Investments metadata from a synthetic Schwab variant", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn((url: string | URL | Request) => {
      const rawUrl =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      const path = new URL(rawUrl).pathname;
      calls.push(path);
      const body =
        path === "/item/public_token/exchange"
          ? {
              access_token: "synthetic-schwab-access-token",
              item_id: "synthetic-schwab-item",
              request_id: "synthetic-request",
            }
          : path === "/item/get"
            ? {
                item: {
                  institution_id: "synthetic-schwab-investments",
                  item_id: "synthetic-schwab-item",
                },
                request_id: "synthetic-request",
              }
            : path === "/institutions/get_by_id"
              ? {
                  institution: {
                    institution_id: "synthetic-schwab-investments",
                    name: "Synthetic Schwab Investments",
                    products: ["investments"],
                  },
                  request_id: "synthetic-request",
                }
              : { removed: true, request_id: "synthetic-request" };
      return Promise.resolve(Response.json(body));
    });
    const client = new FetchPlaidInvestmentsClient(
      {
        clientId: "synthetic-client",
        secret: "synthetic-secret",
        environment: "sandbox",
        credentialKey,
        redirectUri: "https://keel.example/holdings",
        webhookUrl: "https://keel-webhooks.example/webhooks/plaid",
      },
      fetcher,
    );

    await expect(
      client.exchangeInvestmentToken("synthetic-public-token"),
    ).resolves.toEqual({
      version: 1,
      accessToken: "synthetic-schwab-access-token",
      itemId: "synthetic-schwab-item",
      institutionKey: "synthetic-schwab-investments",
      institutionLabel: "Synthetic Schwab Investments",
    });
    expect(calls).toEqual([
      "/item/public_token/exchange",
      "/item/get",
      "/institutions/get_by_id",
    ]);
  });

  it("removes a Fidelity cash-management variant without Investments support", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn((url: string | URL | Request) => {
      const rawUrl =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      const path = new URL(rawUrl).pathname;
      calls.push(path);
      const body =
        path === "/item/public_token/exchange"
          ? {
              access_token: "synthetic-access-token",
              item_id: "synthetic-item",
              request_id: "synthetic-request",
            }
          : path === "/item/get"
            ? {
                item: {
                  institution_id: "synthetic-fidelity-cash-management",
                  item_id: "synthetic-item",
                },
                request_id: "synthetic-request",
              }
            : path === "/institutions/get_by_id"
              ? {
                  institution: {
                    institution_id: "synthetic-fidelity-cash-management",
                    name: "Synthetic Fidelity Cash Management",
                    products: ["auth"],
                  },
                  request_id: "synthetic-request",
                }
              : { removed: true, request_id: "synthetic-request" };
      return Promise.resolve(Response.json(body));
    });
    const client = new FetchPlaidInvestmentsClient(
      {
        clientId: "synthetic-client",
        secret: "synthetic-secret",
        environment: "sandbox",
        credentialKey,
        redirectUri: "https://keel.example/holdings",
        webhookUrl: "https://keel-webhooks.example/webhooks/plaid",
      },
      fetcher,
    );

    await expect(
      client.exchangeInvestmentToken("synthetic-public-token"),
    ).rejects.toThrow("does not support Investments");
    expect(calls).toEqual([
      "/item/public_token/exchange",
      "/item/get",
      "/institutions/get_by_id",
      "/item/remove",
    ]);
  });

  it("rejects an oversized provider response before parsing it", async () => {
    const client = new FetchPlaidInvestmentsClient(
      {
        clientId: "synthetic-client",
        secret: "synthetic-secret",
        environment: "sandbox",
        credentialKey,
        redirectUri: "https://keel.example/holdings",
        webhookUrl: "https://keel-webhooks.example/webhooks/plaid",
      },
      vi.fn(() =>
        Promise.resolve(
          new Response("{}", {
            headers: { "Content-Length": String(5 * 1_048_576 + 1) },
          }),
        ),
      ),
    );

    await expect(client.getHoldings("synthetic-access-token")).rejects.toThrow(
      "oversized response",
    );
  });

  it("applies clear holdings and refreshes the baseline alongside isolated exceptions", async () => {
    const storage = memoryBucket();
    const env = testEnv(storage.bucket);
    const repository = publicRepository();
    const response = syntheticHoldingsResponse();
    const responseBytes = new TextEncoder().encode(JSON.stringify(response));
    const updateItemWebhook = vi.fn();
    const client: PlaidInvestmentsClient = {
      createLinkToken: vi.fn(),
      exchangeInvestmentToken: vi.fn().mockResolvedValue({
        version: 1,
        accessToken: "synthetic-private-access-token",
        itemId: "synthetic-item",
        institutionKey: "synthetic-robinhood",
        institutionLabel: "Robinhood",
      }),
      removeItem: vi.fn(),
      updateItemWebhook,
      getWebhookVerificationKey: vi.fn(),
      getHoldings: vi.fn().mockResolvedValue({
        bytes: responseBytes,
        parsed: response,
      }),
    };

    await connectInvestmentConnection({
      env,
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

    const stagePlaidInvestmentsHoldingImport = vi.fn().mockResolvedValue({
      created: true,
      preview: {
        id: "synthetic-import",
        provider: "plaid_investments",
        status: "pending_review",
        observedAt: "2026-08-08T00:00:00.000Z",
        summary: {
          rowCount: 1,
          administratorValueCount: 1,
          lockedValueCount: 0,
          createCount: 1,
          updateCount: 0,
          unchangedCount: 0,
          needsAttentionCount: 0,
        },
        coverage: [],
        rows: [],
      },
    });
    const autoAdjudicatePlaidInvestmentsHoldingImport = vi
      .fn()
      .mockResolvedValue({
        importId: "synthetic-import",
        policyVersion: "plaid-investments-holdings-auto-v3",
        autoAppliedCount: 1,
        quarantinedCount: 2,
        preservedPositionCount: 1,
      });
    const getState = vi.fn().mockResolvedValue({
      status: "ready",
      sourceRevision: "c".repeat(64),
      baseForecastSnapshotId: "synthetic-forecast",
      baseForecastSnapshotVersion: 3,
      hasCashAccountChanges: false,
      requiresDuplicateReview: false,
      requiresCashOverlapReview: false,
      latestBaseline: { otherFiEligibleLiquidMinor: 25_000_000 },
    });
    const confirm = vi.fn().mockResolvedValue({
      baseline: { id: "synthetic-auto-baseline" },
    });
    await syncInvestmentConnection({
      env,
      repository,
      holdingImports: {
        stagePlaidInvestmentsHoldingImport,
        autoAdjudicatePlaidInvestmentsHoldingImport,
      },
      portfolioBaselines: { getState, confirm },
      client,
      accessSubject: "synthetic-access-subject",
      connectionId: "synthetic-investment-connection",
    });

    expect(updateItemWebhook).not.toHaveBeenCalled();

    expect(stagePlaidInvestmentsHoldingImport).toHaveBeenCalledWith(
      "synthetic-access-subject",
      expect.objectContaining({
        objectKey: expect.stringMatching(/^holding-imports\//u),
        normalizedFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        canonicalScope: {
          connection: {
            mode: "existing",
            connectionId: "synthetic-investment-connection",
          },
          containers: [
            expect.objectContaining({
              displayLabel: "Robinhood brokerage",
              completeness: "complete",
            }),
          ],
          rows: [
            expect.objectContaining({
              sourceRowNumber: 1,
              protectedAccountKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
              protectedPositionKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
              publicExposureIdentityKind: "cusip",
              protectedExposureKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
            }),
          ],
        },
        rows: [
          expect.objectContaining({
            ticker: "SYN",
            quantityMicros: 1_250_000,
            costBasisMinor: 10_000,
            marketValueMinor: 12_500,
          }),
        ],
      }),
    );
    expect(repository.completeSync).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-run",
      {
        discoveredCount: 1,
        proposedCount: 1,
        importId: "synthetic-import",
        adjudication: {
          policyVersion: "plaid-investments-holdings-auto-v3",
          autoAppliedCount: 1,
          quarantinedCount: 2,
          preservedPositionCount: 1,
          baselineRefreshStatus: "refreshed",
          portfolioBaselineId: "synthetic-auto-baseline",
        },
      },
    );
    expect(confirm).toHaveBeenCalledWith("synthetic-access-subject", {
      sourceRevision: "c".repeat(64),
      baseForecastSnapshotId: "synthetic-forecast",
      baseForecastSnapshotVersion: 3,
      otherFiEligibleLiquidMinor: 25_000_000,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Investment holdings refreshed automatically.",
    });
    expect(repository.failSync).not.toHaveBeenCalled();
  });

  it("records an empty snapshot without inferring a disposition", async () => {
    const storage = memoryBucket();
    const env = testEnv(storage.bucket);
    const repository = publicRepository();
    const emptyResponse = {
      ...syntheticHoldingsResponse(),
      holdings: [],
      securities: [],
    };
    const client: PlaidInvestmentsClient = {
      createLinkToken: vi.fn(),
      exchangeInvestmentToken: vi.fn().mockResolvedValue({
        version: 1,
        accessToken: "synthetic-private-access-token",
        itemId: "synthetic-item",
        institutionKey: "synthetic-robinhood",
        institutionLabel: "Robinhood",
      }),
      removeItem: vi.fn(),
      updateItemWebhook: vi.fn(),
      getWebhookVerificationKey: vi.fn(),
      getHoldings: vi.fn().mockResolvedValue({
        bytes: new TextEncoder().encode(JSON.stringify(emptyResponse)),
        parsed: emptyResponse,
      }),
    };
    await connectInvestmentConnection({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      publicToken: "synthetic-public-token",
    });
    const stagePlaidInvestmentsHoldingImport = vi.fn().mockResolvedValue({
      created: true,
      preview: {
        id: "synthetic-empty-import",
        provider: "plaid_investments",
        status: "pending_review",
        observedAt: "2026-08-08T00:00:00.000Z",
        summary: {
          rowCount: 0,
          administratorValueCount: 0,
          lockedValueCount: 0,
          createCount: 0,
          updateCount: 0,
          unchangedCount: 0,
          needsAttentionCount: 0,
        },
        coverage: [],
        rows: [],
      },
    });
    const autoAdjudicatePlaidInvestmentsHoldingImport = vi
      .fn()
      .mockResolvedValue({
        importId: "synthetic-empty-import",
        policyVersion: "plaid-investments-holdings-auto-v3",
        autoAppliedCount: 0,
        quarantinedCount: 0,
        preservedPositionCount: 0,
      });

    await syncInvestmentConnection({
      env,
      repository,
      holdingImports: {
        stagePlaidInvestmentsHoldingImport,
        autoAdjudicatePlaidInvestmentsHoldingImport,
      },
      client,
      accessSubject: "synthetic-access-subject",
      connectionId: "synthetic-investment-connection",
    });

    expect(stagePlaidInvestmentsHoldingImport).toHaveBeenCalledWith(
      "synthetic-access-subject",
      expect.objectContaining({
        rows: [],
        canonicalScope: expect.objectContaining({
          containers: [expect.objectContaining({ completeness: "complete" })],
          rows: [],
        }),
      }),
    );
    expect(autoAdjudicatePlaidInvestmentsHoldingImport).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-empty-import",
    );
    expect(repository.completeSync).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-run",
      {
        discoveredCount: 0,
        proposedCount: 0,
        importId: "synthetic-empty-import",
        adjudication: {
          policyVersion: "plaid-investments-holdings-auto-v3",
          autoAppliedCount: 0,
          quarantinedCount: 0,
          preservedPositionCount: 0,
          baselineRefreshStatus: "not_needed",
          portfolioBaselineId: null,
        },
      },
    );
  });

  it("fails closed when Plaid returns a different Item identity", async () => {
    const storage = memoryBucket();
    const env = testEnv(storage.bucket);
    const repository = publicRepository();
    const mismatchedResponse = {
      ...syntheticHoldingsResponse(),
      item: {
        institution_id: "synthetic-robinhood",
        item_id: "synthetic-other-item",
      },
    };
    const client: PlaidInvestmentsClient = {
      createLinkToken: vi.fn(),
      exchangeInvestmentToken: vi.fn().mockResolvedValue({
        version: 1,
        accessToken: "synthetic-private-access-token",
        itemId: "synthetic-item",
        institutionKey: "synthetic-robinhood",
        institutionLabel: "Robinhood",
      }),
      removeItem: vi.fn(),
      updateItemWebhook: vi.fn(),
      getWebhookVerificationKey: vi.fn(),
      getHoldings: vi.fn().mockResolvedValue({
        bytes: new TextEncoder().encode(JSON.stringify(mismatchedResponse)),
        parsed: mismatchedResponse,
      }),
    };
    await connectInvestmentConnection({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      publicToken: "synthetic-public-token",
    });
    const stagePlaidInvestmentsHoldingImport = vi.fn();
    const autoAdjudicatePlaidInvestmentsHoldingImport = vi.fn();

    await expect(
      syncInvestmentConnection({
        env,
        repository,
        holdingImports: {
          stagePlaidInvestmentsHoldingImport,
          autoAdjudicatePlaidInvestmentsHoldingImport,
        },
        client,
        accessSubject: "synthetic-access-subject",
        connectionId: "synthetic-investment-connection",
      }),
    ).rejects.toThrow("complete account coverage");

    expect(stagePlaidInvestmentsHoldingImport).not.toHaveBeenCalled();
    expect(repository.completeSync).not.toHaveBeenCalled();
    expect(repository.failSync).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-run",
      "holdings_incomplete",
    );
  });

  it("removes provider and stored access while preserving repository history", async () => {
    const storage = memoryBucket();
    const env = testEnv(storage.bucket);
    const repository = publicRepository();
    const removeItem = vi.fn().mockResolvedValue(undefined);
    const client: PlaidInvestmentsClient = {
      createLinkToken: vi.fn(),
      exchangeInvestmentToken: vi.fn().mockResolvedValue({
        version: 1,
        accessToken: "synthetic-private-access-token",
        itemId: "synthetic-item",
        institutionKey: "synthetic-robinhood",
        institutionLabel: "Robinhood",
      }),
      removeItem,
      updateItemWebhook: vi.fn(),
      getWebhookVerificationKey: vi.fn(),
      getHoldings: vi.fn(),
    };
    await connectInvestmentConnection({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      publicToken: "synthetic-public-token",
    });
    const secretReference = repository.secretReference;
    expect(secretReference).not.toBeNull();

    await disconnectInvestmentConnection({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      connectionId: "synthetic-investment-connection",
    });

    expect(removeItem).toHaveBeenCalledWith("synthetic-private-access-token");
    expect(repository.disconnectConnection).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-investment-connection",
    );
    expect(storage.values.has(secretReference ?? "")).toBe(false);
  });

  it("opens reconnect for one retained connection without replacing its credential", async () => {
    const storage = memoryBucket();
    const env = testEnv(storage.bucket);
    const repository = publicRepository();
    const createLinkToken = vi.fn().mockResolvedValue({
      linkToken: "link-synthetic-update-token",
      expiration: "2026-08-16T12:30:00.000Z",
    });
    const client: PlaidInvestmentsClient = {
      createLinkToken,
      exchangeInvestmentToken: vi.fn().mockResolvedValue({
        version: 1,
        accessToken: "synthetic-private-access-token",
        itemId: "synthetic-item",
        institutionKey: "synthetic-fidelity",
        institutionLabel: "Fidelity",
      }),
      removeItem: vi.fn(),
      updateItemWebhook: vi.fn(),
      getWebhookVerificationKey: vi.fn(),
      getHoldings: vi.fn(),
    };
    await connectInvestmentConnection({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      publicToken: "synthetic-public-token",
    });
    const secretReference = repository.secretReference;

    await expect(
      createInvestmentReconnectLinkToken({
        env,
        repository,
        client,
        accessSubject: "synthetic-access-subject",
        connectionId: "synthetic-investment-connection",
      }),
    ).resolves.toEqual({
      linkToken: "link-synthetic-update-token",
      expiration: "2026-08-16T12:30:00.000Z",
    });
    expect(createLinkToken).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "synthetic-private-access-token",
    );
    expect(repository.secretReference).toBe(secretReference);
    expect(storage.values.has(secretReference ?? "")).toBe(true);
  });

  it("preserves access to the shipped encrypted credential during cutover", async () => {
    const storage = memoryBucket();
    const env = testEnv(storage.bucket);
    const repository = publicRepository();
    const objectKey = "connector-secrets/synthetic-legacy.enc";
    repository.secretReference = objectKey;
    repository.providerAccountKey = "a".repeat(64);
    storage.values.set(
      objectKey,
      await legacyCredentialEnvelope("synthetic-access-subject", objectKey),
    );
    const removeItem = vi.fn().mockResolvedValue(undefined);
    const client: PlaidInvestmentsClient = {
      createLinkToken: vi.fn(),
      exchangeInvestmentToken: vi.fn(),
      removeItem,
      updateItemWebhook: vi.fn(),
      getWebhookVerificationKey: vi.fn(),
      getHoldings: vi.fn(),
    };

    await disconnectInvestmentConnection({
      env,
      repository,
      client,
      accessSubject: "synthetic-access-subject",
      connectionId: "synthetic-investment-connection",
    });

    expect(removeItem).toHaveBeenCalledWith("synthetic-legacy-access-token");
    expect(storage.values.has(objectKey)).toBe(false);
  });
});
