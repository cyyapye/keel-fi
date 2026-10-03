-- A rename is an explicit same-investment decision, never a sale or conversion.
ALTER TABLE holding_position_link_reviews ADD COLUMN company_renamed INTEGER NOT NULL DEFAULT 0 CHECK(company_renamed IN (0,1));
ALTER TABLE holding_position_link_reviews ADD COLUMN company_name TEXT;
ALTER TABLE holding_position_link_reviews ADD COLUMN former_company_name TEXT;
CREATE TRIGGER holding_position_rename_guard BEFORE INSERT ON holding_position_link_reviews BEGIN
  SELECT RAISE(ABORT,'position link rename relationship') WHERE NEW.company_renamed=1 AND NEW.relationship<>'same_investment';
  SELECT RAISE(ABORT,'position link historical valuation') WHERE NEW.state='linked' AND NEW.use_source_value=1 AND EXISTS(
    SELECT 1 FROM holding_positions p JOIN holding_position_snapshots s ON s.id=CASE p.id WHEN NEW.source_position_id THEN NEW.source_snapshot_id ELSE NEW.target_snapshot_id END
    WHERE p.id IN (NEW.source_position_id,NEW.target_position_id) AND COALESCE(
      (SELECT json_extract(state_json,'$.participationStatus') FROM holding_investment_reviews WHERE household_id=p.household_id AND position_id=p.id ORDER BY version DESC LIMIT 1),
      CASE s.provider_status WHEN 'realized' THEN 'historical' ELSE 'current' END) IN ('historical','cancelled')
  );
  SELECT RAISE(ABORT,'position link rename identity') WHERE NEW.state='linked' AND NEW.company_renamed=1 AND NOT EXISTS(
    SELECT 1 FROM holding_positions s JOIN holding_positions t ON t.id=NEW.target_position_id
    JOIN holding_position_ownerships so ON so.position_id=s.id
    JOIN holding_position_ownerships tor ON tor.position_id=t.id AND tor.container_id=so.container_id
    WHERE s.id=NEW.source_position_id AND s.provider=t.provider AND s.legal_vehicle_name=t.legal_vehicle_name
      AND s.owner_label IS t.owner_label AND s.opened_on IS t.opened_on AND s.opened_on IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=so.id)
      AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=tor.id)
  );
END;
CREATE TRIGGER holding_position_same_investment_guard BEFORE INSERT ON holding_position_link_reviews WHEN NEW.state='linked' AND NEW.relationship='same_investment' BEGIN
  SELECT RAISE(ABORT,'position link participation conflict') WHERE
    COALESCE((SELECT json_extract(state_json,'$.participationStatus') FROM holding_investment_reviews WHERE household_id=NEW.household_id AND position_id=NEW.source_position_id ORDER BY version DESC LIMIT 1),
      (SELECT CASE provider_status WHEN 'realized' THEN 'historical' ELSE 'current' END FROM holding_position_snapshots WHERE id=NEW.source_snapshot_id)) IS NOT
    COALESCE((SELECT json_extract(state_json,'$.participationStatus') FROM holding_investment_reviews WHERE household_id=NEW.household_id AND position_id=NEW.target_position_id ORDER BY version DESC LIMIT 1),
      (SELECT CASE provider_status WHEN 'realized' THEN 'historical' ELSE 'current' END FROM holding_position_snapshots WHERE id=NEW.target_snapshot_id));
