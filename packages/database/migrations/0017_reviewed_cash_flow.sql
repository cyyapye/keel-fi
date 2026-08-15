PRAGMA foreign_keys = ON;

ALTER TABLE cash_balance_proposal_rows
  ADD COLUMN item_account_key_sha256 TEXT CHECK (
    item_account_key_sha256 IS NULL OR (
      length(item_account_key_sha256) = 64
      AND item_account_key_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  );
CREATE INDEX cash_balance_proposal_rows_item_account_key_idx
  ON cash_balance_proposal_rows(item_account_key_sha256);

CREATE TABLE cash_flow_connections (
  connector_account_id TEXT PRIMARY KEY NOT NULL
    REFERENCES connector_accounts(id) ON DELETE RESTRICT,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  confirmed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  policy_version TEXT NOT NULL CHECK (
    policy_version = 'observed-cash-flow-v1'
  ),
  pricing_confirmed_at TEXT NOT NULL,
  plaid_cursor TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX cash_flow_connections_household_idx
  ON cash_flow_connections(household_id, created_at);

CREATE TABLE cash_flow_activation_events (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connector_account_id TEXT NOT NULL
    REFERENCES connector_accounts(id) ON DELETE RESTRICT,
  confirmed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  policy_version TEXT NOT NULL CHECK (
    policy_version = 'observed-cash-flow-v1'
  ),
  pricing_confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX cash_flow_activation_events_household_created_idx
  ON cash_flow_activation_events(household_id, created_at);

CREATE TABLE cash_flow_transaction_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connector_account_id TEXT NOT NULL
    REFERENCES connector_accounts(id) ON DELETE RESTRICT,
  sync_run_id TEXT NOT NULL
    REFERENCES connector_sync_runs(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  mutation TEXT NOT NULL CHECK (mutation IN ('added', 'modified', 'removed')),
  transaction_key_sha256 TEXT NOT NULL CHECK (
    length(transaction_key_sha256) = 64
    AND transaction_key_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  account_key_sha256 TEXT CHECK (
    account_key_sha256 IS NULL OR (
      length(account_key_sha256) = 64
      AND account_key_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  effective_date TEXT,
  month TEXT,
  amount_minor INTEGER,
  pending INTEGER CHECK (pending IS NULL OR pending IN (0, 1)),
  category TEXT CHECK (
    category IS NULL OR category IN (
      'BANK_FEES', 'ENTERTAINMENT', 'FOOD_AND_DRINK',
      'GENERAL_MERCHANDISE', 'GENERAL_SERVICES',
      'GOVERNMENT_AND_NON_PROFIT', 'HOME_IMPROVEMENT', 'INCOME',
      'LOAN_PAYMENTS', 'MEDICAL', 'OTHER', 'PERSONAL_CARE',
      'RENT_AND_UTILITIES', 'TRANSFER_IN', 'TRANSFER_OUT',
      'TRANSPORTATION', 'TRAVEL'
    )
  ),
  currency_supported INTEGER CHECK (
    currency_supported IS NULL OR currency_supported IN (0, 1)
  ),
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (sync_run_id, sequence),
  UNIQUE (sync_run_id, transaction_key_sha256),
  CHECK (
    (mutation = 'removed'
      AND account_key_sha256 IS NULL
      AND effective_date IS NULL
      AND month IS NULL
      AND amount_minor IS NULL
      AND pending IS NULL
      AND category IS NULL
      AND currency_supported IS NULL)
    OR (mutation IN ('added', 'modified')
      AND account_key_sha256 IS NOT NULL
      AND effective_date IS NOT NULL
      AND month = substr(effective_date, 1, 7)
      AND pending IS NOT NULL
      AND category IS NOT NULL
      AND currency_supported IS NOT NULL
      AND ((currency_supported = 1 AND amount_minor IS NOT NULL)
        OR (currency_supported = 0 AND amount_minor IS NULL)))
  )
);
CREATE INDEX cash_flow_revisions_household_transaction_idx
  ON cash_flow_transaction_revisions(
    household_id, transaction_key_sha256, created_at, sequence
  );
CREATE INDEX cash_flow_revisions_connection_month_idx
  ON cash_flow_transaction_revisions(connector_account_id, month, created_at);

CREATE TABLE cash_flow_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  trigger_sync_run_id TEXT NOT NULL UNIQUE
    REFERENCES connector_sync_runs(id) ON DELETE RESTRICT,
  source_revision TEXT NOT NULL CHECK (
    length(source_revision) = 64
    AND source_revision NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'pending_review', 'ready_for_plan', 'reviewed_no_change', 'applied'
    )
  ),
  observed_at TEXT NOT NULL,
  period_start_month TEXT NOT NULL,
  period_end_month TEXT NOT NULL,
  transaction_count INTEGER NOT NULL CHECK (transaction_count > 0),
  pending_excluded_count INTEGER NOT NULL CHECK (pending_excluded_count >= 0),
  unsupported_excluded_count INTEGER NOT NULL CHECK (
    unsupported_excluded_count >= 0
  ),
  unreviewed_account_excluded_count INTEGER NOT NULL CHECK (
    unreviewed_account_excluded_count >= 0
  ),
  covered_connection_count INTEGER NOT NULL CHECK (
    covered_connection_count > 0
  ),
  base_cash_flow_plan_id TEXT NOT NULL
    REFERENCES cash_flow_plans(id) ON DELETE RESTRICT,
  base_forecast_snapshot_id TEXT NOT NULL
    REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  base_forecast_snapshot_version INTEGER NOT NULL CHECK (
    base_forecast_snapshot_version > 0
  ),
  household_burn_monthly_minor INTEGER NOT NULL CHECK (
    household_burn_monthly_minor >= 0
  ),
  business_burn_monthly_minor INTEGER NOT NULL CHECK (
    business_burn_monthly_minor >= 0
  ),
  debt_payment_context_monthly_minor INTEGER NOT NULL CHECK (
    debt_payment_context_monthly_minor >= 0
  ),
  protected_cash_floor_minor INTEGER NOT NULL CHECK (
    protected_cash_floor_minor >= 0
  ),
  fi_eligible_liquid_minor INTEGER NOT NULL CHECK (
    fi_eligible_liquid_minor >= 0
  ),
  suggested_household_burn_monthly_minor INTEGER CHECK (
    suggested_household_burn_monthly_minor IS NULL
    OR suggested_household_burn_monthly_minor >= 0
  ),
  suggested_business_burn_monthly_minor INTEGER CHECK (
    suggested_business_burn_monthly_minor IS NULL
    OR suggested_business_burn_monthly_minor >= 0
  ),
  reviewed_at TEXT,
  applied_cash_flow_plan_id TEXT
    REFERENCES cash_flow_plans(id) ON DELETE RESTRICT,
  applied_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, source_revision),
  CHECK (period_start_month <= period_end_month),
  CHECK (
    (status = 'pending_review'
      AND suggested_household_burn_monthly_minor IS NULL
      AND suggested_business_burn_monthly_minor IS NULL
      AND reviewed_at IS NULL
      AND applied_cash_flow_plan_id IS NULL
      AND applied_at IS NULL)
    OR (status = 'ready_for_plan'
      AND suggested_household_burn_monthly_minor IS NOT NULL
      AND suggested_business_burn_monthly_minor IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND applied_cash_flow_plan_id IS NULL
      AND applied_at IS NULL)
    OR (status = 'reviewed_no_change'
      AND suggested_household_burn_monthly_minor IS NULL
      AND suggested_business_burn_monthly_minor IS NULL
      AND reviewed_at IS NOT NULL
      AND applied_cash_flow_plan_id IS NULL
      AND applied_at IS NULL)
    OR (status = 'applied'
      AND suggested_household_burn_monthly_minor IS NOT NULL
      AND suggested_business_burn_monthly_minor IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND applied_cash_flow_plan_id IS NOT NULL
      AND applied_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX cash_flow_proposals_household_action_unique
  ON cash_flow_proposals(household_id)
  WHERE status IN ('pending_review', 'ready_for_plan');
CREATE INDEX cash_flow_proposals_household_created_idx
  ON cash_flow_proposals(household_id, created_at);

CREATE TABLE cash_flow_proposal_months (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL
    REFERENCES cash_flow_proposals(id) ON DELETE RESTRICT,
  month TEXT NOT NULL,
  outflow_minor INTEGER NOT NULL CHECK (outflow_minor >= 0),
  transaction_count INTEGER NOT NULL CHECK (transaction_count > 0),
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (proposal_id, month)
);
CREATE INDEX cash_flow_proposal_months_proposal_idx
  ON cash_flow_proposal_months(proposal_id, month);

CREATE TABLE cash_flow_proposal_categories (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL
    REFERENCES cash_flow_proposals(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (
    category IN (
      'BANK_FEES', 'ENTERTAINMENT', 'FOOD_AND_DRINK',
      'GENERAL_MERCHANDISE', 'GENERAL_SERVICES',
      'GOVERNMENT_AND_NON_PROFIT', 'HOME_IMPROVEMENT', 'INCOME',
      'LOAN_PAYMENTS', 'MEDICAL', 'OTHER', 'PERSONAL_CARE',
      'RENT_AND_UTILITIES', 'TRANSFER_IN', 'TRANSFER_OUT',
      'TRANSPORTATION', 'TRAVEL'
    )
  ),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  average_monthly_minor INTEGER NOT NULL CHECK (average_monthly_minor >= 0),
  transaction_count INTEGER NOT NULL CHECK (transaction_count > 0),
  default_treatment TEXT NOT NULL CHECK (
    default_treatment IN ('household', 'business', 'excluded', 'debt_payment')
  ),
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (proposal_id, category)
);
CREATE INDEX cash_flow_proposal_categories_proposal_idx
  ON cash_flow_proposal_categories(proposal_id, category);

CREATE TABLE cash_flow_review_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL
    REFERENCES cash_flow_proposals(id) ON DELETE RESTRICT,
  proposal_category_id TEXT NOT NULL UNIQUE
    REFERENCES cash_flow_proposal_categories(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  treatment TEXT NOT NULL CHECK (
    treatment IN ('household', 'business', 'excluded', 'debt_payment')
  ),
  change_note TEXT NOT NULL CHECK (length(change_note) BETWEEN 1 AND 500),
  decided_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX cash_flow_review_decisions_household_decided_idx
  ON cash_flow_review_decisions(household_id, decided_at);

CREATE TRIGGER cash_flow_connections_integrity_insert
BEFORE INSERT ON cash_flow_connections
BEGIN
  SELECT RAISE(ABORT, 'cash flow connection mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM connector_accounts account
    WHERE account.id = NEW.connector_account_id
      AND account.household_id = NEW.household_id
      AND account.connector_type = 'plaid-cash'
  );
END;

CREATE TRIGGER cash_flow_revisions_integrity_insert
BEFORE INSERT ON cash_flow_transaction_revisions
BEGIN
  SELECT RAISE(ABORT, 'cash flow revision mismatch')
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
      AND run.cursor IN (
        'cash-flow-initial-v1', 'cash-flow-incremental-v1'
      )
  );
END;

CREATE TRIGGER cash_flow_activation_events_integrity_insert
BEFORE INSERT ON cash_flow_activation_events
BEGIN
  SELECT RAISE(ABORT, 'cash flow activation mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM connector_accounts account
    WHERE account.id = NEW.connector_account_id
      AND account.household_id = NEW.household_id
      AND account.connector_type = 'plaid-cash'
  );
END;

CREATE TRIGGER cash_flow_proposals_integrity_insert
BEFORE INSERT ON cash_flow_proposals
BEGIN
  SELECT RAISE(ABORT, 'cash flow proposal mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM connector_sync_runs run
    WHERE run.id = NEW.trigger_sync_run_id
      AND run.household_id = NEW.household_id
      AND run.cursor IN (
        'cash-flow-initial-v1', 'cash-flow-incremental-v1'
      )
  );
END;

CREATE TRIGGER cash_flow_proposal_months_integrity_insert
BEFORE INSERT ON cash_flow_proposal_months
BEGIN
  SELECT RAISE(ABORT, 'cash flow proposal month mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM cash_flow_proposals proposal
    WHERE proposal.id = NEW.proposal_id
      AND proposal.household_id = NEW.household_id
      AND NEW.month BETWEEN proposal.period_start_month
        AND proposal.period_end_month
  );
END;

CREATE TRIGGER cash_flow_proposal_categories_integrity_insert
BEFORE INSERT ON cash_flow_proposal_categories
BEGIN
  SELECT RAISE(ABORT, 'cash flow proposal category mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM cash_flow_proposals proposal
    WHERE proposal.id = NEW.proposal_id
      AND proposal.household_id = NEW.household_id
  );
END;

CREATE TRIGGER cash_flow_review_decisions_integrity_insert
BEFORE INSERT ON cash_flow_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash flow review decision mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM cash_flow_proposals proposal
    JOIN cash_flow_proposal_categories category
      ON category.proposal_id = proposal.id
      AND category.household_id = proposal.household_id
    WHERE proposal.id = NEW.proposal_id
      AND proposal.household_id = NEW.household_id
      AND proposal.status = 'pending_review'
      AND category.id = NEW.proposal_category_id
  );
END;

CREATE TRIGGER cash_flow_connections_update_boundary
BEFORE UPDATE ON cash_flow_connections
WHEN NOT (
  NEW.connector_account_id = OLD.connector_account_id
  AND NEW.household_id = OLD.household_id
  AND NEW.confirmed_by_user_id = OLD.confirmed_by_user_id
  AND NEW.policy_version = OLD.policy_version
  AND NEW.pricing_confirmed_at = OLD.pricing_confirmed_at
  AND NEW.created_at = OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'cash flow consent is immutable');
END;

CREATE TRIGGER cash_flow_activation_events_no_update
BEFORE UPDATE ON cash_flow_activation_events
BEGIN
  SELECT RAISE(ABORT, 'cash flow activation events are immutable');
END;

CREATE TRIGGER cash_flow_activation_events_no_delete
BEFORE DELETE ON cash_flow_activation_events
BEGIN
  SELECT RAISE(ABORT, 'cash flow activation events are immutable');
END;

CREATE TRIGGER cash_flow_revisions_no_update
BEFORE UPDATE ON cash_flow_transaction_revisions
BEGIN
  SELECT RAISE(ABORT, 'cash flow transaction revisions are immutable');
END;

CREATE TRIGGER cash_flow_proposals_update_transition
BEFORE UPDATE ON cash_flow_proposals
WHEN NOT (
  NEW.id = OLD.id
  AND NEW.household_id = OLD.household_id
  AND NEW.trigger_sync_run_id = OLD.trigger_sync_run_id
  AND NEW.source_revision = OLD.source_revision
  AND NEW.observed_at = OLD.observed_at
  AND NEW.period_start_month = OLD.period_start_month
  AND NEW.period_end_month = OLD.period_end_month
  AND NEW.transaction_count = OLD.transaction_count
  AND NEW.pending_excluded_count = OLD.pending_excluded_count
  AND NEW.unsupported_excluded_count = OLD.unsupported_excluded_count
  AND NEW.unreviewed_account_excluded_count
    = OLD.unreviewed_account_excluded_count
  AND NEW.covered_connection_count = OLD.covered_connection_count
  AND NEW.base_cash_flow_plan_id = OLD.base_cash_flow_plan_id
  AND NEW.base_forecast_snapshot_id = OLD.base_forecast_snapshot_id
  AND NEW.base_forecast_snapshot_version
    = OLD.base_forecast_snapshot_version
  AND NEW.household_burn_monthly_minor = OLD.household_burn_monthly_minor
  AND NEW.business_burn_monthly_minor = OLD.business_burn_monthly_minor
  AND NEW.debt_payment_context_monthly_minor
    = OLD.debt_payment_context_monthly_minor
  AND NEW.protected_cash_floor_minor = OLD.protected_cash_floor_minor
  AND NEW.fi_eligible_liquid_minor = OLD.fi_eligible_liquid_minor
  AND NEW.created_at = OLD.created_at
  AND (
    (
      OLD.status = 'pending_review'
      AND NEW.status IN ('ready_for_plan', 'reviewed_no_change')
      AND NEW.reviewed_at IS NOT NULL
      AND NEW.applied_cash_flow_plan_id IS NULL
      AND NEW.applied_at IS NULL
    )
    OR (
      OLD.status = 'ready_for_plan'
      AND NEW.status = 'applied'
      AND NEW.suggested_household_burn_monthly_minor
        = OLD.suggested_household_burn_monthly_minor
      AND NEW.suggested_business_burn_monthly_minor
        = OLD.suggested_business_burn_monthly_minor
      AND NEW.reviewed_at = OLD.reviewed_at
      AND NEW.applied_cash_flow_plan_id IS NOT NULL
      AND NEW.applied_at IS NOT NULL
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'cash flow proposal transition is invalid');
END;

CREATE TRIGGER cash_flow_proposals_no_delete
BEFORE DELETE ON cash_flow_proposals
BEGIN
  SELECT RAISE(ABORT, 'cash flow proposals are immutable');
END;

CREATE TRIGGER cash_flow_proposal_months_no_update
BEFORE UPDATE ON cash_flow_proposal_months
BEGIN
  SELECT RAISE(ABORT, 'cash flow proposal months are immutable');
END;

CREATE TRIGGER cash_flow_proposal_months_no_delete
BEFORE DELETE ON cash_flow_proposal_months
BEGIN
  SELECT RAISE(ABORT, 'cash flow proposal months are immutable');
END;

CREATE TRIGGER cash_flow_proposal_categories_no_update
BEFORE UPDATE ON cash_flow_proposal_categories
BEGIN
  SELECT RAISE(ABORT, 'cash flow proposal categories are immutable');
END;

CREATE TRIGGER cash_flow_proposal_categories_no_delete
BEFORE DELETE ON cash_flow_proposal_categories
BEGIN
  SELECT RAISE(ABORT, 'cash flow proposal categories are immutable');
END;

CREATE TRIGGER cash_flow_review_decisions_no_update
BEFORE UPDATE ON cash_flow_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash flow review decisions are immutable');
END;

CREATE TRIGGER cash_flow_review_decisions_no_delete
BEFORE DELETE ON cash_flow_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'cash flow review decisions are immutable');
END;
