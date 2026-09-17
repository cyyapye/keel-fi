import { z } from "zod";
import {
  WatchReadInputSchema,
  WatchReadReceiptSchema,
} from "@keel/domain/portfolio-watch-activity";

const READER_SQL = `SELECT user.id AS user_id, household.id AS household_id
  FROM users user JOIN households household ON household.owner_user_id = user.id
  WHERE user.access_subject = ? ORDER BY household.created_at LIMIT 1`;

/** Personal read state never writes evidence, source health, or financial records. */
export class D1PortfolioWatchInboxRepository {
  public constructor(private readonly db: D1Database) {}

  public async setRead(
    accessSubject: string,
    rawObservationId: string,
    rawInput: unknown,
    now = new Date().toISOString(),
  ) {
    const observationId = z.string().min(1).max(200).parse(rawObservationId);
    const input = WatchReadInputSchema.parse(rawInput);
    const readAt = input.read
      ? z.iso.datetime({ offset: true }).parse(now)
      : null;
    const changed = await this.db
      .prepare(
        `
      WITH reader AS (${READER_SQL})
      INSERT INTO portfolio_watch_read_receipts
        (user_id, observation_id, household_id, read_at, version)
      SELECT reader.user_id, observation.id, reader.household_id, ?, 1
      FROM reader JOIN public_source_observations observation ON observation.household_id = reader.household_id
      LEFT JOIN portfolio_watch_read_receipts receipt
        ON receipt.user_id = reader.user_id AND receipt.observation_id = observation.id
      WHERE observation.id = ? AND COALESCE(receipt.version, 0) = ?
        AND ((? = 1 AND receipt.read_at IS NULL) OR (? = 0 AND receipt.read_at IS NOT NULL))
      ON CONFLICT (user_id, observation_id) DO UPDATE SET
        read_at = excluded.read_at, version = portfolio_watch_read_receipts.version + 1
      WHERE portfolio_watch_read_receipts.version = ?
      RETURNING read_at AS readAt, version
    `,
      )
      .bind(
        accessSubject,
        readAt,
        observationId,
        input.expectedVersion,
        Number(input.read),
        Number(input.read),
        input.expectedVersion,
      )
      .first<{ readAt: string | null; version: number }>();
    if (changed !== null) {
      return WatchReadReceiptSchema.parse({ observationId, ...changed });
    }
    const current = await this.db
      .prepare(
        `
      WITH reader AS (${READER_SQL})
      SELECT receipt.read_at AS readAt, COALESCE(receipt.version, 0) AS version
      FROM reader JOIN public_source_observations observation ON observation.household_id = reader.household_id
      LEFT JOIN portfolio_watch_read_receipts receipt
        ON receipt.user_id = reader.user_id AND receipt.observation_id = observation.id
      WHERE observation.id = ?
    `,
      )
      .bind(accessSubject, observationId)
      .first<{ readAt: string | null; version: number }>();
    if (current === null) throw new Error("watch_observation_not_found");
    if ((current.readAt !== null) !== input.read) {
      throw new Error("watch_read_state_changed");
    }
    return WatchReadReceiptSchema.parse({ observationId, ...current });
  }
}
