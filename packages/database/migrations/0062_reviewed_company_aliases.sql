-- Names are identity evidence only after a recorded household review. These
-- projections never collapse legal positions or rewrite accepted history.
CREATE TABLE company_identity_revisions (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
INSERT INTO company_identity_revisions SELECT id, 0 FROM households;
CREATE INDEX companies_name_key_idx ON companies(household_id, lower(trim(legal_name)));
CREATE TABLE company_alias_reviews (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  request_id TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  expected_revision INTEGER NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  source_company_id TEXT REFERENCES companies(id),
  alias_name TEXT NOT NULL CHECK (length(alias_name) BETWEEN 1 AND 1000),
  alias_key TEXT NOT NULL CHECK (alias_key = lower(trim(alias_name))),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  guard_json TEXT NOT NULL CHECK (json_valid(guard_json)),
  position_receipts_json TEXT NOT NULL CHECK (json_valid(position_receipts_json)),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  UNIQUE (household_id, request_id),
  CHECK (company_id IS NOT source_company_id)
);
CREATE TABLE company_aliases (
  household_id TEXT NOT NULL REFERENCES households(id),
  alias_key TEXT NOT NULL,
  alias_name TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  review_id TEXT NOT NULL REFERENCES company_alias_reviews(id),
  PRIMARY KEY (household_id, alias_key)
);
CREATE INDEX company_aliases_company_idx ON company_aliases(household_id, company_id);
CREATE TABLE company_redirects (
  source_company_id TEXT PRIMARY KEY REFERENCES companies(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  review_id TEXT NOT NULL REFERENCES company_alias_reviews(id),
  CHECK (source_company_id <> company_id)
);
CREATE INDEX company_redirects_company_idx ON company_redirects(household_id, company_id);
CREATE TABLE company_alias_position_receipts (
  position_id TEXT PRIMARY KEY REFERENCES holding_positions(id),
  mapping_id TEXT NOT NULL REFERENCES holding_position_exposure_mappings(id),
  review_id TEXT NOT NULL REFERENCES company_alias_reviews(id),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json))
);
CREATE VIEW company_alias_current_receipts AS
  SELECT receipt.position_id, receipt.receipt_json
  FROM company_alias_position_receipts receipt
  WHERE EXISTS (SELECT 1 FROM holding_position_exposure_mappings mapping
    WHERE mapping.id = receipt.mapping_id AND mapping.status = 'active' AND NOT EXISTS (
      SELECT 1 FROM holding_position_exposure_mappings later WHERE later.supersedes_mapping_id = mapping.id
    ));
