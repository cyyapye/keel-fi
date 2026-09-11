import {
  MAX_PORTFOLIO_WATCH_JOB_BATCH,
  decideSourceLifecycle,
  evaluateSourceUrl,
  OfficialCompanySourceStatusSchema,
  SourceGradeSchema,
} from "@keel/connectors";
import {
  FinancingAnnouncementFactsSchema,
  HttpsSourceUrlSchema,
  IsoTimestampSchema,
} from "@keel/domain";
import { z } from "zod";

const SourceKindSchema = z.enum([
  "official_company_web",
  "official_rss",
  "official_atom",
]);

const SourceJobSchema = z.object({
  type: z.enum([
    "portfolio_watch_source_verify",
    "portfolio_watch_source_scan",
  ]),
  sourceId: z.string().min(1),
});

const DUE_PORTFOLIO_WATCH_SOURCE_JOBS_SQL = `
  SELECT source.id, source.status
  FROM portfolio_watch_source_sync_state sync
    INDEXED BY portfolio_watch_source_sync_due_idx
  JOIN portfolio_watch_sources source ON source.id = sync.source_id
  JOIN portfolio_watch_targets target
    ON target.id = source.watch_target_id
   AND target.household_id = source.household_id
   AND target.company_id = source.company_id
  WHERE sync.next_check_at <= ?
    AND target.status = 'active'
    AND source.status IN ('discovered', 'verified', 'active', 'degraded')
  ORDER BY sync.next_check_at, source.id
  LIMIT ?`;

export const PortfolioWatchScanPreparationSchema = z.object({
  checkedAt: IsoTimestampSchema,
  jobs: z.array(SourceJobSchema),
});

export const PortfolioWatchSourceRecordSchema = z.object({
  id: z.string().min(1),
  householdId: z.string().min(1),
  watchTargetId: z.string().min(1),
  companyId: z.string().min(1),
  companyName: z.string().min(1),
  approvedWebsiteHost: z.string().min(1),
  sourceKind: SourceKindSchema,
  canonicalUrl: z.url(),
  allowedOrigin: z.url(),
  allowedPathPrefix: z.string().startsWith("/"),
  status: OfficialCompanySourceStatusSchema,
  grade: SourceGradeSchema,
});

export const PortfolioWatchDiscoveredCandidateSchema = z.object({
  canonicalUrl: z.url(),
  sourceKind: SourceKindSchema,
  discoveryMethod: z.string().min(1).max(80),
  grade: SourceGradeSchema,
});

export const PortfolioWatchVerificationInputSchema = z.object({
  sourceId: z.string().min(1),
  nextStatus: OfficialCompanySourceStatusSchema,
  reasonCode: z.string().min(1).max(120),
  observedUrl: z.url(),
  normalizedUrl: z.url().nullable(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  contentType: z.string().max(255).nullable(),
  redirectUrl: z.url().nullable(),
  securityPassed: z.boolean(),
  grade: SourceGradeSchema,
  checkedAt: IsoTimestampSchema,
  contentSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  etag: z.string().max(1_024).nullable(),
  lastModified: z.string().max(1_024).nullable(),
  errorCode: z.string().max(120).nullable(),
});

function normalizeEvidenceWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export const PortfolioWatchObservationInputSchema = z
  .object({
    sourceId: z.string().min(1),
    objectKey: z.string().min(1).max(1_024),
    contentType: z.string().min(1).max(255),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    retrievedAt: IsoTimestampSchema,
    sourceUrl: HttpsSourceUrlSchema,
    sourceTitle: z.string().trim().min(1).max(500),
    publishedAt: IsoTimestampSchema,
    eventType: z.enum([
      "financing_announced",
      "acquisition_announced",
      "secondary_transaction_announced",
      "public_listing_announced",
      "operations_ended",
      "company_update",
    ]),
    observedFact: z.string().trim().min(1).max(2_000),
    modelConfidencePpm: z.number().int().min(0).max(1_000_000),
    financingFacts: FinancingAnnouncementFactsSchema.nullable(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.eventType !== "financing_announced" &&
      input.financingFacts !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["financingFacts"],
        message: "Only financing announcements can contain financing facts.",
      });
    }
    if (input.financingFacts === null) {
      return;
    }

    const normalizedTitle = normalizeEvidenceWhitespace(input.sourceTitle);
    const normalizedObservedFact = normalizeEvidenceWhitespace(
      input.observedFact,
    );
    const retainedEvidence = normalizedObservedFact
      .toLowerCase()
      .includes(normalizedTitle.toLowerCase())
      ? normalizedObservedFact
      : normalizeEvidenceWhitespace(
          `${normalizedTitle}. ${normalizedObservedFact}`,
        );
    const moneyFacts = [
      ["announcedAmount", input.financingFacts.announcedAmount],
      ["companyValuation", input.financingFacts.companyValuation],
    ] as const;
    for (const [field, fact] of moneyFacts) {
      if (
        fact !== null &&
        !retainedEvidence.includes(
          normalizeEvidenceWhitespace(fact.evidenceText),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["financingFacts", field, "evidenceText"],
          message:
            "Financing evidence text must appear in the retained source title or observed fact.",
        });
      }
    }
  });

