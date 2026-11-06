PRAGMA defer_foreign_keys = ON;

DROP TRIGGER automatic_investment_reviews_guard;
DROP TRIGGER automatic_wefunder_existing_entity_guard;
DROP TRIGGER holding_import_accepted_price;
DROP TRIGGER holding_import_application_head;
DROP TRIGGER holding_import_applications_integrity_insert;
DROP TRIGGER holding_import_historical_rename_policy_guard;
DROP TRIGGER holding_import_late_price;
DROP TRIGGER holding_import_provider_investment_scope;
DROP TRIGGER holding_import_quarantines_integrity_insert;
DROP TRIGGER holding_import_rename_alias_guard;
DROP TRIGGER holding_import_row_containers_coverage_insert;
DROP TRIGGER holding_import_row_containers_integrity_insert;
DROP TRIGGER holding_import_row_decisions_integrity_insert;
DROP TRIGGER holding_import_row_provider_exposure_evidence_integrity_insert;
DROP TRIGGER holding_import_row_public_exposure_evidence_integrity_insert;
DROP TRIGGER holding_import_row_reported_economics_integrity_insert;
DROP TRIGGER holding_import_row_structured_asset_exposure_evidence_integrity_insert;
DROP TRIGGER holding_import_rows_exposure_identity_insert;
DROP TRIGGER holding_import_rows_integrity_insert;
DROP TRIGGER holding_import_rows_no_delete;
DROP TRIGGER holding_import_rows_no_update;
DROP TRIGGER holding_import_share_prices_guard;
DROP TRIGGER holding_investment_amount_correction_guard;
DROP TRIGGER holding_investment_review_guard;
DROP TRIGGER holding_investment_reviews_evidence_guard;
DROP TRIGGER holding_position_continuities_integrity_insert;
DROP TRIGGER holding_position_continuities_unique_candidate_insert;
DROP TRIGGER holding_position_economics_proposals_integrity_insert;
DROP TRIGGER holding_position_link_guard;
DROP TRIGGER holding_position_rename_guard;
DROP TRIGGER holding_position_same_investment_guard;
DROP TRIGGER holding_position_snapshots_integrity_insert;
DROP TRIGGER holding_position_snapshots_no_delete;
DROP TRIGGER holding_position_snapshots_no_update;
DROP TRIGGER holding_position_value_proposals_integrity_insert;
DROP TRIGGER holding_purchase_price_evidence_guard;
DROP TRIGGER holding_purchase_review_guard;
DROP TRIGGER holding_purchase_unified_guard;
DROP TRIGGER holding_selected_valuation_guard;
DROP TRIGGER investment_company_review_guard;
DROP TRIGGER investment_company_reviews_evidence_guard;
DROP TRIGGER portfolio_baseline_items_integrity_insert;
DROP TRIGGER portfolio_baseline_items_no_delete;
DROP TRIGGER portfolio_baseline_items_no_update;
DROP TRIGGER private_holding_policy_stale_insert;
DROP VIEW holding_position_continuity_candidates_v1;
DROP VIEW holding_position_continuity_evidence_v1;

