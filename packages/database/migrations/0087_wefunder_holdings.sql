-- Add the manual Wefunder template; preserve append-only baseline history.
PRAGMA defer_foreign_keys = ON;

DROP TRIGGER portfolio_baseline_items_integrity_insert;
DROP TRIGGER portfolio_baseline_items_no_update;
DROP TRIGGER portfolio_baseline_items_no_delete;

CREATE TABLE portfolio_baseline_items_wefunder (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  baseline_id TEXT NOT NULL
    REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL
    REFERENCES holding_positions(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL
    REFERENCES holding_position_snapshots(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (
    provider IN (
      'angellist', 'tokenfolio', 'sydecar', 'wefunder', 'plaid_investments'
    )
  ),
  classification TEXT NOT NULL CHECK (
    classification IN ('public_market', 'private_paper')
  ),
  value_minor INTEGER CHECK (value_minor IS NULL OR value_minor >= 0),
  value_state TEXT NOT NULL CHECK (
    value_state IN ('reported', 'locked', 'not_reported')
  ),
  observed_at TEXT NOT NULL,
  duplicate_key TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (baseline_id, position_id),
  CHECK (
    (provider = 'plaid_investments' AND classification = 'public_market')
    OR (
      provider IN ('angellist', 'tokenfolio', 'sydecar', 'wefunder')
      AND classification = 'private_paper'
    )
  ),
  CHECK (
    (value_state = 'reported' AND value_minor IS NOT NULL)
    OR (value_state <> 'reported' AND value_minor IS NULL)
  )
);

INSERT INTO portfolio_baseline_items_wefunder (
  id, household_id, baseline_id, position_id, snapshot_id, provider,
  classification, value_minor, value_state, observed_at, duplicate_key,
  created_at
)
SELECT
  id, household_id, baseline_id, position_id, snapshot_id, provider,
  classification, value_minor, value_state, observed_at, duplicate_key,
  created_at
FROM portfolio_baseline_items;

DROP TABLE portfolio_baseline_items;
ALTER TABLE portfolio_baseline_items_wefunder
  RENAME TO portfolio_baseline_items;


CREATE TRIGGER portfolio_baseline_items_integrity_insert
BEFORE INSERT ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline item identity mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM portfolio_baselines baseline
    JOIN holding_positions position
      ON position.household_id = baseline.household_id
    JOIN holding_position_snapshots snapshot
      ON snapshot.position_id = position.id
      AND snapshot.household_id = position.household_id
    WHERE baseline.id = NEW.baseline_id
      AND baseline.household_id = NEW.household_id
      AND position.id = NEW.position_id
      AND snapshot.id = NEW.snapshot_id
      AND position.provider = NEW.provider
  );

  SELECT RAISE(ABORT, 'portfolio baseline item is not an accepted snapshot')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_import_applications application
    WHERE application.household_id = NEW.household_id
      AND application.position_id = NEW.position_id
      AND application.snapshot_id = NEW.snapshot_id
  );
END;

CREATE TRIGGER portfolio_baseline_items_no_update
BEFORE UPDATE ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline items are immutable');
END;

CREATE TRIGGER portfolio_baseline_items_no_delete
BEFORE DELETE ON portfolio_baseline_items
BEGIN
  SELECT RAISE(ABORT, 'portfolio baseline items are immutable');
END;

PRAGMA defer_foreign_keys = OFF;

-- Extend the existing provenance guard without changing its review checks.
DROP TRIGGER holding_position_link_guard;
CREATE TRIGGER holding_position_link_guard BEFORE INSERT ON holding_position_link_reviews BEGIN
  SELECT RAISE(ABORT,'position link provenance mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM holding_positions s JOIN holding_positions t ON t.household_id=s.household_id
    JOIN households h ON h.id=s.household_id
    WHERE s.id=NEW.source_position_id AND t.id=NEW.target_position_id AND h.id=NEW.household_id
      AND h.owner_user_id=NEW.reviewer_user_id AND s.currency=t.currency
      AND s.provider IN ('angellist','tokenfolio','sydecar','wefunder') AND t.provider IN ('angellist','tokenfolio','sydecar','wefunder')
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
