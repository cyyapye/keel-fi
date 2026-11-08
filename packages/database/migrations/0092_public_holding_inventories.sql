-- Replace the existing scope index instead of maintaining a redundant index on
-- each accepted ownership. Household/account scans retain their leading keys.
DROP INDEX holding_position_ownerships_household_container_idx;
CREATE INDEX holding_position_ownerships_household_container_idx ON holding_position_ownerships(household_id,container_id,protected_position_key);

-- Source status is separate from the original holdings response and historical
-- prices. An unverified/legacy capture cannot assert negative ownership.
CREATE TABLE public_holding_inventory_evidence (
  import_id TEXT PRIMARY KEY NOT NULL REFERENCES holding_imports(id),
  status_document_id TEXT NOT NULL UNIQUE REFERENCES source_documents(id),
  holdings_object_key TEXT NOT NULL CHECK(length(holdings_object_key) BETWEEN 1 AND 1024),
  holdings_sha256 TEXT NOT NULL CHECK(length(holdings_sha256)=64),
  holdings_byte_size INTEGER NOT NULL CHECK(holdings_byte_size BETWEEN 1 AND 5242880),
  zero_cash_containers_json TEXT NOT NULL CHECK(json_valid(zero_cash_containers_json) AND json_type(zero_cash_containers_json)='array' AND json_array_length(zero_cash_containers_json)<=100),
  source_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  policy_version TEXT NOT NULL CHECK(policy_version='public-holding-inventory-v1')
) WITHOUT ROWID;
CREATE TRIGGER public_inventory_evidence_guard BEFORE INSERT ON public_holding_inventory_evidence BEGIN
  SELECT RAISE(ABORT,'inventory evidence scope mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM holding_imports i JOIN source_documents d ON d.id=i.source_document_id
    JOIN source_documents status ON status.id=NEW.status_document_id
    WHERE i.id=NEW.import_id AND i.provider='plaid_investments'
      AND status.household_id=i.household_id AND status.content_type='application/json'
      AND status.id=d.id AND status.byte_size<=131072 AND status.retrieved_at=d.retrieved_at
      AND NEW.source_updated_at<=d.retrieved_at
  );
END;
CREATE TRIGGER public_inventory_evidence_no_update BEFORE UPDATE ON public_holding_inventory_evidence BEGIN SELECT RAISE(ABORT,'inventory evidence is immutable'); END;
CREATE TRIGGER public_inventory_evidence_no_delete BEFORE DELETE ON public_holding_inventory_evidence BEGIN SELECT RAISE(ABORT,'inventory evidence is immutable'); END;

