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
      WITH context AS MATERIALIZED (
        SELECT u.id user_id,h.id household_id FROM users u JOIN households h ON h.owner_user_id=u.id WHERE u.access_subject=?
      ), source_ids AS MATERIALIZED (
        SELECT DISTINCT link.source_position_id,link.household_id FROM context
        CROSS JOIN holding_price_proxy_links link ON link.household_id=context.household_id
      ), source_prices AS MATERIALIZED (
        SELECT head.* FROM source_ids
        CROSS JOIN holding_price_current_quotes head ON head.household_id=source_ids.household_id AND head.source_position_id=source_ids.source_position_id
      ), candidates AS MATERIALIZED (
        SELECT link.household_id,context.user_id,link.position_id,review.id prior_id,
          review.receipt_json,link.source_position_id,price_head.quote_id,
          price_head.share_class_quote_id,price_head.share_basis_quote_id,price_head.dated_quote_id,price_head.observation_id
        FROM context
        CROSS JOIN holding_price_proxy_links link ON link.household_id=context.household_id
        JOIN holding_purchase_reviews review ON review.id=link.receipt_id
        JOIN json_each(review.receipt_json,'$.details.valuation.records') chosen
          ON json_extract(chosen.value,'$.id')=json_extract(review.receipt_json,'$.details.valuation.selected.recordId')
        JOIN source_prices price_head ON price_head.source_position_id=link.source_position_id AND price_head.household_id=link.household_id
        WHERE (price_head.quote_id IS NOT json_extract(review.receipt_json,'$.details.valuation.calculation.quoteId')
            OR (json_extract(chosen.value,'$.shareClass') IS NULL AND price_head.share_class_quote_id IS NOT NULL AND price_head.share_class_quote_id IS NOT json_extract(chosen.value,'$.sourceContinuation.quoteId'))
            OR (json_extract(chosen.value,'$.shareBasis') IS NULL AND price_head.share_basis_quote_id IS NOT NULL AND price_head.share_basis_quote_id IS NOT COALESCE(
              json_extract(chosen.value,'$.sourceContinuation.shareBasisQuoteId'),json_extract(chosen.value,'$.sourceContinuation.quoteId'))))
          AND NOT EXISTS(SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id=link.position_id)
        ORDER BY link.position_id LIMIT 500
      ), sources AS MATERIALIZED (
        SELECT source_key.source_position_id,q.price_micros,q.price_date,q.share_class,q.basis_json,q.source_url,q.observed_at,
          CASE source.provider WHEN 'tokenfolio' THEN 'Tokenfolio' ELSE q.source_label END source_label,
          CASE WHEN class_quote.id IS NOT NULL OR basis_quote.id IS NOT NULL THEN json_object(
            'policy','accepted-source-continuation-v1','quoteId',class_quote.id,'shareBasisQuoteId',source_key.share_basis_quote_id,
            'shareClass',class_quote.share_class,'shareBasis',json(CASE WHEN source_key.share_basis_quote_id IS source_key.share_class_quote_id THEN class_quote.basis_json ELSE basis_quote.basis_json END)) END source_metadata_json
        FROM (SELECT DISTINCT source_position_id,household_id,quote_id,share_class_quote_id,share_basis_quote_id FROM candidates) source_key
        JOIN holding_price_quotes q ON q.id=source_key.quote_id AND q.household_id=source_key.household_id
        JOIN holding_positions source ON source.id=source_key.source_position_id
        LEFT JOIN holding_price_quotes class_quote ON class_quote.id=source_key.share_class_quote_id
        LEFT JOIN holding_price_quotes basis_quote ON basis_quote.id=(CASE WHEN source_key.share_basis_quote_id IS NOT source_key.share_class_quote_id THEN source_key.share_basis_quote_id END)
      )
      SELECT candidate.*,sources.*,application_head.snapshot_id
      FROM candidates candidate
      JOIN sources ON sources.source_position_id=candidate.source_position_id
      JOIN holding_import_application_heads application_head ON application_head.position_id=candidate.position_id
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
        dated_quote_id: string | null;
        observation_id: string;
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
          AND EXISTS(SELECT 1 FROM holding_price_source_heads INDEXED BY holding_price_source_heads_version WHERE household_id=? AND source_position_id=? AND quote_id IS ? AND observation_id=?)
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
            row.dated_quote_id,
            row.observation_id,
          ),
      );
    }
    const results = statements.length ? await this.db.batch(statements) : [];
    return { recalculated: results.filter((r) => r.meta.changes > 0).length };
  }
}
