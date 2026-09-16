import {
  MacAgentTargetSchema,
  ProviderBrowserSessionCompletionInputSchema,
  ProviderBrowserSessionFailureInputSchema,
  ProviderBrowserSessionLeaseSchema,
  ProviderBrowserSessionReadyInputSchema,
  ProviderBrowserSessionSchema,
  type MacAgentTarget,
  type ProviderBrowserSession,
  type ProviderBrowserSessionCompletionInput,
  type ProviderBrowserSessionFailureInput,
  type ProviderBrowserSessionLease,
  type ProviderBrowserSessionReadyInput,
  type ProviderBrowserSessionStatus,
} from "@keel/domain";

import { agentHeartbeatCutoff } from "./agent-heartbeat";
import { recordProviderSessionVerification } from "./provider-session-renewals";

const SESSION_DURATION_MS = 15 * 60 * 1_000;

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type SessionRow = {
  id: string;
  provider: MacAgentTarget;
  status: ProviderBrowserSessionStatus;
  requested_at: string;
  expires_at: string;
  opened_at: string | null;
  connected_at: string | null;
  error_code: ProviderBrowserSession["errorCode"];
};

type LeasedSessionRow = {
  id: string;
  expires_at: string;
};

type LiveUrlRow = { live_url: string };
type IdRow = { id: string };
type AgentHeartbeatRow = { last_seen_at: string };

export type ProviderBrowserSessionRepositoryErrorCode =
  | "agent_not_registered"
  | "lease_invalid"
  | "session_not_found"
  | "session_not_ready";

export class ProviderBrowserSessionRepositoryError extends Error {
  public constructor(
    public readonly code: ProviderBrowserSessionRepositoryErrorCode,
  ) {
    super(code);
    this.name = "ProviderBrowserSessionRepositoryError";
  }
}

