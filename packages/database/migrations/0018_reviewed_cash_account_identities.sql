PRAGMA foreign_keys = ON;

CREATE TABLE cash_account_identity_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connector_account_id TEXT NOT NULL
    REFERENCES connector_accounts(id) ON DELETE RESTRICT,
  natural_key_low_sha256 TEXT NOT NULL CHECK (
    length(natural_key_low_sha256) = 64
    AND natural_key_low_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  natural_key_high_sha256 TEXT NOT NULL CHECK (
    length(natural_key_high_sha256) = 64
    AND natural_key_high_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  decision TEXT NOT NULL CHECK (
    decision IN ('same_account', 'separate_accounts')
  ),
  supersedes_decision_id TEXT UNIQUE
    REFERENCES cash_account_identity_decisions(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  change_note TEXT NOT NULL CHECK (length(change_note) BETWEEN 1 AND 500),
  decided_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (natural_key_low_sha256 < natural_key_high_sha256)
);
CREATE INDEX cash_account_identity_decisions_household_pair_idx
  ON cash_account_identity_decisions(
    household_id, connector_account_id,
    natural_key_low_sha256, natural_key_high_sha256, decided_at
  );

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

  SELECT RAISE(ABORT, 'cash account identity keys are not accepted')
  WHERE NOT EXISTS (
    SELECT 1
    FROM cash_balance_review_decisions decision
    JOIN cash_balance_proposal_rows row
      ON row.id = decision.proposal_row_id
    JOIN cash_balance_proposals proposal
      ON proposal.id = decision.proposal_id
    WHERE decision.household_id = NEW.household_id
      AND decision.decision = 'accepted'
      AND proposal.connector_account_id = NEW.connector_account_id
      AND row.natural_key_sha256 = NEW.natural_key_low_sha256
  ) OR NOT EXISTS (
    SELECT 1
    FROM cash_balance_review_decisions decision
    JOIN cash_balance_proposal_rows row
      ON row.id = decision.proposal_row_id
    JOIN cash_balance_proposals proposal
      ON proposal.id = decision.proposal_id
    WHERE decision.household_id = NEW.household_id
      AND decision.decision = 'accepted'
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

CREATE TRIGGER cash_account_identity_decisions_no_update
BEFORE UPDATE ON cash_account_identity_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash account identity decisions are immutable');
END;

CREATE TRIGGER cash_account_identity_decisions_no_delete
BEFORE DELETE ON cash_account_identity_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash account identity decisions are immutable');
END;
