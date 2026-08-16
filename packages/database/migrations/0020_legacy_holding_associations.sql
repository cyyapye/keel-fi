PRAGMA foreign_keys = ON;

-- Legacy public-position provenance can prove an exact Plaid Item only when
-- every accepted application for the position traces to one retained sync
-- connection with a protected provider key. It cannot recover an account ID
-- from the old position fingerprint.
CREATE VIEW legacy_holding_position_connection_provenance AS
SELECT
  position.id AS position_id,
  position.household_id,
  CASE
    WHEN COUNT(DISTINCT account.id) = 1 THEN MIN(account.id)
    ELSE NULL
  END AS connector_account_id,
  CASE
    WHEN COUNT(DISTINCT account.id) = 1
      THEN MIN(account.provider_account_key)
    ELSE NULL
  END AS protected_source_key,
  COUNT(DISTINCT account.id) AS candidate_connection_count
FROM holding_positions position
LEFT JOIN holding_import_applications application
  ON application.position_id = position.id
LEFT JOIN holding_import_rows import_row
  ON import_row.id = application.import_row_id
LEFT JOIN connector_sync_imports sync_import
  ON sync_import.holding_import_id = import_row.import_id
LEFT JOIN connector_sync_runs sync_run
  ON sync_run.id = sync_import.sync_run_id
LEFT JOIN connector_accounts account
  ON account.id = sync_run.connector_account_id
  AND account.household_id = position.household_id
  AND account.connector_type = 'plaid-investments'
  AND account.provider_account_key IS NOT NULL
WHERE position.provider = 'robinhood'
GROUP BY position.id, position.household_id;

-- Preserve a proven legacy Plaid Item as a canonical connection identity. Its
-- canonical lifecycle remains pending until the later provider-neutral
-- cutover; the shipped connector_accounts row continues to operate unchanged.
INSERT OR IGNORE INTO investment_connections (
  id, household_id, adapter_type, protected_source_key,
  created_by_user_id, created_at, immutable
)
SELECT DISTINCT
  'legacy-investment-connection-' || account.id,
  account.household_id,
  'plaid-investments',
  account.provider_account_key,
  household.owner_user_id,
  account.created_at,
  1
FROM legacy_holding_position_connection_provenance provenance
JOIN connector_accounts account
  ON account.id = provenance.connector_account_id
JOIN households household ON household.id = account.household_id
WHERE provenance.candidate_connection_count = 1;

INSERT OR IGNORE INTO investment_connection_versions (
  id, household_id, connection_id, version, institution_key,
  institution_label, lifecycle_state, credential_reference,
  supersedes_version_id, recorded_by_user_id, recorded_at, immutable
)
SELECT
  'legacy-investment-connection-version-' || account.id,
  account.household_id,
  connection.id,
  1,
  'legacy-robinhood',
  substr(account.display_label, 1, 512),
  'pending',
  NULL,
  NULL,
  household.owner_user_id,
  account.created_at,
  1
FROM connector_accounts account
JOIN households household ON household.id = account.household_id
JOIN investment_connections connection
  ON connection.household_id = account.household_id
  AND connection.adapter_type = 'plaid-investments'
  AND connection.protected_source_key = account.provider_account_key
WHERE account.connector_type = 'plaid-investments'
  AND account.provider_account_key IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM legacy_holding_position_connection_provenance provenance
    WHERE provenance.connector_account_id = account.id
      AND provenance.candidate_connection_count = 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM investment_connection_versions version
    WHERE version.connection_id = connection.id
  );

-- Fixed HMAC-derived migration surrogates identify an unresolved legacy source
-- class only. They do not represent a provider Item, account, or credential.
INSERT OR IGNORE INTO investment_connections (
  id, household_id, adapter_type, protected_source_key,
  created_by_user_id, created_at, immutable
)
SELECT
  'legacy-robinhood-connection-' || position.household_id,
  position.household_id,
  'plaid-investments',
  '63357af2618a4f020e8c96c72b1d127010a80859b1666eea2d70357622eee5e5',
  household.owner_user_id,
  MIN(position.created_at),
  1
FROM holding_positions position
JOIN households household ON household.id = position.household_id
JOIN legacy_holding_position_connection_provenance provenance
  ON provenance.position_id = position.id
WHERE position.provider = 'robinhood'
  AND provenance.candidate_connection_count <> 1
GROUP BY position.household_id, household.owner_user_id;

