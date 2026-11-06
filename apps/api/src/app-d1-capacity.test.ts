import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { handleCapacityQueue, handleScheduled } from "./index";
import { assertCapacityRouteCoverage, CAPACITY_ROUTES } from "./d1-capacity";
import type { Env } from "./types";

const quota = () =>
  new Error("D1_ERROR", {
    cause: new Error(
      "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
    ),
  });
const now = "2026-09-12T12:00:00.000Z";
function fixture(error: Error | null = null) {
  const query = vi.fn(() => {
    if (error !== null) return Promise.reject(error);
    return Promise.resolve({
      success: true,
      results: [{ allowed: 1 }],
      meta: { rows_read: 3, rows_written: 0 },
    });
  });
  const statement = {
    bind: () => statement,
    all: query,
    first: query,
    run: query,
  } as unknown as D1PreparedStatement;
  const database = {
    prepare: () => statement,
    batch: query,
  } as unknown as D1Database;
  const get = vi.fn();
  const put = vi.fn();
  const env: Env = {
    DB: database,
    DOCUMENTS: { get, put } as unknown as R2Bucket,
    D1_CAPACITY: { get, put } as unknown as R2Bucket,
    ENVIRONMENT: "preview",
    INGESTION_QUEUE: {} as Queue,
    MAC_AGENT_API_ORIGIN: "https://keel.synthetic.invalid",
  };
  const app = createApp({
    verifyAccess: () =>
      Promise.resolve({
        kind: "user",
        subject: "synthetic-access-subject",
        email: null,
      }),
  });
  return { app, env, query, get, put };
}
afterEach(() => vi.useRealTimers());

describe("D1 capacity ingress", () => {
  it("classifies every registered route and rejects missing or stale classifications", () => {
    const app = createApp();
    expect(() => assertCapacityRouteCoverage(app.routes)).not.toThrow();
    expect(() =>
      assertCapacityRouteCoverage([
        ...app.routes,
        { method: "POST", path: "/api/unreviewed-job" },
      ]),
    ).toThrow("classification missing");
    const omitted = app.routes.filter(
      (route) =>
        `${route.method} ${route.path}` !== Object.keys(CAPACITY_ROUTES)[0],
    );
    expect(() => assertCapacityRouteCoverage(omitted)).toThrow(
      "classification is stale",
    );
  });

  it("keeps authenticated projections outside the capacity store", async () => {
    const f = fixture();
    const response = await f.app.request(
      "/api/session",
      { headers: { "Cf-Access-Jwt-Assertion": "synthetic-jwt" } },
      f.env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true });
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.get).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
  });

  it("returns a quota pause after a handler catches exhaustion without reporting invalid credentials", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture(quota());
    const response = await f.app.request(
      "/api/session",
      { headers: { "Cf-Access-Jwt-Assertion": "synthetic-jwt" } },
      f.env,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("43200");
    expect(await response.json()).toMatchObject({
      code: "d1_quota_exhausted",
      retryAt: "2026-09-13T00:00:00.000Z",
      outcome: "unknown",
    });
    expect(f.get).not.toHaveBeenCalled();
  });

  it("keeps a generic session outage unknown without an invented reset", async () => {
    const f = fixture(new Error("synthetic database unavailable"));
    const response = await f.app.request(
      "/api/session",
      { headers: { "Cf-Access-Jwt-Assertion": "synthetic-jwt" } },
      f.env,
    );
    expect(response.status).toBe(503);
    expect(response.headers.has("Retry-After")).toBe(false);
    expect(await response.json()).toEqual({
      error: "Session availability could not be checked.",
    });
  });

  it("does not turn a machine credential database quota failure into401", async () => {
    const f = fixture(quota());
    const response = await f.app.request(
      "https://keel.synthetic.invalid/api/automation/provider-holdings/tokenfolio/mac-agent/lease",
      {
        method: "POST",
        headers: { Authorization: `Bearer keel_agent_v1_${"a".repeat(43)}` },
      },
      f.env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "d1_quota_exhausted" });
    expect(f.get).not.toHaveBeenCalled();
  });

  it("refuses background work with missing capacity configuration before its first query", async () => {
    const f = fixture();
    const response = await f.app.request(
      "/api/automation/provider-holdings/tokenfolio/run",
      {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": "synthetic-jwt" },
      },
      f.env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "d1_budget_unavailable",
      outcome: "not_started",
      retryAt: null,
    });
    expect(f.query).not.toHaveBeenCalled();
  });

  it("requires account admission for an old smoke caller after both existing auth checks", async () => {
    const f = fixture();
    f.env.DEPLOYMENT_SMOKE_TOKEN = "synthetic-smoke-token";
    const denied = await f.app.request(
      "/api/deployment-smoke",
      {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": "synthetic-jwt" },
      },
      f.env,
    );
    expect(denied.status).toBe(403);
    const response = await f.app.request(
      "/api/deployment-smoke",
      {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": "synthetic-jwt",
          "X-Keel-Deployment-Smoke-Token": "synthetic-smoke-token",
        },
      },
      f.env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "d1_budget_unavailable",
      outcome: "not_started",
    });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
  });

  it("isolates overlapping request bindings and preserves the original environment", async () => {
    const f = fixture();
    const original = f.env.DB;
    const headers = { "Cf-Access-Jwt-Assertion": "synthetic-jwt" };
    const results = await Promise.all([
      f.app.request("/api/session", { headers }, f.env),
      f.app.request("/api/session", { headers }, f.env),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(f.env.DB).toBe(original);
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it("fences legacy queue work before claims and leaves denied messages for retry and DLQ", async () => {
    const f = fixture();
    const ack = vi.fn();
    const retry = vi.fn();
    const body = {
      type: "portfolio_watch_source_scan",
      messageId: "10000000-0000-4000-8000-000000000001",
      requestedAt: now,
      sourceId: "synthetic-source",
    };
    await handleCapacityQueue(
      {
        queue: "synthetic-queue",
        messages: [
          {
            id: "synthetic-message",
            timestamp: new Date(now),
            body,
            attempts: 1,
            ack,
            retry,
          },
        ],
        ackAll: ack,
        retryAll: retry,
        metadata: { metrics: { backlogCount: 1, backlogBytes: 512 } },
      },
      f.env,
    );
    expect(f.query).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it("denies cron discovery before any query while queue deferral activation is unavailable", async () => {
    const f = fixture();
    await expect(
      handleScheduled(
        {
          cron: "0 13 * * *",
          scheduledTime: Date.parse(now),
          noRetry: () => undefined,
        },
        f.env,
      ),
    ).rejects.toMatchObject({
      code: "d1_budget_unavailable",
      outcome: "not_started",
    });
    expect(f.query).not.toHaveBeenCalled();
  });
});
