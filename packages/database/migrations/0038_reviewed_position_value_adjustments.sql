PRAGMA foreign_keys = ON;

-- User-supplied position values are immutable proposals. An append-only review
-- decision must accept a proposal before it can become the effective value.
CREATE TABLE holding_position_value_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  supersedes_proposal_id TEXT
    REFERENCES holding_position_value_proposals(id) ON DELETE RESTRICT,
  prior_value_state TEXT NOT NULL CHECK (
    prior_value_state IN ('reported', 'locked', 'not_reported')
  ),
  prior_value_minor INTEGER CHECK (prior_value_minor >= 0),
  value_minor INTEGER NOT NULL CHECK (value_minor >= 0),
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND currency = upper(currency)
  ),
  effective_date TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('gp_update', 'news_article', 'other')
  ),
  source_label TEXT NOT NULL CHECK (length(source_label) BETWEEN 1 AND 240),
  source_url TEXT CHECK (
    source_url IS NULL OR (
      length(source_url) <= 2048 AND source_url LIKE 'https://%'
    )
  ),
  commentary TEXT NOT NULL CHECK (length(commentary) BETWEEN 3 AND 1000),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (
    (prior_value_state = 'reported' AND prior_value_minor IS NOT NULL)
    OR
    (prior_value_state <> 'reported' AND prior_value_minor IS NULL)
  ),
  CHECK (source_kind <> 'news_article' OR source_url IS NOT NULL)
);
CREATE UNIQUE INDEX holding_position_value_proposals_roots_unique
  ON holding_position_value_proposals(position_id)
  WHERE supersedes_proposal_id IS NULL;
CREATE UNIQUE INDEX holding_position_value_proposals_supersedes_unique
  ON holding_position_value_proposals(supersedes_proposal_id)
  WHERE supersedes_proposal_id IS NOT NULL;
CREATE INDEX holding_position_value_proposals_household_position_idx
  ON holding_position_value_proposals(household_id, position_id, created_at);

CREATE TRIGGER holding_position_value_proposals_no_update
BEFORE UPDATE ON holding_position_value_proposals
BEGIN
  SELECT RAISE(ABORT, 'holding position value proposals are immutable');
END;

CREATE TRIGGER holding_position_value_proposals_no_delete
BEFORE DELETE ON holding_position_value_proposals
BEGIN
  SELECT RAISE(ABORT, 'holding position value proposals are immutable');
END;

CREATE TABLE holding_position_value_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL UNIQUE
    REFERENCES holding_position_value_proposals(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 3 AND 1000),
  decided_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX holding_position_value_reviews_household_decided_idx
  ON holding_position_value_reviews(household_id, decided_at);

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

CREATE TRIGGER holding_position_value_reviews_integrity_insert
BEFORE INSERT ON holding_position_value_reviews
BEGIN
  SELECT RAISE(ABORT, 'position value review provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_position_value_proposals proposal
    JOIN households household ON household.id = proposal.household_id
    WHERE proposal.id = NEW.proposal_id
      AND proposal.household_id = NEW.household_id
      AND household.owner_user_id = NEW.reviewer_user_id
  );
END;

CREATE TRIGGER holding_position_value_reviews_no_update
BEFORE UPDATE ON holding_position_value_reviews
BEGIN
  SELECT RAISE(ABORT, 'holding position value reviews are immutable');
END;

CREATE TRIGGER holding_position_value_reviews_no_delete
BEFORE DELETE ON holding_position_value_reviews
BEGIN
  SELECT RAISE(ABORT, 'holding position value reviews are immutable');
END;
