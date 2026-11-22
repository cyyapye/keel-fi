-- Verified instrument matches and official regular-session closes are evidence.
-- A household decision enrolls only the reviewed position mappings.
CREATE TABLE exposure_market_listings (
  exposure_id TEXT PRIMARY KEY REFERENCES canonical_exposures(id),
  instrument_id TEXT NOT NULL, ticker TEXT NOT NULL, venue TEXT NOT NULL, share_class TEXT NOT NULL,
  basis_key TEXT NOT NULL, first_session TEXT NOT NULL, identity_source_url TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency='USD')
);
CREATE TABLE exposure_market_closes (
  id TEXT PRIMARY KEY, exposure_id TEXT NOT NULL REFERENCES exposure_market_listings(exposure_id),
  session_date TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1), price_micros INTEGER NOT NULL CHECK(price_micros BETWEEN 1 AND 1000000000000),
  units_per_original INTEGER NOT NULL CHECK(units_per_original BETWEEN 1 AND 1000000),
  source_url TEXT NOT NULL, observed_at TEXT NOT NULL,
  UNIQUE(exposure_id,session_date,revision), UNIQUE(exposure_id,id)
);
CREATE TABLE exposure_market_heads (
  exposure_id TEXT PRIMARY KEY REFERENCES exposure_market_listings(exposure_id),
  quote_id TEXT NOT NULL, session_date TEXT NOT NULL, revision INTEGER NOT NULL,
  FOREIGN KEY(exposure_id,quote_id) REFERENCES exposure_market_closes(exposure_id,id)
);
CREATE TRIGGER exposure_market_close_project AFTER INSERT ON exposure_market_closes BEGIN
  INSERT INTO exposure_market_heads VALUES(NEW.exposure_id,NEW.id,NEW.session_date,NEW.revision)
  ON CONFLICT(exposure_id) DO UPDATE SET quote_id=excluded.quote_id,session_date=excluded.session_date,revision=excluded.revision
  WHERE (excluded.session_date,excluded.revision)>(exposure_market_heads.session_date,exposure_market_heads.revision);
END;
CREATE TABLE exposure_market_decisions (
  id TEXT PRIMARY KEY, exposure_id TEXT NOT NULL REFERENCES exposure_market_listings(exposure_id),
  version INTEGER NOT NULL CHECK(version>0), quote_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id), choice TEXT NOT NULL CHECK(choice IN('follow','keep')),
  input_token TEXT NOT NULL, scope_json TEXT NOT NULL CHECK(json_valid(scope_json)), decided_at TEXT NOT NULL,
  UNIQUE(exposure_id,version), FOREIGN KEY(exposure_id,quote_id) REFERENCES exposure_market_closes(exposure_id,id)
);
CREATE TABLE exposure_market_members (
  position_id TEXT PRIMARY KEY REFERENCES holding_positions(id), exposure_id TEXT NOT NULL REFERENCES exposure_market_listings(exposure_id),
  mapping_id TEXT NOT NULL REFERENCES holding_position_exposure_mappings(id), decision_id TEXT NOT NULL REFERENCES exposure_market_decisions(id)
);
CREATE INDEX exposure_market_members_exposure_idx ON exposure_market_members(exposure_id);
CREATE TRIGGER exposure_market_decision_project AFTER INSERT ON exposure_market_decisions BEGIN
  DELETE FROM exposure_market_members WHERE exposure_id=NEW.exposure_id;
  INSERT INTO exposure_market_members SELECT json_extract(value,'$.id'),NEW.exposure_id,json_extract(value,'$.mappingId'),NEW.id
  FROM json_each(NEW.scope_json) WHERE NEW.choice='follow'
  ON CONFLICT(position_id) DO UPDATE SET exposure_id=excluded.exposure_id,
    mapping_id=excluded.mapping_id,decision_id=excluded.decision_id;
