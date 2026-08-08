import {
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

type TargetRow = {
  id: string;
  company_id: string;
  website_host: string | null;
};

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

type RecoverableDiscoveredSourceRow = {
  id: string;
  last_attempt_at: string | null;
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
  next.setUTCMinutes(next.getUTCMinutes() + (succeeded ? 6 * 60 : 60));
  return next.toISOString();
}

function isSourceUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "UNIQUE constraint failed: portfolio_watch_sources.watch_target_id, portfolio_watch_sources.canonical_url",
    )
  );
}

export class D1PortfolioWatchRepository {
  public constructor(private readonly db: D1Database) {}

  public async prepareScan(
    householdId: string,
  ): Promise<PortfolioWatchScanPreparation> {
    const checkedAt = new Date().toISOString();
    const targets = await all<TargetRow>(
      this.db
        .prepare(
          `SELECT target.id, target.company_id, company.website_host
           FROM portfolio_watch_targets target
           JOIN companies company ON company.id = target.company_id
           WHERE target.household_id = ?
             AND company.household_id = target.household_id
             AND target.status = 'active'
           ORDER BY target.id`,
        )
        .bind(householdId),
    );

    for (const target of targets) {
      if (target.website_host === null) {
        continue;
      }
      const homepage = evaluateSourceUrl({
        rawUrl: `https://${target.website_host}/`,
        approvedWebsiteHost: target.website_host,
      });
      if (!homepage.accepted) {
        continue;
      }

      const existing = await this.db
        .prepare(
          `SELECT id FROM portfolio_watch_sources
           WHERE watch_target_id = ? AND canonical_url = ?`,
        )
        .bind(target.id, homepage.source.canonicalUrl)
        .first<{ id: string }>();
      if (existing !== null) {
        continue;
      }

      const sourceId = crypto.randomUUID();
      const coverageJson = JSON.stringify({
        discoveryMethod: "configured_homepage",
      });
      try {
        await this.db.batch([
          this.db
            .prepare(
              `INSERT INTO portfolio_watch_sources (
             id, household_id, watch_target_id, company_id, source_kind,
             source_class, canonical_url, allowed_origin, allowed_path_prefix,
             status, authority_ppm, identity_confidence_ppm,
             operational_health_ppm, coverage_json, auto_activated_at,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'official_company_web', 'official_company',
             ?, ?, '/', 'discovered', 1000000, 850000, 0, ?, NULL, ?, ?)`,
            )
            .bind(
              sourceId,
              householdId,
              target.id,
              target.company_id,
              homepage.source.canonicalUrl,
              new URL(homepage.source.canonicalUrl).origin,
              coverageJson,
              checkedAt,
              checkedAt,
            ),
          this.db
            .prepare(
              `INSERT INTO portfolio_watch_source_verification_events (
                 id, household_id, source_id, event_type, reason_code,
                 observed_url, normalized_url, http_status, content_type,
                 redirect_url, security_passed, authority_ppm,
                 identity_confidence_ppm, coverage_json, occurred_at
               ) VALUES (?, ?, ?, 'discovered', 'configured_homepage', ?, ?,
                 NULL, NULL, NULL, 1, 1000000, 850000, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              householdId,
              sourceId,
              homepage.source.canonicalUrl,
              homepage.source.canonicalUrl,
              coverageJson,
              checkedAt,
            ),
          this.db
            .prepare(
              `INSERT INTO portfolio_watch_source_sync_state (
                 source_id, next_check_at, consecutive_failure_count, updated_at
               ) VALUES (?, ?, 0, ?)`,
            )
            .bind(sourceId, checkedAt, checkedAt),
        ]);
      } catch (error) {
        if (!isSourceUniqueConstraint(error)) {
          throw error;
        }
      }
    }

    const sources = await all<{
      id: string;
      status: z.infer<typeof OfficialCompanySourceStatusSchema>;
    }>(
      this.db
        .prepare(
          `SELECT source.id, source.status
           FROM portfolio_watch_sources source
           JOIN portfolio_watch_targets target ON target.id = source.watch_target_id
           WHERE source.household_id = ?
             AND target.status = 'active'
             AND source.status IN ('discovered', 'verified', 'active', 'degraded')
           ORDER BY source.id`,
        )
        .bind(householdId),
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

    const existingCount = await this.db
      .prepare(
        `SELECT COUNT(*) AS source_count
         FROM portfolio_watch_sources WHERE watch_target_id = ?`,
      )
      .bind(parent.watch_target_id)
      .first<{ source_count: number }>();
    let remaining = Math.max(0, 50 - (existingCount?.source_count ?? 0));

    const jobs: PortfolioWatchScanPreparation["jobs"] = [];
    for (const candidate of candidates) {
      if (remaining === 0) {
        break;
      }
      const policy = evaluateSourceUrl({
        rawUrl: candidate.canonicalUrl,
        approvedWebsiteHost: new URL(parent.allowed_origin).hostname,
      });
      if (!policy.accepted) {
        continue;
      }

      const sourceId = crypto.randomUUID();
      const coverageJson = JSON.stringify({
        discoveryMethod: candidate.discoveryMethod,
        parentSourceId,
      });
      const url = new URL(policy.source.canonicalUrl);
      try {
        await this.db.batch([
          this.db
            .prepare(
              `INSERT INTO portfolio_watch_sources (
             id, household_id, watch_target_id, company_id, source_kind,
             source_class, canonical_url, allowed_origin, allowed_path_prefix,
             status, authority_ppm, identity_confidence_ppm,
             operational_health_ppm, coverage_json, auto_activated_at,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'official_company', ?, ?, ?, 'discovered',
             ?, ?, ?, ?, NULL, ?, ?)`,
            )
            .bind(
              sourceId,
              parent.household_id,
              parent.watch_target_id,
              parent.company_id,
              candidate.sourceKind,
              policy.source.canonicalUrl,
              url.origin,
              url.pathname,
              candidate.grade.authorityPpm,
              candidate.grade.identityPpm,
              candidate.grade.operationalPpm,
              coverageJson,
              discoveredAt,
              discoveredAt,
            ),
          this.db
            .prepare(
              `INSERT INTO portfolio_watch_source_verification_events (
               id, household_id, source_id, event_type, reason_code,
               observed_url, normalized_url, http_status, content_type,
               redirect_url, security_passed, authority_ppm,
               identity_confidence_ppm, coverage_json, occurred_at
             ) VALUES (?, ?, ?, 'discovered', ?, ?, ?, NULL, NULL, NULL, 1,
               ?, ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              parent.household_id,
              sourceId,
              candidate.discoveryMethod,
              candidate.canonicalUrl,
              policy.source.canonicalUrl,
              candidate.grade.authorityPpm,
              candidate.grade.identityPpm,
              coverageJson,
              discoveredAt,
            ),
          this.db
            .prepare(
              `INSERT INTO portfolio_watch_source_sync_state (
               source_id, next_check_at, consecutive_failure_count, updated_at
             ) VALUES (?, ?, 0, ?)`,
            )
            .bind(sourceId, discoveredAt, discoveredAt),
        ]);
        jobs.push({
          type: "portfolio_watch_source_verify",
          sourceId,
        });
        remaining -= 1;
      } catch (error) {
        if (!isSourceUniqueConstraint(error)) {
          throw error;
        }
        const existing = await this.db
          .prepare(
            `SELECT source.id, sync.last_attempt_at
             FROM portfolio_watch_sources source
             LEFT JOIN portfolio_watch_source_sync_state sync
               ON sync.source_id = source.id
             WHERE source.watch_target_id = ?
               AND source.canonical_url = ?
               AND source.status = 'discovered'`,
          )
          .bind(parent.watch_target_id, policy.source.canonicalUrl)
          .first<RecoverableDiscoveredSourceRow>();
        if (existing?.last_attempt_at === null) {
          jobs.push({
            type: "portfolio_watch_source_verify",
            sourceId: existing.id,
          });
        }
      }
    }
    return z.array(SourceJobSchema).parse(jobs);
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

  public async hasObservation(
    householdId: string,
    fingerprint: string,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT id FROM public_source_observations
         WHERE household_id = ? AND fingerprint = ?`,
      )
      .bind(householdId, fingerprint)
      .first<{ id: string }>();
    return row !== null;
  }

  public async recordObservation(
    rawInput: PortfolioWatchObservationInput,
  ): Promise<boolean> {
    const input = PortfolioWatchObservationInputSchema.parse(rawInput);
    const source = await this.getSource(input.sourceId);
    if (source === null || source.status !== "active") {
      return false;
    }
    const observedUrl = evaluateSourceUrl({
      rawUrl: input.sourceUrl,
      approvedWebsiteHost: source.approvedWebsiteHost,
    });
    if (
      !observedUrl.accepted ||
      new URL(observedUrl.source.canonicalUrl).origin !== source.allowedOrigin
    ) {
      throw new Error(
        "Observation URL is outside the approved company origin.",
      );
    }
    if (await this.hasObservation(source.householdId, input.fingerprint)) {
      return false;
    }

    const existingDocument = await this.db
      .prepare(
        `SELECT id FROM source_documents WHERE household_id = ? AND sha256 = ?`,
      )
      .bind(source.householdId, input.sha256)
      .first<{ id: string }>();
    const sourceDocumentId = existingDocument?.id ?? crypto.randomUUID();
    const evidenceEventId = crypto.randomUUID();
    const effectiveDate = input.publishedAt.slice(0, 10);
    const claimPath =
      input.financingFacts === null
        ? `company_event.${input.eventType}`
        : "company_event.financing_terms";
    const sourceLabel = "Official company website";
    const limitations =
      "Public company information does not establish security terms, ownership, dilution, fees, taxes, or liquidity for this holding.";
    const inference =
      "This is a company-level public signal. It does not imply a holding value or liquidity outcome.";
    const statements: D1PreparedStatement[] = [];

    if (existingDocument === null) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO source_documents (
               id, household_id, object_key, file_name, content_type,
               byte_size, sha256, effective_date, retrieved_at, source_label,
               review_status, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)`,
          )
          .bind(
            sourceDocumentId,
            source.householdId,
            input.objectKey,
            `${input.sourceId}.source`,
            input.contentType,
            input.byteSize,
            input.sha256,
            effectiveDate,
            input.retrievedAt,
            sourceLabel,
            input.retrievedAt,
          ),
      );
    }