END;
CREATE TRIGGER holding_position_rename_company_guard BEFORE INSERT ON holding_position_link_reviews WHEN NEW.state='linked' AND NEW.company_renamed=1 BEGIN
  SELECT RAISE(ABORT,'position link rename company conflict') WHERE NEW.company_name IS NULL OR NEW.former_company_name IS NULL OR NEW.company_name=NEW.former_company_name OR
    (SELECT COALESCE(json_extract(a.receipt_json,'$.companyId'),
      (SELECT json_extract(receipt_json,'$.companyId') FROM investment_company_reviews WHERE household_id=p.household_id AND position_id=p.id ORDER BY version DESC LIMIT 1),
      (SELECT json_extract(details_json,'$.company.receipt.companyId') FROM automatic_investment_reviews WHERE household_id=p.household_id AND position_id=p.id ORDER BY version DESC LIMIT 1))
     FROM holding_positions p LEFT JOIN company_alias_current_receipts a ON a.position_id=p.id WHERE p.id=NEW.source_position_id) IS NOT
    (SELECT COALESCE(json_extract(a.receipt_json,'$.companyId'),
      (SELECT json_extract(receipt_json,'$.companyId') FROM investment_company_reviews WHERE household_id=p.household_id AND position_id=p.id ORDER BY version DESC LIMIT 1),
      (SELECT json_extract(details_json,'$.company.receipt.companyId') FROM automatic_investment_reviews WHERE household_id=p.household_id AND position_id=p.id ORDER BY version DESC LIMIT 1))
     FROM holding_positions p LEFT JOIN company_alias_current_receipts a ON a.position_id=p.id WHERE p.id=NEW.target_position_id);
END;
CREATE TABLE holding_import_rename_aliases (
  import_row_id TEXT PRIMARY KEY REFERENCES holding_import_rows(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  rename_review_id TEXT NOT NULL REFERENCES holding_position_link_reviews(id),
  target_position_id TEXT NOT NULL REFERENCES holding_positions(id)
);
CREATE TRIGGER holding_import_rename_alias_guard BEFORE INSERT ON holding_import_rename_aliases BEGIN
  SELECT RAISE(ABORT,'position link rename alias stale') WHERE NOT EXISTS(
    SELECT 1 FROM holding_position_link_reviews r JOIN holding_position_link_heads h ON h.review_id=r.id AND h.state='linked'
    JOIN holding_import_rows row ON row.id=NEW.import_row_id AND row.household_id=r.household_id
    WHERE r.id=NEW.rename_review_id AND r.household_id=NEW.household_id AND r.company_renamed=1 AND r.target_position_id=NEW.target_position_id
  );
END;
CREATE TRIGGER holding_import_rename_alias_application_guard BEFORE INSERT ON holding_import_applications BEGIN
  SELECT RAISE(ABORT,'position link rename alias stale') WHERE EXISTS(
    SELECT 1 FROM holding_import_rename_aliases alias WHERE alias.import_row_id=NEW.import_row_id AND (
      alias.target_position_id<>NEW.position_id OR NOT EXISTS(
        SELECT 1 FROM holding_position_link_heads h WHERE h.review_id=alias.rename_review_id AND h.state='linked'
      )
    )
  );
END;
CREATE TRIGGER holding_import_rename_alias_no_update BEFORE UPDATE ON holding_import_rename_aliases BEGIN SELECT RAISE(ABORT,'rename aliases are immutable'); END;
CREATE TRIGGER holding_import_rename_alias_no_delete BEFORE DELETE ON holding_import_rename_aliases BEGIN SELECT RAISE(ABORT,'rename aliases are immutable'); END;
CREATE TRIGGER holding_import_historical_rename_policy_guard BEFORE INSERT ON holding_import_row_decisions
WHEN NEW.decision_source='policy' AND NEW.decision='accepted' BEGIN
  SELECT RAISE(ABORT,'historical renamed investment requires review') WHERE EXISTS(
    SELECT 1 FROM holding_position_link_heads link JOIN holding_position_link_reviews r ON r.id=link.review_id
    JOIN holding_position_snapshots prior ON prior.id=r.target_snapshot_id
    JOIN holding_import_rows row ON row.id=NEW.import_row_id
    WHERE link.household_id=NEW.household_id AND link.target_position_id=NEW.matched_position_id AND link.state='linked' AND r.company_renamed=1
      AND prior.provider_status='realized' AND (row.provider_status<>'realized' OR row.invested_minor<>prior.invested_minor OR row.allocation_minor<>prior.allocation_minor)
  );
END;

CREATE INDEX holding_position_link_recent_reviews ON holding_position_link_reviews(household_id,accepted_at DESC,id DESC);