CREATE TABLE holding_import_rows_manual_nullable (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  import_id TEXT NOT NULL REFERENCES holding_imports(id) ON DELETE RESTRICT,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  position_fingerprint TEXT NOT NULL CHECK (
    length(position_fingerprint) = 64
    AND position_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  snapshot_fingerprint TEXT NOT NULL CHECK (
    length(snapshot_fingerprint) = 64
    AND snapshot_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  legal_vehicle_name TEXT NOT NULL CHECK (
    length(legal_vehicle_name) BETWEEN 1 AND 1000
  ),
  owner_label TEXT NOT NULL CHECK (length(owner_label) BETWEEN 1 AND 1000),
  exposure_label TEXT NOT NULL CHECK (length(exposure_label) BETWEEN 1 AND 1000),
  provider_status TEXT NOT NULL CHECK (
    provider_status IN ('live', 'realized')
  ),
  invested_on TEXT CHECK (
    invested_on IS NULL OR
    invested_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  invested_on_state TEXT NOT NULL DEFAULT 'reported' CHECK (
    invested_on_state IN ('reported', 'not_reported')
  ),
  invested_minor INTEGER CHECK (invested_minor >= 0),
  allocation_minor INTEGER CHECK (allocation_minor >= 0),
  unrealized_value_minor INTEGER CHECK (unrealized_value_minor >= 0),
  unrealized_value_state TEXT NOT NULL CHECK (
    unrealized_value_state IN ('reported', 'locked', 'not_reported')
  ),
  realized_value_minor INTEGER CHECK (realized_value_minor >= 0),
  net_value_minor INTEGER CHECK (net_value_minor >= 0),
  net_value_state TEXT NOT NULL CHECK (
    net_value_state IN ('reported', 'locked', 'not_reported')
  ),
  instrument_type TEXT NOT NULL CHECK (length(instrument_type) BETWEEN 1 AND 1000),
  currency_hint TEXT CHECK (
    currency_hint IS NULL OR (
      length(currency_hint) = 3 AND currency_hint = upper(currency_hint)
    )
  ),
  parse_status TEXT NOT NULL CHECK (
    parse_status IN ('ready', 'needs_attention')
  ),
  issue_codes_json TEXT NOT NULL CHECK (json_valid(issue_codes_json)),
  created_at TEXT NOT NULL,
  position_kind TEXT NOT NULL DEFAULT 'spv_interest' CHECK (
    position_kind IN ('direct', 'spv_interest', 'fund_interest')
  ),
  quantity_micros INTEGER CHECK (
    quantity_micros IS NULL OR quantity_micros >= 0
  ),
  ticker TEXT CHECK (
    ticker IS NULL OR length(ticker) BETWEEN 1 AND 32
  ),
  cost_basis_minor INTEGER CHECK (
    cost_basis_minor IS NULL OR cost_basis_minor >= 0
  ),
  public_exposure_identity_kind TEXT CHECK (
    public_exposure_identity_kind IS NULL
    OR public_exposure_identity_kind IN ('cusip', 'isin', 'sedol')
  ),
  protected_exposure_key TEXT CHECK (
    protected_exposure_key IS NULL OR (
      length(protected_exposure_key) = 64
      AND protected_exposure_key NOT GLOB '*[^0-9a-f]*'
    )
  ),
  UNIQUE (import_id, source_row_number),
  CHECK (
    (invested_on_state = 'reported' AND invested_on IS NOT NULL)
    OR
    (invested_on_state = 'not_reported' AND invested_on IS NULL)
  ),
  CHECK (
    (unrealized_value_state = 'reported' AND unrealized_value_minor IS NOT NULL)
    OR
    (unrealized_value_state <> 'reported' AND unrealized_value_minor IS NULL)
  ),
  CHECK (
    (net_value_state = 'reported' AND net_value_minor IS NOT NULL)
    OR
    (net_value_state <> 'reported' AND net_value_minor IS NULL)
  )
);
INSERT INTO holding_import_rows_manual_nullable (id, household_id, import_id, source_row_number, position_fingerprint, snapshot_fingerprint, legal_vehicle_name, owner_label, exposure_label, provider_status, invested_on, invested_on_state, invested_minor, allocation_minor, unrealized_value_minor, unrealized_value_state, realized_value_minor, net_value_minor, net_value_state, instrument_type, currency_hint, parse_status, issue_codes_json, created_at, position_kind, quantity_micros, ticker, cost_basis_minor, public_exposure_identity_kind, protected_exposure_key) SELECT id, household_id, import_id, source_row_number, position_fingerprint, snapshot_fingerprint, legal_vehicle_name, owner_label, exposure_label, provider_status, invested_on, invested_on_state, invested_minor, allocation_minor, unrealized_value_minor, unrealized_value_state, realized_value_minor, net_value_minor, net_value_state, instrument_type, currency_hint, parse_status, issue_codes_json, created_at, position_kind, quantity_micros, ticker, cost_basis_minor, public_exposure_identity_kind, protected_exposure_key FROM holding_import_rows;
DROP TABLE holding_import_rows;
ALTER TABLE holding_import_rows_manual_nullable RENAME TO holding_import_rows;

CREATE INDEX holding_import_rows_position_idx
  ON holding_import_rows(household_id, position_fingerprint);
CREATE INDEX holding_import_rows_protected_exposure_idx
  ON holding_import_rows(household_id, protected_exposure_key)
  WHERE protected_exposure_key IS NOT NULL;

CREATE TABLE holding_position_snapshots_manual_nullable (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  source_document_id TEXT NOT NULL
    REFERENCES source_documents(id) ON DELETE RESTRICT,
  source_import_row_id TEXT NOT NULL UNIQUE
    REFERENCES holding_import_rows(id) ON DELETE RESTRICT,
  snapshot_fingerprint TEXT NOT NULL CHECK (
    length(snapshot_fingerprint) = 64
    AND snapshot_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  provider_status TEXT NOT NULL CHECK (
    provider_status IN ('live', 'realized')
  ),
  invested_minor INTEGER CHECK (invested_minor >= 0),
  allocation_minor INTEGER CHECK (allocation_minor >= 0),
  unrealized_value_minor INTEGER CHECK (unrealized_value_minor >= 0),
  unrealized_value_state TEXT NOT NULL CHECK (
    unrealized_value_state IN ('reported', 'locked', 'not_reported')
  ),
  realized_value_minor INTEGER CHECK (realized_value_minor >= 0),
  net_value_minor INTEGER CHECK (net_value_minor >= 0),
  net_value_state TEXT NOT NULL CHECK (
    net_value_state IN ('reported', 'locked', 'not_reported')
  ),
  instrument_type TEXT NOT NULL CHECK (length(instrument_type) BETWEEN 1 AND 1000),
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND currency = upper(currency)
  ),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL, quantity_micros INTEGER CHECK (
    quantity_micros IS NULL OR quantity_micros >= 0
  ), ticker TEXT CHECK (
    ticker IS NULL OR length(ticker) BETWEEN 1 AND 32
  ), cost_basis_minor INTEGER CHECK (
    cost_basis_minor IS NULL OR cost_basis_minor >= 0
  ),
  UNIQUE (position_id, snapshot_fingerprint),
  CHECK (
    (unrealized_value_state = 'reported' AND unrealized_value_minor IS NOT NULL)
    OR
    (unrealized_value_state <> 'reported' AND unrealized_value_minor IS NULL)
  ),
  CHECK (
    (net_value_state = 'reported' AND net_value_minor IS NOT NULL)
    OR
    (net_value_state <> 'reported' AND net_value_minor IS NULL)
  )
);
INSERT INTO holding_position_snapshots_manual_nullable (id, household_id, position_id, source_document_id, source_import_row_id, snapshot_fingerprint, provider_status, invested_minor, allocation_minor, unrealized_value_minor, unrealized_value_state, realized_value_minor, net_value_minor, net_value_state, instrument_type, currency, observed_at, created_at, quantity_micros, ticker, cost_basis_minor) SELECT id, household_id, position_id, source_document_id, source_import_row_id, snapshot_fingerprint, provider_status, invested_minor, allocation_minor, unrealized_value_minor, unrealized_value_state, realized_value_minor, net_value_minor, net_value_state, instrument_type, currency, observed_at, created_at, quantity_micros, ticker, cost_basis_minor FROM holding_position_snapshots;
DROP TABLE holding_position_snapshots;
ALTER TABLE holding_position_snapshots_manual_nullable RENAME TO holding_position_snapshots;

CREATE INDEX holding_position_snapshots_observed_idx
  ON holding_position_snapshots(position_id, observed_at DESC, created_at DESC);

CREATE TABLE portfolio_baseline_items_manual_nullable (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  baseline_id TEXT NOT NULL
    REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL
    REFERENCES holding_positions(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (
    provider IN (
      'angellist', 'tokenfolio', 'sydecar', 'wefunder', 'manual', 'plaid_investments'
    )
  ),
  classification TEXT NOT NULL CHECK (
    classification IN ('public_market', 'private_paper')
  ),
  value_minor INTEGER CHECK (value_minor IS NULL OR value_minor >= 0),
  value_state TEXT NOT NULL CHECK (
    value_state IN ('reported', 'locked', 'not_reported')
  ),
  observed_at TEXT NOT NULL,
  duplicate_key TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (baseline_id, position_id),
  CHECK (
    (provider = 'plaid_investments' AND classification = 'public_market')
    OR (
      provider IN ('angellist', 'tokenfolio', 'sydecar', 'wefunder', 'manual')
      AND classification = 'private_paper'
    )
  ),
  CHECK (
    (value_state = 'reported' AND value_minor IS NOT NULL)
    OR (value_state <> 'reported' AND value_minor IS NULL)
  )
);
INSERT INTO portfolio_baseline_items_manual_nullable (id, household_id, baseline_id, position_id, snapshot_id, provider, classification, value_minor, value_state, observed_at, duplicate_key, created_at) SELECT id, household_id, baseline_id, position_id, snapshot_id, provider, classification, value_minor, value_state, observed_at, duplicate_key, created_at FROM portfolio_baseline_items;
DROP TABLE portfolio_baseline_items;
ALTER TABLE portfolio_baseline_items_manual_nullable RENAME TO portfolio_baseline_items;


CREATE VIEW holding_position_continuity_candidates_v1 AS
SELECT candidate.*
FROM holding_position_continuity_evidence_v1 candidate
WHERE (
  SELECT COUNT(*) FROM (
    SELECT 1 FROM holding_position_continuity_evidence_v1 other
    WHERE other.household_id = candidate.household_id
      AND other.provider = candidate.provider
      AND other.normalized_legal_vehicle_name = candidate.normalized_legal_vehicle_name
      AND other.predecessor_position_id = candidate.predecessor_position_id
    LIMIT 2
  )
) = 1
AND (
  SELECT COUNT(*) FROM (
    SELECT 1 FROM holding_position_continuity_evidence_v1 other
    WHERE other.household_id = candidate.household_id
      AND other.provider = candidate.provider
      AND other.normalized_legal_vehicle_name = candidate.normalized_legal_vehicle_name
      AND other.successor_position_id = candidate.successor_position_id
    LIMIT 2
  )
) = 1;

CREATE VIEW holding_position_continuity_evidence_v1 AS
WITH latest_positions AS NOT MATERIALIZED (
  SELECT
    position.id AS position_id,
    position.household_id,
    position.provider,
    position.legal_vehicle_name,
    position.position_kind,
    connection.id AS connection_id,
    connection.adapter_type,
    container_version.display_label AS container_label,
    snapshot.id AS snapshot_id,
    snapshot.provider_status,
    snapshot.invested_minor,
    snapshot.allocation_minor,
    snapshot.instrument_type,
    snapshot.currency,
    snapshot.quantity_micros,
    snapshot.ticker,
    snapshot.cost_basis_minor,
    snapshot.observed_at,
    row.exposure_label,
    row.invested_on,
    COALESCE(
      row.protected_exposure_key,
      retained.protected_identity_key
    ) AS strong_identity_key,
    application.applied_at
  FROM holding_positions position
  JOIN holding_position_ownerships ownership
    ON ownership.position_id = position.id
   AND NOT EXISTS (
     SELECT 1
     FROM holding_position_ownerships later_ownership
     WHERE later_ownership.supersedes_ownership_id = ownership.id
   )
  JOIN ownership_containers container ON container.id = ownership.container_id
  JOIN ownership_container_versions container_version
    ON container_version.container_id = container.id
   AND NOT EXISTS (
     SELECT 1
     FROM ownership_container_versions later_container_version
     WHERE later_container_version.supersedes_version_id =
           container_version.id
   )
  JOIN investment_connections connection
    ON connection.id = container.connection_id
  JOIN holding_import_applications application
    ON application.id = (
      SELECT candidate.id
      FROM holding_import_applications candidate
      JOIN holding_position_snapshots candidate_snapshot
        ON candidate_snapshot.id = candidate.snapshot_id
      WHERE candidate.position_id = position.id
      ORDER BY candidate.applied_at DESC,
               candidate_snapshot.observed_at DESC,
               candidate.id DESC
      LIMIT 1
    )
  JOIN holding_position_snapshots snapshot
    ON snapshot.id = application.snapshot_id
  JOIN holding_import_rows row ON row.id = application.import_row_id
  LEFT JOIN holding_import_row_public_exposure_evidence retained
    ON retained.import_row_id = row.id
   AND retained.resolution_status = 'strong_identifier'
  WHERE position.provider IN (
      'plaid_investments', 'angellist', 'tokenfolio', 'sydecar'
    )
), candidate_pairs AS (
  SELECT
    predecessor.household_id,
    predecessor.provider,
    lower(trim(predecessor.legal_vehicle_name)) AS normalized_legal_vehicle_name,
    predecessor.position_id AS predecessor_position_id,
    predecessor.snapshot_id AS predecessor_snapshot_id,
    successor.position_id AS successor_position_id,
    successor.snapshot_id AS successor_snapshot_id,
    successor.applied_at AS recorded_at
  FROM latest_positions predecessor
  JOIN latest_positions successor
    ON successor.household_id = predecessor.household_id
   AND successor.provider = predecessor.provider
   AND lower(trim(successor.legal_vehicle_name)) =
       lower(trim(predecessor.legal_vehicle_name))
   AND successor.connection_id NOT LIKE
       'reconciled-holding-connection-v1:%'
   AND (
     (
       predecessor.provider_status = 'live'
       AND successor.provider_status = 'live'
       AND predecessor.provider = 'plaid_investments'
       AND successor.provider = 'plaid_investments'
       AND predecessor.position_kind = 'direct'
       AND successor.position_kind = 'direct'
       AND predecessor.adapter_type = 'plaid-investments'
       AND successor.adapter_type = 'plaid-investments'
       AND lower(trim(successor.legal_vehicle_name)) =
           lower(trim(predecessor.legal_vehicle_name))
       AND lower(trim(successor.container_label)) =
           lower(trim(predecessor.container_label))
       AND lower(trim(successor.instrument_type)) =
           lower(trim(predecessor.instrument_type))
       AND successor.currency = predecessor.currency
       AND successor.ticker IS NOT NULL
       AND predecessor.ticker IS NOT NULL
       AND upper(trim(successor.ticker)) = upper(trim(predecessor.ticker))
       AND successor.quantity_micros IS NOT NULL
       AND successor.quantity_micros = predecessor.quantity_micros
       AND successor.cost_basis_minor IS NOT NULL
       AND successor.cost_basis_minor = predecessor.cost_basis_minor
       AND (
         successor.strong_identity_key IS NULL
         OR predecessor.strong_identity_key IS NULL
         OR successor.strong_identity_key = predecessor.strong_identity_key
       )
       AND successor.observed_at > predecessor.observed_at
     )
     OR
     (
       predecessor.provider IN ('angellist', 'tokenfolio', 'sydecar')
       AND successor.provider = predecessor.provider
       AND successor.adapter_type = predecessor.adapter_type
       AND successor.position_kind = predecessor.position_kind
       AND lower(trim(successor.legal_vehicle_name)) =
           lower(trim(predecessor.legal_vehicle_name))
       AND lower(trim(successor.container_label)) =
           lower(trim(predecessor.container_label))
       AND lower(trim(successor.exposure_label)) =
           lower(trim(predecessor.exposure_label))
       AND successor.invested_on IS predecessor.invested_on
       AND lower(trim(successor.instrument_type)) =
           lower(trim(predecessor.instrument_type))
       AND successor.currency = predecessor.currency




       AND (
         predecessor.invested_on IS NOT NULL
         OR (
           successor.invested_minor = predecessor.invested_minor
           AND successor.allocation_minor = predecessor.allocation_minor
         )
       )
       AND (
         successor.observed_at > predecessor.observed_at
         OR (
           successor.observed_at = predecessor.observed_at
           AND successor.applied_at > predecessor.applied_at
         )
       )
     )
   )
  WHERE predecessor.connection_id LIKE
        'reconciled-holding-connection-v1:%'
    AND NOT EXISTS (
      SELECT 1
      FROM holding_position_continuities existing
      WHERE existing.predecessor_position_id = predecessor.position_id
         OR existing.successor_position_id = successor.position_id
    )
)
SELECT * FROM candidate_pairs;

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


  SELECT RAISE(ABORT, 'automatic investment identity stale') WHERE
    json_extract(NEW.details_json, '$.identity.legalName') IS NOT NULL AND EXISTS (
      SELECT 1 FROM legal_entity_versions WHERE household_id = NEW.household_id AND legal_name = json_extract(NEW.details_json, '$.identity.legalName')
    );
  SELECT RAISE(ABORT, 'automatic investment company stale') WHERE
    json_extract(NEW.details_json, '$.newCompany.legalName') IS NOT NULL AND EXISTS (
      SELECT 1 FROM companies WHERE household_id = NEW.household_id AND legal_name = json_extract(NEW.details_json, '$.newCompany.legalName')
    );
END;

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

CREATE TRIGGER holding_import_accepted_price AFTER INSERT ON holding_import_applications BEGIN
  INSERT OR IGNORE INTO holding_price_quotes(id,household_id,source_position_id,import_row_id,review_id,price_micros,price_date,share_class,basis_json,source_label,source_url,observed_at,accepted_at,decision_policy)
SELECT 'import:'||e.import_row_id,e.household_id,a.position_id,e.import_row_id,NULL,
  json_extract(e.evidence_json,'$.markMicros'),json_extract(e.evidence_json,'$.markDate'),
  json_extract(e.evidence_json,'$.shareClass'),json_extract(e.evidence_json,'$.shareBasis'),
  (CASE i.provider WHEN 'tokenfolio' THEN 'Tokenfolio' WHEN 'sydecar' THEN 'Sydecar' ELSE i.provider END),
  NULL,i.created_at,a.applied_at,'accepted-import-price-v1'
FROM holding_import_share_prices e JOIN holding_import_applications a ON a.import_row_id=e.import_row_id
JOIN holding_import_rows r ON r.id=e.import_row_id JOIN holding_imports i ON i.id=r.import_id
WHERE json_extract(e.evidence_json,'$.markMicros') > 0 AND a.id=NEW.id;
END;

CREATE TRIGGER holding_import_application_head AFTER INSERT ON holding_import_applications BEGIN
  INSERT INTO holding_import_application_heads(position_id,application_id,snapshot_id,applied_at,observed_at)
  SELECT NEW.position_id,NEW.id,NEW.snapshot_id,NEW.applied_at,s.observed_at FROM holding_position_snapshots s WHERE s.id=NEW.snapshot_id
  ON CONFLICT(position_id) DO UPDATE SET application_id=excluded.application_id,snapshot_id=excluded.snapshot_id,applied_at=excluded.applied_at,observed_at=excluded.observed_at
    WHERE (excluded.applied_at,excluded.observed_at,excluded.application_id)>(applied_at,observed_at,application_id);
END;

CREATE TRIGGER holding_import_applications_integrity_insert
BEFORE INSERT ON holding_import_applications
BEGIN
  SELECT RAISE(ABORT, 'holding import application mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_row_decisions decision
    JOIN holding_position_snapshots snapshot ON snapshot.id = NEW.snapshot_id
    JOIN holding_positions position ON position.id = NEW.position_id
    JOIN households household ON household.id = NEW.household_id
    WHERE decision.id = NEW.decision_id
      AND decision.import_row_id = NEW.import_row_id
      AND decision.household_id = NEW.household_id
      AND decision.decision = 'accepted'
      AND snapshot.position_id = NEW.position_id
      AND snapshot.household_id = NEW.household_id
      AND snapshot.snapshot_fingerprint = (
        SELECT row.snapshot_fingerprint
        FROM holding_import_rows row
        WHERE row.id = NEW.import_row_id
      )
      AND position.household_id = NEW.household_id
      AND household.owner_user_id = NEW.applied_by
  );
END;

CREATE TRIGGER holding_import_historical_rename_policy_guard BEFORE INSERT ON holding_import_row_decisions
WHEN NEW.decision_source='policy' AND NEW.decision='accepted' BEGIN
  SELECT RAISE(ABORT,'historical renamed investment requires review') WHERE EXISTS(
    SELECT 1 FROM holding_position_link_heads link JOIN holding_position_link_reviews r ON r.id=link.review_id
    JOIN holding_position_snapshots prior ON prior.id=r.target_snapshot_id
    JOIN holding_import_rows row ON row.id=NEW.import_row_id
    WHERE link.household_id=NEW.household_id AND link.target_position_id=NEW.matched_position_id AND link.state='linked' AND r.company_renamed=1
      AND prior.provider_status='realized' AND (row.provider_status<>'realized' OR row.invested_minor<>prior.invested_minor OR row.allocation_minor<>prior.allocation_minor)
  );
END;

CREATE TRIGGER holding_import_late_price AFTER INSERT ON holding_import_share_prices BEGIN
  INSERT OR IGNORE INTO holding_price_quotes(id,household_id,source_position_id,import_row_id,review_id,price_micros,price_date,share_class,basis_json,source_label,source_url,observed_at,accepted_at,decision_policy)
SELECT 'import:'||e.import_row_id,e.household_id,a.position_id,e.import_row_id,NULL,
  json_extract(e.evidence_json,'$.markMicros'),json_extract(e.evidence_json,'$.markDate'),
  json_extract(e.evidence_json,'$.shareClass'),json_extract(e.evidence_json,'$.shareBasis'),
  (CASE i.provider WHEN 'tokenfolio' THEN 'Tokenfolio' WHEN 'sydecar' THEN 'Sydecar' ELSE i.provider END),
  NULL,i.created_at,a.applied_at,'accepted-import-price-v1'
FROM holding_import_share_prices e JOIN holding_import_applications a ON a.import_row_id=e.import_row_id
JOIN holding_import_rows r ON r.id=e.import_row_id JOIN holding_imports i ON i.id=r.import_id
WHERE json_extract(e.evidence_json,'$.markMicros') > 0 AND e.import_row_id=NEW.import_row_id;
END;

CREATE TRIGGER holding_import_provider_investment_scope BEFORE INSERT ON holding_import_row_provider_investments
BEGIN
  SELECT RAISE(ABORT, 'provider investment row scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_import_rows WHERE id = NEW.import_row_id AND household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_import_quarantines_integrity_insert
BEFORE INSERT ON holding_import_quarantines
BEGIN
  SELECT RAISE(ABORT, 'holding import quarantine import mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM holding_imports import
    WHERE import.id = NEW.import_id AND import.household_id = NEW.household_id
  );
  SELECT RAISE(ABORT, 'holding import quarantine row mismatch')
  WHERE NEW.import_row_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM holding_import_rows row
    WHERE row.id = NEW.import_row_id AND row.import_id = NEW.import_id
      AND row.household_id = NEW.household_id
  );
  SELECT RAISE(ABORT, 'holding import quarantine position mismatch')
  WHERE NEW.position_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM holding_positions position
    JOIN holding_imports import ON import.id = NEW.import_id
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
      AND position.provider = import.provider
  );
END;

CREATE TRIGGER holding_import_rename_alias_guard BEFORE INSERT ON holding_import_rename_aliases BEGIN
  SELECT RAISE(ABORT,'position link rename alias stale') WHERE NOT EXISTS(
    SELECT 1 FROM holding_position_link_reviews r JOIN holding_position_link_heads h ON h.review_id=r.id AND h.state='linked'
    JOIN holding_import_rows row ON row.id=NEW.import_row_id AND row.household_id=r.household_id
    WHERE r.id=NEW.rename_review_id AND r.household_id=NEW.household_id AND r.company_renamed=1 AND r.target_position_id=NEW.target_position_id
  );
END;

CREATE TRIGGER holding_import_row_containers_coverage_insert
BEFORE INSERT ON holding_import_row_containers
BEGIN
  SELECT RAISE(ABORT, 'holding import row coverage missing')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_import_coverages coverage
      ON coverage.import_id = row.import_id
     AND coverage.container_id = NEW.container_id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND coverage.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_import_row_containers_integrity_insert
BEFORE INSERT ON holding_import_row_containers
BEGIN
  SELECT RAISE(ABORT, 'holding import row container mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_import_connections source ON source.import_id = row.import_id
    JOIN ownership_containers container ON container.id = NEW.container_id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND source.household_id = NEW.household_id
      AND container.household_id = NEW.household_id
      AND container.connection_id = source.connection_id
  );
END;

CREATE TRIGGER holding_import_row_decisions_integrity_insert
BEFORE INSERT ON holding_import_row_decisions
BEGIN
  SELECT RAISE(ABORT, 'holding import decision household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN households household ON household.id = row.household_id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND row.snapshot_fingerprint = NEW.reviewed_snapshot_fingerprint
      AND household.owner_user_id = NEW.reviewer_user_id
  );
  SELECT RAISE(ABORT, 'holding import decision position mismatch')
  WHERE NEW.matched_position_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM holding_positions position
    WHERE position.id = NEW.matched_position_id
      AND position.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_import_row_provider_exposure_evidence_integrity_insert
BEFORE INSERT ON holding_import_row_provider_exposure_evidence
BEGIN
  SELECT RAISE(ABORT, 'provider-scoped exposure evidence provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_imports import ON import.id = row.import_id
    JOIN source_documents document ON document.id = import.source_document_id
    JOIN holding_import_applications application
      ON application.import_row_id = row.id
    JOIN holding_positions position ON position.id = application.position_id
    JOIN households household ON household.id = row.household_id
    JOIN holding_import_row_public_exposure_evidence public_evidence
      ON public_evidence.import_row_id = row.id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND import.household_id = NEW.household_id
      AND document.household_id = NEW.household_id
      AND position.household_id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
      AND import.provider IN ('robinhood', 'plaid_investments')
      AND row.position_kind = 'direct'
      AND position.position_kind = 'direct'
      AND row.public_exposure_identity_kind IS NULL
      AND row.protected_exposure_key IS NULL
      AND public_evidence.resolution_status = 'no_strong_identifier'
      AND public_evidence.evidence_sha256 = NEW.evidence_sha256
      AND document.sha256 = NEW.evidence_sha256
  );
END;

CREATE TRIGGER holding_import_row_public_exposure_evidence_integrity_insert
BEFORE INSERT ON holding_import_row_public_exposure_evidence
BEGIN
  SELECT RAISE(ABORT, 'retained public exposure evidence provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_imports import ON import.id = row.import_id
    JOIN source_documents document ON document.id = import.source_document_id
    JOIN holding_import_applications application
      ON application.import_row_id = row.id
    JOIN holding_positions position ON position.id = application.position_id
    JOIN households household ON household.id = row.household_id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND import.household_id = NEW.household_id
      AND document.household_id = NEW.household_id
      AND position.household_id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
      AND import.provider IN ('robinhood', 'plaid_investments')
      AND row.position_kind = 'direct'
      AND position.position_kind = 'direct'
      AND row.public_exposure_identity_kind IS NULL
      AND row.protected_exposure_key IS NULL
      AND document.sha256 = NEW.evidence_sha256
  );
END;

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

CREATE TRIGGER holding_import_row_structured_asset_exposure_evidence_integrity_insert
BEFORE INSERT ON holding_import_row_structured_asset_exposure_evidence
BEGIN
  SELECT RAISE(ABORT, 'structured asset exposure evidence provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_rows row
    JOIN holding_imports import ON import.id = row.import_id
    JOIN source_documents document ON document.id = import.source_document_id
    JOIN holding_import_applications application
      ON application.import_row_id = row.id
    JOIN holding_positions position ON position.id = application.position_id
    JOIN households household ON household.id = row.household_id
    JOIN holding_import_row_public_exposure_evidence public_evidence
      ON public_evidence.import_row_id = row.id
    JOIN holding_import_row_provider_exposure_evidence provider_evidence
      ON provider_evidence.import_row_id = row.id
    WHERE row.id = NEW.import_row_id
      AND row.household_id = NEW.household_id
      AND import.household_id = NEW.household_id
      AND document.household_id = NEW.household_id
      AND position.household_id = NEW.household_id
      AND household.owner_user_id = NEW.created_by_user_id
      AND import.provider IN ('robinhood', 'plaid_investments')
      AND row.position_kind = 'direct'
      AND position.position_kind = 'direct'
      AND row.public_exposure_identity_kind IS NULL
      AND row.protected_exposure_key IS NULL
      AND public_evidence.resolution_status = 'no_strong_identifier'
      AND provider_evidence.resolution_status = 'not_eligible'
      AND public_evidence.evidence_sha256 = NEW.evidence_sha256
      AND provider_evidence.evidence_sha256 = NEW.evidence_sha256
      AND document.sha256 = NEW.evidence_sha256
  );
END;

CREATE TRIGGER holding_import_rows_exposure_identity_insert
BEFORE INSERT ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'holding import exposure identity mismatch')
  WHERE (NEW.public_exposure_identity_kind IS NULL)
        <> (NEW.protected_exposure_key IS NULL);
END;

CREATE TRIGGER holding_import_rows_integrity_insert
BEFORE INSERT ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'holding import row household mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM holding_imports import
    WHERE import.id = NEW.import_id
      AND import.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_import_rows_no_delete
BEFORE DELETE ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'holding import rows are immutable');
END;

CREATE TRIGGER holding_import_rows_no_update
BEFORE UPDATE ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'holding import rows are immutable');
END;