CREATE INDEX company_alias_mapping_roots_idx ON holding_position_exposure_mappings(household_id, exposure_id, position_id) WHERE supersedes_mapping_id IS NULL;
CREATE TRIGGER companies_identity_revision_insert AFTER INSERT ON companies BEGIN
  INSERT INTO company_identity_revisions VALUES (NEW.household_id, 1)
  ON CONFLICT(household_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER companies_identity_revision_update AFTER UPDATE ON companies BEGIN
  UPDATE company_identity_revisions SET revision = revision + 1 WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER companies_known_alias_guard BEFORE INSERT ON companies BEGIN
  SELECT RAISE(ABORT, 'company alias exists; choose its reviewed company') WHERE EXISTS (
    SELECT 1 FROM company_aliases WHERE household_id = NEW.household_id AND alias_key = lower(trim(NEW.legal_name))
  );
END;
CREATE TRIGGER company_alias_review_guard BEFORE INSERT ON company_alias_reviews BEGIN
  SELECT RAISE(ABORT, 'company alias scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM companies c JOIN households h ON h.id = c.household_id
    WHERE c.id = NEW.company_id AND h.id = NEW.household_id AND h.owner_user_id = NEW.reviewer_user_id
  ) OR (NEW.source_company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM companies WHERE id = NEW.source_company_id AND household_id = NEW.household_id AND lower(trim(legal_name)) = NEW.alias_key
  ));
  SELECT RAISE(ABORT, 'company alias stale') WHERE
    NEW.expected_revision <> COALESCE((SELECT revision FROM company_identity_revisions WHERE household_id = NEW.household_id), 0)
    OR EXISTS (SELECT 1 FROM company_redirects WHERE source_company_id IN (NEW.company_id, NEW.source_company_id));
  SELECT RAISE(ABORT, 'company alias conflict') WHERE EXISTS (
    SELECT 1 FROM company_aliases WHERE household_id = NEW.household_id AND alias_key = NEW.alias_key AND company_id <> NEW.company_id
  ) OR EXISTS (
    SELECT 1 FROM companies c WHERE c.household_id = NEW.household_id AND lower(trim(c.legal_name)) = NEW.alias_key
      AND c.id <> NEW.company_id AND c.id IS NOT NEW.source_company_id
      AND NOT EXISTS (SELECT 1 FROM company_redirects r WHERE r.source_company_id = c.id AND r.company_id = NEW.source_company_id)
  );
  -- Compare the complete current mapping set using roots + indexed head seeks;
  -- the cost does not grow with repeated historical versions.
  SELECT RAISE(ABORT, 'company alias mappings stale') WHERE EXISTS (
    SELECT m.id FROM canonical_exposures e
    JOIN holding_position_exposure_mappings root INDEXED BY company_alias_mapping_roots_idx ON root.household_id = e.household_id AND root.exposure_id = e.id AND root.supersedes_mapping_id IS NULL
    JOIN holding_position_exposure_mappings m ON m.id = (SELECT id FROM holding_position_exposure_mappings WHERE position_id = root.position_id AND exposure_id = root.exposure_id ORDER BY version DESC LIMIT 1)
    WHERE e.household_id = NEW.household_id AND e.company_id IN (NEW.company_id, NEW.source_company_id)
    EXCEPT SELECT value FROM json_each(NEW.guard_json, '$.mappingIds')
  ) OR EXISTS (
    SELECT value FROM json_each(NEW.guard_json, '$.mappingIds')
    EXCEPT SELECT m.id FROM canonical_exposures e
    JOIN holding_position_exposure_mappings root INDEXED BY company_alias_mapping_roots_idx ON root.household_id = e.household_id AND root.exposure_id = e.id AND root.supersedes_mapping_id IS NULL
    JOIN holding_position_exposure_mappings m ON m.id = (SELECT id FROM holding_position_exposure_mappings WHERE position_id = root.position_id AND exposure_id = root.exposure_id ORDER BY version DESC LIMIT 1)
    WHERE e.household_id = NEW.household_id AND e.company_id IN (NEW.company_id, NEW.source_company_id)
  );
END;
CREATE TRIGGER company_alias_review_projection AFTER INSERT ON company_alias_reviews BEGIN
  UPDATE company_aliases SET company_id = NEW.company_id, review_id = NEW.id
    WHERE household_id = NEW.household_id AND company_id = NEW.source_company_id;
  UPDATE company_redirects SET company_id = NEW.company_id, review_id = NEW.id
    WHERE household_id = NEW.household_id AND company_id = NEW.source_company_id;
  INSERT INTO company_redirects SELECT NEW.source_company_id, NEW.household_id, NEW.company_id, NEW.id WHERE NEW.source_company_id IS NOT NULL;
  INSERT INTO company_aliases VALUES (NEW.household_id, NEW.alias_key, NEW.alias_name, NEW.company_id, NEW.id)
    ON CONFLICT(household_id, alias_key) DO UPDATE SET company_id = excluded.company_id, alias_name = excluded.alias_name, review_id = excluded.review_id;
  INSERT INTO company_identity_revisions VALUES (NEW.household_id, 1)
    ON CONFLICT(household_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER company_alias_review_no_update BEFORE UPDATE ON company_alias_reviews BEGIN SELECT RAISE(ABORT, 'company alias reviews are append only'); END;
CREATE TRIGGER company_alias_review_no_delete BEFORE DELETE ON company_alias_reviews BEGIN SELECT RAISE(ABORT, 'company alias reviews are append only'); END;
CREATE TRIGGER company_mapping_canonical_guard BEFORE INSERT ON holding_position_exposure_mappings WHEN NEW.status = 'active' BEGIN
  SELECT RAISE(ABORT, 'company alias changed; use its reviewed company') WHERE EXISTS (
    SELECT 1 FROM canonical_exposures e JOIN company_redirects r ON r.source_company_id = e.company_id WHERE e.id = NEW.exposure_id
  );
END;
