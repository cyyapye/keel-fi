PRAGMA foreign_keys = ON;

ALTER TABLE connector_accounts
ADD COLUMN provider_account_key TEXT CHECK (
  provider_account_key IS NULL
  OR (
    provider_account_key NOT GLOB '*[^0-9a-f]*'
    AND length(provider_account_key) = 64
  )
);

CREATE UNIQUE INDEX connector_accounts_provider_account_key_unique
  ON connector_accounts(connector_type, provider_account_key)
  WHERE provider_account_key IS NOT NULL;

CREATE TABLE plaid_webhook_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL
    REFERENCES households(id) ON DELETE RESTRICT,
  connector_account_id TEXT NOT NULL
    REFERENCES connector_accounts(id) ON DELETE RESTRICT,
  signature_sha256 TEXT NOT NULL UNIQUE CHECK (
    signature_sha256 NOT GLOB '*[^0-9a-f]*'
    AND length(signature_sha256) = 64
  ),
  body_sha256 TEXT NOT NULL CHECK (
    body_sha256 NOT GLOB '*[^0-9a-f]*'
    AND length(body_sha256) = 64
  ),
  issued_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('received', 'queued', 'processing', 'processed', 'failed')
  ),
  updated_at TEXT NOT NULL
);

CREATE INDEX plaid_webhook_deliveries_account_received_idx
  ON plaid_webhook_deliveries(connector_account_id, received_at);

CREATE INDEX plaid_webhook_deliveries_status_received_idx
  ON plaid_webhook_deliveries(status, received_at);
