-- Additive evidence and projections only. Existing financial records are untouched.
CREATE TABLE investment_history_admissions (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES connector_sync_runs(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  connection_id TEXT NOT NULL REFERENCES investment_connections(id),
  utc_day TEXT NOT NULL,
  admitted_at TEXT NOT NULL,
  reserved_writes INTEGER NOT NULL CHECK(reserved_writes BETWEEN 14 AND 4000),
  transaction_limit INTEGER NOT NULL CHECK(transaction_limit BETWEEN 0 AND 250)
) WITHOUT ROWID;
CREATE INDEX investment_history_admission_day ON investment_history_admissions(utc_day,run_id);
CREATE INDEX investment_history_admission_household ON investment_history_admissions(household_id);
CREATE INDEX investment_history_admission_connection ON investment_history_admissions(connection_id);
CREATE TRIGGER investment_history_admission_limit BEFORE INSERT ON investment_history_admissions BEGIN
  SELECT RAISE(ABORT,'investment history daily capacity exhausted')
  WHERE (SELECT COUNT(*) FROM investment_history_admissions WHERE utc_day=NEW.utc_day)>=3;
  SELECT RAISE(ABORT,'investment history write capacity exhausted') WHERE NEW.reserved_writes + COALESCE((
    SELECT SUM(COALESCE(c.write_cost_bound,a.reserved_writes)) FROM investment_history_admissions a
    LEFT JOIN investment_history_captures c ON c.admission_run_id=a.run_id WHERE a.utc_day=NEW.utc_day),0)>4000;
  SELECT RAISE(ABORT,'investment history admission scope mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM investment_connections c WHERE c.id=NEW.connection_id AND c.household_id=NEW.household_id);
END;

CREATE TABLE investment_history_captures (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  connection_id TEXT NOT NULL REFERENCES investment_connections(id),
  import_id TEXT NOT NULL REFERENCES holding_imports(id),
  captured_at TEXT NOT NULL,
  provider_updated_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  policy_version TEXT NOT NULL CHECK(policy_version='investment-history-v1'),
  sequence INTEGER NOT NULL CHECK(sequence>0),
  admission_run_id TEXT REFERENCES investment_history_admissions(run_id),
  write_cost_bound INTEGER NOT NULL CHECK(write_cost_bound>=14)
) WITHOUT ROWID;
CREATE UNIQUE INDEX investment_history_capture_admission ON investment_history_captures(admission_run_id);
CREATE UNIQUE INDEX investment_history_capture_sequence ON investment_history_captures(sequence);
CREATE INDEX investment_history_capture_household ON investment_history_captures(household_id,id);
CREATE INDEX investment_history_capture_connection ON investment_history_captures(connection_id,captured_at,id);
CREATE INDEX investment_history_capture_import ON investment_history_captures(import_id);
CREATE TRIGGER investment_history_capture_scope BEFORE INSERT ON investment_history_captures BEGIN
  SELECT RAISE(ABORT,'investment history reservation mismatch') WHERE NEW.admission_run_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM investment_history_admissions a WHERE a.run_id=NEW.admission_run_id AND a.connection_id=NEW.connection_id AND a.household_id=NEW.household_id AND a.reserved_writes>=NEW.write_cost_bound);
  SELECT RAISE(ABORT,'investment history evidence scope mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM holding_import_connections c WHERE c.import_id=NEW.import_id
      AND c.connection_id=NEW.connection_id AND c.household_id=NEW.household_id);
END;

CREATE TABLE investment_history_accounts (
  capture_id TEXT NOT NULL REFERENCES investment_history_captures(id),
  container_id TEXT NOT NULL REFERENCES ownership_containers(id),
  context_json TEXT NOT NULL CHECK(json_valid(context_json)),
  PRIMARY KEY(capture_id,container_id)
) WITHOUT ROWID;
CREATE INDEX investment_history_account_container ON investment_history_accounts(container_id,capture_id);
CREATE TRIGGER investment_history_account_scope BEFORE INSERT ON investment_history_accounts BEGIN
  SELECT RAISE(ABORT,'investment history account scope mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM ownership_containers a JOIN investment_history_captures c
      ON c.connection_id=a.connection_id AND c.household_id=a.household_id
      WHERE a.id=NEW.container_id AND c.id=NEW.capture_id);
END;
CREATE TABLE investment_history_account_heads (
  container_id TEXT PRIMARY KEY NOT NULL REFERENCES ownership_containers(id),
  capture_id TEXT NOT NULL,
  FOREIGN KEY(capture_id,container_id) REFERENCES investment_history_accounts(capture_id,container_id)
) WITHOUT ROWID;
CREATE INDEX investment_history_account_head_capture ON investment_history_account_heads(capture_id,container_id);

CREATE TABLE investment_history_positions (
  capture_id TEXT NOT NULL REFERENCES investment_history_captures(id),
  position_id TEXT NOT NULL REFERENCES holding_positions(id),
  container_id TEXT NOT NULL REFERENCES ownership_containers(id),
  snapshot_id TEXT NOT NULL REFERENCES holding_position_snapshots(id),
  reconciliation_json TEXT NOT NULL CHECK(json_valid(reconciliation_json)),
  lot_coverage_json TEXT NOT NULL CHECK(json_valid(lot_coverage_json)),
  PRIMARY KEY(capture_id,position_id)
) WITHOUT ROWID;
CREATE INDEX investment_history_position_id ON investment_history_positions(position_id,capture_id);
CREATE INDEX investment_history_position_container ON investment_history_positions(container_id,capture_id);
CREATE INDEX investment_history_position_snapshot ON investment_history_positions(snapshot_id);
CREATE TRIGGER investment_history_position_scope BEFORE INSERT ON investment_history_positions BEGIN
  SELECT RAISE(ABORT,'investment history position scope mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM investment_history_captures c JOIN holding_positions p ON p.household_id=c.household_id
    JOIN holding_position_snapshots s ON s.position_id=p.id AND s.household_id=p.household_id
    JOIN holding_position_ownerships o ON o.position_id=p.id AND o.household_id=p.household_id
    JOIN ownership_containers a ON a.id=o.container_id AND a.connection_id=c.connection_id
    WHERE c.id=NEW.capture_id AND p.id=NEW.position_id AND s.id=NEW.snapshot_id AND a.id=NEW.container_id);
END;

CREATE TABLE investment_transaction_observations (
  id TEXT PRIMARY KEY NOT NULL,
  capture_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  transaction_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  FOREIGN KEY(capture_id,container_id) REFERENCES investment_history_accounts(capture_id,container_id)
) WITHOUT ROWID;
CREATE INDEX investment_transaction_observation_capture ON investment_transaction_observations(capture_id,container_id);
CREATE INDEX investment_transaction_observation_history ON investment_transaction_observations(container_id,transaction_key,capture_id);
CREATE TABLE investment_transaction_heads (
  container_id TEXT NOT NULL REFERENCES ownership_containers(id),
  transaction_key TEXT NOT NULL,
  observation_id TEXT NOT NULL REFERENCES investment_transaction_observations(id),
  position_id TEXT REFERENCES holding_positions(id),
  posted_on TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  last_seen_capture_id TEXT NOT NULL,
  FOREIGN KEY(last_seen_capture_id,container_id) REFERENCES investment_history_accounts(capture_id,container_id),
  PRIMARY KEY(container_id,transaction_key)
) WITHOUT ROWID;
CREATE INDEX investment_transaction_page ON investment_transaction_heads(container_id,posted_on DESC,transaction_key DESC);
CREATE INDEX investment_transaction_position_page ON investment_transaction_heads(container_id,position_id,posted_on DESC,transaction_key DESC);
CREATE INDEX investment_transaction_type_page ON investment_transaction_heads(container_id,transaction_type,posted_on DESC,transaction_key DESC);
CREATE INDEX investment_transaction_position_type_page ON investment_transaction_heads(container_id,position_id,transaction_type,posted_on DESC,transaction_key DESC);
CREATE INDEX investment_transaction_head_last_seen ON investment_transaction_heads(last_seen_capture_id,container_id);
CREATE INDEX investment_transaction_head_observation ON investment_transaction_heads(observation_id);
CREATE INDEX investment_transaction_head_position ON investment_transaction_heads(position_id);
CREATE TRIGGER investment_transaction_head_scope BEFORE INSERT ON investment_transaction_heads BEGIN
  SELECT RAISE(ABORT,'investment transaction scope mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM investment_transaction_observations o WHERE o.id=NEW.observation_id
      AND o.container_id=NEW.container_id AND o.transaction_key=NEW.transaction_key);
  SELECT RAISE(ABORT,'investment transaction position mismatch') WHERE NEW.position_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM holding_position_ownerships o WHERE o.container_id=NEW.container_id AND o.position_id=NEW.position_id);
