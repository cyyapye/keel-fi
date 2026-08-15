import {
  MAX_PLAID_TRANSACTION_MUTATIONS,
  normalizePlaidTransactionsSync,
  PlaidTransactionsSyncResponseSchema,
  type PlaidTransactionsSyncResponse,
} from "@keel/connectors";
import type { CashFlowRepository } from "@keel/database";
import {
  CashFlowErrorCodeSchema,
  type CashFlowErrorCode,
  type CashFlowState,
  type CashFlowSyncInput,
} from "@keel/domain";
import { z } from "zod";

import {
  cashAccountsConfigured,
  cashProviderKey,
  cashProviderScopedKey,
  loadCashCredential,
  plaidCashConfiguration,
  type PlaidCashConfiguration,
} from "./plaid-cash-sync";
import type { Env } from "./types";

const MAX_PLAID_TRANSACTION_RESPONSE_BYTES = 1_500_000;
const MAX_PLAID_TRANSACTION_TOTAL_BYTES = 10_000_000;
const MAX_PLAID_TRANSACTION_PAGES = 16;
const PLAID_REQUEST_TIMEOUT_MS = 15_000;

const PlaidErrorSchema = z
  .object({
    error_code: z.string().min(1).max(128),
  })
  .passthrough();

type ClientErrorCode = CashFlowErrorCode | "pagination_mutated";

export class PlaidCashFlowClientError extends Error {
  public constructor(
    public readonly code: ClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlaidCashFlowClientError";
  }
}

export interface PlaidCashFlowClient {
  syncTransactions(
    accessToken: string,
    startingCursor: string | null,
  ): Promise<readonly PlaidTransactionsSyncResponse[]>;
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  if (response.body === null) {
    throw new PlaidCashFlowClientError(
      "response_invalid",
      "Plaid returned an empty transaction response.",
    );
  }
  const contentLength = response.headers.get("Content-Length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) ||
      BigInt(contentLength) > BigInt(MAX_PLAID_TRANSACTION_RESPONSE_BYTES))
  ) {
    throw new PlaidCashFlowClientError(
      "response_invalid",
      "Plaid returned an oversized transaction response.",
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
      if (byteLength > MAX_PLAID_TRANSACTION_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PlaidCashFlowClientError(
          "response_invalid",
          "Plaid returned an oversized transaction response.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PlaidCashFlowClientError) {
      throw error;
    }
    throw new PlaidCashFlowClientError(
      "provider_unavailable",
      "Transaction data is temporarily unavailable.",
    );
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) {
    throw new PlaidCashFlowClientError(
      "response_invalid",
      "Plaid returned an empty transaction response.",
    );
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PlaidCashFlowClientError(
      "response_invalid",
      "Plaid returned an unreadable transaction response.",
    );
  }
}

function plaidErrorCode(raw: unknown): ClientErrorCode {
  const parsed = PlaidErrorSchema.safeParse(raw);
  if (!parsed.success) {
    return "provider_unavailable";
  }
  if (parsed.data.error_code === "PRODUCT_NOT_READY") {
    return "provider_not_ready";
  }
  if (
    parsed.data.error_code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
  ) {
    return "pagination_mutated";
  }
  if (
    parsed.data.error_code === "ITEM_LOGIN_REQUIRED" ||
    parsed.data.error_code === "INVALID_ACCESS_TOKEN"
  ) {
    return "connection_invalid";
  }
  return "provider_unavailable";
}

export class FetchPlaidCashFlowClient implements PlaidCashFlowClient {
  public constructor(
    private readonly config: PlaidCashConfiguration,
    private readonly fetcher: typeof fetch = (input, init) =>
      fetch(input, init),
  ) {}

  public async syncTransactions(
    accessToken: string,
    startingCursor: string | null,
  ): Promise<readonly PlaidTransactionsSyncResponse[]> {
    const token = z.string().min(1).max(4_096).parse(accessToken);
    const cursor = z
      .string()
      .min(1)
      .max(4_096)
      .nullable()
      .parse(startingCursor);
    const budget = { bytes: 0 };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const pages = await this.syncOnce(token, cursor, budget);
        if (
          pages.some(
            (page) =>
              page.transactions_update_status !== "HISTORICAL_UPDATE_COMPLETE",
          )
        ) {
          throw new PlaidCashFlowClientError(
            "provider_not_ready",
            "Plaid is still preparing transaction history.",
          );
        }
        return pages;
      } catch (error) {
        if (
          error instanceof PlaidCashFlowClientError &&
          error.code === "pagination_mutated" &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new PlaidCashFlowClientError(
      "response_invalid",
      "Plaid transaction pagination did not stabilize.",
    );
  }

  private async syncOnce(
    accessToken: string,
    startingCursor: string | null,
    budget: { bytes: number },
  ): Promise<readonly PlaidTransactionsSyncResponse[]> {
    const pages: PlaidTransactionsSyncResponse[] = [];
    let cursor = startingCursor;
    let mutationCount = 0;
    for (
      let pageIndex = 0;
      pageIndex < MAX_PLAID_TRANSACTION_PAGES;
      pageIndex += 1
    ) {
      const body: Record<string, unknown> = {
        access_token: accessToken,
        count: 500,
        options: { personal_finance_category_version: "v2" },
      };
      if (cursor === null) {
        body.options = {
          days_requested: 125,
          personal_finance_category_version: "v2",
        };
      } else {
        body.cursor = cursor;
      }
      const result = await this.request(body);
      budget.bytes += result.byteLength;
      if (budget.bytes > MAX_PLAID_TRANSACTION_TOTAL_BYTES) {
        throw new PlaidCashFlowClientError(
          "response_invalid",
          "Plaid returned too much transaction data.",
        );
      }
      const page = result.page;
      pages.push(page);
      mutationCount +=
        page.added.length + page.modified.length + page.removed.length;
      if (mutationCount > MAX_PLAID_TRANSACTION_MUTATIONS) {
        throw new PlaidCashFlowClientError(
          "response_invalid",
          "Plaid returned too many transaction changes.",
        );
      }
      cursor = page.next_cursor;
      if (!page.has_more) {
        return pages;
      }
    }
    throw new PlaidCashFlowClientError(
      "response_invalid",
      "Plaid transaction pagination exceeded the page limit.",
    );
  }

  private async request(body: unknown): Promise<{
    page: PlaidTransactionsSyncResponse;
    byteLength: number;
  }> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://${this.config.environment}.plaid.com/transactions/sync`,
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
      throw new PlaidCashFlowClientError(
        "provider_unavailable",
        "Transaction data is temporarily unavailable.",
      );
    }
    const bytes = await readBoundedResponse(response);
    const decoded = decodeJson(bytes);
    if (!response.ok) {
      const code = plaidErrorCode(decoded);
      throw new PlaidCashFlowClientError(
        code,
        code === "provider_not_ready"
          ? "Plaid is still preparing transaction history."
          : code === "connection_invalid"
            ? "Reconnect this institution to continue."
            : "Transaction data is temporarily unavailable.",
      );
    }
    const parsed = PlaidTransactionsSyncResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new PlaidCashFlowClientError(
        "response_invalid",
        "Plaid returned unsupported transaction data.",
      );
    }
    return { page: parsed.data, byteLength: bytes.byteLength };
  }
}

