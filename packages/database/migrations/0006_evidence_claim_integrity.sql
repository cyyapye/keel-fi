-- Claims can be corrected while an evidence event is still pending. Once a
-- review decision exists, the claims that informed it become part of the
-- retained audit record and cannot be changed or added to.
CREATE TRIGGER evidence_claims_after_review_no_insert
BEFORE INSERT ON evidence_claims
WHEN EXISTS (
  SELECT 1
  FROM review_decisions decision
  WHERE decision.evidence_event_id = NEW.evidence_event_id
)
BEGIN
  SELECT RAISE(ABORT, 'evidence claims are immutable after review');
END;

CREATE TRIGGER evidence_claims_after_review_no_update
BEFORE UPDATE ON evidence_claims
WHEN EXISTS (
  SELECT 1
  FROM review_decisions decision
  WHERE decision.evidence_event_id = OLD.evidence_event_id
     OR decision.evidence_event_id = NEW.evidence_event_id
)
BEGIN
  SELECT RAISE(ABORT, 'evidence claims are immutable after review');
END;

CREATE TRIGGER evidence_claims_after_review_no_delete
BEFORE DELETE ON evidence_claims
WHEN EXISTS (
  SELECT 1
  FROM review_decisions decision
  WHERE decision.evidence_event_id = OLD.evidence_event_id
)
BEGIN
  SELECT RAISE(ABORT, 'evidence claims are immutable after review');
END;
