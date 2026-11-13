DROP TRIGGER holding_position_economics_proposals_integrity_insert;

CREATE TRIGGER holding_position_economics_proposals_integrity_insert
BEFORE INSERT ON holding_position_economics_proposals
BEGIN
  SELECT RAISE(ABORT, 'position economics proposal provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    JOIN holding_position_snapshots snapshot
      ON snapshot.position_id = position.id
    JOIN households household ON household.id = position.household_id
    WHERE position.id = NEW.position_id
      AND position.position_kind = 'spv_interest'
      AND position.household_id = NEW.household_id
      AND snapshot.id = NEW.snapshot_id
      AND snapshot.household_id = NEW.household_id
      AND COALESCE((SELECT json_extract(review.state_json, '$.amountCorrection.amountMinor')
        FROM holding_investment_reviews review
        WHERE review.household_id = NEW.household_id AND review.position_id = NEW.position_id
        ORDER BY review.version DESC LIMIT 1),
        CASE position.provider WHEN 'angellist' THEN snapshot.invested_minor ELSE snapshot.allocation_minor END) = NEW.commitment_minor
      AND snapshot.invested_minor = NEW.funded_minor
      AND household.owner_user_id = NEW.created_by
  );
  SELECT RAISE(ABORT, 'position economics proposal snapshot is stale')
  WHERE NEW.snapshot_id IS NOT (
    SELECT candidate.snapshot_id
    FROM holding_import_applications candidate INDEXED BY holding_import_applications_position_applied_idx
    JOIN holding_position_snapshots candidate_snapshot
      ON candidate_snapshot.id = candidate.snapshot_id
    WHERE candidate.position_id = NEW.position_id
      AND candidate.household_id = NEW.household_id
    ORDER BY candidate.applied_at DESC,
             candidate_snapshot.observed_at DESC,
             candidate.id DESC
    LIMIT 1
  );
  SELECT RAISE(ABORT, 'position economics proposal chain mismatch')
  WHERE NEW.supersedes_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_position_economics_proposals prior
    JOIN holding_position_economics_reviews review
      ON review.proposal_id = prior.id
     AND review.decision = 'accepted'
    WHERE prior.id = NEW.supersedes_proposal_id
      AND prior.position_id = NEW.position_id
      AND prior.household_id = NEW.household_id
  );
END;
