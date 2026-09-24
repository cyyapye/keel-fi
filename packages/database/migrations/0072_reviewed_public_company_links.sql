-- A public security keeps its strong instrument identity. A household review
-- may additionally associate its issuer with an existing reviewed company.
CREATE TABLE public_exposure_company_reviews (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  public_exposure_id TEXT NOT NULL REFERENCES canonical_exposures(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  source_url TEXT NOT NULL CHECK (length(source_url) BETWEEN 8 AND 2048),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  expected_review_id TEXT REFERENCES public_exposure_company_reviews(id),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id),
  reviewed_at TEXT NOT NULL
);
CREATE INDEX public_exposure_company_reviews_exposure_idx
  ON public_exposure_company_reviews(household_id, public_exposure_id, reviewed_at);

CREATE TABLE public_exposure_company_links (
  public_exposure_id TEXT PRIMARY KEY REFERENCES canonical_exposures(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  review_id TEXT NOT NULL REFERENCES public_exposure_company_reviews(id)
);
CREATE INDEX public_exposure_company_links_company_idx
  ON public_exposure_company_links(household_id, company_id);

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
      AND household.owner_user_id = NEW.reviewer_user_id
      AND NOT EXISTS (SELECT 1 FROM company_redirects redirect WHERE redirect.source_company_id = company.id)
  );
  SELECT RAISE(ABORT, 'public company review needs an existing company exposure')
  WHERE NOT EXISTS (
    SELECT 1 FROM canonical_exposures exposure
    JOIN holding_position_exposure_mappings mapping
      ON mapping.exposure_id = exposure.id AND mapping.status = 'active'
    WHERE exposure.household_id = NEW.household_id
      AND exposure.company_id = NEW.company_id
      AND exposure.exposure_kind = 'private_company'
      AND NOT EXISTS (
        SELECT 1 FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = mapping.id
      )
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

CREATE TRIGGER public_exposure_company_review_projection
AFTER INSERT ON public_exposure_company_reviews
BEGIN
  INSERT INTO public_exposure_company_links (
    public_exposure_id, household_id, company_id, review_id
  ) VALUES (
    NEW.public_exposure_id, NEW.household_id, NEW.company_id, NEW.id
  ) ON CONFLICT(public_exposure_id) DO UPDATE SET
    company_id = excluded.company_id,
    review_id = excluded.review_id;
END;

CREATE TRIGGER public_exposure_company_reviews_no_update
BEFORE UPDATE ON public_exposure_company_reviews
BEGIN SELECT RAISE(ABORT, 'public company reviews are append only'); END;
CREATE TRIGGER public_exposure_company_reviews_no_delete
BEFORE DELETE ON public_exposure_company_reviews
BEGIN SELECT RAISE(ABORT, 'public company reviews are append only'); END;
