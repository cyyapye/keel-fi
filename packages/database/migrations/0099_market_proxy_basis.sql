-- Store the reviewed basis with its active member. Existing direct-close decisions use NULL.
ALTER TABLE exposure_market_members ADD COLUMN proxy_basis_json TEXT;
DROP TRIGGER exposure_market_decision_project;
CREATE TRIGGER exposure_market_decision_project AFTER INSERT ON exposure_market_decisions BEGIN
  DELETE FROM exposure_market_members WHERE exposure_id=NEW.exposure_id;
  INSERT INTO exposure_market_members(position_id,exposure_id,mapping_id,decision_id,proxy_basis_json)
  SELECT json_extract(value,'$.id'),NEW.exposure_id,json_extract(value,'$.mappingId'),NEW.id,json_extract(value,'$.proxyBasis')
  FROM json_each(NEW.scope_json) WHERE NEW.choice='follow'
  ON CONFLICT(position_id) DO UPDATE SET exposure_id=excluded.exposure_id,
    mapping_id=excluded.mapping_id,decision_id=excluded.decision_id,proxy_basis_json=excluded.proxy_basis_json;
END;
