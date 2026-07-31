PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  access_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE households (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL CHECK (length(base_currency) = 3),
  created_at TEXT NOT NULL,
  UNIQUE (owner_user_id, name)
);
CREATE INDEX households_owner_user_idx ON households(owner_user_id);

CREATE TABLE companies (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  legal_name TEXT NOT NULL,
  website_host TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'exited', 'written_off')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, legal_name)
);
CREATE INDEX companies_household_idx ON companies(household_id);

CREATE TABLE asset_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (
    account_type IN ('direct', 'spv', 'fund', 'brokerage', 'cash')
  ),
  administrator_label TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, name)
);
CREATE INDEX asset_accounts_household_idx ON asset_accounts(household_id);

CREATE TABLE private_vehicles (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('spv', 'fund', 'trust')),
  created_at TEXT NOT NULL,
  UNIQUE (household_id, name)
);
CREATE INDEX private_vehicles_household_idx ON private_vehicles(household_id);

CREATE TABLE asset_lots (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  asset_account_id TEXT NOT NULL REFERENCES asset_accounts(id) ON DELETE RESTRICT,
  private_vehicle_id TEXT REFERENCES private_vehicles(id) ON DELETE RESTRICT,
  lot_label TEXT NOT NULL,
  security_type TEXT NOT NULL,
  quantity_scaled INTEGER NOT NULL,
  quantity_scale INTEGER NOT NULL CHECK (quantity_scale >= 0),
  acquisition_date TEXT NOT NULL,
  cost_basis_minor INTEGER NOT NULL CHECK (cost_basis_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  created_at TEXT NOT NULL,
  UNIQUE (asset_account_id, lot_label)
);
CREATE INDEX asset_lots_household_company_idx
  ON asset_lots(household_id, company_id);

CREATE TABLE mark_sources (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  confidence_ppm INTEGER NOT NULL
    CHECK (confidence_ppm BETWEEN 0 AND 1000000),
  created_at TEXT NOT NULL
);
CREATE INDEX mark_sources_household_idx ON mark_sources(household_id);

CREATE TABLE marks (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  asset_lot_id TEXT REFERENCES asset_lots(id) ON DELETE RESTRICT,
  mark_source_id TEXT NOT NULL REFERENCES mark_sources(id) ON DELETE RESTRICT,
  mark_kind TEXT NOT NULL CHECK (
    mark_kind IN (
      'administrator_nav',
      'external_mark',
      'fi_underwriting',
      'thesis_weighted',
      'usable_liquidity'
    )
  ),
  value_minor INTEGER NOT NULL CHECK (value_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  effective_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (
    review_status IN ('accepted', 'proposed', 'rejected')
  ),
  created_at TEXT NOT NULL,
  UNIQUE (asset_lot_id, mark_kind, effective_at)
);
CREATE INDEX marks_household_company_kind_idx
  ON marks(household_id, company_id, mark_kind);

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  effective_date TEXT,
  retrieved_at TEXT NOT NULL,
  source_label TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (
    review_status IN ('pending_review', 'accepted', 'rejected')
  ),
  created_at TEXT NOT NULL,
  UNIQUE (household_id, sha256)
);
CREATE INDEX source_documents_household_idx
  ON source_documents(household_id);

CREATE TABLE evidence_events (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT,
  source_document_id TEXT REFERENCES source_documents(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  headline TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending_review', 'accepted', 'rejected', 'scenario_only')
  ),
  confidence_ppm INTEGER NOT NULL
    CHECK (confidence_ppm BETWEEN 0 AND 1000000),
  prior_value_json TEXT,
  replacement_value_json TEXT,
  estimated_forecast_impact_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (
    status <> 'accepted'
    OR (prior_value_json IS NOT NULL AND replacement_value_json IS NOT NULL)
  )
);
CREATE INDEX evidence_events_household_status_idx
  ON evidence_events(household_id, status, detected_at);

CREATE TABLE evidence_claims (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  evidence_event_id TEXT NOT NULL REFERENCES evidence_events(id) ON DELETE RESTRICT,
  field_path TEXT NOT NULL,
  claim_value_json TEXT NOT NULL,
  unit TEXT,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (evidence_event_id, field_path)
);
CREATE INDEX evidence_claims_event_idx
  ON evidence_claims(evidence_event_id);

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  evidence_event_id TEXT NOT NULL UNIQUE REFERENCES evidence_events(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (
    decision IN ('accepted', 'rejected', 'scenario_only')
  ),
  rationale TEXT NOT NULL,
  prior_value_json TEXT NOT NULL,
  replacement_value_json TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE INDEX review_decisions_household_idx
  ON review_decisions(household_id);

CREATE TABLE scenarios (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  is_sandbox INTEGER NOT NULL CHECK (is_sandbox IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, name)
);
CREATE INDEX scenarios_household_idx ON scenarios(household_id);

CREATE TABLE scenario_assumptions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  assumption_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value_integer INTEGER NOT NULL,
  value_scale INTEGER NOT NULL CHECK (value_scale >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('ppm', 'months', 'minor_units')),
  provenance TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (scenario_id, assumption_key, effective_date)
);
CREATE INDEX scenario_assumptions_household_scenario_idx
  ON scenario_assumptions(household_id, scenario_id);

CREATE TABLE tax_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  assumed_tax_rate_ppm INTEGER NOT NULL
    CHECK (assumed_tax_rate_ppm BETWEEN 0 AND 1000000),
  effective_date TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX tax_profiles_household_idx ON tax_profiles(household_id);

CREATE TABLE cash_flow_plans (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  household_burn_monthly_minor INTEGER NOT NULL
    CHECK (household_burn_monthly_minor >= 0),
  business_burn_monthly_minor INTEGER NOT NULL
    CHECK (business_burn_monthly_minor >= 0),
  fi_eligible_liquid_minor INTEGER NOT NULL
    CHECK (fi_eligible_liquid_minor >= 0),
  protected_cash_floor_minor INTEGER NOT NULL
    CHECK (protected_cash_floor_minor >= 0),
  fi_target_minor INTEGER NOT NULL CHECK (fi_target_minor >= 0),
  effective_date TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (scenario_id, effective_date)
);
CREATE INDEX cash_flow_plans_household_scenario_idx
  ON cash_flow_plans(household_id, scenario_id, effective_date);

CREATE TABLE forecast_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  input_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  trigger TEXT NOT NULL,
  attributed_change TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (scenario_id, version)
);
CREATE INDEX forecast_snapshots_household_created_idx
  ON forecast_snapshots(household_id, created_at);

