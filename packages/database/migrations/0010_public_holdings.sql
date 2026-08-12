PRAGMA foreign_keys = ON;

-- Public-brokerage syncs retain the provider response privately. Consecutive
-- observations deduplicate on normalized facts rather than request noise, but
-- a later return to an older portfolio state must still create a new review.
ALTER TABLE holding_imports
  ADD COLUMN normalized_fingerprint TEXT CHECK (
    normalized_fingerprint IS NULL OR (
      length(normalized_fingerprint) = 64
      AND normalized_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  );

-- AngelList rows continue to default to SPV interests. Public rows carry a
-- direct-position kind plus exact micro-share quantity and an optional ticker.
ALTER TABLE holding_import_rows
  ADD COLUMN position_kind TEXT NOT NULL DEFAULT 'spv_interest' CHECK (
    position_kind IN ('direct', 'spv_interest', 'fund_interest')
  );
ALTER TABLE holding_import_rows
  ADD COLUMN quantity_micros INTEGER CHECK (
    quantity_micros IS NULL OR quantity_micros >= 0
  );
ALTER TABLE holding_import_rows
  ADD COLUMN ticker TEXT CHECK (
    ticker IS NULL OR length(ticker) BETWEEN 1 AND 32
  );
ALTER TABLE holding_import_rows
  ADD COLUMN cost_basis_minor INTEGER CHECK (
    cost_basis_minor IS NULL OR cost_basis_minor >= 0
  );

ALTER TABLE holding_position_snapshots
  ADD COLUMN quantity_micros INTEGER CHECK (
    quantity_micros IS NULL OR quantity_micros >= 0
  );

CREATE UNIQUE INDEX connector_sync_runs_active_account_unique
  ON connector_sync_runs(connector_account_id)
  WHERE status IN ('queued', 'running');
ALTER TABLE holding_position_snapshots
  ADD COLUMN ticker TEXT CHECK (
    ticker IS NULL OR length(ticker) BETWEEN 1 AND 32
  );
ALTER TABLE holding_position_snapshots
  ADD COLUMN cost_basis_minor INTEGER CHECK (
    cost_basis_minor IS NULL OR cost_basis_minor >= 0
  );

-- Each completed sync can point to at most one review import. A zero-holding or
-- unchanged sync deliberately has no row here and cannot imply a disposition.
CREATE TABLE connector_sync_imports (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  sync_run_id TEXT NOT NULL UNIQUE
    REFERENCES connector_sync_runs(id) ON DELETE RESTRICT,
  holding_import_id TEXT NOT NULL UNIQUE
    REFERENCES holding_imports(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX connector_sync_imports_household_created_idx
  ON connector_sync_imports(household_id, created_at);

CREATE TRIGGER connector_sync_imports_integrity_insert
BEFORE INSERT ON connector_sync_imports
BEGIN
  SELECT RAISE(ABORT, 'connector sync import household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM connector_sync_runs run
    JOIN connector_accounts account ON account.id = run.connector_account_id
    JOIN holding_imports import ON import.id = NEW.holding_import_id
    WHERE run.id = NEW.sync_run_id
      AND run.household_id = NEW.household_id
      AND account.household_id = NEW.household_id
      AND account.connector_type = 'plaid-investments'
      AND import.household_id = NEW.household_id
      AND import.provider = 'robinhood'
  );
END;

CREATE TRIGGER connector_sync_imports_no_update
BEFORE UPDATE ON connector_sync_imports
BEGIN
  SELECT RAISE(ABORT, 'connector sync imports are immutable');
END;

CREATE TRIGGER connector_sync_imports_no_delete
BEFORE DELETE ON connector_sync_imports
BEGIN
  SELECT RAISE(ABORT, 'connector sync imports are immutable');
END;
