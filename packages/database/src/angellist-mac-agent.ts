import {
  AngelListMacAgentConfigInputSchema,
  AngelListMacAgentFailureInputSchema,
  AngelListMacAgentLeaseSchema,
  AngelListMacAgentOverviewSchema,
  AngelListMacAgentRunRequestSchema,
  type AngelListMacAgentConfigInput,
  type AngelListMacAgentFailureInput,
  type AngelListMacAgentInterval,
  type AngelListMacAgentLease,
  type AngelListMacAgentOverview,
  type AngelListMacAgentRunRequest,
} from "@keel/domain";

import { agentHeartbeatCutoff } from "./agent-heartbeat";

const DEFAULT_INTERVAL: AngelListMacAgentInterval = "weekly";
const OFFLINE_AFTER_MS = 36 * 60 * 60 * 1_000;
const LEASE_DURATION_MS = 5 * 60 * 1_000;

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type AgentRow = {
  id: string;
  household_id: string;
  registered_by_user_id: string;
  interval: AngelListMacAgentInterval;
  last_seen_at: string;
  last_completed_at: string | null;
  next_run_at: string | null;
  last_error_code: AngelListMacAgentOverview["errorCode"];
};

type ActiveRunRow = {
  id: string;
  request_kind: "manual" | "schedule";
  status: "queued" | "leased";
  lease_expires_at: string | null;
  requested_at: string;
};

type LatestCompletedRunRow = {
  import_id: string;
};

type LeasedRunRow = {
  id: string;
  lease_expires_at: string;
};

export type AngelListMacAgentRepositoryErrorCode =
  "agent_not_registered" | "lease_invalid";

export class AngelListMacAgentRepositoryError extends Error {
  public constructor(
    public readonly code: AngelListMacAgentRepositoryErrorCode,
  ) {
    super(code);
    this.name = "AngelListMacAgentRepositoryError";
  }
}

export interface AngelListMacAgentRepository {
  getOverview(accessSubject: string): Promise<AngelListMacAgentOverview>;
  register(accessSubject: string): Promise<AngelListMacAgentOverview>;
  configure(
    accessSubject: string,
    input: AngelListMacAgentConfigInput,
  ): Promise<AngelListMacAgentOverview>;
  requestRun(accessSubject: string): Promise<AngelListMacAgentRunRequest>;
  lease(accessSubject: string): Promise<AngelListMacAgentLease>;
  assertLease(
    accessSubject: string,
    runId: string,
    leaseToken: string,
  ): Promise<void>;
  complete(
    accessSubject: string,
    runId: string,
    leaseToken: string,
    importId: string,
  ): Promise<AngelListMacAgentOverview>;
  fail(
    accessSubject: string,
    runId: string,
    leaseToken: string,
    input: AngelListMacAgentFailureInput,
  ): Promise<AngelListMacAgentOverview>;
}

function intervalDelayMs(interval: AngelListMacAgentInterval): number | null {
  if (interval === "off") {
    return null;
  }
  return interval === "daily" ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
}