CREATE TABLE company_forecasts (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  forecast_snapshot_id TEXT NOT NULL REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  conditional_value_minor INTEGER NOT NULL
    CHECK (conditional_value_minor >= 0),
  timing_adjusted_liquidity_minor INTEGER NOT NULL
    CHECK (timing_adjusted_liquidity_minor >= 0),
  probability_zero_ppm INTEGER NOT NULL
    CHECK (probability_zero_ppm BETWEEN 0 AND 1000000),
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (forecast_snapshot_id, company_id)
);
CREATE INDEX company_forecasts_snapshot_idx
  ON company_forecasts(forecast_snapshot_id);

CREATE TABLE liquidity_curves (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  forecast_snapshot_id TEXT NOT NULL REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  year INTEGER NOT NULL,
  p25_minor INTEGER NOT NULL CHECK (p25_minor >= 0),
  p50_minor INTEGER NOT NULL CHECK (p50_minor >= 0),
  p75_minor INTEGER NOT NULL CHECK (p75_minor >= 0),
  expected_minor INTEGER NOT NULL CHECK (expected_minor >= 0),
  probability_zero_ppm INTEGER NOT NULL
    CHECK (probability_zero_ppm BETWEEN 0 AND 1000000),
  created_at TEXT NOT NULL,
  UNIQUE (forecast_snapshot_id, year)
);
CREATE INDEX liquidity_curves_scenario_year_idx
  ON liquidity_curves(scenario_id, year);

CREATE TABLE forecast_outputs (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  forecast_snapshot_id TEXT NOT NULL REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  metric_key TEXT NOT NULL,
  horizon_date TEXT NOT NULL,
  percentile INTEGER,
  value_minor INTEGER,
  probability_ppm INTEGER,
  created_at TEXT NOT NULL,
  CHECK (value_minor IS NULL OR value_minor >= 0),
  CHECK (
    probability_ppm IS NULL
    OR probability_ppm BETWEEN 0 AND 1000000
  ),
  UNIQUE (forecast_snapshot_id, metric_key, horizon_date, percentile)
);
CREATE INDEX forecast_outputs_snapshot_idx
  ON forecast_outputs(forecast_snapshot_id);

