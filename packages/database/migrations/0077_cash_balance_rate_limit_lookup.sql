CREATE INDEX connector_sync_runs_cash_rate_limit_idx
  ON connector_sync_runs(connector_account_id, error_code, started_at DESC)
  WHERE cursor = 'cash-live-v1';
