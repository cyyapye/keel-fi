import {
  CanonicalExposureSchema,
  IsoTimestampSchema,
  NonNegativeMoneyMinorSchema,
  PositionExposureMappingSchema,
  ProtectedIdentityKeySchema,
  multiplyMinorByScalePpm,
  type CanonicalExposure,
  type PositionExposureMapping,
} from "@keel/domain";
import { z } from "zod";

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

type PositionRow = {
  id: string;
  legal_vehicle_name: string;
  position_kind: "direct" | "spv_interest" | "fund_interest";
  currency: string;
  value_minor: number | null;
  value_state: "reported" | "locked" | "not_reported";
  observed_at: string;
};

type DeterministicPublicRow = {
  position_id: string;
  canonical_name: string;
  public_exposure_identity_kind: "cusip" | "isin" | "sedol";
  protected_exposure_key: string;
  evidence_sha256: string;
  effective_at: string;
};

export type ExposureContribution = {
  readonly positionId: string;
  readonly exposureId: string;
  readonly relationshipKind: "direct" | "look_through";
  readonly currency: string;
  readonly positionValueMinor: number | null;
  readonly allocationPpm: number | null;
  readonly allocatedValueMinor: number | null;
};

export type ExposureProjection = {
  readonly positions: readonly {
    readonly id: string;
    readonly legalVehicleName: string;
    readonly positionKind: "direct" | "spv_interest" | "fund_interest";
    readonly currency: string;
    readonly observedAt: string;
    readonly valueMinor: number | null;
    readonly valueState: "reported" | "locked" | "not_reported";
    readonly mappedExposureIds: readonly string[];
    readonly knownAllocationPpm: number;
    readonly hasUnknownAllocation: boolean;
    readonly allocatedValueMinor: number | null;
    readonly unallocatedValueMinor: number | null;
  }[];
  readonly exposures: readonly {
    readonly exposure: CanonicalExposure;
    readonly contributions: readonly ExposureContribution[];
    readonly totals: readonly {
      readonly currency: string;
      readonly allocatedValueMinor: number;
      readonly knownValuePositionCount: number;
      readonly unknownValuePositionCount: number;
    }[];
  }[];
};

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

function safeMinorSum(values: readonly number[]): number {
  const result = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return NonNegativeMoneyMinorSchema.parse(Number(result));
}