export type PortfolioWatchScanPreparation = z.infer<
  typeof PortfolioWatchScanPreparationSchema
>;
export type PortfolioWatchSourceRecord = z.infer<
  typeof PortfolioWatchSourceRecordSchema
>;
export type PortfolioWatchDiscoveredCandidate = z.infer<
  typeof PortfolioWatchDiscoveredCandidateSchema
>;
export type PortfolioWatchVerificationInput = z.infer<
  typeof PortfolioWatchVerificationInputSchema
>;
export type PortfolioWatchObservationInput = z.infer<
  typeof PortfolioWatchObservationInputSchema
>;

export interface ScheduledPortfolioWatchRepository {
  listDueSourceJobs(
    dueAt: string,
    limit: number,
  ): Promise<PortfolioWatchScanPreparation["jobs"]>;
}

type SourceRow = {
  id: string;
  household_id: string;
  watch_target_id: string;
  company_id: string;
  company_name: string;
  approved_website_host: string;
  source_kind: z.infer<typeof SourceKindSchema>;
  canonical_url: string;
  allowed_origin: string;
  allowed_path_prefix: string;
  status: z.infer<typeof OfficialCompanySourceStatusSchema>;
  authority_ppm: number;
  identity_confidence_ppm: number;
  operational_health_ppm: number;
};

type SourceIdentityRow = {
  id: string;
  household_id: string;
  watch_target_id: string;
  company_id: string;
  canonical_url: string;
  allowed_origin: string;
  status: z.infer<typeof OfficialCompanySourceStatusSchema>;
};

type DiscoveredSourceInput = {
  id: string;
  householdId: string;
  targetId: string;
  companyId: string;
  kind: z.infer<typeof SourceKindSchema>;
  url: string;
  origin: string;
  path: string;
  authority: number;
  identity: number;
  operational: number;
  coverage: string;
  method: string;
  observedUrl: string;
  occurredAt: string;
};

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

function sourceRecord(row: SourceRow): PortfolioWatchSourceRecord {
  return PortfolioWatchSourceRecordSchema.parse({
    id: row.id,
    householdId: row.household_id,
    watchTargetId: row.watch_target_id,
    companyId: row.company_id,
    companyName: row.company_name,
    approvedWebsiteHost: row.approved_website_host,
    sourceKind: row.source_kind,
    canonicalUrl: row.canonical_url,
    allowedOrigin: row.allowed_origin,
    allowedPathPrefix: row.allowed_path_prefix,
    status: row.status,
    grade: {
      authorityPpm: row.authority_ppm,
      identityPpm: row.identity_confidence_ppm,
      securityPpm: row.status === "quarantined" ? 0 : 1_000_000,
      operationalPpm: row.operational_health_ppm,
    },
  });
}

function nextCheckAt(checkedAt: string, succeeded: boolean): string {
  const next = new Date(checkedAt);
  next.setUTCMinutes(next.getUTCMinutes() + (succeeded ? 7 * 24 * 60 : 60));
  return next.toISOString();
}

export class D1PortfolioWatchRepository {
  public constructor(private readonly db: D1Database) {}

