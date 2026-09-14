import { z } from "zod";
import {
  PortfolioWatchActivitySchema,
  PortfolioWatchProgressSchema,
  type PortfolioWatchProgress,
  type PortfolioWatchActivity,
  type WatchRun,
} from "@keel/domain/portfolio-watch-activity";

const JobSchema = z.object({
  type: z.enum([
    "portfolio_watch_source_scan",
    "portfolio_watch_source_verify",
  ]),
  sourceId: z.string().min(1),
});
type Job = z.infer<typeof JobSchema>;
export type TrackedWatchJob = Job & { messageId: string; runId: string };
export const WATCH_CHECK_DEADLINE_MS = 15 * 60_000;
const iso = z.iso.datetime({ offset: true });
const after = (time: string, milliseconds: number) =>
  new Date(Date.parse(time) + milliseconds).toISOString();

export const WATCH_RECENT_RUNS_SQL = `
  SELECT run.id, run.trigger_kind, run.requested_at, run.deadline_at,
    MIN(checks.started_at) AS started_at, MAX(checks.completed_at) AS completed_at,
    COUNT(*) AS total_count,
    SUM(checks.state IN ('succeeded', 'failed', 'skipped')) AS completed_count,
    SUM(checks.state = 'succeeded') AS succeeded_count,
    SUM(checks.state = 'failed') AS failed_count,
    SUM(checks.state = 'skipped') AS skipped_count,
    SUM(checks.signal_count) AS signal_count
  FROM (SELECT * FROM portfolio_watch_runs WHERE household_id = ?
    ORDER BY requested_at DESC, id DESC LIMIT 20) run
  JOIN portfolio_watch_checks checks ON checks.run_id = run.id
  GROUP BY run.id ORDER BY run.requested_at DESC, run.id DESC`;

const WATCH_SOURCE_FIELDS_SQL = `SELECT source.id, source.watch_target_id AS targetId, source.canonical_url AS url,
      source.source_kind AS kind, source.status,
      CASE WHEN checks.started_at > COALESCE(sync.last_attempt_at, '') THEN checks.started_at ELSE sync.last_attempt_at END AS lastAttemptAt,
      sync.last_completed_at AS lastCompletedAt, sync.last_completed_success_at AS lastSuccessAt,
      CASE WHEN source.status IN ('discovered', 'verified', 'active', 'degraded') THEN sync.next_check_at END AS nextCheckAt,
      CASE WHEN run.deadline_at <= ? THEN 'timed_out' ELSE checks.state END AS pendingState,
      sync.last_check_outcome AS outcome, COALESCE(sync.last_check_error_code, sync.last_error_code) AS errorCode,
      COALESCE(sync.last_signal_count, 0) AS signalCount
`;
const WATCH_SOURCE_JOINS_SQL = `LEFT JOIN portfolio_watch_source_sync_state sync ON sync.source_id = source.id
      LEFT JOIN portfolio_watch_checks checks ON checks.source_id = source.id AND checks.state IN ('queued', 'running')
      LEFT JOIN portfolio_watch_runs run ON run.id = checks.run_id`;

export class D1PortfolioWatchActivityRepository {
  public constructor(private readonly db: D1Database) {}

