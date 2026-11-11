import {
  PurchaseReceiptSchema,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";

/** Reuse accepted source balances under the recorded GP selection. No GET writes. */
export class D1GpReportedTotalRepository {
  constructor(private readonly db: D1Database) {}

  async refresh(subject: string) {
    const rows = await this.db
      .prepare(
        `SELECT h.household_id,u.id user_id,h.position_id,h.review_id,review.receipt_json,
          target.snapshot_id,source.id source_position_id,source.provider,
          balance.id source_snapshot_id,source_head.application_id source_application_id,
          balance.unrealized_value_minor,balance.observed_at,link.review_id link_review_id
        FROM users u JOIN households household ON household.owner_user_id=u.id
        CROSS JOIN holding_purchase_heads h ON h.household_id=household.id
        JOIN holding_purchase_reviews review ON review.id=h.review_id
        JOIN holding_import_application_heads target ON target.position_id=h.position_id
        JOIN holding_position_link_heads link ON link.household_id=h.household_id
          AND link.target_position_id=h.position_id AND link.state='linked' AND link.use_source_value=1
        JOIN holding_positions source ON source.id=link.source_position_id
          AND source.household_id=h.household_id AND source.provider IN ('angellist','tokenfolio','sydecar','wefunder')
        JOIN holding_import_application_heads source_head ON source_head.position_id=source.id
        JOIN holding_position_snapshots balance ON balance.id=source_head.snapshot_id
        JOIN json_each(review.receipt_json,'$.details.valuation.records') record
          ON json_extract(record.value,'$.id')=json_extract(review.receipt_json,'$.details.valuation.selected.recordId')
        WHERE u.access_subject=?
          AND json_extract(review.receipt_json,'$.details.valuation.selected.method')='total'
          AND json_extract(record.value,'$.origin')='gp'
          AND balance.currency='USD' AND balance.provider_status='live'
          AND balance.unrealized_value_state='reported'
          AND balance.unrealized_value_minor IS NOT json_extract(record.value,'$.totalMinor')
          AND balance.created_at>review.accepted_at
          AND substr(balance.observed_at,1,10)>=json_extract(record.value,'$.effectiveDate')
          AND substr(balance.observed_at,1,10)<=substr(?,1,10)
          AND NOT EXISTS(SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id IN (h.position_id,source.id))
          AND COALESCE((SELECT json_extract(r.state_json,'$.participationStatus') FROM holding_investment_reviews r
            WHERE r.household_id=h.household_id AND r.position_id=source.id ORDER BY r.version DESC LIMIT 1),'current') NOT IN ('historical','cancelled')
          AND COALESCE((SELECT json_extract(r.state_json,'$.participationStatus') FROM holding_investment_reviews r
            WHERE r.household_id=h.household_id AND r.position_id=h.position_id ORDER BY r.version DESC LIMIT 1),'current') NOT IN ('historical','cancelled')
        ORDER BY h.position_id LIMIT 500`,
      )
      .bind(subject, new Date().toISOString())
      .all<{
        household_id: string;
        user_id: string;
        position_id: string;
        review_id: string;
        receipt_json: string;
        snapshot_id: string;
        source_position_id: string;
        provider: string;
        source_snapshot_id: string;
        source_application_id: string;
        unrealized_value_minor: number;
        observed_at: string;
        link_review_id: string;
      }>();
    const statements: D1PreparedStatement[] = [];
    for (const row of rows.results) {
      const raw: unknown = JSON.parse(row.receipt_json);
      PurchaseReceiptSchema.parse(raw);
      // Keep the accepted serialization, including legacy key order/defaults,
      // so the native preservation guard compares unchanged financial inputs.
      const prior = raw as PurchaseReceipt;
      const state = prior.details.valuation!;
      const receipt: PurchaseReceipt = {
        ...prior,
        id: crypto.randomUUID(),
        snapshotId: row.snapshot_id,
        acceptedAt: new Date().toISOString(),
        details: {
          ...prior.details,
          // An accepted balance refresh does not re-confirm investment inputs.
          investmentSnapshotId:
            prior.details.investmentSnapshotId ?? prior.snapshotId,
          valuation: {
            ...state,
            snapshotId: row.snapshot_id,
            reportedTotalRefresh: {
              policy: "accepted-gp-total-v1",
              priorReceiptId: prior.id,
              sourcePositionId: row.source_position_id,
              sourceSnapshotId: row.source_snapshot_id,
              sourceApplicationId: row.source_application_id,
              linkReviewId: row.link_review_id,
            },
            records: state.records.map((record) =>
              record.id !== state.selected!.recordId
                ? record
                : {
                    ...record,
                    totalMinor: row.unrealized_value_minor,
                    // This is the source report's observation date, not its share-price date.
                    effectiveDate: row.observed_at.slice(0, 10),
                    carryStatus: "unknown",
                    sourceLabel:
                      row.provider === "angellist"
                        ? "AngelList"
                        : row.provider === "tokenfolio"
                          ? "Tokenfolio"
                          : row.provider === "sydecar"
                            ? "Sydecar"
                            : "Wefunder",
                    sourceUrl: null,
                    // The new total does not adopt or re-date the retained per-share quote.
                    sourceEvidenceId: null,
                    sourcePositionId: null,
                    sourceCapturedAt: null,
                  },
            ),
          },
        },
      };
      PurchaseReceiptSchema.parse(receipt);
      statements.push(
        this.db
          .prepare(
            `
        INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM holding_purchase_heads WHERE position_id=? AND review_id=?)
          AND EXISTS(SELECT 1 FROM holding_import_application_heads WHERE position_id=? AND application_id=?)
          AND EXISTS(SELECT 1 FROM holding_position_link_heads WHERE target_position_id=? AND review_id=? AND state='linked' AND use_source_value=1)
      `,
          )
          .bind(
            receipt.id,
            row.household_id,
            row.position_id,
            row.snapshot_id,
            prior.id,
            JSON.stringify(receipt),
            row.user_id,
            receipt.acceptedAt,
            row.position_id,
            prior.id,
            row.source_position_id,
            row.source_application_id,
            row.position_id,
            row.link_review_id,
          ),
      );
    }
    const results = statements.length ? await this.db.batch(statements) : [];
    return { refreshed: results.filter((r) => r.meta.changes > 0).length };
  }
}
