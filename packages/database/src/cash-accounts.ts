import type { NormalizedCashAccounts } from "@keel/connectors";
import {
  addMinorUnits,
  CashAccountApplyInputSchema,
  CashAccountApplyResultSchema,
  CashAccountIdentityReviewInputSchema,
  CashAccountsErrorCodeSchema,
  CashAccountsStateSchema,
  type AcceptedCashAccount,
  type CashAccountApplyInput,
  type CashAccountApplyResult,
  type CashAccountIdentityCandidate,
  type CashAccountIdentityDecision,
  type CashAccountIdentityReviewInput,
  type CashAccountProposalRow,
  type CashAccountsErrorCode,
  type CashAccountsState,
  type CashBalanceProposal,
} from "@keel/domain";
import { z } from "zod";

import {
  projectCashAccountIdentities,
  type AcceptedCashAccountHistoryRow,
} from "./cash-account-identity";

const CONNECTOR_TYPE = "plaid-cash";
const LIVE_REFRESH_LIMIT = 4;
const SHA256_SCHEMA = z.string().regex(/^[a-f0-9]{64}$/u);

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type ConnectionRow = {
  id: string;
  display_label: string;
  secret_reference: string;
  status: "active" | "paused" | "revoked";
  last_synced_at: string | null;
  provider_account_key: string | null;
};

type ConnectionStateRow = ConnectionRow & {
  latest_run_status: "queued" | "running" | "succeeded" | "failed" | null;
  latest_error_code: string | null;
  live_refreshes_used: number;
};

type ProposalRow = {
  id: string;
  connector_account_id: string;
  institution_label: string;
  refresh_kind: "initial" | "live";
  observed_at: string;
  retrieved_at: string;
};

type ProposalSourceRow = {
  id: string;
  natural_key_sha256: string;
  item_account_key_sha256: string | null;
  institution_label: string;
  account_label: string;
  subtype:
    "checking" | "savings" | "money market" | "cash management" | "other";
  available_minor: number | null;
  current_minor: number | null;
  value_minor: number | null;
  value_state: "reported" | "unavailable" | "unsupported" | "not_reported";
  balance_source: "available" | "current" | null;
  observed_at: string;
  issues_json: string;
};

type CashAccountIdentityDecisionRow = {
  id: string;
  connector_account_id: string;
  natural_key_low_sha256: string;
  natural_key_high_sha256: string;
  decision: CashAccountIdentityDecision;
};

export type CashAccountConnection = {
  readonly id: string;
  readonly institutionLabel: string;
  readonly secretReference: string;
  readonly providerAccountKey: string;
};

export type CashAccountConnectionUpdate = CashAccountConnection & {
  readonly previousSecretReference: string | null;
};

export type CashAccountRefreshRun = {
  readonly id: string;
  readonly connection: CashAccountConnection;
  readonly refreshKind: "initial" | "live";
};

export type CashBalanceProposalStageResult = {
  readonly proposal: CashBalanceProposal | null;
};

export class CashAccountRepositoryError extends Error {
  public constructor(
    public readonly code: CashAccountsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CashAccountRepositoryError";
  }
}

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

async function findIdentity(
  db: D1Database,
  accessSubject: string,
): Promise<HouseholdIdentity> {
  const identity = await db
    .prepare(
      `SELECT household.id AS household_id, user.id AS user_id
       FROM users user
       JOIN households household ON household.owner_user_id = user.id
       WHERE user.access_subject = ?
       ORDER BY household.created_at
       LIMIT 1`,
    )
    .bind(accessSubject)
    .first<HouseholdIdentity>();
  if (identity === null) {
    throw new Error("Household not found for the authenticated user.");
  }
  return identity;
}

function monthPrefix(at: Date = new Date()): string {
  return at.toISOString().slice(0, 7);
}

function issuesFromJson(raw: string): string[] {
  return z.array(z.string().min(1).max(240)).max(5).parse(JSON.parse(raw));
}

function acceptedFromCanonicalRow(
  row: AcceptedCashAccountHistoryRow,
  canonicalNaturalKeySha256: string,
): AcceptedCashAccount {
  return {
    id: row.decision_id,
    naturalKeySha256: canonicalNaturalKeySha256,
    connectionId: row.connector_account_id,
    institutionLabel: row.institution_label,
    accountLabel: row.account_label,
    subtype: row.subtype,
    valueMinor: row.value_minor,
    valueState: row.value_state,
    balanceSource: row.balance_source,
    refreshKind: row.refresh_kind,
    observedAt: row.observed_at,
    acceptedAt: row.decided_at,
  };
}

function orderedIdentityKeys(left: string, right: string): [string, string] {
  return left.localeCompare(right) < 0 ? [left, right] : [right, left];
}

function identityPairKey(
  connectionId: string,
  left: string,
  right: string,
): string {
  const [low, high] = orderedIdentityKeys(left, right);
  return JSON.stringify([connectionId, low, high]);
}

function sameAccountLinks(
  decisions: readonly CashAccountIdentityDecisionRow[],
) {
  return decisions
    .filter((decision) => decision.decision === "same_account")
    .map((decision) => ({
      connectorAccountId: decision.connector_account_id,
      naturalKeyLowSha256: decision.natural_key_low_sha256,
      naturalKeyHighSha256: decision.natural_key_high_sha256,
    }));
}

