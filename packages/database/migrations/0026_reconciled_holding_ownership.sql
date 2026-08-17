-- Accepted holdings created before ADR 005 did not always receive the full
-- connection, container, row-scope, coverage, and ownership chain required by
-- the authoritative position projection. Preserve proven container provenance
-- where it exists. Only rows with no canonical scope receive a new unresolved
-- container, and that fallback never merges positions by display text.
CREATE TABLE holding_ownership_reconciliation_candidates_v1 (
  position_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  position_fingerprint TEXT NOT NULL,
  owner_label TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO holding_ownership_reconciliation_candidates_v1 (
  position_id, household_id, provider, connection_id, container_id,
  position_fingerprint, owner_label, evidence_sha256, accepted_at, created_at
)
SELECT
  position.id,
  position.household_id,
  position.provider,
  COALESCE(
    (
      SELECT container.connection_id
      FROM holding_import_applications scoped_application
      JOIN holding_import_row_containers row_scope
        ON row_scope.import_row_id = scoped_application.import_row_id
      JOIN ownership_containers container
        ON container.id = row_scope.container_id
      WHERE scoped_application.position_id = position.id
      ORDER BY scoped_application.applied_at DESC, scoped_application.id DESC
      LIMIT 1
    ),
    (
      SELECT import_scope.connection_id
      FROM holding_import_applications scoped_application
      JOIN holding_import_rows scoped_row
        ON scoped_row.id = scoped_application.import_row_id
      JOIN holding_import_connections import_scope
        ON import_scope.import_id = scoped_row.import_id
      WHERE scoped_application.position_id = position.id
      ORDER BY scoped_application.applied_at DESC, scoped_application.id DESC
      LIMIT 1
    ),
    'reconciled-holding-connection-v1:' || position.household_id || ':' ||
      position.provider
  ),
  COALESCE(
    (
      SELECT row_scope.container_id
      FROM holding_import_applications scoped_application
      JOIN holding_import_row_containers row_scope
        ON row_scope.import_row_id = scoped_application.import_row_id
      WHERE scoped_application.position_id = position.id
      ORDER BY scoped_application.applied_at DESC, scoped_application.id DESC
      LIMIT 1
    ),
    'reconciled-holding-container-v1:' || position.id
  ),
  position.position_fingerprint,
  position.owner_label,
  document.sha256,
  application.applied_at,
  position.created_at
FROM holding_positions position
JOIN holding_import_applications application
  ON application.id = (
    SELECT latest.id
    FROM holding_import_applications latest
    WHERE latest.position_id = position.id
    ORDER BY latest.applied_at DESC, latest.id DESC
    LIMIT 1
  )
JOIN holding_position_snapshots snapshot
  ON snapshot.id = application.snapshot_id
 AND snapshot.position_id = position.id
JOIN source_documents document ON document.id = snapshot.source_document_id
WHERE NOT EXISTS (
  SELECT 1
  FROM holding_position_ownerships ownership
  WHERE ownership.position_id = position.id
);

INSERT INTO investment_connections (
  id, household_id, adapter_type, protected_source_key,
  created_by_user_id, created_at, immutable
)
SELECT
  candidate.connection_id,
  candidate.household_id,
  CASE candidate.provider
    WHEN 'angellist' THEN 'angellist-import'
    WHEN 'plaid_investments' THEN 'plaid-investments'
    ELSE 'manual'
  END,
  lower(hex(randomblob(32))),
  household.owner_user_id,
  MIN(candidate.created_at),
  1
FROM holding_ownership_reconciliation_candidates_v1 candidate
JOIN households household ON household.id = candidate.household_id
WHERE NOT EXISTS (
  SELECT 1
  FROM investment_connections connection
  WHERE connection.id = candidate.connection_id
)
GROUP BY candidate.connection_id;

INSERT INTO investment_connection_versions (
  id, household_id, connection_id, version, institution_key,
  institution_label, lifecycle_state, credential_reference,
  supersedes_version_id, recorded_by_user_id, recorded_at, immutable
)
SELECT
  'reconciled-holding-connection-version-v1:' || candidate.connection_id,
  candidate.household_id,
  candidate.connection_id,
  1,
  substr('reviewed-history:' || candidate.provider, 1, 200),
  CASE candidate.provider
    WHEN 'angellist' THEN 'AngelList reviewed history'
    WHEN 'plaid_investments' THEN 'Investment reviewed history'
    ELSE 'Reviewed holding history'
  END,
  'pending',
  NULL,
  NULL,
  household.owner_user_id,
  MIN(candidate.created_at),
  1
FROM holding_ownership_reconciliation_candidates_v1 candidate
JOIN households household ON household.id = candidate.household_id
WHERE candidate.connection_id LIKE 'reconciled-holding-connection-v1:%'
  AND NOT EXISTS (
    SELECT 1
    FROM investment_connection_versions version
    WHERE version.connection_id = candidate.connection_id
  )
GROUP BY candidate.connection_id;

INSERT INTO ownership_containers (
  id, household_id, connection_id, protected_account_key,
  created_by_user_id, created_at, immutable
)
SELECT
  candidate.container_id,
  candidate.household_id,
  candidate.connection_id,
  lower(hex(randomblob(32))),
  household.owner_user_id,
  candidate.created_at,
  1
FROM holding_ownership_reconciliation_candidates_v1 candidate
JOIN households household ON household.id = candidate.household_id
WHERE NOT EXISTS (
  SELECT 1
  FROM ownership_containers container
  WHERE container.id = candidate.container_id
);

INSERT INTO ownership_container_versions (
  id, household_id, container_id, version, display_label, container_kind,
  tax_treatment, supersedes_version_id, recorded_by_user_id, recorded_at,
  immutable
)
SELECT
  'reconciled-holding-container-version-v1:' || candidate.position_id,
  candidate.household_id,
  candidate.container_id,
  1,
  substr(
    COALESCE(NULLIF(trim(candidate.owner_label), ''), 'Reviewed holding'),
    1,
    512
  ),
  'unresolved',
  'unknown',
  NULL,
  household.owner_user_id,
  candidate.created_at,
  1
FROM holding_ownership_reconciliation_candidates_v1 candidate
JOIN households household ON household.id = candidate.household_id
WHERE candidate.container_id LIKE 'reconciled-holding-container-v1:%'
  AND NOT EXISTS (
    SELECT 1
    FROM ownership_container_versions version
    WHERE version.container_id = candidate.container_id
  );

-- Bind every accepted legacy row to the same proven or conservative fallback
-- chain. Ambiguous coverage deliberately disables omission inference.
INSERT INTO holding_import_connections (
  id, household_id, import_id, connection_id, created_at, immutable
)
SELECT
  'reconciled-holding-import-connection-v1:' || import.id,
  import.household_id,
  import.id,
  candidate.connection_id,
  MIN(application.applied_at),
  1
FROM holding_ownership_reconciliation_candidates_v1 candidate
JOIN holding_import_applications application
  ON application.position_id = candidate.position_id
JOIN holding_import_rows row ON row.id = application.import_row_id
JOIN holding_imports import ON import.id = row.import_id
WHERE NOT EXISTS (
  SELECT 1
  FROM holding_import_connections source
  WHERE source.import_id = import.id
)
GROUP BY import.id;

INSERT INTO holding_import_coverages (
  id, household_id, import_id, container_id, completeness,
  evidence_sha256, observed_at, created_at, immutable
)
SELECT
  'reconciled-holding-coverage-v1:' || import.id || ':' ||
    candidate.position_id,
  candidate.household_id,
  import.id,
  candidate.container_id,
  'ambiguous',
  document.sha256,
  CASE
    WHEN document.effective_date IS NULL THEN document.retrieved_at
    ELSE document.effective_date || 'T00:00:00.000Z'
  END,
  MIN(application.applied_at),
  1
FROM holding_ownership_reconciliation_candidates_v1 candidate
JOIN holding_import_applications application
  ON application.position_id = candidate.position_id
JOIN holding_import_rows row ON row.id = application.import_row_id
JOIN holding_imports import ON import.id = row.import_id
JOIN source_documents document ON document.id = import.source_document_id
WHERE NOT EXISTS (
  SELECT 1
  FROM holding_import_coverages coverage
  WHERE coverage.import_id = import.id
    AND coverage.container_id = candidate.container_id
)
GROUP BY import.id, candidate.container_id;

INSERT INTO holding_import_row_containers (
  id, household_id, import_row_id, container_id, created_at, immutable
)
SELECT
  'reconciled-holding-row-container-v1:' || row.id,
  candidate.household_id,
  row.id,
  candidate.container_id,
  application.applied_at,
  1
FROM holding_ownership_reconciliation_candidates_v1 candidate
JOIN holding_import_applications application
  ON application.position_id = candidate.position_id
JOIN holding_import_rows row ON row.id = application.import_row_id
WHERE NOT EXISTS (
  SELECT 1
  FROM holding_import_row_containers row_scope
  WHERE row_scope.import_row_id = row.id
);

INSERT INTO holding_position_ownerships (
  id, household_id, container_id, position_id, protected_position_key,
  association_basis, evidence_sha256, version, supersedes_ownership_id,
  accepted_by_user_id, accepted_at, immutable
)
SELECT
  'reconciled-holding-ownership-v1:' || candidate.position_id,
  candidate.household_id,
  candidate.container_id,
  candidate.position_id,
  candidate.position_fingerprint,
  'reviewed_import',
  candidate.evidence_sha256,
  1,
  NULL,
  household.owner_user_id,
  candidate.accepted_at,
  1
FROM holding_ownership_reconciliation_candidates_v1 candidate
JOIN households household ON household.id = candidate.household_id;

DROP TABLE holding_ownership_reconciliation_candidates_v1;

-- Re-run the same high-confidence exposure policies across accepted history,
-- independent of provider. A public security requires a protected strong
-- identifier. A private company requires an already-reviewed company id.
-- Display labels, tickers, and provider security ids are never sufficient.
CREATE TABLE holding_exposure_reconciliation_candidates_v1 (
  position_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  exposure_kind TEXT NOT NULL CHECK (
    exposure_kind IN ('public_instrument', 'private_company')
  ),
  canonical_name TEXT NOT NULL,
  public_identity_kind TEXT,
  protected_identity_key TEXT,
  company_id TEXT,
  relationship_kind TEXT NOT NULL CHECK (
    relationship_kind IN ('direct', 'look_through')
  ),
  evidence_sha256 TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

INSERT INTO holding_exposure_reconciliation_candidates_v1 (
  position_id, household_id, exposure_kind, canonical_name,
  public_identity_kind, protected_identity_key, company_id,
  relationship_kind, evidence_sha256, effective_at, accepted_at
)
SELECT
  position.id,
  position.household_id,
  'public_instrument',
  row.legal_vehicle_name,
  row.public_exposure_identity_kind,
  row.protected_exposure_key,
  NULL,
  'direct',
  document.sha256,
  CASE
    WHEN document.effective_date IS NULL THEN document.retrieved_at
    ELSE document.effective_date || 'T00:00:00.000Z'
  END,
  application.applied_at
FROM holding_positions position
JOIN holding_import_applications application
  ON application.id = (
    SELECT accepted.id
    FROM holding_import_applications accepted
    JOIN holding_import_rows accepted_row
      ON accepted_row.id = accepted.import_row_id
    WHERE accepted.position_id = position.id
      AND accepted_row.public_exposure_identity_kind IS NOT NULL
      AND accepted_row.protected_exposure_key IS NOT NULL
    ORDER BY accepted.applied_at DESC, accepted.id DESC
    LIMIT 1
  )
JOIN holding_import_rows row ON row.id = application.import_row_id
JOIN holding_imports import ON import.id = row.import_id
JOIN source_documents document ON document.id = import.source_document_id
WHERE EXISTS (
    SELECT 1
    FROM holding_position_ownerships ownership
    WHERE ownership.position_id = position.id
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_ownerships later
        WHERE later.supersedes_ownership_id = ownership.id
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings mapping
    JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
    WHERE mapping.position_id = position.id
      AND mapping.status = 'active'
      AND exposure.exposure_kind <> 'unresolved'
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = mapping.id
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings mapping
    JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
    WHERE mapping.position_id = position.id
      AND exposure.protected_identity_key = row.protected_exposure_key
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = mapping.id
      )
  );

INSERT INTO holding_exposure_reconciliation_candidates_v1 (
  position_id, household_id, exposure_kind, canonical_name,
  public_identity_kind, protected_identity_key, company_id,
  relationship_kind, evidence_sha256, effective_at, accepted_at
)
SELECT
  position.id,
  position.household_id,
  'private_company',
  company.legal_name,
  NULL,
  NULL,
  reported.company_id,
  CASE
    WHEN position.position_kind = 'direct' THEN 'direct'
    ELSE 'look_through'
  END,
  document.sha256,
  CASE
    WHEN document.effective_date IS NULL THEN document.retrieved_at
    ELSE document.effective_date || 'T00:00:00.000Z'
  END,
  CASE
    WHEN reported.created_at > application.applied_at
      THEN reported.created_at
    ELSE application.applied_at
  END
FROM holding_positions position
JOIN holding_position_exposures reported
  ON reported.id = (
    SELECT reviewed.id
    FROM holding_position_exposures reviewed
    WHERE reviewed.position_id = position.id
      AND reviewed.company_id IS NOT NULL
    ORDER BY reviewed.created_at DESC, reviewed.id DESC
    LIMIT 1
  )
JOIN companies company
  ON company.id = reported.company_id
 AND company.household_id = position.household_id
JOIN holding_import_applications application
  ON application.id = (
    SELECT accepted.id
    FROM holding_import_applications accepted
    WHERE accepted.position_id = position.id
    ORDER BY accepted.applied_at DESC, accepted.id DESC
    LIMIT 1
  )
JOIN holding_position_snapshots snapshot
  ON snapshot.id = application.snapshot_id
 AND snapshot.position_id = position.id
JOIN source_documents document ON document.id = snapshot.source_document_id
WHERE NOT EXISTS (
    SELECT 1
    FROM holding_exposure_reconciliation_candidates_v1 candidate
    WHERE candidate.position_id = position.id
  )
  AND (
    SELECT COUNT(DISTINCT reviewed.company_id)
    FROM holding_position_exposures reviewed
    WHERE reviewed.position_id = position.id
      AND reviewed.company_id IS NOT NULL
  ) = 1
  AND (
    position.position_kind = 'spv_interest'
    OR (
      position.provider = 'angellist'
      AND position.position_kind = 'direct'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM holding_position_ownerships ownership
    WHERE ownership.position_id = position.id
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_ownerships later
        WHERE later.supersedes_ownership_id = ownership.id
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings mapping
    JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
    WHERE mapping.position_id = position.id
      AND mapping.status = 'active'
      AND exposure.exposure_kind <> 'unresolved'
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = mapping.id
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings mapping
    JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
    WHERE mapping.position_id = position.id
      AND exposure.company_id = reported.company_id
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = mapping.id
      )
  );

INSERT INTO canonical_exposures (
  id, household_id, exposure_kind, canonical_name,
  protected_identity_key, company_id, resolution_method,
  evidence_sha256, created_by_user_id, created_at, immutable
)
SELECT
  'reconciled-public-exposure-v1:' || candidate.household_id || ':' ||
    candidate.protected_identity_key,
  candidate.household_id,
  'public_instrument',
  candidate.canonical_name,
  candidate.protected_identity_key,
  NULL,
  'strong_identifier',
  candidate.evidence_sha256,
  household.owner_user_id,
  candidate.accepted_at,
  1
FROM holding_exposure_reconciliation_candidates_v1 candidate
JOIN households household ON household.id = candidate.household_id
WHERE candidate.exposure_kind = 'public_instrument'
  AND candidate.position_id = (
    SELECT first_candidate.position_id
    FROM holding_exposure_reconciliation_candidates_v1 first_candidate
    WHERE first_candidate.household_id = candidate.household_id
      AND first_candidate.protected_identity_key =
        candidate.protected_identity_key
    ORDER BY first_candidate.accepted_at, first_candidate.position_id
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM canonical_exposures exposure
    WHERE exposure.household_id = candidate.household_id
      AND exposure.protected_identity_key = candidate.protected_identity_key
  );

INSERT INTO canonical_exposures (
  id, household_id, exposure_kind, canonical_name,
  protected_identity_key, company_id, resolution_method,
  evidence_sha256, created_by_user_id, created_at, immutable
)
SELECT
  'reconciled-private-exposure-v1:' || candidate.company_id,
  candidate.household_id,
  'private_company',
  company.legal_name,
  NULL,
  candidate.company_id,
  'reviewed_company',
  candidate.evidence_sha256,
  household.owner_user_id,
  candidate.accepted_at,
  1
FROM holding_exposure_reconciliation_candidates_v1 candidate
JOIN companies company ON company.id = candidate.company_id
JOIN households household ON household.id = candidate.household_id
WHERE candidate.exposure_kind = 'private_company'
  AND candidate.position_id = (
    SELECT first_candidate.position_id
    FROM holding_exposure_reconciliation_candidates_v1 first_candidate
    WHERE first_candidate.company_id = candidate.company_id
    ORDER BY first_candidate.accepted_at, first_candidate.position_id
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM canonical_exposures exposure
    WHERE exposure.company_id = candidate.company_id
  );

-- Retire any unresolved placeholder before appending the resolved mapping.
INSERT INTO holding_position_exposure_mappings (
  id, household_id, position_id, exposure_id, relationship_kind,
  allocation_ppm, status, decision_source, decision_reference,
  evidence_sha256, effective_at, version, supersedes_mapping_id,
  accepted_by_user_id, accepted_at, immutable
)
SELECT
  'reconciled-exposure-withdrawal-v1:' || mapping.id,
  mapping.household_id,
  mapping.position_id,
  mapping.exposure_id,
  mapping.relationship_kind,
  NULL,
  'withdrawn',
  CASE
    WHEN candidate.exposure_kind = 'public_instrument'
      THEN 'deterministic_policy'
    ELSE 'review'
  END,
  'Replaced by high-confidence exposure reconciliation',
  candidate.evidence_sha256,
  CASE
    WHEN mapping.effective_at > candidate.effective_at
      THEN mapping.effective_at
    ELSE candidate.effective_at
  END,
  mapping.version + 1,
  mapping.id,
  household.owner_user_id,
  CASE
    WHEN mapping.accepted_at > candidate.accepted_at
      THEN mapping.accepted_at
    ELSE candidate.accepted_at
  END,
  1
FROM holding_exposure_reconciliation_candidates_v1 candidate
JOIN holding_position_exposure_mappings mapping
  ON mapping.position_id = candidate.position_id
 AND mapping.household_id = candidate.household_id
JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
JOIN households household ON household.id = mapping.household_id
WHERE mapping.status = 'active'
  AND exposure.exposure_kind = 'unresolved'
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings later
    WHERE later.supersedes_mapping_id = mapping.id
  );

