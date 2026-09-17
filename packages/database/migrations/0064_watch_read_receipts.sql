-- Reading news is a personal inbox preference, separate from evidence decisions.
CREATE TABLE portfolio_watch_read_receipts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  observation_id TEXT NOT NULL REFERENCES public_source_observations(id) ON DELETE RESTRICT,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  read_at TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  PRIMARY KEY (user_id, observation_id)
);

CREATE TRIGGER portfolio_watch_read_receipt_scope_insert
BEFORE INSERT ON portfolio_watch_read_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM public_source_observations observation
  JOIN households household ON household.id = observation.household_id
  WHERE observation.id = NEW.observation_id
    AND observation.household_id = NEW.household_id
    AND household.owner_user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'Watch read receipt must belong to its reader and household');
END;

CREATE TRIGGER portfolio_watch_read_receipt_scope_update
BEFORE UPDATE ON portfolio_watch_read_receipts
WHEN NEW.user_id <> OLD.user_id OR NEW.observation_id <> OLD.observation_id
  OR NEW.household_id <> OLD.household_id OR NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'Watch read receipt identity is fixed and versions must advance');
END;
