PRAGMA foreign_keys = ON;

CREATE TABLE cash_balance_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connector_account_id TEXT NOT NULL
    REFERENCES connector_accounts(id) ON DELETE RESTRICT,
  sync_run_id TEXT NOT NULL UNIQUE
    REFERENCES connector_sync_runs(id) ON DELETE RESTRICT,
  source_object_key TEXT NOT NULL UNIQUE,
  source_sha256 TEXT NOT NULL CHECK (
    length(source_sha256) = 64
    AND source_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  normalized_fingerprint TEXT NOT NULL CHECK (
    length(normalized_fingerprint) = 64
    AND normalized_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  refresh_kind TEXT NOT NULL CHECK (refresh_kind IN ('initial', 'live')),
  observed_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'applied')),
  created_at TEXT NOT NULL
);
CREATE INDEX cash_balance_proposals_household_status_idx
  ON cash_balance_proposals(household_id, status, created_at);
CREATE INDEX cash_balance_proposals_connection_created_idx
  ON cash_balance_proposals(connector_account_id, created_at);

CREATE TABLE cash_balance_proposal_rows (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL
    REFERENCES cash_balance_proposals(id) ON DELETE RESTRICT,
  natural_key_sha256 TEXT NOT NULL CHECK (
    length(natural_key_sha256) = 64
    AND natural_key_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  institution_label TEXT NOT NULL CHECK (length(institution_label) <= 512),
  account_label TEXT NOT NULL CHECK (length(account_label) <= 512),
  subtype TEXT NOT NULL CHECK (
    subtype IN (
      'checking', 'savings', 'money market', 'cash management', 'other'
    )
  ),
  available_minor INTEGER,
  current_minor INTEGER,
  value_minor INTEGER CHECK (value_minor IS NULL OR value_minor >= 0),
  value_state TEXT NOT NULL CHECK (
    value_state IN ('reported', 'unavailable', 'unsupported', 'not_reported')
  ),
  balance_source TEXT CHECK (balance_source IN ('available', 'current')),
  observed_at TEXT NOT NULL,
  issues_json TEXT NOT NULL CHECK (
    json_valid(issues_json) AND json_type(issues_json) = 'array'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (proposal_id, natural_key_sha256),
  CHECK (
    (value_state = 'reported' AND value_minor IS NOT NULL
      AND balance_source IS NOT NULL)
    OR (value_state <> 'reported' AND value_minor IS NULL
      AND balance_source IS NULL)
  )
);
CREATE INDEX cash_balance_proposal_rows_proposal_idx
  ON cash_balance_proposal_rows(proposal_id, natural_key_sha256);

CREATE TABLE cash_balance_review_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL
    REFERENCES cash_balance_proposals(id) ON DELETE RESTRICT,
  proposal_row_id TEXT NOT NULL UNIQUE
    REFERENCES cash_balance_proposal_rows(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'excluded')),
  change_note TEXT NOT NULL CHECK (length(change_note) BETWEEN 1 AND 500),
  decided_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX cash_balance_review_decisions_household_decided_idx
  ON cash_balance_review_decisions(household_id, decided_at);

ALTER TABLE portfolio_baselines
  ADD COLUMN cash_account_count INTEGER NOT NULL DEFAULT 0
    CHECK (cash_account_count >= 0);
ALTER TABLE portfolio_baselines
  ADD COLUMN cash_account_value_minor INTEGER NOT NULL DEFAULT 0
    CHECK (cash_account_value_minor >= 0);
ALTER TABLE portfolio_baselines
  ADD COLUMN unknown_cash_account_count INTEGER NOT NULL DEFAULT 0
    CHECK (unknown_cash_account_count BETWEEN 0 AND cash_account_count);

CREATE TABLE portfolio_baseline_cash_items (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  baseline_id TEXT NOT NULL
    REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  review_decision_id TEXT NOT NULL
    REFERENCES cash_balance_review_decisions(id) ON DELETE RESTRICT,
  proposal_row_id TEXT NOT NULL
    REFERENCES cash_balance_proposal_rows(id) ON DELETE RESTRICT,
  natural_key_sha256 TEXT NOT NULL CHECK (
    length(natural_key_sha256) = 64
    AND natural_key_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  value_minor INTEGER CHECK (value_minor IS NULL OR value_minor >= 0),
  value_state TEXT NOT NULL CHECK (
    value_state IN ('reported', 'not_reported')
  ),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (baseline_id, natural_key_sha256),
  CHECK (
    (value_state = 'reported' AND value_minor IS NOT NULL)
    OR (value_state = 'not_reported' AND value_minor IS NULL)
  )
);
CREATE INDEX portfolio_baseline_cash_items_baseline_idx
  ON portfolio_baseline_cash_items(baseline_id, natural_key_sha256);

CREATE TRIGGER cash_balance_proposals_integrity_insert
BEFORE INSERT ON cash_balance_proposals
BEGIN
  SELECT RAISE(ABORT, 'cash proposal connector mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM connector_accounts account
    JOIN connector_sync_runs run
      ON run.connector_account_id = account.id
      AND run.household_id = account.household_id
    WHERE account.id = NEW.connector_account_id
      AND account.household_id = NEW.household_id
      AND account.connector_type = 'plaid-cash'
      AND run.id = NEW.sync_run_id
      AND run.cursor = CASE NEW.refresh_kind
        WHEN 'initial' THEN 'cash-initial-v1'
        ELSE 'cash-live-v1'
      END
  );
END;

CREATE TRIGGER cash_balance_proposal_rows_integrity_insert
BEFORE INSERT ON cash_balance_proposal_rows
BEGIN
  SELECT RAISE(ABORT, 'cash proposal row household mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM cash_balance_proposals proposal
    WHERE proposal.id = NEW.proposal_id
      AND proposal.household_id = NEW.household_id
  );
END;

CREATE TRIGGER cash_balance_review_decisions_integrity_insert
BEFORE INSERT ON cash_balance_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash review decision mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM cash_balance_proposals proposal
    JOIN cash_balance_proposal_rows row ON row.proposal_id = proposal.id
    WHERE proposal.id = NEW.proposal_id
      AND proposal.status = 'pending_review'
      AND proposal.household_id = NEW.household_id
      AND row.id = NEW.proposal_row_id
      AND row.household_id = NEW.household_id
  );

  SELECT RAISE(ABORT, 'unsupported cash balance cannot be accepted')
  WHERE NEW.decision = 'accepted' AND EXISTS (
    SELECT 1 FROM cash_balance_proposal_rows row
    WHERE row.id = NEW.proposal_row_id
      AND row.value_state IN ('unavailable', 'unsupported')
  );
END;

CREATE TRIGGER portfolio_baseline_cash_items_integrity_insert
BEFORE INSERT ON portfolio_baseline_cash_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline cash item mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM portfolio_baselines baseline
    JOIN cash_balance_review_decisions decision
      ON decision.household_id = baseline.household_id
    JOIN cash_balance_proposal_rows row
      ON row.id = decision.proposal_row_id
      AND row.household_id = decision.household_id
    WHERE baseline.id = NEW.baseline_id
      AND baseline.household_id = NEW.household_id
      AND decision.id = NEW.review_decision_id
      AND decision.decision = 'accepted'
      AND row.id = NEW.proposal_row_id
      AND row.natural_key_sha256 = NEW.natural_key_sha256
      AND row.value_state = NEW.value_state
      AND row.value_minor IS NEW.value_minor
      AND row.observed_at = NEW.observed_at
  );
