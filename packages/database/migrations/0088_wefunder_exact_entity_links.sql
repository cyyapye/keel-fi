-- Current-name lookup stays independent of append-only profile history.
CREATE TABLE legal_entity_name_heads (
  legal_entity_id TEXT PRIMARY KEY NOT NULL REFERENCES legal_entities(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  version_id TEXT UNIQUE NOT NULL REFERENCES legal_entity_versions(id),
  legal_name TEXT NOT NULL,
  entity_type TEXT NOT NULL
);
CREATE INDEX legal_entity_name_heads_household_name_idx
  ON legal_entity_name_heads(household_id, legal_name, legal_entity_id);

INSERT INTO legal_entity_name_heads
  SELECT v.legal_entity_id, v.household_id, v.id, v.legal_name, v.entity_type
  FROM legal_entities entity
  JOIN legal_entity_versions v ON v.id = (
    SELECT latest.id FROM legal_entity_versions latest
    WHERE latest.household_id = entity.household_id AND latest.legal_entity_id = entity.id
    ORDER BY latest.version DESC LIMIT 1
  );

CREATE TRIGGER legal_entity_name_heads_insert_guard BEFORE INSERT ON legal_entity_name_heads
BEGIN
  SELECT RAISE(ABORT, 'legal entity name head mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM legal_entity_versions v WHERE v.id = NEW.version_id
      AND v.household_id = NEW.household_id AND v.legal_entity_id = NEW.legal_entity_id
      AND v.legal_name = NEW.legal_name AND v.entity_type = NEW.entity_type
      AND NOT EXISTS (SELECT 1 FROM legal_entity_versions later WHERE later.supersedes_version_id = v.id)
  );
END;
CREATE TRIGGER legal_entity_name_heads_update_guard BEFORE UPDATE ON legal_entity_name_heads
BEGIN
  SELECT RAISE(ABORT, 'legal entity name head mismatch') WHERE
    OLD.legal_entity_id <> NEW.legal_entity_id OR OLD.household_id <> NEW.household_id OR NOT EXISTS (
      SELECT 1 FROM legal_entity_versions v WHERE v.id = NEW.version_id
        AND v.household_id = NEW.household_id AND v.legal_entity_id = NEW.legal_entity_id
        AND v.legal_name = NEW.legal_name AND v.entity_type = NEW.entity_type
        AND NOT EXISTS (SELECT 1 FROM legal_entity_versions later WHERE later.supersedes_version_id = v.id)
    );
END;
CREATE TRIGGER legal_entity_name_heads_no_delete BEFORE DELETE ON legal_entity_name_heads
BEGIN SELECT RAISE(ABORT, 'legal entity name heads cannot be deleted'); END;
CREATE TRIGGER legal_entity_name_heads_advance AFTER INSERT ON legal_entity_versions
BEGIN
  INSERT INTO legal_entity_name_heads VALUES
    (NEW.legal_entity_id, NEW.household_id, NEW.id, NEW.legal_name, NEW.entity_type)
  ON CONFLICT(legal_entity_id) DO UPDATE SET
    version_id = excluded.version_id, legal_name = excluded.legal_name, entity_type = excluded.entity_type;
END;

ALTER TABLE legal_entity_source_decisions ADD COLUMN automatic_review_id TEXT REFERENCES automatic_investment_reviews(id);

-- Existing-entity reuse is distinct from the original policy's new-entity path.
CREATE TRIGGER automatic_wefunder_existing_entity_guard BEFORE INSERT ON automatic_investment_reviews
WHEN json_type(NEW.details_json, '$.existingIdentity') IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'automatic Wefunder entity match stale') WHERE
    json_extract(NEW.details_json, '$.existingIdentity.policy') IS NOT 'wefunder-legal-entity-exact-v1'
    OR json_extract(NEW.expected_guard_json, '$.entityDecisionId') IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM holding_import_applications a
      JOIN holding_import_rows r ON r.id = a.import_row_id
      JOIN holding_imports i ON i.id = r.import_id
      JOIN legal_entity_name_heads h ON h.household_id = NEW.household_id AND h.legal_name = r.legal_vehicle_name
      WHERE a.id = json_extract(NEW.expected_guard_json, '$.applicationId')
        AND a.position_id = NEW.position_id AND i.household_id = NEW.household_id
        AND i.provider = 'wefunder' AND i.parser_schema = 'wefunder_keel_template_v1'
        AND h.legal_name = json_extract(NEW.details_json, '$.existingIdentity.legalName')
        AND h.legal_entity_id = json_extract(NEW.details_json, '$.existingIdentity.entityId')
        AND h.version_id = json_extract(NEW.details_json, '$.existingIdentity.entityVersionId')
        AND h.entity_type = json_extract(NEW.details_json, '$.existingIdentity.entityType')
        AND NOT EXISTS (SELECT 1 FROM legal_entity_name_heads other
          WHERE other.household_id = h.household_id AND other.legal_name = h.legal_name
            AND other.legal_entity_id <> h.legal_entity_id)
    )
    OR json_extract(NEW.result_guard_json, '$.entityDecisionId') IS NOT json_extract(NEW.details_json, '$.existingIdentity.sourceDecisionId')
    OR json_extract(NEW.result_guard_json, '$.entityVersionId') IS NOT json_extract(NEW.details_json, '$.existingIdentity.entityVersionId');
