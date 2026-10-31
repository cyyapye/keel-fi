-- Exact latest/prior order projected at acceptance. Price propagation and its
-- integrity guard never sort a position's application history in a row loop.
CREATE TABLE holding_import_application_heads (
  position_id TEXT PRIMARY KEY REFERENCES holding_positions(id),
  application_id TEXT NOT NULL REFERENCES holding_import_applications(id),
  snapshot_id TEXT NOT NULL REFERENCES holding_position_snapshots(id),
  applied_at TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE TRIGGER holding_import_application_head AFTER INSERT ON holding_import_applications BEGIN
  INSERT INTO holding_import_application_heads(position_id,application_id,snapshot_id,applied_at,observed_at)
  SELECT NEW.position_id,NEW.id,NEW.snapshot_id,NEW.applied_at,s.observed_at FROM holding_position_snapshots s WHERE s.id=NEW.snapshot_id
  ON CONFLICT(position_id) DO UPDATE SET application_id=excluded.application_id,snapshot_id=excluded.snapshot_id,applied_at=excluded.applied_at,observed_at=excluded.observed_at
    WHERE (excluded.applied_at,excluded.observed_at,excluded.application_id)>(applied_at,observed_at,application_id);
END;
INSERT INTO holding_import_application_heads(position_id,application_id,snapshot_id,applied_at,observed_at)
SELECT position_id,id,snapshot_id,applied_at,observed_at FROM (
  SELECT a.position_id,a.id,a.snapshot_id,a.applied_at,s.observed_at,
    ROW_NUMBER() OVER(PARTITION BY a.position_id ORDER BY a.applied_at DESC,s.observed_at DESC,a.id DESC) rank
  FROM holding_import_applications a JOIN holding_position_snapshots s ON s.id=a.snapshot_id
) WHERE rank=1;
-- Accepted quotes are distinct from reported position balances. The source key
-- is the stable accepted provider position, not a snapshot or import row.
CREATE TABLE holding_price_quotes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  source_position_id TEXT NOT NULL REFERENCES holding_positions(id),
  import_row_id TEXT REFERENCES holding_import_rows(id),
  review_id TEXT REFERENCES holding_purchase_reviews(id),
  price_micros INTEGER NOT NULL CHECK(price_micros > 0 AND price_micros <= 1000000000000),
  price_date TEXT,
  share_class TEXT,
  basis_json TEXT CHECK(basis_json IS NULL OR json_valid(basis_json)),
  source_label TEXT NOT NULL,
  source_url TEXT,
  observed_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  decision_policy TEXT NOT NULL CHECK(decision_policy IN ('accepted-import-price-v1','reviewed-price-v1')),
  CHECK((import_row_id IS NULL) <> (review_id IS NULL))
);
CREATE INDEX holding_price_quotes_source_history ON holding_price_quotes(household_id,source_position_id,price_date DESC,accepted_at DESC,id DESC);
CREATE TABLE holding_price_source_heads (
  source_position_id TEXT PRIMARY KEY REFERENCES holding_positions(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  quote_id TEXT REFERENCES holding_price_quotes(id),
  observation_id TEXT NOT NULL REFERENCES holding_price_quotes(id)
);
CREATE INDEX holding_price_source_heads_household ON holding_price_source_heads(household_id,source_position_id);
CREATE TRIGGER holding_price_quote_scope BEFORE INSERT ON holding_price_quotes BEGIN
  SELECT RAISE(ABORT,'price quote scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p WHERE p.id=NEW.source_position_id AND p.household_id=NEW.household_id AND p.currency='USD'
  );
END;
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
END;
CREATE TRIGGER holding_price_quotes_no_update BEFORE UPDATE ON holding_price_quotes BEGIN SELECT RAISE(ABORT,'price quotes are immutable'); END;
CREATE TRIGGER holding_price_quotes_no_delete BEFORE DELETE ON holding_price_quotes BEGIN SELECT RAISE(ABORT,'price quotes are immutable'); END;
CREATE TRIGGER holding_import_accepted_price AFTER INSERT ON holding_import_applications BEGIN
  INSERT OR IGNORE INTO holding_price_quotes(id,household_id,source_position_id,import_row_id,review_id,price_micros,price_date,share_class,basis_json,source_label,source_url,observed_at,accepted_at,decision_policy)
SELECT 'import:'||e.import_row_id,e.household_id,a.position_id,e.import_row_id,NULL,
  json_extract(e.evidence_json,'$.markMicros'),json_extract(e.evidence_json,'$.markDate'),
  json_extract(e.evidence_json,'$.shareClass'),json_extract(e.evidence_json,'$.shareBasis'),
  (CASE i.provider WHEN 'tokenfolio' THEN 'Tokenfolio' WHEN 'sydecar' THEN 'Sydecar' ELSE i.provider END),
  NULL,i.created_at,a.applied_at,'accepted-import-price-v1'
FROM holding_import_share_prices e JOIN holding_import_applications a ON a.import_row_id=e.import_row_id
JOIN holding_import_rows r ON r.id=e.import_row_id JOIN holding_imports i ON i.id=r.import_id
WHERE json_extract(e.evidence_json,'$.markMicros') > 0 AND a.id=NEW.id;
END;
CREATE TRIGGER holding_import_late_price AFTER INSERT ON holding_import_share_prices BEGIN
  INSERT OR IGNORE INTO holding_price_quotes(id,household_id,source_position_id,import_row_id,review_id,price_micros,price_date,share_class,basis_json,source_label,source_url,observed_at,accepted_at,decision_policy)
SELECT 'import:'||e.import_row_id,e.household_id,a.position_id,e.import_row_id,NULL,
  json_extract(e.evidence_json,'$.markMicros'),json_extract(e.evidence_json,'$.markDate'),
  json_extract(e.evidence_json,'$.shareClass'),json_extract(e.evidence_json,'$.shareBasis'),
  (CASE i.provider WHEN 'tokenfolio' THEN 'Tokenfolio' WHEN 'sydecar' THEN 'Sydecar' ELSE i.provider END),
  NULL,i.created_at,a.applied_at,'accepted-import-price-v1'
FROM holding_import_share_prices e JOIN holding_import_applications a ON a.import_row_id=e.import_row_id
JOIN holding_import_rows r ON r.id=e.import_row_id JOIN holding_imports i ON i.id=r.import_id
WHERE json_extract(e.evidence_json,'$.markMicros') > 0 AND e.import_row_id=NEW.import_row_id;
END;
CREATE TRIGGER holding_review_accepted_price AFTER INSERT ON holding_purchase_reviews BEGIN
  INSERT OR IGNORE INTO holding_price_quotes(id,household_id,source_position_id,import_row_id,review_id,price_micros,price_date,share_class,basis_json,source_label,source_url,observed_at,accepted_at,decision_policy)
SELECT 'review:'||review.id||':'||json_extract(record.value,'$.id'),review.household_id,
  COALESCE(json_extract(record.value,'$.priceSourcePositionId'),link.source_position_id,review.position_id),
  NULL,review.id,json_extract(record.value,'$.priceMicros'),json_extract(record.value,'$.priceDate'),
  json_extract(record.value,'$.shareClass'),json_extract(record.value,'$.shareBasis'),
  json_extract(record.value,'$.sourceLabel'),json_extract(record.value,'$.sourceUrl'),
  COALESCE(json_extract(record.value,'$.sourceCapturedAt'),review.accepted_at),review.accepted_at,'reviewed-price-v1'
FROM holding_purchase_reviews review
LEFT JOIN holding_position_link_heads link ON link.target_position_id=review.position_id AND link.state='linked' AND link.use_source_value=1,
json_each(review.receipt_json,'$.details.valuation.records') record
WHERE json_extract(record.value,'$.origin')='gp' AND json_extract(record.value,'$.priceMicros') > 0
  AND NOT EXISTS (SELECT 1 FROM holding_purchase_reviews prior,json_each(prior.receipt_json,'$.details.valuation.records') old
    WHERE prior.id=review.prior_id AND json_extract(old.value,'$.id')=json_extract(record.value,'$.id')
      AND json_extract(old.value,'$.priceMicros') IS json_extract(record.value,'$.priceMicros')
      AND json_extract(old.value,'$.priceDate') IS json_extract(record.value,'$.priceDate')
      AND json_extract(old.value,'$.shareClass') IS json_extract(record.value,'$.shareClass')
      AND json_extract(old.value,'$.shareBasis') IS json_extract(record.value,'$.shareBasis')) AND review.id=NEW.id;
END;
INSERT OR IGNORE INTO holding_price_quotes(id,household_id,source_position_id,import_row_id,review_id,price_micros,price_date,share_class,basis_json,source_label,source_url,observed_at,accepted_at,decision_policy)
SELECT 'import:'||e.import_row_id,e.household_id,a.position_id,e.import_row_id,NULL,
  json_extract(e.evidence_json,'$.markMicros'),json_extract(e.evidence_json,'$.markDate'),
  json_extract(e.evidence_json,'$.shareClass'),json_extract(e.evidence_json,'$.shareBasis'),
  (CASE i.provider WHEN 'tokenfolio' THEN 'Tokenfolio' WHEN 'sydecar' THEN 'Sydecar' ELSE i.provider END),
  NULL,i.created_at,a.applied_at,'accepted-import-price-v1'
FROM holding_import_share_prices e JOIN holding_import_applications a ON a.import_row_id=e.import_row_id
JOIN holding_import_rows r ON r.id=e.import_row_id JOIN holding_imports i ON i.id=r.import_id
WHERE json_extract(e.evidence_json,'$.markMicros') > 0 ORDER BY a.applied_at,a.id;
INSERT OR IGNORE INTO holding_price_quotes(id,household_id,source_position_id,import_row_id,review_id,price_micros,price_date,share_class,basis_json,source_label,source_url,observed_at,accepted_at,decision_policy)
SELECT 'review:'||review.id||':'||json_extract(record.value,'$.id'),review.household_id,
  COALESCE(json_extract(record.value,'$.priceSourcePositionId'),link.source_position_id,review.position_id),
  NULL,review.id,json_extract(record.value,'$.priceMicros'),json_extract(record.value,'$.priceDate'),
  json_extract(record.value,'$.shareClass'),json_extract(record.value,'$.shareBasis'),
  json_extract(record.value,'$.sourceLabel'),json_extract(record.value,'$.sourceUrl'),
  COALESCE(json_extract(record.value,'$.sourceCapturedAt'),review.accepted_at),review.accepted_at,'reviewed-price-v1'
FROM holding_purchase_reviews review
LEFT JOIN holding_position_link_heads link ON link.target_position_id=review.position_id AND link.state='linked' AND link.use_source_value=1,
json_each(review.receipt_json,'$.details.valuation.records') record
WHERE json_extract(record.value,'$.origin')='gp' AND json_extract(record.value,'$.priceMicros') > 0
  AND NOT EXISTS (SELECT 1 FROM holding_purchase_reviews prior,json_each(prior.receipt_json,'$.details.valuation.records') old
    WHERE prior.id=review.prior_id AND json_extract(old.value,'$.id')=json_extract(record.value,'$.id')
      AND json_extract(old.value,'$.priceMicros') IS json_extract(record.value,'$.priceMicros')
      AND json_extract(old.value,'$.priceDate') IS json_extract(record.value,'$.priceDate')
      AND json_extract(old.value,'$.shareClass') IS json_extract(record.value,'$.shareClass')
      AND json_extract(old.value,'$.shareBasis') IS json_extract(record.value,'$.shareBasis')) ORDER BY review.accepted_at,review.id;

-- A projection of explicitly selected relationships, bounded per household.
CREATE TABLE holding_price_proxy_links (
  position_id TEXT PRIMARY KEY REFERENCES holding_positions(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  source_position_id TEXT NOT NULL REFERENCES holding_positions(id),
  receipt_id TEXT NOT NULL REFERENCES holding_purchase_reviews(id)
);
CREATE INDEX holding_price_proxy_links_source ON holding_price_proxy_links(household_id,source_position_id,position_id);
CREATE TRIGGER holding_price_proxy_link AFTER INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT,'price proxy capacity exceeded') WHERE NOT EXISTS(SELECT 1 FROM holding_price_proxy_links WHERE position_id=NEW.position_id)
    AND EXISTS(SELECT 1 FROM json_each(NEW.receipt_json,'$.details.valuation.records') r
      WHERE json_extract(r.value,'$.id')=json_extract(NEW.receipt_json,'$.details.valuation.selected.recordId') AND json_extract(r.value,'$.followSource')=1)
    AND (SELECT COUNT(*) FROM holding_price_proxy_links WHERE household_id=NEW.household_id)>=500;
  DELETE FROM holding_price_proxy_links WHERE position_id=NEW.position_id AND NOT EXISTS(
    SELECT 1 FROM json_each(NEW.receipt_json,'$.details.valuation.records') r
    WHERE json_extract(r.value,'$.id')=json_extract(NEW.receipt_json,'$.details.valuation.selected.recordId') AND json_extract(r.value,'$.followSource')=1);
  INSERT INTO holding_price_proxy_links(position_id,household_id,source_position_id,receipt_id)
  SELECT NEW.position_id,NEW.household_id,json_extract(record.value,'$.priceSourcePositionId'),NEW.id
  FROM json_each(NEW.receipt_json,'$.details.valuation.records') record
  WHERE json_extract(record.value,'$.id')=json_extract(NEW.receipt_json,'$.details.valuation.selected.recordId')
    AND json_extract(record.value,'$.followSource')=1
  ON CONFLICT(position_id) DO UPDATE SET source_position_id=excluded.source_position_id,receipt_id=excluded.receipt_id;
END;
DROP TRIGGER holding_selected_valuation_guard;
CREATE TRIGGER holding_selected_valuation_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase price evidence stale') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.valuation.records') record
    WHERE json_extract(record.value,'$.id')=json_extract(NEW.receipt_json,'$.details.valuation.selected.recordId')
      AND json_extract(record.value,'$.sourceEvidenceId') IS NOT NULL
      AND json_extract(NEW.receipt_json,'$.details.valuation') IS NOT
        (SELECT json_extract(prior.receipt_json,'$.details.valuation') FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id)
      AND NOT EXISTS (
        SELECT 1 FROM holding_price_source_heads head JOIN holding_price_quotes q ON q.source_position_id=head.source_position_id AND q.id=head.quote_id
        WHERE q.id=json_extract(record.value,'$.sourceEvidenceId') AND q.household_id=NEW.household_id
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

-- Corrections can name only the position's own source or its reviewed link.
CREATE TRIGGER holding_review_price_source_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT,'purchase price evidence stale') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json,'$.details.valuation.records') r
    WHERE json_extract(r.value,'$.origin')='gp' AND json_extract(r.value,'$.priceSourcePositionId') IS NOT NULL
      AND json_extract(r.value,'$.priceSourcePositionId')<>NEW.position_id
      AND NOT EXISTS(SELECT 1 FROM holding_position_link_heads l WHERE l.source_position_id=json_extract(r.value,'$.priceSourcePositionId')
        AND l.target_position_id=NEW.position_id AND l.household_id=NEW.household_id AND l.state='linked' AND l.use_source_value=1)
      AND json_extract(NEW.receipt_json,'$.details.valuation.records') IS NOT
        (SELECT json_extract(prior.receipt_json,'$.details.valuation.records') FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id)
  );
