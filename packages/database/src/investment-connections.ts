import {
  InvestmentConnectionStatusSchema,
  InvestmentConnectionsStateSchema,
  InvestmentSyncErrorCodeSchema,
  type InvestmentConnectionStatus,
  type InvestmentConnectionsState,
  type InvestmentSyncErrorCode,
} from "@keel/domain";
import { z } from "zod";

const CONNECTOR_TYPE = "plaid-investments";
const INVESTMENT_SYNC_STALE_AFTER_MS = 5 * 60 * 1_000;

const DUE_AUTOMATIC_INVESTMENT_CONNECTIONS_SQL = `
  SELECT connection.id AS connection_id,
         MIN(COALESCE(latest.started_at, account.created_at)) AS due_order
  FROM connector_accounts account
  JOIN connector_investment_connection_versions link
    ON link.connector_account_id = account.id
   AND link.household_id = account.household_id
   AND NOT EXISTS (
     SELECT 1
     FROM connector_investment_connection_versions later_link
     WHERE later_link.supersedes_link_id = link.id
   )
  JOIN investment_connections connection
    ON connection.id = link.connection_id
   AND connection.household_id = account.household_id
   AND connection.adapter_type = 'plaid-investments'
  JOIN investment_connection_versions state
    ON state.connection_id = connection.id
   AND state.household_id = connection.household_id
   AND NOT EXISTS (
     SELECT 1
     FROM investment_connection_versions later_state
     WHERE later_state.supersedes_version_id = state.id
   )
  LEFT JOIN connector_sync_runs latest ON latest.id = (
    SELECT run.id FROM connector_sync_investment_connections scope
    JOIN connector_sync_runs run ON run.id = scope.sync_run_id
    WHERE scope.connection_id = connection.id
      AND scope.household_id = connection.household_id
    ORDER BY run.started_at DESC, run.id DESC LIMIT 1
  )
  WHERE account.connector_type = 'plaid-investments'
    AND account.status = 'active'
    AND account.provider_account_key IS NOT NULL
    AND state.lifecycle_state = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM holding_import_connections import_scope
      JOIN holding_imports import ON import.id = import_scope.import_id
      JOIN source_documents document ON document.id = import.source_document_id
      WHERE import_scope.household_id = connection.household_id
        AND import_scope.connection_id = connection.id
        AND document.review_status = 'pending_review'
    )
    AND (
      latest.id IS NULL
      OR (
        latest.started_at < ?
        AND latest.quarantined_count = 0
        AND (
          latest.status IN ('queued', 'running', 'succeeded')
          OR (
            latest.status = 'failed'
            AND latest.error_code = 'unexpected_failure'
          )
        )
      )
    )
  GROUP BY connection.id
  ORDER BY due_order, connection.id
  LIMIT ?`;

function connectorAccountDisplayLabel(
  institutionLabel: string,
  providerAccountKey: string,
): string {
  // connector_accounts predates canonical investment connections and has a
  // label-based unique key. Include the protected Item key so two Items at the
  // same institution remain distinct without treating display text as identity.
  return `${institutionLabel} [${providerAccountKey}]`;
}

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type ConnectionRow = {
  id: string;
  display_label: string;
  created_at: string;
  secret_reference: string;
  status: "active" | "paused" | "revoked";
  last_synced_at: string | null;
  provider_account_key: string | null;
  investment_connection_id: string | null;
  investment_source_key: string | null;
  investment_version_id: string | null;
  investment_version: number | null;
  investment_lifecycle_state:
    "pending" | "active" | "paused" | "disconnected" | null;
  investment_credential_reference: string | null;
  institution_key: string | null;
  institution_label: string | null;
  connector_link_id: string | null;
  connector_link_version: number | null;
};

type LatestRunRow = {
  status: "queued" | "running" | "succeeded" | "failed";
  started_at: string;
  error_code: string | null;
  adjudication_policy_version: string | null;
  auto_applied_count: number;
  quarantined_count: number;
  preserved_position_count: number;
  baseline_refresh_status: "not_needed" | "refreshed" | "manual_required";
  holding_import_id: string | null;
};

type ConnectionStatusRow = LatestRunRow & {
  connection_id: string;
  run_id: string | null;
  pending_import_id: string | null;
  latest_linked_import_id: string | null;
};

type InvestmentConnectionRow = {
  id: string;
  protected_source_key: string;
  version_id: string;
  version: number;
  lifecycle_state: "pending" | "active" | "paused" | "disconnected";
  credential_reference: string | null;
  institution_key: string;
  institution_label: string;
};

export type InvestmentConnection = {
  readonly id: string;
  readonly connectorAccountId: string;
  readonly secretReference: string;
  readonly providerAccountKey: string | null;
  readonly institutionKey: string;
  readonly institutionLabel: string;
};

export type InvestmentConnectionUpdate = InvestmentConnection & {
  readonly previousSecretReference: string | null;
};

export type InvestmentSyncRun = {
  readonly id: string;
  readonly connection: InvestmentConnection;
  readonly created: boolean;
};

export type PlaidWebhookDeliveryClaim =
  | { readonly status: "unknown" }
  | { readonly status: "duplicate"; readonly deliveryId: string }
  | { readonly status: "claimed"; readonly deliveryId: string };

export type PlaidWebhookDelivery = {
  readonly id: string;
  readonly accessSubject: string;
  readonly connectionId: string;
  readonly status:
    "received" | "queued" | "processing" | "processed" | "failed";
};

