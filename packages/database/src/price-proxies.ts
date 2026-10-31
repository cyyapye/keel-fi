import {
  assessValuationFromShares,
  PurchaseReceiptSchema,
  valuationSharesKey,
} from "@keel/domain/position-purchases";
import { ShareBasisSchema } from "@keel/domain/valuation-record";

/** Bounded write-side projection. GETs never refresh prices or accepted facts. */
export class D1PriceProxyRepository {
  constructor(private readonly db: D1Database) {}

  async refresh(subject: string) {
    const rows = await this.db
      .prepare(
        `
      SELECT link.household_id,u.id user_id,link.position_id,review.id prior_id,
        review.receipt_json,q.id quote_id,q.price_micros,q.price_date,q.share_class,
        q.basis_json,CASE source.provider WHEN 'tokenfolio' THEN 'Tokenfolio' ELSE q.source_label END source_label,q.source_url,q.observed_at,
        application_head.snapshot_id
      FROM users u JOIN households h ON h.owner_user_id=u.id
      CROSS JOIN holding_price_proxy_links link ON link.household_id=h.id
      JOIN holding_purchase_reviews review ON review.id=link.receipt_id
      JOIN holding_import_application_heads application_head ON application_head.position_id=link.position_id
      JOIN holding_positions source ON source.id=link.source_position_id
      JOIN holding_price_source_heads head ON head.source_position_id=link.source_position_id
      JOIN holding_price_quotes q ON q.id=head.quote_id AND q.household_id=link.household_id
      WHERE u.access_subject=?
        AND q.id IS NOT json_extract(review.receipt_json,'$.details.valuation.calculation.quoteId')
        AND NOT EXISTS(SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id=link.position_id)
      ORDER BY link.position_id LIMIT 500
    `,
      )
      .bind(subject)
      .all<{
        household_id: string;
        user_id: string;
        position_id: string;
        prior_id: string;
        receipt_json: string;
        quote_id: string;
        price_micros: number;
        price_date: string;
        share_class: string;
        basis_json: string | null;
        source_label: string;
        source_url: string | null;
        observed_at: string;
        snapshot_id: string;
      }>();
    const acceptedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const row of rows.results) {
      const prior = PurchaseReceiptSchema.parse(JSON.parse(row.receipt_json));
      const state = prior.details.valuation!;
      const selected = state.selected!;
      const old = state.records.find((r) => r.id === selected.recordId)!;
      if (!old.followSource) continue;
      const record = {
        ...old,
        priceMicros: row.price_micros,
        priceDate: row.price_date,
        effectiveDate: row.price_date,
        shareClass: row.share_class,
        shareBasis: row.basis_json
          ? ShareBasisSchema.parse(JSON.parse(row.basis_json))
          : null,
        sourceLabel: row.source_label,
        sourceUrl: row.source_url,
        sourceEvidenceId: row.quote_id,
        sourceCapturedAt: row.observed_at,
      };
      const result = assessValuationFromShares(prior.details, record);
      // Missing dates, basis changes or incompatible rights preserve the last
      // valid estimate. The source-head mismatch is exposed as stale by reads.
      if (!result.ok) continue;
      const receipt = PurchaseReceiptSchema.parse({
        ...prior,
        id: crypto.randomUUID(),
        snapshotId: row.snapshot_id,
        acceptedAt,
        details: {
          ...prior.details,
          investmentSnapshotId:
            prior.details.investmentSnapshotId ?? prior.snapshotId,
          valuation: {
            ...state,
            snapshotId: row.snapshot_id,
            records: state.records.map((r) =>
              r.id === record.id ? record : r,
            ),
            selected: {
              ...selected,
              sharesKey: valuationSharesKey(prior.details),
            },
            calculation: {
              policy: "linked-price-proxy-v1",
              quoteId: row.quote_id,
              quantityReceiptId:
                state.calculation?.quantityReceiptId ?? prior.id,
              ...result.calculation,
            },
          },
        },
      });
      // Compare-and-swap within the write transaction: a racing manual switch
      // wins. The quote guard also rejects an obsolete source revision.
      statements.push(
        this.db
          .prepare(
            `
        INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(
          SELECT 1 FROM holding_purchase_heads WHERE position_id=? AND review_id=?)
          AND EXISTS(SELECT 1 FROM holding_price_source_heads WHERE source_position_id=? AND quote_id=?)
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
            acceptedAt,
            row.position_id,
            prior.id,
            old.priceSourcePositionId!,
            row.quote_id,
          ),
      );
    }
    const results = statements.length ? await this.db.batch(statements) : [];
    return { recalculated: results.filter((r) => r.meta.changes > 0).length };
  }
}
