import {
  normalizeRobinhoodHoldings,
  PlaidInvestmentsHoldingsResponseSchema,
  type PlaidInvestmentsHoldingsResponse,
} from "@keel/connectors";
import type {
  D1HoldingImportRepository,
  PublicHoldingsRepository,
} from "@keel/database";
import {
  RobinhoodLinkTokenSchema,
  type RobinhoodLinkToken,
  type RobinhoodSyncErrorCode,
  type RobinhoodSyncStatus,
} from "@keel/domain";
import { z } from "zod";

import type { Env } from "./types";

const MAX_PLAID_RESPONSE_BYTES = 5 * 1_048_576;
const PLAID_REQUEST_TIMEOUT_MS = 15_000;

const PlaidConfigurationSchema = z
  .object({
    clientId: z.string().min(1).max(512),
    secret: z.string().min(1).max(512),
    environment: z.enum(["sandbox", "production"]),
    credentialKey: z.string().min(1).max(256),
    redirectUri: z.url().max(2_048),
  })
  .strict();

type PlaidConfiguration = z.infer<typeof PlaidConfigurationSchema>;

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
        name: z.string().min(1).max(512),
        products: z.array(z.string().min(1).max(128)).max(100),
      })
      .passthrough(),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

const RobinhoodCredentialSchema = z
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

type RobinhoodCredential = z.infer<typeof RobinhoodCredentialSchema>;

export class PlaidClientError extends Error {
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
    this.name = "PlaidClientError";
  }
}

export interface PlaidInvestmentsClient {
  createLinkToken(clientUserId: string): Promise<RobinhoodLinkToken>;
  exchangeRobinhoodToken(publicToken: string): Promise<RobinhoodCredential>;
  removeItem(accessToken: string): Promise<void>;
  getHoldings(accessToken: string): Promise<{
    bytes: Uint8Array;
    parsed: PlaidInvestmentsHoldingsResponse;
  }>;
}

function configuration(env: Env): PlaidConfiguration {
  const parsed = PlaidConfigurationSchema.safeParse({
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    environment: env.PLAID_ENVIRONMENT,
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    redirectUri: env.PLAID_REDIRECT_URI,
  });
  if (!parsed.success) {
    throw new PlaidClientError(
      "configuration_required",
      "Robinhood sync is not configured.",
    );
  }
  try {
    if (base64UrlDecode(parsed.data.credentialKey).byteLength !== 32) {
      throw new Error("invalid key");
    }
  } catch {
    throw new PlaidClientError(
      "configuration_required",
      "Robinhood sync is not configured.",
    );
  }
  return parsed.data;
}

export function robinhoodSyncConfigured(env: Env): boolean {
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

async function encryptCredential(
  env: Env,
  rawCredential: RobinhoodCredential,
  accessSubject: string,
  objectKey: string,
): Promise<Uint8Array> {
  const credential = RobinhoodCredentialSchema.parse(rawCredential);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credential));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedArrayBuffer(iv),
      additionalData: ownedArrayBuffer(
        new TextEncoder().encode(
          JSON.stringify(["robinhood-credential-v1", accessSubject, objectKey]),
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
): Promise<RobinhoodCredential> {
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
              "robinhood-credential-v1",
              accessSubject,
              objectKey,
            ]),
          ),
        ),
      },
      await credentialKey(env),
      ownedArrayBuffer(base64UrlDecode(envelope.ciphertext)),
    );
    return RobinhoodCredentialSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
    );
  } catch (error) {
    if (
      error instanceof PlaidClientError &&
      error.code === "configuration_required"
    ) {
      throw error;
    }
    throw new PlaidClientError(
      "connection_invalid",
      "Reconnect Robinhood to continue syncing.",
    );
  }
}

