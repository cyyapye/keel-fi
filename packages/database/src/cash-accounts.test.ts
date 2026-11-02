import { createSqliteFixture } from "../../../scripts/test-support/sqlite-fixture";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedCashAccounts } from "@keel/connectors";

import { D1CashAccountsRepository } from "./cash-accounts";
import { createApp } from "../../../apps/api/src/app";
import {
  connectCashAccount,
  PlaidCashClientError,
  type PlaidCashClient,
} from "../../../apps/api/src/plaid-cash-sync";
import type { Env } from "../../../apps/api/src/types";
import {
  refreshDueCashAccounts as refreshCashClient,
  loadCashAccounts,
} from "../../../apps/web/src/api";
import { handleRequest } from "../../../apps/web/src/worker";

const migrationFiles = [
  ...readdirSync(resolve(process.cwd(), "packages/database/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => `packages/database/migrations/${file}`),
  "packages/database/seed/synthetic.sql",
];

class TestD1Statement {
  public constructor(
    private readonly owner: TestD1Database,
    private readonly sql: string,
    private readonly values: readonly SQLInputValue[] = [],
  ) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    return new TestD1Statement(this.owner, this.sql, values);
  }

  public first<T>(): Promise<T | null> {
    this.owner.record(this.sql, this.values);
    return Promise.resolve(
      (this.owner.statement(this.sql).get(...this.values) as T) ?? null,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    this.owner.record(this.sql, this.values);
    return Promise.resolve({
      results: this.owner.statement(this.sql).all(...this.values) as T[],
    });
  }

  public run(): Promise<{ meta: { changes: number } }> {
    this.owner.record(this.sql, this.values);
    const result = this.owner.statement(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }

  public execute(): void {
    this.owner.statement(this.sql).run(...this.values);
  }
}

class TestD1Database {
  private readonly statements = new Map<string, StatementSync>();
  public roundTrips = 0;
  public queries: { sql: string; values: readonly SQLInputValue[] }[] = [];
  public failNextBatch = false;
  public record(sql: string, values: readonly SQLInputValue[]) {
    this.roundTrips++;
    this.queries.push({ sql, values });
  }
  public constructor(private readonly database: DatabaseSync) {}

  // Compilation is shared only within one fresh fixture; all reads, bindings,
  // writes, transaction boundaries and measured calls still execute.
  public statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.database.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this, sql);
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
    this.roundTrips++;
    this.database.exec("BEGIN");
    try {
      statements.forEach((statement) => statement.execute());
      if (this.failNextBatch) {
        this.failNextBatch = false;
        throw new Error("Synthetic commit failure");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return Promise.resolve();
  }
}

function normalized(
  rows: NormalizedCashAccounts["rows"],
  observedAt = "2026-08-14T18:00:00.000Z",
): NormalizedCashAccounts {
  return {
    normalizedFingerprint: "f".repeat(64),
    observedAt,
    rows,
  };
}

function reportedRow(
  overrides: Partial<NormalizedCashAccounts["rows"][number]> = {},
) {
  return {
    naturalKeySha256: "a".repeat(64),
    itemAccountKeySha256: "a".repeat(64),
    institutionLabel: "First Synthetic Bank",
    accountLabel: "Household checking",
    subtype: "checking" as const,
    availableMinor: 120_000,
    currentMinor: 125_000,
    valueMinor: 120_000,
    valueState: "reported" as const,
    balanceSource: "available" as const,
    observedAt: "2026-08-14T18:00:00.000Z",
    issues: [],
    ...overrides,
  };
}

async function acceptOpaqueIdentityRotation(
  repository: D1CashAccountsRepository,
) {
  const priorNaturalKeySha256 = "a".repeat(64);
  const reportedNaturalKeySha256 = "b".repeat(64);
  const connection = await repository.upsertConnection(
    "synthetic-access-subject",
    "First Synthetic Bank",
    "connector-secrets/synthetic-cash.enc",
    "c".repeat(64),
  );
  const initial = await repository.beginRefresh(
    "synthetic-access-subject",
    connection.id,
    "initial",
  );
  const initialProposal = (
    await repository.stageProposal("synthetic-access-subject", initial.id, {
      objectKey: "cash-observations/synthetic-opaque-initial.json",
      sourceSha256: "d".repeat(64),
      normalized: normalized([
        reportedRow({
          naturalKeySha256: priorNaturalKeySha256,
          itemAccountKeySha256: priorNaturalKeySha256,
        }),
      ]),
    })
  ).proposal;
  if (initialProposal === null) {
    throw new Error("Expected the initial opaque-identity proposal.");
  }
  await repository.completeRefresh(
    "synthetic-access-subject",
    initial.id,
    initialProposal.id,
    1,
  );
  await repository.applyProposal(
    "synthetic-access-subject",
    initialProposal.id,
    {
      changeNote: "Accepted the initial synthetic account.",
      decisions: initialProposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
      })),
    },
  );

  const live = await repository.beginRefresh(
    "synthetic-access-subject",
    connection.id,
    "live",
  );
  const liveObservedAt = "2026-08-15T18:00:00.000Z";
  const liveProposal = (
    await repository.stageProposal("synthetic-access-subject", live.id, {
      objectKey: "cash-observations/synthetic-opaque-live.json",
      sourceSha256: "e".repeat(64),
      normalized: normalized(
        [
          reportedRow({
            naturalKeySha256: reportedNaturalKeySha256,
            itemAccountKeySha256: reportedNaturalKeySha256,
            valueMinor: 130_000,
            availableMinor: 130_000,
            currentMinor: 135_000,
            observedAt: liveObservedAt,
          }),
        ],
        liveObservedAt,
      ),
    })
  ).proposal;
  if (liveProposal === null) {
    throw new Error("Expected the rotated opaque-identity proposal.");
  }
  await repository.completeRefresh(
    "synthetic-access-subject",
    live.id,
    liveProposal.id,
    1,
  );
  return {
    connection,
    priorNaturalKeySha256,
    reportedNaturalKeySha256,
  };
}