CREATE TABLE public_holding_inventories (
  import_id TEXT PRIMARY KEY NOT NULL REFERENCES holding_imports(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  source_updated_at TEXT NOT NULL,
  expected_source_version INTEGER NOT NULL CHECK(expected_source_version>=0),
  change_count INTEGER NOT NULL CHECK(change_count BETWEEN 0 AND 1000),
  container_ids_json TEXT NOT NULL CHECK(json_valid(container_ids_json) AND json_type(container_ids_json)='array' AND json_array_length(container_ids_json) BETWEEN 1 AND 100),
  prior_snapshots_json TEXT NOT NULL CHECK(json_valid(prior_snapshots_json) AND json_type(prior_snapshots_json)='array' AND json_array_length(prior_snapshots_json)<=500),
  closed_positions_json TEXT NOT NULL CHECK(json_valid(closed_positions_json) AND json_type(closed_positions_json)='array' AND json_array_length(closed_positions_json)<=500),
  returned_position_ids_json TEXT NOT NULL CHECK(json_valid(returned_position_ids_json) AND json_type(returned_position_ids_json)='array' AND json_array_length(returned_position_ids_json)<=500),
  policy_version TEXT NOT NULL CHECK(policy_version='public-holding-inventory-v1'),
  accepted_by_user_id TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX public_inventory_household ON public_holding_inventories(household_id,accepted_at,import_id);
CREATE INDEX public_inventory_user ON public_holding_inventories(accepted_by_user_id);

CREATE TABLE public_holding_account_inventory_heads (
  container_id TEXT PRIMARY KEY NOT NULL REFERENCES ownership_containers(id),
  inventory_id TEXT NOT NULL REFERENCES public_holding_inventories(import_id),
  source_updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX public_inventory_head_receipt ON public_holding_account_inventory_heads(inventory_id);

-- Drive current collections from active keys, rather than visiting all closed
-- securities accumulated over a household's history.
CREATE TABLE public_holding_active_positions (
  position_id TEXT PRIMARY KEY NOT NULL REFERENCES holding_positions(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  container_id TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX public_active_household ON public_holding_active_positions(household_id,container_id,position_id);
INSERT INTO public_holding_active_positions SELECT position_id,household_id,container_id FROM public_holding_security_heads;
CREATE TRIGGER public_active_security_insert AFTER INSERT ON public_holding_security_heads
BEGIN INSERT OR IGNORE INTO public_holding_active_positions VALUES(NEW.position_id,NEW.household_id,NEW.container_id); END;

CREATE TRIGGER public_active_scope_guard BEFORE INSERT ON public_holding_active_positions BEGIN
  SELECT RAISE(ABORT,'active security scope mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM public_holding_security_heads k WHERE k.position_id=NEW.position_id
      AND k.household_id=NEW.household_id AND k.container_id=NEW.container_id);
END;

DROP INDEX holding_positions_household_id_idx;
CREATE INDEX holding_positions_household_id_idx ON holding_positions(household_id,provider,id);

CREATE TRIGGER public_inventory_guard BEFORE INSERT ON public_holding_inventories BEGIN
  SELECT RAISE(ABORT,'inventory source graph changed') WHERE NEW.expected_source_version<>
    COALESCE((SELECT version FROM public_holding_source_versions WHERE household_id=NEW.household_id),0);
  SELECT RAISE(ABORT,'inventory source is stale') WHERE EXISTS(
    SELECT 1 FROM holding_import_coverages c JOIN public_holding_account_inventory_heads h ON h.container_id=c.container_id
    WHERE c.import_id=NEW.import_id AND c.container_id IN(SELECT value FROM json_each(NEW.container_ids_json)) AND h.source_updated_at>=NEW.source_updated_at
  );
  SELECT RAISE(ABORT,'newer accepted ownership already exists') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.container_ids_json) selected
    JOIN public_holding_active_positions active ON active.household_id=NEW.household_id AND active.container_id=selected.value
    JOIN holding_import_application_heads a ON a.position_id=active.position_id
    JOIN holding_import_applications application ON application.id=a.application_id
    JOIN holding_import_rows row ON row.id=application.import_row_id
    WHERE row.import_id<>NEW.import_id AND a.source_updated_at>=NEW.source_updated_at);
  SELECT RAISE(ABORT,'inventory source provenance mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM public_holding_inventory_evidence e
    JOIN holding_import_coverages c ON c.import_id=e.import_id AND c.completeness='complete'
    JOIN holding_import_connections connection ON connection.import_id=e.import_id
    JOIN public_holding_import_heads latest ON latest.connection_id=connection.connection_id AND latest.import_id=e.import_id
    JOIN ownership_containers account ON account.id=c.container_id AND account.connection_id=connection.connection_id
    JOIN households household ON household.id=NEW.household_id AND household.owner_user_id=NEW.accepted_by_user_id
    WHERE e.import_id=NEW.import_id AND e.source_updated_at=NEW.source_updated_at
      AND account.household_id=NEW.household_id
      AND account.id IN(SELECT value FROM json_each(NEW.container_ids_json))
  );
  SELECT RAISE(ABORT,'inventory account scope mismatch') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.container_ids_json) selected WHERE selected.type<>'text' OR NOT EXISTS(
      SELECT 1 FROM holding_import_coverages c JOIN ownership_containers account ON account.id=c.container_id
      JOIN holding_import_connections link ON link.import_id=c.import_id AND link.connection_id=account.connection_id
      WHERE c.import_id=NEW.import_id AND c.container_id=selected.value AND c.completeness='complete' AND account.household_id=NEW.household_id))
    OR (SELECT COUNT(*) FROM json_each(NEW.container_ids_json))<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.container_ids_json));
  SELECT RAISE(ABORT,'inventory duplicate transition') WHERE
    (SELECT COUNT(*) FROM json_each(NEW.closed_positions_json))<>(SELECT COUNT(DISTINCT json_extract(value,'$.positionId')) FROM json_each(NEW.closed_positions_json)) OR
    (SELECT COUNT(*) FROM json_each(NEW.returned_position_ids_json))<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.returned_position_ids_json));
  SELECT RAISE(ABORT,'inventory cash coverage unavailable') WHERE EXISTS(
    SELECT 1 FROM holding_import_coverages c WHERE c.import_id=NEW.import_id AND c.container_id IN(SELECT value FROM json_each(NEW.container_ids_json))
      AND NOT EXISTS(SELECT 1 FROM holding_import_rows r JOIN holding_import_row_containers scope ON scope.import_row_id=r.id
        WHERE r.import_id=NEW.import_id AND scope.container_id=c.container_id AND r.instrument_type='cash' AND r.parse_status='ready')
      AND NOT EXISTS(SELECT 1 FROM public_holding_inventory_evidence e,json_each(e.zero_cash_containers_json) zero WHERE e.import_id=NEW.import_id AND zero.value=c.container_id));
  SELECT RAISE(ABORT,'zero inventory contains holdings rows') WHERE EXISTS(
    SELECT 1 FROM public_holding_inventory_evidence e,json_each(e.zero_cash_containers_json) zero
    WHERE e.import_id=NEW.import_id AND zero.value IN(SELECT value FROM json_each(NEW.container_ids_json))
      AND EXISTS(SELECT 1 FROM holding_import_rows r JOIN holding_import_row_containers c ON c.import_row_id=r.id WHERE r.import_id=NEW.import_id AND c.container_id=zero.value));
  SELECT RAISE(ABORT,'inventory contains unaccepted source rows') WHERE EXISTS(
    SELECT 1 FROM holding_import_row_containers c JOIN holding_import_rows r ON r.id=c.import_row_id
    WHERE r.import_id=NEW.import_id AND c.container_id IN(SELECT value FROM json_each(NEW.container_ids_json))
      AND (r.parse_status<>'ready' OR r.currency_hint<>'USD' OR (NOT EXISTS(SELECT 1 FROM holding_import_row_decisions d WHERE d.import_row_id=r.id AND d.decision='accepted')
        AND NOT EXISTS(SELECT 1 FROM public_holding_source_heads h JOIN public_holding_source_reviews review ON review.id=h.review_id
          WHERE h.review_key=c.container_id||':'||r.position_fingerprint AND h.household_id=NEW.household_id
            AND h.position_id IS NOT NULL AND h.decision='ignore' AND review.decision_source='manual')))
  );
  SELECT RAISE(ABORT,'inventory prior snapshot scope mismatch') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.prior_snapshots_json) item
    LEFT JOIN holding_import_rows r ON r.id=json_extract(item.value,'$.rowId')
    LEFT JOIN holding_import_row_containers c ON c.import_row_id=r.id
    LEFT JOIN holding_position_snapshots snapshot ON snapshot.id=json_extract(item.value,'$.snapshotId')
    LEFT JOIN public_holding_security_heads k ON k.position_id=snapshot.position_id
    WHERE r.import_id IS NOT NEW.import_id OR snapshot.household_id IS NOT NEW.household_id OR k.container_id IS NOT c.container_id
      OR c.container_id NOT IN(SELECT value FROM json_each(NEW.container_ids_json)));
  SELECT RAISE(ABORT,'inventory closed snapshot changed') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.closed_positions_json) item
    LEFT JOIN public_holding_security_heads k ON k.position_id=json_extract(item.value,'$.positionId')
    LEFT JOIN holding_import_application_heads a ON a.position_id=k.position_id
    WHERE k.household_id IS NOT NEW.household_id OR k.container_id NOT IN(SELECT value FROM json_each(NEW.container_ids_json)) OR NOT EXISTS(SELECT 1 FROM holding_import_coverages c WHERE c.import_id=NEW.import_id AND c.container_id=k.container_id AND c.completeness='complete')
      OR a.snapshot_id IS NOT json_extract(item.value,'$.snapshotId') OR a.application_id IS NOT json_extract(item.value,'$.applicationId')
      OR EXISTS(SELECT 1 FROM holding_import_rows r JOIN holding_import_row_containers c ON c.import_row_id=r.id
        WHERE r.import_id=NEW.import_id AND c.container_id=k.container_id
          AND r.position_fingerprint=(SELECT protected_position_key FROM holding_position_ownerships WHERE position_id=k.position_id AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=holding_position_ownerships.id)))
  );
  SELECT RAISE(ABORT,'inventory return is not reported') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.returned_position_ids_json) item
    LEFT JOIN public_holding_security_heads k ON k.position_id=item.value
    WHERE k.household_id IS NOT NEW.household_id OR k.container_id NOT IN(SELECT value FROM json_each(NEW.container_ids_json)) OR NOT EXISTS(SELECT 1 FROM holding_import_coverages c WHERE c.import_id=NEW.import_id AND c.container_id=k.container_id AND c.completeness='complete')
      OR NOT EXISTS(SELECT 1 FROM holding_import_application_heads a JOIN holding_import_applications application ON application.id=a.application_id JOIN holding_import_rows r ON r.id=application.import_row_id WHERE a.position_id=k.position_id AND r.import_id=NEW.import_id)
  );
