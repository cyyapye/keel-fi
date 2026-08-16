import {
  CanonicalExposureSchema,
  IsoTimestampSchema,
  PositionExposureMappingSchema,
  PrivateExposureResolutionInputSchema,
  PrivateExposureResolutionResultSchema,
  PrivateExposureReviewStateSchema,
  ProtectedIdentityKeySchema,
  type CanonicalExposure,
  type PositionExposureMapping,
  type PrivateExposureResolutionInput,
  type PrivateExposureResolutionResult,
  type PrivateExposureReviewState,
} from "@keel/domain";
import type { InvestmentExposureView } from "@keel/domain/exposure-read-model";
import { z } from "zod";

import {
  D1InvestmentExposureViewRepository,
  type InvestmentExposureViewRepository,
} from "./exposure-read-model";

const CanonicalExposureResolutionInputSchema = z.discriminatedUnion(
  "exposureKind",
  [
    z
      .object({
        exposureKind: z.literal("public_instrument"),
        canonicalName: z.string().trim().min(1).max(1_000),
        protectedIdentityKey: ProtectedIdentityKeySchema,
        evidenceSha256: ProtectedIdentityKeySchema,
      })
      .strict(),
    z
      .object({
        exposureKind: z.literal("private_company"),
        canonicalName: z.string().trim().min(1).max(1_000),
        companyId: z.string().min(1),
        evidenceSha256: ProtectedIdentityKeySchema,
      })
      .strict(),
    z
      .object({
        exposureKind: z.literal("fund"),
        canonicalName: z.string().trim().min(1).max(1_000),
        protectedIdentityKey: ProtectedIdentityKeySchema,
        evidenceSha256: ProtectedIdentityKeySchema,
      })
      .strict(),
    z
      .object({
        exposureKind: z.literal("unresolved"),
        canonicalName: z.string().trim().min(1).max(1_000),
        evidenceSha256: ProtectedIdentityKeySchema,
      })
      .strict(),
  ],
);

const PositionExposureMappingInputSchema = z
  .object({
    positionId: z.string().min(1),
    exposureId: z.string().min(1),
    relationshipKind: z.enum(["direct", "look_through"]),
    allocationPpm: z.number().int().safe().min(0).max(1_000_000).nullable(),
    status: z.enum(["active", "withdrawn"]),
    decisionSource: z.enum(["deterministic_policy", "review"]),
    decisionReference: z.string().trim().min(1).max(200),
    evidenceSha256: ProtectedIdentityKeySchema,
    effectiveAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "withdrawn" && value.allocationPpm !== null) {
      context.addIssue({
        code: "custom",
        path: ["allocationPpm"],
        message: "Withdrawn mappings cannot carry an allocation.",
      });
    }
    if (
      value.status === "active" &&
      value.relationshipKind === "direct" &&
      value.allocationPpm !== 1_000_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["allocationPpm"],
        message: "Active direct mappings require full allocation.",
      });
    }
  });

export type CanonicalExposureResolutionInput = z.infer<
  typeof CanonicalExposureResolutionInputSchema
>;
export type PositionExposureMappingInput = z.infer<
  typeof PositionExposureMappingInputSchema
>;

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
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
  status: "active" | "withdrawn";
  decision_source: "deterministic_policy" | "review";
  decision_reference: string;
  evidence_sha256: string;
  effective_at: string;
  version: number;
  supersedes_mapping_id: string | null;
};

type DeterministicPublicRow = {
  position_id: string;
  canonical_name: string;
  public_exposure_identity_kind: "cusip" | "isin" | "sedol";
  protected_exposure_key: string;
  evidence_sha256: string;
  effective_at: string;
};

type PrivateExposureReviewPositionRow = {
  position_id: string;
  snapshot_id: string;
  legal_vehicle_name: string;
  reported_exposure_name: string | null;
  position_kind: "direct" | "spv_interest";
  owner_label: string;
  observed_at: string;
};

