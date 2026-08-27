PRAGMA foreign_keys = ON;

-- A signed-in Keel user may ask the registered provider agent to expose only
-- its provider Chrome window through a short-lived HTTPS stream. The provider
-- profile, cookies, passwords, and 2FA stay on the agent host. D1 retains the
-- lifecycle record, a digest of the agent lease, and the temporary HTTPS URL
-- only until the stream is consumed or terminated.
CREATE TABLE provider_browser_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL
    REFERENCES households(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (
    provider IN ('angellist', 'tokenfolio', 'sydecar')
  ),
  requested_by_user_id TEXT NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (
    status IN (
      'requested', 'starting', 'ready', 'opened', 'connected', 'expired',
      'cancelled', 'failed'
    )
  ),
  lease_token_sha256 TEXT CHECK (
    lease_token_sha256 IS NULL OR (
      length(lease_token_sha256) = 64
      AND lease_token_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  live_url TEXT CHECK (
    live_url IS NULL OR (
      length(live_url) BETWEEN 9 AND 2048
      AND live_url LIKE 'https://%'
    )
  ),
  error_code TEXT CHECK (
    error_code IS NULL OR error_code IN (
      'agent_unavailable',
      'browser_unavailable',
      'provider_sign_in_incomplete',
      'unexpected_failure'
    )
  ),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  started_at TEXT,
  ready_at TEXT,
  opened_at TEXT,
  connected_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (expires_at > requested_at),
  CHECK (
    (status = 'requested'
      AND lease_token_sha256 IS NULL
      AND live_url IS NULL
      AND error_code IS NULL
      AND started_at IS NULL
      AND ready_at IS NULL
      AND opened_at IS NULL
      AND connected_at IS NULL
      AND finished_at IS NULL)
    OR (status = 'starting'
      AND lease_token_sha256 IS NOT NULL
      AND live_url IS NULL
      AND error_code IS NULL
      AND started_at IS NOT NULL
      AND ready_at IS NULL
      AND opened_at IS NULL
      AND connected_at IS NULL
      AND finished_at IS NULL)
    OR (status = 'ready'
      AND lease_token_sha256 IS NOT NULL
      AND live_url IS NOT NULL
      AND error_code IS NULL
      AND started_at IS NOT NULL
      AND ready_at IS NOT NULL
      AND opened_at IS NULL
      AND connected_at IS NULL
      AND finished_at IS NULL)
    OR (status = 'opened'
      AND lease_token_sha256 IS NOT NULL
      AND live_url IS NULL
      AND error_code IS NULL
      AND started_at IS NOT NULL
      AND ready_at IS NOT NULL
      AND opened_at IS NOT NULL
      AND connected_at IS NULL
      AND finished_at IS NULL)
    OR (status = 'connected'
      AND lease_token_sha256 IS NULL
      AND live_url IS NULL
      AND error_code IS NULL
      AND started_at IS NOT NULL
      AND ready_at IS NOT NULL
      AND opened_at IS NOT NULL
      AND connected_at IS NOT NULL
      AND finished_at IS NOT NULL)
    OR (status IN ('expired', 'cancelled')
      AND lease_token_sha256 IS NULL
      AND live_url IS NULL
      AND error_code IS NULL
      AND started_at IS NULL
      AND ready_at IS NULL
      AND opened_at IS NULL
      AND connected_at IS NULL
      AND finished_at IS NOT NULL)
    OR (status = 'failed'
      AND lease_token_sha256 IS NULL
      AND live_url IS NULL
      AND error_code IS NOT NULL
      AND started_at IS NULL
      AND ready_at IS NULL
      AND opened_at IS NULL
      AND connected_at IS NULL
      AND finished_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX provider_browser_sessions_active_provider_unique
  ON provider_browser_sessions(household_id, provider)
  WHERE status IN ('requested', 'starting', 'ready', 'opened');
CREATE INDEX provider_browser_sessions_household_requested_idx
  ON provider_browser_sessions(household_id, requested_at);
CREATE INDEX provider_browser_sessions_provider_status_idx
  ON provider_browser_sessions(provider, status, requested_at);

CREATE TRIGGER provider_browser_sessions_integrity_insert
BEFORE INSERT ON provider_browser_sessions
BEGIN
  SELECT RAISE(ABORT, 'provider browser session household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM households household
    WHERE household.id = NEW.household_id
      AND household.owner_user_id = NEW.requested_by_user_id
  );

  SELECT RAISE(ABORT, 'provider browser session agent is not registered')
  WHERE NOT (
    (NEW.provider = 'angellist' AND EXISTS (
      SELECT 1
      FROM angellist_mac_agents agent
      WHERE agent.household_id = NEW.household_id
    ))
    OR
    (NEW.provider IN ('tokenfolio', 'sydecar') AND EXISTS (
      SELECT 1
      FROM provider_portfolio_agents agent
      WHERE agent.household_id = NEW.household_id
        AND agent.provider = NEW.provider
    ))
  );
END;

CREATE TRIGGER provider_browser_sessions_transition_update
BEFORE UPDATE ON provider_browser_sessions
WHEN NOT (
  OLD.status = 'requested' AND NEW.status IN (
    'starting', 'expired', 'cancelled', 'failed'
  )
  OR OLD.status = 'starting' AND NEW.status IN (
    'ready', 'expired', 'cancelled', 'failed'
  )
  OR OLD.status = 'ready' AND NEW.status IN (
    'opened', 'expired', 'cancelled', 'failed'
  )
  OR OLD.status = 'opened' AND NEW.status IN (
    'connected', 'expired', 'cancelled', 'failed'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid provider browser session transition');
END;

CREATE TRIGGER provider_browser_sessions_identity_immutable
BEFORE UPDATE ON provider_browser_sessions
WHEN NEW.id <> OLD.id
  OR NEW.household_id <> OLD.household_id
  OR NEW.provider <> OLD.provider
  OR NEW.requested_by_user_id <> OLD.requested_by_user_id
  OR NEW.requested_at <> OLD.requested_at
  OR NEW.expires_at <> OLD.expires_at
  OR NEW.updated_at < OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'provider browser session identity is immutable');
END;

CREATE TRIGGER provider_browser_sessions_no_delete
BEFORE DELETE ON provider_browser_sessions
BEGIN
  SELECT RAISE(ABORT, 'provider browser sessions cannot be deleted');
END;
