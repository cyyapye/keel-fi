import { sourceInvestmentAmount } from "@keel/domain/investment-review";
import {
  companyNameKey,
  companySuggestionKey,
} from "@keel/domain/company-identity";
import { loadCompanyIdentityChoices, identityChoice } from "./company-identity";
import {
  AUTOMATIC_INVESTMENT_BATCH_SIZE,
  AutomaticInvestmentReviewSchema,
  INVESTMENT_REVIEW_POLICY,
  automaticCompanyChoice,
  automaticCompanyChoices,
  automaticEconomics,
  automaticLegalName,
  issue,
  type AutomaticReviewIssue,
  type AutomaticReviewSection,
  type ResolveInvestmentReviewsResult,
} from "@keel/domain/automatic-investment-review";
import {
  InvestmentCompanyReceiptSchema,
  InvestmentReviewStateSchema,
  investmentEvidenceRevision,
  investmentCompanyEvidenceRevision,
} from "@keel/domain/investment-review";
import { exactLegalEntityTypeFromName } from "@keel/domain/legal-entities";
import {
  LegalEntityNameEvidenceSchema,
  reviewedInvestmentNameEvidence,
} from "@keel/domain/position-read-model";
import {
  LegalDocumentScanSchema,
  type LegalNameDocumentReference,
} from "@keel/domain/provider-legal-documents";
import {
  PositionEconomicsTermsSchema,
  calculatePositionEconomics,
} from "@keel/domain/position-economics";

type Identity = { household_id: string; user_id: string };
type Row = {
  id: string;
  provider: string;
  position_kind: string;
  legal_vehicle_name: string;
  owner_label: string;
  currency: string;
  opened_on: string | null;
  application_id: string;
  import_id: string;
  snapshot_id: string;
  allocation_minor: number;
  invested_minor: number;
  provider_status: string;
  observed_at: string;
  provider_investment_id: string | null;
  observation_id: string | null;
  evidence_json: string | null;
  evidence_oversized: number;
  review_id: string | null;
  state_json: string | null;
  company_review_id: string | null;
  receipt_json: string | null;
  economics_json: string | null;
  economics_source: string | null;
  reported_management_fee_ppm: number | null;
  reported_carry_ppm: number | null;
  entity_decision_id: string | null;
  entity_decision: string | null;
  entity_decision_source: string | null;
  entity_version_id: string | null;
  entity_version: number | null;
  accepted_legal_name: string | null;
  entity_id: string | null;
  auto_id: string | null;
  auto_version: number | null;
  auto_result_guard_json: string | null;
  auto_summary_json: string | null;
};
type Mapping = {
  id: string;
  position_id: string;
  exposure_id: string;
  company_id: string | null;
  canonical_name: string;
  status: string;
  decision_source: string;
  version: number;
  effective_at: string;
  relationship_kind: string;
};
type Company = {
  id: string;
  legal_name: string;
  exposure_id: string | null;
  aliases_json?: string;
};
type JsonRow = Record<string, string | number | null>;

// D1 caps each bound string at 2 MB. Keep JSON bindings below that limit,
// including UTF-8 expansion, while retaining one atomic database batch.
export function automaticReviewJsonBatches(
  records: readonly JsonRow[],
): string[] {
  const limit = 1_500_000;
  const encoder = new TextEncoder();
  const batches: string[] = [];
  let items: string[] = [];
  let bytes = 2;
  for (const record of records) {
    const json = JSON.stringify(record);
    const size = encoder.encode(json).byteLength;
    if (size + 2 > limit)
      throw new Error("Automatic review evidence is too large.");
    if (bytes + size + 1 > limit) {
      batches.push(`[${items.join(",")}]`);
      items = [];
      bytes = 2;
    }
    items.push(json);
    bytes += size + 1;
  }
  if (items.length > 0) batches.push(`[${items.join(",")}]`);
  return batches;
}

