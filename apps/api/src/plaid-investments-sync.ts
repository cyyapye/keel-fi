import {
  normalizePlaidInvestmentsHoldings,
  plaidInvestmentAccountPresentation,
  plaidInvestmentSecurityIdentity,
  plaidInvestmentStrongSecurityIdentifier,
  PlaidInvestmentsHoldingsResponseSchema,
  type PlaidInvestmentsHoldingsResponse,
} from "@keel/connectors";
import { refreshAcceptedPortfolioBaseline } from "@keel/database";
import type {
  D1HoldingImportRepository,
  PortfolioBaselineRepository,
  InvestmentConnectionsRepository,
  InvestmentSyncRun,
} from "@keel/database";
import {
  HoldingImportCanonicalScopeSchema,
  InvestmentLinkTokenSchema,
  type HoldingImportCanonicalScope,
  type InvestmentLinkToken,
  type InvestmentSyncErrorCode,
  type InvestmentConnectionStatus,
  type InvestmentConnectionsState,
} from "@keel/domain";
import { z } from "zod";

import {
  plaidInvestmentsAccountKey,
  plaidInvestmentsExposureKey,
  plaidInvestmentsPositionKey,
  plaidInvestmentsSourceKey,
} from "./investment-identity";
import type { Env } from "./types";
import {
  D1RetainedPublicExposureReconciler,
  type RetainedPublicExposureReconciler,
} from "./retained-public-exposure";

const MAX_PLAID_RESPONSE_BYTES = 5 * 1_048_576;
const PLAID_REQUEST_TIMEOUT_MS = 15_000;

const PlaidConfigurationSchema = z
  .object({
    clientId: z.string().min(1).max(512),
    secret: z.string().min(1).max(512),
    environment: z.enum(["sandbox", "production"]),
    credentialKey: z.string().min(1).max(256),
    redirectUri: z.url().max(2_048),
    webhookUrl: z
      .url()
      .max(2_048)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.username === "" &&
          url.password === "" &&
          url.port === "" &&
          url.pathname === "/webhooks/plaid" &&
          url.search === "" &&
          url.hash === ""
        );
      }),
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

