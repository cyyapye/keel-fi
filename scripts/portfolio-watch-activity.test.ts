import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  D1PortfolioWatchActivityRepository,
  WATCH_RECENT_RUNS_SQL,
} from "../packages/database/src/portfolio-watch-activity";
import { D1PortfolioWatchRepository } from "../packages/database/src/portfolio-watch";
import {
  __portfolioWatchTest,
  type ApprovedSourceFetchResult,
} from "../apps/api/src/portfolio-watch";
import { createApp } from "../apps/api/src/app";
import { PortfolioWatchSourceJobMessageSchema } from "../packages/connectors/src/index";
import { PortfolioWatchActivitySchema } from "../packages/domain/src/portfolio-watch-activity";
import { handleRequest } from "../apps/web/src/worker";
import {
  loadPortfolioWatchActivity,
  loadPortfolioWatchProgress,
} from "../apps/web/src/api";
import {
  startBoundedPolling,
  type PollingEnvironment,
} from "../apps/web/src/bounded-polling";
import type { Env } from "../apps/api/src/types";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import {
  seedCostHoldings,
  seedCostWatchTargets,
} from "./test-support/cost-fixtures";

const start = "2026-09-12T13:00:00.000Z";
const finish = "2026-09-12T13:01:00.000Z";
const fetchSource: NonNullable<
  Parameters<typeof __portfolioWatchTest.processSourceJob>[2]
