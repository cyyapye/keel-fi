PRAGMA foreign_keys = ON;

-- A one-time authenticated setup issues an opaque, target-scoped credential.
-- Only its SHA-256 digest is stored. Provider browser sessions stay on the Mac,
-- and every uploaded capture continues through holding-import review.
CREATE TABLE mac_agent_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL
    REFERENCES households(id) ON DELETE RESTRICT,
  target TEXT NOT NULL CHECK (
    target IN ('angellist', 'tokenfolio', 'sydecar')
  ),
  token_sha256 TEXT NOT NULL CHECK (
    length(token_sha256) = 64
    AND token_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  issued_by_user_id TEXT NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  issued_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  UNIQUE (token_sha256),
  CHECK (last_used_at IS NULL OR last_used_at >= issued_at),
  CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);

CREATE UNIQUE INDEX mac_agent_credentials_active_target_unique
  ON mac_agent_credentials(household_id, target)
  WHERE revoked_at IS NULL;
CREATE INDEX mac_agent_credentials_household_issued_idx
  ON mac_agent_credentials(household_id, issued_at);

CREATE TRIGGER mac_agent_credentials_integrity_insert
BEFORE INSERT ON mac_agent_credentials
BEGIN
  SELECT RAISE(ABORT, 'Mac agent credential household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM households household
    WHERE household.id = NEW.household_id
      AND household.owner_user_id = NEW.issued_by_user_id
  );

  SELECT RAISE(ABORT, 'Mac agent credential target is not registered')
  WHERE NOT (
    (NEW.target = 'angellist' AND EXISTS (
      SELECT 1
      FROM angellist_mac_agents agent
      WHERE agent.household_id = NEW.household_id
    ))
    OR
    (NEW.target IN ('tokenfolio', 'sydecar') AND EXISTS (
      SELECT 1
      FROM provider_portfolio_agents agent
      WHERE agent.household_id = NEW.household_id
        AND agent.provider = NEW.target
    ))
  );
END;

CREATE TRIGGER mac_agent_credentials_identity_immutable
BEFORE UPDATE ON mac_agent_credentials
WHEN NEW.id <> OLD.id
  OR NEW.household_id <> OLD.household_id
  OR NEW.target <> OLD.target
  OR NEW.token_sha256 <> OLD.token_sha256
  OR NEW.issued_by_user_id <> OLD.issued_by_user_id
  OR NEW.issued_at <> OLD.issued_at
BEGIN
  SELECT RAISE(ABORT, 'Mac agent credential identity is immutable');
END;

CREATE TRIGGER mac_agent_credentials_state_forward_only
BEFORE UPDATE ON mac_agent_credentials
WHEN (OLD.last_used_at IS NOT NULL AND NEW.last_used_at IS NULL)
  OR (OLD.last_used_at IS NOT NULL AND NEW.last_used_at < OLD.last_used_at)
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
BEGIN
  SELECT RAISE(ABORT, 'Mac agent credential state must move forward');
END;

CREATE TRIGGER mac_agent_credentials_no_delete
BEFORE DELETE ON mac_agent_credentials
BEGIN
  SELECT RAISE(ABORT, 'Mac agent credentials cannot be deleted');
END;