// Price dates are not ownership freshness. Keep the original Item status pair
// as evidence and require a stable, successful Investments update around the read.
export const PlaidInvestmentStatusSchema = z
  .object({
    item: z
      .object({
        item_id: z.string().min(1).max(512),
        institution_id: z.string().min(1).max(512).nullable(),
        error: z
          .object({ error_code: z.string().min(1).max(512) })
          .passthrough()
          .nullable(),
      })
      .passthrough(),
    status: z
      .object({
        investments: z
          .object({
            last_successful_update: z.iso.datetime({ offset: true }).nullable(),
            last_failed_update: z.iso.datetime({ offset: true }).nullable(),
          })
          .passthrough()
          .nullable(),
      })
      .passthrough()
      .nullable(),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();
type InvestmentStatus = z.infer<typeof PlaidInvestmentStatusSchema>;

const PlaidItemWebhookUpdateResponseSchema = z
  .object({
    item: z.object({ webhook: z.url().max(2_048).nullable() }).passthrough(),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

export const PlaidWebhookVerificationKeySchema = z
  .object({
    alg: z.literal("ES256"),
    crv: z.literal("P-256"),
    kid: z.string().min(1).max(512),
    kty: z.literal("EC"),
    use: z.literal("sig"),
    x: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    y: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    created_at: z.number().int().nonnegative(),
    expired_at: z.number().int().nonnegative().nullable(),
  })
  .strict();

const PlaidWebhookVerificationKeyResponseSchema = z
  .object({
    key: PlaidWebhookVerificationKeySchema,
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

export type PlaidWebhookVerificationKey = z.infer<
  typeof PlaidWebhookVerificationKeySchema
>;

const PlaidInstitutionResponseSchema = z
  .object({
    institution: z
      .object({
        institution_id: z.string().min(1).max(200),
        name: z.string().min(1).max(512),
        products: z.array(z.string().min(1).max(128)).max(100),
      })
      .passthrough(),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

const InvestmentCredentialSchema = z
  .object({
    version: z.literal(1),
    accessToken: z.string().min(1).max(4_096),
    itemId: z.string().min(1).max(512),
    institutionKey: z.string().min(1).max(200),
    institutionLabel: z.string().min(1).max(512),
  })
  .strict();

const LegacyRobinhoodCredentialSchema = z
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

type InvestmentCredential = z.infer<typeof InvestmentCredentialSchema>;

export class PlaidInvestmentsClientError extends Error {
  public constructor(
    public readonly code:
      | "configuration_required"
      | "connection_invalid"
      | "provider_unavailable"
      | "response_invalid"
      | "holdings_incomplete"
      | "staging_failed",
    message: string,
  ) {
    super(message);
    this.name = "PlaidInvestmentsClientError";
  }
}

export interface PlaidInvestmentsClient {
  createLinkToken(
    clientUserId: string,
    accessToken?: string,
  ): Promise<InvestmentLinkToken>;
  exchangeInvestmentToken(publicToken: string): Promise<InvestmentCredential>;
  removeItem(accessToken: string): Promise<void>;
  updateItemWebhook(accessToken: string): Promise<void>;
  getWebhookVerificationKey(
    keyId: string,
  ): Promise<PlaidWebhookVerificationKey>;
  getInvestmentStatus(
    accessToken: string,
  ): Promise<{ bytes: Uint8Array; parsed: InvestmentStatus }>;
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
    webhookUrl: env.PLAID_WEBHOOK_URL,
  });
  if (!parsed.success) {
    throw new PlaidInvestmentsClientError(
      "configuration_required",
      "Investment sync is not configured.",
    );
  }
  try {
    if (base64UrlDecode(parsed.data.credentialKey).byteLength !== 32) {
      throw new Error("invalid key");
    }
  } catch {
    throw new PlaidInvestmentsClientError(
      "configuration_required",
      "Investment sync is not configured.",
    );
  }
  return parsed.data;
}

export function investmentsSyncConfigured(env: Env): boolean {
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
  rawCredential: InvestmentCredential,
  accessSubject: string,
  objectKey: string,
): Promise<Uint8Array> {
  const credential = InvestmentCredentialSchema.parse(rawCredential);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credential));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedArrayBuffer(iv),
      additionalData: ownedArrayBuffer(
        new TextEncoder().encode(
          JSON.stringify([
            "plaid-investments-credential-v1",
            accessSubject,
            objectKey,
          ]),
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
): Promise<Pick<InvestmentCredential, "accessToken" | "itemId">> {
  let envelope: z.infer<typeof EncryptedCredentialSchema>;
  try {
    envelope = EncryptedCredentialSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encrypted)),
    );
  } catch {
    throw new PlaidInvestmentsClientError(
      "connection_invalid",
      "Reconnect this institution to continue syncing.",
    );
  }
  const key = await credentialKey(env);
  const decryptWithContext = async (context: string): Promise<unknown> => {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ownedArrayBuffer(base64UrlDecode(envelope.iv)),
        additionalData: ownedArrayBuffer(
          new TextEncoder().encode(
            JSON.stringify([context, accessSubject, objectKey]),
          ),
        ),
      },
      key,
      ownedArrayBuffer(base64UrlDecode(envelope.ciphertext)),
    );
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
    );
  };
  try {
    return InvestmentCredentialSchema.parse(
      await decryptWithContext("plaid-investments-credential-v1"),
    );
  } catch {
    try {
      return LegacyRobinhoodCredentialSchema.parse(
        await decryptWithContext("robinhood-credential-v1"),
      );
    } catch {
      throw new PlaidInvestmentsClientError(
        "connection_invalid",
        "Reconnect this institution to continue syncing.",
      );
    }
  }
}

