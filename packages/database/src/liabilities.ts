import type { NormalizedLiabilities } from "@keel/connectors";
import {
  addMinorUnits,
  createLiabilityImpact,
  LiabilitiesErrorCodeSchema,
  LiabilitiesStateSchema,
  liabilityClassification,
  LiabilityApplyInputSchema,
  LiabilityApplyResultSchema,
  ManualLiabilityInputSchema,
  type AcceptedLiability,
  type LiabilitiesErrorCode,
  type LiabilitiesState,
  type LiabilityApplyInput,
  type LiabilityApplyResult,
  type LiabilityPlanningContextSchema,
  type LiabilityProposal,
  type LiabilityProposalRow,
  type LiabilityValueState,
  type ManualLiabilityInput,
} from "@keel/domain";
import { z } from "zod";

import { groupRowsBy } from "./group-rows";

const CONNECTOR_TYPE = "plaid-liabilities";
const LIVE_REFRESH_LIMIT = 4;
const STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1_000;
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
  connector_account_id: string | null;
  institution_label: string;
  source: "plaid" | "manual";
  refresh_kind: "initial" | "live" | "manual";
  observed_at: string;
  retrieved_at: string;
};

type ProposalSourceRow = {
  id: string;
  natural_key_sha256: string;
  source: "plaid" | "manual";
  institution_label: string;
  account_label: string;
  kind:
    | "credit_card"
    | "mortgage"
    | "student_loan"
    | "other_revolving"
    | "other_scheduled";
  classification: "revolving" | "scheduled";
  balance_minor: number | null;
  value_state: LiabilityValueState;
  payment_minor: number | null;
  interest_rate_ppm: number | null;
  next_payment_due_date: string | null;
  is_overdue: number | null;
  effective_date: string;
  observed_at: string;
  issues_json: string;
};

type AcceptedRow = {
  decision_id: string;
  natural_key_sha256: string;
  connector_account_id: string | null;
  source: "plaid" | "manual";
  institution_label: string;
  account_label: string;
  kind: ProposalSourceRow["kind"];
  classification: "revolving" | "scheduled";
  balance_minor: number | null;
  value_state: "reported" | "unavailable" | "not_reported";
  payment_minor: number | null;
  payment_treatment:
    "reserve_from_liquidity" | "add_to_household_burn" | "already_in_plan";
  interest_rate_ppm: number | null;
  next_payment_due_date: string | null;
  is_overdue: number | null;
  effective_date: string;
  observed_at: string;
  retrieved_at: string;
  decided_at: string;
};

type PlanningContext = z.infer<typeof LiabilityPlanningContextSchema>;

export type LiabilityConnection = {
  readonly id: string;
  readonly institutionLabel: string;
  readonly secretReference: string;
  readonly providerAccountKey: string;
};

export type LiabilityConnectionUpdate = LiabilityConnection & {
  readonly previousSecretReference: string | null;
};

export type LiabilityRefreshRun = {
  readonly id: string;
  readonly connection: LiabilityConnection;
  readonly refreshKind: "initial" | "live";
};

export type LiabilityProposalStageResult = {
  readonly proposal: LiabilityProposal | null;
};

export class LiabilityRepositoryError extends Error {
  public constructor(
    public readonly code: LiabilitiesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LiabilityRepositoryError";
  }
}

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
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

function monthBounds(at: Date = new Date()): readonly [string, string] {
  return [
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString(),
    new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1),
    ).toISOString(),
  ];
}

function issuesFromJson(raw: string): string[] {
  return z.array(z.string().min(1).max(240)).max(5).parse(JSON.parse(raw));
}

function acceptedFromRow(row: AcceptedRow): AcceptedLiability {
  return {
    id: row.decision_id,
    naturalKeySha256: row.natural_key_sha256,
    connectionId: row.connector_account_id,
    source: row.source,
    institutionLabel: row.institution_label,
    accountLabel: row.account_label,
    kind: row.kind,
    classification: row.classification,
    balanceMinor: row.balance_minor,
    valueState: row.value_state,
    paymentMinor: row.payment_minor,
    paymentTreatment: row.payment_treatment,
    interestRatePpm: row.interest_rate_ppm,
    nextPaymentDueDate: row.next_payment_due_date,
    isOverdue: row.is_overdue === null ? null : row.is_overdue === 1,
    effectiveDate: row.effective_date,
    observedAt: row.observed_at,
    retrievedAt: row.retrieved_at,
    acceptedAt: row.decided_at,
    freshness:
      Date.now() - Date.parse(row.retrieved_at) > STALE_AFTER_MS
        ? "stale"
        : "current",
  };
}

