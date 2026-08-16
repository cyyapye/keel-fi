import {
  CanonicalExposureSchema,
  PositionExposureMappingSchema,
  type CanonicalExposure,
  type PositionExposureMapping,
} from "@keel/domain";
import {
  createInvestmentExposureView,
  type InvestmentExposureView,
} from "@keel/domain/exposure-read-model";
import {
  InvestmentPositionViewSchema,
  type InvestmentPositionView,
} from "@keel/domain/position-read-model";

import {
  D1InvestmentPositionViewRepository,
  type InvestmentPositionViewRepository,
} from "./position-read-model";

type HouseholdIdentity = {
  household_id: string;
};

type CanonicalExposureRow = {
  id: string;
  household_id: string;
  exposure_kind:
    "public_instrument" | "private_company" | "fund" | "unresolved";
  canonical_name: string;
  protected_identity_key: string | null;
  company_id: string | null;
  resolution_method:
    "strong_identifier" | "reviewed_company" | "reviewed_fund" | "unresolved";
  evidence_sha256: string;
  created_at: string;
};

type PositionExposureMappingRow = {
  id: string;
  household_id: string;
  position_id: string;
  exposure_id: string;
  relationship_kind: "direct" | "look_through";
  allocation_ppm: number | null;
  status: "active";
  decision_source: "deterministic_policy" | "review";
  decision_reference: string;
  evidence_sha256: string;
  effective_at: string;
  version: number;
  supersedes_mapping_id: string | null;
};

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

function canonicalExposureFrom(row: CanonicalExposureRow): CanonicalExposure {
  return CanonicalExposureSchema.parse({
    id: row.id,
    householdId: row.household_id,
    exposureKind: row.exposure_kind,
    canonicalName: row.canonical_name,
    protectedIdentityKey: row.protected_identity_key,
    companyId: row.company_id,
    resolutionMethod: row.resolution_method,
    evidenceSha256: row.evidence_sha256,
    createdAt: row.created_at,
  });
}

function mappingFrom(row: PositionExposureMappingRow): PositionExposureMapping {
  return PositionExposureMappingSchema.parse({
    id: row.id,
    householdId: row.household_id,
    positionId: row.position_id,
    exposureId: row.exposure_id,
    relationshipKind: row.relationship_kind,
    allocationPpm: row.allocation_ppm,
    status: row.status,
    decisionSource: row.decision_source,
    decisionReference: row.decision_reference,
    evidenceSha256: row.evidence_sha256,
    effectiveAt: row.effective_at,
    version: row.version,
    supersedesMappingId: row.supersedes_mapping_id,
  });
}

export interface InvestmentExposureViewRepository {
  list(
    accessSubject: string,
    asOf?: string,
    positionView?: InvestmentPositionView,
  ): Promise<InvestmentExposureView>;
}

export class D1InvestmentExposureViewRepository implements InvestmentExposureViewRepository {
  public constructor(
    private readonly db: D1Database,
    private readonly positions: InvestmentPositionViewRepository = new D1InvestmentPositionViewRepository(
      db,
    ),
  ) {}

  public async list(
    accessSubject: string,
    asOf = new Date().toISOString(),
    suppliedPositionView?: InvestmentPositionView,
  ): Promise<InvestmentExposureView> {
    const [identity, positionView] = await Promise.all([
      this.findIdentity(accessSubject),
      suppliedPositionView === undefined
        ? this.positions.list(accessSubject, asOf)
        : Promise.resolve(
            InvestmentPositionViewSchema.parse(suppliedPositionView),
          ),
    ]);
    const [exposureRows, mappingRows] = await Promise.all([
      all<CanonicalExposureRow>(
        this.db
          .prepare(
            `SELECT
               id, household_id, exposure_kind, canonical_name,
               protected_identity_key, company_id, resolution_method,
               evidence_sha256, created_at
             FROM canonical_exposures
             WHERE household_id = ?
             ORDER BY lower(canonical_name), id`,
          )
          .bind(identity.household_id),
      ),
      all<PositionExposureMappingRow>(
        this.db
          .prepare(
            `SELECT
               mapping.id, mapping.household_id, mapping.position_id,
               mapping.exposure_id, mapping.relationship_kind,
               mapping.allocation_ppm, mapping.status,
               mapping.decision_source, mapping.decision_reference,
               mapping.evidence_sha256, mapping.effective_at,
               mapping.version, mapping.supersedes_mapping_id
             FROM holding_position_exposure_mappings mapping
             WHERE mapping.household_id = ?
               AND mapping.status = 'active'
               AND NOT EXISTS (
                 SELECT 1
                 FROM holding_position_exposure_mappings later
                 WHERE later.supersedes_mapping_id = mapping.id
               )
             ORDER BY mapping.position_id, mapping.exposure_id`,
          )
          .bind(identity.household_id),
      ),
    ]);
    return createInvestmentExposureView(
      positionView,
      exposureRows.map(canonicalExposureFrom),
      mappingRows.map(mappingFrom),
    );
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id
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
}
