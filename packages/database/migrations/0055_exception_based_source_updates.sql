-- The same evidence and household checks apply to every holdings provider.
DROP TRIGGER holding_import_quarantines_integrity_insert;
CREATE TRIGGER holding_import_quarantines_integrity_insert
BEFORE INSERT ON holding_import_quarantines
BEGIN
  SELECT RAISE(ABORT, 'holding import quarantine import mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM holding_imports import
    WHERE import.id = NEW.import_id AND import.household_id = NEW.household_id
  );
  SELECT RAISE(ABORT, 'holding import quarantine row mismatch')
  WHERE NEW.import_row_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM holding_import_rows row
    WHERE row.id = NEW.import_row_id AND row.import_id = NEW.import_id
      AND row.household_id = NEW.household_id
  );
  SELECT RAISE(ABORT, 'holding import quarantine position mismatch')
  WHERE NEW.position_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM holding_positions position
    JOIN holding_imports import ON import.id = NEW.import_id
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
      AND position.provider = import.provider
  );
END;

CREATE INDEX holding_position_snapshots_observed_idx
  ON holding_position_snapshots(position_id, observed_at DESC);

CREATE TRIGGER private_holding_policy_stale_insert
BEFORE INSERT ON holding_import_row_decisions
WHEN NEW.decision_source = 'policy' AND NEW.decision = 'accepted'
  AND NEW.policy_version = 'private-holdings-auto-v1'
BEGIN
  SELECT RAISE(ABORT, 'newer holding observation already accepted') WHERE EXISTS (
    SELECT 1 FROM holding_position_snapshots snapshot
    JOIN holding_import_rows row ON row.id = NEW.import_row_id
    JOIN holding_imports import ON import.id = row.import_id
    JOIN source_documents document ON document.id = import.source_document_id
    WHERE snapshot.position_id = NEW.matched_position_id
      AND snapshot.observed_at > COALESCE(document.effective_date || 'T00:00:00.000Z', document.retrieved_at)
  );
END;

CREATE TABLE portfolio_baseline_policy_decisions (
  baseline_id TEXT PRIMARY KEY NOT NULL REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  prior_baseline_id TEXT NOT NULL REFERENCES portfolio_baselines(id) ON DELETE RESTRICT,
  policy_version TEXT NOT NULL CHECK (policy_version = 'accepted-sources-auto-v1')
);
CREATE TRIGGER portfolio_baseline_policy_decisions_integrity
BEFORE INSERT ON portfolio_baseline_policy_decisions
BEGIN
  SELECT RAISE(ABORT, 'baseline policy household mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM portfolio_baselines current
    JOIN portfolio_baselines prior ON prior.household_id = current.household_id
    WHERE current.id = NEW.baseline_id AND prior.id = NEW.prior_baseline_id
      AND current.id <> prior.id
  );
END;
CREATE TRIGGER portfolio_baseline_policy_decisions_no_update
BEFORE UPDATE ON portfolio_baseline_policy_decisions
BEGIN SELECT RAISE(ABORT, 'baseline policy decisions are immutable'); END;
CREATE TRIGGER portfolio_baseline_policy_decisions_no_delete
BEFORE DELETE ON portfolio_baseline_policy_decisions
BEGIN SELECT RAISE(ABORT, 'baseline policy decisions are immutable'); END;