function proposalAction(
  row: ProposalSourceRow,
  prior: AcceptedLiability | undefined,
): LiabilityProposalRow["action"] {
  if (row.value_state === "unsupported") {
    return "needs_attention";
  }
  if (row.value_state === "not_reported") {
    return "not_reported";
  }
  if (prior === undefined) {
    return "new_obligation";
  }
  if (
    prior.valueState === row.value_state &&
    prior.balanceMinor === row.balance_minor &&
    prior.paymentMinor === row.payment_minor &&
    prior.interestRatePpm === row.interest_rate_ppm &&
    prior.nextPaymentDueDate === row.next_payment_due_date &&
    prior.isOverdue === (row.is_overdue === null ? null : row.is_overdue === 1)
  ) {
    return "no_change";
  }
  return "update_obligation";
}

function proposalRowFrom(
  row: ProposalSourceRow,
  prior: AcceptedLiability | undefined,
): LiabilityProposalRow {
  return {
    id: row.id,
    naturalKeySha256: row.natural_key_sha256,
    source: row.source,
    institutionLabel: row.institution_label,
    accountLabel: row.account_label,
    kind: row.kind,
    classification: row.classification,
    balanceMinor: row.balance_minor,
    valueState: row.value_state,
    paymentMinor: row.payment_minor,
    interestRatePpm: row.interest_rate_ppm,
    nextPaymentDueDate: row.next_payment_due_date,
    isOverdue: row.is_overdue === null ? null : row.is_overdue === 1,
    effectiveDate: row.effective_date,
    observedAt: row.observed_at,
    priorBalanceMinor: prior?.balanceMinor ?? null,
    priorValueState: prior?.valueState ?? null,
    action: proposalAction(row, prior),
    issues: issuesFromJson(row.issues_json),
  };
}

function summarize(rows: readonly LiabilityProposalRow[]) {
  return {
    rowCount: rows.length,
    reportedCount: rows.filter((row) => row.valueState === "reported").length,
    needsAttentionCount: rows.filter((row) => row.action === "needs_attention")
      .length,
    notReportedCount: rows.filter((row) => row.valueState === "not_reported")
      .length,
    totalReportedMinor: addMinorUnits(
      ...rows.map((row) => row.balanceMinor ?? 0),
    ),
  };
}

export interface LiabilitiesRepository {
  getState(
    accessSubject: string,
    configured: boolean,
  ): Promise<LiabilitiesState>;
  upsertConnection(
    accessSubject: string,
    institutionLabel: string,
    secretReference: string,
    providerAccountKey: string,
  ): Promise<LiabilityConnectionUpdate>;
  getConnection(
    accessSubject: string,
    connectionId: string,
  ): Promise<LiabilityConnection | null>;
  revokeConnection(accessSubject: string, connectionId: string): Promise<void>;
  beginRefresh(
    accessSubject: string,
    connectionId: string,
    refreshKind: "initial" | "live",
  ): Promise<LiabilityRefreshRun>;
  stageProposal(
    accessSubject: string,
    runId: string,
    input: {
      objectKey: string;
      sourceSha256: string;
      normalized: NormalizedLiabilities;
    },
  ): Promise<LiabilityProposalStageResult>;
  stageManualProposal(
    accessSubject: string,
    input: ManualLiabilityInput,
  ): Promise<LiabilityProposal>;
  completeRefresh(
    accessSubject: string,
    runId: string,
    proposalId: string | null,
    discoveredCount: number,
  ): Promise<void>;
  failRefresh(
    accessSubject: string,
    runId: string,
    errorCode: LiabilitiesErrorCode,
  ): Promise<void>;
  applyProposal(
    accessSubject: string,
    proposalId: string,
    input: LiabilityApplyInput,
  ): Promise<LiabilityApplyResult>;
}