function nextRunAt(
  interval: AngelListMacAgentInterval,
  now: Date,
): string | null {
  const delay = intervalDelayMs(interval);
  return delay === null ? null : new Date(now.getTime() + delay).toISOString();
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function newLeaseToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export class D1AngelListMacAgentRepository implements AngelListMacAgentRepository {
  public constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async getOverview(
    accessSubject: string,
  ): Promise<AngelListMacAgentOverview> {
    const identity = await this.findIdentity(accessSubject);
    return this.overviewFor(identity.household_id, this.now());
  }

  public async register(
    accessSubject: string,
  ): Promise<AngelListMacAgentOverview> {
    const identity = await this.findIdentity(accessSubject);
    const now = this.now();
    const timestamp = now.toISOString();
    const existing = await this.findAgent(identity.household_id);
    if (existing === null) {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO angellist_mac_agents (
               id, household_id, registered_by_user_id, interval,
               last_seen_at, last_completed_at, next_run_at, last_error_code,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            identity.user_id,
            DEFAULT_INTERVAL,
            timestamp,
            nextRunAt(DEFAULT_INTERVAL, now),
            timestamp,
            timestamp,
          ),
      ]);
    } else {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE angellist_mac_agents
             SET last_seen_at = ?,
               last_error_code = CASE
                 WHEN last_error_code = 'keel_sign_in_required' THEN NULL
                 ELSE last_error_code
               END,
               updated_at = ?
             WHERE id = ? AND household_id = ?`,
          )
          .bind(timestamp, timestamp, existing.id, identity.household_id),
      ]);
    }
    return this.overviewFor(identity.household_id, now);
  }

  public async configure(
    accessSubject: string,
    rawInput: AngelListMacAgentConfigInput,
  ): Promise<AngelListMacAgentOverview> {
    const input = AngelListMacAgentConfigInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id);
    const now = this.now();
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE angellist_mac_agents
           SET interval = ?, next_run_at = ?, updated_at = ?
           WHERE id = ? AND household_id = ?`,
        )
        .bind(
          input.interval,
          nextRunAt(input.interval, now),
          timestamp,
          agent.id,
          identity.household_id,
        ),
    ]);
    return this.overviewFor(identity.household_id, now);
  }

  public async requestRun(
    accessSubject: string,
  ): Promise<AngelListMacAgentRunRequest> {
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id);
    const active = await this.findActiveRun(agent.id);
    if (active !== null) {
      return AngelListMacAgentRunRequestSchema.parse({
        version: 1,
        runId: active.id,
        status: active.status === "leased" ? "running" : "queued",
      });
    }

    const id = crypto.randomUUID();
    const timestamp = this.now().toISOString();
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO angellist_mac_runs (
               id, household_id, agent_id, requested_by_user_id, request_kind,
               status, lease_token_sha256, lease_expires_at, import_id,
               error_code, requested_at, started_at, finished_at
             ) VALUES (?, ?, ?, ?, 'manual', 'queued', NULL, NULL, NULL, NULL,
               ?, NULL, NULL)`,
          )
          .bind(
            id,
            identity.household_id,
            agent.id,
            identity.user_id,
            timestamp,
          ),
      ]);
    } catch {
      const concurrent = await this.findActiveRun(agent.id);
      if (concurrent === null) {
        throw new Error("AngelList Mac run could not be queued.");
      }
      return AngelListMacAgentRunRequestSchema.parse({
        version: 1,
        runId: concurrent.id,
        status: concurrent.status === "leased" ? "running" : "queued",
      });
    }

    return AngelListMacAgentRunRequestSchema.parse({
      version: 1,
      runId: id,
      status: "queued",
    });
  }

  public async lease(accessSubject: string): Promise<AngelListMacAgentLease> {
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id);
    const now = this.now();
    const timestamp = now.toISOString();
    if (agent.last_seen_at <= agentHeartbeatCutoff(now)) {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE angellist_mac_agents
           SET last_seen_at = ?, updated_at = ?
           WHERE id = ? AND household_id = ? AND last_seen_at <= ?`,
          )
          .bind(
            timestamp,
            timestamp,
            agent.id,
            identity.household_id,
            agentHeartbeatCutoff(now),
          ),
      ]);
    }

    let active = await this.findActiveRun(agent.id);
    let expiredLease = false;
    if (
      active?.status === "leased" &&
      active.lease_expires_at !== null &&
      new Date(active.lease_expires_at).getTime() <= now.getTime()
    ) {
      await this.failExpiredLease(agent, active, now);
      active = null;
      expiredLease = true;
    }

    if (
      active === null &&
      !expiredLease &&
      agent.interval !== "off" &&
      agent.next_run_at !== null &&
      new Date(agent.next_run_at).getTime() <= now.getTime()
    ) {
      try {
        await this.db.batch([
          this.db
            .prepare(
              `INSERT INTO angellist_mac_runs (
                 id, household_id, agent_id, requested_by_user_id,
                 request_kind, status, lease_token_sha256, lease_expires_at,
                 import_id, error_code, requested_at, started_at, finished_at
               ) VALUES (?, ?, ?, ?, 'schedule', 'queued', NULL, NULL, NULL,
                 NULL, ?, NULL, NULL)`,
            )
            .bind(
              crypto.randomUUID(),
              identity.household_id,
              agent.id,
              identity.user_id,
              timestamp,
            ),
        ]);
      } catch {
        // A concurrent poll may have created the single active run.
      }
      active = await this.findActiveRun(agent.id);
    }

    if (active?.status !== "queued") {
      return AngelListMacAgentLeaseSchema.parse({
        version: 1,
        serverTime: timestamp,
        run: null,
      });
    }

    const leaseToken = newLeaseToken();
    const leaseTokenSha256 = await sha256(leaseToken);
    const leaseExpiresAt = new Date(
      now.getTime() + LEASE_DURATION_MS,
    ).toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE angellist_mac_runs
           SET status = 'leased', lease_token_sha256 = ?, lease_expires_at = ?,
             started_at = ?
           WHERE id = ? AND household_id = ? AND status = 'queued'`,
        )
        .bind(
          leaseTokenSha256,
          leaseExpiresAt,
          timestamp,
          active.id,
          identity.household_id,
        ),
    ]);
    const leased = await this.db
      .prepare(
        `SELECT id, lease_expires_at
         FROM angellist_mac_runs
         WHERE id = ? AND household_id = ? AND status = 'leased'
           AND lease_token_sha256 = ?`,
      )
      .bind(active.id, identity.household_id, leaseTokenSha256)
      .first<LeasedRunRow>();

    return AngelListMacAgentLeaseSchema.parse({
      version: 1,
      serverTime: timestamp,
      run:
        leased === null
          ? null
          : {
              id: leased.id,
              leaseToken,
              expiresAt: leased.lease_expires_at,
            },
    });
  }

  public async assertLease(
    accessSubject: string,
    runId: string,
    leaseToken: string,
  ): Promise<void> {
    const identity = await this.findIdentity(accessSubject);
    await this.requireLease(
      identity.household_id,
      runId,
      leaseToken,
      this.now(),
    );
  }

  public async complete(
    accessSubject: string,
    runId: string,
    leaseToken: string,
    importId: string,
  ): Promise<AngelListMacAgentOverview> {
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id);
    const now = this.now();
    await this.requireLease(identity.household_id, runId, leaseToken, now);
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE angellist_mac_runs
           SET status = 'completed', lease_token_sha256 = NULL,
             lease_expires_at = NULL, import_id = ?, finished_at = ?
           WHERE id = ? AND household_id = ? AND status = 'leased'`,
        )
        .bind(importId, timestamp, runId, identity.household_id),
      this.db
        .prepare(
          `UPDATE angellist_mac_agents
           SET last_seen_at = ?, last_completed_at = ?, next_run_at = ?,
             last_error_code = NULL, updated_at = ?
           WHERE id = ? AND household_id = ?`,
        )
        .bind(
          timestamp,
          timestamp,
          nextRunAt(agent.interval, now),
          timestamp,
          agent.id,
          identity.household_id,
        ),
    ]);
    return this.overviewFor(identity.household_id, now);
  }

  public async fail(
    accessSubject: string,
    runId: string,
    leaseToken: string,
    rawInput: AngelListMacAgentFailureInput,
  ): Promise<AngelListMacAgentOverview> {
    const input = AngelListMacAgentFailureInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id);
    const now = this.now();
    await this.requireLease(identity.household_id, runId, leaseToken, now);
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE angellist_mac_runs
           SET status = 'failed', lease_token_sha256 = NULL,
             lease_expires_at = NULL, error_code = ?, finished_at = ?
           WHERE id = ? AND household_id = ? AND status = 'leased'`,
        )
        .bind(input.errorCode, timestamp, runId, identity.household_id),
      this.db
        .prepare(
          `UPDATE angellist_mac_agents
           SET last_seen_at = ?, next_run_at = ?, last_error_code = ?,
             updated_at = ?
           WHERE id = ? AND household_id = ?`,
        )
        .bind(
          timestamp,
          nextRunAt(agent.interval, now),
          input.errorCode,
          timestamp,
          agent.id,
          identity.household_id,
        ),
    ]);
    return this.overviewFor(identity.household_id, now);
  }

  private async overviewFor(
    householdId: string,
    now: Date,
  ): Promise<AngelListMacAgentOverview> {
    const agent = await this.findAgent(householdId);
    if (agent === null) {
      return AngelListMacAgentOverviewSchema.parse({
        version: 1,
        status: "setup_required",
        interval: DEFAULT_INTERVAL,
        runStatus: null,
        lastSeenAt: null,
        lastCompletedAt: null,
        nextRunAt: null,
        latestImportId: null,
        errorCode: null,
      });
    }
    const [active, latestCompleted] = await Promise.all([
      this.findActiveRun(agent.id),
      this.db
        .prepare(
          `SELECT import_id
           FROM angellist_mac_runs
           WHERE agent_id = ? AND household_id = ? AND status = 'completed'
           ORDER BY finished_at DESC, requested_at DESC
           LIMIT 1`,
        )
        .bind(agent.id, householdId)
        .first<LatestCompletedRunRow>(),
    ]);
    const offline =
      now.getTime() - new Date(agent.last_seen_at).getTime() > OFFLINE_AFTER_MS;
    const status = offline
      ? "offline"
      : active !== null
        ? "running"
        : agent.last_error_code !== null
          ? "needs_attention"
          : "ready";
    return AngelListMacAgentOverviewSchema.parse({
      version: 1,
      status,
      interval: agent.interval,
      runStatus:
        active === null
          ? null
          : active.status === "leased"
            ? "running"
            : "queued",
      lastSeenAt: agent.last_seen_at,
      lastCompletedAt: agent.last_completed_at,
      nextRunAt: agent.next_run_at,
      latestImportId: latestCompleted?.import_id ?? null,
      errorCode: agent.last_error_code,
    });
  }

  private async failExpiredLease(
    agent: AgentRow,
    active: ActiveRunRow,
    now: Date,
  ): Promise<void> {
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE angellist_mac_runs
           SET status = 'failed', lease_token_sha256 = NULL,
             lease_expires_at = NULL, error_code = 'unexpected_failure',
             finished_at = ?
           WHERE id = ? AND household_id = ? AND status = 'leased'`,
        )
        .bind(timestamp, active.id, agent.household_id),
      this.db
        .prepare(
          `UPDATE angellist_mac_agents
           SET next_run_at = ?, last_error_code = 'unexpected_failure',
             updated_at = ?
           WHERE id = ? AND household_id = ?`,
        )
        .bind(
          nextRunAt(agent.interval, now),
          timestamp,
          agent.id,
          agent.household_id,
        ),
    ]);
  }

  private async requireLease(
    householdId: string,
    runId: string,
    leaseToken: string,
    now: Date,
  ): Promise<void> {
    const leaseTokenSha256 = await sha256(leaseToken);
    const leased = await this.db
      .prepare(
        `SELECT id, lease_expires_at
         FROM angellist_mac_runs
         WHERE id = ? AND household_id = ? AND status = 'leased'
           AND lease_token_sha256 = ?`,
      )
      .bind(runId, householdId, leaseTokenSha256)
      .first<LeasedRunRow>();
    if (
      leased === null ||
      new Date(leased.lease_expires_at).getTime() <= now.getTime()
    ) {
      throw new AngelListMacAgentRepositoryError("lease_invalid");
    }
  }

  private async requireAgent(householdId: string): Promise<AgentRow> {
    const agent = await this.findAgent(householdId);
    if (agent === null) {
      throw new AngelListMacAgentRepositoryError("agent_not_registered");
    }
    return agent;
  }

  private findAgent(householdId: string): Promise<AgentRow | null> {
    return this.db
      .prepare(
        `SELECT id, household_id, registered_by_user_id, interval,
          last_seen_at, last_completed_at, next_run_at, last_error_code
         FROM angellist_mac_agents
         WHERE household_id = ?`,
      )
      .bind(householdId)
      .first<AgentRow>();
  }

  private findActiveRun(agentId: string): Promise<ActiveRunRow | null> {
    return this.db
      .prepare(
        `SELECT id, request_kind, status, lease_expires_at, requested_at
         FROM angellist_mac_runs
         WHERE agent_id = ? AND status IN ('queued', 'leased')
         ORDER BY requested_at
         LIMIT 1`,
      )
      .bind(agentId)
      .first<ActiveRunRow>();
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id, user.id AS user_id
         FROM households household
         JOIN users user ON user.id = household.owner_user_id
         WHERE user.access_subject = ?
         ORDER BY household.created_at
         LIMIT 1`,
      )
      .bind(accessSubject)
      .first<HouseholdIdentity>();
    if (identity === null) {
      throw new Error("No household is provisioned for this identity.");
    }
    return identity;
  }
}
