CREATE TABLE evidence_applications (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  evidence_event_id TEXT NOT NULL UNIQUE REFERENCES evidence_events(id) ON DELETE RESTRICT,
  review_decision_id TEXT NOT NULL UNIQUE REFERENCES review_decisions(id) ON DELETE RESTRICT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('external_mark', 'usable_liquidity')),
  target_record_id TEXT NOT NULL REFERENCES marks(id) ON DELETE RESTRICT,
  prior_value_json TEXT NOT NULL,
  replacement_value_json TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  applied_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX evidence_applications_household_idx
  ON evidence_applications(household_id, applied_at);

CREATE TRIGGER evidence_applications_no_update
BEFORE UPDATE ON evidence_applications
BEGIN
  SELECT RAISE(ABORT, 'evidence applications are immutable');
END;

CREATE TRIGGER evidence_applications_no_delete
BEFORE DELETE ON evidence_applications
BEGIN
  SELECT RAISE(ABORT, 'evidence applications are immutable');
END;
