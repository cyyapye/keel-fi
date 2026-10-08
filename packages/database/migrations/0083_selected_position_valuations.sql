-- Selected valuation inputs share the immutable investment receipt and indexed head.
-- Validate newly adopted imported prices atomically; retaining a past selection
-- during an unrelated investment edit does not re-adopt source evidence.
CREATE TRIGGER holding_selected_valuation_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase price evidence stale') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.valuation.records') record
    WHERE json_extract(record.value,'$.id')=json_extract(NEW.receipt_json,'$.details.valuation.selected.recordId')
      AND json_extract(record.value,'$.sourceEvidenceId') IS NOT NULL
      AND json_extract(NEW.receipt_json,'$.details.valuation') IS NOT
        (SELECT json_extract(prior.receipt_json,'$.details.valuation') FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id)
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
          AND application.id=(SELECT latest.id FROM holding_import_applications latest
            JOIN holding_position_snapshots snapshot ON snapshot.id=latest.snapshot_id
            WHERE latest.position_id=application.position_id
            ORDER BY latest.applied_at DESC,snapshot.observed_at DESC,latest.id DESC LIMIT 1)
      )
  );
END;
