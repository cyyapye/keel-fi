-- Allocation refunds are distinct from fees. Preserve all existing review heads and receipts.
DROP TRIGGER holding_purchase_unified_guard;
-- Extend versioned purchase JSON without rewriting legacy receipts or reviews.
-- A unified head owns reviewed economics, including explicitly unknown terms.
CREATE TRIGGER holding_purchase_unified_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase unified terms downgrade')
  WHERE json_type(NEW.receipt_json, '$.details.investmentTerms') IS NULL
    AND EXISTS (SELECT 1 FROM holding_purchase_heads head
      JOIN holding_purchase_reviews prior ON prior.id = head.review_id
      WHERE head.position_id = NEW.position_id
        AND json_type(prior.receipt_json, '$.details.investmentTerms') IS NOT NULL);

  SELECT RAISE(ABORT, 'purchase economics review stale')
  WHERE json_type(NEW.receipt_json, '$.details.investmentTerms') IS NOT NULL
    AND json_extract(NEW.receipt_json, '$.supersedesEconomicsTermsId') IS NOT (
      SELECT proposal.id FROM holding_position_economics_proposals proposal
      JOIN holding_position_economics_reviews review ON review.proposal_id = proposal.id AND review.decision = 'accepted'
      WHERE proposal.position_id = NEW.position_id AND proposal.household_id = NEW.household_id
        AND NOT EXISTS (SELECT 1 FROM holding_position_economics_proposals later
          JOIN holding_position_economics_reviews later_review ON later_review.proposal_id = later.id AND later_review.decision = 'accepted'
          WHERE later.supersedes_proposal_id = proposal.id)
      ORDER BY review.decided_at DESC, proposal.id DESC LIMIT 1);

  SELECT RAISE(ABORT, 'purchase capital does not reconcile') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.lots') lot
    WHERE json_type(lot.value, '$.upfrontDeductionsMinor') IS 'integer'
      AND ((json_extract(lot.value, '$.grossCashMinor') IS NOT NULL
        AND json_extract(lot.value, '$.upfrontDeductionsMinor') > (json_extract(lot.value, '$.grossCashMinor') - CASE WHEN json_extract(lot.value, '$.capitalReturn.status') = 'received' THEN json_extract(lot.value, '$.capitalReturn.amountMinor') ELSE 0 END))
        OR (json_extract(lot.value, '$.grossCashMinor') IS NOT NULL
          AND json_extract(lot.value, '$.netCapitalMinor') IS NOT NULL
          AND (json_extract(lot.value, '$.grossCashMinor') - CASE WHEN json_extract(lot.value, '$.capitalReturn.status') = 'received' THEN json_extract(lot.value, '$.capitalReturn.amountMinor') ELSE 0 END) != json_extract(lot.value, '$.netCapitalMinor') + json_extract(lot.value, '$.upfrontDeductionsMinor'))));

  -- Carry classification belongs to one observed mark, not every future mark.
  SELECT RAISE(ABORT, 'purchase value evidence stale')
  WHERE json_type(NEW.receipt_json, '$.details.investmentTerms.reportedValueReview') IS 'object'
    AND NOT EXISTS (
      SELECT 1 FROM holding_positions source_position
      JOIN holding_import_applications source_application ON source_application.id = (
        SELECT application.id FROM holding_import_applications application
        JOIN holding_position_snapshots snapshot ON snapshot.id = application.snapshot_id
        WHERE application.position_id = source_position.id
        ORDER BY application.applied_at DESC, snapshot.observed_at DESC, application.id DESC LIMIT 1)
      JOIN holding_position_snapshots source ON source.id = source_application.snapshot_id
      WHERE source_position.household_id = NEW.household_id AND source_position.currency = 'USD'
        AND source.id = json_extract(NEW.receipt_json, '$.details.investmentTerms.reportedValueReview.sourceSnapshotId')
        AND source.unrealized_value_minor = json_extract(NEW.receipt_json, '$.details.investmentTerms.reportedValueReview.valueMinor')
        AND ((source_position.id = NEW.position_id AND NOT EXISTS (
          SELECT 1 FROM holding_position_link_heads link WHERE link.household_id = NEW.household_id
            AND link.target_position_id = NEW.position_id AND link.state = 'linked' AND link.use_source_value = 1))
        OR (source.provider_status = 'live' AND EXISTS (
          SELECT 1 FROM holding_position_link_heads link WHERE link.household_id = NEW.household_id
            AND link.target_position_id = NEW.position_id AND link.source_position_id = source_position.id
            AND link.state = 'linked' AND link.use_source_value = 1)
          AND COALESCE((SELECT json_extract(review.state_json, '$.participationStatus')
            FROM holding_investment_reviews review WHERE review.household_id = NEW.household_id
              AND review.position_id = source_position.id ORDER BY review.version DESC LIMIT 1), 'current') NOT IN ('historical', 'cancelled'))));
END;


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
      OR (json_extract(lot.value, '$.capitalReturn.status') = 'received' AND (
        json_type(lot.value, '$.capitalReturn.effectiveDate') IS NOT 'text'
        OR length(json_extract(lot.value, '$.capitalReturn.effectiveDate')) != 10
        OR date(json_extract(lot.value, '$.capitalReturn.effectiveDate')) IS NULL))));
END;
