PRAGMA foreign_keys = ON;

CREATE TABLE goals (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  template_key TEXT NOT NULL CHECK (
    template_key IN (
      'financial_independence',
      'cash_runway',
      'major_purchase',
      'custom'
    )
  ),
  is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX goals_household_idx ON goals(household_id);
CREATE UNIQUE INDEX goals_household_primary_unique
  ON goals(household_id)
  WHERE is_primary = 1;

CREATE TABLE goal_versions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_label TEXT NOT NULL,
  target_value_integer INTEGER CHECK (
    target_value_integer IS NULL OR target_value_integer >= 0
  ),
  target_unit TEXT NOT NULL CHECK (
    target_unit IN ('minor_units', 'months', 'ppm', 'count')
  ),
  target_date TEXT,
  current_value_integer INTEGER NOT NULL CHECK (current_value_integer >= 0),
  current_value_source TEXT NOT NULL,
  change_note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (goal_id, version)
);
CREATE INDEX goal_versions_household_goal_idx
  ON goal_versions(household_id, goal_id);

CREATE TABLE goal_forecast_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  goal_version_id TEXT NOT NULL UNIQUE
    REFERENCES goal_versions(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  model_status TEXT NOT NULL CHECK (
    model_status IN ('modeled', 'not_configured')
  ),
  lower_value_integer INTEGER CHECK (
    lower_value_integer IS NULL OR lower_value_integer >= 0
  ),
  middle_value_integer INTEGER CHECK (
    middle_value_integer IS NULL OR middle_value_integer >= 0
  ),
  higher_value_integer INTEGER CHECK (
    higher_value_integer IS NULL OR higher_value_integer >= 0
  ),
  success_probability_ppm INTEGER CHECK (
    success_probability_ppm IS NULL
    OR success_probability_ppm BETWEEN 0 AND 1000000
  ),
  unit TEXT NOT NULL CHECK (
    unit IN ('minor_units', 'months', 'ppm', 'count')
  ),
  horizon_date TEXT,
  methodology TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (
    model_status = 'not_configured'
    OR (
      lower_value_integer <= middle_value_integer
      AND middle_value_integer <= higher_value_integer
    )
  )
);
CREATE INDEX goal_forecast_snapshots_household_idx
  ON goal_forecast_snapshots(household_id);

CREATE TRIGGER goal_versions_no_update
BEFORE UPDATE ON goal_versions
BEGIN
  SELECT RAISE(ABORT, 'goal versions are immutable');
END;

CREATE TRIGGER goal_versions_no_delete
BEFORE DELETE ON goal_versions
BEGIN
  SELECT RAISE(ABORT, 'goal versions are immutable');
END;

CREATE TRIGGER goal_forecast_snapshots_no_update
BEFORE UPDATE ON goal_forecast_snapshots
BEGIN
  SELECT RAISE(ABORT, 'goal forecast snapshots are immutable');
END;

CREATE TRIGGER goal_forecast_snapshots_no_delete
BEFORE DELETE ON goal_forecast_snapshots
BEGIN
  SELECT RAISE(ABORT, 'goal forecast snapshots are immutable');
END;
