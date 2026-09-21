import { afterEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { createApp } from "../apps/api/src/app";
import { D1ProviderBrowserSessionRepository } from "../packages/database/src/provider-browser-sessions";
import { createSqliteTrace } from "./test-support/sqlite-trace";
import { handleRequest } from "../apps/web/src/worker";
import { D1AngelListMacAgentRepository } from "../packages/database/src/angellist-mac-agent";
import { D1MacAgentCredentialRepository } from "../packages/database/src/mac-agent-credentials";
import { D1ProviderPortfolioAgentRepository } from "../packages/database/src/provider-portfolio-agent";
import type { MacAgentAuthorization } from "../packages/domain/src/index";
import { __angellistMacAgentTest } from "./angellist-mac-agent";
import { __providerPortfolioMacAgentTest } from "./provider-portfolio-mac-agent";
import { leaseProviderBrowserSession } from "./provider-browser-reconnect";
import { runProviderAgentPolling } from "./provider-agent-polling";
import { createCostDatabase } from "./test-support/d1-cost";

const START = Date.parse("2026-09-01T00:00:00.000Z");
const DAY = 86_400_000;
const SUBJECT = "synthetic-access-subject";
const ORIGIN = "https://agents.keel.example.com";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  "idle",
  "renewal",
  "renewal_failure",
  "renewal_intermittent",
  "revoked",
] as const)(
  "measures a complete three-agent %s day with real D1 counters",
  async (scenario) => {
    const bundled = await build({
      entryPoints: ["scripts/test-support/sql-replay-worker.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      conditions: ["workerd", "worker", "browser"],
      mainFields: ["browser", "module", "main"],
      external: ["node:*", "cloudflare:*"],
      logLevel: "silent",
    });
    const fixture = await createCostDatabase(bundled.outputFiles[0]!.text);
    const trace = createSqliteTrace();
    let clock = START;
    const now = () => new Date(clock);
    const credentials = new D1MacAgentCredentialRepository(trace.database, now);
    const angellist = new D1AngelListMacAgentRepository(trace.database, now);
    const portfolios = new D1ProviderPortfolioAgentRepository(
      trace.database,
      now,
    );
    const authorizations: MacAgentAuthorization[] = [];
    const log = console.info.bind(console);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      for (const provider of ["angellist", "tokenfolio", "sydecar"] as const) {
        if (provider === "angellist") {
          await angellist.register(SUBJECT);
          await angellist.configure(SUBJECT, { interval: "off" });
        } else {
          await portfolios.register(SUBJECT, provider);
          await portfolios.configure(SUBJECT, provider, { interval: "off" });
        }
        authorizations.push({
          version: 1,
          target: provider,
          apiOrigin: ORIGIN,
          token: await credentials.issueToken(SUBJECT, provider),
        });
      }
      // 120 retired records exercise the current authentication lookup at scale.
      await trace.database
        .prepare(
          `INSERT INTO mac_agent_credentials
      (id, household_id, target, token_sha256, issued_by_user_id, issued_at, last_used_at, revoked_at)
      SELECT 'retired-' || value, 'hh_demo', 'sydecar', printf('%064d', value), 'usr_demo',
        '2026-08-01T00:00:00.000Z', NULL, '2026-08-02T00:00:00.000Z'
      FROM json_each(?)`,
        )
        .bind(JSON.stringify(Array.from({ length: 120 }, (_, n) => n)))
        .run();
      const app = createApp({
        macAgentCredentialRepository: credentials,
        angelListMacAgentRepository: angellist,
        providerPortfolioAgentRepository: portfolios,
        providerBrowserSessionRepository:
          new D1ProviderBrowserSessionRepository(trace.database, now),
      });
      let http = 0;
      let workerInvocations = 0;
      let maxRoundTrips = 0;
      let sessionLeaseRequests = 0;
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(++http).toBeLessThanOrEqual(10_000);
          if (new Request(input, init).url.endsWith("/session-renewal/lease"))
            sessionLeaseRequests++;
          const before = trace.roundTrips;
          workerInvocations++;
          const response = await handleRequest(new Request(input, init), {
            MAC_AGENT_API_HOST: new URL(ORIGIN).hostname,
            API: {
              fetch: async (request) => {
                workerInvocations++;
                return app.fetch(request, {
                  DB: trace.database,
                  ENVIRONMENT: "preview",
                  MAC_AGENT_API_ORIGIN: ORIGIN,
                  DOCUMENTS: {} as R2Bucket,
                  INGESTION_QUEUE: {} as Queue,
                });
              },
            },
            ASSETS: {
              fetch: () => {
                throw new Error("Idle client requested an asset");
              },
            },
          });
          maxRoundTrips = Math.max(maxRoundTrips, trace.roundTrips - before);
          return response;
        },
      );
      const rejected = scenario === "revoked";
      const renewals = scenario.startsWith("renewal");
      const renewalFailure = scenario === "renewal_failure";
      const intermittentFailure = scenario === "renewal_intermittent";
      // Start the maximum retry day with maintenance already due. Changing a
      // capture schedule does not verify the provider session. This exercises
      // all nine attempts in a rolling day, not just eight after a fresh login.
      const lastVerifiedAt = START - (intermittentFailure ? 6 * 3_600_000 : 0);
      // Each scenario owns a fresh database. Rewinding a shared fixture would
      // retain future heartbeat timestamps and silently suppress their writes.
      if (renewals) {
        await portfolios.configure(SUBJECT, "sydecar", { interval: "daily" });
        await trace.database
          .prepare(
            `UPDATE provider_portfolio_agents SET last_completed_at = ?
          WHERE provider = 'sydecar'`,
          )
          .bind(new Date(lastVerifiedAt).toISOString())
          .run();
        await trace.database
          .prepare(
            `INSERT INTO provider_session_renewals (agent_id, last_verified_at, next_check_at)
          SELECT id, ?, ? FROM provider_portfolio_agents WHERE provider = 'sydecar'
          ON CONFLICT(agent_id) DO UPDATE SET last_verified_at = excluded.last_verified_at,
            next_check_at = excluded.next_check_at, attempts = 0, lease_token_sha256 = NULL,
            lease_expires_at = NULL, last_outcome_token_sha256 = NULL, last_error_code = NULL`,
          )
          .bind(
            new Date(lastVerifiedAt).toISOString(),
            new Date(lastVerifiedAt + 6 * 3_600_000).toISOString(),
          )
          .run();
      }
      if (rejected)
        await trace.database
          .prepare(
            "UPDATE mac_agent_credentials SET revoked_at = '2026-09-02T00:00:00.000Z' WHERE revoked_at IS NULL",
          )
          .run();
      trace.reset();
      http = 0;
      workerInvocations = 0;
      maxRoundTrips = 0;
      sessionLeaseRequests = 0;
      let browserStarts = 0;
      // Synthetic provider access lasts one hour; its renewal authorization
      // lasts twelve. Immediate Chrome restarts alone cannot survive a day.
      let providerRefreshUntil = lastVerifiedAt + 12 * 3_600_000;
      for (const authorization of authorizations) {
        clock = START;
        const controller = new AbortController();
        await runProviderAgentPolling({
          ...(authorization.target === "sydecar"
            ? {
                checkSessionRenewal: () =>
                  __providerPortfolioMacAgentTest.checkSessionRenewal(
                    new URL(ORIGIN),
                    authorization,
                    async (_provider, _origin, operation) => {
                      browserStarts++;
                      expect(browserStarts).toBeLessThanOrEqual(9);
                      if (
                        renewalFailure ||
                        (intermittentFailure && browserStarts % 3 !== 0)
                      )
                        throw new Error("Synthetic provider outage");
                      return operation({} as never);
                    },
                    () => {
                      if (clock >= providerRefreshUntil)
                        throw new Error("Synthetic refresh token expired");
                      providerRefreshUntil = clock + 12 * 3_600_000;
                      return Promise.resolve();
                    },
                  ),
              }
            : {}),
          checkReconnect: async () => {
            expect(
              (
                await leaseProviderBrowserSession(
                  authorization,
                  authorization.target,
                )
              ).session,
            ).toBeNull();
            return "idle";
          },
          checkUpdates: async () => {
            const leased =
              authorization.target === "angellist"
                ? await __angellistMacAgentTest.lease(authorization)
                : await __providerPortfolioMacAgentTest.lease(
                    authorization,
                    authorization.target,
                  );
            expect(leased.run).toBeNull();
          },
          updateIntervalMs: authorization.target === "angellist" ? DAY : 60_000,
          onError: (error) => {
            if (!rejected && !renewalFailure && !intermittentFailure)
              throw error;
            return rejected ? "authorization" : "retryable";
          },
          now: () => clock,
          sleep: (milliseconds) => {
            clock += milliseconds;
            if (clock >= START + DAY) controller.abort();
            return Promise.resolve();
          },
          signal: controller.signal,
        });
      }
      expect(http).toBeLessThanOrEqual(rejected ? 300 : 10_000);
      expect(workerInvocations).toBeLessThanOrEqual(rejected ? 600 : 20_000);
      expect(maxRoundTrips).toBeLessThanOrEqual(10);
      expect(sessionLeaseRequests).toBe(rejected ? 0 : 24);
      expect(browserStarts).toBe(intermittentFailure ? 9 : renewals ? 3 : 0);
      if (scenario === "renewal" || intermittentFailure) {
        expect(providerRefreshUntil).toBeGreaterThan(START + DAY);
        const state = await portfolios.getOverview(SUBJECT, "sydecar");
        expect(state.lastCompletedAt).toBe(
          new Date(lastVerifiedAt).toISOString(),
        );
        expect(state.nextRunAt).toBe(new Date(START + DAY).toISOString());
        expect(state.errorCode).toBeNull();
      }
      if (renewalFailure) {
        expect(
          (await portfolios.getOverview(SUBJECT, "sydecar")).errorCode,
        ).toBe("unexpected_failure");
      }
      const cost = await trace.replay((body) =>
        fixture.dispatchFetch("https://synthetic-replay.invalid", {
          method: "POST",
          body,
        }),
      );
      expect(cost.rowsRead).toBeLessThanOrEqual(rejected ? 1_000 : 150_000);
      expect(cost.rowsWritten).toBeLessThanOrEqual(rejected ? 0 : 2_000);
      if (!rejected) expect(cost.rowsWritten).toBeGreaterThan(1_500);
      log(
        JSON.stringify({
          actualD1AgentDay: {
            scenario,
            sessionLeaseRequests,
            browserStarts,
            rejected,
            http,
            workerInvocations,
            maxRoundTrips,
            ...cost,
          },
        }),
      );
    } finally {
      trace.close();
      await fixture.close();
    }
  },
  180_000,
);
