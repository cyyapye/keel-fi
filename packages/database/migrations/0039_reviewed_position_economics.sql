PRAGMA foreign_keys = ON;

-- SPV fee and carry terms are user-reviewed, append-only proposals. Imported
-- commitment and funded capital remain source facts on the accepted snapshot.
CREATE TABLE holding_position_economics_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL REFERENCES holding_positions(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  supersedes_proposal_id TEXT
    REFERENCES holding_position_economics_proposals(id) ON DELETE RESTRICT,
  commitment_minor INTEGER NOT NULL CHECK (commitment_minor > 0),
  funded_minor INTEGER NOT NULL CHECK (funded_minor >= 0),
  annual_admin_fee_ppm INTEGER NOT NULL CHECK (
    annual_admin_fee_ppm BETWEEN 0 AND 1000000
  ),
  admin_fee_years INTEGER NOT NULL CHECK (admin_fee_years BETWEEN 1 AND 100),
  carry_ppm INTEGER NOT NULL CHECK (carry_ppm BETWEEN 0 AND 1000000),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 3 AND 500),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  CHECK (annual_admin_fee_ppm * admin_fee_years <= 1000000)
);
CREATE UNIQUE INDEX holding_position_economics_proposals_roots_unique
  ON holding_position_economics_proposals(position_id)
  WHERE supersedes_proposal_id IS NULL;
CREATE UNIQUE INDEX holding_position_economics_proposals_supersedes_unique
  ON holding_position_economics_proposals(supersedes_proposal_id)
  WHERE supersedes_proposal_id IS NOT NULL;
CREATE INDEX holding_position_economics_proposals_household_position_idx
  ON holding_position_economics_proposals(household_id, position_id, created_at);

CREATE TABLE holding_position_economics_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL UNIQUE
    REFERENCES holding_position_economics_proposals(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 3 AND 1000),
  decided_at TEXT NOT NULL,
  immutable INTEGER NOT NULL CHECK (immutable = 1)
);
CREATE INDEX holding_position_economics_reviews_household_decided_idx
  ON holding_position_economics_reviews(household_id, decided_at);

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
      AND snapshot.allocation_minor = NEW.commitment_minor
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

CREATE TRIGGER holding_position_economics_reviews_integrity_insert
BEFORE INSERT ON holding_position_economics_reviews
BEGIN
  SELECT RAISE(ABORT, 'position economics review provenance mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_position_economics_proposals proposal
    JOIN households household ON household.id = proposal.household_id
    WHERE proposal.id = NEW.proposal_id
      AND proposal.household_id = NEW.household_id
      AND household.owner_user_id = NEW.reviewer_user_id
  );
END;

CREATE TRIGGER holding_position_economics_proposals_no_update
BEFORE UPDATE ON holding_position_economics_proposals
BEGIN
  SELECT RAISE(ABORT, 'holding position economics proposals are immutable');
END;

CREATE TRIGGER holding_position_economics_proposals_no_delete
BEFORE DELETE ON holding_position_economics_proposals
BEGIN
  SELECT RAISE(ABORT, 'holding position economics proposals are immutable');
END;

CREATE TRIGGER holding_position_economics_reviews_no_update
BEFORE UPDATE ON holding_position_economics_reviews
BEGIN
  SELECT RAISE(ABORT, 'holding position economics reviews are immutable');
END;

CREATE TRIGGER holding_position_economics_reviews_no_delete
BEFORE DELETE ON holding_position_economics_reviews
BEGIN
  SELECT RAISE(ABORT, 'holding position economics reviews are immutable');
END;
