PRAGMA foreign_keys = ON;

-- The target collection projects coverage with three status lookups per
-- company. Keep each correlated lookup on one target-scoped index.
CREATE INDEX portfolio_watch_sources_target_status_idx
  ON portfolio_watch_sources(watch_target_id, status);

-- Portfolio Watch follows the current accepted private-company exposure
-- projection. One company may be reached through several legal positions or
-- SPVs, but it receives one watch target. Historical targets and source
-- evidence are retained in a paused state when the last current exposure
-- mapping leaves the portfolio.
INSERT OR IGNORE INTO portfolio_watch_targets (
  id, household_id, company_id, status, source_policy, last_checked_at,
  created_at
)
SELECT
  'watch-current-exposure-v1:' || exposure.company_id,
  exposure.household_id,
  exposure.company_id,
  'active',
  'public_only',
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM canonical_exposures exposure
WHERE exposure.exposure_kind = 'private_company'
  AND exposure.company_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings mapping
    WHERE mapping.household_id = exposure.household_id
      AND mapping.exposure_id = exposure.id
      AND mapping.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = mapping.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_continuities continuity
        WHERE continuity.predecessor_position_id = mapping.position_id
      )
  );

UPDATE portfolio_watch_targets
SET status = CASE
  WHEN EXISTS (
    SELECT 1
    FROM canonical_exposures exposure
    JOIN holding_position_exposure_mappings mapping
      ON mapping.exposure_id = exposure.id
     AND mapping.household_id = exposure.household_id
    WHERE exposure.household_id = portfolio_watch_targets.household_id
      AND exposure.company_id = portfolio_watch_targets.company_id
      AND exposure.exposure_kind = 'private_company'
      AND mapping.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = mapping.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_continuities continuity
        WHERE continuity.predecessor_position_id = mapping.position_id
      )
  ) THEN 'active'
  ELSE 'paused'
END;

-- Fresh synthetic seeds are applied after migrations. Derive their initial
-- target status too, instead of allowing fixture order to create a manual
-- watch list that disagrees with current exposures.
CREATE TRIGGER portfolio_watch_targets_derive_status_insert
AFTER INSERT ON portfolio_watch_targets
BEGIN
  UPDATE portfolio_watch_targets
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM canonical_exposures exposure
      JOIN holding_position_exposure_mappings mapping
        ON mapping.exposure_id = exposure.id
       AND mapping.household_id = exposure.household_id
      WHERE exposure.household_id = NEW.household_id
        AND exposure.company_id = NEW.company_id
        AND exposure.exposure_kind = 'private_company'
        AND mapping.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_exposure_mappings later
          WHERE later.supersedes_mapping_id = mapping.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_continuities continuity
          WHERE continuity.predecessor_position_id = mapping.position_id
        )
    ) THEN 'active'
    ELSE 'paused'
  END
  WHERE id = NEW.id;
END;

-- Activating a target also registers its reviewed official homepage as due for
-- verification. This makes the daily scheduler sufficient to begin monitoring;
-- Check now remains an optional immediate refresh rather than a bootstrap step.
-- A missing reviewed website host remains an explicit coverage gap.
CREATE TRIGGER portfolio_watch_targets_register_homepage_update
AFTER UPDATE OF status ON portfolio_watch_targets
WHEN NEW.status = 'active'
BEGIN
  INSERT OR IGNORE INTO portfolio_watch_sources (
    id, household_id, watch_target_id, company_id, source_kind, source_class,
    canonical_url, allowed_origin, allowed_path_prefix, status, authority_ppm,
    identity_confidence_ppm, operational_health_ppm, coverage_json,
    auto_activated_at, created_at, updated_at
  )
  SELECT
    'source-homepage-v1:' || NEW.id,
    NEW.household_id,
    NEW.id,
    NEW.company_id,
    'official_company_web',
    'official_company',
    'https://' || lower(company.website_host) || '/',
    'https://' || lower(company.website_host),
    '/',
    'discovered',
    1000000,
    850000,
    0,
    '{"discoveryMethod":"configured_homepage"}',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM companies company
  WHERE company.id = NEW.company_id
    AND company.household_id = NEW.household_id
    AND company.website_host IS NOT NULL;

  INSERT OR IGNORE INTO portfolio_watch_source_verification_events (
    id, household_id, source_id, event_type, reason_code, observed_url,
    normalized_url, http_status, content_type, redirect_url, security_passed,
    authority_ppm, identity_confidence_ppm, coverage_json, occurred_at
  )
  SELECT
    'source-homepage-discovered-v1:' || NEW.id,
    NEW.household_id,
    source.id,
    'discovered',
    'configured_homepage',
    source.canonical_url,
    source.canonical_url,
    NULL,
    NULL,
    NULL,
    1,
    1000000,
    850000,
    '{"discoveryMethod":"configured_homepage"}',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM companies company
  JOIN portfolio_watch_sources source
    ON source.watch_target_id = NEW.id
   AND source.canonical_url =
       'https://' || lower(company.website_host) || '/'
  WHERE company.id = NEW.company_id
    AND company.household_id = NEW.household_id
    AND company.website_host IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM portfolio_watch_source_verification_events existing
      WHERE existing.source_id = source.id
        AND existing.event_type = 'discovered'
        AND existing.reason_code = 'configured_homepage'
    );

  INSERT OR IGNORE INTO portfolio_watch_source_sync_state (
    source_id, next_check_at, consecutive_failure_count, updated_at
  )
  SELECT
    source.id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM companies company
  JOIN portfolio_watch_sources source
    ON source.watch_target_id = NEW.id
   AND source.canonical_url =
       'https://' || lower(company.website_host) || '/'
  WHERE company.id = NEW.company_id
    AND company.household_id = NEW.household_id
    AND company.website_host IS NOT NULL;
