import { afterEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { handleRequest } from "../apps/web/src/worker";
import { D1AngelListMacAgentRepository } from "../packages/database/src/angellist-mac-agent";
import { D1MacAgentCredentialRepository } from "../packages/database/src/mac-agent-credentials";
import { D1ProviderPortfolioAgentRepository } from "../packages/database/src/provider-portfolio-agent";
import type { MacAgentAuthorization } from "../packages/domain/src/index";
import { __angellistMacAgentTest } from "./angellist-mac-agent";
import { __providerPortfolioMacAgentTest } from "./provider-portfolio-mac-agent";
import { leaseProviderBrowserSession } from "./provider-browser-reconnect";
import { runProviderAgentPolling } from "./provider-agent-polling";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";

const START = Date.parse("2026-09-01T00:00:00.000Z");
const DAY = 86_400_000;
const SUBJECT = "synthetic-access-subject";
const ORIGIN = "https://agents.keel.example.com";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("measures the entire three-agent idle and rejected-credential day with real D1 billing counters", async () => {
  const bundled = await build({
    entryPoints: ["scripts/test-support/agent-cost-worker.ts"],
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
  const measured = measureD1(fixture.database);
  let clock = START;
  const now = () => new Date(clock);
  const credentials = new D1MacAgentCredentialRepository(
    measured.database,
    now,
  );
  const angellist = new D1AngelListMacAgentRepository(measured.database, now);
  const portfolios = new D1ProviderPortfolioAgentRepository(
    measured.database,
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
    await fixture.database
      .prepare(
        `INSERT INTO mac_agent_credentials
      (id, household_id, target, token_sha256, issued_by_user_id, issued_at, last_used_at, revoked_at)
      SELECT 'retired-' || value, 'hh_demo', 'sydecar', printf('%064d', value), 'usr_demo',
        '2026-08-01T00:00:00.000Z', NULL, '2026-08-02T00:00:00.000Z'
      FROM json_each(?)`,
      )
      .bind(JSON.stringify(Array.from({ length: 120 }, (_, n) => n)))
      .run();
    let http = 0;
    let workerInvocations = 0;
    let maxRoundTrips = 0;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(++http).toBeLessThanOrEqual(10_000);
        const before = measured.cost.roundTrips;
        workerInvocations++;
        const response = await handleRequest(new Request(input, init), {
          MAC_AGENT_API_HOST: new URL(ORIGIN).hostname,
          API: {
            fetch: async (request) => {
              workerInvocations++;
              const headers = new Headers(request.headers);
              headers.set("x-synthetic-clock", String(clock));
              const response = await fixture.dispatchFetch(request.url, {
                method: request.method,
                headers: Object.fromEntries(headers.entries()),
                body: await request.arrayBuffer(),
              });
              const cost = JSON.parse(
                response.headers.get("x-synthetic-d1-cost")!,
              ) as typeof measured.cost;
              for (const key of [
                "rowsRead",
                "rowsWritten",
                "roundTrips",
                "statements",
              ] as const)
                measured.cost[key] += cost[key];
              return new Response(await response.arrayBuffer(), {
                status: response.status,
                headers: Object.fromEntries(response.headers.entries()),
              });
            },
          },
          ASSETS: {
            fetch: () => {
              throw new Error("Idle client requested an asset");
            },
          },
        });
        maxRoundTrips = Math.max(
          maxRoundTrips,
          measured.cost.roundTrips - before,
        );
        return response;
      },
    );
    for (const rejected of [false, true]) {
      if (rejected)
        await fixture.database
          .prepare(
            "UPDATE mac_agent_credentials SET revoked_at = '2026-09-02T00:00:00.000Z' WHERE revoked_at IS NULL",
          )
          .run();
      measured.reset();
      http = 0;
      workerInvocations = 0;
      maxRoundTrips = 0;
      for (const authorization of authorizations) {
        clock = START;
        const controller = new AbortController();
        await runProviderAgentPolling({
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
            if (!rejected) throw error;
            return "authorization";
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
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(
        rejected ? 1_000 : 150_000,
      );
      expect(measured.cost.rowsWritten).toBeLessThanOrEqual(
        rejected ? 0 : 2_000,
      );
      expect(maxRoundTrips).toBeLessThanOrEqual(10);
      log(
        JSON.stringify({
          actualD1AgentDay: {
            rejected,
            http,
            workerInvocations,
            maxRoundTrips,
            ...measured.cost,
          },
        }),
      );
    }
  } finally {
    await fixture.close();
  }
}, 180_000);
