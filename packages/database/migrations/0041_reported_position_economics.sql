PRAGMA foreign_keys = ON;

-- Provider-reported fee and carry percentages are derived, append-only source
-- evidence. Keeping them separate from immutable import rows also lets a
-- repeated byte-identical export add newly supported parsing without rewriting
-- the accepted position or its source snapshot.
CREATE TABLE holding_import_row_reported_economics_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_row_id TEXT NOT NULL UNIQUE
    REFERENCES holding_import_rows(id) ON DELETE RESTRICT,
  management_fee_ppm INTEGER CHECK (
    management_fee_ppm IS NULL OR management_fee_ppm BETWEEN 0 AND 1000000
  ),
  carry_ppm INTEGER CHECK (
    carry_ppm IS NULL OR carry_ppm BETWEEN 0 AND 1000000
  ),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64
    AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  derivation_method TEXT NOT NULL CHECK (
    derivation_method IN (
      'angellist_export_carry_v1',
      'sydecar_template_economics_v1'
    )
  ),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (management_fee_ppm IS NOT NULL OR carry_ppm IS NOT NULL)
);

CREATE INDEX holding_import_row_reported_economics_household_row_idx
  ON holding_import_row_reported_economics_evidence(
    household_id, import_row_id
  );

CREATE TRIGGER holding_import_row_reported_economics_integrity_insert
BEFORE INSERT ON holding_import_row_reported_economics_evidence
BEGIN
  SELECT RAISE(ABORT, 'reported position economics evidence provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_imports import ON import.id = row.import_id
    JOIN source_documents document ON document.id = import.source_document_id
    JOIN households household ON household.id = row.household_id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND import.household_id = NEW.household_id
      AND document.household_id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
      AND document.sha256 = NEW.evidence_sha256
      AND row.position_kind = 'spv_interest'
      AND (
        (
          import.provider = 'sydecar'
          AND import.parser_schema = 'sydecar_keel_template_v2'
          AND NEW.management_fee_ppm IS NOT NULL
          AND NEW.carry_ppm IS NOT NULL
          AND NEW.derivation_method = 'sydecar_template_economics_v1'
        )
        OR (
          import.provider = 'angellist'
          AND NEW.management_fee_ppm IS NULL
          AND NEW.carry_ppm IS NOT NULL
          AND NEW.derivation_method = 'angellist_export_carry_v1'
        )
      )
  );
END;

CREATE TRIGGER holding_import_row_reported_economics_no_update
BEFORE UPDATE ON holding_import_row_reported_economics_evidence
BEGIN
  SELECT RAISE(ABORT, 'reported position economics evidence is immutable');
END;

CREATE TRIGGER holding_import_row_reported_economics_no_delete
BEFORE DELETE ON holding_import_row_reported_economics_evidence
BEGIN
  SELECT RAISE(ABORT, 'reported position economics evidence is immutable');
END;
