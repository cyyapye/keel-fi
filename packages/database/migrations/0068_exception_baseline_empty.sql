-- Allow an explicitly reviewed plan with no remaining holdings.

PRAGMA defer_foreign_keys = ON;

DROP TRIGGER portfolio_baseline_cash_items_integrity_insert;

DROP TRIGGER portfolio_baseline_items_integrity_insert;

DROP TRIGGER portfolio_baseline_policy_decisions_integrity;

DROP TRIGGER portfolio_baselines_integrity_insert;

DROP TRIGGER portfolio_baselines_no_delete;

DROP TRIGGER portfolio_baselines_no_update;

CREATE TABLE portfolio_baselines_empty (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  source_revision TEXT NOT NULL CHECK (
    length(source_revision) = 64
    AND source_revision NOT GLOB '*[^0-9a-f]*'
  ),
  source_observed_at TEXT NOT NULL,
  position_count INTEGER NOT NULL CHECK (position_count >= 0),
  public_market_value_minor INTEGER NOT NULL
    CHECK (public_market_value_minor >= 0),
  private_paper_value_minor INTEGER NOT NULL
    CHECK (private_paper_value_minor >= 0),
  unknown_value_count INTEGER NOT NULL CHECK (
    unknown_value_count BETWEEN 0 AND position_count
  ),
  potential_duplicate_count INTEGER NOT NULL CHECK (
    potential_duplicate_count BETWEEN 0 AND position_count
  ),
  prior_fi_eligible_liquid_minor INTEGER NOT NULL
    CHECK (prior_fi_eligible_liquid_minor >= 0),
  fi_eligible_liquid_minor INTEGER NOT NULL
    CHECK (fi_eligible_liquid_minor >= 0),
  base_forecast_snapshot_id TEXT NOT NULL
    REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  cash_flow_plan_id TEXT NOT NULL UNIQUE
    REFERENCES cash_flow_plans(id) ON DELETE RESTRICT,
  forecast_snapshot_id TEXT NOT NULL UNIQUE
    REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  goal_version_id TEXT REFERENCES goal_versions(id) ON DELETE RESTRICT,
  change_note TEXT NOT NULL CHECK (length(change_note) BETWEEN 1 AND 500),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
, cash_account_count INTEGER NOT NULL DEFAULT 0
    CHECK (cash_account_count >= 0), cash_account_value_minor INTEGER NOT NULL DEFAULT 0
    CHECK (cash_account_value_minor >= 0), unknown_cash_account_count INTEGER NOT NULL DEFAULT 0
    CHECK (unknown_cash_account_count BETWEEN 0 AND cash_account_count));

INSERT INTO portfolio_baselines_empty (id,household_id,source_revision,source_observed_at,position_count,public_market_value_minor,private_paper_value_minor,unknown_value_count,potential_duplicate_count,prior_fi_eligible_liquid_minor,fi_eligible_liquid_minor,base_forecast_snapshot_id,cash_flow_plan_id,forecast_snapshot_id,goal_version_id,change_note,created_by_user_id,created_at,immutable,cash_account_count,cash_account_value_minor,unknown_cash_account_count) SELECT id,household_id,source_revision,source_observed_at,position_count,public_market_value_minor,private_paper_value_minor,unknown_value_count,potential_duplicate_count,prior_fi_eligible_liquid_minor,fi_eligible_liquid_minor,base_forecast_snapshot_id,cash_flow_plan_id,forecast_snapshot_id,goal_version_id,change_note,created_by_user_id,created_at,immutable,cash_account_count,cash_account_value_minor,unknown_cash_account_count FROM portfolio_baselines;

DROP TABLE portfolio_baselines;

ALTER TABLE portfolio_baselines_empty RENAME TO portfolio_baselines;

CREATE INDEX portfolio_baselines_household_created_idx
  ON portfolio_baselines(household_id, created_at);

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

CREATE TRIGGER portfolio_baseline_items_integrity_insert
BEFORE INSERT ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline item identity mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM portfolio_baselines baseline
    JOIN holding_positions position
      ON position.household_id = baseline.household_id
    JOIN holding_position_snapshots snapshot
      ON snapshot.position_id = position.id
      AND snapshot.household_id = position.household_id
    WHERE baseline.id = NEW.baseline_id
      AND baseline.household_id = NEW.household_id
      AND position.id = NEW.position_id
      AND snapshot.id = NEW.snapshot_id
      AND position.provider = NEW.provider
  );

  SELECT RAISE(ABORT, 'portfolio baseline item is not an accepted snapshot')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_applications application
    WHERE application.household_id = NEW.household_id
      AND application.position_id = NEW.position_id
      AND application.snapshot_id = NEW.snapshot_id
  );
