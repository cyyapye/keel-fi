import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../apps/api/src/app";
import type { Env } from "../apps/api/src/types";
import { handleRequest } from "../apps/web/src/worker";
import { D1AngelListMacAgentRepository } from "../packages/database/src/angellist-mac-agent";
import { D1MacAgentCredentialRepository } from "../packages/database/src/mac-agent-credentials";
import { D1ProviderBrowserSessionRepository } from "../packages/database/src/provider-browser-sessions";
import { D1ProviderPortfolioAgentRepository } from "../packages/database/src/provider-portfolio-agent";
import type {
  MacAgentAuthorization,
  MacAgentTarget,
} from "../packages/domain/src/index";
import { __angellistMacAgentTest } from "./angellist-mac-agent";
import { MacAgentAccessError } from "./mac-agent-auth";
import { runProviderAgentPolling } from "./provider-agent-polling";
import { leaseProviderBrowserSession } from "./provider-browser-reconnect";
import { __providerPortfolioMacAgentTest } from "./provider-portfolio-mac-agent";

const DAY_MS = 24 * 60 * 60_000;
const START = Date.parse("2026-09-01T00:00:00.000Z");
const SUBJECT = "synthetic-access-subject";
const ORIGIN = "https://agents.keel.example.com";
const PROVIDERS = ["angellist", "tokenfolio", "sydecar"] as const;
const report = console.info.bind(console);

class MeasuredStatement {
  private bindings: SQLInputValue[] = [];
  public constructor(
    private readonly owner: MeasuredDatabase,
    private readonly sql: string,
  ) {}
  public bind(...bindings: SQLInputValue[]): MeasuredStatement {
    this.bindings = bindings;
    return this;
  }
  public first<T>(columnName?: string): Promise<T | null> {
    this.owner.roundTrips++;
    const row = this.owner.sqlite.prepare(this.sql).get(...this.bindings);
    return Promise.resolve(
      row === undefined
        ? null
        : ((columnName === undefined ? row : row[columnName]) as T),
    );
  }
  public all<T>(): Promise<{ results: T[] }> {
    this.owner.roundTrips++;
    return Promise.resolve({
      results: this.owner.sqlite.prepare(this.sql).all(...this.bindings) as T[],
    });
  }
  public execute(): { success: true } {
    this.owner.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true };
  }
}