>["fetchSource"] = (source) => {
  const text = `<rss version="2.0"><channel><title>${source.companyName}</title><item><title>${source.companyName} acquires Synthetic Harbor</title><link>${source.allowedOrigin}/news/acquisition</link><pubDate>Tue, 01 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  return Promise.resolve({
    ok: true,
    bytes: new TextEncoder().encode(text),
    text,
    contentType: "application/rss+xml",
    status: 200,
    sha256: createHash("sha256").update(text).digest("hex"),
    etag: null,
    lastModified: null,
  });
};

async function setup() {
  const fixture = await createCostDatabase();
  await seedCostHoldings(fixture.database);
  await seedCostWatchTargets(fixture.database);
  await fixture.database
    .prepare("UPDATE portfolio_watch_source_sync_state SET next_check_at = ?")
    .bind(start)
    .run();
  const measured = measureD1(fixture.database);
  const repository = new D1PortfolioWatchRepository(measured.database);
  const activity = new D1PortfolioWatchActivityRepository(measured.database);
  const put = vi.fn(() => Promise.resolve({}));
  const sendBatch = vi
    .fn<(messages: readonly { body: unknown }[]) => Promise<void>>()
    .mockResolvedValue(undefined);
  const env = {
    DB: measured.database,
    DOCUMENTS: { put },
    ENVIRONMENT: "local",
    INGESTION_QUEUE: { sendBatch },
  } as unknown as Env;
  return { ...fixture, measured, repository, activity, put, sendBatch, env };
}

async function fillSourceCoverage(db: D1Database) {
  await db
    .prepare(
      `INSERT INTO portfolio_watch_sources (id, household_id, watch_target_id, company_id, source_kind, source_class, canonical_url, allowed_origin, allowed_path_prefix, status, authority_ppm, identity_confidence_ppm, operational_health_ppm, coverage_json, created_at, updated_at)
    SELECT source.id || '-extra-' || extra.value, source.household_id, source.watch_target_id, source.company_id, source.source_kind, source.source_class,
      source.allowed_origin || '/synthetic-source/' || extra.value, source.allowed_origin, '/', 'discovered', source.authority_ppm, source.identity_confidence_ppm, source.operational_health_ppm, source.coverage_json, source.created_at, source.updated_at
    FROM portfolio_watch_sources source CROSS JOIN json_each(?) extra
    WHERE source.household_id = 'hh_demo' AND source.company_id LIKE 'cost-company-%' AND source.canonical_url = source.allowed_origin || '/'`,
    )
    .bind(JSON.stringify(Array.from({ length: 49 }, (_, index) => index)))
    .run();
  await db
    .prepare(
      `INSERT INTO portfolio_watch_source_sync_state (source_id, next_check_at, updated_at)
    SELECT id, ?, ? FROM portfolio_watch_sources WHERE household_id = 'hh_demo' AND id LIKE '%-extra-%'`,
    )
    .bind(start, start)
    .run();
}

describe("saved Portfolio Watch activity", () => {
  it("admits racing scans once, persists signals before success, and reloads the household projection", async () => {
    const f = await setup();
    try {
      const due = (await f.repository.listDueSourceJobs(start, 40)).slice(0, 3);
      const racers = await Promise.all([
        f.activity.admit(due, "manual", start),
        f.activity.admit(due, "scheduled", start),
      ]);
      expect(racers.map((jobs) => jobs.length).sort()).toEqual([0, 3]);
      const jobs = racers.flat();
      const before = await f.activity.read(
        "synthetic-access-subject",
        null,
        start,
      );
      expect(before.runs[0]).toMatchObject({
        status: "queued",
        totalCount: 3,
        completedCount: 0,
      });
      await __portfolioWatchTest.processSourceJob(
        { ...jobs[0]!, requestedAt: start },
        f.env,
        { fetchSource, now: () => finish },
      );
      await __portfolioWatchTest.processSourceJob(
        { ...jobs[1]!, requestedAt: start },
        f.env,
        {
          now: () => finish,
          fetchSource: (): Promise<ApprovedSourceFetchResult> =>
            Promise.resolve({
              ok: false,
              reason: "source_timeout",
              permanent: false,
              status: null,
              contentType: null,
              redirectUrl: null,
            }),
        },
      );
      await f.database
        .prepare(
          "UPDATE portfolio_watch_targets SET status = 'paused' WHERE id = (SELECT watch_target_id FROM portfolio_watch_sources WHERE id = ?)",
        )
        .bind(jobs[2]!.sourceId)
        .run();
      await __portfolioWatchTest.processSourceJob(
        { ...jobs[2]!, requestedAt: start },
        f.env,
        { fetchSource, now: () => finish },
      );
      const after = await f.activity.read(
        "synthetic-access-subject",
        null,
        finish,
      );
      expect(after.runs[0]).toMatchObject({
        status: "partial",
        totalCount: 3,
        completedCount: 3,
        succeededCount: 1,
        failedCount: 1,
        skippedCount: 1,
        signalCount: 1,
        completedAt: finish,
      });
      expect(
        await f.database
          .prepare(
            "SELECT last_completed_success_at FROM portfolio_watch_source_sync_state WHERE source_id = ?",
          )
          .bind(jobs[0]!.sourceId)
          .first("last_completed_success_at"),
      ).toBe(finish);
      expect(
        await f.database
          .prepare(
            "SELECT last_completed_success_at FROM portfolio_watch_source_sync_state WHERE source_id = ?",
          )
          .bind(jobs[1]!.sourceId)
          .first("last_completed_success_at"),
      ).toBeNull();
      f.put.mockClear();
      f.measured.reset();
      await __portfolioWatchTest.processSourceJob(
        { ...jobs[0]!, requestedAt: start },
        f.env,
        { fetchSource, now: () => finish },
      );
      expect(f.put).not.toHaveBeenCalled();
      expect(f.measured.cost.rowsWritten).toBe(0);
      const response = await createApp().request(
        "/api/watch/activity",
        undefined,
        f.env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(
        PortfolioWatchActivitySchema.parse(await response.json()).runs[0],
      ).toMatchObject({ signalCount: 1, status: "partial" });
      await expect(
        f.activity.read("unprovisioned-synthetic-user"),
      ).rejects.toThrow("not found");

      // Exercise the actual manual producer as well as the admission race.
      // Selecting sources stays read-only; this explicit POST creates the run.
      f.measured.reset();
      const submitted = await createApp().request(
        "/api/watch/scan",
        { method: "POST" },
        f.env,
      );
      expect(submitted.status).toBe(202);
      expect(await submitted.json()).toMatchObject({ queuedCount: 40 });
      expect(f.measured.cost.roundTrips).toBe(5);
      expect(f.measured.cost.rowsRead).toBeLessThanOrEqual(10_000);
      expect(f.measured.cost.rowsWritten).toBeLessThanOrEqual(1_000);
      const sent = Array.from(f.sendBatch.mock.calls[0]?.[0] ?? [], (message) =>
        PortfolioWatchSourceJobMessageSchema.parse(message.body),
      );
      expect(sent).toHaveLength(40);
      expect(new Set(sent.map((message) => message.messageId)).size).toBe(40);
      const manual = await f.activity.read("synthetic-access-subject");
      expect(manual.runs[0]).toMatchObject({
        trigger: "manual",
        totalCount: 40,
        status: "queued",
      });
      expect(new Set(sent.map((message) => message.runId))).toEqual(
        new Set([manual.runs[0]!.id]),
      );
    } finally {
      await f.close();
    }
  }, 120_000);

  it("recovers an interrupted completion without losing attribution, and bounds retry exhaustion", async () => {
    const f = await setup();
    try {
      const due = (await f.repository.listDueSourceJobs(start, 40)).slice(0, 2);
      const jobs = await f.activity.admit(due, "manual", start);
      const interrupted = vi
        .spyOn(D1PortfolioWatchActivityRepository.prototype, "finish")
        .mockRejectedValueOnce(new Error("synthetic completion outage"));
      await expect(
        __portfolioWatchTest.processSourceJob(
          { ...jobs[0]!, requestedAt: start },
          f.env,
          { fetchSource, now: () => finish },
        ),
      ).rejects.toThrow();
      interrupted.mockRestore();
      await __portfolioWatchTest.processSourceJob(
        { ...jobs[0]!, requestedAt: start },
        f.env,
        { fetchSource, now: () => finish },
      );
      expect(
        await f.database
          .prepare(
            "SELECT state, signal_count, attempts FROM portfolio_watch_checks WHERE id = ?",
          )
          .bind(jobs[0]!.messageId)
          .first(),
      ).toEqual({ state: "succeeded", signal_count: 1, attempts: 2 });
      f.put.mockRejectedValue(new Error("synthetic storage outage"));
      for (let attempt = 0; attempt < 4; attempt++) {
        const promise = __portfolioWatchTest.processSourceJob(
          { ...jobs[1]!, requestedAt: start },
          f.env,
          { fetchSource, now: () => finish },
        );
        if (attempt < 3) await expect(promise).rejects.toThrow();
        else await promise;
      }
      expect(
        await f.database
          .prepare(
            "SELECT state, attempts, error_code FROM portfolio_watch_checks WHERE id = ?",
          )
          .bind(jobs[1]!.messageId)
          .first(),
      ).toEqual({
        state: "failed",
        attempts: 4,
        error_code: "processing_failed",
      });
      expect(
        await f.database
          .prepare(
            "SELECT next_check_at FROM portfolio_watch_source_sync_state WHERE source_id = ?",
          )
          .bind(jobs[1]!.sourceId)
          .first("next_check_at"),
      ).toBe("2026-09-12T14:01:00.000Z");
      expect(
        (await f.activity.read("synthetic-access-subject", null, finish))
          .runs[0]?.status,
      ).toBe("partial");
    } finally {
      vi.restoreAllMocks();
      await f.close();
    }
  }, 120_000);

  it("projects timeouts without writes and rejects a late completion after explicit recovery", async () => {
    const f = await setup();
    try {
      const due = (await f.repository.listDueSourceJobs(start, 40)).slice(0, 1);
      const [old] = await f.activity.admit(due, "manual", start);
      const claim = await f.activity.claim(old!, start);
      expect(typeof claim).toBe("object");
      const later = "2026-09-12T13:16:00.000Z";
      f.measured.reset();
      const expired = await f.activity.read(
        "synthetic-access-subject",
        null,
        later,
      );
      expect(expired.runs[0]?.status).toBe("timed_out");
      expect(
        expired.companies
          .flatMap((company) => company.sources)
          .find((source) => source.id === old!.sourceId)?.pendingState,
      ).toBe("timed_out");
      expect(expired.summary.unavailableCount).toBeGreaterThan(0);
      expect(f.measured.cost.rowsWritten).toBe(0);
      const [fresh] = await f.activity.admit(due, "manual", later);
      expect(fresh).toBeDefined();
      expect(
        await f.database
          .prepare(
            "SELECT last_check_error_code FROM portfolio_watch_source_sync_state WHERE source_id = ?",
          )
          .bind(old!.sourceId)
          .first("last_check_error_code"),
      ).toBe("check_timed_out");
      await __portfolioWatchTest.processSourceJob(
        { ...fresh!, requestedAt: later },
        f.env,
        { fetchSource, now: () => later },
      );
      if (typeof claim === "object")
        await f.activity.finish(old!, claim.token, later, "succeeded", null);
      expect(
        await f.database
          .prepare(
            "SELECT state, error_code FROM portfolio_watch_checks WHERE id = ?",
          )
          .bind(old!.messageId)
          .first(),
      ).toEqual({ state: "failed", error_code: "check_timed_out" });
      expect(
        (await f.activity.read("synthetic-access-subject", null, later)).runs[0]
          ?.status,
      ).toBe("succeeded");
    } finally {
      await f.close();
    }
  }, 120_000);

  it("keeps 120-company reads bounded as same-date history grows", async () => {
    const f = await setup();
    try {
      const initial = await f.activity.read(
        "synthetic-access-subject",
        null,
        start,
      );
      expect(initial.summary.companyCount).toBeGreaterThanOrEqual(120);
      expect(initial.companies).toHaveLength(20);
      expect(initial.nextCursor).not.toBeNull();
      const due = await f.repository.listDueSourceJobs(start, 40);
      const jobs = await f.activity.admit(due, "scheduled", start);
      for (const job of jobs) {
        const claim = await f.activity.claim(job, start);
        if (typeof claim === "object")
          await f.activity.finish(job, claim.token, finish, "succeeded", null);
      }
      f.measured.reset();
      await f.activity.read("synthetic-access-subject", null, finish);
      const before = { ...f.measured.cost };
      const entries = JSON.stringify(
        Array.from({ length: 120 }, (_, index) => index),
      );
      await f.database.batch([
        f.database
          .prepare(
            `INSERT INTO portfolio_watch_runs (id, household_id, trigger_kind, requested_at, deadline_at)
          SELECT 'history-' || value, 'hh_demo', 'scheduled', '2026-09-01T13:00:00.000Z', '2026-09-01T13:15:00.000Z' FROM json_each(?)`,
          )
          .bind(entries),
        f.database
          .prepare(
            `INSERT INTO portfolio_watch_checks (id, run_id, source_id, state, requested_at, completed_at)
          SELECT 'history-' || history.value || '-' || source.value, 'history-' || history.value, json_extract(source.value, '$.sourceId'), 'succeeded',
            '2026-09-01T13:00:00.000Z', '2026-09-01T13:01:00.000Z' FROM json_each(?) history CROSS JOIN json_each(?) source`,
          )
          .bind(entries, JSON.stringify(jobs)),
      ]);
      f.measured.reset();
      const state = await f.activity.read(
        "synthetic-access-subject",
        null,
        finish,
      );
      expect(state.runs).toHaveLength(20);
      expect(f.measured.cost.roundTrips).toBe(5);
      expect(f.measured.cost.rowsWritten).toBe(0);
      expect(f.measured.cost.rowsRead).toBeLessThan(5_000);
      expect(before.roundTrips).toBe(5);
      const historicalRead = { ...f.measured.cost };
      // Add more same-timestamp history per returned run and a separate household.
      await f.database.batch([
        f.database
          .prepare(
            `INSERT INTO users (id, access_subject, email, display_name, created_at)
          VALUES ('watch-other-user', 'watch-other-subject', 'watch-other@example.invalid', 'Synthetic other user', ?),
                 ('watch-empty-user', 'watch-empty-subject', 'watch-empty@example.invalid', 'Synthetic empty user', ?)`,
          )
          .bind(start, start),
        f.database
          .prepare(
            `INSERT INTO households (id, owner_user_id, name, base_currency, created_at)
          VALUES ('watch-other-household', 'watch-other-user', 'Synthetic other household', 'USD', ?),
                 ('watch-empty-household', 'watch-empty-user', 'Synthetic empty household', 'USD', ?)`,
          )
          .bind(start, start),
        f.database
          .prepare(`INSERT INTO companies (id, household_id, legal_name, website_host, status, created_at, updated_at)
          SELECT 'other-' || id, 'watch-other-household', legal_name, website_host, status, created_at, updated_at FROM companies WHERE household_id = 'hh_demo'`),
        f.database
          .prepare(`INSERT INTO portfolio_watch_targets (id, household_id, company_id, status, source_policy, created_at)
          SELECT 'other-' || id, 'watch-other-household', 'other-' || company_id, status, source_policy, created_at FROM portfolio_watch_targets WHERE household_id = 'hh_demo'`),
        f.database
          .prepare(`INSERT INTO portfolio_watch_sources (id, household_id, watch_target_id, company_id, source_kind, source_class, canonical_url, allowed_origin, allowed_path_prefix, status, authority_ppm, identity_confidence_ppm, operational_health_ppm, coverage_json, created_at, updated_at)
          SELECT 'other-' || id, 'watch-other-household', 'other-' || watch_target_id, 'other-' || company_id, source_kind, source_class, canonical_url, allowed_origin, allowed_path_prefix, status, authority_ppm, identity_confidence_ppm, operational_health_ppm, coverage_json, created_at, updated_at
          FROM portfolio_watch_sources WHERE household_id = 'hh_demo'`),
        f.database
          .prepare(`INSERT INTO portfolio_watch_runs (id, household_id, trigger_kind, requested_at, deadline_at)
          SELECT 'extra-' || id, household_id, trigger_kind, requested_at, deadline_at FROM portfolio_watch_runs WHERE id LIKE 'history-%'`),
        f.database
          .prepare(`INSERT INTO portfolio_watch_checks (id, run_id, source_id, state, requested_at, completed_at)
          SELECT 'extra-' || id, 'extra-' || run_id, source_id, state, requested_at, completed_at FROM portfolio_watch_checks WHERE run_id LIKE 'history-%'`),
        f.database
          .prepare(`INSERT INTO portfolio_watch_runs (id, household_id, trigger_kind, requested_at, deadline_at)
          SELECT 'other-' || id, 'watch-other-household', trigger_kind, requested_at, deadline_at FROM portfolio_watch_runs WHERE household_id = 'hh_demo'`),
        f.database
          .prepare(`INSERT INTO portfolio_watch_checks (id, run_id, source_id, state, requested_at, completed_at)
          SELECT 'other-' || id, 'other-' || run_id, 'other-' || source_id, state, requested_at, completed_at FROM portfolio_watch_checks WHERE run_id NOT LIKE 'other-%'`),
      ]);
      f.measured.reset();
      const grown = await f.activity.read(
        "synthetic-access-subject",
        null,
        finish,
      );
      expect(grown.runs.map((run) => run.id)).toEqual(
        state.runs.map((run) => run.id),
      );
      expect(f.measured.cost.rowsRead).toBeLessThanOrEqual(
        historicalRead.rowsRead + 20,
      );
      expect(f.measured.cost.roundTrips).toBe(5);
      const empty = await f.activity.read("watch-empty-subject", null, finish);
      expect(empty).toMatchObject({
        companies: [],
        runs: [],
        summary: { companyCount: 0, sourceCount: 0 },
      });
      f.measured.reset();
      const pageTwo = await f.activity.read(
        "synthetic-access-subject",
        initial.nextCursor,
        finish,
      );
      expect(pageTwo.companies).toHaveLength(20);
      expect(
        pageTwo.companies.some((company) =>
          initial.companies.some((first) => first.id === company.id),
        ),
      ).toBe(false);
      expect(f.measured.cost.rowsRead).toBeLessThan(5_000);
      expect(f.measured.cost.rowsWritten).toBe(0);
      const sourcesQuery = [...f.measured.queries].find((query) =>
        query.includes("AS pendingState"),
      )!;
      const sourcePlan = (
        await f.database
          .prepare(`EXPLAIN QUERY PLAN ${sourcesQuery}`)
          .bind(
            finish,
            "hh_demo",
            JSON.stringify(pageTwo.companies.map((company) => company.id)),
          )
          .all<{ detail: string }>()
      ).results
        .map((row) => row.detail)
        .join("\n");
      expect(sourcePlan).toContain("portfolio_watch_sources_page_idx");
      expect(sourcePlan).toContain("portfolio_watch_checks_active_source_idx");
      expect(sourcePlan).not.toMatch(/SCAN (?:portfolio_watch_checks|checks)/);
      const plan = (
        await f.database
          .prepare(`EXPLAIN QUERY PLAN ${WATCH_RECENT_RUNS_SQL}`)
          .bind("hh_demo")
          .all<{ detail: string }>()
      ).results
        .map((row) => row.detail)
        .join("\n");
      expect(plan).toContain("portfolio_watch_runs_recent_idx");
      expect(plan).toContain("portfolio_watch_checks_run_idx");
      expect(plan).not.toMatch(/SCAN (?:portfolio_watch_checks|checks)/);
      console.info(JSON.stringify({ watchActivityRead: f.measured.cost }));
      await fillSourceCoverage(f.database);
      f.measured.reset();
      const full = await f.activity.read(
        "synthetic-access-subject",
        null,
        finish,
      );
      expect(full.summary.sourceCount).toBeGreaterThanOrEqual(6_000);
      expect(full.companies).toHaveLength(20);
      expect(full.companies.flatMap((company) => company.sources)).toHaveLength(
        1_000,
      );
      expect(f.measured.cost.roundTrips).toBe(5);
      expect(f.measured.cost.rowsRead).toBeLessThan(30_000);
      // Negative control: the former full-coverage poll would exceed the
      // unchanged daily budget even though each individual read is indexed.
      expect(f.measured.cost.rowsRead * 90).toBeGreaterThan(450_000);
      console.info(JSON.stringify({ watchFullCoverageRead: f.measured.cost }));
      f.measured.reset();
      const progress = await f.activity.readProgress(
        "synthetic-access-subject",
        jobs[0]!.runId,
        finish,
      );
      expect(progress.sources).toHaveLength(40);
      expect(f.measured.cost.roundTrips).toBe(3);
      expect(f.measured.cost.rowsRead).toBeLessThan(3_000);
      expect(f.measured.cost.rowsWritten).toBe(0);
      console.info(JSON.stringify({ watchProgressRead: f.measured.cost }));
      expect(
        (
          await f.activity.readProgress(
            "watch-other-subject",
            jobs[0]!.runId,
            finish,
          )
        ).sources,
      ).toEqual([]);
    } finally {
      await f.close();
    }
  }, 120_000);
  it("bounds a full day through the client, proxy, authentication and D1, and detects completion within ten seconds", async () => {
    const f = await setup();
    const log = console.info.bind(console);
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(start);
      const jobs = await f.activity.admit(
        await f.repository.listDueSourceJobs(start, 40),
        "manual",
        start,
      );
      await fillSourceCoverage(f.database);
      const history = JSON.stringify(
        Array.from({ length: 19 }, (_, index) => index),
      );
      await f.database.batch([
        f.database
          .prepare(
            `INSERT INTO portfolio_watch_runs (id, household_id, trigger_kind, requested_at, deadline_at)
          SELECT 'poll-history-' || value, 'hh_demo', 'scheduled', '2026-09-01T13:00:00.000Z', '2026-09-01T13:15:00.000Z' FROM json_each(?)`,
          )
          .bind(history),
        f.database
          .prepare(
            `INSERT INTO portfolio_watch_checks (id, run_id, source_id, state, requested_at, completed_at)
          SELECT 'poll-history-' || history.value || '-' || source.value, 'poll-history-' || history.value, json_extract(source.value, '$.sourceId'), 'succeeded',
            '2026-09-01T13:00:00.000Z', '2026-09-01T13:01:00.000Z' FROM json_each(?) history CROSS JOIN json_each(?) source`,
          )
          .bind(history, JSON.stringify(jobs)),
      ]);
      let authorized = true;
      let authenticated = 0;
      const app = createApp({
        verifyAccess: () => {
          authenticated++;
          if (!authorized) throw new Error("Synthetic expired credential");
          return Promise.resolve({
            kind: "user" as const,
            subject: "synthetic-access-subject",
            email: null,
          });
        },
      });
      const env = { ...f.env, ENVIRONMENT: "preview" } as Env;
      let http = 0;
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
        http++;
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return handleRequest(
          new Request(new URL(path, "https://keel.example"), {
            ...init,
            headers: { "Cf-Access-Jwt-Assertion": "synthetic-test-assertion" },
          }),
          {
            API: { fetch: async (request) => app.fetch(request, env) },
            ASSETS: {
              fetch: () => {
                throw new Error("Watch GET requested an asset");
              },
            },
          },
        );
      });
      for (const scenario of [
        "active",
        "hidden",
        "unauthorized",
        "completed",
      ] as const) {
        vi.setSystemTime(start);
        authorized = scenario !== "unauthorized";
        http = 0;
        authenticated = 0;
        f.measured.reset();
        let now = Date.parse(start);
        let visible = scenario !== "hidden";
        let sequence = 0;
        const timers = new Map<
          number,
          { at: number; callback: () => void | Promise<void> }
        >();
        let onVisible: () => void = () => undefined;
        const environment: PollingEnvironment = {
          now: () => now,
          visible: () => visible,
          setTimeout: (callback, delay) => {
            const id = ++sequence;
            timers.set(id, { at: now + delay, callback });
            return id;
          },
          clearTimeout: (id) => {
            timers.delete(id);
          },
          onVisible: (callback) => {
            onVisible = callback;
            return () => {
              onVisible = () => undefined;
            };
          },
        };
        const timeout = vi.fn();
        let detectedAt: number | null = null;
        const check = async () => {
          const state = await loadPortfolioWatchProgress(jobs[0]!.runId);
          const active = state.runs.some((run) =>
            ["queued", "running"].includes(run.status),
          );
          if (!active) {
            detectedAt = now;
            await loadPortfolioWatchActivity();
          }
          return active;
        };
        // Initial read is budgeted separately from the bounded foreground loop.
        await loadPortfolioWatchActivity().catch(() => undefined);
        startBoundedPolling({
          environment,
          intervalMs: 10_000,
          deadline: Date.parse(start) + 900_000,
          check,
          onError: () => undefined,
          onTimeout: timeout,
        });
        if (scenario === "completed") {
          const initialReadCost = { ...f.measured.cost };
          for (const job of jobs) {
            const claim = await f.activity.claim(job, start);
            if (typeof claim === "object")
              await f.activity.finish(
                job,
                claim.token,
                start,
                "succeeded",
                null,
              );
          }
          f.measured.reset(); // Exclude worker writes while retaining the initial browser read.
          Object.assign(f.measured.cost, initialReadCost);
        }
        while (timers.size > 0) {
          const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0]!;
          if (timer.at > Date.parse(start) + 86_400_000) break;
          timers.delete(id);
          now = timer.at;
          vi.setSystemTime(now);
          onVisible();
          onVisible(); // Repeated focus notifications cannot bypass the clock.
          await timer.callback();
        }
        now = Date.parse(start) + 86_400_000;
        vi.setSystemTime(now);
        visible = true;
        onVisible();
        expect(timers.size).toBe(0);
        expect(authenticated).toBe(http);
        expect(http).toBeLessThanOrEqual(
          scenario === "active"
            ? 90
            : scenario === "unauthorized"
              ? 6
              : scenario === "hidden"
                ? 1
                : 3,
        );
        expect(f.measured.cost.rowsRead).toBeLessThanOrEqual(450_000);
        expect(f.measured.cost.rowsWritten).toBe(0);
        expect(f.measured.cost.roundTrips).toBeLessThanOrEqual(450);
        if (scenario === "completed") {
          expect(detectedAt).toBe(Date.parse(start) + 10_000);
          expect(timeout).not.toHaveBeenCalled();
        } else expect(timeout).toHaveBeenCalledOnce();
        if (scenario === "unauthorized")
          expect(f.measured.cost.roundTrips).toBe(0);
        log(
          JSON.stringify({
            watchForegroundDay: {
              scenario,
              http,
              workerInvocations: 2 * http,
              authenticated,
              ...f.measured.cost,
            },
          }),
        );
      }
      expect(f.put).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      await f.close();
    }
  }, 120_000);
});