  /** Admission, expiry recovery and capacity enforcement share one transaction. */
  public async admit(
    rawJobs: readonly Job[],
    trigger: "manual" | "scheduled",
    rawRequestedAt: string,
  ): Promise<TrackedWatchJob[]> {
    const jobs = z.array(JobSchema).max(40).parse(rawJobs);
    const requestedAt = new Date(iso.parse(rawRequestedAt)).toISOString();
    if (jobs.length === 0) return [];
    const sources = (
      await this.db
        .prepare(
          `SELECT source.id, source.household_id
      FROM portfolio_watch_sources source JOIN portfolio_watch_targets target ON target.id = source.watch_target_id
      WHERE source.id IN (SELECT json_extract(value, '$.sourceId') FROM json_each(?))
        AND source.status IN ('discovered', 'verified', 'active', 'degraded') AND target.status = 'active'`,
        )
        .bind(JSON.stringify(jobs))
        .all<{ id: string; household_id: string }>()
    ).results;
    const runIds = new Map<string, string>();
    const bySource = new Map(jobs.map((job) => [job.sourceId, job]));
    const inputs = sources.map((source) => {
      const runId = runIds.get(source.household_id) ?? crypto.randomUUID();
      runIds.set(source.household_id, runId);
      return {
        ...bySource.get(source.id)!,
        householdId: source.household_id,
        runId,
        messageId: crypto.randomUUID(),
      };
    });
    if (inputs.length === 0) return [];
    const encoded = JSON.stringify(inputs);
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE portfolio_watch_source_sync_state AS sync SET
        last_completed_at = run.deadline_at, last_check_requested_at = checks.requested_at,
        last_check_outcome = 'failed', last_check_error_code = 'check_timed_out',
        last_signal_count = (SELECT COUNT(*) FROM public_source_observations WHERE watch_check_id = checks.id)
        FROM portfolio_watch_checks checks JOIN portfolio_watch_runs run ON run.id = checks.run_id
        WHERE checks.source_id IN (SELECT json_extract(value, '$.sourceId') FROM json_each(?))
          AND checks.state IN ('queued', 'running') AND run.deadline_at <= ?
          AND sync.source_id = checks.source_id
          AND (sync.last_check_requested_at IS NULL OR sync.last_check_requested_at <= checks.requested_at)`,
        )
        .bind(encoded, requestedAt),
      this.db
        .prepare(
          `UPDATE portfolio_watch_checks SET state = 'failed', completed_at = ?, error_code = 'check_timed_out', lease_token = NULL, lease_until = NULL,
        signal_count = (SELECT COUNT(*) FROM public_source_observations WHERE watch_check_id = portfolio_watch_checks.id)
        WHERE source_id IN (SELECT json_extract(value, '$.sourceId') FROM json_each(?)) AND state IN ('queued', 'running')
          AND EXISTS (SELECT 1 FROM portfolio_watch_runs run WHERE run.id = run_id AND run.deadline_at <= ?)`,
        )
        .bind(requestedAt, encoded, requestedAt),
      this.db
        .prepare(
          `INSERT INTO portfolio_watch_runs (id, household_id, trigger_kind, requested_at, deadline_at)
        SELECT DISTINCT json_extract(value, '$.runId'), json_extract(value, '$.householdId'), ?, ?, ?
        FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM portfolio_watch_checks checks
          WHERE checks.source_id = json_extract(value, '$.sourceId') AND checks.state IN ('queued', 'running'))`,
        )
        .bind(
          trigger,
          requestedAt,
          after(requestedAt, WATCH_CHECK_DEADLINE_MS),
          encoded,
        ),
      this.db
        .prepare(
          `INSERT INTO portfolio_watch_checks (id, run_id, source_id, state, requested_at)
        SELECT json_extract(value, '$.messageId'), run.id, json_extract(value, '$.sourceId'), 'queued', ?
        FROM json_each(?) JOIN portfolio_watch_runs run ON run.id = json_extract(value, '$.runId')
        WHERE NOT EXISTS (SELECT 1 FROM portfolio_watch_checks checks
          WHERE checks.source_id = json_extract(value, '$.sourceId') AND checks.state IN ('queued', 'running'))`,
        )
        .bind(requestedAt, encoded),
    ]);
    const admitted = (
      await this.db
        .prepare(
          `SELECT id FROM portfolio_watch_checks
      WHERE run_id IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify([...runIds.values()]))
        .all<{ id: string }>()
    ).results;
    const ids = new Set(admitted.map((row) => row.id));
    return inputs
      .filter((job) => ids.has(job.messageId))
      .map(({ type, sourceId, messageId, runId }) => ({
        type,
        sourceId,
        messageId,
        runId,
      }));
  }

  public async claim(
    job: TrackedWatchJob,
    now: string,
  ): Promise<{ token: string; attempts: number } | "busy" | "finished"> {
    const token = crypto.randomUUID();
    const claimed = await this.db
      .prepare(
        `UPDATE portfolio_watch_checks
      SET state = 'running', lease_token = ?, lease_until = ?, started_at = COALESCE(started_at, ?), attempts = attempts + 1
      WHERE id = ? AND run_id = ? AND source_id = ? AND state IN ('queued', 'running') AND attempts < 4
        AND (lease_until IS NULL OR lease_until <= ?)
        AND EXISTS (SELECT 1 FROM portfolio_watch_runs run WHERE run.id = run_id AND run.deadline_at > ?)
      RETURNING attempts`,
      )
      .bind(
        token,
        after(now, 120_000),
        now,
        job.messageId,
        job.runId,
        job.sourceId,
        now,
        now,
      )
      .first<{ attempts: number }>();
    if (claimed !== null) return { token, attempts: claimed.attempts };
    const pending = await this.db
      .prepare(
        `SELECT checks.id FROM portfolio_watch_checks checks
      JOIN portfolio_watch_runs run ON run.id = checks.run_id
      WHERE checks.id = ? AND checks.run_id = ? AND checks.source_id = ?
        AND checks.state IN ('queued', 'running') AND run.deadline_at > ?`,
      )
      .bind(job.messageId, job.runId, job.sourceId, now)
      .first();
    return pending === null ? "finished" : "busy";
  }

  public async release(job: TrackedWatchJob, token: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE portfolio_watch_checks SET state = 'queued', lease_token = NULL, lease_until = NULL, error_code = 'processing_retry'
      WHERE id = ? AND run_id = ? AND state = 'running' AND lease_token = ?`,
      )
      .bind(job.messageId, job.runId, token)
      .run();
  }

  public async finish(
    job: TrackedWatchJob,
    token: string,
    now: string,
    state: "succeeded" | "failed" | "skipped",
    errorCode: string | null,
  ): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE portfolio_watch_checks SET state = ?, completed_at = ?, error_code = ?,
        signal_count = (SELECT COUNT(*) FROM public_source_observations WHERE watch_check_id = ?)
        WHERE id = ? AND run_id = ? AND source_id = ? AND state = 'running' AND lease_token = ?
          AND EXISTS (SELECT 1 FROM portfolio_watch_runs run WHERE run.id = run_id AND run.deadline_at > ?)`,
        )
        .bind(
          state,
          now,
          errorCode,
          job.messageId,
          job.messageId,
          job.runId,
          job.sourceId,
          token,
          now,
        ),
      this.db
        .prepare(
          `UPDATE portfolio_watch_source_sync_state SET
        last_completed_at = ?, last_check_requested_at = (SELECT requested_at FROM portfolio_watch_checks WHERE id = ?),
        last_completed_success_at = CASE WHEN ? = 'succeeded' THEN ? ELSE last_completed_success_at END,
        last_check_outcome = ?, last_check_error_code = ?,
        next_check_at = CASE WHEN ? = 'failed' THEN MIN(next_check_at, ?) ELSE next_check_at END,
        last_signal_count = (SELECT signal_count FROM portfolio_watch_checks WHERE id = ?)
        WHERE source_id = ? AND EXISTS (SELECT 1 FROM portfolio_watch_checks checks
          WHERE checks.id = ? AND checks.state = ? AND checks.lease_token = ? AND checks.completed_at = ?
            AND (last_check_requested_at IS NULL OR last_check_requested_at <= checks.requested_at))`,
        )
        .bind(
          now,
          job.messageId,
          state,
          now,
          state,
          errorCode,
          state,
          after(now, 3_600_000),
          job.messageId,
          job.sourceId,
          job.messageId,
          state,
          token,
          now,
        ),
    ]);
  }

  private async householdId(accessSubject: string): Promise<string> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id FROM households household
      JOIN users user ON user.id = household.owner_user_id WHERE user.access_subject = ? ORDER BY household.created_at LIMIT 1`,
      )
      .bind(accessSubject)
      .first<{ household_id: string }>();
    if (identity === null) throw new Error("Watch household not found");
    return identity.household_id;
  }

  private async recentRuns(
    householdId: string,
    now: string,
  ): Promise<WatchRun[]> {
    const runResult = await this.db
      .prepare(WATCH_RECENT_RUNS_SQL)
      .bind(householdId)
      .all<{
        id: string;
        trigger_kind: "manual" | "scheduled";
        requested_at: string;
        deadline_at: string;
        started_at: string | null;
        completed_at: string | null;
        total_count: number;
        completed_count: number;
        succeeded_count: number;
        failed_count: number;
        skipped_count: number;
        signal_count: number;
      }>();
    const runs: WatchRun[] = runResult.results.map((row) => {
      const pending = row.total_count - row.completed_count;
      const timedOut = pending > 0 && row.deadline_at <= now;
      return {
        id: row.id,
        trigger: row.trigger_kind,
        requestedAt: row.requested_at,
        startedAt: row.started_at,
        completedAt: pending === 0 ? row.completed_at : null,
        deadlineAt: row.deadline_at,
        status: timedOut
          ? "timed_out"
          : pending > 0
            ? row.started_at === null
              ? "queued"
              : "running"
            : row.succeeded_count === row.total_count
              ? "succeeded"
              : row.succeeded_count > 0
                ? "partial"
                : "failed",
        totalCount: row.total_count,
        completedCount: row.completed_count,
        succeededCount: row.succeeded_count,
        failedCount: row.failed_count,
        skippedCount: row.skipped_count,
        signalCount: row.signal_count,
      };
    });
    return runs;
  }

  public async readProgress(
    accessSubject: string,
    runId: string,
    now = new Date().toISOString(),
  ): Promise<PortfolioWatchProgress> {
    iso.parse(now);
    const householdId = await this.householdId(accessSubject);
    const [runs, sources] = await Promise.all([
      this.recentRuns(householdId, now),
      this.db
        .prepare(
          `${WATCH_SOURCE_FIELDS_SQL}
        FROM portfolio_watch_checks requested CROSS JOIN portfolio_watch_sources source
        ${WATCH_SOURCE_JOINS_SQL}
        WHERE requested.run_id = ? AND source.id = requested.source_id AND source.household_id = ? ORDER BY source.id`,
        )
        .bind(now, runId, householdId)
        .all(),
    ]);
    return PortfolioWatchProgressSchema.parse({
      asOf: now,
      runs,
      sources: sources.results,
    });
  }

  public async read(
    accessSubject: string,
    cursor: string | null = null,
    now = new Date().toISOString(),
  ): Promise<PortfolioWatchActivity> {
    iso.parse(now);
    const householdId = await this.householdId(accessSubject);
    const [summaryResult, companyResult, runResult] = await Promise.all([
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT target.id) AS companyCount, COUNT(source.id) AS sourceCount,
        COALESCE(SUM(source.status IN ('degraded', 'quarantined', 'revoked') OR sync.last_check_outcome IN ('failed', 'skipped') OR run.deadline_at <= ?), 0) AS unavailableCount,
        COALESCE(SUM(source.id IS NOT NULL AND sync.last_completed_at IS NULL), 0) AS neverCheckedCount,
        MIN(CASE WHEN source.status IN ('discovered', 'verified', 'active', 'degraded') THEN sync.next_check_at END) AS nextCheckAt
        FROM portfolio_watch_targets target LEFT JOIN portfolio_watch_sources source ON source.watch_target_id = target.id
        LEFT JOIN portfolio_watch_source_sync_state sync ON sync.source_id = source.id
        LEFT JOIN portfolio_watch_checks checks ON checks.source_id = source.id AND checks.state IN ('queued', 'running')
        LEFT JOIN portfolio_watch_runs run ON run.id = checks.run_id
        WHERE target.household_id = ? AND target.status = 'active'`,
        )
        .bind(now, householdId)
        .first(),
      this.db
        .prepare(
          `SELECT target.id, company.legal_name AS companyName FROM portfolio_watch_targets target
        JOIN companies company ON company.id = target.company_id
        WHERE target.household_id = ? AND target.status = 'active' AND target.id > ? ORDER BY target.id LIMIT 21`,
        )
        .bind(householdId, cursor ?? "")
        .all<{ id: string; companyName: string }>(),
      this.recentRuns(householdId, now),
    ]);
    const companies = companyResult.results.slice(0, 20);
    const sources = (
      await this.db
        .prepare(
          `${WATCH_SOURCE_FIELDS_SQL} FROM portfolio_watch_sources source ${WATCH_SOURCE_JOINS_SQL}
      WHERE source.household_id = ? AND source.watch_target_id IN (SELECT value FROM json_each(?)) ORDER BY source.watch_target_id, source.canonical_url`,
        )
        .bind(
          now,
          householdId,
          JSON.stringify(companies.map((company) => company.id)),
        )
        .all()
    ).results;
    return PortfolioWatchActivitySchema.parse({
      asOf: now,
      summary: summaryResult,
      companies: companies.map((company) => ({
        ...company,
        sources: sources.filter((source) => source.targetId === company.id),
      })),
      nextCursor:
        companyResult.results.length > 20 ? companies.at(-1)!.id : null,
      runs: runResult,
    });
  }
}
