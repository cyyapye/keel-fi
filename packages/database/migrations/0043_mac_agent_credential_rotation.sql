PRAGMA foreign_keys = ON;

-- Machine credentials rotate with a safe overlap. The current credential stays
-- valid until the agent stores and successfully uses its replacement. A normal
-- setup still revokes every prior credential immediately.
DROP INDEX mac_agent_credentials_active_target_unique;

CREATE INDEX mac_agent_credentials_active_target_idx
  ON mac_agent_credentials(household_id, target, issued_at)
  WHERE revoked_at IS NULL;
