import {
  normalizeRobinhoodHoldings,
  plaidInvestmentSecurityIdentity,
  plaidInvestmentStrongSecurityIdentifier,
  PlaidInvestmentsHoldingsResponseSchema,
  type PlaidInvestmentsHoldingsResponse,
} from "@keel/connectors";
import type {
  D1HoldingImportRepository,
  PortfolioBaselineRepository,
  PublicHoldingsRepository,
  RobinhoodImportAdjudication,
} from "@keel/database";
import {
  HoldingImportCanonicalScopeSchema,
  RobinhoodLinkTokenSchema,
  type HoldingImportCanonicalScope,
  type RobinhoodLinkToken,
  type RobinhoodSyncErrorCode,
  type RobinhoodSyncStatus,
} from "@keel/domain";
import { z } from "zod";

import {
  plaidInvestmentsAccountKey,
  plaidInvestmentsExposureKey,
  plaidInvestmentsPositionKey,
  plaidInvestmentsSourceKey,
} from "./investment-identity";
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
      | "holdings_incomplete"
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
  updateItemWebhook(accessToken: string): Promise<void>;
  getWebhookVerificationKey(
    keyId: string,
  ): Promise<PlaidWebhookVerificationKey>;
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
        webhook: this.config.webhookUrl,
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

  public async updateItemWebhook(accessToken: string): Promise<void> {
    const token = z.string().min(1).max(4_096).parse(accessToken);
    const response = await this.post(
      "/item/webhook/update",
      { access_token: token, webhook: this.config.webhookUrl },
      PlaidItemWebhookUpdateResponseSchema,
    );
    if (response.item.webhook !== this.config.webhookUrl) {
      throw new PlaidClientError(
        "provider_unavailable",
        "Robinhood automatic updates could not be enabled.",
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
      throw new PlaidClientError(
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
      await plaidInvestmentsSourceKey(input.env, credential.itemId),
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

export async function disconnectRobinhood(input: {
  env: Env;
  repository: PublicHoldingsRepository;
  client: PlaidInvestmentsClient;
  accessSubject: string;
}): Promise<RobinhoodSyncStatus> {
  const connection = await input.repository.getConnection(input.accessSubject);
  if (connection === null) {
    const status = await input.repository.getStatus(input.accessSubject, true);
    if (status.status === "disconnected") {
      return status;
    }
    throw new PlaidClientError(
      "connection_invalid",
      "Robinhood is no longer connected.",
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
  return input.repository.getStatus(input.accessSubject, true);
}

function syncErrorCode(error: unknown): RobinhoodSyncErrorCode {
  if (error instanceof PlaidClientError) {
    return error.code;
  }
  return "unexpected_failure";
}

async function refreshPortfolioBaseline(input: {
  repository:
    Pick<PortfolioBaselineRepository, "getState" | "confirm"> | undefined;
  accessSubject: string;
  adjudication: RobinhoodImportAdjudication;
}): Promise<{
  status: "not_needed" | "refreshed" | "manual_required";
  baselineId: string | null;
}> {
  if (
    input.repository === undefined ||
    input.adjudication.autoAppliedCount === 0
  ) {
    return { status: "not_needed", baselineId: null };
  }
  try {
    const state = await input.repository.getState(input.accessSubject);
    if (
      state.status !== "ready" ||
      state.latestBaseline === null ||
      state.hasCashAccountChanges ||
      state.requiresDuplicateReview ||
      state.requiresCashOverlapReview ||
      state.sourceRevision === null ||
      state.baseForecastSnapshotId === null ||
      state.baseForecastSnapshotVersion === null
    ) {
      return {
        status: state.status === "current" ? "not_needed" : "manual_required",
        baselineId: null,
      };
    }
    const result = await input.repository.confirm(input.accessSubject, {
      sourceRevision: state.sourceRevision,
      baseForecastSnapshotId: state.baseForecastSnapshotId,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor:
        state.latestBaseline.otherFiEligibleLiquidMinor,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Robinhood holdings refreshed automatically.",
    });
    return { status: "refreshed", baselineId: result.baseline.id };
  } catch {
    return { status: "manual_required", baselineId: null };
  }
}

function robinhoodContainerPresentation(subtype: string | null): {
  displayLabel: string;
  containerKind: "brokerage" | "ira";
  taxTreatment: "taxable" | "tax_deferred" | "tax_exempt";
} {
  const normalized = subtype?.trim().toLowerCase() ?? "";
  if (normalized.includes("roth")) {
    return {
      displayLabel: "Robinhood Roth IRA",
      containerKind: "ira",
      taxTreatment: "tax_exempt",
    };
  }
  if (normalized.includes("ira")) {
    return {
      displayLabel: "Robinhood IRA",
      containerKind: "ira",
      taxTreatment: "tax_deferred",
    };
  }
  return {
    displayLabel: "Robinhood brokerage",
    containerKind: "brokerage",
    taxTreatment: "taxable",
  };
}

export async function buildRobinhoodCanonicalScope(input: {
  env: Env;
  connectionId: string;
  expectedSourceKey: string;
  response: PlaidInvestmentsHoldingsResponse;
}): Promise<HoldingImportCanonicalScope> {
  const observedSourceKey = await plaidInvestmentsSourceKey(
    input.env,
    input.response.item.item_id,
  );
  if (observedSourceKey !== input.expectedSourceKey) {
    throw new Error("Plaid returned holdings for a different Item.");
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
        ...robinhoodContainerPresentation(account.subtype),
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

export async function syncRobinhood(input: {
  env: Env;
  repository: PublicHoldingsRepository;
  holdingImports: Pick<
    D1HoldingImportRepository,
    "stageRobinhoodHoldingImport" | "autoAdjudicateRobinhoodHoldingImport"
  >;
  portfolioBaselines?: Pick<
    PortfolioBaselineRepository,
    "getState" | "confirm"
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
    let canonicalScope: HoldingImportCanonicalScope;
    try {
      if (run.connection.providerAccountKey === null) {
        throw new Error("Canonical Plaid Item identity is unavailable.");
      }
      canonicalScope = await buildRobinhoodCanonicalScope({
        env: input.env,
        connectionId: run.connection.investmentConnectionId,
        expectedSourceKey: run.connection.providerAccountKey,
        response: holdings.parsed,
      });
    } catch {
      throw new PlaidClientError(
        "holdings_incomplete",
        "Robinhood did not return complete account coverage. Prior accepted positions were preserved.",
      );
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
          canonicalScope,
        },
      );
    } catch {
      throw new PlaidClientError(
        "staging_failed",
        "Keel could not safely prepare the Robinhood update.",
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
    const adjudication =
      staged.created || staged.preview.status !== "applied"
        ? await input.holdingImports.autoAdjudicateRobinhoodHoldingImport(
            input.accessSubject,
            staged.preview.id,
          )
        : null;
    const baselineRefresh =
      adjudication === null
        ? { status: "not_needed" as const, baselineId: null }
        : await refreshPortfolioBaseline({
            repository: input.portfolioBaselines,
            accessSubject: input.accessSubject,
            adjudication,
          });
    await input.repository.completeSync(input.accessSubject, run.id, {
      discoveredCount: normalized.rows.length,
      proposedCount: staged.created ? normalized.rows.length : 0,
      importId: adjudication === null ? null : staged.preview.id,
      adjudication:
        adjudication === null
          ? null
          : {
              policyVersion: adjudication.policyVersion,
              autoAppliedCount: adjudication.autoAppliedCount,
              quarantinedCount: adjudication.quarantinedCount,
              preservedPositionCount: adjudication.preservedPositionCount,
              baselineRefreshStatus: baselineRefresh.status,
              portfolioBaselineId: baselineRefresh.baselineId,
            },
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
