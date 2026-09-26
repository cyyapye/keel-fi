-- Source observations only. A purchase review explicitly selects a price.
CREATE TABLE holding_import_share_prices (
  import_row_id TEXT PRIMARY KEY REFERENCES holding_import_rows(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json))
);
CREATE INDEX holding_import_share_prices_household ON holding_import_share_prices(household_id, import_row_id);
CREATE TRIGGER holding_import_share_prices_guard BEFORE INSERT ON holding_import_share_prices BEGIN
  SELECT RAISE(ABORT, 'share price household mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_import_rows r WHERE r.id=NEW.import_row_id AND r.household_id=NEW.household_id
  );
END;
CREATE TRIGGER holding_import_share_prices_no_update BEFORE UPDATE ON holding_import_share_prices BEGIN SELECT RAISE(ABORT, 'share prices are immutable'); END;
CREATE TRIGGER holding_import_share_prices_no_delete BEFORE DELETE ON holding_import_share_prices BEGIN SELECT RAISE(ABORT, 'share prices are immutable'); END;

-- Reject a source revision race in the same transaction as purchase acceptance.
CREATE TRIGGER holding_purchase_price_evidence_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase price evidence stale') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.lots') lot
    WHERE json_extract(lot.value,'$.mark.sourceEvidenceId') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM holding_import_share_prices e
      JOIN holding_import_applications a ON a.import_row_id=e.import_row_id
      WHERE e.import_row_id=json_extract(lot.value,'$.mark.sourceEvidenceId')
        AND e.household_id=NEW.household_id
        AND json_extract(lot.value,'$.mark.comparableConfirmed')=1
        AND json_extract(e.evidence_json,'$.markMicros')=json_extract(lot.value,'$.mark.priceMicros')
        AND (json_extract(e.evidence_json,'$.markDate') IS NULL OR json_extract(e.evidence_json,'$.markDate')=json_extract(lot.value,'$.mark.effectiveDate'))
        AND a.id=(SELECT latest.id FROM holding_import_applications latest
          JOIN holding_position_snapshots s ON s.id=latest.snapshot_id
          WHERE latest.position_id=a.position_id
          ORDER BY latest.applied_at DESC,s.observed_at DESC,latest.id DESC LIMIT 1)
    )
  );
END;
