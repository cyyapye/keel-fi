PRAGMA foreign_keys = ON;

DROP TRIGGER holding_import_row_reported_economics_integrity_insert;
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
          AND import.parser_schema IN ('sydecar_keel_template_v2', 'sydecar_keel_template_v3')
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


-- Preserve provider investment identity across the CSV boundary. Existing
-- position keys stay stable; a deal-label change is not authority to rename or
-- merge accepted financial records. Ambiguous legacy keys still need review.
CREATE TABLE holding_import_row_provider_investments (
  import_row_id TEXT PRIMARY KEY REFERENCES holding_import_rows(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  provider_investment_id TEXT NOT NULL CHECK (length(provider_investment_id) BETWEEN 8 AND 128)
);
CREATE INDEX holding_import_provider_investment_idx ON holding_import_row_provider_investments(household_id, provider_investment_id, import_row_id);
CREATE TRIGGER holding_import_provider_investment_scope BEFORE INSERT ON holding_import_row_provider_investments
BEGIN
  SELECT RAISE(ABORT, 'provider investment row scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_import_rows WHERE id = NEW.import_row_id AND household_id = NEW.household_id
  );
END;
CREATE TRIGGER holding_import_provider_investment_no_update BEFORE UPDATE ON holding_import_row_provider_investments
BEGIN SELECT RAISE(ABORT, 'provider investment evidence is append only'); END;
CREATE TRIGGER holding_import_provider_investment_no_delete BEFORE DELETE ON holding_import_row_provider_investments
BEGIN SELECT RAISE(ABORT, 'provider investment evidence is append only'); END;

-- A holder's participation and dated ownership evidence belong to the existing
-- position, not the shared legal-entity profile or a second financial record.
CREATE TABLE holding_investment_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  position_id TEXT NOT NULL REFERENCES holding_positions(id),
  request_id TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  expected_snapshot_id TEXT REFERENCES holding_position_snapshots(id),
  supersedes_review_id TEXT UNIQUE REFERENCES holding_investment_reviews(id),
  version INTEGER NOT NULL CHECK (version > 0),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  evidence_guard_json TEXT NOT NULL CHECK (json_valid(evidence_guard_json)),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  UNIQUE (household_id, request_id),
  UNIQUE (position_id, version)
);
CREATE INDEX holding_investment_reviews_current_idx ON holding_investment_reviews(household_id, position_id, version DESC);
CREATE TRIGGER holding_investment_review_guard BEFORE INSERT ON holding_investment_reviews
BEGIN
  SELECT RAISE(ABORT, 'investment review scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p JOIN households h ON h.id = p.household_id
    WHERE p.id = NEW.position_id AND p.household_id = NEW.household_id AND h.owner_user_id = NEW.reviewer_user_id
  );
  SELECT RAISE(ABORT, 'investment review stale') WHERE
    NEW.supersedes_review_id IS NOT (SELECT id FROM holding_investment_reviews WHERE position_id = NEW.position_id ORDER BY version DESC LIMIT 1)
    OR NEW.version <> 1 + COALESCE((SELECT MAX(version) FROM holding_investment_reviews WHERE position_id = NEW.position_id), 0)
    OR NEW.expected_snapshot_id IS NOT (SELECT candidate.snapshot_id FROM holding_import_applications candidate JOIN holding_position_snapshots snapshot ON snapshot.id = candidate.snapshot_id WHERE candidate.position_id = NEW.position_id ORDER BY candidate.applied_at DESC, snapshot.observed_at DESC, candidate.id DESC LIMIT 1);
  SELECT RAISE(ABORT, 'investment review state mismatch') WHERE
    json_extract(NEW.state_json, '$.id') IS NOT NEW.id OR json_extract(NEW.state_json, '$.positionId') IS NOT NEW.position_id
    OR json_extract(NEW.state_json, '$.version') IS NOT NEW.version
    OR json_extract(NEW.state_json, '$.participationStatus') NOT IN ('pending', 'current', 'historical', 'cancelled', 'unknown');
