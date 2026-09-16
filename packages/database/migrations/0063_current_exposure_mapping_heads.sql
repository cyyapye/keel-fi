-- Current heads make repeated corrections independent of historical versions.
-- Maintained in the same trigger/transaction as Portfolio Watch target status.
CREATE TABLE holding_position_exposure_heads (
  household_id TEXT NOT NULL REFERENCES households(id),
  position_id TEXT NOT NULL REFERENCES holding_positions(id),
  exposure_id TEXT NOT NULL REFERENCES canonical_exposures(id),
  mapping_id TEXT NOT NULL REFERENCES holding_position_exposure_mappings(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')),
  PRIMARY KEY (position_id, exposure_id)
);
CREATE INDEX holding_exposure_heads_active_idx ON holding_position_exposure_heads(household_id, exposure_id, status, position_id);
INSERT INTO holding_position_exposure_heads
  SELECT root.household_id, root.position_id, root.exposure_id, current.id, current.status
  FROM holding_position_exposure_mappings root
  JOIN holding_position_exposure_mappings current ON current.id = (
    SELECT id FROM holding_position_exposure_mappings
    WHERE position_id = root.position_id AND exposure_id = root.exposure_id ORDER BY version DESC LIMIT 1
  ) WHERE root.supersedes_mapping_id IS NULL;


DROP TRIGGER portfolio_watch_targets_derive_status_insert;
CREATE TRIGGER portfolio_watch_targets_derive_status_insert
AFTER INSERT ON portfolio_watch_targets
BEGIN
  UPDATE portfolio_watch_targets
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM canonical_exposures exposure
      JOIN holding_position_exposure_heads mapping
        ON mapping.exposure_id = exposure.id
       AND mapping.household_id = exposure.household_id
      WHERE exposure.household_id = NEW.household_id
        AND exposure.company_id = NEW.company_id
        AND exposure.exposure_kind = 'private_company'
        AND mapping.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_continuities continuity
          WHERE continuity.predecessor_position_id = mapping.position_id
        )
    ) THEN 'active'
    ELSE 'paused'
  END
  WHERE id = NEW.id;
END;

DROP TRIGGER portfolio_watch_targets_sync_mapping_insert;
CREATE TRIGGER portfolio_watch_targets_sync_mapping_insert
AFTER INSERT ON holding_position_exposure_mappings
BEGIN
  INSERT INTO holding_position_exposure_heads VALUES (NEW.household_id, NEW.position_id, NEW.exposure_id, NEW.id, NEW.status)
    ON CONFLICT(position_id, exposure_id) DO UPDATE SET mapping_id = excluded.mapping_id, status = excluded.status;
  INSERT OR IGNORE INTO portfolio_watch_targets (
    id, household_id, company_id, status, source_policy, last_checked_at,
    created_at
  )
  SELECT
    'watch-current-exposure-v1:' || exposure.company_id,
    exposure.household_id,
    exposure.company_id,
    'active',
    'public_only',
    NULL,
    NEW.accepted_at
  FROM canonical_exposures exposure
  WHERE exposure.id = NEW.exposure_id
    AND exposure.household_id = NEW.household_id
    AND exposure.exposure_kind = 'private_company'
    AND exposure.company_id IS NOT NULL
    AND NEW.status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM holding_position_continuities continuity
      WHERE continuity.predecessor_position_id = NEW.position_id
    );

  UPDATE portfolio_watch_targets
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM canonical_exposures exposure
      JOIN holding_position_exposure_heads mapping
        ON mapping.exposure_id = exposure.id
       AND mapping.household_id = exposure.household_id
      WHERE exposure.household_id = NEW.household_id
        AND exposure.company_id = portfolio_watch_targets.company_id
        AND exposure.exposure_kind = 'private_company'
        AND mapping.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_continuities continuity
          WHERE continuity.predecessor_position_id = mapping.position_id
        )
    ) THEN 'active'
    ELSE 'paused'
  END
  WHERE household_id = NEW.household_id
    AND company_id = (
      SELECT exposure.company_id
      FROM canonical_exposures exposure
      WHERE exposure.id = NEW.exposure_id
        AND exposure.exposure_kind = 'private_company'
    );
END;

DROP TRIGGER portfolio_watch_targets_sync_continuity_insert;
CREATE TRIGGER portfolio_watch_targets_sync_continuity_insert
AFTER INSERT ON holding_position_continuities
BEGIN
  UPDATE portfolio_watch_targets
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM canonical_exposures exposure
      JOIN holding_position_exposure_heads mapping
        ON mapping.exposure_id = exposure.id
       AND mapping.household_id = exposure.household_id
      WHERE exposure.household_id = NEW.household_id
        AND exposure.company_id = portfolio_watch_targets.company_id
        AND exposure.exposure_kind = 'private_company'
        AND mapping.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM holding_position_continuities continuity
          WHERE continuity.predecessor_position_id = mapping.position_id
        )
    ) THEN 'active'
    ELSE 'paused'
  END
  WHERE household_id = NEW.household_id
    AND company_id IN (
      SELECT exposure.company_id
      FROM holding_position_exposure_heads mapping
      JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
      WHERE mapping.household_id = NEW.household_id
        AND mapping.position_id IN (
          NEW.predecessor_position_id,
          NEW.successor_position_id
        )
        AND exposure.exposure_kind = 'private_company'
        AND exposure.company_id IS NOT NULL
    );
END;

DROP TRIGGER holding_position_exposure_mappings_integrity_insert;
CREATE TRIGGER holding_position_exposure_mappings_integrity_insert
BEFORE INSERT ON holding_position_exposure_mappings
BEGIN
  SELECT RAISE(ABORT, 'position exposure mapping household mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM holding_positions position
    JOIN canonical_exposures exposure ON exposure.id = NEW.exposure_id
    JOIN households household ON household.id = NEW.household_id
    WHERE position.id = NEW.position_id
      AND position.household_id = NEW.household_id
      AND exposure.household_id = NEW.household_id
      AND household.owner_user_id = NEW.accepted_by_user_id
  );

  SELECT RAISE(ABORT, 'position exposure mapping initial version mismatch')
  WHERE NEW.supersedes_mapping_id IS NULL AND EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings prior
    WHERE prior.position_id = NEW.position_id
      AND prior.exposure_id = NEW.exposure_id
  );

  SELECT RAISE(ABORT, 'position exposure mapping supersession mismatch')
  WHERE NEW.supersedes_mapping_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM holding_position_exposure_mappings prior
    WHERE prior.id = NEW.supersedes_mapping_id
      AND prior.household_id = NEW.household_id
      AND prior.position_id = NEW.position_id
      AND prior.exposure_id = NEW.exposure_id
      AND prior.version = NEW.version - 1
      AND prior.effective_at <= NEW.effective_at
      AND NOT EXISTS (
        SELECT 1
        FROM holding_position_exposure_mappings later
        WHERE later.supersedes_mapping_id = prior.id
      )
  );

  SELECT RAISE(ABORT, 'position exposure allocations exceed one million ppm')
  WHERE NEW.status = 'active'
    AND NEW.allocation_ppm IS NOT NULL
    AND NEW.allocation_ppm + COALESCE((
      SELECT SUM(current.allocation_ppm)
      FROM holding_position_exposure_heads head
      JOIN holding_position_exposure_mappings current ON current.id = head.mapping_id
      WHERE head.position_id = NEW.position_id
        AND current.status = 'active'
        AND current.allocation_ppm IS NOT NULL
        AND current.id <> COALESCE(NEW.supersedes_mapping_id, '')
    ), 0) > 1000000;
END;