INSERT OR IGNORE INTO investment_connection_versions (
  id, household_id, connection_id, version, institution_key,
  institution_label, lifecycle_state, credential_reference,
  supersedes_version_id, recorded_by_user_id, recorded_at, immutable
)
SELECT
  'legacy-robinhood-connection-version-' || connection.household_id,
  connection.household_id,
  connection.id,
  1,
  'legacy-robinhood-unresolved',
  'Unresolved Robinhood legacy',
  'pending',
  NULL,
  NULL,
  household.owner_user_id,
  MIN(position.created_at),
  1
FROM investment_connections connection
JOIN households household ON household.id = connection.household_id
JOIN holding_positions position
  ON position.household_id = connection.household_id
  AND position.provider = 'robinhood'
JOIN legacy_holding_position_connection_provenance provenance
  ON provenance.position_id = position.id
WHERE connection.adapter_type = 'plaid-investments'
  AND connection.protected_source_key =
    '63357af2618a4f020e8c96c72b1d127010a80859b1666eea2d70357622eee5e5'
  AND provenance.candidate_connection_count <> 1
  AND NOT EXISTS (
    SELECT 1
    FROM investment_connection_versions version
    WHERE version.connection_id = connection.id
  )
GROUP BY connection.id, connection.household_id, household.owner_user_id;

INSERT OR IGNORE INTO investment_connections (
  id, household_id, adapter_type, protected_source_key,
  created_by_user_id, created_at, immutable
)
SELECT
  'legacy-angellist-connection-' || position.household_id,
  position.household_id,
  'angellist-import',
  '5ca0f4b3d303cb94cced29d4e78bfe142e3172f6c2eb1ccc5d3aa0f2a6a96c6b',
  household.owner_user_id,
  MIN(position.created_at),
  1
FROM holding_positions position
JOIN households household ON household.id = position.household_id
WHERE position.provider = 'angellist'
GROUP BY position.household_id, household.owner_user_id;

INSERT OR IGNORE INTO investment_connection_versions (
  id, household_id, connection_id, version, institution_key,
  institution_label, lifecycle_state, credential_reference,
  supersedes_version_id, recorded_by_user_id, recorded_at, immutable
)
SELECT
  'legacy-angellist-connection-version-' || connection.household_id,
  connection.household_id,
  connection.id,
  1,
  'legacy-angellist-import',
  'AngelList legacy imports',
  'pending',
  NULL,
  NULL,
  household.owner_user_id,
  MIN(position.created_at),
  1
FROM investment_connections connection
JOIN households household ON household.id = connection.household_id
JOIN holding_positions position
  ON position.household_id = connection.household_id
  AND position.provider = 'angellist'
WHERE connection.adapter_type = 'angellist-import'
  AND connection.protected_source_key =
    '5ca0f4b3d303cb94cced29d4e78bfe142e3172f6c2eb1ccc5d3aa0f2a6a96c6b'
  AND NOT EXISTS (
    SELECT 1
    FROM investment_connection_versions version
    WHERE version.connection_id = connection.id
  )
GROUP BY connection.id, connection.household_id, household.owner_user_id;

-- Legacy rows did not retain a protected provider account identifier. Each
-- accepted position therefore receives its own explicit unresolved container;
-- a mutable owner label or account label is display provenance only.
INSERT INTO ownership_containers (
  id, household_id, connection_id, protected_account_key,
  created_by_user_id, created_at, immutable
)
SELECT
  'legacy-ownership-container-' || position.id,
  position.household_id,
  connection.id,
  position.position_fingerprint,
  position.created_by,
  position.created_at,
  1
FROM holding_positions position
JOIN legacy_holding_position_connection_provenance provenance
  ON provenance.position_id = position.id
JOIN investment_connections connection
  ON connection.household_id = position.household_id
  AND connection.adapter_type = 'plaid-investments'
  AND connection.protected_source_key = CASE
    WHEN provenance.candidate_connection_count = 1
      THEN provenance.protected_source_key
    ELSE '63357af2618a4f020e8c96c72b1d127010a80859b1666eea2d70357622eee5e5'
  END
WHERE position.provider = 'robinhood'
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_ownerships ownership
    WHERE ownership.position_id = position.id
  );

INSERT INTO ownership_containers (
  id, household_id, connection_id, protected_account_key,
  created_by_user_id, created_at, immutable
)
SELECT
  'legacy-ownership-container-' || position.id,
  position.household_id,
  connection.id,
  position.position_fingerprint,
  position.created_by,
  position.created_at,
  1
FROM holding_positions position
JOIN investment_connections connection
  ON connection.household_id = position.household_id
  AND connection.adapter_type = 'angellist-import'
  AND connection.protected_source_key =
    '5ca0f4b3d303cb94cced29d4e78bfe142e3172f6c2eb1ccc5d3aa0f2a6a96c6b'
