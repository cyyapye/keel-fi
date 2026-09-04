PRAGMA foreign_keys = ON;

-- Agreement backfills renew the existing run instead of creating another
-- connector or lease. Only expiration may advance; token and start are fixed.
DROP TRIGGER provider_portfolio_runs_transition_update;
CREATE TRIGGER provider_portfolio_runs_transition_update
BEFORE UPDATE ON provider_portfolio_runs
WHEN NOT (
  OLD.status = 'queued' AND NEW.status = 'leased'
  OR OLD.status = 'leased' AND NEW.status IN ('completed', 'failed')
  OR OLD.status = 'leased' AND NEW.status = 'leased'
    AND NEW.lease_token_sha256 = OLD.lease_token_sha256
    AND NEW.started_at = OLD.started_at
    AND NEW.lease_expires_at >= OLD.lease_expires_at
    AND julianday(NEW.lease_expires_at) <= julianday(OLD.started_at, '+30 minutes')
)
BEGIN SELECT RAISE(ABORT, 'invalid provider portfolio run transition'); END;

-- Reserve before object storage, including failed/ambiguous writes. Retrying
-- the same bytes reuses a reservation, and concurrent uploads cannot overspend.
CREATE TABLE provider_legal_document_uploads (
  run_id TEXT NOT NULL REFERENCES provider_portfolio_runs(id) ON DELETE RESTRICT,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
  PRIMARY KEY (run_id, sha256)
);
CREATE TRIGGER provider_legal_document_upload_budget
BEFORE INSERT ON provider_legal_document_uploads
WHEN NOT EXISTS (SELECT 1 FROM provider_legal_document_uploads WHERE run_id = NEW.run_id AND sha256 = NEW.sha256)
BEGIN
  SELECT RAISE(ABORT, 'legal document run budget reached') WHERE
    (SELECT COUNT(*) FROM provider_legal_document_uploads WHERE run_id = NEW.run_id) >= 24
    OR (SELECT COALESCE(SUM(byte_size), 0) FROM provider_legal_document_uploads WHERE run_id = NEW.run_id) + NEW.byte_size > 67108864;
END;
CREATE TRIGGER provider_legal_document_uploads_no_update
BEFORE UPDATE ON provider_legal_document_uploads
BEGIN SELECT RAISE(ABORT, 'legal document reservation is append only'); END;
CREATE TRIGGER provider_legal_document_uploads_no_delete
BEFORE DELETE ON provider_legal_document_uploads
BEGIN SELECT RAISE(ABORT, 'legal document reservation is append only'); END;

-- Raw agreements stay in private R2. These are append-only source observations
-- and proposed names, never accepted legal entities or financial records.
CREATE TABLE provider_legal_document_observations (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('tokenfolio', 'sydecar')),
  run_id TEXT NOT NULL REFERENCES provider_portfolio_runs(id) ON DELETE RESTRICT,
  natural_key_sha256 TEXT NOT NULL CHECK (length(natural_key_sha256) = 64 AND natural_key_sha256 NOT GLOB '*[^0-9a-f]*'),
  position_fingerprint TEXT NOT NULL CHECK (length(position_fingerprint) = 64 AND position_fingerprint NOT GLOB '*[^0-9a-f]*'),
  capture_sha256 TEXT NOT NULL CHECK (length(capture_sha256) = 64 AND capture_sha256 NOT GLOB '*[^0-9a-f]*'),
  capture_json TEXT NOT NULL CHECK (json_valid(capture_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, provider, run_id, natural_key_sha256)
);

CREATE TRIGGER provider_legal_document_observations_scope
BEFORE INSERT ON provider_legal_document_observations
BEGIN
  SELECT RAISE(ABORT, 'legal document provider scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM provider_portfolio_runs run
    JOIN provider_portfolio_agents agent ON agent.id = run.agent_id
    WHERE run.id = NEW.run_id AND run.household_id = NEW.household_id
      AND agent.provider = NEW.provider AND agent.household_id = NEW.household_id
      AND run.started_at = NEW.observed_at
  );
  SELECT RAISE(ABORT, 'legal document position budget reached') WHERE
    (SELECT COUNT(*) FROM provider_legal_document_observations WHERE household_id = NEW.household_id AND provider = NEW.provider AND run_id = NEW.run_id) >= 500
    AND NOT EXISTS (SELECT 1 FROM provider_legal_document_observations WHERE household_id = NEW.household_id AND provider = NEW.provider AND run_id = NEW.run_id AND natural_key_sha256 = NEW.natural_key_sha256);
END;
CREATE TRIGGER provider_legal_document_observations_no_update
BEFORE UPDATE ON provider_legal_document_observations
BEGIN SELECT RAISE(ABORT, 'legal document evidence is append only'); END;
CREATE TRIGGER provider_legal_document_observations_no_delete
BEFORE DELETE ON provider_legal_document_observations
BEGIN SELECT RAISE(ABORT, 'legal document evidence is append only'); END;

-- Replaceable read projection, advanced only at ingestion. Never backfill from
-- a user-facing GET. The PK is also the complete indexed position join key.
CREATE TABLE provider_legal_document_latest (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('tokenfolio', 'sydecar')),
  natural_key_sha256 TEXT NOT NULL,
  position_fingerprint TEXT NOT NULL,
  observation_id TEXT NOT NULL UNIQUE REFERENCES provider_legal_document_observations(id) ON DELETE RESTRICT,
  PRIMARY KEY (household_id, provider, position_fingerprint)
);

CREATE TRIGGER provider_legal_document_latest_scope_insert
BEFORE INSERT ON provider_legal_document_latest
BEGIN
  SELECT RAISE(ABORT, 'legal document projection scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM provider_legal_document_observations observation
    WHERE observation.id = NEW.observation_id AND observation.household_id = NEW.household_id
      AND observation.provider = NEW.provider AND observation.natural_key_sha256 = NEW.natural_key_sha256
      AND observation.position_fingerprint = NEW.position_fingerprint
  );
END;
CREATE TRIGGER provider_legal_document_latest_scope_update
BEFORE UPDATE ON provider_legal_document_latest
BEGIN
  SELECT RAISE(ABORT, 'legal document projection scope mismatch') WHERE
    NEW.household_id <> OLD.household_id OR NEW.provider <> OLD.provider OR NEW.natural_key_sha256 <> OLD.natural_key_sha256 OR NEW.position_fingerprint <> OLD.position_fingerprint
    OR NOT EXISTS (
      SELECT 1 FROM provider_legal_document_observations observation
      WHERE observation.id = NEW.observation_id AND observation.household_id = NEW.household_id
        AND observation.provider = NEW.provider AND observation.natural_key_sha256 = NEW.natural_key_sha256
        AND observation.position_fingerprint = NEW.position_fingerprint
    );
END;
