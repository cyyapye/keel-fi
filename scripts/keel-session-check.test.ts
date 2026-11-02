import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app";
import type { Env } from "../apps/api/src/types";
import { createCostDatabase } from "./test-support/d1-cost";
import { SessionCheckCostResultSchema } from "./test-support/session-check-cost-worker";
import { createSqliteTrace } from "./test-support/sqlite-trace";

const ORIGIN = new URL("https://keel.example.com");
const bundleWorker = (entryPoint: string) =>
  build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["browser", "module", "main"],
    external: ["node:*", "cloudflare:*"],
    logLevel: "silent",
  }).then((result) => result.outputFiles[0]!.text);
const replayWorker = bundleWorker("scripts/test-support/sql-replay-worker.ts");
const sessionWorker = bundleWorker(
  "scripts/test-support/session-check-cost-worker.ts",
);

async function replayD1(trace: ReturnType<typeof createSqliteTrace>) {
  const fixture = await createCostDatabase(await replayWorker);
  try {
    return await trace.replay((body) =>
      fixture.dispatchFetch("https://synthetic-replay.invalid", {
        method: "POST",
        body,
      }),
    );
  } finally {
    await fixture.close();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("bounds all three setup checks through the browser client, auth and real D1 without loading the dashboard", async () => {
  const fixture = await createCostDatabase(await sessionWorker);
  try {
    const response = await fixture.dispatchFetch(
      "https://synthetic-session-cost.invalid",
      { method: "POST" },
    );
    expect(response.ok).toBe(true);
    const result = SessionCheckCostResultSchema.parse(await response.json());
    expect(result.scenarios.map(({ scenario }) => scenario)).toEqual([
      "pending",
      "failure",
      "ready",
    ]);
    for (const { scenario, attempts, requests, cost } of result.scenarios) {
      for (const attempt of attempts) {
        expect(attempt.ready).toBe(scenario === "ready");
        expect(attempt.elapsedMs).toBeLessThanOrEqual(30 * 60_000);
      }
      expect(requests).toBeLessThanOrEqual(
        scenario === "pending" ? 1_080 : scenario === "failure" ? 30 : 3,
      );
      if (scenario === "pending") expect(requests).toBe(1_080);
      expect(cost.roundTrips).toBe(requests);
      expect(cost.rowsRead).toBeLessThanOrEqual(
        scenario === "pending" ? 0 : 120,
      );
      expect(cost.rowsWritten).toBe(0);
      console.info(
        JSON.stringify({
          syntheticSetupDay: {
            scenario,
            requests,
            workerInvocations: requests * 2,
            ...cost,
          },
        }),
      );
    }
    expect(result.unexpectedRequests).toBe(0);
    expect(result.assetRequests).toBe(0);
    expect(result.unauthenticatedStatus).toBe(401);
    expect(result.afterUnauthenticated).toBe(result.beforeUnauthenticated);
  } finally {
    await fixture.close();
  }
}, 60_000);

it("bounds a full browser reconnect day through the real status client and read-only repository", async () => {
  const { startBoundedPolling } =
    await import("../apps/web/src/bounded-polling");
  const { getProviderBrowserReconnect } = await import("../apps/web/src/api");
  const { D1ProviderBrowserSessionRepository } =
    await import("../packages/database/src/provider-browser-sessions");
  const { D1ProviderPortfolioAgentRepository } =
    await import("../packages/database/src/provider-portfolio-agent");
  const { D1AngelListMacAgentRepository } =
    await import("../packages/database/src/angellist-mac-agent");
  const trace = createSqliteTrace();
  const start = Date.parse("2026-09-01T00:00:00.000Z");
  let now = start;
  const sessions = new D1ProviderBrowserSessionRepository(
    trace.database,
    () => new Date(now),
  );
  const portfolios = new D1ProviderPortfolioAgentRepository(
    trace.database,
    () => new Date(now),
  );
  const angellist = new D1AngelListMacAgentRepository(
    trace.database,
    () => new Date(now),
  );
  const app = createApp({
    providerBrowserSessionRepository: sessions,
    verifyAccess: () =>
      Promise.resolve({
        kind: "user" as const,
        subject: "synthetic-access-subject",
        email: null,
      }),
  });
  const env: Env = {
    DB: trace.database,
    ENVIRONMENT: "preview",
    DOCUMENTS: {} as R2Bucket,
    INGESTION_QUEUE: {} as Queue,
  };
  let requests = 0;
  let failure = false;
  const report = console.info.bind(console);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    requests++;
    const response = await app.request(
      new URL(path, ORIGIN).href,
      {
        ...init,
        headers: { "Cf-Access-Jwt-Assertion": "synthetic-test-assertion" },
      },
      env,
    );
    return failure
      ? new Response("Synthetic proxy failure", { status: 503 })
      : response;
  });
  try {
    for (const failed of [false, true]) {
      failure = failed;
      now = start + Number(failed) * 86_400_000;
      const jobs = new Map<
        number,
        { at: number; callback: () => void | Promise<void> }
      >();
      let sequence = 0;
      let stopped = 0;
      for (const provider of ["angellist", "tokenfolio", "sydecar"] as const) {
        if (provider === "angellist")
          await angellist.register("synthetic-access-subject");
        else await portfolios.register("synthetic-access-subject", provider);
        const session = await sessions.create(
          "synthetic-access-subject",
          provider,
        );
        startBoundedPolling({
          check: async () => {
            const next = await getProviderBrowserReconnect(session.id);
            return ["requested", "starting", "ready", "opened"].includes(
              next.status,
            );
          },
          intervalMs: 5_000,
          deadline: Date.parse(session.expiresAt),
          onError: () => undefined,
          onTimeout: () => {
            stopped++;
          },
          environment: {
            now: () => now,
            visible: () => true,
            setTimeout: (callback, delay) => {
              jobs.set(++sequence, { at: now + delay, callback });
              return sequence;
            },
            clearTimeout: (timer) => {
              jobs.delete(timer);
            },
            onVisible: () => () => undefined,
          },
        });
      }
      trace.reset();
      requests = 0;
      const end = now + 86_400_000;
      while (jobs.size > 0) {
        const [id, job] = [...jobs].sort((a, b) => a[1].at - b[1].at)[0]!;
        jobs.delete(id);
        now = job.at;
        expect(now).toBeLessThanOrEqual(end);
        // The real timer callback returns its request promise, so the virtual
        // clock never races a request or substitutes a repository fake.
        await job.callback();
      }
      expect(stopped).toBe(3);
      expect(requests).toBeLessThanOrEqual(failed ? 18 : 540);
      const cost = await replayD1(trace);
      expect(cost.roundTrips).toBe(requests * 2);
      expect(cost.rowsRead).toBeLessThanOrEqual(failed ? 100 : 3_000);
      expect(cost.rowsWritten).toBe(0);
      report(
        JSON.stringify({
          syntheticReconnectBrowserDay: {
            failed,
            requests,
            workerInvocations: requests * 2,
            ...cost,
          },
        }),
      );
    }
  } finally {
    trace.close();
  }
}, 60_000);
