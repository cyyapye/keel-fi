import { automaticEconomics } from "@keel/domain/automatic-investment-review";
import {
  CreateDocumentInvestmentInputSchema,
  InvestmentCompanyReceiptSchema,
  InvestmentCompanyReviewInputSchema,
  InvestmentOwnershipObservationSchema,
  InvestmentReviewContextSchema,
  InvestmentReviewStateSchema,
  ReviewInvestmentInputSchema,
  investmentEvidenceRevision,
  investmentCompanyEvidenceRevision,
  type CreateDocumentInvestmentInput,
  type InvestmentCompanyReceipt,
  type InvestmentCompanyReviewInput,
  type InvestmentReviewContext,
  type InvestmentReviewState,
  type ReviewInvestmentInput,
} from "@keel/domain/investment-review";
import {
  LegalEntitySourceSummarySchema,
  exactLegalEntityTypeFromName,
} from "@keel/domain/legal-entities";
import {
  LegalEntityNameEvidenceSchema,
  reviewedInvestmentNameEvidence,
} from "@keel/domain/position-read-model";
import {
  LegalDocumentScanSchema,
  LegalNameDocumentReferenceSchema,
} from "@keel/domain/provider-legal-documents";
import { z } from "zod";
import { PositionEconomicsTermsSchema } from "@keel/domain/position-economics";

type Identity = { household_id: string; user_id: string };
type Position = {
  id: string;
  legal_vehicle_name: string;
  owner_label: string;
  currency: string;
  position_kind: string;
  provider: string;
  opened_on: string | null;
  snapshot_id: string | null;
  allocation_minor: number | null;
  invested_minor: number | null;
  provider_status: string | null;
  evidence_json: string | null;
  origin_json: string | null;
  state_json: string | null;
  receipt_json: string | null;
  economics_json: string | null;
  automatic_review_json: string | null;
  observation_id: string | null;
  reported_management_fee_ppm: number | null;
  reported_carry_ppm: number | null;
  observed_at: string | null;
};
type Mapping = {
  id: string;
  exposure_id: string;
  company_id: string | null;
  canonical_name: string;
  status: "active" | "withdrawn";
  relationship_kind: string;
  version: number;
  effective_at: string;
  decision_source: string;
  accepted_at: string;
};
const documentsSchema = z.array(LegalNameDocumentReferenceSchema).max(100);
function evidenceGuard(
  context: InvestmentReviewContext,
  observationId: string | null,
  incoming: {
    position_id: string;
    document_id: string;
    review_id: string;
  }[] = [],
): string {
  return JSON.stringify({
    observationId,
    reviewId: context.review?.id ?? null,
    incoming: incoming
      .map(
        (item) => `${item.position_id}:${item.document_id}:${item.review_id}`,
      )
      .sort(),
    scans: context.documents.map((doc) => ({
      id: doc.id,
      sha256: doc.sha256,
      scannedAt: doc.scan?.scannedAt ?? null,
      outcome: doc.scan?.outcome ?? null,
    })),
  });
}

export class InvestmentReviewError extends Error {
  public constructor(
    public readonly code:
      "not_found" | "stale" | "invalid_evidence" | "invalid_input",
    message: string,
  ) {
    super(message);
    this.name = "InvestmentReviewError";
  }
}
const stale = () =>
  new InvestmentReviewError(
    "stale",
    "This investment changed. Close and reopen its review before saving.",
  );
const invalid = (message: string) =>
  new InvestmentReviewError("invalid_evidence", message);

export interface InvestmentReviewRepository {
  getContext(
    subject: string,
    positionId: string,
  ): Promise<InvestmentReviewContext>;
  review(
    subject: string,
    positionId: string,
    input: ReviewInvestmentInput,
  ): Promise<InvestmentReviewState>;
  reviewCompany(
    subject: string,
    positionId: string,
    input: InvestmentCompanyReviewInput,
  ): Promise<InvestmentCompanyReceipt>;
  createRelated(
    subject: string,
    positionId: string,
    input: CreateDocumentInvestmentInput,
  ): Promise<{ positionId: string }>;
}

