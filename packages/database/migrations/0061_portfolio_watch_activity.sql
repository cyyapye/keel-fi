CREATE TABLE portfolio_watch_runs (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'scheduled')),
  requested_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL
);
CREATE INDEX portfolio_watch_runs_recent_idx
  ON portfolio_watch_runs(household_id, requested_at DESC, id DESC);
CREATE INDEX portfolio_watch_targets_page_idx ON portfolio_watch_targets(household_id, status, id);
CREATE INDEX portfolio_watch_sources_page_idx ON portfolio_watch_sources(household_id, watch_target_id, canonical_url);

CREATE TABLE portfolio_watch_checks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES portfolio_watch_runs(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES portfolio_watch_sources(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  lease_token TEXT,
  lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
  error_code TEXT,
  signal_count INTEGER NOT NULL DEFAULT 0 CHECK (signal_count BETWEEN 0 AND 40),
  UNIQUE(run_id, source_id)
);
CREATE INDEX portfolio_watch_checks_run_idx ON portfolio_watch_checks(run_id, state);
CREATE UNIQUE INDEX portfolio_watch_checks_active_source_idx
  ON portfolio_watch_checks(source_id) WHERE state IN ('queued', 'running');
CREATE TRIGGER portfolio_watch_checks_scope_insert
BEFORE INSERT ON portfolio_watch_checks
BEGIN
  SELECT RAISE(ABORT, 'watch check scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM portfolio_watch_runs run
    JOIN portfolio_watch_sources source ON source.household_id = run.household_id
    WHERE run.id = NEW.run_id AND source.id = NEW.source_id
  );
  SELECT RAISE(ABORT, 'watch run capacity exceeded') WHERE (
    SELECT COUNT(*) FROM portfolio_watch_checks WHERE run_id = NEW.run_id
  ) >= 40;
END;
CREATE TRIGGER portfolio_watch_checks_identity_update
BEFORE UPDATE OF id, run_id, source_id, requested_at ON portfolio_watch_checks
BEGIN
  SELECT RAISE(ABORT, 'watch check identity cannot change');
END;
CREATE TRIGGER portfolio_watch_checks_terminal_update
BEFORE UPDATE ON portfolio_watch_checks
WHEN OLD.state IN ('succeeded', 'failed', 'skipped')
BEGIN
  SELECT RAISE(ABORT, 'completed watch check cannot change');
END;

ALTER TABLE portfolio_watch_source_sync_state ADD COLUMN last_completed_at TEXT;
ALTER TABLE portfolio_watch_source_sync_state ADD COLUMN last_completed_success_at TEXT;
ALTER TABLE portfolio_watch_source_sync_state ADD COLUMN last_check_requested_at TEXT;
ALTER TABLE portfolio_watch_source_sync_state ADD COLUMN last_check_outcome TEXT;
ALTER TABLE portfolio_watch_source_sync_state ADD COLUMN last_check_error_code TEXT;
ALTER TABLE portfolio_watch_source_sync_state ADD COLUMN last_signal_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public_source_observations ADD COLUMN watch_check_id TEXT REFERENCES portfolio_watch_checks(id) ON DELETE RESTRICT;
CREATE INDEX public_source_observations_check_idx ON public_source_observations(watch_check_id);
CREATE TRIGGER public_source_observations_check_scope_insert
BEFORE INSERT ON public_source_observations WHEN NEW.watch_check_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'observation watch check mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM portfolio_watch_checks WHERE id = NEW.watch_check_id AND source_id = NEW.source_id
  );
END;
