-- Reuse already accepted GP balances through append-only purchase receipts.
-- Investment inputs and independently dated per-share prices are not re-adopted.
CREATE TRIGGER holding_gp_total_refresh_guard BEFORE INSERT ON holding_purchase_reviews
WHEN json_extract(NEW.receipt_json,'$.details.valuation.reportedTotalRefresh') IS NOT
  (SELECT json_extract(receipt_json,'$.details.valuation.reportedTotalRefresh') FROM holding_purchase_reviews WHERE id=NEW.prior_id)
  AND json_extract(NEW.receipt_json,'$.details.valuation.reportedTotalRefresh') IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'GP total refresh provenance mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_purchase_reviews prior
    JOIN holding_positions source ON source.id=json_extract(NEW.receipt_json,'$.details.valuation.reportedTotalRefresh.sourcePositionId')
      AND source.household_id=NEW.household_id AND source.provider IN ('angellist','tokenfolio','sydecar','wefunder')
    JOIN holding_import_application_heads head ON head.position_id=source.id
    JOIN holding_position_snapshots balance ON balance.id=head.snapshot_id
    JOIN json_each(prior.receipt_json,'$.details.valuation.records') old
      ON json_extract(old.value,'$.id')=json_extract(prior.receipt_json,'$.details.valuation.selected.recordId')
    JOIN json_each(NEW.receipt_json,'$.details.valuation.records') current
      ON json_extract(current.value,'$.id')=json_extract(old.value,'$.id')
    WHERE prior.id=NEW.prior_id AND prior.household_id=NEW.household_id AND prior.position_id=NEW.position_id
      AND json_extract(NEW.receipt_json,'$.details.valuation.reportedTotalRefresh.policy')='accepted-gp-total-v1'
      AND json_extract(NEW.receipt_json,'$.details.valuation.reportedTotalRefresh.priorReceiptId')=prior.id
      AND json_extract(NEW.receipt_json,'$.details.valuation.reportedTotalRefresh.sourceApplicationId')=head.application_id
      AND json_extract(NEW.receipt_json,'$.details.valuation.reportedTotalRefresh.sourceSnapshotId')=balance.id
      AND json_extract(prior.receipt_json,'$.details.valuation.selected.method')='total'
      AND json_extract(old.value,'$.origin')='gp'
      AND balance.currency='USD' AND balance.provider_status='live' AND balance.unrealized_value_state='reported'
      AND balance.created_at>prior.accepted_at
      AND substr(balance.observed_at,1,10)>=json_extract(old.value,'$.effectiveDate')
      AND substr(balance.observed_at,1,10)<=substr(NEW.accepted_at,1,10)
      AND json_extract(current.value,'$.totalMinor')=balance.unrealized_value_minor
      AND json_extract(current.value,'$.totalMinor') IS NOT json_extract(old.value,'$.totalMinor')
      AND json_extract(current.value,'$.effectiveDate')=substr(balance.observed_at,1,10)
      AND json_extract(current.value,'$.carryStatus')='unknown'
      AND json_extract(current.value,'$.sourceLabel')=(CASE source.provider WHEN 'angellist' THEN 'AngelList' WHEN 'tokenfolio' THEN 'Tokenfolio' WHEN 'sydecar' THEN 'Sydecar' ELSE 'Wefunder' END)
      AND json_extract(current.value,'$.sourceUrl') IS NULL
      AND json_extract(current.value,'$.sourceEvidenceId') IS NULL
      AND json_extract(current.value,'$.sourcePositionId') IS NULL
      AND json_extract(current.value,'$.sourceCapturedAt') IS NULL
      AND EXISTS(SELECT 1 FROM holding_position_link_heads link WHERE link.source_position_id=source.id
          AND link.household_id=NEW.household_id AND link.target_position_id=NEW.position_id AND link.state='linked' AND link.use_source_value=1
          AND link.review_id=json_extract(NEW.receipt_json,'$.details.valuation.reportedTotalRefresh.linkReviewId'))
      AND NOT EXISTS(SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id IN (NEW.position_id,source.id))
      AND COALESCE((SELECT json_extract(r.state_json,'$.participationStatus') FROM holding_investment_reviews r
        WHERE r.household_id=NEW.household_id AND r.position_id=source.id ORDER BY r.version DESC LIMIT 1),'current') NOT IN ('historical','cancelled')
      AND COALESCE((SELECT json_extract(r.state_json,'$.participationStatus') FROM holding_investment_reviews r
        WHERE r.household_id=NEW.household_id AND r.position_id=NEW.position_id ORDER BY r.version DESC LIMIT 1),'current') NOT IN ('historical','cancelled')
  );
  SELECT RAISE(ABORT,'GP total refresh changed investment inputs') WHERE EXISTS (
    SELECT 1 FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id AND (
      json_remove(NEW.receipt_json,'$.id','$.snapshotId','$.acceptedAt','$.details.valuation','$.details.investmentSnapshotId') IS NOT
        json_remove(prior.receipt_json,'$.id','$.snapshotId','$.acceptedAt','$.details.valuation','$.details.investmentSnapshotId')
      OR json_extract(NEW.receipt_json,'$.details.investmentSnapshotId') IS NOT
        COALESCE(json_extract(prior.receipt_json,'$.details.investmentSnapshotId'),prior.snapshot_id)
      OR json_remove(json_extract(NEW.receipt_json,'$.details.valuation'),'$.snapshotId','$.reportedTotalRefresh','$.records') IS NOT
        json_remove(json_extract(prior.receipt_json,'$.details.valuation'),'$.snapshotId','$.reportedTotalRefresh','$.records')
      OR json_array_length(NEW.receipt_json,'$.details.valuation.records') IS NOT json_array_length(prior.receipt_json,'$.details.valuation.records')
      OR EXISTS (SELECT 1 FROM json_each(NEW.receipt_json,'$.details.valuation.records') current
        WHERE NOT EXISTS (SELECT 1 FROM json_each(prior.receipt_json,'$.details.valuation.records') old
          WHERE old.key=current.key AND (CASE WHEN json_extract(current.value,'$.id')=json_extract(NEW.receipt_json,'$.details.valuation.selected.recordId')
            THEN json_remove(current.value,'$.totalMinor','$.effectiveDate','$.carryStatus','$.sourceLabel','$.sourceUrl','$.sourceEvidenceId','$.sourcePositionId','$.sourceCapturedAt') IS
              json_remove(old.value,'$.totalMinor','$.effectiveDate','$.carryStatus','$.sourceLabel','$.sourceUrl','$.sourceEvidenceId','$.sourcePositionId','$.sourceCapturedAt')
            ELSE current.value IS old.value END)))
    )
  );
