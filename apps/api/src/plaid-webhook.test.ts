import type { PublicHoldingsRepository } from "@keel/database";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __plaidWebhookTest,
  PlaidWebhookRequestError,
  receivePlaidWebhook,
} from "./plaid-webhook";
import type {
  PlaidInvestmentsClient,
  PlaidWebhookVerificationKey,
} from "./robinhood-sync";
import type { Env } from "./types";

const now = new Date("2026-08-14T12:00:00.000Z");
const deliveryId = "11111111-1111-4111-8111-111111111111";
const credentialKey = btoa("k".repeat(32))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/u, "");

const holdingsWebhook = {
  webhook_type: "HOLDINGS",
  webhook_code: "DEFAULT_UPDATE",
  item_id: "synthetic-provider-item",
  user_id: "synthetic-provider-user",
  error: null,
  new_holdings: 1,
  updated_holdings: 2,
  environment: "sandbox",
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signer() {
  const keyId = crypto.randomUUID();
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const exported = (await exportJWK(publicKey)) as JWK & {
    crv: "P-256";
    kty: "EC";
    x: string;
    y: string;
  };
  const verificationKey: PlaidWebhookVerificationKey = {
    alg: "ES256",
    crv: "P-256",
    kid: keyId,
    kty: "EC",
    use: "sig",
    x: exported.x,
    y: exported.y,
    created_at: Math.floor(now.getTime() / 1_000) - 60,
    expired_at: null,
  };
  const sign = async (body: string, issuedAt = now) =>
    new SignJWT({ request_body_sha256: await sha256(body) })
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setIssuedAt(Math.floor(issuedAt.getTime() / 1_000))
      .sign(privateKey);
  return { keyId, sign, verificationKey };
}

function testRepository(
  claim: Awaited<
    ReturnType<PublicHoldingsRepository["claimPlaidWebhookDelivery"]>
  > = { status: "claimed", deliveryId },
) {
  const claimPlaidWebhookDelivery = vi.fn().mockResolvedValue(claim);
  const markPlaidWebhookDelivery = vi.fn().mockResolvedValue(undefined);
  return {
    claimPlaidWebhookDelivery,
    markPlaidWebhookDelivery,
    repository: {
      getStatus: vi.fn(),
      getConnection: vi.fn(),
      upsertConnection: vi.fn(),
      bindProviderAccountKey: vi.fn(),
      claimPlaidWebhookDelivery,
      getPlaidWebhookDelivery: vi.fn(),
      markPlaidWebhookDelivery,
      beginSync: vi.fn(),
      completeSync: vi.fn(),
      failSync: vi.fn(),
    } as unknown as PublicHoldingsRepository,
  };
}

function testEnv(send: ReturnType<typeof vi.fn>): Env {
  return {
    CONNECTOR_CREDENTIAL_KEY: credentialKey,
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: { send } as unknown as Queue,
    PLAID_CLIENT_ID: "synthetic-client-id",
    PLAID_ENVIRONMENT: "sandbox",
    PLAID_REDIRECT_URI: "https://keel.example/holdings",
    PLAID_SECRET: "synthetic-secret",
    PLAID_WEBHOOK_URL: "https://keel-webhooks.example/webhooks/plaid",
  };
}

function testClient(
  verificationKey: PlaidWebhookVerificationKey,
): PlaidInvestmentsClient {
  return {
    createLinkToken: vi.fn(),
    exchangeRobinhoodToken: vi.fn(),
    removeItem: vi.fn(),
    updateItemWebhook: vi.fn(),
    getWebhookVerificationKey: vi.fn().mockResolvedValue(verificationKey),
    getHoldings: vi.fn(),
  };
}

async function signedRequest(
  body: string,
  sign: (body: string, issuedAt?: Date) => Promise<string>,
  issuedAt?: Date,
): Promise<Request> {
  return new Request("https://keel-webhooks.example/webhooks/plaid", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Plaid-Verification": await sign(body, issuedAt),
    },
    body,
  });
}

