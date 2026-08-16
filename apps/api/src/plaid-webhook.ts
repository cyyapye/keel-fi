import { PlaidHoldingsWebhookJobMessageSchema } from "@keel/connectors";
import {
  D1HoldingImportRepository,
  D1PortfolioBaselineRepository,
  D1PublicHoldingsRepository,
  type PublicHoldingsRepository,
} from "@keel/database";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { z } from "zod";

import {
  createPlaidInvestmentsClient,
  PlaidClientError,
  syncRobinhood,
  type PlaidInvestmentsClient,
  type PlaidWebhookVerificationKey,
} from "./robinhood-sync";
import { plaidInvestmentsSourceKey } from "./investment-identity";
import type { Env } from "./types";

const MAX_PLAID_WEBHOOK_BYTES = 64 * 1_024;
const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;
const MAX_WEBHOOK_CLOCK_SKEW_SECONDS = 30;
const MAX_CACHED_KEYS = 8;

const PlaidWebhookEnvelopeSchema = z
  .object({
    webhook_type: z.string().min(1).max(64),
    webhook_code: z.string().min(1).max(64),
  })
  .passthrough();

const PlaidHoldingsWebhookSchema = z
  .object({
    webhook_type: z.literal("HOLDINGS"),
    webhook_code: z.literal("DEFAULT_UPDATE"),
    item_id: z.string().min(1).max(512),
    user_id: z.string().min(1).max(512),
    error: z.unknown().nullable(),
    new_holdings: z.number().int().nonnegative().max(10_000),
    updated_holdings: z.number().int().nonnegative().max(10_000),
    environment: z.enum(["sandbox", "production"]),
  })
  .passthrough();