  public async listDueSourceJobs(
    rawDueAt: string,
    rawLimit: number,
  ): Promise<PortfolioWatchScanPreparation["jobs"]> {
    const dueAt = z.iso.datetime({ offset: true }).parse(rawDueAt);
    const limit = Math.min(
      z.number().int().min(1).max(100).parse(rawLimit),
      MAX_PORTFOLIO_WATCH_JOB_BATCH,
    );
    const rows = await all<{
      id: string;
      status: z.infer<typeof OfficialCompanySourceStatusSchema>;
    }>(this.db.prepare(DUE_PORTFOLIO_WATCH_SOURCE_JOBS_SQL).bind(dueAt, limit));
    return z.array(SourceJobSchema).parse(
      rows.map((source) => ({
        type:
          source.status === "active"
            ? "portfolio_watch_source_scan"
            : "portfolio_watch_source_verify",
        sourceId: source.id,
      })),
    );
  }

  public async prepareScan(
    householdId: string,
  ): Promise<PortfolioWatchScanPreparation> {
    const checkedAt = new Date().toISOString();
    // Accepted exposure changes already register homepages in the canonical
    // database transaction. Preparing a scan only selects a bounded job batch.
    const sources = await all<{
      id: string;
      status: z.infer<typeof OfficialCompanySourceStatusSchema>;
    }>(
      this.db
        .prepare(
          `SELECT source.id, source.status
           FROM portfolio_watch_sources source
           JOIN portfolio_watch_targets target ON target.id = source.watch_target_id
           LEFT JOIN portfolio_watch_source_sync_state sync ON sync.source_id = source.id
           WHERE source.household_id = ?
             AND target.status = 'active'
             AND source.status IN ('discovered', 'verified', 'active', 'degraded')
           ORDER BY COALESCE(sync.last_attempt_at, ''), source.id
           LIMIT ?`,
        )
        .bind(householdId, MAX_PORTFOLIO_WATCH_JOB_BATCH),
    );

    return PortfolioWatchScanPreparationSchema.parse({
      checkedAt,
      jobs: sources.map((source) => ({
        type:
          source.status === "active"
            ? "portfolio_watch_source_scan"
            : "portfolio_watch_source_verify",
        sourceId: source.id,
      })),
    });
  }

