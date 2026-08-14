PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS portfolio_baseline_cash_flow_plans_no_update;
DROP TRIGGER IF EXISTS portfolio_baseline_cash_flow_plans_no_delete;

CREATE TRIGGER cash_flow_plans_no_update
BEFORE UPDATE ON cash_flow_plans
BEGIN
  SELECT RAISE(ABORT, 'cash flow plans are immutable');
END;

CREATE TRIGGER cash_flow_plans_no_delete
BEFORE DELETE ON cash_flow_plans
BEGIN
  SELECT RAISE(ABORT, 'cash flow plans are immutable');
END;