INSERT INTO holding_position_exposure_mappings (
  id, household_id, position_id, exposure_id, relationship_kind,
  allocation_ppm, status, decision_source, decision_reference,
  evidence_sha256, effective_at, version, supersedes_mapping_id,
  accepted_by_user_id, accepted_at, immutable
)
SELECT
  'reconciled-exposure-mapping-v1:' || candidate.position_id,
  candidate.household_id,
  candidate.position_id,
  exposure.id,
  candidate.relationship_kind,
  1000000,
  'active',
  CASE
    WHEN candidate.exposure_kind = 'public_instrument'
      THEN 'deterministic_policy'
    ELSE 'review'
  END,
  CASE
    WHEN candidate.exposure_kind = 'public_instrument'
      THEN 'public-strong-identifier-v1:' || candidate.public_identity_kind
    ELSE 'Reviewed legacy company identity'
  END,
  candidate.evidence_sha256,
  candidate.effective_at,
  1,
  NULL,
  household.owner_user_id,
  candidate.accepted_at,
  1
FROM holding_exposure_reconciliation_candidates_v1 candidate
JOIN canonical_exposures exposure
  ON exposure.household_id = candidate.household_id
 AND (
   (
     candidate.exposure_kind = 'public_instrument'
     AND exposure.protected_identity_key = candidate.protected_identity_key
   ) OR (
     candidate.exposure_kind = 'private_company'
     AND exposure.company_id = candidate.company_id
   )
 )
JOIN households household ON household.id = candidate.household_id;

DROP TABLE holding_exposure_reconciliation_candidates_v1;

-- Enforce the projection invariant at the write boundary so a future exposure
-- decision cannot make both Holdings and Portfolio Baseline unreadable.
CREATE TRIGGER holding_position_exposure_mappings_ownership_insert
BEFORE INSERT ON holding_position_exposure_mappings
BEGIN
  SELECT RAISE(ABORT, 'exposure mapping requires canonical position ownership')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_position_ownerships ownership
    WHERE ownership.position_id = NEW.position_id
      AND ownership.household_id = NEW.household_id
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_ownerships later
        WHERE later.supersedes_ownership_id = ownership.id
      )
  );
END;
