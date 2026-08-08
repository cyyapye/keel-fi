PRAGMA foreign_keys = ON;

-- Uploads are retained as private source_documents.  These rows record the
-- immutable parse result without treating an external observation as an
-- accepted holding.
CREATE TABLE holding_imports (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  source_document_id TEXT NOT NULL UNIQUE
    REFERENCES source_documents(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 50),
  parser_schema TEXT NOT NULL CHECK (length(parser_schema) BETWEEN 1 AND 100),
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 1 AND 500),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
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

CREATE TABLE holding_import_rows (
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
  invested_on TEXT NOT NULL CHECK (
    invested_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
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
  UNIQUE (import_id, source_row_number),
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
CREATE INDEX holding_import_rows_import_idx
  ON holding_import_rows(import_id, source_row_number);
CREATE INDEX holding_import_rows_position_idx
  ON holding_import_rows(household_id, position_fingerprint);

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

-- A position is the legal asset owned by the household.  For AngelList
-- syndicates that is an SPV interest, not shares in the look-through company.
-- Quantity is deliberately absent because the export does not report LP units.
CREATE TABLE holding_positions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 50),
  position_fingerprint TEXT NOT NULL CHECK (
    length(position_fingerprint) = 64
    AND position_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  legal_vehicle_name TEXT NOT NULL CHECK (
    length(legal_vehicle_name) BETWEEN 1 AND 1000
  ),
  owner_label TEXT NOT NULL CHECK (length(owner_label) BETWEEN 1 AND 1000),
  position_kind TEXT NOT NULL CHECK (
    position_kind IN ('direct', 'spv_interest', 'fund_interest')
  ),
  instrument_type TEXT NOT NULL CHECK (length(instrument_type) BETWEEN 1 AND 1000),
  opened_on TEXT CHECK (
    opened_on IS NULL OR
    opened_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND currency = upper(currency)
  ),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, provider, position_fingerprint)
);
CREATE INDEX holding_positions_household_created_idx
  ON holding_positions(household_id, created_at);

CREATE TRIGGER holding_positions_integrity_insert
BEFORE INSERT ON holding_positions
BEGIN
  SELECT RAISE(ABORT, 'holding position household mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM households household
    WHERE household.id = NEW.household_id
      AND household.owner_user_id = NEW.created_by
  );
END;

CREATE TRIGGER holding_positions_no_update
BEFORE UPDATE ON holding_positions
BEGIN
  SELECT RAISE(ABORT, 'holding positions are immutable');
END;

CREATE TRIGGER holding_positions_no_delete
BEFORE DELETE ON holding_positions
BEGIN
  SELECT RAISE(ABORT, 'holding positions are immutable');
END;

-- Exposure is intentionally separate and may remain unresolved.  Provider
-- display text must not silently become a canonical company record.
CREATE TABLE holding_position_exposures (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  exposure_label TEXT CHECK (
    exposure_label IS NULL OR length(exposure_label) BETWEEN 1 AND 1000
  ),
  exposure_kind TEXT NOT NULL CHECK (
    exposure_kind IN ('unresolved', 'company', 'fund')
  ),
  company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (position_id, exposure_label),
  CHECK (exposure_label IS NOT NULL OR company_id IS NOT NULL),
  CHECK (exposure_kind = 'company' OR company_id IS NULL)
);
CREATE INDEX holding_position_exposures_household_idx
  ON holding_position_exposures(household_id, position_id);

CREATE TRIGGER holding_position_exposures_integrity_insert
BEFORE INSERT ON holding_position_exposures
BEGIN
  SELECT RAISE(ABORT, 'holding exposure household mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions position
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
  );
  SELECT RAISE(ABORT, 'holding exposure company mismatch')
  WHERE NEW.company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM companies company
    WHERE company.id = NEW.company_id
      AND company.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_position_exposures_no_update
BEFORE UPDATE ON holding_position_exposures
BEGIN
  SELECT RAISE(ABORT, 'holding position exposures are immutable');
END;

CREATE TRIGGER holding_position_exposures_no_delete
BEFORE DELETE ON holding_position_exposures
BEGIN
  SELECT RAISE(ABORT, 'holding position exposures are immutable');
END;

-- Financial facts are append-only provider snapshots.  Missing or locked
-- values remain NULL with an explicit state; they are never coerced to zero.
CREATE TABLE holding_position_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  source_document_id TEXT NOT NULL
    REFERENCES source_documents(id) ON DELETE RESTRICT,
  source_import_row_id TEXT NOT NULL UNIQUE
    REFERENCES holding_import_rows(id) ON DELETE RESTRICT,
  snapshot_fingerprint TEXT NOT NULL CHECK (
    length(snapshot_fingerprint) = 64
    AND snapshot_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  provider_status TEXT NOT NULL CHECK (
    provider_status IN ('live', 'realized')
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
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND currency = upper(currency)
  ),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (position_id, snapshot_fingerprint),
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
CREATE INDEX holding_position_snapshots_position_idx
  ON holding_position_snapshots(position_id, observed_at);

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

CREATE TRIGGER holding_position_snapshots_no_update
BEFORE UPDATE ON holding_position_snapshots
BEGIN
  SELECT RAISE(ABORT, 'holding position snapshots are immutable');
END;

CREATE TRIGGER holding_position_snapshots_no_delete
BEFORE DELETE ON holding_position_snapshots
BEGIN
  SELECT RAISE(ABORT, 'holding position snapshots are immutable');
END;

CREATE TABLE holding_import_row_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_row_id TEXT NOT NULL UNIQUE
    REFERENCES holding_import_rows(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  matched_position_id TEXT REFERENCES holding_positions(id) ON DELETE RESTRICT,
  currency TEXT CHECK (
    currency IS NULL OR (length(currency) = 3 AND currency = upper(currency))
  ),
  reviewed_snapshot_fingerprint TEXT NOT NULL CHECK (
    length(reviewed_snapshot_fingerprint) = 64
    AND reviewed_snapshot_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 500),
  decided_at TEXT NOT NULL,
  CHECK (decision = 'rejected' OR currency IS NOT NULL)
);
CREATE INDEX holding_import_row_decisions_household_idx
  ON holding_import_row_decisions(household_id, decided_at);

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

CREATE TRIGGER holding_import_row_decisions_no_update
BEFORE UPDATE ON holding_import_row_decisions
BEGIN
  SELECT RAISE(ABORT, 'holding import decisions are immutable');
END;

CREATE TRIGGER holding_import_row_decisions_no_delete
BEFORE DELETE ON holding_import_row_decisions
BEGIN
  SELECT RAISE(ABORT, 'holding import decisions are immutable');
END;

CREATE TABLE holding_import_applications (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_row_id TEXT NOT NULL UNIQUE
    REFERENCES holding_import_rows(id) ON DELETE RESTRICT,
  decision_id TEXT NOT NULL UNIQUE
    REFERENCES holding_import_row_decisions(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('created_position', 'appended_snapshot', 'no_change')
  ),
  applied_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  applied_at TEXT NOT NULL
);
CREATE INDEX holding_import_applications_household_idx
  ON holding_import_applications(household_id, applied_at);

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

CREATE TRIGGER holding_import_applications_no_update
BEFORE UPDATE ON holding_import_applications
BEGIN
  SELECT RAISE(ABORT, 'holding import applications are immutable');
END;

CREATE TRIGGER holding_import_applications_no_delete
BEFORE DELETE ON holding_import_applications
BEGIN
  SELECT RAISE(ABORT, 'holding import applications are immutable');
END;