async function readR2Bytes(object: R2ObjectBody): Promise<Uint8Array> {
  const buffer = await object.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > 16_384) {
    throw new PlaidInvestmentsClientError(
      "connection_invalid",
      "Reconnect this institution to continue syncing.",
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
  maxBytes = MAX_PLAID_RESPONSE_BYTES,
): Promise<Uint8Array> {
  if (response.body === null) {
    throw new PlaidInvestmentsClientError(
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
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PlaidInvestmentsClientError(
          "response_invalid",
          "Plaid returned an oversized response.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PlaidInvestmentsClientError) {
      throw error;
    }
    throw new PlaidInvestmentsClientError(
      "provider_unavailable",
      "Investment sync is temporarily unavailable.",
    );
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) {
    throw new PlaidInvestmentsClientError(
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
    rawAccessToken?: string,
  ): Promise<InvestmentLinkToken> {
    const accessToken =
      rawAccessToken === undefined
        ? undefined
        : z.string().min(1).max(4_096).parse(rawAccessToken);
    const response = await this.post(
      "/link/token/create",
      {
        client_name: "Keel",
        country_codes: ["US"],
        language: "en",
        redirect_uri: this.config.redirectUri,
        user: { client_user_id: await sha256(clientUserId) },
        ...(accessToken === undefined
          ? {
              products: ["investments"],
              webhook: this.config.webhookUrl,
              account_filters: {
                investment: { account_subtypes: ["all"] },
              },
            }
          : { access_token: accessToken }),
      },
      PlaidLinkTokenResponseSchema,
    );
    return InvestmentLinkTokenSchema.parse({
      linkToken: response.link_token,
      expiration: response.expiration,
    });
  }

  public async exchangeInvestmentToken(
    publicToken: string,
  ): Promise<InvestmentCredential> {
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
        throw new PlaidInvestmentsClientError(
          "connection_invalid",
          "Choose an institution that supports Investments.",
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
        item.item.item_id !== exchange.item_id ||
        institution.institution.institution_id !== item.item.institution_id ||
        !institution.institution.products.some(
          (product) => product.trim().toLowerCase() === "investments",
        )
      ) {
        throw new PlaidInvestmentsClientError(
          "connection_invalid",
          "The selected institution does not support Investments.",
        );
      }
      return InvestmentCredentialSchema.parse({
        version: 1,
        accessToken: exchange.access_token,
        itemId: exchange.item_id,
        institutionKey: institution.institution.institution_id,
        institutionLabel: institution.institution.name,
      });
    } catch (error) {
      await this.removeItem(exchange.access_token);
      throw error;
    }
  }

  public async getInvestmentStatus(
    accessToken: string,
  ): Promise<{ bytes: Uint8Array; parsed: InvestmentStatus }> {
    const bytes = await this.request(
      "/item/get",
      { access_token: z.string().min(1).max(4096).parse(accessToken) },
      32768,
    );
    try {
      return {
        bytes,
        parsed: PlaidInvestmentStatusSchema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        ),
      };
    } catch {
      throw new PlaidInvestmentsClientError(
        "holdings_incomplete",
        "The institution did not establish a current, complete holdings report. Previous holdings are unchanged.",
      );
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
      throw new PlaidInvestmentsClientError(
        "response_invalid",
        "The institution returned an unreadable holdings response.",
      );
    }
    const parsed = PlaidInvestmentsHoldingsResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new PlaidInvestmentsClientError(
        "response_invalid",
        "The institution returned an unsupported holdings response.",
      );
    }
    return { bytes: response, parsed: parsed.data };
  }

  public async updateItemWebhook(accessToken: string): Promise<void> {
    const token = z.string().min(1).max(4_096).parse(accessToken);
    const response = await this.post(
      "/item/webhook/update",
      { access_token: token, webhook: this.config.webhookUrl },
      PlaidItemWebhookUpdateResponseSchema,
    );
    if (response.item.webhook !== this.config.webhookUrl) {
      throw new PlaidInvestmentsClientError(
        "provider_unavailable",
        "Investment automatic updates could not be enabled.",
      );
    }
  }

  public async getWebhookVerificationKey(
    rawKeyId: string,
  ): Promise<PlaidWebhookVerificationKey> {
    const keyId = z.string().min(1).max(512).parse(rawKeyId);
    const response = await this.post(
      "/webhook_verification_key/get",
      { key_id: keyId },
      PlaidWebhookVerificationKeyResponseSchema,
    );
    if (response.key.kid !== keyId) {
      throw new PlaidInvestmentsClientError(
        "response_invalid",
        "Plaid returned an unsupported verification key.",
      );
    }
    return response.key;
  }

  public async removeItem(accessToken: string): Promise<void> {
    await this.request("/item/remove", { access_token: accessToken });
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
      throw new PlaidInvestmentsClientError(
        "response_invalid",
        "Plaid returned an unreadable response.",
      );
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      throw new PlaidInvestmentsClientError(
        "response_invalid",
        "Plaid returned an unsupported response.",
      );
    }
    return parsed.data;
  }

  private async request(
    path: string,
    body: unknown,
    maxBytes = MAX_PLAID_RESPONSE_BYTES,
  ): Promise<Uint8Array> {
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
      throw new PlaidInvestmentsClientError(
        "provider_unavailable",
        "Investment sync is temporarily unavailable.",
      );
    }
    const contentLength = response.headers.get("Content-Length");
    if (
      contentLength !== null &&
      (/^\d+$/u.test(contentLength) === false ||
        BigInt(contentLength) > BigInt(maxBytes))
    ) {
      throw new PlaidInvestmentsClientError(
        "response_invalid",
        "Plaid returned an oversized response.",
      );
    }
    const bytes = await readBoundedPlaidResponse(response, maxBytes);
    if (!response.ok) {
      throw new PlaidInvestmentsClientError(
        response.status === 400 || response.status === 401
          ? "connection_invalid"
          : "provider_unavailable",
        response.status === 400 || response.status === 401
          ? "Reconnect this institution to continue syncing."
          : "Investment sync is temporarily unavailable.",
      );
    }
    return bytes;
  }
}

