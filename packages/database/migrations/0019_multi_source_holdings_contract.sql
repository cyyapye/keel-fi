PRAGMA foreign_keys = ON;

-- A connection is identified by a household, adapter, and HMAC-derived source
-- key. Institution labels are versioned metadata and never act as identity.
CREATE TABLE investment_connections (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  adapter_type TEXT NOT NULL CHECK (
    adapter_type IN ('plaid-investments', 'angellist-import', 'manual')
  ),
  protected_source_key TEXT NOT NULL CHECK (
    length(protected_source_key) = 64
    AND protected_source_key NOT GLOB '*[^0-9a-f]*'
  ),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (household_id, adapter_type, protected_source_key)
);
CREATE INDEX investment_connections_household_created_idx
  ON investment_connections(household_id, created_at);

CREATE TRIGGER investment_connections_integrity_insert
BEFORE INSERT ON investment_connections
BEGIN
  SELECT RAISE(ABORT, 'investment connection household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM households household
    WHERE household.id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
  );
END;

CREATE TRIGGER investment_connections_no_update
BEFORE UPDATE ON investment_connections
BEGIN
  SELECT RAISE(ABORT, 'investment connections are immutable');
END;

CREATE TRIGGER investment_connections_no_delete
BEFORE DELETE ON investment_connections
BEGIN
  SELECT RAISE(ABORT, 'investment connections are immutable');
END;

-- Lifecycle and display metadata advance through an append-only version chain.
-- Credential references point to private storage; they never contain secrets.
CREATE TABLE investment_connection_versions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connection_id TEXT NOT NULL
    REFERENCES investment_connections(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  institution_key TEXT NOT NULL CHECK (
    length(institution_key) BETWEEN 1 AND 200
  ),
  institution_label TEXT NOT NULL CHECK (
    length(institution_label) BETWEEN 1 AND 512
  ),
  lifecycle_state TEXT NOT NULL CHECK (
    lifecycle_state IN ('pending', 'active', 'paused', 'disconnected')
  ),
  credential_reference TEXT CHECK (
    credential_reference IS NULL OR (
      length(credential_reference) BETWEEN 1 AND 1024
      AND credential_reference NOT GLOB '*[^A-Za-z0-9._/-]*'
      AND substr(credential_reference, 1, 1) GLOB '[A-Za-z0-9]'
    )
  ),
  supersedes_version_id TEXT UNIQUE
    REFERENCES investment_connection_versions(id) ON DELETE RESTRICT,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (connection_id, version),
  CHECK (
    (version = 1 AND supersedes_version_id IS NULL)
    OR (version > 1 AND supersedes_version_id IS NOT NULL)
  ),
  CHECK (
    lifecycle_state <> 'disconnected' OR credential_reference IS NULL
  )
);
CREATE INDEX investment_connection_versions_household_connection_idx
  ON investment_connection_versions(household_id, connection_id, version);

CREATE TRIGGER investment_connection_versions_integrity_insert
BEFORE INSERT ON investment_connection_versions
BEGIN
  SELECT RAISE(ABORT, 'investment connection version household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM investment_connections connection
    JOIN households household ON household.id = connection.household_id
    WHERE connection.id = NEW.connection_id
      AND connection.household_id = NEW.household_id
      AND household.owner_user_id = NEW.recorded_by_user_id
  );

  SELECT RAISE(ABORT, 'provider connection requires private reference')
  WHERE NEW.lifecycle_state IN ('active', 'paused')
    AND NEW.credential_reference IS NULL
    AND EXISTS (
      SELECT 1
      FROM investment_connections connection
      WHERE connection.id = NEW.connection_id
        AND connection.adapter_type <> 'manual'
    );

  SELECT RAISE(ABORT, 'investment connection initial version mismatch')
  WHERE NEW.supersedes_version_id IS NULL AND EXISTS (
    SELECT 1
    FROM investment_connection_versions prior
    WHERE prior.connection_id = NEW.connection_id
  );

  SELECT RAISE(ABORT, 'investment connection supersession mismatch')
  WHERE NEW.supersedes_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM investment_connection_versions prior
    WHERE prior.id = NEW.supersedes_version_id
      AND prior.household_id = NEW.household_id
      AND prior.connection_id = NEW.connection_id
      AND prior.version = NEW.version - 1
      AND NOT EXISTS (
        SELECT 1
        FROM investment_connection_versions later
        WHERE later.supersedes_version_id = prior.id
      )
  );