// A bounded write-side projection. These queries never run on a GET path.
const positionsSql = `SELECT p.id, p.provider, p.position_kind, p.legal_vehicle_name, p.owner_label, p.currency, p.opened_on,
  a.id application_id, r.import_id, s.id snapshot_id, s.allocation_minor, s.invested_minor, s.provider_status, s.observed_at,
  provider_identity.provider_investment_id, observation.id observation_id,
  CASE WHEN length(CAST(observation.evidence_json AS BLOB)) <= 131072 THEN observation.evidence_json ELSE NULL END evidence_json,
  CASE WHEN length(CAST(observation.evidence_json AS BLOB)) > 131072 THEN 1 ELSE 0 END evidence_oversized,
  review.id review_id, review.state_json, company_review.id company_review_id, COALESCE(alias_receipt.receipt_json, company_review.receipt_json) receipt_json,
  terms.decision_source economics_source,
  reported.management_fee_ppm reported_management_fee_ppm, reported.carry_ppm reported_carry_ppm,
  decision.id entity_decision_id, decision.decision entity_decision, decision.legal_entity_id entity_id,
  decision.decision_source entity_decision_source, entity_version.id entity_version_id, entity_version.version entity_version, entity_version.legal_name accepted_legal_name,
  automatic.id auto_id, automatic.version auto_version, automatic.result_guard_json auto_result_guard_json, automatic.summary_json auto_summary_json,
  CASE WHEN terms.id IS NULL THEN NULL ELSE json_object(
    'id', terms.id, 'positionId', p.id, 'acceptedAgainstSnapshotId', terms.snapshot_id,
    'commitmentMinorAtAcceptance', terms.commitment_minor, 'fundedMinorAtAcceptance', terms.funded_minor,
    'capitalBasis', terms.capital_basis, 'grossCommitmentMinor', terms.gross_commitment_minor, 'setupFeePpm', terms.setup_fee_ppm,
    'annualAdminFeePpm', terms.annual_admin_fee_ppm, 'adminFeeYears', terms.admin_fee_years,
    'carryPpm', terms.carry_ppm, 'note', terms.note, 'acceptedAt', terms_review.decided_at,
    'decisionSource', terms.decision_source
  ) END economics_json
  FROM holding_positions p
  JOIN holding_import_applications a ON a.id = (
    SELECT candidate.id FROM holding_import_applications candidate JOIN holding_position_snapshots snapshot ON snapshot.id = candidate.snapshot_id
    WHERE candidate.position_id = p.id ORDER BY candidate.applied_at DESC, snapshot.observed_at DESC, candidate.id DESC LIMIT 1)
  JOIN holding_position_snapshots s ON s.id = a.snapshot_id
  JOIN holding_import_rows r ON r.id = a.import_row_id
  LEFT JOIN holding_import_row_provider_investments provider_identity ON provider_identity.import_row_id = r.id
  LEFT JOIN holding_import_row_reported_economics_evidence reported ON reported.import_row_id = r.id
  LEFT JOIN provider_legal_document_latest latest ON latest.household_id = p.household_id AND latest.provider = p.provider AND latest.position_fingerprint = r.position_fingerprint
  LEFT JOIN provider_legal_document_observations observation ON observation.id = latest.observation_id
    AND (provider_identity.provider_investment_id IS NULL OR json_extract(observation.capture_json, '$.sourceInvestment.id') = provider_identity.provider_investment_id)
  LEFT JOIN holding_investment_reviews review ON review.id = (SELECT id FROM holding_investment_reviews WHERE household_id = p.household_id AND position_id = p.id ORDER BY version DESC LIMIT 1)
  LEFT JOIN company_alias_current_receipts alias_receipt ON alias_receipt.position_id = p.id
  LEFT JOIN investment_company_reviews company_review ON company_review.id = (SELECT id FROM investment_company_reviews WHERE household_id = p.household_id AND position_id = p.id ORDER BY version DESC LIMIT 1)
  LEFT JOIN legal_entity_source_decisions decision ON decision.id = (SELECT id FROM legal_entity_source_decisions WHERE household_id = p.household_id AND source_kind = 'holding_position' AND source_reference = p.id ORDER BY version DESC LIMIT 1)
  LEFT JOIN legal_entity_versions entity_version ON entity_version.id = (SELECT id FROM legal_entity_versions WHERE household_id = p.household_id AND legal_entity_id = decision.legal_entity_id ORDER BY version DESC LIMIT 1)
  LEFT JOIN automatic_investment_reviews automatic ON automatic.id = (SELECT id FROM automatic_investment_reviews WHERE household_id = p.household_id AND position_id = p.id ORDER BY version DESC LIMIT 1)
  LEFT JOIN holding_position_economics_proposals terms ON terms.id = (
    SELECT proposal.id FROM holding_position_economics_proposals proposal
    JOIN holding_position_economics_reviews accepted ON accepted.proposal_id = proposal.id AND accepted.decision = 'accepted'
    WHERE proposal.household_id = p.household_id AND proposal.position_id = p.id AND NOT EXISTS (
      SELECT 1 FROM holding_position_economics_proposals later JOIN holding_position_economics_reviews accepted_later ON accepted_later.proposal_id = later.id AND accepted_later.decision = 'accepted' WHERE later.supersedes_proposal_id = proposal.id
    ) ORDER BY accepted.decided_at DESC, proposal.id DESC LIMIT 1)
  LEFT JOIN holding_position_economics_reviews terms_review ON terms_review.proposal_id = terms.id AND terms_review.decision = 'accepted'
  WHERE p.household_id = ? AND p.position_kind <> 'direct' AND p.id > ?
    AND (? IS NULL OR r.import_id = ?)
    AND NOT EXISTS (SELECT 1 FROM holding_position_continuities WHERE predecessor_position_id = p.id)
  ORDER BY p.id LIMIT ?`;

export interface AutomaticInvestmentReviewRepository {
  resolve(
    subject: string,
    afterPositionId?: string | null,
  ): Promise<ResolveInvestmentReviewsResult>;
}

export class D1AutomaticInvestmentReviewRepository implements AutomaticInvestmentReviewRepository {
  public constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async resolveImport(subject: string, importId: string): Promise<void> {
    let cursor: string | null = null;
    // Provider imports admit at most 500 rows. Five batches also leave room
    // for the keyset lookahead without any recurring discovery loop.
    for (let batch = 0; batch < 5; batch++) {
      const result = await this.resolve(subject, cursor, importId);
      if (result.nextPositionId === null) return;
      cursor = result.nextPositionId;
    }
    throw new Error("This import exceeds the automatic review limit.");
  }