END;
CREATE TRIGGER investment_transaction_head_update_scope BEFORE UPDATE ON investment_transaction_heads BEGIN
  SELECT RAISE(ABORT,'investment transaction scope mismatch') WHERE NEW.container_id<>OLD.container_id
    OR NEW.transaction_key<>OLD.transaction_key OR NOT EXISTS(
      SELECT 1 FROM investment_transaction_observations o WHERE o.id=NEW.observation_id
        AND o.container_id=NEW.container_id AND o.transaction_key=NEW.transaction_key);
  SELECT RAISE(ABORT,'investment transaction position mismatch') WHERE NEW.position_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM holding_position_ownerships o WHERE o.container_id=NEW.container_id AND o.position_id=NEW.position_id);
END;

CREATE TABLE investment_tax_lots (
  capture_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  basis_rank INTEGER NOT NULL CHECK(basis_rank>=0),
  acquisition_rank INTEGER NOT NULL CHECK(acquisition_rank>=0),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  PRIMARY KEY(capture_id,position_id,basis_rank),
  FOREIGN KEY(capture_id,position_id) REFERENCES investment_history_positions(capture_id,position_id)
) WITHOUT ROWID;
CREATE INDEX investment_tax_lot_acquisition_page ON investment_tax_lots(capture_id,position_id,acquisition_rank);
CREATE INDEX investment_tax_lot_position ON investment_tax_lots(position_id,capture_id);