type PrivateExposureCompanyRow = {
  id: string;
  legal_name: string;
  website_host: string | null;
  status: "active" | "exited" | "written_off";
};

type PrivateExposureReviewEvidenceRow = PrivateExposureReviewPositionRow & {
  evidence_sha256: string;
};

type CurrentExposureMappingRow = PositionExposureMappingRow & {
  exposure_kind:
    "public_instrument" | "private_company" | "fund" | "unresolved";
};

export type PrivateExposureReviewErrorCode =
  | "already_resolved"
  | "company_conflict"
  | "invalid_company"
  | "not_found"
  | "stale";

export class PrivateExposureReviewError extends Error {
  public constructor(
    public readonly code: PrivateExposureReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrivateExposureReviewError";
  }
}

export interface PrivateExposureReviewRepository {
  getPrivateExposureReviewState(
    accessSubject: string,
  ): Promise<PrivateExposureReviewState>;
  assignPrivateCompanyExposure(
    accessSubject: string,
    positionId: string,
    input: PrivateExposureResolutionInput,
  ): Promise<PrivateExposureResolutionResult>;
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

async function all<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results;
}

export class D1ExposureRepository {
  public constructor(
    private readonly db: D1Database,
    private readonly readModel: InvestmentExposureViewRepository = new D1InvestmentExposureViewRepository(
      db,
    ),
  ) {}

  public async getPrivateExposureReviewState(
    accessSubject: string,
  ): Promise<PrivateExposureReviewState> {
    const identity = await this.findIdentity(accessSubject);
    const [positions, companies] = await Promise.all([
      all<PrivateExposureReviewPositionRow>(
        this.db
          .prepare(
            `SELECT
               position.id AS position_id,
               snapshot.id AS snapshot_id,
               position.legal_vehicle_name,
               (
                 SELECT reported.exposure_label
                 FROM holding_position_exposures reported
                 WHERE reported.position_id = position.id
                 ORDER BY reported.created_at, reported.id
                 LIMIT 1
               ) AS reported_exposure_name,
               position.position_kind,
               position.owner_label,
               snapshot.observed_at
             FROM holding_positions position
             JOIN holding_import_applications application
               ON application.id = (
                 SELECT latest.id
                 FROM holding_import_applications latest
                 WHERE latest.position_id = position.id
                 ORDER BY latest.applied_at DESC, latest.id DESC
                 LIMIT 1
               )
             JOIN holding_position_snapshots snapshot
               ON snapshot.id = application.snapshot_id
              AND snapshot.position_id = position.id
             WHERE position.household_id = ?
               AND position.provider = 'angellist'
               AND position.position_kind IN ('direct', 'spv_interest')
               AND NOT EXISTS (
                 SELECT 1
                 FROM holding_position_exposure_mappings mapping
                 JOIN canonical_exposures exposure
                   ON exposure.id = mapping.exposure_id
                 WHERE mapping.position_id = position.id
                   AND mapping.household_id = position.household_id
                   AND mapping.status = 'active'
                   AND exposure.exposure_kind <> 'unresolved'
                   AND NOT EXISTS (
                     SELECT 1
                     FROM holding_position_exposure_mappings later
                     WHERE later.supersedes_mapping_id = mapping.id
                   )
               )
             ORDER BY
               lower(COALESCE(reported_exposure_name, position.legal_vehicle_name)),
               lower(position.legal_vehicle_name),
               position.id
             LIMIT 500`,
          )
          .bind(identity.household_id),
      ),
      all<PrivateExposureCompanyRow>(
        this.db
          .prepare(
            `SELECT id, legal_name, website_host, status
             FROM companies
             WHERE household_id = ?
             ORDER BY lower(legal_name), id
             LIMIT 1000`,
          )
          .bind(identity.household_id),
      ),
    ]);

    return PrivateExposureReviewStateSchema.parse({
      version: 1,
      positions: positions.map((position) => ({
        positionId: position.position_id,
        snapshotId: position.snapshot_id,
        legalVehicleName: position.legal_vehicle_name,
        reportedExposureName: position.reported_exposure_name,
        positionKind: position.position_kind,
        ownerLabel: position.owner_label,
        observedAt: position.observed_at,
      })),
      companies: companies.map((company) => ({
        id: company.id,
        legalName: company.legal_name,
        websiteHost: company.website_host,
        status: company.status,
      })),
    });
  }