END;
CREATE TRIGGER public_inventory_apply AFTER INSERT ON public_holding_inventories BEGIN
  INSERT INTO public_holding_account_inventory_heads SELECT c.container_id,NEW.import_id,NEW.source_updated_at FROM holding_import_coverages c WHERE c.import_id=NEW.import_id AND c.container_id IN(SELECT value FROM json_each(NEW.container_ids_json))
    ON CONFLICT(container_id) DO UPDATE SET inventory_id=excluded.inventory_id,source_updated_at=excluded.source_updated_at;
  DELETE FROM public_holding_active_positions
    WHERE household_id=NEW.household_id AND container_id IN(SELECT value FROM json_each(NEW.container_ids_json))
      AND position_id NOT IN(SELECT a.position_id FROM holding_import_rows r JOIN holding_import_applications a ON a.import_row_id=r.id WHERE r.import_id=NEW.import_id);
  INSERT OR IGNORE INTO public_holding_active_positions
    SELECT a.position_id,NEW.household_id,c.container_id FROM holding_import_rows r
    JOIN holding_import_applications a ON a.import_row_id=r.id JOIN holding_import_row_containers c ON c.import_row_id=r.id WHERE r.import_id=NEW.import_id AND c.container_id IN(SELECT value FROM json_each(NEW.container_ids_json));
  INSERT INTO public_holding_source_versions VALUES(NEW.household_id,1)
    ON CONFLICT(household_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER public_inventory_no_update BEFORE UPDATE ON public_holding_inventories BEGIN SELECT RAISE(ABORT,'accepted inventories are immutable'); END;
CREATE TRIGGER public_inventory_no_delete BEFORE DELETE ON public_holding_inventories BEGIN SELECT RAISE(ABORT,'accepted inventories are immutable'); END;

-- Identity continuity keeps the existing reviewed v4 rules. Financial updates
-- use v5, with an additional source watermark guard for certified inventories.
CREATE TRIGGER public_holding_policy_v5_guard BEFORE INSERT ON holding_import_row_decisions
WHEN NEW.decision_source='policy' AND NEW.decision='accepted' AND NEW.policy_version='plaid-investments-holdings-auto-v5'
BEGIN
  SELECT RAISE(ABORT,'public source policy report changed') WHERE NOT EXISTS(
    SELECT 1 FROM holding_import_rows r JOIN holding_imports i ON i.id=r.import_id
    JOIN holding_import_connections c ON c.import_id=i.id
    JOIN holding_import_row_containers row_scope ON row_scope.import_row_id=r.id
    JOIN holding_import_coverages coverage ON coverage.import_id=i.id AND coverage.container_id=row_scope.container_id AND coverage.completeness='complete'
    JOIN public_holding_import_heads h ON h.connection_id=c.connection_id AND h.import_id=i.id
    WHERE r.id=NEW.import_row_id AND i.household_id=NEW.household_id AND i.provider='plaid_investments'
      AND r.parse_status='ready' AND r.currency_hint='USD' AND NEW.currency='USD'
  );
  SELECT RAISE(ABORT,'newer holding observation already accepted') WHERE EXISTS(
    SELECT 1 FROM holding_import_rows r JOIN holding_imports i ON i.id=r.import_id
    JOIN source_documents d ON d.id=i.source_document_id
    JOIN holding_import_application_heads a ON a.position_id=NEW.matched_position_id
    JOIN holding_position_snapshots s ON s.id=a.snapshot_id
    WHERE r.id=NEW.import_row_id AND NOT EXISTS(SELECT 1 FROM public_holding_inventory_evidence e WHERE e.import_id=i.id) AND s.observed_at>COALESCE(d.effective_date||'T00:00:00.000Z',d.retrieved_at)
  );
  SELECT RAISE(ABORT,'public source policy identity changed') WHERE EXISTS(
    SELECT 1 FROM holding_import_rows r JOIN public_holding_security_heads k ON k.position_id=NEW.matched_position_id
    WHERE r.id=NEW.import_row_id AND (k.instrument_type<>r.instrument_type OR
      (k.identity_key IS NOT NULL AND r.protected_exposure_key IS NOT NULL AND
        (k.identity_key<>r.protected_exposure_key OR k.identity_kind<>r.public_exposure_identity_kind)))
  );
END;

CREATE TRIGGER public_holding_inventory_row_guard BEFORE INSERT ON holding_import_row_decisions
WHEN NEW.decision_source='policy' AND NEW.decision='accepted' AND NEW.policy_version='plaid-investments-holdings-auto-v5'
BEGIN
  SELECT RAISE(ABORT,'newer account inventory already accepted') WHERE EXISTS(
    SELECT 1 FROM holding_import_rows r JOIN holding_import_row_containers c ON c.import_row_id=r.id
    JOIN public_holding_inventory_evidence e ON e.import_id=r.import_id
    LEFT JOIN public_holding_account_inventory_heads h ON h.container_id=c.container_id
    LEFT JOIN holding_import_application_heads a ON a.position_id=NEW.matched_position_id
    WHERE r.id=NEW.import_row_id AND (h.source_updated_at>=e.source_updated_at OR a.source_updated_at>=e.source_updated_at)
  );
END;

-- Retain the original accepted identity proof when the verified identity is unchanged.
DROP TRIGGER public_holding_security_head;
DROP TRIGGER public_holding_security_head_update;
CREATE TRIGGER public_holding_security_head AFTER INSERT ON holding_import_application_heads
WHEN EXISTS(SELECT 1 FROM holding_positions WHERE id=NEW.position_id AND provider='plaid_investments')
BEGIN
  INSERT INTO public_holding_security_heads
  SELECT p.id,p.household_id,o.container_id,r.public_exposure_identity_kind,r.protected_exposure_key,CASE WHEN r.protected_exposure_key IS NOT NULL THEN r.id END,s.instrument_type,s.currency
  FROM holding_positions p JOIN holding_position_snapshots s ON s.id=NEW.snapshot_id
  JOIN holding_import_rows r ON r.id=s.source_import_row_id
  JOIN holding_position_ownerships o ON o.position_id=p.id
  WHERE p.id=NEW.position_id AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=o.id)
  ON CONFLICT(position_id) DO UPDATE SET
    identity_kind=COALESCE(excluded.identity_kind,public_holding_security_heads.identity_kind),
    identity_key=COALESCE(excluded.identity_key,public_holding_security_heads.identity_key),
    identity_row_id=COALESCE(excluded.identity_row_id,public_holding_security_heads.identity_row_id),
    instrument_type=excluded.instrument_type,currency=excluded.currency
  WHERE (excluded.identity_key IS NOT NULL AND
    (excluded.identity_key IS NOT public_holding_security_heads.identity_key OR excluded.identity_kind IS NOT public_holding_security_heads.identity_kind))
    OR excluded.instrument_type<>public_holding_security_heads.instrument_type
    OR excluded.currency<>public_holding_security_heads.currency;
