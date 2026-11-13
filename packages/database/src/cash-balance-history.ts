import {
  cashBalanceHistoryPage,
  CashBalanceHistoryCursorError,
} from "@keel/domain/cash-balance-history";

export class D1BrokerageCashHistoryRepository {
  constructor(private readonly db: D1Database) {}

  async history(
    subject: string,
    positionId: string,
    limit: number,
    after?: string,
    revision?: string,
  ) {
    const owned = await this.db
      .prepare(
        `SELECT p.id, p.household_id, s.currency, s.id AS snapshot_id FROM holding_positions p
      JOIN households h ON h.id=p.household_id JOIN users u ON u.id=h.owner_user_id
      JOIN holding_import_application_heads head ON head.position_id=p.id
      JOIN holding_position_snapshots s ON s.id=head.snapshot_id
      WHERE p.id=? AND u.access_subject=? AND lower(trim(s.instrument_type))='cash'`,
      )
      .bind(positionId, subject)
      .first<{
        id: string;
        household_id: string;
        currency: string;
        snapshot_id: string;
      }>();
    if (!owned) return null;
    const result = await this.db
      .prepare(
        `WITH RECURSIVE family(id) AS (
      SELECT ? UNION
      SELECT head.prior_position_id
      FROM family f CROSS JOIN public_holding_source_heads head
        ON head.position_id=f.id
      WHERE head.household_id=? AND head.decision='same'
      UNION SELECT head.position_id
      FROM family f CROSS JOIN public_holding_source_heads head INDEXED BY public_source_head_prior
        ON head.prior_position_id=f.id
      WHERE head.household_id=? AND head.decision='same'
    ) SELECT a.id, s.id AS snapshotId, a.applied_at AS acceptedAt, s.observed_at AS observedAt,
        CASE WHEN s.unrealized_value_state='reported' THEN s.unrealized_value_minor ELSE NULL END AS valueMinor
      FROM family f CROSS JOIN holding_import_applications a INDEXED BY holding_import_applications_position_applied_idx ON a.position_id=f.id
      CROSS JOIN holding_position_snapshots s ON s.id=a.snapshot_id
      WHERE a.household_id=? AND lower(trim(s.instrument_type))='cash' AND s.currency=?
      ORDER BY a.applied_at, s.observed_at, a.id`,
      )
      .bind(
        positionId,
        owned.household_id,
        owned.household_id,
        owned.household_id,
        owned.currency,
      )
      .all<{
        id: string;
        acceptedAt: string;
        observedAt: string;
        valueMinor: number | null;
        snapshotId: string;
      }>();
    const anchor = result.results
      .filter((row) => row.snapshotId === (revision ?? owned.snapshot_id))
      .at(-1);
    if (!anchor)
      throw new CashBalanceHistoryCursorError(
        "The requested balance revision is unavailable.",
      );
    return cashBalanceHistoryPage(result.results, limit, after, anchor.id);
  }
}
