PRAGMA foreign_keys = ON;

-- The Mac agent keeps its browser session on the user's computer. D1 stores
-- only scheduling and operational state; exported CSVs continue through the
-- immutable holding-import review path.
CREATE TABLE angellist_mac_agents (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL UNIQUE
    REFERENCES households(id) ON DELETE RESTRICT,
  registered_by_user_id TEXT NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  interval TEXT NOT NULL CHECK (interval IN ('off', 'daily', 'weekly')),
  last_seen_at TEXT NOT NULL,
  last_completed_at TEXT,
  next_run_at TEXT,
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'angellist_sign_in_required',
      'export_unavailable',
      'download_failed',
      'keel_sign_in_required',
      'upload_failed',
      'unexpected_failure'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (interval = 'off' AND next_run_at IS NULL)
    OR (interval <> 'off' AND next_run_at IS NOT NULL)
  )
);

CREATE TRIGGER angellist_mac_agents_integrity_insert
BEFORE INSERT ON angellist_mac_agents
BEGIN
  SELECT RAISE(ABORT, 'AngelList Mac agent household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM households household
    WHERE household.id = NEW.household_id
      AND household.owner_user_id = NEW.registered_by_user_id
  );
END;

CREATE TRIGGER angellist_mac_agents_identity_immutable
BEFORE UPDATE ON angellist_mac_agents
WHEN NEW.id <> OLD.id
  OR NEW.household_id <> OLD.household_id
  OR NEW.registered_by_user_id <> OLD.registered_by_user_id
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'AngelList Mac agent identity is immutable');
END;

CREATE TRIGGER angellist_mac_agents_no_delete
BEFORE DELETE ON angellist_mac_agents
BEGIN
  SELECT RAISE(ABORT, 'AngelList Mac agents cannot be deleted');
END;

CREATE TABLE angellist_mac_runs (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL
    REFERENCES angellist_mac_agents(id) ON DELETE RESTRICT,
  requested_by_user_id TEXT NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('manual', 'schedule')),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'leased', 'completed', 'failed')
  ),
  lease_token_sha256 TEXT CHECK (
    lease_token_sha256 IS NULL OR (
      length(lease_token_sha256) = 64
      AND lease_token_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  lease_expires_at TEXT,
  import_id TEXT REFERENCES holding_imports(id) ON DELETE RESTRICT,
  error_code TEXT CHECK (
    error_code IS NULL OR error_code IN (
      'angellist_sign_in_required',
      'export_unavailable',
      'download_failed',
      'keel_sign_in_required',
      'upload_failed',
      'unexpected_failure'
    )
  ),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  CHECK (
    (status = 'queued'
      AND lease_token_sha256 IS NULL
      AND lease_expires_at IS NULL
      AND import_id IS NULL
      AND error_code IS NULL
      AND started_at IS NULL
      AND finished_at IS NULL)
    OR (status = 'leased'
      AND lease_token_sha256 IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND import_id IS NULL
      AND error_code IS NULL
      AND started_at IS NOT NULL
      AND finished_at IS NULL)
    OR (status = 'completed'
      AND lease_token_sha256 IS NULL
      AND lease_expires_at IS NULL
      AND import_id IS NOT NULL
      AND error_code IS NULL
      AND started_at IS NOT NULL
      AND finished_at IS NOT NULL)
    OR (status = 'failed'
      AND lease_token_sha256 IS NULL
      AND lease_expires_at IS NULL
      AND import_id IS NULL
      AND error_code IS NOT NULL
      AND started_at IS NOT NULL
      AND finished_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX angellist_mac_runs_active_agent_unique
  ON angellist_mac_runs(agent_id)
  WHERE status IN ('queued', 'leased');
CREATE INDEX angellist_mac_runs_household_requested_idx
  ON angellist_mac_runs(household_id, requested_at);

CREATE TRIGGER angellist_mac_runs_integrity_insert
BEFORE INSERT ON angellist_mac_runs
BEGIN
  SELECT RAISE(ABORT, 'AngelList Mac run household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM angellist_mac_agents agent
    JOIN households household ON household.id = agent.household_id
    WHERE agent.id = NEW.agent_id
      AND agent.household_id = NEW.household_id
      AND household.id = NEW.household_id
      AND household.owner_user_id = NEW.requested_by_user_id
  );
END;

CREATE TRIGGER angellist_mac_runs_transition_update
BEFORE UPDATE ON angellist_mac_runs
WHEN NOT (
  OLD.status = 'queued' AND NEW.status = 'leased'
  OR OLD.status = 'leased' AND NEW.status IN ('completed', 'failed')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid AngelList Mac run transition');
END;

CREATE TRIGGER angellist_mac_runs_identity_update
BEFORE UPDATE ON angellist_mac_runs
WHEN NEW.id <> OLD.id
  OR NEW.household_id <> OLD.household_id
  OR NEW.agent_id <> OLD.agent_id
  OR NEW.requested_by_user_id <> OLD.requested_by_user_id
  OR NEW.request_kind <> OLD.request_kind
  OR NEW.requested_at <> OLD.requested_at
BEGIN
  SELECT RAISE(ABORT, 'AngelList Mac run identity is immutable');
END;

CREATE TRIGGER angellist_mac_runs_completion_integrity
BEFORE UPDATE ON angellist_mac_runs
WHEN NEW.status = 'completed' AND NOT EXISTS (
  SELECT 1
  FROM holding_imports import
  WHERE import.id = NEW.import_id
    AND import.household_id = NEW.household_id
    AND import.provider = 'angellist'
)
BEGIN
  SELECT RAISE(ABORT, 'AngelList Mac run import mismatch');
END;

CREATE TRIGGER angellist_mac_runs_no_delete
BEFORE DELETE ON angellist_mac_runs
BEGIN
  SELECT RAISE(ABORT, 'AngelList Mac runs cannot be deleted');
END;