async function readR2Bytes(object: R2ObjectBody): Promise<Uint8Array> {
  const buffer = await object.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > 16_384) {
    throw new PlaidClientError(
      "connection_invalid",
      "Reconnect Robinhood to continue syncing.",
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

async function readBoundedPlaidResponse(
  response: Response,
): Promise<Uint8Array> {
  if (response.body === null) {
    throw new PlaidClientError(
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
        throw new PlaidClientError(
          "response_invalid",
          "Plaid returned an oversized response.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PlaidClientError) {
      throw error;
    }
    throw new PlaidClientError(
      "provider_unavailable",
      "Robinhood sync is temporarily unavailable.",
    );
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) {
    throw new PlaidClientError(
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

export class FetchPlaidInvestmentsClient implements PlaidInvestmentsClient {
  public constructor(
    private readonly config: PlaidConfiguration,
    private readonly fetcher: typeof fetch = (input, init) =>
      fetch(input, init),
  ) {}

  public async createLinkToken(
    clientUserId: string,
  ): Promise<RobinhoodLinkToken> {
    const response = await this.post(
      "/link/token/create",
      {
        client_name: "Keel",
        country_codes: ["US"],
        language: "en",
        products: ["investments"],
        redirect_uri: this.config.redirectUri,
        account_filters: {
          investment: { account_subtypes: ["all"] },
        },
        user: { client_user_id: await sha256(clientUserId) },
      },
      PlaidLinkTokenResponseSchema,
    );
    return RobinhoodLinkTokenSchema.parse({
      linkToken: response.link_token,
      expiration: response.expiration,
    });
  }

  public async exchangeRobinhoodToken(
    publicToken: string,
  ): Promise<RobinhoodCredential> {
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
        throw new PlaidClientError(
          "connection_invalid",
          "Choose Robinhood in the connection window.",
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
      if (
        !/^Robinhood(?:\s|$)/iu.test(institution.institution.name) ||
        !institution.institution.products.includes("investments")
      ) {
        throw new PlaidClientError(
          "connection_invalid",
          "Choose Robinhood in the connection window.",
        );
      }
      return RobinhoodCredentialSchema.parse({
        version: 1,
        accessToken: exchange.access_token,
        itemId: exchange.item_id,
        institutionId: institution.institution.institution_id,
      });
    } catch (error) {
      await this.removeItem(exchange.access_token);
      throw error;
    }
  }

  public async getHoldings(accessToken: string): Promise<{
    bytes: Uint8Array;
    parsed: PlaidInvestmentsHoldingsResponse;
  }> {
    const token = z.string().min(1).max(4_096).parse(accessToken);
    const response = await this.request("/investments/holdings/get", {
      access_token: token,
    });
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(response),
      );
    } catch {
      throw new PlaidClientError(
        "response_invalid",
        "Robinhood returned an unreadable holdings response.",
      );
    }
    const parsed = PlaidInvestmentsHoldingsResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new PlaidClientError(
        "response_invalid",
        "Robinhood returned an unsupported holdings response.",
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
      throw new PlaidClientError(
        "response_invalid",
        "Plaid returned an unreadable response.",
      );
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      throw new PlaidClientError(
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
      throw new PlaidClientError(
        "provider_unavailable",
        "Robinhood sync is temporarily unavailable.",
      );
    }
    const contentLength = response.headers.get("Content-Length");
    if (
      contentLength !== null &&
      (/^\d+$/u.test(contentLength) === false ||
        BigInt(contentLength) > BigInt(MAX_PLAID_RESPONSE_BYTES))
    ) {
      throw new PlaidClientError(
        "response_invalid",
        "Plaid returned an oversized response.",
      );
    }
    const bytes = await readBoundedPlaidResponse(response);
    if (!response.ok) {
      throw new PlaidClientError(
        response.status === 400 || response.status === 401
          ? "connection_invalid"
          : "provider_unavailable",
        response.status === 400 || response.status === 401
          ? "Reconnect Robinhood to continue syncing."
          : "Robinhood sync is temporarily unavailable.",
      );
    }
    return bytes;
  }
}

export function createPlaidInvestmentsClient(env: Env): PlaidInvestmentsClient {
  return new FetchPlaidInvestmentsClient(configuration(env));
}

export async function connectRobinhood(input: {
  env: Env;
  repository: PublicHoldingsRepository;
  client: PlaidInvestmentsClient;
  accessSubject: string;
  publicToken: string;
}): Promise<RobinhoodSyncStatus> {
  const credential = await input.client.exchangeRobinhoodToken(
    input.publicToken,
  );
  const objectKey = `connector-secrets/${crypto.randomUUID()}.json.enc`;
  try {
    const encrypted = await encryptCredential(
      input.env,
      credential,
      input.accessSubject,
      objectKey,
    );
    await input.env.DOCUMENTS.put(objectKey, encrypted, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const connection = await input.repository.upsertConnection(
      input.accessSubject,
      objectKey,
    );
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
      .removeItem(credential.accessToken)
      .catch(() => undefined);
    throw error;
  }
  return input.repository.getStatus(input.accessSubject, true);
}

function syncErrorCode(error: unknown): RobinhoodSyncErrorCode {
  if (error instanceof PlaidClientError) {
    return error.code;
  }
  return "unexpected_failure";
}

export async function syncRobinhood(input: {
  env: Env;
  repository: PublicHoldingsRepository;
  holdingImports: Pick<
    D1HoldingImportRepository,
    "stageRobinhoodHoldingImport"
  >;
  client: PlaidInvestmentsClient;
  accessSubject: string;
}): Promise<RobinhoodSyncStatus> {
  if ((await input.repository.getConnection(input.accessSubject)) === null) {
    throw new PlaidClientError(
      "connection_invalid",
      "Reconnect Robinhood to continue syncing.",
    );
  }
  const run = await input.repository.beginSync(input.accessSubject);
  if (!run.created) {
    return input.repository.getStatus(input.accessSubject, true);
  }

  let stagedObjectKey: string | null = null;
  try {
    const encrypted = await input.env.DOCUMENTS.get(
      run.connection.secretReference,
    );
    if (encrypted === null) {
      throw new PlaidClientError(
        "connection_invalid",
        "Reconnect Robinhood to continue syncing.",
      );
    }
    const credential = await decryptCredential(
      input.env,
      await readR2Bytes(encrypted),
      input.accessSubject,
      run.connection.secretReference,
    );
    const retrievedAt = new Date().toISOString();
    const holdings = await input.client.getHoldings(credential.accessToken);
    let normalized: Awaited<ReturnType<typeof normalizeRobinhoodHoldings>>;
    try {
      normalized = await normalizeRobinhoodHoldings(
        holdings.parsed,
        retrievedAt,
      );
    } catch {
      throw new PlaidClientError(
        "response_invalid",
        "Robinhood returned an unsupported holdings response.",
      );
    }
    if (normalized.rows.length === 0) {
      await input.repository.completeSync(input.accessSubject, run.id, {
        discoveredCount: 0,
        proposedCount: 0,
        importId: null,
      });
      return input.repository.getStatus(input.accessSubject, true);
    }

    stagedObjectKey = `holding-imports/${crypto.randomUUID()}.json`;
    await input.env.DOCUMENTS.put(stagedObjectKey, holdings.bytes, {
      httpMetadata: { contentType: "application/json" },
    });
    let staged: Awaited<
      ReturnType<D1HoldingImportRepository["stageRobinhoodHoldingImport"]>
    >;
    try {
      staged = await input.holdingImports.stageRobinhoodHoldingImport(
        input.accessSubject,
        {
          objectKey: stagedObjectKey,
          sha256: await sha256Bytes(holdings.bytes),
          byteSize: holdings.bytes.byteLength,
          normalizedFingerprint: normalized.normalizedFingerprint,
          effectiveDate: normalized.effectiveDate,
          retrievedAt,
          rows: normalized.rows,
        },
      );
    } catch {
      throw new PlaidClientError(
        "staging_failed",
        "Keel could not prepare the Robinhood update for review.",
      );
    }
    if (!staged.created) {
      await input.env.DOCUMENTS.delete(stagedObjectKey).catch(() => undefined);
      stagedObjectKey = null;
    } else {
      // The holding import now owns this private object. Never delete it during
      // later sync-run bookkeeping failures.
      stagedObjectKey = null;
    }
    await input.repository.completeSync(input.accessSubject, run.id, {
      discoveredCount: normalized.rows.length,
      proposedCount: staged.created ? normalized.rows.length : 0,
      importId: staged.created ? staged.preview.id : null,
    });
    return input.repository.getStatus(input.accessSubject, true);
  } catch (error) {
    if (stagedObjectKey !== null) {
      await input.env.DOCUMENTS.delete(stagedObjectKey).catch(() => undefined);
    }
    const code = syncErrorCode(error);
    await input.repository.failSync(input.accessSubject, run.id, code);
    throw error;
  }
}