describe("reviewed cash accounts", () => {
  let sqlite: DatabaseSync;
  let repository: D1CashAccountsRepository;
  let measured: TestD1Database;

  beforeEach(() => {
    sqlite = createSqliteFixture(migrationFiles);
    measured = new TestD1Database(sqlite);
    repository = new D1CashAccountsRepository(
      measured as unknown as D1Database,
    );
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["idle", "failure"])(
    "bounds a full %s day through the browser client, JWT authentication, proxy and real SQL",
    async (mode) => {
      const start = Date.parse("2026-09-01T00:00:00.000Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(start - 8 * 86_400_000);
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const objects = new Map<string, Uint8Array>();
      const traffic = {
        http: 0,
        workers: 0,
        jwks: 0,
        provider: 0,
        r2Reads: 0,
        r2Writes: 0,
      };
      const bucket = {
        put: (key: string, value: Uint8Array) => {
          traffic.r2Writes++;
          objects.set(key, new Uint8Array(value));
          return Promise.resolve();
        },
        get: (key: string) => {
          traffic.r2Reads++;
          const value = objects.get(key);
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
        },
        delete: (key: string) => {
          traffic.r2Writes++;
          objects.delete(key);
          return Promise.resolve();
        },
      } as unknown as R2Bucket;
      const env: Env = {
        DB: measured as unknown as D1Database,
        DOCUMENTS: bucket,
        ENVIRONMENT: "preview",
        INGESTION_QUEUE: {} as Queue,
        CONNECTOR_CREDENTIAL_KEY: btoa("k".repeat(32)).replace(/=+$/u, ""),
        PLAID_CLIENT_ID: "synthetic-client",
        PLAID_SECRET: "synthetic-secret",
        PLAID_ENVIRONMENT: "sandbox",
        PLAID_REDIRECT_URI: "https://synthetic-cash.keel.example.com/holdings",
        ACCESS_AUD: "synthetic-cash-audience",
        ACCESS_TEAM_DOMAIN: `cash-${mode}.cloudflareaccess.com`,
      };
      let bank = 0;
      let fail = false;
      const client: PlaidCashClient = {
        createLinkToken: vi.fn(),
        removeItem: vi.fn().mockResolvedValue(undefined),
        exchangeToken: () =>
          Promise.resolve({
            credential: {
              version: 1,
              accessToken: `synthetic-access-${bank}`,
              itemId: `synthetic-item-${bank}`,
              institutionId: `synthetic-bank-${bank}`,
            },
            institutionLabel: `Synthetic bank ${bank.toString().padStart(2, "0")}`,
          }),
        getAccounts: (accessToken) => {
          traffic.provider++;
          if (fail)
            throw new PlaidCashClientError(
              "provider_unavailable",
              "Synthetic provider outage",
            );
          const parsed = {
            accounts: Array.from({ length: 5 }, (_, i) => ({
              account_id: `synthetic-account-${i}`,
              name: `Synthetic account ${i}`,
              official_name: null,
              subtype: "checking",
              type: "depository",
              balances: {
                available: "1200.00",
                current: "1250.00",
                iso_currency_code: "USD",
                unofficial_currency_code: null,
              },
            })),
            item: { item_id: accessToken, institution_id: "synthetic-bank" },
            request_id: "synthetic-request",
          };
          return Promise.resolve({
            parsed,
            bytes: new TextEncoder().encode(JSON.stringify(parsed)),
          });
        },
      };
      const connections: string[] = [];
      for (bank = 0; bank < 20; bank++) {
        const state = await connectCashAccount({
          env,
          repository,
          client,
          accessSubject: "synthetic-access-subject",
          publicToken: "synthetic-public-token",
        });
        const proposal = state.pendingProposals[0]!;
        connections.push(proposal.connectionId);
        await repository.applyProposal(
          "synthetic-access-subject",
          proposal.id,
          {
            changeNote: "Included synthetic accounts for the daily budget.",
            decisions: proposal.rows.map((row) => ({
              rowId: row.id,
              decision: "accepted",
            })),
          },
        );
      }
      // One institution already has an unresolved account. Its next due check must still run.
      const accepted = (
        await repository.getState("synthetic-access-subject", true)
      ).acceptedAccounts.filter((row) => row.connectionId === connections[0]);
      await check(
        connections[0]!,
        [
          ...accepted.map((row) =>
            reportedRow({
              naturalKeySha256: row.naturalKeySha256,
              itemAccountKeySha256: row.naturalKeySha256,
              accountLabel: row.accountLabel,
            }),
          ),
          reportedRow({
            naturalKeySha256: "f".repeat(64),
            itemAccountKeySha256: "f".repeat(64),
            accountLabel: "Synthetic unsupported cash",
            valueState: "unsupported",
            valueMinor: null,
            balanceSource: null,
            issues: ["Only USD cash balances are supported."],
          }),
        ],
        new Date(start - 8 * 86_400_000).toISOString(),
      );
      await repository.applyAutomaticUpdates("synthetic-access-subject");
      if (mode === "idle") {
        vi.setSystemTime(start - 86_400_000);
        for (const id of connections) {
          const run = await repository.beginRefresh(
            "synthetic-access-subject",
            id,
            "live",
          );
          await repository.completeRefresh(
            "synthetic-access-subject",
            run.id,
            null,
            0,
          );
        }
      }
      vi.setSystemTime(start);
      fail = mode === "failure";
      const keys = await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      );
      const jwk = {
        ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
        kid: "synthetic-cash-key",
        alg: "RS256",
        use: "sig",
      };
      const header = Buffer.from(
        JSON.stringify({ alg: "RS256", kid: jwk.kid }),
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          sub: "synthetic-access-subject",
          aud: env.ACCESS_AUD,
          iss: `https://${env.ACCESS_TEAM_DOMAIN}`,
          exp: Math.floor(start / 1000) + 2 * 86400,
        }),
      ).toString("base64url");
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        keys.privateKey,
        new TextEncoder().encode(`${header}.${payload}`),
      );
      let token = `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
      const app = createApp({
        // Keep the signed-JWT SQL workload independent of the shared account
        // owner, which has its own real-D1/R2 admission integration tests.
        capacityWork: (env, _producer, _operationId, execute) => execute(env),
        cashAccountsRepository: repository,
        cashPlaidClient: client,
      });
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (
            url.startsWith(
              `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,
            )
          ) {
            traffic.jwks++;
            return Response.json({ keys: [jwk] });
          }
          traffic.http++;
          traffic.workers++;
          const request = new Request(
            new URL(url, "https://synthetic-cash.keel.example.com"),
            init,
          );
          request.headers.set("Cf-Access-Jwt-Assertion", token);
          return handleRequest(request, {
            API: {
              fetch: async (r) => {
                traffic.workers++;
                return app.fetch(r, env);
              },
            },
            ASSETS: {
              fetch: () =>
                Promise.reject(new Error("Unexpected asset request")),
            },
          });
        },
      );
      Object.assign(traffic, {
        http: 0,
        workers: 0,
        jwks: 0,
        provider: 0,
        r2Reads: 0,
        r2Writes: 0,
      });
      const beforeReads = measured.roundTrips;
      const beforeChanges = Number(
        sqlite.prepare("SELECT total_changes() AS count").get()!.count,
      );
      // Hourly visits for 24 hours; forcing the POST each visit is stricter than the browser eligibility check.
      for (let hour = 0; hour < 24; hour++) {
        vi.setSystemTime(start + hour * 3_600_000);
        await loadCashAccounts();
        await refreshCashClient();
      }
      const writes =
        Number(sqlite.prepare("SELECT total_changes() AS count").get()!.count) -
        beforeChanges;
      expect(traffic.http).toBe(48);
      expect(traffic.workers).toBe(96);
      expect(traffic.jwks).toBeLessThanOrEqual(24);
      expect(traffic.provider).toBe(mode === "idle" ? 0 : 20);
      expect(traffic.r2Reads).toBe(mode === "idle" ? 0 : 20);
      expect(traffic.r2Writes).toBe(0);
      expect(writes).toBe(mode === "idle" ? 0 : 40);
      expect(measured.roundTrips - beforeReads).toBeLessThanOrEqual(600);
      const beforeUnauthorized = measured.roundTrips;
      token = "synthetic-invalid-token";
      await expect(refreshCashClient()).rejects.toThrow();
      expect(measured.roundTrips).toBe(beforeUnauthorized);
    },
  );

  async function check(
    connectionId: string,
    rows: NormalizedCashAccounts["rows"],
    date: string,
    initial = false,
  ) {
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connectionId,
      initial ? "initial" : "live",
    );
    const result = await repository.stageProposal(
      "synthetic-access-subject",
      run.id,
      {
        objectKey: `cash-observations/synthetic-${run.id}.json`,
        sourceSha256: "f".repeat(64),
        normalized: normalized(
          rows.map((row) => ({ ...row, observedAt: date })),
          date,
        ),
      },
    );
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      result.proposal?.id ?? null,
      rows.length,
    );
    return result.proposal;
  }

  async function knownAccounts(rows = [reportedRow()]) {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "c".repeat(64),
    );
    const proposal = (await check(
      connection.id,
      rows,
      "2026-08-14T18:00:00.000Z",
      true,
    ))!;
    await repository.applyProposal("synthetic-access-subject", proposal.id, {
      changeNote: "Included the synthetic accounts.",
      decisions: proposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
      })),
    });
    return connection;
  }

  it("automatically accepts 100 known balances in fixed round trips with indexed reads and no GET writes", async () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      reportedRow({
        naturalKeySha256: index.toString(16).padStart(64, "0"),
        itemAccountKeySha256: index.toString(16).padStart(64, "0"),
        accountLabel: `Synthetic account ${index.toString().padStart(3, "0")}`,
      }),
    );
    const connection = await knownAccounts(rows);
    const proposal = await check(
      connection.id,
      rows.map((row) => ({ ...row, valueMinor: 0, availableMinor: 0 })),
      "2026-08-15T18:00:00.000Z",
    );
    expect(proposal?.rows).toHaveLength(100);
    const before = measured.roundTrips;
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    expect(measured.roundTrips - before).toBe(6);
    const decisions = sqlite
      .prepare(
        "SELECT decision, policy_version, prior_decision_id FROM cash_balance_review_decisions WHERE decision_source = 'policy'",
      )
      .all();
    expect(decisions).toHaveLength(100);
    expect(
      decisions.every(
        (decision) =>
          decision.decision === "accepted" &&
          decision.policy_version === "cash-balances-auto-v1" &&
          decision.prior_decision_id !== null,
      ),
    ).toBe(true);
    const changes = sqlite.prepare("SELECT total_changes() AS count").get();
    const readsBefore = measured.roundTrips;
    const state = await repository.getState("synthetic-access-subject", true);
    expect(measured.roundTrips - readsBefore).toBe(5);
    expect(state.pendingProposals).toEqual([]);
    expect(state.acceptedAccounts).toHaveLength(100);
    expect(state.acceptedAccounts.every((row) => row.valueMinor === 0)).toBe(
      true,
    );
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    expect(sqlite.prepare("SELECT total_changes() AS count").get()).toEqual(
      changes,
    );
    const query = measured.queries.find(({ sql }) =>
      sql.includes("AS is_latest"),
    )!;
    const plan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
      .all(...query.values)
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("cash_balance_proposals_connection_observed_idx");
    expect(plan).toContain("sqlite_autoindex_cash_balance_proposal_rows_2");
    expect(plan).not.toMatch(/SCAN newer|SCAN decision/);
  });

  it("keeps 100 missing accounts and 100 new observations reviewable without exceeding the accepted-account limit", async () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      reportedRow({
        naturalKeySha256: index.toString(16).padStart(64, "0"),
        itemAccountKeySha256: index.toString(16).padStart(64, "0"),
        accountLabel: `Original synthetic account ${index.toString()}`,
      }),
    );
    const connection = await knownAccounts(rows);
    const before = (await repository.getState("synthetic-access-subject", true))
      .acceptedAccounts;
    const proposal = (await check(
      connection.id,
      rows.map((row, index) => ({
        ...row,
        naturalKeySha256: (index + 100).toString(16).padStart(64, "0"),
        itemAccountKeySha256: (index + 100).toString(16).padStart(64, "0"),
        accountLabel: `Different synthetic account ${index.toString()}`,
      })),
      "2026-08-15T18:00:00.000Z",
    ))!;
    expect(proposal.rows).toHaveLength(200);
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    const readsBefore = measured.roundTrips;
    const state = await repository.getState("synthetic-access-subject", true);
    expect(measured.roundTrips - readsBefore).toBe(5);
    expect(state.pendingProposals[0]?.rows).toHaveLength(200);
    expect(state.acceptedAccounts).toEqual(before);
    await expect(
      repository.applyProposal("synthetic-access-subject", proposal.id, {
        changeNote: "Tried to include too many synthetic accounts.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision: row.valueState === "reported" ? "accepted" : "excluded",
        })),
      }),
    ).rejects.toThrow("Cash accounts are limited to 100");
    await repository.applyProposal("synthetic-access-subject", proposal.id, {
      changeNote:
        "Kept the existing synthetic accounts and their last balances.",
      decisions: proposal.rows.map((row) => ({
        rowId: row.id,
        decision: "excluded",
      })),
    });
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .acceptedAccounts,
    ).toEqual(before);
  });

  it("clears superseded observations even when all 20 institutions have an exception", async () => {
    const connectionIds: string[] = [];
    for (let index = 0; index < 20; index++) {
      const connection = await repository.upsertConnection(
        "synthetic-access-subject",
        `Synthetic bank ${index.toString()}`,
        `connector-secrets/synthetic-${index.toString()}.enc`,
        index.toString(16).padStart(64, "0"),
      );
      connectionIds.push(connection.id);
      const proposal = (await check(
        connection.id,
        [reportedRow()],
        "2026-08-14T18:00:00.000Z",
        true,
      ))!;
      await repository.applyProposal("synthetic-access-subject", proposal.id, {
        changeNote: "Included the synthetic account.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      });
      await check(
        connection.id,
        [
          reportedRow({
            valueState: "unavailable",
            valueMinor: null,
            balanceSource: null,
          }),
        ],
        "2026-08-15T18:00:00.000Z",
      );
    }
    await check(
      connectionIds[0]!,
      [
        reportedRow({
          valueState: "unavailable",
          valueMinor: null,
          balanceSource: null,
        }),
      ],
      "2026-08-16T18:00:00.000Z",
    );
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM cash_balance_proposals WHERE status = 'pending_review'",
        )
        .get()!.count,
    ).toBe(20);
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .pendingProposals,
    ).toHaveLength(20);

    await check(
      connectionIds[0]!,
      [reportedRow({ valueMinor: 150_000, availableMinor: 150_000 })],
      "2026-08-17T18:00:00.000Z",
    );
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.pendingProposals).toHaveLength(19);
    expect(
      state.acceptedAccounts.find(
        (account) => account.connectionId === connectionIds[0],
      )?.valueMinor,
    ).toBe(150_000);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM cash_balance_proposals WHERE status = 'pending_review'",
        )
        .get()!.count,
    ).toBe(19);
  });

  it("updates clean accounts while invalid, missing and new accounts stay in review, then recovers on the next check", async () => {
    const savings = reportedRow({
      naturalKeySha256: "b".repeat(64),
      itemAccountKeySha256: "b".repeat(64),
      accountLabel: "Synthetic savings",
      subtype: "savings",
    });
    const reserve = reportedRow({
      naturalKeySha256: "d".repeat(64),
      itemAccountKeySha256: "d".repeat(64),
      accountLabel: "Synthetic reserve",
    });
    const connection = await knownAccounts([reportedRow(), savings, reserve]);
    const invalid = {
      ...savings,
      valueState: "unsupported" as const,
      valueMinor: null,
      balanceSource: null,
      issues: ["Only USD cash balances are supported."],
    };
    const newlyReported = reportedRow({
      naturalKeySha256: "e".repeat(64),
      itemAccountKeySha256: "e".repeat(64),
      accountLabel: "New synthetic account",
    });
    const proposal = (await check(
      connection.id,
      [
        reportedRow({ valueMinor: 999_000, availableMinor: 999_000 }),
        invalid,
        newlyReported,
      ],
      "2026-08-15T18:00:00.000Z",
    ))!;
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.acceptedAccounts.map((row) => row.valueMinor).sort()).toEqual(
      [120_000, 120_000, 999_000].sort(),
    );
    expect(
      state.pendingProposals[0]?.rows.map((row) => row.valueState).sort(),
    ).toEqual(["not_reported", "reported", "unsupported"]);
    await check(
      connection.id,
      [
        reportedRow({ valueMinor: 150_000, availableMinor: 150_000 }),
        savings,
        reserve,
      ],
      "2026-08-16T18:00:00.000Z",
    );
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    const recovered = await repository.getState(
      "synthetic-access-subject",
      true,
    );
    expect(recovered.pendingProposals).toEqual([]);
    expect(
      recovered.acceptedAccounts.find(
        (row) => row.naturalKeySha256 === "a".repeat(64),
      )?.valueMinor,
    ).toBe(150_000);
    await expect(
      repository.applyProposal("synthetic-access-subject", proposal.id, {
        changeNote: "Tried an obsolete review.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "excluded",
        })),
      }),
    ).rejects.toThrow("stale");
  });

  it("rolls back failed policy batches and converges on duplicate recovery", async () => {
    const connection = await knownAccounts();
    await check(
      connection.id,
      [reportedRow({ valueMinor: 135_000, availableMinor: 135_000 })],
      "2026-08-15T18:00:00.000Z",
    );
    measured.failNextBatch = true;
    await expect(
      repository.applyAutomaticUpdates("synthetic-access-subject"),
    ).rejects.toThrow("Synthetic commit failure");
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .acceptedAccounts[0]?.valueMinor,
    ).toBe(120_000);
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM cash_balance_review_decisions WHERE decision_source = 'policy'",
        )
        .get(),
    ).toEqual({ count: 0 });
    await Promise.all([
      repository.applyAutomaticUpdates("synthetic-access-subject"),
      repository.applyAutomaticUpdates("synthetic-access-subject"),
    ]);
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .acceptedAccounts[0]?.valueMinor,
    ).toBe(135_000);
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM cash_balance_review_decisions WHERE decision_source = 'policy'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("ignores older observations and requires a decision for conflicting dates or account types", async () => {
    const connection = await knownAccounts();
    await check(
      connection.id,
      [reportedRow({ valueMinor: 135_000, availableMinor: 135_000 })],
      "2026-08-13T18:00:00.000Z",
    );
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .pendingProposals,
    ).toEqual([]);
    await check(
      connection.id,
      [reportedRow({ valueMinor: 135_000, availableMinor: 135_000 })],
      "2026-08-14T18:00:00.000Z",
    );
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    const conflicting = await repository.getState(
      "synthetic-access-subject",
      true,
    );
    expect(conflicting.acceptedAccounts[0]?.valueMinor).toBe(120_000);
    expect(
      conflicting.pendingProposals[0]?.rows[0]?.issues.join(" "),
    ).toContain("same date");
    await check(
      connection.id,
      [reportedRow({ subtype: "savings" })],
      "2026-08-15T18:00:00.000Z",
    );
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    expect(
      (
        await repository.getState("synthetic-access-subject", true)
      ).pendingProposals[0]?.rows[0]?.issues.join(" "),
    ).toContain("account's type");
  });

  it("preserves a declined balance until the bank reports a different value", async () => {
    const connection = await knownAccounts();
    const declined = (await check(
      connection.id,
      [reportedRow({ valueMinor: 135_000, availableMinor: 135_000 })],
      "2026-08-14T18:00:00.000Z",
    ))!;
    await repository.applyProposal("synthetic-access-subject", declined.id, {
      changeNote: "Kept the prior synthetic balance.",
      decisions: declined.rows.map((row) => ({
        rowId: row.id,
        decision: "excluded",
      })),
    });
    await check(
      connection.id,
      [reportedRow({ valueMinor: 135_000, availableMinor: 135_000 })],
      "2026-08-15T18:00:00.000Z",
    );
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .acceptedAccounts[0]?.valueMinor,
    ).toBe(120_000);
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .pendingProposals,
    ).toEqual([]);
    await check(
      connection.id,
      [reportedRow({ valueMinor: 140_000, availableMinor: 140_000 })],
      "2026-08-16T18:00:00.000Z",
    );
    await repository.applyAutomaticUpdates("synthetic-access-subject");
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .acceptedAccounts[0]?.valueMinor,
    ).toBe(140_000);
  });

  it("stages provider facts without changing the plan, then applies explicit row decisions", async () => {
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({ status: "disconnected" });
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "1".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const forecastCountBefore = sqlite
      .prepare("SELECT COUNT(*) AS count FROM forecast_snapshots")
      .get() as { count: number };
    const planCountBefore = sqlite
      .prepare("SELECT COUNT(*) AS count FROM cash_flow_plans")
      .get() as { count: number };
    const staged = await repository.stageProposal(
      "synthetic-access-subject",
      run.id,
      {
        objectKey: "cash-observations/synthetic-one.json",
        sourceSha256: "2".repeat(64),
        normalized: normalized([
          reportedRow(),
          reportedRow({
            naturalKeySha256: "b".repeat(64),
            itemAccountKeySha256: "b".repeat(64),
            accountLabel: "Foreign cash",
            availableMinor: 10_000,
            currentMinor: 10_000,
            valueMinor: null,
            valueState: "unsupported",
            balanceSource: null,
            issues: ["Only USD cash balances are supported."],
          }),
        ]),
      },
    );
    expect(staged.proposal?.summary).toEqual({
      rowCount: 2,
      reportedCount: 1,
      needsAttentionCount: 1,
      notReportedCount: 0,
      totalReportedMinor: 120_000,
    });
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      staged.proposal?.id ?? null,
      2,
    );
    const nextRun = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    await repository.completeRefresh(
      "synthetic-access-subject",
      nextRun.id,
      null,
      0,
    );
    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.pendingProposals).toHaveLength(1);
    expect(state.acceptedAccounts).toHaveLength(0);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots").get(),
    ).toEqual(forecastCountBefore);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM cash_flow_plans").get(),
    ).toEqual(planCountBefore);
    expect(
      sqlite
        .prepare("SELECT proposed_count FROM connector_sync_runs WHERE id = ?")
        .get(run.id),
    ).toEqual({ proposed_count: 2 });

    const proposal = state.pendingProposals[0];
    if (proposal === undefined) {
      throw new Error("Expected a pending cash proposal.");
    }
    await expect(
      repository.applyProposal("synthetic-access-subject", proposal.id, {
        changeNote: "Tried to accept an unsupported balance.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      }),
    ).rejects.toThrow("cannot be accepted");
    const result = await repository.applyProposal(
      "synthetic-access-subject",
      proposal.id,
      {
        changeNote: "Reviewed the synthetic cash balances.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision:
            row.valueState === "reported"
              ? ("accepted" as const)
              : ("excluded" as const),
        })),
      },
    );
    expect(result).toEqual({
      proposalId: proposal.id,
      acceptedCount: 1,
      excludedCount: 1,
      acceptedCashMinor: 120_000,
    });
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      pendingProposals: [],
      acceptedAccounts: [
        expect.objectContaining({
          accountLabel: "Household checking",
          valueMinor: 120_000,
          valueState: "reported",
          refreshKind: "initial",
        }),
      ],
    });

    const unchangedRun = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const unchanged = await repository.stageProposal(
      "synthetic-access-subject",
      unchangedRun.id,
      {
        objectKey: "cash-observations/synthetic-unchanged.json",
        sourceSha256: "3".repeat(64),
        normalized: normalized([reportedRow()]),
      },
    );
    expect(unchanged.proposal).toBeNull();
    await repository.completeRefresh(
      "synthetic-access-subject",
      unchangedRun.id,
      null,
      1,
    );
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({ pendingProposals: [] });
  });

  it("treats a missing account as unknown only after review", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "3".repeat(64),
    );
    const initial = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const first = await repository.stageProposal(
      "synthetic-access-subject",
      initial.id,
      {
        objectKey: "cash-observations/synthetic-initial.json",
        sourceSha256: "4".repeat(64),
        normalized: normalized([reportedRow()]),
      },
    );
    const firstProposal = first.proposal;
    if (firstProposal === null) {
      throw new Error("Expected the initial proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      initial.id,
      firstProposal.id,
      1,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      firstProposal.id,
      {
        changeNote: "Accepted initial synthetic checking.",
        decisions: firstProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const live = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const missing = await repository.stageProposal(
      "synthetic-access-subject",
      live.id,
      {
        objectKey: "cash-observations/synthetic-missing.json",
        sourceSha256: "5".repeat(64),
        normalized: normalized([]),
      },
    );
    expect(missing.proposal?.rows[0]).toMatchObject({
      action: "not_reported",
      valueMinor: null,
      valueState: "not_reported",
      priorValueMinor: 120_000,
    });
    const beforeReview = await repository.getState(
      "synthetic-access-subject",
      true,
    );
    expect(beforeReview.acceptedAccounts[0]?.valueMinor).toBe(120_000);
    const missingProposal = missing.proposal;
    if (missingProposal === null) {
      throw new Error("Expected the missing-account proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      live.id,
      missingProposal.id,
      0,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      missingProposal.id,
      {
        changeNote: "Confirmed the account was not reported.",
        decisions: missingProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      acceptedAccounts: [
        expect.objectContaining({
          valueMinor: null,
          valueState: "not_reported",
        }),
      ],
    });
  });

  it("keeps one lineage when Plaid changes the natural identity but preserves the Item account identity", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "3".repeat(64),
    );
    const initial = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const initialProposal = (
      await repository.stageProposal("synthetic-access-subject", initial.id, {
        objectKey: "cash-observations/synthetic-identity-initial.json",
        sourceSha256: "4".repeat(64),
        normalized: normalized([
          reportedRow({
            naturalKeySha256: "a".repeat(64),
            itemAccountKeySha256: "c".repeat(64),
          }),
        ]),
      })
    ).proposal;
    if (initialProposal === null) {
      throw new Error("Expected the initial identity proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      initial.id,
      initialProposal.id,
      1,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      initialProposal.id,
      {
        changeNote: "Accepted the initial synthetic account identity.",
        decisions: initialProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const live = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const liveObservedAt = "2026-08-15T18:00:00.000Z";
    const liveProposal = (
      await repository.stageProposal("synthetic-access-subject", live.id, {
        objectKey: "cash-observations/synthetic-identity-live.json",
        sourceSha256: "5".repeat(64),
        normalized: normalized(
          [
            reportedRow({
              naturalKeySha256: "b".repeat(64),
              itemAccountKeySha256: "c".repeat(64),
              availableMinor: 130_000,
              currentMinor: 135_000,
              valueMinor: 130_000,
              observedAt: liveObservedAt,
            }),
          ],
          liveObservedAt,
        ),
      })
    ).proposal;
    if (liveProposal === null) {
      throw new Error("Expected the live identity proposal.");
    }
    expect(liveProposal.rows).toEqual([
      expect.objectContaining({
        naturalKeySha256: "a".repeat(64),
        action: "update_balance",
        priorValueMinor: 120_000,
        valueMinor: 130_000,
      }),
    ]);
    await repository.completeRefresh(
      "synthetic-access-subject",
      live.id,
      liveProposal.id,
      1,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      liveProposal.id,
      {
        changeNote: "Accepted the continued synthetic account identity.",
        decisions: liveProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.acceptedAccounts).toEqual([
      expect.objectContaining({
        naturalKeySha256: "a".repeat(64),
        valueMinor: 130_000,
        valueState: "reported",
      }),
    ]);
  });

  it("repairs an accepted reported/not-reported split when both lineages share the exact Item account identity", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "6".repeat(64),
    );
    const initial = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const initialProposal = (
      await repository.stageProposal("synthetic-access-subject", initial.id, {
        objectKey: "cash-observations/synthetic-repair-initial.json",
        sourceSha256: "7".repeat(64),
        normalized: normalized([
          reportedRow({
            naturalKeySha256: "a".repeat(64),
            itemAccountKeySha256: "c".repeat(64),
          }),
        ]),
      })
    ).proposal;
    if (initialProposal === null) {
      throw new Error("Expected the repair fixture's initial proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      initial.id,
      initialProposal.id,
      1,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      initialProposal.id,
      {
        changeNote: "Accepted the repair fixture's initial account.",
        decisions: initialProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );
    const initialDecision = sqlite
      .prepare(
        `SELECT decided_at
         FROM cash_balance_review_decisions
         WHERE proposal_id = ?`,
      )
      .get(initialProposal.id) as { decided_at: string } | undefined;
    if (initialDecision === undefined) {
      throw new Error("Expected the repair fixture's initial decision.");
    }

    const live = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const proposalId = "cash_proposal_identity_split";
    const reportedRowId = "cash_row_identity_reported";
    const missingRowId = "cash_row_identity_missing";
    const observedAt = "2026-08-15T18:00:00.000Z";
    const decidedAt = new Date(
      Date.parse(initialDecision.decided_at) + 1,
    ).toISOString();
    sqlite
      .prepare(
        `INSERT INTO cash_balance_proposals (
           id, household_id, connector_account_id, sync_run_id,
           source_object_key, source_sha256, normalized_fingerprint,
           refresh_kind, observed_at, retrieved_at, status, created_at
         ) VALUES (?, 'hh_demo', ?, ?, ?, ?, ?, 'live', ?, ?,
                   'pending_review', ?)`,
      )
      .run(
        proposalId,
        connection.id,
        live.id,
        "cash-observations/synthetic-identity-split.json",
        "8".repeat(64),
        "9".repeat(64),
        observedAt,
        observedAt,
        observedAt,
      );
    sqlite
      .prepare(
        `INSERT INTO cash_balance_proposal_rows (
           id, household_id, proposal_id, natural_key_sha256,
           item_account_key_sha256, institution_label, account_label, subtype,
           available_minor, current_minor, value_minor, value_state,
           balance_source, observed_at, issues_json, created_at
         ) VALUES (?, 'hh_demo', ?, ?, ?, 'First Synthetic Bank',
                   'Household checking', 'checking', 130000, 135000, 130000,
                   'reported', 'available', ?, '[]', ?)`,
      )
      .run(
        reportedRowId,
        proposalId,
        "b".repeat(64),
        "c".repeat(64),
        observedAt,
        observedAt,
      );
    sqlite
      .prepare(
        `INSERT INTO cash_balance_proposal_rows (
           id, household_id, proposal_id, natural_key_sha256,
           item_account_key_sha256, institution_label, account_label, subtype,
           available_minor, current_minor, value_minor, value_state,
           balance_source, observed_at, issues_json, created_at
         ) VALUES (?, 'hh_demo', ?, ?, NULL, 'First Synthetic Bank',
                   'Household checking', 'checking', NULL, NULL, NULL,
                   'not_reported', NULL, ?, ?, ?)`,
      )
      .run(
        missingRowId,
        proposalId,
        "a".repeat(64),
        observedAt,
        JSON.stringify([
          "This account was not reported in the latest balance check.",
        ]),
        observedAt,
      );
    const decision = sqlite.prepare(
      `INSERT INTO cash_balance_review_decisions (
         id, household_id, proposal_id, proposal_row_id, reviewer_user_id,
         decision, change_note, decided_at, immutable
       ) VALUES (?, 'hh_demo', ?, ?, 'usr_demo', 'accepted', ?, ?, 1)`,
    );
    decision.run(
      "cash_decision_identity_reported",
      proposalId,
      reportedRowId,
      "Accepted the replacement identity.",
      decidedAt,
    );
    decision.run(
      "cash_decision_identity_missing",
      proposalId,
      missingRowId,
      "Accepted the missing prior identity.",
      decidedAt,
    );
    sqlite
      .prepare(
        "UPDATE cash_balance_proposals SET status = 'applied' WHERE id = ?",
      )
      .run(proposalId);

    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.acceptedAccounts).toEqual([
      expect.objectContaining({
        naturalKeySha256: "a".repeat(64),
        valueMinor: 130_000,
        valueState: "reported",
      }),
    ]);
  });

  it("keeps identically named accounts separate when their provider identities differ", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "a".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const proposal = (
      await repository.stageProposal("synthetic-access-subject", run.id, {
        objectKey: "cash-observations/synthetic-same-label.json",
        sourceSha256: "b".repeat(64),
        normalized: normalized([
          reportedRow({
            naturalKeySha256: "c".repeat(64),
            itemAccountKeySha256: "d".repeat(64),
          }),
          reportedRow({
            naturalKeySha256: "e".repeat(64),
            itemAccountKeySha256: "f".repeat(64),
            valueMinor: 80_000,
          }),
        ]),
      })
    ).proposal;
    if (proposal === null) {
      throw new Error("Expected the same-label proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      proposal.id,
      2,
    );
    await repository.applyProposal("synthetic-access-subject", proposal.id, {
      changeNote: "Accepted both distinct synthetic accounts.",
      decisions: proposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
      })),
    });

    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.acceptedAccounts).toHaveLength(2);
    expect(
      new Set(state.acceptedAccounts.map((account) => account.naturalKeySha256))
        .size,
    ).toBe(2);
  });

  it("requires review before linking a one-to-one opaque account rotation", async () => {
    const rotation = await acceptOpaqueIdentityRotation(repository);
    const beforeReview = await repository.getState(
      "synthetic-access-subject",
      true,
    );
    expect(beforeReview.acceptedAccounts).toHaveLength(1);
    expect(beforeReview.pendingProposals[0]?.rows).toHaveLength(2);
    expect(beforeReview.identityCandidates).toEqual([
      expect.objectContaining({
        connectionId: rotation.connection.id,
        accountLabel: "Household checking",
        priorNaturalKeySha256: rotation.priorNaturalKeySha256,
        reportedNaturalKeySha256: rotation.reportedNaturalKeySha256,
      }),
    ]);

    await repository.reviewIdentity("synthetic-access-subject", {
      connectionId: rotation.connection.id,
      priorNaturalKeySha256: rotation.priorNaturalKeySha256,
      reportedNaturalKeySha256: rotation.reportedNaturalKeySha256,
      decision: "same_account",
      changeNote: "Confirmed the synthetic records describe one account.",
    });

    const afterReview = await repository.getState(
      "synthetic-access-subject",
      true,
    );
    expect(afterReview.identityCandidates).toEqual([]);
    expect(afterReview.acceptedAccounts).toEqual([
      expect.objectContaining({
        naturalKeySha256: rotation.priorNaturalKeySha256,
        valueMinor: 130_000,
        valueState: "reported",
      }),
    ]);
    expect(() =>
      sqlite
        .prepare(
          "UPDATE cash_account_identity_decisions SET decision = 'separate_accounts'",
        )
        .run(),
    ).toThrow("cash account identity decisions are immutable");
    await expect(
      repository.reviewIdentity("synthetic-access-subject", {
        connectionId: rotation.connection.id,
        priorNaturalKeySha256: rotation.priorNaturalKeySha256,
        reportedNaturalKeySha256: rotation.reportedNaturalKeySha256,
        decision: "same_account",
        changeNote: "Tried to repeat a stale synthetic review.",
      }),
    ).rejects.toMatchObject({ code: "review_required" });
  });

  it("records a reviewed decision to keep opaque account identities separate", async () => {
    const rotation = await acceptOpaqueIdentityRotation(repository);
    await repository.reviewIdentity("synthetic-access-subject", {
      connectionId: rotation.connection.id,
      priorNaturalKeySha256: rotation.priorNaturalKeySha256,
      reportedNaturalKeySha256: rotation.reportedNaturalKeySha256,
      decision: "separate_accounts",
      changeNote: "Confirmed the synthetic records are separate accounts.",
    });

    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.identityCandidates).toEqual([]);
    expect(state.acceptedAccounts).toHaveLength(1);
    const proposal = state.pendingProposals[0]!;
    await repository.applyProposal("synthetic-access-subject", proposal.id, {
      changeNote:
        "Included the separate account and kept the missing account's last balance.",
      decisions: proposal.rows.map((row) => ({
        rowId: row.id,
        decision: row.valueState === "reported" ? "accepted" : "excluded",
      })),
    });
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .acceptedAccounts,
    ).toHaveLength(2);
  });

  it("counts every live provider attempt and enforces the monthly ceiling", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "6".repeat(64),
    );
    for (let index = 0; index < 4; index += 1) {
      const run = await repository.beginRefresh(
        "synthetic-access-subject",
        connection.id,
        "live",
      );
      await repository.failRefresh(
        "synthetic-access-subject",
        run.id,
        "provider_unavailable",
      );
    }

    await expect(
      repository.beginRefresh(
        "synthetic-access-subject",
        connection.id,
        "live",
      ),
    ).rejects.toMatchObject({
      code: "monthly_limit_reached",
    });
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      connections: [
        expect.objectContaining({
          liveRefreshesUsed: 4,
          liveRefreshesRemaining: 0,
        }),
      ],
    });
  });

  it("uses the free cadence until a real rate limit, then remembers the seven-day pause", async () => {
    repository = new D1CashAccountsRepository(
      measured as unknown as D1Database,
      "free",
    );
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "6".repeat(64),
    );
    const dailyCutoff = new Date(
      Date.now() - 24 * 60 * 60 * 1_000,
    ).toISOString();
    const first = await repository.beginAutomaticRefresh(
      "synthetic-access-subject",
      connection.id,
      dailyCutoff,
    );
    expect(first).not.toBeNull();
    await repository.failRefresh(
      "synthetic-access-subject",
      first!.id,
      "provider_rate_limited",
    );
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .connections[0],
    ).toMatchObject({
      liveRefreshLimit: 31,
      liveRefreshesRemaining: 30,
      cooldownUntil: expect.any(String),
      cooldownActive: true,
    });
    sqlite
      .prepare("UPDATE connector_sync_runs SET started_at = ? WHERE id = ?")
      .run(
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString(),
        first!.id,
      );
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        dailyCutoff,
      ),
    ).resolves.toBeNull();
    const guardedInsert = measured.queries.find(({ sql }) =>
      sql.includes("limited.error_code = 'provider_rate_limited'"),
    )!;
    const guardPlan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${guardedInsert.sql}`)
      .all(...guardedInsert.values)
      .map((row) => row.detail)
      .join("\n");
    expect(guardPlan).toContain("connector_sync_runs_cash_rate_limit_idx");
    expect(guardPlan).not.toMatch(/SCAN limited/);
    await expect(
      repository.beginRefresh(
        "synthetic-access-subject",
        connection.id,
        "live",
      ),
    ).rejects.toMatchObject({ code: "cooldown_active" });

    sqlite
      .prepare("UPDATE connector_sync_runs SET started_at = ? WHERE id = ?")
      .run(
        new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString(),
        first!.id,
      );
    const second = await repository.beginAutomaticRefresh(
      "synthetic-access-subject",
      connection.id,
      dailyCutoff,
    );
    expect(second).not.toBeNull();
    await repository.failRefresh(
      "synthetic-access-subject",
      second!.id,
      "provider_unavailable",
    );
    sqlite
      .prepare(
        "UPDATE connector_sync_runs SET status = 'succeeded', error_code = NULL WHERE id = ?",
      )
      .run(second!.id);
    sqlite
      .prepare("UPDATE connector_sync_runs SET started_at = ? WHERE id = ?")
      .run(
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString(),
        second!.id,
      );
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        dailyCutoff,
      ),
    ).resolves.toBeNull();
  });

  it("stops automatic checks when free credits are exhausted", async () => {
    repository = new D1CashAccountsRepository(
      measured as unknown as D1Database,
      "free",
    );
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "6".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    await repository.failRefresh(
      "synthetic-access-subject",
      run.id,
      "free_usage_exhausted",
    );
    sqlite
      .prepare("UPDATE connector_sync_runs SET started_at = ? WHERE id = ?")
      .run(
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString(),
        run.id,
      );
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
      ),
    ).resolves.toBeNull();
    const retry = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    await repository.failRefresh(
      "synthetic-access-subject",
      retry.id,
      "provider_unavailable",
    );
    sqlite
      .prepare("UPDATE connector_sync_runs SET started_at = ? WHERE id = ?")
      .run(
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString(),
        retry.id,
      );
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
      ),
    ).resolves.toBeNull();
  });

  it("starts an automatic live check only when the weekly guard allows it", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "6".repeat(64),
    );
    const refreshedAfter = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const first = await repository.beginAutomaticRefresh(
      "synthetic-access-subject",
      connection.id,
      refreshedAfter,
    );
    expect(first).toMatchObject({ refreshKind: "live" });
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        refreshedAfter,
      ),
    ).resolves.toBeNull();
    if (first === null) {
      throw new Error("Expected an automatic live refresh run.");
    }
    await repository.failRefresh(
      "synthetic-access-subject",
      first.id,
      "provider_unavailable",
    );
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        refreshedAfter,
      ),
    ).resolves.toBeNull();

    sqlite
      .prepare("UPDATE connector_sync_runs SET started_at = ? WHERE id = ?")
      .run(
        new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString(),
        first.id,
      );
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        refreshedAfter,
      ),
    ).resolves.toMatchObject({ refreshKind: "live" });
  });

  it("guards cash observations and decisions against rewriting", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "7".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const staged = await repository.stageProposal(
      "synthetic-access-subject",
      run.id,
      {
        objectKey: "cash-observations/synthetic-immutable.json",
        sourceSha256: "8".repeat(64),
        normalized: normalized([reportedRow()]),
      },
    );
    const proposal = staged.proposal;
    if (proposal === null) {
      throw new Error("Expected a proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      proposal.id,
      1,
    );
    await repository.applyProposal("synthetic-access-subject", proposal.id, {
      changeNote: "Accepted immutable synthetic cash.",
      decisions: proposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
      })),
    });

    expect(() =>
      sqlite
        .prepare(
          "UPDATE cash_balance_proposal_rows SET account_label = 'Changed'",
        )
        .run(),
    ).toThrow("cash proposal rows are immutable");
    expect(() =>
      sqlite.prepare("DELETE FROM cash_balance_review_decisions").run(),
    ).toThrow("cash review decisions are immutable");
  });
});
