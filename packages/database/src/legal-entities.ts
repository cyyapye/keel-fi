import {
  CreateLegalEntityInputSchema,
  LegalEntityExactBatchInputSchema,
  LegalEntityExactBatchPreviewSchema,
  LegalEntityExactBatchResultSchema,
  LegalEntityInventorySchema,
  LegalEntityProfileInputSchema,
  LegalEntityRecordSchema,
  LegalNameResolutionSchema,
  legalNameEvidenceRevision,
  legalEntityReviewKind,
  LegalEntitySourceReviewResultSchema,
  LegalEntitySourceSummarySchema,
  MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES,
  ReviewLegalEntitySourceInputSchema,
  UpdateLegalEntityInputSchema,
  exactLegalEntityTypeFromName,
  type CreateLegalEntityInput,
  type ExactLegalEntityType,
  type LegalEntityExactBatchInput,
  type LegalEntityExactBatchPreview,
  type LegalEntityExactBatchResult,
  type LegalEntityInterestStatus,
  type LegalEntityInventory,
  type LegalEntityProfileInput,
  type LegalEntityRecord,
  type LegalEntityRelationship,
  type LegalEntitySourceReference,
  type LegalEntitySourceSummary,
  type LegalEntitySourceReviewResult,
  type LegalEntityType,
  type LegalNameResolutionInput,
  type ReviewLegalEntitySourceInput,
  type UpdateLegalEntityInput,
} from "@keel/domain/legal-entities";
import {
  InvestmentCompanyReceiptSchema,
  InvestmentReviewStateSchema,
} from "@keel/domain/investment-review";
import { LegalNameDocumentReferenceSchema } from "@keel/domain/provider-legal-documents";
import { reviewedInvestmentNameEvidence } from "@keel/domain/position-read-model";
import type {
  InvestmentPositionRecord,
  InvestmentPositionView,
} from "@keel/domain/position-read-model";

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type LegalEntityVersionRow = {
  entity_id: string;
  version_id: string;
  version: number;
  legal_name: string;
  entity_type: LegalEntityType;
  relationship: LegalEntityRelationship;
  current_owner: string | null;
  jurisdiction: string | null;
  formed_on: string | null;
  ein_last_four: string | null;
  ownership_interest_ppm: number | null;
  interest_status: LegalEntityInterestStatus;
  tax_classification: string | null;
  notes: string | null;
  recorded_at: string;
};

type SourceDecisionRow = {
  decision_id: string;
  source_kind: LegalEntitySourceReference["kind"];
  source_reference: string;
  source_name: string;
  source_label: string;
  source_as_of: string;
  relationship: LegalEntityRelationship;
  current_owner: string | null;
  interest_status: LegalEntityInterestStatus;
  opened_on: string | null;
  decision: "linked" | "not_llc";
  legal_entity_id: string | null;
  version: number;
  name_resolution_json?: string | null;
};

type CurrentVersionIdentityRow = {
  version_id: string;
  version: number;
};

export class LegalEntityRepositoryError extends Error {
  public constructor(
    public readonly code:
      "invalid_source" | "no_matches" | "not_found" | "stale",
    message: string,
  ) {
    super(message);
    this.name = "LegalEntityRepositoryError";
  }
}

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

async function findIdentity(
  db: D1Database,
  accessSubject: string,
): Promise<HouseholdIdentity> {
  const identity = await db
    .prepare(
      `SELECT household.id AS household_id, user.id AS user_id
       FROM users user
       JOIN households household ON household.owner_user_id = user.id
       WHERE user.access_subject = ?
       ORDER BY household.created_at
       LIMIT 1`,
    )
    .bind(accessSubject)
    .first<HouseholdIdentity>();
  if (identity === null) {
    throw new Error("Household not found for the authenticated user.");
  }
  return identity;
}

function sourceKey(source: LegalEntitySourceReference): string {
  return JSON.stringify([source.kind, source.id]);
}

function currentPositionValue(position: InvestmentPositionRecord) {
  const adjustment = position.acceptedValueAdjustment ?? null;
  if (adjustment !== null) {
    return { state: "reported" as const, minor: adjustment.valueMinor };
  }
  if (position.snapshot.netValue.state !== "not_reported") {
    return position.snapshot.netValue;
  }
  return position.snapshot.unrealizedValue;
}

function positionSourceSummary(
  position: InvestmentPositionRecord,
): LegalEntitySourceSummary {
  const legalName = position.legalEntityNameEvidence.legalName;
  const terms =
    position.acceptedEconomicsTerms?.acceptedAgainstSnapshotId ===
    position.snapshot.id
      ? position.acceptedEconomicsTerms
      : null;
  return {
    source: { kind: "holding_position", id: position.id },
    sourceDisplayName:
      position.reportedExposureName ?? position.legalVehicleName,
    legalEntityNameEvidence: position.legalEntityNameEvidence,
    suggestedEntityType:
      legalName === null ? null : exactLegalEntityTypeFromName(legalName),
    sourceLabel: position.source.label,
    sourceAsOf: position.source.effectiveDate,
    relationship: "investment_vehicle",
    currentOwner: position.ownerLabel ?? null,
    interestStatus:
      position.snapshot.providerStatus === "live" ? "current" : "historical",
    openedOn: position.openedOn,
    financials: {
      currency: position.snapshot.currency,
      commitmentMinor: position.snapshot.allocationMinor,
      fundedMinor: position.snapshot.investedMinor,
      annualAdminFeePpm: terms?.annualAdminFeePpm ?? null,
      adminFeeYears: terms?.adminFeeYears ?? null,
      carryPpm: terms?.carryPpm ?? null,
      currentValue: currentPositionValue(position),
    },
    currentDecisionId: null,
    ...(position.investmentReview == null
      ? {}
      : { investmentReview: position.investmentReview }),
    ...(position.companyReview == null
      ? {}
      : { companyReview: position.companyReview }),
  };
}

