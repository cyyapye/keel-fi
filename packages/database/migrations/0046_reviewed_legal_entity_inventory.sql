PRAGMA foreign_keys = ON;

-- Legal entities are reviewed household records. They remain distinct from
-- companies and economic exposures, and they can exist without a holding.
CREATE TABLE legal_entities (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX legal_entities_household_created_idx
  ON legal_entities(household_id, created_at, id);

CREATE TRIGGER legal_entities_integrity_insert
BEFORE INSERT ON legal_entities
BEGIN
  SELECT RAISE(ABORT, 'legal entity household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM households household
    WHERE household.id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
  );
END;

CREATE TRIGGER legal_entities_no_update
BEFORE UPDATE ON legal_entities
BEGIN
  SELECT RAISE(ABORT, 'legal entities are immutable');
END;

CREATE TRIGGER legal_entities_no_delete
BEFORE DELETE ON legal_entities
BEGIN
  SELECT RAISE(ABORT, 'legal entities are immutable');
END;

-- Profile corrections advance through an append-only version chain. Missing
-- legal and ownership details stay nullable rather than being inferred.
CREATE TABLE legal_entity_versions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  legal_entity_id TEXT NOT NULL
    REFERENCES legal_entities(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  legal_name TEXT NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 1000),
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'llc', 'limited_partnership', 'corporation', 'partnership', 'trust',
      'other'
    )
  ),
  relationship TEXT NOT NULL CHECK (
    relationship IN (
      'direct_interest', 'ownership_entity', 'operating_entity',
      'investment_vehicle', 'other'
    )
  ),
  current_owner TEXT CHECK (
    current_owner IS NULL OR length(current_owner) BETWEEN 1 AND 1000
  ),
  jurisdiction TEXT CHECK (
    jurisdiction IS NULL OR length(jurisdiction) BETWEEN 1 AND 240
  ),
  formed_on TEXT CHECK (formed_on IS NULL OR length(formed_on) = 10),
  ein_last_four TEXT CHECK (
    ein_last_four IS NULL OR (
      length(ein_last_four) = 4
      AND ein_last_four NOT GLOB '*[^0-9]*'
    )
  ),
  ownership_interest_ppm INTEGER CHECK (
    ownership_interest_ppm IS NULL
    OR ownership_interest_ppm BETWEEN 0 AND 1000000
  ),
  interest_status TEXT NOT NULL CHECK (
    interest_status IN ('current', 'historical', 'unknown')
  ),
  tax_classification TEXT CHECK (
    tax_classification IS NULL
    OR length(tax_classification) BETWEEN 1 AND 240
  ),
  notes TEXT CHECK (notes IS NULL OR length(notes) BETWEEN 1 AND 2000),
  supersedes_version_id TEXT UNIQUE
    REFERENCES legal_entity_versions(id) ON DELETE RESTRICT,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (legal_entity_id, version),
  CHECK (
    (version = 1 AND supersedes_version_id IS NULL)
    OR (version > 1 AND supersedes_version_id IS NOT NULL)
  )
);
CREATE INDEX legal_entity_versions_household_entity_idx
  ON legal_entity_versions(household_id, legal_entity_id, version);

CREATE TRIGGER legal_entity_versions_integrity_insert
BEFORE INSERT ON legal_entity_versions
BEGIN
  SELECT RAISE(ABORT, 'legal entity version household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM legal_entities entity
    JOIN households household ON household.id = entity.household_id
    WHERE entity.id = NEW.legal_entity_id
      AND entity.household_id = NEW.household_id
      AND household.owner_user_id = NEW.recorded_by_user_id
  );

  SELECT RAISE(ABORT, 'legal entity initial version mismatch')
  WHERE NEW.supersedes_version_id IS NULL AND EXISTS (
    SELECT 1
    FROM legal_entity_versions prior
    WHERE prior.legal_entity_id = NEW.legal_entity_id
  );

  SELECT RAISE(ABORT, 'legal entity supersession mismatch')
  WHERE NEW.supersedes_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM legal_entity_versions prior
    WHERE prior.id = NEW.supersedes_version_id
      AND prior.household_id = NEW.household_id
      AND prior.legal_entity_id = NEW.legal_entity_id
      AND prior.version = NEW.version - 1
      AND NOT EXISTS (
        SELECT 1
        FROM legal_entity_versions later
        WHERE later.supersedes_version_id = prior.id
      )
  );
END;

CREATE TRIGGER legal_entity_versions_no_update
BEFORE UPDATE ON legal_entity_versions
BEGIN
  SELECT RAISE(ABORT, 'legal entity versions are immutable');
END;

CREATE TRIGGER legal_entity_versions_no_delete
BEFORE DELETE ON legal_entity_versions
BEGIN
  SELECT RAISE(ABORT, 'legal entity versions are immutable');
END;

