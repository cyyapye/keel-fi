PRAGMA foreign_keys = ON;

-- A Plaid Item recreated after retained history was imported can produce a new
-- canonical position for the same legal holding. Preserve both accepted
-- records, but record the one-to-one continuation so only the newer position
-- participates in current ownership, exposure, and planning projections.
CREATE TABLE holding_position_continuities (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  predecessor_position_id TEXT NOT NULL UNIQUE
    REFERENCES holding_positions(id) ON DELETE RESTRICT,
  predecessor_snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  successor_position_id TEXT NOT NULL UNIQUE
    REFERENCES holding_positions(id) ON DELETE RESTRICT,
  successor_snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  resolution_method TEXT NOT NULL CHECK (
    resolution_method = 'exact_reconnect_snapshot_v1'
  ),
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (predecessor_position_id <> successor_position_id)
);

CREATE INDEX holding_position_continuities_household_idx
  ON holding_position_continuities(
    household_id, predecessor_position_id, successor_position_id
  );

CREATE TRIGGER holding_position_continuities_integrity_insert
BEFORE INSERT ON holding_position_continuities
BEGIN
  SELECT RAISE(ABORT, 'holding position continuity evidence mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_positions predecessor
    JOIN holding_position_snapshots predecessor_snapshot
      ON predecessor_snapshot.id = NEW.predecessor_snapshot_id
     AND predecessor_snapshot.position_id = predecessor.id
    JOIN holding_import_applications predecessor_application
      ON predecessor_application.position_id = predecessor.id
     AND predecessor_application.snapshot_id = predecessor_snapshot.id
    JOIN holding_import_rows predecessor_row
      ON predecessor_row.id = predecessor_application.import_row_id
    LEFT JOIN holding_import_row_public_exposure_evidence predecessor_retained
      ON predecessor_retained.import_row_id = predecessor_row.id
     AND predecessor_retained.resolution_status = 'strong_identifier'
    JOIN holding_position_ownerships predecessor_ownership
      ON predecessor_ownership.position_id = predecessor.id
     AND NOT EXISTS (
       SELECT 1
       FROM holding_position_ownerships later_predecessor_ownership
       WHERE later_predecessor_ownership.supersedes_ownership_id =
             predecessor_ownership.id
     )
    JOIN ownership_containers predecessor_container
      ON predecessor_container.id = predecessor_ownership.container_id
    JOIN ownership_container_versions predecessor_container_version
      ON predecessor_container_version.container_id = predecessor_container.id
     AND NOT EXISTS (
       SELECT 1
       FROM ownership_container_versions later_predecessor_container_version
       WHERE later_predecessor_container_version.supersedes_version_id =
             predecessor_container_version.id
     )
    JOIN investment_connections predecessor_connection
      ON predecessor_connection.id = predecessor_container.connection_id
    JOIN holding_positions successor
      ON successor.id = NEW.successor_position_id
    JOIN holding_position_snapshots successor_snapshot
      ON successor_snapshot.id = NEW.successor_snapshot_id
     AND successor_snapshot.position_id = successor.id
    JOIN holding_import_applications successor_application
      ON successor_application.position_id = successor.id
     AND successor_application.snapshot_id = successor_snapshot.id
    JOIN holding_import_rows successor_row
      ON successor_row.id = successor_application.import_row_id
    LEFT JOIN holding_import_row_public_exposure_evidence successor_retained
      ON successor_retained.import_row_id = successor_row.id
     AND successor_retained.resolution_status = 'strong_identifier'
    JOIN holding_position_ownerships successor_ownership
      ON successor_ownership.position_id = successor.id
     AND NOT EXISTS (
       SELECT 1
       FROM holding_position_ownerships later_successor_ownership
       WHERE later_successor_ownership.supersedes_ownership_id =
             successor_ownership.id
     )
    JOIN ownership_containers successor_container
      ON successor_container.id = successor_ownership.container_id
    JOIN ownership_container_versions successor_container_version
      ON successor_container_version.container_id = successor_container.id
     AND NOT EXISTS (
       SELECT 1
       FROM ownership_container_versions later_successor_container_version
       WHERE later_successor_container_version.supersedes_version_id =
             successor_container_version.id
     )
    JOIN investment_connections successor_connection
      ON successor_connection.id = successor_container.connection_id
    JOIN households household ON household.id = NEW.household_id
    WHERE predecessor.id = NEW.predecessor_position_id
      AND predecessor.household_id = NEW.household_id
      AND successor.household_id = NEW.household_id
      AND predecessor_snapshot.household_id = NEW.household_id
      AND successor_snapshot.household_id = NEW.household_id
      AND predecessor.provider = 'plaid_investments'
      AND successor.provider = 'plaid_investments'
      AND predecessor.position_kind = 'direct'
      AND successor.position_kind = 'direct'
      AND predecessor_connection.adapter_type = 'plaid-investments'
      AND successor_connection.adapter_type = 'plaid-investments'
      AND predecessor_connection.id LIKE
          'reconciled-holding-connection-v1:%'
      AND successor_connection.id NOT LIKE
          'reconciled-holding-connection-v1:%'
      AND lower(trim(predecessor.legal_vehicle_name)) =
          lower(trim(successor.legal_vehicle_name))
      AND lower(trim(predecessor_container_version.display_label)) =
          lower(trim(successor_container_version.display_label))
      AND predecessor_snapshot.provider_status = 'live'
      AND successor_snapshot.provider_status = 'live'
      AND lower(trim(predecessor_snapshot.instrument_type)) =
          lower(trim(successor_snapshot.instrument_type))
      AND predecessor_snapshot.currency = successor_snapshot.currency
      AND predecessor_snapshot.ticker IS NOT NULL
      AND successor_snapshot.ticker IS NOT NULL
      AND upper(trim(predecessor_snapshot.ticker)) =
          upper(trim(successor_snapshot.ticker))
      AND predecessor_snapshot.quantity_micros IS NOT NULL
      AND predecessor_snapshot.quantity_micros =
          successor_snapshot.quantity_micros
      AND predecessor_snapshot.cost_basis_minor IS NOT NULL
      AND predecessor_snapshot.cost_basis_minor =
          successor_snapshot.cost_basis_minor
      AND COALESCE(
            predecessor_row.protected_exposure_key,
            predecessor_retained.protected_identity_key
          ) IS COALESCE(
            successor_row.protected_exposure_key,
            successor_retained.protected_identity_key
          )
      AND predecessor_snapshot.observed_at < successor_snapshot.observed_at
      AND household.owner_user_id = NEW.recorded_by_user_id
  );
