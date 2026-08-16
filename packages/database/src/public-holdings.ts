import {
  RobinhoodSyncErrorCodeSchema,
  RobinhoodSyncStatusSchema,
  type RobinhoodSyncErrorCode,
  type RobinhoodSyncStatus,
} from "@keel/domain";
import { z } from "zod";

const CONNECTOR_TYPE = "plaid-investments";
const DISPLAY_LABEL = "Robinhood";

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type ConnectionRow = {
  id: string;
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
  connector_link_id: string | null;
  connector_link_version: number | null;
};

type LatestRunRow = {
  status: "queued" | "running" | "succeeded" | "failed";
  error_code: string | null;
  adjudication_policy_version: string | null;
  auto_applied_count: number;
  quarantined_count: number;
  preserved_position_count: number;
  baseline_refresh_status: "not_needed" | "refreshed" | "manual_required";
  holding_import_id: string | null;
};

type InvestmentConnectionRow = {
  id: string;
  protected_source_key: string;
  version_id: string;
  version: number;
  lifecycle_state: "pending" | "active" | "paused" | "disconnected";
  credential_reference: string | null;
};

export type RobinhoodConnection = {
  readonly id: string;
  readonly investmentConnectionId: string;
  readonly secretReference: string;
  readonly providerAccountKey: string | null;
};

export type RobinhoodConnectionUpdate = RobinhoodConnection & {
  readonly previousSecretReference: string | null;
};

export type RobinhoodSyncRun = {
  readonly id: string;
  readonly connection: RobinhoodConnection;
  readonly created: boolean;
};

export type PlaidWebhookDeliveryClaim =
  | { readonly status: "unknown" }
  | { readonly status: "duplicate"; readonly deliveryId: string }
  | { readonly status: "claimed"; readonly deliveryId: string };

