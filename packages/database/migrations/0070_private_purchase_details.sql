-- Optional, versioned per-position purchase details. Current heads keep reads
-- independent of purchase-review history. Original imports remain untouched.
CREATE TABLE holding_purchase_reviews (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  position_id TEXT NOT NULL REFERENCES holding_positions(id),
  snapshot_id TEXT NOT NULL REFERENCES holding_position_snapshots(id),
  prior_id TEXT REFERENCES holding_purchase_reviews(id),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT NOT NULL,
  CHECK(json_extract(receipt_json,'$.id') IS id),
  CHECK(json_extract(receipt_json,'$.positionId') IS position_id),
  CHECK(json_extract(receipt_json,'$.snapshotId') IS snapshot_id),
  CHECK(json_extract(receipt_json,'$.acceptedAt') IS accepted_at),
  CHECK(json_extract(receipt_json,'$.currency') IS 'USD')
);
CREATE INDEX holding_purchase_reviews_position ON holding_purchase_reviews(household_id,position_id,accepted_at,id);
CREATE TABLE holding_purchase_heads (
  position_id TEXT PRIMARY KEY REFERENCES holding_positions(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  review_id TEXT NOT NULL UNIQUE REFERENCES holding_purchase_reviews(id)
);
CREATE INDEX holding_purchase_heads_household ON holding_purchase_heads(household_id,position_id);
CREATE TRIGGER holding_purchase_review_guard BEFORE INSERT ON holding_purchase_reviews BEGIN
  -- Remote D1 misparses unparenthesized CASE..END inside triggers (#4727).
  SELECT RAISE(ABORT,'purchase provenance mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions p JOIN households h ON h.id=p.household_id
    JOIN holding_position_snapshots s ON s.position_id=p.id
    WHERE p.id=NEW.position_id AND p.household_id=NEW.household_id
      AND p.position_kind='spv_interest' AND p.currency='USD'
      AND h.owner_user_id=NEW.reviewer_user_id AND s.id=NEW.snapshot_id
      AND NOT EXISTS (SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id=p.id)
  );
  SELECT RAISE(ABORT,'purchase review stale') WHERE NEW.prior_id IS NOT
    (SELECT review_id FROM holding_purchase_heads WHERE position_id=NEW.position_id);
  SELECT RAISE(ABORT,'purchase snapshot stale') WHERE NEW.snapshot_id IS NOT (
    SELECT a.snapshot_id FROM holding_import_applications a
    JOIN holding_position_snapshots s ON s.id=a.snapshot_id
    WHERE a.position_id=NEW.position_id
    ORDER BY a.applied_at DESC,s.observed_at DESC,a.id DESC LIMIT 1
  );
END;
CREATE TRIGGER holding_purchase_review_head AFTER INSERT ON holding_purchase_reviews BEGIN
  INSERT INTO holding_purchase_heads(position_id,household_id,review_id)
  VALUES(NEW.position_id,NEW.household_id,NEW.id)
  ON CONFLICT(position_id) DO UPDATE SET review_id=NEW.id;
END;
CREATE TRIGGER holding_purchase_reviews_no_update BEFORE UPDATE ON holding_purchase_reviews BEGIN SELECT RAISE(ABORT,'purchase reviews are immutable'); END;
CREATE TRIGGER holding_purchase_reviews_no_delete BEFORE DELETE ON holding_purchase_reviews BEGIN SELECT RAISE(ABORT,'purchase reviews are immutable'); END;
