PRAGMA defer_foreign_keys = ON;

-- M9.5 removes the provider-specific Robinhood storage path. Existing public
-- holdings remain the same immutable observations; only their adapter-facing
-- provider and parser identifiers move to the Plaid Investments contract.
DROP TRIGGER holding_imports_no_update;
DROP TRIGGER holding_positions_no_update;
DROP TRIGGER connector_sync_imports_integrity_insert;
DROP TRIGGER holding_import_quarantines_integrity_insert;

UPDATE holding_imports
SET provider = 'plaid_investments',
    parser_schema = 'plaid_investments_holdings_v1'
WHERE provider = 'robinhood';

UPDATE holding_positions
SET provider = 'plaid_investments'
WHERE provider = 'robinhood';

CREATE TRIGGER holding_imports_no_update
BEFORE UPDATE ON holding_imports
BEGIN
  SELECT RAISE(ABORT, 'holding imports are immutable');
END;

CREATE TRIGGER holding_positions_no_update
BEFORE UPDATE ON holding_positions
BEGIN
  SELECT RAISE(ABORT, 'holding positions are immutable');
END;

CREATE TRIGGER connector_sync_imports_integrity_insert
BEFORE INSERT ON connector_sync_imports
BEGIN
  SELECT RAISE(ABORT, 'connector sync import household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM connector_sync_runs run
    JOIN connector_accounts account ON account.id = run.connector_account_id
    JOIN connector_sync_investment_connections run_scope
      ON run_scope.sync_run_id = run.id
    JOIN holding_imports import ON import.id = NEW.holding_import_id
    JOIN holding_import_connections import_scope
      ON import_scope.import_id = import.id
      AND import_scope.connection_id = run_scope.connection_id
    WHERE run.id = NEW.sync_run_id
      AND run.household_id = NEW.household_id
      AND account.household_id = NEW.household_id
      AND run_scope.household_id = NEW.household_id
      AND account.connector_type = 'plaid-investments'
      AND import.household_id = NEW.household_id
      AND import_scope.household_id = NEW.household_id
      AND import.provider = 'plaid_investments'
  );
END;

CREATE TRIGGER holding_import_quarantines_integrity_insert
BEFORE INSERT ON holding_import_quarantines
BEGIN
  SELECT RAISE(ABORT, 'holding import quarantine import mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_imports import
    WHERE import.id = NEW.import_id
      AND import.household_id = NEW.household_id
      AND import.provider = 'plaid_investments'
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
      AND position.provider = 'plaid_investments'
  );
END;

-- The original baseline-item check encoded Robinhood as the only public
-- institution. Rebuild the append-only child table with the provider-neutral
-- value while preserving every accepted baseline row and its identifiers.
DROP TRIGGER portfolio_baseline_items_integrity_insert;
DROP TRIGGER portfolio_baseline_items_no_update;
DROP TRIGGER portfolio_baseline_items_no_delete;
DROP INDEX portfolio_baseline_items_baseline_idx;

CREATE TABLE portfolio_baseline_items_m9_5 (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  baseline_id TEXT NOT NULL
    REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL
    REFERENCES holding_positions(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (
    provider IN ('angellist', 'plaid_investments')
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
    OR (provider = 'angellist' AND classification = 'private_paper')
  ),
  CHECK (
    (value_state = 'reported' AND value_minor IS NOT NULL)
    OR (value_state <> 'reported' AND value_minor IS NULL)
  )
);

INSERT INTO portfolio_baseline_items_m9_5 (
  id, household_id, baseline_id, position_id, snapshot_id, provider,
  classification, value_minor, value_state, observed_at, duplicate_key,
  created_at
)
SELECT
  id, household_id, baseline_id, position_id, snapshot_id,
  CASE
    WHEN provider = 'robinhood' THEN 'plaid_investments'
    ELSE provider
  END,
  classification, value_minor, value_state, observed_at, duplicate_key,
  created_at
FROM portfolio_baseline_items;

DROP TABLE portfolio_baseline_items;
ALTER TABLE portfolio_baseline_items_m9_5 RENAME TO portfolio_baseline_items;

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