export function legalEntitySourceCandidates(
  positionView: InvestmentPositionView,
): LegalEntitySourceSummary[] {
  const candidates: LegalEntitySourceSummary[] = [];
  for (const connection of positionView.connections) {
    for (const container of connection.containers) {
      if (container.kind === "entity") {
        const hasCurrentPosition = container.positions.some(
          (position) => position.snapshot.providerStatus === "live",
        );
        const hasHistoricalPosition = container.positions.some(
          (position) => position.snapshot.providerStatus === "realized",
        );
        candidates.push({
          source: { kind: "ownership_container", id: container.id },
          sourceDisplayName: container.label,
          legalEntityNameEvidence: {
            state: "unavailable",
            legalName: null,
            sourceField: null,
          },
          suggestedEntityType: null,
          sourceLabel: connection.institutionLabel,
          sourceAsOf: (
            container.coverage?.observedAt ?? positionView.asOf
          ).slice(0, 10),
          relationship: "ownership_entity",
          currentOwner: null,
          interestStatus: hasCurrentPosition
            ? "current"
            : hasHistoricalPosition
              ? "historical"
              : "unknown",
          openedOn: null,
          financials: null,
          currentDecisionId: null,
        });
      }
      for (const position of container.positions) {
        if (position.kind !== "direct") {
          candidates.push(positionSourceSummary(position));
        }
      }
    }
  }
  return candidates.sort(
    (left, right) =>
      sourceDisplayName(left).localeCompare(sourceDisplayName(right)) ||
      sourceKey(left.source).localeCompare(sourceKey(right.source)),
  );
}

function sourceFromDecision(row: SourceDecisionRow): LegalEntitySourceSummary {
  return {
    source: { kind: row.source_kind, id: row.source_reference },
    sourceDisplayName: row.source_name,
    legalEntityNameEvidence: {
      state: "unavailable",
      legalName: null,
      sourceField: null,
    },
    suggestedEntityType: null,
    sourceLabel: row.source_label,
    sourceAsOf: row.source_as_of,
    relationship: row.relationship,
    currentOwner: row.current_owner,
    interestStatus: row.interest_status,
    openedOn: row.opened_on,
    financials: null,
    currentDecisionId: row.decision_id,
    ...resolutionFromDecision(row),
  };
}

function resolutionFromDecision(row: SourceDecisionRow) {
  return row.name_resolution_json == null
    ? {}
    : {
        nameResolution: LegalNameResolutionSchema.parse(
          JSON.parse(row.name_resolution_json),
        ),
      };
}

async function resolveSourceName(
  source: LegalEntitySourceSummary,
  input: LegalNameResolutionInput | undefined,
  legalName: string,
  entityType?: LegalEntityType,
): Promise<LegalEntitySourceSummary> {
  const evidence = source.legalEntityNameEvidence;
  const conflicting =
    evidence.state === "unavailable" && evidence.problem === "conflicting";
  const reviewKind = legalEntityReviewKind(source);
  if (input === undefined) {
    if (evidence.state === "unavailable" && evidence.problem !== undefined)
      throw new LegalEntityRepositoryError(
        "invalid_source",
        "Review the document evidence before adding or linking this source.",
      );
    return source;
  }
  if (!["conflict", "structure", "document"].includes(reviewKind))
    throw new LegalEntityRepositoryError(
      "invalid_source",
      "This source has no available document review. Reload its current evidence.",
    );
  if (conflicting && input.kind === "document_entry")
    throw new LegalEntityRepositoryError(
      "invalid_source",
      "Explain the correction when the agreements report conflicting names.",
    );
  const { expectedEvidenceRevision, ...details } = input;
  if (
    expectedEvidenceRevision !== (await legalNameEvidenceRevision(evidence))
  ) {
    throw new LegalEntityRepositoryError(
      "stale",
      "The agreement evidence changed. Reload and compare the current names before saving.",
    );
  }
  const document = evidence.documents?.find(
    (item) => item.id === input.documentId,
  );
  if (
    document === undefined ||
    legalName !== input.legalName ||
    document.scan?.outcome === "blocked" ||
    (!conflicting && document.scan?.outcome !== "clean")
  ) {
    throw new LegalEntityRepositoryError(
      "invalid_source",
      "The selected document and legal name must match this source review.",
    );
  }
  if (
    input.kind === "document_structure" &&
    (reviewKind !== "structure" ||
      !document.structure?.parties.some(
        (party) =>
          party.role !== "representative" &&
          party.legalName === input.legalName &&
          party.page === input.page &&
          party.quote === input.quote,
      ))
  )
    throw new LegalEntityRepositoryError(
      "invalid_source",
      "Choose the named compartment or issuer, not its representative.",
    );
  if (reviewKind === "structure" && input.kind === "document_choice")
    throw new LegalEntityRepositoryError(
      "invalid_source",
      "Review the parties in their stated roles.",
    );
  if (
    input.kind === "document_choice" &&
    !document.citations?.some(
      (citation) =>
        citation.legalName === input.legalName &&
        citation.page === input.page &&
        citation.quote === input.quote,
    )
  ) {
    throw new LegalEntityRepositoryError(
      "invalid_source",
      "Choose an exact name and citation reported by this agreement.",
    );
  }
  return {
    ...source,
    nameResolution: LegalNameResolutionSchema.parse({
      ...details,
      ...(reviewKind === "structure" ? { reviewedEntityType: entityType } : {}),
      fileName: document.fileName,
      sha256: document.sha256,
      evidence,
    }),
  };
}