export function createPlaidInvestmentsClient(env: Env): PlaidInvestmentsClient {
  return new FetchPlaidInvestmentsClient(configuration(env));
}

export async function connectInvestmentConnection(input: {
  env: Env;
  repository: InvestmentConnectionsRepository;
  client: PlaidInvestmentsClient;
  accessSubject: string;
  publicToken: string;
}): Promise<InvestmentConnectionStatus> {
  const credential = await input.client.exchangeInvestmentToken(
    input.publicToken,
  );
  const objectKey = `connector-secrets/${crypto.randomUUID()}.json.enc`;
  let connectionId: string;
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
      await plaidInvestmentsSourceKey(input.env, credential.itemId),
      credential.institutionKey,
      credential.institutionLabel,
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
      .removeItem(credential.accessToken)
      .catch(() => undefined);
    throw error;
  }
  return input.repository.getConnectionStatus(
    input.accessSubject,
    connectionId,
  );
}

export async function createInvestmentReconnectLinkToken(input: {
  env: Env;
  repository: InvestmentConnectionsRepository;
  client: PlaidInvestmentsClient;
  accessSubject: string;
  connectionId: string;
}): Promise<InvestmentLinkToken> {
  const connection = await input.repository.getConnection(
    input.accessSubject,
    input.connectionId,
    true,
  );
  if (connection === null) {
    throw new PlaidInvestmentsClientError(
      "connection_invalid",
      "Reconnect this institution to continue syncing.",
    );
  }
  const encrypted = await input.env.DOCUMENTS.get(connection.secretReference);
  if (encrypted === null) {
    throw new PlaidInvestmentsClientError(
      "connection_invalid",
      "Reconnect this institution to continue syncing.",
    );
  }
  const credential = await decryptCredential(
    input.env,
    await readR2Bytes(encrypted),
    input.accessSubject,
    connection.secretReference,
  );
  return input.client.createLinkToken(
    input.accessSubject,
    credential.accessToken,
  );
}

export async function disconnectInvestmentConnection(input: {
  env: Env;
  repository: InvestmentConnectionsRepository;
  client: PlaidInvestmentsClient;
  accessSubject: string;
  connectionId: string;
}): Promise<InvestmentConnectionStatus> {
  const connection = await input.repository.getConnection(
    input.accessSubject,
    input.connectionId,
    true,
  );
  if (connection === null) {
    return input.repository.getConnectionStatus(
      input.accessSubject,
      input.connectionId,
    );
  }

  const encrypted = await input.env.DOCUMENTS.get(connection.secretReference);
  if (encrypted !== null) {
    const credential = await decryptCredential(
      input.env,
      await readR2Bytes(encrypted),
      input.accessSubject,
      connection.secretReference,
    );
    await input.client.removeItem(credential.accessToken);
  }
  await input.repository.disconnectConnection(
    input.accessSubject,
    connection.id,
  );
  await input.env.DOCUMENTS.delete(connection.secretReference);
  return input.repository.getConnectionStatus(
    input.accessSubject,
    input.connectionId,
  );
}