END;
CREATE TRIGGER public_holding_security_head_update AFTER UPDATE ON holding_import_application_heads
WHEN EXISTS(SELECT 1 FROM holding_positions WHERE id=NEW.position_id AND provider='plaid_investments')
BEGIN
  INSERT INTO public_holding_security_heads
  SELECT p.id,p.household_id,o.container_id,r.public_exposure_identity_kind,r.protected_exposure_key,CASE WHEN r.protected_exposure_key IS NOT NULL THEN r.id END,s.instrument_type,s.currency
  FROM holding_positions p JOIN holding_position_snapshots s ON s.id=NEW.snapshot_id
  JOIN holding_import_rows r ON r.id=s.source_import_row_id
  JOIN holding_position_ownerships o ON o.position_id=p.id
  WHERE p.id=NEW.position_id AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=o.id)
  ON CONFLICT(position_id) DO UPDATE SET
    identity_kind=COALESCE(excluded.identity_kind,public_holding_security_heads.identity_kind),
    identity_key=COALESCE(excluded.identity_key,public_holding_security_heads.identity_key),
    identity_row_id=COALESCE(excluded.identity_row_id,public_holding_security_heads.identity_row_id),
    instrument_type=excluded.instrument_type,currency=excluded.currency
  WHERE (excluded.identity_key IS NOT NULL AND
    (excluded.identity_key IS NOT public_holding_security_heads.identity_key OR excluded.identity_kind IS NOT public_holding_security_heads.identity_kind))
    OR excluded.instrument_type<>public_holding_security_heads.instrument_type
    OR excluded.currency<>public_holding_security_heads.currency;