function recordFromRow(row: LegalEntityVersionRow): LegalEntityRecord {
  return LegalEntityRecordSchema.parse({
    id: row.entity_id,
    versionId: row.version_id,
    version: row.version,
    legalName: row.legal_name,
    entityType: row.entity_type,
    relationship: row.relationship,
    currentOwner: row.current_owner,
    jurisdiction: row.jurisdiction,
    formedOn: row.formed_on,
    einLastFour: row.ein_last_four,
    ownershipInterestPpm: row.ownership_interest_ppm,
    interestStatus: row.interest_status,
    taxClassification: row.tax_classification,
    notes: row.notes,
    recordedAt: row.recorded_at,
    sources: [],
  });
}

type LegalEntityExactBatchGroup = {
  key: string;
  entity: LegalEntityRecord | null;
  entityName: string;
  entityType: ExactLegalEntityType;
  sources: LegalEntitySourceSummary[];
};

type LegalEntityExactBatchPlan = {
  groups: LegalEntityExactBatchGroup[];
  preview: LegalEntityExactBatchPreview;
};

type LegalEntityState = {
  inventory: LegalEntityInventory;
  exactBatchPlan: LegalEntityExactBatchPlan;
};

function exactEntityName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function exactEntityNameKey(value: string): string {
  return exactEntityName(value).toLocaleLowerCase("en-US");
}

