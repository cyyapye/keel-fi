PRAGMA defer_foreign_keys = ON;

DROP TRIGGER portfolio_baseline_items_integrity_insert;
DROP TRIGGER portfolio_baseline_items_no_update;
DROP TRIGGER portfolio_baseline_items_no_delete;
DROP INDEX portfolio_baseline_items_baseline_idx;

CREATE TABLE portfolio_baseline_items_provider_templates (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  baseline_id TEXT NOT NULL
    REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL
    REFERENCES holding_positions(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (
    provider IN (
      'angellist', 'tokenfolio', 'sydecar', 'plaid_investments'
    )
  ),
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
    (provider = 'plaid_investments' AND classification = 'public_market')
    OR (
      provider IN ('angellist', 'tokenfolio', 'sydecar')
      AND classification = 'private_paper'
    )
  ),
  CHECK (
    (value_state = 'reported' AND value_minor IS NOT NULL)
    OR (value_state <> 'reported' AND value_minor IS NULL)
  )
);

INSERT INTO portfolio_baseline_items_provider_templates (
  id, household_id, baseline_id, position_id, snapshot_id, provider,
  classification, value_minor, value_state, observed_at, duplicate_key,
  created_at
)
SELECT
  id, household_id, baseline_id, position_id, snapshot_id, provider,
  classification, value_minor, value_state, observed_at, duplicate_key,
  created_at
FROM portfolio_baseline_items;

DROP TABLE portfolio_baseline_items;
ALTER TABLE portfolio_baseline_items_provider_templates
  RENAME TO portfolio_baseline_items;

CREATE INDEX portfolio_baseline_items_baseline_idx
  ON portfolio_baseline_items(baseline_id, position_id);

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

PRAGMA defer_foreign_keys = OFF;