  public async assignPrivateCompanyExposure(
    accessSubject: string,
    positionId: string,
    rawInput: PrivateExposureResolutionInput,
  ): Promise<PrivateExposureResolutionResult> {
    const input = PrivateExposureResolutionInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const position = await this.db
      .prepare(
        `SELECT
           position.id AS position_id,
           snapshot.id AS snapshot_id,
           position.legal_vehicle_name,
           (
             SELECT reported.exposure_label
             FROM holding_position_exposures reported
             WHERE reported.position_id = position.id
             ORDER BY reported.created_at, reported.id
             LIMIT 1
           ) AS reported_exposure_name,
           position.position_kind,
           position.owner_label,
           snapshot.observed_at,
           document.sha256 AS evidence_sha256
         FROM holding_positions position
         JOIN holding_import_applications application
           ON application.id = (
             SELECT latest.id
             FROM holding_import_applications latest
             WHERE latest.position_id = position.id
             ORDER BY latest.applied_at DESC, latest.id DESC
             LIMIT 1
           )
         JOIN holding_position_snapshots snapshot
           ON snapshot.id = application.snapshot_id
          AND snapshot.position_id = position.id
         JOIN source_documents document
           ON document.id = snapshot.source_document_id
         WHERE position.id = ?
           AND position.household_id = ?
           AND position.provider = 'angellist'
           AND position.position_kind IN ('direct', 'spv_interest')`,
      )
      .bind(positionId, identity.household_id)
      .first<PrivateExposureReviewEvidenceRow>();
    if (position === null) {
      throw new PrivateExposureReviewError(
        "not_found",
        "Private position was not found for review.",
      );
    }
    if (position.snapshot_id !== input.expectedSnapshotId) {
      throw new PrivateExposureReviewError(
        "stale",
        "The reviewed position changed before exposure assignment.",
      );
    }

    const currentMappings = await all<CurrentExposureMappingRow>(
      this.db
        .prepare(
          `SELECT
             mapping.id, mapping.household_id, mapping.position_id,
             mapping.exposure_id, mapping.relationship_kind,
             mapping.allocation_ppm, mapping.status,
             mapping.decision_source, mapping.decision_reference,
             mapping.evidence_sha256, mapping.effective_at,
             mapping.version, mapping.supersedes_mapping_id,
             exposure.exposure_kind
           FROM holding_position_exposure_mappings mapping
           JOIN canonical_exposures exposure ON exposure.id = mapping.exposure_id
           WHERE mapping.household_id = ?
             AND mapping.position_id = ?
             AND NOT EXISTS (
               SELECT 1
               FROM holding_position_exposure_mappings later
               WHERE later.supersedes_mapping_id = mapping.id
             )
           ORDER BY mapping.exposure_id`,
        )
        .bind(identity.household_id, positionId),
    );
    if (
      currentMappings.some(
        (mapping) =>
          mapping.status === "active" && mapping.exposure_kind !== "unresolved",
      )
    ) {
      throw new PrivateExposureReviewError(
        "already_resolved",
        "This position already has a reviewed exposure.",
      );
    }

    let company: PrivateExposureCompanyRow;
    let createCompany = false;
    if (input.company.mode === "existing") {
      const existing = await this.db
        .prepare(
          `SELECT id, legal_name, website_host, status
           FROM companies
           WHERE id = ? AND household_id = ?`,
        )
        .bind(input.company.companyId, identity.household_id)
        .first<PrivateExposureCompanyRow>();
      if (existing === null) {
        throw new PrivateExposureReviewError(
          "invalid_company",
          "Reviewed company was not found for this household.",
        );
      }
      company = existing;
    } else {
      const conflicting = await this.db
        .prepare(
          `SELECT id
           FROM companies
           WHERE household_id = ?
             AND trim(legal_name) = trim(?) COLLATE NOCASE`,
        )
        .bind(identity.household_id, input.company.legalName)
        .first<{ id: string }>();
      if (conflicting !== null) {
        throw new PrivateExposureReviewError(
          "company_conflict",
          "A reviewed company with this name already exists.",
        );
      }
      company = {
        id: crypto.randomUUID(),
        legal_name: input.company.legalName,
        website_host:
          input.company.websiteHost === null
            ? null
            : input.company.websiteHost.toLowerCase(),
        status: "active",
      };
      createCompany = true;
    }

    const existingExposure = await this.db
      .prepare(
        `SELECT
           id, household_id, exposure_kind, canonical_name,
           protected_identity_key, company_id, resolution_method,
           evidence_sha256, created_at
         FROM canonical_exposures
         WHERE household_id = ? AND company_id = ?`,
      )
      .bind(identity.household_id, company.id)
      .first<CanonicalExposureRow>();
    const exposureId = existingExposure?.id ?? crypto.randomUUID();
    const mappingId = crypto.randomUUID();
    const acceptedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    if (createCompany) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO companies (
               id, household_id, legal_name, website_host, status,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
          )
          .bind(
            company.id,
            identity.household_id,
            company.legal_name,
            company.website_host,
            acceptedAt,
            acceptedAt,
          ),
      );
    }
    if (existingExposure === null) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO canonical_exposures (
               id, household_id, exposure_kind, canonical_name,
               protected_identity_key, company_id, resolution_method,
               evidence_sha256, created_by_user_id, created_at, immutable
             ) VALUES (?, ?, 'private_company', ?, NULL, ?,
               'reviewed_company', ?, ?, ?, 1)`,
          )
          .bind(
            exposureId,
            identity.household_id,
            company.legal_name,
            company.id,
            position.evidence_sha256,
            identity.user_id,
            acceptedAt,
          ),
      );
    }

    for (const mapping of currentMappings.filter(
      (candidate) =>
        candidate.status === "active" &&
        candidate.exposure_kind === "unresolved",
    )) {
      const effectiveAt =
        mapping.effective_at > acceptedAt ? mapping.effective_at : acceptedAt;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO holding_position_exposure_mappings (
               id, household_id, position_id, exposure_id, relationship_kind,
               allocation_ppm, status, decision_source, decision_reference,
               evidence_sha256, effective_at, version, supersedes_mapping_id,
               accepted_by_user_id, accepted_at, immutable
             ) VALUES (?, ?, ?, ?, ?, NULL, 'withdrawn', 'review', ?, ?, ?, ?,
               ?, ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            positionId,
            mapping.exposure_id,
            mapping.relationship_kind,
            "Replaced by reviewed company assignment",
            position.evidence_sha256,
            effectiveAt,
            mapping.version + 1,
            mapping.id,
            identity.user_id,
            acceptedAt,
          ),
      );
    }

    const currentTarget = currentMappings.find(
      (mapping) => mapping.exposure_id === exposureId,
    );
    const mappingEffectiveAt =
      currentTarget !== undefined && currentTarget.effective_at > acceptedAt
        ? currentTarget.effective_at
        : acceptedAt;
    statements.push(
      this.db
        .prepare(
          `INSERT INTO holding_position_exposure_mappings (
             id, household_id, position_id, exposure_id, relationship_kind,
             allocation_ppm, status, decision_source, decision_reference,
             evidence_sha256, effective_at, version, supersedes_mapping_id,
             accepted_by_user_id, accepted_at, immutable
           ) VALUES (?, ?, ?, ?, ?, 1000000, 'active', 'review', ?, ?, ?, ?, ?,
             ?, ?, 1)`,
        )
        .bind(
          mappingId,
          identity.household_id,
          positionId,
          exposureId,
          position.position_kind === "direct" ? "direct" : "look_through",
          "Reviewed company assignment",
          position.evidence_sha256,
          mappingEffectiveAt,
          (currentTarget?.version ?? 0) + 1,
          currentTarget?.id ?? null,
          identity.user_id,
          acceptedAt,
        ),
    );

    try {
      await this.db.batch(statements);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new PrivateExposureReviewError(
          "stale",
          "This exposure review is no longer current.",
        );
      }
      throw error;
    }

    return PrivateExposureResolutionResultSchema.parse({
      version: 1,
      positionId,
      companyId: company.id,
      companyName: company.legal_name,
      exposureId,
      mappingId,
    });
  }

  public async resolveExposure(
    accessSubject: string,
    rawInput: CanonicalExposureResolutionInput,
  ): Promise<CanonicalExposure> {
    const input = CanonicalExposureResolutionInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const existing = await this.findResolvedExposure(
      identity.household_id,
      input,
    );
    if (existing !== null) {
      if (existing.exposure_kind !== input.exposureKind) {
        throw new Error(
          "Canonical exposure identity is already used differently.",
        );
      }
      return canonicalExposureFrom(existing);
    }

    if (input.exposureKind === "private_company") {
      const company = await this.db
        .prepare(
          `SELECT id
           FROM companies
           WHERE id = ? AND household_id = ?`,
        )
        .bind(input.companyId, identity.household_id)
        .first<{ id: string }>();
      if (company === null) {
        throw new Error("Reviewed company was not found for this household.");
      }
    }

    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const protectedIdentityKey =
      input.exposureKind === "public_instrument" ||
      input.exposureKind === "fund"
        ? input.protectedIdentityKey
        : null;
    const companyId =
      input.exposureKind === "private_company" ? input.companyId : null;
    const resolutionMethod =
      input.exposureKind === "public_instrument"
        ? "strong_identifier"
        : input.exposureKind === "private_company"
          ? "reviewed_company"
          : input.exposureKind === "fund"
            ? "reviewed_fund"
            : "unresolved";

    await this.db
      .prepare(
        `INSERT INTO canonical_exposures (
           id, household_id, exposure_kind, canonical_name,
           protected_identity_key, company_id, resolution_method,
           evidence_sha256, created_by_user_id, created_at, immutable
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .bind(
        id,
        identity.household_id,
        input.exposureKind,
        input.canonicalName,
        protectedIdentityKey,
        companyId,
        resolutionMethod,
        input.evidenceSha256,
        identity.user_id,
        createdAt,
      )
      .run();

    return CanonicalExposureSchema.parse({
      id,
      householdId: identity.household_id,
      exposureKind: input.exposureKind,
      canonicalName: input.canonicalName,
      protectedIdentityKey,
      companyId,
      resolutionMethod,
      evidenceSha256: input.evidenceSha256,
      createdAt,
    });
  }

  public async recordMapping(
    accessSubject: string,
    rawInput: PositionExposureMappingInput,
  ): Promise<PositionExposureMapping> {
    const input = PositionExposureMappingInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const [position, exposure, current] = await Promise.all([
      this.db
        .prepare(
          `SELECT id, position_kind
           FROM holding_positions
           WHERE id = ? AND household_id = ?`,
        )
        .bind(input.positionId, identity.household_id)
        .first<{ id: string; position_kind: string }>(),
      this.getExposure(identity.household_id, input.exposureId),
      this.db
        .prepare(
          `SELECT
             mapping.id, mapping.household_id, mapping.position_id,
             mapping.exposure_id, mapping.relationship_kind,
             mapping.allocation_ppm, mapping.status, mapping.decision_source,
             mapping.decision_reference, mapping.evidence_sha256,
             mapping.effective_at, mapping.version,
             mapping.supersedes_mapping_id
           FROM holding_position_exposure_mappings mapping
           WHERE mapping.household_id = ?
             AND mapping.position_id = ?
             AND mapping.exposure_id = ?
             AND NOT EXISTS (
               SELECT 1
               FROM holding_position_exposure_mappings later
               WHERE later.supersedes_mapping_id = mapping.id
             )`,
        )
        .bind(identity.household_id, input.positionId, input.exposureId)
        .first<PositionExposureMappingRow>(),
    ]);
    if (position === null) {
      throw new Error("Holding position was not found for this household.");
    }
    if (exposure === null) {
      throw new Error("Canonical exposure was not found for this household.");
    }
    if (
      exposure.exposure_kind === "unresolved" &&
      input.status === "active" &&
      input.allocationPpm !== null
    ) {
      throw new Error("Unresolved exposures cannot receive allocated value.");
    }
    if (
      current !== null &&
      current.relationship_kind === input.relationshipKind &&
      current.allocation_ppm === input.allocationPpm &&
      current.status === input.status
    ) {
      return mappingFrom(current);
    }
    if (
      current?.status === "withdrawn" &&
      input.status === "active" &&
      input.decisionSource === "deterministic_policy"
    ) {
      throw new Error("A withdrawn exposure mapping requires explicit review.");
    }
    if (current !== null && current.effective_at > input.effectiveAt) {
      throw new Error(
        "Exposure mapping corrections cannot move backward in time.",
      );
    }

    const allocation = await this.db
      .prepare(
        `SELECT COALESCE(SUM(mapping.allocation_ppm), 0) AS allocated_ppm
         FROM holding_position_exposure_mappings mapping
         WHERE mapping.household_id = ?
           AND mapping.position_id = ?
           AND mapping.status = 'active'
           AND mapping.allocation_ppm IS NOT NULL
           AND mapping.id <> COALESCE(?, '')
           AND NOT EXISTS (
             SELECT 1
             FROM holding_position_exposure_mappings later
             WHERE later.supersedes_mapping_id = mapping.id
           )`,
      )
      .bind(identity.household_id, input.positionId, current?.id ?? null)
      .first<{ allocated_ppm: number }>();
    const nextAllocation =
      input.status === "active" ? (input.allocationPpm ?? 0) : 0;
    if ((allocation?.allocated_ppm ?? 0) + nextAllocation > 1_000_000) {
      throw new Error("Exposure allocations exceed one million ppm.");
    }

    const acceptedAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const version = (current?.version ?? 0) + 1;
    await this.db
      .prepare(
        `INSERT INTO holding_position_exposure_mappings (
           id, household_id, position_id, exposure_id, relationship_kind,
           allocation_ppm, status, decision_source, decision_reference,
           evidence_sha256, effective_at, version, supersedes_mapping_id,
           accepted_by_user_id, accepted_at, immutable
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .bind(
        id,
        identity.household_id,
        input.positionId,
        input.exposureId,
        input.relationshipKind,
        input.allocationPpm,
        input.status,
        input.decisionSource,
        input.decisionReference,
        input.evidenceSha256,
        input.effectiveAt,
        version,
        current?.id ?? null,
        identity.user_id,
        acceptedAt,
      )
      .run();

    return PositionExposureMappingSchema.parse({
      id,
      householdId: identity.household_id,
      positionId: input.positionId,
      exposureId: input.exposureId,
      relationshipKind: input.relationshipKind,
      allocationPpm: input.allocationPpm,
      status: input.status,
      decisionSource: input.decisionSource,
      decisionReference: input.decisionReference,
      evidenceSha256: input.evidenceSha256,
      effectiveAt: input.effectiveAt,
      version,
      supersedesMappingId: current?.id ?? null,
    });
  }

  public async reconcileDeterministicPublicImport(
    accessSubject: string,
    importId: string,
  ): Promise<void> {
    const identity = await this.findIdentity(accessSubject);
    const rows = await all<DeterministicPublicRow>(
      this.db
        .prepare(
          `SELECT
             application.position_id,
             row.legal_vehicle_name AS canonical_name,
             row.public_exposure_identity_kind,
             row.protected_exposure_key,
             document.sha256 AS evidence_sha256,
             CASE
               WHEN document.effective_date IS NULL THEN document.retrieved_at
               ELSE document.effective_date || 'T00:00:00.000Z'
             END AS effective_at
           FROM holding_import_applications application
           JOIN holding_import_rows row ON row.id = application.import_row_id
           JOIN holding_imports import ON import.id = row.import_id
           JOIN source_documents document ON document.id = import.source_document_id
           WHERE import.id = ?
             AND import.household_id = ?
             AND row.public_exposure_identity_kind IS NOT NULL
             AND row.protected_exposure_key IS NOT NULL
           ORDER BY row.source_row_number`,
        )
        .bind(importId, identity.household_id),
    );

    for (const row of rows) {
      const exposure = await this.resolveExposure(accessSubject, {
        exposureKind: "public_instrument",
        canonicalName: row.canonical_name,
        protectedIdentityKey: row.protected_exposure_key,
        evidenceSha256: row.evidence_sha256,
      });
      await this.recordMapping(accessSubject, {
        positionId: row.position_id,
        exposureId: exposure.id,
        relationshipKind: "direct",
        allocationPpm: 1_000_000,
        status: "active",
        decisionSource: "deterministic_policy",
        decisionReference: `public-strong-identifier-v1:${row.public_exposure_identity_kind}`,
        evidenceSha256: row.evidence_sha256,
        effectiveAt: row.effective_at,
      });
    }
  }

  public async getProjection(
    accessSubject: string,
  ): Promise<InvestmentExposureView> {
    return this.readModel.list(accessSubject);
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id, user.id AS user_id
         FROM users user
         JOIN households household ON household.owner_user_id = user.id
         WHERE user.access_subject = ?`,
      )
      .bind(accessSubject)
      .first<HouseholdIdentity>();
    if (identity === null) {
      throw new Error("No household is provisioned for this identity.");
    }
    return identity;
  }

  private async findResolvedExposure(
    householdId: string,
    input: CanonicalExposureResolutionInput,
  ): Promise<CanonicalExposureRow | null> {
    if (input.exposureKind === "unresolved") {
      return null;
    }
    if (input.exposureKind === "private_company") {
      return this.db
        .prepare(
          `SELECT
             id, household_id, exposure_kind, canonical_name,
             protected_identity_key, company_id, resolution_method,
             evidence_sha256, created_at
           FROM canonical_exposures
           WHERE household_id = ? AND company_id = ?`,
        )
        .bind(householdId, input.companyId)
        .first<CanonicalExposureRow>();
    }
    return this.db
      .prepare(
        `SELECT
           id, household_id, exposure_kind, canonical_name,
           protected_identity_key, company_id, resolution_method,
           evidence_sha256, created_at
         FROM canonical_exposures
         WHERE household_id = ? AND protected_identity_key = ?`,
      )
      .bind(householdId, input.protectedIdentityKey)
      .first<CanonicalExposureRow>();
  }

  private getExposure(
    householdId: string,
    exposureId: string,
  ): Promise<CanonicalExposureRow | null> {
    return this.db
      .prepare(
        `SELECT
           id, household_id, exposure_kind, canonical_name,
           protected_identity_key, company_id, resolution_method,
           evidence_sha256, created_at
         FROM canonical_exposures
         WHERE household_id = ? AND id = ?`,
      )
      .bind(householdId, exposureId)
      .first<CanonicalExposureRow>();
  }
}