END;

-- The dated quote remains an immutable metadata anchor. A later accepted
-- provider observation may continue an explicitly selected proxy without
-- inventing a mark date, share class or stock-split basis.
CREATE VIEW holding_price_current_quotes AS
SELECT head.source_position_id,head.household_id,head.observation_id,
  (CASE WHEN EXISTS (
    SELECT 1 FROM holding_price_quotes observation
    JOIN holding_price_quotes dated ON dated.id=head.quote_id
    WHERE observation.id=head.observation_id AND observation.decision_policy IN ('accepted-import-price-v1','reviewed-price-v1')
      AND observation.id<>dated.id AND (observation.accepted_at,observation.id)>(dated.accepted_at,dated.id)
      AND (observation.observed_at,observation.accepted_at,observation.id)>(dated.observed_at,dated.accepted_at,dated.id)
      AND (observation.price_date IS NULL OR (observation.price_date>=dated.price_date AND observation.price_date<=substr(observation.accepted_at,1,10)))
    ) THEN head.observation_id ELSE COALESCE(head.quote_id,head.observation_id) END) quote_id
FROM holding_price_source_heads head;

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


-- A continuation can only reuse metadata from this proxy's previously accepted
-- quote. The quote's raw metadata above must still match exactly. Neither a
-- client nor a racing propagation can fabricate a basis or establish a new link.
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
        WHERE prior.id=NEW.prior_id AND prior.position_id=NEW.position_id AND prior.household_id=NEW.household_id
          AND json_extract(old.value,'$.followSource')=1 AND json_extract(current.value,'$.followSource')=1
          AND json_extract(old.value,'$.priceSourcePositionId')=json_extract(current.value,'$.priceSourcePositionId')
          AND anchor.household_id=NEW.household_id AND anchor.source_position_id=json_extract(current.value,'$.priceSourcePositionId')
          AND anchor.price_date IS NOT NULL AND anchor.share_class IS NOT NULL AND anchor.basis_json IS NOT NULL
          AND json_extract(current.value,'$.sourceContinuation.policy')='accepted-source-continuation-v1'
          AND anchor.id=COALESCE(json_extract(old.value,'$.sourceContinuation.quoteId'),json_extract(old.value,'$.sourceEvidenceId'))
          AND anchor.share_class=json_extract(current.value,'$.sourceContinuation.shareClass')
          AND json_extract(anchor.basis_json,'$.key')=json_extract(current.value,'$.sourceContinuation.shareBasis.key')
          AND json_extract(anchor.basis_json,'$.unitsPerOriginal')=json_extract(current.value,'$.sourceContinuation.shareBasis.unitsPerOriginal')
      )
  );
END;
