-- Permit an explicitly accepted proxy while preserving source revision guards.
DROP TRIGGER holding_purchase_price_evidence_guard;
CREATE TRIGGER holding_purchase_price_evidence_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase price evidence stale') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.lots') lot
    WHERE json_extract(lot.value,'$.mark.sourceEvidenceId') IS NOT NULL
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
        AND a.id=(SELECT latest.id FROM holding_import_applications latest
          JOIN holding_position_snapshots s ON s.id=latest.snapshot_id
          WHERE latest.position_id=a.position_id
          ORDER BY latest.applied_at DESC,s.observed_at DESC,latest.id DESC LIMIT 1)
    )
  );
END;
