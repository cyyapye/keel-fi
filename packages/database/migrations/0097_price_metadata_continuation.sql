-- Retain the latest separately evidenced share class and split basis.
-- An undated quote can establish metadata without inventing a mark date.
-- Every anchor must come from this followed proxy's prior accepted receipt.
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
        JOIN holding_price_quotes basis_anchor ON basis_anchor.id=COALESCE(json_extract(current.value,'$.sourceContinuation.shareBasisQuoteId'),anchor.id)
        WHERE prior.id=NEW.prior_id AND prior.position_id=NEW.position_id AND prior.household_id=NEW.household_id
          AND json_extract(old.value,'$.followSource')=1 AND json_extract(current.value,'$.followSource')=1
          AND json_extract(old.value,'$.priceSourcePositionId')=json_extract(current.value,'$.priceSourcePositionId')
          AND anchor.household_id=NEW.household_id AND anchor.source_position_id=json_extract(current.value,'$.priceSourcePositionId')
          AND anchor.share_class IS NOT NULL AND basis_anchor.basis_json IS NOT NULL
          AND basis_anchor.household_id=NEW.household_id AND basis_anchor.source_position_id=anchor.source_position_id
          AND json_extract(current.value,'$.sourceContinuation.policy')='accepted-source-continuation-v1'
          AND ((anchor.id=(CASE WHEN json_extract(old.value,'$.shareClass') IS NOT NULL
            THEN json_extract(old.value,'$.sourceEvidenceId') ELSE json_extract(old.value,'$.sourceContinuation.quoteId') END)
          AND basis_anchor.id=(CASE WHEN json_extract(old.value,'$.shareBasis') IS NOT NULL
            THEN json_extract(old.value,'$.sourceEvidenceId')
            ELSE COALESCE(json_extract(old.value,'$.sourceContinuation.shareBasisQuoteId'),json_extract(old.value,'$.sourceContinuation.quoteId')) END))
            OR current.value IS old.value)
          AND anchor.share_class=json_extract(current.value,'$.sourceContinuation.shareClass')
          AND json_extract(basis_anchor.basis_json,'$.key')=json_extract(current.value,'$.sourceContinuation.shareBasis.key')
          AND json_extract(basis_anchor.basis_json,'$.unitsPerOriginal')=json_extract(current.value,'$.sourceContinuation.shareBasis.unitsPerOriginal')
      )
  );
END;