END;
CREATE TRIGGER holding_investment_reviews_no_update BEFORE UPDATE ON holding_investment_reviews
BEGIN SELECT RAISE(ABORT, 'investment review is append only'); END;
CREATE TRIGGER holding_investment_reviews_incoming_guard BEFORE INSERT ON holding_investment_reviews
BEGIN
  SELECT RAISE(ABORT, 'investment evidence stale') WHERE
    json_extract(NEW.evidence_guard_json, '$.reviewId') IS NOT (SELECT id FROM holding_investment_reviews WHERE position_id = NEW.position_id ORDER BY version DESC LIMIT 1)
    OR EXISTS (
      SELECT position_id || ':' || document_id || ':' || review_id FROM investment_document_assignments WHERE household_id = NEW.household_id AND target_position_id = NEW.position_id
      EXCEPT SELECT value FROM json_each(NEW.evidence_guard_json, '$.incoming')
    ) OR EXISTS (
      SELECT value FROM json_each(NEW.evidence_guard_json, '$.incoming')
      EXCEPT SELECT position_id || ':' || document_id || ':' || review_id FROM investment_document_assignments WHERE household_id = NEW.household_id AND target_position_id = NEW.position_id
    );
END;
CREATE TRIGGER holding_investment_reviews_no_delete BEFORE DELETE ON holding_investment_reviews
BEGIN SELECT RAISE(ABORT, 'investment review is append only'); END;

-- Rebuildable per-position document-assignment projection. The immutable review
-- above records each change. General governing documents do not imply a vehicle.
CREATE TABLE investment_document_assignments (
  household_id TEXT NOT NULL REFERENCES households(id),
  position_id TEXT NOT NULL REFERENCES holding_positions(id),
  document_id TEXT NOT NULL REFERENCES source_documents(id),
  relationship TEXT NOT NULL CHECK (relationship IN ('supports', 'general', 'other_investment', 'unassigned')),
  target_position_id TEXT REFERENCES holding_positions(id),
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  review_id TEXT NOT NULL REFERENCES holding_investment_reviews(id),
  PRIMARY KEY (position_id, document_id),
  CHECK ((relationship = 'other_investment') = (target_position_id IS NOT NULL))
);
CREATE INDEX investment_document_assignment_target_idx ON investment_document_assignments(household_id, target_position_id, document_id);
CREATE TRIGGER investment_document_assignment_scope BEFORE INSERT ON investment_document_assignments
BEGIN
  SELECT RAISE(ABORT, 'investment document scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM source_documents d JOIN holding_positions p ON p.id = NEW.position_id
    JOIN holding_investment_reviews r ON r.id = NEW.review_id
    WHERE d.id = NEW.document_id AND d.household_id = NEW.household_id AND p.household_id = NEW.household_id
      AND r.household_id = NEW.household_id AND r.position_id = p.id
  ) OR (NEW.target_position_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM holding_positions WHERE id = NEW.target_position_id AND household_id = NEW.household_id AND id <> NEW.position_id
  ));
END;