END;


-- Cache accepted source time on the existing application head. This backfills
-- only current heads from their accepted import, never scans snapshot history.
ALTER TABLE holding_import_application_heads ADD COLUMN source_updated_at TEXT;
UPDATE holding_import_application_heads SET source_updated_at=(
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ',document.retrieved_at) FROM holding_import_applications application
  JOIN holding_import_rows row ON row.id=application.import_row_id
  JOIN holding_imports report ON report.id=row.import_id
  JOIN source_documents document ON document.id=report.source_document_id
  WHERE application.id=holding_import_application_heads.application_id
) WHERE EXISTS(SELECT 1 FROM public_holding_security_heads security WHERE security.position_id=holding_import_application_heads.position_id);
DROP TRIGGER holding_import_application_head;
CREATE TRIGGER holding_import_application_head AFTER INSERT ON holding_import_applications BEGIN
  INSERT INTO holding_import_application_heads(position_id,application_id,snapshot_id,applied_at,observed_at,source_updated_at)
  SELECT NEW.position_id,NEW.id,NEW.snapshot_id,NEW.applied_at,s.observed_at,
    CASE WHEN (SELECT provider FROM holding_positions WHERE id=NEW.position_id)='plaid_investments' THEN (
      SELECT COALESCE(e.source_updated_at,strftime('%Y-%m-%dT%H:%M:%fZ',d.retrieved_at)) FROM holding_import_rows r
      JOIN holding_imports i ON i.id=r.import_id JOIN source_documents d ON d.id=i.source_document_id
      LEFT JOIN public_holding_inventory_evidence e ON e.import_id=i.id WHERE r.id=NEW.import_row_id
    ) END
  FROM holding_position_snapshots s WHERE s.id=NEW.snapshot_id
  ON CONFLICT(position_id) DO UPDATE SET application_id=excluded.application_id,snapshot_id=excluded.snapshot_id,applied_at=excluded.applied_at,observed_at=excluded.observed_at,source_updated_at=excluded.source_updated_at
    WHERE (excluded.applied_at,excluded.observed_at,excluded.application_id)>(applied_at,observed_at,application_id);
