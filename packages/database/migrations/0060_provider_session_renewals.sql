-- Operational session maintenance is separate from financial captures. Provider
-- credentials remain in the worker's dedicated Chrome profile.
CREATE TABLE provider_session_renewals (
  agent_id TEXT PRIMARY KEY NOT NULL
    REFERENCES provider_portfolio_agents(id) ON DELETE RESTRICT,
  last_verified_at TEXT NOT NULL,
  next_check_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_token_sha256 TEXT,
  lease_expires_at TEXT,
  last_outcome_token_sha256 TEXT,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code IN (
    'provider_sign_in_required', 'unexpected_failure'
  )),
  CHECK ((lease_token_sha256 IS NULL) = (lease_expires_at IS NULL)),
  CHECK (lease_token_sha256 IS NULL OR (
    length(lease_token_sha256) = 64
    AND lease_token_sha256 NOT GLOB '*[^0-9a-f]*'
  )),
  CHECK (last_outcome_token_sha256 IS NULL OR (
    length(last_outcome_token_sha256) = 64
    AND last_outcome_token_sha256 NOT GLOB '*[^0-9a-f]*'
  ))
);

CREATE TRIGGER provider_session_renewals_provider_insert
BEFORE INSERT ON provider_session_renewals
BEGIN
  SELECT RAISE(ABORT, 'session renewal requires a Sydecar agent')
  WHERE NOT EXISTS (
    SELECT 1 FROM provider_portfolio_agents
    WHERE id = NEW.agent_id AND provider = 'sydecar'
  );
END;

CREATE TRIGGER provider_session_renewals_identity_update
BEFORE UPDATE OF agent_id ON provider_session_renewals
WHEN NEW.agent_id <> OLD.agent_id
BEGIN
  SELECT RAISE(ABORT, 'session renewal identity is immutable');
END;

INSERT INTO provider_session_renewals
  (agent_id, last_verified_at, next_check_at)
SELECT id, last_completed_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', last_completed_at, '+6 hours')
FROM provider_portfolio_agents
WHERE provider = 'sydecar' AND last_completed_at IS NOT NULL;
