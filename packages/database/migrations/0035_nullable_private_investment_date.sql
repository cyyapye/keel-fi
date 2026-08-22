PRAGMA defer_foreign_keys = ON;

-- Some provider-held private positions do not report an investment date.
-- Preserve that absence as immutable evidence instead of inventing a date.
DROP TRIGGER holding_import_applications_integrity_insert;
DROP TRIGGER holding_import_quarantines_integrity_insert;
DROP TRIGGER holding_import_row_containers_coverage_insert;
DROP TRIGGER holding_import_row_containers_integrity_insert;
DROP TRIGGER holding_import_row_decisions_integrity_insert;
DROP TRIGGER holding_import_row_provider_exposure_evidence_integrity_insert;
DROP TRIGGER holding_import_row_public_exposure_evidence_integrity_insert;
DROP TRIGGER holding_import_row_structured_asset_exposure_evidence_integrity_insert;
DROP TRIGGER holding_position_continuities_integrity_insert;
DROP TRIGGER holding_position_continuities_unique_candidate_insert;
DROP TRIGGER holding_position_snapshots_integrity_insert;
DROP VIEW holding_position_continuity_candidates_v1;
DROP TRIGGER holding_import_rows_integrity_insert;
DROP TRIGGER holding_import_rows_exposure_identity_insert;
DROP TRIGGER holding_import_rows_no_update;
DROP TRIGGER holding_import_rows_no_delete;
DROP INDEX holding_import_rows_import_idx;
DROP INDEX holding_import_rows_position_idx;
DROP INDEX holding_import_rows_protected_exposure_idx;