END;

CREATE TRIGGER holding_position_continuities_no_update
BEFORE UPDATE ON holding_position_continuities
BEGIN
  SELECT RAISE(ABORT, 'holding position continuity is immutable');
END;

CREATE TRIGGER holding_position_continuities_no_delete
BEFORE DELETE ON holding_position_continuities
BEGIN
  SELECT RAISE(ABORT, 'holding position continuity is immutable');
END;

-- Repair retained history already followed by a uniquely matching current
-- Plaid position. Exact ticker, quantity, cost basis, legal vehicle, and
-- account label are all required. Either-side ambiguity deliberately yields no
-- decision.
CREATE VIEW holding_position_continuity_candidates_v1 AS
WITH latest_positions AS (
  SELECT
    position.id AS position_id,
    position.household_id,
    position.legal_vehicle_name,
    connection.id AS connection_id,
    container_version.display_label AS container_label,
    snapshot.id AS snapshot_id,
    snapshot.provider_status,
    snapshot.instrument_type,
    snapshot.currency,
    snapshot.quantity_micros,
    snapshot.ticker,
    snapshot.cost_basis_minor,
    snapshot.observed_at,
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
     WHERE later_container_version.supersedes_version_id = container_version.id
   )
  JOIN investment_connections connection ON connection.id = container.connection_id
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
  JOIN holding_position_snapshots snapshot ON snapshot.id = application.snapshot_id
  JOIN holding_import_rows row ON row.id = application.import_row_id
  LEFT JOIN holding_import_row_public_exposure_evidence retained
    ON retained.import_row_id = row.id
   AND retained.resolution_status = 'strong_identifier'
  WHERE position.provider = 'plaid_investments'
    AND position.position_kind = 'direct'
    AND connection.adapter_type = 'plaid-investments'
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
   AND successor.strong_identity_key IS predecessor.strong_identity_key
   AND successor.observed_at > predecessor.observed_at
  WHERE predecessor.connection_id LIKE
        'reconciled-holding-connection-v1:%'
    AND NOT EXISTS (
      SELECT 1
      FROM holding_position_continuities existing
      WHERE existing.predecessor_position_id = predecessor.position_id
         OR existing.successor_position_id = successor.position_id
    )
), unique_pairs AS (
  SELECT candidate.*
  FROM candidate_pairs candidate
  WHERE 1 = (
      SELECT COUNT(*)
      FROM candidate_pairs same_predecessor
      WHERE same_predecessor.predecessor_position_id =
            candidate.predecessor_position_id
    )
    AND 1 = (
      SELECT COUNT(*)
      FROM candidate_pairs same_successor
      WHERE same_successor.successor_position_id = candidate.successor_position_id
    )
)
SELECT * FROM unique_pairs;

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

INSERT INTO holding_position_continuities (
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
