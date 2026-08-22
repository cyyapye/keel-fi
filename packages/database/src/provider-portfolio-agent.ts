import {
  ProviderPortfolioAgentConfigInputSchema,
  ProviderPortfolioAgentFailureInputSchema,
  ProviderPortfolioAgentLeaseSchema,
  ProviderPortfolioAgentOverviewSchema,
  ProviderPortfolioAgentProviderSchema,
  ProviderPortfolioAgentRunRequestSchema,
  type AngelListMacAgentInterval,
  type ProviderPortfolioAgentConfigInput,
  type ProviderPortfolioAgentFailureInput,
  type ProviderPortfolioAgentLease,
  type ProviderPortfolioAgentOverview,
  type ProviderPortfolioAgentProvider,
  type ProviderPortfolioAgentRunRequest,
} from "@keel/domain";

const DEFAULT_INTERVAL: AngelListMacAgentInterval = "daily";
const OFFLINE_AFTER_MS = 36 * 60 * 60 * 1_000;
const LEASE_DURATION_MS = 5 * 60 * 1_000;

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type AgentRow = {
  id: string;
  household_id: string;
  provider: ProviderPortfolioAgentProvider;
  interval: AngelListMacAgentInterval;
  last_seen_at: string;
  last_completed_at: string | null;
  next_run_at: string | null;
  last_error_code: ProviderPortfolioAgentOverview["errorCode"];
};

type ActiveRunRow = {
  id: string;
  status: "queued" | "leased";
  lease_expires_at: string | null;
};

type LatestCompletedRunRow = { import_id: string };
type LeasedRunRow = { id: string; lease_expires_at: string };

export type ProviderPortfolioAgentRepositoryErrorCode =
  "agent_not_registered" | "lease_invalid";

export class ProviderPortfolioAgentRepositoryError extends Error {
  public constructor(
    public readonly code: ProviderPortfolioAgentRepositoryErrorCode,
  ) {
    super(code);
    this.name = "ProviderPortfolioAgentRepositoryError";
  }
}

export interface ProviderPortfolioAgentRepository {
  getOverview(
    accessSubject: string,
    provider: ProviderPortfolioAgentProvider,
  ): Promise<ProviderPortfolioAgentOverview>;
  register(
    accessSubject: string,
    provider: ProviderPortfolioAgentProvider,
  ): Promise<ProviderPortfolioAgentOverview>;
  configure(
    accessSubject: string,
    provider: ProviderPortfolioAgentProvider,
    input: ProviderPortfolioAgentConfigInput,
  ): Promise<ProviderPortfolioAgentOverview>;
  requestRun(
    accessSubject: string,
    provider: ProviderPortfolioAgentProvider,
  ): Promise<ProviderPortfolioAgentRunRequest>;
  lease(
    accessSubject: string,
    provider: ProviderPortfolioAgentProvider,
  ): Promise<ProviderPortfolioAgentLease>;
  assertLease(
    accessSubject: string,
    provider: ProviderPortfolioAgentProvider,
    runId: string,
    leaseToken: string,
  ): Promise<void>;
  complete(
    accessSubject: string,
    provider: ProviderPortfolioAgentProvider,
    runId: string,
    leaseToken: string,
    importId: string,
  ): Promise<ProviderPortfolioAgentOverview>;
  fail(
    accessSubject: string,
    provider: ProviderPortfolioAgentProvider,
    runId: string,
    leaseToken: string,
    input: ProviderPortfolioAgentFailureInput,
  ): Promise<ProviderPortfolioAgentOverview>;
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

export class D1ProviderPortfolioAgentRepository implements ProviderPortfolioAgentRepository {
  public constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async getOverview(
    accessSubject: string,
    rawProvider: ProviderPortfolioAgentProvider,
  ): Promise<ProviderPortfolioAgentOverview> {
    const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
    const identity = await this.findIdentity(accessSubject);
    return this.overviewFor(identity.household_id, provider, this.now());
  }

