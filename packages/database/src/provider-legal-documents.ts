import {
  LegalEntityNameEvidenceSchema,
  type LegalEntityNameEvidence,
} from "@keel/domain/position-read-model";
import {
  ProviderLegalDocumentCaptureSchema,
  ProviderLegalDocumentManifestSchema,
  type ProviderLegalDocumentCapture,
  type ProviderLegalDocumentManifest,
  type StoredLegalDocument,
} from "@keel/domain/provider-legal-documents";

type Provider = "sydecar" | "tokenfolio";
export type LegalDocumentLease = {
  householdId: string;
  provider: Provider;
  runId: string;
  tokenSha256: string;
  startedAt: string;
};
export type PrivateLegalDocument = {
  id: string;
  sha256: string;
  object_key: string;
  byte_size: number;
  content_type: string;
  scan_outcome?: "clean" | "blocked" | null;
};

export class ProviderLegalDocumentError extends Error {
  public constructor(
    public readonly code:
      "lease_invalid" | "capture_conflict" | "document_missing" | "not_found",
  ) {
    super(code);
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function legalNameEvidenceFromDocuments(
  capture: ProviderLegalDocumentCapture,
  documents: readonly StoredLegalDocument[],
): LegalEntityNameEvidence {
  const references = documents.map((document) => ({
    id: document.id,
    fileName: document.fileName,
    sha256: document.sha256,
    page: document.extraction.citations[0]?.page ?? null,
    quote: document.extraction.citations[0]?.quote ?? null,
  }));
  const names = new Set(
    documents.flatMap((document) =>
      document.extraction.citations.map((citation) => citation.legalName),
    ),
  );
  const blocking = documents.find(
    (document) =>
      document.extraction.problem !== null &&
      document.extraction.problem !== "name_not_found",
  );
  const problem =
    (documents.some((document) => document.scan?.outcome === "blocked")
      ? "security_blocked"
      : null) ??
    (documents.some((document) => document.scan === undefined)
      ? "scanner_unavailable"
      : null) ??
    capture.problem ??
    (names.size > 1 ? "conflicting" : blocking?.extraction.problem) ??
    (names.size === 0 ? "name_not_found" : null);
  if (problem !== null)
    return LegalEntityNameEvidenceSchema.parse({
      state: "unavailable",
      legalName: null,
      sourceField: null,
      problem,
      documents: references,
    });
  const first = documents.find(
    (document) => document.extraction.citations.length > 0,
  );
  return LegalEntityNameEvidenceSchema.parse({
    state: "document_reported",
    legalName: [...names][0],
    sourceField: `Agreement, page ${first?.extraction.citations[0]?.page.toString() ?? ""}`,
    documents: references,
  });
}

const LIVE_LEASE = `EXISTS (SELECT 1 FROM provider_portfolio_runs run
  WHERE run.id = ? AND run.household_id = ? AND run.status = 'leased'
    AND run.lease_token_sha256 = ? AND run.lease_expires_at > ?)`;

export class D1ProviderLegalDocumentRepository {
  public constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async lease(
    accessSubject: string,
    provider: Provider,
    runId: string,
    token: string,
  ): Promise<LegalDocumentLease> {
    const tokenSha256 = await sha256(token);
    const now = this.now();
    const row = await this.db
      .prepare(
        `SELECT household.id AS household_id, run.started_at
      FROM users user JOIN households household ON household.owner_user_id = user.id
      JOIN provider_portfolio_agents agent ON agent.household_id = household.id AND agent.provider = ?
      JOIN provider_portfolio_runs run ON run.agent_id = agent.id AND run.household_id = household.id
      WHERE user.access_subject = ? AND run.id = ? AND run.status = 'leased'
        AND run.lease_token_sha256 = ? AND run.lease_expires_at > ? AND run.started_at > ?`,
      )
      .bind(
        provider,
        accessSubject,
        runId,
        tokenSha256,
        now.toISOString(),
        new Date(now.getTime() - 30 * 60_000).toISOString(),
      )
      .first<{ household_id: string; started_at: string }>();
    if (row === null) throw new ProviderLegalDocumentError("lease_invalid");
    const expiresAt = new Date(
      Math.min(
        now.getTime() + 5 * 60_000,
        new Date(row.started_at).getTime() + 30 * 60_000,
      ),
    ).toISOString();
    // Renewable in small increments, with a hard total run lifetime. No expired
    // or terminal lease can be revived by document work.
    const renewed = await this.db
      .prepare(
        `UPDATE provider_portfolio_runs SET lease_expires_at = MAX(lease_expires_at, ?)
      WHERE id = ? AND household_id = ? AND status = 'leased' AND lease_token_sha256 = ? AND lease_expires_at > ?`,
      )
      .bind(expiresAt, runId, row.household_id, tokenSha256, now.toISOString())
      .run();
    if (renewed.meta.changes !== 1)
      throw new ProviderLegalDocumentError("lease_invalid");
    return {
      householdId: row.household_id,
      provider,
      runId,
      tokenSha256,
      startedAt: row.started_at,
    };
  }

  public async manifest(
    lease: LegalDocumentLease,
  ): Promise<ProviderLegalDocumentManifest> {
    const result = await this.db
      .prepare(
        `SELECT observation.capture_json
      FROM provider_legal_document_latest latest
      JOIN provider_legal_document_observations observation ON observation.id = latest.observation_id
      WHERE latest.household_id = ? AND latest.provider = ?
      ORDER BY observation.observed_at DESC, latest.natural_key_sha256 LIMIT 500`,
      )
      .bind(lease.householdId, lease.provider)
      .all<{ capture_json: string }>();
    return ProviderLegalDocumentManifestSchema.parse({
      version: 1,
      captures: result.results.map(
        (row) => JSON.parse(row.capture_json) as unknown,
      ),
    });
  }

  public async knownDocuments(
    householdId: string,
    hashes: readonly string[],
  ): Promise<PrivateLegalDocument[]> {
    if (hashes.length === 0) return [];
    const result = await this.db
      .prepare(
        `SELECT id, sha256, object_key, byte_size, content_type
      FROM source_documents WHERE household_id = ? AND sha256 IN (SELECT value FROM json_each(?))`,
      )
      .bind(householdId, JSON.stringify(hashes))
      .all<PrivateLegalDocument>();
    return result.results;
  }

  public async record(
    lease: LegalDocumentLease,
    positionFingerprint: string,
    raw: ProviderLegalDocumentCapture,
    objects: readonly { sha256: string; objectKey: string }[],
  ): Promise<void> {
    const capture = ProviderLegalDocumentCaptureSchema.parse(raw);
    const captureSha256 = await sha256(JSON.stringify(capture));
    const existing = await this.db
      .prepare(
        `SELECT capture_sha256 FROM provider_legal_document_observations
      WHERE household_id = ? AND provider = ? AND run_id = ? AND natural_key_sha256 = ?`,
      )
      .bind(
        lease.householdId,
        lease.provider,
        lease.runId,
        capture.naturalKeySha256,
      )
      .first<{ capture_sha256: string }>();
    if (existing !== null) {
      if (existing.capture_sha256 !== captureSha256)
        throw new ProviderLegalDocumentError("capture_conflict");
      return;
    }
    const known = await this.knownDocuments(
      lease.householdId,
      capture.documents.map((document) => document.sha256),
    );
    const timestamp = this.now().toISOString();
    const guard = [
      lease.runId,
      lease.householdId,
      lease.tokenSha256,
      timestamp,
    ];
    const inserts: D1PreparedStatement[] = [];
    const stored: StoredLegalDocument[] = capture.documents.map((document) => {
      const prior = known.find((item) => item.sha256 === document.sha256);
      if (prior !== undefined) {
        if (
          prior.byte_size !== document.byteSize ||
          prior.content_type !== "application/pdf"
        )
          throw new ProviderLegalDocumentError("document_missing");
        return { ...document, id: prior.id };
      }
      const object = objects.find((item) => item.sha256 === document.sha256);
      if (object === undefined)
        throw new ProviderLegalDocumentError("document_missing");
      const id = crypto.randomUUID();
      // Deterministic object keys and INSERT OR IGNORE make a concurrent retry
      // safe. A following lookup resolves the winning household document id.
      inserts.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO source_documents
        (id, household_id, object_key, file_name, content_type, byte_size, sha256, effective_date, retrieved_at, source_label, review_status, created_at)
        SELECT ?, ?, ?, ?, 'application/pdf', ?, ?, NULL, ?, ?, 'pending_review', ? WHERE ${LIVE_LEASE}`,
          )
          .bind(
            id,
            lease.householdId,
            object.objectKey,
            document.fileName,
            document.byteSize,
            document.sha256,
            timestamp,
            `${lease.provider} agreement`,
            timestamp,
            ...guard,
          ),
      );
      return { ...document, id };
    });
    // Commit the original's metadata and its upload event together. Otherwise
    // a failed audit could be skipped on retry once the hash became known.
    inserts.push(
      ...objects.map((object) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO private_document_access_events
      (id, household_id, actor_user_id, actor_kind, document_id, action, outcome, occurred_at)
      SELECT ?, household.id, household.owner_user_id, 'provider_agent', document.id, 'upload', 'stored', ?
      FROM households household JOIN source_documents document ON document.household_id = household.id
      WHERE household.id = ? AND document.sha256 = ? AND ${LIVE_LEASE}`,
          )
          .bind(
            `upload:${lease.runId}:${object.sha256}`,
            timestamp,
            lease.householdId,
            object.sha256,
            ...guard,
          ),
      ),
    );
    if (inserts.length > 0) {
      await this.db.batch(inserts);
      const resolved = await this.knownDocuments(
        lease.householdId,
        capture.documents.map((document) => document.sha256),
      );
      stored.forEach((document) => {
        const original = resolved.find(
          (item) => item.sha256 === document.sha256,
        );
        if (original === undefined)
          throw new ProviderLegalDocumentError("lease_invalid");
        document.id = original.id;
      });
    }
    const evidence = legalNameEvidenceFromDocuments(capture, stored);
    const id = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO provider_legal_document_observations
        (id, household_id, provider, run_id, natural_key_sha256, position_fingerprint, capture_sha256, capture_json, evidence_json, observed_at, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${LIVE_LEASE}`,
        )
        .bind(
          id,
          lease.householdId,
          lease.provider,
          lease.runId,
          capture.naturalKeySha256,
          positionFingerprint,
          captureSha256,
          JSON.stringify({ ...capture, documents: stored }),
          JSON.stringify(evidence),
          lease.startedAt,
          timestamp,
          ...guard,
        ),
      this.db
        .prepare(
          `INSERT INTO provider_legal_document_latest (household_id, provider, natural_key_sha256, position_fingerprint, observation_id)
        SELECT household_id, provider, natural_key_sha256, position_fingerprint, id FROM provider_legal_document_observations WHERE id = ?
        ON CONFLICT (household_id, provider, position_fingerprint) DO UPDATE SET observation_id = excluded.observation_id
        WHERE (SELECT observed_at FROM provider_legal_document_observations WHERE id = excluded.observation_id) >
          (SELECT observed_at FROM provider_legal_document_observations WHERE id = provider_legal_document_latest.observation_id)`,
        )
        .bind(id),
      ...stored
        .filter((document) => document.scan !== undefined)
        .map((document) =>
          this.db
            .prepare(
              `INSERT INTO private_document_scans (document_id, household_id, sha256, outcome, scan_json, scanned_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE ${LIVE_LEASE}
        ON CONFLICT (document_id) DO UPDATE SET outcome = excluded.outcome, scan_json = excluded.scan_json, scanned_at = excluded.scanned_at
        WHERE excluded.scanned_at > private_document_scans.scanned_at`,
            )
            .bind(
              document.id,
              lease.householdId,
              document.sha256,
              document.scan!.outcome,
              JSON.stringify(document.scan),
              document.scan!.scannedAt,
              ...guard,
            ),
        ),
    ]);
    const saved = await this.db
      .prepare(
        `SELECT capture_sha256 FROM provider_legal_document_observations
      WHERE household_id = ? AND provider = ? AND run_id = ? AND natural_key_sha256 = ?`,
      )
      .bind(
        lease.householdId,
        lease.provider,
        lease.runId,
        capture.naturalKeySha256,
      )
      .first<{ capture_sha256: string }>();
    if (saved === null) throw new ProviderLegalDocumentError("lease_invalid");
    if (saved.capture_sha256 !== captureSha256)
      throw new ProviderLegalDocumentError("capture_conflict");
  }

  public async reserveUploads(
    lease: LegalDocumentLease,
    documents: readonly { sha256: string; byteSize: number }[],
  ): Promise<void> {
    if (documents.length === 0) return;
    const timestamp = this.now().toISOString();
    await this.db.batch(
      documents.map((document) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO provider_legal_document_uploads (run_id, sha256, byte_size)
       SELECT ?, ?, ? WHERE ${LIVE_LEASE}`,
          )
          .bind(
            lease.runId,
            document.sha256,
            document.byteSize,
            lease.runId,
            lease.householdId,
            lease.tokenSha256,
            timestamp,
          ),
      ),
    );
    const saved = await this.db
      .prepare(
        `SELECT sha256, byte_size FROM provider_legal_document_uploads WHERE run_id = ? AND sha256 IN (SELECT value FROM json_each(?))`,
      )
      .bind(
        lease.runId,
        JSON.stringify(documents.map((document) => document.sha256)),
      )
      .all<{ sha256: string; byte_size: number }>();
    if (
      documents.some(
        (document) =>
          !saved.results.some(
            (row) =>
              row.sha256 === document.sha256 &&
              row.byte_size === document.byteSize,
          ),
      )
    )
      throw new ProviderLegalDocumentError("lease_invalid");
  }