function syncErrorCode(error: unknown): InvestmentSyncErrorCode {
  if (error instanceof PlaidInvestmentsClientError) {
    return error.code;
  }
  return "unexpected_failure";
}

async function refreshPortfolioBaseline(input: {
  repository:
    Pick<PortfolioBaselineRepository, "getState" | "confirm"> | undefined;
  accessSubject: string;
}): Promise<{
  status: "not_needed" | "refreshed" | "manual_required";
  baselineId: string | null;
}> {
  if (input.repository === undefined) {
    return { status: "not_needed", baselineId: null };
  }
  try {
    return await refreshAcceptedPortfolioBaseline(
      input.repository,
      input.accessSubject,
    );
  } catch {
    return { status: "manual_required", baselineId: null };
  }
}

export async function buildPlaidInvestmentsCanonicalScope(input: {
  env: Env;
  connectionId: string;
  expectedSourceKey: string;
  institutionKey: string;
  institutionLabel: string;
  response: PlaidInvestmentsHoldingsResponse;
}): Promise<HoldingImportCanonicalScope> {
  const observedSourceKey = await plaidInvestmentsSourceKey(
    input.env,
    input.response.item.item_id,
  );
  if (observedSourceKey !== input.expectedSourceKey) {
    throw new Error("Plaid returned holdings for a different Item.");
  }
  if (input.response.item.institution_id !== input.institutionKey) {
    throw new Error("Plaid returned holdings for a different institution.");
  }
  if (input.response.accounts.length === 0) {
    throw new Error("Plaid returned no investment account coverage.");
  }

  const accountScopes = await Promise.all(
    input.response.accounts.map(async (account) => {
      if (account.type.trim().toLowerCase() !== "investment") {
        throw new Error("Plaid returned a non-investment account.");
      }
      const protectedAccountKey = await plaidInvestmentsAccountKey(
        input.env,
        observedSourceKey,
        account.persistent_account_id ?? account.account_id,
      );
      return {
        account,
        protectedAccountKey,
        ...plaidInvestmentAccountPresentation({
          institutionLabel: input.institutionLabel,
          subtype: account.subtype,
        }),
      };
    }),
  );
  if (
    new Set(accountScopes.map((scope) => scope.protectedAccountKey)).size !==
    accountScopes.length
  ) {
    throw new Error("Plaid returned duplicate investment account identities.");
  }

  const accountScopesByProviderId = new Map(
    accountScopes.map((scope) => [scope.account.account_id, scope]),
  );
  const securitiesByProviderId = new Map(
    input.response.securities.map((security) => [
      security.security_id,
      security,
    ]),
  );
  const rows = await Promise.all(
    input.response.holdings.map(async (holding, index) => {
      const accountScope = accountScopesByProviderId.get(holding.account_id);
      const security = securitiesByProviderId.get(holding.security_id);
      if (accountScope === undefined || security === undefined) {
        throw new Error("Plaid holding scope could not be resolved.");
      }
      const strongIdentifier =
        plaidInvestmentStrongSecurityIdentifier(security);
      return {
        sourceRowNumber: index + 1,
        protectedAccountKey: accountScope.protectedAccountKey,
        protectedPositionKey: await plaidInvestmentsPositionKey(
          input.env,
          accountScope.protectedAccountKey,
          plaidInvestmentSecurityIdentity(security),
        ),
        publicExposureIdentityKind: strongIdentifier?.kind ?? null,
        protectedExposureKey:
          strongIdentifier === null
            ? null
            : await plaidInvestmentsExposureKey(
                input.env,
                strongIdentifier.kind,
                strongIdentifier.value,
              ),
      };
    }),
  );

  return HoldingImportCanonicalScopeSchema.parse({
    connection: { mode: "existing", connectionId: input.connectionId },
    containers: accountScopes.map((scope) => ({
      protectedAccountKey: scope.protectedAccountKey,
      displayLabel: scope.displayLabel,
      containerKind: scope.containerKind,
      taxTreatment: scope.taxTreatment,
      completeness: "complete",
    })),
    rows,
  });
}

type InvestmentSyncDependencies = {
  env: Env;
  exposureReconciler?: RetainedPublicExposureReconciler;
  repository: InvestmentConnectionsRepository;
  holdingImports: Pick<
    D1HoldingImportRepository,
    | "stagePlaidInvestmentsHoldingImport"
    | "autoAdjudicatePlaidInvestmentsHoldingImport"
  >;
  portfolioBaselines?: Pick<
    PortfolioBaselineRepository,
    "getState" | "confirm"
  >;
  client: PlaidInvestmentsClient;
  accessSubject: string;
};

