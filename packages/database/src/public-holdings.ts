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

export type RobinhoodConnection = {
  readonly id: string;
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
    if (connection === null || connection.status !== "active") {
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
           LEFT JOIN connector_sync_imports link ON link.sync_run_id = run.id
           WHERE run.connector_account_id = ? AND run.household_id = ?
           ORDER BY run.started_at DESC, run.id DESC
           LIMIT 1`,
          )
          .bind(connection.id, identity.household_id)
          .first<LatestRunRow>(),
        this.db
          .prepare(
            `SELECT link.holding_import_id AS id
           FROM connector_sync_imports link
           JOIN holding_imports import ON import.id = link.holding_import_id
           JOIN source_documents document
             ON document.id = import.source_document_id
           WHERE link.household_id = ?
             AND document.review_status = 'pending_review'
           ORDER BY link.created_at DESC, link.id DESC
           LIMIT 1`,
          )
          .bind(identity.household_id)
          .first<{ id: string }>(),
        this.db
          .prepare(
            `SELECT holding_import_id AS id
             FROM connector_sync_imports
             WHERE household_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 1`,
          )
          .bind(identity.household_id)
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
    if (connection === null || connection.status !== "active") {
      return null;
    }
    return {
      id: connection.id,
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
          DISPLAY_LABEL,
          secretReference,
          providerAccountKey,
          now,
        )
        .run();
      return {
        id,
        secretReference,
        providerAccountKey,
        previousSecretReference: null,
      };
    }

    const result = await this.db
      .prepare(
        `UPDATE connector_accounts
         SET secret_reference = ?, provider_account_key = ?, status = 'active'
         WHERE id = ? AND household_id = ?`,
      )
      .bind(
        secretReference,
        providerAccountKey,
        existing.id,
        identity.household_id,
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new Error("Robinhood connection could not be updated.");
    }
    return {
      id: existing.id,
      secretReference,
      providerAccountKey,
      previousSecretReference: existing.secret_reference,
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
    const result = await this.db
      .prepare(
        `UPDATE connector_accounts
         SET provider_account_key = ?
         WHERE id = ? AND household_id = ? AND connector_type = ?
           AND status = 'active'`,
      )
      .bind(
        providerAccountKey,
        connectionId,
        identity.household_id,
        CONNECTOR_TYPE,
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new Error("Active Robinhood connection was not found.");
    }
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
        `SELECT id, household_id
         FROM connector_accounts
         WHERE connector_type = ? AND provider_account_key = ?
           AND status = 'active'`,
      )
      .bind(CONNECTOR_TYPE, parsed.providerAccountKey)
      .first<{ id: string; household_id: string }>();
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
      await this.db
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
        )
        .run();
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
    if (connection === null || connection.status !== "active") {
      throw new Error("Robinhood is not connected.");
    }
    const active = await this.db
      .prepare(
        `SELECT id
         FROM connector_sync_runs
         WHERE connector_account_id = ?
           AND household_id = ?
           AND status IN ('queued', 'running')
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .bind(connection.id, identity.household_id)
      .first<{ id: string }>();
    if (active !== null) {
      return {
        id: active.id,
        connection: {
          id: connection.id,
          secretReference: connection.secret_reference,
          providerAccountKey: connection.provider_account_key,
        },
        created: false,
      };
    }

    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      await this.db
        .prepare(
          `INSERT INTO connector_sync_runs (
             id, household_id, connector_account_id, status, started_at,
             finished_at, cursor, discovered_count, proposed_count, error_code
           ) VALUES (?, ?, ?, 'running', ?, NULL, NULL, 0, 0, NULL)`,
        )
        .bind(runId, identity.household_id, connection.id, startedAt)
        .run();
    } catch (error) {
      const raced = await this.db
        .prepare(
          `SELECT id
           FROM connector_sync_runs
           WHERE connector_account_id = ?
             AND household_id = ?
             AND status IN ('queued', 'running')
           ORDER BY started_at DESC
           LIMIT 1`,
        )
        .bind(connection.id, identity.household_id)
        .first<{ id: string }>();
      if (raced === null) {
        throw error;
      }
      return {
        id: raced.id,
        connection: {
          id: connection.id,
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
             SELECT connector_account_id
             FROM connector_sync_runs
             WHERE id = ? AND household_id = ?
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
        `SELECT id, secret_reference, status, last_synced_at,
                provider_account_key
         FROM connector_accounts
         WHERE household_id = ? AND connector_type = ? AND display_label = ?`,
      )
      .bind(householdId, CONNECTOR_TYPE, DISPLAY_LABEL)
      .first<ConnectionRow>();
  }
}