-- Company corrections version the existing exposure mappings, never rename an
-- SPV or replace its financial snapshots. Insert this receipt first in the same
-- transaction as the replacement mappings so concurrent reviews fail closed.
CREATE TABLE investment_company_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  position_id TEXT NOT NULL REFERENCES holding_positions(id),
  request_id TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  version INTEGER NOT NULL CHECK (version > 0),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  evidence_guard_json TEXT NOT NULL CHECK (json_valid(evidence_guard_json)),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  UNIQUE (household_id, request_id),
  UNIQUE (position_id, version)
);
CREATE INDEX investment_company_reviews_position_idx ON investment_company_reviews(household_id, position_id, version DESC);
CREATE TRIGGER investment_company_review_guard BEFORE INSERT ON investment_company_reviews
BEGIN
  SELECT RAISE(ABORT, 'investment company review scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p JOIN households h ON h.id = p.household_id
    WHERE p.id = NEW.position_id AND p.household_id = NEW.household_id AND h.owner_user_id = NEW.reviewer_user_id
  );
  SELECT RAISE(ABORT, 'investment company review stale') WHERE
    NEW.version <> 1 + COALESCE((SELECT MAX(version) FROM investment_company_reviews WHERE position_id = NEW.position_id), 0)
    OR json_extract(NEW.receipt_json, '$.expectedSnapshotId') IS NOT (SELECT candidate.snapshot_id FROM holding_import_applications candidate JOIN holding_position_snapshots snapshot ON snapshot.id = candidate.snapshot_id WHERE candidate.position_id = NEW.position_id ORDER BY candidate.applied_at DESC, snapshot.observed_at DESC, candidate.id DESC LIMIT 1)
    OR EXISTS (
      SELECT id FROM holding_position_exposure_mappings m WHERE m.position_id = NEW.position_id
        AND NOT EXISTS (SELECT 1 FROM holding_position_exposure_mappings later WHERE later.supersedes_mapping_id = m.id)
      EXCEPT SELECT value FROM json_each(NEW.receipt_json, '$.expectedMappingIds')
    ) OR EXISTS (
      SELECT value FROM json_each(NEW.receipt_json, '$.expectedMappingIds')
      EXCEPT SELECT id FROM holding_position_exposure_mappings m WHERE m.position_id = NEW.position_id
        AND NOT EXISTS (SELECT 1 FROM holding_position_exposure_mappings later WHERE later.supersedes_mapping_id = m.id)
    );
  SELECT RAISE(ABORT, 'investment company document unavailable') WHERE
    json_extract(NEW.receipt_json, '$.citation.documentId') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM private_document_scans s WHERE s.document_id = json_extract(NEW.receipt_json, '$.citation.documentId')
        AND s.household_id = NEW.household_id AND s.sha256 = json_extract(NEW.receipt_json, '$.citation.sha256') AND s.outcome = 'clean'
    );
END;
CREATE TRIGGER investment_company_reviews_no_update BEFORE UPDATE ON investment_company_reviews
BEGIN SELECT RAISE(ABORT, 'investment company review is append only'); END;
CREATE TRIGGER investment_company_reviews_incoming_guard BEFORE INSERT ON investment_company_reviews
BEGIN
  SELECT RAISE(ABORT, 'investment evidence stale') WHERE
    json_extract(NEW.evidence_guard_json, '$.reviewId') IS NOT (SELECT id FROM holding_investment_reviews WHERE position_id = NEW.position_id ORDER BY version DESC LIMIT 1)
    OR EXISTS (
      SELECT position_id || ':' || document_id || ':' || review_id FROM investment_document_assignments WHERE household_id = NEW.household_id AND target_position_id = NEW.position_id
      EXCEPT SELECT value FROM json_each(NEW.evidence_guard_json, '$.incoming')
    ) OR EXISTS (
      SELECT value FROM json_each(NEW.evidence_guard_json, '$.incoming')
      EXCEPT SELECT position_id || ':' || document_id || ':' || review_id FROM investment_document_assignments WHERE household_id = NEW.household_id AND target_position_id = NEW.position_id
    );
END;
CREATE TRIGGER investment_company_reviews_no_delete BEFORE DELETE ON investment_company_reviews
BEGIN SELECT RAISE(ABORT, 'investment company review is append only'); END;

