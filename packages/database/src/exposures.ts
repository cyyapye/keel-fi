import {
  CanonicalExposureSchema,
  IsoTimestampSchema,
  PositionExposureMappingSchema,
  PrivateExposureExactBatchInputSchema,
  PrivateExposureExactBatchPreviewSchema,
  PrivateExposureExactBatchResultSchema,
  PrivateExposureResolutionInputSchema,
  PrivateExposureResolutionResultSchema,
  PrivateExposureReviewStateSchema,
  ProtectedIdentityKeySchema,
  type CanonicalExposure,
  type PositionExposureMapping,
  type PrivateExposureExactBatchInput,
  type PrivateExposureExactBatchPreview,
  type PrivateExposureExactBatchResult,
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

const RetainedPublicExposureEvidenceInputSchema = z.discriminatedUnion(
  "resolutionStatus",
  [
    z
      .object({
        importRowId: z.string().min(1),
        resolutionStatus: z.literal("strong_identifier"),
        identityKind: z.enum(["cusip", "isin", "sedol"]),
        protectedIdentityKey: ProtectedIdentityKeySchema,
        evidenceSha256: ProtectedIdentityKeySchema,
      })
      .strict(),
    z
      .object({
        importRowId: z.string().min(1),
        resolutionStatus: z.literal("no_strong_identifier"),
        evidenceSha256: ProtectedIdentityKeySchema,
      })
      .strict(),
  ],
);

const RetainedPublicExposureEvidenceInputsSchema = z
  .array(RetainedPublicExposureEvidenceInputSchema)
  .max(500)
  .superRefine((rows, context) => {
    if (new Set(rows.map((row) => row.importRowId)).size !== rows.length) {
      context.addIssue({
        code: "custom",
        message: "Retained public exposure rows must be unique.",
      });
    }
  });

const RetainedProviderExposureEvidenceInputSchema = z.discriminatedUnion(
  "resolutionStatus",
  [
    z
      .object({
        importRowId: z.string().min(1),
        resolutionStatus: z.literal("scoped_identifier"),
        protectedIdentityKey: ProtectedIdentityKeySchema,
        evidenceSha256: ProtectedIdentityKeySchema,
      })
      .strict(),
    z
      .object({
        importRowId: z.string().min(1),
        resolutionStatus: z.literal("not_eligible"),
        evidenceSha256: ProtectedIdentityKeySchema,
      })
      .strict(),
  ],
);

const RetainedProviderExposureEvidenceInputsSchema = z
  .array(RetainedProviderExposureEvidenceInputSchema)
  .max(500)
  .superRefine((rows, context) => {
    if (new Set(rows.map((row) => row.importRowId)).size !== rows.length) {
      context.addIssue({
        code: "custom",
        message: "Provider-scoped exposure rows must be unique.",
      });
    }
  });

const RetainedStructuredAssetExposureEvidenceInputSchema = z.union([
  z
    .object({
      importRowId: z.string().min(1),
      resolutionStatus: z.literal("structured_identifier"),
      identityKind: z.literal("cash_currency"),
      protectedIdentityKey: ProtectedIdentityKeySchema,
      currencyCode: z.literal("USD"),
      evidenceSha256: ProtectedIdentityKeySchema,
    })
    .strict(),
  z
    .object({
      importRowId: z.string().min(1),
      resolutionStatus: z.literal("structured_identifier"),
      identityKind: z.literal("provider_crypto"),
      protectedIdentityKey: ProtectedIdentityKeySchema,
      currencyCode: z.null(),
      evidenceSha256: ProtectedIdentityKeySchema,
    })
    .strict(),
  z
    .object({
      importRowId: z.string().min(1),
      resolutionStatus: z.literal("not_eligible"),
      evidenceSha256: ProtectedIdentityKeySchema,
    })
    .strict(),
]);

const RetainedStructuredAssetExposureEvidenceInputsSchema = z
  .array(RetainedStructuredAssetExposureEvidenceInputSchema)
  .max(500)
  .superRefine((rows, context) => {
    if (new Set(rows.map((row) => row.importRowId)).size !== rows.length) {
      context.addIssue({
        code: "custom",
        message: "Structured asset exposure rows must be unique.",
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
  public_exposure_identity_kind:
    | "cusip"
    | "isin"
    | "sedol"
    | "provider_security"
    | "cash_currency"
    | "provider_crypto";
  protected_exposure_key: string;
  evidence_sha256: string;
  effective_at: string;
};

type RetainedPublicExposureDocumentRow = {
  import_id: string;
  object_key: string;
  byte_size: number;
  evidence_sha256: string;
  import_row_id: string;
  source_row_number: number;
};

type RetainedPublicExposureEvidenceRow = {
  import_row_id: string;
  resolution_status: "strong_identifier" | "no_strong_identifier";
  identity_kind: "cusip" | "isin" | "sedol" | null;
  protected_identity_key: string | null;
  evidence_sha256: string;
};

type RetainedProviderExposureEvidenceRow = {
  import_row_id: string;
  resolution_status: "scoped_identifier" | "not_eligible";
  protected_identity_key: string | null;
  evidence_sha256: string;
};

type RetainedStructuredAssetExposureEvidenceRow = {
  import_row_id: string;
  resolution_status: "structured_identifier" | "not_eligible";
  identity_kind: "cash_currency" | "provider_crypto" | null;
  protected_identity_key: string | null;
  currency_code: "USD" | null;
  evidence_sha256: string;
};

export type RetainedPublicExposureDocument = {
  readonly importId: string;
  readonly objectKey: string;
  readonly byteSize: number;
  readonly evidenceSha256: string;
  readonly rows: readonly {
    readonly importRowId: string;
    readonly sourceRowNumber: number;
  }[];
};

export type RetainedPublicExposureEvidenceInput = z.infer<
  typeof RetainedPublicExposureEvidenceInputSchema
>;

export type RetainedProviderExposureEvidenceInput = z.infer<
  typeof RetainedProviderExposureEvidenceInputSchema
>;

export type RetainedStructuredAssetExposureEvidenceInput = z.infer<
  typeof RetainedStructuredAssetExposureEvidenceInputSchema
>;

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

type PrivateExposureExactBatchRow = PrivateExposureReviewEvidenceRow & {
  provider: string;
  reported_exposure_count: number;
};

type CurrentExposureMappingRow = PositionExposureMappingRow & {
  exposure_kind:
    "public_instrument" | "private_company" | "fund" | "unresolved";
};

export type PrivateExposureReviewErrorCode =
  | "already_resolved"
  | "company_conflict"
  | "invalid_company"
  | "no_matches"
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
  applyPrivateExposureExactBatch(
    accessSubject: string,
    input: PrivateExposureExactBatchInput,
  ): Promise<PrivateExposureExactBatchResult>;
}

type PrivateExposureExactBatchGroup = {
  key: string;
  company: PrivateExposureCompanyRow | null;
  companyName: string;
  positions: PrivateExposureExactBatchRow[];
};

type PrivateExposureExactBatchPlan = {
  groups: PrivateExposureExactBatchGroup[];
  preview: PrivateExposureExactBatchPreview;
};

function exactCompanyKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

function exactCompanyName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
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

async function buildPrivateExposureExactBatchPlan(
  positions: readonly PrivateExposureExactBatchRow[],
  companies: readonly PrivateExposureCompanyRow[],
): Promise<PrivateExposureExactBatchPlan> {
  const companiesByKey = new Map<string, PrivateExposureCompanyRow[]>();
  for (const company of companies) {
    const key = exactCompanyKey(company.legal_name);
    const matches = companiesByKey.get(key) ?? [];
    matches.push(company);
    companiesByKey.set(key, matches);
  }

  const groupsByKey = new Map<string, PrivateExposureExactBatchGroup>();
  for (const position of positions) {
    if (
      position.reported_exposure_name === null ||
      position.reported_exposure_count !== 1
    ) {
      continue;
    }
    const companyName = exactCompanyName(position.reported_exposure_name);
    const key = exactCompanyKey(companyName);
    if (
      position.position_kind === "spv_interest" &&
      key === exactCompanyKey(position.legal_vehicle_name)
    ) {
      continue;
    }
    const companyMatches = companiesByKey.get(key) ?? [];
    if (companyMatches.length > 1) {
      continue;
    }
    const group = groupsByKey.get(key) ?? {
      key,
      company: companyMatches[0] ?? null,
      companyName,
      positions: [],
    };
    group.positions.push(position);
    groupsByKey.set(key, group);
  }

  const groups = [...groupsByKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  const positionCount = groups.reduce(
    (count, group) => count + group.positions.length,
    0,
  );
  const revision = await sha256(
    JSON.stringify({
      version: 1,
      positions: positions.map((position) => [
        position.position_id,
        position.snapshot_id,
        position.legal_vehicle_name,
        position.reported_exposure_name,
        position.reported_exposure_count,
        position.position_kind,
      ]),
      companies: companies.map((company) => [company.id, company.legal_name]),
    }),
  );
  const existingCompanyCount = groups.filter(
    (group) => group.company !== null,
  ).length;
  return {
    groups,
    preview: PrivateExposureExactBatchPreviewSchema.parse({
      revision,
      positionCount,
      companyCount: groups.length,
      existingCompanyCount,
      newCompanyCount: groups.length - existingCompanyCount,
      excludedPositionCount: positions.length - positionCount,
    }),
  };
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

type PrivateExposureAssignmentOptions = {
  allowCompanyCreation: boolean;
  decisionReference: string;
  decisionSource: "deterministic_policy" | "review";
};

type PrivateExposureAssignmentResult = {
  assignedPositionCount: number;
  companyCount: number;
  createdCompanyCount: number;
  existingCompanyCount: number;
};

async function applyPrivateExposureGroups(
  db: D1Database,
  identity: HouseholdIdentity,
  groups: readonly PrivateExposureExactBatchGroup[],
  options: PrivateExposureAssignmentOptions,
): Promise<PrivateExposureAssignmentResult> {
  if (groups.length === 0) {
    return {
      assignedPositionCount: 0,
      companyCount: 0,
      createdCompanyCount: 0,
      existingCompanyCount: 0,
    };
  }

  const candidatePositionIds = new Set(
    groups.flatMap((group) =>
      group.positions.map((position) => position.position_id),
    ),
  );
  const [existingExposures, allCurrentMappings] = await Promise.all([
    all<CanonicalExposureRow>(
      db
        .prepare(
          `SELECT
             id, household_id, exposure_kind, canonical_name,
             protected_identity_key, company_id, resolution_method,
             evidence_sha256, created_at
           FROM canonical_exposures
           WHERE household_id = ? AND company_id IS NOT NULL
           ORDER BY company_id, id`,
        )
        .bind(identity.household_id),
    ),
    all<CurrentExposureMappingRow>(
      db
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
  const exposuresByCompanyId = new Map(
    existingExposures.flatMap((exposure) =>
      exposure.company_id === null ? [] : [[exposure.company_id, exposure]],
    ),
  );
  const mappingsByPositionId = new Map<string, CurrentExposureMappingRow[]>();
  for (const mapping of allCurrentMappings) {
    if (!candidatePositionIds.has(mapping.position_id)) {
      continue;
    }
    const mappings = mappingsByPositionId.get(mapping.position_id) ?? [];
    mappings.push(mapping);
    mappingsByPositionId.set(mapping.position_id, mappings);
  }
  if (
    [...mappingsByPositionId.values()].some((mappings) =>
      mappings.some(
        (mapping) =>
          mapping.status === "active" && mapping.exposure_kind !== "unresolved",
      ),
    )
  ) {
    throw new PrivateExposureReviewError(
      "stale",
      "An exact company assignment is no longer unresolved.",
    );
  }

  const acceptedAt = new Date().toISOString();
  const companyRows: Array<Record<string, unknown>> = [];
  const exposureRows: Array<Record<string, unknown>> = [];
  const mappingRows: Array<Record<string, unknown>> = [];
  const assignedCompanyIds = new Set<string>();
  let assignedPositionCount = 0;
  let createdCompanyCount = 0;

  for (const group of groups) {
    if (group.company === null && !options.allowCompanyCreation) {
      continue;
    }
    const companyId = group.company?.id ?? crypto.randomUUID();
    if (group.company === null) {
      companyRows.push({
        id: companyId,
        householdId: identity.household_id,
        legalName: group.companyName,
        createdAt: acceptedAt,
      });
      createdCompanyCount += 1;
    }
    const existingExposure = exposuresByCompanyId.get(companyId);
    const exposureId = existingExposure?.id ?? crypto.randomUUID();
    if (existingExposure === undefined) {
      exposureRows.push({
        id: exposureId,
        householdId: identity.household_id,
        canonicalName: group.company?.legal_name ?? group.companyName,
        companyId,
        evidenceSha256: group.positions[0]!.evidence_sha256,
        createdByUserId: identity.user_id,
        createdAt: acceptedAt,
      });
    }

    for (const position of group.positions) {
      const currentMappings =
        mappingsByPositionId.get(position.position_id) ?? [];
      const currentTarget = currentMappings.find(
        (mapping) => mapping.exposure_id === exposureId,
      );
      if (
        options.decisionSource === "deterministic_policy" &&
        currentTarget?.status === "withdrawn"
      ) {
        continue;
      }
      for (const mapping of currentMappings.filter(
        (candidate) =>
          candidate.status === "active" &&
          candidate.exposure_kind === "unresolved",
      )) {
        mappingRows.push({
          id: crypto.randomUUID(),
          householdId: identity.household_id,
          positionId: position.position_id,
          exposureId: mapping.exposure_id,
          relationshipKind: mapping.relationship_kind,
          allocationPpm: null,
          status: "withdrawn",
          decisionSource: options.decisionSource,
          decisionReference: options.decisionReference,
          evidenceSha256: position.evidence_sha256,
          effectiveAt:
            mapping.effective_at > acceptedAt
              ? mapping.effective_at
              : acceptedAt,
          version: mapping.version + 1,
          supersedesMappingId: mapping.id,
          acceptedByUserId: identity.user_id,
          acceptedAt,
        });
      }

      mappingRows.push({
        id: crypto.randomUUID(),
        householdId: identity.household_id,
        positionId: position.position_id,
        exposureId,
        relationshipKind:
          position.position_kind === "direct" ? "direct" : "look_through",
        allocationPpm: 1_000_000,
        status: "active",
        decisionSource: options.decisionSource,
        decisionReference: options.decisionReference,
        evidenceSha256: position.evidence_sha256,
        effectiveAt:
          currentTarget !== undefined && currentTarget.effective_at > acceptedAt
            ? currentTarget.effective_at
            : acceptedAt,
        version: (currentTarget?.version ?? 0) + 1,
        supersedesMappingId: currentTarget?.id ?? null,
        acceptedByUserId: identity.user_id,
        acceptedAt,
      });
      assignedCompanyIds.add(companyId);
      assignedPositionCount += 1;
    }
  }

  const statements: D1PreparedStatement[] = [];
  if (companyRows.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO companies (
             id, household_id, legal_name, website_host, status,
             created_at, updated_at
           )
           SELECT
             json_extract(value, '$.id'),
             json_extract(value, '$.householdId'),
             json_extract(value, '$.legalName'),
             NULL,
             'active',
             json_extract(value, '$.createdAt'),
             json_extract(value, '$.createdAt')
           FROM json_each(?)`,
        )
        .bind(JSON.stringify(companyRows)),
    );
  }
  if (exposureRows.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO canonical_exposures (
             id, household_id, exposure_kind, canonical_name,
             protected_identity_key, company_id, resolution_method,
             evidence_sha256, created_by_user_id, created_at, immutable
           )
           SELECT
             json_extract(value, '$.id'),
             json_extract(value, '$.householdId'),
             'private_company',
             json_extract(value, '$.canonicalName'),
             NULL,
             json_extract(value, '$.companyId'),
             'reviewed_company',
             json_extract(value, '$.evidenceSha256'),
             json_extract(value, '$.createdByUserId'),
             json_extract(value, '$.createdAt'),
             1
           FROM json_each(?)`,
        )
        .bind(JSON.stringify(exposureRows)),
    );
  }
  if (mappingRows.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO holding_position_exposure_mappings (
             id, household_id, position_id, exposure_id, relationship_kind,
             allocation_ppm, status, decision_source, decision_reference,
             evidence_sha256, effective_at, version, supersedes_mapping_id,
             accepted_by_user_id, accepted_at, immutable
           )
           SELECT
             json_extract(value, '$.id'),
             json_extract(value, '$.householdId'),
             json_extract(value, '$.positionId'),
             json_extract(value, '$.exposureId'),
             json_extract(value, '$.relationshipKind'),
             CAST(json_extract(value, '$.allocationPpm') AS INTEGER),
             json_extract(value, '$.status'),
             json_extract(value, '$.decisionSource'),
             json_extract(value, '$.decisionReference'),
             json_extract(value, '$.evidenceSha256'),
             json_extract(value, '$.effectiveAt'),
             CAST(json_extract(value, '$.version') AS INTEGER),
             json_extract(value, '$.supersedesMappingId'),
             json_extract(value, '$.acceptedByUserId'),
             json_extract(value, '$.acceptedAt'),
             1
           FROM json_each(?)`,
        )
        .bind(JSON.stringify(mappingRows)),
    );
  }

  try {
    if (statements.length > 0) {
      await db.batch(statements);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new PrivateExposureReviewError(
        "stale",
        "The exact company assignments are no longer current.",
      );
    }
    throw error;
  }

  return {
    assignedPositionCount,
    companyCount: assignedCompanyIds.size,
    existingCompanyCount: assignedCompanyIds.size - createdCompanyCount,
    createdCompanyCount,
  };
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
    const { positions, companies } = await this.loadPrivateExposureReviewData(
      identity.household_id,
    );
    const exactBatch = await buildPrivateExposureExactBatchPlan(
      positions,
      companies,
    );

    return PrivateExposureReviewStateSchema.parse({
      version: 2,
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
      exactBatch: exactBatch.preview,
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
           AND (
             position.position_kind = 'spv_interest'
             OR (
               position.provider IN ('angellist', 'tokenfolio', 'sydecar')
               AND position.position_kind = 'direct'
             )
           )`,
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

  public async applyPrivateExposureExactBatch(
    accessSubject: string,
    rawInput: PrivateExposureExactBatchInput,
  ): Promise<PrivateExposureExactBatchResult> {
    const input = PrivateExposureExactBatchInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const { positions, companies } = await this.loadPrivateExposureReviewData(
      identity.household_id,
    );
    const plan = await buildPrivateExposureExactBatchPlan(positions, companies);
    if (plan.preview.revision !== input.expectedRevision) {
      throw new PrivateExposureReviewError(
        "stale",
        "The exact company assignments changed before review.",
      );
    }
    if (plan.preview.positionCount === 0) {
      throw new PrivateExposureReviewError(
        "no_matches",
        "No exact company assignments are ready.",
      );
    }

    await applyPrivateExposureGroups(this.db, identity, plan.groups, {
      allowCompanyCreation: true,
      decisionReference: `Reviewed exact company batch ${plan.preview.revision.slice(0, 12)}`,
      decisionSource: "review",
    });

    return PrivateExposureExactBatchResultSchema.parse({
      version: 1,
      assignedPositionCount: plan.preview.positionCount,
      companyCount: plan.preview.companyCount,
      existingCompanyCount: plan.preview.existingCompanyCount,
      createdCompanyCount: plan.preview.newCompanyCount,
      remainingPositionCount: plan.preview.excludedPositionCount,
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

  public async reconcileAcceptedImportExposures(
    accessSubject: string,
    importId: string,
  ): Promise<void> {
    await this.reconcileAcceptedPublicExposureRows(accessSubject, importId);
    await this.reconcileAcceptedPrivateExposureRows(accessSubject, importId);
    await this.reconcileRetainedPositionContinuity(accessSubject);
  }

  public async listRetainedPublicExposureDocuments(
    accessSubject: string,
  ): Promise<readonly RetainedPublicExposureDocument[]> {
    const identity = await this.findIdentity(accessSubject);
    const rows = await all<RetainedPublicExposureDocumentRow>(
      this.db
        .prepare(
          `SELECT
             import.id AS import_id,
             document.object_key,
             document.byte_size,
             document.sha256 AS evidence_sha256,
             row.id AS import_row_id,
             row.source_row_number
           FROM holding_import_rows row
           JOIN holding_imports import ON import.id = row.import_id
           JOIN source_documents document
             ON document.id = import.source_document_id
           WHERE import.household_id = ?
             AND import.provider IN ('robinhood', 'plaid_investments')
             AND row.position_kind = 'direct'
             AND row.public_exposure_identity_kind IS NULL
             AND row.protected_exposure_key IS NULL
             AND EXISTS (
               SELECT 1
               FROM holding_import_applications application
               WHERE application.import_row_id = row.id
             )
             AND NOT EXISTS (
               SELECT 1
               FROM holding_import_row_public_exposure_evidence evidence
               WHERE evidence.import_row_id = row.id
                 AND evidence.resolution_status = 'strong_identifier'
             )
             AND (
               NOT EXISTS (
                 SELECT 1
                 FROM holding_import_row_provider_exposure_evidence evidence
                 WHERE evidence.import_row_id = row.id
               )
               OR (
                 EXISTS (
                   SELECT 1
                   FROM holding_import_row_provider_exposure_evidence evidence
                   WHERE evidence.import_row_id = row.id
                     AND evidence.resolution_status = 'not_eligible'
                 )
                 AND NOT EXISTS (
                   SELECT 1
                   FROM holding_import_row_structured_asset_exposure_evidence
                     structured_evidence
                   WHERE structured_evidence.import_row_id = row.id
                 )
               )
             )
           ORDER BY import.created_at, import.id, row.source_row_number
           LIMIT 500`,
        )
        .bind(identity.household_id),
    );

    const documents = new Map<
      string,
      Omit<RetainedPublicExposureDocument, "rows"> & {
        rows: Array<RetainedPublicExposureDocument["rows"][number]>;
      }
    >();
    for (const row of rows) {
      const existing = documents.get(row.import_id);
      if (existing === undefined) {
        documents.set(row.import_id, {
          importId: row.import_id,
          objectKey: row.object_key,
          byteSize: row.byte_size,
          evidenceSha256: row.evidence_sha256,
          rows: [
            {
              importRowId: row.import_row_id,
              sourceRowNumber: row.source_row_number,
            },
          ],
        });
        continue;
      }
      if (
        existing.objectKey !== row.object_key ||
        existing.byteSize !== row.byte_size ||
        existing.evidenceSha256 !== row.evidence_sha256
      ) {
        throw new Error("Retained public exposure document changed identity.");
      }
      existing.rows.push({
        importRowId: row.import_row_id,
        sourceRowNumber: row.source_row_number,
      });
    }
    return [...documents.values()];
  }

  public async recordRetainedPublicExposureEvidence(
    accessSubject: string,
    rawInputs: readonly RetainedPublicExposureEvidenceInput[],
  ): Promise<void> {
    const inputs = RetainedPublicExposureEvidenceInputsSchema.parse(rawInputs);
    if (inputs.length === 0) {
      return;
    }
    const identity = await this.findIdentity(accessSubject);
    const rowIds = inputs.map((input) => input.importRowId);
    const existing = await all<RetainedPublicExposureEvidenceRow>(
      this.db
        .prepare(
          `SELECT
             import_row_id, resolution_status, identity_kind,
             protected_identity_key, evidence_sha256
           FROM holding_import_row_public_exposure_evidence
           WHERE household_id = ?
             AND import_row_id IN (
               SELECT CAST(value AS TEXT) FROM json_each(?)
             )`,
        )
        .bind(identity.household_id, JSON.stringify(rowIds)),
    );
    const existingByRowId = new Map(
      existing.map((row) => [row.import_row_id, row]),
    );
    for (const input of inputs) {
      const prior = existingByRowId.get(input.importRowId);
      const identityKind =
        input.resolutionStatus === "strong_identifier"
          ? input.identityKind
          : null;
      const protectedIdentityKey =
        input.resolutionStatus === "strong_identifier"
          ? input.protectedIdentityKey
          : null;
      if (
        prior !== undefined &&
        (prior.resolution_status !== input.resolutionStatus ||
          prior.identity_kind !== identityKind ||
          prior.protected_identity_key !== protectedIdentityKey ||
          prior.evidence_sha256 !== input.evidenceSha256)
      ) {
        throw new Error("Retained public exposure evidence changed.");
      }
    }
    const createdAt = new Date().toISOString();
    const statements = inputs
      .filter((input) => !existingByRowId.has(input.importRowId))
      .map((input) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO holding_import_row_public_exposure_evidence (
               id, household_id, import_row_id, resolution_status,
               identity_kind, protected_identity_key, evidence_sha256,
               derivation_method, created_by_user_id, created_at, immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'retained_source_document', ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            input.importRowId,
            input.resolutionStatus,
            input.resolutionStatus === "strong_identifier"
              ? input.identityKind
              : null,
            input.resolutionStatus === "strong_identifier"
              ? input.protectedIdentityKey
              : null,
            input.evidenceSha256,
            identity.user_id,
            createdAt,
          ),
      );
    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  public async recordRetainedProviderExposureEvidence(
    accessSubject: string,
    rawInputs: readonly RetainedProviderExposureEvidenceInput[],
  ): Promise<void> {
    const inputs =
      RetainedProviderExposureEvidenceInputsSchema.parse(rawInputs);
    if (inputs.length === 0) {
      return;
    }
    const identity = await this.findIdentity(accessSubject);
    const rowIds = inputs.map((input) => input.importRowId);
    const existing = await all<RetainedProviderExposureEvidenceRow>(
      this.db
        .prepare(
          `SELECT
             import_row_id, resolution_status, protected_identity_key,
             evidence_sha256
           FROM holding_import_row_provider_exposure_evidence
           WHERE household_id = ?
             AND import_row_id IN (
               SELECT CAST(value AS TEXT) FROM json_each(?)
             )`,
        )
        .bind(identity.household_id, JSON.stringify(rowIds)),
    );
    const existingByRowId = new Map(
      existing.map((row) => [row.import_row_id, row]),
    );
    for (const input of inputs) {
      const prior = existingByRowId.get(input.importRowId);
      const protectedIdentityKey =
        input.resolutionStatus === "scoped_identifier"
          ? input.protectedIdentityKey
          : null;
      if (
        prior !== undefined &&
        (prior.resolution_status !== input.resolutionStatus ||
          prior.protected_identity_key !== protectedIdentityKey ||
          prior.evidence_sha256 !== input.evidenceSha256)
      ) {
        throw new Error("Provider-scoped exposure evidence changed.");
      }
    }
    const createdAt = new Date().toISOString();
    const statements = inputs
      .filter((input) => !existingByRowId.has(input.importRowId))
      .map((input) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO holding_import_row_provider_exposure_evidence (
               id, household_id, import_row_id, resolution_status,
               protected_identity_key, evidence_sha256, derivation_method,
               created_by_user_id, created_at, immutable
             ) VALUES (?, ?, ?, ?, ?, ?,
               'retained_source_provider_security_v1', ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            input.importRowId,
            input.resolutionStatus,
            input.resolutionStatus === "scoped_identifier"
              ? input.protectedIdentityKey
              : null,
            input.evidenceSha256,
            identity.user_id,
            createdAt,
          ),
      );
    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  public async recordRetainedStructuredAssetExposureEvidence(
    accessSubject: string,
    rawInputs: readonly RetainedStructuredAssetExposureEvidenceInput[],
  ): Promise<void> {
    const inputs =
      RetainedStructuredAssetExposureEvidenceInputsSchema.parse(rawInputs);
    if (inputs.length === 0) {
      return;
    }
    const identity = await this.findIdentity(accessSubject);
    const rowIds = inputs.map((input) => input.importRowId);
    const existing = await all<RetainedStructuredAssetExposureEvidenceRow>(
      this.db
        .prepare(
          `SELECT
             import_row_id, resolution_status, identity_kind,
             protected_identity_key, currency_code, evidence_sha256
           FROM holding_import_row_structured_asset_exposure_evidence
           WHERE household_id = ?
             AND import_row_id IN (
               SELECT CAST(value AS TEXT) FROM json_each(?)
             )`,
        )
        .bind(identity.household_id, JSON.stringify(rowIds)),
    );
    const existingByRowId = new Map(
      existing.map((row) => [row.import_row_id, row]),
    );
    for (const input of inputs) {
      const prior = existingByRowId.get(input.importRowId);
      const identityKind =
        input.resolutionStatus === "structured_identifier"
          ? input.identityKind
          : null;
      const protectedIdentityKey =
        input.resolutionStatus === "structured_identifier"
          ? input.protectedIdentityKey
          : null;
      const currencyCode =
        input.resolutionStatus === "structured_identifier"
          ? input.currencyCode
          : null;
      if (
        prior !== undefined &&
        (prior.resolution_status !== input.resolutionStatus ||
          prior.identity_kind !== identityKind ||
          prior.protected_identity_key !== protectedIdentityKey ||
          prior.currency_code !== currencyCode ||
          prior.evidence_sha256 !== input.evidenceSha256)
      ) {
        throw new Error("Structured asset exposure evidence changed.");
      }
    }
    const createdAt = new Date().toISOString();
    const statements = inputs
      .filter((input) => !existingByRowId.has(input.importRowId))
      .map((input) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO
               holding_import_row_structured_asset_exposure_evidence (
                 id, household_id, import_row_id, resolution_status,
                 identity_kind, protected_identity_key, currency_code,
                 evidence_sha256, derivation_method, created_by_user_id,
                 created_at, immutable
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,
                 'retained_source_structured_asset_v1', ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            input.importRowId,
            input.resolutionStatus,
            input.resolutionStatus === "structured_identifier"
              ? input.identityKind
              : null,
            input.resolutionStatus === "structured_identifier"
              ? input.protectedIdentityKey
              : null,
            input.resolutionStatus === "structured_identifier"
              ? input.currencyCode
              : null,
            input.evidenceSha256,
            identity.user_id,
            createdAt,
          ),
      );
    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  public async reconcileAcceptedPublicExposureHistory(
    accessSubject: string,
  ): Promise<void> {
    await this.reconcileAcceptedPublicExposureRows(accessSubject, null);
    await this.reconcileRetainedPositionContinuity(accessSubject);
  }

  public async reconcileRetainedPositionContinuity(
    accessSubject: string,
  ): Promise<void> {
    const identity = await this.findIdentity(accessSubject);
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO holding_position_continuities (
           id, household_id, predecessor_position_id, predecessor_snapshot_id,
           successor_position_id, successor_snapshot_id, resolution_method,
           recorded_by_user_id, recorded_at, immutable
         )
         SELECT
           'holding-position-continuity-v1:' ||
             candidate.predecessor_position_id || ':' ||
             candidate.successor_position_id,
           candidate.household_id,
           candidate.predecessor_position_id,
           candidate.predecessor_snapshot_id,
           candidate.successor_position_id,
           candidate.successor_snapshot_id,
           'exact_reconnect_snapshot_v1',
           ?,
           candidate.recorded_at,
           1
         FROM holding_position_continuity_candidates_v1 candidate
         WHERE candidate.household_id = ?`,
      )
      .bind(identity.user_id, identity.household_id)
      .run();
  }

  private async reconcileAcceptedPublicExposureRows(
    accessSubject: string,
    importId: string | null,
  ): Promise<void> {
    const identity = await this.findIdentity(accessSubject);
    const rows = await all<DeterministicPublicRow>(
      this.db
        .prepare(
          `SELECT
             application.position_id,
             CASE
               WHEN structured.identity_kind = 'cash_currency'
               THEN 'US Dollar'
               ELSE row.legal_vehicle_name
             END AS canonical_name,
             COALESCE(
               row.public_exposure_identity_kind,
               retained.identity_kind,
               CASE
                 WHEN provider_scoped.protected_identity_key IS NOT NULL
                 THEN 'provider_security'
               END,
               structured.identity_kind
             ) AS public_exposure_identity_kind,
             COALESCE(
               row.protected_exposure_key,
               retained.protected_identity_key,
               provider_scoped.protected_identity_key,
               structured.protected_identity_key
             ) AS protected_exposure_key,
             document.sha256 AS evidence_sha256,
             CASE
               WHEN document.effective_date IS NULL THEN document.retrieved_at
               ELSE document.effective_date || 'T00:00:00.000Z'
             END AS effective_at
           FROM holding_import_applications application
           JOIN holding_import_rows row ON row.id = application.import_row_id
           JOIN holding_imports import ON import.id = row.import_id
           JOIN source_documents document
             ON document.id = import.source_document_id
           JOIN holding_positions position
             ON position.id = application.position_id
           LEFT JOIN holding_import_row_public_exposure_evidence retained
             ON retained.import_row_id = row.id
            AND retained.resolution_status = 'strong_identifier'
           LEFT JOIN holding_import_row_provider_exposure_evidence
             provider_scoped
             ON provider_scoped.import_row_id = row.id
            AND provider_scoped.resolution_status = 'scoped_identifier'
           LEFT JOIN holding_import_row_structured_asset_exposure_evidence
             structured
             ON structured.import_row_id = row.id
            AND structured.resolution_status = 'structured_identifier'
           WHERE import.household_id = ?
             AND (? IS NULL OR import.id = ?)
             AND position.position_kind = 'direct'
             AND COALESCE(
               row.public_exposure_identity_kind,
               retained.identity_kind,
               CASE
                 WHEN provider_scoped.protected_identity_key IS NOT NULL
                 THEN 'provider_security'
               END,
               structured.identity_kind
             ) IS NOT NULL
             AND COALESCE(
               row.protected_exposure_key,
               retained.protected_identity_key,
               provider_scoped.protected_identity_key,
               structured.protected_identity_key
             ) IS NOT NULL
             AND application.id = (
               SELECT latest_application.id
               FROM holding_import_applications latest_application
               JOIN holding_import_rows latest_row
                 ON latest_row.id = latest_application.import_row_id
               JOIN holding_imports latest_import
                 ON latest_import.id = latest_row.import_id
               LEFT JOIN holding_import_row_public_exposure_evidence
                 latest_retained
                 ON latest_retained.import_row_id = latest_row.id
                AND latest_retained.resolution_status = 'strong_identifier'
               LEFT JOIN holding_import_row_provider_exposure_evidence
                 latest_provider_scoped
                 ON latest_provider_scoped.import_row_id = latest_row.id
                AND latest_provider_scoped.resolution_status = 'scoped_identifier'
               LEFT JOIN holding_import_row_structured_asset_exposure_evidence
                 latest_structured
                 ON latest_structured.import_row_id = latest_row.id
                AND latest_structured.resolution_status = 'structured_identifier'
               WHERE latest_application.position_id = application.position_id
                 AND latest_import.household_id = import.household_id
                 AND (? IS NULL OR latest_import.id = ?)
                 AND COALESCE(
                   latest_row.public_exposure_identity_kind,
                   latest_retained.identity_kind,
                   CASE
                     WHEN latest_provider_scoped.protected_identity_key IS NOT NULL
                     THEN 'provider_security'
                   END,
                   latest_structured.identity_kind
                 ) IS NOT NULL
                 AND COALESCE(
                   latest_row.protected_exposure_key,
                   latest_retained.protected_identity_key,
                   latest_provider_scoped.protected_identity_key,
                   latest_structured.protected_identity_key
                 ) IS NOT NULL
               ORDER BY
                 latest_application.applied_at DESC,
                 latest_application.id DESC
               LIMIT 1
             )
             AND NOT EXISTS (
               SELECT 1
               FROM holding_position_exposure_mappings mapping
               JOIN canonical_exposures exposure
                 ON exposure.id = mapping.exposure_id
               WHERE mapping.position_id = application.position_id
                 AND mapping.status = 'active'
                 AND exposure.exposure_kind <> 'unresolved'
                 AND NOT EXISTS (
                   SELECT 1
                   FROM holding_position_exposure_mappings later
                   WHERE later.supersedes_mapping_id = mapping.id
                 )
             )
           ORDER BY application.applied_at, row.source_row_number`,
        )
        .bind(identity.household_id, importId, importId, importId, importId),
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
        decisionReference:
          row.public_exposure_identity_kind === "cash_currency"
            ? "cash-currency-v1:USD"
            : row.public_exposure_identity_kind === "provider_crypto"
              ? "public-provider-crypto-v1"
              : row.public_exposure_identity_kind === "provider_security"
                ? "public-provider-security-v1"
                : `public-strong-identifier-v1:${row.public_exposure_identity_kind}`,
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

  private async reconcileAcceptedPrivateExposureRows(
    accessSubject: string,
    importId: string | null,
  ): Promise<void> {
    const identity = await this.findIdentity(accessSubject);
    const { positions, companies } = await this.loadPrivateExposureReviewData(
      identity.household_id,
      importId,
    );
    const plan = await buildPrivateExposureExactBatchPlan(
      positions.filter(
        (position) =>
          position.provider === "angellist" ||
          position.provider === "tokenfolio" ||
          position.provider === "sydecar",
      ),
      companies,
    );
    await applyPrivateExposureGroups(
      this.db,
      identity,
      plan.groups.filter((group) => group.company !== null),
      {
        allowCompanyCreation: false,
        decisionReference: "private-company-exact-reviewed-v1",
        decisionSource: "deterministic_policy",
      },
    );
  }

  private async loadPrivateExposureReviewData(
    householdId: string,
    importId: string | null = null,
  ): Promise<{
    positions: PrivateExposureExactBatchRow[];
    companies: PrivateExposureCompanyRow[];
  }> {
    const [positions, companies] = await Promise.all([
      all<PrivateExposureExactBatchRow>(
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
                   AND reported.exposure_label IS NOT NULL
                 ORDER BY reported.created_at, reported.id
                 LIMIT 1
               ) AS reported_exposure_name,
               (
                 SELECT COUNT(*)
                 FROM holding_position_exposures reported_count
                 WHERE reported_count.position_id = position.id
                   AND reported_count.exposure_label IS NOT NULL
               ) AS reported_exposure_count,
               position.position_kind,
               position.provider,
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
             JOIN holding_import_rows applied_row
               ON applied_row.id = application.import_row_id
             JOIN holding_position_snapshots snapshot
               ON snapshot.id = application.snapshot_id
              AND snapshot.position_id = position.id
             JOIN source_documents document
               ON document.id = snapshot.source_document_id
             WHERE position.household_id = ?
               AND (? IS NULL OR applied_row.import_id = ?)
               AND (
                 position.position_kind = 'spv_interest'
                 OR (
                   position.provider IN ('angellist', 'tokenfolio', 'sydecar')
                   AND position.position_kind = 'direct'
                 )
               )
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
          .bind(householdId, importId, importId),
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
          .bind(householdId),
      ),
    ]);
    return { positions, companies };
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
