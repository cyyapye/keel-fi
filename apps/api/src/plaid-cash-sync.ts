import {
  normalizePlaidCashAccounts,
  PlaidCashAccountsResponseSchema,
  type PlaidCashAccountsResponse,
} from "@keel/connectors";
import type { CashAccountsRepository } from "@keel/database";
import {
  CashAccountLinkTokenSchema,
  type CashAccountLinkToken,
  type CashAccountsErrorCode,
  type CashAccountsState,
} from "@keel/domain";
import { z } from "zod";

import type { Env } from "./types";

const MAX_PLAID_RESPONSE_BYTES = 5 * 1_048_576;
const PLAID_REQUEST_TIMEOUT_MS = 15_000;

const PlaidCashConfigurationSchema = z
  .object({
    clientId: z.string().min(1).max(512),
    secret: z.string().min(1).max(512),
    environment: z.enum(["sandbox", "production"]),
    credentialKey: z.string().min(1).max(256),
    redirectUri: z.url().max(2_048),
  })
  .strict();

type PlaidCashConfiguration = z.infer<typeof PlaidCashConfigurationSchema>;

const PlaidLinkTokenResponseSchema = z
  .object({
    link_token: z.string().min(1).max(4_096),
    expiration: z.iso.datetime({ offset: true }),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

const PlaidExchangeResponseSchema = z
  .object({
    access_token: z.string().min(1).max(4_096),
    item_id: z.string().min(1).max(512),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

const PlaidItemResponseSchema = z
  .object({
    item: z
      .object({
        institution_id: z.string().min(1).max(512).nullable(),
        item_id: z.string().min(1).max(512),
      })
      .passthrough(),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

const PlaidInstitutionResponseSchema = z
  .object({
    institution: z
      .object({
        institution_id: z.string().min(1).max(512),
        name: z.string().trim().min(1).max(512),
        products: z.array(z.string().min(1).max(128)).max(100),
      })
      .passthrough(),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

const CashCredentialSchema = z
  .object({
    version: z.literal(1),
    accessToken: z.string().min(1).max(4_096),
    itemId: z.string().min(1).max(512),
    institutionId: z.string().min(1).max(512),
  })
  .strict();

const EncryptedCredentialSchema = z
  .object({
    version: z.literal(1),
    iv: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict();

export type CashCredential = z.infer<typeof CashCredentialSchema>;

export class PlaidCashClientError extends Error {
  public constructor(
    public readonly code:
      | "configuration_required"
      | "connection_invalid"
      | "provider_unavailable"
      | "response_invalid"
      | "staging_failed",
    message: string,
  ) {
    super(message);
    this.name = "PlaidCashClientError";
  }
}

export interface PlaidCashClient {
  createLinkToken(clientUserId: string): Promise<CashAccountLinkToken>;
  exchangeToken(publicToken: string): Promise<{
    credential: CashCredential;
    institutionLabel: string;
  }>;
  getAccounts(
    accessToken: string,
    refreshKind: "initial" | "live",
  ): Promise<{ bytes: Uint8Array; parsed: PlaidCashAccountsResponse }>;
  removeItem(accessToken: string): Promise<void>;
}

function configuration(env: Env): PlaidCashConfiguration {
  const parsed = PlaidCashConfigurationSchema.safeParse({
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    environment: env.PLAID_ENVIRONMENT,
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    redirectUri: env.PLAID_REDIRECT_URI,
  });
  if (!parsed.success) {
    throw new PlaidCashClientError(
      "configuration_required",
      "Cash accounts are not configured.",
    );
  }
  try {
    if (base64UrlDecode(parsed.data.credentialKey).byteLength !== 32) {
      throw new Error("invalid key");
    }
  } catch {
    throw new PlaidCashClientError(
      "configuration_required",
      "Cash accounts are not configured.",
    );
  }
  return parsed.data;
}

export function cashAccountsConfigured(env: Env): boolean {
  try {
    configuration(env);
    return true;
  } catch {
    return false;
  }
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid base64url value.");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") + padding,
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function credentialKey(env: Env): Promise<CryptoKey> {
  const key = base64UrlDecode(configuration(env).credentialKey);
  return crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(key),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

async function cashHmacKey(env: Env, info: string): Promise<CryptoKey> {
  const key = base64UrlDecode(configuration(env).credentialKey);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(key),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ownedArrayBuffer(
        new TextEncoder().encode("keel-cash-provider-key-v1"),
      ),
      info: ownedArrayBuffer(new TextEncoder().encode(info)),
    },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

async function cashProviderKey(
  env: Env,
  kind: "item" | "account",
  rawValue: string,
): Promise<string> {
  const value = z.string().min(1).max(512).parse(rawValue);
  const signature = await crypto.subtle.sign(
    "HMAC",
    await cashHmacKey(env, `plaid-${kind}-id`),
    ownedArrayBuffer(new TextEncoder().encode(value)),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function encryptCredential(
  env: Env,
  rawCredential: CashCredential,
  accessSubject: string,
  objectKey: string,
): Promise<Uint8Array> {
  const credential = CashCredentialSchema.parse(rawCredential);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credential));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedArrayBuffer(iv),
      additionalData: ownedArrayBuffer(
        new TextEncoder().encode(
          JSON.stringify(["cash-credential-v1", accessSubject, objectKey]),
        ),
      ),
    },
    await credentialKey(env),
    ownedArrayBuffer(plaintext),
  );
  return new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      iv: base64UrlEncode(iv),
      ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    }),
  );
}

async function decryptCredential(
  env: Env,
  encrypted: Uint8Array,
  accessSubject: string,
  objectKey: string,
): Promise<CashCredential> {
  try {
    const envelope = EncryptedCredentialSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encrypted)),
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ownedArrayBuffer(base64UrlDecode(envelope.iv)),
        additionalData: ownedArrayBuffer(
          new TextEncoder().encode(
            JSON.stringify(["cash-credential-v1", accessSubject, objectKey]),
          ),
        ),
      },
      await credentialKey(env),
      ownedArrayBuffer(base64UrlDecode(envelope.ciphertext)),
    );
    return CashCredentialSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
    );
  } catch (error) {
    if (
      error instanceof PlaidCashClientError &&
      error.code === "configuration_required"
    ) {
      throw error;
    }
    throw new PlaidCashClientError(
      "connection_invalid",
      "Reconnect this institution to continue.",
    );
  }
}

async function readCredentialObject(object: R2ObjectBody): Promise<Uint8Array> {
  const buffer = await object.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > 16_384) {
    throw new PlaidCashClientError(
      "connection_invalid",
      "Reconnect this institution to continue.",
    );
  }
  return new Uint8Array(buffer);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedArrayBuffer(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  if (response.body === null) {
    throw new PlaidCashClientError(
      "response_invalid",
      "Plaid returned an empty response.",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_PLAID_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PlaidCashClientError(
          "response_invalid",
          "Plaid returned an oversized response.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PlaidCashClientError) {
      throw error;
    }
    throw new PlaidCashClientError(
      "provider_unavailable",
      "Cash balances are temporarily unavailable.",
    );
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) {
    throw new PlaidCashClientError(
      "response_invalid",
      "Plaid returned an invalid response size.",
    );
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class FetchPlaidCashClient implements PlaidCashClient {
  public constructor(
    private readonly config: PlaidCashConfiguration,
    private readonly fetcher: typeof fetch = (input, init) =>
      fetch(input, init),
  ) {}

  public async createLinkToken(
    clientUserId: string,
  ): Promise<CashAccountLinkToken> {
    const response = await this.post(
      "/link/token/create",
      {
        client_name: "Keel",
        country_codes: ["US"],
        language: "en",
        products: ["auth"],
        additional_consented_products: ["transactions"],
        redirect_uri: this.config.redirectUri,
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
        user: { client_user_id: await sha256(clientUserId) },
      },
      PlaidLinkTokenResponseSchema,
    );
    return CashAccountLinkTokenSchema.parse({
      linkToken: response.link_token,
      expiration: response.expiration,
    });
  }

  public async exchangeToken(publicToken: string): Promise<{
    credential: CashCredential;
    institutionLabel: string;
  }> {
    const token = z.string().min(1).max(4_096).parse(publicToken);
    const exchange = await this.post(
      "/item/public_token/exchange",
      { public_token: token },
      PlaidExchangeResponseSchema,
    );
    try {
      const item = await this.post(
        "/item/get",
        { access_token: exchange.access_token },
        PlaidItemResponseSchema,
      );
      if (item.item.institution_id === null) {
        throw new PlaidCashClientError(
          "connection_invalid",
          "Choose a supported bank or cash institution.",
        );
      }
      const institution = await this.post(
        "/institutions/get_by_id",
        {
          institution_id: item.item.institution_id,
          country_codes: ["US"],
        },
        PlaidInstitutionResponseSchema,
      );
      if (!institution.institution.products.includes("auth")) {
        throw new PlaidCashClientError(
          "connection_invalid",
          "Choose a supported bank or cash institution.",
        );
      }
      return {
        credential: CashCredentialSchema.parse({
          version: 1,
          accessToken: exchange.access_token,
          itemId: exchange.item_id,
          institutionId: institution.institution.institution_id,
        }),
        institutionLabel: institution.institution.name,
      };
    } catch (error) {
      await this.removeItem(exchange.access_token);
      throw error;
    }
  }

  public async getAccounts(
    accessToken: string,
    refreshKind: "initial" | "live",
  ): Promise<{ bytes: Uint8Array; parsed: PlaidCashAccountsResponse }> {
    const token = z.string().min(1).max(4_096).parse(accessToken);
    const response = await this.request(
      refreshKind === "initial" ? "/accounts/get" : "/accounts/balance/get",
      { access_token: token },
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(response),
      );
    } catch {
      throw new PlaidCashClientError(
        "response_invalid",
        "Plaid returned an unreadable balance response.",
      );
    }
    const parsed = PlaidCashAccountsResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new PlaidCashClientError(
        "response_invalid",
        "Plaid returned an unsupported balance response.",
      );
    }
    return { bytes: response, parsed: parsed.data };
  }

  public async removeItem(accessToken: string): Promise<void> {
    await this.request("/item/remove", { access_token: accessToken }).catch(
      () => undefined,
    );
  }

  private async post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const bytes = await this.request(path, body);
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new PlaidCashClientError(
        "response_invalid",
        "Plaid returned an unreadable response.",
      );
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      throw new PlaidCashClientError(
        "response_invalid",
        "Plaid returned an unsupported response.",
      );
    }
    return parsed.data;
  }

  private async request(path: string, body: unknown): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://${this.config.environment}.plaid.com${path}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "PLAID-CLIENT-ID": this.config.clientId,
            "PLAID-SECRET": this.config.secret,
            "Plaid-Version": "2020-09-14",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(PLAID_REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new PlaidCashClientError(
        "provider_unavailable",
        "Cash balances are temporarily unavailable.",
      );
    }
    const contentLength = response.headers.get("Content-Length");
    if (
      contentLength !== null &&
      (!/^\d+$/u.test(contentLength) ||
        BigInt(contentLength) > BigInt(MAX_PLAID_RESPONSE_BYTES))
    ) {
      throw new PlaidCashClientError(
        "response_invalid",
        "Plaid returned an oversized response.",
      );
    }
    const bytes = await readBoundedResponse(response);
    if (!response.ok) {
      throw new PlaidCashClientError(
        response.status === 400 || response.status === 401
          ? "connection_invalid"
          : "provider_unavailable",
        response.status === 400 || response.status === 401
          ? "Reconnect this institution to continue."
          : "Cash balances are temporarily unavailable.",
      );
    }
    return bytes;
  }
}

