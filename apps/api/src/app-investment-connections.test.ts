import type { InvestmentConnectionsRepository } from "@keel/database";
import type {
  InvestmentConnectionStatus,
  InvestmentConnectionsState,
} from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { PlaidInvestmentsClient } from "./plaid-investments-sync";
import type { Env } from "./types";

const connectionId = "11111111-1111-4111-8111-111111111111";

const readyStatus: InvestmentConnectionStatus = {
  version: 1,
  connectionId,
  institutionKey: "ins_fidelity",
  institutionLabel: "Fidelity",
  status: "ready",
  lastSyncedAt: "2026-08-10T12:00:00.000Z",
  automaticUpdatesEnabled: true,
  latestImportId: null,
  latestRunStatus: "succeeded",
  errorCode: null,
  latestAdjudication: null,
};

const state: InvestmentConnectionsState = {
  version: 1,
  configured: true,
  connections: [readyStatus],
  errorCode: null,
};

function repository() {
  const value = {
    getState: vi.fn().mockResolvedValue(state),
    getConnectionStatus: vi.fn().mockResolvedValue(readyStatus),
    getConnection: vi.fn().mockResolvedValue(null),
    upsertConnection: vi.fn().mockResolvedValue({
      id: connectionId,
      connectorAccountId: "synthetic-connector",
      secretReference: "synthetic-reference",
      providerAccountKey: "a".repeat(64),
      institutionKey: "ins_fidelity",
      institutionLabel: "Fidelity",
      previousSecretReference: null,
    }),
    beginSync: vi.fn().mockResolvedValue({
      id: "synthetic-run",
      created: false,
      connection: {
        id: connectionId,
        connectorAccountId: "synthetic-connector",
        secretReference: "synthetic-reference",
        providerAccountKey: "a".repeat(64),
        institutionKey: "ins_fidelity",
        institutionLabel: "Fidelity",
      },
    }),
    completeSync: vi.fn().mockResolvedValue(undefined),
    failSync: vi.fn().mockResolvedValue(undefined),
    disconnectConnection: vi.fn().mockResolvedValue(undefined),
    setConnectionPaused: vi.fn().mockResolvedValue(undefined),
    claimPlaidWebhookDelivery: vi.fn(),
    getPlaidWebhookDelivery: vi.fn(),
    markPlaidWebhookDelivery: vi.fn(),
  } satisfies InvestmentConnectionsRepository;
  return value;
}

function client() {
  const value = {
    createLinkToken: vi.fn().mockResolvedValue({
      linkToken: "link-synthetic-token",
      expiration: "2026-08-10T12:30:00.000Z",
    }),
    exchangeInvestmentToken: vi.fn(),
    removeItem: vi.fn(),
    updateItemWebhook: vi.fn(),
    getWebhookVerificationKey: vi.fn(),
    getHoldings: vi.fn(),
  } satisfies PlaidInvestmentsClient;
  return value;
}

function env(): Env {
  return {
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
  };
}

describe("investment-connections API", () => {
  it("rejects unsigned Plaid webhooks before repository state", async () => {
    const investmentConnectionsRepository = repository();
    const app = createApp({
      investmentConnectionsRepository,
      plaidClient: client(),
    });
    const response = await app.request(
      "/webhooks/plaid",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhook_type: "HOLDINGS",
          webhook_code: "DEFAULT_UPDATE",
        }),
      },
      env(),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(
      investmentConnectionsRepository.claimPlaidWebhookDelivery,
    ).not.toHaveBeenCalled();
  });

  it("returns all configured connections and creates a Link token", async () => {
    const investmentConnectionsRepository = repository();
    const plaidClient = client();
    const app = createApp({ investmentConnectionsRepository, plaidClient });

    const statusResponse = await app.request(
      "/api/investment-connections",
      undefined,
      env(),
    );
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual(state);
    expect(investmentConnectionsRepository.getState).toHaveBeenCalledWith(
      "synthetic-access-subject",
      true,
    );

    const linkResponse = await app.request(
      "/api/investment-connections/link-token",
      { method: "POST" },
      env(),
    );
    expect(linkResponse.status).toBe(200);
    await expect(linkResponse.json()).resolves.toEqual({
      linkToken: "link-synthetic-token",
      expiration: "2026-08-10T12:30:00.000Z",
    });
    expect(plaidClient.createLinkToken).toHaveBeenCalledWith(
      "synthetic-access-subject",
    );
  });

  it("rejects a malformed exchange before calling Plaid", async () => {
    const plaidClient = client();
    const app = createApp({
      investmentConnectionsRepository: repository(),
      plaidClient,
    });
    const response = await app.request(
      "/api/investment-connections/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken: "" }),
      },
      env(),
    );

    expect(response.status).toBe(400);
    expect(plaidClient.exchangeInvestmentToken).not.toHaveBeenCalled();
  });

  it("treats an already disconnected exact connection as an idempotent delete", async () => {
    const investmentConnectionsRepository = repository();
    investmentConnectionsRepository.getConnectionStatus.mockResolvedValue({
      ...readyStatus,
      status: "disconnected",
      lastSyncedAt: null,
      automaticUpdatesEnabled: false,
      latestRunStatus: null,
    });
    const app = createApp({
      investmentConnectionsRepository,
      plaidClient: client(),
    });

    const response = await app.request(
      `/api/investment-connections/${connectionId}`,
      { method: "DELETE" },
      env(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connectionId,
      status: "disconnected",
      automaticUpdatesEnabled: false,
    });
    expect(
      investmentConnectionsRepository.disconnectConnection,
    ).not.toHaveBeenCalled();
  });

  it("validates and applies a scoped pause action without provider configuration", async () => {
    const investmentConnectionsRepository = repository();
    const pausedStatus = {
      ...readyStatus,
      status: "paused" as const,
      automaticUpdatesEnabled: false,
      latestRunStatus: null,
    };
    investmentConnectionsRepository.getConnectionStatus.mockResolvedValue(
      pausedStatus,
    );
    const app = createApp({
      investmentConnectionsRepository,
      plaidClient: client(),
    });

    const invalid = await app.request(
      `/api/investment-connections/${connectionId}/lifecycle`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      },
      env(),
    );
    expect(invalid.status).toBe(400);

    const response = await app.request(
      `/api/investment-connections/${connectionId}/lifecycle`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      },
      env(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(pausedStatus);
    expect(
      investmentConnectionsRepository.setConnectionPaused,
    ).toHaveBeenCalledWith("synthetic-access-subject", connectionId, true);
  });

  it("does not retain the Robinhood-only route surface", async () => {
    const app = createApp({
      investmentConnectionsRepository: repository(),
      plaidClient: client(),
    });
    const responses = await Promise.all([
      app.request("/api/public-holdings/robinhood/status", undefined, env()),
      app.request(
        "/api/public-holdings/robinhood/link-token",
        { method: "POST" },
        env(),
      ),
      app.request(
        "/api/public-holdings/robinhood/exchange",
        { method: "POST" },
        env(),
      ),
      app.request(
        "/api/public-holdings/robinhood/sync",
        { method: "POST" },
        env(),
      ),
      app.request(
        "/api/public-holdings/robinhood",
        { method: "DELETE" },
        env(),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404,
    ]);
  });
});