END;

CREATE TRIGGER portfolio_baseline_policy_decisions_integrity
BEFORE INSERT ON portfolio_baseline_policy_decisions
BEGIN
  SELECT RAISE(ABORT, 'baseline policy household mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM portfolio_baselines current
    JOIN portfolio_baselines prior ON prior.household_id = current.household_id
    WHERE current.id = NEW.baseline_id AND prior.id = NEW.prior_baseline_id
      AND current.id <> prior.id
  );
END;

CREATE TRIGGER portfolio_baselines_integrity_insert
BEFORE INSERT ON portfolio_baselines
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline forecast identity mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM forecast_snapshots base
    JOIN forecast_snapshots next
      ON next.household_id = base.household_id
      AND next.scenario_id = base.scenario_id
      AND next.version = base.version + 1
    JOIN cash_flow_plans plan
      ON plan.household_id = base.household_id
      AND plan.scenario_id = base.scenario_id
    WHERE base.id = NEW.base_forecast_snapshot_id
      AND next.id = NEW.forecast_snapshot_id
      AND plan.id = NEW.cash_flow_plan_id
      AND base.household_id = NEW.household_id
      AND next.trigger = 'Portfolio baseline'
      AND plan.fi_eligible_liquid_minor = NEW.fi_eligible_liquid_minor
  );

  SELECT RAISE(ABORT, 'portfolio baseline goal identity mismatch')
  WHERE NEW.goal_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM goal_versions version
    JOIN goals goal ON goal.id = version.goal_id
    WHERE version.id = NEW.goal_version_id
      AND version.household_id = NEW.household_id
      AND goal.household_id = NEW.household_id
      AND goal.template_key = 'financial_independence'
      AND version.current_value_integer = NEW.fi_eligible_liquid_minor
  );
END;

CREATE TRIGGER portfolio_baselines_no_delete
BEFORE DELETE ON portfolio_baselines
BEGIN
  SELECT RAISE(ABORT, 'portfolio baselines are immutable');
END;

CREATE TRIGGER portfolio_baselines_no_update
BEFORE UPDATE ON portfolio_baselines
BEGIN
  SELECT RAISE(ABORT, 'portfolio baselines are immutable');
END;

-- Distinguish selective refreshes from the earlier whole-baseline policy.
DROP TRIGGER portfolio_baseline_policy_decisions_integrity;
DROP TRIGGER portfolio_baseline_policy_decisions_no_update;
DROP TRIGGER portfolio_baseline_policy_decisions_no_delete;
CREATE TABLE portfolio_baseline_policy_decisions_selective (
  baseline_id TEXT PRIMARY KEY NOT NULL REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  prior_baseline_id TEXT NOT NULL REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  policy_version TEXT NOT NULL CHECK (policy_version IN ('accepted-sources-auto-v1', 'accepted-sources-auto-v2'))
);
INSERT INTO portfolio_baseline_policy_decisions_selective SELECT * FROM portfolio_baseline_policy_decisions;
DROP TABLE portfolio_baseline_policy_decisions;
ALTER TABLE portfolio_baseline_policy_decisions_selective RENAME TO portfolio_baseline_policy_decisions;
CREATE TRIGGER portfolio_baseline_policy_decisions_integrity
BEFORE INSERT ON portfolio_baseline_policy_decisions
BEGIN
  SELECT RAISE(ABORT, 'baseline policy household mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM portfolio_baselines current
    JOIN portfolio_baselines prior ON prior.household_id = current.household_id
    WHERE current.id = NEW.baseline_id AND prior.id = NEW.prior_baseline_id
      AND current.id <> prior.id
  );
END;
CREATE TRIGGER portfolio_baseline_policy_decisions_no_update
BEFORE UPDATE ON portfolio_baseline_policy_decisions
BEGIN SELECT RAISE(ABORT, 'baseline policy decisions are immutable'); END;
CREATE TRIGGER portfolio_baseline_policy_decisions_no_delete
BEFORE DELETE ON portfolio_baseline_policy_decisions
BEGIN SELECT RAISE(ABORT, 'baseline policy decisions are immutable'); END;

PRAGMA defer_foreign_keys = OFF;
