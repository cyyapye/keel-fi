import {
  normalizePlaidLiabilities,
  PlaidLiabilitiesResponseSchema,
  type PlaidLiabilitiesResponse,
} from "@keel/connectors";
import type { LiabilitiesRepository } from "@keel/database";
import {
  LiabilitiesErrorCodeSchema,
  LiabilityLinkTokenSchema,
  type LiabilitiesErrorCode,
  type LiabilitiesState,
  type LiabilityLinkToken,
} from "@keel/domain";
import { z } from "zod";

import type { Env } from "./types";

const MAX_RESPONSE_BYTES = 5 * 1_048_576;
const REQUEST_TIMEOUT_MS = 15_000;

const ConfigurationSchema = z
  .object({
    clientId: z.string().min(1).max(512),
    secret: z.string().min(1).max(512),
    environment: z.enum(["sandbox", "production"]),
    credentialKey: z.string().min(1).max(256),
    redirectUri: z.url().max(2_048),
  })
  .strict();

type Configuration = z.infer<typeof ConfigurationSchema>;

const LinkTokenResponseSchema = z
  .object({
    link_token: z.string().min(1).max(4_096),
    expiration: z.iso.datetime({ offset: true }),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

const ExchangeResponseSchema = z
  .object({
    access_token: z.string().min(1).max(4_096),
    item_id: z.string().min(1).max(512),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

const ItemResponseSchema = z
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

const InstitutionResponseSchema = z
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

const CredentialSchema = z
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

export type LiabilityCredential = z.infer<typeof CredentialSchema>;

export class PlaidLiabilitiesClientError extends Error {
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
    this.name = "PlaidLiabilitiesClientError";
  }
}

export interface PlaidLiabilitiesClient {
  createLinkToken(clientUserId: string): Promise<LiabilityLinkToken>;
  exchangeToken(publicToken: string): Promise<{
    credential: LiabilityCredential;
    institutionLabel: string;
  }>;
  getLiabilities(accessToken: string): Promise<{
    bytes: Uint8Array;
    parsed: PlaidLiabilitiesResponse;
  }>;
  removeItem(accessToken: string): Promise<void>;
}

function configuration(env: Env): Configuration {
  let redirectUri: string | undefined;
  try {
    const url = new URL(env.PLAID_REDIRECT_URI ?? "");
    url.pathname = "/obligations";
    url.search = "";
    url.hash = "";
    redirectUri = url.toString();
  } catch {
    redirectUri = undefined;
  }
  const parsed = ConfigurationSchema.safeParse({
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    environment: env.PLAID_ENVIRONMENT,
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    redirectUri,
  });
  if (!parsed.success) {
    throw new PlaidLiabilitiesClientError(
      "configuration_required",
      "Obligation import is not configured.",
    );
  }
  try {
    if (base64UrlDecode(parsed.data.credentialKey).byteLength !== 32) {
      throw new Error("invalid key");
    }
  } catch {
    throw new PlaidLiabilitiesClientError(
      "configuration_required",
      "Obligation import is not configured.",
    );
  }
  return parsed.data;
}

export function liabilitiesConfigured(env: Env): boolean {
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
  for (const byte of bytes) binary += String.fromCharCode(byte);
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

async function encryptionKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(base64UrlDecode(configuration(env).credentialKey)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

async function providerHmacKey(env: Env, info: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(base64UrlDecode(configuration(env).credentialKey)),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ownedArrayBuffer(
        new TextEncoder().encode("keel-liability-provider-key-v1"),
      ),
      info: ownedArrayBuffer(new TextEncoder().encode(info)),
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

async function providerKey(
  env: Env,
  kind: "item" | "account",
  rawValue: string,
): Promise<string> {
  const value = z.string().min(1).max(512).parse(rawValue);
  const signature = await crypto.subtle.sign(
    "HMAC",
    await providerHmacKey(env, `plaid-liability-${kind}-id`),
    ownedArrayBuffer(new TextEncoder().encode(value)),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function encryptCredential(
  env: Env,
  rawCredential: LiabilityCredential,
  accessSubject: string,
  objectKey: string,
): Promise<Uint8Array> {
  const credential = CredentialSchema.parse(rawCredential);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedArrayBuffer(iv),
      additionalData: ownedArrayBuffer(
        new TextEncoder().encode(
          JSON.stringify(["liability-credential-v1", accessSubject, objectKey]),
        ),
      ),
    },
    await encryptionKey(env),
    ownedArrayBuffer(new TextEncoder().encode(JSON.stringify(credential))),
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
): Promise<LiabilityCredential> {
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
            JSON.stringify([
              "liability-credential-v1",
              accessSubject,
              objectKey,
            ]),
          ),
        ),
      },
      await encryptionKey(env),
      ownedArrayBuffer(base64UrlDecode(envelope.ciphertext)),
    );
    return CredentialSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
    );
  } catch (error) {
    if (
      error instanceof PlaidLiabilitiesClientError &&
      error.code === "configuration_required"
    ) {
      throw error;
    }
    throw new PlaidLiabilitiesClientError(
      "connection_invalid",
      "Reconnect this institution to continue.",
    );
  }
}

async function readCredentialObject(object: R2ObjectBody): Promise<Uint8Array> {
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 16_384) {
    throw new PlaidLiabilitiesClientError(
      "connection_invalid",
      "Reconnect this institution to continue.",
    );
  }
  return bytes;
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
    throw new PlaidLiabilitiesClientError(
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
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PlaidLiabilitiesClientError(
          "response_invalid",
          "Plaid returned an oversized response.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PlaidLiabilitiesClientError) throw error;
    throw new PlaidLiabilitiesClientError(
      "provider_unavailable",
      "Obligation data is temporarily unavailable.",
    );
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) {
    throw new PlaidLiabilitiesClientError(
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

export class FetchPlaidLiabilitiesClient implements PlaidLiabilitiesClient {
  public constructor(
    private readonly config: Configuration,
    private readonly fetcher: typeof fetch = (input, init) =>
      fetch(input, init),
  ) {}

  public async createLinkToken(
    clientUserId: string,
  ): Promise<LiabilityLinkToken> {
    const response = await this.post(
      "/link/token/create",
      {
        client_name: "Keel",
        country_codes: ["US"],
        language: "en",
        products: ["liabilities"],
        redirect_uri: this.config.redirectUri,
        account_filters: {
          credit: { account_subtypes: ["credit card", "paypal"] },
          loan: { account_subtypes: ["mortgage", "student"] },
        },
        user: { client_user_id: await sha256(clientUserId) },
      },
      LinkTokenResponseSchema,
    );
    return LiabilityLinkTokenSchema.parse({
      linkToken: response.link_token,
      expiration: response.expiration,
    });
  }

  public async exchangeToken(publicToken: string): Promise<{
    credential: LiabilityCredential;
    institutionLabel: string;
  }> {
    const exchange = await this.post(
      "/item/public_token/exchange",
      { public_token: z.string().min(1).max(4_096).parse(publicToken) },
      ExchangeResponseSchema,
    );
    try {
      const item = await this.post(
        "/item/get",
        { access_token: exchange.access_token },
        ItemResponseSchema,
      );
      if (item.item.institution_id === null) {
        throw new PlaidLiabilitiesClientError(
          "connection_invalid",
          "Choose an institution that reports supported obligations.",
        );
      }
      const institution = await this.post(
        "/institutions/get_by_id",
        {
          institution_id: item.item.institution_id,
          country_codes: ["US"],
        },
        InstitutionResponseSchema,
      );
      if (!institution.institution.products.includes("liabilities")) {
        throw new PlaidLiabilitiesClientError(
          "connection_invalid",
          "Choose an institution that reports supported obligations.",
        );
      }
      return {
        credential: CredentialSchema.parse({
          version: 1,
          accessToken: exchange.access_token,
          itemId: exchange.item_id,
          institutionId: institution.institution.institution_id,
        }),
        institutionLabel: institution.institution.name,
      };
    } catch (error) {
      await this.removeItem(exchange.access_token).catch(() => undefined);
      throw error;
    }
  }

  public async getLiabilities(accessToken: string): Promise<{
    bytes: Uint8Array;
    parsed: PlaidLiabilitiesResponse;
  }> {
    const bytes = await this.request("/liabilities/get", {
      access_token: z.string().min(1).max(4_096).parse(accessToken),
    });
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new PlaidLiabilitiesClientError(
        "response_invalid",
        "Plaid returned unreadable obligation data.",
      );
    }
    const parsed = PlaidLiabilitiesResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new PlaidLiabilitiesClientError(
        "response_invalid",
        "Plaid returned unsupported obligation data.",
      );
    }
    return { bytes, parsed: parsed.data };
  }

  public async removeItem(accessToken: string): Promise<void> {
    await this.request("/item/remove", {
      access_token: z.string().min(1).max(4_096).parse(accessToken),
    });
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
      throw new PlaidLiabilitiesClientError(
        "response_invalid",
        "Plaid returned an unreadable response.",
      );
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      throw new PlaidLiabilitiesClientError(
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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new PlaidLiabilitiesClientError(
        "provider_unavailable",
        "Obligation data is temporarily unavailable.",
      );
    }
    const contentLength = response.headers.get("Content-Length");
    if (
      contentLength !== null &&
      (!/^\d+$/u.test(contentLength) ||
        BigInt(contentLength) > BigInt(MAX_RESPONSE_BYTES))
    ) {
      throw new PlaidLiabilitiesClientError(
        "response_invalid",
        "Plaid returned an oversized response.",
      );
    }
    const bytes = await readBoundedResponse(response);
    if (!response.ok) {
      const invalid = response.status === 400 || response.status === 401;
      throw new PlaidLiabilitiesClientError(
        invalid ? "connection_invalid" : "provider_unavailable",
        invalid
          ? "Reconnect this institution to continue."
          : "Obligation data is temporarily unavailable.",
      );
    }
    return bytes;
  }
}

export function createPlaidLiabilitiesClient(env: Env): PlaidLiabilitiesClient {
  return new FetchPlaidLiabilitiesClient(configuration(env));
}

function errorCode(error: unknown): LiabilitiesErrorCode {
  const rawCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unexpected_failure";
  return LiabilitiesErrorCodeSchema.catch("unexpected_failure").parse(rawCode);
}

export async function connectLiabilities(input: {
  env: Env;
  repository: LiabilitiesRepository;
  client: PlaidLiabilitiesClient;
  accessSubject: string;
  publicToken: string;
}): Promise<LiabilitiesState> {
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
      await providerKey(input.env, "item", exchanged.credential.itemId),
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
  try {
    return await refreshLiabilities({
      ...input,
      connectionId,
      refreshKind: "initial",
    });
  } catch (error) {
    try {
      await input.client.removeItem(exchanged.credential.accessToken);
      await input.repository.revokeConnection(
        input.accessSubject,
        connectionId,
      );
      await input.env.DOCUMENTS.delete(objectKey);
    } catch {
      // Keep the active encrypted credential so removal can be retried safely.
    }
    throw error;
  }
}

export async function refreshLiabilities(input: {
  env: Env;
  repository: LiabilitiesRepository;
  client: PlaidLiabilitiesClient;
  accessSubject: string;
  connectionId: string;
  refreshKind: "initial" | "live";
}): Promise<LiabilitiesState> {
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
      throw new PlaidLiabilitiesClientError(
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
    const response = await input.client.getLiabilities(credential.accessToken);
    let normalized: Awaited<ReturnType<typeof normalizePlaidLiabilities>>;
    try {
      normalized = await normalizePlaidLiabilities(response.parsed, {
        institutionLabel: run.connection.institutionLabel,
        retrievedAt,
        accountKeyFor: (providerAccountId) =>
          providerKey(input.env, "account", providerAccountId),
      });
    } catch {
      throw new PlaidLiabilitiesClientError(
        "response_invalid",
        "Plaid returned unsupported obligation data.",
      );
    }
    observationObjectKey = `liability-observations/${crypto.randomUUID()}.json`;
    await input.env.DOCUMENTS.put(observationObjectKey, response.bytes, {
      httpMetadata: { contentType: "application/json" },
    });
    let staged: Awaited<ReturnType<LiabilitiesRepository["stageProposal"]>>;
    try {
      staged = await input.repository.stageProposal(
        input.accessSubject,
        run.id,
        {
          objectKey: observationObjectKey,
          sourceSha256: await sha256Bytes(response.bytes),
          normalized,
        },
      );
    } catch {
      throw new PlaidLiabilitiesClientError(
        "staging_failed",
        "Keel could not prepare the obligations for review.",
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

export async function disconnectLiabilities(input: {
  env: Env;
  repository: LiabilitiesRepository;
  client: PlaidLiabilitiesClient;
  accessSubject: string;
  connectionId: string;
}): Promise<LiabilitiesState> {
  const connection = await input.repository.getConnection(
    input.accessSubject,
    input.connectionId,
  );
  if (connection === null) {
    throw new PlaidLiabilitiesClientError(
      "connection_invalid",
      "This institution is no longer connected.",
    );
  }
  const object = await input.env.DOCUMENTS.get(connection.secretReference);
  if (object === null) {
    throw new PlaidLiabilitiesClientError(
      "connection_invalid",
      "Reconnect this institution before removing access.",
    );
  }
  const credential = await decryptCredential(
    input.env,
    await readCredentialObject(object),
    input.accessSubject,
    connection.secretReference,
  );
  await input.client.removeItem(credential.accessToken);
  await input.repository.revokeConnection(input.accessSubject, connection.id);
  await input.env.DOCUMENTS.delete(connection.secretReference);
  return input.repository.getState(input.accessSubject, true);
}
