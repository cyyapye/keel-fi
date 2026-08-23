-- Reuse a reviewed private-company identity when an accepted provider row
-- reports that one company name exactly. This never creates a company from
-- provider text and never reactivates a previously withdrawn company mapping.
CREATE TABLE exact_reviewed_private_exposure_candidates_v1 (
  position_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  relationship_kind TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  recorded_by_user_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

INSERT INTO exact_reviewed_private_exposure_candidates_v1 (
  position_id,
  household_id,
  company_id,
  company_name,
  relationship_kind,
  evidence_sha256,
  recorded_by_user_id,
  recorded_at
)
SELECT
  position.id,
  position.household_id,
  company.id,
  company.legal_name,
  CASE
    WHEN position.position_kind = 'direct' THEN 'direct'
    ELSE 'look_through'
  END,
  document.sha256,
  household.owner_user_id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM holding_positions position
JOIN households household ON household.id = position.household_id
JOIN holding_import_applications application
  ON application.id = (
    SELECT latest.id
    FROM holding_import_applications latest
    WHERE latest.position_id = position.id
    ORDER BY latest.applied_at DESC, latest.id DESC
    LIMIT 1
  )
JOIN holding_position_snapshots snapshot
  ON snapshot.id = application.snapshot_id
 AND snapshot.position_id = position.id
JOIN source_documents document ON document.id = snapshot.source_document_id
JOIN holding_position_exposures reported
  ON reported.position_id = position.id
 AND reported.exposure_label IS NOT NULL
JOIN companies company
  ON company.household_id = position.household_id
 AND lower(trim(company.legal_name)) = lower(trim(reported.exposure_label))
WHERE position.provider IN ('angellist', 'tokenfolio', 'sydecar')
  AND position.position_kind IN ('direct', 'spv_interest')
  AND (
    position.position_kind = 'direct'
    OR lower(trim(reported.exposure_label)) <>
       lower(trim(position.legal_vehicle_name))
  )
  AND (
    SELECT COUNT(*)
    FROM holding_position_exposures reported_count
    WHERE reported_count.position_id = position.id
      AND reported_count.exposure_label IS NOT NULL
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM companies company_count
    WHERE company_count.household_id = position.household_id
      AND lower(trim(company_count.legal_name)) =
          lower(trim(reported.exposure_label))
  ) = 1
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings mapping
    JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
    WHERE mapping.position_id = position.id
      AND mapping.household_id = position.household_id
      AND mapping.status = 'active'
      AND exposure.exposure_kind <> 'unresolved'
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = mapping.id
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings prior_company_mapping
    JOIN canonical_exposures prior_company_exposure
      ON prior_company_exposure.id = prior_company_mapping.exposure_id
    WHERE prior_company_mapping.position_id = position.id
      AND prior_company_exposure.company_id = company.id
  );

INSERT INTO canonical_exposures (
  id,
  household_id,
  exposure_kind,
  canonical_name,
  protected_identity_key,
  company_id,
  resolution_method,
  evidence_sha256,
  created_by_user_id,
  created_at,
  immutable
)
SELECT
  'canonical-private-exact-reviewed-v1:' || candidate.company_id,
  candidate.household_id,
  'private_company',
  candidate.company_name,
  NULL,
  candidate.company_id,
  'reviewed_company',
  min(candidate.evidence_sha256),
  candidate.recorded_by_user_id,
  min(candidate.recorded_at),
  1
FROM exact_reviewed_private_exposure_candidates_v1 candidate
WHERE NOT EXISTS (
  SELECT 1
  FROM canonical_exposures existing
  WHERE existing.company_id = candidate.company_id
)
GROUP BY
  candidate.household_id,
  candidate.company_id,
  candidate.company_name,
  candidate.recorded_by_user_id;

INSERT INTO holding_position_exposure_mappings (
  id,
  household_id,
  position_id,
  exposure_id,
  relationship_kind,
  allocation_ppm,
  status,
  decision_source,
  decision_reference,
  evidence_sha256,
  effective_at,
  version,
  supersedes_mapping_id,
  accepted_by_user_id,
  accepted_at,
  immutable
)
SELECT
  'mapping-private-exact-reviewed-v1:withdraw:' || mapping.id,
  candidate.household_id,
  candidate.position_id,
  mapping.exposure_id,
  mapping.relationship_kind,
  NULL,
  'withdrawn',
  'deterministic_policy',
  'private-company-exact-reviewed-v1',
  candidate.evidence_sha256,
  CASE
    WHEN mapping.effective_at > candidate.recorded_at
      THEN mapping.effective_at
    ELSE candidate.recorded_at
  END,
  mapping.version + 1,
  mapping.id,
  candidate.recorded_by_user_id,
  candidate.recorded_at,
  1
FROM exact_reviewed_private_exposure_candidates_v1 candidate
JOIN holding_position_exposure_mappings mapping
  ON mapping.position_id = candidate.position_id
JOIN canonical_exposures unresolved
  ON unresolved.id = mapping.exposure_id
 AND unresolved.exposure_kind = 'unresolved'
WHERE mapping.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings later
    WHERE later.supersedes_mapping_id = mapping.id
  );

INSERT INTO holding_position_exposure_mappings (
  id,
  household_id,
  position_id,
  exposure_id,
  relationship_kind,
  allocation_ppm,
  status,
  decision_source,
  decision_reference,
  evidence_sha256,
  effective_at,
  version,
  supersedes_mapping_id,
  accepted_by_user_id,
  accepted_at,
  immutable
)
SELECT
  'mapping-private-exact-reviewed-v1:' || candidate.position_id,
  candidate.household_id,
  candidate.position_id,
  exposure.id,
  candidate.relationship_kind,
  1000000,
  'active',
  'deterministic_policy',
  'private-company-exact-reviewed-v1',
  candidate.evidence_sha256,
  candidate.recorded_at,
  1,
  NULL,
  candidate.recorded_by_user_id,
  candidate.recorded_at,
  1
FROM exact_reviewed_private_exposure_candidates_v1 candidate
JOIN canonical_exposures exposure
  ON exposure.id = (
    SELECT existing.id
    FROM canonical_exposures existing
    WHERE existing.company_id = candidate.company_id
    ORDER BY existing.id DESC
    LIMIT 1
  );

DROP TABLE exact_reviewed_private_exposure_candidates_v1;