function sourceDisplayName(source: LegalEntitySourceSummary): string {
  return source.legalEntityNameEvidence.legalName ?? source.sourceDisplayName;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function buildLegalEntityExactBatchPlan(
  entities: readonly LegalEntityRecord[],
  candidates: readonly LegalEntitySourceSummary[],
): Promise<LegalEntityExactBatchPlan> {
  const entitiesByName = new Map<string, LegalEntityRecord[]>();
  for (const entity of entities) {
    const key = exactEntityNameKey(entity.legalName);
    const matches = entitiesByName.get(key) ?? [];
    matches.push(entity);
    entitiesByName.set(key, matches);
  }

  const groupsByKey = new Map<string, LegalEntityExactBatchGroup>();
  for (const candidate of candidates) {
    const legalName = candidate.legalEntityNameEvidence.legalName;
    if (legalName === null || candidate.suggestedEntityType === null) {
      continue;
    }
    const entityName = exactEntityName(legalName);
    const nameKey = exactEntityNameKey(entityName);
    const entityMatches = entitiesByName.get(nameKey) ?? [];
    if (
      entityMatches.length > 1 ||
      (entityMatches.length === 1 &&
        entityMatches[0]?.entityType !== candidate.suggestedEntityType)
    ) {
      continue;
    }
    const key = JSON.stringify([candidate.suggestedEntityType, nameKey]);
    const group = groupsByKey.get(key) ?? {
      key,
      entity: entityMatches[0] ?? null,
      entityName,
      entityType: candidate.suggestedEntityType,
      sources: [],
    };
    group.sources.push(candidate);
    groupsByKey.set(key, group);
  }

  const groups: LegalEntityExactBatchGroup[] = [];
  let sourceCount = 0;
  for (const group of [...groupsByKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  )) {
    group.sources.sort((left, right) =>
      sourceKey(left.source).localeCompare(sourceKey(right.source)),
    );
    const remainingCapacity =
      MAX_LEGAL_ENTITY_EXACT_BATCH_SOURCES - sourceCount;
    if (remainingCapacity === 0) {
      break;
    }
    const sources = group.sources.slice(0, remainingCapacity);
    groups.push({ ...group, sources });
    sourceCount += sources.length;
  }

  const existingEntityCount = groups.filter(
    (group) => group.entity !== null,
  ).length;
  const revision = await sha256(
    JSON.stringify({
      version: 1,
      entities: entities.map((entity) => [
        entity.id,
        entity.versionId,
        entity.legalName,
        entity.entityType,
      ]),
      candidates: candidates.map((candidate) => [
        candidate.source.kind,
        candidate.source.id,
        candidate.sourceDisplayName,
        candidate.legalEntityNameEvidence,
        candidate.suggestedEntityType,
        candidate.sourceLabel,
        candidate.sourceAsOf,
        candidate.relationship,
        candidate.currentOwner,
        candidate.interestStatus,
        candidate.openedOn,
      ]),
    }),
  );
  return {
    groups,
    preview: LegalEntityExactBatchPreviewSchema.parse({
      revision,
      sourceCount,
      entityCount: groups.length,
      existingEntityCount,
      newEntityCount: groups.length - existingEntityCount,
      llcEntityCount: groups.filter((group) => group.entityType === "llc")
        .length,
      limitedPartnershipEntityCount: groups.filter(
        (group) => group.entityType === "limited_partnership",
      ).length,
      remainingCandidateCount: candidates.length - sourceCount,
    }),
  };
}

async function stateFromRows(
  entityRows: readonly LegalEntityVersionRow[],
  decisionRows: readonly SourceDecisionRow[],
  positionView: InvestmentPositionView,
  documentSources: readonly LegalEntitySourceSummary[] = [],
): Promise<LegalEntityState> {
  const entities = entityRows.map(recordFromRow);
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  const sourceCandidates = [
    ...legalEntitySourceCandidates(positionView),
    ...documentSources,
  ];
  const candidateByKey = new Map(
    sourceCandidates.map((candidate) => [
      sourceKey(candidate.source),
      candidate,
    ]),
  );
  const decidedSourceKeys = new Set<string>();
  const excludedCandidates: LegalEntitySourceSummary[] = [];

  for (const decision of decisionRows) {
    const key = sourceKey({
      kind: decision.source_kind,
      id: decision.source_reference,
    });
    decidedSourceKeys.add(key);
    const liveSource = candidateByKey.get(key);
    const summary = {
      ...(liveSource ?? sourceFromDecision(decision)),
      currentDecisionId: decision.decision_id,
      ...resolutionFromDecision(decision),
    };
    if (decision.decision === "not_llc") {
      excludedCandidates.push(summary);
      continue;
    }
    const entity =
      decision.legal_entity_id === null
        ? undefined
        : entitiesById.get(decision.legal_entity_id);
    if (entity === undefined) {
      throw new Error("Linked legal entity is unavailable.");
    }
    entity.sources.push(summary);
  }

  entities.forEach((entity) => {
    entity.sources.sort(
      (left, right) =>
        sourceDisplayName(left).localeCompare(sourceDisplayName(right)) ||
        sourceKey(left.source).localeCompare(sourceKey(right.source)),
    );
  });

  const candidates = sourceCandidates.filter(
    (candidate) => !decidedSourceKeys.has(sourceKey(candidate.source)),
  );
  const exactBatchPlan = await buildLegalEntityExactBatchPlan(
    entities,
    candidates,
  );
  const inventory = LegalEntityInventorySchema.parse({
    version: 3,
    asOf: positionView.asOf,
    entities,
    candidates,
    excludedCandidates: excludedCandidates.sort(
      (left, right) =>
        sourceDisplayName(left).localeCompare(sourceDisplayName(right)) ||
        sourceKey(left.source).localeCompare(sourceKey(right.source)),
    ),
    exactBatch: exactBatchPlan.preview,
  });
  return { inventory, exactBatchPlan };
}

async function candidateFor(
  db: D1Database,
  householdId: string,
  positionView: InvestmentPositionView,
  source: LegalEntitySourceReference,
  fallback: SourceDecisionRow | null,
): Promise<LegalEntitySourceSummary> {
  const candidate = legalEntitySourceCandidates(positionView).find(
    (item) => sourceKey(item.source) === sourceKey(source),
  );
  if (candidate !== undefined) {
    return candidate;
  }
  if (source.kind === "holding_position") {
    const row = await db
      .prepare(
        `${documentSourcesSql} WHERE origin.household_id = ? AND origin.position_id = ?`,
      )
      .bind(householdId, source.id)
      .first<DocumentSourceRow>();
    if (row !== null) return documentSourceFromRow(row);
  }
  if (fallback !== null) {
    return sourceFromDecision(fallback);
  }
  throw new LegalEntityRepositoryError(
    "invalid_source",
    "This legal entity source is unavailable.",
  );
}

type DocumentSourceRow = {
  source_json: string;
  state_json: string | null;
  receipt_json: string | null;
  incoming_json: string;
};
const documentSourcesSql = `SELECT origin.source_json, review.state_json, company_review.receipt_json,
  (SELECT json_group_array(json(assignment.document_json)) FROM investment_document_assignments assignment WHERE assignment.household_id = origin.household_id AND assignment.target_position_id = origin.position_id) incoming_json
  FROM document_investment_origins origin
  LEFT JOIN holding_investment_reviews review ON review.id = (SELECT id FROM holding_investment_reviews WHERE household_id = origin.household_id AND position_id = origin.position_id ORDER BY version DESC LIMIT 1)
  LEFT JOIN investment_company_reviews company_review ON company_review.id = (SELECT id FROM investment_company_reviews WHERE household_id = origin.household_id AND position_id = origin.position_id ORDER BY version DESC LIMIT 1)`;
function documentSourceFromRow(
  row: DocumentSourceRow,
): LegalEntitySourceSummary {
  const source = LegalEntitySourceSummarySchema.parse(
    JSON.parse(row.source_json),
  );
  const review =
    row.state_json === null
      ? null
      : InvestmentReviewStateSchema.parse(JSON.parse(row.state_json));
  const evidence = reviewedInvestmentNameEvidence(
    source.legalEntityNameEvidence,
    review,
    LegalNameDocumentReferenceSchema.array()
      .max(100)
      .parse(JSON.parse(row.incoming_json)),
  );
  return {
    ...source,
    legalEntityNameEvidence: evidence,
    suggestedEntityType:
      evidence.legalName === null
        ? null
        : exactLegalEntityTypeFromName(evidence.legalName),
    investmentReview: review,
    ...(row.receipt_json === null
      ? {}
      : {
          companyReview: InvestmentCompanyReceiptSchema.parse(
            JSON.parse(row.receipt_json),
          ),
        }),
  };
}

export interface LegalEntityRepository {
  getState(
    accessSubject: string,
    positionView: InvestmentPositionView | Promise<InvestmentPositionView>,
  ): Promise<LegalEntityInventory>;
  create(
    accessSubject: string,
    input: CreateLegalEntityInput,
    positionView: InvestmentPositionView,
  ): Promise<LegalEntityRecord>;
  update(
    accessSubject: string,
    legalEntityId: string,
    input: UpdateLegalEntityInput,
  ): Promise<LegalEntityRecord>;
  reviewSource(
    accessSubject: string,
    input: ReviewLegalEntitySourceInput,
    positionView: InvestmentPositionView,
  ): Promise<LegalEntitySourceReviewResult>;
  applyExactBatch(
    accessSubject: string,
    input: LegalEntityExactBatchInput,
    positionView: InvestmentPositionView,
  ): Promise<LegalEntityExactBatchResult>;
}

export class D1LegalEntityRepository implements LegalEntityRepository {
  public constructor(private readonly db: D1Database) {}

  public async getState(
    accessSubject: string,
    positionView: InvestmentPositionView | Promise<InvestmentPositionView>,
  ): Promise<LegalEntityInventory> {
    const { state } = await this.loadState(accessSubject, positionView);
    return state.inventory;
  }

  public async create(
    accessSubject: string,
    rawInput: CreateLegalEntityInput,
    positionView: InvestmentPositionView,
  ): Promise<LegalEntityRecord> {
    const input = CreateLegalEntityInputSchema.parse(rawInput);
    const identity = await findIdentity(this.db, accessSubject);
    const currentDecision =
      input.source === null
        ? null
        : await this.currentDecision(
            identity.household_id,
            input.source.reference,
          );
    if (
      input.source !== null &&
      (currentDecision?.decision_id ?? null) !== input.source.expectedDecisionId
    ) {
      throw new LegalEntityRepositoryError(
        "stale",
        "This source review changed. Review the current record and try again.",
      );
    }
    const sourceSummary =
      input.source === null
        ? null
        : await resolveSourceName(
            await candidateFor(
              this.db,
              identity.household_id,
              positionView,
              input.source.reference,
              currentDecision,
            ),
            input.source.nameResolution,
            input.profile.legalName,
            input.profile.entityType,
          );
    const entityId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const decisionId = sourceSummary === null ? null : crypto.randomUUID();
    const recordedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO legal_entities (
             id, household_id, created_by_user_id, created_at, immutable
           ) VALUES (?, ?, ?, ?, 1)`,
        )
        .bind(entityId, identity.household_id, identity.user_id, recordedAt),
      this.versionInsert(
        identity,
        entityId,
        versionId,
        1,
        null,
        input.profile,
        recordedAt,
      ),
    ];
    if (sourceSummary !== null && decisionId !== null) {
      statements.push(
        this.sourceDecisionInsert(
          identity,
          decisionId,
          sourceSummary,
          "linked",
          entityId,
          (currentDecision?.version ?? 0) + 1,
          currentDecision?.decision_id ?? null,
          recordedAt,
        ),
      );
    }
    await this.commitSourceReview(statements);
    return LegalEntityRecordSchema.parse({
      id: entityId,
      versionId,
      version: 1,
      ...input.profile,
      recordedAt,
      sources:
        sourceSummary === null || decisionId === null
          ? []
          : [{ ...sourceSummary, currentDecisionId: decisionId }],
    });
  }

  public async update(
    accessSubject: string,
    rawLegalEntityId: string,
    rawInput: UpdateLegalEntityInput,
  ): Promise<LegalEntityRecord> {
    const legalEntityId =
      LegalEntityRecordSchema.shape.id.parse(rawLegalEntityId);
    const input = UpdateLegalEntityInputSchema.parse(rawInput);
    const identity = await findIdentity(this.db, accessSubject);
    const current = await this.db
      .prepare(
        `SELECT version.id AS version_id, version.version
         FROM legal_entities entity
         JOIN legal_entity_versions version
           ON version.legal_entity_id = entity.id
          AND NOT EXISTS (
            SELECT 1
            FROM legal_entity_versions later
            WHERE later.supersedes_version_id = version.id
          )
         WHERE entity.id = ? AND entity.household_id = ?`,
      )
      .bind(legalEntityId, identity.household_id)
      .first<CurrentVersionIdentityRow>();
    if (current === null) {
      throw new LegalEntityRepositoryError(
        "not_found",
        "This legal entity is unavailable.",
      );
    }
    if (current.version_id !== input.expectedVersionId) {
      throw new LegalEntityRepositoryError(
        "stale",
        "This legal entity changed. Review the current record and try again.",
      );
    }
    const versionId = crypto.randomUUID();
    const recordedAt = new Date().toISOString();
    await this.db.batch([
      this.versionInsert(
        identity,
        legalEntityId,
        versionId,
        current.version + 1,
        current.version_id,
        input.profile,
        recordedAt,
      ),
    ]);
    return LegalEntityRecordSchema.parse({
      id: legalEntityId,
      versionId,
      version: current.version + 1,
      ...input.profile,
      recordedAt,
      sources: [],
    });
  }

  public async reviewSource(
    accessSubject: string,
    rawInput: ReviewLegalEntitySourceInput,
    positionView: InvestmentPositionView,
  ): Promise<LegalEntitySourceReviewResult> {
    const input = ReviewLegalEntitySourceInputSchema.parse(rawInput);
    const identity = await findIdentity(this.db, accessSubject);
    const current = await this.currentDecision(
      identity.household_id,
      input.source,
    );
    if ((current?.decision_id ?? null) !== input.expectedDecisionId) {
      throw new LegalEntityRepositoryError(
        "stale",
        "This source review changed. Review the current record and try again.",
      );
    }
    if (
      input.decision.kind === "linked" &&
      !(await this.entityExists(
        identity.household_id,
        input.decision.legalEntityId,
      ))
    ) {
      throw new LegalEntityRepositoryError(
        "not_found",
        "The selected legal entity is unavailable.",
      );
    }
    let source = await candidateFor(
      this.db,
      identity.household_id,
      positionView,
      input.source,
      current,
    );
    if (input.decision.kind === "linked") {
      const selectedName =
        input.nameResolution === undefined
          ? ""
          : await this.db
              .prepare(
                `SELECT version.legal_name, version.entity_type FROM legal_entities entity
         JOIN legal_entity_versions version ON version.legal_entity_id = entity.id
         WHERE entity.id = ? AND entity.household_id = ?
           AND NOT EXISTS (SELECT 1 FROM legal_entity_versions later WHERE later.supersedes_version_id = version.id)`,
              )
              .bind(input.decision.legalEntityId, identity.household_id)
              .first<{ legal_name: string; entity_type: LegalEntityType }>();
      source = await resolveSourceName(
        source,
        input.nameResolution,
        typeof selectedName === "string"
          ? selectedName
          : (selectedName?.legal_name ?? ""),
        typeof selectedName === "string"
          ? undefined
          : selectedName?.entity_type,
      );
    } else if (input.nameResolution !== undefined) {
      throw new LegalEntityRepositoryError(
        "invalid_source",
        "A name resolution must add or link a legal entity.",
      );
    }
    const decisionId = crypto.randomUUID();
    const decidedAt = new Date().toISOString();
    await this.commitSourceReview([
      this.sourceDecisionInsert(
        identity,
        decisionId,
        source,
        input.decision.kind,
        input.decision.kind === "linked" ? input.decision.legalEntityId : null,
        (current?.version ?? 0) + 1,
        current?.decision_id ?? null,
        decidedAt,
      ),
    ]);
    return LegalEntitySourceReviewResultSchema.parse({
      version: 1,
      decisionId,
    });
  }

  public async applyExactBatch(
    accessSubject: string,
    rawInput: LegalEntityExactBatchInput,
    positionView: InvestmentPositionView,
  ): Promise<LegalEntityExactBatchResult> {
    const input = LegalEntityExactBatchInputSchema.parse(rawInput);
    const { identity, state } = await this.loadState(
      accessSubject,
      positionView,
    );
    const plan = state.exactBatchPlan;
    if (plan.preview.revision !== input.expectedRevision) {
      throw new LegalEntityRepositoryError(
        "stale",
        "The exact legal entity review changed before it was saved.",
      );
    }
    if (plan.preview.sourceCount === 0) {
      throw new LegalEntityRepositoryError(
        "no_matches",
        "No source-reported LLC or LP names are ready for batch review.",
      );
    }

    const recordedAt = new Date().toISOString();
    const entityRows: Array<Record<string, unknown>> = [];
    const versionRows: Array<Record<string, unknown>> = [];
    const decisionRows: Array<Record<string, unknown>> = [];
    for (const group of plan.groups) {
      const entityId = group.entity?.id ?? crypto.randomUUID();
      if (group.entity === null) {
        const primarySource = group.sources[0];
        if (primarySource === undefined) {
          throw new Error("An exact legal entity group has no source.");
        }
        const sharedRelationship = group.sources.every(
          (source) => source.relationship === primarySource.relationship,
        )
          ? primarySource.relationship
          : "other";
        const sharedCurrentOwner = group.sources.every(
          (source) => source.currentOwner === primarySource.currentOwner,
        )
          ? primarySource.currentOwner
          : null;
        const sharedInterestStatus = group.sources.every(
          (source) => source.interestStatus === primarySource.interestStatus,
        )
          ? primarySource.interestStatus
          : "unknown";
        entityRows.push({
          id: entityId,
          householdId: identity.household_id,
          createdByUserId: identity.user_id,
          createdAt: recordedAt,
        });
        versionRows.push({
          id: crypto.randomUUID(),
          householdId: identity.household_id,
          legalEntityId: entityId,
          legalName: group.entityName,
          entityType: group.entityType,
          relationship: sharedRelationship,
          currentOwner: sharedCurrentOwner,
          interestStatus: sharedInterestStatus,
          recordedByUserId: identity.user_id,
          recordedAt,
        });
      }
      for (const source of group.sources) {
        decisionRows.push({
          id: crypto.randomUUID(),
          householdId: identity.household_id,
          sourceKind: source.source.kind,
          sourceReference: source.source.id,
          sourceName: source.sourceDisplayName,
          sourceLabel: source.sourceLabel,
          sourceAsOf: source.sourceAsOf,
          relationship: source.relationship,
          currentOwner: source.currentOwner,
          interestStatus: source.interestStatus,
          openedOn: source.openedOn,
          legalEntityId: entityId,
          decidedByUserId: identity.user_id,
          decidedAt: recordedAt,
        });
      }
    }

    const statements: D1PreparedStatement[] = [];
    if (entityRows.length > 0) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO legal_entities (
               id, household_id, created_by_user_id, created_at, immutable
             )
             SELECT
               json_extract(value, '$.id'),
               json_extract(value, '$.householdId'),
               json_extract(value, '$.createdByUserId'),
               json_extract(value, '$.createdAt'),
               1
             FROM json_each(?)`,
          )
          .bind(JSON.stringify(entityRows)),
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO legal_entity_versions (
               id, household_id, legal_entity_id, version, legal_name,
               entity_type, relationship, current_owner, jurisdiction,
               formed_on, ein_last_four, ownership_interest_ppm,
               interest_status, tax_classification, notes,
               supersedes_version_id, recorded_by_user_id, recorded_at,
               immutable
             )
             SELECT
               json_extract(value, '$.id'),
               json_extract(value, '$.householdId'),
               json_extract(value, '$.legalEntityId'),
               1,
               json_extract(value, '$.legalName'),
               json_extract(value, '$.entityType'),
               json_extract(value, '$.relationship'),
               json_extract(value, '$.currentOwner'),
               NULL,
               NULL,
               NULL,
               NULL,
               json_extract(value, '$.interestStatus'),
               NULL,
               NULL,
               NULL,
               json_extract(value, '$.recordedByUserId'),
               json_extract(value, '$.recordedAt'),
               1
             FROM json_each(?)`,
          )
          .bind(JSON.stringify(versionRows)),
      );
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO legal_entity_source_decisions (
             id, household_id, source_kind, source_reference, source_name,
             source_label, source_as_of, relationship, current_owner,
             interest_status, opened_on, decision, legal_entity_id, version,
             supersedes_decision_id, decided_by_user_id, decided_at, immutable
           )
           SELECT
             json_extract(value, '$.id'),
             json_extract(value, '$.householdId'),
             json_extract(value, '$.sourceKind'),
             json_extract(value, '$.sourceReference'),
             json_extract(value, '$.sourceName'),
             json_extract(value, '$.sourceLabel'),
             json_extract(value, '$.sourceAsOf'),
             json_extract(value, '$.relationship'),
             json_extract(value, '$.currentOwner'),
             json_extract(value, '$.interestStatus'),
             json_extract(value, '$.openedOn'),
             'linked',
             json_extract(value, '$.legalEntityId'),
             1,
             NULL,
             json_extract(value, '$.decidedByUserId'),
             json_extract(value, '$.decidedAt'),
             1
           FROM json_each(?)`,
        )
        .bind(JSON.stringify(decisionRows)),
    );

    try {
      await this.db.batch(statements);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new LegalEntityRepositoryError(
          "stale",
          "The exact legal entity review is no longer current.",
        );
      }
      throw error;
    }

    return LegalEntityExactBatchResultSchema.parse({
      version: 1,
      reviewedSourceCount: plan.preview.sourceCount,
      entityCount: plan.preview.entityCount,
      existingEntityCount: plan.preview.existingEntityCount,
      createdEntityCount: plan.preview.newEntityCount,
      remainingCandidateCount: plan.preview.remainingCandidateCount,
    });
  }

  private async commitSourceReview(
    statements: D1PreparedStatement[],
  ): Promise<void> {
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("legal name resolution entity changed") ||
          error.message.includes(
            "UNIQUE constraint failed: legal_entity_source_decisions.",
          ))
      )
        throw new LegalEntityRepositoryError(
          "stale",
          "The entity or source review changed. Reload its current details before saving.",
        );
      throw error;
    }
  }

  private async loadState(
    accessSubject: string,
    positionView: InvestmentPositionView | Promise<InvestmentPositionView>,
  ): Promise<{ identity: HouseholdIdentity; state: LegalEntityState }> {
    const [rows, view] = await Promise.all([
      this.loadRows(accessSubject),
      positionView,
    ]);
    return {
      identity: rows.identity,
      state: await stateFromRows(
        rows.entityRows,
        rows.decisionRows,
        view,
        rows.documentRows.map(documentSourceFromRow),
      ),
    };
  }

  private async loadRows(accessSubject: string) {
    const identity = await findIdentity(this.db, accessSubject);
    const [entityRows, decisionRows, documentRows] = await Promise.all([
      all<LegalEntityVersionRow>(
        this.db
          .prepare(
            `SELECT
               entity.id AS entity_id,
               version.id AS version_id,
               version.version,
               version.legal_name,
               version.entity_type,
               version.relationship,
               version.current_owner,
               version.jurisdiction,
               version.formed_on,
               version.ein_last_four,
               version.ownership_interest_ppm,
               version.interest_status,
               version.tax_classification,
               version.notes,
               version.recorded_at
             FROM legal_entities entity
             JOIN legal_entity_versions version
               ON version.legal_entity_id = entity.id
              AND NOT EXISTS (
                SELECT 1
                FROM legal_entity_versions later
                WHERE later.supersedes_version_id = version.id
              )
             WHERE entity.household_id = ?
             ORDER BY lower(version.legal_name), entity.id`,
          )
          .bind(identity.household_id),
      ),
      all<SourceDecisionRow>(
        this.db
          .prepare(
            `SELECT
               decision.id AS decision_id,
               decision.source_kind,
               decision.source_reference,
               decision.source_name,
               decision.source_label,
               decision.source_as_of,
               decision.relationship,
               decision.current_owner,
               decision.interest_status,
               decision.opened_on,
               decision.decision,
               decision.legal_entity_id,
               decision.version,
               decision.name_resolution_json
             FROM legal_entity_source_decisions decision
             WHERE decision.household_id = ?
               AND NOT EXISTS (
                 SELECT 1
                 FROM legal_entity_source_decisions later
                 WHERE later.supersedes_decision_id = decision.id
               )
             ORDER BY decision.source_kind, decision.source_reference`,
          )
          .bind(identity.household_id),
      ),
      all<DocumentSourceRow>(
        this.db
          .prepare(
            `${documentSourcesSql} WHERE origin.household_id = ? ORDER BY origin.position_id`,
          )
          .bind(identity.household_id),
      ),
    ]);
    return { identity, entityRows, decisionRows, documentRows };
  }

  private async currentDecision(
    householdId: string,
    source: LegalEntitySourceReference,
  ): Promise<SourceDecisionRow | null> {
    return this.db
      .prepare(
        `SELECT
           decision.id AS decision_id,
           decision.source_kind,
           decision.source_reference,
           decision.source_name,
           decision.source_label,
           decision.source_as_of,
           decision.relationship,
           decision.current_owner,
           decision.interest_status,
           decision.opened_on,
           decision.decision,
           decision.legal_entity_id,
           decision.version,
           decision.name_resolution_json
         FROM legal_entity_source_decisions decision
         WHERE decision.household_id = ?
           AND decision.source_kind = ?
           AND decision.source_reference = ?
           AND NOT EXISTS (
             SELECT 1
             FROM legal_entity_source_decisions later
             WHERE later.supersedes_decision_id = decision.id
           )`,
      )
      .bind(householdId, source.kind, source.id)
      .first<SourceDecisionRow>();
  }

  private async entityExists(
    householdId: string,
    legalEntityId: string,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT id
         FROM legal_entities
         WHERE id = ? AND household_id = ?`,
      )
      .bind(legalEntityId, householdId)
      .first<{ id: string }>();
    return row !== null;
  }

  private versionInsert(
    identity: HouseholdIdentity,
    legalEntityId: string,
    versionId: string,
    version: number,
    supersedesVersionId: string | null,
    rawProfile: LegalEntityProfileInput,
    recordedAt: string,
  ): D1PreparedStatement {
    const profile = LegalEntityProfileInputSchema.parse(rawProfile);
    return this.db
      .prepare(
        `INSERT INTO legal_entity_versions (
           id, household_id, legal_entity_id, version, legal_name,
           entity_type, relationship, current_owner, jurisdiction,
           formed_on, ein_last_four, ownership_interest_ppm,
           interest_status, tax_classification, notes,
           supersedes_version_id, recorded_by_user_id, recorded_at, immutable
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .bind(
        versionId,
        identity.household_id,
        legalEntityId,
        version,
        profile.legalName,
        profile.entityType,
        profile.relationship,
        profile.currentOwner,
        profile.jurisdiction,
        profile.formedOn,
        profile.einLastFour,
        profile.ownershipInterestPpm,
        profile.interestStatus,
        profile.taxClassification,
        profile.notes,
        supersedesVersionId,
        identity.user_id,
        recordedAt,
      );
  }

  private sourceDecisionInsert(
    identity: HouseholdIdentity,
    decisionId: string,
    source: LegalEntitySourceSummary,
    decision: "linked" | "not_llc",
    legalEntityId: string | null,
    version: number,
    supersedesDecisionId: string | null,
    decidedAt: string,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO legal_entity_source_decisions (
           id, household_id, source_kind, source_reference, source_name,
           source_label, source_as_of, relationship, current_owner,
           interest_status, opened_on, decision, legal_entity_id, version,
           supersedes_decision_id, decided_by_user_id, decided_at, immutable,
           name_resolution_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .bind(
        decisionId,
        identity.household_id,
        source.source.kind,
        source.source.id,
        source.sourceDisplayName,
        source.sourceLabel,
        source.sourceAsOf,
        source.relationship,
        source.currentOwner,
        source.interestStatus,
        source.openedOn,
        decision,
        legalEntityId,
        version,
        supersedesDecisionId,
        identity.user_id,
        decidedAt,
        decision === "linked" && source.nameResolution !== undefined
          ? JSON.stringify(source.nameResolution)
          : null,
      );
  }
}
