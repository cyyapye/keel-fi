import type {
  RobinhoodConnectionUpdate,
  RobinhoodSyncRun,
} from "@keel/database";
import type { RobinhoodSyncStatus } from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { Env } from "./types";

const readyStatus: RobinhoodSyncStatus = {
  version: 1,
  configured: true,
  status: "ready",
  lastSyncedAt: "2026-08-10T12:00:00.000Z",
  automaticUpdatesEnabled: true,
  latestImportId: null,
  latestRunStatus: "succeeded",
  errorCode: null,
  latestAdjudication: null,
};

function repository() {
  return {
    getStatus: vi.fn().mockResolvedValue(readyStatus),
    getConnection: vi.fn().mockResolvedValue(null),
    upsertConnection: vi.fn().mockResolvedValue({
      id: "synthetic-connection",
      secretReference: "synthetic-reference",
      providerAccountKey: "a".repeat(64),
      previousSecretReference: null,
    } satisfies RobinhoodConnectionUpdate),
    beginSync: vi.fn().mockResolvedValue({
      id: "synthetic-run",
      created: false,
      connection: {
        id: "synthetic-connection",
        secretReference: "synthetic-reference",
        providerAccountKey: "a".repeat(64),
      },
    } satisfies RobinhoodSyncRun),
    completeSync: vi.fn().mockResolvedValue(undefined),
    failSync: vi.fn().mockResolvedValue(undefined),
    bindProviderAccountKey: vi.fn().mockResolvedValue(undefined),
    claimPlaidWebhookDelivery: vi.fn(),
    getPlaidWebhookDelivery: vi.fn(),
    markPlaidWebhookDelivery: vi.fn(),
  };
}

function client() {
  return {
    createLinkToken: vi.fn().mockResolvedValue({
      linkToken: "link-synthetic-token",
      expiration: "2026-08-10T12:30:00.000Z",
    }),
    exchangeRobinhoodToken: vi.fn(),
    removeItem: vi.fn(),
    updateItemWebhook: vi.fn(),
    getWebhookVerificationKey: vi.fn(),
    getHoldings: vi.fn(),
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

describe("Robinhood public-holdings API", () => {
  it("rejects unsigned Plaid webhooks before they reach repository state", async () => {
    const publicHoldingsRepository = repository();
    const app = createApp({
      publicHoldingsRepository,
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
      publicHoldingsRepository.claimPlaidWebhookDelivery,
    ).not.toHaveBeenCalled();
  });

  it("returns configured status and creates a private Link token", async () => {
    const publicHoldingsRepository = repository();
    const plaidClient = client();
    const app = createApp({ publicHoldingsRepository, plaidClient });

    const statusResponse = await app.request(
      "/api/public-holdings/robinhood/status",
      undefined,
      env(),
    );
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual(readyStatus);
    expect(publicHoldingsRepository.getStatus).toHaveBeenCalledWith(
      "synthetic-access-subject",
      true,
    );

    const linkResponse = await app.request(
      "/api/public-holdings/robinhood/link-token",
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

  it("rejects an unbounded or malformed exchange payload before Plaid", async () => {
    const plaidClient = client();
    const app = createApp({
      publicHoldingsRepository: repository(),
      plaidClient,
    });
    const response = await app.request(
      "/api/public-holdings/robinhood/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken: "" }),
      },
      env(),
    );

    expect(response.status).toBe(400);
    expect(plaidClient.exchangeRobinhoodToken).not.toHaveBeenCalled();
  });
});