END;
CREATE TRIGGER exposure_market_listings_no_update BEFORE UPDATE ON exposure_market_listings BEGIN SELECT RAISE(ABORT,'Immutable market record'); END;
CREATE TRIGGER exposure_market_listings_no_delete BEFORE DELETE ON exposure_market_listings BEGIN SELECT RAISE(ABORT,'Immutable market record'); END;
CREATE TRIGGER exposure_market_closes_no_update BEFORE UPDATE ON exposure_market_closes BEGIN SELECT RAISE(ABORT,'Immutable market record'); END;
CREATE TRIGGER exposure_market_closes_no_delete BEFORE DELETE ON exposure_market_closes BEGIN SELECT RAISE(ABORT,'Immutable market record'); END;
CREATE TRIGGER exposure_market_decisions_no_update BEFORE UPDATE ON exposure_market_decisions BEGIN SELECT RAISE(ABORT,'Immutable market record'); END;
CREATE TRIGGER exposure_market_decisions_no_delete BEFORE DELETE ON exposure_market_decisions BEGIN SELECT RAISE(ABORT,'Immutable market record'); END;
CREATE VIEW exposure_market_prices AS
SELECT l.exposure_id,l.first_session,json_object(
  'id',q.id,'ticker',l.ticker,'venue',l.venue,'shareClass',l.share_class,
  'shareBasis',json_object('key',l.basis_key,'unitsPerOriginal',q.units_per_original),
  'date',q.session_date,'priceMicros',q.price_micros,'sourceUrl',q.source_url) quote_json
FROM exposure_market_listings l JOIN exposure_market_heads h USING(exposure_id)
JOIN exposure_market_closes q ON q.id=h.quote_id
JOIN exposure_market_closes first ON first.exposure_id=l.exposure_id AND first.session_date=l.first_session AND first.revision=(SELECT max(f.revision) FROM exposure_market_closes f WHERE f.exposure_id=l.exposure_id AND f.session_date=l.first_session);

CREATE VIEW exposure_market_candidates AS
SELECT m.household_id,m.exposure_id,m.position_id,m.mapping_id,r.id receipt_id,s.id snapshot_id,
  p.legal_vehicle_name,s.unrealized_value_minor,r.receipt_json
FROM holding_position_exposure_heads m
JOIN holding_position_exposure_mappings mapping ON mapping.id=m.mapping_id
JOIN holding_positions p ON p.id=m.position_id
JOIN holding_import_application_heads a ON a.position_id=p.id
JOIN holding_position_snapshots s ON s.id=a.snapshot_id
JOIN holding_purchase_heads ph ON ph.position_id=p.id
JOIN holding_purchase_reviews r ON r.id=ph.review_id
WHERE m.status='active' AND p.provider IN ('manual','sydecar','angellist','wefunder','tokenfolio')
AND s.currency='USD' AND lower(s.provider_status)='live'
AND COALESCE((SELECT json_extract(review.state_json,'$.participationStatus') FROM holding_investment_reviews review
  WHERE review.household_id=m.household_id AND review.position_id=m.position_id ORDER BY review.version DESC LIMIT 1),'current') NOT IN('historical','cancelled')
AND (mapping.allocation_ppm IS NULL OR mapping.allocation_ppm=1000000)
AND NOT EXISTS(SELECT 1 FROM holding_position_exposure_heads other WHERE other.position_id=m.position_id AND other.status='active' AND other.exposure_id<>m.exposure_id)
AND NOT EXISTS(SELECT 1 FROM holding_position_link_heads link WHERE link.source_position_id=m.position_id AND link.state='linked')
AND NOT EXISTS(SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id=m.position_id);

CREATE TABLE exposure_market_news_reads (
  exposure_id TEXT NOT NULL REFERENCES exposure_market_listings(exposure_id),
  user_id TEXT NOT NULL REFERENCES users(id), is_read INTEGER NOT NULL CHECK(is_read IN(0,1)),
  version INTEGER NOT NULL CHECK(version>0), PRIMARY KEY(exposure_id,user_id)
);
CREATE TRIGGER exposure_market_review_read AFTER INSERT ON exposure_market_decisions BEGIN
  INSERT INTO exposure_market_news_reads VALUES(NEW.exposure_id,NEW.user_id,1,1)
  ON CONFLICT(exposure_id,user_id) DO UPDATE SET is_read=1,version=version+1;
END;

CREATE INDEX exposure_market_decision_owner_idx ON exposure_market_decisions(user_id);
CREATE INDEX exposure_market_decision_quote_idx ON exposure_market_decisions(quote_id,exposure_id);
CREATE INDEX exposure_market_head_quote_idx ON exposure_market_heads(quote_id,exposure_id);
CREATE INDEX exposure_market_member_mapping_idx ON exposure_market_members(mapping_id);
CREATE INDEX exposure_market_member_decision_idx ON exposure_market_members(decision_id);
CREATE INDEX exposure_market_news_owner_idx ON exposure_market_news_reads(user_id);
