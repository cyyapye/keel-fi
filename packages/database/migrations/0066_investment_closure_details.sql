PRAGMA foreign_keys = ON;

-- Closure metadata belongs to the participation decision. Never update source
-- snapshots, cash movements, legal entities, or earlier review versions.
CREATE TRIGGER holding_investment_closure_guard
BEFORE INSERT ON holding_investment_reviews
WHEN json_type(NEW.state_json, '$.closure') IS NOT NULL
  AND json_type(NEW.state_json, '$.closure') <> 'null'
BEGIN
  SELECT RAISE(ABORT, 'investment closure requires historical participation')
  WHERE json_type(NEW.state_json, '$.closure') <> 'object'
    OR json_extract(NEW.state_json, '$.participationStatus') <> 'historical';
  SELECT RAISE(ABORT, 'investment replacement scope mismatch')
  WHERE json_extract(NEW.state_json, '$.closure.replacementPositionId') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM holding_positions replacement
      WHERE replacement.id = json_extract(NEW.state_json, '$.closure.replacementPositionId')
        AND replacement.id <> NEW.position_id
        AND replacement.household_id = NEW.household_id
        AND replacement.position_kind <> 'direct'
        AND NOT EXISTS (
          SELECT 1 FROM holding_position_continuities continuity
          WHERE continuity.predecessor_position_id = replacement.id
        )
    );
END;
