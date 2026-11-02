import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Log, LogLevel, Miniflare } from "miniflare";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createCostDatabase } from "../../../scripts/test-support/d1-cost";
import { measureD1 } from "../../../scripts/test-support/d1-meter";
import { D1MacAgentCredentialRepository } from "../../../packages/database/src/mac-agent-credentials";
import { D1ProviderPortfolioAgentRepository } from "../../../packages/database/src/provider-portfolio-agent";
import { initializeCapacityOwner } from "../../../packages/database/src/d1-capacity";
import { workerCapacityStore } from "../../../packages/database/src/d1-capacity-r2";
import { macAgentApi } from "../../../scripts/mac-agent-auth";
import { runProviderAgentPolling } from "../../../scripts/provider-agent-polling";
import type { Env } from "./types";
import { observeD1 } from "./d1-capacity";
import { D1ServiceUnavailableError } from "@keel/domain/d1-service";

function scope() {
  return {
    check: vi.fn(),
    record: vi.fn(),
    recordUnknown: vi.fn(),
    stage: <T>(_name: string, execute: () => Promise<T>) => execute(),
  };
}

describe("runtime D1 attribution", () => {
  it("attributes actual local D1 rows including index writes and session operations", async () => {
    const directory = mkdtempSync(join(tmpdir(), "keel-runtime-capacity-"));
    const runtime = new Miniflare({
      modules: true,
      script: 'export default {fetch(){return new Response("synthetic");}}',
      d1Databases: ["DB"],
      d1Persist: directory,
      compatibilityDate: "2026-07-28",
      log: new Log(LogLevel.NONE),
    });
    try {
      const db = await runtime.getD1Database("DB");
      await db.batch([
        db.prepare(
          "CREATE TABLE synthetic_rows(id INTEGER PRIMARY KEY, value INTEGER NOT NULL)",
        ),
        db.prepare("CREATE INDEX synthetic_value ON synthetic_rows(value)"),
      ]);
      const observation = observeD1(db);
      const admission = scope();
      observation.attach(admission);
      await observation.database.batch(
        Array.from({ length: 120 }, (_, index) =>
          observation.database
            .prepare("INSERT INTO synthetic_rows(id,value) VALUES (?,?)")
            .bind(index, index),
        ),
      );
      const before = { ...observation.cost };
      const session = observation.database.withSession("first-primary");
      expect(
        await session
          .prepare("SELECT value FROM synthetic_rows WHERE id=?")
          .bind(119)
          .first("value"),
      ).toBe(119);
      expect(
        await observation.database
          .prepare("SELECT value FROM synthetic_rows WHERE id=?")
          .bind(999)
          .first(),
      ).toBeNull();
      await observation.database
        .prepare("UPDATE synthetic_rows SET value=? WHERE id=?")
        .bind(300, 119)
        .run();
      expect(before.writes).toBeGreaterThanOrEqual(240);
      expect(observation.cost.reads).toBeGreaterThan(before.reads);
      expect(observation.cost.writes - before.writes).toBe(2);
      expect(observation.cost.statements).toBe(123);
      expect(observation.cost.unknown).toBe(false);
      expect(admission.record).toHaveBeenCalledTimes(124);
      expect(admission.recordUnknown).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("caps a full authenticated agent day through the real client, repository, D1 and R2 owner", async () => {
    const costDatabase = await createCostDatabase();
    const directory = mkdtempSync(join(tmpdir(), "keel-runtime-day-"));
    const runtime = new Miniflare({
      modules: true,
      script: 'export default {fetch(){return new Response("synthetic");}}',
      r2Buckets: ["CAPACITY"],
      r2Persist: directory,
      compatibilityDate: "2026-07-28",
      log: new Log(LogLevel.NONE),
    });
    let clock = Date.parse("2026-09-12T00:10:00.000Z");
    const end = Date.parse("2026-09-13T00:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const database = costDatabase.database;
      const credentials = new D1MacAgentCredentialRepository(database);
      const portfolios = new D1ProviderPortfolioAgentRepository(database);
      await portfolios.register("synthetic-access-subject", "tokenfolio");
      await portfolios.configure("synthetic-access-subject", "tokenfolio", {
        interval: "off",
      });
      const token = await credentials.issueToken(
        "synthetic-access-subject",
        "tokenfolio",
      );
      const account = "a".repeat(32);
      const databaseId = "10000000-0000-4000-8000-000000000001";
      const revision = "b".repeat(40);
      const key = "operations/d1-capacity/synthetic.json";
      const bucket = (await runtime.getR2Bucket(
        "CAPACITY",
      )) as unknown as R2Bucket;
      const store = workerCapacityStore(bucket, key);
      await initializeCapacityOwner(
        store,
        {
          day: "2026-09-12",
          account,
          databases: [databaseId],
          revisions: [revision],
          inventoryHash: "c".repeat(64),
          bootstrapBasisHash: "d".repeat(64),
          priorUsageUpper: { reads: 0, writes: 0 },
          policies: [
            {
              producer: "agent-maintenance",
              operation: { reads: 10_000, writes: 1_000 },
              daily: { reads: 20_000, writes: 2_000 },
              maxOperations: 2,
              maxDurationMs: 60_000,
              evidenceHash: "e".repeat(64),
            },
          ],
          usage: null,
        },
        clock,
      );
      const measured = measureD1(database);
      const env: Env = {
        DB: measured.database,
        DOCUMENTS: {} as R2Bucket,
        ENVIRONMENT: "preview",
        INGESTION_QUEUE: {} as Queue,
        MAC_AGENT_API_ORIGIN: "https://keel.synthetic.invalid",
        DEPLOYED_GIT_SHA: revision,
        D1_CAPACITY: bucket,
        D1_CAPACITY_ACCOUNT: account,
        D1_CAPACITY_DATABASE: databaseId,
        D1_CAPACITY_KEY: key,
      };
      const app = createApp();
      const requests: number[] = [];
      const transport: typeof fetch = async (input, init) => {
        requests.push(clock);
        return app.request(new Request(input, init), undefined, env);
      };
      const authorization = {
        version: 1 as const,
        target: "tokenfolio" as const,
        apiOrigin: env.MAC_AGENT_API_ORIGIN!,
        token,
      };
      const controller = new AbortController();
      const failures: unknown[] = [];
      await runProviderAgentPolling({
        checkReconnect: async () => {
          const result = await macAgentApi(
            authorization,
            "/api/automation/provider-browser/tokenfolio/mac-agent/lease",
            { method: "POST" },
            transport,
          );
          expect(result.status).toBe(200);
          return "idle";
        },
        checkUpdates: async () => {
          const result = await macAgentApi(
            authorization,
            "/api/automation/provider-holdings/tokenfolio/mac-agent/lease",
            { method: "POST" },
            transport,
          );
          expect(result.status).toBe(200);
        },
        updateIntervalMs: 60_000,
        onError: (error) => {
          failures.push(error);
          return "retryable";
        },
        now: () => clock,
        sleep: (duration) => {
          clock += duration;
          vi.setSystemTime(clock);
          if (clock >= end) controller.abort();
          return Promise.resolve();
        },
        signal: controller.signal,
      });
      expect(requests).toHaveLength(3);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        code: "d1_quota_exhausted",
        outcome: "not_started",
        retryAt: new Date(end).toISOString(),
      });
      expect(measured.cost.rowsRead).toBeLessThan(500);
      expect(measured.cost.rowsWritten).toBeLessThan(100);
      const ledger = (await store.read())!.value as {
        charged: unknown;
        producerCharges: { operations: number }[];
      };
      expect(ledger.charged).toEqual({ reads: 20_000, writes: 2_000 });
      expect(ledger.producerCharges[0]!.operations).toBe(2);
      expect(clock).toBe(end);
    } finally {
      logs.mockRestore();
      vi.useRealTimers();
      await costDatabase.close();
      await runtime.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("marks missing billing metadata unknown instead of inferring cost from results", async () => {
    const statement = {
      all: () => Promise.resolve({ results: [{ value: 1 }], success: true }),
    } as unknown as D1PreparedStatement;
    const db = { prepare: () => statement } as unknown as D1Database;
    const observation = observeD1(db);
    const admission = scope();
    observation.attach(admission);
    await expect(
      observation.database.prepare("SELECT value").all(),
    ).rejects.toBeInstanceOf(D1ServiceUnavailableError);
    expect(observation.cost.unknown).toBe(true);
    expect(admission.recordUnknown).toHaveBeenCalledOnce();
  });

  it("latches confirmed daily exhaustion and does not dispatch another query", async () => {
    const all = vi.fn(() =>
      Promise.reject(
        new Error(
          "Your account has exceeded D1's free tier daily row write limit.",
        ),
      ),
    );
    const statement = { all } as unknown as D1PreparedStatement;
    const observation = observeD1(
      { prepare: () => statement } as unknown as D1Database,
      () => Date.parse("2026-08-20T12:00:00.000Z"),
    );
    await expect(
      observation.database.prepare("SELECT synthetic").all(),
    ).rejects.toThrow("daily row write limit");
    await expect(
      observation.database.prepare("SELECT second").all(),
    ).rejects.toMatchObject({
      code: "d1_quota_exhausted",
      retryAt: "2026-08-21T00:00:00.000Z",
      outcome: "unknown",
    });
    expect(all).toHaveBeenCalledOnce();
  });

  it("refuses unmeasured raw and exec operations before dispatch", async () => {
    const raw = vi.fn();
    const exec = vi.fn();
    const observation = observeD1({
      prepare: () => ({ raw }) as unknown as D1PreparedStatement,
      exec,
    } as unknown as D1Database);
    await expect(
      observation.database.prepare("SELECT synthetic").raw(),
    ).rejects.toMatchObject({
      code: "d1_budget_unavailable",
      outcome: "not_started",
    });
    await expect(
      observation.database.exec("SELECT synthetic"),
    ).rejects.toMatchObject({
      code: "d1_budget_unavailable",
      outcome: "not_started",
    });
    expect(raw).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
});