export function createPlaidCashFlowClient(env: Env): PlaidCashFlowClient {
  return new FetchPlaidCashFlowClient(plaidCashConfiguration(env));
}

export function cashFlowConfigured(env: Env): boolean {
  return cashAccountsConfigured(env);
}

function errorCode(error: unknown): CashFlowErrorCode {
  if (error instanceof PlaidCashFlowClientError) {
    return CashFlowErrorCodeSchema.catch("unexpected_failure").parse(
      error.code,
    );
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return CashFlowErrorCodeSchema.catch("unexpected_failure").parse(
      error.code,
    );
  }
  return "unexpected_failure";
}

export async function syncObservedCashFlow(input: {
  env: Env;
  repository: CashFlowRepository;
  client: PlaidCashFlowClient;
  accessSubject: string;
  connectionId: string;
  syncInput: CashFlowSyncInput;
}): Promise<CashFlowState> {
  const run = await input.repository.beginSync(
    input.accessSubject,
    input.connectionId,
    input.syncInput,
  );
  try {
    const credential = await loadCashCredential(
      input.env,
      input.accessSubject,
      run.secretReference,
    );
    const itemKeySha256 = await cashProviderKey(
      input.env,
      "item",
      credential.itemId,
    );
    const pages = await input.client.syncTransactions(
      credential.accessToken,
      run.plaidCursor,
    );
    let delta: Awaited<ReturnType<typeof normalizePlaidTransactionsSync>>;
    try {
      delta = await normalizePlaidTransactionsSync(pages, {
        retrievedAt: new Date().toISOString(),
        accountKeyFor: (providerAccountId) =>
          cashProviderScopedKey(
            input.env,
            "account",
            itemKeySha256,
            providerAccountId,
          ),
        transactionKeyFor: (providerTransactionId) =>
          cashProviderScopedKey(
            input.env,
            "transaction",
            itemKeySha256,
            providerTransactionId,
          ),
      });
    } catch {
      throw new PlaidCashFlowClientError(
        "response_invalid",
        "Plaid returned unsupported transaction data.",
      );
    }
    await input.repository.completeSync(input.accessSubject, run.id, delta);
    return input.repository.getState(input.accessSubject, true);
  } catch (error) {
    await input.repository
      .failSync(input.accessSubject, run.id, errorCode(error))
      .catch(() => undefined);
    throw error;
  }
}
