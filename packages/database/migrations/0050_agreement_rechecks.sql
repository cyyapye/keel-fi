PRAGMA foreign_keys = ON;

-- A bounded priority hint on the existing provider job, not a second queue or
-- permission to download quarantine. Normal lease and review rules still apply.
ALTER TABLE provider_portfolio_runs ADD COLUMN recheck_document_id TEXT
  REFERENCES source_documents(id) ON DELETE RESTRICT;

CREATE INDEX provider_legal_documents_recheck_run_idx
  ON provider_legal_document_observations(household_id, run_id);
CREATE INDEX provider_legal_documents_recheck_source_idx
  ON provider_legal_document_observations(household_id, provider, natural_key_sha256);

CREATE TRIGGER provider_portfolio_recheck_scope
BEFORE INSERT ON provider_portfolio_runs
WHEN NEW.recheck_document_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'agreement recheck scope mismatch') WHERE
    NEW.request_kind <> 'manual' OR NOT EXISTS (
      SELECT 1 FROM source_documents document
      JOIN provider_portfolio_agents agent ON agent.id = NEW.agent_id
        AND agent.household_id = document.household_id
      JOIN provider_legal_document_latest latest ON latest.household_id = document.household_id
        AND latest.provider = agent.provider
      JOIN provider_legal_document_observations observation ON observation.id = latest.observation_id
      JOIN json_each(observation.capture_json, '$.documents') entry
      WHERE document.id = NEW.recheck_document_id AND document.household_id = NEW.household_id
        AND json_extract(entry.value, '$.id') = document.id
    );
END;

CREATE TRIGGER provider_portfolio_recheck_identity
BEFORE UPDATE ON provider_portfolio_runs
WHEN NEW.recheck_document_id IS NOT OLD.recheck_document_id
BEGIN SELECT RAISE(ABORT, 'agreement recheck target is immutable'); END;

-- A successful portfolio update alone is not proof of the requested recheck.
-- Match the provider-owned document key, allowing a replacement PDF at that
-- same source location, and require a fresh versioned scan in this exact run.
CREATE TRIGGER provider_portfolio_recheck_completion
BEFORE UPDATE OF status ON provider_portfolio_runs
WHEN NEW.status = 'completed' AND NEW.recheck_document_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'agreement recheck has no fresh scan') WHERE NOT EXISTS (
    SELECT 1 FROM provider_legal_document_observations current
    JOIN json_each(current.capture_json, '$.documents') checked
    WHERE current.run_id = NEW.id AND current.household_id = NEW.household_id
      AND json_extract(checked.value, '$.scan.version') = 2
      AND json_extract(checked.value, '$.scan.sha256') = json_extract(checked.value, '$.sha256')
      AND julianday(json_extract(checked.value, '$.scan.scannedAt')) >= julianday(NEW.started_at)
      AND EXISTS (
        SELECT 1 FROM provider_legal_document_observations prior
        JOIN json_each(prior.capture_json, '$.documents') original
        WHERE prior.household_id = current.household_id AND prior.provider = current.provider
          AND prior.natural_key_sha256 = current.natural_key_sha256
          AND json_extract(original.value, '$.id') = NEW.recheck_document_id
          AND json_extract(original.value, '$.documentKey') = json_extract(checked.value, '$.documentKey')
      )
  );
END;