export type PlaidWebhookDelivery = {
  readonly id: string;
  readonly accessSubject: string;
  readonly status:
    "received" | "queued" | "processing" | "processed" | "failed";
};

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export interface PublicHoldingsRepository {
  getStatus(
    accessSubject: string,
    configured: boolean,
  ): Promise<RobinhoodSyncStatus>;
  getConnection(accessSubject: string): Promise<RobinhoodConnection | null>;
  upsertConnection(
    accessSubject: string,
    secretReference: string,
    providerAccountKey: string,
  ): Promise<RobinhoodConnectionUpdate>;
  bindProviderAccountKey(
    accessSubject: string,
    connectionId: string,
    providerAccountKey: string,
  ): Promise<void>;
  disconnectConnection(
    accessSubject: string,
    connectionId: string,
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
  beginSync(accessSubject: string): Promise<RobinhoodSyncRun>;
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
    errorCode: RobinhoodSyncErrorCode,
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

export class D1PublicHoldingsRepository implements PublicHoldingsRepository {
  public constructor(private readonly db: D1Database) {}

  public async getStatus(
    accessSubject: string,
    configured: boolean,
  ): Promise<RobinhoodSyncStatus> {
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(identity.household_id);
    if (!configured) {
      return RobinhoodSyncStatusSchema.parse({
        version: 1,
        configured: false,
        status: "setup_required",
        lastSyncedAt: connection?.last_synced_at ?? null,
        automaticUpdatesEnabled:
          connection?.provider_account_key !== null &&
          connection?.provider_account_key !== undefined,
        latestImportId: null,
        latestRunStatus: null,
        errorCode: "configuration_required",
        latestAdjudication: null,
      });
    }
    if (
      connection === null ||
      connection.status !== "active" ||
      connection.investment_connection_id === null ||
      connection.investment_lifecycle_state !== "active"
    ) {
      return RobinhoodSyncStatusSchema.parse({
        version: 1,
        configured: true,
        status: "disconnected",
        lastSyncedAt: null,
        automaticUpdatesEnabled: false,
        latestImportId: null,
        latestRunStatus: null,
        errorCode: null,
        latestAdjudication: null,
      });
    }

    const [latestRun, latestPendingImport, latestLinkedImport] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT run.status, run.error_code,
                  run.adjudication_policy_version,
                  run.auto_applied_count,
                  run.quarantined_count,
                  run.preserved_position_count,
                  run.baseline_refresh_status,
                  link.holding_import_id
           FROM connector_sync_runs run
           JOIN connector_sync_investment_connections run_scope
             ON run_scope.sync_run_id = run.id
           LEFT JOIN connector_sync_imports link ON link.sync_run_id = run.id
           WHERE run.connector_account_id = ? AND run.household_id = ?
             AND run_scope.connection_id = ?
           ORDER BY run.started_at DESC, run.id DESC
           LIMIT 1`,
          )
          .bind(
            connection.id,
            identity.household_id,
            connection.investment_connection_id,
          )
          .first<LatestRunRow>(),
        this.db
          .prepare(
            `SELECT link.holding_import_id AS id
           FROM connector_sync_imports link
           JOIN holding_imports import ON import.id = link.holding_import_id
           JOIN holding_import_connections import_scope
             ON import_scope.import_id = import.id
           JOIN source_documents document
             ON document.id = import.source_document_id
           WHERE link.household_id = ?
             AND import_scope.connection_id = ?
             AND document.review_status = 'pending_review'
           ORDER BY link.created_at DESC, link.id DESC
           LIMIT 1`,
          )
          .bind(identity.household_id, connection.investment_connection_id)
          .first<{ id: string }>(),
        this.db
          .prepare(
            `SELECT link.holding_import_id AS id
             FROM connector_sync_imports link
             JOIN holding_import_connections import_scope
               ON import_scope.import_id = link.holding_import_id
             WHERE link.household_id = ?
               AND import_scope.connection_id = ?
             ORDER BY link.created_at DESC, link.id DESC
             LIMIT 1`,
          )
          .bind(identity.household_id, connection.investment_connection_id)
          .first<{ id: string }>(),
      ]);
    const runStatus =
      latestRun?.status === "queued" ? "running" : (latestRun?.status ?? null);
    const errorCode =
      latestRun?.error_code === null || latestRun?.error_code === undefined
        ? null
        : RobinhoodSyncErrorCodeSchema.parse(latestRun.error_code);
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

    return RobinhoodSyncStatusSchema.parse({
      version: 1,
      configured: true,
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
  ): Promise<RobinhoodConnection | null> {
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(identity.household_id);
    if (
      connection === null ||
      connection.status !== "active" ||
      connection.investment_connection_id === null ||
      connection.investment_lifecycle_state !== "active"
    ) {
      return null;
    }
    return {
      id: connection.id,
      investmentConnectionId: connection.investment_connection_id,
      secretReference: connection.secret_reference,
      providerAccountKey: connection.provider_account_key,
    };
  }

  public async upsertConnection(
    accessSubject: string,
    rawSecretReference: string,
    rawProviderAccountKey: string,
  ): Promise<RobinhoodConnectionUpdate> {
    const secretReference = z
      .string()
      .min(1)
      .max(1_024)
      .parse(rawSecretReference);
    const providerAccountKey = Sha256Schema.parse(rawProviderAccountKey);
    const identity = await findIdentity(this.db, accessSubject);
    const existing = await this.findConnection(identity.household_id);
    const now = new Date().toISOString();
    const connectorAccountId = existing?.id ?? crypto.randomUUID();
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
            DISPLAY_LABEL,
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
                 last_synced_at = CASE
                   WHEN provider_account_key = ? THEN last_synced_at
                   ELSE NULL
                 END,
                 provider_account_key = ?, status = 'active'
             WHERE id = ? AND household_id = ?`,
          )
          .bind(
            secretReference,
            providerAccountKey,
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
          }
        : await this.findInvestmentConnectionBySourceKey(
            identity.household_id,
            providerAccountKey,
          );
    const linkedInvestmentConnectionId =
      existing?.investment_connection_id ?? null;

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
             ) VALUES (?, ?, ?, 1, 'robinhood', ?, 'active', ?, NULL, ?, ?, 1)`,
          )
          .bind(
            versionId,
            identity.household_id,
            investmentConnectionId,
            DISPLAY_LABEL,
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
      };
    } else if (
      investmentConnection.lifecycle_state !== "active" ||
      investmentConnection.credential_reference !== secretReference
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
             ) VALUES (?, ?, ?, ?, 'robinhood', ?, 'active', ?, ?, ?, ?, 1)`,
          )
          .bind(
            versionId,
            identity.household_id,
            investmentConnection.id,
            investmentConnection.version + 1,
            DISPLAY_LABEL,
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
      };
    }

    const replacesInvestmentConnection =
      existing?.investment_connection_id !== null &&
      existing?.investment_connection_id !== undefined &&
      existing.investment_connection_id !== investmentConnection.id;
    if (
      replacesInvestmentConnection &&
      existing.investment_version_id !== null &&
      existing.investment_version !== null &&
      existing.investment_lifecycle_state !== "disconnected"
    ) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO investment_connection_versions (
               id, household_id, connection_id, version, institution_key,
               institution_label, lifecycle_state, credential_reference,
               supersedes_version_id, recorded_by_user_id, recorded_at,
               immutable
             ) VALUES (?, ?, ?, ?, 'robinhood', ?, 'disconnected', NULL, ?, ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            existing.investment_connection_id,
            existing.investment_version + 1,
            DISPLAY_LABEL,
            existing.investment_version_id,
            identity.user_id,
            now,
          ),
        this.db
          .prepare(
            `UPDATE connector_sync_runs
             SET status = 'failed', finished_at = ?,
                 error_code = 'connection_invalid'
             WHERE connector_account_id = ? AND household_id = ?
               AND status IN ('queued', 'running')
               AND id IN (
                 SELECT sync_run_id
                 FROM connector_sync_investment_connections
                 WHERE connection_id = ? AND household_id = ?
               )`,
          )
          .bind(
            now,
            connectorAccountId,
            identity.household_id,
            existing.investment_connection_id,
            identity.household_id,
          ),
      );
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
      id: connectorAccountId,
      investmentConnectionId: investmentConnection.id,
      secretReference,
      providerAccountKey,
      previousSecretReference: existing?.secret_reference ?? null,
    };
  }

  public async bindProviderAccountKey(
    accessSubject: string,
    rawConnectionId: string,
    rawProviderAccountKey: string,
  ): Promise<void> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const providerAccountKey = Sha256Schema.parse(rawProviderAccountKey);
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(identity.household_id);
    if (
      connection === null ||
      connection.id !== connectionId ||
      connection.status !== "active"
    ) {
      throw new Error("Active Robinhood connection was not found.");
    }
    await this.upsertConnection(
      accessSubject,
      connection.secret_reference,
      providerAccountKey,
    );
  }

  public async disconnectConnection(
    accessSubject: string,
    rawConnectionId: string,
  ): Promise<void> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(identity.household_id);
    if (connection === null || connection.id !== connectionId) {
      throw new Error("Robinhood connection was not found.");
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
      connection.investment_version === null
    ) {
      throw new Error("Canonical Robinhood connection was not found.");
    }
    const recordedAt = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE connector_accounts
           SET status = 'revoked'
           WHERE id = ? AND household_id = ? AND status <> 'revoked'`,
        )
        .bind(connectionId, identity.household_id),
      this.db
        .prepare(
          `INSERT INTO investment_connection_versions (
             id, household_id, connection_id, version, institution_key,
             institution_label, lifecycle_state, credential_reference,
             supersedes_version_id, recorded_by_user_id, recorded_at,
             immutable
           ) VALUES (?, ?, ?, ?, 'robinhood', ?, 'disconnected', NULL, ?, ?, ?, 1)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          connection.investment_connection_id,
          connection.investment_version + 1,
          DISPLAY_LABEL,
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
        `SELECT delivery.id, user.access_subject, delivery.status
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
        status: PlaidWebhookDelivery["status"];
      }>();
    return row === null
      ? null
      : { id: row.id, accessSubject: row.access_subject, status: row.status };
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

  public async beginSync(accessSubject: string): Promise<RobinhoodSyncRun> {
    const identity = await findIdentity(this.db, accessSubject);
    const connection = await this.findConnection(identity.household_id);
    if (
      connection === null ||
      connection.status !== "active" ||
      connection.investment_connection_id === null ||
      connection.investment_lifecycle_state !== "active"
    ) {
      throw new Error("Robinhood is not connected.");
    }
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
          id: connection.id,
          investmentConnectionId: connection.investment_connection_id,
          secretReference: connection.secret_reference,
          providerAccountKey: connection.provider_account_key,
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
          id: connection.id,
          investmentConnectionId: connection.investment_connection_id,
          secretReference: connection.secret_reference,
          providerAccountKey: connection.provider_account_key,
        },
        created: false,
      };
    }
    return {
      id: runId,
      connection: {
        id: connection.id,
        investmentConnectionId: connection.investment_connection_id,
        secretReference: connection.secret_reference,
        providerAccountKey: connection.provider_account_key,
      },
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
    rawErrorCode: RobinhoodSyncErrorCode,
  ): Promise<void> {
    const errorCode = RobinhoodSyncErrorCodeSchema.parse(rawErrorCode);
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

  private async findConnection(
    householdId: string,
  ): Promise<ConnectionRow | null> {
    return this.db
      .prepare(
        `SELECT account.id, account.secret_reference, account.status,
                account.last_synced_at, account.provider_account_key,
                connection.id AS investment_connection_id,
                connection.protected_source_key AS investment_source_key,
                state.id AS investment_version_id,
                state.version AS investment_version,
                state.lifecycle_state AS investment_lifecycle_state,
                state.credential_reference AS investment_credential_reference,
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
           AND account.display_label = ?`,
      )
      .bind(householdId, CONNECTOR_TYPE, DISPLAY_LABEL)
      .first<ConnectionRow>();
  }

  private async findInvestmentConnectionBySourceKey(
    householdId: string,
    sourceKey: string,
  ): Promise<InvestmentConnectionRow | null> {
    return this.db
      .prepare(
        `SELECT connection.id, connection.protected_source_key,
                state.id AS version_id, state.version,
                state.lifecycle_state, state.credential_reference
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
