CREATE TABLE signal_update_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  reconciliation_group_id TEXT NOT NULL,
  reconciliation_revision TEXT NOT NULL CHECK (
    length(reconciliation_revision) = 64
  ),
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  base_forecast_snapshot_id TEXT NOT NULL
    REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  base_forecast_snapshot_version INTEGER NOT NULL CHECK (
    base_forecast_snapshot_version > 0
  ),
  proposed_company_valuation_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  UNIQUE (
    household_id,
    reconciliation_group_id,
    reconciliation_revision,
    scenario_id,
    base_forecast_snapshot_id
  )
);
CREATE INDEX signal_update_proposals_household_created_idx
  ON signal_update_proposals(household_id, created_at);
CREATE INDEX signal_update_proposals_group_idx
  ON signal_update_proposals(household_id, reconciliation_group_id);

CREATE TABLE signal_update_proposal_evidence (
  proposal_id TEXT NOT NULL
    REFERENCES signal_update_proposals(id) ON DELETE RESTRICT,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  evidence_event_id TEXT NOT NULL
    REFERENCES evidence_events(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, evidence_event_id)
);
CREATE INDEX signal_update_proposal_evidence_event_idx
  ON signal_update_proposal_evidence(evidence_event_id);

CREATE TRIGGER signal_update_proposals_integrity_insert
BEFORE INSERT ON signal_update_proposals
WHEN NOT EXISTS (
  SELECT 1
  FROM companies company
  JOIN scenarios scenario ON scenario.household_id = company.household_id
  JOIN forecast_snapshots snapshot
    ON snapshot.id = NEW.base_forecast_snapshot_id
    AND snapshot.scenario_id = scenario.id
    AND snapshot.household_id = scenario.household_id
    AND snapshot.version = NEW.base_forecast_snapshot_version
    AND snapshot.version = (
      SELECT MAX(latest.version)
      FROM forecast_snapshots latest
      WHERE latest.scenario_id = scenario.id
        AND latest.household_id = scenario.household_id
    )
  WHERE company.id = NEW.company_id
    AND company.household_id = NEW.household_id
    AND scenario.id = NEW.scenario_id
    AND scenario.household_id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'signal update proposal version mismatch');
END;

CREATE TRIGGER signal_update_proposal_evidence_integrity_insert
BEFORE INSERT ON signal_update_proposal_evidence
WHEN NOT EXISTS (
  SELECT 1
  FROM signal_update_proposals proposal
  JOIN evidence_events event
    ON event.household_id = proposal.household_id
    AND event.company_id = proposal.company_id
    AND event.status IN ('accepted', 'scenario_only')
  WHERE proposal.id = NEW.proposal_id
    AND proposal.household_id = NEW.household_id
    AND event.id = NEW.evidence_event_id
    AND event.household_id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'signal update proposal evidence mismatch');
END;

CREATE TRIGGER signal_update_proposals_no_update
BEFORE UPDATE ON signal_update_proposals
BEGIN
  SELECT RAISE(ABORT, 'signal update proposals are immutable');
END;

CREATE TRIGGER signal_update_proposals_no_delete
BEFORE DELETE ON signal_update_proposals
BEGIN
  SELECT RAISE(ABORT, 'signal update proposals are immutable');
END;

CREATE TRIGGER signal_update_proposal_evidence_no_update
BEFORE UPDATE ON signal_update_proposal_evidence
BEGIN
  SELECT RAISE(ABORT, 'signal update proposal evidence is immutable');
END;

CREATE TRIGGER signal_update_proposal_evidence_no_delete
BEFORE DELETE ON signal_update_proposal_evidence
BEGIN
  SELECT RAISE(ABORT, 'signal update proposal evidence is immutable');
END;
