-- Bounded runtime reads. Operational heartbeat columns remain unindexed.
CREATE INDEX holding_import_quarantines_import_all_idx
  ON holding_import_quarantines(import_id, import_row_id, position_id);
CREATE INDEX connector_sync_runs_cash_flow_latest_idx
  ON connector_sync_runs(household_id, started_at DESC, id DESC)
  WHERE cursor IN ('cash-flow-initial-v1', 'cash-flow-incremental-v1');
CREATE INDEX connector_sync_runs_household_active_idx
  ON connector_sync_runs(household_id, cursor)
  WHERE status IN ('queued', 'running');
CREATE INDEX connector_sync_runs_cash_live_latest_idx
  ON connector_sync_runs(connector_account_id, started_at DESC)
  WHERE cursor = 'cash-live-v1';

-- Same observation date can have many accepted captures. Cover the complete
-- latest-snapshot ordering instead of sorting every historical tied date.
DROP INDEX holding_position_snapshots_position_idx;
DROP INDEX holding_position_snapshots_observed_idx;
CREATE INDEX holding_position_snapshots_observed_idx
  ON holding_position_snapshots(position_id, observed_at DESC, created_at DESC);
DROP INDEX holding_import_coverages_household_container_idx;
CREATE INDEX holding_import_coverages_household_container_idx
  ON holding_import_coverages(household_id, container_id, observed_at DESC, created_at DESC, id DESC);

-- Operational retry state only. A bad source must not occupy every bounded
-- maintenance slot or be read from object storage again on each page visit.
CREATE TABLE retained_public_exposure_document_failures (
  import_id TEXT PRIMARY KEY REFERENCES holding_imports(id) ON DELETE RESTRICT,
  last_attempt_at TEXT NOT NULL
);

-- These seven indexes exactly duplicate existing UNIQUE indexes, including
-- column order and collation. Keep uniqueness and remove their extra writes.
DROP INDEX cash_balance_proposal_rows_proposal_idx;
DROP INDEX portfolio_baseline_cash_items_baseline_idx;
DROP INDEX liability_proposal_rows_proposal_idx;
DROP INDEX cash_flow_proposal_months_proposal_idx;
DROP INDEX cash_flow_proposal_categories_proposal_idx;
DROP INDEX portfolio_baseline_items_baseline_idx;
DROP INDEX holding_import_rows_import_idx;

CREATE INDEX holding_positions_continuity_match_idx
  ON holding_positions(household_id, provider, lower(trim(legal_vehicle_name)));

-- Preserve the evidence and uniqueness rules while pushing household scope
-- into both sides of the candidate graph. No financial record is rewritten.
DROP VIEW holding_position_continuity_candidates_v1;
DROP VIEW holding_position_continuity_evidence_v1;

CREATE VIEW holding_position_continuity_evidence_v1 AS
WITH latest_positions AS NOT MATERIALIZED (
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
    predecessor.provider,
    lower(trim(predecessor.legal_vehicle_name)) AS normalized_legal_vehicle_name,
    predecessor.position_id AS predecessor_position_id,
    predecessor.snapshot_id AS predecessor_snapshot_id,
    successor.position_id AS successor_position_id,
    successor.snapshot_id AS successor_snapshot_id,
    successor.applied_at AS recorded_at
  FROM latest_positions predecessor
  JOIN latest_positions successor
    ON successor.household_id = predecessor.household_id
   AND successor.provider = predecessor.provider
   AND lower(trim(successor.legal_vehicle_name)) =
       lower(trim(predecessor.legal_vehicle_name))
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
SELECT candidate.*
FROM holding_position_continuity_evidence_v1 candidate
WHERE (
  SELECT COUNT(*) FROM (
    SELECT 1 FROM holding_position_continuity_evidence_v1 other
    WHERE other.household_id = candidate.household_id
      AND other.provider = candidate.provider
      AND other.normalized_legal_vehicle_name = candidate.normalized_legal_vehicle_name
      AND other.predecessor_position_id = candidate.predecessor_position_id
    LIMIT 2
  )
) = 1
AND (
  SELECT COUNT(*) FROM (
    SELECT 1 FROM holding_position_continuity_evidence_v1 other
    WHERE other.household_id = candidate.household_id
      AND other.provider = candidate.provider
      AND other.normalized_legal_vehicle_name = candidate.normalized_legal_vehicle_name
      AND other.successor_position_id = candidate.successor_position_id
    LIMIT 2
  )
) = 1;
