-- Carry only checksum-validated, protected public-security identities into D1.
-- Tickers, provider security IDs, and display text remain non-canonical.
ALTER TABLE holding_import_rows
ADD COLUMN public_exposure_identity_kind TEXT CHECK (
  public_exposure_identity_kind IS NULL
  OR public_exposure_identity_kind IN ('cusip', 'isin', 'sedol')
);

ALTER TABLE holding_import_rows
ADD COLUMN protected_exposure_key TEXT CHECK (
  protected_exposure_key IS NULL OR (
    length(protected_exposure_key) = 64
    AND protected_exposure_key NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE INDEX holding_import_rows_protected_exposure_idx
  ON holding_import_rows(household_id, protected_exposure_key)
  WHERE protected_exposure_key IS NOT NULL;

CREATE TRIGGER holding_import_rows_exposure_identity_insert
BEFORE INSERT ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'holding import exposure identity mismatch')
  WHERE (NEW.public_exposure_identity_kind IS NULL)
        <> (NEW.protected_exposure_key IS NULL);
END;

-- A direct relationship is the complete economic exposure of its legal
-- position. Unresolved relationships may be visible but cannot manufacture
-- allocated value.
CREATE TRIGGER holding_position_exposure_mappings_policy_insert
BEFORE INSERT ON holding_position_exposure_mappings
BEGIN
  SELECT RAISE(ABORT, 'direct exposure mappings require full allocation')
  WHERE NEW.status = 'active'
    AND NEW.relationship_kind = 'direct'
    AND NEW.allocation_ppm IS NOT 1000000;

  SELECT RAISE(ABORT, 'unresolved exposure mappings cannot allocate value')
  WHERE NEW.status = 'active'
    AND NEW.allocation_ppm IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM canonical_exposures exposure
      WHERE exposure.id = NEW.exposure_id
        AND exposure.exposure_kind = 'unresolved'
    );
END;