END;

CREATE TRIGGER legal_entity_automatic_link_receipt_guard BEFORE INSERT ON legal_entity_source_decisions
WHEN NEW.automatic_review_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'automatic Wefunder entity receipt mismatch') WHERE
    NEW.decision_source <> 'policy' OR NEW.decision <> 'linked' OR NEW.source_kind <> 'holding_position'
    OR NOT EXISTS (
      SELECT 1 FROM automatic_investment_reviews review
      JOIN legal_entity_name_heads h ON h.household_id = NEW.household_id AND h.legal_entity_id = NEW.legal_entity_id
      WHERE review.id = NEW.automatic_review_id AND review.household_id = NEW.household_id
        AND review.position_id = NEW.source_reference
        AND json_extract(review.details_json, '$.existingIdentity.sourceDecisionId') = NEW.id
        AND json_extract(review.details_json, '$.existingIdentity.entityId') = NEW.legal_entity_id
        AND json_extract(review.details_json, '$.existingIdentity.entityVersionId') = h.version_id
        AND json_extract(review.details_json, '$.existingIdentity.legalName') = h.legal_name
    );
END;

CREATE TRIGGER legal_entity_wefunder_policy_receipt_required BEFORE INSERT ON legal_entity_source_decisions
WHEN NEW.decision_source = 'policy' AND NEW.source_label = 'Wefunder template'
BEGIN
  SELECT RAISE(ABORT, 'automatic Wefunder entity receipt required')
  WHERE NEW.automatic_review_id IS NULL;
END;

-- Direct Wefunder holdings use only the existing-identity section. The broader
-- company, fee and new-entity policies retain their previous scope.
CREATE TRIGGER automatic_wefunder_direct_identity_guard BEFORE INSERT ON automatic_investment_reviews
WHEN EXISTS (SELECT 1 FROM holding_positions p WHERE p.id = NEW.position_id AND p.position_kind = 'direct')
BEGIN
  SELECT RAISE(ABORT, 'automatic direct identity scope mismatch') WHERE
    EXISTS (SELECT 1 FROM json_each(NEW.details_json) WHERE key <> 'existingIdentity')
    OR EXISTS (SELECT 1 FROM json_each(NEW.summary_json, '$.resolved') WHERE value <> 'identity')
    OR EXISTS (SELECT 1 FROM json_each(NEW.summary_json, '$.issues') WHERE json_extract(value, '$.section') <> 'identity');
END;

-- Preserve all existing revision, document, mapping and creation guards.
DROP TRIGGER automatic_investment_reviews_guard;
CREATE TRIGGER automatic_investment_reviews_guard BEFORE INSERT ON automatic_investment_reviews
BEGIN
  SELECT RAISE(ABORT, 'automatic investment scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p JOIN households h ON h.id = p.household_id
    WHERE p.id = NEW.position_id AND p.household_id = NEW.household_id AND h.owner_user_id = NEW.recorded_by_user_id
      AND (p.position_kind <> 'direct' OR p.provider = 'wefunder')
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