CREATE TABLE holding_import_rows_nullable_date (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_id TEXT NOT NULL REFERENCES holding_imports(id) ON DELETE RESTRICT,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  position_fingerprint TEXT NOT NULL CHECK (
    length(position_fingerprint) = 64
    AND position_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  snapshot_fingerprint TEXT NOT NULL CHECK (
    length(snapshot_fingerprint) = 64
    AND snapshot_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  legal_vehicle_name TEXT NOT NULL CHECK (
    length(legal_vehicle_name) BETWEEN 1 AND 1000
  ),
  owner_label TEXT NOT NULL CHECK (length(owner_label) BETWEEN 1 AND 1000),
  exposure_label TEXT NOT NULL CHECK (length(exposure_label) BETWEEN 1 AND 1000),
  provider_status TEXT NOT NULL CHECK (
    provider_status IN ('live', 'realized')
  ),
  invested_on TEXT CHECK (
    invested_on IS NULL OR
    invested_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  invested_on_state TEXT NOT NULL DEFAULT 'reported' CHECK (
    invested_on_state IN ('reported', 'not_reported')
  ),
  invested_minor INTEGER NOT NULL CHECK (invested_minor >= 0),
  allocation_minor INTEGER NOT NULL CHECK (allocation_minor >= 0),
  unrealized_value_minor INTEGER CHECK (unrealized_value_minor >= 0),
  unrealized_value_state TEXT NOT NULL CHECK (
    unrealized_value_state IN ('reported', 'locked', 'not_reported')
  ),
  realized_value_minor INTEGER NOT NULL CHECK (realized_value_minor >= 0),
  net_value_minor INTEGER CHECK (net_value_minor >= 0),
  net_value_state TEXT NOT NULL CHECK (
    net_value_state IN ('reported', 'locked', 'not_reported')
  ),
  instrument_type TEXT NOT NULL CHECK (length(instrument_type) BETWEEN 1 AND 1000),
  currency_hint TEXT CHECK (
    currency_hint IS NULL OR (
      length(currency_hint) = 3 AND currency_hint = upper(currency_hint)
    )
  ),
  parse_status TEXT NOT NULL CHECK (
    parse_status IN ('ready', 'needs_attention')
  ),
  issue_codes_json TEXT NOT NULL CHECK (json_valid(issue_codes_json)),
  created_at TEXT NOT NULL,
  position_kind TEXT NOT NULL DEFAULT 'spv_interest' CHECK (
    position_kind IN ('direct', 'spv_interest', 'fund_interest')
  ),
  quantity_micros INTEGER CHECK (
    quantity_micros IS NULL OR quantity_micros >= 0
  ),
  ticker TEXT CHECK (
    ticker IS NULL OR length(ticker) BETWEEN 1 AND 32
  ),
  cost_basis_minor INTEGER CHECK (
    cost_basis_minor IS NULL OR cost_basis_minor >= 0
  ),
  public_exposure_identity_kind TEXT CHECK (
    public_exposure_identity_kind IS NULL
    OR public_exposure_identity_kind IN ('cusip', 'isin', 'sedol')
  ),
  protected_exposure_key TEXT CHECK (
    protected_exposure_key IS NULL OR (
      length(protected_exposure_key) = 64
      AND protected_exposure_key NOT GLOB '*[^0-9a-f]*'
    )
  ),
  UNIQUE (import_id, source_row_number),
  CHECK (
    (invested_on_state = 'reported' AND invested_on IS NOT NULL)
    OR
    (invested_on_state = 'not_reported' AND invested_on IS NULL)
  ),
  CHECK (
    (unrealized_value_state = 'reported' AND unrealized_value_minor IS NOT NULL)
    OR
    (unrealized_value_state <> 'reported' AND unrealized_value_minor IS NULL)
  ),
  CHECK (
    (net_value_state = 'reported' AND net_value_minor IS NOT NULL)
    OR
    (net_value_state <> 'reported' AND net_value_minor IS NULL)
  )
);

INSERT INTO holding_import_rows_nullable_date (
  id, household_id, import_id, source_row_number, position_fingerprint,
  snapshot_fingerprint, legal_vehicle_name, owner_label, exposure_label,
  provider_status, invested_on, invested_on_state, invested_minor,
  allocation_minor, unrealized_value_minor, unrealized_value_state,
  realized_value_minor, net_value_minor, net_value_state, instrument_type,
  currency_hint, parse_status, issue_codes_json, created_at, position_kind,
  quantity_micros, ticker, cost_basis_minor, public_exposure_identity_kind,
  protected_exposure_key
)
SELECT
  id, household_id, import_id, source_row_number, position_fingerprint,
  snapshot_fingerprint, legal_vehicle_name, owner_label, exposure_label,
  provider_status, invested_on, 'reported', invested_minor, allocation_minor,
  unrealized_value_minor, unrealized_value_state, realized_value_minor,
  net_value_minor, net_value_state, instrument_type, currency_hint,
  parse_status, issue_codes_json, created_at, position_kind, quantity_micros,
  ticker, cost_basis_minor, public_exposure_identity_kind,
  protected_exposure_key
FROM holding_import_rows;

DROP TABLE holding_import_rows;
ALTER TABLE holding_import_rows_nullable_date RENAME TO holding_import_rows;

CREATE INDEX holding_import_rows_import_idx
  ON holding_import_rows(import_id, source_row_number);
CREATE INDEX holding_import_rows_position_idx
  ON holding_import_rows(household_id, position_fingerprint);
CREATE INDEX holding_import_rows_protected_exposure_idx
  ON holding_import_rows(household_id, protected_exposure_key)
  WHERE protected_exposure_key IS NOT NULL;

CREATE TRIGGER holding_import_rows_integrity_insert
BEFORE INSERT ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'holding import row household mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM holding_imports import
    WHERE import.id = NEW.import_id
      AND import.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_import_rows_exposure_identity_insert
BEFORE INSERT ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'holding import exposure identity mismatch')
  WHERE (NEW.public_exposure_identity_kind IS NULL)
        <> (NEW.protected_exposure_key IS NULL);
END;

CREATE TRIGGER holding_import_rows_no_update
BEFORE UPDATE ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'holding import rows are immutable');
END;

CREATE TRIGGER holding_import_rows_no_delete
BEFORE DELETE ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'holding import rows are immutable');
END;