describe("Plaid holdings webhooks", () => {
  beforeEach(() => __plaidWebhookTest.clearKeyCache());

  it("verifies the raw body, stores only opaque identifiers, and queues one job", async () => {
    const body = JSON.stringify(holdingsWebhook);
    const { sign, verificationKey } = await signer();
    const send = vi.fn().mockResolvedValue(undefined);
    const repository = testRepository();

    await expect(
      receivePlaidWebhook({
        client: testClient(verificationKey),
        env: testEnv(send),
        now: () => now,
        repository: repository.repository,
        request: await signedRequest(body, sign),
      }),
    ).resolves.toBe("accepted");

    expect(repository.claimPlaidWebhookDelivery).toHaveBeenCalledWith({
      providerAccountKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
      signatureSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      bodySha256: await sha256(body),
      issuedAt: now.toISOString(),
      receivedAt: now.toISOString(),
    });
    expect(
      repository.claimPlaidWebhookDelivery.mock.calls[0]?.[0]
        .providerAccountKey,
    ).not.toContain(holdingsWebhook.item_id);
    expect(send).toHaveBeenCalledWith({
      type: "plaid_holdings_webhook",
      messageId: expect.any(String),
      deliveryId,
      requestedAt: now.toISOString(),
    });
    expect(repository.markPlaidWebhookDelivery).toHaveBeenCalledWith(
      deliveryId,
      "queued",
    );
  });

  it("rejects a tampered body and a stale signed delivery", async () => {
    const originalBody = JSON.stringify(holdingsWebhook);
    const tamperedBody = JSON.stringify({
      ...holdingsWebhook,
      new_holdings: 9,
    });
    const { sign, verificationKey } = await signer();
    const send = vi.fn();
    const repository = testRepository();
    const tamperedToken = await sign(originalBody);
    const tamperedRequest = new Request(
      "https://keel-webhooks.example/webhooks/plaid",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Plaid-Verification": tamperedToken,
        },
        body: tamperedBody,
      },
    );

    await expect(
      receivePlaidWebhook({
        client: testClient(verificationKey),
        env: testEnv(send),
        now: () => now,
        repository: repository.repository,
        request: tamperedRequest,
      }),
    ).rejects.toMatchObject({ status: 401, code: "signature_invalid" });
    await expect(
      receivePlaidWebhook({
        client: testClient(verificationKey),
        env: testEnv(send),
        now: () => now,
        repository: repository.repository,
        request: await signedRequest(
          originalBody,
          sign,
          new Date(now.getTime() - 301_000),
        ),
      }),
    ).rejects.toMatchObject({ status: 401, code: "signature_invalid" });
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed on a missing signature and an oversized body", async () => {
    const send = vi.fn();
    const { verificationKey } = await signer();
    const input = {
      client: testClient(verificationKey),
      env: testEnv(send),
      now: () => now,
      repository: testRepository().repository,
    };
    await expect(
      receivePlaidWebhook({
        ...input,
        request: new Request("https://keel-webhooks.example/webhooks/plaid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(holdingsWebhook),
        }),
      }),
    ).rejects.toBeInstanceOf(PlaidWebhookRequestError);
    await expect(
      receivePlaidWebhook({
        ...input,
        request: new Request("https://keel-webhooks.example/webhooks/plaid", {
          method: "POST",
          headers: {
            "Content-Length": String(__plaidWebhookTest.maxBodyBytes + 1),
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      }),
    ).rejects.toMatchObject({ status: 413, code: "body_too_large" });
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores signed unrelated events and environment mismatches", async () => {
    const { sign, verificationKey } = await signer();
    const send = vi.fn();
    const repository = testRepository();
    const unrelated = JSON.stringify({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
    });
    const wrongEnvironment = JSON.stringify({
      ...holdingsWebhook,
      environment: "production",
    });
    for (const body of [unrelated, wrongEnvironment]) {
      await expect(
        receivePlaidWebhook({
          client: testClient(verificationKey),
          env: testEnv(send),
          now: () => now,
          repository: repository.repository,
          request: await signedRequest(body, sign),
        }),
      ).resolves.toBe("ignored");
    }
    expect(repository.claimPlaidWebhookDelivery).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("acknowledges unknown and replayed items without adding queue work", async () => {
    const body = JSON.stringify(holdingsWebhook);
    const { sign, verificationKey } = await signer();
    for (const claim of [
      { status: "unknown" } as const,
      { status: "duplicate", deliveryId } as const,
    ]) {
      const send = vi.fn();
      await expect(
        receivePlaidWebhook({
          client: testClient(verificationKey),
          env: testEnv(send),
          now: () => now,
          repository: testRepository(claim).repository,
          request: await signedRequest(body, sign),
        }),
      ).resolves.toBe(
        claim.status === "unknown" ? "unknown_item" : "duplicate",
      );
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("returns a retryable failure when the queue cannot accept a claimed delivery", async () => {
    const body = JSON.stringify(holdingsWebhook);
    const { sign, verificationKey } = await signer();
    const send = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    const repository = testRepository();

    await expect(
      receivePlaidWebhook({
        client: testClient(verificationKey),
        env: testEnv(send),
        now: () => now,
        repository: repository.repository,
        request: await signedRequest(body, sign),
      }),
    ).rejects.toMatchObject({ status: 503, code: "temporary_failure" });
    expect(repository.markPlaidWebhookDelivery).not.toHaveBeenCalled();
  });
});