CREATE TRIGGER holding_import_share_prices_guard BEFORE INSERT ON holding_import_share_prices BEGIN
  SELECT RAISE(ABORT, 'share price household mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_import_rows r WHERE r.id=NEW.import_row_id AND r.household_id=NEW.household_id
  );
END;

CREATE TRIGGER holding_investment_amount_correction_guard
BEFORE INSERT ON holding_investment_reviews
WHEN json_type(NEW.state_json, '$.amountCorrection') IS NOT NULL
  AND json_type(NEW.state_json, '$.amountCorrection') <> 'null'
BEGIN
  SELECT RAISE(ABORT, 'investment amount correction invalid')
  WHERE json_type(NEW.state_json, '$.amountCorrection') IS NOT 'object'
    OR json_type(NEW.state_json, '$.amountCorrection.amountMinor') IS NOT 'integer'
    OR json_extract(NEW.state_json, '$.amountCorrection.amountMinor') NOT BETWEEN 1 AND 9007199254740991
    OR json_type(NEW.state_json, '$.amountCorrection.note') IS NOT 'text'
    OR length(trim(json_extract(NEW.state_json, '$.amountCorrection.note'))) NOT BETWEEN 3 AND 500;
  SELECT RAISE(ABORT, 'investment amount correction provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM holding_position_snapshots snapshot
    JOIN holding_positions position ON position.id = snapshot.position_id
    WHERE snapshot.id = json_extract(NEW.state_json, '$.amountCorrection.snapshotId')
      AND snapshot.position_id = NEW.position_id AND snapshot.household_id = NEW.household_id
      AND position.position_kind <> 'direct'
      AND json_extract(NEW.state_json, '$.amountCorrection.sourceAmountMinor') =
        CASE position.provider WHEN 'angellist' THEN snapshot.invested_minor ELSE snapshot.allocation_minor END
  );