export class D1LiabilitiesRepository implements LiabilitiesRepository {
  public constructor(private readonly db: D1Database) {}

  public async getState(
    accessSubject: string,
    configured: boolean,
  ): Promise<LiabilitiesState> {
    const identity = await findIdentity(this.db, accessSubject);
    const acceptedRequest = this.acceptedLiabilities(identity.household_id);
    const [connections, acceptedLiabilities, pendingProposals, planning] =
      await Promise.all([
        this.connectionStateRows(identity.household_id),
        acceptedRequest,
        this.pendingProposals(identity.household_id, acceptedRequest),
        this.planningContext(identity.household_id),
      ]);
    const errorCode = connections
      .map((connection) => connection.latest_error_code)
      .find((code): code is string => code !== null);
    const parsedErrorCode =
      errorCode === undefined
        ? null
        : LiabilitiesErrorCodeSchema.catch("unexpected_failure").parse(
            errorCode,
          );
    const hasFailedConnection = connections.some(
      (connection) => connection.latest_run_status === "failed",
    );

    return LiabilitiesStateSchema.parse({
      version: 1,
      configured,
      status:
        !configured && connections.length === 0
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
      acceptedLiabilities,
      pendingProposals,
      planning,
      impact: createLiabilityImpact(planning, acceptedLiabilities),
      errorCode: configured ? parsedErrorCode : "configuration_required",
    });
  }