function identityCandidates(
  rows: readonly AcceptedCashAccountHistoryRow[],
  decisions: readonly CashAccountIdentityDecisionRow[],
): CashAccountIdentityCandidate[] {
  const decidedPairs = new Set(
    decisions.map((decision) =>
      identityPairKey(
        decision.connector_account_id,
        decision.natural_key_low_sha256,
        decision.natural_key_high_sha256,
      ),
    ),
  );
  const projection = projectCashAccountIdentities(
    rows,
    [],
    sameAccountLinks(decisions),
  );
  const historyByNatural = new Map<string, AcceptedCashAccountHistoryRow[]>();
  rows.forEach((row) => {
    const key = JSON.stringify([
      row.connector_account_id,
      row.natural_key_sha256,
    ]);
    const history = historyByNatural.get(key) ?? [];
    history.push(row);
    historyByNatural.set(key, history);
  });
  const rowsByProposal = new Map<string, AcceptedCashAccountHistoryRow[]>();
  rows.forEach((row) => {
    const proposalRows = rowsByProposal.get(row.proposal_id) ?? [];
    proposalRows.push(row);
    rowsByProposal.set(row.proposal_id, proposalRows);
  });
  const candidates: CashAccountIdentityCandidate[] = [];
  rowsByProposal.forEach((proposalRows) => {
    const groups = new Map<string, AcceptedCashAccountHistoryRow[]>();
    proposalRows.forEach((row) => {
      const key = JSON.stringify([
        row.connector_account_id,
        row.institution_label,
        row.account_label,
        row.subtype,
      ]);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    });
    groups.forEach((group) => {
      const reported = group.filter((row) => row.value_state === "reported");
      const missing = group.filter((row) => row.value_state === "not_reported");
      if (reported.length !== 1 || missing.length !== 1) {
        return;
      }
      const reportedRow = reported[0];
      const missingRow = missing[0];
      if (reportedRow === undefined || missingRow === undefined) {
        return;
      }
      const pairKey = identityPairKey(
        reportedRow.connector_account_id,
        reportedRow.natural_key_sha256,
        missingRow.natural_key_sha256,
      );
      const reportedHistory =
        historyByNatural.get(
          JSON.stringify([
            reportedRow.connector_account_id,
            reportedRow.natural_key_sha256,
          ]),
        ) ?? [];
      const missingHistory =
        historyByNatural.get(
          JSON.stringify([
            missingRow.connector_account_id,
            missingRow.natural_key_sha256,
          ]),
        ) ?? [];
      // Back-to-back reviews can share a millisecond timestamp. Proposal
      // lineage still distinguishes an earlier accepted observation.
      const priorReportedExists = missingHistory.some(
        (row) =>
          row.value_state === "reported" &&
          row.proposal_id !== reportedRow.proposal_id,
      );
      const alreadySameIdentity =
        projection.canonicalNaturalKeyForNatural(
          reportedRow.connector_account_id,
          reportedRow.natural_key_sha256,
        ) ===
        projection.canonicalNaturalKeyForNatural(
          missingRow.connector_account_id,
          missingRow.natural_key_sha256,
        );
      if (
        reportedRow.natural_key_sha256 === missingRow.natural_key_sha256 ||
        reportedHistory.length !== 1 ||
        !priorReportedExists ||
        alreadySameIdentity ||
        decidedPairs.has(pairKey)
      ) {
        return;
      }
      candidates.push({
        connectionId: reportedRow.connector_account_id,
        institutionLabel: reportedRow.institution_label,
        accountLabel: reportedRow.account_label,
        subtype: reportedRow.subtype,
        priorNaturalKeySha256: missingRow.natural_key_sha256,
        reportedNaturalKeySha256: reportedRow.natural_key_sha256,
        observedAt: reportedRow.observed_at,
      });
    });
  });
  return candidates.sort(
    (left, right) =>
      left.institutionLabel.localeCompare(right.institutionLabel) ||
      left.accountLabel.localeCompare(right.accountLabel) ||
      left.priorNaturalKeySha256.localeCompare(right.priorNaturalKeySha256),
  );
}

function proposalAction(
  row: ProposalSourceRow,
  prior: AcceptedCashAccount | undefined,
): CashAccountProposalRow["action"] {
  if (row.value_state === "unsupported" || row.value_state === "unavailable") {
    return "needs_attention";
  }
  if (row.value_state === "not_reported") {
    return "not_reported";
  }
  if (prior === undefined) {
    return "new_account";
  }
  if (
    prior.valueState === row.value_state &&
    prior.valueMinor === row.value_minor
  ) {
    return "no_change";
  }
  return "update_balance";
}

function proposalRowFrom(
  row: ProposalSourceRow,
  prior: AcceptedCashAccount | undefined,
): CashAccountProposalRow {
  return {
    id: row.id,
    naturalKeySha256: row.natural_key_sha256,
    institutionLabel: row.institution_label,
    accountLabel: row.account_label,
    subtype: row.subtype,
    availableMinor: row.available_minor,
    currentMinor: row.current_minor,
    valueMinor: row.value_minor,
    valueState: row.value_state,
    balanceSource: row.balance_source,
    observedAt: row.observed_at,
    priorValueMinor: prior?.valueMinor ?? null,
    priorValueState: prior?.valueState ?? null,
    action: proposalAction(row, prior),
    issues: issuesFromJson(row.issues_json),
  };
}

function summarize(rows: readonly CashAccountProposalRow[]) {
  return {
    rowCount: rows.length,
    reportedCount: rows.filter((row) => row.valueState === "reported").length,
    needsAttentionCount: rows.filter((row) => row.action === "needs_attention")
      .length,
    notReportedCount: rows.filter((row) => row.valueState === "not_reported")
      .length,
    totalReportedMinor: addMinorUnits(
      ...rows.map((row) => row.valueMinor ?? 0),
    ),
  };
}

