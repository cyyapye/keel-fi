PRAGMA defer_foreign_keys = ON;

-- A live private-provider connection can follow accepted rows retained under the
-- reviewed-history connection. Preserve both immutable records, but treat an
-- exact, unique natural-position match as one continuing legal position so its
-- value appears only once in current position, exposure, and baseline views.
-- Company identity alone is never sufficient: distinct SPVs remain distinct.
-- A D1 CPU reset may interrupt the remote request after SQLite has begun the
-- batch. Make the retry safe whether that batch was rolled back or retained.
DROP TRIGGER IF EXISTS holding_position_continuities_integrity_insert;
DROP TRIGGER IF EXISTS holding_position_continuities_unique_candidate_insert;
DROP VIEW IF EXISTS holding_position_continuity_candidates_v1;
DROP VIEW IF EXISTS holding_position_continuity_evidence_v1;

CREATE VIEW holding_position_continuity_evidence_v1 AS
WITH latest_positions AS (
  SELECT
    position.id AS position_id,
    position.household_id,
    position.provider,
    position.legal_vehicle_name,
    position.position_kind,
    connection.id AS connection_id,
    connection.adapter_type,
    container_version.display_label AS container_label,
    snapshot.id AS snapshot_id,
    snapshot.provider_status,
    snapshot.invested_minor,
    snapshot.allocation_minor,
    snapshot.instrument_type,
    snapshot.currency,
    snapshot.quantity_micros,
    snapshot.ticker,
    snapshot.cost_basis_minor,
    snapshot.observed_at,
    row.exposure_label,
    row.invested_on,
    COALESCE(
      row.protected_exposure_key,
      retained.protected_identity_key
    ) AS strong_identity_key,
    application.applied_at
  FROM holding_positions position
  JOIN holding_position_ownerships ownership
    ON ownership.position_id = position.id
   AND NOT EXISTS (
     SELECT 1
     FROM holding_position_ownerships later_ownership
     WHERE later_ownership.supersedes_ownership_id = ownership.id
   )
  JOIN ownership_containers container ON container.id = ownership.container_id
  JOIN ownership_container_versions container_version
    ON container_version.container_id = container.id
   AND NOT EXISTS (
     SELECT 1
     FROM ownership_container_versions later_container_version
     WHERE later_container_version.supersedes_version_id =
           container_version.id
   )
  JOIN investment_connections connection
    ON connection.id = container.connection_id
  JOIN holding_import_applications application
    ON application.id = (
      SELECT candidate.id
      FROM holding_import_applications candidate
      JOIN holding_position_snapshots candidate_snapshot
        ON candidate_snapshot.id = candidate.snapshot_id
      WHERE candidate.position_id = position.id
      ORDER BY candidate.applied_at DESC,
               candidate_snapshot.observed_at DESC,
               candidate.id DESC
      LIMIT 1
    )
  JOIN holding_position_snapshots snapshot
    ON snapshot.id = application.snapshot_id
  JOIN holding_import_rows row ON row.id = application.import_row_id
  LEFT JOIN holding_import_row_public_exposure_evidence retained
    ON retained.import_row_id = row.id
   AND retained.resolution_status = 'strong_identifier'
  WHERE position.provider IN (
      'plaid_investments', 'angellist', 'tokenfolio', 'sydecar'
    )
    AND snapshot.provider_status = 'live'
), candidate_pairs AS (
  SELECT
    predecessor.household_id,
    predecessor.position_id AS predecessor_position_id,
    predecessor.snapshot_id AS predecessor_snapshot_id,
    successor.position_id AS successor_position_id,
    successor.snapshot_id AS successor_snapshot_id,
    successor.applied_at AS recorded_at
  FROM latest_positions predecessor
  JOIN latest_positions successor
    ON successor.household_id = predecessor.household_id
   AND successor.connection_id NOT LIKE
       'reconciled-holding-connection-v1:%'
   AND (
     (
       predecessor.provider = 'plaid_investments'
       AND successor.provider = 'plaid_investments'
       AND predecessor.position_kind = 'direct'
       AND successor.position_kind = 'direct'
       AND predecessor.adapter_type = 'plaid-investments'
       AND successor.adapter_type = 'plaid-investments'
       AND lower(trim(successor.legal_vehicle_name)) =
           lower(trim(predecessor.legal_vehicle_name))
       AND lower(trim(successor.container_label)) =
           lower(trim(predecessor.container_label))
       AND lower(trim(successor.instrument_type)) =
           lower(trim(predecessor.instrument_type))
       AND successor.currency = predecessor.currency
       AND successor.ticker IS NOT NULL
       AND predecessor.ticker IS NOT NULL
       AND upper(trim(successor.ticker)) = upper(trim(predecessor.ticker))
       AND successor.quantity_micros IS NOT NULL
       AND successor.quantity_micros = predecessor.quantity_micros
       AND successor.cost_basis_minor IS NOT NULL
       AND successor.cost_basis_minor = predecessor.cost_basis_minor
       AND (
         successor.strong_identity_key IS NULL
         OR predecessor.strong_identity_key IS NULL
         OR successor.strong_identity_key = predecessor.strong_identity_key
       )
       AND successor.observed_at > predecessor.observed_at
     )
     OR
     (
       predecessor.provider IN ('angellist', 'tokenfolio', 'sydecar')
       AND successor.provider = predecessor.provider
       AND successor.adapter_type = predecessor.adapter_type
       AND successor.position_kind = predecessor.position_kind
       AND lower(trim(successor.legal_vehicle_name)) =
           lower(trim(predecessor.legal_vehicle_name))
       AND lower(trim(successor.container_label)) =
           lower(trim(predecessor.container_label))
       AND lower(trim(successor.exposure_label)) =
           lower(trim(predecessor.exposure_label))
       AND successor.invested_on IS predecessor.invested_on
       AND lower(trim(successor.instrument_type)) =
           lower(trim(predecessor.instrument_type))
       AND successor.currency = predecessor.currency
       AND successor.invested_minor = predecessor.invested_minor
       AND successor.allocation_minor = predecessor.allocation_minor
       AND (
         successor.observed_at > predecessor.observed_at
         OR (
           successor.observed_at = predecessor.observed_at
           AND successor.applied_at > predecessor.applied_at
         )
       )
     )
   )
  WHERE predecessor.connection_id LIKE
        'reconciled-holding-connection-v1:%'
    AND NOT EXISTS (
      SELECT 1
      FROM holding_position_continuities existing
      WHERE existing.predecessor_position_id = predecessor.position_id
         OR existing.successor_position_id = successor.position_id
    )
)
SELECT * FROM candidate_pairs;