type InvestmentConnectionSyncInput = InvestmentSyncDependencies & {
  connectionId: string;
};

export function certifyInventoryStatus(
  before: InvestmentStatus,
  after: InvestmentStatus,
  credential: {
    itemId: string;
    institutionKey?: string;
    institutionId?: string;
  },
  retrievedAt: string,
): string {
  const first = before.status?.investments;
  const last = after.status?.investments;
  const success = first?.last_successful_update;
  const valid = [before, after].every(
    (value) =>
      value.item.item_id === credential.itemId &&
      value.item.institution_id ===
        (credential.institutionKey ?? credential.institutionId) &&
      value.item.error === null,
  );
  if (
    !valid ||
    !success ||
    !last?.last_successful_update ||
    Date.parse(success) !== Date.parse(last.last_successful_update) ||
    Date.parse(success) > Date.parse(retrievedAt) ||
    [first?.last_failed_update, last.last_failed_update].some(
      (failed) => failed && Date.parse(failed) >= Date.parse(success),
    )
  ) {
    throw new PlaidInvestmentsClientError(
      "holdings_incomplete",
      "The institution did not establish a current, complete holdings report. Previous holdings are unchanged.",
    );
  }
  return new Date(success).toISOString();
}

async function executeInvestmentConnectionSync(
  input: InvestmentSyncDependencies,
  run: InvestmentSyncRun,
): Promise<InvestmentConnectionStatus> {
  let stagedObjectKey: string | null = null;
  let stagedStatusKey: string | null = null;
  let stagingAttempted = false;
  try {
    const encrypted = await input.env.DOCUMENTS.get(
      run.connection.secretReference,
    );
    if (encrypted === null) {
      throw new PlaidInvestmentsClientError(
        "connection_invalid",
        "Reconnect this institution to continue syncing.",
      );
    }
    const credential = await decryptCredential(
      input.env,
      await readR2Bytes(encrypted),
      input.accessSubject,
      run.connection.secretReference,
    );
    const before = await input.client.getInvestmentStatus(
      credential.accessToken,
    );
    const holdings = await input.client.getHoldings(credential.accessToken);
    const after = await input.client.getInvestmentStatus(
      credential.accessToken,
    );
    const retrievedAt = new Date().toISOString();
    const sourceUpdatedAt = certifyInventoryStatus(
      before.parsed,
      after.parsed,
      credential,
      retrievedAt,
    );
    let normalized: Awaited<
      ReturnType<typeof normalizePlaidInvestmentsHoldings>
    >;
    try {
      normalized = await normalizePlaidInvestmentsHoldings(
        holdings.parsed,
        sourceUpdatedAt,
        run.connection.institutionLabel,
      );
    } catch {
      throw new PlaidInvestmentsClientError(
        "response_invalid",
        "The institution returned an unsupported holdings response.",
      );
    }
    let canonicalScope: HoldingImportCanonicalScope;
    try {
      if (run.connection.providerAccountKey === null) {
        throw new Error("Canonical Plaid Item identity is unavailable.");
      }
      canonicalScope = await buildPlaidInvestmentsCanonicalScope({
        env: input.env,
        connectionId: run.connection.id,
        expectedSourceKey: run.connection.providerAccountKey,
        institutionKey: run.connection.institutionKey,
        institutionLabel: run.connection.institutionLabel,
        response: holdings.parsed,
      });
    } catch {
      throw new PlaidInvestmentsClientError(
        "holdings_incomplete",
        "The institution did not return complete account coverage. Prior accepted positions were preserved.",
      );
    }

    const zeroAccountBalance = z
      .object({
        balances: z
          .object({
            current: z.union([
              z.literal(0),
              z.string().regex(/^0+(?:\.0+)?$/u),
            ]),
            iso_currency_code: z.literal("USD"),
            unofficial_currency_code: z.null(),
          })
          .passthrough(),
      })
      .passthrough();
    const zeroCashAccountKeys = (
      await Promise.all(
        holdings.parsed.accounts
          .filter(
            (account) =>
              !holdings.parsed.holdings.some(
                (holding) => holding.account_id === account.account_id,
              ) && zeroAccountBalance.safeParse(account).success,
          )
          .map((account) =>
            plaidInvestmentsAccountKey(
              input.env,
              run.connection.providerAccountKey!,
              account.persistent_account_id ?? account.account_id,
            ),
          ),
      )
    ).sort();
    stagedObjectKey = `holding-imports/${crypto.randomUUID()}.json`;
    stagedStatusKey = `holding-imports/${crypto.randomUUID()}-status.json`;
    const rawSha256 = await sha256Bytes(holdings.bytes);
    const statusBytes = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        retrievedAt,
        holdings: {
          objectKey: stagedObjectKey,
          sha256: rawSha256,
          byteSize: holdings.bytes.byteLength,
        },
        before: JSON.parse(new TextDecoder().decode(before.bytes)) as unknown,
        after: JSON.parse(new TextDecoder().decode(after.bytes)) as unknown,
      }),
    );
    if (statusBytes.byteLength > 131072)
      throw new PlaidInvestmentsClientError(
        "holdings_incomplete",
        "The holdings status evidence is too large. Previous holdings are unchanged.",
      );
    await input.env.DOCUMENTS.put(stagedStatusKey, statusBytes, {
      httpMetadata: { contentType: "application/json" },
    });
    await input.env.DOCUMENTS.put(stagedObjectKey, holdings.bytes, {
      httpMetadata: { contentType: "application/json" },
    });
    let staged: Awaited<
      ReturnType<
        D1HoldingImportRepository["stagePlaidInvestmentsHoldingImport"]
      >
    >;
    try {
      stagingAttempted = true;
      staged = await input.holdingImports.stagePlaidInvestmentsHoldingImport(
        input.accessSubject,
        {
          objectKey: stagedObjectKey,
          sha256: rawSha256,
          byteSize: holdings.bytes.byteLength,
          normalizedFingerprint: await sha256(
            JSON.stringify([
              "plaid-inventory-capture-v1",
              normalized.normalizedFingerprint,
              sourceUpdatedAt,
              canonicalScope.containers
                .map((container) => container.protectedAccountKey)
                .sort(),
              zeroCashAccountKeys,
            ]),
          ),
          inventoryEvidence: {
            sourceUpdatedAt,
            zeroCashAccountKeys,
            objectKey: stagedStatusKey,
            sha256: await sha256Bytes(statusBytes),
            byteSize: statusBytes.byteLength,
          },
          effectiveDate: normalized.effectiveDate,
          retrievedAt,
          rows: normalized.rows,
          canonicalScope,
        },
      );
    } catch {
      throw new PlaidInvestmentsClientError(
        "staging_failed",
        "Keel could not safely prepare the investment update.",
      );
    }
    if (!staged.created) {
      await input.env.DOCUMENTS.delete(stagedObjectKey).catch(() => undefined);
      await input.env.DOCUMENTS.delete(stagedStatusKey).catch(() => undefined);
      stagedObjectKey = null;
      stagedStatusKey = null;
    } else {
      // The holding import now owns this private object. Never delete it during
      // later sync-run bookkeeping failures.
      stagedObjectKey = null;
      stagedStatusKey = null;
    }
    // Re-enter idempotent acceptance on identical reports as well: a prior
    // attempt may have committed acceptance before grouping or planning failed.
    const adjudication =
      await input.holdingImports.autoAdjudicatePlaidInvestmentsHoldingImport(
        input.accessSubject,
        staged.preview.id,
      );
    await (
      input.exposureReconciler ??
      new D1RetainedPublicExposureReconciler(input.env)
    ).reconcile(input.accessSubject, staged.preview.id);
    const baselineRefresh = await refreshPortfolioBaseline({
      repository: input.portfolioBaselines,
      accessSubject: input.accessSubject,
    });
    await input.repository.completeSync(input.accessSubject, run.id, {
      discoveredCount: normalized.rows.length,
      proposedCount: staged.created ? normalized.rows.length : 0,
      importId: staged.preview.id,
      adjudication: {
        policyVersion: adjudication.policyVersion,
        autoAppliedCount: adjudication.autoAppliedCount,
        quarantinedCount: adjudication.quarantinedCount,
        preservedPositionCount: adjudication.preservedPositionCount,
        baselineRefreshStatus: baselineRefresh.status,
        portfolioBaselineId: baselineRefresh.baselineId,
      },
    });
    return input.repository.getConnectionStatus(
      input.accessSubject,
      run.connection.id,
    );
  } catch (error) {
    // A failed status/readback does not prove the atomic stage rolled back.
    // Preserve potentially owned evidence instead of deleting it on an uncertain response.
    if (!stagingAttempted && stagedObjectKey !== null) {
      await input.env.DOCUMENTS.delete(stagedObjectKey).catch(() => undefined);
    }
    if (!stagingAttempted && stagedStatusKey !== null)
      await input.env.DOCUMENTS.delete(stagedStatusKey).catch(() => undefined);
    const code = syncErrorCode(error);
    await input.repository.failSync(input.accessSubject, run.id, code);
    throw error;
  }
}

