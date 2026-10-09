-- The investment timeline reads both sides of an immutable link decision.
CREATE INDEX holding_position_link_target_history
  ON holding_position_link_reviews(household_id,target_position_id,accepted_at,id);