  public async getSource(
    sourceId: string,
  ): Promise<PortfolioWatchSourceRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
           source.id,
           source.household_id,
           source.watch_target_id,
           source.company_id,
           company.legal_name AS company_name,
           company.website_host AS approved_website_host,
           source.source_kind,
           source.canonical_url,
           source.allowed_origin,
           source.allowed_path_prefix,
           source.status,
           source.authority_ppm,
           source.identity_confidence_ppm,
           source.operational_health_ppm
         FROM portfolio_watch_sources source
         JOIN companies company ON company.id = source.company_id
         JOIN portfolio_watch_targets target ON target.id = source.watch_target_id
         WHERE source.id = ?
           AND target.status = 'active'
           AND source.status <> 'revoked'
           AND source.household_id = target.household_id
           AND source.company_id = target.company_id
           AND company.household_id = source.household_id`,
      )
      .bind(sourceId)
      .first<SourceRow>();
    return row === null ? null : sourceRecord(row);
  }

  public async registerCandidates(
    parentSourceId: string,
    rawCandidates: readonly PortfolioWatchDiscoveredCandidate[],
    discoveredAt: string,
  ): Promise<PortfolioWatchScanPreparation["jobs"]> {
    const candidates = z
      .array(PortfolioWatchDiscoveredCandidateSchema)
      .max(40)
      .parse(rawCandidates);
    const parent = await this.db
      .prepare(
        `SELECT source.id, source.household_id, source.watch_target_id,
                source.company_id, source.canonical_url, source.allowed_origin,
                source.status
         FROM portfolio_watch_sources source
         JOIN portfolio_watch_targets target ON target.id = source.watch_target_id
         JOIN companies company ON company.id = source.company_id
         WHERE source.id = ?
           AND source.status NOT IN ('quarantined', 'revoked')
           AND source.household_id = target.household_id
           AND source.company_id = target.company_id
           AND company.household_id = source.household_id`,
      )
      .bind(parentSourceId)
      .first<SourceIdentityRow>();
    if (parent === null) {
      return [];
    }

    const existing = await all<{ canonical_url: string }>(
      this.db
        .prepare(
          `SELECT canonical_url FROM portfolio_watch_sources WHERE watch_target_id = ?`,
        )
        .bind(parent.watch_target_id),
    );
    const knownUrls = new Set(existing.map((source) => source.canonical_url));
    let remaining = Math.max(0, 50 - existing.length);
    const requestedUrls = new Set<string>();
    const additions: DiscoveredSourceInput[] = [];
    for (const candidate of candidates) {
      const policy = evaluateSourceUrl({
        rawUrl: candidate.canonicalUrl,
        approvedWebsiteHost: new URL(parent.allowed_origin).hostname,
      });
      if (!policy.accepted || requestedUrls.has(policy.source.canonicalUrl))
        continue;
      const url = new URL(policy.source.canonicalUrl);
      requestedUrls.add(url.href);
      if (knownUrls.has(url.href) || remaining === 0) continue;
      remaining--;
      additions.push({
        id: crypto.randomUUID(),
        householdId: parent.household_id,
        targetId: parent.watch_target_id,
        companyId: parent.company_id,
        kind: candidate.sourceKind,
        url: url.href,
        origin: url.origin,
        path: url.pathname,
        authority: candidate.grade.authorityPpm,
        identity: candidate.grade.identityPpm,
        operational: candidate.grade.operationalPpm,
        coverage: JSON.stringify({
          discoveryMethod: candidate.discoveryMethod,
          parentSourceId,
        }),
        method: candidate.discoveryMethod,
        observedUrl: candidate.canonicalUrl,
        occurredAt: discoveredAt,
      });
    }
    await this.insertDiscoveredSources(additions);
    const recoverable = await all<{ id: string }>(
      this.db
        .prepare(
          `SELECT source.id FROM portfolio_watch_sources source
       LEFT JOIN portfolio_watch_source_sync_state sync ON sync.source_id = source.id
       WHERE source.watch_target_id = ? AND source.status = 'discovered'
         AND source.canonical_url IN (SELECT value FROM json_each(?))
         AND sync.last_attempt_at IS NULL`,
        )
        .bind(parent.watch_target_id, JSON.stringify([...requestedUrls])),
    );
    return z.array(SourceJobSchema).parse(
      recoverable.map((source) => ({
        type: "portfolio_watch_source_verify",
        sourceId: source.id,
      })),
    );
  }

  private async insertDiscoveredSources(
    sources: readonly DiscoveredSourceInput[],
  ): Promise<void> {
    if (sources.length === 0) return;
    const input = JSON.stringify(sources);
    // A transaction keeps registration and discovery evidence together. The
    // conflict target handles racing discovery without swallowing other errors.
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO portfolio_watch_sources (
        id, household_id, watch_target_id, company_id, source_kind, source_class,
        canonical_url, allowed_origin, allowed_path_prefix, status, authority_ppm,
        identity_confidence_ppm, operational_health_ppm, coverage_json,
        auto_activated_at, created_at, updated_at)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.householdId'),
          json_extract(value, '$.targetId'), json_extract(value, '$.companyId'),
          json_extract(value, '$.kind'), 'official_company', json_extract(value, '$.url'),
          json_extract(value, '$.origin'), json_extract(value, '$.path'), 'discovered',
          json_extract(value, '$.authority'), json_extract(value, '$.identity'),
          json_extract(value, '$.operational'), json_extract(value, '$.coverage'), NULL,
          json_extract(value, '$.occurredAt'), json_extract(value, '$.occurredAt')
        FROM json_each(?) input
        WHERE (SELECT COUNT(*) FROM portfolio_watch_sources existing
          WHERE existing.watch_target_id = json_extract(input.value, '$.targetId')) < 50
        ON CONFLICT(watch_target_id, canonical_url) DO NOTHING`,
        )
        .bind(input),
      this.db
        .prepare(
          `INSERT INTO portfolio_watch_source_verification_events (
        id, household_id, source_id, event_type, reason_code, observed_url,
        normalized_url, http_status, content_type, redirect_url, security_passed,
        authority_ppm, identity_confidence_ppm, coverage_json, occurred_at)
        SELECT source.id || ':discovered', source.household_id, source.id,
          'discovered', json_extract(input.value, '$.method'),
          json_extract(input.value, '$.observedUrl'), source.canonical_url,
          NULL, NULL, NULL, 1, source.authority_ppm, source.identity_confidence_ppm,
          source.coverage_json, source.created_at
        FROM json_each(?) input
        JOIN portfolio_watch_sources source ON source.id = json_extract(input.value, '$.id')`,
        )
        .bind(input),
      this.db
        .prepare(
          `INSERT INTO portfolio_watch_source_sync_state (
        source_id, next_check_at, consecutive_failure_count, updated_at)
        SELECT source.id, source.created_at, 0, source.created_at
        FROM json_each(?) input
        JOIN portfolio_watch_sources source ON source.id = json_extract(input.value, '$.id')`,
        )
        .bind(input),
    ]);
  }

  public async recordVerification(
    rawInput: PortfolioWatchVerificationInput,
  ): Promise<void> {
    const input = PortfolioWatchVerificationInputSchema.parse(rawInput);
    const source = await this.getSource(input.sourceId);
    if (source === null) {
      return;
    }
    if (source.status === "quarantined" && input.nextStatus !== "quarantined") {
      throw new Error(
        "A quarantined source cannot re-enter monitoring automatically.",
      );
    }
    if (
      (input.nextStatus === "active" || input.nextStatus === "verified") &&
      !input.securityPassed
    ) {
      throw new Error(
        "An active or verified source must pass security checks.",
      );
    }
    if (input.nextStatus === "active" || input.nextStatus === "verified") {
      const lifecycle = decideSourceLifecycle({
        currentStatus: source.status,
        grade: input.grade,
      });
      if (lifecycle.nextStatus !== input.nextStatus) {
        throw new Error(
          "Source verification does not satisfy its lifecycle grade.",
        );
      }
    }
    const succeeded =
      input.nextStatus === "active" || input.nextStatus === "verified";
    const coverageJson = JSON.stringify({ reasonCode: input.reasonCode });

    await this.db.batch([
      this.db
        .prepare(
          `UPDATE portfolio_watch_sources
           SET status = ?, authority_ppm = ?, identity_confidence_ppm = ?,
               operational_health_ppm = ?, coverage_json = ?,
               auto_activated_at = CASE WHEN ? = 'active' THEN COALESCE(auto_activated_at, ?) ELSE auto_activated_at END,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.nextStatus,
          input.grade.authorityPpm,
          input.grade.identityPpm,
          input.grade.operationalPpm,
          coverageJson,
          input.nextStatus,
          input.checkedAt,
          input.checkedAt,
          input.sourceId,
        ),
      this.db
        .prepare(
          `INSERT INTO portfolio_watch_source_verification_events (
             id, household_id, source_id, event_type, reason_code,
             observed_url, normalized_url, http_status, content_type,
             redirect_url, security_passed, authority_ppm,
             identity_confidence_ppm, coverage_json, occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          source.householdId,
          input.sourceId,
          input.nextStatus === "active" ? "activated" : input.nextStatus,
          input.reasonCode,
          input.observedUrl,
          input.normalizedUrl,
          input.httpStatus,
          input.contentType,
          input.redirectUrl,
          input.securityPassed ? 1 : 0,
          input.grade.authorityPpm,
          input.grade.identityPpm,
          coverageJson,
          input.checkedAt,
        ),
      this.db
        .prepare(
          `INSERT INTO portfolio_watch_source_sync_state (
             source_id, etag, last_modified, last_content_sha256,
             last_attempt_at, last_success_at, next_check_at, last_http_status,
             consecutive_failure_count, last_error_code, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_id) DO UPDATE SET
             etag = excluded.etag,
             last_modified = excluded.last_modified,
             last_content_sha256 = COALESCE(excluded.last_content_sha256, last_content_sha256),
             last_attempt_at = excluded.last_attempt_at,
             last_success_at = CASE WHEN ? THEN excluded.last_success_at ELSE last_success_at END,
             next_check_at = excluded.next_check_at,
             last_http_status = excluded.last_http_status,
             consecutive_failure_count = CASE WHEN ? THEN 0 ELSE consecutive_failure_count + 1 END,
             last_error_code = excluded.last_error_code,
             updated_at = excluded.updated_at`,
        )
        .bind(
          input.sourceId,
          input.etag,
          input.lastModified,
          input.contentSha256,
          input.checkedAt,
          succeeded ? input.checkedAt : null,
          nextCheckAt(input.checkedAt, succeeded),
          input.httpStatus,
          succeeded ? 0 : 1,
          input.errorCode,
          input.checkedAt,
          succeeded ? 1 : 0,
          succeeded ? 1 : 0,
        ),
      this.db
        .prepare(
          `UPDATE portfolio_watch_targets SET last_checked_at = ?
           WHERE id = ? AND household_id = ?`,
        )
        .bind(input.checkedAt, source.watchTargetId, source.householdId),
    ]);
  }

  public async existingObservationFingerprints(
    householdId: string,
    fingerprints: readonly string[],
  ): Promise<Set<string>> {
    if (fingerprints.length === 0) return new Set();
    const existing = await all<{ fingerprint: string }>(
      this.db
        .prepare(
          `SELECT fingerprint FROM public_source_observations
       WHERE household_id = ? AND fingerprint IN (SELECT value FROM json_each(?))`,
        )
        .bind(householdId, JSON.stringify(fingerprints)),
    );
    return new Set(existing.map((row) => row.fingerprint));
  }

  public async hasObservation(
    householdId: string,
    fingerprint: string,
  ): Promise<boolean> {
    return (
      await this.existingObservationFingerprints(householdId, [fingerprint])
    ).has(fingerprint);
  }

  public async recordObservation(
    rawInput: PortfolioWatchObservationInput,
  ): Promise<boolean> {
    return (await this.recordObservations([rawInput])) > 0;
  }

  public async recordObservations(
    rawInputs: readonly PortfolioWatchObservationInput[],
  ): Promise<number> {
    const inputs = z
      .array(PortfolioWatchObservationInputSchema)
      .max(40)
      .parse(rawInputs);
    if (inputs.length === 0) return 0;
    if (inputs.some((input) => input.sourceId !== inputs[0]!.sourceId))
      throw new Error("Observation batch must describe one source");
    const source = await this.getSource(inputs[0]!.sourceId);
    if (source === null || source.status !== "active") return 0;
    const validated = inputs.map((input) => {
      const url = evaluateSourceUrl({
        rawUrl: input.sourceUrl,
        approvedWebsiteHost: source.approvedWebsiteHost,
      });
      if (
        !url.accepted ||
        new URL(url.source.canonicalUrl).origin !== source.allowedOrigin
      )
        throw new Error(
          "Observation URL is outside the approved company origin.",
        );
      return { ...input, sourceUrl: url.source.canonicalUrl };
    });
    const existing = await this.existingObservationFingerprints(
      source.householdId,
      validated.map((input) => input.fingerprint),
    );
    const newInputs = validated.filter((input) => {
      if (existing.has(input.fingerprint)) return false;
      existing.add(input.fingerprint);
      return true;
    });
    if (newInputs.length === 0) return 0;
    const documents = await all<{ id: string; sha256: string }>(
      this.db
        .prepare(
          `SELECT id, sha256 FROM source_documents WHERE household_id = ?
       AND sha256 IN (SELECT value FROM json_each(?))`,
        )
        .bind(
          source.householdId,
          JSON.stringify(newInputs.map((input) => input.sha256)),
        ),
    );
    const documentIds = new Map(
      documents.map((document) => [document.sha256, document.id]),
    );
    const newDocuments: Record<string, unknown>[] = [];
    const observations = newInputs.map((input) => {
      let documentId = documentIds.get(input.sha256);
      if (documentId === undefined) {
        documentId = crypto.randomUUID();
        documentIds.set(input.sha256, documentId);
        newDocuments.push({ ...input, documentId });
      }
      return {
        ...input,
        documentId,
        eventId: crypto.randomUUID(),
        claimId: crypto.randomUUID(),
        observationId: crypto.randomUUID(),
        claimPath:
          input.financingFacts === null
            ? `company_event.${input.eventType}`
            : "company_event.financing_terms",
        claimJson: JSON.stringify({
          title: input.sourceTitle,
          publishedAt: input.publishedAt,
          sourceUrl: input.sourceUrl,
          financingFacts: input.financingFacts,
        }),
      };
    });
    const encoded = JSON.stringify(observations);
    // Fixed statements for up to forty events. A duplicate racing another
    // delivery rolls back this transaction; the retry sees the existing evidence.
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO source_documents (
        id, household_id, object_key, file_name, content_type, byte_size, sha256,
        effective_date, retrieved_at, source_label, review_status, created_at)
        SELECT json_extract(value, '$.documentId'), ?, json_extract(value, '$.objectKey'),
          json_extract(value, '$.sourceId') || '.source', json_extract(value, '$.contentType'),
          json_extract(value, '$.byteSize'), json_extract(value, '$.sha256'),
          substr(json_extract(value, '$.publishedAt'), 1, 10), json_extract(value, '$.retrievedAt'),
          'Official company website', 'pending_review', json_extract(value, '$.retrievedAt')
        FROM json_each(?)`,
        )
        .bind(source.householdId, JSON.stringify(newDocuments)),
      this.db
        .prepare(
          `INSERT INTO evidence_events (
        id, household_id, company_id, source_document_id, event_type, headline,
        effective_date, detected_at, retrieved_at, status, confidence_ppm,
        prior_value_json, replacement_value_json, estimated_forecast_impact_minor, created_at)
        SELECT json_extract(value, '$.eventId'), ?, ?, json_extract(value, '$.documentId'),
          json_extract(value, '$.eventType'), json_extract(value, '$.sourceTitle'),
          substr(json_extract(value, '$.publishedAt'), 1, 10), json_extract(value, '$.retrievedAt'),
          json_extract(value, '$.retrievedAt'), 'pending_review', ?, '{}', '{}', 0,
          json_extract(value, '$.retrievedAt') FROM json_each(?)`,
        )
        .bind(
          source.householdId,
          source.companyId,
          source.grade.authorityPpm,
          encoded,
        ),
      this.db
        .prepare(
          `INSERT INTO evidence_claims (
        id, household_id, evidence_event_id, field_path, claim_value_json, unit, provenance, created_at)
        SELECT json_extract(value, '$.claimId'), ?, json_extract(value, '$.eventId'),
          json_extract(value, '$.claimPath'), json_extract(value, '$.claimJson'), NULL,
          'Official company website', json_extract(value, '$.retrievedAt')
        FROM json_each(?)`,
        )
        .bind(source.householdId, encoded),
      this.db
        .prepare(
          `INSERT INTO public_source_observations (
        id, household_id, company_id, evidence_event_id, source_document_id, source_class,
        source_url, source_title, published_at, retrieved_at, observed_fact, inference,
        source_reliability_ppm, model_confidence_ppm, valuation_low_minor, valuation_middle_minor,
        valuation_high_minor, limitations, fingerprint, created_at, source_id)
        SELECT json_extract(value, '$.observationId'), ?, ?, json_extract(value, '$.eventId'),
          json_extract(value, '$.documentId'), 'official_company', json_extract(value, '$.sourceUrl'),
          json_extract(value, '$.sourceTitle'), json_extract(value, '$.publishedAt'),
          json_extract(value, '$.retrievedAt'), json_extract(value, '$.observedFact'),
          'This is a company-level public signal. It does not imply a holding value or liquidity outcome.',
          ?, json_extract(value, '$.modelConfidencePpm'), NULL, NULL, NULL,
          'Public company information does not establish security terms, ownership, dilution, fees, taxes, or liquidity for this holding.',
          json_extract(value, '$.fingerprint'), json_extract(value, '$.retrievedAt'),
          json_extract(value, '$.sourceId') FROM json_each(?)`,
        )
        .bind(
          source.householdId,
          source.companyId,
          source.grade.authorityPpm,
          encoded,
        ),
      this.db
        .prepare(
          `UPDATE portfolio_watch_targets SET last_checked_at = ?
        WHERE id = ? AND household_id = ?`,
        )
        .bind(
          newInputs.at(-1)!.retrievedAt,
          source.watchTargetId,
          source.householdId,
        ),
    ]);
    return observations.length;
  }
}

export const __portfolioWatchTest = {
  dueSourceJobsSql: DUE_PORTFOLIO_WATCH_SOURCE_JOBS_SQL,
};
