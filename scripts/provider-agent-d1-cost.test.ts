import { afterEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { createApp } from "../apps/api/src/app";
import { D1ProviderBrowserSessionRepository } from "../packages/database/src/provider-browser-sessions";
import { createSqliteTrace } from "./test-support/sqlite-trace";
import { handleRequest, type WebWorkerBindings } from "../apps/web/src/worker";
import type { Env } from "../apps/api/src/types";
import { MacAgentAccessError } from "./mac-agent-auth";
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
  "renewal_transport_recovery",
  "revoked",
] as const)(
  "measures a complete three-agent %s day with real D1 counters",
  async (scenario) => {
    const started = performance.now();
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
    const bundledAt = performance.now();
    const fixture = await createCostDatabase(bundled.outputFiles[0]!.text, {
      sharedMemoryParent:
        process.env.CI === "true"
          ? process.env.KEEL_PROVIDER_DAY_SCRATCH
          : undefined,
    });
    let closeTrace: (() => void) | undefined;
    try {
      const trace = createSqliteTrace();
      closeTrace = trace.close;
      const initializedAt = performance.now();
      let clock = START;
      const now = () => new Date(clock);
      const credentials = new D1MacAgentCredentialRepository(
        trace.database,
        now,
      );
      const angellist = new D1AngelListMacAgentRepository(trace.database, now);
      const portfolios = new D1ProviderPortfolioAgentRepository(
        trace.database,
        now,
      );
      const authorizations: MacAgentAuthorization[] = [];
      const log = console.info.bind(console);
      vi.spyOn(console, "info").mockImplementation(() => undefined);
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
      let harnessFailure: Error | undefined;
      const failHarness = (message: string): never => {
        const error = new Error(message);
        harnessFailure ??= error;
        throw error;
      };
      const assertHarness = (condition: boolean, message: string) => {
        if (!condition) failHarness(message);
      };
      const apiEnv: Env = {
        DB: trace.database,
        ENVIRONMENT: "preview",
        MAC_AGENT_API_ORIGIN: ORIGIN,
        DOCUMENTS: {} as R2Bucket,
        INGESTION_QUEUE: {} as Queue,
      };
      const bridge: WebWorkerBindings = {
        MAC_AGENT_API_HOST: new URL(ORIGIN).hostname,
        API: {
          fetch: async (request) => {
            workerInvocations++;
            return app.fetch(request, apiEnv);
          },
        },
        ASSETS: { fetch: () => failHarness("Idle client requested an asset") },
      };
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          assertHarness(++http <= 10_000, "Agent day exceeded its HTTP budget");
          const request = new Request(input, init);
          if (request.url.endsWith("/session-renewal/lease"))
            sessionLeaseRequests++;
          const before = trace.roundTrips;
          workerInvocations++;
          const response = await handleRequest(request, bridge);
          maxRoundTrips = Math.max(maxRoundTrips, trace.roundTrips - before);
          return response;
        },
      );
      const rejected = scenario === "revoked";
      const renewals = scenario.startsWith("renewal");
      const renewalFailure = scenario === "renewal_failure";
      const intermittentFailure = scenario === "renewal_intermittent";
      const transportRecovery = scenario === "renewal_transport_recovery";
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
                      assertHarness(
                        browserStarts <= 9,
                        "Agent day exceeded its browser budget",
                      );
                      if (transportRecovery && browserStarts <= 3)
                        throw new __providerPortfolioMacAgentTest.SessionRenewalFailure(
                          {
                            errorCode: "unexpected_failure",
                            reason: "transport",
                            refreshExpiresAt: new Date(
                              providerRefreshUntil,
                            ).toISOString(),
                          },
                        );
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
                      return Promise.resolve(
                        transportRecovery
                          ? {
                              refreshExpiresAt: new Date(
                                providerRefreshUntil,
                              ).toISOString(),
                            }
                          : undefined,
                      );
                    },
                  ),
              }
            : {}),
          checkReconnect: async () => {
            const lease = await leaseProviderBrowserSession(
              authorization,
              authorization.target,
            );
            assertHarness(
              lease.session === null,
              "Idle reconnect returned a session",
            );
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
            assertHarness(leased.run === null, "Idle update returned a run");
          },
          updateIntervalMs: authorization.target === "angellist" ? DAY : 60_000,
          onError: (error) => {
            if (harnessFailure) throw harnessFailure;
            if (rejected && error instanceof MacAgentAccessError)
              return "authorization";
            if (
              (renewalFailure || intermittentFailure || transportRecovery) &&
              error instanceof
                __providerPortfolioMacAgentTest.SessionRenewalFailure
            )
              return "retryable";
            throw error;
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
      if (harnessFailure) throw harnessFailure;
      expect(http).toBeLessThanOrEqual(rejected ? 300 : 10_000);
      expect(workerInvocations).toBeLessThanOrEqual(rejected ? 600 : 20_000);
      expect(maxRoundTrips).toBeLessThanOrEqual(10);
      expect(sessionLeaseRequests).toBe(rejected ? 0 : 24);
      expect(browserStarts).toBe(
        transportRecovery ? 6 : intermittentFailure ? 9 : renewals ? 3 : 0,
      );
      if (scenario === "renewal" || intermittentFailure || transportRecovery) {
        expect(providerRefreshUntil).toBeGreaterThan(START + DAY);
        const state = await portfolios.getOverview(SUBJECT, "sydecar");
        expect(state.lastCompletedAt).toBe(
          new Date(lastVerifiedAt).toISOString(),
        );
        expect(state.nextRunAt).toBe(new Date(START + DAY).toISOString());
        // Maintenance proves session access, not successful capture recovery.
        expect(state.errorCode).toBe(
          transportRecovery ? "unexpected_failure" : null,
        );
      }
      if (renewalFailure) {
        expect(
          (await portfolios.getOverview(SUBJECT, "sydecar")).errorCode,
        ).toBe("unexpected_failure");
      }
      const replayStartedAt = performance.now();
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
            storage: fixture.storage,
            sessionLeaseRequests,
            browserStarts,
            rejected,
            http,
            workerInvocations,
            maxRoundTrips,
            ...cost,
            timingsMs: {
              bundle: Math.round(bundledAt - started),
              initialize: Math.round(initializedAt - bundledAt),
              scenario: Math.round(replayStartedAt - initializedAt),
              replay: Math.round(performance.now() - replayStartedAt),
            },
          },
        }),
      );
    } finally {
      try {
        closeTrace?.();
      } finally {
        await fixture.close();
      }
    }
  },
  180_000,
);
