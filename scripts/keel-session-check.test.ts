import type { Page } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app";
import type { Env } from "../apps/api/src/types";
import { handleRequest } from "../apps/web/src/worker";
import { waitForKeelSession } from "./keel-session-check";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";

const ORIGIN = new URL("https://keel.example.com");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("bounds all three setup checks through the browser client, auth and real D1 without loading the dashboard", async () => {
  const fixture = await createCostDatabase();
  const measured = measureD1(fixture.database);
  let subject = "synthetic-unprovisioned-subject";
  const app = createApp({
    verifyAccess: async () => ({ kind: "user", subject, email: null }),
  });
  const env: Env = {
    DB: measured.database,
    ENVIRONMENT: "preview",
    DOCUMENTS: {} as R2Bucket,
    INGESTION_QUEUE: {} as Queue,
  };
  let requests = 0;
  let failed = false;
  const report = console.info.bind(console);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    expect(path).toBe("/api/session");
    requests++;
    const response = await handleRequest(
      new Request(new URL(path, ORIGIN), {
        ...init,
        headers: { "Cf-Access-Jwt-Assertion": "synthetic-test-assertion" },
      }),
      {
        API: { fetch: async (request) => app.fetch(request, env) },
        ASSETS: {
          fetch: () => {
            throw new Error("Session check fetched assets");
          },
        },
      },
    );
    return failed
      ? new Response("Synthetic proxy failure", { status: 503 })
      : response;
  });
  const page = {
    url: () => ORIGIN.href,
    evaluate: (callback: () => unknown) => callback(),
  } as unknown as Pick<Page, "url" | "evaluate">;
  try {
    for (const scenario of ["pending", "failure", "ready"] as const) {
      failed = scenario === "failure";
      subject =
        scenario === "pending"
          ? "synthetic-unprovisioned-subject"
          : "synthetic-access-subject";
      measured.reset();
      requests = 0;
      for (let agent = 0; agent < 3; agent++) {
        let now = 0;
        const ready = await waitForKeelSession(page, ORIGIN, 30 * 60_000, {
          now: () => now,
          sleep: (delay) => {
            now += delay;
            return Promise.resolve();
          },
        });
        expect(ready).toBe(scenario === "ready");
        expect(now).toBeLessThanOrEqual(30 * 60_000);
      }
      expect(requests).toBeLessThanOrEqual(
        scenario === "pending" ? 1_080 : scenario === "failure" ? 30 : 3,
      );
      expect(measured.cost.roundTrips).toBe(requests);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(
        scenario === "pending" ? 0 : 120,
      );
      expect(measured.cost.rowsWritten).toBe(0);
      report(
        JSON.stringify({
          syntheticSetupDay: {
            scenario,
            requests,
            workerInvocations: requests * 2,
            ...measured.cost,
          },
        }),
      );
    }
    const unauthenticated = await app.request("/api/session", {}, env);
    expect(unauthenticated.status).toBe(401);
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
  const fixture = await createCostDatabase();
  const measured = measureD1(fixture.database);
  const start = Date.parse("2026-09-01T00:00:00.000Z");
  let now = start;
  const sessions = new D1ProviderBrowserSessionRepository(
    measured.database,
    () => new Date(now),
  );
  const portfolios = new D1ProviderPortfolioAgentRepository(
    measured.database,
    () => new Date(now),
  );
  const angellist = new D1AngelListMacAgentRepository(
    measured.database,
    () => new Date(now),
  );
  const app = createApp({
    providerBrowserSessionRepository: sessions,
    verifyAccess: async () => ({
      kind: "user",
      subject: "synthetic-access-subject",
      email: null,
    }),
  });
  const env: Env = {
    DB: measured.database,
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
      const jobs = new Map<number, { at: number; callback: () => void }>();
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
      measured.reset();
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
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(failed ? 100 : 3_000);
      expect(measured.cost.rowsWritten).toBe(0);
      report(
        JSON.stringify({
          syntheticReconnectBrowserDay: {
            failed,
            requests,
            workerInvocations: requests * 2,
            ...measured.cost,
          },
        }),
      );
    }
  } finally {
    await fixture.close();
  }
}, 60_000);
