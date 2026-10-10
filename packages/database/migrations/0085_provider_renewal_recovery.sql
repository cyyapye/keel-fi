-- Only operational expiry and fixed error categories leave the browser.
ALTER TABLE provider_session_renewals ADD COLUMN refresh_expires_at TEXT;
ALTER TABLE provider_session_renewals ADD COLUMN last_failure_reason TEXT
  CHECK (last_failure_reason IS NULL OR last_failure_reason IN (
    'transport', 'unavailable', 'unverified', 'authorization'
  ));

-- At most nine attempts per agent survive the rolling-day admission window.
-- This is a workload guard, not a credential store or financial history.
CREATE TABLE provider_session_renewal_attempts (
  agent_id TEXT NOT NULL REFERENCES provider_session_renewals(agent_id) ON DELETE RESTRICT,
  lease_token_sha256 TEXT NOT NULL CHECK (
    length(lease_token_sha256) = 64 AND lease_token_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  attempted_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, lease_token_sha256)
);
CREATE INDEX provider_session_renewal_attempts_window
  ON provider_session_renewal_attempts(agent_id, attempted_at);
