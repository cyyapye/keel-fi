-- A compartment review must not race with a target being reclassified as an
-- LLC. Keep the classification check in the same commit as the reviewed receipt.
CREATE TRIGGER legal_structure_resolution_entity_insert
BEFORE INSERT ON legal_entity_source_decisions
WHEN NEW.name_resolution_json IS NOT NULL
  AND json_extract(NEW.name_resolution_json, '$.evidence.problem') = 'other_structure'
BEGIN
  SELECT RAISE(ABORT, 'legal name resolution entity changed')
  WHERE NOT EXISTS (
    SELECT 1 FROM legal_entity_versions version
    WHERE version.legal_entity_id = NEW.legal_entity_id
      AND version.household_id = NEW.household_id
      AND version.entity_type = 'other'
      AND NOT EXISTS (
        SELECT 1 FROM legal_entity_versions later
        WHERE later.supersedes_version_id = version.id
      )
  );
END;