END;

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

CREATE TRIGGER holding_position_continuities_integrity_insert
BEFORE INSERT ON holding_position_continuities
BEGIN
  SELECT RAISE(ABORT, 'holding position continuity evidence mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_position_continuity_evidence_v1 evidence
    JOIN households household ON household.id = evidence.household_id
    WHERE evidence.household_id = NEW.household_id
      AND evidence.predecessor_position_id = NEW.predecessor_position_id
      AND evidence.predecessor_snapshot_id = NEW.predecessor_snapshot_id
      AND evidence.successor_position_id = NEW.successor_position_id
      AND evidence.successor_snapshot_id = NEW.successor_snapshot_id
      AND household.owner_user_id = NEW.recorded_by_user_id
  );
END;

CREATE TRIGGER holding_position_continuities_unique_candidate_insert
BEFORE INSERT ON holding_position_continuities
BEGIN
  SELECT RAISE(ABORT, 'holding position continuity is not a unique candidate')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_position_continuity_candidates_v1 candidate
    WHERE candidate.household_id = NEW.household_id
      AND candidate.predecessor_position_id = NEW.predecessor_position_id
      AND candidate.predecessor_snapshot_id = NEW.predecessor_snapshot_id
      AND candidate.successor_position_id = NEW.successor_position_id
      AND candidate.successor_snapshot_id = NEW.successor_snapshot_id
  );
END;

CREATE TRIGGER holding_position_economics_proposals_integrity_insert
BEFORE INSERT ON holding_position_economics_proposals
BEGIN
  SELECT RAISE(ABORT, 'position economics proposal provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    JOIN holding_position_snapshots snapshot
      ON snapshot.position_id = position.id
    JOIN households household ON household.id = position.household_id
    WHERE position.id = NEW.position_id
      AND position.position_kind = 'spv_interest'
      AND position.household_id = NEW.household_id
      AND snapshot.id = NEW.snapshot_id
      AND snapshot.household_id = NEW.household_id
      AND COALESCE((SELECT json_extract(review.state_json, '$.amountCorrection.amountMinor')
        FROM holding_investment_reviews review
        WHERE review.household_id = NEW.household_id AND review.position_id = NEW.position_id
        ORDER BY review.version DESC LIMIT 1),
        CASE position.provider WHEN 'angellist' THEN snapshot.invested_minor ELSE snapshot.allocation_minor END) = NEW.commitment_minor
      AND snapshot.invested_minor = NEW.funded_minor
      AND household.owner_user_id = NEW.created_by
  );
  SELECT RAISE(ABORT, 'position economics proposal snapshot is stale')
  WHERE NEW.snapshot_id IS NOT (
    SELECT candidate.snapshot_id
    FROM holding_import_applications candidate
    JOIN holding_position_snapshots candidate_snapshot
      ON candidate_snapshot.id = candidate.snapshot_id
    WHERE candidate.position_id = NEW.position_id
      AND candidate.household_id = NEW.household_id
    ORDER BY candidate.applied_at DESC,
             candidate_snapshot.observed_at DESC,
             candidate.id DESC
    LIMIT 1
  );
  SELECT RAISE(ABORT, 'position economics proposal chain mismatch')
  WHERE NEW.supersedes_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_position_economics_proposals prior
    JOIN holding_position_economics_reviews review
      ON review.proposal_id = prior.id
     AND review.decision = 'accepted'
    WHERE prior.id = NEW.supersedes_proposal_id
      AND prior.position_id = NEW.position_id
      AND prior.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_position_link_guard BEFORE INSERT ON holding_position_link_reviews BEGIN
  SELECT RAISE(ABORT,'position link provenance mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions s JOIN holding_positions t ON t.household_id=s.household_id
    JOIN households h ON h.id=s.household_id
    WHERE s.id=NEW.source_position_id AND t.id=NEW.target_position_id AND h.id=NEW.household_id
      AND h.owner_user_id=NEW.reviewer_user_id AND s.currency=t.currency
      AND s.provider IN ('angellist','tokenfolio','sydecar','wefunder','manual') AND t.provider IN ('angellist','tokenfolio','sydecar','wefunder','manual')
      AND (t.position_kind='spv_interest' OR t.provider='manual')
  );
  SELECT RAISE(ABORT,'position link stale') WHERE NEW.prior_id IS NOT
    (SELECT review_id FROM holding_position_link_heads WHERE source_position_id=NEW.source_position_id);
  SELECT RAISE(ABORT,'position link source stale') WHERE NEW.source_snapshot_id IS NOT (
    SELECT a.snapshot_id FROM holding_import_applications a JOIN holding_position_snapshots s ON s.id=a.snapshot_id
    WHERE a.position_id=NEW.source_position_id ORDER BY a.applied_at DESC,s.observed_at DESC,a.id DESC LIMIT 1
  );
  SELECT RAISE(ABORT,'position link target stale') WHERE NEW.target_snapshot_id IS NOT (
    SELECT a.snapshot_id FROM holding_import_applications a JOIN holding_position_snapshots s ON s.id=a.snapshot_id
    WHERE a.position_id=NEW.target_position_id ORDER BY a.applied_at DESC,s.observed_at DESC,a.id DESC LIMIT 1
  );
  SELECT RAISE(ABORT,'position link participation stale') WHERE
    NEW.source_participation_review_id IS NOT (SELECT id FROM holding_investment_reviews WHERE household_id=NEW.household_id AND position_id=NEW.source_position_id ORDER BY version DESC LIMIT 1)
    OR NEW.target_participation_review_id IS NOT (SELECT id FROM holding_investment_reviews WHERE household_id=NEW.household_id AND position_id=NEW.target_position_id ORDER BY version DESC LIMIT 1);
  SELECT RAISE(ABORT,'position link chain or cycle') WHERE NEW.state='linked' AND (
    EXISTS(SELECT 1 FROM holding_position_link_heads WHERE source_position_id=NEW.target_position_id AND state='linked')
    OR EXISTS(SELECT 1 FROM holding_position_link_heads WHERE target_position_id=NEW.source_position_id AND household_id=NEW.household_id AND state='linked')
    OR EXISTS(SELECT 1 FROM holding_position_continuities WHERE predecessor_position_id IN (NEW.source_position_id,NEW.target_position_id))
  );
  SELECT RAISE(ABORT,'position link must be removed before retargeting') WHERE NEW.prior_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM holding_position_link_heads WHERE source_position_id=NEW.source_position_id AND state='linked' AND target_position_id<>NEW.target_position_id
  );