  public async upsertConnection(
    accessSubject: string,
    rawInstitutionLabel: string,
    rawSecretReference: string,
    rawProviderAccountKey: string,
  ): Promise<LiabilityConnectionUpdate> {
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
      throw new LiabilityRepositoryError(
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
      throw new LiabilityRepositoryError(
        "review_required",
        "Review the waiting obligations before reconnecting this institution.",
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
  ): Promise<LiabilityConnection | null> {
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

  public async revokeConnection(
    accessSubject: string,
    rawConnectionId: string,
  ): Promise<void> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const identity = await findIdentity(this.db, accessSubject);
    const result = await this.db
      .prepare(
        `UPDATE connector_accounts SET status = 'revoked'
         WHERE id = ? AND household_id = ? AND connector_type = ?
           AND status = 'active'`,
      )
      .bind(connectionId, identity.household_id, CONNECTOR_TYPE)
      .run();
    if (result.meta.changes !== 1) {
      throw new LiabilityRepositoryError(
        "connection_invalid",
        "This liability connection is no longer active.",
      );
    }
  }

  public async beginRefresh(
    accessSubject: string,
    rawConnectionId: string,
    rawRefreshKind: "initial" | "live",
  ): Promise<LiabilityRefreshRun> {
    const refreshKind = z.enum(["initial", "live"]).parse(rawRefreshKind);
    const connection = await this.getConnection(accessSubject, rawConnectionId);
    if (connection === null) {
      throw new LiabilityRepositoryError(
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
           SELECT 1 FROM liability_proposals proposal
           WHERE proposal.household_id = ?
             AND proposal.connector_account_id = ?
             AND proposal.status = 'pending_review'
         )
         AND NOT EXISTS (
           SELECT 1 FROM connector_sync_runs active
           WHERE active.household_id = ?
             AND active.connector_account_id = ?
             AND active.cursor IN ('liability-initial-v1', 'liability-live-v1')
             AND active.status IN ('queued', 'running')
         )
         AND (
           ? = 'initial'
           OR (
             SELECT COUNT(*) FROM connector_sync_runs used
             WHERE used.household_id = ?
               AND used.connector_account_id = ?
               AND used.cursor = 'liability-live-v1'
               AND used.started_at >= ? AND used.started_at < ?
           ) < ?
         )`,
      )
      .bind(
        id,
        identity.household_id,
        connection.id,
        startedAt,
        refreshKind === "initial"
          ? "liability-initial-v1"
          : "liability-live-v1",
        identity.household_id,
        connection.id,
        identity.household_id,
        connection.id,
        refreshKind,
        identity.household_id,
        connection.id,
        ...monthBounds(new Date(startedAt)),
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
        throw new LiabilityRepositoryError(
          "review_required",
          "Review the waiting obligations before checking again.",
        );
      }
      throw new LiabilityRepositoryError(
        "monthly_limit_reached",
        "This institution has used its checks for this month.",
      );
    }
    return { id, connection, refreshKind };
  }

  public async stageProposal(
    accessSubject: string,
    rawRunId: string,
    input: {
      objectKey: string;
      sourceSha256: string;
      normalized: NormalizedLiabilities;
    },
  ): Promise<LiabilityProposalStageResult> {
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
        cursor: "liability-initial-v1" | "liability-live-v1";
        display_label: string;
      }>();
    if (run === null) {
      throw new LiabilityRepositoryError(
        "staging_failed",
        "The liability check is no longer active.",
      );
    }
    const duplicate = await this.db
      .prepare(
        `SELECT id FROM liability_proposals
         WHERE household_id = ? AND connector_account_id = ?
           AND normalized_fingerprint = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(
        identity.household_id,
        run.connector_account_id,
        normalizedFingerprint,
      )
      .first<{ id: string }>();
    if (duplicate !== null) {
      return { proposal: null };
    }
    const accepted = await this.acceptedLiabilities(
      identity.household_id,
      run.connector_account_id,
    );
    const acceptedByKey = new Map(
      accepted.map((liability) => [liability.naturalKeySha256, liability]),
    );
    const observedKeys = new Set(
      input.normalized.rows.map((row) => row.naturalKeySha256),
    );
    const materialRows: Omit<ProposalSourceRow, "id">[] = [
      ...input.normalized.rows.map((row) => ({
        natural_key_sha256: row.naturalKeySha256,
        source: "plaid" as const,
        institution_label: row.institutionLabel,
        account_label: row.accountLabel,
        kind: row.kind,
        classification: row.classification,
        balance_minor: row.balanceMinor,
        value_state: row.valueState,
        payment_minor: row.paymentMinor,
        interest_rate_ppm: row.interestRatePpm,
        next_payment_due_date: row.nextPaymentDueDate,
        is_overdue: row.isOverdue === null ? null : row.isOverdue ? 1 : 0,
        effective_date: row.effectiveDate,
        observed_at: row.observedAt,
        issues_json: JSON.stringify(row.issues),
      })),
      ...accepted
        .filter((liability) => !observedKeys.has(liability.naturalKeySha256))
        .map((liability) => ({
          natural_key_sha256: liability.naturalKeySha256,
          source: "plaid" as const,
          institution_label: liability.institutionLabel,
          account_label: liability.accountLabel,
          kind: liability.kind,
          classification: liability.classification,
          balance_minor: null,
          value_state: "not_reported" as const,
          payment_minor: null,
          interest_rate_ppm: null,
          next_payment_due_date: null,
          is_overdue: null,
          effective_date: input.normalized.observedAt.slice(0, 10),
          observed_at: input.normalized.observedAt,
          issues_json: JSON.stringify([
            "This previously reviewed obligation was not reported. Its balance and payment are now unknown.",
          ]),
        })),
    ];
    if (materialRows.length === 0) {
      return { proposal: null };
    }
    return this.insertProposal(identity, {
      connectorAccountId: run.connector_account_id,
      runId,
      source: "plaid",
      sourceObjectKey: objectKey,
      sourceSha256,
      normalizedFingerprint,
      refreshKind: run.cursor === "liability-initial-v1" ? "initial" : "live",
      observedAt: input.normalized.observedAt,
      retrievedAt: input.normalized.observedAt,
      institutionLabel: run.display_label,
      materialRows,
      acceptedByKey,
    });
  }

  public async stageManualProposal(
    accessSubject: string,
    rawInput: ManualLiabilityInput,
  ): Promise<LiabilityProposal> {
    const input = ManualLiabilityInputSchema.parse(rawInput);
    const identity = await findIdentity(this.db, accessSubject);
    const retrievedAt = new Date().toISOString();
    const naturalKeySha256 = await sha256(
      JSON.stringify([
        "manual-liability-v1",
        identity.household_id,
        input.kind,
        input.institutionLabel.toLowerCase(),
        input.accountLabel.toLowerCase(),
      ]),
    );
    const pending = await this.db
      .prepare(
        `SELECT row.id
         FROM liability_proposal_rows row
         JOIN liability_proposals proposal ON proposal.id = row.proposal_id
           AND proposal.household_id = row.household_id
         WHERE row.household_id = ? AND row.natural_key_sha256 = ?
           AND proposal.source = 'manual'
           AND proposal.status = 'pending_review'
         LIMIT 1`,
      )
      .bind(identity.household_id, naturalKeySha256)
      .first<{ id: string }>();
    if (pending !== null) {
      throw new LiabilityRepositoryError(
        "review_required",
        "Review the waiting manual obligation before entering it again.",
      );
    }
    const issues = [
      ...(input.balanceMinor === null
        ? ["No outstanding balance was entered; the amount stays unknown."]
        : []),
      ...(input.paymentMinor === null
        ? ["No next payment was entered; planning impact stays unknown."]
        : []),
    ];
    const materialRows: Omit<ProposalSourceRow, "id">[] = [
      {
        natural_key_sha256: naturalKeySha256,
        source: "manual",
        institution_label: input.institutionLabel,
        account_label: input.accountLabel,
        kind: input.kind,
        classification: liabilityClassification(input.kind),
        balance_minor: input.balanceMinor,
        value_state: input.balanceMinor === null ? "unavailable" : "reported",
        payment_minor: input.paymentMinor,
        interest_rate_ppm: input.interestRatePpm,
        next_payment_due_date: input.nextPaymentDueDate,
        is_overdue: input.isOverdue === null ? null : input.isOverdue ? 1 : 0,
        effective_date: input.effectiveDate,
        observed_at: retrievedAt,
        issues_json: JSON.stringify(issues),
      },
    ];
    const acceptedByKey = new Map(
      (await this.acceptedLiabilities(identity.household_id)).map(
        (liability) => [liability.naturalKeySha256, liability],
      ),
    );
    const result = await this.insertProposal(identity, {
      connectorAccountId: null,
      runId: null,
      source: "manual",
      sourceObjectKey: null,
      sourceSha256: null,
      normalizedFingerprint: await sha256(
        JSON.stringify(["manual-liability-v1", materialRows]),
      ),
      refreshKind: "manual",
      observedAt: retrievedAt,
      retrievedAt,
      institutionLabel: input.institutionLabel,
      materialRows,
      acceptedByKey,
    });
    if (result.proposal === null) {
      throw new LiabilityRepositoryError(
        "staging_failed",
        "The manual obligation could not be prepared.",
      );
    }
    return result.proposal;
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
                 FROM liability_proposal_rows row
                 JOIN liability_proposals proposal
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
          `UPDATE connector_accounts SET last_synced_at = ?
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
    rawErrorCode: LiabilitiesErrorCode,
  ): Promise<void> {
    const runId = z.string().min(1).parse(rawRunId);
    const errorCode = LiabilitiesErrorCodeSchema.parse(rawErrorCode);
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
    rawInput: LiabilityApplyInput,
  ): Promise<LiabilityApplyResult> {
    const proposalId = z.string().min(1).parse(rawProposalId);
    const input = LiabilityApplyInputSchema.parse(rawInput);
    const identity = await findIdentity(this.db, accessSubject);
    const rows = await all<ProposalSourceRow>(
      this.db
        .prepare(
          `SELECT row.id, row.natural_key_sha256, row.source,
                  row.institution_label, row.account_label, row.kind,
                  row.classification, row.balance_minor, row.value_state,
                  row.payment_minor, row.interest_rate_ppm,
                  row.next_payment_due_date, row.is_overdue,
                  row.effective_date, row.observed_at, row.issues_json
           FROM liability_proposal_rows row
           JOIN liability_proposals proposal ON proposal.id = row.proposal_id
           WHERE proposal.id = ? AND proposal.household_id = ?
             AND proposal.status = 'pending_review'
           ORDER BY row.account_label, row.id`,
        )
        .bind(proposalId, identity.household_id),
    );
    if (rows.length === 0) {
      throw new Error("Liability proposal is stale.");
    }
    const decisionByRow = new Map(
      input.decisions.map((decision) => [decision.rowId, decision]),
    );
    if (
      decisionByRow.size !== input.decisions.length ||
      decisionByRow.size !== rows.length ||
      rows.some((row) => !decisionByRow.has(row.id))
    ) {
      throw new Error("Every obligation needs one review decision.");
    }
    rows.forEach((row) => {
      const decision = decisionByRow.get(row.id);
      if (decision === undefined) {
        throw new Error("Every obligation needs one review decision.");
      }
      if (decision.decision === "excluded") {
        if (decision.paymentTreatment !== null) {
          throw new Error("Excluded obligations cannot change planning.");
        }
        return;
      }
      if (row.value_state === "unsupported") {
        throw new Error("An unsupported obligation cannot be accepted.");
      }
      if (decision.paymentTreatment === null) {
        throw new Error("Accepted obligations need a payment treatment.");
      }
      if (
        row.payment_minor === null &&
        decision.paymentTreatment !== "already_in_plan"
      ) {
        throw new Error("An unknown payment cannot change planning.");
      }
      if (
        (row.classification === "revolving" &&
          decision.paymentTreatment === "add_to_household_burn") ||
        (row.classification === "scheduled" &&
          decision.paymentTreatment === "reserve_from_liquidity")
      ) {
        throw new Error("Payment treatment does not match the obligation.");
      }
    });
    const decidedAt = new Date().toISOString();
    const statements = rows.map((row) => {
      const decision = decisionByRow.get(row.id);
      if (decision === undefined) {
        throw new Error("Every obligation needs one review decision.");
      }
      return this.db
        .prepare(
          `INSERT INTO liability_review_decisions (
             id, household_id, proposal_id, proposal_row_id, reviewer_user_id,
             decision, payment_treatment, change_note, decided_at, immutable
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          proposalId,
          row.id,
          identity.user_id,
          decision.decision,
          decision.paymentTreatment,
          input.changeNote,
          decidedAt,
        );
    });
    statements.push(
      this.db
        .prepare(
          `UPDATE liability_proposals SET status = 'applied'
           WHERE id = ? AND household_id = ? AND status = 'pending_review'`,
        )
        .bind(proposalId, identity.household_id),
    );
    await this.db.batch(statements);
    const [acceptedLiabilities, planning] = await Promise.all([
      this.acceptedLiabilities(identity.household_id),
      this.planningContext(identity.household_id),
    ]);
    const acceptedCount = input.decisions.filter(
      (decision) => decision.decision === "accepted",
    ).length;
    return LiabilityApplyResultSchema.parse({
      proposalId,
      acceptedCount,
      excludedCount: rows.length - acceptedCount,
      impact: createLiabilityImpact(planning, acceptedLiabilities),
    });
  }

  private async insertProposal(
    identity: HouseholdIdentity,
    input: {
      connectorAccountId: string | null;
      runId: string | null;
      source: "plaid" | "manual";
      sourceObjectKey: string | null;
      sourceSha256: string | null;
      normalizedFingerprint: string;
      refreshKind: "initial" | "live" | "manual";
      observedAt: string;
      retrievedAt: string;
      institutionLabel: string;
      materialRows: readonly Omit<ProposalSourceRow, "id">[];
      acceptedByKey: ReadonlyMap<string, AcceptedLiability>;
    },
  ): Promise<LiabilityProposalStageResult> {
    const proposalId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const rowRecords: ProposalSourceRow[] = input.materialRows.map((row) => ({
      id: crypto.randomUUID(),
      ...row,
    }));
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO liability_proposals (
             id, household_id, connector_account_id, sync_run_id, source,
             source_object_key, source_sha256, normalized_fingerprint,
             refresh_kind, observed_at, retrieved_at, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)`,
        )
        .bind(
          proposalId,
          identity.household_id,
          input.connectorAccountId,
          input.runId,
          input.source,
          input.sourceObjectKey,
          input.sourceSha256,
          input.normalizedFingerprint,
          input.refreshKind,
          input.observedAt,
          input.retrievedAt,
          createdAt,
        ),
    ];
    rowRecords.forEach((row) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO liability_proposal_rows (
               id, household_id, proposal_id, natural_key_sha256, source,
               institution_label, account_label, kind, classification,
               balance_minor, value_state, payment_minor, interest_rate_ppm,
               next_payment_due_date, is_overdue, effective_date, observed_at,
               issues_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            row.id,
            identity.household_id,
            proposalId,
            row.natural_key_sha256,
            row.source,
            row.institution_label,
            row.account_label,
            row.kind,
            row.classification,
            row.balance_minor,
            row.value_state,
            row.payment_minor,
            row.interest_rate_ppm,
            row.next_payment_due_date,
            row.is_overdue,
            row.effective_date,
            row.observed_at,
            row.issues_json,
            createdAt,
          ),
      );
    });
    await this.db.batch(statements);
    const rows = rowRecords.map((row) =>
      proposalRowFrom(row, input.acceptedByKey.get(row.natural_key_sha256)),
    );
    return {
      proposal: {
        id: proposalId,
        connectionId: input.connectorAccountId,
        institutionLabel: input.institutionLabel,
        source: input.source,
        status: "pending_review",
        refreshKind: input.refreshKind,
        observedAt: input.observedAt,
        retrievedAt: input.retrievedAt,
        summary: summarize(rows),
        rows,
      },
    };
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
                 AND run.cursor IN ('liability-initial-v1', 'liability-live-v1')
               ORDER BY run.started_at DESC, run.id DESC LIMIT 1
             ) AS latest_run_status,
             (
               SELECT run.error_code FROM connector_sync_runs run
               WHERE run.connector_account_id = account.id
                 AND run.cursor IN ('liability-initial-v1', 'liability-live-v1')
               ORDER BY run.started_at DESC, run.id DESC LIMIT 1
             ) AS latest_error_code,
             (
               SELECT COUNT(*) FROM connector_sync_runs run
               WHERE run.connector_account_id = account.id
                 AND run.cursor = 'liability-live-v1'
                 AND run.started_at >= ? AND run.started_at < ?
             ) AS live_refreshes_used
           FROM connector_accounts account
           WHERE account.household_id = ? AND account.connector_type = ?
             AND account.status = 'active'
           ORDER BY account.display_label, account.id`,
        )
        .bind(...monthBounds(), householdId, CONNECTOR_TYPE),
    );
  }

  private async hasPendingProposalOrActiveRefresh(
    householdId: string,
    connectionId: string,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT (
           EXISTS (
             SELECT 1 FROM liability_proposals proposal
             WHERE proposal.household_id = ?
               AND proposal.connector_account_id = ?
               AND proposal.status = 'pending_review'
           )
           OR EXISTS (
             SELECT 1 FROM connector_sync_runs run
             WHERE run.household_id = ?
               AND run.connector_account_id = ?
               AND run.cursor IN ('liability-initial-v1', 'liability-live-v1')
               AND run.status IN ('queued', 'running')
           )
         ) AS blocked`,
      )
      .bind(householdId, connectionId, householdId, connectionId)
      .first<{ blocked: number }>();
    return row?.blocked === 1;
  }

  private async acceptedLiabilities(
    householdId: string,
    connectionId?: string,
  ): Promise<AcceptedLiability[]> {
    const rows = await all<AcceptedRow>(
      this.db
        .prepare(
          `WITH accepted AS (
             SELECT
               decision.id AS decision_id,
               row.natural_key_sha256,
               proposal.connector_account_id,
               row.source,
               row.institution_label,
               row.account_label,
               row.kind,
               row.classification,
               row.balance_minor,
               row.value_state,
               row.payment_minor,
               decision.payment_treatment,
               row.interest_rate_ppm,
               row.next_payment_due_date,
               row.is_overdue,
               row.effective_date,
               row.observed_at,
               proposal.retrieved_at,
               decision.decided_at,
               ROW_NUMBER() OVER (
                 PARTITION BY row.natural_key_sha256
                 ORDER BY decision.decided_at DESC, decision.id DESC
               ) AS recency
             FROM liability_review_decisions decision
             JOIN liability_proposal_rows row
               ON row.id = decision.proposal_row_id
             JOIN liability_proposals proposal
               ON proposal.id = decision.proposal_id
             WHERE decision.household_id = ? AND decision.decision = 'accepted'
               AND (? IS NULL OR proposal.connector_account_id = ?)
           )
           SELECT decision_id, natural_key_sha256, connector_account_id,
                  source, institution_label, account_label, kind,
                  classification, balance_minor, value_state, payment_minor,
                  payment_treatment, interest_rate_ppm,
                  next_payment_due_date, is_overdue, effective_date,
                  observed_at, retrieved_at, decided_at
           FROM accepted WHERE recency = 1
           ORDER BY institution_label, account_label, natural_key_sha256`,
        )
        .bind(householdId, connectionId ?? null, connectionId ?? null),
    );
    return rows.map(acceptedFromRow);
  }

  private async pendingProposals(
    householdId: string,
    acceptedRequest: Promise<AcceptedLiability[]>,
  ): Promise<LiabilityProposal[]> {
    const proposals = await all<ProposalRow>(
      this.db
        .prepare(
          `SELECT proposal.id, proposal.connector_account_id,
                  COALESCE(account.display_label,
                    (SELECT row.institution_label
                     FROM liability_proposal_rows row
                     WHERE row.proposal_id = proposal.id LIMIT 1))
                    AS institution_label,
                  proposal.source, proposal.refresh_kind,
                  proposal.observed_at, proposal.retrieved_at
           FROM liability_proposals proposal
           LEFT JOIN connector_accounts account
             ON account.id = proposal.connector_account_id
           WHERE proposal.household_id = ?
             AND proposal.status = 'pending_review'
           ORDER BY proposal.created_at, proposal.id`,
        )
        .bind(householdId),
    );
    const accepted = await acceptedRequest;
    const acceptedByKey = new Map(
      accepted.map((liability) => [liability.naturalKeySha256, liability]),
    );
    const sourceRows = await all<ProposalSourceRow & { proposal_id: string }>(
      this.db
        .prepare(
          `SELECT proposal_id, id, natural_key_sha256, source, institution_label,
                      account_label, kind, classification, balance_minor,
                      value_state, payment_minor, interest_rate_ppm,
                      next_payment_due_date, is_overdue, effective_date,
                      observed_at, issues_json
               FROM liability_proposal_rows
               WHERE household_id = ? AND proposal_id IN (
                 SELECT id FROM liability_proposals
                 WHERE household_id = ? AND status = 'pending_review'
               )
               ORDER BY account_label, id`,
        )
        .bind(householdId, householdId),
    );
    const rowsByProposal = groupRowsBy(sourceRows, (row) => row.proposal_id);
    return proposals.map((proposal) => {
      const sourceRows = rowsByProposal.get(proposal.id) ?? [];
      const rows = sourceRows.map((row) =>
        proposalRowFrom(row, acceptedByKey.get(row.natural_key_sha256)),
      );
      return {
        id: proposal.id,
        connectionId: proposal.connector_account_id,
        institutionLabel: proposal.institution_label,
        source: proposal.source,
        status: "pending_review" as const,
        refreshKind: proposal.refresh_kind,
        observedAt: proposal.observed_at,
        retrievedAt: proposal.retrieved_at,
        summary: summarize(rows),
        rows,
      };
    });
  }

  private async planningContext(householdId: string): Promise<PlanningContext> {
    const row = await this.db
      .prepare(
        `SELECT plan.fi_eligible_liquid_minor,
                plan.protected_cash_floor_minor,
                plan.household_burn_monthly_minor,
                plan.business_burn_monthly_minor,
                plan.fi_target_minor
         FROM scenarios scenario
         JOIN cash_flow_plans plan
           ON plan.id = (
             SELECT latest.id
             FROM cash_flow_plans latest
             WHERE latest.scenario_id = scenario.id
             ORDER BY latest.effective_date DESC, latest.created_at DESC,
                      latest.id DESC
             LIMIT 1
           )
         WHERE scenario.household_id = ?
           AND scenario.name = 'FI Underwriting'`,
      )
      .bind(householdId)
      .first<{
        fi_eligible_liquid_minor: number;
        protected_cash_floor_minor: number;
        household_burn_monthly_minor: number;
        business_burn_monthly_minor: number;
        fi_target_minor: number;
      }>();
    if (row === null) {
      throw new Error("Liabilities require a complete FI plan.");
    }
    return {
      currentFiEligibleLiquidMinor: row.fi_eligible_liquid_minor,
      protectedCashFloorMinor: row.protected_cash_floor_minor,
      householdBurnMonthlyMinor: row.household_burn_monthly_minor,
      businessBurnMonthlyMinor: row.business_burn_monthly_minor,
      fiTargetMinor: row.fi_target_minor,
    };
  }
}
