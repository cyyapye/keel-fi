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
};

type LatestRunRow = {
  status: "queued" | "running" | "succeeded" | "failed";
  error_code: string | null;
};

export type RobinhoodConnection = {
  readonly id: string;
  readonly secretReference: string;
};

export type RobinhoodConnectionUpdate = RobinhoodConnection & {
  readonly previousSecretReference: string | null;
};

export type RobinhoodSyncRun = {
  readonly id: string;
  readonly connection: RobinhoodConnection;
  readonly created: boolean;
};

export interface PublicHoldingsRepository {
  getStatus(
    accessSubject: string,
    configured: boolean,
  ): Promise<RobinhoodSyncStatus>;
  getConnection(accessSubject: string): Promise<RobinhoodConnection | null>;
  upsertConnection(
    accessSubject: string,
    secretReference: string,
  ): Promise<RobinhoodConnectionUpdate>;
  beginSync(accessSubject: string): Promise<RobinhoodSyncRun>;
  completeSync(
    accessSubject: string,
    runId: string,
    input: {
      discoveredCount: number;
      proposedCount: number;
      importId: string | null;
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
        latestImportId: null,
        latestRunStatus: null,
        errorCode: "configuration_required",
      });
    }
    if (connection === null || connection.status !== "active") {
      return RobinhoodSyncStatusSchema.parse({
        version: 1,
        configured: true,
        status: "disconnected",
        lastSyncedAt: null,
        latestImportId: null,
        latestRunStatus: null,
        errorCode: null,
      });
    }

    const [latestRun, latestImport] = await Promise.all([
      this.db
        .prepare(
          `SELECT status, error_code
           FROM connector_sync_runs
           WHERE connector_account_id = ? AND household_id = ?
           ORDER BY started_at DESC, id DESC
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
    ]);
    const runStatus =
      latestRun?.status === "queued" ? "running" : (latestRun?.status ?? null);
    const errorCode =
      latestRun?.error_code === null || latestRun?.error_code === undefined
        ? null
        : RobinhoodSyncErrorCodeSchema.parse(latestRun.error_code);

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
      latestImportId: latestImport?.id ?? null,
      latestRunStatus: runStatus,
      errorCode,
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
    return { id: connection.id, secretReference: connection.secret_reference };
  }

  public async upsertConnection(
    accessSubject: string,
    rawSecretReference: string,
  ): Promise<RobinhoodConnectionUpdate> {
    const secretReference = z
      .string()
      .min(1)
      .max(1_024)
      .parse(rawSecretReference);
    const identity = await findIdentity(this.db, accessSubject);
    const existing = await this.findConnection(identity.household_id);
    const now = new Date().toISOString();
    if (existing === null) {
      const id = crypto.randomUUID();
      await this.db
        .prepare(
          `INSERT INTO connector_accounts (
             id, household_id, connector_type, display_label, secret_reference,
             status, last_synced_at, created_at
           ) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?)`,
        )
        .bind(
          id,
          identity.household_id,
          CONNECTOR_TYPE,
          DISPLAY_LABEL,
          secretReference,
          now,
        )
        .run();
      return {
        id,
        secretReference,
        previousSecretReference: null,
      };
    }

    await this.db
      .prepare(
        `UPDATE connector_accounts
         SET secret_reference = ?, status = 'active'
         WHERE id = ? AND household_id = ?`,
      )
      .bind(secretReference, existing.id, identity.household_id)
      .run();
    return {
      id: existing.id,
      secretReference,
      previousSecretReference: existing.secret_reference,
    };
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
        },
        created: false,
      };
    }
    return {
      id: runId,
      connection: {
        id: connection.id,
        secretReference: connection.secret_reference,
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
    },
  ): Promise<void> {
    const parsed = z
      .object({
        discoveredCount: z.number().int().nonnegative().max(500),
        proposedCount: z.number().int().nonnegative().max(500),
        importId: z.string().min(1).nullable(),
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
               proposed_count = ?, error_code = NULL
           WHERE id = ? AND household_id = ? AND status = 'running'`,
        )
        .bind(
          finishedAt,
          parsed.discoveredCount,
          parsed.proposedCount,
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
            `INSERT INTO connector_sync_imports (
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
        `SELECT id, secret_reference, status, last_synced_at
         FROM connector_accounts
         WHERE household_id = ? AND connector_type = ? AND display_label = ?`,
      )
      .bind(householdId, CONNECTOR_TYPE, DISPLAY_LABEL)
      .first<ConnectionRow>();
  }
}