END;

-- A deliberate correction can override presence for this same inventory.
-- Historical identity edits cannot reactivate a holding absent from a newer report.
CREATE TRIGGER public_inventory_manual_presence AFTER INSERT ON public_holding_source_reviews
WHEN NEW.decision_source='manual' AND NEW.position_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM public_holding_inventories inventory
    WHERE inventory.import_id=(SELECT import_id FROM holding_import_rows WHERE id=NEW.import_row_id))
BEGIN
  INSERT OR IGNORE INTO public_holding_active_positions
  SELECT k.position_id,k.household_id,k.container_id FROM (
    SELECT NEW.position_id position_id WHERE NEW.decision<>'ignore'
    UNION SELECT previous.prior_position_id FROM public_holding_source_reviews previous
      WHERE previous.id=NEW.prior_review_id AND previous.decision='same' AND NEW.decision IN('separate','ignore')
  ) choice CROSS JOIN public_holding_security_heads k ON k.position_id=choice.position_id
  WHERE k.household_id=NEW.household_id AND EXISTS(SELECT 1 FROM holding_import_rows row
    JOIN holding_import_row_containers c ON c.import_row_id=row.id
    JOIN public_holding_account_inventory_heads inventory ON inventory.container_id=c.container_id AND inventory.inventory_id=row.import_id
    WHERE row.id=NEW.import_row_id AND row.household_id=NEW.household_id AND c.container_id=k.container_id);
END;

-- Ownership freshness and a security's source price date are different facts.
-- Legacy rows remain unchanged; certified captures retain their per-row date.
ALTER TABLE holding_import_rows ADD COLUMN public_observed_on TEXT
  CHECK(public_observed_on IS NULL OR (length(public_observed_on)=10 AND date(public_observed_on) IS public_observed_on));