export interface CashAccountsRepository {
  getState(
    accessSubject: string,
    configured: boolean,
  ): Promise<CashAccountsState>;
  upsertConnection(
    accessSubject: string,
    institutionLabel: string,
    secretReference: string,
    providerAccountKey: string,
  ): Promise<CashAccountConnectionUpdate>;
  getConnection(
    accessSubject: string,
    connectionId: string,
  ): Promise<CashAccountConnection | null>;
  beginDisconnect(
    accessSubject: string,
    connectionId: string,
  ): Promise<CashAccountConnection>;
  cancelDisconnect(accessSubject: string, connectionId: string): Promise<void>;
  completeDisconnect(
    accessSubject: string,
    connectionId: string,
  ): Promise<void>;
  beginRefresh(
    accessSubject: string,
    connectionId: string,
    refreshKind: "initial" | "live",
  ): Promise<CashAccountRefreshRun>;
  beginAutomaticRefresh(
    accessSubject: string,
    connectionId: string,
    refreshedAfter: string,
  ): Promise<CashAccountRefreshRun | null>;
  stageProposal(
    accessSubject: string,
    runId: string,
    input: {
      objectKey: string;
      sourceSha256: string;
      normalized: NormalizedCashAccounts;
    },
  ): Promise<CashBalanceProposalStageResult>;
  completeRefresh(
    accessSubject: string,
    runId: string,
    proposalId: string | null,
    discoveredCount: number,
  ): Promise<void>;
  failRefresh(
    accessSubject: string,
    runId: string,
    errorCode: CashAccountsErrorCode,
  ): Promise<void>;
  applyProposal(
    accessSubject: string,
    proposalId: string,
    input: CashAccountApplyInput,
  ): Promise<CashAccountApplyResult>;
  reviewIdentity(
    accessSubject: string,
    input: CashAccountIdentityReviewInput,
  ): Promise<void>;
}

export class D1CashAccountsRepository implements CashAccountsRepository {
  public constructor(private readonly db: D1Database) {}

  public async listAcceptedAccountsForHousehold(
    householdId: string,
  ): Promise<AcceptedCashAccount[]> {
    return (await this.acceptedIdentityState(householdId)).acceptedAccounts;
  }

  public async getState(
    accessSubject: string,
    configured: boolean,
  ): Promise<CashAccountsState> {
    const identity = await findIdentity(this.db, accessSubject);
    const [connections, acceptedIdentity, pendingProposals] = await Promise.all(
      [
        this.connectionStateRows(identity.household_id),
        this.acceptedIdentityState(identity.household_id),
        this.pendingProposals(identity.household_id),
      ],
    );
    const errorCode = connections
      .map((connection) => connection.latest_error_code)
      .find((code): code is string => code !== null);
    const parsedErrorCode =
      errorCode === undefined
        ? null
        : CashAccountsErrorCodeSchema.catch("unexpected_failure").parse(
            errorCode,
          );
    const hasFailedConnection = connections.some(
      (connection) => connection.latest_run_status === "failed",
    );

    return CashAccountsStateSchema.parse({
      version: 1,
      configured,
      status: !configured
        ? "setup_required"
        : connections.length === 0
          ? "disconnected"
          : hasFailedConnection
            ? "needs_attention"
            : "ready",
      connections: connections.map((connection) => ({
        id: connection.id,
        institutionLabel: connection.display_label,
        status:
          connection.latest_run_status === "failed"
            ? "needs_attention"
            : "ready",
        lastCheckedAt: connection.last_synced_at,
        liveRefreshLimit: LIVE_REFRESH_LIMIT,
        liveRefreshesUsed: connection.live_refreshes_used,
        liveRefreshesRemaining: Math.max(
          LIVE_REFRESH_LIMIT - connection.live_refreshes_used,
          0,
        ),
      })),
      acceptedAccounts: acceptedIdentity.acceptedAccounts,
      identityCandidates: acceptedIdentity.identityCandidates,
      pendingProposals,
      errorCode: configured ? parsedErrorCode : "configuration_required",
    });
  }