export async function syncInvestmentConnection(
  input: InvestmentConnectionSyncInput,
): Promise<InvestmentConnectionStatus> {
  if (
    (await input.repository.getConnection(
      input.accessSubject,
      input.connectionId,
    )) === null
  ) {
    throw new PlaidInvestmentsClientError(
      "connection_invalid",
      "Reconnect this institution to continue syncing.",
    );
  }
  const run = await input.repository.beginSync(
    input.accessSubject,
    input.connectionId,
  );
  if (!run.created) {
    return input.repository.getConnectionStatus(
      input.accessSubject,
      input.connectionId,
    );
  }

  return executeInvestmentConnectionSync(input, run);
}

const AUTOMATIC_INVESTMENT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1_000;

function isAutomaticInvestmentSyncEligible(
  connection: InvestmentConnectionStatus,
): boolean {
  return (
    connection.status === "ready" ||
    (connection.status === "needs_attention" &&
      connection.errorCode === "unexpected_failure")
  );
}

export function automaticInvestmentSyncCutoff(now: Date): string {
  return new Date(
    now.getTime() - AUTOMATIC_INVESTMENT_SYNC_INTERVAL_MS,
  ).toISOString();
}

async function syncDueInvestmentConnectionStatus(
  input: InvestmentSyncDependencies,
  connection: InvestmentConnectionStatus,
  syncedAfter: string,
): Promise<InvestmentConnectionStatus> {
  if (
    !isAutomaticInvestmentSyncEligible(connection) ||
    !connection.automaticUpdatesEnabled ||
    connection.latestImportId !== null ||
    (connection.lastSyncedAt !== null && connection.lastSyncedAt >= syncedAfter)
  ) {
    return connection;
  }
  const run = await input.repository.beginAutomaticSync(
    input.accessSubject,
    connection.connectionId,
    syncedAfter,
  );
  if (run === null) {
    return input.repository.getConnectionStatus(
      input.accessSubject,
      connection.connectionId,
    );
  }
  return executeInvestmentConnectionSync(input, run);
}

