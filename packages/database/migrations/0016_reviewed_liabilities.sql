PRAGMA foreign_keys = ON;

CREATE TABLE liability_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connector_account_id TEXT
    REFERENCES connector_accounts(id) ON DELETE RESTRICT,
  sync_run_id TEXT UNIQUE
    REFERENCES connector_sync_runs(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('plaid', 'manual')),
  source_object_key TEXT UNIQUE,
  source_sha256 TEXT CHECK (
    source_sha256 IS NULL OR (
      length(source_sha256) = 64
      AND source_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  normalized_fingerprint TEXT NOT NULL CHECK (
    length(normalized_fingerprint) = 64
    AND normalized_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  refresh_kind TEXT NOT NULL CHECK (
    refresh_kind IN ('initial', 'live', 'manual')
  ),
  observed_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'applied')),
  created_at TEXT NOT NULL,
  CHECK (
    (source = 'plaid'
      AND connector_account_id IS NOT NULL
      AND sync_run_id IS NOT NULL
      AND source_object_key IS NOT NULL
      AND source_sha256 IS NOT NULL
      AND refresh_kind IN ('initial', 'live'))
    OR (source = 'manual'
      AND connector_account_id IS NULL
      AND sync_run_id IS NULL
      AND source_object_key IS NULL
      AND source_sha256 IS NULL
      AND refresh_kind = 'manual')
  )
);
CREATE INDEX liability_proposals_household_status_idx
  ON liability_proposals(household_id, status, created_at);
CREATE INDEX liability_proposals_connection_created_idx
  ON liability_proposals(connector_account_id, created_at);

CREATE TABLE liability_proposal_rows (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL
    REFERENCES liability_proposals(id) ON DELETE RESTRICT,
  natural_key_sha256 TEXT NOT NULL CHECK (
    length(natural_key_sha256) = 64
    AND natural_key_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source TEXT NOT NULL CHECK (source IN ('plaid', 'manual')),
  institution_label TEXT NOT NULL CHECK (length(institution_label) <= 512),
  account_label TEXT NOT NULL CHECK (length(account_label) <= 512),
  kind TEXT NOT NULL CHECK (
    kind IN (
      'credit_card', 'mortgage', 'student_loan',
      'other_revolving', 'other_scheduled'
    )
  ),
  classification TEXT NOT NULL CHECK (
    classification IN ('revolving', 'scheduled')
  ),
  balance_minor INTEGER CHECK (balance_minor IS NULL OR balance_minor >= 0),
  value_state TEXT NOT NULL CHECK (
    value_state IN ('reported', 'unavailable', 'unsupported', 'not_reported')
  ),
  payment_minor INTEGER CHECK (payment_minor IS NULL OR payment_minor >= 0),
  interest_rate_ppm INTEGER CHECK (
    interest_rate_ppm IS NULL OR interest_rate_ppm BETWEEN 0 AND 1000000
  ),
  next_payment_due_date TEXT,
  is_overdue INTEGER CHECK (is_overdue IS NULL OR is_overdue IN (0, 1)),
  effective_date TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  issues_json TEXT NOT NULL CHECK (
    json_valid(issues_json) AND json_type(issues_json) = 'array'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (proposal_id, natural_key_sha256),
  CHECK (
    (value_state = 'reported' AND balance_minor IS NOT NULL)
    OR (value_state <> 'reported' AND balance_minor IS NULL)
  ),
  CHECK (
    (kind IN ('credit_card', 'other_revolving')
      AND classification = 'revolving')
    OR (kind IN ('mortgage', 'student_loan', 'other_scheduled')
      AND classification = 'scheduled')
  )
);
CREATE INDEX liability_proposal_rows_proposal_idx
  ON liability_proposal_rows(proposal_id, natural_key_sha256);

CREATE TABLE liability_review_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL
    REFERENCES liability_proposals(id) ON DELETE RESTRICT,
  proposal_row_id TEXT NOT NULL UNIQUE
    REFERENCES liability_proposal_rows(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'excluded')),
  payment_treatment TEXT CHECK (
    payment_treatment IN (
      'reserve_from_liquidity', 'add_to_household_burn', 'already_in_plan'
    )
  ),
  change_note TEXT NOT NULL CHECK (length(change_note) BETWEEN 1 AND 500),
  decided_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (
    (decision = 'accepted' AND payment_treatment IS NOT NULL)
    OR (decision = 'excluded' AND payment_treatment IS NULL)
  )
);
CREATE INDEX liability_review_decisions_household_decided_idx
  ON liability_review_decisions(household_id, decided_at);