CREATE TRIGGER investment_history_admissions_no_update BEFORE UPDATE ON investment_history_admissions BEGIN SELECT RAISE(ABORT,'investment history admission is immutable'); END;
CREATE TRIGGER investment_history_admissions_no_delete BEFORE DELETE ON investment_history_admissions BEGIN SELECT RAISE(ABORT,'investment history admission is immutable'); END;
CREATE TRIGGER investment_history_captures_no_update BEFORE UPDATE ON investment_history_captures BEGIN SELECT RAISE(ABORT,'investment history capture is immutable'); END;
CREATE TRIGGER investment_history_captures_no_delete BEFORE DELETE ON investment_history_captures BEGIN SELECT RAISE(ABORT,'investment history capture is immutable'); END;
CREATE TRIGGER investment_history_accounts_no_update BEFORE UPDATE ON investment_history_accounts BEGIN SELECT RAISE(ABORT,'investment history account is immutable'); END;
CREATE TRIGGER investment_history_accounts_no_delete BEFORE DELETE ON investment_history_accounts BEGIN SELECT RAISE(ABORT,'investment history account is immutable'); END;
CREATE TRIGGER investment_history_positions_no_update BEFORE UPDATE ON investment_history_positions BEGIN SELECT RAISE(ABORT,'investment history position is immutable'); END;
CREATE TRIGGER investment_history_positions_no_delete BEFORE DELETE ON investment_history_positions BEGIN SELECT RAISE(ABORT,'investment history position is immutable'); END;
CREATE TRIGGER investment_transaction_observations_no_update BEFORE UPDATE ON investment_transaction_observations BEGIN SELECT RAISE(ABORT,'investment transaction evidence is immutable'); END;
CREATE TRIGGER investment_transaction_observations_no_delete BEFORE DELETE ON investment_transaction_observations BEGIN SELECT RAISE(ABORT,'investment transaction evidence is immutable'); END;
CREATE TRIGGER investment_tax_lots_no_update BEFORE UPDATE ON investment_tax_lots BEGIN SELECT RAISE(ABORT,'investment lot evidence is immutable'); END;
CREATE TRIGGER investment_tax_lots_no_delete BEFORE DELETE ON investment_tax_lots BEGIN SELECT RAISE(ABORT,'investment lot evidence is immutable'); END;
