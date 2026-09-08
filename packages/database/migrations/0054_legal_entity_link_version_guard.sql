-- Pin a reviewed link to the entity profile actually compared with the source.
ALTER TABLE legal_entity_source_decisions ADD COLUMN expected_entity_version_id TEXT;

CREATE TRIGGER legal_entity_link_version_insert
BEFORE INSERT ON legal_entity_source_decisions
WHEN NEW.expected_entity_version_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'legal name resolution entity changed')
  WHERE NOT EXISTS (
    SELECT 1 FROM legal_entity_versions version
    WHERE version.id = NEW.expected_entity_version_id
      AND version.legal_entity_id = NEW.legal_entity_id
      AND version.household_id = NEW.household_id
      AND NOT EXISTS (SELECT 1 FROM legal_entity_versions later WHERE later.supersedes_version_id = version.id)
  );
END;