WHERE position.provider = 'angellist'
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_ownerships ownership
    WHERE ownership.position_id = position.id
  );

INSERT INTO ownership_container_versions (
  id, household_id, container_id, version, display_label,
  container_kind, tax_treatment, supersedes_version_id,
  recorded_by_user_id, recorded_at, immutable
)
SELECT
  'legacy-ownership-container-version-' || position.id,
  position.household_id,
  container.id,
  1,
  substr(position.owner_label, 1, 512),
  'unresolved',
  'unknown',
  NULL,
  position.created_by,
  position.created_at,
  1
FROM holding_positions position
JOIN ownership_containers container
  ON container.id = 'legacy-ownership-container-' || position.id
WHERE position.provider IN ('angellist', 'robinhood')
  AND NOT EXISTS (
    SELECT 1
    FROM ownership_container_versions version
    WHERE version.container_id = container.id
  );

INSERT INTO holding_position_ownerships (
  id, household_id, container_id, position_id, protected_position_key,
  association_basis, evidence_sha256, version, supersedes_ownership_id,
  accepted_by_user_id, accepted_at, immutable
)
SELECT
  'legacy-position-ownership-' || position.id,
  position.household_id,
  container.id,
  position.id,
  position.position_fingerprint,
  CASE
    WHEN position.provider = 'robinhood'
      AND provenance.candidate_connection_count = 1
      THEN 'provider_provenance'
    ELSE 'reviewed_legacy'
  END,
  COALESCE((
    SELECT decision.reviewed_snapshot_fingerprint
    FROM holding_import_applications application
    JOIN holding_import_row_decisions decision
      ON decision.id = application.decision_id
    WHERE application.position_id = position.id
    ORDER BY application.applied_at DESC, application.id DESC
    LIMIT 1
  ), position.position_fingerprint),
  1,
  NULL,
  COALESCE((
    SELECT application.applied_by
    FROM holding_import_applications application
    WHERE application.position_id = position.id
    ORDER BY application.applied_at DESC, application.id DESC
    LIMIT 1
  ), position.created_by),
  COALESCE((
    SELECT application.applied_at
    FROM holding_import_applications application
    WHERE application.position_id = position.id
    ORDER BY application.applied_at DESC, application.id DESC
    LIMIT 1
  ), position.created_at),
  1
FROM holding_positions position
JOIN ownership_containers container
  ON container.id = 'legacy-ownership-container-' || position.id
LEFT JOIN legacy_holding_position_connection_provenance provenance
  ON provenance.position_id = position.id
WHERE position.provider IN ('angellist', 'robinhood')
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_ownerships ownership
    WHERE ownership.position_id = position.id
  );

-- Legacy write paths continue to create the accepted holding first. After the
-- accepted application exists, these triggers add an unresolved compatibility
-- association in the same transaction without changing the holding, snapshot,
-- decision, or planning write.
CREATE TRIGGER legacy_robinhood_application_association_insert
AFTER INSERT ON holding_import_applications
WHEN EXISTS (
  SELECT 1 FROM holding_positions position
  WHERE position.id = NEW.position_id AND position.provider = 'robinhood'
)
  AND NOT EXISTS (
    SELECT 1 FROM holding_position_ownerships ownership
    WHERE ownership.position_id = NEW.position_id
  )
