CREATE INDEX IF NOT EXISTS automatic_investment_reviews_snapshot_fk
  ON automatic_investment_reviews (snapshot_id);
CREATE INDEX IF NOT EXISTS holding_import_application_heads_snapshot_fk
  ON holding_import_application_heads (snapshot_id);
CREATE INDEX IF NOT EXISTS holding_import_applications_snapshot_fk
  ON holding_import_applications (snapshot_id);
CREATE INDEX IF NOT EXISTS holding_import_quarantines_import_row_fk
  ON holding_import_quarantines (import_row_id) WHERE import_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS holding_investment_reviews_snapshot_fk
  ON holding_investment_reviews (expected_snapshot_id) WHERE expected_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS holding_position_continuities_successor_snapshot_fk
  ON holding_position_continuities (successor_snapshot_id);
CREATE INDEX IF NOT EXISTS holding_position_continuities_predecessor_snapshot_fk
  ON holding_position_continuities (predecessor_snapshot_id);
CREATE INDEX IF NOT EXISTS holding_position_economics_proposals_snapshot_fk
  ON holding_position_economics_proposals (snapshot_id);
CREATE INDEX IF NOT EXISTS holding_position_link_reviews_target_snapshot_fk
  ON holding_position_link_reviews (target_snapshot_id);
CREATE INDEX IF NOT EXISTS holding_position_link_reviews_source_snapshot_fk
  ON holding_position_link_reviews (source_snapshot_id);
CREATE INDEX IF NOT EXISTS holding_position_value_proposals_snapshot_fk
  ON holding_position_value_proposals (snapshot_id);
CREATE INDEX IF NOT EXISTS holding_price_quotes_import_row_fk
  ON holding_price_quotes (import_row_id) WHERE import_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS holding_purchase_reviews_snapshot_fk
  ON holding_purchase_reviews (snapshot_id);
CREATE INDEX IF NOT EXISTS portfolio_baseline_items_snapshot_fk
  ON portfolio_baseline_items (snapshot_id);
CREATE INDEX IF NOT EXISTS manual_holding_submissions_snapshot_fk
  ON manual_holding_submissions (snapshot_id);
