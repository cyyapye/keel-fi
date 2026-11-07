import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import {
  __investmentConnectionsTest,
  D1InvestmentConnectionsRepository,
} from "@keel/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import { plaidInvestmentsSourceKey } from "./investment-identity";
import {
  connectInvestmentConnection,
  type PlaidInvestmentsClient,
} from "./plaid-investments-sync";
import {
  handlePortfolioWatchQueue,
  PLAID_HOLDINGS_QUEUE_RETRY_DELAY_SECONDS,
} from "./portfolio-watch";
import type { Env } from "./types";

const accessSubject = "synthetic-access-subject";
const credentialKey = btoa("k".repeat(32))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/u, "");

const migrationFiles = [
  ...readdirSync("packages/database/migrations")
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort()
    .map((file) => `packages/database/migrations/${file}`),
  "packages/database/seed/synthetic.sql",
];

class TestD1Statement {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: readonly SQLInputValue[] = [],
  ) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    return new TestD1Statement(this.database, this.sql, values);
  }

  public first<T>(): Promise<T | null> {
    return Promise.resolve(
      (this.database.prepare(this.sql).get(...this.values) as T) ?? null,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({
      results: this.database.prepare(this.sql).all(...this.values) as T[],
    });
  }

  public run(): Promise<{ meta: { changes: number } }> {
    const result = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }

  public execute(): void {
    this.database.prepare(this.sql).run(...this.values);
  }
}

class TestD1Database {
  private afterBatchOnce: (() => void) | null = null;

  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }

  public afterNextBatch(callback: () => void): void {
    this.afterBatchOnce = callback;
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
    const afterBatch = this.afterBatchOnce;
    this.afterBatchOnce = null;
    this.database.exec("BEGIN");
    try {
      statements.forEach((statement) => statement.execute());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    afterBatch?.();
    return Promise.resolve();
  }
}

function memoryBucket(): R2Bucket {
  const values = new Map<string, Uint8Array>();
  return {
    put: vi.fn((key: string, value: Uint8Array) => {
      values.set(key, new Uint8Array(value));
      return Promise.resolve();
    }),
    get: vi.fn((key: string) => {
      const value = values.get(key);
      return Promise.resolve(
        value === undefined
          ? null
          : {
              arrayBuffer: () =>
                Promise.resolve(
                  value.buffer.slice(
                    value.byteOffset,
                    value.byteOffset + value.byteLength,
                  ),
                ),
            },
      );
    }),
    delete: vi.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
  } as unknown as R2Bucket;
}

function syntheticHoldingsResponse() {
  return {
    accounts: [
      {
        account_id: "synthetic-account",
        persistent_account_id: "synthetic-persistent-account",
        name: "Synthetic Brokerage",
        official_name: "Synthetic Brokerage Account",
        subtype: "brokerage",
        type: "investment",
      },
    ],
    holdings: [
      {
        account_id: "synthetic-account",
        security_id: "synthetic-security",
        institution_value: 125,
        cost_basis: 100,
        quantity: 1.25,
        institution_price_as_of: "2026-08-14",
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      },
    ],
    securities: [
      {
        security_id: "synthetic-security",
        name: "Synthetic Public Company",
        ticker_symbol: "SYN",
        type: "equity",
        cusip: "000000000",
        isin: null,
        sedol: null,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      },
    ],
    item: {
      institution_id: "synthetic-institution",
      item_id: "synthetic-item",
    },
    request_id: "synthetic-request",
  };
}

function queueAttempt(body: unknown) {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    ack,
    retry,
    batch: {
      messages: [{ body, ack, retry }],
    } as unknown as MessageBatch<unknown>,
  };
}

