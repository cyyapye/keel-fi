PRAGMA foreign_keys = ON;

CREATE TABLE portfolio_baselines (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  source_revision TEXT NOT NULL CHECK (
    length(source_revision) = 64
    AND source_revision NOT GLOB '*[^0-9a-f]*'
  ),
  source_observed_at TEXT NOT NULL,
  position_count INTEGER NOT NULL CHECK (position_count > 0),
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
);
CREATE INDEX portfolio_baselines_household_created_idx
  ON portfolio_baselines(household_id, created_at);

CREATE TABLE portfolio_baseline_items (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  baseline_id TEXT NOT NULL
    REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL
    REFERENCES holding_positions(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('angellist', 'robinhood')),
  classification TEXT NOT NULL CHECK (
    classification IN ('public_market', 'private_paper')
  ),
  value_minor INTEGER CHECK (value_minor IS NULL OR value_minor >= 0),
  value_state TEXT NOT NULL CHECK (
    value_state IN ('reported', 'locked', 'not_reported')
  ),
  observed_at TEXT NOT NULL,
  duplicate_key TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (baseline_id, position_id),
  CHECK (
    (provider = 'robinhood' AND classification = 'public_market')
    OR (provider = 'angellist' AND classification = 'private_paper')
  ),
  CHECK (
    (value_state = 'reported' AND value_minor IS NOT NULL)
    OR (value_state <> 'reported' AND value_minor IS NULL)
  )
);
CREATE INDEX portfolio_baseline_items_baseline_idx
  ON portfolio_baseline_items(baseline_id, position_id);

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
END;

CREATE TRIGGER portfolio_baselines_no_update
BEFORE UPDATE ON portfolio_baselines
BEGIN
  SELECT RAISE(ABORT, 'portfolio baselines are immutable');
END;

CREATE TRIGGER portfolio_baselines_no_delete
BEFORE DELETE ON portfolio_baselines
BEGIN
  SELECT RAISE(ABORT, 'portfolio baselines are immutable');
END;

CREATE TRIGGER portfolio_baseline_items_no_update
BEFORE UPDATE ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline items are immutable');
END;

CREATE TRIGGER portfolio_baseline_items_no_delete
BEFORE DELETE ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline items are immutable');
END;

CREATE TRIGGER portfolio_baseline_cash_flow_plans_no_update
BEFORE UPDATE ON cash_flow_plans
WHEN EXISTS (
  SELECT 1
  FROM portfolio_baselines baseline
  WHERE baseline.cash_flow_plan_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline cash flow plans are immutable');
END;

CREATE TRIGGER portfolio_baseline_cash_flow_plans_no_delete
BEFORE DELETE ON cash_flow_plans
WHEN EXISTS (
  SELECT 1
  FROM portfolio_baselines baseline
  WHERE baseline.cash_flow_plan_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline cash flow plans are immutable');
END;