END;

DROP TRIGGER holding_purchase_price_evidence_guard;
CREATE TRIGGER holding_purchase_price_evidence_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase price evidence stale') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.lots') lot
    WHERE json_extract(lot.value,'$.mark.sourceEvidenceId') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM holding_price_source_heads head JOIN holding_price_quotes q ON q.source_position_id=head.source_position_id AND q.id=COALESCE(head.quote_id,head.observation_id)
      WHERE q.id=json_extract(lot.value,'$.mark.sourceEvidenceId') AND q.household_id=NEW.household_id
        AND q.price_micros=json_extract(lot.value,'$.mark.priceMicros')
        AND (q.price_date IS NULL OR q.price_date=json_extract(lot.value,'$.mark.effectiveDate'))
        AND ((json_extract(lot.value,'$.mark.proxy.confirmed')=1 AND q.observed_at=json_extract(lot.value,'$.mark.proxy.capturedAt'))
          OR (json_extract(lot.value,'$.mark.proxy') IS NULL AND json_extract(lot.value,'$.mark.comparableConfirmed')=1))
    )
    AND NOT EXISTS (
      SELECT 1 FROM holding_import_share_prices e
      JOIN holding_import_applications a ON a.import_row_id=e.import_row_id
      JOIN holding_import_rows r ON r.id=e.import_row_id
      JOIN holding_imports i ON i.id=r.import_id
      WHERE e.import_row_id=json_extract(lot.value,'$.mark.sourceEvidenceId')
        AND e.household_id=NEW.household_id
        AND (
          (json_extract(lot.value,'$.mark.proxy') IS NULL AND json_extract(lot.value,'$.mark.comparableConfirmed')=1)
          OR (json_extract(lot.value,'$.mark.proxy.confirmed')=1
            AND json_extract(lot.value,'$.mark.comparableConfirmed') IS NULL
            AND length(trim(json_extract(lot.value,'$.mark.proxy.reason'))) > 0
            AND json_extract(lot.value,'$.mark.proxy.capturedAt')=i.created_at)
        )
        AND json_extract(e.evidence_json,'$.markMicros')=json_extract(lot.value,'$.mark.priceMicros')
        AND (json_extract(e.evidence_json,'$.markDate') IS NULL OR json_extract(e.evidence_json,'$.markDate')=json_extract(lot.value,'$.mark.effectiveDate'))
        AND a.id=(SELECT application_id FROM holding_import_application_heads WHERE position_id=a.position_id)
    )
  );
END;

DROP TRIGGER holding_purchase_review_guard;
CREATE TRIGGER holding_purchase_review_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  -- Remote D1 misparses unparenthesized CASE..END inside triggers (#4727).
  SELECT RAISE(ABORT,'purchase provenance mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p JOIN households h ON h.id=p.household_id
    JOIN holding_position_snapshots s ON s.position_id=p.id
    WHERE p.id=NEW.position_id AND p.household_id=NEW.household_id
      AND p.position_kind='spv_interest' AND p.currency='USD'
      AND h.owner_user_id=NEW.reviewer_user_id AND s.id=NEW.snapshot_id
      AND NOT EXISTS (SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id=p.id)
  );
  SELECT RAISE(ABORT,'purchase review stale') WHERE NEW.prior_id IS NOT
    (SELECT review_id FROM holding_purchase_heads WHERE position_id=NEW.position_id);
  SELECT RAISE(ABORT,'purchase snapshot stale') WHERE NEW.snapshot_id IS NOT (
    SELECT snapshot_id FROM holding_import_application_heads WHERE position_id=NEW.position_id
  );
END;