export class D1ExposureRepository {
  public constructor(private readonly db: D1Database) {}

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
  ): Promise<ExposureProjection> {
    const identity = await this.findIdentity(accessSubject);
    const [exposureRows, mappingRows, positionRows] = await Promise.all([
      all<CanonicalExposureRow>(
        this.db
          .prepare(
            `SELECT
               id, household_id, exposure_kind, canonical_name,
               protected_identity_key, company_id, resolution_method,
               evidence_sha256, created_at
             FROM canonical_exposures
             WHERE household_id = ?
             ORDER BY canonical_name, id`,
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
      all<PositionRow>(
        this.db
          .prepare(
            `SELECT
               position.id, position.legal_vehicle_name,
               position.position_kind, position.currency,
               snapshot.unrealized_value_minor AS value_minor,
               snapshot.unrealized_value_state AS value_state,
               snapshot.observed_at
             FROM holding_positions position
             JOIN holding_position_snapshots snapshot
               ON snapshot.id = (
                 SELECT latest.id
                 FROM holding_position_snapshots latest
                 WHERE latest.position_id = position.id
                   AND EXISTS (
                     SELECT 1
                     FROM holding_import_applications application
                     WHERE application.position_id = position.id
                       AND application.snapshot_id = latest.id
                   )
                 ORDER BY latest.observed_at DESC, latest.created_at DESC,
                          latest.id DESC
                 LIMIT 1
               )
             WHERE position.household_id = ?
             ORDER BY position.id`,
          )
          .bind(identity.household_id),
      ),
    ]);
    return projectExposures(exposureRows, mappingRows, positionRows);
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

function projectExposures(
  exposureRows: readonly CanonicalExposureRow[],
  mappingRows: readonly PositionExposureMappingRow[],
  positionRows: readonly PositionRow[],
): ExposureProjection {
  const exposures = exposureRows.map(canonicalExposureFrom);
  const exposureById = new Map(
    exposures.map((exposure) => [exposure.id, exposure]),
  );
  const mappings = mappingRows.map(mappingFrom);
  const mappingsByPosition = new Map<string, PositionExposureMapping[]>();
  mappings.forEach((mapping) => {
    if (!exposureById.has(mapping.exposureId)) {
      throw new Error("Exposure projection references an unknown exposure.");
    }
    const existing = mappingsByPosition.get(mapping.positionId) ?? [];
    existing.push(mapping);
    mappingsByPosition.set(mapping.positionId, existing);
  });

  const contributionsByExposure = new Map<string, ExposureContribution[]>();
  const projectedPositions = positionRows.map((position) => {
    const valueMinor =
      position.value_state === "reported"
        ? NonNegativeMoneyMinorSchema.parse(position.value_minor)
        : null;
    const positionMappings = mappingsByPosition.get(position.id) ?? [];
    const knownAllocationPpm = positionMappings.reduce(
      (sum, mapping) => sum + (mapping.allocationPpm ?? 0),
      0,
    );
    if (knownAllocationPpm > 1_000_000) {
      throw new Error(
        "Exposure projection allocations exceed one million ppm.",
      );
    }
    const allocatedValues: number[] = [];
    positionMappings.forEach((mapping) => {
      const allocatedValueMinor =
        valueMinor === null || mapping.allocationPpm === null
          ? null
          : multiplyMinorByScalePpm(valueMinor, mapping.allocationPpm);
      if (allocatedValueMinor !== null) {
        allocatedValues.push(allocatedValueMinor);
      }
      const contributions =
        contributionsByExposure.get(mapping.exposureId) ?? [];
      contributions.push({
        positionId: position.id,
        exposureId: mapping.exposureId,
        relationshipKind: mapping.relationshipKind,
        currency: position.currency,
        positionValueMinor: valueMinor,
        allocationPpm: mapping.allocationPpm,
        allocatedValueMinor,
      });
      contributionsByExposure.set(mapping.exposureId, contributions);
    });
    const allocatedValueMinor =
      valueMinor === null ? null : safeMinorSum(allocatedValues);
    return {
      id: position.id,
      legalVehicleName: position.legal_vehicle_name,
      positionKind: position.position_kind,
      currency: position.currency,
      observedAt: IsoTimestampSchema.parse(position.observed_at),
      valueMinor,
      valueState: position.value_state,
      mappedExposureIds: positionMappings.map((mapping) => mapping.exposureId),
      knownAllocationPpm,
      hasUnknownAllocation: positionMappings.some(
        (mapping) => mapping.allocationPpm === null,
      ),
      allocatedValueMinor,
      unallocatedValueMinor:
        valueMinor === null || allocatedValueMinor === null
          ? null
          : NonNegativeMoneyMinorSchema.parse(valueMinor - allocatedValueMinor),
    };
  });

  return {
    positions: projectedPositions,
    exposures: exposures.map((exposure) => {
      const contributions = contributionsByExposure.get(exposure.id) ?? [];
      const totalsByCurrency = new Map<
        string,
        {
          allocatedValues: number[];
          knownValuePositionCount: number;
          unknownValuePositionCount: number;
        }
      >();
      contributions.forEach((contribution) => {
        const total = totalsByCurrency.get(contribution.currency) ?? {
          allocatedValues: [],
          knownValuePositionCount: 0,
          unknownValuePositionCount: 0,
        };
        if (contribution.allocatedValueMinor === null) {
          total.unknownValuePositionCount += 1;
        } else {
          total.allocatedValues.push(contribution.allocatedValueMinor);
          total.knownValuePositionCount += 1;
        }
        totalsByCurrency.set(contribution.currency, total);
      });
      return {
        exposure,
        contributions,
        totals: [...totalsByCurrency.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([currency, total]) => ({
            currency,
            allocatedValueMinor: safeMinorSum(total.allocatedValues),
            knownValuePositionCount: total.knownValuePositionCount,
            unknownValuePositionCount: total.unknownValuePositionCount,
          })),
      };
    }),
  };
}
