DROP TRIGGER holding_purchase_unified_guard;
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
        AND json_extract(lot.value, '$.upfrontDeductionsMinor') > (json_extract(lot.value, '$.grossCashMinor') - iif(json_extract(lot.value, '$.capitalReturn.status') = 'received', json_extract(lot.value, '$.capitalReturn.amountMinor'), 0)))
        OR (json_extract(lot.value, '$.grossCashMinor') IS NOT NULL
          AND json_extract(lot.value, '$.netCapitalMinor') IS NOT NULL
          AND (json_extract(lot.value, '$.grossCashMinor') - iif(json_extract(lot.value, '$.capitalReturn.status') = 'received', json_extract(lot.value, '$.capitalReturn.amountMinor'), 0)) != json_extract(lot.value, '$.netCapitalMinor') + json_extract(lot.value, '$.upfrontDeductionsMinor'))));

END;

CREATE TRIGGER holding_purchase_reported_value_guard BEFORE INSERT ON holding_purchase_reviews
WHEN json_extract(NEW.receipt_json,'$.details.investmentTerms.reportedValueReview') IS NOT
  (SELECT json_extract(prior.receipt_json,'$.details.investmentTerms.reportedValueReview') FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id)
BEGIN
  SELECT RAISE(ABORT, 'purchase value evidence stale')
  WHERE json_type(NEW.receipt_json, '$.details.investmentTerms.reportedValueReview') IS 'object'
    AND NOT EXISTS (
      SELECT 1 FROM holding_positions source_position
      JOIN holding_import_application_heads source_application ON source_application.position_id = source_position.id
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

DROP TRIGGER holding_purchase_price_evidence_guard;
CREATE TRIGGER holding_purchase_price_evidence_guard BEFORE INSERT ON holding_purchase_reviews
WHEN json_extract(NEW.receipt_json,'$.details.lots') IS NOT
  (SELECT json_extract(prior.receipt_json,'$.details.lots') FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id)
  OR COALESCE(json_extract(NEW.receipt_json,'$.details.investmentSnapshotId'),NEW.snapshot_id) IS NOT
    (SELECT COALESCE(json_extract(prior.receipt_json,'$.details.investmentSnapshotId'),prior.snapshot_id) FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id)
BEGIN
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


CREATE TRIGGER holding_purchase_distribution_guard BEFORE INSERT ON holding_purchase_reviews
WHEN json_extract(NEW.receipt_json,'$.details.distributionReview') IS NOT
  (SELECT json_extract(prior.receipt_json,'$.details.distributionReview') FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id)
BEGIN
  SELECT RAISE(ABORT,'purchase distribution invalid') WHERE
    json_type(NEW.receipt_json,'$.details.distributionReview') IS NOT 'object'
    OR json_extract(NEW.receipt_json,'$.details.distributionReview.method') IS NOT 'capital_return_first_v1'
    OR length(CAST(json_extract(NEW.receipt_json,'$.details.distributionReview') AS BLOB)) > 65536
    OR json_type(NEW.receipt_json,'$.details.distributionReview.events') IS NOT 'array'
    OR json_array_length(NEW.receipt_json,'$.details.distributionReview.events') > 100
    OR COALESCE(json_extract(NEW.receipt_json,'$.details.distributionReview.coverage.status'),'') NOT IN ('complete','incomplete')
    OR json_type(NEW.receipt_json,'$.details.distributionReview.coverage.throughDate') IS NOT 'text'
    OR length(json_extract(NEW.receipt_json,'$.details.distributionReview.coverage.throughDate')) != 10
    OR date(json_extract(NEW.receipt_json,'$.details.distributionReview.coverage.throughDate'),'+0 days') IS NOT json_extract(NEW.receipt_json,'$.details.distributionReview.coverage.throughDate')
    OR COALESCE(json_extract(NEW.receipt_json,'$.details.distributionReview.priorCarry.status'),'') NOT IN ('known','unknown')
    OR (json_extract(NEW.receipt_json,'$.details.distributionReview.priorCarry.status')='known' AND (
      json_type(NEW.receipt_json,'$.details.distributionReview.priorCarry.amountMinor') IS NOT 'integer'
      OR json_extract(NEW.receipt_json,'$.details.distributionReview.priorCarry.amountMinor') NOT BETWEEN 0 AND 9007199254740991))
    OR (json_extract(NEW.receipt_json,'$.details.distributionReview.coverage.status')='complete'
      AND json_array_length(NEW.receipt_json,'$.details.distributionReview.events')=0 AND (
        json_extract(NEW.receipt_json,'$.details.distributionReview.priorCarry.status')!='known'
        OR json_extract(NEW.receipt_json,'$.details.distributionReview.priorCarry.amountMinor') IS NOT 0))
    OR COALESCE(json_extract(NEW.receipt_json,'$.details.distributionReview.provider.inclusion'),'') NOT IN ('all','none','unknown','unsupported_mixed')
    OR json_type(NEW.receipt_json,'$.details.distributionReview.provider.realizedValueMinor') IS NOT 'integer'
    OR json_extract(NEW.receipt_json,'$.details.distributionReview.provider.realizedValueMinor') NOT BETWEEN 0 AND 9007199254740991
    OR json_type(NEW.receipt_json,'$.details.distributionReview.sourceLabel') IS NOT 'text'
    OR length(trim(json_extract(NEW.receipt_json,'$.details.distributionReview.sourceLabel'))) NOT BETWEEN 1 AND 500;

  SELECT RAISE(ABORT,'purchase distribution invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json,'$.details.distributionReview.events') event WHERE
      json_type(event.value,'$.id') IS NOT 'text' OR length(trim(json_extract(event.value,'$.id'))) NOT BETWEEN 1 AND 100
      OR COALESCE(json_extract(event.value,'$.kind'),'') NOT IN ('cash','in_kind')
      OR json_type(event.value,'$.receivedOn') IS NOT 'text' OR length(json_extract(event.value,'$.receivedOn')) != 10
      OR date(json_extract(event.value,'$.receivedOn'),'+0 days') IS NOT json_extract(event.value,'$.receivedOn')
      OR json_extract(event.value,'$.receivedOn') > json_extract(NEW.receipt_json,'$.details.distributionReview.coverage.throughDate')
      OR json_type(event.value,'$.investorValueMinor') NOT IN ('integer','null')
      OR json_type(event.value,'$.investorValueMinor') IS NULL
      OR (json_type(event.value,'$.investorValueMinor')='integer' AND json_extract(event.value,'$.investorValueMinor') NOT BETWEEN 0 AND 9007199254740991)
      OR json_type(event.value,'$.sourceLabel') IS NOT 'text' OR length(trim(json_extract(event.value,'$.sourceLabel'))) NOT BETWEEN 1 AND 500
      OR (json_extract(event.value,'$.kind')='in_kind' AND (
        COALESCE(json_type(event.value,'$.securityLabel'),'missing') NOT IN ('text','null')
        OR COALESCE(json_type(event.value,'$.quantityMicros'),'missing') NOT IN ('integer','null')
        OR (json_type(event.value,'$.quantityMicros')='integer' AND json_extract(event.value,'$.quantityMicros') NOT BETWEEN 0 AND 1000000000000))));
  SELECT RAISE(ABORT,'purchase distribution invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json,'$.details.distributionReview.events') event GROUP BY json_extract(event.value,'$.id') HAVING count(*) > 1);
  SELECT RAISE(ABORT,'purchase distribution invalid') WHERE (
    SELECT COALESCE(sum(json_extract(event.value,'$.investorValueMinor')),0) FROM json_each(NEW.receipt_json,'$.details.distributionReview.events') event)
      + (iif(json_extract(NEW.receipt_json,'$.details.distributionReview.priorCarry.status')='known',
          json_extract(NEW.receipt_json,'$.details.distributionReview.priorCarry.amountMinor'), 0)) > 9007199254740991;
  SELECT RAISE(ABORT,'purchase distribution invalid') WHERE NOT EXISTS (
    SELECT 1 FROM holding_position_snapshots source
    JOIN holding_import_application_heads head ON head.position_id=source.position_id AND head.snapshot_id=source.id
    WHERE source.household_id=NEW.household_id AND source.position_id=NEW.position_id
      AND source.id=json_extract(NEW.receipt_json,'$.details.distributionReview.provider.sourceSnapshotId')
      AND source.realized_value_minor=json_extract(NEW.receipt_json,'$.details.distributionReview.provider.realizedValueMinor'));
END;