describe("Plaid webhook queue recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reclaims an abandoned real D1 lease within the configured retry budget", async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-08-14T12:00:00.000Z");
    vi.setSystemTime(startedAt);

    const sqlite = new DatabaseSync(":memory:");
    try {
      for (const file of migrationFiles) {
        sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
      }
      const database = new TestD1Database(sqlite);
      const repository = new D1InvestmentConnectionsRepository(
        database as unknown as D1Database,
      );
      const bucket = memoryBucket();
      const env = {
        CONNECTOR_CREDENTIAL_KEY: credentialKey,
        DB: database as unknown as D1Database,
        DOCUMENTS: bucket,
        ENVIRONMENT: "local",
        INGESTION_QUEUE: {} as Queue,
        PLAID_CLIENT_ID: "synthetic-client-id",
        PLAID_ENVIRONMENT: "sandbox",
        PLAID_REDIRECT_URI: "https://keel.example/holdings",
        PLAID_SECRET: "synthetic-secret",
        PLAID_WEBHOOK_URL: "https://keel-webhooks.example/webhooks/plaid",
      } satisfies Env;
      const response = syntheticHoldingsResponse();
      const responseBytes = new TextEncoder().encode(JSON.stringify(response));
      const client: PlaidInvestmentsClient = {
        createLinkToken: vi.fn(),
        exchangeInvestmentToken: vi.fn().mockResolvedValue({
          version: 1,
          accessToken: "synthetic-private-access-token",
          itemId: "synthetic-item",
          institutionKey: "synthetic-institution",
          institutionLabel: "Synthetic Institution",
        }),
        removeItem: vi.fn(),
        updateItemWebhook: vi.fn(),
        getWebhookVerificationKey: vi.fn(),
        getHoldings: vi.fn(),
      };
      const connection = await connectInvestmentConnection({
        env,
        repository,
        client,
        accessSubject,
        publicToken: "synthetic-public-token",
      });
      const claim = await repository.claimPlaidWebhookDelivery({
        providerAccountKey: await plaidInvestmentsSourceKey(
          env,
          "synthetic-item",
        ),
        signatureSha256: "a".repeat(64),
        bodySha256: "b".repeat(64),
        issuedAt: new Date(startedAt).toISOString(),
        receivedAt: new Date(startedAt).toISOString(),
      });
      if (claim.status !== "claimed") {
        throw new Error("Synthetic webhook delivery was not claimed.");
      }
      await repository.markPlaidWebhookDelivery(claim.deliveryId, "queued");
      const plaidFetch = vi.fn().mockResolvedValue(
        new Response(responseBytes, {
          status: 200,
          headers: {
            "Content-Length": String(responseBytes.byteLength),
            "Content-Type": "application/json",
          },
        }),
      );
      vi.stubGlobal("fetch", plaidFetch);
      const job = {
        type: "plaid_holdings_webhook",
        messageId: "11111111-1111-4111-8111-111111111111",
        deliveryId: claim.deliveryId,
        requestedAt: new Date(startedAt).toISOString(),
      };

      expect(
        3 * PLAID_HOLDINGS_QUEUE_RETRY_DELAY_SECONDS * 1_000,
      ).toBeGreaterThan(__investmentConnectionsTest.syncStaleAfterMs);

      database.afterNextBatch(() => {
        throw new Error("synthetic termination after durable lease");
      });
      const initial = queueAttempt(job);
      await handlePortfolioWatchQueue(initial.batch, env);
      expect(initial.ack).not.toHaveBeenCalled();
      expect(initial.retry).toHaveBeenCalledWith({
        delaySeconds: PLAID_HOLDINGS_QUEUE_RETRY_DELAY_SECONDS,
      });

      for (const elapsedSeconds of [120, 240]) {
        vi.setSystemTime(startedAt + elapsedSeconds * 1_000);
        const retry = queueAttempt(job);
        await handlePortfolioWatchQueue(retry.batch, env);
        expect(retry.ack).not.toHaveBeenCalled();
        expect(retry.retry).toHaveBeenCalledWith({
          delaySeconds: PLAID_HOLDINGS_QUEUE_RETRY_DELAY_SECONDS,
        });
      }

      vi.setSystemTime(startedAt + 360 * 1_000);
      const recovery = queueAttempt(job);
      await handlePortfolioWatchQueue(recovery.batch, env);
      expect(recovery.ack).toHaveBeenCalledOnce();
      expect(recovery.retry).not.toHaveBeenCalled();
      expect(plaidFetch).toHaveBeenCalledOnce();
      await expect(
        repository.getPlaidWebhookDelivery(claim.deliveryId),
      ).resolves.toMatchObject({ status: "processed" });

      expect(
        sqlite
          .prepare(
            `SELECT run.status, run.error_code
             FROM connector_sync_runs run
             JOIN connector_sync_investment_connections scope
               ON scope.sync_run_id = run.id
             WHERE scope.connection_id = ?
             ORDER BY run.started_at, run.id`,
          )
          .all(connection.connectionId),
      ).toEqual([
        { status: "failed", error_code: "unexpected_failure" },
        { status: "succeeded", error_code: null },
      ]);

      vi.setSystemTime(startedAt + 361 * 1_000);
      const replay = queueAttempt(job);
      await handlePortfolioWatchQueue(replay.batch, env);
      expect(replay.ack).toHaveBeenCalledOnce();
      expect(replay.retry).not.toHaveBeenCalled();
      expect(plaidFetch).toHaveBeenCalledOnce();
    } finally {
      sqlite.close();
    }
  });
});
