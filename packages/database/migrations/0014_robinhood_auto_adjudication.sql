ALTER TABLE holding_import_row_decisions
  ADD COLUMN decision_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (decision_source IN ('manual', 'policy'));

ALTER TABLE holding_import_row_decisions
  ADD COLUMN policy_version TEXT
  CHECK (policy_version IS NULL OR length(policy_version) BETWEEN 1 AND 100);

ALTER TABLE holding_import_row_decisions
  ADD COLUMN reason_codes_json TEXT NOT NULL DEFAULT '[]'
  CHECK (
    json_valid(reason_codes_json)
    AND json_type(reason_codes_json) = 'array'
  );

CREATE TRIGGER holding_import_row_decisions_policy_insert
BEFORE INSERT ON holding_import_row_decisions
BEGIN
  SELECT RAISE(ABORT, 'holding import decision policy metadata mismatch')
  WHERE
    (NEW.decision_source = 'manual' AND NEW.policy_version IS NOT NULL)
    OR (NEW.decision_source = 'policy' AND NEW.policy_version IS NULL);
END;

CREATE TABLE holding_import_quarantines (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_id TEXT NOT NULL REFERENCES holding_imports(id) ON DELETE RESTRICT,
  import_row_id TEXT REFERENCES holding_import_rows(id) ON DELETE RESTRICT,
  position_id TEXT REFERENCES holding_positions(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'row_validation_failed',
      'possible_identity_change',
      'position_not_reported'
    )
  ),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 100),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64
    AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  detail TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL,
  CHECK ((import_row_id IS NULL) <> (position_id IS NULL))
);
CREATE UNIQUE INDEX holding_import_quarantines_row_unique
  ON holding_import_quarantines(import_id, import_row_id)
  WHERE import_row_id IS NOT NULL;
CREATE UNIQUE INDEX holding_import_quarantines_position_unique
  ON holding_import_quarantines(import_id, position_id)
  WHERE position_id IS NOT NULL;
CREATE INDEX holding_import_quarantines_household_created_idx
  ON holding_import_quarantines(household_id, created_at);

CREATE TRIGGER holding_import_quarantines_integrity_insert
BEFORE INSERT ON holding_import_quarantines
BEGIN
  SELECT RAISE(ABORT, 'holding import quarantine import mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_imports import
    WHERE import.id = NEW.import_id
      AND import.household_id = NEW.household_id
      AND import.provider = 'robinhood'
  );
  SELECT RAISE(ABORT, 'holding import quarantine row mismatch')
  WHERE NEW.import_row_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    WHERE row.id = NEW.import_row_id
      AND row.import_id = NEW.import_id
      AND row.household_id = NEW.household_id
  );
  SELECT RAISE(ABORT, 'holding import quarantine position mismatch')
  WHERE NEW.position_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
      AND position.provider = 'robinhood'
  );
END;

CREATE TRIGGER holding_import_quarantines_no_update
BEFORE UPDATE ON holding_import_quarantines
BEGIN
  SELECT RAISE(ABORT, 'holding import quarantines are immutable');
END;

CREATE TRIGGER holding_import_quarantines_no_delete
BEFORE DELETE ON holding_import_quarantines
BEGIN
  SELECT RAISE(ABORT, 'holding import quarantines are immutable');
END;

ALTER TABLE connector_sync_runs
  ADD COLUMN adjudication_policy_version TEXT
  CHECK (
    adjudication_policy_version IS NULL
    OR length(adjudication_policy_version) BETWEEN 1 AND 100
  );

ALTER TABLE connector_sync_runs
  ADD COLUMN auto_applied_count INTEGER NOT NULL DEFAULT 0
  CHECK (auto_applied_count >= 0);

ALTER TABLE connector_sync_runs
  ADD COLUMN quarantined_count INTEGER NOT NULL DEFAULT 0
  CHECK (quarantined_count >= 0);

ALTER TABLE connector_sync_runs
  ADD COLUMN preserved_position_count INTEGER NOT NULL DEFAULT 0
  CHECK (preserved_position_count >= 0);

ALTER TABLE connector_sync_runs
  ADD COLUMN baseline_refresh_status TEXT NOT NULL DEFAULT 'not_needed'
  CHECK (
    baseline_refresh_status IN ('not_needed', 'refreshed', 'manual_required')
  );

ALTER TABLE connector_sync_runs
  ADD COLUMN portfolio_baseline_id TEXT
  REFERENCES portfolio_baselines(id) ON DELETE RESTRICT;