export function createPlaidCashClient(env: Env): PlaidCashClient {
  return new FetchPlaidCashClient(configuration(env));
}

function errorCode(error: unknown): CashAccountsErrorCode {
  if (error instanceof PlaidCashClientError) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const parsed = z
      .enum([
        "configuration_required",
        "connection_invalid",
        "monthly_limit_reached",
        "review_required",
        "provider_unavailable",
        "response_invalid",
        "staging_failed",
        "unexpected_failure",
      ])
      .safeParse(error.code);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return "unexpected_failure";
}

export async function connectCashAccount(input: {
  env: Env;
  repository: CashAccountsRepository;
  client: PlaidCashClient;
  accessSubject: string;
  publicToken: string;
}): Promise<CashAccountsState> {
  const exchanged = await input.client.exchangeToken(input.publicToken);
  const objectKey = `connector-secrets/${crypto.randomUUID()}.json.enc`;
  let connectionId: string;
  try {
    const encrypted = await encryptCredential(
      input.env,
      exchanged.credential,
      input.accessSubject,
      objectKey,
    );
    await input.env.DOCUMENTS.put(objectKey, encrypted, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const connection = await input.repository.upsertConnection(
      input.accessSubject,
      exchanged.institutionLabel,
      objectKey,
      await cashProviderKey(input.env, "item", exchanged.credential.itemId),
    );
    connectionId = connection.id;
    if (
      connection.previousSecretReference !== null &&
      connection.previousSecretReference !== objectKey
    ) {
      await input.env.DOCUMENTS.delete(
        connection.previousSecretReference,
      ).catch(() => undefined);
    }
  } catch (error) {
    await input.env.DOCUMENTS.delete(objectKey).catch(() => undefined);
    await input.client
      .removeItem(exchanged.credential.accessToken)
      .catch(() => undefined);
    throw error;
  }
  await refreshCashAccount({
    ...input,
    connectionId,
    refreshKind: "initial",
  });
  return input.repository.getState(input.accessSubject, true);
}

export async function refreshCashAccount(input: {
  env: Env;
  repository: CashAccountsRepository;
  client: PlaidCashClient;
  accessSubject: string;
  connectionId: string;
  refreshKind: "initial" | "live";
}): Promise<CashAccountsState> {
  const run = await input.repository.beginRefresh(
    input.accessSubject,
    input.connectionId,
    input.refreshKind,
  );
  let observationObjectKey: string | null = null;
  try {
    const encrypted = await input.env.DOCUMENTS.get(
      run.connection.secretReference,
    );
    if (encrypted === null) {
      throw new PlaidCashClientError(
        "connection_invalid",
        "Reconnect this institution to continue.",
      );
    }
    const credential = await decryptCredential(
      input.env,
      await readCredentialObject(encrypted),
      input.accessSubject,
      run.connection.secretReference,
    );
    const retrievedAt = new Date().toISOString();
    const accounts = await input.client.getAccounts(
      credential.accessToken,
      input.refreshKind,
    );
    let normalized: Awaited<ReturnType<typeof normalizePlaidCashAccounts>>;
    try {
      normalized = await normalizePlaidCashAccounts(accounts.parsed, {
        institutionLabel: run.connection.institutionLabel,
        retrievedAt,
        accountKeyFor: (providerAccountId) =>
          cashProviderKey(input.env, "account", providerAccountId),
      });
    } catch {
      throw new PlaidCashClientError(
        "response_invalid",
        "Plaid returned an unsupported balance response.",
      );
    }
    observationObjectKey = `cash-observations/${crypto.randomUUID()}.json`;
    await input.env.DOCUMENTS.put(observationObjectKey, accounts.bytes, {
      httpMetadata: { contentType: "application/json" },
    });
    let staged: Awaited<ReturnType<CashAccountsRepository["stageProposal"]>>;
    try {
      staged = await input.repository.stageProposal(
        input.accessSubject,
        run.id,
        {
          objectKey: observationObjectKey,
          sourceSha256: await sha256Bytes(accounts.bytes),
          normalized,
        },
      );
    } catch {
      throw new PlaidCashClientError(
        "staging_failed",
        "Keel could not prepare the cash balances for review.",
      );
    }
    if (staged.proposal === null) {
      await input.env.DOCUMENTS.delete(observationObjectKey).catch(
        () => undefined,
      );
    }
    observationObjectKey = null;
    await input.repository.completeRefresh(
      input.accessSubject,
      run.id,
      staged.proposal?.id ?? null,
      normalized.rows.length,
    );
    return input.repository.getState(input.accessSubject, true);
  } catch (error) {
    if (observationObjectKey !== null) {
      await input.env.DOCUMENTS.delete(observationObjectKey).catch(
        () => undefined,
      );
    }
    await input.repository.failRefresh(
      input.accessSubject,
      run.id,
      errorCode(error),
    );
    throw error;
  }
}