END;

CREATE TRIGGER investment_connection_versions_no_update
BEFORE UPDATE ON investment_connection_versions
BEGIN
  SELECT RAISE(ABORT, 'investment connection versions are immutable');
END;

CREATE TRIGGER investment_connection_versions_no_delete
BEFORE DELETE ON investment_connection_versions
BEGIN
  SELECT RAISE(ABORT, 'investment connection versions are immutable');
END;

-- The account or ownership entity is a first-class container beneath exactly
-- one connection. Its key is protected and labels never act as identity.
CREATE TABLE ownership_containers (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connection_id TEXT NOT NULL
    REFERENCES investment_connections(id) ON DELETE RESTRICT,
  protected_account_key TEXT NOT NULL CHECK (
    length(protected_account_key) = 64
    AND protected_account_key NOT GLOB '*[^0-9a-f]*'
  ),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (connection_id, protected_account_key)
);
CREATE INDEX ownership_containers_household_connection_idx
  ON ownership_containers(household_id, connection_id, created_at);

CREATE TRIGGER ownership_containers_integrity_insert
BEFORE INSERT ON ownership_containers
BEGIN
  SELECT RAISE(ABORT, 'ownership container household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM investment_connections connection
    JOIN households household ON household.id = connection.household_id
    WHERE connection.id = NEW.connection_id
      AND connection.household_id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
  );
END;

CREATE TRIGGER ownership_containers_no_update
BEFORE UPDATE ON ownership_containers
BEGIN
  SELECT RAISE(ABORT, 'ownership containers are immutable');
END;

CREATE TRIGGER ownership_containers_no_delete
BEFORE DELETE ON ownership_containers
BEGIN
  SELECT RAISE(ABORT, 'ownership containers are immutable');
END;

CREATE TABLE ownership_container_versions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  container_id TEXT NOT NULL
    REFERENCES ownership_containers(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  display_label TEXT NOT NULL CHECK (length(display_label) BETWEEN 1 AND 512),
  container_kind TEXT NOT NULL CHECK (
    container_kind IN (
      'brokerage', 'ira', 'retirement', 'trust', 'entity', 'unresolved', 'other'
    )
  ),
  tax_treatment TEXT NOT NULL CHECK (
    tax_treatment IN ('taxable', 'tax_deferred', 'tax_exempt', 'unknown')
  ),
  supersedes_version_id TEXT UNIQUE
    REFERENCES ownership_container_versions(id) ON DELETE RESTRICT,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (container_id, version),
  CHECK (
    (version = 1 AND supersedes_version_id IS NULL)
    OR (version > 1 AND supersedes_version_id IS NOT NULL)
  )
);
CREATE INDEX ownership_container_versions_household_container_idx
  ON ownership_container_versions(household_id, container_id, version);

CREATE TRIGGER ownership_container_versions_integrity_insert
BEFORE INSERT ON ownership_container_versions
BEGIN
  SELECT RAISE(ABORT, 'ownership container version household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ownership_containers container
    JOIN households household ON household.id = container.household_id
    WHERE container.id = NEW.container_id
      AND container.household_id = NEW.household_id
      AND household.owner_user_id = NEW.recorded_by_user_id
  );

  SELECT RAISE(ABORT, 'ownership container initial version mismatch')
  WHERE NEW.supersedes_version_id IS NULL AND EXISTS (
    SELECT 1
    FROM ownership_container_versions prior
    WHERE prior.container_id = NEW.container_id
  );

  SELECT RAISE(ABORT, 'ownership container supersession mismatch')
  WHERE NEW.supersedes_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM ownership_container_versions prior
    WHERE prior.id = NEW.supersedes_version_id
      AND prior.household_id = NEW.household_id
      AND prior.container_id = NEW.container_id
      AND prior.version = NEW.version - 1
      AND NOT EXISTS (
        SELECT 1
        FROM ownership_container_versions later
        WHERE later.supersedes_version_id = prior.id
      )
  );
END;

CREATE TRIGGER ownership_container_versions_no_update
BEFORE UPDATE ON ownership_container_versions
BEGIN
  SELECT RAISE(ABORT, 'ownership container versions are immutable');
END;

CREATE TRIGGER ownership_container_versions_no_delete
BEFORE DELETE ON ownership_container_versions
BEGIN
  SELECT RAISE(ABORT, 'ownership container versions are immutable');
END;

