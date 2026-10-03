-- A received refund may have an unknown receipt date; preserve existing reviews.
DROP TRIGGER holding_purchase_capital_return_guard;
CREATE TRIGGER holding_purchase_capital_return_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase capital refund invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.lots') lot
    WHERE json_type(lot.value, '$.capitalReturn') IS NOT NULL AND (
      json_type(lot.value, '$.capitalReturn') IS NOT 'object'
      OR json_type(lot.value, '$.capitalReturn.amountMinor') IS NOT 'integer'
      OR json_extract(lot.value, '$.capitalReturn.amountMinor') <= 0
      OR json_extract(lot.value, '$.capitalReturn.amountMinor') > 10000000000000
      OR json_type(lot.value, '$.grossCashMinor') IS NOT 'integer'
      OR json_extract(lot.value, '$.capitalReturn.amountMinor') > json_extract(lot.value, '$.grossCashMinor')
      OR COALESCE(json_extract(lot.value, '$.capitalReturn.status'), '') NOT IN ('expected', 'received')
      OR COALESCE(json_extract(lot.value, '$.capitalReturn.reportedDistributions'), '') NOT IN ('unknown', 'included', 'excluded')
      OR (json_extract(lot.value, '$.capitalReturn.status') = 'expected' AND json_extract(lot.value, '$.capitalReturn.reportedDistributions') != 'unknown')
      OR (json_extract(lot.value, '$.capitalReturn.status') = 'received'
        AND json_type(lot.value, '$.capitalReturn.effectiveDate') IS NOT 'null' AND (
        json_type(lot.value, '$.capitalReturn.effectiveDate') IS NOT 'text'
        OR length(json_extract(lot.value, '$.capitalReturn.effectiveDate')) != 10
        OR date(json_extract(lot.value, '$.capitalReturn.effectiveDate')) IS NULL))));
END;
