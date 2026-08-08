CREATE TABLE portfolio_watch_sources (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  watch_target_id TEXT NOT NULL REFERENCES portfolio_watch_targets(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('official_company_web', 'official_rss', 'official_atom')
  ),
  source_class TEXT NOT NULL CHECK (source_class = 'official_company'),
  canonical_url TEXT NOT NULL,
  allowed_origin TEXT NOT NULL,
  allowed_path_prefix TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'discovered',
      'verified',
      'active',
      'degraded',
      'quarantined',
      'revoked'
    )
  ),
  authority_ppm INTEGER NOT NULL
    CHECK (authority_ppm BETWEEN 0 AND 1000000),
  identity_confidence_ppm INTEGER NOT NULL
    CHECK (identity_confidence_ppm BETWEEN 0 AND 1000000),
  operational_health_ppm INTEGER NOT NULL
    CHECK (operational_health_ppm BETWEEN 0 AND 1000000),
  coverage_json TEXT NOT NULL,
  auto_activated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (watch_target_id, canonical_url)
);
CREATE INDEX portfolio_watch_sources_ready_idx
  ON portfolio_watch_sources(status, updated_at);
CREATE INDEX portfolio_watch_sources_company_idx
  ON portfolio_watch_sources(household_id, company_id, status);

-- A source is scoped to one household through both its watch target and
-- company.  SQLite foreign keys cannot express that composite relationship,
-- so keep it explicit at the storage boundary.
CREATE TRIGGER portfolio_watch_sources_integrity_insert
BEFORE INSERT ON portfolio_watch_sources
BEGIN
  SELECT RAISE(ABORT, 'portfolio watch source household or company mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM portfolio_watch_targets target
    JOIN companies company ON company.id = target.company_id
    WHERE target.id = NEW.watch_target_id
      AND target.household_id = NEW.household_id
      AND target.company_id = NEW.company_id
      AND company.household_id = NEW.household_id
  );
END;

CREATE TRIGGER portfolio_watch_sources_integrity_update
BEFORE UPDATE OF household_id, watch_target_id, company_id
ON portfolio_watch_sources
BEGIN
  SELECT RAISE(ABORT, 'portfolio watch source household or company mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM portfolio_watch_targets target
    JOIN companies company ON company.id = target.company_id
    WHERE target.id = NEW.watch_target_id
      AND target.household_id = NEW.household_id
      AND target.company_id = NEW.company_id
      AND company.household_id = NEW.household_id
  );
END;

CREATE TABLE portfolio_watch_source_verification_events (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES portfolio_watch_sources(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'discovered',
      'verified',
      'activated',
      'degraded',
      'quarantined',
      'revoked'
    )
  ),
  reason_code TEXT NOT NULL,
  observed_url TEXT NOT NULL,
  normalized_url TEXT,
  http_status INTEGER,
  content_type TEXT,
  redirect_url TEXT,
  security_passed INTEGER NOT NULL CHECK (security_passed IN (0, 1)),
  authority_ppm INTEGER NOT NULL
    CHECK (authority_ppm BETWEEN 0 AND 1000000),
  identity_confidence_ppm INTEGER NOT NULL
    CHECK (identity_confidence_ppm BETWEEN 0 AND 1000000),
  coverage_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX portfolio_watch_source_verification_events_source_idx
  ON portfolio_watch_source_verification_events(source_id, occurred_at);

CREATE TRIGGER portfolio_watch_source_verification_events_integrity_insert
BEFORE INSERT ON portfolio_watch_source_verification_events
BEGIN
  SELECT RAISE(ABORT, 'portfolio watch verification household mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM portfolio_watch_sources source
    WHERE source.id = NEW.source_id
      AND source.household_id = NEW.household_id
  );
END;

CREATE TRIGGER portfolio_watch_source_verification_events_no_update
BEFORE UPDATE ON portfolio_watch_source_verification_events
BEGIN
  SELECT RAISE(ABORT, 'portfolio watch source verification events are immutable');
END;

CREATE TRIGGER portfolio_watch_source_verification_events_no_delete
BEFORE DELETE ON portfolio_watch_source_verification_events
BEGIN
  SELECT RAISE(ABORT, 'portfolio watch source verification events are immutable');
END;

CREATE TABLE portfolio_watch_source_sync_state (
  source_id TEXT PRIMARY KEY NOT NULL
    REFERENCES portfolio_watch_sources(id) ON DELETE RESTRICT,
  etag TEXT,
  last_modified TEXT,
  last_content_sha256 TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_check_at TEXT NOT NULL,
  last_http_status INTEGER,
  consecutive_failure_count INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_failure_count >= 0),
  last_error_code TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX portfolio_watch_source_sync_due_idx
  ON portfolio_watch_source_sync_state(next_check_at);

ALTER TABLE public_source_observations
  ADD COLUMN source_id TEXT REFERENCES portfolio_watch_sources(id) ON DELETE RESTRICT;
CREATE INDEX public_source_observations_source_published_idx
  ON public_source_observations(source_id, published_at);

-- `source_id` is optional to preserve prior source classes. When it is set,
-- the observation, evidence event, and retained source document must all be
-- within the source's household and company.
CREATE TRIGGER public_source_observations_source_integrity_insert
BEFORE INSERT ON public_source_observations
WHEN NEW.source_id IS NOT NULL
BEGIN
  SELECT RAISE(
    ABORT,
    'portfolio watch observation household or company mismatch'
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM portfolio_watch_sources source
    JOIN evidence_events event ON event.id = NEW.evidence_event_id
    JOIN source_documents document ON document.id = NEW.source_document_id
    WHERE source.id = NEW.source_id
      AND source.household_id = NEW.household_id
      AND source.company_id = NEW.company_id
      AND event.household_id = NEW.household_id
      AND event.company_id = NEW.company_id
      AND event.source_document_id = NEW.source_document_id
      AND document.household_id = NEW.household_id
  );
END;