// Detail-only, projection-only queries. The collection GET does not call this
// once per row. Every collection below is bounded and each join is indexed.
export class D1InvestmentReviewRepository implements InvestmentReviewRepository {
  public constructor(private readonly db: D1Database) {}
  private async identity(subject: string): Promise<Identity> {
    const identity = await this.db
      .prepare(
        `SELECT h.id household_id, u.id user_id FROM users u JOIN households h ON h.owner_user_id = u.id WHERE u.access_subject = ? ORDER BY h.created_at LIMIT 1`,
      )
      .bind(subject)
      .first<Identity>();
    if (identity === null)
      throw new InvestmentReviewError("not_found", "Investment not found.");
    return identity;
  }
  private async load(identity: Identity, positionId: string) {
    const position = await this.db
      .prepare(
        `SELECT p.id, p.legal_vehicle_name, p.owner_label, p.currency, p.position_kind, p.provider, p.opened_on,
      s.id snapshot_id, s.allocation_minor, s.invested_minor, s.provider_status,
      observation.evidence_json, observation.id observation_id, origin.source_json origin_json, review.state_json,
      reported_terms.management_fee_ppm reported_management_fee_ppm, reported_terms.carry_ppm reported_carry_ppm, s.observed_at,
      COALESCE(company_review.receipt_json, json_extract(automatic.details_json, '$.company.receipt')) receipt_json,
      CASE WHEN automatic.snapshot_id = s.id
        AND json_extract(automatic.result_guard_json, '$.observationId') IS observation.id
        AND json_extract(automatic.result_guard_json, '$.reviewId') IS review.id
        AND json_extract(automatic.result_guard_json, '$.companyReviewId') IS company_review.id
        AND json_extract(automatic.result_guard_json, '$.termsId') IS terms.id
        THEN automatic.summary_json ELSE NULL END automatic_review_json,
      CASE WHEN terms.id IS NULL THEN NULL ELSE json_object(
        'id', terms.id, 'positionId', p.id, 'acceptedAgainstSnapshotId', terms.snapshot_id,
        'commitmentMinorAtAcceptance', terms.commitment_minor, 'fundedMinorAtAcceptance', terms.funded_minor,
        'capitalBasis', terms.capital_basis, 'grossCommitmentMinor', terms.gross_commitment_minor, 'setupFeePpm', terms.setup_fee_ppm,
        'annualAdminFeePpm', terms.annual_admin_fee_ppm, 'adminFeeYears', terms.admin_fee_years,
        'carryPpm', terms.carry_ppm, 'note', terms.note, 'acceptedAt', terms_review.decided_at, 'decisionSource', terms.decision_source
      ) END economics_json
      FROM holding_positions p
      LEFT JOIN holding_import_applications a ON a.id = (SELECT candidate.id FROM holding_import_applications candidate JOIN holding_position_snapshots snapshot ON snapshot.id = candidate.snapshot_id WHERE candidate.position_id = p.id ORDER BY candidate.applied_at DESC, snapshot.observed_at DESC, candidate.id DESC LIMIT 1)
      LEFT JOIN holding_position_snapshots s ON s.id = a.snapshot_id
      LEFT JOIN holding_import_rows r ON r.id = a.import_row_id
      LEFT JOIN holding_import_row_reported_economics_evidence reported_terms ON reported_terms.import_row_id = r.id
      LEFT JOIN holding_import_row_provider_investments provider_identity ON provider_identity.import_row_id = r.id
      LEFT JOIN provider_legal_document_latest latest ON latest.household_id = p.household_id AND latest.provider = p.provider AND latest.position_fingerprint = r.position_fingerprint
      LEFT JOIN provider_legal_document_observations observation ON observation.id = latest.observation_id
        AND (provider_identity.provider_investment_id IS NULL OR json_extract(observation.capture_json, '$.sourceInvestment.id') = provider_identity.provider_investment_id)
      LEFT JOIN document_investment_origins origin ON origin.position_id = p.id
      LEFT JOIN holding_investment_reviews review ON review.id = (SELECT id FROM holding_investment_reviews WHERE household_id = p.household_id AND position_id = p.id ORDER BY version DESC LIMIT 1)
      LEFT JOIN investment_company_reviews company_review ON company_review.id = (SELECT id FROM investment_company_reviews WHERE household_id = p.household_id AND position_id = p.id ORDER BY version DESC LIMIT 1)
      LEFT JOIN automatic_investment_reviews automatic ON automatic.id = (SELECT id FROM automatic_investment_reviews WHERE household_id = p.household_id AND position_id = p.id ORDER BY version DESC LIMIT 1)
      LEFT JOIN holding_position_economics_proposals terms ON terms.id = (
        SELECT proposal.id FROM holding_position_economics_proposals proposal
        JOIN holding_position_economics_reviews accepted ON accepted.proposal_id = proposal.id AND accepted.decision = 'accepted'
        WHERE proposal.household_id = p.household_id AND proposal.position_id = p.id AND NOT EXISTS (
          SELECT 1 FROM holding_position_economics_proposals later JOIN holding_position_economics_reviews accepted_later ON accepted_later.proposal_id = later.id AND accepted_later.decision = 'accepted'
          WHERE later.supersedes_proposal_id = proposal.id
        ) ORDER BY accepted.decided_at DESC, proposal.id DESC LIMIT 1
      )
      LEFT JOIN holding_position_economics_reviews terms_review ON terms_review.proposal_id = terms.id AND terms_review.decision = 'accepted'
      WHERE p.id = ? AND p.household_id = ? AND p.position_kind <> 'direct'
        AND NOT EXISTS (SELECT 1 FROM holding_position_continuities WHERE predecessor_position_id = p.id)`,
      )
      .bind(positionId, identity.household_id)
      .first<Position>();
    if (position === null)
      throw new InvestmentReviewError("not_found", "Investment not found.");
    const [mappings, companies, otherPositions, incoming] = await Promise.all([
      this.db
        .prepare(
          `SELECT m.id, m.exposure_id, e.company_id, e.canonical_name, m.status, m.relationship_kind, m.version, m.effective_at, m.decision_source, m.accepted_at
        FROM holding_position_exposure_mappings m JOIN canonical_exposures e ON e.id = m.exposure_id
        WHERE m.household_id = ? AND m.position_id = ? AND NOT EXISTS (SELECT 1 FROM holding_position_exposure_mappings later WHERE later.supersedes_mapping_id = m.id)
        ORDER BY m.exposure_id LIMIT 101`,
        )
        .bind(identity.household_id, positionId)
        .all<Mapping>(),
      this.db
        .prepare(
          `SELECT id, legal_name legalName FROM companies WHERE household_id = ? ORDER BY legal_name, id LIMIT 5001`,
        )
        .bind(identity.household_id)
        .all<{ id: string; legalName: string }>(),
      this.db
        .prepare(
          `SELECT p.id, COALESCE(v.legal_name, p.legal_vehicle_name) label FROM holding_positions p
        LEFT JOIN legal_entity_source_decisions d ON d.source_kind = 'holding_position' AND d.source_reference = p.id AND d.household_id = p.household_id AND d.decision = 'linked'
          AND NOT EXISTS (SELECT 1 FROM legal_entity_source_decisions later WHERE later.supersedes_decision_id = d.id)
        LEFT JOIN legal_entity_versions v ON v.legal_entity_id = d.legal_entity_id AND NOT EXISTS (SELECT 1 FROM legal_entity_versions later WHERE later.supersedes_version_id = v.id)
        WHERE p.household_id = ? AND p.id <> ? AND p.position_kind <> 'direct'
          AND NOT EXISTS (SELECT 1 FROM holding_position_continuities WHERE predecessor_position_id = p.id)
        ORDER BY label, p.id LIMIT 5001`,
        )
        .bind(identity.household_id, positionId)
        .all<{ id: string; label: string }>(),
      this.db
        .prepare(
          `SELECT position_id, document_id, review_id, document_json FROM investment_document_assignments WHERE household_id = ? AND target_position_id = ? ORDER BY document_id LIMIT 101`,
        )
        .bind(identity.household_id, positionId)
        .all<{
          position_id: string;
          document_id: string;
          review_id: string;
          document_json: string;
        }>(),
    ]);
    const review =
      position.state_json === null
        ? null
        : InvestmentReviewStateSchema.parse(JSON.parse(position.state_json));
    const original =
      position.origin_json === null
        ? null
        : LegalEntitySourceSummarySchema.parse(
            JSON.parse(position.origin_json),
          );
    const evidence =
      position.evidence_json === null
        ? original?.legalEntityNameEvidence
        : LegalEntityNameEvidenceSchema.parse(
            JSON.parse(position.evidence_json),
          );
    const rawDocuments = [
      ...new Map(
        [
          ...(evidence?.documents ?? []),
          ...incoming.results.map((row) =>
            LegalNameDocumentReferenceSchema.parse(
              JSON.parse(row.document_json),
            ),
          ),
        ].map((doc) => [doc.id, doc]),
      ).values(),
    ];
    if (rawDocuments.length > 100)
      throw invalid("This investment exceeds the 100-document review limit.");
    const scans = await this.db
      .prepare(
        `SELECT document_id, scan_json FROM private_document_scans WHERE household_id = ? AND document_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(
        identity.household_id,
        JSON.stringify(rawDocuments.map((doc) => doc.id)),
      )
      .all<{ document_id: string; scan_json: string }>();
    const scansById = new Map(
      scans.results.map((row) => [
        row.document_id,
        LegalDocumentScanSchema.parse(JSON.parse(row.scan_json)),
      ]),
    );
    const documents = documentsSchema.parse(
      rawDocuments.map((document) => ({
        ...document,
        scan: scansById.get(document.id),
      })),
    );
    const excluded = new Set(
      review?.documentAssignments
        .filter((item) => item.relationship !== "supports")
        .map((item) => item.documentId),
    );
    const choices = documents
      .filter(
        (doc) =>
          !excluded.has(doc.id) &&
          doc.scan?.outcome === "clean" &&
          (doc.sourceInvestment?.association === "investment_page" ||
            doc.sourceInvestment?.association === "document_investment_id" ||
            review?.documentAssignments.some(
              (a) => a.documentId === doc.id && a.relationship === "supports",
            )),
      )
      .flatMap((doc) =>
        (doc.companyCitations ?? []).map((citation) => ({
          documentId: doc.id,
          sha256: doc.sha256,
          companyName: citation.companyName,
          page: citation.page,
          quote: citation.quote,
        })),
      );
    const context = InvestmentReviewContextSchema.parse({
      positionId,
      positionLabel: position.legal_vehicle_name,
      automaticReview:
        position.automatic_review_json === null
          ? null
          : (JSON.parse(position.automatic_review_json) as unknown),
      holderLabel: position.owner_label,
      snapshotId: position.snapshot_id,
      committedMinor: position.allocation_minor,
      fundedMinor: position.invested_minor,
      currency: position.currency,
      economics:
        position.snapshot_id === null ||
        (position.allocation_minor ?? 0) <= 0 ||
        position.position_kind !== "spv_interest"
          ? null
          : {
              snapshotId: position.snapshot_id,
              currency: position.currency,
              committedMinor: position.allocation_minor,
              fundedMinor: position.invested_minor,
              acceptedTerms:
                position.economics_json === null
                  ? null
                  : PositionEconomicsTermsSchema.parse(
                      JSON.parse(position.economics_json),
                    ),
              reportedTerms:
                position.reported_management_fee_ppm === null &&
                position.reported_carry_ppm === null
                  ? null
                  : {
                      managementFeePpm: position.reported_management_fee_ppm,
                      carryPpm: position.reported_carry_ppm,
                      observedAt: position.observed_at,
                      sourceLabel:
                        position.provider === "sydecar"
                          ? "Sydecar template"
                          : "Imported source",
                    },
            },
      review,
      defaultParticipationStatus:
        position.provider_status === "live"
          ? "current"
          : position.provider_status === "realized"
            ? "historical"
            : "unknown",
      documents,
      evidenceRevision: await investmentEvidenceRevision({
        documents,
        assignments: review?.documentAssignments ?? [],
        observationId: position.observation_id,
      }),
      companyChoices: choices,
      companies: companies.results,
      mappings: mappings.results.map((m) => ({
        id: m.id,
        companyId: m.company_id,
        companyName: m.canonical_name,
        status: m.status,
        decisionSource: m.decision_source,
        acceptedAt: m.accepted_at,
      })),
      companyReceipt:
        position.receipt_json === null
          ? null
          : InvestmentCompanyReceiptSchema.parse(
              JSON.parse(position.receipt_json),
            ),
      otherPositions: otherPositions.results,
    });
    if (context.economics !== null) {
      context.economics.reportedTerms = automaticEconomics(
        context.economics,
        documents.filter(
          (doc) =>
            !excluded.has(doc.id) &&
            (doc.sourceInvestment?.association === "investment_page" ||
              doc.sourceInvestment?.association === "document_investment_id" ||
              review?.documentAssignments.some(
                (assignment) =>
                  assignment.documentId === doc.id &&
                  assignment.relationship === "supports",
              )),
        ),
      ).reported;
    }
    return {
      position,
      context,
      mappings: mappings.results,
      guard: evidenceGuard(context, position.observation_id, incoming.results),
    };
  }
  public async getContext(subject: string, positionId: string) {
    return (await this.load(await this.identity(subject), positionId)).context;
  }
  private check(
    context: InvestmentReviewContext,
    input: {
      expectedSnapshotId: string | null;
      expectedEvidenceRevision: string;
    },
  ) {
    if (
      context.snapshotId !== input.expectedSnapshotId ||
      context.evidenceRevision !== input.expectedEvidenceRevision
    )
      throw stale();
  }
  private document(
    context: InvestmentReviewContext,
    id: string,
    sha256?: string,
  ) {
    const document = context.documents.find(
      (doc) => doc.id === id && (sha256 === undefined || doc.sha256 === sha256),
    );
    if (document === undefined || document.scan?.outcome !== "clean")
      throw invalid(
        "Choose a supporting document that has passed its security check.",
      );
    return document;
  }
  private async retry(
    identity: Identity,
    positionId: string,
    requestId: string,
    hash: string,
    kind: "review" | "company" | "origin",
  ) {
    const table =
      kind === "review"
        ? "holding_investment_reviews"
        : kind === "company"
          ? "investment_company_reviews"
          : "document_investment_origins";
    const field =
      kind === "review"
        ? "state_json"
        : kind === "company"
          ? "receipt_json"
          : "source_json";
    const row = await this.db
      .prepare(
        `SELECT position_id, request_sha256, ${field} payload FROM ${table} WHERE household_id = ? AND request_id = ?`,
      )
      .bind(identity.household_id, requestId)
      .first<{
        position_id: string;
        request_sha256: string;
        payload: string;
      }>();
    if (
      row !== null &&
      (row.request_sha256 !== hash ||
        (kind !== "origin" && row.position_id !== positionId))
    )
      throw stale();
    return row;
  }
  private reviewStatement(
    identity: Identity,
    context: InvestmentReviewContext,
    input: ReviewInvestmentInput,
    hash: string,
    state: InvestmentReviewState,
    guard: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO holding_investment_reviews (id, household_id, position_id, request_id, request_sha256, expected_snapshot_id, supersedes_review_id, version, state_json, reviewer_user_id, recorded_at, evidence_guard_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        state.id,
        identity.household_id,
        context.positionId,
        input.requestId,
        hash,
        context.snapshotId,
        context.review?.id ?? null,
        state.version,
        JSON.stringify(state),
        identity.user_id,
        state.recordedAt,
        guard,
      );
  }
  private assignmentStatements(
    identity: Identity,
    context: InvestmentReviewContext,
    state: InvestmentReviewState,
  ) {
    return state.documentAssignments.map((assignment) => {
      const doc = this.document(
        context,
        assignment.documentId,
        assignment.sha256,
      );
      if (
        assignment.targetPositionId !== null &&
        !context.otherPositions.some(
          (p) => p.id === assignment.targetPositionId,
        )
      )
        throw invalid("Choose another investment from this household.");
      return this.db
        .prepare(
          `INSERT INTO investment_document_assignments (household_id, position_id, document_id, relationship, target_position_id, document_json, review_id) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(position_id, document_id) DO UPDATE SET relationship = excluded.relationship, target_position_id = excluded.target_position_id, document_json = excluded.document_json, review_id = excluded.review_id`,
        )
        .bind(
          identity.household_id,
          context.positionId,
          doc.id,
          assignment.relationship,
          assignment.targetPositionId,
          JSON.stringify(doc),
          state.id,
        );
    });
  }
  private async batch(statements: D1PreparedStatement[]) {
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE|stale|supersession/u.test(error.message)
      )
        throw stale();
      throw error;
    }
  }
  // A concurrent duplicate or an uncertain response converges on the original
  // committed receipt. A reused key with different content still fails closed.
  private async commit(
    identity: Identity,
    positionId: string,
    requestId: string,
    hash: string,
    kind: "review" | "company" | "origin",
    statements: D1PreparedStatement[],
  ) {
    try {
      await this.batch(statements);
      return null;
    } catch (error) {
      const receipt = await this.retry(
        identity,
        positionId,
        requestId,
        hash,
        kind,
      );
      if (receipt !== null) return receipt;
      throw error;
    }
  }
  public async review(
    subject: string,
    positionId: string,
    rawInput: ReviewInvestmentInput,
  ) {
    const input = ReviewInvestmentInputSchema.parse(rawInput);
    const identity = await this.identity(subject);
    const hash = await investmentEvidenceRevision({ positionId, input });
    const retry = await this.retry(
      identity,
      positionId,
      input.requestId,
      hash,
      "review",
    );
    if (retry !== null)
      return InvestmentReviewStateSchema.parse(JSON.parse(retry.payload));
    const { context, guard } = await this.load(identity, positionId);
    this.check(context, input);
    if ((context.review?.id ?? null) !== input.expectedReviewId) throw stale();
    const recordedAt = new Date().toISOString();
    const ownership = input.ownershipObservation;
    const observations = [...(context.review?.ownershipObservations ?? [])];
    if (ownership !== undefined) {
      if (ownership.supersedesObservationId !== null) {
        const previous = observations.find(
          (item) => item.id === ownership.supersedesObservationId,
        );
        if (
          previous === undefined ||
          previous.sourceKind !== ownership.sourceKind ||
          previous.taxYear !== ownership.taxYear ||
          observations.some(
            (item) => item.supersedesObservationId === previous.id,
          )
        )
          throw invalid(
            "Choose the current ownership observation being amended.",
          );
      }
      const doc =
        ownership.documentId === null
          ? null
          : this.document(context, ownership.documentId);
      observations.push(
        InvestmentOwnershipObservationSchema.parse({
          ...ownership,
          id: crypto.randomUUID(),
          recordedAt,
          evidenceBasis: doc === null ? "user_reported" : "document_review",
          documentSha256: doc?.sha256 ?? null,
        }),
      );
    }
    const assignments = new Map(
      context.review?.documentAssignments.map((item) => [
        item.documentId,
        item,
      ]),
    );
    for (const item of input.documentAssignments ?? [])
      assignments.set(item.documentId, item);
    const state = InvestmentReviewStateSchema.parse({
      id: crypto.randomUUID(),
      positionId,
      version: (context.review?.version ?? 0) + 1,
      participationStatus: input.participationStatus,
      ownershipObservations: observations,
      documentAssignments: [...assignments.values()],
      recordedAt,
    });
    const committed = await this.commit(
      identity,
      positionId,
      input.requestId,
      hash,
      "review",
      [
        this.reviewStatement(identity, context, input, hash, state, guard),
        ...this.assignmentStatements(identity, context, {
          ...state,
          documentAssignments: input.documentAssignments ?? [],
        }),
      ],
    );
    return committed === null
      ? state
      : InvestmentReviewStateSchema.parse(JSON.parse(committed.payload));
  }
  public async reviewCompany(
    subject: string,
    positionId: string,
    rawInput: InvestmentCompanyReviewInput,
  ) {
    const input = InvestmentCompanyReviewInputSchema.parse(rawInput);
    const identity = await this.identity(subject);
    const hash = await investmentEvidenceRevision({ positionId, input });
    const retry = await this.retry(
      identity,
      positionId,
      input.requestId,
      hash,
      "company",
    );
    if (retry !== null)
      return InvestmentCompanyReceiptSchema.parse(JSON.parse(retry.payload));
    const { context, mappings, guard } = await this.load(identity, positionId);
    this.check(context, input);
    if (
      JSON.stringify([...input.expectedMappingIds].sort()) !==
      JSON.stringify(mappings.map((m) => m.id).sort())
    )
      throw stale();
    let company =
      input.company.mode === "existing"
        ? context.companies.find(
            (c) =>
              input.company.mode === "existing" &&
              c.id === input.company.companyId,
          )
        : undefined;
    const createCompany = input.company.mode === "new";
    if (input.company.mode === "new") {
      if (
        context.companies.some(
          (c) =>
            c.legalName.toLowerCase() ===
            (input.company.mode === "new"
              ? input.company.legalName.toLowerCase()
              : ""),
        )
      )
        throw invalid(
          "This company already exists. Choose the existing company.",
        );
      company = { id: crypto.randomUUID(), legalName: input.company.legalName };
    }
    if (company === undefined)
      throw invalid("Choose a company from this household.");
    if (input.citation !== null) {
      this.document(context, input.citation.documentId, input.citation.sha256);
      if (
        context.review?.documentAssignments.some(
          (a) =>
            a.documentId === input.citation?.documentId &&
            a.relationship !== "supports",
        )
      )
        throw invalid("This document is not assigned to this investment.");
      if (
        input.basis === "document_choice" &&
        (!context.companyChoices.some(
          (choice) => JSON.stringify(choice) === JSON.stringify(input.citation),
        ) ||
          company.legalName !== input.citation.companyName)
      )
        throw invalid(
          "Choose the exact company reported in the document, or record a correction.",
        );
      if (
        input.basis === "document_correction" &&
        input.citation.companyName !== company.legalName
      )
        throw invalid("The citation must name the reviewed company.");
    }
    const existingExposure = await this.db
      .prepare(
        `SELECT id FROM canonical_exposures WHERE household_id = ? AND company_id = ?`,
      )
      .bind(identity.household_id, company.id)
      .first<{ id: string }>();
    const exposureId = existingExposure?.id ?? crypto.randomUUID();
    const mappingId = crypto.randomUUID();
    const recordedAt = new Date().toISOString();
    const receipt = InvestmentCompanyReceiptSchema.parse({
      ...input,
      companyEvidenceRevision: await investmentCompanyEvidenceRevision(
        context.companyChoices,
      ),
      positionId,
      companyId: company.id,
      companyName: company.legalName,
      mappingId,
      recordedAt,
      sourceDocument:
        input.citation === null
          ? null
          : this.document(
              context,
              input.citation.documentId,
              input.citation.sha256,
            ),
    });
    const evidenceHash = input.citation?.sha256 ?? hash;
    const statements = [
      this.db
        .prepare(
          `INSERT INTO investment_company_reviews (id, household_id, position_id, request_id, request_sha256, receipt_json, reviewer_user_id, recorded_at, evidence_guard_json, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM investment_company_reviews WHERE position_id = ?))`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          positionId,
          input.requestId,
          hash,
          JSON.stringify(receipt),
          identity.user_id,
          recordedAt,
          guard,
          positionId,
        ),
    ];
    if (createCompany)
      statements.push(
        this.db
          .prepare(
            `INSERT INTO companies (id, household_id, legal_name, website_host, status, created_at, updated_at) VALUES (?, ?, ?, NULL, 'active', ?, ?)`,
          )
          .bind(
            company.id,
            identity.household_id,
            company.legalName,
            recordedAt,
            recordedAt,
          ),
      );
    if (existingExposure === null)
      statements.push(
        this.db
          .prepare(
            `INSERT INTO canonical_exposures (id, household_id, exposure_kind, canonical_name, protected_identity_key, company_id, resolution_method, evidence_sha256, created_by_user_id, created_at, immutable) VALUES (?, ?, 'private_company', ?, NULL, ?, 'reviewed_company', ?, ?, ?, 1)`,
          )
          .bind(
            exposureId,
            identity.household_id,
            company.legalName,
            company.id,
            evidenceHash,
            identity.user_id,
            recordedAt,
          ),
      );
    const insertMapping = (
      m: Mapping | undefined,
      target: string,
      active: boolean,
    ) =>
      this.db
        .prepare(
          `INSERT INTO holding_position_exposure_mappings (id, household_id, position_id, exposure_id, relationship_kind, allocation_ppm, status, decision_source, decision_reference, evidence_sha256, effective_at, version, supersedes_mapping_id, accepted_by_user_id, accepted_at, immutable) VALUES (?, ?, ?, ?, 'look_through', ?, ?, 'review', ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          active ? mappingId : crypto.randomUUID(),
          identity.household_id,
          positionId,
          target,
          active ? 1_000_000 : null,
          active ? "active" : "withdrawn",
          `Investment company review ${input.requestId}`,
          evidenceHash,
          m !== undefined && m.effective_at > recordedAt
            ? m.effective_at
            : recordedAt,
          (m?.version ?? 0) + 1,
          m?.id ?? null,
          identity.user_id,
          recordedAt,
        );
    for (const m of mappings.filter(
      (m) => m.status === "active" && m.exposure_id !== exposureId,
    ))
      statements.push(insertMapping(m, m.exposure_id, false));
    statements.push(
      insertMapping(
        mappings.find((m) => m.exposure_id === exposureId),
        exposureId,
        true,
      ),
    );
    const committed = await this.commit(
      identity,
      positionId,
      input.requestId,
      hash,
      "company",
      statements,
    );
    return committed === null
      ? receipt
      : InvestmentCompanyReceiptSchema.parse(JSON.parse(committed.payload));
  }
  public async createRelated(
    subject: string,
    positionId: string,
    rawInput: CreateDocumentInvestmentInput,
  ) {
    const input = CreateDocumentInvestmentInputSchema.parse(rawInput);
    const identity = await this.identity(subject);
    const hash = await investmentEvidenceRevision({ positionId, input });
    const retry = await this.retry(
      identity,
      positionId,
      input.requestId,
      hash,
      "origin",
    );
    if (retry !== null) return { positionId: retry.position_id };
    const { context, position, guard } = await this.load(identity, positionId);
    this.check(context, input);
    if ((context.review?.id ?? null) !== input.expectedReviewId) throw stale();
    const documents = input.documentIds.map((id) => this.document(context, id));
    if (
      context.review?.documentAssignments.some(
        (a) =>
          input.documentIds.includes(a.documentId) &&
          a.relationship === "other_investment",
      )
    )
      throw invalid(
        "An agreement is already assigned to another investment. Review that assignment first.",
      );
    const id = crypto.randomUUID();
    const recordedAt = new Date().toISOString();
    const names = [
      ...new Set(
        documents.flatMap(
          (doc) => doc.citations?.map((citation) => citation.legalName) ?? [],
        ),
      ),
    ];
    const evidence = reviewedInvestmentNameEvidence(
      LegalEntityNameEvidenceSchema.parse(
        names.length === 1
          ? {
              state: "document_reported",
              legalName: names[0],
              sourceField: "Agreement",
              documents,
            }
          : {
              state: "unavailable",
              legalName: null,
              sourceField: null,
              problem: names.length > 1 ? "conflicting" : "name_not_found",
              documents,
            },
      ),
      null,
      documents,
    );
    const source = LegalEntitySourceSummarySchema.parse({
      source: { kind: "holding_position", id },
      sourceDisplayName: input.label,
      legalEntityNameEvidence: evidence,
      suggestedEntityType:
        evidence.legalName === null
          ? null
          : exactLegalEntityTypeFromName(evidence.legalName),
      sourceLabel: "Reviewed agreement",
      sourceAsOf: recordedAt.slice(0, 10),
      relationship: "investment_vehicle",
      currentOwner: position.owner_label,
      interestStatus: "unknown",
      openedOn: null,
      financials: null,
      currentDecisionId: null,
    });
    const childState = InvestmentReviewStateSchema.parse({
      id: crypto.randomUUID(),
      positionId: id,
      version: 1,
      participationStatus: input.participationStatus,
      ownershipObservations: [],
      documentAssignments: [],
      recordedAt,
    });
    const parentState = InvestmentReviewStateSchema.parse({
      id: crypto.randomUUID(),
      positionId,
      version: (context.review?.version ?? 0) + 1,
      participationStatus:
        context.review?.participationStatus ??
        context.defaultParticipationStatus,
      ownershipObservations: context.review?.ownershipObservations ?? [],
      documentAssignments: [
        ...(context.review?.documentAssignments.filter(
          (a) => !input.documentIds.includes(a.documentId),
        ) ?? []),
        ...documents.map((doc) => ({
          documentId: doc.id,
          sha256: doc.sha256,
          relationship: "other_investment",
          targetPositionId: id,
        })),
      ],
      recordedAt,
    });
    const parentInput = ReviewInvestmentInputSchema.parse({
      requestId: input.requestId,
      expectedReviewId: input.expectedReviewId,
      expectedSnapshotId: input.expectedSnapshotId,
      expectedEvidenceRevision: input.expectedEvidenceRevision,
      participationStatus: parentState.participationStatus,
    });
    const childContext = {
      ...context,
      positionId: id,
      snapshotId: null,
      review: null,
    };
    const childInput = {
      ...parentInput,
      requestId: crypto.randomUUID(),
      expectedSnapshotId: null,
      expectedReviewId: null,
    };
    const fingerprint = await investmentEvidenceRevision({
      origin: input.requestId,
      householdId: identity.household_id,
    });
    const committed = await this.commit(
      identity,
      positionId,
      input.requestId,
      hash,
      "origin",
      [
        this.db
          .prepare(
            `INSERT INTO holding_positions (id, household_id, provider, position_fingerprint, legal_vehicle_name, owner_label, position_kind, instrument_type, opened_on, currency, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'spv_interest', 'Document-reported interest', NULL, ?, ?, ?)`,
          )
          .bind(
            id,
            identity.household_id,
            position.provider,
            fingerprint,
            input.label,
            position.owner_label,
            position.currency,
            identity.user_id,
            recordedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO holding_position_ownerships (id, household_id, container_id, position_id, protected_position_key, association_basis, evidence_sha256, version, supersedes_ownership_id, accepted_by_user_id, accepted_at, immutable)
        SELECT ?, household_id, container_id, ?, ?, 'manual', ?, 1, NULL, ?, ?, 1 FROM holding_position_ownerships ownership
        WHERE ownership.household_id = ? AND ownership.position_id = ? AND NOT EXISTS (SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id = ownership.id)`,
          )
          .bind(
            crypto.randomUUID(),
            id,
            fingerprint,
            hash,
            identity.user_id,
            recordedAt,
            identity.household_id,
            positionId,
          ),
        this.db
          .prepare(
            `INSERT INTO document_investment_origins (position_id, household_id, source_position_id, request_id, request_sha256, source_json, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            identity.household_id,
            positionId,
            input.requestId,
            hash,
            JSON.stringify(source),
            identity.user_id,
            recordedAt,
          ),
        this.reviewStatement(
          identity,
          context,
          parentInput,
          hash,
          parentState,
          guard,
        ),
        this.reviewStatement(
          identity,
          childContext,
          childInput,
          await investmentEvidenceRevision(childInput),
          childState,
          evidenceGuard(childContext, null),
        ),
        ...this.assignmentStatements(
          identity,
          {
            ...context,
            otherPositions: [
              ...context.otherPositions,
              { id, label: input.label },
            ],
          },
          {
            ...parentState,
            documentAssignments: parentState.documentAssignments.filter((a) =>
              input.documentIds.includes(a.documentId),
            ),
          },
        ),
      ],
    );
    return { positionId: committed?.position_id ?? id };
  }
}