class MeasuredDatabase {
  public roundTrips = 0;
  public queries = new Set<string>();
  public constructor(public readonly sqlite: DatabaseSync) {}
  public prepare(sql: string): MeasuredStatement {
    this.queries.add(sql);
    return new MeasuredStatement(this, sql);
  }
  public batch(statements: MeasuredStatement[]): Promise<{ success: true }[]> {
    this.roundTrips++;
    this.sqlite.exec("BEGIN");
    try {
      const result = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return Promise.resolve(result);
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  public changes(): number {
    return Number(
      this.sqlite.prepare("SELECT total_changes() AS count").get()!.count,
    );
  }
}

let database: DatabaseSync | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function fixture() {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  database = new DatabaseSync(":memory:");
  const migrations = resolve("packages/database/migrations");
  for (const file of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(resolve(migrations, file), "utf8"));
  }
  database.exec(
    readFileSync(resolve("packages/database/seed/synthetic.sql"), "utf8"),
  );
  const measured = new MeasuredDatabase(database);
  const d1 = measured as unknown as D1Database;
  const clock = { now: START };
  const now = () => new Date(clock.now);
  const credentials = new D1MacAgentCredentialRepository(d1, now);
  const angellist = new D1AngelListMacAgentRepository(d1, now);
  const portfolios = new D1ProviderPortfolioAgentRepository(d1, now);
  const reconnects = new D1ProviderBrowserSessionRepository(d1, now);
  const authorizations = new Map<MacAgentTarget, MacAgentAuthorization>();
  for (const provider of PROVIDERS) {
    if (provider === "angellist") {
      await angellist.register(SUBJECT);
      await angellist.configure(SUBJECT, { interval: "off" });
    } else {
      await portfolios.register(SUBJECT, provider);
      await portfolios.configure(SUBJECT, provider, { interval: "off" });
    }
    // Historical credentials must not turn a hot authentication lookup into
    // a full scan as an installation ages. No real credential enters this case.
    for (let index = 0; index < 40; index++) {
      await credentials.issueToken(SUBJECT, provider);
    }
    authorizations.set(provider, {
      version: 1,
      target: provider,
      apiOrigin: ORIGIN,
      token: await credentials.issueToken(SUBJECT, provider),
    });
  }
  const app = createApp({
    macAgentCredentialRepository: credentials,
    angelListMacAgentRepository: angellist,
    providerPortfolioAgentRepository: portfolios,
    providerBrowserSessionRepository: reconnects,
  });
  const env: Env = {
    DB: d1,
    ENVIRONMENT: "preview",
    MAC_AGENT_API_ORIGIN: ORIGIN,
    DOCUMENTS: {} as R2Bucket,
    INGESTION_QUEUE: {} as Queue,
  };
  const traffic = { http: 0, workerInvocations: 0, maxRoundTrips: 0 };
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      traffic.http++;
      // Fail promptly if a regression brings back a runaway loop.
      expect(traffic.http).toBeLessThanOrEqual(10_000);
      const before = measured.roundTrips;
      traffic.workerInvocations++;
      const response = await handleRequest(new Request(input, init), {
        MAC_AGENT_API_HOST: new URL(ORIGIN).hostname,
        API: {
          fetch: async (request) => {
            traffic.workerInvocations++;
            return app.fetch(request, env);
          },
        },
        ASSETS: {
          fetch: () => {
            throw new Error("Agent must not fetch page assets");
          },
        },
      });
      traffic.maxRoundTrips = Math.max(
        traffic.maxRoundTrips,
        measured.roundTrips - before,
      );
      return response;
    },
  );
  return {
    measured,
    clock,
    credentials,
    reconnects,
    portfolios,
    authorizations,
    traffic,
  };
}

async function leaseUpdate(authorization: MacAgentAuthorization) {
  return authorization.target === "angellist"
    ? __angellistMacAgentTest.lease(authorization)
    : __providerPortfolioMacAgentTest.lease(
        authorization,
        authorization.target,
      );
}

