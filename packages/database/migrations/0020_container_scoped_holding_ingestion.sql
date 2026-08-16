PRAGMA defer_foreign_keys = ON;

-- A complete account observation may legitimately contain no holdings. Rebuild
-- the immutable import envelope with a zero-inclusive row-count constraint.
-- D1 runs migrations inside an implicit transaction, so build the replacement
-- before dropping the referenced table and defer the temporary FK violation.
DROP TRIGGER holding_imports_integrity_insert;
DROP TRIGGER holding_imports_no_update;
DROP TRIGGER holding_imports_no_delete;
DROP TRIGGER holding_import_rows_integrity_insert;
DROP TRIGGER holding_position_snapshots_integrity_insert;
DROP TRIGGER angellist_mac_runs_completion_integrity;
DROP TRIGGER connector_sync_imports_integrity_insert;
DROP TRIGGER holding_import_quarantines_integrity_insert;
DROP TRIGGER holding_import_connections_integrity_insert;
DROP INDEX holding_imports_household_created_idx;

CREATE TABLE holding_imports_m9_3 (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  source_document_id TEXT NOT NULL UNIQUE
    REFERENCES source_documents(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 50),
  parser_schema TEXT NOT NULL CHECK (length(parser_schema) BETWEEN 1 AND 100),
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 500),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  normalized_fingerprint TEXT CHECK (
    normalized_fingerprint IS NULL OR (
      length(normalized_fingerprint) = 64
      AND normalized_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  )
);

INSERT INTO holding_imports_m9_3 (
  id, household_id, source_document_id, provider, parser_schema, row_count,
  created_by, created_at, normalized_fingerprint
)
SELECT
  id, household_id, source_document_id, provider, parser_schema, row_count,
  created_by, created_at, normalized_fingerprint
FROM holding_imports;

DROP TABLE holding_imports;
ALTER TABLE holding_imports_m9_3 RENAME TO holding_imports;

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

CREATE TRIGGER angellist_mac_runs_completion_integrity
BEFORE UPDATE ON angellist_mac_runs
WHEN NEW.status = 'completed' AND NOT EXISTS (
  SELECT 1
  FROM holding_imports import
  WHERE import.id = NEW.import_id
    AND import.household_id = NEW.household_id
    AND import.provider = 'angellist'
)
BEGIN
  SELECT RAISE(ABORT, 'AngelList Mac run import mismatch');
END;

CREATE TRIGGER connector_sync_imports_integrity_insert
BEFORE INSERT ON connector_sync_imports
BEGIN
  SELECT RAISE(ABORT, 'connector sync import household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM connector_sync_runs run
    JOIN connector_accounts account ON account.id = run.connector_account_id
    JOIN holding_imports import ON import.id = NEW.holding_import_id
    WHERE run.id = NEW.sync_run_id
      AND run.household_id = NEW.household_id
      AND account.household_id = NEW.household_id
      AND account.connector_type = 'plaid-investments'
      AND import.household_id = NEW.household_id
      AND import.provider = 'robinhood'
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
      AND import.provider = 'robinhood'
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
      AND position.provider = 'robinhood'
  );
END;

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

CREATE INDEX holding_imports_household_created_idx
  ON holding_imports(household_id, created_at);

CREATE TRIGGER holding_imports_integrity_insert
BEFORE INSERT ON holding_imports
BEGIN
  SELECT RAISE(ABORT, 'holding import household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM source_documents document
    JOIN households household ON household.id = NEW.household_id
    WHERE document.id = NEW.source_document_id
      AND document.household_id = NEW.household_id
      AND household.owner_user_id = NEW.created_by
  );
END;

CREATE TRIGGER holding_imports_no_update
BEFORE UPDATE ON holding_imports
BEGIN
  SELECT RAISE(ABORT, 'holding imports are immutable');
END;

CREATE TRIGGER holding_imports_no_delete
BEFORE DELETE ON holding_imports
BEGIN
  SELECT RAISE(ABORT, 'holding imports are immutable');
END;

PRAGMA defer_foreign_keys = OFF;