END;

CREATE TRIGGER cash_balance_proposals_update_transition
BEFORE UPDATE ON cash_balance_proposals
WHEN NOT (
  OLD.status = 'pending_review'
  AND NEW.status = 'applied'
  AND NEW.id = OLD.id
  AND NEW.household_id = OLD.household_id
  AND NEW.connector_account_id = OLD.connector_account_id
  AND NEW.sync_run_id = OLD.sync_run_id
  AND NEW.source_object_key = OLD.source_object_key
  AND NEW.source_sha256 = OLD.source_sha256
  AND NEW.normalized_fingerprint = OLD.normalized_fingerprint
  AND NEW.refresh_kind = OLD.refresh_kind
  AND NEW.observed_at = OLD.observed_at
  AND NEW.retrieved_at = OLD.retrieved_at
  AND NEW.created_at = OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'cash proposals only transition to applied');
END;

CREATE TRIGGER cash_balance_proposals_no_delete
BEFORE DELETE ON cash_balance_proposals
BEGIN
  SELECT RAISE(ABORT, 'cash proposals are immutable');
END;

CREATE TRIGGER cash_balance_proposal_rows_no_update
BEFORE UPDATE ON cash_balance_proposal_rows
BEGIN
  SELECT RAISE(ABORT, 'cash proposal rows are immutable');
END;

CREATE TRIGGER cash_balance_proposal_rows_no_delete
BEFORE DELETE ON cash_balance_proposal_rows
BEGIN
  SELECT RAISE(ABORT, 'cash proposal rows are immutable');
END;

CREATE TRIGGER cash_balance_review_decisions_no_update
BEFORE UPDATE ON cash_balance_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash review decisions are immutable');
END;

CREATE TRIGGER cash_balance_review_decisions_no_delete
BEFORE DELETE ON cash_balance_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash review decisions are immutable');
END;

CREATE TRIGGER portfolio_baseline_cash_items_no_update
BEFORE UPDATE ON portfolio_baseline_cash_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline cash items are immutable');
END;

CREATE TRIGGER portfolio_baseline_cash_items_no_delete
BEFORE DELETE ON portfolio_baseline_cash_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline cash items are immutable');
END;
