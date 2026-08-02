CREATE TABLE portfolio_watch_targets (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  source_policy TEXT NOT NULL CHECK (source_policy = 'public_only'),
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, company_id)
);
CREATE INDEX portfolio_watch_targets_household_idx
  ON portfolio_watch_targets(household_id, status);

CREATE TABLE public_source_observations (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  evidence_event_id TEXT NOT NULL UNIQUE REFERENCES evidence_events(id) ON DELETE RESTRICT,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
  source_class TEXT NOT NULL CHECK (
    source_class IN (
      'official_company',
      'regulatory_filing',
      'reputable_reporting',
      'secondary_source'
    )
  ),
  source_url TEXT NOT NULL,
  source_title TEXT NOT NULL,
  published_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  observed_fact TEXT NOT NULL,
  inference TEXT NOT NULL,
  source_reliability_ppm INTEGER NOT NULL CHECK (
    source_reliability_ppm BETWEEN 0 AND 1000000
  ),
  model_confidence_ppm INTEGER NOT NULL CHECK (
    model_confidence_ppm BETWEEN 0 AND 1000000
  ),
  valuation_low_minor INTEGER CHECK (valuation_low_minor >= 0),
  valuation_middle_minor INTEGER CHECK (valuation_middle_minor >= 0),
  valuation_high_minor INTEGER CHECK (valuation_high_minor >= 0),
  limitations TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, fingerprint),
  CHECK (
    valuation_low_minor IS NULL OR
    valuation_middle_minor IS NULL OR
    valuation_high_minor IS NULL OR
    (
      valuation_low_minor <= valuation_middle_minor AND
      valuation_middle_minor <= valuation_high_minor
    )
  )
);
CREATE INDEX public_source_observations_household_idx
  ON public_source_observations(household_id, retrieved_at);
CREATE INDEX public_source_observations_company_idx
  ON public_source_observations(company_id, published_at);

CREATE TRIGGER public_source_observations_no_update
BEFORE UPDATE ON public_source_observations
BEGIN
  SELECT RAISE(ABORT, 'public source observations are immutable');
END;

CREATE TRIGGER public_source_observations_no_delete
BEFORE DELETE ON public_source_observations
BEGIN
  SELECT RAISE(ABORT, 'public source observations are immutable');
END;
