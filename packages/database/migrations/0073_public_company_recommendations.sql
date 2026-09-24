-- An admitted lookup is completed once with its immutable observation/proposal.
-- Reopening the same review reuses one daily lookup per issuer and identity revision.
CREATE TABLE public_company_match_runs (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  exposure_id TEXT NOT NULL REFERENCES canonical_exposures(id),
  issuer_name TEXT NOT NULL,
  identity_revision INTEGER NOT NULL,
  expected_review_id TEXT,
  cache_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  search_requested INTEGER NOT NULL CHECK (search_requested IN (0, 1)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  UNIQUE(household_id, exposure_id, cache_key)
);
CREATE INDEX public_company_match_daily_search_idx ON public_company_match_runs(household_id, created_at) WHERE search_requested = 1;
CREATE TRIGGER public_company_match_no_rewrite BEFORE UPDATE ON public_company_match_runs
WHEN OLD.result_json IS NOT NULL OR NEW.id <> OLD.id OR NEW.household_id <> OLD.household_id
  OR NEW.exposure_id <> OLD.exposure_id OR NEW.issuer_name <> OLD.issuer_name
  OR NEW.identity_revision <> OLD.identity_revision OR NEW.expected_review_id IS NOT OLD.expected_review_id
  OR NEW.cache_key <> OLD.cache_key OR NEW.created_at <> OLD.created_at OR NEW.search_requested <> OLD.search_requested
BEGIN SELECT RAISE(ABORT, 'issuer match evidence is immutable'); END;
CREATE TRIGGER public_company_match_no_delete BEFORE DELETE ON public_company_match_runs
BEGIN SELECT RAISE(ABORT, 'issuer match evidence is immutable'); END;
ALTER TABLE public_exposure_company_reviews ADD COLUMN recommendation_id TEXT REFERENCES public_company_match_runs(id);
CREATE UNIQUE INDEX public_company_review_recommendation_idx ON public_exposure_company_reviews(recommendation_id);
CREATE TRIGGER public_company_recommendation_guard BEFORE INSERT ON public_exposure_company_reviews
WHEN NEW.recommendation_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'public company recommendation is stale') WHERE NOT EXISTS (
    SELECT 1 FROM public_company_match_runs proposal
    JOIN canonical_exposures exposure ON exposure.id = proposal.exposure_id
    LEFT JOIN company_identity_revisions revision ON revision.household_id = proposal.household_id
    WHERE proposal.id = NEW.recommendation_id AND proposal.household_id = NEW.household_id
      AND proposal.exposure_id = NEW.public_exposure_id
      AND proposal.issuer_name = exposure.canonical_name
      AND proposal.identity_revision = COALESCE(revision.revision, 0)
      AND proposal.expected_review_id IS NEW.expected_review_id
      AND json_extract(proposal.result_json, '$.status') = 'recommended'
      AND json_extract(proposal.result_json, '$.companyId') = NEW.company_id
      AND julianday(proposal.created_at) >= julianday('now', '-1 day')
  );
END;

-- Keep review integrity checks independent of mapping history.
DROP TRIGGER public_exposure_company_review_guard;
CREATE TRIGGER public_exposure_company_review_guard
BEFORE INSERT ON public_exposure_company_reviews
BEGIN
  SELECT RAISE(ABORT, 'public company review scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM canonical_exposures exposure
    JOIN households household ON household.id = exposure.household_id
    JOIN companies company ON company.id = NEW.company_id
      AND company.household_id = exposure.household_id
    WHERE exposure.id = NEW.public_exposure_id
      AND exposure.household_id = NEW.household_id
      AND exposure.exposure_kind = 'public_instrument'
      AND exposure.protected_identity_key IS NOT NULL
      AND EXISTS (SELECT 1 FROM holding_position_exposure_heads current
        WHERE current.household_id = NEW.household_id AND current.exposure_id = exposure.id AND current.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM holding_position_continuities continuity WHERE continuity.predecessor_position_id = current.position_id))
      AND household.owner_user_id = NEW.reviewer_user_id
      AND NOT EXISTS (SELECT 1 FROM company_redirects redirect WHERE redirect.source_company_id = company.id)
  );
  SELECT RAISE(ABORT, 'public company review needs an existing company exposure')
  WHERE NOT EXISTS (
    SELECT 1 FROM canonical_exposures exposure
    JOIN holding_position_exposure_heads mapping
      ON mapping.exposure_id = exposure.id AND mapping.status = 'active'
    WHERE exposure.household_id = NEW.household_id
      AND exposure.company_id = NEW.company_id
      AND exposure.exposure_kind = 'private_company'
      AND NOT EXISTS (
        SELECT 1 FROM holding_position_continuities continuity
        WHERE continuity.predecessor_position_id = mapping.position_id
      )
  );
  SELECT RAISE(ABORT, 'public company review is stale') WHERE
    NEW.expected_review_id IS NOT (
      SELECT review_id FROM public_exposure_company_links
      WHERE public_exposure_id = NEW.public_exposure_id
    );
END;