    statements.push(
      this.db
        .prepare(
          `INSERT INTO evidence_events (
             id, household_id, company_id, source_document_id, event_type,
             headline, effective_date, detected_at, retrieved_at, status,
             confidence_ppm, prior_value_json, replacement_value_json,
             estimated_forecast_impact_minor, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, '{}',
             '{}', 0, ?)`,
        )
        .bind(
          evidenceEventId,
          source.householdId,
          source.companyId,
          sourceDocumentId,
          input.eventType,
          input.sourceTitle,
          effectiveDate,
          input.retrievedAt,
          input.retrievedAt,
          source.grade.authorityPpm,
          input.retrievedAt,
        ),
      this.db
        .prepare(
          `INSERT INTO evidence_claims (
             id, household_id, evidence_event_id, field_path, claim_value_json,
             unit, provenance, created_at
           ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          source.householdId,
          evidenceEventId,
          claimPath,
          JSON.stringify({
            title: input.sourceTitle,
            publishedAt: input.publishedAt,
            sourceUrl: observedUrl.source.canonicalUrl,
            financingFacts: input.financingFacts,
          }),
          sourceLabel,
          input.retrievedAt,
        ),
      this.db
        .prepare(
          `INSERT INTO public_source_observations (
             id, household_id, company_id, evidence_event_id,
             source_document_id, source_class, source_url, source_title,
             published_at, retrieved_at, observed_fact, inference,
             source_reliability_ppm, model_confidence_ppm,
             valuation_low_minor, valuation_middle_minor,
             valuation_high_minor, limitations, fingerprint, created_at,
             source_id
           ) VALUES (?, ?, ?, ?, ?, 'official_company', ?, ?, ?, ?, ?, ?, ?, ?,
             NULL, NULL, NULL, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          source.householdId,
          source.companyId,
          evidenceEventId,
          sourceDocumentId,
          observedUrl.source.canonicalUrl,
          input.sourceTitle,
          input.publishedAt,
          input.retrievedAt,
          input.observedFact,
          inference,
          source.grade.authorityPpm,
          input.modelConfidencePpm,
          limitations,
          input.fingerprint,
          input.retrievedAt,
          input.sourceId,
        ),
      this.db
        .prepare(
          `UPDATE portfolio_watch_targets SET last_checked_at = ?
           WHERE id = ? AND household_id = ?`,
        )
        .bind(input.retrievedAt, source.watchTargetId, source.householdId),
    );
    await this.db.batch(statements);
    return true;
  }
}