CREATE TRIGGER holding_import_applications_integrity_insert
BEFORE INSERT ON holding_import_applications
BEGIN
  SELECT RAISE(ABORT, 'holding import application mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_row_decisions decision
    JOIN holding_position_snapshots snapshot ON snapshot.id = NEW.snapshot_id
    JOIN holding_positions position ON position.id = NEW.position_id
    JOIN households household ON household.id = NEW.household_id
    WHERE decision.id = NEW.decision_id
      AND decision.import_row_id = NEW.import_row_id
      AND decision.household_id = NEW.household_id
      AND decision.decision = 'accepted'
      AND snapshot.position_id = NEW.position_id
      AND snapshot.household_id = NEW.household_id
      AND snapshot.snapshot_fingerprint = (
        SELECT row.snapshot_fingerprint
        FROM holding_import_rows row
        WHERE row.id = NEW.import_row_id
      )
      AND position.household_id = NEW.household_id
      AND household.owner_user_id = NEW.applied_by
  );
END;

CREATE TRIGGER holding_import_quarantines_integrity_insert
BEFORE INSERT ON holding_import_quarantines
BEGIN
  SELECT RAISE(ABORT, 'holding import quarantine import mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_imports import
    WHERE import.id = NEW.import_id
      AND import.household_id = NEW.household_id
      AND import.provider = 'plaid_investments'
  );
  SELECT RAISE(ABORT, 'holding import quarantine row mismatch')
  WHERE NEW.import_row_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    WHERE row.id = NEW.import_row_id
      AND row.import_id = NEW.import_id
      AND row.household_id = NEW.household_id
  );
  SELECT RAISE(ABORT, 'holding import quarantine position mismatch')
  WHERE NEW.position_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
      AND position.provider = 'plaid_investments'
  );
END;

CREATE TRIGGER holding_import_row_containers_coverage_insert
BEFORE INSERT ON holding_import_row_containers
BEGIN
  SELECT RAISE(ABORT, 'holding import row coverage missing')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_import_coverages coverage
      ON coverage.import_id = row.import_id
     AND coverage.container_id = NEW.container_id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND coverage.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_import_row_containers_integrity_insert
BEFORE INSERT ON holding_import_row_containers
BEGIN
  SELECT RAISE(ABORT, 'holding import row container mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_import_connections source ON source.import_id = row.import_id
    JOIN ownership_containers container ON container.id = NEW.container_id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND source.household_id = NEW.household_id
      AND container.household_id = NEW.household_id
      AND container.connection_id = source.connection_id
  );
END;

CREATE TRIGGER holding_import_row_decisions_integrity_insert
BEFORE INSERT ON holding_import_row_decisions
BEGIN
  SELECT RAISE(ABORT, 'holding import decision household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN households household ON household.id = row.household_id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND row.snapshot_fingerprint = NEW.reviewed_snapshot_fingerprint
      AND household.owner_user_id = NEW.reviewer_user_id
  );
  SELECT RAISE(ABORT, 'holding import decision position mismatch')
  WHERE NEW.matched_position_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM holding_positions position
    WHERE position.id = NEW.matched_position_id
      AND position.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_import_row_provider_exposure_evidence_integrity_insert
BEFORE INSERT ON holding_import_row_provider_exposure_evidence
BEGIN
  SELECT RAISE(ABORT, 'provider-scoped exposure evidence provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_imports import ON import.id = row.import_id
    JOIN source_documents document ON document.id = import.source_document_id
    JOIN holding_import_applications application
      ON application.import_row_id = row.id
    JOIN holding_positions position ON position.id = application.position_id
    JOIN households household ON household.id = row.household_id
    JOIN holding_import_row_public_exposure_evidence public_evidence
      ON public_evidence.import_row_id = row.id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND import.household_id = NEW.household_id
      AND document.household_id = NEW.household_id
      AND position.household_id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
      AND import.provider IN ('robinhood', 'plaid_investments')
      AND row.position_kind = 'direct'
      AND position.position_kind = 'direct'
      AND row.public_exposure_identity_kind IS NULL
      AND row.protected_exposure_key IS NULL
      AND public_evidence.resolution_status = 'no_strong_identifier'
      AND public_evidence.evidence_sha256 = NEW.evidence_sha256
      AND document.sha256 = NEW.evidence_sha256
  );
END;

