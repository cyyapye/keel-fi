ALTER TABLE cash_balance_review_decisions
  ADD COLUMN decision_source TEXT NOT NULL DEFAULT 'user'
    CHECK (decision_source IN ('user', 'policy'));
ALTER TABLE cash_balance_review_decisions
  ADD COLUMN policy_version TEXT CHECK (
    policy_version IS NULL OR policy_version = 'cash-balances-auto-v1'
  );
ALTER TABLE cash_balance_review_decisions
  ADD COLUMN prior_decision_id TEXT
    REFERENCES cash_balance_review_decisions(id) ON DELETE RESTRICT;

CREATE INDEX cash_balance_proposals_household_status_observed_idx
  ON cash_balance_proposals(household_id, status, observed_at DESC);
CREATE INDEX cash_balance_proposals_connection_observed_idx
  ON cash_balance_proposals(connector_account_id, observed_at DESC);
CREATE INDEX cash_balance_proposal_rows_household_key_idx
  ON cash_balance_proposal_rows(household_id, natural_key_sha256, observed_at DESC);

CREATE TRIGGER cash_balance_policy_decision_integrity
BEFORE INSERT ON cash_balance_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash policy attribution mismatch') WHERE
    (NEW.decision_source = 'user' AND
      (NEW.policy_version IS NOT NULL OR NEW.prior_decision_id IS NOT NULL))
    OR (NEW.decision_source = 'policy' AND NEW.policy_version IS NULL);

  SELECT RAISE(ABORT, 'cash automatic acceptance requires a known account')
  WHERE NEW.decision_source = 'policy' AND NEW.decision = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM cash_balance_review_decisions prior
      JOIN cash_balance_proposals prior_proposal ON prior_proposal.id = prior.proposal_id
      JOIN cash_balance_proposals proposal ON proposal.id = NEW.proposal_id
      JOIN cash_balance_proposal_rows row ON row.id = NEW.proposal_row_id
      WHERE prior.id = NEW.prior_decision_id AND prior.decision = 'accepted'
        AND prior.household_id = NEW.household_id
        AND prior_proposal.connector_account_id = proposal.connector_account_id
        AND row.value_state = 'reported' AND proposal.refresh_kind = 'live'
    );

  SELECT RAISE(ABORT, 'cash balance proposal is stale')
  WHERE NEW.decision = 'accepted' AND EXISTS (
    SELECT 1 FROM cash_balance_proposals proposal
    JOIN cash_balance_proposals newer
      ON newer.connector_account_id = proposal.connector_account_id
      AND (newer.observed_at > proposal.observed_at OR
        (newer.observed_at = proposal.observed_at AND newer.rowid > proposal.rowid))
    WHERE proposal.id = NEW.proposal_id
  );

  SELECT RAISE(ABORT, 'newer cash balance already accepted')
  WHERE NEW.decision = 'accepted' AND EXISTS (
    SELECT 1 FROM cash_balance_proposal_rows row
    JOIN cash_balance_proposal_rows newer
      ON newer.household_id = row.household_id
      AND newer.natural_key_sha256 = row.natural_key_sha256
      AND newer.observed_at > row.observed_at
    JOIN cash_balance_review_decisions decision
      ON decision.proposal_row_id = newer.id AND decision.decision = 'accepted'
    JOIN cash_balance_proposals proposal ON proposal.id = NEW.proposal_id
    JOIN cash_balance_proposals newer_proposal ON newer_proposal.id = newer.proposal_id
      AND newer_proposal.connector_account_id = proposal.connector_account_id
    WHERE row.id = NEW.proposal_row_id
  );
END;
-- Identity exceptions can be resolved before a new record enters accepted cash.
DROP TRIGGER cash_account_identity_decisions_integrity_insert;
CREATE TRIGGER cash_account_identity_decisions_integrity_insert
BEFORE INSERT ON cash_account_identity_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash account identity connection mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM connector_accounts account
    WHERE account.id = NEW.connector_account_id
      AND account.household_id = NEW.household_id
      AND account.connector_type = 'plaid-cash'
  );

  SELECT RAISE(ABORT, 'cash account identity keys were not observed')
  WHERE NOT EXISTS (
    SELECT 1 FROM cash_balance_proposal_rows row
    JOIN cash_balance_proposals proposal ON proposal.id = row.proposal_id
    WHERE proposal.household_id = NEW.household_id
      AND proposal.connector_account_id = NEW.connector_account_id
      AND row.natural_key_sha256 = NEW.natural_key_low_sha256
  ) OR NOT EXISTS (
    SELECT 1 FROM cash_balance_proposal_rows row
    JOIN cash_balance_proposals proposal ON proposal.id = row.proposal_id
    WHERE proposal.household_id = NEW.household_id
      AND proposal.connector_account_id = NEW.connector_account_id
      AND row.natural_key_sha256 = NEW.natural_key_high_sha256
  );

  SELECT RAISE(ABORT, 'cash account identity decision already exists')
  WHERE NEW.supersedes_decision_id IS NULL AND EXISTS (
    SELECT 1
    FROM cash_account_identity_decisions prior
    WHERE prior.household_id = NEW.household_id
      AND prior.connector_account_id = NEW.connector_account_id
      AND prior.natural_key_low_sha256 = NEW.natural_key_low_sha256
      AND prior.natural_key_high_sha256 = NEW.natural_key_high_sha256
  );

  SELECT RAISE(ABORT, 'cash account identity supersession mismatch')
  WHERE NEW.supersedes_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM cash_account_identity_decisions prior
    WHERE prior.id = NEW.supersedes_decision_id
      AND prior.household_id = NEW.household_id
      AND prior.connector_account_id = NEW.connector_account_id
      AND prior.natural_key_low_sha256 = NEW.natural_key_low_sha256
      AND prior.natural_key_high_sha256 = NEW.natural_key_high_sha256
      AND NOT EXISTS (
        SELECT 1
        FROM cash_account_identity_decisions later
        WHERE later.supersedes_decision_id = prior.id
      )
  );
END;
