PRAGMA foreign_keys = ON;

-- Holdings selects the latest and prior accepted application for every current
-- position. Keep those correlated lookups indexed by position instead of
-- rescanning all accepted applications once per row.
CREATE INDEX holding_import_applications_position_applied_idx
  ON holding_import_applications(position_id, applied_at DESC, id DESC);

-- Exposure projection starts from canonical exposures and tests their current
-- mappings. Lead with household and exposure so the lookup does not rescan all
-- mappings in the household once per exposure.
CREATE INDEX holding_position_exposure_mappings_household_exposure_idx
  ON holding_position_exposure_mappings(
    household_id, exposure_id, position_id, version
  );
