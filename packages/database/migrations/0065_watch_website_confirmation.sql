-- Confirming a company identity is distinct from a successful source read.
CREATE TABLE portfolio_watch_website_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  company_name TEXT NOT NULL,
  website_host TEXT NOT NULL,
  reviewed_url TEXT NOT NULL,
  rationale TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE INDEX portfolio_watch_website_decisions_company_idx
  ON portfolio_watch_website_decisions(company_id, decided_at);
CREATE TRIGGER portfolio_watch_website_decision_capacity
BEFORE INSERT ON portfolio_watch_website_decisions
BEGIN
  SELECT RAISE(ABORT, 'Watch source limit reached; existing sources need correction')
  WHERE EXISTS (
    SELECT 1 FROM portfolio_watch_targets target
    WHERE target.company_id = NEW.company_id AND target.household_id = NEW.household_id AND target.status = 'active'
      AND (SELECT COUNT(*) FROM portfolio_watch_sources source WHERE source.watch_target_id = target.id) >= 50
      AND NOT EXISTS (SELECT 1 FROM portfolio_watch_sources source WHERE source.watch_target_id = target.id AND source.canonical_url = 'https://' || NEW.website_host || '/')
  );
END;
CREATE TRIGGER portfolio_watch_website_decision_insert
BEFORE INSERT ON portfolio_watch_website_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM companies company JOIN households household ON household.id = company.household_id
  WHERE company.id = NEW.company_id AND company.household_id = NEW.household_id
    AND company.legal_name = NEW.company_name AND company.website_host IS NULL
    AND household.owner_user_id = NEW.reviewer_user_id
)
BEGIN SELECT RAISE(ABORT, 'Company website changed; review the current company'); END;
CREATE TRIGGER portfolio_watch_website_decision_apply
AFTER INSERT ON portfolio_watch_website_decisions
BEGIN
  UPDATE companies SET website_host = NEW.website_host, updated_at = NEW.decided_at WHERE id = NEW.company_id;
  UPDATE portfolio_watch_targets SET status = status
    WHERE company_id = NEW.company_id AND household_id = NEW.household_id AND status = 'active';
  -- A legacy target may already own the original deterministic homepage ID.
  -- Retain that history and register this reviewed host under a new identity.
  INSERT OR IGNORE INTO portfolio_watch_sources (
    id, household_id, watch_target_id, company_id, source_kind, source_class,
    canonical_url, allowed_origin, allowed_path_prefix, status, authority_ppm,
    identity_confidence_ppm, operational_health_ppm, coverage_json, created_at, updated_at
  ) SELECT 'source-website-decision:' || NEW.id, NEW.household_id, target.id, NEW.company_id,
    'official_company_web', 'official_company', 'https://' || NEW.website_host || '/',
    'https://' || NEW.website_host, '/', 'discovered', 1000000, 1000000, 0,
    '{"discoveryMethod":"reviewed_website"}', NEW.decided_at, NEW.decided_at
    FROM portfolio_watch_targets target WHERE target.company_id = NEW.company_id
      AND target.household_id = NEW.household_id AND target.status = 'active';
  INSERT OR IGNORE INTO portfolio_watch_source_sync_state (source_id, next_check_at, consecutive_failure_count, updated_at)
    SELECT id, NEW.decided_at, 0, NEW.decided_at FROM portfolio_watch_sources
    WHERE id = 'source-website-decision:' || NEW.id;
  INSERT INTO portfolio_watch_source_verification_events (
    id, household_id, source_id, event_type, reason_code, observed_url, normalized_url,
    security_passed, authority_ppm, identity_confidence_ppm, coverage_json, occurred_at
  ) SELECT 'source-website-decision-event:' || NEW.id, NEW.household_id, id, 'discovered',
    'reviewed_website', NEW.reviewed_url, canonical_url, 0, 1000000, 1000000,
    '{"discoveryMethod":"reviewed_website"}', NEW.decided_at
    FROM portfolio_watch_sources WHERE id = 'source-website-decision:' || NEW.id;
END;
CREATE TRIGGER portfolio_watch_website_decision_no_update BEFORE UPDATE ON portfolio_watch_website_decisions
BEGIN SELECT RAISE(ABORT, 'Website decisions are append-only'); END;
CREATE TRIGGER portfolio_watch_website_decision_no_delete BEFORE DELETE ON portfolio_watch_website_decisions
BEGIN SELECT RAISE(ABORT, 'Website decisions are append-only'); END;