END;

CREATE TRIGGER holding_position_rename_guard BEFORE INSERT ON holding_position_link_reviews BEGIN
  SELECT RAISE(ABORT,'position link rename relationship') WHERE NEW.company_renamed=1 AND NEW.relationship<>'same_investment';
  SELECT RAISE(ABORT,'position link historical valuation') WHERE NEW.state='linked' AND NEW.use_source_value=1 AND EXISTS(
    SELECT 1 FROM holding_positions p JOIN holding_position_snapshots s ON s.id=CASE p.id WHEN NEW.source_position_id THEN NEW.source_snapshot_id ELSE NEW.target_snapshot_id END
    WHERE p.id IN (NEW.source_position_id,NEW.target_position_id) AND COALESCE(
      (SELECT json_extract(state_json,'$.participationStatus') FROM holding_investment_reviews WHERE household_id=p.household_id AND position_id=p.id ORDER BY version DESC LIMIT 1),
      CASE s.provider_status WHEN 'realized' THEN 'historical' ELSE 'current' END) IN ('historical','cancelled')
  );
  SELECT RAISE(ABORT,'position link rename identity') WHERE NEW.state='linked' AND NEW.company_renamed=1 AND NOT EXISTS(
    SELECT 1 FROM holding_positions s JOIN holding_positions t ON t.id=NEW.target_position_id
    JOIN holding_position_ownerships so ON so.position_id=s.id
    JOIN holding_position_ownerships tor ON tor.position_id=t.id AND tor.container_id=so.container_id
    WHERE s.id=NEW.source_position_id AND s.provider=t.provider AND s.legal_vehicle_name=t.legal_vehicle_name
      AND s.owner_label IS t.owner_label AND s.opened_on IS t.opened_on AND s.opened_on IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=so.id)
      AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=tor.id)
  );
END;

CREATE TRIGGER holding_position_same_investment_guard BEFORE INSERT ON holding_position_link_reviews WHEN NEW.state='linked' AND NEW.relationship='same_investment' BEGIN
  SELECT RAISE(ABORT,'position link participation conflict') WHERE
    COALESCE((SELECT json_extract(state_json,'$.participationStatus') FROM holding_investment_reviews WHERE household_id=NEW.household_id AND position_id=NEW.source_position_id ORDER BY version DESC LIMIT 1),
      (SELECT CASE provider_status WHEN 'realized' THEN 'historical' ELSE 'current' END FROM holding_position_snapshots WHERE id=NEW.source_snapshot_id)) IS NOT
    COALESCE((SELECT json_extract(state_json,'$.participationStatus') FROM holding_investment_reviews WHERE household_id=NEW.household_id AND position_id=NEW.target_position_id ORDER BY version DESC LIMIT 1),
      (SELECT CASE provider_status WHEN 'realized' THEN 'historical' ELSE 'current' END FROM holding_position_snapshots WHERE id=NEW.target_snapshot_id));
END;

CREATE TRIGGER holding_position_snapshots_integrity_insert
BEFORE INSERT ON holding_position_snapshots
BEGIN
  SELECT RAISE(ABORT, 'holding snapshot provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    JOIN holding_import_rows row ON row.id = NEW.source_import_row_id
    JOIN holding_imports import ON import.id = row.import_id
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
      AND row.household_id = NEW.household_id
      AND (
        row.position_fingerprint = position.position_fingerprint
        OR EXISTS (
          SELECT 1 FROM holding_import_row_decisions decision
          WHERE decision.import_row_id = row.id
            AND decision.matched_position_id = position.id
            AND decision.decision = 'accepted'
        )
      )
      AND import.source_document_id = NEW.source_document_id
  );
END;

CREATE TRIGGER holding_position_snapshots_no_delete
BEFORE DELETE ON holding_position_snapshots
BEGIN
  SELECT RAISE(ABORT, 'holding position snapshots are immutable');
END;

CREATE TRIGGER holding_position_snapshots_no_update
BEFORE UPDATE ON holding_position_snapshots
BEGIN
  SELECT RAISE(ABORT, 'holding position snapshots are immutable');
END;

CREATE TRIGGER holding_position_value_proposals_integrity_insert
BEFORE INSERT ON holding_position_value_proposals
BEGIN
  SELECT RAISE(ABORT, 'position value proposal provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    JOIN holding_position_snapshots snapshot
      ON snapshot.position_id = position.id
    JOIN households household ON household.id = position.household_id
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
      AND snapshot.id = NEW.snapshot_id
      AND snapshot.household_id = NEW.household_id
      AND snapshot.currency = NEW.currency
      AND household.owner_user_id = NEW.created_by
  );
  SELECT RAISE(ABORT, 'position value proposal snapshot is stale')
  WHERE NEW.snapshot_id IS NOT (
    SELECT candidate.snapshot_id
    FROM holding_import_applications candidate
    JOIN holding_position_snapshots candidate_snapshot
      ON candidate_snapshot.id = candidate.snapshot_id
    WHERE candidate.position_id = NEW.position_id
      AND candidate.household_id = NEW.household_id
    ORDER BY candidate.applied_at DESC,
             candidate_snapshot.observed_at DESC,
             candidate.id DESC
    LIMIT 1
  );
  SELECT RAISE(ABORT, 'position value proposal chain mismatch')
  WHERE NEW.supersedes_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_position_value_proposals prior
    JOIN holding_position_value_reviews review
      ON review.proposal_id = prior.id
     AND review.decision = 'accepted'
    WHERE prior.id = NEW.supersedes_proposal_id
      AND prior.position_id = NEW.position_id
      AND prior.household_id = NEW.household_id
  );
END;

CREATE TRIGGER holding_purchase_price_evidence_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase price evidence stale') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.lots') lot
    WHERE json_extract(lot.value,'$.mark.sourceEvidenceId') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM holding_price_source_heads head JOIN holding_price_quotes q ON q.source_position_id=head.source_position_id AND q.id=COALESCE(head.quote_id,head.observation_id)
      WHERE q.id=json_extract(lot.value,'$.mark.sourceEvidenceId') AND q.household_id=NEW.household_id
        AND q.price_micros=json_extract(lot.value,'$.mark.priceMicros')
        AND (q.price_date IS NULL OR q.price_date=json_extract(lot.value,'$.mark.effectiveDate'))
        AND ((json_extract(lot.value,'$.mark.proxy.confirmed')=1 AND q.observed_at=json_extract(lot.value,'$.mark.proxy.capturedAt'))
          OR (json_extract(lot.value,'$.mark.proxy') IS NULL AND json_extract(lot.value,'$.mark.comparableConfirmed')=1))
    )
    AND NOT EXISTS (
      SELECT 1 FROM holding_import_share_prices e
      JOIN holding_import_applications a ON a.import_row_id=e.import_row_id
      JOIN holding_import_rows r ON r.id=e.import_row_id
      JOIN holding_imports i ON i.id=r.import_id
      WHERE e.import_row_id=json_extract(lot.value,'$.mark.sourceEvidenceId')
        AND e.household_id=NEW.household_id
        AND (
          (json_extract(lot.value,'$.mark.proxy') IS NULL AND json_extract(lot.value,'$.mark.comparableConfirmed')=1)
          OR (json_extract(lot.value,'$.mark.proxy.confirmed')=1
            AND json_extract(lot.value,'$.mark.comparableConfirmed') IS NULL
            AND length(trim(json_extract(lot.value,'$.mark.proxy.reason'))) > 0
            AND json_extract(lot.value,'$.mark.proxy.capturedAt')=i.created_at)
        )
        AND json_extract(e.evidence_json,'$.markMicros')=json_extract(lot.value,'$.mark.priceMicros')
        AND (json_extract(e.evidence_json,'$.markDate') IS NULL OR json_extract(e.evidence_json,'$.markDate')=json_extract(lot.value,'$.mark.effectiveDate'))
        AND a.id=(SELECT application_id FROM holding_import_application_heads WHERE position_id=a.position_id)
    )
  );