CREATE TRIGGER liability_proposals_integrity_insert
BEFORE INSERT ON liability_proposals
WHEN NEW.source = 'plaid'
BEGIN
  SELECT RAISE(ABORT, 'liability proposal connector mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM connector_accounts account
    JOIN connector_sync_runs run
      ON run.connector_account_id = account.id
      AND run.household_id = account.household_id
    WHERE account.id = NEW.connector_account_id
      AND account.household_id = NEW.household_id
      AND account.connector_type = 'plaid-liabilities'
      AND run.id = NEW.sync_run_id
      AND run.cursor = CASE NEW.refresh_kind
        WHEN 'initial' THEN 'liability-initial-v1'
        ELSE 'liability-live-v1'
      END
  );
END;

CREATE TRIGGER liability_proposal_rows_integrity_insert
BEFORE INSERT ON liability_proposal_rows
BEGIN
  SELECT RAISE(ABORT, 'liability proposal row mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM liability_proposals proposal
    WHERE proposal.id = NEW.proposal_id
      AND proposal.household_id = NEW.household_id
      AND proposal.source = NEW.source
  );
END;

CREATE TRIGGER liability_review_decisions_integrity_insert
BEFORE INSERT ON liability_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'liability review decision mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM liability_proposals proposal
    JOIN liability_proposal_rows row ON row.proposal_id = proposal.id
    WHERE proposal.id = NEW.proposal_id
      AND proposal.status = 'pending_review'
      AND proposal.household_id = NEW.household_id
      AND row.id = NEW.proposal_row_id
      AND row.household_id = NEW.household_id
  );

  SELECT RAISE(ABORT, 'unsupported liability cannot be accepted')
  WHERE NEW.decision = 'accepted'
    AND EXISTS (
      SELECT 1 FROM liability_proposal_rows row
      WHERE row.id = NEW.proposal_row_id
        AND row.value_state = 'unsupported'
    );

  SELECT RAISE(ABORT, 'liability payment treatment mismatch')
  WHERE NEW.decision = 'accepted'
    AND EXISTS (
      SELECT 1 FROM liability_proposal_rows row
      WHERE row.id = NEW.proposal_row_id
        AND (
          (row.payment_minor IS NULL
            AND NEW.payment_treatment <> 'already_in_plan')
          OR (row.classification = 'revolving'
            AND NEW.payment_treatment NOT IN (
              'reserve_from_liquidity', 'already_in_plan'
            ))
          OR (row.classification = 'scheduled'
            AND NEW.payment_treatment NOT IN (
              'add_to_household_burn', 'already_in_plan'
            ))
        )
    );
END;

CREATE TRIGGER liability_proposal_rows_no_update
BEFORE UPDATE ON liability_proposal_rows
BEGIN
  SELECT RAISE(ABORT, 'liability proposal rows are immutable');
END;

CREATE TRIGGER liability_proposals_update_transition
BEFORE UPDATE ON liability_proposals
WHEN NOT (
  OLD.status = 'pending_review'
  AND NEW.status = 'applied'
  AND NEW.id = OLD.id
  AND NEW.household_id = OLD.household_id
  AND NEW.connector_account_id IS OLD.connector_account_id
  AND NEW.sync_run_id IS OLD.sync_run_id
  AND NEW.source = OLD.source
  AND NEW.source_object_key IS OLD.source_object_key
  AND NEW.source_sha256 IS OLD.source_sha256
  AND NEW.normalized_fingerprint = OLD.normalized_fingerprint
  AND NEW.refresh_kind = OLD.refresh_kind
  AND NEW.observed_at = OLD.observed_at
  AND NEW.retrieved_at = OLD.retrieved_at
  AND NEW.created_at = OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'liability proposals only transition to applied');
END;

CREATE TRIGGER liability_proposals_no_delete
BEFORE DELETE ON liability_proposals
BEGIN
  SELECT RAISE(ABORT, 'liability proposals are immutable');
END;

CREATE TRIGGER liability_proposal_rows_no_delete
BEFORE DELETE ON liability_proposal_rows
BEGIN
  SELECT RAISE(ABORT, 'liability proposal rows are immutable');
END;

CREATE TRIGGER liability_review_decisions_no_update
BEFORE UPDATE ON liability_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'liability review decisions are immutable');
END;

CREATE TRIGGER liability_review_decisions_no_delete
BEFORE DELETE ON liability_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'liability review decisions are immutable');
END;