export interface ProviderBrowserSessionRepository {
  create(
    accessSubject: string,
    provider: MacAgentTarget,
  ): Promise<ProviderBrowserSession>;
  get(
    accessSubject: string,
    sessionId: string,
  ): Promise<ProviderBrowserSession>;
  cancel(
    accessSubject: string,
    sessionId: string,
  ): Promise<ProviderBrowserSession>;
  consume(accessSubject: string, sessionId: string): Promise<string>;
  lease(
    accessSubject: string,
    provider: MacAgentTarget,
  ): Promise<ProviderBrowserSessionLease>;
  ready(
    accessSubject: string,
    provider: MacAgentTarget,
    sessionId: string,
    input: ProviderBrowserSessionReadyInput,
  ): Promise<ProviderBrowserSession>;
  complete(
    accessSubject: string,
    provider: MacAgentTarget,
    sessionId: string,
    input: ProviderBrowserSessionCompletionInput,
  ): Promise<ProviderBrowserSession>;
  fail(
    accessSubject: string,
    provider: MacAgentTarget,
    sessionId: string,
    input: ProviderBrowserSessionFailureInput,
  ): Promise<ProviderBrowserSession>;
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

function newLeaseToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
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

function toSession(row: SessionRow): ProviderBrowserSession {
  return ProviderBrowserSessionSchema.parse({
    version: 1,
    id: row.id,
    provider: row.provider,
    status: row.status,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    openedAt: row.opened_at,
    connectedAt: row.connected_at,
    errorCode: row.error_code,
  });
}

export class D1ProviderBrowserSessionRepository implements ProviderBrowserSessionRepository {
  public constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async create(
    accessSubject: string,
    rawProvider: MacAgentTarget,
  ): Promise<ProviderBrowserSession> {
    const provider = MacAgentTargetSchema.parse(rawProvider);
    const identity = await this.findIdentity(accessSubject);
    await this.requireRegisteredAgent(identity.household_id, provider);
    const now = this.now();
    await this.expireActive(identity.household_id, provider, now);
    const existing = await this.findActive(identity.household_id, provider);
    if (existing !== null) {
      return toSession(existing);
    }

    const id = crypto.randomUUID();
    const requestedAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + SESSION_DURATION_MS,
    ).toISOString();
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO provider_browser_sessions (
               id, household_id, provider, requested_by_user_id, status,
               lease_token_sha256, live_url, error_code, requested_at,
               expires_at, started_at, ready_at, opened_at, connected_at,
               finished_at, updated_at
             ) VALUES (?, ?, ?, ?, 'requested', NULL, NULL, NULL, ?, ?, NULL,
               NULL, NULL, NULL, NULL, ?)`,
          )
          .bind(
            id,
            identity.household_id,
            provider,
            identity.user_id,
            requestedAt,
            expiresAt,
            requestedAt,
          ),
      ]);
    } catch (error) {
      const concurrent = await this.findActive(identity.household_id, provider);
      if (concurrent === null) {
        throw new Error("Provider browser session could not be requested.", {
          cause: error,
        });
      }
      return toSession(concurrent);
    }
    return this.get(accessSubject, id);
  }

  public async get(
    accessSubject: string,
    sessionId: string,
  ): Promise<ProviderBrowserSession> {
    const identity = await this.findIdentity(accessSubject);
    const current = await this.findById(identity.household_id, sessionId);
    if (current === null) {
      throw new ProviderBrowserSessionRepositoryError("session_not_found");
    }
    // Lease/create/open mutations persist expiry. Status is a read projection.
    const expired =
      ["requested", "starting", "ready", "opened"].includes(current.status) &&
      Date.parse(current.expires_at) <= this.now().getTime();
    return toSession(
      expired
        ? {
            ...current,
            status: "expired",
            error_code: null,
            opened_at: null,
            connected_at: null,
          }
        : current,
    );
  }

  public async cancel(
    accessSubject: string,
    sessionId: string,
  ): Promise<ProviderBrowserSession> {
    const identity = await this.findIdentity(accessSubject);
    const row = await this.requireSession(identity.household_id, sessionId);
    if (["requested", "starting", "ready", "opened"].includes(row.status)) {
      const timestamp = this.now().toISOString();
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE provider_browser_sessions
             SET status = 'cancelled', lease_token_sha256 = NULL,
               live_url = NULL, error_code = NULL, started_at = NULL,
               ready_at = NULL, opened_at = NULL, connected_at = NULL,
               finished_at = ?, updated_at = ?
             WHERE id = ? AND household_id = ?
               AND status IN ('requested', 'starting', 'ready', 'opened')`,
          )
          .bind(timestamp, timestamp, sessionId, identity.household_id),
      ]);
    }
    return toSession(
      await this.requireSession(identity.household_id, sessionId),
    );
  }

  public async consume(
    accessSubject: string,
    sessionId: string,
  ): Promise<string> {
    const identity = await this.findIdentity(accessSubject);
    const now = this.now();
    const existing = await this.requireSession(
      identity.household_id,
      sessionId,
    );
    await this.expireActive(identity.household_id, existing.provider, now);
    const timestamp = now.toISOString();
    const destination = await this.db
      .prepare(
        `SELECT live_url
         FROM provider_browser_sessions
         WHERE id = ? AND household_id = ? AND status = 'ready'
           AND expires_at > ?`,
      )
      .bind(sessionId, identity.household_id, timestamp)
      .first<LiveUrlRow>();
    if (destination === null) {
      throw new ProviderBrowserSessionRepositoryError("session_not_ready");
    }
    const consumed = await this.db
      .prepare(
        `UPDATE provider_browser_sessions
         SET status = 'opened', live_url = NULL, opened_at = ?, updated_at = ?
         WHERE id = ? AND household_id = ? AND status = 'ready'
           AND expires_at > ?
         RETURNING id`,
      )
      .bind(timestamp, timestamp, sessionId, identity.household_id, timestamp)
      .first<IdRow>();
    if (consumed === null) {
      throw new ProviderBrowserSessionRepositoryError("session_not_ready");
    }
    return destination.live_url;
  }

  public async lease(
    accessSubject: string,
    rawProvider: MacAgentTarget,
  ): Promise<ProviderBrowserSessionLease> {
    const provider = MacAgentTargetSchema.parse(rawProvider);
    const identity = await this.findIdentity(accessSubject);
    const agent = await this.requireRegisteredAgent(
      identity.household_id,
      provider,
    );
    const now = this.now();
    const timestamp = now.toISOString();
    if (agent.last_seen_at <= agentHeartbeatCutoff(now)) {
      await this.touchAgent(identity.household_id, provider, now);
    }
    await this.expireActive(identity.household_id, provider, now);
    const requested = await this.db
      .prepare(
        `SELECT id, expires_at
         FROM provider_browser_sessions
         WHERE household_id = ? AND provider = ? AND status = 'requested'
         ORDER BY requested_at
         LIMIT 1`,
      )
      .bind(identity.household_id, provider)
      .first<LeasedSessionRow>();
    if (requested === null) {
      return ProviderBrowserSessionLeaseSchema.parse({
        version: 1,
        provider,
        serverTime: timestamp,
        session: null,
      });
    }

    const leaseToken = newLeaseToken();
    const digest = await sha256(leaseToken);
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE provider_browser_sessions
           SET status = 'starting', lease_token_sha256 = ?, started_at = ?,
             updated_at = ?
           WHERE id = ? AND household_id = ? AND provider = ?
             AND status = 'requested' AND expires_at > ?
             AND NOT EXISTS (SELECT 1 FROM provider_portfolio_agents agent
               JOIN provider_session_renewals renewal ON renewal.agent_id = agent.id
               WHERE agent.household_id = provider_browser_sessions.household_id
                 AND agent.provider = provider_browser_sessions.provider
                 AND renewal.lease_expires_at > ?)`,
        )
        .bind(
          digest,
          timestamp,
          timestamp,
          requested.id,
          identity.household_id,
          provider,
          timestamp,
          timestamp,
        ),
    ]);
    const leased = await this.db
      .prepare(
        `SELECT id, expires_at
         FROM provider_browser_sessions
         WHERE id = ? AND household_id = ? AND provider = ?
           AND status = 'starting' AND lease_token_sha256 = ?`,
      )
      .bind(requested.id, identity.household_id, provider, digest)
      .first<LeasedSessionRow>();
    return ProviderBrowserSessionLeaseSchema.parse({
      version: 1,
      provider,
      serverTime: timestamp,
      session:
        leased === null
          ? null
          : {
              id: leased.id,
              leaseToken,
              expiresAt: leased.expires_at,
            },
    });
  }

  public async ready(
    accessSubject: string,
    rawProvider: MacAgentTarget,
    sessionId: string,
    rawInput: ProviderBrowserSessionReadyInput,
  ): Promise<ProviderBrowserSession> {
    const provider = MacAgentTargetSchema.parse(rawProvider);
    const input = ProviderBrowserSessionReadyInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const now = this.now();
    await this.requireLease(
      identity.household_id,
      provider,
      sessionId,
      input.leaseToken,
      now,
      ["starting"],
    );
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE provider_browser_sessions
           SET status = 'ready', live_url = ?, ready_at = ?, updated_at = ?
           WHERE id = ? AND household_id = ? AND provider = ?
             AND status = 'starting'`,
        )
        .bind(
          input.liveUrl,
          timestamp,
          timestamp,
          sessionId,
          identity.household_id,
          provider,
        ),
    ]);
    return toSession(
      await this.requireSession(identity.household_id, sessionId),
    );
  }

  public async complete(
    accessSubject: string,
    rawProvider: MacAgentTarget,
    sessionId: string,
    rawInput: ProviderBrowserSessionCompletionInput,
  ): Promise<ProviderBrowserSession> {
    const provider = MacAgentTargetSchema.parse(rawProvider);
    const input = ProviderBrowserSessionCompletionInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const now = this.now();
    await this.requireLease(
      identity.household_id,
      provider,
      sessionId,
      input.leaseToken,
      now,
      ["opened"],
    );
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE provider_browser_sessions
           SET status = 'connected', lease_token_sha256 = NULL,
             live_url = NULL, connected_at = ?, finished_at = ?, updated_at = ?
           WHERE id = ? AND household_id = ? AND provider = ?
             AND status = 'opened'`,
        )
        .bind(
          timestamp,
          timestamp,
          timestamp,
          sessionId,
          identity.household_id,
          provider,
        ),
      ...recordProviderSessionVerification(
        this.db,
        identity.household_id,
        provider,
        now,
        true,
      ),
    ]);
    return toSession(
      await this.requireSession(identity.household_id, sessionId),
    );
  }

  public async fail(
    accessSubject: string,
    rawProvider: MacAgentTarget,
    sessionId: string,
    rawInput: ProviderBrowserSessionFailureInput,
  ): Promise<ProviderBrowserSession> {
    const provider = MacAgentTargetSchema.parse(rawProvider);
    const input = ProviderBrowserSessionFailureInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const now = this.now();
    await this.requireLease(
      identity.household_id,
      provider,
      sessionId,
      input.leaseToken,
      now,
      ["starting", "ready", "opened"],
    );
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE provider_browser_sessions
           SET status = 'failed', lease_token_sha256 = NULL, live_url = NULL,
             error_code = ?, started_at = NULL, ready_at = NULL,
             opened_at = NULL, connected_at = NULL, finished_at = ?,
             updated_at = ?
           WHERE id = ? AND household_id = ? AND provider = ?
             AND status IN ('starting', 'ready', 'opened')`,
        )
        .bind(
          input.errorCode,
          timestamp,
          timestamp,
          sessionId,
          identity.household_id,
          provider,
        ),
    ]);
    return toSession(
      await this.requireSession(identity.household_id, sessionId),
    );
  }

  private async expireActive(
    householdId: string,
    provider: MacAgentTarget,
    now: Date,
  ): Promise<void> {
    const timestamp = now.toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE provider_browser_sessions
           SET status = 'expired', lease_token_sha256 = NULL, live_url = NULL,
             error_code = NULL, started_at = NULL, ready_at = NULL,
             opened_at = NULL, connected_at = NULL, finished_at = ?,
             updated_at = ?
           WHERE household_id = ? AND provider = ?
             AND status IN ('requested', 'starting', 'ready', 'opened')
             AND expires_at <= ?`,
        )
        .bind(timestamp, timestamp, householdId, provider, timestamp),
    ]);
  }

  private async requireLease(
    householdId: string,
    provider: MacAgentTarget,
    sessionId: string,
    leaseToken: string,
    now: Date,
    statuses: readonly ProviderBrowserSessionStatus[],
  ): Promise<void> {
    const digest = await sha256(leaseToken);
    const placeholders = statuses.map(() => "?").join(", ");
    const leased = await this.db
      .prepare(
        `SELECT id, expires_at
         FROM provider_browser_sessions
         WHERE id = ? AND household_id = ? AND provider = ?
           AND status IN (${placeholders}) AND lease_token_sha256 = ?`,
      )
      .bind(sessionId, householdId, provider, ...statuses, digest)
      .first<LeasedSessionRow>();
    if (
      leased === null ||
      new Date(leased.expires_at).getTime() <= now.getTime()
    ) {
      throw new ProviderBrowserSessionRepositoryError("lease_invalid");
    }
  }

  private async touchAgent(
    householdId: string,
    provider: MacAgentTarget,
    now: Date,
  ): Promise<void> {
    const timestamp = now.toISOString();
    const cutoff = agentHeartbeatCutoff(now);
    const statement =
      provider === "angellist"
        ? this.db
            .prepare(
              `UPDATE angellist_mac_agents
               SET last_seen_at = ?, updated_at = ?
               WHERE household_id = ? AND last_seen_at <= ?`,
            )
            .bind(timestamp, timestamp, householdId, cutoff)
        : this.db
            .prepare(
              `UPDATE provider_portfolio_agents
               SET last_seen_at = ?, updated_at = ?
               WHERE household_id = ? AND provider = ? AND last_seen_at <= ?`,
            )
            .bind(timestamp, timestamp, householdId, provider, cutoff);
    await this.db.batch([statement]);
  }

  private async requireRegisteredAgent(
    householdId: string,
    provider: MacAgentTarget,
  ): Promise<AgentHeartbeatRow> {
    const row =
      provider === "angellist"
        ? await this.db
            .prepare(
              `SELECT last_seen_at
               FROM angellist_mac_agents
               WHERE household_id = ?`,
            )
            .bind(householdId)
            .first<AgentHeartbeatRow>()
        : await this.db
            .prepare(
              `SELECT last_seen_at
               FROM provider_portfolio_agents
               WHERE household_id = ? AND provider = ?`,
            )
            .bind(householdId, provider)
            .first<AgentHeartbeatRow>();
    if (row === null) {
      throw new ProviderBrowserSessionRepositoryError("agent_not_registered");
    }
    return row;
  }

  private findActive(
    householdId: string,
    provider: MacAgentTarget,
  ): Promise<SessionRow | null> {
    return this.db
      .prepare(
        `SELECT id, provider, status, requested_at, expires_at, opened_at,
           connected_at, error_code
         FROM provider_browser_sessions
         WHERE household_id = ? AND provider = ?
           AND status IN ('requested', 'starting', 'ready', 'opened')
         ORDER BY requested_at DESC
         LIMIT 1`,
      )
      .bind(householdId, provider)
      .first<SessionRow>();
  }

  private findById(
    householdId: string,
    sessionId: string,
  ): Promise<SessionRow | null> {
    return this.db
      .prepare(
        `SELECT id, provider, status, requested_at, expires_at, opened_at,
           connected_at, error_code
         FROM provider_browser_sessions
         WHERE household_id = ? AND id = ?`,
      )
      .bind(householdId, sessionId)
      .first<SessionRow>();
  }

  private async requireSession(
    householdId: string,
    sessionId: string,
  ): Promise<SessionRow> {
    const session = await this.findById(householdId, sessionId);
    if (session === null) {
      throw new ProviderBrowserSessionRepositoryError("session_not_found");
    }
    return session;
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

export const __providerBrowserSessionTest = {
  SESSION_DURATION_MS,
  sha256,
};
