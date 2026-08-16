PRAGMA foreign_keys = ON;

CREATE TABLE plan_actual_monitoring_cooldowns (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  item_key TEXT NOT NULL CHECK (
    item_key IN (
      'cash_review', 'cash_freshness', 'cash_drift',
      'debt_review', 'debt_overdue', 'debt_freshness', 'debt_drift',
      'burn_review', 'burn_freshness', 'burn_drift', 'runway_drift'
    )
  ),
  source_revision TEXT NOT NULL CHECK (
    length(source_revision) = 64
    AND source_revision NOT GLOB '*[^0-9a-f]*'
  ),
  snoozed_until TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (snoozed_until > created_at)
);
CREATE INDEX plan_actual_monitoring_cooldowns_household_item_idx
  ON plan_actual_monitoring_cooldowns(
    household_id, item_key, source_revision, created_at
  );

CREATE TRIGGER plan_actual_monitoring_cooldowns_integrity_insert
BEFORE INSERT ON plan_actual_monitoring_cooldowns
BEGIN
  SELECT RAISE(ABORT, 'monitoring cooldown identity mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM households household
    WHERE household.id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
  );
END;

CREATE TRIGGER plan_actual_monitoring_cooldowns_no_update
BEFORE UPDATE ON plan_actual_monitoring_cooldowns
BEGIN
  SELECT RAISE(ABORT, 'monitoring cooldowns are immutable');
END;

CREATE TRIGGER plan_actual_monitoring_cooldowns_no_delete
BEFORE DELETE ON plan_actual_monitoring_cooldowns
BEGIN
  SELECT RAISE(ABORT, 'monitoring cooldowns are immutable');
END;