  public async document(
    accessSubject: string,
    documentId: string,
  ): Promise<PrivateLegalDocument> {
    const row = await this.db
      .prepare(
        `SELECT document.id, document.sha256, document.object_key, document.byte_size, document.content_type, scan.outcome AS scan_outcome
      FROM users user JOIN households household ON household.owner_user_id = user.id
      JOIN source_documents document ON document.household_id = household.id
      LEFT JOIN private_document_scans scan ON scan.document_id = document.id AND scan.household_id = household.id AND scan.sha256 = document.sha256
      WHERE user.access_subject = ? AND document.id = ? AND document.content_type = 'application/pdf'`,
      )
      .bind(accessSubject, documentId)
      .first<PrivateLegalDocument>();
    if (row === null) throw new ProviderLegalDocumentError("not_found");
    return row;
  }

  public async auditDownload(
    accessSubject: string,
    documentId: string,
    outcome: "released" | "denied" | "unavailable",
  ): Promise<void> {
    const result = await this.db
      .prepare(
        `INSERT INTO private_document_access_events
      (id, household_id, actor_user_id, actor_kind, document_id, action, outcome, occurred_at)
      SELECT ?, household.id, user.id, 'owner', ?, 'download', ?, ?
      FROM users user JOIN households household ON household.owner_user_id = user.id
      WHERE user.access_subject = ?`,
      )
      .bind(
        crypto.randomUUID(),
        documentId,
        outcome,
        this.now().toISOString(),
        accessSubject,
      )
      .run();
    if (result.meta.changes !== 1)
      throw new ProviderLegalDocumentError("not_found");
  }
}