BEGIN
  INSERT OR IGNORE INTO investment_connections (
    id, household_id, adapter_type, protected_source_key,
    created_by_user_id, created_at, immutable
  ) VALUES (
    'legacy-robinhood-connection-' || NEW.household_id,
    NEW.household_id,
    'plaid-investments',
    '63357af2618a4f020e8c96c72b1d127010a80859b1666eea2d70357622eee5e5',
    NEW.applied_by,
    NEW.applied_at,
    1
  );

  INSERT OR IGNORE INTO investment_connection_versions (
    id, household_id, connection_id, version, institution_key,
    institution_label, lifecycle_state, credential_reference,
    supersedes_version_id, recorded_by_user_id, recorded_at, immutable
  )
  SELECT
    'legacy-robinhood-connection-version-' || NEW.household_id,
    NEW.household_id,
    connection.id,
    1,
    'legacy-robinhood-unresolved',
    'Unresolved Robinhood legacy',
    'pending',
    NULL,
    NULL,
    NEW.applied_by,
    NEW.applied_at,
    1
  FROM investment_connections connection
  WHERE connection.household_id = NEW.household_id
    AND connection.adapter_type = 'plaid-investments'
    AND connection.protected_source_key =
      '63357af2618a4f020e8c96c72b1d127010a80859b1666eea2d70357622eee5e5'
    AND NOT EXISTS (
      SELECT 1
      FROM investment_connection_versions version
      WHERE version.connection_id = connection.id
    );

  INSERT INTO ownership_containers (
    id, household_id, connection_id, protected_account_key,
    created_by_user_id, created_at, immutable
  )
  SELECT
    'legacy-ownership-container-' || NEW.position_id,
    NEW.household_id,
    connection.id,
    (
      SELECT position.position_fingerprint FROM holding_positions position
      WHERE position.id = NEW.position_id
    ),
    NEW.applied_by,
    NEW.applied_at,
    1
  FROM investment_connections connection
  WHERE connection.household_id = NEW.household_id
    AND connection.adapter_type = 'plaid-investments'
    AND connection.protected_source_key =
      '63357af2618a4f020e8c96c72b1d127010a80859b1666eea2d70357622eee5e5';

  INSERT INTO ownership_container_versions (
    id, household_id, container_id, version, display_label,
    container_kind, tax_treatment, supersedes_version_id,
    recorded_by_user_id, recorded_at, immutable
  ) VALUES (
    'legacy-ownership-container-version-' || NEW.position_id,
    NEW.household_id,
    'legacy-ownership-container-' || NEW.position_id,
    1,
    substr((
      SELECT position.owner_label FROM holding_positions position
      WHERE position.id = NEW.position_id
    ), 1, 512),
    'unresolved',
    'unknown',
    NULL,
    NEW.applied_by,
    NEW.applied_at,
    1
  );

  INSERT INTO holding_position_ownerships (
    id, household_id, container_id, position_id, protected_position_key,
    association_basis, evidence_sha256, version, supersedes_ownership_id,
    accepted_by_user_id, accepted_at, immutable
  ) VALUES (
    'legacy-position-ownership-' || NEW.position_id,
    NEW.household_id,
    'legacy-ownership-container-' || NEW.position_id,
    NEW.position_id,
    (
      SELECT position.position_fingerprint FROM holding_positions position
      WHERE position.id = NEW.position_id
    ),
    'reviewed_legacy',
    (
      SELECT decision.reviewed_snapshot_fingerprint
      FROM holding_import_row_decisions decision
      WHERE decision.id = NEW.decision_id
    ),
    1,
    NULL,
    NEW.applied_by,
    NEW.applied_at,
    1
  );
END;

CREATE TRIGGER legacy_angellist_application_association_insert
AFTER INSERT ON holding_import_applications
WHEN EXISTS (
  SELECT 1 FROM holding_positions position
  WHERE position.id = NEW.position_id AND position.provider = 'angellist'
)
  AND NOT EXISTS (
    SELECT 1 FROM holding_position_ownerships ownership
    WHERE ownership.position_id = NEW.position_id
  )
