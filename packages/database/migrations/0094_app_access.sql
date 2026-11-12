CREATE TABLE app_access_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 256),
  origin TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL CHECK(json_valid(redirect_uris_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE app_access_grants (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('key','oauth')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 256),
  client_id TEXT REFERENCES app_access_clients(id),
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  agent_rotation INTEGER NOT NULL CHECK(agent_rotation IN (0,1)),
  key_suffix TEXT,
  previous_key_expires_at TEXT,
  CHECK((kind='key' AND expires_at IS NOT NULL AND client_id IS NULL) OR (kind='oauth' AND client_id IS NOT NULL AND agent_rotation=0))
) STRICT;
CREATE INDEX app_access_grants_household_page ON app_access_grants(household_id,kind,sequence DESC);
CREATE INDEX app_access_grants_client ON app_access_grants(client_id);
CREATE INDEX app_access_grants_user ON app_access_grants(user_id);
CREATE INDEX app_access_grants_active ON app_access_grants(household_id,revoked_at,expires_at);

CREATE TABLE app_access_credentials (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES app_access_grants(id),
  kind TEXT NOT NULL CHECK(kind IN ('key','access','refresh')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  replaced_by TEXT,
  revoked_at TEXT
) STRICT;
CREATE INDEX app_access_credentials_grant ON app_access_credentials(grant_id,kind,created_at);

CREATE TABLE app_access_codes (
  code_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES app_access_grants(id),
  client_id TEXT NOT NULL REFERENCES app_access_clients(id),
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_pair TEXT
) STRICT;
CREATE INDEX app_access_codes_grant ON app_access_codes(grant_id);
CREATE INDEX app_access_codes_client ON app_access_codes(client_id);

CREATE TRIGGER app_access_grant_capacity BEFORE INSERT ON app_access_grants
WHEN ((SELECT count(*) FROM app_access_grants WHERE household_id=NEW.household_id AND revoked_at IS NULL AND expires_at IS NULL)+(SELECT count(*) FROM app_access_grants WHERE household_id=NEW.household_id AND revoked_at IS NULL AND expires_at>NEW.created_at))>=120
BEGIN SELECT RAISE(ABORT,'App access limit reached. Revoke an unused connection.'); END;

CREATE TRIGGER app_access_client_capacity BEFORE INSERT ON app_access_clients
WHEN (SELECT count(*) FROM app_access_clients)>=4096
BEGIN SELECT RAISE(ABORT,'Client registration capacity reached.'); END;