  public async upsertConnection(
    accessSubject: string,
    rawInstitutionLabel: string,
    rawSecretReference: string,
    rawProviderAccountKey: string,
  ): Promise<CashAccountConnectionUpdate> {
    const institutionLabel = z
      .string()
      .trim()
      .min(1)
      .max(512)
      .parse(rawInstitutionLabel);
    const secretReference = z
      .string()
      .min(1)
      .max(1_024)
      .parse(rawSecretReference);
    const providerAccountKey = SHA256_SCHEMA.parse(rawProviderAccountKey);
    const identity = await findIdentity(this.db, accessSubject);
    const existing = await this.db
      .prepare(
        `SELECT id, display_label, secret_reference, status, last_synced_at,
                provider_account_key
         FROM connector_accounts
         WHERE household_id = ? AND connector_type = ?
           AND (provider_account_key = ? OR display_label = ?)
         ORDER BY CASE WHEN provider_account_key = ? THEN 0 ELSE 1 END, created_at
         LIMIT 1`,
      )
      .bind(
        identity.household_id,
        CONNECTOR_TYPE,
        providerAccountKey,
        institutionLabel,
        providerAccountKey,
      )
      .first<ConnectionRow>();
    if (existing === null) {
      const id = crypto.randomUUID();
      await this.db
        .prepare(
          `INSERT INTO connector_accounts (
             id, household_id, connector_type, display_label, secret_reference,
             status, last_synced_at, provider_account_key, created_at
           ) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
        )
        .bind(
          id,
          identity.household_id,
          CONNECTOR_TYPE,
          institutionLabel,
          secretReference,
          providerAccountKey,
          new Date().toISOString(),
        )
        .run();
      return {
        id,
        institutionLabel,
        secretReference,
        providerAccountKey,
        previousSecretReference: null,
      };
    }

    if (existing.status !== "revoked") {
      throw new CashAccountRepositoryError(
        "connection_invalid",
        "Disconnect this institution before connecting it again.",
      );
    }

    if (
      await this.hasPendingProposalOrActiveRefresh(
        identity.household_id,
        existing.id,
      )
    ) {
      throw new CashAccountRepositoryError(
        "review_required",
        "Review the waiting balances before reconnecting this institution.",
      );
    }

    await this.db
      .prepare(
        `UPDATE connector_accounts
         SET display_label = ?, secret_reference = ?, provider_account_key = ?,
             status = 'active'
         WHERE id = ? AND household_id = ? AND connector_type = ?`,
      )
      .bind(
        institutionLabel,
        secretReference,
        providerAccountKey,
        existing.id,
        identity.household_id,
        CONNECTOR_TYPE,
      )
      .run();
    return {
      id: existing.id,
      institutionLabel,
      secretReference,
      providerAccountKey,
      previousSecretReference: existing.secret_reference,
    };
  }

  public async getConnection(
    accessSubject: string,
    rawConnectionId: string,
  ): Promise<CashAccountConnection | null> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const identity = await findIdentity(this.db, accessSubject);
    const row = await this.db
      .prepare(
        `SELECT id, display_label, secret_reference, status, last_synced_at,
                provider_account_key
         FROM connector_accounts
         WHERE id = ? AND household_id = ? AND connector_type = ?
         LIMIT 1`,
      )
      .bind(connectionId, identity.household_id, CONNECTOR_TYPE)
      .first<ConnectionRow>();
    if (
      row === null ||
      row.status !== "active" ||
      row.provider_account_key === null
    ) {
      return null;
    }
    return {
      id: row.id,
      institutionLabel: row.display_label,
      secretReference: row.secret_reference,
      providerAccountKey: row.provider_account_key,
    };
  }

  public async beginDisconnect(
    accessSubject: string,
    rawConnectionId: string,
  ): Promise<CashAccountConnection> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const connection = await this.getConnection(accessSubject, connectionId);
    if (connection === null) {
      throw new CashAccountRepositoryError(
        "connection_invalid",
        "This institution is no longer connected.",
      );
    }
    const identity = await findIdentity(this.db, accessSubject);
    const result = await this.db
      .prepare(
        `UPDATE connector_accounts AS account SET status = 'paused'
         WHERE account.id = ? AND account.household_id = ?
           AND account.connector_type = ? AND account.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM connector_sync_runs run
             WHERE run.connector_account_id = account.id
               AND run.status IN ('queued', 'running')
           )
           AND NOT EXISTS (
             SELECT 1 FROM cash_balance_proposals proposal
             WHERE proposal.connector_account_id = account.id
               AND proposal.status = 'pending_review'
           )
           AND NOT EXISTS (
             SELECT 1 FROM cash_flow_proposals proposal
             JOIN connector_sync_runs run
               ON run.id = proposal.trigger_sync_run_id
             WHERE run.connector_account_id = account.id
               AND proposal.status IN ('pending_review', 'ready_for_plan')
           )`,
      )
      .bind(connectionId, identity.household_id, CONNECTOR_TYPE)
      .run();
    if (result.meta.changes !== 1) {
      throw new CashAccountRepositoryError(
        "review_required",
        "Finish the waiting review or check before disconnecting.",
      );
    }
    return connection;
  }

  public async cancelDisconnect(
    accessSubject: string,
    rawConnectionId: string,
  ): Promise<void> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const identity = await findIdentity(this.db, accessSubject);
    await this.db
      .prepare(
        `UPDATE connector_accounts SET status = 'active'
         WHERE id = ? AND household_id = ? AND connector_type = ?
           AND status = 'paused'`,
      )
      .bind(connectionId, identity.household_id, CONNECTOR_TYPE)
      .run();
  }

  public async completeDisconnect(
    accessSubject: string,
    rawConnectionId: string,
  ): Promise<void> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const identity = await findIdentity(this.db, accessSubject);
    const paused = `EXISTS (
      SELECT 1 FROM connector_accounts account
      WHERE account.id = ? AND account.household_id = ?
        AND account.connector_type = ? AND account.status = 'paused'
    )`;
    await this.db.batch([
      this.db
        .prepare(
          `DELETE FROM cash_flow_transaction_revisions
           WHERE connector_account_id = ? AND ${paused}`,
        )
        .bind(
          connectionId,
          connectionId,
          identity.household_id,
          CONNECTOR_TYPE,
        ),
      this.db
        .prepare(
          `DELETE FROM cash_flow_connections
           WHERE connector_account_id = ? AND ${paused}`,
        )
        .bind(
          connectionId,
          connectionId,
          identity.household_id,
          CONNECTOR_TYPE,
        ),
      this.db
        .prepare(
          `UPDATE connector_accounts SET status = 'revoked'
           WHERE id = ? AND household_id = ? AND connector_type = ?
             AND status = 'paused'`,
        )
        .bind(connectionId, identity.household_id, CONNECTOR_TYPE),
    ]);
    const result = await this.db
      .prepare(
        `SELECT status FROM connector_accounts
         WHERE id = ? AND household_id = ? AND connector_type = ?`,
      )
      .bind(connectionId, identity.household_id, CONNECTOR_TYPE)
      .first<{ status: ConnectionRow["status"] }>();
    if (result?.status !== "revoked") {
      throw new CashAccountRepositoryError(
        "connection_invalid",
        "This institution could not be disconnected.",
      );
    }
  }

  public async beginRefresh(
    accessSubject: string,
    rawConnectionId: string,
    rawRefreshKind: "initial" | "live",
  ): Promise<CashAccountRefreshRun> {
    const refreshKind = z.enum(["initial", "live"]).parse(rawRefreshKind);
    const connection = await this.getConnection(accessSubject, rawConnectionId);
    if (connection === null) {
      throw new CashAccountRepositoryError(
        "connection_invalid",
        "Reconnect this institution to continue.",
      );
    }
    const identity = await findIdentity(this.db, accessSubject);
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const result = await this.db
      .prepare(
        `INSERT INTO connector_sync_runs (
           id, household_id, connector_account_id, status, started_at,
           finished_at, cursor, discovered_count, proposed_count, error_code
         )
         SELECT ?, ?, ?, 'running', ?, NULL, ?, 0, 0, NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM cash_balance_proposals proposal
           WHERE proposal.household_id = ?
             AND proposal.connector_account_id = ?
             AND proposal.status = 'pending_review'
         )
         AND NOT EXISTS (
           SELECT 1 FROM connector_sync_runs active
           WHERE active.household_id = ?
             AND active.connector_account_id = ?
             AND active.cursor IN ('cash-initial-v1', 'cash-live-v1')
             AND active.status IN ('queued', 'running')
         )
         AND (
           ? = 'initial'
           OR (
             SELECT COUNT(*) FROM connector_sync_runs used
             WHERE used.household_id = ?
               AND used.connector_account_id = ?
               AND used.cursor = 'cash-live-v1'
               AND substr(used.started_at, 1, 7) = ?
           ) < ?
         )`,
      )
      .bind(
        id,
        identity.household_id,
        connection.id,
        startedAt,
        refreshKind === "initial" ? "cash-initial-v1" : "cash-live-v1",
        identity.household_id,
        connection.id,
        identity.household_id,
        connection.id,
        refreshKind,
        identity.household_id,
        connection.id,
        monthPrefix(new Date(startedAt)),
        LIVE_REFRESH_LIMIT,
      )
      .run();
    if (result.meta.changes !== 1) {
      if (
        await this.hasPendingProposalOrActiveRefresh(
          identity.household_id,
          connection.id,
        )
      ) {
        throw new CashAccountRepositoryError(
          "review_required",
          "Review the waiting balances before checking this institution again.",
        );
      }
      throw new CashAccountRepositoryError(
        "monthly_limit_reached",
        "This institution has used its live balance checks for this month.",
      );
    }
    return { id, connection, refreshKind };
  }

  public async beginAutomaticRefresh(
    accessSubject: string,
    rawConnectionId: string,
    rawRefreshedAfter: string,
  ): Promise<CashAccountRefreshRun | null> {
    const refreshedAfter = z.iso
      .datetime({ offset: true })
      .parse(rawRefreshedAfter);
    const connection = await this.getConnection(accessSubject, rawConnectionId);
    if (connection === null) {
      return null;
    }
    const identity = await findIdentity(this.db, accessSubject);
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const result = await this.db
      .prepare(
        `INSERT INTO connector_sync_runs (
           id, household_id, connector_account_id, status, started_at,
           finished_at, cursor, discovered_count, proposed_count, error_code
         )
         SELECT ?, ?, ?, 'running', ?, NULL, 'cash-live-v1', 0, 0, NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM cash_balance_proposals proposal
           WHERE proposal.household_id = ?
             AND proposal.connector_account_id = ?
             AND proposal.status = 'pending_review'
         )
         AND NOT EXISTS (
           SELECT 1 FROM connector_sync_runs active
           WHERE active.household_id = ?
             AND active.connector_account_id = ?
             AND active.cursor IN ('cash-initial-v1', 'cash-live-v1')
             AND active.status IN ('queued', 'running')
         )
         AND NOT EXISTS (
           SELECT 1 FROM connector_sync_runs recent
           WHERE recent.household_id = ?
             AND recent.connector_account_id = ?
             AND recent.cursor = 'cash-live-v1'
             AND recent.started_at >= ?
         )
         AND (
           SELECT COUNT(*) FROM connector_sync_runs used
           WHERE used.household_id = ?
             AND used.connector_account_id = ?
             AND used.cursor = 'cash-live-v1'
             AND substr(used.started_at, 1, 7) = ?
         ) < ?`,
      )
      .bind(
        id,
        identity.household_id,
        connection.id,
        startedAt,
        identity.household_id,
        connection.id,
        identity.household_id,
        connection.id,
        identity.household_id,
        connection.id,
        refreshedAfter,
        identity.household_id,
        connection.id,
        monthPrefix(new Date(startedAt)),
        LIVE_REFRESH_LIMIT,
      )
      .run();
    return result.meta.changes === 1
      ? { id, connection, refreshKind: "live" }
      : null;
  }

  public async stageProposal(
    accessSubject: string,
    rawRunId: string,
    input: {
      objectKey: string;
      sourceSha256: string;
      normalized: NormalizedCashAccounts;
    },
  ): Promise<CashBalanceProposalStageResult> {
    const runId = z.string().min(1).parse(rawRunId);
    const objectKey = z.string().min(1).max(1_024).parse(input.objectKey);
    const sourceSha256 = SHA256_SCHEMA.parse(input.sourceSha256);
    const normalizedFingerprint = SHA256_SCHEMA.parse(
      input.normalized.normalizedFingerprint,
    );
    const identity = await findIdentity(this.db, accessSubject);
    const run = await this.db
      .prepare(
        `SELECT run.connector_account_id, run.cursor, account.display_label
         FROM connector_sync_runs run
         JOIN connector_accounts account ON account.id = run.connector_account_id
         WHERE run.id = ? AND run.household_id = ? AND run.status = 'running'
           AND account.connector_type = ?`,
      )
      .bind(runId, identity.household_id, CONNECTOR_TYPE)
      .first<{
        connector_account_id: string;
        cursor: "cash-initial-v1" | "cash-live-v1";
        display_label: string;
      }>();
    if (run === null) {
      throw new CashAccountRepositoryError(
        "staging_failed",
        "The cash balance check is no longer active.",
      );
    }
    const [acceptedHistory, identityDecisions] = await Promise.all([
      this.acceptedAccountRows(identity.household_id, run.connector_account_id),
      this.effectiveIdentityDecisions(
        identity.household_id,
        run.connector_account_id,
      ),
    ]);
    const identityProjection = projectCashAccountIdentities(
      acceptedHistory,
      input.normalized.rows.map((row) => ({
        connectorAccountId: run.connector_account_id,
        naturalKeySha256: row.naturalKeySha256,
        itemAccountKeySha256: row.itemAccountKeySha256,
      })),
      sameAccountLinks(identityDecisions),
    );
    const accepted = identityProjection.acceptedRows.map(
      ({ canonicalNaturalKeySha256, row }) =>
        acceptedFromCanonicalRow(row, canonicalNaturalKeySha256),
    );
    const acceptedByKey = new Map(
      accepted.map((account) => [account.naturalKeySha256, account]),
    );
    const observedRows = input.normalized.rows.map((row) => ({
      ...row,
      naturalKeySha256: identityProjection.canonicalNaturalKeyFor(
        run.connector_account_id,
        row.naturalKeySha256,
        row.itemAccountKeySha256,
      ),
    }));
    const observedKeys = new Set(
      observedRows.map((row) => row.naturalKeySha256),
    );
    if (observedKeys.size !== observedRows.length) {
      throw new CashAccountRepositoryError(
        "staging_failed",
        "The provider returned duplicate cash account identities.",
      );
    }
    const materialRows: Omit<ProposalSourceRow, "id">[] = [
      ...observedRows.map((row) => ({
        natural_key_sha256: row.naturalKeySha256,
        item_account_key_sha256: row.itemAccountKeySha256,
        institution_label: row.institutionLabel,
        account_label: row.accountLabel,
        subtype: row.subtype,
        available_minor: row.availableMinor,
        current_minor: row.currentMinor,
        value_minor: row.valueMinor,
        value_state: row.valueState,
        balance_source: row.balanceSource,
        observed_at: row.observedAt,
        issues_json: JSON.stringify(row.issues),
      })),
      ...accepted
        .filter((account) => !observedKeys.has(account.naturalKeySha256))
        .map((account) => ({
          natural_key_sha256: account.naturalKeySha256,
          item_account_key_sha256: null,
          institution_label: account.institutionLabel,
          account_label: account.accountLabel,
          subtype: account.subtype,
          available_minor: null,
          current_minor: null,
          value_minor: null,
          value_state: "not_reported" as const,
          balance_source: null,
          observed_at: input.normalized.observedAt,
          issues_json: JSON.stringify([
            "This account was not reported in the latest balance check.",
          ]),
        })),
    ];
    if (materialRows.length === 0) {
      return { proposal: null };
    }

    const proposalId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const rowRecords: ProposalSourceRow[] = materialRows.map((row) => ({
      id: crypto.randomUUID(),
      ...row,
    }));
    const rows = rowRecords.map((row) =>
      proposalRowFrom(row, acceptedByKey.get(row.natural_key_sha256)),
    );
    if (rows.every((row) => row.action === "no_change")) {
      return { proposal: null };
    }
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO cash_balance_proposals (
             id, household_id, connector_account_id, sync_run_id,
             source_object_key, source_sha256, normalized_fingerprint,
             refresh_kind, observed_at, retrieved_at, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)`,
        )
        .bind(
          proposalId,
          identity.household_id,
          run.connector_account_id,
          runId,
          objectKey,
          sourceSha256,
          normalizedFingerprint,
          run.cursor === "cash-initial-v1" ? "initial" : "live",
          input.normalized.observedAt,
          input.normalized.observedAt,
          createdAt,
        ),
    ];
    rowRecords.forEach((row) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO cash_balance_proposal_rows (
               id, household_id, proposal_id, natural_key_sha256,
               item_account_key_sha256,
               institution_label, account_label, subtype, available_minor,
               current_minor, value_minor, value_state, balance_source,
               observed_at, issues_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            row.id,
            identity.household_id,
            proposalId,
            row.natural_key_sha256,
            row.item_account_key_sha256,
            row.institution_label,
            row.account_label,
            row.subtype,
            row.available_minor,
            row.current_minor,
            row.value_minor,
            row.value_state,
            row.balance_source,
            row.observed_at,
            row.issues_json,
            createdAt,
          ),
      );
    });
    await this.db.batch(statements);
    return {
      proposal: {
        id: proposalId,
        connectionId: run.connector_account_id,
        institutionLabel: run.display_label,
        status: "pending_review",
        refreshKind: run.cursor === "cash-initial-v1" ? "initial" : "live",
        observedAt: input.normalized.observedAt,
        retrievedAt: input.normalized.observedAt,
        summary: summarize(rows),
        rows,
      },
    };
  }

  public async completeRefresh(
    accessSubject: string,
    rawRunId: string,
    rawProposalId: string | null,
    rawDiscoveredCount: number,
  ): Promise<void> {
    const runId = z.string().min(1).parse(rawRunId);
    const proposalId = z.string().min(1).nullable().parse(rawProposalId);
    const discoveredCount = z
      .number()
      .int()
      .nonnegative()
      .parse(rawDiscoveredCount);
    const identity = await findIdentity(this.db, accessSubject);
    const finishedAt = new Date().toISOString();
    const proposalRowCount =
      proposalId === null
        ? 0
        : ((
            await this.db
              .prepare(
                `SELECT COUNT(*) AS count
                 FROM cash_balance_proposal_rows row
                 JOIN cash_balance_proposals proposal
                   ON proposal.id = row.proposal_id
                 WHERE proposal.id = ? AND proposal.sync_run_id = ?
                   AND proposal.household_id = ?`,
              )
              .bind(proposalId, runId, identity.household_id)
              .first<{ count: number }>()
          )?.count ?? 0);
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE connector_sync_runs
           SET status = 'succeeded', finished_at = ?, discovered_count = ?,
               proposed_count = ?, error_code = NULL
           WHERE id = ? AND household_id = ? AND status = 'running'
             AND connector_account_id IN (
               SELECT id FROM connector_accounts
               WHERE household_id = ? AND connector_type = ?
             )`,
        )
        .bind(
          finishedAt,
          discoveredCount,
          proposalRowCount,
          runId,
          identity.household_id,
          identity.household_id,
          CONNECTOR_TYPE,
        ),
      this.db
        .prepare(
          `UPDATE connector_accounts
           SET last_synced_at = ?
           WHERE household_id = ? AND connector_type = ?
             AND id = (
               SELECT connector_account_id FROM connector_sync_runs
               WHERE id = ? AND household_id = ?
             )`,
        )
        .bind(
          finishedAt,
          identity.household_id,
          CONNECTOR_TYPE,
          runId,
          identity.household_id,
        ),
    ]);
  }

  public async failRefresh(
    accessSubject: string,
    rawRunId: string,
    rawErrorCode: CashAccountsErrorCode,
  ): Promise<void> {
    const runId = z.string().min(1).parse(rawRunId);
    const errorCode = CashAccountsErrorCodeSchema.parse(rawErrorCode);
    const identity = await findIdentity(this.db, accessSubject);
    await this.db
      .prepare(
        `UPDATE connector_sync_runs
         SET status = 'failed', finished_at = ?, error_code = ?
         WHERE id = ? AND household_id = ? AND status = 'running'
           AND connector_account_id IN (
             SELECT id FROM connector_accounts
             WHERE household_id = ? AND connector_type = ?
           )`,
      )
      .bind(
        new Date().toISOString(),
        errorCode,
        runId,
        identity.household_id,
        identity.household_id,
        CONNECTOR_TYPE,
      )
      .run();
  }

  public async applyProposal(
    accessSubject: string,
    rawProposalId: string,
    rawInput: CashAccountApplyInput,
  ): Promise<CashAccountApplyResult> {
    const proposalId = z.string().min(1).parse(rawProposalId);
    const input = CashAccountApplyInputSchema.parse(rawInput);
    const identity = await findIdentity(this.db, accessSubject);
    const rows = await all<ProposalSourceRow>(
      this.db
        .prepare(
          `SELECT row.id, row.natural_key_sha256,
                  row.item_account_key_sha256, row.institution_label,
                  row.account_label, row.subtype, row.available_minor,
                  row.current_minor, row.value_minor, row.value_state,
                  row.balance_source, row.observed_at, row.issues_json
           FROM cash_balance_proposal_rows row
           JOIN cash_balance_proposals proposal ON proposal.id = row.proposal_id
           WHERE proposal.id = ? AND proposal.household_id = ?
             AND proposal.status = 'pending_review'
           ORDER BY row.account_label, row.id`,
        )
        .bind(proposalId, identity.household_id),
    );
    if (rows.length === 0) {
      throw new Error("Cash balance proposal is stale.");
    }
    const decisionByRow = new Map(
      input.decisions.map((decision) => [decision.rowId, decision.decision]),
    );
    if (
      decisionByRow.size !== input.decisions.length ||
      decisionByRow.size !== rows.length ||
      rows.some((row) => !decisionByRow.has(row.id))
    ) {
      throw new Error("Every cash account needs one review decision.");
    }
    rows.forEach((row) => {
      if (
        decisionByRow.get(row.id) === "accepted" &&
        (row.value_state === "unsupported" || row.value_state === "unavailable")
      ) {
        throw new Error("A cash account needing attention cannot be accepted.");
      }
    });
    const decidedAt = new Date().toISOString();
    const statements = rows.map((row) =>
      this.db
        .prepare(
          `INSERT INTO cash_balance_review_decisions (
             id, household_id, proposal_id, proposal_row_id, reviewer_user_id,
             decision, change_note, decided_at, immutable
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          proposalId,
          row.id,
          identity.user_id,
          decisionByRow.get(row.id),
          input.changeNote,
          decidedAt,
        ),
    );
    statements.push(
      this.db
        .prepare(
          `UPDATE cash_balance_proposals SET status = 'applied'
           WHERE id = ? AND household_id = ? AND status = 'pending_review'`,
        )
        .bind(proposalId, identity.household_id),
    );
    await this.db.batch(statements);
    const acceptedAccounts = await this.acceptedAccounts(identity.household_id);
    const acceptedCount = input.decisions.filter(
      (decision) => decision.decision === "accepted",
    ).length;
    return CashAccountApplyResultSchema.parse({
      proposalId,
      acceptedCount,
      excludedCount: rows.length - acceptedCount,
      acceptedCashMinor: addMinorUnits(
        ...acceptedAccounts.map((account) => account.valueMinor ?? 0),
      ),
    });
  }

  public async reviewIdentity(
    accessSubject: string,
    rawInput: CashAccountIdentityReviewInput,
  ): Promise<void> {
    const input = CashAccountIdentityReviewInputSchema.parse(rawInput);
    const identity = await findIdentity(this.db, accessSubject);
    const [rows, decisions] = await Promise.all([
      this.acceptedAccountRows(identity.household_id, input.connectionId),
      this.effectiveIdentityDecisions(
        identity.household_id,
        input.connectionId,
      ),
    ]);
    const candidate = identityCandidates(rows, decisions).find(
      (item) =>
        item.connectionId === input.connectionId &&
        item.priorNaturalKeySha256 === input.priorNaturalKeySha256 &&
        item.reportedNaturalKeySha256 === input.reportedNaturalKeySha256,
    );
    if (candidate === undefined) {
      throw new CashAccountRepositoryError(
        "review_required",
        "This cash account identity review is no longer current.",
      );
    }
    const [naturalKeyLowSha256, naturalKeyHighSha256] = orderedIdentityKeys(
      input.priorNaturalKeySha256,
      input.reportedNaturalKeySha256,
    );
    await this.db
      .prepare(
        `INSERT INTO cash_account_identity_decisions (
           id, household_id, connector_account_id,
           natural_key_low_sha256, natural_key_high_sha256, decision,
           supersedes_decision_id, reviewer_user_id, change_note, decided_at,
           immutable
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1)`,
      )
      .bind(
        crypto.randomUUID(),
        identity.household_id,
        input.connectionId,
        naturalKeyLowSha256,
        naturalKeyHighSha256,
        input.decision,
        identity.user_id,
        input.changeNote,
        new Date().toISOString(),
      )
      .run();
  }

  private connectionStateRows(householdId: string) {
    return all<ConnectionStateRow>(
      this.db
        .prepare(
          `SELECT
             account.id, account.display_label, account.secret_reference,
             account.status, account.last_synced_at,
             account.provider_account_key,
             (
               SELECT run.status FROM connector_sync_runs run
               WHERE run.connector_account_id = account.id
               ORDER BY run.started_at DESC, run.id DESC LIMIT 1
             ) AS latest_run_status,
             (
               SELECT run.error_code FROM connector_sync_runs run
               WHERE run.connector_account_id = account.id
               ORDER BY run.started_at DESC, run.id DESC LIMIT 1
             ) AS latest_error_code,
             (
               SELECT COUNT(*) FROM connector_sync_runs run
               WHERE run.connector_account_id = account.id
                 AND run.cursor = 'cash-live-v1'
                 AND substr(run.started_at, 1, 7) = ?
             ) AS live_refreshes_used
           FROM connector_accounts account
           WHERE account.household_id = ? AND account.connector_type = ?
             AND account.status = 'active'
           ORDER BY account.display_label, account.id`,
        )
        .bind(monthPrefix(), householdId, CONNECTOR_TYPE),
    );
  }

  private async liveRefreshesUsed(
    householdId: string,
    connectionId: string,
  ): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM connector_sync_runs
         WHERE household_id = ? AND connector_account_id = ?
           AND cursor = 'cash-live-v1'
           AND substr(started_at, 1, 7) = ?`,
      )
      .bind(householdId, connectionId, monthPrefix())
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  private async hasPendingProposalOrActiveRefresh(
    householdId: string,
    connectionId: string,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT (
           EXISTS (
             SELECT 1 FROM cash_balance_proposals proposal
             WHERE proposal.household_id = ?
               AND proposal.connector_account_id = ?
               AND proposal.status = 'pending_review'
           )
           OR EXISTS (
             SELECT 1 FROM connector_sync_runs run
             WHERE run.household_id = ?
               AND run.connector_account_id = ?
               AND run.cursor IN ('cash-initial-v1', 'cash-live-v1')
               AND run.status IN ('queued', 'running')
           )
         ) AS blocked`,
      )
      .bind(householdId, connectionId, householdId, connectionId)
      .first<{ blocked: number }>();
    return row?.blocked === 1;
  }

  private async acceptedAccounts(
    householdId: string,
    connectionId?: string,
  ): Promise<AcceptedCashAccount[]> {
    return (await this.acceptedIdentityState(householdId, connectionId))
      .acceptedAccounts;
  }

  private async acceptedIdentityState(
    householdId: string,
    connectionId?: string,
  ): Promise<{
    acceptedAccounts: AcceptedCashAccount[];
    identityCandidates: CashAccountIdentityCandidate[];
  }> {
    const [rows, decisions] = await Promise.all([
      this.acceptedAccountRows(householdId, connectionId),
      this.effectiveIdentityDecisions(householdId, connectionId),
    ]);
    const projection = projectCashAccountIdentities(
      rows,
      [],
      sameAccountLinks(decisions),
    );
    return {
      acceptedAccounts: projection.acceptedRows.map(
        ({ canonicalNaturalKeySha256, row }) =>
          acceptedFromCanonicalRow(row, canonicalNaturalKeySha256),
      ),
      identityCandidates: identityCandidates(rows, decisions),
    };
  }

  private async acceptedAccountRows(
    householdId: string,
    connectionId?: string,
  ): Promise<readonly AcceptedCashAccountHistoryRow[]> {
    const rows = await all<AcceptedCashAccountHistoryRow>(
      this.db
        .prepare(
          `SELECT decision.id AS decision_id, proposal.id AS proposal_id,
                  row.natural_key_sha256,
                  row.item_account_key_sha256,
                  proposal.connector_account_id, row.institution_label,
                  row.account_label, row.subtype, row.value_minor,
                  row.value_state, row.balance_source, proposal.refresh_kind,
                  row.observed_at, decision.decided_at
           FROM cash_balance_review_decisions decision
           JOIN cash_balance_proposal_rows row
             ON row.id = decision.proposal_row_id
           JOIN cash_balance_proposals proposal
             ON proposal.id = decision.proposal_id
           WHERE decision.household_id = ? AND decision.decision = 'accepted'
             AND (? IS NULL OR proposal.connector_account_id = ?)
           ORDER BY decision.decided_at, decision.id`,
        )
        .bind(householdId, connectionId ?? null, connectionId ?? null),
    );
    return rows;
  }

  private effectiveIdentityDecisions(
    householdId: string,
    connectionId?: string,
  ): Promise<readonly CashAccountIdentityDecisionRow[]> {
    return all<CashAccountIdentityDecisionRow>(
      this.db
        .prepare(
          `SELECT decision.id, decision.connector_account_id,
                  decision.natural_key_low_sha256,
                  decision.natural_key_high_sha256, decision.decision
           FROM cash_account_identity_decisions decision
           WHERE decision.household_id = ?
             AND (? IS NULL OR decision.connector_account_id = ?)
             AND NOT EXISTS (
               SELECT 1 FROM cash_account_identity_decisions later
               WHERE later.supersedes_decision_id = decision.id
             )
           ORDER BY decision.decided_at, decision.id`,
        )
        .bind(householdId, connectionId ?? null, connectionId ?? null),
    );
  }

  private async pendingProposals(
    householdId: string,
  ): Promise<CashBalanceProposal[]> {
    const proposals = await all<ProposalRow>(
      this.db
        .prepare(
          `SELECT proposal.id, proposal.connector_account_id,
                  account.display_label AS institution_label,
                  proposal.refresh_kind, proposal.observed_at,
                  proposal.retrieved_at
           FROM cash_balance_proposals proposal
           JOIN connector_accounts account
             ON account.id = proposal.connector_account_id
           WHERE proposal.household_id = ?
             AND proposal.status = 'pending_review'
           ORDER BY proposal.created_at, proposal.id`,
        )
        .bind(householdId),
    );
    const accepted = await this.acceptedAccounts(householdId);
    const acceptedByKey = new Map(
      accepted.map((account) => [account.naturalKeySha256, account]),
    );
    return Promise.all(
      proposals.map(async (proposal) => {
        const sourceRows = await all<ProposalSourceRow>(
          this.db
            .prepare(
              `SELECT id, natural_key_sha256, item_account_key_sha256,
                      institution_label,
                      account_label, subtype, available_minor, current_minor,
                      value_minor, value_state, balance_source, observed_at,
                      issues_json
               FROM cash_balance_proposal_rows
               WHERE household_id = ? AND proposal_id = ?
               ORDER BY account_label, id`,
            )
            .bind(householdId, proposal.id),
        );
        const rows = sourceRows.map((row) =>
          proposalRowFrom(row, acceptedByKey.get(row.natural_key_sha256)),
        );
        return {
          id: proposal.id,
          connectionId: proposal.connector_account_id,
          institutionLabel: proposal.institution_label,
          status: "pending_review" as const,
          refreshKind: proposal.refresh_kind,
          observedAt: proposal.observed_at,
          retrievedAt: proposal.retrieved_at,
          summary: summarize(rows),
          rows,
        };
      }),
    );
  }
}