-- A separately reviewed agreement can establish another pending/cancelled
-- position before an amount is known. No financial snapshot is manufactured.
CREATE TABLE document_investment_origins (
  position_id TEXT PRIMARY KEY REFERENCES holding_positions(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  source_position_id TEXT NOT NULL REFERENCES holding_positions(id),
  request_id TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (household_id, request_id)
);
CREATE INDEX document_investment_origins_household_idx ON document_investment_origins(household_id, position_id);
CREATE TRIGGER document_investment_origin_guard BEFORE INSERT ON document_investment_origins
BEGIN
  SELECT RAISE(ABORT, 'document investment origin scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p JOIN holding_positions original ON original.id = NEW.source_position_id
    JOIN households h ON h.id = p.household_id
    WHERE p.id = NEW.position_id AND p.household_id = NEW.household_id AND original.household_id = NEW.household_id
      AND h.owner_user_id = NEW.created_by_user_id
  );
END;
CREATE TRIGGER document_investment_origins_no_update BEFORE UPDATE ON document_investment_origins
BEGIN SELECT RAISE(ABORT, 'document investment origin is append only'); END;
CREATE TRIGGER document_investment_origins_no_delete BEFORE DELETE ON document_investment_origins
BEGIN SELECT RAISE(ABORT, 'document investment origin is append only'); END;

CREATE TRIGGER holding_investment_reviews_evidence_guard BEFORE INSERT ON holding_investment_reviews
BEGIN
  SELECT RAISE(ABORT, 'investment evidence stale') WHERE
    json_extract(NEW.evidence_guard_json, '$.observationId') IS NOT (
      SELECT o.id FROM holding_positions p
      JOIN holding_import_applications a ON a.id = (SELECT candidate.id FROM holding_import_applications candidate JOIN holding_position_snapshots snapshot ON snapshot.id = candidate.snapshot_id WHERE candidate.position_id = p.id ORDER BY candidate.applied_at DESC, snapshot.observed_at DESC, candidate.id DESC LIMIT 1)
      JOIN holding_import_rows r ON r.id = a.import_row_id
      LEFT JOIN holding_import_row_provider_investments provider_identity ON provider_identity.import_row_id = r.id
      JOIN provider_legal_document_latest latest ON latest.household_id = p.household_id AND latest.provider = p.provider AND latest.position_fingerprint = r.position_fingerprint
      JOIN provider_legal_document_observations o ON o.id = latest.observation_id
        AND (provider_identity.provider_investment_id IS NULL OR json_extract(o.capture_json, '$.sourceInvestment.id') = provider_identity.provider_investment_id)
      WHERE p.id = NEW.position_id AND p.household_id = NEW.household_id
    ) OR EXISTS (
      SELECT 1 FROM json_each(NEW.evidence_guard_json, '$.scans') expected
      LEFT JOIN private_document_scans s ON s.document_id = json_extract(expected.value, '$.id')
        AND s.household_id = NEW.household_id AND s.sha256 = json_extract(expected.value, '$.sha256')
      WHERE json_extract(expected.value, '$.scannedAt') IS NOT s.scanned_at
        OR json_extract(expected.value, '$.outcome') IS NOT s.outcome
    );
END;

CREATE TRIGGER investment_company_reviews_evidence_guard BEFORE INSERT ON investment_company_reviews
BEGIN
  SELECT RAISE(ABORT, 'investment evidence stale') WHERE
    json_extract(NEW.evidence_guard_json, '$.observationId') IS NOT (
      SELECT o.id FROM holding_positions p
      JOIN holding_import_applications a ON a.id = (SELECT candidate.id FROM holding_import_applications candidate JOIN holding_position_snapshots snapshot ON snapshot.id = candidate.snapshot_id WHERE candidate.position_id = p.id ORDER BY candidate.applied_at DESC, snapshot.observed_at DESC, candidate.id DESC LIMIT 1)
      JOIN holding_import_rows r ON r.id = a.import_row_id
      LEFT JOIN holding_import_row_provider_investments provider_identity ON provider_identity.import_row_id = r.id
      JOIN provider_legal_document_latest latest ON latest.household_id = p.household_id AND latest.provider = p.provider AND latest.position_fingerprint = r.position_fingerprint
      JOIN provider_legal_document_observations o ON o.id = latest.observation_id
        AND (provider_identity.provider_investment_id IS NULL OR json_extract(o.capture_json, '$.sourceInvestment.id') = provider_identity.provider_investment_id)
      WHERE p.id = NEW.position_id AND p.household_id = NEW.household_id
    ) OR EXISTS (
      SELECT 1 FROM json_each(NEW.evidence_guard_json, '$.scans') expected
      LEFT JOIN private_document_scans s ON s.document_id = json_extract(expected.value, '$.id')
        AND s.household_id = NEW.household_id AND s.sha256 = json_extract(expected.value, '$.sha256')
      WHERE json_extract(expected.value, '$.scannedAt') IS NOT s.scanned_at
        OR json_extract(expected.value, '$.outcome') IS NOT s.outcome
    );
END;
