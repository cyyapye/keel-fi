PRAGMA foreign_keys = ON;

-- Restricted audit records, not ordinary request logs. A download means the
-- server authorized/released a response, not proof that the client saved it.
CREATE TABLE private_document_access_events (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('owner', 'provider_agent')),
  document_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upload', 'download', 'delete')),
  outcome TEXT NOT NULL CHECK (outcome IN ('stored', 'released', 'denied', 'unavailable', 'deleted')),
  occurred_at TEXT NOT NULL
);
CREATE INDEX private_document_access_household_time_idx
  ON private_document_access_events(household_id, occurred_at, id);
CREATE INDEX private_document_access_document_time_idx
  ON private_document_access_events(household_id, document_id, occurred_at);
CREATE TRIGGER private_document_access_scope
BEFORE INSERT ON private_document_access_events
BEGIN
  SELECT RAISE(ABORT, 'document audit actor scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM households WHERE id = NEW.household_id AND owner_user_id = NEW.actor_user_id
  );
  SELECT RAISE(ABORT, 'document audit object scope mismatch') WHERE
    NEW.outcome IN ('stored', 'released', 'deleted') AND NOT EXISTS (
      SELECT 1 FROM source_documents WHERE id = NEW.document_id AND household_id = NEW.household_id
    );
END;
CREATE TRIGGER private_document_access_no_update
BEFORE UPDATE ON private_document_access_events
BEGIN SELECT RAISE(ABORT, 'document access history is append only'); END;
CREATE TRIGGER private_document_access_no_delete
BEFORE DELETE ON private_document_access_events
BEGIN SELECT RAISE(ABORT, 'document access history is append only'); END;
-- Missing scan state is quarantine, including pre-migration originals. No
-- object deletion, accepted-record mutation, or invented historical scans.
CREATE TABLE private_document_scans (
  document_id TEXT PRIMARY KEY REFERENCES source_documents(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  sha256 TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('clean', 'blocked')),
  scan_json TEXT NOT NULL CHECK (json_valid(scan_json)),
  scanned_at TEXT NOT NULL
);
CREATE TRIGGER private_document_scans_owner_insert
BEFORE INSERT ON private_document_scans
WHEN NOT EXISTS (SELECT 1 FROM source_documents WHERE id = NEW.document_id AND household_id = NEW.household_id AND sha256 = NEW.sha256)
BEGIN SELECT RAISE(ABORT, 'scan document ownership mismatch'); END;
CREATE TRIGGER private_document_scans_owner_update
BEFORE UPDATE ON private_document_scans
WHEN NEW.document_id <> OLD.document_id OR NEW.household_id <> OLD.household_id OR NEW.sha256 <> OLD.sha256 OR NEW.scanned_at <= OLD.scanned_at
BEGIN SELECT RAISE(ABORT, 'scan identity or ordering mismatch'); END;
