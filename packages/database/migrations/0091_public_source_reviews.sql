-- Bound report-local acceptance reads independently of household history.
CREATE INDEX holding_import_rows_household_import_current
  ON holding_import_rows(household_id,import_id,id,position_fingerprint,snapshot_fingerprint)
  WHERE position_kind='direct';

-- Current source identity evidence is maintained with acceptance, not on GET.
CREATE TABLE public_holding_import_heads (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES investment_connections(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  import_id TEXT NOT NULL UNIQUE REFERENCES holding_imports(id),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX public_holding_import_head_household ON public_holding_import_heads(household_id,connection_id);
INSERT INTO public_holding_import_heads
SELECT connection_id,household_id,import_id,observed_at,created_at FROM (
  SELECT c.connection_id,c.household_id,c.import_id,d.retrieved_at observed_at,c.created_at,
    ROW_NUMBER() OVER(PARTITION BY c.connection_id ORDER BY d.retrieved_at DESC,c.created_at DESC,c.import_id DESC) ordinal
  FROM holding_import_connections c JOIN holding_imports i ON i.id=c.import_id
  JOIN source_documents d ON d.id=i.source_document_id WHERE i.provider='plaid_investments'
) WHERE ordinal=1;
CREATE TRIGGER public_holding_import_head AFTER INSERT ON holding_import_connections
WHEN EXISTS(SELECT 1 FROM holding_imports WHERE id=NEW.import_id AND provider='plaid_investments')
BEGIN
  INSERT INTO public_holding_import_heads
  SELECT NEW.connection_id,NEW.household_id,NEW.import_id,d.retrieved_at,NEW.created_at
  FROM holding_imports i JOIN source_documents d ON d.id=i.source_document_id WHERE i.id=NEW.import_id
  ON CONFLICT(connection_id) DO UPDATE SET import_id=excluded.import_id,observed_at=excluded.observed_at,created_at=excluded.created_at
  WHERE (excluded.observed_at,excluded.created_at,excluded.import_id)>
    (public_holding_import_heads.observed_at,public_holding_import_heads.created_at,public_holding_import_heads.import_id);
END;

CREATE TABLE public_holding_security_heads (
  position_id TEXT PRIMARY KEY NOT NULL REFERENCES holding_positions(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  container_id TEXT NOT NULL REFERENCES ownership_containers(id),
  identity_kind TEXT,
  identity_key TEXT,
  identity_row_id TEXT REFERENCES holding_import_rows(id),
  instrument_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  CHECK ((identity_kind IS NULL AND identity_key IS NULL) OR
    (identity_kind IN ('cusip','isin','sedol') AND length(identity_key)=64))
);
CREATE INDEX public_holding_security_match ON public_holding_security_heads(
  household_id,container_id,identity_kind,identity_key,instrument_type,currency,position_id
);
CREATE INDEX public_holding_security_container ON public_holding_security_heads(container_id,position_id);
CREATE INDEX public_holding_security_identity_row ON public_holding_security_heads(identity_row_id);
INSERT INTO public_holding_security_heads
SELECT p.id,p.household_id,o.container_id,r.public_exposure_identity_kind,r.protected_exposure_key,CASE WHEN r.protected_exposure_key IS NOT NULL THEN r.id END,s.instrument_type,s.currency
FROM holding_import_application_heads a
JOIN holding_positions p ON p.id=a.position_id AND p.provider='plaid_investments'
JOIN holding_position_snapshots s ON s.id=a.snapshot_id
JOIN holding_import_rows r ON r.id=s.source_import_row_id
JOIN holding_position_ownerships o ON o.position_id=p.id
WHERE NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=o.id);
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
    instrument_type=excluded.instrument_type,currency=excluded.currency;
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
    instrument_type=excluded.instrument_type,currency=excluded.currency;
END;

CREATE TABLE public_holding_source_versions (
  household_id TEXT PRIMARY KEY NOT NULL REFERENCES households(id),
  version INTEGER NOT NULL CHECK(version>0)
);

CREATE TABLE public_holding_source_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  review_key TEXT NOT NULL,
  import_row_id TEXT NOT NULL REFERENCES holding_import_rows(id),
  position_id TEXT REFERENCES holding_positions(id),
  source_snapshot_id TEXT REFERENCES holding_position_snapshots(id),
  prior_position_id TEXT REFERENCES holding_positions(id),
  prior_snapshot_id TEXT REFERENCES holding_position_snapshots(id),
  prior_review_id TEXT UNIQUE REFERENCES public_holding_source_reviews(id),
  expected_household_version INTEGER NOT NULL CHECK(expected_household_version>=0),
  initial_acceptance INTEGER NOT NULL DEFAULT 0 CHECK(initial_acceptance IN (0,1)),
  decision TEXT NOT NULL CHECK(decision IN ('same','separate','ignore')),
  decision_source TEXT NOT NULL CHECK(decision_source IN ('manual','policy')),
  policy_version TEXT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK((position_id IS NULL AND decision='ignore' AND source_snapshot_id IS NULL)
    OR (position_id IS NOT NULL AND source_snapshot_id IS NOT NULL)),
  CHECK(decision<>'same' OR (prior_position_id IS NOT NULL AND prior_snapshot_id IS NOT NULL AND position_id<>prior_position_id)),
  CHECK((decision_source='manual' AND policy_version IS NULL) OR
    (decision_source='policy' AND decision IN ('same','separate') AND policy_version='plaid-investments-holdings-auto-v4'))
);
CREATE INDEX public_source_review_row ON public_holding_source_reviews(import_row_id,created_at,id);
CREATE INDEX public_source_review_position ON public_holding_source_reviews(position_id,created_at,id);
CREATE INDEX public_source_review_prior_position ON public_holding_source_reviews(prior_position_id);
CREATE INDEX public_source_review_source_snapshot ON public_holding_source_reviews(source_snapshot_id);
CREATE INDEX public_source_review_prior_snapshot ON public_holding_source_reviews(prior_snapshot_id);
CREATE INDEX public_source_review_household ON public_holding_source_reviews(household_id,created_at,id);
CREATE INDEX public_source_review_reviewer ON public_holding_source_reviews(reviewer_user_id);

CREATE TABLE public_holding_source_heads (
  review_key TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  position_id TEXT UNIQUE REFERENCES holding_positions(id),
  import_row_id TEXT NOT NULL REFERENCES holding_import_rows(id),
  review_id TEXT NOT NULL UNIQUE REFERENCES public_holding_source_reviews(id),
  decision TEXT NOT NULL CHECK(decision IN ('same','separate','ignore')),
  prior_position_id TEXT REFERENCES holding_positions(id)
);
CREATE INDEX public_source_head_household ON public_holding_source_heads(household_id,position_id);
CREATE INDEX public_source_head_prior ON public_holding_source_heads(prior_position_id,decision,position_id);
CREATE INDEX public_source_head_row ON public_holding_source_heads(import_row_id);
CREATE INDEX public_source_import_latest ON holding_import_connections(household_id,connection_id,created_at DESC,import_id DESC);

CREATE TRIGGER public_source_review_guard BEFORE INSERT ON public_holding_source_reviews BEGIN
  SELECT RAISE(ABORT,'public source review graph changed') WHERE NEW.expected_household_version<>
    COALESCE((SELECT version FROM public_holding_source_versions WHERE household_id=NEW.household_id),0);
  SELECT RAISE(ABORT,'public source report is obsolete') WHERE NEW.initial_acceptance=1 AND NOT EXISTS(
    SELECT 1 FROM holding_import_rows r JOIN holding_import_connections c ON c.import_id=r.import_id
    JOIN public_holding_import_heads latest ON latest.connection_id=c.connection_id AND latest.import_id=c.import_id
    WHERE r.id=NEW.import_row_id AND latest.household_id=NEW.household_id
  );
  SELECT RAISE(ABORT,'public source review provenance mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM holding_import_rows r JOIN holding_imports i ON i.id=r.import_id
    JOIN households h ON h.id=r.household_id
    WHERE r.id=NEW.import_row_id AND h.id=NEW.household_id AND h.owner_user_id=NEW.reviewer_user_id
      AND i.provider='plaid_investments'
      AND (NEW.review_key=(SELECT container_id||':'||r.position_fingerprint FROM holding_import_row_containers WHERE import_row_id=r.id)
        OR (NEW.position_id IS NULL AND NEW.review_key='report:'||r.id))
      AND ((NEW.position_id IS NULL AND NEW.decision='ignore')
        OR EXISTS(SELECT 1 FROM holding_position_ownerships o
          JOIN holding_import_application_heads a ON a.position_id=o.position_id
          WHERE o.position_id=NEW.position_id AND o.protected_position_key=r.position_fingerprint
            AND o.container_id=(SELECT container_id FROM holding_import_row_containers WHERE import_row_id=r.id)
            AND a.snapshot_id=NEW.source_snapshot_id))
  );
  SELECT RAISE(ABORT,'public source review stale') WHERE NEW.prior_review_id IS NOT
    (SELECT review_id FROM public_holding_source_heads WHERE review_key=NEW.review_key);
  SELECT RAISE(ABORT,'public source match scope or snapshot changed') WHERE NEW.decision='same' AND NOT EXISTS(
    SELECT 1 FROM public_holding_security_heads s JOIN public_holding_security_heads t
      ON t.household_id=s.household_id AND t.container_id=s.container_id
      AND t.currency=s.currency AND t.instrument_type=s.instrument_type
    JOIN holding_import_application_heads a ON a.position_id=t.position_id
    WHERE s.position_id=NEW.position_id AND t.position_id=NEW.prior_position_id
      AND a.snapshot_id=NEW.prior_snapshot_id
  );
  SELECT RAISE(ABORT,'public source policy identity is unverified') WHERE NEW.decision_source='policy' AND NEW.decision='same' AND NOT EXISTS(
    SELECT 1 FROM public_holding_security_heads s JOIN public_holding_security_heads t
      ON t.household_id=s.household_id AND t.container_id=s.container_id
      AND t.identity_kind=s.identity_kind AND t.identity_key=s.identity_key
      AND t.instrument_type=s.instrument_type AND t.currency=s.currency
    WHERE s.position_id=NEW.position_id AND t.position_id=NEW.prior_position_id
      AND s.identity_kind IS NOT NULL AND s.identity_key IS NOT NULL
      AND EXISTS(SELECT 1 FROM holding_import_rows r JOIN holding_import_applications a ON a.import_row_id=r.id
        WHERE r.id=s.identity_row_id AND a.position_id=s.position_id AND r.public_exposure_identity_kind=s.identity_kind AND r.protected_exposure_key=s.identity_key)
      AND EXISTS(SELECT 1 FROM holding_import_rows r JOIN holding_import_applications a ON a.import_row_id=r.id
        WHERE r.id=t.identity_row_id AND a.position_id=t.position_id AND r.public_exposure_identity_kind=t.identity_kind AND r.protected_exposure_key=t.identity_key)
  );
  SELECT RAISE(ABORT,'public source match cycle or capacity') WHERE NEW.decision='same' AND (
    WITH RECURSIVE family(id) AS (
      SELECT NEW.prior_position_id UNION
      SELECT CASE WHEN h.position_id=f.id THEN h.prior_position_id ELSE h.position_id END
      FROM family f JOIN public_holding_source_heads h ON h.position_id=f.id OR h.prior_position_id=f.id
      WHERE h.decision='same' AND h.review_key<>NEW.review_key LIMIT 501
    ) SELECT COUNT(*)>499 OR MAX(id=NEW.position_id) FROM family
  );
  SELECT RAISE(ABORT,'public source match capacity') WHERE NEW.decision='same' AND (
    WITH RECURSIVE combined(id) AS (
      SELECT NEW.position_id UNION SELECT NEW.prior_position_id UNION
      SELECT CASE WHEN h.position_id=f.id THEN h.prior_position_id ELSE h.position_id END
      FROM combined f JOIN public_holding_source_heads h ON h.position_id=f.id OR h.prior_position_id=f.id
      WHERE h.decision='same' AND h.review_key<>NEW.review_key LIMIT 501
    ) SELECT COUNT(*)>500 FROM combined
  );
  SELECT RAISE(ABORT,'public source policy match is ambiguous') WHERE NEW.decision_source='policy' AND NEW.decision='same' AND EXISTS(
    WITH RECURSIVE family(id) AS (
      SELECT NEW.prior_position_id UNION
      SELECT CASE WHEN h.position_id=f.id THEN h.prior_position_id ELSE h.position_id END
      FROM family f JOIN public_holding_source_heads h ON h.position_id=f.id OR h.prior_position_id=f.id
      WHERE h.decision='same' AND h.review_key<>NEW.review_key LIMIT 501
    )
    SELECT 1 FROM public_holding_security_heads s JOIN public_holding_security_heads t
      ON t.household_id=s.household_id AND t.container_id=s.container_id
      AND t.identity_kind=s.identity_kind AND t.identity_key=s.identity_key
      AND t.instrument_type=s.instrument_type AND t.currency=s.currency
    WHERE s.position_id=NEW.position_id AND t.position_id<>NEW.position_id AND t.position_id NOT IN(SELECT id FROM family)
      AND NOT EXISTS(SELECT 1 FROM public_holding_source_heads h WHERE h.position_id=t.position_id AND h.decision='ignore')
  );
  SELECT RAISE(ABORT,'public source policy cannot replace this manual decision') WHERE NEW.decision_source='policy' AND NEW.decision='separate' AND NOT EXISTS(
    SELECT 1 FROM public_holding_source_reviews previous JOIN holding_import_rows r ON r.id=NEW.import_row_id
    WHERE previous.id=NEW.prior_review_id AND previous.decision='ignore' AND previous.import_row_id<>NEW.import_row_id
      AND NOT EXISTS(SELECT 1 FROM holding_import_quarantines q JOIN public_holding_security_heads k ON k.position_id=q.position_id JOIN holding_import_row_containers c ON c.import_row_id=r.id WHERE q.import_id=r.import_id AND k.container_id=c.container_id AND
        (lower(trim(k.instrument_type)) IN ('cash','equity','etf','mutual fund') OR k.instrument_type=r.instrument_type))
  );
END;
CREATE TRIGGER public_source_review_head AFTER INSERT ON public_holding_source_reviews BEGIN
  INSERT INTO public_holding_source_heads VALUES(NEW.review_key,NEW.household_id,NEW.position_id,NEW.import_row_id,NEW.id,NEW.decision,NEW.prior_position_id)
  ON CONFLICT(review_key) DO UPDATE SET review_id=NEW.id,position_id=NEW.position_id,import_row_id=NEW.import_row_id,decision=NEW.decision,prior_position_id=NEW.prior_position_id;
  INSERT INTO public_holding_source_versions VALUES(NEW.household_id,1)
  ON CONFLICT(household_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER public_source_review_no_update BEFORE UPDATE ON public_holding_source_reviews BEGIN SELECT RAISE(ABORT,'public source reviews are immutable'); END;
CREATE TRIGGER public_source_review_no_delete BEFORE DELETE ON public_holding_source_reviews BEGIN SELECT RAISE(ABORT,'public source reviews are immutable'); END;

-- The planning write must use the same recorded source decisions as its preview.
CREATE TABLE portfolio_baseline_public_source_versions (
  baseline_id TEXT PRIMARY KEY NOT NULL REFERENCES portfolio_baselines(id),
  source_graph_version INTEGER NOT NULL CHECK(source_graph_version>=0)
);
CREATE TRIGGER baseline_public_source_guard BEFORE INSERT ON portfolio_baseline_public_source_versions BEGIN
  SELECT RAISE(ABORT,'portfolio source decisions changed') WHERE NEW.source_graph_version<>
    COALESCE((SELECT v.version FROM portfolio_baselines b JOIN public_holding_source_versions v ON v.household_id=b.household_id WHERE b.id=NEW.baseline_id),0);
END;
CREATE TRIGGER baseline_public_source_no_update BEFORE UPDATE ON portfolio_baseline_public_source_versions BEGIN SELECT RAISE(ABORT,'portfolio source versions are immutable'); END;
CREATE TRIGGER baseline_public_source_no_delete BEFORE DELETE ON portfolio_baseline_public_source_versions BEGIN SELECT RAISE(ABORT,'portfolio source versions are immutable'); END;

-- Recheck routine acceptance atomically; a newer capture or accepted source wins a race.
CREATE TRIGGER public_holding_policy_v4_guard BEFORE INSERT ON holding_import_row_decisions
WHEN NEW.decision_source='policy' AND NEW.decision='accepted' AND NEW.policy_version='plaid-investments-holdings-auto-v4'
BEGIN
  SELECT RAISE(ABORT,'public source policy report changed') WHERE NOT EXISTS(
    SELECT 1 FROM holding_import_rows r JOIN holding_imports i ON i.id=r.import_id
    JOIN holding_import_connections c ON c.import_id=i.id
    JOIN public_holding_import_heads h ON h.connection_id=c.connection_id AND h.import_id=i.id
    WHERE r.id=NEW.import_row_id AND i.household_id=NEW.household_id AND i.provider='plaid_investments'
      AND r.parse_status='ready' AND r.currency_hint='USD' AND NEW.currency='USD'
  );
  SELECT RAISE(ABORT,'newer holding observation already accepted') WHERE EXISTS(
    SELECT 1 FROM holding_import_rows r JOIN holding_imports i ON i.id=r.import_id
    JOIN source_documents d ON d.id=i.source_document_id
    JOIN holding_import_application_heads a ON a.position_id=NEW.matched_position_id
    JOIN holding_position_snapshots s ON s.id=a.snapshot_id
    WHERE r.id=NEW.import_row_id AND s.observed_at>COALESCE(d.effective_date||'T00:00:00.000Z',d.retrieved_at)
  );
  SELECT RAISE(ABORT,'public source policy identity changed') WHERE EXISTS(
    SELECT 1 FROM holding_import_rows r JOIN public_holding_security_heads k ON k.position_id=NEW.matched_position_id
    WHERE r.id=NEW.import_row_id AND (k.instrument_type<>r.instrument_type OR
      (k.identity_key IS NOT NULL AND r.protected_exposure_key IS NOT NULL AND
        (k.identity_key<>r.protected_exposure_key OR k.identity_kind<>r.public_exposure_identity_kind)))
  );
END;