BEGIN
  INSERT OR IGNORE INTO investment_connections (
    id, household_id, adapter_type, protected_source_key,
    created_by_user_id, created_at, immutable
  ) VALUES (
    'legacy-angellist-connection-' || NEW.household_id,
    NEW.household_id,
    'angellist-import',
    '5ca0f4b3d303cb94cced29d4e78bfe142e3172f6c2eb1ccc5d3aa0f2a6a96c6b',
    NEW.applied_by,
    NEW.applied_at,
    1
  );

  INSERT OR IGNORE INTO investment_connection_versions (
    id, household_id, connection_id, version, institution_key,
    institution_label, lifecycle_state, credential_reference,
    supersedes_version_id, recorded_by_user_id, recorded_at, immutable
  )
  SELECT
    'legacy-angellist-connection-version-' || NEW.household_id,
    NEW.household_id,
    connection.id,
    1,
    'legacy-angellist-import',
    'AngelList legacy imports',
    'pending',
    NULL,
    NULL,
    NEW.applied_by,
    NEW.applied_at,
    1
  FROM investment_connections connection
  WHERE connection.household_id = NEW.household_id
    AND connection.adapter_type = 'angellist-import'
    AND connection.protected_source_key =
      '5ca0f4b3d303cb94cced29d4e78bfe142e3172f6c2eb1ccc5d3aa0f2a6a96c6b'
    AND NOT EXISTS (
      SELECT 1
      FROM investment_connection_versions version
      WHERE version.connection_id = connection.id
    );

  INSERT INTO ownership_containers (
    id, household_id, connection_id, protected_account_key,
    created_by_user_id, created_at, immutable
  )
  SELECT
    'legacy-ownership-container-' || NEW.position_id,
    NEW.household_id,
    connection.id,
    (
      SELECT position.position_fingerprint FROM holding_positions position
      WHERE position.id = NEW.position_id
    ),
    NEW.applied_by,
    NEW.applied_at,
    1
  FROM investment_connections connection
  WHERE connection.household_id = NEW.household_id
    AND connection.adapter_type = 'angellist-import'
    AND connection.protected_source_key =
      '5ca0f4b3d303cb94cced29d4e78bfe142e3172f6c2eb1ccc5d3aa0f2a6a96c6b';

  INSERT INTO ownership_container_versions (
    id, household_id, container_id, version, display_label,
    container_kind, tax_treatment, supersedes_version_id,
    recorded_by_user_id, recorded_at, immutable
  ) VALUES (
    'legacy-ownership-container-version-' || NEW.position_id,
    NEW.household_id,
    'legacy-ownership-container-' || NEW.position_id,
    1,
    substr((
      SELECT position.owner_label FROM holding_positions position
      WHERE position.id = NEW.position_id
    ), 1, 512),
    'unresolved',
    'unknown',
    NULL,
    NEW.applied_by,
    NEW.applied_at,
    1
  );

  INSERT INTO holding_position_ownerships (
    id, household_id, container_id, position_id, protected_position_key,
    association_basis, evidence_sha256, version, supersedes_ownership_id,
    accepted_by_user_id, accepted_at, immutable
  ) VALUES (
    'legacy-position-ownership-' || NEW.position_id,
    NEW.household_id,
    'legacy-ownership-container-' || NEW.position_id,
    NEW.position_id,
    (
      SELECT position.position_fingerprint FROM holding_positions position
      WHERE position.id = NEW.position_id
    ),
    'reviewed_legacy',
    (
      SELECT decision.reviewed_snapshot_fingerprint
      FROM holding_import_row_decisions decision
      WHERE decision.id = NEW.decision_id
    ),
    1,
    NULL,
    NEW.applied_by,
    NEW.applied_at,
    1
  );
END;

CREATE VIEW current_investment_connection_versions AS
SELECT version.*
FROM investment_connection_versions version
WHERE NOT EXISTS (
  SELECT 1
  FROM investment_connection_versions later
  WHERE later.supersedes_version_id = version.id
);

CREATE VIEW current_ownership_container_versions AS
SELECT version.*
FROM ownership_container_versions version
WHERE NOT EXISTS (
  SELECT 1
  FROM ownership_container_versions later
  WHERE later.supersedes_version_id = version.id
);

CREATE VIEW current_holding_position_ownerships AS
SELECT ownership.*
FROM holding_position_ownerships ownership
WHERE NOT EXISTS (
  SELECT 1
  FROM holding_position_ownerships later
  WHERE later.supersedes_ownership_id = ownership.id
);

-- Compatibility reads expose canonical ownership context one-for-one while
-- preserving the existing holding row as the only monetary position identity.
-- Snapshot and baseline values remain in their existing append-only tables.
CREATE VIEW holding_position_compatibility AS
SELECT
  position.id,
  position.household_id,
  position.provider,
  position.position_fingerprint,
  position.legal_vehicle_name,
  position.owner_label,
  position.position_kind,
  position.instrument_type,
  position.opened_on,
  position.currency,
  position.created_by,
  position.created_at,
  ownership.id AS ownership_id,
  ownership.association_basis,
  ownership.evidence_sha256 AS ownership_evidence_sha256,
  container.id AS container_id,
  container.protected_account_key,
  container_version.display_label AS container_label,
  container_version.container_kind,
  container_version.tax_treatment,
  connection.id AS connection_id,
  connection.adapter_type,
  connection.protected_source_key,
  connection_version.institution_key,
  connection_version.institution_label,
  connection_version.lifecycle_state,
  CASE
    WHEN container_version.container_kind = 'unresolved' THEN 'unresolved'
    ELSE 'resolved'
  END AS association_state,
  0 AS omission_eligible
FROM holding_positions position
JOIN current_holding_position_ownerships ownership
  ON ownership.position_id = position.id
  AND ownership.household_id = position.household_id
JOIN ownership_containers container
  ON container.id = ownership.container_id
  AND container.household_id = position.household_id
JOIN current_ownership_container_versions container_version
  ON container_version.container_id = container.id
  AND container_version.household_id = position.household_id
JOIN investment_connections connection
  ON connection.id = container.connection_id
  AND connection.household_id = position.household_id
JOIN current_investment_connection_versions connection_version
  ON connection_version.connection_id = connection.id
  AND connection_version.household_id = position.household_id
WHERE position.provider IN ('angellist', 'robinhood');