CREATE VIEW holding_position_continuity_candidates_v1 AS
WITH candidate_counts AS (
  SELECT
    candidate.*,
    COUNT(*) OVER (
      PARTITION BY candidate.predecessor_position_id
    ) AS predecessor_candidate_count,
    COUNT(*) OVER (
      PARTITION BY candidate.successor_position_id
    ) AS successor_candidate_count
  FROM holding_position_continuity_evidence_v1 candidate
)
SELECT
  household_id,
  predecessor_position_id,
  predecessor_snapshot_id,
  successor_position_id,
  successor_snapshot_id,
  recorded_at
FROM candidate_counts
WHERE predecessor_candidate_count = 1
  AND successor_candidate_count = 1;

INSERT OR IGNORE INTO holding_position_continuities (
  id, household_id, predecessor_position_id, predecessor_snapshot_id,
  successor_position_id, successor_snapshot_id, resolution_method,
  recorded_by_user_id, recorded_at, immutable
)
SELECT
  'holding-position-continuity-v1:' || candidate.predecessor_position_id || ':' ||
    candidate.successor_position_id,
  candidate.household_id,
  candidate.predecessor_position_id,
  candidate.predecessor_snapshot_id,
  candidate.successor_position_id,
  candidate.successor_snapshot_id,
  'exact_reconnect_snapshot_v1',
  household.owner_user_id,
  candidate.recorded_at,
  1
FROM holding_position_continuity_candidates_v1 candidate
JOIN households household ON household.id = candidate.household_id;

-- The backfill above is already sourced from the exact, unique evidence view.
-- Restore row-level validation after the set-based insert so D1 does not
-- recompute the entire candidate graph for every historical row.
CREATE TRIGGER holding_position_continuities_integrity_insert
BEFORE INSERT ON holding_position_continuities
BEGIN
  SELECT RAISE(ABORT, 'holding position continuity evidence mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_position_continuity_evidence_v1 evidence
    JOIN households household ON household.id = evidence.household_id
    WHERE evidence.household_id = NEW.household_id
      AND evidence.predecessor_position_id = NEW.predecessor_position_id
      AND evidence.predecessor_snapshot_id = NEW.predecessor_snapshot_id
      AND evidence.successor_position_id = NEW.successor_position_id
      AND evidence.successor_snapshot_id = NEW.successor_snapshot_id
      AND household.owner_user_id = NEW.recorded_by_user_id
  );
END;

CREATE TRIGGER holding_position_continuities_unique_candidate_insert
BEFORE INSERT ON holding_position_continuities
BEGIN
  SELECT RAISE(ABORT, 'holding position continuity is not a unique candidate')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_position_continuity_candidates_v1 candidate
    WHERE candidate.household_id = NEW.household_id
      AND candidate.predecessor_position_id = NEW.predecessor_position_id
      AND candidate.predecessor_snapshot_id = NEW.predecessor_snapshot_id
      AND candidate.successor_position_id = NEW.successor_position_id
      AND candidate.successor_snapshot_id = NEW.successor_snapshot_id
  );
END;

PRAGMA defer_foreign_keys = OFF;