describe("provider agent operating budget", () => {
  it("keeps a full idle day for all three agents inside the shared request and write budgets", async () => {
    const { measured, clock, authorizations, traffic } = await fixture();
    const before = measured.changes();
    for (const provider of PROVIDERS) {
      clock.now = START;
      const authorization = authorizations.get(provider)!;
      const controller = new AbortController();
      await runProviderAgentPolling({
        checkReconnect: async () => {
          expect(
            (await leaseProviderBrowserSession(authorization, provider))
              .session,
          ).toBeNull();
          return "idle";
        },
        checkUpdates: async () => {
          expect((await leaseUpdate(authorization)).run).toBeNull();
        },
        updateIntervalMs:
          provider === "angellist"
            ? __angellistMacAgentTest.queuedUpdatePollIntervalMs
            : __providerPortfolioMacAgentTest.queuedUpdatePollIntervalMs,
        onError: (error) => {
          throw error;
        },
        now: () => clock.now,
        sleep: (milliseconds) => {
          clock.now += milliseconds;
          if (clock.now >= START + DAY_MS) controller.abort();
          return Promise.resolve();
        },
        signal: controller.signal,
      });
    }
    expect(traffic.http).toBeLessThanOrEqual(10_000);
    expect(traffic.workerInvocations).toBeLessThanOrEqual(20_000);
    expect(measured.changes() - before).toBeLessThanOrEqual(2_000);
    expect(traffic.maxRoundTrips).toBeLessThanOrEqual(10);
    // SQLite's change counter excludes index maintenance. A new heartbeat
    // index must trigger an explicit D1 write-budget review instead of silently
    // making the measured row count understate billable writes.
    const heartbeatIndexes = measured.sqlite
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'index'
         AND tbl_name IN ('mac_agent_credentials', 'angellist_mac_agents',
           'provider_portfolio_agents') AND sql IS NOT NULL`,
      )
      .all();
    expect(
      heartbeatIndexes.some((row) =>
        /\b(last_used_at|last_seen_at|updated_at)\b/iu.test(String(row.sql)),
      ),
    ).toBe(false);
    // Prove the real credential lookup uses indexes even with 120 retired
    // credentials. A cached authorization result would hide this boundary.
    const lookup = [...measured.queries].find((sql) =>
      sql.includes("AS retire_older"),
    )!;
    const plan = measured.sqlite
      .prepare(`EXPLAIN QUERY PLAN ${lookup}`)
      .all("angellist", "0".repeat(64));
    const details = plan.map((row) => String(row.detail));
    expect(
      details.some((detail) => /SCAN (credential|older|newer)\b/u.test(detail)),
    ).toBe(false);
    expect(
      details.filter((detail) =>
        /SEARCH (credential|older|newer)\b/u.test(detail),
      ),
    ).toHaveLength(3);
    report(
      JSON.stringify({
        syntheticAgentDay: {
          ...traffic,
          databaseRowsChanged: measured.changes() - before,
        },
      }),
    );
  }, 30_000);

  it("discovers a queued reconnect within a minute without writing on every check", async () => {
    const { measured, clock, authorizations, reconnects } = await fixture();
    const authorization = authorizations.get("tokenfolio")!;
    await leaseProviderBrowserSession(authorization, "tokenfolio");
    const before = measured.changes();
    clock.now += 1_000;
    await leaseProviderBrowserSession(authorization, "tokenfolio");
    expect(measured.changes()).toBe(before);
    const controller = new AbortController();
    let requestedAt = 0;
    let foundAt = 0;
    await runProviderAgentPolling({
      checkReconnect: async () => {
        const result = await leaseProviderBrowserSession(
          authorization,
          "tokenfolio",
        );
        if (result.session !== null) {
          foundAt = clock.now;
          controller.abort();
          return "handled";
        }
        return "idle";
      },
      checkUpdates: async () => {
        await leaseUpdate(authorization);
      },
      updateIntervalMs:
        __providerPortfolioMacAgentTest.queuedUpdatePollIntervalMs,
      onError: (error) => {
        throw error;
      },
      now: () => clock.now,
      sleep: async (milliseconds) => {
        requestedAt = ++clock.now;
        await reconnects.create(SUBJECT, "tokenfolio");
        clock.now += milliseconds - 1;
      },
      signal: controller.signal,
    });
    expect(foundAt - requestedAt).toBeGreaterThan(0);
    expect(foundAt - requestedAt).toBeLessThanOrEqual(60_000);
  });

  it.each([401, 503])(
    "bounds an entire day of HTTP %s failures and recovers on the next successful check",
    async (status) => {
      let now = START;
      let requests = 0;
      let recovered = false;
      const controller = new AbortController();
      const authorization: MacAgentAuthorization = {
        version: 1,
        target: "angellist",
        apiOrigin: ORIGIN,
        token: `keel_agent_v1_${"a".repeat(43)}`,
      };
      vi.stubGlobal("fetch", () => {
        requests++;
        return Promise.resolve(
          Response.json(
            now < START + DAY_MS
              ? { error: "synthetic outage" }
              : {
                  version: 1,
                  provider: "angellist",
                  serverTime: new Date(now).toISOString(),
                  session: null,
                },
            { status: now < START + DAY_MS ? status : 200 },
          ),
        );
      });
      await runProviderAgentPolling({
        checkReconnect: async () => {
          await leaseProviderBrowserSession(authorization, "angellist");
          return "idle";
        },
        checkUpdates: () => {
          recovered = true;
          controller.abort();
          return Promise.resolve();
        },
        updateIntervalMs: DAY_MS,
        onError: (error) =>
          error instanceof MacAgentAccessError ? "authorization" : "retryable",
        now: () => now,
        sleep: (milliseconds) => {
          now += milliseconds;
          return Promise.resolve();
        },
        signal: controller.signal,
      });
      expect(requests).toBeLessThanOrEqual(105);
      expect(now - START - DAY_MS).toBeLessThanOrEqual(15 * 60_000);
      expect(recovered).toBe(true);
    },
  );

  it.each(["tokenfolio", "sydecar"] as const)(
    "discovers a manual %s update within its existing one-minute target",
    async (provider) => {
      const { clock, authorizations, portfolios } = await fixture();
      const authorization = authorizations.get(provider)!;
      const controller = new AbortController();
      let requestedAt = 0;
      let foundAt = 0;
      await runProviderAgentPolling({
        checkReconnect: () => Promise.resolve("idle"),
        checkUpdates: async () => {
          if ((await leaseUpdate(authorization)).run !== null) {
            foundAt = clock.now;
            controller.abort();
          }
        },
        updateIntervalMs:
          __providerPortfolioMacAgentTest.queuedUpdatePollIntervalMs,
        onError: (error) => {
          throw error;
        },
        now: () => clock.now,
        sleep: async (milliseconds) => {
          requestedAt = ++clock.now;
          await portfolios.requestRun(SUBJECT, provider);
          clock.now += milliseconds - 1;
        },
        signal: controller.signal,
      });
      expect(foundAt - requestedAt).toBeGreaterThan(0);
      expect(foundAt - requestedAt).toBeLessThanOrEqual(60_000);
    },
  );

  it("keeps recovery responsive when only update checks fail all day", async () => {
    let now = START;
    let reconnects = 0;
    let updates = 0;
    const controller = new AbortController();
    await runProviderAgentPolling({
      checkReconnect: () => {
        reconnects++;
        return Promise.resolve("idle");
      },
      checkUpdates: () => {
        updates++;
        return Promise.reject(new Error("synthetic provider browser failure"));
      },
      updateIntervalMs: 60_000,
      onError: () => "retryable",
      now: () => now,
      sleep: (milliseconds) => {
        expect(milliseconds).toBeLessThanOrEqual(60_000);
        now += milliseconds;
        if (now >= START + DAY_MS) controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
    });
    expect(reconnects).toBeLessThanOrEqual(1_440);
    expect(updates).toBeLessThanOrEqual(105);
    expect(reconnects + updates).toBeLessThanOrEqual(1_545);
  });

  it("resets failure backoff after success and checks updates immediately after reconnect", async () => {
    let now = START;
    const events: string[] = [];
    const delays: number[] = [];
    const controller = new AbortController();
    let tick = 0;
    await runProviderAgentPolling({
      checkReconnect: () => {
        tick++;
        events.push(`reconnect:${tick}`);
        if ([1, 2, 4, 6].includes(tick)) {
          return Promise.reject(new Error("synthetic outage"));
        }
        return Promise.resolve(tick === 5 ? "connected" : "idle");
      },
      checkUpdates: () => {
        events.push(`update:${tick}`);
        return Promise.resolve();
      },
      updateIntervalMs: DAY_MS,
      onError: () => "retryable",
      now: () => now,
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        now += milliseconds;
        if (tick === 6) controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
    });
    expect(delays).toEqual([60_000, 120_000, 60_000, 60_000, 60_000, 60_000]);
    expect(events).toEqual([
      "reconnect:1",
      "reconnect:2",
      "reconnect:3",
      "update:3",
      "reconnect:4",
      "reconnect:5",
      "update:5",
      "reconnect:6",
    ]);
  });
});
