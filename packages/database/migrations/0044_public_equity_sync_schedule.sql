PRAGMA foreign_keys = ON;

-- The daily scheduler starts from active Plaid Investments accounts and then
-- resolves exact canonical connection lineage. Keep that bounded scan indexed
-- without making display labels or provider text part of identity.
CREATE INDEX connector_accounts_investment_schedule_idx
  ON connector_accounts(status, household_id, id)
  WHERE connector_type = 'plaid-investments'
    AND provider_account_key IS NOT NULL;

-- Scheduled eligibility reads the latest exact-connection attempt and checks
-- for review work without scanning unrelated connection history.
CREATE INDEX connector_sync_investment_connections_connection_created_idx
  ON connector_sync_investment_connections(
    connection_id, created_at DESC, sync_run_id
  );

CREATE INDEX holding_import_connections_connection_import_idx
  ON holding_import_connections(connection_id, import_id, household_id);