export interface ScheduledInvestmentConnectionsRepository {
  listDueAutomaticSyncConnectionIds(
    syncedAfter: string,
    limit: number,
  ): Promise<readonly string[]>;
  findAutomaticSyncAccessSubject(connectionId: string): Promise<string | null>;
}

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export interface InvestmentConnectionsRepository {
  getState(
    accessSubject: string,
    configured: boolean,
  ): Promise<InvestmentConnectionsState>;
  getConnectionStatus(
    accessSubject: string,
    connectionId: string,
  ): Promise<InvestmentConnectionStatus>;
  getConnection(
    accessSubject: string,
    connectionId: string,
    includePaused?: boolean,
  ): Promise<InvestmentConnection | null>;
  upsertConnection(
    accessSubject: string,
    secretReference: string,
    providerAccountKey: string,
    institutionKey: string,
    institutionLabel: string,
  ): Promise<InvestmentConnectionUpdate>;
  disconnectConnection(
    accessSubject: string,
    connectionId: string,
  ): Promise<void>;
  setConnectionPaused(
    accessSubject: string,
    connectionId: string,
    paused: boolean,
  ): Promise<void>;
  claimPlaidWebhookDelivery(input: {
    providerAccountKey: string;
    signatureSha256: string;
    bodySha256: string;
    issuedAt: string;
    receivedAt: string;
  }): Promise<PlaidWebhookDeliveryClaim>;
  getPlaidWebhookDelivery(
    deliveryId: string,
  ): Promise<PlaidWebhookDelivery | null>;
  markPlaidWebhookDelivery(
    deliveryId: string,
    status: "queued" | "processing" | "processed" | "failed",
  ): Promise<boolean>;
  beginSync(
    accessSubject: string,
    connectionId: string,
  ): Promise<InvestmentSyncRun>;
  beginAutomaticSync(
    accessSubject: string,
    connectionId: string,
    syncedAfter: string,
  ): Promise<InvestmentSyncRun | null>;
  completeSync(
    accessSubject: string,
    runId: string,
    input: {
      discoveredCount: number;
      proposedCount: number;
      importId: string | null;
      adjudication?: {
        policyVersion: string;
        autoAppliedCount: number;
        quarantinedCount: number;
        preservedPositionCount: number;
        baselineRefreshStatus: "not_needed" | "refreshed" | "manual_required";
        portfolioBaselineId: string | null;
      } | null;
    },
  ): Promise<void>;
  failSync(
    accessSubject: string,
    runId: string,
    errorCode: InvestmentSyncErrorCode,
  ): Promise<void>;
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
       WHERE user.access_subject = ?`,
    )
    .bind(accessSubject)
    .first<HouseholdIdentity>();
  if (identity === null) {
    throw new Error("Household not found for the authenticated user.");
  }
  return identity;
}

export class D1InvestmentConnectionsRepository
  implements
    InvestmentConnectionsRepository,
    ScheduledInvestmentConnectionsRepository
{
  public constructor(private readonly db: D1Database) {}

  public async getState(
    accessSubject: string,
    configured: boolean,
  ): Promise<InvestmentConnectionsState> {
    const identity = await findIdentity(this.db, accessSubject);
    const connections = await this.findConnections(identity.household_id);
    const statusRows = await this.connectionStatusRows(
      identity.household_id,
      connections,
    );
    const statuses = connections.map((connection) =>
      this.connectionStatus(
        connection,
        statusRows.get(connection.investment_connection_id ?? ""),
      ),
    );
    return InvestmentConnectionsStateSchema.parse({
      version: 1,
      configured,
      connections: statuses,
      errorCode: configured ? null : "configuration_required",
    });
  }

  public async listDueAutomaticSyncConnectionIds(
    rawSyncedAfter: string,
    rawLimit: number,
  ): Promise<readonly string[]> {
    const syncedAfter = z.iso.datetime({ offset: true }).parse(rawSyncedAfter);
    const limit = z.number().int().min(1).max(100).parse(rawLimit);
    const rows = await this.db
      .prepare(DUE_AUTOMATIC_INVESTMENT_CONNECTIONS_SQL)
      .bind(syncedAfter, limit)
      .all<{ connection_id: string }>();
    return rows.results.map((row) => z.uuid().parse(row.connection_id));
  }

  public async findAutomaticSyncAccessSubject(
    rawConnectionId: string,
  ): Promise<string | null> {
    const connectionId = z.uuid().parse(rawConnectionId);
    const row = await this.db
      .prepare(
        `SELECT user.access_subject
         FROM investment_connections connection
         JOIN households household ON household.id = connection.household_id
         JOIN users user ON user.id = household.owner_user_id
         JOIN investment_connection_versions state
           ON state.connection_id = connection.id
          AND state.household_id = connection.household_id
          AND NOT EXISTS (
            SELECT 1
            FROM investment_connection_versions later_state
            WHERE later_state.supersedes_version_id = state.id
          )
         JOIN connector_investment_connection_versions link
           ON link.connection_id = connection.id
          AND link.household_id = connection.household_id
          AND NOT EXISTS (
            SELECT 1
            FROM connector_investment_connection_versions later_link
            WHERE later_link.supersedes_link_id = link.id
          )
         JOIN connector_accounts account
           ON account.id = link.connector_account_id
          AND account.household_id = connection.household_id
         WHERE connection.id = ?
           AND connection.adapter_type = 'plaid-investments'
           AND state.lifecycle_state = 'active'
           AND account.connector_type = 'plaid-investments'
           AND account.status = 'active'
           AND account.provider_account_key IS NOT NULL
         LIMIT 1`,
      )
      .bind(connectionId)
      .first<{ access_subject: string }>();
    return row?.access_subject ?? null;
  }

  public async getConnectionStatus(
    accessSubject: string,
    rawConnectionId: string,
  ): Promise<InvestmentConnectionStatus> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(
      identity.household_id,
      connectionId,
    );
    if (connection === null) {
      throw new Error("Investment connection was not found.");
    }
    const rows = await this.connectionStatusRows(identity.household_id, [
      connection,
    ]);
    return this.connectionStatus(
      connection,
      rows.get(connection.investment_connection_id ?? ""),
    );
  }

  private async connectionStatusRows(
    householdId: string,
    connections: readonly ConnectionRow[],
  ): Promise<Map<string, ConnectionStatusRow>> {
    const ids = connections.flatMap((connection) =>
      connection.status === "active" &&
      connection.investment_lifecycle_state === "active" &&
      connection.investment_connection_id !== null
        ? [connection.investment_connection_id]
        : [],
    );
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .prepare(
        `
      SELECT connection.id AS connection_id, run.id AS run_id,
        run.status, run.started_at, run.error_code,
        run.adjudication_policy_version, run.auto_applied_count,
        run.quarantined_count, run.preserved_position_count,
        run.baseline_refresh_status, link.holding_import_id,
        (
          SELECT import_scope.import_id
          FROM holding_import_connections import_scope
          JOIN holding_imports import ON import.id = import_scope.import_id
          JOIN source_documents document ON document.id = import.source_document_id
          JOIN connector_sync_imports imported ON imported.holding_import_id = import.id
          WHERE import_scope.household_id = connection.household_id
            AND import_scope.connection_id = connection.id
            AND imported.household_id = connection.household_id
            AND document.review_status = 'pending_review'
          ORDER BY imported.created_at DESC, imported.id DESC LIMIT 1
        ) AS pending_import_id,
        (
          SELECT imported.holding_import_id
          FROM holding_import_connections import_scope
          JOIN connector_sync_imports imported ON imported.holding_import_id = import_scope.import_id
          WHERE import_scope.household_id = connection.household_id
            AND import_scope.connection_id = connection.id
            AND imported.household_id = connection.household_id
          ORDER BY imported.created_at DESC, imported.id DESC LIMIT 1
        ) AS latest_linked_import_id
      FROM investment_connections connection
      LEFT JOIN connector_sync_runs run ON run.id = (
        SELECT candidate.id FROM connector_sync_investment_connections scope
        JOIN connector_sync_runs candidate ON candidate.id = scope.sync_run_id
        JOIN connector_investment_connection_versions current_link
          ON current_link.connector_account_id = candidate.connector_account_id
          AND current_link.connection_id = connection.id
          AND current_link.household_id = connection.household_id
          AND NOT EXISTS (SELECT 1 FROM connector_investment_connection_versions later
            WHERE later.supersedes_link_id = current_link.id)
        WHERE scope.household_id = connection.household_id
          AND scope.connection_id = connection.id
          AND candidate.household_id = connection.household_id
        ORDER BY candidate.started_at DESC, candidate.id DESC LIMIT 1
      )
      LEFT JOIN connector_sync_imports link ON link.sync_run_id = run.id
      WHERE connection.household_id = ? AND connection.id IN (SELECT value FROM json_each(?))
    `,
      )
      .bind(householdId, JSON.stringify(ids))
      .all<ConnectionStatusRow>();
    return new Map(rows.results.map((row) => [row.connection_id, row]));
  }

  private connectionStatus(
    connection: ConnectionRow,
    row: ConnectionStatusRow | undefined,
  ): InvestmentConnectionStatus {
    if (
      connection.status === "revoked" ||
      connection.investment_connection_id === null ||
      connection.investment_lifecycle_state === "disconnected" ||
      connection.institution_key === null ||
      connection.institution_label === null
    ) {
      return InvestmentConnectionStatusSchema.parse({
        version: 1,
        connectionId: connection.investment_connection_id ?? connection.id,
        institutionKey: connection.institution_key ?? "unresolved",
        institutionLabel:
          connection.institution_label ?? connection.display_label,
        status: "disconnected",
        lastSyncedAt: connection.last_synced_at,
        automaticUpdatesEnabled: false,
        latestImportId: null,
        latestRunStatus: null,
        errorCode: null,
        latestAdjudication: null,
      });
    }

    if (
      connection.status === "paused" &&
      connection.investment_lifecycle_state === "paused"
    ) {
      return InvestmentConnectionStatusSchema.parse({
        version: 1,
        connectionId: connection.investment_connection_id,
        institutionKey: connection.institution_key,
        institutionLabel: connection.institution_label,
        status: "paused",
        lastSyncedAt: connection.last_synced_at,
        automaticUpdatesEnabled: false,
        latestImportId: null,
        latestRunStatus: null,
        errorCode: null,
        latestAdjudication: null,
      });
    }

    if (
      connection.status !== "active" ||
      connection.investment_lifecycle_state !== "active"
    ) {
      throw new Error("Investment connection lifecycle is inconsistent.");
    }

    const latestRun = row?.run_id == null ? null : row;
    const latestPendingImport =
      row?.pending_import_id == null ? null : { id: row.pending_import_id };
    const latestLinkedImport =
      row?.latest_linked_import_id == null
        ? null
        : { id: row.latest_linked_import_id };
    const staleRunning =
      latestRun !== null &&
      (latestRun.status === "queued" || latestRun.status === "running") &&
      Date.parse(latestRun.started_at) <=
        Date.now() - INVESTMENT_SYNC_STALE_AFTER_MS;
    const runStatus = staleRunning
      ? "failed"
      : latestRun?.status === "queued"
        ? "running"
        : (latestRun?.status ?? null);
    const errorCode = staleRunning
      ? "unexpected_failure"
      : latestRun?.error_code === null || latestRun?.error_code === undefined
        ? null
        : InvestmentSyncErrorCodeSchema.parse(latestRun.error_code);
    const adjudicationImportId =
      latestRun?.holding_import_id ?? latestLinkedImport?.id ?? null;
    const latestAdjudication =
      latestRun?.adjudication_policy_version === null ||
      latestRun?.adjudication_policy_version === undefined ||
      adjudicationImportId === null
        ? null
        : {
            importId: adjudicationImportId,
            policyVersion: latestRun.adjudication_policy_version,
            autoAppliedCount: latestRun.auto_applied_count,
            quarantinedCount: latestRun.quarantined_count,
            preservedPositionCount: latestRun.preserved_position_count,
            baselineRefreshStatus: latestRun.baseline_refresh_status,
          };

    return InvestmentConnectionStatusSchema.parse({
      version: 1,
      connectionId: connection.investment_connection_id,
      institutionKey: connection.institution_key,
      institutionLabel: connection.institution_label,
      status:
        runStatus === "running"
          ? "syncing"
          : runStatus === "failed"
            ? "needs_attention"
            : "ready",
      lastSyncedAt: connection.last_synced_at,
      automaticUpdatesEnabled: connection.provider_account_key !== null,
      latestImportId:
        latestAdjudication !== null && latestAdjudication.quarantinedCount > 0
          ? latestAdjudication.importId
          : (latestPendingImport?.id ?? null),
      latestRunStatus: runStatus,
      errorCode,
      latestAdjudication,
    });
  }

  public async getConnection(
    accessSubject: string,
    rawConnectionId: string,
    includePaused = false,
  ): Promise<InvestmentConnection | null> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(
      identity.household_id,
      connectionId,
    );
    if (
      connection === null ||
      !(
        connection.status === "active" ||
        (includePaused && connection.status === "paused")
      ) ||
      connection.investment_connection_id === null ||
      !(
        connection.investment_lifecycle_state === "active" ||
        (includePaused && connection.investment_lifecycle_state === "paused")
      ) ||
      connection.institution_key === null ||
      connection.institution_label === null
    ) {
      return null;
    }
    return {
      id: connection.investment_connection_id,
      connectorAccountId: connection.id,
      secretReference: connection.secret_reference,
      providerAccountKey: connection.provider_account_key,
      institutionKey: connection.institution_key,
      institutionLabel: connection.institution_label,
    };
  }

  public async setConnectionPaused(
    accessSubject: string,
    rawConnectionId: string,
    rawPaused: boolean,
  ): Promise<void> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const paused = z.boolean().parse(rawPaused);
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(
      identity.household_id,
      connectionId,
    );
    if (connection === null) {
      throw new Error("Investment connection was not found.");
    }
    if (
      connection.investment_connection_id === null ||
      connection.investment_version_id === null ||
      connection.investment_version === null ||
      connection.investment_credential_reference === null ||
      connection.institution_key === null ||
      connection.institution_label === null
    ) {
      throw new Error("Canonical investment connection was not found.");
    }
    if (
      connection.status === "revoked" ||
      connection.investment_lifecycle_state === "disconnected"
    ) {
      throw new Error("Disconnected investment connections cannot be changed.");
    }

    const lifecycleState = paused ? "paused" : "active";
    const connectorStatus = paused ? "paused" : "active";
    if (
      connection.investment_lifecycle_state === lifecycleState &&
      connection.status === connectorStatus
    ) {
      return;
    }
    if (
      (connection.status !== "active" && connection.status !== "paused") ||
      (connection.investment_lifecycle_state !== "active" &&
        connection.investment_lifecycle_state !== "paused")
    ) {
      throw new Error("Investment connection lifecycle is inconsistent.");
    }
    if (paused) {
      const activeRun = await this.db
        .prepare(
          `SELECT run.id
           FROM connector_sync_runs run
           JOIN connector_sync_investment_connections scope
             ON scope.sync_run_id = run.id
           WHERE run.connector_account_id = ?
             AND run.household_id = ?
             AND scope.connection_id = ?
             AND run.status IN ('queued', 'running')
           LIMIT 1`,
        )
        .bind(
          connection.id,
          identity.household_id,
          connection.investment_connection_id,
        )
        .first<{ id: string }>();
      if (activeRun !== null) {
        throw new Error("Investment connection check is in progress.");
      }
    }

    const recordedAt = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE connector_accounts
           SET status = ?
           WHERE id = ? AND household_id = ?`,
        )
        .bind(connectorStatus, connection.id, identity.household_id),
      this.db
        .prepare(
          `INSERT INTO investment_connection_versions (
             id, household_id, connection_id, version, institution_key,
             institution_label, lifecycle_state, credential_reference,
             supersedes_version_id, recorded_by_user_id, recorded_at,
             immutable
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          connection.investment_connection_id,
          connection.investment_version + 1,
          connection.institution_key,
          connection.institution_label,
          lifecycleState,
          connection.investment_credential_reference,
          connection.investment_version_id,
          identity.user_id,
          recordedAt,
        ),
    ]);
  }

  public async upsertConnection(
    accessSubject: string,
    rawSecretReference: string,
    rawProviderAccountKey: string,
    rawInstitutionKey: string,
    rawInstitutionLabel: string,
  ): Promise<InvestmentConnectionUpdate> {
    const secretReference = z
      .string()
      .min(1)
      .max(1_024)
      .parse(rawSecretReference);
    const providerAccountKey = Sha256Schema.parse(rawProviderAccountKey);
    const institutionKey = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(rawInstitutionKey);
    const institutionLabel = z
      .string()
      .trim()
      .min(1)
      .max(512)
      .parse(rawInstitutionLabel);
    const identity = await findIdentity(this.db, accessSubject);
    const existing = await this.findConnectionBySourceKey(
      identity.household_id,
      providerAccountKey,
    );
    if (
      existing?.institution_key !== null &&
      existing?.institution_key !== undefined &&
      existing.institution_key !== institutionKey
    ) {
      throw new Error("Investment connection institution identity changed.");
    }
    const now = new Date().toISOString();
    const connectorAccountId = existing?.id ?? crypto.randomUUID();
    const displayLabel = connectorAccountDisplayLabel(
      institutionLabel,
      providerAccountKey,
    );
    const statements: D1PreparedStatement[] = [];
    if (existing === null) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO connector_accounts (
               id, household_id, connector_type, display_label,
               secret_reference, status, last_synced_at,
               provider_account_key, created_at
             ) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
          )
          .bind(
            connectorAccountId,
            identity.household_id,
            CONNECTOR_TYPE,
            displayLabel,
            secretReference,
            providerAccountKey,
            now,
          ),
      );
    } else {
      statements.push(
        this.db
          .prepare(
            `UPDATE connector_accounts
             SET secret_reference = ?,
                 display_label = ?, provider_account_key = ?, status = 'active'
             WHERE id = ? AND household_id = ?`,
          )
          .bind(
            secretReference,
            displayLabel,
            providerAccountKey,
            connectorAccountId,
            identity.household_id,
          ),
      );
    }

    let investmentConnection =
      existing?.investment_source_key === providerAccountKey &&
      existing.investment_connection_id !== null &&
      existing.investment_version_id !== null &&
      existing.investment_version !== null &&
      existing.investment_lifecycle_state !== null
        ? {
            id: existing.investment_connection_id,
            protected_source_key: existing.investment_source_key,
            version_id: existing.investment_version_id,
            version: existing.investment_version,
            lifecycle_state: existing.investment_lifecycle_state,
            credential_reference: existing.investment_credential_reference,
            institution_key: existing.institution_key ?? institutionKey,
            institution_label: existing.institution_label ?? institutionLabel,
          }
        : await this.findInvestmentConnectionBySourceKey(
            identity.household_id,
            providerAccountKey,
          );
    const linkedInvestmentConnectionId =
      existing?.investment_connection_id ?? null;

    if (
      investmentConnection !== null &&
      investmentConnection.institution_key !== institutionKey
    ) {
      throw new Error("Investment connection institution identity changed.");
    }

    if (investmentConnection === null) {
      const investmentConnectionId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      statements.push(
        this.db
          .prepare(
            `INSERT INTO investment_connections (
               id, household_id, adapter_type, protected_source_key,
               created_by_user_id, created_at, immutable
             ) VALUES (?, ?, 'plaid-investments', ?, ?, ?, 1)`,
          )
          .bind(
            investmentConnectionId,
            identity.household_id,
            providerAccountKey,
            identity.user_id,
            now,
          ),
        this.db
          .prepare(
            `INSERT INTO investment_connection_versions (
               id, household_id, connection_id, version, institution_key,
               institution_label, lifecycle_state, credential_reference,
               supersedes_version_id, recorded_by_user_id, recorded_at,
               immutable
             ) VALUES (?, ?, ?, 1, ?, ?, 'active', ?, NULL, ?, ?, 1)`,
          )
          .bind(
            versionId,
            identity.household_id,
            investmentConnectionId,
            institutionKey,
            institutionLabel,
            secretReference,
            identity.user_id,
            now,
          ),
      );
      investmentConnection = {
        id: investmentConnectionId,
        protected_source_key: providerAccountKey,
        version_id: versionId,
        version: 1,
        lifecycle_state: "active",
        credential_reference: secretReference,
        institution_key: institutionKey,
        institution_label: institutionLabel,
      };
    } else if (
      investmentConnection.lifecycle_state !== "active" ||
      investmentConnection.credential_reference !== secretReference ||
      investmentConnection.institution_label !== institutionLabel
    ) {
      const versionId = crypto.randomUUID();
      statements.push(
        this.db
          .prepare(
            `INSERT INTO investment_connection_versions (
               id, household_id, connection_id, version, institution_key,
               institution_label, lifecycle_state, credential_reference,
               supersedes_version_id, recorded_by_user_id, recorded_at,
               immutable
             ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1)`,
          )
          .bind(
            versionId,
            identity.household_id,
            investmentConnection.id,
            investmentConnection.version + 1,
            institutionKey,
            institutionLabel,
            secretReference,
            investmentConnection.version_id,
            identity.user_id,
            now,
          ),
      );
      investmentConnection = {
        ...investmentConnection,
        version_id: versionId,
        version: investmentConnection.version + 1,
        lifecycle_state: "active",
        credential_reference: secretReference,
        institution_key: institutionKey,
        institution_label: institutionLabel,
      };
    }

    if (
      linkedInvestmentConnectionId !== investmentConnection.id ||
      existing?.connector_link_id === null ||
      existing?.connector_link_id === undefined
    ) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO connector_investment_connection_versions (
               id, household_id, connector_account_id, connection_id, version,
               supersedes_link_id, recorded_at, immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            connectorAccountId,
            investmentConnection.id,
            (existing?.connector_link_version ?? 0) + 1,
            existing?.connector_link_id ?? null,
            now,
          ),
      );
    }

    await this.db.batch(statements);
    return {
      id: investmentConnection.id,
      connectorAccountId,
      secretReference,
      providerAccountKey,
      institutionKey,
      institutionLabel,
      previousSecretReference: existing?.secret_reference ?? null,
    };
  }

  public async disconnectConnection(
    accessSubject: string,
    rawConnectionId: string,
  ): Promise<void> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(
      identity.household_id,
      connectionId,
    );
    if (connection === null) {
      throw new Error("Investment connection was not found.");
    }
    if (
      connection.status === "revoked" &&
      connection.investment_lifecycle_state === "disconnected"
    ) {
      return;
    }
    if (
      connection.investment_connection_id === null ||
      connection.investment_version_id === null ||
      connection.investment_version === null ||
      connection.institution_key === null ||
      connection.institution_label === null
    ) {
      throw new Error("Canonical investment connection was not found.");
    }
    const recordedAt = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE connector_accounts
           SET status = 'revoked'
           WHERE id = ? AND household_id = ? AND status <> 'revoked'`,
        )
        .bind(connection.id, identity.household_id),
      this.db
        .prepare(
          `INSERT INTO investment_connection_versions (
             id, household_id, connection_id, version, institution_key,
             institution_label, lifecycle_state, credential_reference,
             supersedes_version_id, recorded_by_user_id, recorded_at,
             immutable
           ) VALUES (?, ?, ?, ?, ?, ?, 'disconnected', NULL, ?, ?, ?, 1)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          connection.investment_connection_id,
          connection.investment_version + 1,
          connection.institution_key,
          connection.institution_label,
          connection.investment_version_id,
          identity.user_id,
          recordedAt,
        ),
    ]);
  }

  public async claimPlaidWebhookDelivery(input: {
    providerAccountKey: string;
    signatureSha256: string;
    bodySha256: string;
    issuedAt: string;
    receivedAt: string;
  }): Promise<PlaidWebhookDeliveryClaim> {
    const parsed = z
      .object({
        providerAccountKey: Sha256Schema,
        signatureSha256: Sha256Schema,
        bodySha256: Sha256Schema,
        issuedAt: z.iso.datetime({ offset: true }),
        receivedAt: z.iso.datetime({ offset: true }),
      })
      .strict()
      .parse(input);
    const connection = await this.db
      .prepare(
        `SELECT
           account.id,
           account.household_id,
           link.connection_id AS investment_connection_id
         FROM connector_accounts account
         JOIN connector_investment_connection_versions link
           ON link.connector_account_id = account.id
          AND NOT EXISTS (
            SELECT 1
            FROM connector_investment_connection_versions later
            WHERE later.supersedes_link_id = link.id
          )
         JOIN investment_connection_versions state
           ON state.connection_id = link.connection_id
          AND state.lifecycle_state = 'active'
          AND NOT EXISTS (
            SELECT 1
            FROM investment_connection_versions later
            WHERE later.supersedes_version_id = state.id
          )
         WHERE account.connector_type = ? AND account.provider_account_key = ?
           AND account.status = 'active'`,
      )
      .bind(CONNECTOR_TYPE, parsed.providerAccountKey)
      .first<{
        id: string;
        household_id: string;
        investment_connection_id: string;
      }>();
    if (connection === null) {
      return { status: "unknown" };
    }
    const existing = await this.db
      .prepare(
        `SELECT id, status
         FROM plaid_webhook_deliveries
         WHERE signature_sha256 = ?`,
      )
      .bind(parsed.signatureSha256)
      .first<{ id: string; status: string }>();
    if (existing !== null && existing.status !== "received") {
      return { status: "duplicate", deliveryId: existing.id };
    }
    if (existing !== null) {
      return { status: "claimed", deliveryId: existing.id };
    }

    const deliveryId = crypto.randomUUID();
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO plaid_webhook_deliveries (
               id, household_id, connector_account_id, signature_sha256,
               body_sha256, issued_at, received_at, status, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?)`,
          )
          .bind(
            deliveryId,
            connection.household_id,
            connection.id,
            parsed.signatureSha256,
            parsed.bodySha256,
            parsed.issuedAt,
            parsed.receivedAt,
            parsed.receivedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO plaid_webhook_investment_connections (
               id, household_id, delivery_id, connection_id, created_at,
               immutable
             ) VALUES (?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            connection.household_id,
            deliveryId,
            connection.investment_connection_id,
            parsed.receivedAt,
          ),
      ]);
      return { status: "claimed", deliveryId };
    } catch (error) {
      const raced = await this.db
        .prepare(
          `SELECT id, status
           FROM plaid_webhook_deliveries
           WHERE signature_sha256 = ?`,
        )
        .bind(parsed.signatureSha256)
        .first<{ id: string; status: string }>();
      if (raced === null) {
        throw error;
      }
      return {
        status: raced.status === "received" ? "claimed" : "duplicate",
        deliveryId: raced.id,
      };
    }
  }

  public async getPlaidWebhookDelivery(
    rawDeliveryId: string,
  ): Promise<PlaidWebhookDelivery | null> {
    const deliveryId = z.uuid().parse(rawDeliveryId);
    const row = await this.db
      .prepare(
        `SELECT delivery.id, user.access_subject, delivery.status,
                webhook_scope.connection_id
         FROM plaid_webhook_deliveries delivery
         JOIN connector_accounts account
           ON account.id = delivery.connector_account_id
          AND account.household_id = delivery.household_id
         JOIN plaid_webhook_investment_connections webhook_scope
           ON webhook_scope.delivery_id = delivery.id
          AND webhook_scope.household_id = delivery.household_id
         JOIN connector_investment_connection_versions connection_scope
           ON connection_scope.connector_account_id = account.id
          AND connection_scope.connection_id = webhook_scope.connection_id
          AND NOT EXISTS (
            SELECT 1
            FROM connector_investment_connection_versions later
            WHERE later.supersedes_link_id = connection_scope.id
          )
         JOIN investment_connection_versions connection_state
           ON connection_state.connection_id = webhook_scope.connection_id
          AND connection_state.lifecycle_state = 'active'
          AND NOT EXISTS (
            SELECT 1
            FROM investment_connection_versions later
            WHERE later.supersedes_version_id = connection_state.id
          )
         JOIN households household ON household.id = delivery.household_id
         JOIN users user ON user.id = household.owner_user_id
         WHERE delivery.id = ? AND account.status = 'active'`,
      )
      .bind(deliveryId)
      .first<{
        id: string;
        access_subject: string;
        connection_id: string;
        status: PlaidWebhookDelivery["status"];
      }>();
    return row === null
      ? null
      : {
          id: row.id,
          accessSubject: row.access_subject,
          connectionId: row.connection_id,
          status: row.status,
        };
  }

  public async markPlaidWebhookDelivery(
    rawDeliveryId: string,
    rawStatus: "queued" | "processing" | "processed" | "failed",
  ): Promise<boolean> {
    const deliveryId = z.uuid().parse(rawDeliveryId);
    const status = z
      .enum(["queued", "processing", "processed", "failed"])
      .parse(rawStatus);
    const priorStatuses = {
      queued: ["received"],
      processing: ["received", "queued", "processing", "failed"],
      processed: ["processing"],
      failed: ["processing"],
    }[status];
    const placeholders = priorStatuses.map(() => "?").join(", ");
    const result = await this.db
      .prepare(
        `UPDATE plaid_webhook_deliveries
         SET status = ?, updated_at = ?
         WHERE id = ? AND status IN (${placeholders})`,
      )
      .bind(status, new Date().toISOString(), deliveryId, ...priorStatuses)
      .run();
    return result.meta.changes > 0;
  }

  public async beginSync(
    accessSubject: string,
    rawConnectionId: string,
  ): Promise<InvestmentSyncRun> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(
      identity.household_id,
      connectionId,
    );
    if (
      connection === null ||
      connection.status !== "active" ||
      connection.investment_connection_id === null ||
      connection.investment_lifecycle_state !== "active" ||
      connection.institution_key === null ||
      connection.institution_label === null
    ) {
      throw new Error("Investment connection is not active.");
    }
    await this.expireStaleSyncRuns(
      identity.household_id,
      connection.id,
      connection.investment_connection_id,
    );
    const active = await this.db
      .prepare(
        `SELECT run.id
         FROM connector_sync_runs run
         JOIN connector_sync_investment_connections scope
           ON scope.sync_run_id = run.id
         WHERE run.connector_account_id = ?
           AND run.household_id = ?
           AND scope.connection_id = ?
           AND run.status IN ('queued', 'running')
         ORDER BY run.started_at DESC
         LIMIT 1`,
      )
      .bind(
        connection.id,
        identity.household_id,
        connection.investment_connection_id,
      )
      .first<{ id: string }>();
    if (active !== null) {
      return {
        id: active.id,
        connection: {
          id: connection.investment_connection_id,
          connectorAccountId: connection.id,
          secretReference: connection.secret_reference,
          providerAccountKey: connection.provider_account_key,
          institutionKey: connection.institution_key,
          institutionLabel: connection.institution_label,
        },
        created: false,
      };
    }

    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO connector_sync_runs (
               id, household_id, connector_account_id, status, started_at,
               finished_at, cursor, discovered_count, proposed_count,
               error_code
             ) VALUES (?, ?, ?, 'running', ?, NULL, NULL, 0, 0, NULL)`,
          )
          .bind(runId, identity.household_id, connection.id, startedAt),
        this.db
          .prepare(
            `INSERT INTO connector_sync_investment_connections (
               id, household_id, sync_run_id, connection_id, created_at,
               immutable
             ) VALUES (?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            runId,
            connection.investment_connection_id,
            startedAt,
          ),
      ]);
    } catch (error) {
      const raced = await this.db
        .prepare(
          `SELECT run.id
           FROM connector_sync_runs run
           JOIN connector_sync_investment_connections scope
             ON scope.sync_run_id = run.id
           WHERE run.connector_account_id = ?
             AND run.household_id = ?
             AND scope.connection_id = ?
             AND run.status IN ('queued', 'running')
           ORDER BY run.started_at DESC
           LIMIT 1`,
        )
        .bind(
          connection.id,
          identity.household_id,
          connection.investment_connection_id,
        )
        .first<{ id: string }>();
      if (raced === null) {
        throw error;
      }
      return {
        id: raced.id,
        connection: {
          id: connection.investment_connection_id,
          connectorAccountId: connection.id,
          secretReference: connection.secret_reference,
          providerAccountKey: connection.provider_account_key,
          institutionKey: connection.institution_key,
          institutionLabel: connection.institution_label,
        },
        created: false,
      };
    }
    return {
      id: runId,
      connection: {
        id: connection.investment_connection_id,
        connectorAccountId: connection.id,
        secretReference: connection.secret_reference,
        providerAccountKey: connection.provider_account_key,
        institutionKey: connection.institution_key,
        institutionLabel: connection.institution_label,
      },
      created: true,
    };
  }

  public async beginAutomaticSync(
    accessSubject: string,
    rawConnectionId: string,
    rawSyncedAfter: string,
  ): Promise<InvestmentSyncRun | null> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const syncedAfter = z.iso.datetime({ offset: true }).parse(rawSyncedAfter);
    const connection = await this.getConnection(accessSubject, connectionId);
    if (connection === null) {
      return null;
    }
    const identity = await findIdentity(this.db, accessSubject);
    const runId = crypto.randomUUID();
    const scopeId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await this.expireStaleSyncRuns(
      identity.household_id,
      connection.connectorAccountId,
      connection.id,
    );
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO connector_sync_runs (
               id, household_id, connector_account_id, status, started_at,
               finished_at, cursor, discovered_count, proposed_count,
               error_code
             )
             SELECT ?, ?, ?, 'running', ?, NULL,
                    'investment-holdings-auto-v1', 0, 0, NULL
             WHERE NOT EXISTS (
               SELECT 1 FROM connector_sync_runs active
               WHERE active.household_id = ?
                 AND active.connector_account_id = ?
                 AND active.status IN ('queued', 'running')
             )
             AND EXISTS (
               SELECT 1
               FROM connector_accounts current_account
               JOIN connector_investment_connection_versions current_link
                 ON current_link.connector_account_id = current_account.id
                AND current_link.household_id = current_account.household_id
                AND NOT EXISTS (
                  SELECT 1
                  FROM connector_investment_connection_versions later_link
                  WHERE later_link.supersedes_link_id = current_link.id
                )
               JOIN investment_connection_versions current_state
                 ON current_state.connection_id = current_link.connection_id
                AND current_state.household_id = current_account.household_id
                AND NOT EXISTS (
                  SELECT 1
                  FROM investment_connection_versions later_state
                  WHERE later_state.supersedes_version_id = current_state.id
                )
               WHERE current_account.id = ?
                 AND current_account.household_id = ?
                 AND current_account.connector_type = ?
                 AND current_account.status = 'active'
                 AND current_link.connection_id = ?
                 AND current_state.lifecycle_state = 'active'
             )
             AND NOT EXISTS (
               SELECT 1
               FROM connector_sync_runs recent
               JOIN connector_sync_investment_connections recent_scope
                 ON recent_scope.sync_run_id = recent.id
               WHERE recent.household_id = ?
                 AND recent.connector_account_id = ?
                 AND recent_scope.connection_id = ?
                 AND recent.started_at >= ?
             )
             AND NOT EXISTS (
               SELECT 1
               FROM holding_import_connections import_scope
               JOIN holding_imports import ON import.id = import_scope.import_id
               JOIN source_documents document
                 ON document.id = import.source_document_id
               WHERE import_scope.household_id = ?
                 AND import_scope.connection_id = ?
                 AND document.review_status = 'pending_review'
             )`,
          )
          .bind(
            runId,
            identity.household_id,
            connection.connectorAccountId,
            startedAt,
            identity.household_id,
            connection.connectorAccountId,
            connection.connectorAccountId,
            identity.household_id,
            CONNECTOR_TYPE,
            connection.id,
            identity.household_id,
            connection.connectorAccountId,
            connection.id,
            syncedAfter,
            identity.household_id,
            connection.id,
          ),
        this.db
          .prepare(
            `INSERT INTO connector_sync_investment_connections (
               id, household_id, sync_run_id, connection_id, created_at,
               immutable
             )
             SELECT ?, ?, ?, ?, ?, 1
             WHERE EXISTS (
               SELECT 1 FROM connector_sync_runs run
               WHERE run.id = ? AND run.household_id = ?
             )`,
          )
          .bind(
            scopeId,
            identity.household_id,
            runId,
            connection.id,
            startedAt,
            runId,
            identity.household_id,
          ),
      ]);
    } catch (error) {
      const blocked = await this.db
        .prepare(
          `SELECT run.id
           FROM connector_sync_runs run
           LEFT JOIN connector_sync_investment_connections scope
             ON scope.sync_run_id = run.id
           WHERE run.household_id = ?
             AND run.connector_account_id = ?
             AND (
               run.status IN ('queued', 'running')
               OR (scope.connection_id = ? AND run.started_at >= ?)
             )
           LIMIT 1`,
        )
        .bind(
          identity.household_id,
          connection.connectorAccountId,
          connection.id,
          syncedAfter,
        )
        .first<{ id: string }>();
      if (blocked !== null) {
        return null;
      }
      throw error;
    }
    const created = await this.db
      .prepare(
        `SELECT id FROM connector_sync_runs
         WHERE id = ? AND household_id = ?`,
      )
      .bind(runId, identity.household_id)
      .first<{ id: string }>();
    return created === null
      ? null
      : {
          id: runId,
          connection,
          created: true,
        };
  }

  public async completeSync(
    accessSubject: string,
    runId: string,
    input: {
      discoveredCount: number;
      proposedCount: number;
      importId: string | null;
      adjudication?: {
        policyVersion: string;
        autoAppliedCount: number;
        quarantinedCount: number;
        preservedPositionCount: number;
        baselineRefreshStatus: "not_needed" | "refreshed" | "manual_required";
        portfolioBaselineId: string | null;
      } | null;
    },
  ): Promise<void> {
    const parsed = z
      .object({
        discoveredCount: z.number().int().nonnegative().max(500),
        proposedCount: z.number().int().nonnegative().max(500),
        importId: z.string().min(1).nullable(),
        adjudication: z
          .object({
            policyVersion: z.string().min(1).max(100),
            autoAppliedCount: z.number().int().nonnegative().max(500),
            quarantinedCount: z.number().int().nonnegative().max(1_000),
            preservedPositionCount: z.number().int().nonnegative().max(500),
            baselineRefreshStatus: z.enum([
              "not_needed",
              "refreshed",
              "manual_required",
            ]),
            portfolioBaselineId: z.string().min(1).nullable(),
          })
          .strict()
          .nullable()
          .optional()
          .default(null),
      })
      .strict()
      .parse(input);
    const identity = await findIdentity(this.db, accessSubject);
    const finishedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE connector_sync_runs
           SET status = 'succeeded', finished_at = ?, discovered_count = ?,
               proposed_count = ?, error_code = NULL,
               adjudication_policy_version = ?, auto_applied_count = ?,
               quarantined_count = ?, preserved_position_count = ?,
               baseline_refresh_status = ?, portfolio_baseline_id = ?
           WHERE id = ? AND household_id = ? AND status = 'running'`,
        )
        .bind(
          finishedAt,
          parsed.discoveredCount,
          parsed.proposedCount,
          parsed.adjudication?.policyVersion ?? null,
          parsed.adjudication?.autoAppliedCount ?? 0,
          parsed.adjudication?.quarantinedCount ?? 0,
          parsed.adjudication?.preservedPositionCount ?? 0,
          parsed.adjudication?.baselineRefreshStatus ?? "not_needed",
          parsed.adjudication?.portfolioBaselineId ?? null,
          runId,
          identity.household_id,
        ),
      this.db
        .prepare(
          `UPDATE connector_accounts
           SET last_synced_at = ?
           WHERE id = (
             SELECT run.connector_account_id
             FROM connector_sync_runs run
             JOIN connector_sync_investment_connections run_scope
               ON run_scope.sync_run_id = run.id
             JOIN connector_investment_connection_versions current_scope
               ON current_scope.connector_account_id = run.connector_account_id
              AND current_scope.connection_id = run_scope.connection_id
              AND NOT EXISTS (
                SELECT 1
                FROM connector_investment_connection_versions later
                WHERE later.supersedes_link_id = current_scope.id
              )
             WHERE run.id = ? AND run.household_id = ?
               AND run.status = 'succeeded'
           )`,
        )
        .bind(finishedAt, runId, identity.household_id),
    ];
    if (parsed.importId !== null) {
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO connector_sync_imports (
               id, household_id, sync_run_id, holding_import_id, created_at
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            runId,
            parsed.importId,
            finishedAt,
          ),
      );
    }
    await this.db.batch(statements);
  }

  public async failSync(
    accessSubject: string,
    runId: string,
    rawErrorCode: InvestmentSyncErrorCode,
  ): Promise<void> {
    const errorCode = InvestmentSyncErrorCodeSchema.parse(rawErrorCode);
    const identity = await findIdentity(this.db, accessSubject);
    await this.db
      .prepare(
        `UPDATE connector_sync_runs
         SET status = 'failed', finished_at = ?, error_code = ?
         WHERE id = ? AND household_id = ? AND status = 'running'`,
      )
      .bind(new Date().toISOString(), errorCode, runId, identity.household_id)
      .run();
  }

  private async expireStaleSyncRuns(
    householdId: string,
    connectorAccountId: string,
    connectionId: string,
  ): Promise<void> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - INVESTMENT_SYNC_STALE_AFTER_MS,
    ).toISOString();
    await this.db
      .prepare(
        `UPDATE connector_sync_runs
         SET status = 'failed', finished_at = ?, error_code = 'unexpected_failure'
         WHERE id IN (
           SELECT run.id
           FROM connector_sync_runs run
           JOIN connector_sync_investment_connections scope
             ON scope.sync_run_id = run.id
           WHERE run.household_id = ?
             AND run.connector_account_id = ?
             AND scope.connection_id = ?
             AND run.status IN ('queued', 'running')
             AND run.started_at <= ?
         )`,
      )
      .bind(
        now.toISOString(),
        householdId,
        connectorAccountId,
        connectionId,
        cutoff,
      )
      .run();
  }

  private async findConnection(
    householdId: string,
    connectionId: string,
  ): Promise<ConnectionRow | null> {
    return this.db
      .prepare(
        `SELECT account.id, account.display_label, account.created_at,
                account.secret_reference, account.status,
                account.last_synced_at, account.provider_account_key,
                connection.id AS investment_connection_id,
                connection.protected_source_key AS investment_source_key,
                state.id AS investment_version_id,
                state.version AS investment_version,
                state.lifecycle_state AS investment_lifecycle_state,
                state.credential_reference AS investment_credential_reference,
                state.institution_key, state.institution_label,
                link.id AS connector_link_id,
                link.version AS connector_link_version
         FROM connector_accounts account
         LEFT JOIN connector_investment_connection_versions link
           ON link.connector_account_id = account.id
          AND link.household_id = account.household_id
          AND NOT EXISTS (
            SELECT 1
            FROM connector_investment_connection_versions later
            WHERE later.supersedes_link_id = link.id
          )
         LEFT JOIN investment_connections connection
           ON connection.id = link.connection_id
          AND connection.household_id = account.household_id
         LEFT JOIN investment_connection_versions state
           ON state.connection_id = connection.id
          AND state.household_id = account.household_id
          AND NOT EXISTS (
            SELECT 1
            FROM investment_connection_versions later
            WHERE later.supersedes_version_id = state.id
          )
         WHERE account.household_id = ?
           AND account.connector_type = ?
           AND connection.id = ?`,
      )
      .bind(householdId, CONNECTOR_TYPE, connectionId)
      .first<ConnectionRow>();
  }

  private async findConnectionBySourceKey(
    householdId: string,
    sourceKey: string,
  ): Promise<ConnectionRow | null> {
    return this.db
      .prepare(
        `SELECT account.id, account.display_label, account.created_at,
                account.secret_reference, account.status,
                account.last_synced_at, account.provider_account_key,
                connection.id AS investment_connection_id,
                connection.protected_source_key AS investment_source_key,
                state.id AS investment_version_id,
                state.version AS investment_version,
                state.lifecycle_state AS investment_lifecycle_state,
                state.credential_reference AS investment_credential_reference,
                state.institution_key, state.institution_label,
                link.id AS connector_link_id,
                link.version AS connector_link_version
         FROM connector_accounts account
         LEFT JOIN connector_investment_connection_versions link
           ON link.connector_account_id = account.id
          AND link.household_id = account.household_id
          AND NOT EXISTS (
            SELECT 1
            FROM connector_investment_connection_versions later
            WHERE later.supersedes_link_id = link.id
          )
         LEFT JOIN investment_connections connection
           ON connection.id = link.connection_id
          AND connection.household_id = account.household_id
         LEFT JOIN investment_connection_versions state
           ON state.connection_id = connection.id
          AND state.household_id = account.household_id
          AND NOT EXISTS (
            SELECT 1
            FROM investment_connection_versions later
            WHERE later.supersedes_version_id = state.id
          )
         WHERE account.household_id = ?
           AND account.connector_type = ?
           AND account.provider_account_key = ?`,
      )
      .bind(householdId, CONNECTOR_TYPE, sourceKey)
      .first<ConnectionRow>();
  }

  private async findConnections(householdId: string): Promise<ConnectionRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT account.id, account.display_label, account.created_at,
                account.secret_reference, account.status,
                account.last_synced_at, account.provider_account_key,
                connection.id AS investment_connection_id,
                connection.protected_source_key AS investment_source_key,
                state.id AS investment_version_id,
                state.version AS investment_version,
                state.lifecycle_state AS investment_lifecycle_state,
                state.credential_reference AS investment_credential_reference,
                state.institution_key, state.institution_label,
                link.id AS connector_link_id,
                link.version AS connector_link_version
         FROM connector_accounts account
         LEFT JOIN connector_investment_connection_versions link
           ON link.connector_account_id = account.id
          AND link.household_id = account.household_id
          AND NOT EXISTS (
            SELECT 1
            FROM connector_investment_connection_versions later
            WHERE later.supersedes_link_id = link.id
          )
         LEFT JOIN investment_connections connection
           ON connection.id = link.connection_id
          AND connection.household_id = account.household_id
         LEFT JOIN investment_connection_versions state
           ON state.connection_id = connection.id
          AND state.household_id = account.household_id
          AND NOT EXISTS (
            SELECT 1
            FROM investment_connection_versions later
            WHERE later.supersedes_version_id = state.id
          )
         WHERE account.household_id = ?
           AND account.connector_type = ?
         ORDER BY account.created_at, account.id`,
      )
      .bind(householdId, CONNECTOR_TYPE)
      .all<ConnectionRow>();
    return rows.results;
  }

  private async findInvestmentConnectionBySourceKey(
    householdId: string,
    sourceKey: string,
  ): Promise<InvestmentConnectionRow | null> {
    return this.db
      .prepare(
        `SELECT connection.id, connection.protected_source_key,
                state.id AS version_id, state.version,
                state.lifecycle_state, state.credential_reference,
                state.institution_key, state.institution_label
         FROM investment_connections connection
         JOIN investment_connection_versions state
           ON state.connection_id = connection.id
          AND state.household_id = connection.household_id
          AND NOT EXISTS (
            SELECT 1
            FROM investment_connection_versions later
            WHERE later.supersedes_version_id = state.id
          )
         WHERE connection.household_id = ?
           AND connection.adapter_type = ?
           AND connection.protected_source_key = ?`,
      )
      .bind(householdId, CONNECTOR_TYPE, sourceKey)
      .first<InvestmentConnectionRow>();
  }
}

export const __investmentConnectionsTest = {
  dueAutomaticInvestmentConnectionsSql:
    DUE_AUTOMATIC_INVESTMENT_CONNECTIONS_SQL,
  syncStaleAfterMs: INVESTMENT_SYNC_STALE_AFTER_MS,
};