CREATE TRIGGER holding_import_row_public_exposure_evidence_integrity_insert
BEFORE INSERT ON holding_import_row_public_exposure_evidence
BEGIN
  SELECT RAISE(ABORT, 'retained public exposure evidence provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_imports import ON import.id = row.import_id
    JOIN source_documents document ON document.id = import.source_document_id
    JOIN holding_import_applications application
      ON application.import_row_id = row.id
    JOIN holding_positions position ON position.id = application.position_id
    JOIN households household ON household.id = row.household_id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND import.household_id = NEW.household_id
      AND document.household_id = NEW.household_id
      AND position.household_id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
      AND import.provider IN ('robinhood', 'plaid_investments')
      AND row.position_kind = 'direct'
      AND position.position_kind = 'direct'
      AND row.public_exposure_identity_kind IS NULL
      AND row.protected_exposure_key IS NULL
      AND document.sha256 = NEW.evidence_sha256
  );
END;

CREATE TRIGGER holding_import_row_structured_asset_exposure_evidence_integrity_insert
BEFORE INSERT ON holding_import_row_structured_asset_exposure_evidence
BEGIN
  SELECT RAISE(ABORT, 'structured asset exposure evidence provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_imports import ON import.id = row.import_id
    JOIN source_documents document ON document.id = import.source_document_id
    JOIN holding_import_applications application
      ON application.import_row_id = row.id
    JOIN holding_positions position ON position.id = application.position_id
    JOIN households household ON household.id = row.household_id
    JOIN holding_import_row_public_exposure_evidence public_evidence
      ON public_evidence.import_row_id = row.id
    JOIN holding_import_row_provider_exposure_evidence provider_evidence
      ON provider_evidence.import_row_id = row.id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND import.household_id = NEW.household_id
      AND document.household_id = NEW.household_id
      AND position.household_id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
      AND import.provider IN ('robinhood', 'plaid_investments')
      AND row.position_kind = 'direct'
      AND position.position_kind = 'direct'
      AND row.public_exposure_identity_kind IS NULL
      AND row.protected_exposure_key IS NULL
      AND public_evidence.resolution_status = 'no_strong_identifier'
      AND provider_evidence.resolution_status = 'not_eligible'
      AND public_evidence.evidence_sha256 = NEW.evidence_sha256
      AND provider_evidence.evidence_sha256 = NEW.evidence_sha256
      AND document.sha256 = NEW.evidence_sha256
  );
END;

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
      AND (
        COALESCE(
          predecessor_row.protected_exposure_key,
          predecessor_retained.protected_identity_key
        ) IS NULL
        OR COALESCE(
          successor_row.protected_exposure_key,
          successor_retained.protected_identity_key
        ) IS NULL
        OR COALESCE(
          predecessor_row.protected_exposure_key,
          predecessor_retained.protected_identity_key
        ) = COALESCE(
          successor_row.protected_exposure_key,
          successor_retained.protected_identity_key
        )
      )
      AND predecessor_snapshot.observed_at < successor_snapshot.observed_at
      AND household.owner_user_id = NEW.recorded_by_user_id
  );
END;

CREATE TRIGGER holding_position_snapshots_integrity_insert
BEFORE INSERT ON holding_position_snapshots
BEGIN
  SELECT RAISE(ABORT, 'holding snapshot provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    JOIN holding_import_rows row ON row.id = NEW.source_import_row_id
    JOIN holding_imports import ON import.id = row.import_id
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
      AND row.household_id = NEW.household_id
      AND (
        row.position_fingerprint = position.position_fingerprint
        OR EXISTS (
          SELECT 1 FROM holding_import_row_decisions decision
          WHERE decision.import_row_id = row.id
            AND decision.matched_position_id = position.id
            AND decision.decision = 'accepted'
        )
      )
      AND import.source_document_id = NEW.source_document_id
  );
END;

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
   AND (
     successor.strong_identity_key IS NULL
     OR predecessor.strong_identity_key IS NULL
     OR successor.strong_identity_key = predecessor.strong_identity_key
   )
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

PRAGMA defer_foreign_keys = OFF;