-- The mutable legacy connector row is operational state. This append-only
-- version chain records which canonical investment connection it currently
-- authorizes and preserves prior Item identities across reconnects.
CREATE TABLE connector_investment_connection_versions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  connector_account_id TEXT NOT NULL
    REFERENCES connector_accounts(id) ON DELETE RESTRICT,
  connection_id TEXT NOT NULL
    REFERENCES investment_connections(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  supersedes_link_id TEXT UNIQUE
    REFERENCES connector_investment_connection_versions(id) ON DELETE RESTRICT,
  recorded_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (connector_account_id, version),
  CHECK (
    (version = 1 AND supersedes_link_id IS NULL)
    OR (version > 1 AND supersedes_link_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX connector_investment_connection_roots_unique
  ON connector_investment_connection_versions(connector_account_id)
  WHERE supersedes_link_id IS NULL;
CREATE INDEX connector_investment_connection_household_idx
  ON connector_investment_connection_versions(
    household_id, connector_account_id, connection_id, version
  );

CREATE TRIGGER connector_investment_connection_versions_integrity_insert
BEFORE INSERT ON connector_investment_connection_versions
BEGIN
  SELECT RAISE(ABORT, 'connector investment connection mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM connector_accounts connector
    JOIN investment_connections connection
      ON connection.id = NEW.connection_id
    WHERE connector.id = NEW.connector_account_id
      AND connector.household_id = NEW.household_id
      AND connector.connector_type = 'plaid-investments'
      AND connection.household_id = NEW.household_id
      AND connection.adapter_type = 'plaid-investments'
  );

  SELECT RAISE(ABORT, 'connector investment initial version mismatch')
  WHERE NEW.supersedes_link_id IS NULL AND EXISTS (
    SELECT 1
    FROM connector_investment_connection_versions prior
    WHERE prior.connector_account_id = NEW.connector_account_id
  );

  SELECT RAISE(ABORT, 'connector investment supersession mismatch')
  WHERE NEW.supersedes_link_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM connector_investment_connection_versions prior
    WHERE prior.id = NEW.supersedes_link_id
      AND prior.household_id = NEW.household_id
      AND prior.connector_account_id = NEW.connector_account_id
      AND prior.version = NEW.version - 1
      AND NOT EXISTS (
        SELECT 1
        FROM connector_investment_connection_versions later
        WHERE later.supersedes_link_id = prior.id
      )
  );
END;

CREATE TRIGGER connector_investment_connection_versions_no_update
BEFORE UPDATE ON connector_investment_connection_versions
BEGIN
  SELECT RAISE(ABORT, 'connector investment connection versions are immutable');
END;

CREATE TRIGGER connector_investment_connection_versions_no_delete
BEFORE DELETE ON connector_investment_connection_versions
BEGIN
  SELECT RAISE(ABORT, 'connector investment connection versions are immutable');
END;

-- Every acquisition run retains the exact canonical connection selected when
-- the run began, even if the operational connector is reauthorized later.
CREATE TABLE connector_sync_investment_connections (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  sync_run_id TEXT NOT NULL UNIQUE
    REFERENCES connector_sync_runs(id) ON DELETE RESTRICT,
  connection_id TEXT NOT NULL
    REFERENCES investment_connections(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX connector_sync_investment_connections_household_idx
  ON connector_sync_investment_connections(
    household_id, connection_id, created_at
  );

CREATE TRIGGER connector_sync_investment_connections_integrity_insert
BEFORE INSERT ON connector_sync_investment_connections
BEGIN
  SELECT RAISE(ABORT, 'connector sync investment connection mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM connector_sync_runs run
    JOIN connector_investment_connection_versions link
      ON link.connector_account_id = run.connector_account_id
     AND link.connection_id = NEW.connection_id
    WHERE run.id = NEW.sync_run_id
      AND run.household_id = NEW.household_id
      AND link.household_id = NEW.household_id
      AND NOT EXISTS (
        SELECT 1
        FROM connector_investment_connection_versions later
        WHERE later.supersedes_link_id = link.id
      )
  );
END;

CREATE TRIGGER connector_sync_investment_connections_no_update
BEFORE UPDATE ON connector_sync_investment_connections
BEGIN
  SELECT RAISE(ABORT, 'connector sync investment connections are immutable');
END;

CREATE TRIGGER connector_sync_investment_connections_no_delete
BEFORE DELETE ON connector_sync_investment_connections
BEGIN
  SELECT RAISE(ABORT, 'connector sync investment connections are immutable');
END;

-- Webhook deduplication remains signature-based, while this association makes
-- its authorization target explicit and connection-scoped.
CREATE TABLE plaid_webhook_investment_connections (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  delivery_id TEXT NOT NULL UNIQUE
    REFERENCES plaid_webhook_deliveries(id) ON DELETE RESTRICT,
  connection_id TEXT NOT NULL
    REFERENCES investment_connections(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX plaid_webhook_investment_connections_household_idx
  ON plaid_webhook_investment_connections(
    household_id, connection_id, created_at
  );

CREATE TRIGGER plaid_webhook_investment_connections_integrity_insert
BEFORE INSERT ON plaid_webhook_investment_connections
BEGIN
  SELECT RAISE(ABORT, 'plaid webhook investment connection mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM plaid_webhook_deliveries delivery
    JOIN connector_investment_connection_versions link
      ON link.connector_account_id = delivery.connector_account_id
     AND link.connection_id = NEW.connection_id
    WHERE delivery.id = NEW.delivery_id
      AND delivery.household_id = NEW.household_id
      AND link.household_id = NEW.household_id
      AND NOT EXISTS (
        SELECT 1
        FROM connector_investment_connection_versions later
        WHERE later.supersedes_link_id = link.id
      )
  );
END;

CREATE TRIGGER plaid_webhook_investment_connections_no_update
BEFORE UPDATE ON plaid_webhook_investment_connections
BEGIN
  SELECT RAISE(ABORT, 'plaid webhook investment connections are immutable');
END;

CREATE TRIGGER plaid_webhook_investment_connections_no_delete
BEFORE DELETE ON plaid_webhook_investment_connections
BEGIN
  SELECT RAISE(ABORT, 'plaid webhook investment connections are immutable');
END;

-- Every row scope must be declared in coverage independently of whether that
-- coverage is complete. Unresolved containers cannot claim complete coverage.
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

CREATE TRIGGER holding_import_coverages_resolved_complete_insert
BEFORE INSERT ON holding_import_coverages
WHEN NEW.completeness = 'complete'
BEGIN
  SELECT RAISE(ABORT, 'unresolved container coverage cannot be complete')
  WHERE EXISTS (
    SELECT 1
    FROM ownership_container_versions current
    WHERE current.container_id = NEW.container_id
      AND current.household_id = NEW.household_id
      AND current.container_kind = 'unresolved'
      AND NOT EXISTS (
        SELECT 1
        FROM ownership_container_versions later
        WHERE later.supersedes_version_id = current.id
      )
  );
END;

-- A sync/import link must resolve to the same exact canonical connection.
CREATE TRIGGER connector_sync_imports_canonical_scope_insert
BEFORE INSERT ON connector_sync_imports
BEGIN
  SELECT RAISE(ABORT, 'connector sync import canonical scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM connector_sync_investment_connections run_scope
    JOIN holding_import_connections import_scope
      ON import_scope.connection_id = run_scope.connection_id
    JOIN connector_sync_runs run
      ON run.id = run_scope.sync_run_id
     AND run.status = 'succeeded'
    JOIN connector_investment_connection_versions current_scope
      ON current_scope.connector_account_id = run.connector_account_id
     AND current_scope.connection_id = run_scope.connection_id
     AND NOT EXISTS (
       SELECT 1
       FROM connector_investment_connection_versions later
       WHERE later.supersedes_link_id = current_scope.id
     )
    WHERE run_scope.sync_run_id = NEW.sync_run_id
      AND run_scope.household_id = NEW.household_id
      AND import_scope.import_id = NEW.holding_import_id
      AND import_scope.household_id = NEW.household_id
  );
END;

-- Accepted applications cannot attach an import row to a position owned by a
-- different container. New ownership is inserted in the same reviewed batch.
CREATE TRIGGER holding_import_applications_container_scope_insert
BEFORE INSERT ON holding_import_applications
BEGIN
  SELECT RAISE(ABORT, 'holding import application container mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_row_containers row_scope
    JOIN holding_position_ownerships ownership
      ON ownership.position_id = NEW.position_id
     AND ownership.container_id = row_scope.container_id
    WHERE row_scope.import_row_id = NEW.import_row_id
      AND row_scope.household_id = NEW.household_id
      AND ownership.household_id = NEW.household_id
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_ownerships later
        WHERE later.supersedes_ownership_id = ownership.id
      )
  );
END;

-- Only the exact import's complete container coverage may support a missing
-- position exception. Partial, failed, ambiguous, or unrelated coverage fails.
CREATE TRIGGER holding_import_quarantines_complete_omission_insert
BEFORE INSERT ON holding_import_quarantines
WHEN NEW.reason_code = 'position_not_reported'
BEGIN
  SELECT RAISE(ABORT, 'holding omission requires complete container coverage')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_coverages coverage
    JOIN holding_position_ownerships ownership
      ON ownership.container_id = coverage.container_id
     AND ownership.position_id = NEW.position_id
    WHERE coverage.import_id = NEW.import_id
      AND coverage.household_id = NEW.household_id
      AND coverage.completeness = 'complete'
      AND ownership.household_id = NEW.household_id
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_ownerships later
        WHERE later.supersedes_ownership_id = ownership.id
      )
  );
END;