END;

CREATE TRIGGER holding_purchase_review_guard BEFORE INSERT ON holding_purchase_reviews BEGIN

  SELECT RAISE(ABORT,'purchase provenance mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p JOIN households h ON h.id=p.household_id
    JOIN holding_position_snapshots s ON s.position_id=p.id
    WHERE p.id=NEW.position_id AND p.household_id=NEW.household_id
      AND (p.position_kind='spv_interest' OR (p.provider='manual' AND p.position_kind IN ('direct','fund_interest'))) AND p.currency='USD'
      AND h.owner_user_id=NEW.reviewer_user_id AND s.id=NEW.snapshot_id
      AND NOT EXISTS (SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id=p.id)
  );
  SELECT RAISE(ABORT,'purchase review stale') WHERE NEW.prior_id IS NOT
    (SELECT review_id FROM holding_purchase_heads WHERE position_id=NEW.position_id);
  SELECT RAISE(ABORT,'purchase snapshot stale') WHERE NEW.snapshot_id IS NOT (
    SELECT snapshot_id FROM holding_import_application_heads WHERE position_id=NEW.position_id
  );
END;

CREATE TRIGGER holding_purchase_unified_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase unified terms downgrade')
  WHERE json_type(NEW.receipt_json, '$.details.investmentTerms') IS NULL
    AND EXISTS (SELECT 1 FROM holding_purchase_heads head
      JOIN holding_purchase_reviews prior ON prior.id = head.review_id
      WHERE head.position_id = NEW.position_id
        AND json_type(prior.receipt_json, '$.details.investmentTerms') IS NOT NULL);

  SELECT RAISE(ABORT, 'purchase economics review stale')
  WHERE json_type(NEW.receipt_json, '$.details.investmentTerms') IS NOT NULL
    AND json_extract(NEW.receipt_json, '$.supersedesEconomicsTermsId') IS NOT (
      SELECT proposal.id FROM holding_position_economics_proposals proposal
      JOIN holding_position_economics_reviews review ON review.proposal_id = proposal.id AND review.decision = 'accepted'
      WHERE proposal.position_id = NEW.position_id AND proposal.household_id = NEW.household_id
        AND NOT EXISTS (SELECT 1 FROM holding_position_economics_proposals later
          JOIN holding_position_economics_reviews later_review ON later_review.proposal_id = later.id AND later_review.decision = 'accepted'
          WHERE later.supersedes_proposal_id = proposal.id)
      ORDER BY review.decided_at DESC, proposal.id DESC LIMIT 1);

  SELECT RAISE(ABORT, 'purchase capital does not reconcile') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.lots') lot
    WHERE json_type(lot.value, '$.upfrontDeductionsMinor') IS 'integer'
      AND ((json_extract(lot.value, '$.grossCashMinor') IS NOT NULL
        AND json_extract(lot.value, '$.upfrontDeductionsMinor') > (json_extract(lot.value, '$.grossCashMinor') - CASE WHEN json_extract(lot.value, '$.capitalReturn.status') = 'received' THEN json_extract(lot.value, '$.capitalReturn.amountMinor') ELSE 0 END))
        OR (json_extract(lot.value, '$.grossCashMinor') IS NOT NULL
          AND json_extract(lot.value, '$.netCapitalMinor') IS NOT NULL
          AND (json_extract(lot.value, '$.grossCashMinor') - CASE WHEN json_extract(lot.value, '$.capitalReturn.status') = 'received' THEN json_extract(lot.value, '$.capitalReturn.amountMinor') ELSE 0 END) != json_extract(lot.value, '$.netCapitalMinor') + json_extract(lot.value, '$.upfrontDeductionsMinor'))));


  SELECT RAISE(ABORT, 'purchase value evidence stale')
  WHERE json_type(NEW.receipt_json, '$.details.investmentTerms.reportedValueReview') IS 'object'
    AND NOT EXISTS (
      SELECT 1 FROM holding_positions source_position
      JOIN holding_import_applications source_application ON source_application.id = (
        SELECT application.id FROM holding_import_applications application
        JOIN holding_position_snapshots snapshot ON snapshot.id = application.snapshot_id
        WHERE application.position_id = source_position.id
        ORDER BY application.applied_at DESC, snapshot.observed_at DESC, application.id DESC LIMIT 1)
      JOIN holding_position_snapshots source ON source.id = source_application.snapshot_id
      WHERE source_position.household_id = NEW.household_id AND source_position.currency = 'USD'
        AND source.id = json_extract(NEW.receipt_json, '$.details.investmentTerms.reportedValueReview.sourceSnapshotId')
        AND source.unrealized_value_minor = json_extract(NEW.receipt_json, '$.details.investmentTerms.reportedValueReview.valueMinor')
        AND ((source_position.id = NEW.position_id AND NOT EXISTS (
          SELECT 1 FROM holding_position_link_heads link WHERE link.household_id = NEW.household_id
            AND link.target_position_id = NEW.position_id AND link.state = 'linked' AND link.use_source_value = 1))
        OR (source.provider_status = 'live' AND EXISTS (
          SELECT 1 FROM holding_position_link_heads link WHERE link.household_id = NEW.household_id
            AND link.target_position_id = NEW.position_id AND link.source_position_id = source_position.id
            AND link.state = 'linked' AND link.use_source_value = 1)
          AND COALESCE((SELECT json_extract(review.state_json, '$.participationStatus')
            FROM holding_investment_reviews review WHERE review.household_id = NEW.household_id
              AND review.position_id = source_position.id ORDER BY review.version DESC LIMIT 1), 'current') NOT IN ('historical', 'cancelled'))));
END;

CREATE TRIGGER holding_selected_valuation_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  SELECT RAISE(ABORT, 'purchase price evidence stale') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.receipt_json, '$.details.valuation.records') record
    WHERE json_extract(record.value,'$.id')=json_extract(NEW.receipt_json,'$.details.valuation.selected.recordId')
      AND json_extract(record.value,'$.sourceEvidenceId') IS NOT NULL
      AND json_extract(NEW.receipt_json,'$.details.valuation') IS NOT
        (SELECT json_extract(prior.receipt_json,'$.details.valuation') FROM holding_purchase_reviews prior WHERE prior.id=NEW.prior_id)
      AND NOT EXISTS (
        SELECT 1 FROM holding_price_source_heads head JOIN holding_price_quotes q ON q.source_position_id=head.source_position_id AND q.id=head.quote_id
        WHERE q.id=json_extract(record.value,'$.sourceEvidenceId') AND q.household_id=NEW.household_id
          AND q.source_position_id=json_extract(record.value,'$.sourcePositionId')
          AND q.price_micros=json_extract(record.value,'$.priceMicros')
          AND q.price_date IS json_extract(record.value,'$.priceDate')
          AND q.share_class IS json_extract(record.value,'$.shareClass')
          AND q.basis_json IS json_extract(record.value,'$.shareBasis')
          AND q.observed_at=json_extract(record.value,'$.sourceCapturedAt')
          AND (q.source_position_id=NEW.position_id OR json_extract(record.value,'$.origin')='proxy'
            OR EXISTS(SELECT 1 FROM holding_position_link_heads l WHERE l.source_position_id=q.source_position_id
              AND l.target_position_id=NEW.position_id AND l.state='linked' AND l.use_source_value=1))
      )
      AND NOT EXISTS (
        SELECT 1 FROM holding_import_share_prices price
        JOIN holding_import_applications application ON application.import_row_id=price.import_row_id
        JOIN holding_import_rows row ON row.id=price.import_row_id
        JOIN holding_imports source ON source.id=row.import_id
        WHERE price.import_row_id=json_extract(record.value,'$.sourceEvidenceId')
          AND price.household_id=NEW.household_id
          AND application.position_id=json_extract(record.value,'$.sourcePositionId')
          AND source.created_at=json_extract(record.value,'$.sourceCapturedAt')
          AND json_extract(price.evidence_json,'$.markMicros')=json_extract(record.value,'$.priceMicros')
          AND json_extract(price.evidence_json,'$.markDate') IS json_extract(record.value,'$.priceDate')
          AND json_extract(price.evidence_json,'$.shareClass') IS json_extract(record.value,'$.shareClass')
          AND (application.position_id=NEW.position_id OR
            (json_extract(record.value,'$.origin')='proxy' AND json_extract(record.value,'$.totalMinor') IS NULL))
          AND application.id=(SELECT application_id FROM holding_import_application_heads WHERE position_id=application.position_id)
      )
  );
END;

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

CREATE TRIGGER portfolio_baseline_items_integrity_insert
BEFORE INSERT ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline item identity mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM portfolio_baselines baseline
    JOIN holding_positions position
      ON position.household_id = baseline.household_id
    JOIN holding_position_snapshots snapshot
      ON snapshot.position_id = position.id
      AND snapshot.household_id = position.household_id
    WHERE baseline.id = NEW.baseline_id
      AND baseline.household_id = NEW.household_id
      AND position.id = NEW.position_id
      AND snapshot.id = NEW.snapshot_id
      AND position.provider = NEW.provider
  );

  SELECT RAISE(ABORT, 'portfolio baseline item is not an accepted snapshot')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_applications application
    WHERE application.household_id = NEW.household_id
      AND application.position_id = NEW.position_id
      AND application.snapshot_id = NEW.snapshot_id
  );
END;

CREATE TRIGGER portfolio_baseline_items_no_delete
BEFORE DELETE ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline items are immutable');
END;

CREATE TRIGGER portfolio_baseline_items_no_update
BEFORE UPDATE ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline items are immutable');
END;

CREATE TRIGGER private_holding_policy_stale_insert
BEFORE INSERT ON holding_import_row_decisions
WHEN NEW.decision_source = 'policy' AND NEW.decision = 'accepted'
  AND NEW.policy_version = 'private-holdings-auto-v1'
