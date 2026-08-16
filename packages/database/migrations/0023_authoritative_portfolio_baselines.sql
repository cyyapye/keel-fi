-- Portfolio Baselines select money from the authoritative accepted-position
-- projection. Preserve existing append-only baselines and tighten only future
-- inserts so an arbitrary observed snapshot can never enter a reviewed plan.
DROP TRIGGER portfolio_baseline_items_integrity_insert;

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
