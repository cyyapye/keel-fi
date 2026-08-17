PRAGMA foreign_keys = ON;

-- Public holdings accepted before canonical exposure resolution retained their
-- exact Plaid source document, but not the checksum-valid security identifier
-- needed to group economic exposure across accounts. Record the derived result
-- as append-only evidence instead of rewriting the accepted import row.
CREATE TABLE holding_import_row_public_exposure_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_row_id TEXT NOT NULL UNIQUE
    REFERENCES holding_import_rows(id) ON DELETE RESTRICT,
  resolution_status TEXT NOT NULL CHECK (
    resolution_status IN ('strong_identifier', 'no_strong_identifier')
  ),
  identity_kind TEXT CHECK (identity_kind IN ('cusip', 'isin', 'sedol')),
  protected_identity_key TEXT CHECK (
    protected_identity_key IS NULL OR (
      length(protected_identity_key) = 64
      AND protected_identity_key NOT GLOB '*[^0-9a-f]*'
    )
  ),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64
    AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  derivation_method TEXT NOT NULL CHECK (
    derivation_method = 'retained_source_document'
  ),
  created_by_user_id TEXT NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (
    (
      resolution_status = 'strong_identifier'
      AND identity_kind IS NOT NULL
      AND protected_identity_key IS NOT NULL
    )
    OR (
      resolution_status = 'no_strong_identifier'
      AND identity_kind IS NULL
      AND protected_identity_key IS NULL
    )
  )
);

CREATE INDEX holding_import_row_public_exposure_evidence_key_idx
  ON holding_import_row_public_exposure_evidence(
    household_id, protected_identity_key
  ) WHERE protected_identity_key IS NOT NULL;

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

CREATE TRIGGER holding_import_row_public_exposure_evidence_no_update
BEFORE UPDATE ON holding_import_row_public_exposure_evidence
BEGIN
  SELECT RAISE(ABORT, 'retained public exposure evidence is immutable');
END;

CREATE TRIGGER holding_import_row_public_exposure_evidence_no_delete
BEFORE DELETE ON holding_import_row_public_exposure_evidence
BEGIN
  SELECT RAISE(ABORT, 'retained public exposure evidence is immutable');
END;