  public async register(
    accessSubject: string,
    rawProvider: ProviderPortfolioAgentProvider,
  ): Promise<ProviderPortfolioAgentOverview> {
    const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
    const identity = await this.findIdentity(accessSubject);
    const now = this.now();
    const timestamp = now.toISOString();
    const existing = await this.findAgent(identity.household_id, provider);
    if (existing === null) {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO provider_portfolio_agents (
               id, household_id, provider, registered_by_user_id, interval,
               last_seen_at, last_completed_at, next_run_at, last_error_code,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            provider,
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
            `UPDATE provider_portfolio_agents
             SET last_seen_at = ?,
               last_error_code = CASE
                 WHEN last_error_code = 'keel_sign_in_required' THEN NULL
                 ELSE last_error_code
               END,
               updated_at = ?
             WHERE id = ? AND household_id = ? AND provider = ?`,
          )
          .bind(
            timestamp,
            timestamp,
            existing.id,
            identity.household_id,
            provider,
          ),
      ]);
    }
    return this.overviewFor(identity.household_id, provider, now);
  }

  public async configure(
    accessSubject: string,
    rawProvider: ProviderPortfolioAgentProvider,
    rawInput: ProviderPortfolioAgentConfigInput,
  ): Promise<ProviderPortfolioAgentOverview> {
    const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
    const input = ProviderPortfolioAgentConfigInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id, provider);
    const now = this.now();
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE provider_portfolio_agents
           SET interval = ?, next_run_at = ?, updated_at = ?
           WHERE id = ? AND household_id = ? AND provider = ?`,
        )
        .bind(
          input.interval,
          nextRunAt(input.interval, now),
          timestamp,
          agent.id,
          identity.household_id,
          provider,
        ),
    ]);
    return this.overviewFor(identity.household_id, provider, now);
  }

  public async requestRun(
    accessSubject: string,
    rawProvider: ProviderPortfolioAgentProvider,
  ): Promise<ProviderPortfolioAgentRunRequest> {
    const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id, provider);
    const active = await this.findActiveRun(agent.id);
    if (active !== null) {
      return ProviderPortfolioAgentRunRequestSchema.parse({
        version: 1,
        provider,
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
            `INSERT INTO provider_portfolio_runs (
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
        throw new Error("Provider portfolio run could not be queued.");
      }
      return ProviderPortfolioAgentRunRequestSchema.parse({
        version: 1,
        provider,
        runId: concurrent.id,
        status: concurrent.status === "leased" ? "running" : "queued",
      });
    }

    return ProviderPortfolioAgentRunRequestSchema.parse({
      version: 1,
      provider,
      runId: id,
      status: "queued",
    });
  }

  public async lease(
    accessSubject: string,
    rawProvider: ProviderPortfolioAgentProvider,
  ): Promise<ProviderPortfolioAgentLease> {
    const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id, provider);
    const now = this.now();
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE provider_portfolio_agents
           SET last_seen_at = ?, updated_at = ?
           WHERE id = ? AND household_id = ? AND provider = ?`,
        )
        .bind(timestamp, timestamp, agent.id, identity.household_id, provider),
    ]);

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
              `INSERT INTO provider_portfolio_runs (
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
      return ProviderPortfolioAgentLeaseSchema.parse({
        version: 1,
        provider,
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
          `UPDATE provider_portfolio_runs
           SET status = 'leased', lease_token_sha256 = ?, lease_expires_at = ?,
             started_at = ?
           WHERE id = ? AND household_id = ? AND agent_id = ?
             AND status = 'queued'`,
        )
        .bind(
          leaseTokenSha256,
          leaseExpiresAt,
          timestamp,
          active.id,
          identity.household_id,
          agent.id,
        ),
    ]);
    const leased = await this.db
      .prepare(
        `SELECT id, lease_expires_at
         FROM provider_portfolio_runs
         WHERE id = ? AND household_id = ? AND agent_id = ?
           AND status = 'leased' AND lease_token_sha256 = ?`,
      )
      .bind(active.id, identity.household_id, agent.id, leaseTokenSha256)
      .first<LeasedRunRow>();

    return ProviderPortfolioAgentLeaseSchema.parse({
      version: 1,
      provider,
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
    rawProvider: ProviderPortfolioAgentProvider,
    runId: string,
    leaseToken: string,
  ): Promise<void> {
    const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id, provider);
    await this.requireLease(
      identity.household_id,
      agent.id,
      runId,
      leaseToken,
      this.now(),
    );
  }

  public async complete(
    accessSubject: string,
    rawProvider: ProviderPortfolioAgentProvider,
    runId: string,
    leaseToken: string,
    importId: string,
  ): Promise<ProviderPortfolioAgentOverview> {
    const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id, provider);
    const now = this.now();
    await this.requireLease(
      identity.household_id,
      agent.id,
      runId,
      leaseToken,
      now,
    );
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE provider_portfolio_runs
           SET status = 'completed', lease_token_sha256 = NULL,
             lease_expires_at = NULL, import_id = ?, finished_at = ?
           WHERE id = ? AND household_id = ? AND agent_id = ?
             AND status = 'leased'`,
        )
        .bind(importId, timestamp, runId, identity.household_id, agent.id),
      this.db
        .prepare(
          `UPDATE provider_portfolio_agents
           SET last_seen_at = ?, last_completed_at = ?, next_run_at = ?,
             last_error_code = NULL, updated_at = ?
           WHERE id = ? AND household_id = ? AND provider = ?`,
        )
        .bind(
          timestamp,
          timestamp,
          nextRunAt(agent.interval, now),
          timestamp,
          agent.id,
          identity.household_id,
          provider,
        ),
    ]);
    return this.overviewFor(identity.household_id, provider, now);
  }

  public async fail(
    accessSubject: string,
    rawProvider: ProviderPortfolioAgentProvider,
    runId: string,
    leaseToken: string,
    rawInput: ProviderPortfolioAgentFailureInput,
  ): Promise<ProviderPortfolioAgentOverview> {
    const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
    const input = ProviderPortfolioAgentFailureInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireAgent(identity.household_id, provider);
    const now = this.now();
    await this.requireLease(
      identity.household_id,
      agent.id,
      runId,
      leaseToken,
      now,
    );
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE provider_portfolio_runs
           SET status = 'failed', lease_token_sha256 = NULL,
             lease_expires_at = NULL, error_code = ?, finished_at = ?
           WHERE id = ? AND household_id = ? AND agent_id = ?
             AND status = 'leased'`,
        )
        .bind(
          input.errorCode,
          timestamp,
          runId,
          identity.household_id,
          agent.id,
        ),
      this.db
        .prepare(
          `UPDATE provider_portfolio_agents
           SET last_seen_at = ?, next_run_at = ?, last_error_code = ?,
             updated_at = ?
           WHERE id = ? AND household_id = ? AND provider = ?`,
        )
        .bind(
          timestamp,
          nextRunAt(agent.interval, now),
          input.errorCode,
          timestamp,
          agent.id,
          identity.household_id,
          provider,
        ),
    ]);
    return this.overviewFor(identity.household_id, provider, now);
  }

  private async overviewFor(
    householdId: string,
    provider: ProviderPortfolioAgentProvider,
    now: Date,
  ): Promise<ProviderPortfolioAgentOverview> {
    const agent = await this.findAgent(householdId, provider);
    if (agent === null) {
      return ProviderPortfolioAgentOverviewSchema.parse({
        version: 1,
        provider,
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
           FROM provider_portfolio_runs
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
    return ProviderPortfolioAgentOverviewSchema.parse({
      version: 1,
      provider,
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
          `UPDATE provider_portfolio_runs
           SET status = 'failed', lease_token_sha256 = NULL,
             lease_expires_at = NULL, error_code = 'unexpected_failure',
             finished_at = ?
           WHERE id = ? AND household_id = ? AND agent_id = ?
             AND status = 'leased'`,
        )
        .bind(timestamp, active.id, agent.household_id, agent.id),
      this.db
        .prepare(
          `UPDATE provider_portfolio_agents
           SET next_run_at = ?, last_error_code = 'unexpected_failure',
             updated_at = ?
           WHERE id = ? AND household_id = ? AND provider = ?`,
        )
        .bind(
          nextRunAt(agent.interval, now),
          timestamp,
          agent.id,
          agent.household_id,
          agent.provider,
        ),
    ]);
  }

  private async requireLease(
    householdId: string,
    agentId: string,
    runId: string,
    leaseToken: string,
    now: Date,
  ): Promise<void> {
    const leaseTokenSha256 = await sha256(leaseToken);
    const leased = await this.db
      .prepare(
        `SELECT id, lease_expires_at
         FROM provider_portfolio_runs
         WHERE id = ? AND household_id = ? AND agent_id = ?
           AND status = 'leased' AND lease_token_sha256 = ?`,
      )
      .bind(runId, householdId, agentId, leaseTokenSha256)
      .first<LeasedRunRow>();
    if (
      leased === null ||
      new Date(leased.lease_expires_at).getTime() <= now.getTime()
    ) {
      throw new ProviderPortfolioAgentRepositoryError("lease_invalid");
    }
  }

  private async requireAgent(
    householdId: string,
    provider: ProviderPortfolioAgentProvider,
  ): Promise<AgentRow> {
    const agent = await this.findAgent(householdId, provider);
    if (agent === null) {
      throw new ProviderPortfolioAgentRepositoryError("agent_not_registered");
    }
    return agent;
  }

  private findAgent(
    householdId: string,
    provider: ProviderPortfolioAgentProvider,
  ): Promise<AgentRow | null> {
    return this.db
      .prepare(
        `SELECT id, household_id, provider, interval, last_seen_at,
          last_completed_at, next_run_at, last_error_code
         FROM provider_portfolio_agents
         WHERE household_id = ? AND provider = ?`,
      )
      .bind(householdId, provider)
      .first<AgentRow>();
  }

  private findActiveRun(agentId: string): Promise<ActiveRunRow | null> {
    return this.db
      .prepare(
        `SELECT id, status, lease_expires_at
         FROM provider_portfolio_runs
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
