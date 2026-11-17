-- Source-owned metadata survives missed propagation and later incomplete quotes.
-- Raw quotes and all financial/review history remain unchanged.
CREATE TABLE holding_price_metadata_heads (
  source_position_id TEXT PRIMARY KEY REFERENCES holding_positions(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  current_quote_id TEXT NOT NULL REFERENCES holding_price_quotes(id),
  share_class_quote_id TEXT REFERENCES holding_price_quotes(id),
  share_basis_quote_id TEXT REFERENCES holding_price_quotes(id)
) WITHOUT ROWID;
-- Cover the version comparison and current-quote projection without a second
-- table lookup per source. Producer cost includes maintenance of this index.
DROP INDEX holding_price_source_heads_household;
CREATE INDEX holding_price_source_heads_version ON holding_price_source_heads(household_id,source_position_id,quote_id,observation_id);
-- Replay only metadata eligibility, in the source's accepted ordering. The
-- running dated/observation watermarks mirror the existing quote-head policy;
-- late historical and future-dated quotes cannot supersede usable metadata.
WITH history AS MATERIALIZED (
  SELECT q.*,
    observed_at||char(0)||accepted_at||char(0)||id observation_order,
    COUNT(*) OVER(PARTITION BY household_id,source_position_id,accepted_at) accepted_time_count,
    MAX(CASE WHEN price_date<=substr(accepted_at,1,10) AND share_class IS NOT NULL THEN price_date END)
      OVER source_history prior_date,
    MAX(observed_at||char(0)||accepted_at||char(0)||id) OVER source_history prior_observation
  FROM holding_price_quotes q
  WINDOW source_history AS (PARTITION BY household_id,source_position_id ORDER BY accepted_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
), eligible AS MATERIALIZED (
  SELECT * FROM history WHERE (price_date IS NULL OR price_date<=substr(accepted_at,1,10)) AND (
    id IN (SELECT quote_id FROM holding_price_source_heads WHERE source_position_id=history.source_position_id AND household_id=history.household_id
      UNION ALL SELECT quote_id FROM holding_price_current_quotes WHERE source_position_id=history.source_position_id AND household_id=history.household_id)
    OR (accepted_time_count=1 AND ((price_date IS NOT NULL AND share_class IS NOT NULL AND
      (prior_date IS NULL OR price_date>prior_date OR (price_date=prior_date AND review_id IS NOT NULL)))
    OR (observation_order>COALESCE(prior_observation,'') AND
      (price_date IS NULL OR prior_date IS NULL OR price_date>=prior_date))))
  )
), ranked AS (
  SELECT household_id,source_position_id,id,kind,
    ROW_NUMBER() OVER(PARTITION BY household_id,source_position_id,kind ORDER BY accepted_at DESC,id DESC) rank
  FROM eligible CROSS JOIN (SELECT 'class' kind UNION ALL SELECT 'basis')
  WHERE (kind='class' AND share_class IS NOT NULL) OR (kind='basis' AND basis_json IS NOT NULL)
), anchors AS (
  SELECT source_position_id,household_id,MAX(CASE WHEN kind='class' THEN id END) class_id,MAX(CASE WHEN kind='basis' THEN id END) basis_id
  FROM ranked WHERE rank=1 GROUP BY household_id,source_position_id
)
INSERT INTO holding_price_metadata_heads(source_position_id,household_id,current_quote_id,share_class_quote_id,share_basis_quote_id)
SELECT current.source_position_id,current.household_id,current.quote_id,anchors.class_id,anchors.basis_id
FROM holding_price_current_quotes current LEFT JOIN anchors ON anchors.household_id=current.household_id AND anchors.source_position_id=current.source_position_id;

DROP TRIGGER holding_price_quote_head;
CREATE TRIGGER holding_price_quote_head AFTER INSERT ON holding_price_quotes BEGIN
  INSERT INTO holding_price_source_heads(source_position_id,household_id,quote_id,observation_id)
  VALUES(NEW.source_position_id,NEW.household_id,(CASE WHEN NEW.price_date IS NOT NULL AND NEW.price_date<=substr(NEW.accepted_at,1,10) AND NEW.share_class IS NOT NULL THEN NEW.id END),NEW.id)
  ON CONFLICT(source_position_id) DO UPDATE SET
    observation_id=(CASE WHEN (NEW.observed_at,NEW.accepted_at,NEW.id) >
      (SELECT observed_at,accepted_at,id FROM holding_price_quotes WHERE id=observation_id) THEN NEW.id ELSE observation_id END),
    quote_id=(CASE WHEN NEW.price_date IS NOT NULL AND NEW.price_date<=substr(NEW.accepted_at,1,10) AND NEW.share_class IS NOT NULL AND (
      quote_id IS NULL OR NEW.price_date > (SELECT price_date FROM holding_price_quotes WHERE id=quote_id)
      OR (NEW.price_date=(SELECT price_date FROM holding_price_quotes WHERE id=quote_id)
        AND NEW.review_id IS NOT NULL
        AND (NEW.accepted_at,NEW.id) > (SELECT accepted_at,id FROM holding_price_quotes WHERE id=quote_id)))
      THEN NEW.id ELSE quote_id END);
  INSERT INTO holding_price_metadata_heads(source_position_id,household_id,current_quote_id,share_class_quote_id,share_basis_quote_id)
  SELECT NEW.source_position_id,NEW.household_id,current.quote_id,
    CASE WHEN current.quote_id=NEW.id AND (NEW.price_date IS NULL OR NEW.price_date<=substr(NEW.accepted_at,1,10)) AND NEW.share_class IS NOT NULL THEN NEW.id END,
    CASE WHEN current.quote_id=NEW.id AND (NEW.price_date IS NULL OR NEW.price_date<=substr(NEW.accepted_at,1,10)) AND NEW.basis_json IS NOT NULL THEN NEW.id END
  FROM holding_price_current_quotes current WHERE current.source_position_id=NEW.source_position_id AND current.household_id=NEW.household_id
  ON CONFLICT(source_position_id) DO UPDATE SET
    current_quote_id=excluded.current_quote_id,
    share_class_quote_id=COALESCE(excluded.share_class_quote_id,share_class_quote_id),
    share_basis_quote_id=COALESCE(excluded.share_basis_quote_id,share_basis_quote_id)
  WHERE current_quote_id IS NOT excluded.current_quote_id
    OR share_class_quote_id IS NOT COALESCE(excluded.share_class_quote_id,share_class_quote_id)
    OR share_basis_quote_id IS NOT COALESCE(excluded.share_basis_quote_id,share_basis_quote_id);
END;

DROP TRIGGER holding_price_continuation_guard;
CREATE TRIGGER holding_price_continuation_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT,'price continuation provenance mismatch') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json,'$.details.valuation.records') current
    WHERE json_extract(current.value,'$.id')=json_extract(NEW.receipt_json,'$.details.valuation.selected.recordId')
      AND json_extract(current.value,'$.sourceContinuation') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM holding_purchase_reviews prior
        JOIN json_each(prior.receipt_json,'$.details.valuation.records') old
          ON json_extract(old.value,'$.id')=json_extract(current.value,'$.id')
        JOIN holding_price_quotes anchor ON anchor.id=json_extract(current.value,'$.sourceContinuation.quoteId')
        LEFT JOIN holding_price_quotes basis_anchor ON basis_anchor.id=(CASE WHEN COALESCE(json_extract(current.value,'$.sourceContinuation.shareBasisQuoteId'),anchor.id)<>anchor.id THEN json_extract(current.value,'$.sourceContinuation.shareBasisQuoteId') END)
        WHERE prior.id=NEW.prior_id AND prior.position_id=NEW.position_id AND prior.household_id=NEW.household_id
          AND json_extract(old.value,'$.followSource')=1 AND json_extract(current.value,'$.followSource')=1
          AND json_extract(old.value,'$.priceSourcePositionId')=json_extract(current.value,'$.priceSourcePositionId')
          AND anchor.household_id=NEW.household_id AND anchor.source_position_id=json_extract(current.value,'$.priceSourcePositionId')
          AND COALESCE(json_extract(current.value,'$.sourceContinuation.shareBasisQuoteId'),anchor.id)=COALESCE(basis_anchor.id,anchor.id)
          AND anchor.share_class IS NOT NULL AND (CASE WHEN basis_anchor.id IS NULL THEN anchor.basis_json ELSE basis_anchor.basis_json END) IS NOT NULL
          AND COALESCE(basis_anchor.household_id,anchor.household_id)=NEW.household_id AND COALESCE(basis_anchor.source_position_id,anchor.source_position_id)=anchor.source_position_id
          AND json_extract(current.value,'$.sourceContinuation.policy')='accepted-source-continuation-v1'
          AND (current.value IS old.value OR EXISTS (
            SELECT 1 FROM holding_price_metadata_heads source
            WHERE source.source_position_id=anchor.source_position_id AND source.household_id=NEW.household_id
              AND COALESCE(source.share_class_quote_id,CASE WHEN json_extract(old.value,'$.shareClass') IS NOT NULL
                THEN json_extract(old.value,'$.sourceEvidenceId') ELSE json_extract(old.value,'$.sourceContinuation.quoteId') END)=anchor.id
              AND COALESCE(source.share_basis_quote_id,CASE WHEN json_extract(old.value,'$.shareBasis') IS NOT NULL
                THEN json_extract(old.value,'$.sourceEvidenceId') ELSE COALESCE(json_extract(old.value,'$.sourceContinuation.shareBasisQuoteId'),json_extract(old.value,'$.sourceContinuation.quoteId')) END)=COALESCE(basis_anchor.id,anchor.id)
          ))
          AND anchor.share_class=json_extract(current.value,'$.sourceContinuation.shareClass')
          AND json_extract(CASE WHEN basis_anchor.id IS NULL THEN anchor.basis_json ELSE basis_anchor.basis_json END,'$.key')=json_extract(current.value,'$.sourceContinuation.shareBasis.key')
          AND json_extract(CASE WHEN basis_anchor.id IS NULL THEN anchor.basis_json ELSE basis_anchor.basis_json END,'$.unitsPerOriginal')=json_extract(current.value,'$.sourceContinuation.shareBasis.unitsPerOriginal')
      )
  );
