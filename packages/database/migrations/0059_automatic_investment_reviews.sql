-- Automatic decisions use the same append-only financial and identity records
-- as manual review. This receipt records the policy, source revisions, and
-- remaining exceptions; it is not another store of investment balances.
ALTER TABLE holding_position_economics_proposals ADD COLUMN decision_source TEXT NOT NULL DEFAULT 'manual' CHECK (decision_source IN ('manual', 'policy'));
ALTER TABLE legal_entity_source_decisions ADD COLUMN decision_source TEXT NOT NULL DEFAULT 'manual' CHECK (decision_source IN ('manual', 'policy'));

CREATE INDEX holding_positions_household_id_idx ON holding_positions(household_id, id);
-- Integrity checks also address a position without a household prefix. Keep
-- their root lookup and allocation checks out of unrelated mapping history.
CREATE INDEX holding_position_exposure_mappings_position_idx ON holding_position_exposure_mappings(position_id, exposure_id, version DESC);
CREATE INDEX legal_entity_versions_household_name_idx ON legal_entity_versions(household_id, legal_name, legal_entity_id, version);

CREATE TABLE automatic_investment_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  position_id TEXT NOT NULL REFERENCES holding_positions(id),
  snapshot_id TEXT NOT NULL REFERENCES holding_position_snapshots(id),
  policy_version TEXT NOT NULL CHECK (policy_version = 'investment-review-auto-v1'),
  source_revision TEXT NOT NULL CHECK (length(source_revision) = 64),
  expected_guard_json TEXT NOT NULL CHECK (json_valid(expected_guard_json)),
  result_guard_json TEXT NOT NULL CHECK (json_valid(result_guard_json)),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  version INTEGER NOT NULL CHECK (version > 0),
  supersedes_id TEXT UNIQUE REFERENCES automatic_investment_reviews(id),
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  UNIQUE (position_id, version),
  CHECK (json_extract(summary_json, '$.id') = id AND json_extract(summary_json, '$.snapshotId') = snapshot_id)
);
-- The UNIQUE(position_id, version) index supplies the current-head lookup.
CREATE TRIGGER automatic_investment_reviews_guard BEFORE INSERT ON automatic_investment_reviews
BEGIN
  SELECT RAISE(ABORT, 'automatic investment scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p JOIN households h ON h.id = p.household_id
    WHERE p.id = NEW.position_id AND p.household_id = NEW.household_id AND h.owner_user_id = NEW.recorded_by_user_id
      AND p.position_kind <> 'direct'
      AND EXISTS (SELECT 1 FROM holding_position_snapshots s WHERE s.id = NEW.snapshot_id AND s.position_id = p.id)
  );
  SELECT RAISE(ABORT, 'automatic investment stale') WHERE
    NEW.supersedes_id IS NOT (SELECT id FROM automatic_investment_reviews WHERE household_id = NEW.household_id AND position_id = NEW.position_id ORDER BY version DESC LIMIT 1)
    OR NEW.version <> 1 + COALESCE((SELECT version FROM automatic_investment_reviews WHERE household_id = NEW.household_id AND position_id = NEW.position_id ORDER BY version DESC LIMIT 1), 0)
    OR json_extract(NEW.expected_guard_json, '$.applicationId') IS NOT (
      SELECT a.id FROM holding_import_applications a JOIN holding_position_snapshots s ON s.id = a.snapshot_id
      WHERE a.position_id = NEW.position_id ORDER BY a.applied_at DESC, s.observed_at DESC, a.id DESC LIMIT 1
    )
    OR NEW.snapshot_id IS NOT (SELECT snapshot_id FROM holding_import_applications WHERE id = json_extract(NEW.expected_guard_json, '$.applicationId'))
    OR json_extract(NEW.expected_guard_json, '$.reviewId') IS NOT (SELECT id FROM holding_investment_reviews WHERE household_id = NEW.household_id AND position_id = NEW.position_id ORDER BY version DESC LIMIT 1)
    OR json_extract(NEW.expected_guard_json, '$.companyReviewId') IS NOT (SELECT id FROM investment_company_reviews WHERE household_id = NEW.household_id AND position_id = NEW.position_id ORDER BY version DESC LIMIT 1)
    OR json_extract(NEW.expected_guard_json, '$.entityDecisionId') IS NOT (SELECT id FROM legal_entity_source_decisions WHERE household_id = NEW.household_id AND source_kind = 'holding_position' AND source_reference = NEW.position_id ORDER BY version DESC LIMIT 1)
    OR json_extract(NEW.expected_guard_json, '$.entityVersionId') IS NOT (
      SELECT v.id FROM legal_entity_source_decisions d JOIN legal_entity_versions v ON v.household_id = d.household_id AND v.legal_entity_id = d.legal_entity_id
      WHERE d.id = json_extract(NEW.expected_guard_json, '$.entityDecisionId') ORDER BY v.version DESC LIMIT 1
    )
    OR json_extract(NEW.expected_guard_json, '$.termsId') IS NOT (
      SELECT p.id FROM holding_position_economics_proposals p JOIN holding_position_economics_reviews r ON r.proposal_id = p.id AND r.decision = 'accepted'
      WHERE p.household_id = NEW.household_id AND p.position_id = NEW.position_id AND NOT EXISTS (
        SELECT 1 FROM holding_position_economics_proposals later JOIN holding_position_economics_reviews accepted ON accepted.proposal_id = later.id AND accepted.decision = 'accepted' WHERE later.supersedes_proposal_id = p.id
      ) ORDER BY r.decided_at DESC, p.id DESC LIMIT 1
    )
    OR EXISTS (SELECT 1 FROM holding_position_continuities WHERE predecessor_position_id = NEW.position_id);
  SELECT RAISE(ABORT, 'automatic investment evidence stale') WHERE
    json_extract(NEW.expected_guard_json, '$.observationId') IS NOT (
      SELECT o.id FROM holding_import_applications a JOIN holding_import_rows r ON r.id = a.import_row_id
      JOIN holding_positions p ON p.id = a.position_id
      LEFT JOIN holding_import_row_provider_investments identity ON identity.import_row_id = r.id
      JOIN provider_legal_document_latest l ON l.household_id = p.household_id AND l.provider = p.provider AND l.position_fingerprint = r.position_fingerprint
      JOIN provider_legal_document_observations o ON o.id = l.observation_id
        AND (identity.provider_investment_id IS NULL OR json_extract(o.capture_json, '$.sourceInvestment.id') = identity.provider_investment_id)
      WHERE a.id = json_extract(NEW.expected_guard_json, '$.applicationId')
    ) OR EXISTS (
      SELECT 1 FROM json_each(NEW.expected_guard_json, '$.scans') expected
      LEFT JOIN private_document_scans s ON s.document_id = json_extract(expected.value, '$.id') AND s.household_id = NEW.household_id AND s.sha256 = json_extract(expected.value, '$.sha256')
      WHERE json_extract(expected.value, '$.scannedAt') IS NOT s.scanned_at OR json_extract(expected.value, '$.outcome') IS NOT s.outcome
    ) OR EXISTS (
      SELECT position_id || ':' || document_id || ':' || review_id FROM investment_document_assignments WHERE household_id = NEW.household_id AND target_position_id = NEW.position_id
      EXCEPT SELECT value FROM json_each(NEW.expected_guard_json, '$.incoming')
    ) OR EXISTS (
      SELECT value FROM json_each(NEW.expected_guard_json, '$.incoming')
      EXCEPT SELECT position_id || ':' || document_id || ':' || review_id FROM investment_document_assignments WHERE household_id = NEW.household_id AND target_position_id = NEW.position_id
    ) OR EXISTS (
      SELECT (SELECT id FROM holding_position_exposure_mappings WHERE position_id = root.position_id AND exposure_id = root.exposure_id ORDER BY version DESC LIMIT 1) FROM holding_position_exposure_mappings root INDEXED BY holding_position_exposure_mapping_roots_unique WHERE root.household_id = NEW.household_id AND root.position_id = NEW.position_id AND root.supersedes_mapping_id IS NULL
      EXCEPT SELECT value FROM json_each(NEW.expected_guard_json, '$.mappingIds')
    ) OR EXISTS (
      SELECT value FROM json_each(NEW.expected_guard_json, '$.mappingIds')
      EXCEPT SELECT (SELECT id FROM holding_position_exposure_mappings WHERE position_id = root.position_id AND exposure_id = root.exposure_id ORDER BY version DESC LIMIT 1) FROM holding_position_exposure_mappings root INDEXED BY holding_position_exposure_mapping_roots_unique WHERE root.household_id = NEW.household_id AND root.position_id = NEW.position_id AND root.supersedes_mapping_id IS NULL
    );
  -- A racing manual/automatic identity creation is an exception, never an
  -- invitation to merge two vehicles by their display labels.
  SELECT RAISE(ABORT, 'automatic investment identity stale') WHERE
    json_extract(NEW.details_json, '$.identity.legalName') IS NOT NULL AND EXISTS (
      SELECT 1 FROM legal_entity_versions WHERE household_id = NEW.household_id AND legal_name = json_extract(NEW.details_json, '$.identity.legalName')
    );
  SELECT RAISE(ABORT, 'automatic investment company stale') WHERE
    json_extract(NEW.details_json, '$.newCompany.legalName') IS NOT NULL AND EXISTS (
      SELECT 1 FROM companies WHERE household_id = NEW.household_id AND legal_name = json_extract(NEW.details_json, '$.newCompany.legalName')
    );
END;
CREATE TRIGGER automatic_investment_reviews_no_update BEFORE UPDATE ON automatic_investment_reviews
BEGIN SELECT RAISE(ABORT, 'automatic investment decisions are append only'); END;
CREATE TRIGGER automatic_investment_reviews_no_delete BEFORE DELETE ON automatic_investment_reviews
BEGIN SELECT RAISE(ABORT, 'automatic investment decisions are append only'); END;