BEGIN
  SELECT RAISE(ABORT, 'newer holding observation already accepted') WHERE EXISTS (
    SELECT 1 FROM holding_position_snapshots snapshot
    JOIN holding_import_rows row ON row.id = NEW.import_row_id
    JOIN holding_imports import ON import.id = row.import_id
    JOIN source_documents document ON document.id = import.source_document_id
    WHERE snapshot.position_id = NEW.matched_position_id
      AND snapshot.observed_at > COALESCE(document.effective_date || 'T00:00:00.000Z', document.retrieved_at)
  );
END;

CREATE TRIGGER holding_import_rows_unknown_amounts_guard
BEFORE INSERT ON holding_import_rows
BEGIN
  SELECT RAISE(ABORT, 'provider holding amounts are required')
  WHERE (NEW.invested_minor IS NULL OR NEW.allocation_minor IS NULL OR NEW.realized_value_minor IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM holding_imports i
      WHERE i.id = NEW.import_id AND i.household_id = NEW.household_id AND i.provider = 'manual'
    );
END;

CREATE TRIGGER holding_position_snapshots_unknown_amounts_guard
BEFORE INSERT ON holding_position_snapshots
BEGIN
  SELECT RAISE(ABORT, 'provider snapshot amounts are required')
  WHERE (NEW.invested_minor IS NULL OR NEW.allocation_minor IS NULL OR NEW.realized_value_minor IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM holding_positions p
      JOIN holding_import_rows r ON r.id = NEW.source_import_row_id
      JOIN holding_imports i ON i.id = r.import_id AND i.household_id = r.household_id
      WHERE p.id = NEW.position_id AND p.household_id = NEW.household_id
        AND p.provider = 'manual' AND i.provider = 'manual'
    );
  SELECT RAISE(ABORT, 'manual snapshot source mismatch')
  WHERE EXISTS (SELECT 1 FROM holding_positions p WHERE p.id = NEW.position_id AND p.provider = 'manual')
    AND NOT EXISTS (
      SELECT 1 FROM holding_import_rows r JOIN holding_imports i ON i.id = r.import_id
      WHERE r.id = NEW.source_import_row_id AND i.provider = 'manual'
        AND i.household_id = NEW.household_id
    );
END;

CREATE TRIGGER manual_holding_row_decision_guard
BEFORE INSERT ON holding_import_row_decisions
BEGIN
  SELECT RAISE(ABORT, 'manual holding requires a human decision')
  WHERE EXISTS (
    SELECT 1 FROM holding_import_rows r JOIN holding_imports i ON i.id = r.import_id
    WHERE r.id = NEW.import_row_id AND i.provider = 'manual'
  ) AND (NEW.decision_source <> 'manual' OR NEW.policy_version IS NOT NULL);
END;

CREATE TABLE manual_holding_identity_versions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  container_id TEXT NOT NULL REFERENCES ownership_containers(id) ON DELETE RESTRICT,
  legal_vehicle_name TEXT NOT NULL CHECK (length(legal_vehicle_name) BETWEEN 1 AND 1000),
  owner_label TEXT NOT NULL CHECK (length(owner_label) BETWEEN 1 AND 1000),
  position_kind TEXT NOT NULL CHECK (position_kind IN ('direct', 'spv_interest', 'fund_interest')),
  opened_on TEXT CHECK (opened_on IS NULL OR opened_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  classification TEXT NOT NULL CHECK (classification = 'private_paper'),
  version INTEGER NOT NULL CHECK (version > 0),
  prior_id TEXT UNIQUE REFERENCES manual_holding_identity_versions(id) ON DELETE RESTRICT,
  prior_company_mapping_ids_json TEXT NOT NULL CHECK (
    json_valid(prior_company_mapping_ids_json)
    AND json_type(prior_company_mapping_ids_json) = 'array'
    AND json_array_length(prior_company_mapping_ids_json) <= 500
  ),
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (position_id, version),
  CHECK ((version = 1 AND prior_id IS NULL) OR (version > 1 AND prior_id IS NOT NULL))
);
CREATE INDEX manual_holding_identity_versions_household_position_idx
  ON manual_holding_identity_versions(household_id, position_id, version);
CREATE INDEX manual_holding_identity_versions_history_idx
  ON manual_holding_identity_versions(household_id, position_id, recorded_at DESC, id DESC);
CREATE INDEX holding_exposure_heads_current_position_idx
  ON holding_position_exposure_heads(household_id, position_id, status, mapping_id);

CREATE TABLE manual_holding_identity_heads (
  position_id TEXT PRIMARY KEY NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL UNIQUE REFERENCES manual_holding_identity_versions(id) ON DELETE RESTRICT
);
CREATE INDEX manual_holding_identity_heads_household_idx
  ON manual_holding_identity_heads(household_id, position_id);

CREATE TRIGGER manual_holding_identity_guard
BEFORE INSERT ON manual_holding_identity_versions
BEGIN
  SELECT RAISE(ABORT, 'manual holding mapping precondition malformed')
  WHERE json_type(NEW.prior_company_mapping_ids_json) IS NOT 'array'
    OR EXISTS (SELECT 1 FROM json_each(NEW.prior_company_mapping_ids_json)
      WHERE type <> 'text' OR length(value) NOT BETWEEN 1 AND 200)
    OR json_array_length(NEW.prior_company_mapping_ids_json) <>
      (SELECT COUNT(DISTINCT value) FROM json_each(NEW.prior_company_mapping_ids_json));
  SELECT RAISE(ABORT, 'initial manual holding mappings must be empty')
  WHERE NEW.version = 1 AND json_array_length(NEW.prior_company_mapping_ids_json) <> 0;
  SELECT RAISE(ABORT, 'manual holding identity provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p
    JOIN households h ON h.id = p.household_id
    JOIN source_documents d ON d.household_id = h.id AND d.id = NEW.source_document_id
    JOIN ownership_containers c ON c.household_id = h.id AND c.id = NEW.container_id
    JOIN investment_connections connection ON connection.id = c.connection_id AND connection.household_id = h.id
    JOIN investment_connection_versions cv ON cv.connection_id = connection.id
    JOIN ownership_container_versions ov ON ov.container_id = c.id
    JOIN holding_position_ownerships ownership ON ownership.position_id = p.id AND ownership.container_id = c.id
    WHERE p.id = NEW.position_id AND p.household_id = NEW.household_id
      AND p.provider = 'manual' AND p.currency = 'USD'
      AND h.owner_user_id = NEW.recorded_by_user_id
      AND d.content_type = 'application/json'
      AND connection.adapter_type = 'manual' AND cv.institution_key = 'manual'
      AND cv.version = (SELECT MAX(version) FROM investment_connection_versions WHERE connection_id = connection.id)
      AND EXISTS (SELECT 1 FROM investment_connection_versions origin
        WHERE origin.connection_id = connection.id AND origin.version = 1 AND origin.institution_key = 'manual')
      AND NOT EXISTS (SELECT 1 FROM investment_connection_versions later WHERE later.supersedes_version_id = cv.id)
      AND NOT EXISTS (SELECT 1 FROM ownership_container_versions later WHERE later.supersedes_version_id = ov.id)
      AND ov.version = (SELECT MAX(version) FROM ownership_container_versions WHERE container_id = c.id)
      AND ov.display_label = NEW.owner_label
      AND NOT EXISTS (SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id = ownership.id)
      AND ownership.version = (SELECT MAX(version) FROM holding_position_ownerships WHERE position_id = p.id)
  );
  SELECT RAISE(ABORT, 'manual holding identity stale')
  WHERE NEW.prior_id IS NOT (SELECT version_id FROM manual_holding_identity_heads WHERE position_id = NEW.position_id);
  SELECT RAISE(ABORT, 'manual holding identity version mismatch')
  WHERE NEW.prior_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM manual_holding_identity_versions prior
    WHERE prior.id = NEW.prior_id AND prior.household_id = NEW.household_id
      AND prior.position_id = NEW.position_id AND prior.version + 1 = NEW.version
      AND prior.recorded_at <= NEW.recorded_at
  );
  SELECT RAISE(ABORT, 'manual holding company mappings stale')
  WHERE EXISTS (
    SELECT mapping_id FROM holding_position_exposure_heads
      INDEXED BY holding_exposure_heads_current_position_idx
    WHERE household_id = NEW.household_id AND position_id = NEW.position_id AND status = 'active'
    EXCEPT SELECT value FROM json_each(NEW.prior_company_mapping_ids_json)
  ) OR EXISTS (
    SELECT value FROM json_each(NEW.prior_company_mapping_ids_json)
    EXCEPT SELECT mapping_id FROM holding_position_exposure_heads
      INDEXED BY holding_exposure_heads_current_position_idx
    WHERE household_id = NEW.household_id AND position_id = NEW.position_id AND status = 'active'
  );
END;
CREATE TRIGGER manual_holding_identity_head
AFTER INSERT ON manual_holding_identity_versions
BEGIN
  INSERT INTO manual_holding_identity_heads(position_id, household_id, version_id)
  VALUES (NEW.position_id, NEW.household_id, NEW.id)
  ON CONFLICT(position_id) DO UPDATE SET version_id = NEW.id;
END;
CREATE TRIGGER manual_holding_identity_heads_integrity_insert
BEFORE INSERT ON manual_holding_identity_heads
BEGIN
  SELECT RAISE(ABORT, 'manual holding identity head mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM manual_holding_identity_versions v
    WHERE v.id = NEW.version_id AND v.household_id = NEW.household_id AND v.position_id = NEW.position_id
      AND NOT EXISTS (SELECT 1 FROM manual_holding_identity_versions later WHERE later.prior_id = v.id)
  );
END;
CREATE TRIGGER manual_holding_identity_heads_integrity_update
BEFORE UPDATE ON manual_holding_identity_heads
BEGIN
  SELECT RAISE(ABORT, 'manual holding identity head mismatch') WHERE
    NEW.position_id IS NOT OLD.position_id OR NEW.household_id IS NOT OLD.household_id OR NOT EXISTS (
      SELECT 1 FROM manual_holding_identity_versions v
      WHERE v.id = NEW.version_id AND v.household_id = NEW.household_id AND v.position_id = NEW.position_id
        AND v.prior_id = OLD.version_id
        AND NOT EXISTS (SELECT 1 FROM manual_holding_identity_versions later WHERE later.prior_id = v.id)
    );