CREATE TABLE actual_liquidity_events (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT,
  asset_lot_id TEXT REFERENCES asset_lots(id) ON DELETE RESTRICT,
  source_document_id TEXT REFERENCES source_documents(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX actual_liquidity_events_household_occurred_idx
  ON actual_liquidity_events(household_id, occurred_at);

CREATE TABLE connector_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connector_type TEXT NOT NULL,
  display_label TEXT NOT NULL,
  secret_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'revoked')),
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, connector_type, display_label)
);
CREATE INDEX connector_accounts_household_idx
  ON connector_accounts(household_id);

CREATE TABLE connector_sync_runs (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connector_account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed')
  ),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  cursor TEXT,
  discovered_count INTEGER NOT NULL CHECK (discovered_count >= 0),
  proposed_count INTEGER NOT NULL CHECK (proposed_count >= 0),
  error_code TEXT
);
CREATE INDEX connector_sync_runs_account_started_idx
  ON connector_sync_runs(connector_account_id, started_at);

-- Immutable forecast history: create a new snapshot instead of rewriting one.
CREATE TRIGGER forecast_snapshots_no_update
BEFORE UPDATE ON forecast_snapshots
BEGIN
  SELECT RAISE(ABORT, 'forecast snapshots are immutable');
END;

CREATE TRIGGER forecast_snapshots_no_delete
BEFORE DELETE ON forecast_snapshots
BEGIN
  SELECT RAISE(ABORT, 'forecast snapshots are immutable');
END;

CREATE TRIGGER forecast_outputs_no_update
BEFORE UPDATE ON forecast_outputs
BEGIN
  SELECT RAISE(ABORT, 'forecast outputs are immutable');
END;

CREATE TRIGGER forecast_outputs_no_delete
BEFORE DELETE ON forecast_outputs
BEGIN
  SELECT RAISE(ABORT, 'forecast outputs are immutable');
END;

CREATE TRIGGER company_forecasts_no_update
BEFORE UPDATE ON company_forecasts
BEGIN
  SELECT RAISE(ABORT, 'company forecasts are immutable');
END;

CREATE TRIGGER company_forecasts_no_delete
BEFORE DELETE ON company_forecasts
BEGIN
  SELECT RAISE(ABORT, 'company forecasts are immutable');
END;

CREATE TRIGGER liquidity_curves_no_update
BEFORE UPDATE ON liquidity_curves
BEGIN
  SELECT RAISE(ABORT, 'liquidity curves are immutable');
END;

CREATE TRIGGER liquidity_curves_no_delete
BEFORE DELETE ON liquidity_curves
BEGIN
  SELECT RAISE(ABORT, 'liquidity curves are immutable');
END;

-- Accepted financial records and decisions retain their audit trail.
CREATE TRIGGER accepted_marks_no_delete
BEFORE DELETE ON marks
WHEN OLD.review_status = 'accepted'
BEGIN
  SELECT RAISE(ABORT, 'accepted marks cannot be deleted');
END;

CREATE TRIGGER accepted_evidence_no_delete
BEFORE DELETE ON evidence_events
WHEN OLD.status = 'accepted'
BEGIN
  SELECT RAISE(ABORT, 'accepted evidence cannot be deleted');
END;

CREATE TRIGGER review_decisions_no_update
BEFORE UPDATE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review decisions are immutable');
END;

CREATE TRIGGER review_decisions_no_delete
BEFORE DELETE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review decisions are immutable');
END;

CREATE TRIGGER actual_liquidity_no_update
BEFORE UPDATE ON actual_liquidity_events
BEGIN
  SELECT RAISE(ABORT, 'actual liquidity events are immutable');
END;

CREATE TRIGGER actual_liquidity_no_delete
BEFORE DELETE ON actual_liquidity_events
BEGIN
  SELECT RAISE(ABORT, 'actual liquidity events are immutable');
END;
