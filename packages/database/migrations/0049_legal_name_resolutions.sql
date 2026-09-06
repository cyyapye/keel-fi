-- A reviewed name choice retains the exact evidence shown at decision time.
-- Existing append-only source-decision triggers also protect this receipt.
ALTER TABLE legal_entity_source_decisions ADD COLUMN name_resolution_json TEXT
  CHECK (name_resolution_json IS NULL OR (
    decision = 'linked' AND json_valid(name_resolution_json)
  ));

-- Fence a concurrent profile rename at the actual commit, not only at the
-- earlier application read. Accepted names and reviewed receipts must agree.
CREATE TRIGGER legal_name_resolution_entity_insert
BEFORE INSERT ON legal_entity_source_decisions
WHEN NEW.name_resolution_json IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'legal name resolution entity changed')
  WHERE NOT EXISTS (
    SELECT 1 FROM legal_entity_versions version
    WHERE version.legal_entity_id = NEW.legal_entity_id
      AND version.household_id = NEW.household_id
      AND version.legal_name = json_extract(NEW.name_resolution_json, '$.legalName')
      AND NOT EXISTS (
        SELECT 1 FROM legal_entity_versions later
        WHERE later.supersedes_version_id = version.id
      )
  );
END;