END;

-- Targets backfilled earlier in this migration were activated before the
-- registration trigger existed. Re-emit that state once to register their
-- reviewed homepages and make them eligible for the next daily sweep.
UPDATE portfolio_watch_targets
SET status = status
WHERE status = 'active';

CREATE TRIGGER portfolio_watch_targets_sync_mapping_insert
AFTER INSERT ON holding_position_exposure_mappings
BEGIN
  INSERT OR IGNORE INTO portfolio_watch_targets (
    id, household_id, company_id, status, source_policy, last_checked_at,
    created_at
  )
  SELECT
    'watch-current-exposure-v1:' || exposure.company_id,
    exposure.household_id,
    exposure.company_id,
    'active',
    'public_only',
    NULL,
    NEW.accepted_at
  FROM canonical_exposures exposure
  WHERE exposure.id = NEW.exposure_id
    AND exposure.household_id = NEW.household_id
    AND exposure.exposure_kind = 'private_company'
    AND exposure.company_id IS NOT NULL
    AND NEW.status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM holding_position_continuities continuity
      WHERE continuity.predecessor_position_id = NEW.position_id
    );

  UPDATE portfolio_watch_targets
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM canonical_exposures exposure
      JOIN holding_position_exposure_mappings mapping
        ON mapping.exposure_id = exposure.id
       AND mapping.household_id = exposure.household_id
      WHERE exposure.household_id = NEW.household_id
        AND exposure.company_id = portfolio_watch_targets.company_id
        AND exposure.exposure_kind = 'private_company'
        AND mapping.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_exposure_mappings later
          WHERE later.supersedes_mapping_id = mapping.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_continuities continuity
          WHERE continuity.predecessor_position_id = mapping.position_id
        )
    ) THEN 'active'
    ELSE 'paused'
  END
  WHERE household_id = NEW.household_id
    AND company_id = (
      SELECT exposure.company_id
      FROM canonical_exposures exposure
      WHERE exposure.id = NEW.exposure_id
        AND exposure.exposure_kind = 'private_company'
    );
END;

CREATE TRIGGER portfolio_watch_targets_sync_continuity_insert
AFTER INSERT ON holding_position_continuities
BEGIN
  UPDATE portfolio_watch_targets
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM canonical_exposures exposure
      JOIN holding_position_exposure_mappings mapping
        ON mapping.exposure_id = exposure.id
       AND mapping.household_id = exposure.household_id
      WHERE exposure.household_id = NEW.household_id
        AND exposure.company_id = portfolio_watch_targets.company_id
        AND exposure.exposure_kind = 'private_company'
        AND mapping.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_exposure_mappings later
          WHERE later.supersedes_mapping_id = mapping.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_continuities continuity
          WHERE continuity.predecessor_position_id = mapping.position_id
        )
    ) THEN 'active'
    ELSE 'paused'
  END
  WHERE household_id = NEW.household_id
    AND company_id IN (
      SELECT exposure.company_id
      FROM holding_position_exposure_mappings mapping
      JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
      WHERE mapping.household_id = NEW.household_id
        AND mapping.position_id IN (
          NEW.predecessor_position_id,
          NEW.successor_position_id
        )
        AND exposure.exposure_kind = 'private_company'
        AND exposure.company_id IS NOT NULL
    );
END;