END;

-- Supply the household key for the covering version lookup while retaining
-- the complete existing raw-price and accepted-import provenance checks.
DROP TRIGGER holding_selected_valuation_guard;
CREATE TRIGGER holding_selected_valuation_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase price evidence stale') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.valuation.records') record
    WHERE json_extract(record.value,'$.id')=json_extract(NEW.receipt_json,'$.details.valuation.selected.recordId')
      AND json_extract(record.value,'$.sourceEvidenceId') IS NOT NULL
      AND json_extract(NEW.receipt_json,'$.details.valuation') IS NOT
        (SELECT json_extract(prior.receipt_json,'$.details.valuation') FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id)
      AND NOT EXISTS (
        SELECT 1 FROM holding_price_current_quotes head JOIN holding_price_quotes q ON q.source_position_id=head.source_position_id AND q.id=head.quote_id
        WHERE q.id=json_extract(record.value,'$.sourceEvidenceId') AND q.household_id=NEW.household_id AND head.household_id=NEW.household_id
          AND q.source_position_id=json_extract(record.value,'$.sourcePositionId')
          AND q.price_micros=json_extract(record.value,'$.priceMicros')
          AND q.price_date IS json_extract(record.value,'$.priceDate')
          AND q.share_class IS json_extract(record.value,'$.shareClass')
          AND q.basis_json IS json_extract(record.value,'$.shareBasis')
          AND q.observed_at=json_extract(record.value,'$.sourceCapturedAt')
          AND (q.source_position_id=NEW.position_id OR json_extract(record.value,'$.origin')='proxy'
            OR EXISTS(SELECT 1 FROM holding_position_link_heads l WHERE l.source_position_id=q.source_position_id
              AND l.target_position_id=NEW.position_id AND l.state='linked' AND l.use_source_value=1))
      )
      AND NOT EXISTS (
        SELECT 1 FROM holding_import_share_prices price
        JOIN holding_import_applications application ON application.import_row_id=price.import_row_id
        JOIN holding_import_rows row ON row.id=price.import_row_id
        JOIN holding_imports source ON source.id=row.import_id
        WHERE price.import_row_id=json_extract(record.value,'$.sourceEvidenceId')
          AND price.household_id=NEW.household_id
          AND application.position_id=json_extract(record.value,'$.sourcePositionId')
          AND source.created_at=json_extract(record.value,'$.sourceCapturedAt')
          AND json_extract(price.evidence_json,'$.markMicros')=json_extract(record.value,'$.priceMicros')
          AND json_extract(price.evidence_json,'$.markDate') IS json_extract(record.value,'$.priceDate')
          AND json_extract(price.evidence_json,'$.shareClass') IS json_extract(record.value,'$.shareClass')
          AND (application.position_id=NEW.position_id OR
            (json_extract(record.value,'$.origin')='proxy' AND json_extract(record.value,'$.totalMinor') IS NULL))
          AND application.id=(SELECT application_id FROM holding_import_application_heads WHERE position_id=application.position_id)
      )
  );
END;