END;
CREATE TRIGGER manual_holding_identity_heads_no_delete
BEFORE DELETE ON manual_holding_identity_heads BEGIN SELECT RAISE(ABORT, 'manual holding identity heads are retained'); END;
CREATE TRIGGER manual_holding_identity_versions_no_update
BEFORE UPDATE ON manual_holding_identity_versions BEGIN SELECT RAISE(ABORT, 'manual holding identity versions are immutable'); END;
CREATE TRIGGER manual_holding_identity_versions_no_delete
BEFORE DELETE ON manual_holding_identity_versions BEGIN SELECT RAISE(ABORT, 'manual holding identity versions are immutable'); END;

CREATE TABLE manual_holding_submissions (
  submission_id TEXT NOT NULL CHECK (length(submission_id) = 36),
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  position_id TEXT NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  purchase_review_id TEXT NOT NULL REFERENCES holding_purchase_reviews(id) ON DELETE RESTRICT,
  identity_version_id TEXT NOT NULL REFERENCES manual_holding_identity_versions(id) ON DELETE RESTRICT,
  declaration_json TEXT NOT NULL CHECK (json_valid(declaration_json)),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (household_id, submission_id)
);
CREATE INDEX manual_holding_submissions_position_idx
  ON manual_holding_submissions(household_id, position_id, accepted_at, submission_id);
CREATE UNIQUE INDEX manual_holding_submissions_identity_idx
  ON manual_holding_submissions(identity_version_id);
CREATE TRIGGER manual_holding_submissions_guard
BEFORE INSERT ON manual_holding_submissions
BEGIN
  SELECT RAISE(ABORT, 'manual holding company selection mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM manual_holding_identity_versions v WHERE v.id = NEW.identity_version_id AND (
      (v.version = 1 AND json_extract(NEW.declaration_json, '$.company.mode') IN ('unassigned', 'existing'))
      OR (v.version > 1 AND json_extract(NEW.declaration_json, '$.company.mode') IN ('unassigned', 'existing', 'unchanged'))
    )
  );
  SELECT RAISE(ABORT, 'manual holding submission provenance mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM households h
    JOIN holding_positions p ON p.household_id = h.id AND p.id = NEW.position_id
    JOIN manual_holding_identity_versions v ON v.position_id = p.id AND v.id = NEW.identity_version_id
    JOIN source_documents d ON d.id = v.source_document_id AND d.household_id = h.id
    JOIN holding_position_snapshots s ON s.position_id = p.id AND s.id = NEW.snapshot_id
    JOIN holding_import_applications a ON a.position_id = p.id AND a.snapshot_id = s.id
    JOIN holding_import_row_decisions decision ON decision.id = a.decision_id
    JOIN holding_import_rows row ON row.id = a.import_row_id
    JOIN holding_imports i ON i.id = row.import_id
    JOIN holding_purchase_reviews r ON r.id = NEW.purchase_review_id AND r.position_id = p.id
    WHERE h.id = NEW.household_id AND h.owner_user_id = NEW.created_by_user_id
      AND p.provider = 'manual' AND i.provider = 'manual'
      AND decision.decision = 'accepted' AND decision.decision_source = 'manual'
      AND v.household_id = h.id AND s.household_id = h.id AND r.household_id = h.id
      AND v.recorded_by_user_id = NEW.created_by_user_id AND v.recorded_at = NEW.accepted_at
      AND d.sha256 = NEW.request_hash AND d.content_type = 'application/json'
      AND v.legal_vehicle_name IS json_extract(NEW.declaration_json, '$.name')
      AND v.position_kind IS json_extract(NEW.declaration_json, '$.kind')
      AND v.opened_on IS json_extract(NEW.declaration_json, '$.investmentDate')
      AND ((v.version = 1 AND json_type(NEW.declaration_json, '$.expectedVersion') IS NULL)
        OR (v.version > 1 AND v.version = json_extract(NEW.declaration_json, '$.expectedVersion') + 1))
      AND NEW.submission_id IS json_extract(NEW.declaration_json, '$.submissionId')
      AND v.id = (SELECT version_id FROM manual_holding_identity_heads WHERE position_id = p.id)
      AND a.id = (SELECT application_id FROM holding_import_application_heads WHERE position_id = p.id)
      AND s.id = (SELECT snapshot_id FROM holding_import_application_heads WHERE position_id = p.id)
      AND r.id = (SELECT review_id FROM holding_purchase_heads WHERE position_id = p.id)
  );
  SELECT RAISE(ABORT, 'manual holding owner selection mismatch')
  WHERE json_extract(NEW.declaration_json, '$.owner.mode') IS NULL
    OR json_extract(NEW.declaration_json, '$.owner.mode') NOT IN ('existing', 'entity', 'new');
  SELECT RAISE(ABORT, 'manual holding mapping declaration mismatch')
  WHERE EXISTS (
    SELECT 1 FROM manual_holding_identity_versions v WHERE v.id = NEW.identity_version_id AND (
      (v.version = 1 AND (json_type(NEW.declaration_json, '$.expectedMappingIds') IS NOT NULL
        OR json_array_length(v.prior_company_mapping_ids_json) <> 0))
      OR (v.version > 1 AND (
        json_type(NEW.declaration_json, '$.expectedMappingIds') IS NOT 'array'
        OR EXISTS (SELECT 1 FROM json_each(NEW.declaration_json, '$.expectedMappingIds')
          WHERE type <> 'text' OR length(value) NOT BETWEEN 1 AND 200)
        OR json_array_length(NEW.declaration_json, '$.expectedMappingIds') <>
          (SELECT COUNT(DISTINCT value) FROM json_each(NEW.declaration_json, '$.expectedMappingIds'))
        OR EXISTS (
          SELECT value FROM json_each(v.prior_company_mapping_ids_json)
          EXCEPT SELECT value FROM json_each(NEW.declaration_json, '$.expectedMappingIds')
        ) OR EXISTS (
          SELECT value FROM json_each(NEW.declaration_json, '$.expectedMappingIds')
          EXCEPT SELECT value FROM json_each(v.prior_company_mapping_ids_json)
        )
      ))
    )
  );
  SELECT RAISE(ABORT, 'manual holding selected owner stale')
  WHERE json_extract(NEW.declaration_json, '$.owner.mode') = 'existing' AND NOT EXISTS (
    SELECT 1 FROM manual_holding_identity_versions v
    JOIN ownership_container_versions cv ON cv.container_id = v.container_id
    WHERE v.id = NEW.identity_version_id
      AND v.container_id = json_extract(NEW.declaration_json, '$.owner.containerId')
      AND cv.version = json_extract(NEW.declaration_json, '$.owner.version')
      AND NOT EXISTS (SELECT 1 FROM ownership_container_versions later WHERE later.supersedes_version_id = cv.id)
  );
  SELECT RAISE(ABORT, 'manual holding selected entity stale')
  WHERE json_extract(NEW.declaration_json, '$.owner.mode') = 'entity' AND NOT EXISTS (
    SELECT 1 FROM legal_entities entity
    JOIN legal_entity_versions ev ON ev.legal_entity_id = entity.id
    JOIN manual_holding_identity_versions v ON v.id = NEW.identity_version_id
    WHERE entity.id = json_extract(NEW.declaration_json, '$.owner.entityId') AND entity.household_id = NEW.household_id
      AND ev.version = json_extract(NEW.declaration_json, '$.owner.version') AND ev.legal_name = v.owner_label
      AND NOT EXISTS (SELECT 1 FROM legal_entity_versions later WHERE later.supersedes_version_id = ev.id)
  );
  SELECT RAISE(ABORT, 'manual holding new owner mismatch')
  WHERE json_extract(NEW.declaration_json, '$.owner.mode') = 'new' AND NOT EXISTS (
    SELECT 1 FROM manual_holding_identity_versions v WHERE v.id = NEW.identity_version_id
      AND v.owner_label = json_extract(NEW.declaration_json, '$.owner.label')
  );
  SELECT RAISE(ABORT, 'manual holding selected company stale')
  WHERE json_extract(NEW.declaration_json, '$.company.mode') = 'existing' AND NOT EXISTS (
    SELECT 1 FROM companies c WHERE c.id = json_extract(NEW.declaration_json, '$.company.companyId')
      AND c.household_id = NEW.household_id AND c.updated_at = json_extract(NEW.declaration_json, '$.company.revision')
  );
END;
CREATE TRIGGER manual_holding_submissions_no_update
BEFORE UPDATE ON manual_holding_submissions BEGIN SELECT RAISE(ABORT, 'manual holding submissions are immutable'); END;
CREATE TRIGGER manual_holding_submissions_no_delete
BEFORE DELETE ON manual_holding_submissions BEGIN SELECT RAISE(ABORT, 'manual holding submissions are immutable'); END;

CREATE TRIGGER manual_holding_baseline_classification_guard
BEFORE INSERT ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'manual holding planning classification mismatch')
  WHERE NEW.provider = 'manual' AND NOT EXISTS (
    SELECT 1 FROM manual_holding_identity_heads h JOIN manual_holding_identity_versions v ON v.id = h.version_id
    WHERE h.position_id = NEW.position_id AND h.household_id = NEW.household_id AND v.classification = NEW.classification
  );
END;

CREATE TRIGGER manual_holding_link_value_guard
BEFORE INSERT ON holding_position_link_reviews
BEGIN
  SELECT RAISE(ABORT, 'manual holding link cannot supply provider value')
  WHERE NEW.use_source_value = 1 AND EXISTS (
    SELECT 1 FROM holding_positions p WHERE p.id = NEW.source_position_id AND p.provider = 'manual'
  );
END;

PRAGMA defer_foreign_keys = OFF;