export async function syncDueInvestmentConnection(
  input: InvestmentConnectionSyncInput & { now?: Date },
): Promise<InvestmentConnectionStatus> {
  const now = input.now ?? new Date();
  const connection = await input.repository.getConnectionStatus(
    input.accessSubject,
    input.connectionId,
  );
  return syncDueInvestmentConnectionStatus(
    input,
    connection,
    automaticInvestmentSyncCutoff(now),
  );
}

export async function syncDueInvestmentConnections(
  input: InvestmentSyncDependencies & { now?: Date },
): Promise<InvestmentConnectionsState> {
  const state = await input.repository.getState(input.accessSubject, true);
  const now = input.now ?? new Date();
  const syncedAfter = automaticInvestmentSyncCutoff(now);
  const due = state.connections.filter(
    (connection) =>
      isAutomaticInvestmentSyncEligible(connection) &&
      connection.automaticUpdatesEnabled &&
      connection.latestImportId === null &&
      (connection.lastSyncedAt === null ||
        connection.lastSyncedAt < syncedAfter),
  );
  if (due.length === 0) return state;
  for (const connection of due) {
    await syncDueInvestmentConnectionStatus(
      input,
      connection,
      syncedAfter,
    ).catch(() => undefined);
  }
  return input.repository.getState(input.accessSubject, true);
}
