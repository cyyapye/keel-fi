-- Explicit source equivalence and replacement decisions; heads are derived state.
CREATE TABLE holding_position_link_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  source_position_id TEXT NOT NULL REFERENCES holding_positions(id),
  target_position_id TEXT NOT NULL REFERENCES holding_positions(id),
  source_snapshot_id TEXT NOT NULL REFERENCES holding_position_snapshots(id),
  target_snapshot_id TEXT NOT NULL REFERENCES holding_position_snapshots(id),
  source_participation_review_id TEXT,
  target_participation_review_id TEXT,
  prior_id TEXT UNIQUE REFERENCES holding_position_link_reviews(id),
  relationship TEXT NOT NULL CHECK(relationship IN ('same_investment','replaced')),
  state TEXT NOT NULL CHECK(state IN ('linked','unlinked')),
  use_source_value INTEGER NOT NULL CHECK(use_source_value IN (0,1)),
  note TEXT NOT NULL,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT NOT NULL,
  CHECK(source_position_id <> target_position_id),
  CHECK(relationship <> 'replaced' OR use_source_value = 0)
);
CREATE INDEX holding_position_link_reviews_history ON holding_position_link_reviews(household_id,source_position_id,accepted_at,id);
CREATE TABLE holding_position_link_heads (
  source_position_id TEXT PRIMARY KEY REFERENCES holding_positions(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  target_position_id TEXT NOT NULL REFERENCES holding_positions(id),
  review_id TEXT NOT NULL UNIQUE REFERENCES holding_position_link_reviews(id),
  state TEXT NOT NULL CHECK(state IN ('linked','unlinked')),
  use_source_value INTEGER NOT NULL CHECK(use_source_value IN (0,1))
);
CREATE INDEX holding_position_link_heads_target ON holding_position_link_heads(household_id,target_position_id,state);
CREATE UNIQUE INDEX holding_position_link_one_value ON holding_position_link_heads(target_position_id) WHERE state='linked' AND use_source_value=1;
CREATE TRIGGER holding_position_link_guard BEFORE INSERT ON holding_position_link_reviews BEGIN
  SELECT RAISE(ABORT,'position link provenance mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions s JOIN holding_positions t ON t.household_id=s.household_id
    JOIN households h ON h.id=s.household_id
    WHERE s.id=NEW.source_position_id AND t.id=NEW.target_position_id AND h.id=NEW.household_id
      AND h.owner_user_id=NEW.reviewer_user_id AND s.currency=t.currency
      AND s.provider IN ('angellist','tokenfolio','sydecar') AND t.provider IN ('angellist','tokenfolio','sydecar')
      AND t.position_kind='spv_interest'
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
CREATE TRIGGER holding_position_link_head AFTER INSERT ON holding_position_link_reviews BEGIN
  INSERT INTO holding_position_link_heads(source_position_id,household_id,target_position_id,review_id,state,use_source_value)
  VALUES(NEW.source_position_id,NEW.household_id,NEW.target_position_id,NEW.id,NEW.state,NEW.use_source_value)
  ON CONFLICT(source_position_id) DO UPDATE SET target_position_id=NEW.target_position_id,review_id=NEW.id,state=NEW.state,use_source_value=NEW.use_source_value;
END;
CREATE TRIGGER holding_position_link_no_update BEFORE UPDATE ON holding_position_link_reviews BEGIN SELECT RAISE(ABORT,'position links are immutable'); END;
CREATE TRIGGER holding_position_link_no_delete BEFORE DELETE ON holding_position_link_reviews BEGIN SELECT RAISE(ABORT,'position links are immutable'); END;
