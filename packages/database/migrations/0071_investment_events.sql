-- Event evidence is separate from portfolio values and legal ownership.
CREATE TABLE investment_event_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  position_id TEXT NOT NULL REFERENCES holding_positions(id),
  event_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_revision_id TEXT UNIQUE REFERENCES investment_event_revisions(id),
  review_id TEXT NOT NULL REFERENCES holding_investment_reviews(id),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  recorded_at TEXT NOT NULL,
  UNIQUE (position_id, event_id, revision)
);
CREATE INDEX investment_event_position_idx ON investment_event_revisions(household_id, position_id, recorded_at DESC, id DESC);
CREATE TRIGGER investment_event_scope BEFORE INSERT ON investment_event_revisions
BEGIN
  SELECT RAISE(ABORT, 'investment event scope mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_investment_reviews r WHERE r.id = NEW.review_id
      AND r.household_id = NEW.household_id AND r.position_id = NEW.position_id
  );
  SELECT RAISE(ABORT, 'investment event supersession mismatch') WHERE
    (NEW.revision = 1 AND NEW.supersedes_revision_id IS NOT NULL)
    OR (NEW.revision > 1 AND NOT EXISTS (
      SELECT 1 FROM investment_event_revisions old WHERE old.id = NEW.supersedes_revision_id
        AND old.household_id = NEW.household_id AND old.position_id = NEW.position_id
        AND old.event_id = NEW.event_id AND old.revision = NEW.revision - 1
    ));
END;
CREATE TRIGGER investment_event_no_update BEFORE UPDATE ON investment_event_revisions
BEGIN SELECT RAISE(ABORT, 'investment events are append only'); END;
CREATE TRIGGER investment_event_no_delete BEFORE DELETE ON investment_event_revisions
BEGIN SELECT RAISE(ABORT, 'investment events are append only'); END;
