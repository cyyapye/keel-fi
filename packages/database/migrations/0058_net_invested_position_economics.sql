PRAGMA foreign_keys = ON;

-- Historical reviews retain their original gross-commitment interpretation.
-- Source snapshot amounts and every accepted review remain unchanged.
ALTER TABLE holding_position_economics_proposals ADD COLUMN capital_basis TEXT
  NOT NULL DEFAULT 'gross_commitment'
  CHECK (capital_basis IN ('gross_commitment', 'net_invested'));
ALTER TABLE holding_position_economics_proposals ADD COLUMN gross_commitment_minor INTEGER
  CHECK (gross_commitment_minor IS NULL OR (
    typeof(gross_commitment_minor) = 'integer'
    AND gross_commitment_minor BETWEEN 1 AND 9007199254740991
  ));
ALTER TABLE holding_position_economics_proposals ADD COLUMN setup_fee_ppm INTEGER
  CHECK (setup_fee_ppm IS NULL OR (
    typeof(setup_fee_ppm) = 'integer' AND setup_fee_ppm BETWEEN 0 AND 1000000
  ));

CREATE TRIGGER holding_position_economics_capital_integrity_insert
BEFORE INSERT ON holding_position_economics_proposals
BEGIN
  SELECT RAISE(ABORT, 'position economics combined fees exceed commitment')
  WHERE NEW.annual_admin_fee_ppm * NEW.admin_fee_years + COALESCE(NEW.setup_fee_ppm, 0) > 1000000;
  SELECT RAISE(ABORT, 'position economics capital basis mismatch')
  WHERE (NEW.capital_basis = 'gross_commitment' AND NEW.gross_commitment_minor IS NOT NULL)
     OR (NEW.capital_basis = 'net_invested' AND (
       NEW.gross_commitment_minor IS NULL OR NEW.setup_fee_ppm IS NULL
     ));
  -- Split the multiplication to stay in SQLite integer range for all safe
  -- minor-unit amounts. This matches the domain's half-up combined fee.
  SELECT RAISE(ABORT, 'position economics net capital does not reconcile')
  WHERE NEW.capital_basis = 'net_invested' AND NEW.commitment_minor !=
    NEW.gross_commitment_minor - (
      (NEW.gross_commitment_minor / 1000000) *
        (NEW.annual_admin_fee_ppm * NEW.admin_fee_years + COALESCE(NEW.setup_fee_ppm, 0))
      + ((NEW.gross_commitment_minor % 1000000) *
        (NEW.annual_admin_fee_ppm * NEW.admin_fee_years + COALESCE(NEW.setup_fee_ppm, 0)) + 500000) / 1000000
    );
END;
