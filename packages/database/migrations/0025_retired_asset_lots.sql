PRAGMA foreign_keys = ON;

-- Preserve historical synthetic records while removing retired lots from the
-- current Holdings read model.
CREATE TABLE asset_lot_retirements (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  asset_lot_id TEXT NOT NULL UNIQUE REFERENCES asset_lots(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (reason IN ('preview_demo_cleanup')),
  retired_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  retired_at TEXT NOT NULL,
  immutable INTEGER NOT NULL DEFAULT 1 CHECK (immutable = 1)
);
CREATE INDEX asset_lot_retirements_household_idx
  ON asset_lot_retirements(household_id, retired_at);

CREATE TRIGGER asset_lot_retirements_integrity_insert
BEFORE INSERT ON asset_lot_retirements
BEGIN
  SELECT RAISE(ABORT, 'asset lot retirement household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM asset_lots lot
    JOIN households household ON household.id = lot.household_id
    WHERE lot.id = NEW.asset_lot_id
      AND lot.household_id = NEW.household_id
      AND household.owner_user_id = NEW.retired_by_user_id
  );
END;

CREATE TRIGGER asset_lot_retirements_no_update
BEFORE UPDATE ON asset_lot_retirements
BEGIN
  SELECT RAISE(ABORT, 'asset lot retirements are immutable');
END;

CREATE TRIGGER asset_lot_retirements_no_delete
BEFORE DELETE ON asset_lot_retirements
BEGIN
  SELECT RAISE(ABORT, 'asset lot retirements are immutable');
END;

INSERT INTO asset_lot_retirements (
  id,
  household_id,
  asset_lot_id,
  reason,
  retired_by_user_id,
  retired_at,
  immutable
)
SELECT
  'retirement_' || lot.id,
  lot.household_id,
  lot.id,
  'preview_demo_cleanup',
  household.owner_user_id,
  '2026-08-16T17:30:00.000Z',
  1
FROM asset_lots lot
JOIN households household ON household.id = lot.household_id
WHERE lot.id IN (
  'lot_harbor_spv',
  'lot_lattice_seriesa',
  'lot_northstar_seed'
);