-- Exact reviewed decisions connect a legal entity to an ownership container or
-- legal position, or record that the source is not an LLC. Display text never
-- acts as identity, and corrections supersede rather than replace decisions.
CREATE TABLE legal_entity_source_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('ownership_container', 'holding_position')
  ),
  source_reference TEXT NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 500),
  source_name TEXT NOT NULL CHECK (length(source_name) BETWEEN 1 AND 1000),
  source_label TEXT NOT NULL CHECK (length(source_label) BETWEEN 1 AND 1000),
  source_as_of TEXT NOT NULL CHECK (length(source_as_of) = 10),
  relationship TEXT NOT NULL CHECK (
    relationship IN (
      'direct_interest', 'ownership_entity', 'operating_entity',
      'investment_vehicle', 'other'
    )
  ),
  current_owner TEXT CHECK (
    current_owner IS NULL OR length(current_owner) BETWEEN 1 AND 1000
  ),
  interest_status TEXT NOT NULL CHECK (
    interest_status IN ('current', 'historical', 'unknown')
  ),
  opened_on TEXT CHECK (opened_on IS NULL OR length(opened_on) = 10),
  decision TEXT NOT NULL CHECK (decision IN ('linked', 'not_llc')),
  legal_entity_id TEXT REFERENCES legal_entities(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  supersedes_decision_id TEXT UNIQUE
    REFERENCES legal_entity_source_decisions(id) ON DELETE RESTRICT,
  decided_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (source_kind, source_reference, version),
  CHECK (
    (version = 1 AND supersedes_decision_id IS NULL)
    OR (version > 1 AND supersedes_decision_id IS NOT NULL)
  ),
  CHECK (
    (decision = 'linked' AND legal_entity_id IS NOT NULL)
    OR (decision = 'not_llc' AND legal_entity_id IS NULL)
  )
);
CREATE UNIQUE INDEX legal_entity_source_decisions_root_unique
  ON legal_entity_source_decisions(source_kind, source_reference)
  WHERE supersedes_decision_id IS NULL;
CREATE INDEX legal_entity_source_decisions_household_source_idx
  ON legal_entity_source_decisions(
    household_id, source_kind, source_reference, version
  );
CREATE INDEX legal_entity_source_decisions_household_entity_idx
  ON legal_entity_source_decisions(household_id, legal_entity_id, version);

CREATE TRIGGER legal_entity_source_decisions_integrity_insert
BEFORE INSERT ON legal_entity_source_decisions
BEGIN
  SELECT RAISE(ABORT, 'legal entity source decision household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM households household
    WHERE household.id = NEW.household_id
      AND household.owner_user_id = NEW.decided_by_user_id
  );

  SELECT RAISE(ABORT, 'legal entity source container mismatch')
  WHERE NEW.source_kind = 'ownership_container' AND NOT EXISTS (
    SELECT 1
    FROM ownership_containers container
    WHERE container.id = NEW.source_reference
      AND container.household_id = NEW.household_id
  );

  SELECT RAISE(ABORT, 'legal entity source position mismatch')
  WHERE NEW.source_kind = 'holding_position' AND NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    WHERE position.id = NEW.source_reference
      AND position.household_id = NEW.household_id
  );

  SELECT RAISE(ABORT, 'linked legal entity household mismatch')
  WHERE NEW.legal_entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM legal_entities entity
    WHERE entity.id = NEW.legal_entity_id
      AND entity.household_id = NEW.household_id
  );

  SELECT RAISE(ABORT, 'legal entity source initial decision mismatch')
  WHERE NEW.supersedes_decision_id IS NULL AND EXISTS (
    SELECT 1
    FROM legal_entity_source_decisions prior
    WHERE prior.source_kind = NEW.source_kind
      AND prior.source_reference = NEW.source_reference
  );

  SELECT RAISE(ABORT, 'legal entity source supersession mismatch')
  WHERE NEW.supersedes_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM legal_entity_source_decisions prior
    WHERE prior.id = NEW.supersedes_decision_id
      AND prior.household_id = NEW.household_id
      AND prior.source_kind = NEW.source_kind
      AND prior.source_reference = NEW.source_reference
      AND prior.version = NEW.version - 1
      AND NOT EXISTS (
        SELECT 1
        FROM legal_entity_source_decisions later
        WHERE later.supersedes_decision_id = prior.id
      )
  );
END;

CREATE TRIGGER legal_entity_source_decisions_no_update
BEFORE UPDATE ON legal_entity_source_decisions
BEGIN
  SELECT RAISE(ABORT, 'legal entity source decisions are immutable');
END;

CREATE TRIGGER legal_entity_source_decisions_no_delete
BEFORE DELETE ON legal_entity_source_decisions
BEGIN
  SELECT RAISE(ABORT, 'legal entity source decisions are immutable');
END;
