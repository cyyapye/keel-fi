-- Preserve the rate, basis and source of a reviewed underlying purchase fee.
ALTER TABLE holding_position_economics_proposals ADD COLUMN purchase_fee_json TEXT
  CHECK (purchase_fee_json IS NULL OR (json_valid(purchase_fee_json)
    AND json_type(purchase_fee_json, '$.ratePpm') IS 'integer'
    AND json_extract(purchase_fee_json, '$.ratePpm') BETWEEN 0 AND 1000000
    AND json_type(purchase_fee_json, '$.basis') IS 'text'
    AND json_extract(purchase_fee_json, '$.basis') IN ('gross_cash', 'net_capital')
    AND json_type(purchase_fee_json, '$.receiptId') IS 'text'
    AND json_type(purchase_fee_json, '$.label') IS 'text'));
DROP TRIGGER holding_position_economics_capital_integrity_insert;
CREATE TRIGGER holding_position_economics_capital_integrity_insert
BEFORE INSERT ON holding_position_economics_proposals BEGIN
  SELECT RAISE(ABORT, 'position economics combined fees exceed commitment')
  WHERE NEW.annual_admin_fee_ppm * NEW.admin_fee_years + COALESCE(NEW.setup_fee_ppm, 0) > 1000000;
  SELECT RAISE(ABORT, 'position economics capital basis mismatch')
  WHERE (NEW.capital_basis = 'gross_commitment' AND NEW.gross_commitment_minor IS NOT NULL)
     OR (NEW.capital_basis = 'net_invested' AND (NEW.gross_commitment_minor IS NULL OR NEW.setup_fee_ppm IS NULL));
  SELECT RAISE(ABORT, 'position economics purchase evidence changed')
  WHERE NEW.purchase_fee_json IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM holding_purchase_heads head
    JOIN holding_purchase_reviews purchase ON purchase.id = head.review_id
    WHERE head.position_id = NEW.position_id AND head.household_id = NEW.household_id
      AND purchase.id = json_extract(NEW.purchase_fee_json, '$.receiptId')
      AND purchase.snapshot_id = NEW.snapshot_id
      AND json_array_length(purchase.receipt_json, '$.details.lots') = 1
      AND json_extract(purchase.receipt_json, '$.details.lots[0].feePpm') = json_extract(NEW.purchase_fee_json, '$.ratePpm')
      AND json_extract(purchase.receipt_json, '$.details.lots[0].feeBasis') = json_extract(NEW.purchase_fee_json, '$.basis')
  );
  -- Match half-up integer rounding without overflowing SQLite's int64 range.
  SELECT RAISE(ABORT, 'position economics net capital does not reconcile')
  WHERE NEW.capital_basis = 'net_invested' AND NEW.commitment_minor != (
    SELECT (CASE WHEN json_extract(NEW.purchase_fee_json, '$.basis') = 'net_capital'
      THEN (cash / (1000000 + rate)) * 1000000
        + ((cash % (1000000 + rate)) * 1000000 + (1000000 + rate) / 2) / (1000000 + rate)
      ELSE cash - ((cash / 1000000) * rate + ((cash % 1000000) * rate + 500000) / 1000000)
    END)
    FROM (
      SELECT NEW.gross_commitment_minor
        - ((NEW.gross_commitment_minor / 1000000) * ppm
          + ((NEW.gross_commitment_minor % 1000000) * ppm + 500000) / 1000000) AS cash,
        COALESCE(json_extract(NEW.purchase_fee_json, '$.ratePpm'), 0) AS rate
      FROM (SELECT NEW.annual_admin_fee_ppm * NEW.admin_fee_years + COALESCE(NEW.setup_fee_ppm, 0) AS ppm)
    )
  );
END;

CREATE TRIGGER automatic_investment_purchase_guard
BEFORE INSERT ON automatic_investment_reviews BEGIN
  SELECT RAISE(ABORT, 'automatic investment review stale')
  WHERE json_type(NEW.expected_guard_json, '$.purchaseReceiptId') IS NOT NULL
    AND json_extract(NEW.expected_guard_json, '$.purchaseReceiptId') IS NOT
      (SELECT review_id FROM holding_purchase_heads WHERE position_id = NEW.position_id AND household_id = NEW.household_id);
END;