-- Existing immutable positions are associated additively. A correction adds a
-- new version; the source key is unique only within its container.
CREATE TABLE holding_position_ownerships (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  container_id TEXT NOT NULL
    REFERENCES ownership_containers(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL
    REFERENCES holding_positions(id) ON DELETE RESTRICT,
  protected_position_key TEXT NOT NULL CHECK (
    length(protected_position_key) = 64
    AND protected_position_key NOT GLOB '*[^0-9a-f]*'
  ),
  association_basis TEXT NOT NULL CHECK (
    association_basis IN ('provider_provenance', 'reviewed_legacy', 'manual')
  ),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64
    AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  version INTEGER NOT NULL CHECK (version > 0),
  supersedes_ownership_id TEXT UNIQUE
    REFERENCES holding_position_ownerships(id) ON DELETE RESTRICT,
  accepted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (container_id, protected_position_key),
  UNIQUE (position_id, version),
  CHECK (
    (version = 1 AND supersedes_ownership_id IS NULL)
    OR (version > 1 AND supersedes_ownership_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX holding_position_ownership_roots_unique
  ON holding_position_ownerships(position_id)
  WHERE supersedes_ownership_id IS NULL;
CREATE INDEX holding_position_ownerships_household_container_idx
  ON holding_position_ownerships(
    household_id, container_id, position_id, version
  );

CREATE TRIGGER holding_position_ownerships_integrity_insert
BEFORE INSERT ON holding_position_ownerships
BEGIN
  SELECT RAISE(ABORT, 'holding position ownership household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ownership_containers container
    JOIN holding_positions position ON position.id = NEW.position_id
    JOIN households household ON household.id = NEW.household_id
    WHERE container.id = NEW.container_id
      AND container.household_id = NEW.household_id
      AND position.household_id = NEW.household_id
      AND household.owner_user_id = NEW.accepted_by_user_id
  );

  SELECT RAISE(ABORT, 'holding position ownership initial version mismatch')
  WHERE NEW.supersedes_ownership_id IS NULL AND EXISTS (
    SELECT 1
    FROM holding_position_ownerships prior
    WHERE prior.position_id = NEW.position_id
  );

  SELECT RAISE(ABORT, 'holding position ownership supersession mismatch')
  WHERE NEW.supersedes_ownership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_position_ownerships prior
    WHERE prior.id = NEW.supersedes_ownership_id
      AND prior.household_id = NEW.household_id
      AND prior.position_id = NEW.position_id
      AND prior.version = NEW.version - 1
      AND prior.accepted_at <= NEW.accepted_at
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_ownerships later
        WHERE later.supersedes_ownership_id = prior.id
      )
  );
END;

CREATE TRIGGER holding_position_ownerships_no_update
BEFORE UPDATE ON holding_position_ownerships
BEGIN
  SELECT RAISE(ABORT, 'holding position ownerships are immutable');
END;

CREATE TRIGGER holding_position_ownerships_no_delete
BEFORE DELETE ON holding_position_ownerships
BEGIN
  SELECT RAISE(ABORT, 'holding position ownerships are immutable');
END;

-- Imports and rows gain canonical scope without rewriting shipped import data.
CREATE TABLE holding_import_connections (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_id TEXT NOT NULL UNIQUE REFERENCES holding_imports(id) ON DELETE RESTRICT,
  connection_id TEXT NOT NULL
    REFERENCES investment_connections(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX holding_import_connections_household_connection_idx
  ON holding_import_connections(household_id, connection_id, created_at);

CREATE TRIGGER holding_import_connections_integrity_insert
BEFORE INSERT ON holding_import_connections
BEGIN
  SELECT RAISE(ABORT, 'holding import connection household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_imports import
    JOIN investment_connections connection ON connection.id = NEW.connection_id
    WHERE import.id = NEW.import_id
      AND import.household_id = NEW.household_id
      AND connection.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_import_connections_no_update
BEFORE UPDATE ON holding_import_connections
BEGIN
  SELECT RAISE(ABORT, 'holding import connections are immutable');
END;

CREATE TRIGGER holding_import_connections_no_delete
BEFORE DELETE ON holding_import_connections
BEGIN
  SELECT RAISE(ABORT, 'holding import connections are immutable');
END;

CREATE TABLE holding_import_row_containers (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_row_id TEXT NOT NULL UNIQUE
    REFERENCES holding_import_rows(id) ON DELETE RESTRICT,
  container_id TEXT NOT NULL
    REFERENCES ownership_containers(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX holding_import_row_containers_household_container_idx
  ON holding_import_row_containers(household_id, container_id, import_row_id);

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

CREATE TRIGGER holding_import_row_containers_no_update
BEFORE UPDATE ON holding_import_row_containers
BEGIN
  SELECT RAISE(ABORT, 'holding import row containers are immutable');
END;

CREATE TRIGGER holding_import_row_containers_no_delete
BEFORE DELETE ON holding_import_row_containers
BEGIN
  SELECT RAISE(ABORT, 'holding import row containers are immutable');
END;

-- Coverage is distinct from rows so later ingestion can represent a complete
-- observation independently from the positions it reports.
CREATE TABLE holding_import_coverages (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_id TEXT NOT NULL REFERENCES holding_imports(id) ON DELETE RESTRICT,
  container_id TEXT NOT NULL
    REFERENCES ownership_containers(id) ON DELETE RESTRICT,
  completeness TEXT NOT NULL CHECK (
    completeness IN (
      'complete', 'partial', 'unavailable', 'malformed', 'failed', 'ambiguous'
    )
  ),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64
    AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (import_id, container_id)
);
CREATE INDEX holding_import_coverages_household_container_idx
  ON holding_import_coverages(household_id, container_id, observed_at);

CREATE TRIGGER holding_import_coverages_integrity_insert
BEFORE INSERT ON holding_import_coverages
BEGIN
  SELECT RAISE(ABORT, 'holding import coverage mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_connections source
    JOIN ownership_containers container ON container.id = NEW.container_id
    WHERE source.import_id = NEW.import_id
      AND source.household_id = NEW.household_id
      AND container.household_id = NEW.household_id
      AND container.connection_id = source.connection_id
  );
END;

CREATE TRIGGER holding_import_coverages_no_update
BEFORE UPDATE ON holding_import_coverages
BEGIN
  SELECT RAISE(ABORT, 'holding import coverages are immutable');
END;

CREATE TRIGGER holding_import_coverages_no_delete
BEFORE DELETE ON holding_import_coverages
BEGIN
  SELECT RAISE(ABORT, 'holding import coverages are immutable');
END;

-- Canonical exposures group economic relationships without becoming positions
-- or contributing money to a Portfolio Baseline.
CREATE TABLE canonical_exposures (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  exposure_kind TEXT NOT NULL CHECK (
    exposure_kind IN ('public_instrument', 'private_company', 'fund', 'unresolved')
  ),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 1000),
  protected_identity_key TEXT CHECK (
    protected_identity_key IS NULL OR (
      length(protected_identity_key) = 64
      AND protected_identity_key NOT GLOB '*[^0-9a-f]*'
    )
  ),
  company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT,
  resolution_method TEXT NOT NULL CHECK (
    resolution_method IN (
      'strong_identifier', 'reviewed_company', 'reviewed_fund', 'unresolved'
    )
  ),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64
    AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (
    (
      exposure_kind = 'public_instrument'
      AND resolution_method = 'strong_identifier'
      AND protected_identity_key IS NOT NULL
      AND company_id IS NULL
    ) OR (
      exposure_kind = 'private_company'
      AND resolution_method = 'reviewed_company'
      AND company_id IS NOT NULL
    ) OR (
      exposure_kind = 'fund'
      AND resolution_method = 'reviewed_fund'
      AND protected_identity_key IS NOT NULL
      AND company_id IS NULL
    ) OR (
      exposure_kind = 'unresolved'
      AND resolution_method = 'unresolved'
      AND protected_identity_key IS NULL
      AND company_id IS NULL
    )
  )
);
CREATE UNIQUE INDEX canonical_exposures_household_identity_unique
  ON canonical_exposures(household_id, protected_identity_key)
  WHERE protected_identity_key IS NOT NULL;
CREATE UNIQUE INDEX canonical_exposures_company_unique
  ON canonical_exposures(company_id)
  WHERE company_id IS NOT NULL;
CREATE INDEX canonical_exposures_household_kind_idx
  ON canonical_exposures(household_id, exposure_kind, canonical_name);

CREATE TRIGGER canonical_exposures_integrity_insert
BEFORE INSERT ON canonical_exposures
BEGIN
  SELECT RAISE(ABORT, 'canonical exposure household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM households household
    WHERE household.id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
  );

  SELECT RAISE(ABORT, 'canonical exposure company mismatch')
  WHERE NEW.company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM companies company
    WHERE company.id = NEW.company_id
      AND company.household_id = NEW.household_id
  );
END;

CREATE TRIGGER canonical_exposures_no_update
BEFORE UPDATE ON canonical_exposures
BEGIN
  SELECT RAISE(ABORT, 'canonical exposures are immutable');
END;

CREATE TRIGGER canonical_exposures_no_delete
BEFORE DELETE ON canonical_exposures
BEGIN
  SELECT RAISE(ABORT, 'canonical exposures are immutable');
END;

-- A mapping is accepted, versioned evidence. Unknown allocation stays NULL;
-- known allocations across current mappings may not exceed one million ppm.
CREATE TABLE holding_position_exposure_mappings (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  exposure_id TEXT NOT NULL REFERENCES canonical_exposures(id) ON DELETE RESTRICT,
  relationship_kind TEXT NOT NULL CHECK (
    relationship_kind IN ('direct', 'look_through')
  ),
  allocation_ppm INTEGER CHECK (allocation_ppm BETWEEN 0 AND 1000000),
  status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')),
  decision_source TEXT NOT NULL CHECK (
    decision_source IN ('deterministic_policy', 'review')
  ),
  decision_reference TEXT NOT NULL CHECK (
    length(decision_reference) BETWEEN 1 AND 200
  ),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64
    AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  effective_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  supersedes_mapping_id TEXT UNIQUE
    REFERENCES holding_position_exposure_mappings(id) ON DELETE RESTRICT,
  accepted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (
    (version = 1 AND supersedes_mapping_id IS NULL)
    OR (version > 1 AND supersedes_mapping_id IS NOT NULL)
  ),
  CHECK (status <> 'withdrawn' OR allocation_ppm IS NULL)
);
CREATE UNIQUE INDEX holding_position_exposure_mapping_roots_unique
  ON holding_position_exposure_mappings(position_id, exposure_id)
  WHERE supersedes_mapping_id IS NULL;
CREATE INDEX holding_position_exposure_mappings_household_position_idx
  ON holding_position_exposure_mappings(
    household_id, position_id, exposure_id, version
  );

CREATE TRIGGER holding_position_exposure_mappings_integrity_insert
BEFORE INSERT ON holding_position_exposure_mappings
BEGIN
  SELECT RAISE(ABORT, 'position exposure mapping household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    JOIN canonical_exposures exposure ON exposure.id = NEW.exposure_id
    JOIN households household ON household.id = NEW.household_id
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
      AND exposure.household_id = NEW.household_id
      AND household.owner_user_id = NEW.accepted_by_user_id
  );

  SELECT RAISE(ABORT, 'position exposure mapping initial version mismatch')
  WHERE NEW.supersedes_mapping_id IS NULL AND EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings prior
    WHERE prior.position_id = NEW.position_id
      AND prior.exposure_id = NEW.exposure_id
  );

  SELECT RAISE(ABORT, 'position exposure mapping supersession mismatch')
  WHERE NEW.supersedes_mapping_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings prior
    WHERE prior.id = NEW.supersedes_mapping_id
      AND prior.household_id = NEW.household_id
      AND prior.position_id = NEW.position_id
      AND prior.exposure_id = NEW.exposure_id
      AND prior.version = NEW.version - 1
      AND prior.effective_at <= NEW.effective_at
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = prior.id
      )
  );

  SELECT RAISE(ABORT, 'position exposure allocations exceed one million ppm')
  WHERE NEW.status = 'active'
    AND NEW.allocation_ppm IS NOT NULL
    AND NEW.allocation_ppm + COALESCE((
      SELECT SUM(current.allocation_ppm)
      FROM holding_position_exposure_mappings current
      WHERE current.position_id = NEW.position_id
        AND current.status = 'active'
        AND current.allocation_ppm IS NOT NULL
        AND current.id <> COALESCE(NEW.supersedes_mapping_id, '')
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_exposure_mappings later
          WHERE later.supersedes_mapping_id = current.id
        )
    ), 0) > 1000000;
END;

CREATE TRIGGER holding_position_exposure_mappings_no_update
BEFORE UPDATE ON holding_position_exposure_mappings
BEGIN
  SELECT RAISE(ABORT, 'holding position exposure mappings are immutable');
END;

CREATE TRIGGER holding_position_exposure_mappings_no_delete
BEFORE DELETE ON holding_position_exposure_mappings
BEGIN
  SELECT RAISE(ABORT, 'holding position exposure mappings are immutable');
END;