  public async resolve(
    subject: string,
    afterPositionId: string | null = null,
    importId: string | null = null,
    attempt = 0,
  ): Promise<ResolveInvestmentReviewsResult> {
    const identity = await this.db
      .prepare(
        `SELECT h.id household_id, u.id user_id FROM users u JOIN households h ON h.owner_user_id = u.id WHERE u.access_subject = ? ORDER BY h.created_at LIMIT 1`,
      )
      .bind(subject)
      .first<Identity>();
    if (identity === null) throw new Error("Household not found.");
    const candidates = (
      await this.db
        .prepare(positionsSql)
        .bind(
          identity.household_id,
          afterPositionId ?? "",
          importId,
          importId,
          AUTOMATIC_INVESTMENT_BATCH_SIZE + 1,
        )
        .all<Row>()
    ).results;
    const rows = candidates.slice(0, AUTOMATIC_INVESTMENT_BATCH_SIZE);
    const result: ResolveInvestmentReviewsResult = {
      processedCount: rows.length,
      changedCount: 0,
      resolvedCount: 0,
      exceptionCount: 0,
      nextPositionId: candidates.length > rows.length ? rows.at(-1)!.id : null,
    };
    if (rows.length === 0) return result;
    const ids = JSON.stringify(rows.map((row) => row.id));
    const evidence = new Map(
      rows.map((row) => [
        row.id,
        LegalEntityNameEvidenceSchema.parse(
          row.evidence_json !== null
            ? JSON.parse(row.evidence_json)
            : row.provider === "angellist"
              ? {
                  state: "provider_reported",
                  legalName: row.legal_vehicle_name,
                  sourceField: "Fund Name",
                }
              : { state: "unavailable", legalName: null, sourceField: null },
        ),
      ]),
    );
    const names = [
      ...new Set(
        [...evidence.values()]
          .flatMap((item) => [
            item.legalName,
            ...(item.documents?.flatMap(
              (doc) =>
                doc.citations?.map((citation) => citation.legalName) ?? [],
            ) ?? []),
          ])
          .filter((name): name is string => name !== null),
      ),
    ];
    const [entities, companies, mappings, incoming] = await Promise.all([
      this.db
        .prepare(
          `SELECT names.value legal_name, (SELECT legal_entity_id FROM legal_entity_versions WHERE household_id = ? AND legal_name = names.value ORDER BY legal_entity_id LIMIT 1) legal_entity_id FROM json_each(?) names`,
        )
        .bind(identity.household_id, JSON.stringify(names))
        .all<{ legal_name: string; legal_entity_id: string | null }>(),
      loadCompanyIdentityChoices(this.db, identity.household_id).then(
        (results) => ({ results }),
      ),
      this.db
        .prepare(
          `SELECT m.id, m.position_id, m.exposure_id, m.status, m.decision_source, m.version, m.effective_at, m.relationship_kind, e.company_id, e.canonical_name FROM holding_position_exposure_mappings root INDEXED BY holding_position_exposure_mapping_roots_unique JOIN holding_position_exposure_mappings m ON m.id = (SELECT id FROM holding_position_exposure_mappings WHERE position_id = root.position_id AND exposure_id = root.exposure_id ORDER BY version DESC LIMIT 1) JOIN canonical_exposures e ON e.id = m.exposure_id WHERE root.household_id = ? AND root.position_id IN (SELECT value FROM json_each(?)) AND root.supersedes_mapping_id IS NULL ORDER BY m.position_id, m.id`,
        )
        .bind(identity.household_id, ids)
        .all<Mapping>(),
      this.db
        .prepare(
          `SELECT position_id, target_position_id, document_id, review_id FROM investment_document_assignments WHERE household_id = ? AND target_position_id IN (SELECT value FROM json_each(?)) ORDER BY target_position_id, position_id, document_id`,
        )
        .bind(identity.household_id, ids)
        .all<{
          position_id: string;
          target_position_id: string;
          document_id: string;
          review_id: string;
        }>(),
    ]);
    if (companies.results.length > 5000)
      throw new Error(
        "This inventory exceeds the supported automatic review limit.",
      );
    const documentIds = [
      ...new Set(
        [...evidence.values()].flatMap(
          (item) => item.documents?.map((doc) => doc.id) ?? [],
        ),
      ),
    ];
    const scans = (
      await this.db
        .prepare(
          `SELECT document_id, scan_json FROM private_document_scans WHERE household_id = ? AND document_id IN (SELECT value FROM json_each(?))`,
        )
        .bind(identity.household_id, JSON.stringify(documentIds))
        .all<{ document_id: string; scan_json: string }>()
    ).results;
    const scansById = new Map(
      scans.map((scan) => [
        scan.document_id,
        LegalDocumentScanSchema.parse(JSON.parse(scan.scan_json)),
      ]),
    );
    const entityIdsByName = new Map<string, string[]>();
    for (const entity of entities.results)
      if (entity.legal_entity_id !== null)
        entityIdsByName.set(entity.legal_name, [
          ...(entityIdsByName.get(entity.legal_name) ?? []),
          entity.legal_entity_id,
        ]);
    const candidateNames = new Map<string, number>();
    for (const value of evidence.values())
      if (value.legalName !== null)
        candidateNames.set(
          value.legalName,
          (candidateNames.get(value.legalName) ?? 0) + 1,
        );
    const companiesByName = new Map<string, Company[]>();
    const companiesById = new Map(
      companies.results.map((company) => [company.id, company]),
    );
    const companiesBySuggestion = new Map<string, Company[]>();
    for (const company of companies.results) {
      for (const name of new Set(
        [company.legal_name, ...(identityChoice(company).aliases ?? [])].map(
          companyNameKey,
        ),
      )) {
        companiesByName.set(name, [
          ...(companiesByName.get(name) ?? []),
          company,
        ]);
      }
      const key = companySuggestionKey(company.legal_name);
      companiesBySuggestion.set(key, [
        ...(companiesBySuggestion.get(key) ?? []),
        company,
      ]);
    }
    const plannedCompanies = new Map<string, Company>();
    const batches = new Map<string, JsonRow[]>();
    const add = (table: string, row: JsonRow) => {
      const records = batches.get(table) ?? [];
      records.push(row);
      batches.set(table, records);
    };
    const recordedAt = this.now().toISOString();
    for (const row of rows) {
      const originalEvidence = evidence.get(row.id)!;
      const documents: LegalNameDocumentReference[] = (
        originalEvidence.documents ?? []
      ).map((doc) => ({
        ...doc,
        scan:
          scansById.get(doc.id)?.sha256 === doc.sha256
            ? scansById.get(doc.id)
            : undefined,
      }));
      const review =
        row.state_json === null
          ? null
          : InvestmentReviewStateSchema.parse(JSON.parse(row.state_json));
      const amountMinor =
        review?.amountCorrection?.amountMinor ??
        sourceInvestmentAmount(
          row.provider,
          row.invested_minor,
          row.allocation_minor,
        );
      const assigned = new Map(
        review?.documentAssignments.map((assignment) => [
          assignment.documentId,
          assignment.relationship,
        ]),
      );
      const supportedDocuments = documents.filter(
        (doc) =>
          assigned.get(doc.id) === "supports" ||
          (!assigned.has(doc.id) &&
            row.provider_investment_id !== null &&
            doc.sourceInvestment?.id === row.provider_investment_id &&
            ["investment_page", "document_investment_id"].includes(
              doc.sourceInvestment.association,
            )),
      );
      const currentMappings = mappings.results.filter(
        (mapping) => mapping.position_id === row.id,
      );
      const currentTerms =
        row.economics_json === null
          ? null
          : PositionEconomicsTermsSchema.parse(JSON.parse(row.economics_json));
      const currentEvidence = reviewedInvestmentNameEvidence(
        { ...originalEvidence, documents },
        review,
        [],
      );
      const legalName = automaticLegalName(currentEvidence);
      const identityConflict =
        row.entity_decision_source === "policy" &&
        row.entity_version === 1 &&
        legalName !== null &&
        legalName !== row.accepted_legal_name;
      const resolvedName = (name: string) => {
        const matches = companiesByName.get(companyNameKey(name)) ?? [];
        return matches.length === 1
          ? `company:${matches[0]!.id}`
          : `name:${companyNameKey(name)}`;
      };
      const companyChoice = automaticCompanyChoice(
        supportedDocuments,
        resolvedName,
      );
      const guard = {
        // Re-evaluate old receipts once after fixing missed company conflicts.
        evaluationVersion: 3,
        applicationId: row.application_id,
        observationId: row.observation_id,
        reviewId: row.review_id,
        companyReviewId: row.company_review_id,
        entityDecisionId: row.entity_decision_id,
        entityVersionId: row.entity_version_id,
        termsId: currentTerms?.id ?? null,
        mappingIds: currentMappings.map((mapping) => mapping.id).sort(),
        incoming: incoming.results
          .filter((item) => item.target_position_id === row.id)
          .map(
            (item) =>
              `${item.position_id}:${item.document_id}:${item.review_id}`,
          )
          .sort(),
        scans: documents
          .map((doc) => ({
            id: doc.id,
            sha256: doc.sha256,
            scannedAt: doc.scan?.scannedAt ?? null,
            outcome: doc.scan?.outcome ?? null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        namedEntityIds:
          legalName === null ? [] : (entityIdsByName.get(legalName) ?? []),
        namedCompanyIds:
          companyChoice === null
            ? []
            : (
                companiesByName.get(
                  companyNameKey(companyChoice.companyName),
                ) ?? []
              )
                .map((company) => company.id)
                .sort(),
      };
      if (
        row.auto_result_guard_json === JSON.stringify(guard) &&
        row.auto_summary_json !== null
      ) {
        const summary = AutomaticInvestmentReviewSchema.parse(
          JSON.parse(row.auto_summary_json),
        );
        if (summary.issues.length === 0) result.resolvedCount++;
        else result.exceptionCount++;
        continue;
      }
      const finalGuard = structuredClone(guard);
      const issues: AutomaticReviewIssue[] = [];
      const resolved: AutomaticReviewSection[] = [];
      const details: Record<string, unknown> = {};
      const policyId = crypto.randomUUID();
      const entityType =
        legalName === null ? null : exactLegalEntityTypeFromName(legalName);
      if (row.entity_decision_id !== null) {
        if (identityConflict)
          issues.push(
            issue(
              "identity",
              "conflicting",
              "The source now names a different legal vehicle. Confirm which investment it belongs to.",
            ),
          );
        else resolved.push("identity");
      } else if (
        legalName !== null &&
        !row.evidence_oversized &&
        entityType !== null &&
        !entityIdsByName.has(legalName) &&
        candidateNames.get(legalName) === 1 &&
        guard.incoming.length === 0 &&
        (originalEvidence.state === "provider_reported" ||
          (supportedDocuments.length === documents.length &&
            documents.length > 0))
      ) {
        const entityId = crypto.randomUUID();
        const entityVersionId = crypto.randomUUID();
        const sourceDecisionId = crypto.randomUUID();
        const interestStatus =
          row.provider_status === "live" ? "current" : "historical";
        details.identity = { legalName, sourceDecisionId, entityId };
        add("legal_entities", {
          id: entityId,
          household_id: identity.household_id,
          created_by_user_id: identity.user_id,
          created_at: recordedAt,
          immutable: 1,
        });
        add("legal_entity_versions", {
          id: entityVersionId,
          household_id: identity.household_id,
          legal_entity_id: entityId,
          version: 1,
          legal_name: legalName,
          entity_type: entityType,
          relationship: "investment_vehicle",
          current_owner: row.owner_label,
          jurisdiction: null,
          formed_on: null,
          ein_last_four: null,
          ownership_interest_ppm: null,
          interest_status: interestStatus,
          tax_classification: null,
          notes: null,
          supersedes_version_id: null,
          recorded_by_user_id: identity.user_id,
          recorded_at: recordedAt,
          immutable: 1,
        });
        add("legal_entity_source_decisions", {
          id: sourceDecisionId,
          household_id: identity.household_id,
          source_kind: "holding_position",
          source_reference: row.id,
          source_name: row.legal_vehicle_name,
          source_label:
            row.provider === "angellist"
              ? "AngelList export"
              : `${row.provider} agreement`,
          source_as_of: row.observed_at.slice(0, 10),
          relationship: "investment_vehicle",
          current_owner: row.owner_label,
          interest_status: interestStatus,
          opened_on: row.opened_on,
          decision: "linked",
          legal_entity_id: entityId,
          version: 1,
          supersedes_decision_id: null,
          decided_by_user_id: identity.user_id,
          decided_at: recordedAt,
          immutable: 1,
          decision_source: "policy",
        });
        finalGuard.entityDecisionId = sourceDecisionId;
        finalGuard.entityVersionId = entityVersionId;
        finalGuard.namedEntityIds = [entityId];
        resolved.push("identity");
      } else
        issues.push(
          issue(
            "identity",
            legalName === null ? "missing" : "ambiguous_identity",
            legalName === null
              ? "The exact legal vehicle name needs supporting evidence."
              : "Confirm the entity type or whether this is an existing legal vehicle.",
          ),
        );

      if (
        (review?.participationStatus !== "unknown" && review !== null) ||
        (review === null && ["live", "realized"].includes(row.provider_status))
      )
        resolved.push("participation");
      else
        issues.push(
          issue(
            "participation",
            "missing",
            "Confirm whether this investment is current, pending, or historical.",
          ),
        );

      const companyReceipt =
        row.receipt_json === null
          ? null
          : InvestmentCompanyReceiptSchema.parse(JSON.parse(row.receipt_json));
      const manualCompany =
        (companyReceipt !== null &&
          companyReceipt.decisionSource !== "deterministic_policy") ||
        currentMappings.some((mapping) => mapping.decision_source === "review");
      const activeMappings = currentMappings.filter(
        (mapping) => mapping.status === "active",
      );
      const companyEvidence = automaticCompanyChoices(supportedDocuments);
      const companyEvidenceRevision =
        await investmentCompanyEvidenceRevision(companyEvidence);
      const savedCompanyNames = new Set(
        activeMappings.map(
          (mapping) =>
            (mapping.company_id === null
              ? null
              : companiesById.get(mapping.company_id)?.legal_name) ??
            mapping.canonical_name,
        ),
      );
      const manualCompanyConflict =
        manualCompany &&
        row.position_kind === "spv_interest" &&
        activeMappings.length > 0 &&
        guard.incoming.length === 0 &&
        currentEvidence.state !== "unavailable" &&
        companyEvidence.some(
          (citation) =>
            ![...savedCompanyNames].some(
              (name) =>
                resolvedName(name) === resolvedName(citation.companyName),
            ),
        ) &&
        companyReceipt?.companyEvidenceRevision !== companyEvidenceRevision;
      if (manualCompanyConflict)
        issues.push(
          issue(
            "company",
            "conflicting",
            "An agreement names a different company from your saved mapping. Review the company link.",
          ),
        );
      else if (manualCompany || row.position_kind === "fund_interest")
        resolved.push("company");
      else if (
        row.position_kind === "spv_interest" &&
        !identityConflict &&
        companyChoice !== null &&
        guard.incoming.length === 0 &&
        activeMappings.length <= 1 &&
        (activeMappings.length === 0 ||
          activeMappings[0]!.company_id === null ||
          resolvedName(activeMappings[0]!.canonical_name) ===
            resolvedName(companyChoice.companyName)) &&
        (companiesByName.get(companyNameKey(companyChoice.companyName))
          ?.length ?? 0) <= 1 &&
        currentEvidence.state !== "unavailable" &&
        ((companiesByName.get(companyNameKey(companyChoice.companyName))
          ?.length ?? 0) === 1 ||
          plannedCompanies.has(companyNameKey(companyChoice.companyName)) ||
          !companiesBySuggestion.has(
            companySuggestionKey(companyChoice.companyName),
          ))
      ) {
        const name = companyChoice.companyName;
        const nameKey = companyNameKey(name);
        let company =
          companiesByName.get(nameKey)?.[0] ?? plannedCompanies.get(nameKey);
        if (company === undefined) {
          company = {
            id: crypto.randomUUID(),
            legal_name: name,
            exposure_id: crypto.randomUUID(),
          };
          plannedCompanies.set(nameKey, company);
          companiesBySuggestion.set(companySuggestionKey(name), [company]);
          add("companies", {
            id: company.id,
            household_id: identity.household_id,
            legal_name: name,
            website_host: null,
            status: "active",
            created_at: recordedAt,
            updated_at: recordedAt,
          });
          details.newCompany = { legalName: name };
        }
        const exposureId = company.exposure_id ?? crypto.randomUUID();
        if (
          company.exposure_id === null ||
          (!companiesByName.has(nameKey) &&
            !batches
              .get("canonical_exposures")
              ?.some((item) => item.id === exposureId))
        ) {
          company.exposure_id = exposureId;
          add("canonical_exposures", {
            id: exposureId,
            household_id: identity.household_id,
            exposure_kind: "private_company",
            canonical_name: company.legal_name,
            protected_identity_key: null,
            company_id: company.id,
            resolution_method: "reviewed_company",
            evidence_sha256: companyChoice.sha256,
            created_by_user_id: identity.user_id,
            created_at: recordedAt,
            immutable: 1,
          });
        }
        const existingTarget = currentMappings.find(
          (mapping) => mapping.exposure_id === exposureId,
        );
        if (existingTarget?.status === "withdrawn")
          issues.push(
            issue(
              "company",
              "conflicting",
              "A previous decision removed this company mapping.",
            ),
          );
        else {
          let mappingId = existingTarget?.id ?? crypto.randomUUID();
          const newMappings = new Map(
            currentMappings.map((mapping) => [mapping.exposure_id, mapping.id]),
          );
          const mappingRow = (
            mapping: Mapping | undefined,
            target: string,
            active: boolean,
            id: string,
          ) => ({
            id,
            household_id: identity.household_id,
            position_id: row.id,
            exposure_id: target,
            relationship_kind: "look_through",
            allocation_ppm: active ? 1_000_000 : null,
            status: active ? "active" : "withdrawn",
            decision_source: "deterministic_policy",
            decision_reference: policyId,
            evidence_sha256: companyChoice.sha256,
            effective_at:
              mapping !== undefined && mapping.effective_at > recordedAt
                ? mapping.effective_at
                : recordedAt,
            version: (mapping?.version ?? 0) + 1,
            supersedes_mapping_id: mapping?.id ?? null,
            accepted_by_user_id: identity.user_id,
            accepted_at: recordedAt,
            immutable: 1,
          });
          for (const mapping of currentMappings.filter(
            (item) =>
              item.status === "active" && item.exposure_id !== exposureId,
          )) {
            const id = crypto.randomUUID();
            add(
              "holding_position_exposure_mappings",
              mappingRow(mapping, mapping.exposure_id, false, id),
            );
            newMappings.set(mapping.exposure_id, id);
          }
          if (existingTarget === undefined) {
            mappingId = crypto.randomUUID();
            add(
              "holding_position_exposure_mappings",
              mappingRow(undefined, exposureId, true, mappingId),
            );
            newMappings.set(exposureId, mappingId);
          }
          if (
            companyReceipt?.mappingId !== mappingId ||
            companyReceipt.citation?.documentId !== companyChoice.documentId ||
            companyReceipt.citation?.sha256 !== companyChoice.sha256
          ) {
            const id = crypto.randomUUID();
            const receipt = InvestmentCompanyReceiptSchema.parse({
              requestId: crypto.randomUUID(),
              expectedSnapshotId: row.snapshot_id,
              expectedEvidenceRevision:
                await investmentEvidenceRevision(documents),
              expectedMappingIds: guard.mappingIds,
              company: { mode: "existing", companyId: company.id },
              basis:
                company.legal_name === name
                  ? "document_choice"
                  : "document_link",
              citation: companyChoice,
              reason: null,
              positionId: row.id,
              companyId: company.id,
              companyName: company.legal_name,
              mappingId,
              recordedAt,
              sourceDocument: supportedDocuments.find(
                (doc) => doc.id === companyChoice.documentId,
              ),
              decisionSource: "deterministic_policy",
            });
            details.company = { id, receipt };
          }
          finalGuard.mappingIds = [...newMappings.values()].sort();
          finalGuard.namedCompanyIds = [company.id];
          resolved.push("company");
        }
      } else
        issues.push(
          issue(
            "company",
            companyChoice === null ? "missing" : "conflicting",
            companyChoice === null
              ? "The underlying company needs an unambiguous source citation."
              : "The company evidence differs from the existing investment mapping.",
          ),
        );

      if (row.position_kind === "spv_interest" && amountMinor > 0) {
        const context = {
          snapshotId: row.snapshot_id,
          currency: row.currency,
          committedMinor: amountMinor,
          fundedMinor: row.invested_minor,
          acceptedTerms: currentTerms,
          reportedTerms:
            row.reported_management_fee_ppm === null &&
            row.reported_carry_ppm === null
              ? null
              : {
                  managementFeePpm: row.reported_management_fee_ppm,
                  carryPpm: row.reported_carry_ppm,
                  sourceLabel: "Imported source",
                  observedAt: row.observed_at,
                },
        };
        if (currentTerms !== null && row.economics_source !== "policy") {
          if (calculatePositionEconomics(context) !== null)
            resolved.push("economics");
          else
            issues.push(
              issue(
                "economics",
                "stale",
                "Check your saved fee terms against the updated source amount.",
              ),
            );
        } else {
          const decision = automaticEconomics(
            context,
            !identityConflict &&
              guard.incoming.length === 0 &&
              currentEvidence.state !== "unavailable"
              ? supportedDocuments
              : [],
          );
          if (decision.issue !== null) issues.push(decision.issue);
          else if (decision.input !== null) {
            const termInput = decision.input;
            if (
              currentTerms === null ||
              calculatePositionEconomics(context) === null ||
              currentTerms.annualAdminFeePpm !== termInput.annualAdminFeePpm ||
              currentTerms.adminFeeYears !== termInput.adminFeeYears ||
              currentTerms.setupFeePpm !== termInput.setupFeePpm ||
              currentTerms.carryPpm !== termInput.carryPpm ||
              currentTerms.capitalBasis !== termInput.capitalBasis ||
              currentTerms.grossCommitmentMinor !==
                termInput.grossCommitmentMinor
            ) {
              const id = crypto.randomUUID();
              details.economics = {
                id,
                input: termInput,
                documents: supportedDocuments
                  .filter((doc) => doc.economicsCitations?.length)
                  .map((doc) => ({
                    id: doc.id,
                    sha256: doc.sha256,
                    citations: doc.economicsCitations,
                  })),
              };
              add("holding_position_economics_proposals", {
                id,
                household_id: identity.household_id,
                position_id: row.id,
                snapshot_id: row.snapshot_id,
                supersedes_proposal_id: currentTerms?.id ?? null,
                commitment_minor: amountMinor,
                funded_minor: row.invested_minor,
                capital_basis: termInput.capitalBasis!,
                gross_commitment_minor: termInput.grossCommitmentMinor ?? null,
                setup_fee_ppm: termInput.setupFeePpm!,
                annual_admin_fee_ppm: termInput.annualAdminFeePpm,
                admin_fee_years: termInput.adminFeeYears,
                carry_ppm: termInput.carryPpm,
                note: termInput.note,
                created_by: identity.user_id,
                created_at: recordedAt,
                immutable: 1,
                decision_source: "policy",
              });
              add("holding_position_economics_reviews", {
                id: crypto.randomUUID(),
                household_id: identity.household_id,
                proposal_id: id,
                reviewer_user_id: identity.user_id,
                decision: "accepted",
                rationale: `Automatically accepted by ${INVESTMENT_REVIEW_POLICY}.`,
                decided_at: recordedAt,
                immutable: 1,
              });
              finalGuard.termsId = id;
            }
            resolved.push("economics");
          }
        }
      } else resolved.push("economics");

      if (row.evidence_oversized)
        issues.push(
          issue(
            "documents",
            "unsupported",
            "This source has more evidence than an automatic review can inspect.",
          ),
        );
      else if (documents.some((doc) => doc.scan?.outcome !== "clean"))
        issues.push(
          issue(
            "documents",
            "document_check",
            "An agreement needs its document check completed.",
          ),
        );
      else if (
        guard.incoming.length > 0 ||
        (documents.length > 0 && currentEvidence.state === "unavailable") ||
        documents.some((doc) => assigned.get(doc.id) === "unassigned")
      )
        issues.push(
          issue(
            "documents",
            "conflicting",
            "Confirm which agreements belong to this investment.",
          ),
        );
      else resolved.push("documents");
      const summary = AutomaticInvestmentReviewSchema.parse({
        id: policyId,
        policyVersion: INVESTMENT_REVIEW_POLICY,
        snapshotId: row.snapshot_id,
        evaluatedAt: recordedAt,
        resolved,
        issues,
      });
      result.changedCount++;
      if (issues.length === 0) result.resolvedCount++;
      else result.exceptionCount++;
      add("automatic_investment_reviews", {
        id: policyId,
        household_id: identity.household_id,
        position_id: row.id,
        snapshot_id: row.snapshot_id,
        policy_version: INVESTMENT_REVIEW_POLICY,
        source_revision: await investmentEvidenceRevision(guard),
        expected_guard_json: JSON.stringify(guard),
        result_guard_json: JSON.stringify(finalGuard),
        summary_json: JSON.stringify(summary),
        details_json: JSON.stringify(details),
        version: (row.auto_version ?? 0) + 1,
        supersedes_id: row.auto_id,
        recorded_by_user_id: identity.user_id,
        recorded_at: recordedAt,
      });
    }
    const order = [
      "automatic_investment_reviews",
      "legal_entities",
      "legal_entity_versions",
      "legal_entity_source_decisions",
      "companies",
      "canonical_exposures",
      "holding_position_exposure_mappings",
      "holding_position_economics_proposals",
      "holding_position_economics_reviews",
    ] as const;
    const statements = order.flatMap((table) => {
      const records = batches.get(table);
      return automaticReviewJsonBatches(records ?? []).map((json) =>
        this.insertStatement(table, json),
      );
    });
    if (statements.length === 0) return result;
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Error &&
        /stale|UNIQUE|supersession/u.test(error.message)
      )
        return this.resolve(subject, afterPositionId, importId, attempt + 1);
      throw error;
    }
    return result;
  }
  private insertStatement(
    table:
      | "automatic_investment_reviews"
      | "legal_entities"
      | "legal_entity_versions"
      | "legal_entity_source_decisions"
      | "companies"
      | "canonical_exposures"
      | "holding_position_exposure_mappings"
      | "holding_position_economics_proposals"
      | "holding_position_economics_reviews",
    records: string,
  ) {
    const sql =
      table === "automatic_investment_reviews"
        ? `INSERT INTO automatic_investment_reviews (id, household_id, position_id, snapshot_id, policy_version, source_revision, expected_guard_json, result_guard_json, summary_json, details_json, version, supersedes_id, recorded_by_user_id, recorded_at) SELECT json_extract(value, '$.id'), json_extract(value, '$.household_id'), json_extract(value, '$.position_id'), json_extract(value, '$.snapshot_id'), json_extract(value, '$.policy_version'), json_extract(value, '$.source_revision'), json_extract(value, '$.expected_guard_json'), json_extract(value, '$.result_guard_json'), json_extract(value, '$.summary_json'), json_extract(value, '$.details_json'), json_extract(value, '$.version'), json_extract(value, '$.supersedes_id'), json_extract(value, '$.recorded_by_user_id'), json_extract(value, '$.recorded_at') FROM json_each(?)`
        : table === "legal_entities"
          ? `INSERT INTO legal_entities (id, household_id, created_by_user_id, created_at, immutable) SELECT json_extract(value, '$.id'), json_extract(value, '$.household_id'), json_extract(value, '$.created_by_user_id'), json_extract(value, '$.created_at'), json_extract(value, '$.immutable') FROM json_each(?)`
          : table === "legal_entity_versions"
            ? `INSERT INTO legal_entity_versions (id, household_id, legal_entity_id, version, legal_name, entity_type, relationship, current_owner, jurisdiction, formed_on, ein_last_four, ownership_interest_ppm, interest_status, tax_classification, notes, supersedes_version_id, recorded_by_user_id, recorded_at, immutable) SELECT json_extract(value, '$.id'), json_extract(value, '$.household_id'), json_extract(value, '$.legal_entity_id'), json_extract(value, '$.version'), json_extract(value, '$.legal_name'), json_extract(value, '$.entity_type'), json_extract(value, '$.relationship'), json_extract(value, '$.current_owner'), json_extract(value, '$.jurisdiction'), json_extract(value, '$.formed_on'), json_extract(value, '$.ein_last_four'), json_extract(value, '$.ownership_interest_ppm'), json_extract(value, '$.interest_status'), json_extract(value, '$.tax_classification'), json_extract(value, '$.notes'), json_extract(value, '$.supersedes_version_id'), json_extract(value, '$.recorded_by_user_id'), json_extract(value, '$.recorded_at'), json_extract(value, '$.immutable') FROM json_each(?)`
            : table === "legal_entity_source_decisions"
              ? `INSERT INTO legal_entity_source_decisions (id, household_id, source_kind, source_reference, source_name, source_label, source_as_of, relationship, current_owner, interest_status, opened_on, decision, legal_entity_id, version, supersedes_decision_id, decided_by_user_id, decided_at, immutable, decision_source) SELECT json_extract(value, '$.id'), json_extract(value, '$.household_id'), json_extract(value, '$.source_kind'), json_extract(value, '$.source_reference'), json_extract(value, '$.source_name'), json_extract(value, '$.source_label'), json_extract(value, '$.source_as_of'), json_extract(value, '$.relationship'), json_extract(value, '$.current_owner'), json_extract(value, '$.interest_status'), json_extract(value, '$.opened_on'), json_extract(value, '$.decision'), json_extract(value, '$.legal_entity_id'), json_extract(value, '$.version'), json_extract(value, '$.supersedes_decision_id'), json_extract(value, '$.decided_by_user_id'), json_extract(value, '$.decided_at'), json_extract(value, '$.immutable'), json_extract(value, '$.decision_source') FROM json_each(?)`
              : table === "companies"
                ? `INSERT INTO companies (id, household_id, legal_name, website_host, status, created_at, updated_at) SELECT json_extract(value, '$.id'), json_extract(value, '$.household_id'), json_extract(value, '$.legal_name'), json_extract(value, '$.website_host'), json_extract(value, '$.status'), json_extract(value, '$.created_at'), json_extract(value, '$.updated_at') FROM json_each(?)`
                : table === "canonical_exposures"
                  ? `INSERT INTO canonical_exposures (id, household_id, exposure_kind, canonical_name, protected_identity_key, company_id, resolution_method, evidence_sha256, created_by_user_id, created_at, immutable) SELECT json_extract(value, '$.id'), json_extract(value, '$.household_id'), json_extract(value, '$.exposure_kind'), json_extract(value, '$.canonical_name'), json_extract(value, '$.protected_identity_key'), json_extract(value, '$.company_id'), json_extract(value, '$.resolution_method'), json_extract(value, '$.evidence_sha256'), json_extract(value, '$.created_by_user_id'), json_extract(value, '$.created_at'), json_extract(value, '$.immutable') FROM json_each(?)`
                  : table === "holding_position_exposure_mappings"
                    ? `INSERT INTO holding_position_exposure_mappings (id, household_id, position_id, exposure_id, relationship_kind, allocation_ppm, status, decision_source, decision_reference, evidence_sha256, effective_at, version, supersedes_mapping_id, accepted_by_user_id, accepted_at, immutable) SELECT json_extract(value, '$.id'), json_extract(value, '$.household_id'), json_extract(value, '$.position_id'), json_extract(value, '$.exposure_id'), json_extract(value, '$.relationship_kind'), json_extract(value, '$.allocation_ppm'), json_extract(value, '$.status'), json_extract(value, '$.decision_source'), json_extract(value, '$.decision_reference'), json_extract(value, '$.evidence_sha256'), json_extract(value, '$.effective_at'), json_extract(value, '$.version'), json_extract(value, '$.supersedes_mapping_id'), json_extract(value, '$.accepted_by_user_id'), json_extract(value, '$.accepted_at'), json_extract(value, '$.immutable') FROM json_each(?)`
                    : table === "holding_position_economics_proposals"
                      ? `INSERT INTO holding_position_economics_proposals (id, household_id, position_id, snapshot_id, supersedes_proposal_id, commitment_minor, funded_minor, capital_basis, gross_commitment_minor, setup_fee_ppm, annual_admin_fee_ppm, admin_fee_years, carry_ppm, note, created_by, created_at, immutable, decision_source) SELECT json_extract(value, '$.id'), json_extract(value, '$.household_id'), json_extract(value, '$.position_id'), json_extract(value, '$.snapshot_id'), json_extract(value, '$.supersedes_proposal_id'), json_extract(value, '$.commitment_minor'), json_extract(value, '$.funded_minor'), json_extract(value, '$.capital_basis'), json_extract(value, '$.gross_commitment_minor'), json_extract(value, '$.setup_fee_ppm'), json_extract(value, '$.annual_admin_fee_ppm'), json_extract(value, '$.admin_fee_years'), json_extract(value, '$.carry_ppm'), json_extract(value, '$.note'), json_extract(value, '$.created_by'), json_extract(value, '$.created_at'), json_extract(value, '$.immutable'), json_extract(value, '$.decision_source') FROM json_each(?)`
                      : `INSERT INTO holding_position_economics_reviews (id, household_id, proposal_id, reviewer_user_id, decision, rationale, decided_at, immutable) SELECT json_extract(value, '$.id'), json_extract(value, '$.household_id'), json_extract(value, '$.proposal_id'), json_extract(value, '$.reviewer_user_id'), json_extract(value, '$.decision'), json_extract(value, '$.rationale'), json_extract(value, '$.decided_at'), json_extract(value, '$.immutable') FROM json_each(?)`;
    return this.db.prepare(sql).bind(records);
  }
}