const PlaidVerificationPayloadSchema = z
  .object({
    iat: z.number().int().nonnegative(),
    request_body_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .passthrough();

type CachedKey = {
  readonly key: CryptoKey;
  readonly expiresAt: number;
};

const verificationKeyCache = new Map<string, CachedKey>();

export class PlaidWebhookRequestError extends Error {
  public constructor(
    public readonly status: 400 | 401 | 413 | 503,
    public readonly code:
      | "body_invalid"
      | "body_too_large"
      | "configuration_invalid"
      | "signature_invalid"
      | "temporary_failure",
  ) {
    super(code);
    this.name = "PlaidWebhookRequestError";
  }
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

function constantTimeTextMatches(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MAX_PLAID_WEBHOOK_BYTES)
  ) {
    throw new PlaidWebhookRequestError(413, "body_too_large");
  }
  if (request.body === null) {
    throw new PlaidWebhookRequestError(400, "body_invalid");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_PLAID_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PlaidWebhookRequestError(413, "body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) {
    throw new PlaidWebhookRequestError(400, "body_invalid");
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function keyExpiry(
  key: PlaidWebhookVerificationKey,
  nowSeconds: number,
): number {
  if (key.created_at > nowSeconds + MAX_WEBHOOK_CLOCK_SKEW_SECONDS) {
    throw new PlaidWebhookRequestError(401, "signature_invalid");
  }
  if (key.expired_at !== null && key.expired_at <= nowSeconds) {
    throw new PlaidWebhookRequestError(401, "signature_invalid");
  }
  return Math.min(key.expired_at ?? nowSeconds + 86_400, nowSeconds + 86_400);
}

async function verificationKey(
  client: PlaidInvestmentsClient,
  keyId: string,
  nowSeconds: number,
): Promise<CryptoKey> {
  const cached = verificationKeyCache.get(keyId);
  if (cached !== undefined && cached.expiresAt > nowSeconds) {
    return cached.key;
  }
  let jwk: PlaidWebhookVerificationKey;
  try {
    jwk = await client.getWebhookVerificationKey(keyId);
  } catch (error) {
    if (
      error instanceof PlaidClientError &&
      (error.code === "configuration_required" ||
        error.code === "provider_unavailable")
    ) {
      throw new PlaidWebhookRequestError(
        503,
        error.code === "configuration_required"
          ? "configuration_invalid"
          : "temporary_failure",
      );
    }
    throw new PlaidWebhookRequestError(401, "signature_invalid");
  }
  const expiresAt = keyExpiry(jwk, nowSeconds);
  const imported = await importJWK(jwk, "ES256");
  if (!(imported instanceof CryptoKey)) {
    throw new PlaidWebhookRequestError(401, "signature_invalid");
  }
  if (verificationKeyCache.size >= MAX_CACHED_KEYS) {
    const oldest = verificationKeyCache.keys().next().value;
    if (typeof oldest === "string") {
      verificationKeyCache.delete(oldest);
    }
  }
  verificationKeyCache.set(keyId, { key: imported, expiresAt });
  return imported;
}

async function verifyPlaidSignature(input: {
  body: Uint8Array;
  client: PlaidInvestmentsClient;
  now: Date;
  token: string | undefined;
}): Promise<{ bodySha256: string; issuedAt: string; signatureSha256: string }> {
  if (input.token === undefined || input.token.length > 8_192) {
    throw new PlaidWebhookRequestError(401, "signature_invalid");
  }
  try {
    const header = decodeProtectedHeader(input.token);
    if (
      header.alg !== "ES256" ||
      typeof header.kid !== "string" ||
      header.kid.length === 0 ||
      header.kid.length > 512
    ) {
      throw new PlaidWebhookRequestError(401, "signature_invalid");
    }
    const nowSeconds = Math.floor(input.now.getTime() / 1_000);
    const key = await verificationKey(input.client, header.kid, nowSeconds);
    const verified = await jwtVerify(input.token, key, {
      algorithms: ["ES256"],
      currentDate: input.now,
    });
    const payload = PlaidVerificationPayloadSchema.parse(verified.payload);
    const ageSeconds = nowSeconds - payload.iat;
    if (
      ageSeconds > MAX_WEBHOOK_AGE_SECONDS ||
      ageSeconds < -MAX_WEBHOOK_CLOCK_SKEW_SECONDS
    ) {
      throw new PlaidWebhookRequestError(401, "signature_invalid");
    }
    const bodySha256 = await sha256Bytes(input.body);
    if (!constantTimeTextMatches(bodySha256, payload.request_body_sha256)) {
      throw new PlaidWebhookRequestError(401, "signature_invalid");
    }
    return {
      bodySha256,
      issuedAt: new Date(payload.iat * 1_000).toISOString(),
      signatureSha256: await sha256Text(input.token),
    };
  } catch (error) {
    if (error instanceof PlaidWebhookRequestError) {
      throw error;
    }
    throw new PlaidWebhookRequestError(401, "signature_invalid");
  }
}

export type PlaidWebhookReceipt =
  "accepted" | "duplicate" | "ignored" | "unknown_item";

export async function receivePlaidWebhook(input: {
  client: PlaidInvestmentsClient;
  env: Env;
  now?: () => Date;
  repository: PublicHoldingsRepository;
  request: Request;
}): Promise<PlaidWebhookReceipt> {
  const contentType = input.request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new PlaidWebhookRequestError(400, "body_invalid");
  }
  const body = await readBoundedBody(input.request);
  const now = (input.now ?? (() => new Date()))();
  const verified = await verifyPlaidSignature({
    body,
    client: input.client,
    now,
    token: input.request.headers.get("Plaid-Verification") ?? undefined,
  });

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
  } catch {
    throw new PlaidWebhookRequestError(400, "body_invalid");
  }
  const envelope = PlaidWebhookEnvelopeSchema.safeParse(decoded);
  if (!envelope.success) {
    throw new PlaidWebhookRequestError(400, "body_invalid");
  }
  if (
    envelope.data.webhook_type !== "HOLDINGS" ||
    envelope.data.webhook_code !== "DEFAULT_UPDATE"
  ) {
    return "ignored";
  }
  const webhook = PlaidHoldingsWebhookSchema.safeParse(decoded);
  if (!webhook.success) {
    throw new PlaidWebhookRequestError(400, "body_invalid");
  }
  if (
    webhook.data.error !== null ||
    webhook.data.environment !== input.env.PLAID_ENVIRONMENT
  ) {
    return "ignored";
  }

  let accountKey: string;
  try {
    accountKey = await plaidInvestmentsSourceKey(
      input.env,
      webhook.data.item_id,
    );
  } catch {
    throw new PlaidWebhookRequestError(503, "configuration_invalid");
  }
  const claim = await input.repository.claimPlaidWebhookDelivery({
    providerAccountKey: accountKey,
    signatureSha256: verified.signatureSha256,
    bodySha256: verified.bodySha256,
    issuedAt: verified.issuedAt,
    receivedAt: now.toISOString(),
  });
  if (claim.status === "unknown") {
    return "unknown_item";
  }
  if (claim.status === "duplicate") {
    return "duplicate";
  }

  try {
    await input.env.INGESTION_QUEUE.send(
      PlaidHoldingsWebhookJobMessageSchema.parse({
        type: "plaid_holdings_webhook",
        messageId: crypto.randomUUID(),
        deliveryId: claim.deliveryId,
        requestedAt: now.toISOString(),
      }),
    );
    await input.repository.markPlaidWebhookDelivery(claim.deliveryId, "queued");
  } catch {
    throw new PlaidWebhookRequestError(503, "temporary_failure");
  }
  return "accepted";
}

export async function processPlaidHoldingsWebhookJob(
  rawMessage: unknown,
  env: Env,
): Promise<"processed" | "retry"> {
  const message = PlaidHoldingsWebhookJobMessageSchema.parse(rawMessage);
  const repository = new D1PublicHoldingsRepository(env.DB);
  const delivery = await repository.getPlaidWebhookDelivery(message.deliveryId);
  if (delivery === null || delivery.status === "processed") {
    return "processed";
  }
  const claimed = await repository.markPlaidWebhookDelivery(
    message.deliveryId,
    "processing",
  );
  if (!claimed) {
    return "processed";
  }
  try {
    const status = await syncRobinhood({
      env,
      repository,
      holdingImports: new D1HoldingImportRepository(env.DB),
      portfolioBaselines: new D1PortfolioBaselineRepository(env.DB),
      client: createPlaidInvestmentsClient(env),
      accessSubject: delivery.accessSubject,
    });
    if (status.status === "syncing") {
      return "retry";
    }
    await repository.markPlaidWebhookDelivery(message.deliveryId, "processed");
    return "processed";
  } catch (error) {
    await repository
      .markPlaidWebhookDelivery(message.deliveryId, "failed")
      .catch(() => undefined);
    throw error;
  }
}

export const __plaidWebhookTest = {
  clearKeyCache: () => verificationKeyCache.clear(),
  maxBodyBytes: MAX_PLAID_WEBHOOK_BYTES,
  verifyPlaidSignature,
};
