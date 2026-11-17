import {
  assessValuationFromShares,
  PurchaseReceiptSchema,
  valuationSharesKey,
} from "@keel/domain/position-purchases";
import {
  continuedPriceMetadata,
  ShareBasisSchema,
  SourcePriceMetadataSchema,
} from "@keel/domain/valuation-record";

/** Bounded write-side projection. GETs never refresh prices or accepted facts. */
export class D1PriceProxyRepository {
  constructor(private readonly db: D1Database) {}

  async refresh(subject: string) {
    const rows = await this.db
      .prepare(
        `
      WITH candidates AS MATERIALIZED (
        SELECT link.household_id,u.id user_id,link.position_id,review.id prior_id,
          review.receipt_json,link.source_position_id,metadata_head.current_quote_id quote_id,
          metadata_head.share_class_quote_id,metadata_head.share_basis_quote_id
        FROM users u JOIN households h ON h.owner_user_id=u.id
        CROSS JOIN holding_price_proxy_links link ON link.household_id=h.id
        JOIN holding_purchase_reviews review ON review.id=link.receipt_id
        JOIN json_each(review.receipt_json,'$.details.valuation.records') chosen
          ON json_extract(chosen.value,'$.id')=json_extract(review.receipt_json,'$.details.valuation.selected.recordId')
        JOIN holding_price_metadata_heads metadata_head ON metadata_head.source_position_id=link.source_position_id AND metadata_head.household_id=link.household_id
        WHERE u.access_subject=? AND (metadata_head.current_quote_id IS NOT json_extract(review.receipt_json,'$.details.valuation.calculation.quoteId')
            OR (json_extract(chosen.value,'$.shareClass') IS NULL AND metadata_head.share_class_quote_id IS NOT NULL AND metadata_head.share_class_quote_id IS NOT json_extract(chosen.value,'$.sourceContinuation.quoteId'))
            OR (json_extract(chosen.value,'$.shareBasis') IS NULL AND metadata_head.share_basis_quote_id IS NOT NULL AND metadata_head.share_basis_quote_id IS NOT COALESCE(
              json_extract(chosen.value,'$.sourceContinuation.shareBasisQuoteId'),json_extract(chosen.value,'$.sourceContinuation.quoteId'))))
          AND NOT EXISTS(SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id=link.position_id)
        ORDER BY link.position_id LIMIT 500
      )
      SELECT candidate.*,q.price_micros,q.price_date,q.share_class,q.basis_json,q.source_url,q.observed_at,
        CASE WHEN EXISTS(SELECT 1 FROM holding_positions source INDEXED BY holding_positions_household_id_idx
          WHERE source.household_id=candidate.household_id AND source.provider='tokenfolio' AND source.id=candidate.source_position_id)
          THEN 'Tokenfolio' ELSE q.source_label END source_label,
        application_head.snapshot_id,
        CASE WHEN class_quote.id IS NOT NULL OR basis_quote.id IS NOT NULL THEN json_object(
          'policy','accepted-source-continuation-v1','quoteId',class_quote.id,'shareBasisQuoteId',candidate.share_basis_quote_id,
          'shareClass',class_quote.share_class,'shareBasis',json(CASE WHEN candidate.share_basis_quote_id IS candidate.share_class_quote_id THEN class_quote.basis_json ELSE basis_quote.basis_json END)) END source_metadata_json
      FROM candidates candidate
      JOIN holding_price_quotes q ON q.id=candidate.quote_id AND q.household_id=candidate.household_id
      JOIN holding_import_application_heads application_head ON application_head.position_id=candidate.position_id
      LEFT JOIN holding_price_quotes class_quote ON class_quote.id=candidate.share_class_quote_id
      LEFT JOIN holding_price_quotes basis_quote ON basis_quote.id=(CASE WHEN candidate.share_basis_quote_id IS NOT candidate.share_class_quote_id THEN candidate.share_basis_quote_id END)
      ORDER BY candidate.position_id
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
        price_date: string | null;
        share_class: string | null;
        basis_json: string | null;
        source_label: string;
        source_url: string | null;
        observed_at: string;
        snapshot_id: string;
        source_metadata_json: string | null;
        share_class_quote_id: string | null;
        share_basis_quote_id: string | null;
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
        effectiveDate: row.price_date ?? old.effectiveDate,
        shareClass: row.share_class,
        shareBasis: row.basis_json
          ? ShareBasisSchema.parse(JSON.parse(row.basis_json))
          : null,
        sourceLabel: row.source_label,
        sourceUrl: row.source_url,
        sourceEvidenceId: row.quote_id,
        sourceCapturedAt: row.observed_at,
      };
      record.sourceContinuation = continuedPriceMetadata(
        old,
        record,
        row.source_metadata_json
          ? SourcePriceMetadataSchema.parse(
              JSON.parse(row.source_metadata_json),
            )
          : undefined,
      );
      const result = assessValuationFromShares(prior.details, record);
      // Explicitly incompatible bases/rights still preserve the last estimate.
      // Missing metadata retains the reviewed assumptions in a separate receipt
      // field, while the source's reported date/class/basis stay unknown.
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
          AND EXISTS(SELECT 1 FROM holding_price_metadata_heads WHERE household_id=? AND source_position_id=? AND current_quote_id=? AND share_class_quote_id IS ? AND share_basis_quote_id IS ?)
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
            row.household_id,
            old.priceSourcePositionId!,
            row.quote_id,
            row.share_class_quote_id,
            row.share_basis_quote_id,
          ),
      );
    }
    const results = statements.length ? await this.db.batch(statements) : [];
    return { recalculated: results.filter((r) => r.meta.changes > 0).length };
  }
}
