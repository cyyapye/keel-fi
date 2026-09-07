import {
  isPlaidInvestmentsFiPlanningSecurityType,
  isPlaidInvestmentsOutsideFiSecurityType,
  PLAID_INVESTMENTS_CRYPTO_OUTSIDE_FI_ISSUE,
  PlaidInvestmentHoldingRowSchema,
  PrivateInvestmentImportRowSchema,
  type PrivateInvestmentImportRow,
  type PlaidInvestmentHoldingRow,
} from "@keel/connectors";
import {
  HoldingImportApplyInputSchema,
  HoldingImportCanonicalScopeSchema,
  HoldingImportProviderSchema,
  HoldingImportSummariesSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  type HoldingImportApplyInput,
  type HoldingImportApplyResult,
  type HoldingImportCanonicalScope,
  type HoldingImportPreview,
  type HoldingImportRowPreview,
  type HoldingImportSummary,
} from "@keel/domain";
import { z } from "zod";

import { D1ExposureRepository } from "./exposures";

const MAX_IMPORT_BYTES = 1_048_576;
const MAX_IMPORT_ROWS = 500;
const ANGELLIST_PROVIDER = "angellist";
const ANGELLIST_PARSER_SCHEMA = "angellist_investments_v2";
const ANGELLIST_SOURCE_LABEL = "AngelList export";
const ANGELLIST_ECONOMICS_DERIVATION = "angellist_export_carry_v1";
const TOKENFOLIO_PROVIDER = "tokenfolio";
const TOKENFOLIO_PARSER_SCHEMA = "tokenfolio_keel_template_v1";
const TOKENFOLIO_SOURCE_LABEL = "Tokenfolio template";
const SYDECAR_PROVIDER = "sydecar";
const SYDECAR_PARSER_SCHEMA_V1 = "sydecar_keel_template_v1";
const SYDECAR_PARSER_SCHEMA_V2 = "sydecar_keel_template_v2";
const SYDECAR_SOURCE_LABEL = "Sydecar template";
const SYDECAR_ECONOMICS_DERIVATION = "sydecar_template_economics_v1";
const PLAID_INVESTMENTS_PROVIDER = "plaid_investments";
const PLAID_INVESTMENTS_PARSER_SCHEMA = "plaid_investments_holdings_v1";
const PLAID_INVESTMENTS_SOURCE_LABEL = "Plaid Investments";
export const PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION =
  "plaid-investments-holdings-auto-v3";
const NON_BLOCKING_PLAID_INVESTMENTS_ISSUES = new Set([
  "Cost basis is unavailable.",
  PLAID_INVESTMENTS_CRYPTO_OUTSIDE_FI_ISSUE,
]);

const PrivateHoldingImportProviderSchema = z.enum([
  ANGELLIST_PROVIDER,
  TOKENFOLIO_PROVIDER,
  SYDECAR_PROVIDER,
]);
type PrivateHoldingImportProvider = z.output<
  typeof PrivateHoldingImportProviderSchema
>;

const PRIVATE_HOLDING_IMPORT_METADATA = {
  [ANGELLIST_PROVIDER]: {
    fileName: "angellist-investments.csv",
    parserSchema: ANGELLIST_PARSER_SCHEMA,
    sourceLabel: ANGELLIST_SOURCE_LABEL,
  },
  [TOKENFOLIO_PROVIDER]: {
    fileName: "tokenfolio-holdings.csv",
    parserSchema: TOKENFOLIO_PARSER_SCHEMA,
    sourceLabel: TOKENFOLIO_SOURCE_LABEL,
  },
  [SYDECAR_PROVIDER]: {
    fileName: "sydecar-holdings.csv",
    parserSchema: SYDECAR_PARSER_SCHEMA_V1,
    sourceLabel: SYDECAR_SOURCE_LABEL,
  },
} as const;

const HoldingImportStageInputSchema = z
  .object({
    provider: PrivateHoldingImportProviderSchema.default(ANGELLIST_PROVIDER),
    formatVersion: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .default(1),
    objectKey: z.string().min(1).max(1_024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().positive().max(MAX_IMPORT_BYTES),
    effectiveDate: IsoDateSchema,
    retrievedAt: IsoTimestampSchema,
    rows: z.array(PrivateInvestmentImportRowSchema).min(1).max(MAX_IMPORT_ROWS),
    canonicalScope: HoldingImportCanonicalScopeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const rowNumbers = value.rows.map((row) => row.rowNumber).sort();
    const scopedRows = value.canonicalScope.rows
      .map((row) => row.sourceRowNumber)
      .sort();
    if (JSON.stringify(rowNumbers) !== JSON.stringify(scopedRows)) {
      context.addIssue({
        code: "custom",
        path: ["canonicalScope", "rows"],
        message: "Every private holding row requires one canonical row scope.",
      });
    }
    const connection = value.canonicalScope.connection;
    const expectedAdapter =
      value.provider === ANGELLIST_PROVIDER ? "angellist-import" : "manual";
    if (
      connection.mode !== "ensure" ||
      connection.adapterType !== expectedAdapter ||
      connection.institutionKey !== value.provider
    ) {
      context.addIssue({
        code: "custom",
        path: ["canonicalScope", "connection"],
        message: "Private holding source scope does not match its provider.",
      });
    }
    if (
      value.provider !== ANGELLIST_PROVIDER &&
      value.rows.some(
        (row) =>
          row.unrealizedValueState === "locked" ||
          row.netValueState === "locked",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Provider templates cannot claim provider-locked values.",
      });
    }
    if (
      (value.provider === ANGELLIST_PROVIDER && value.formatVersion !== 1) ||
      (value.provider === TOKENFOLIO_PROVIDER && value.formatVersion === 2)
    ) {
      context.addIssue({
        code: "custom",
        path: ["formatVersion"],
        message: "Only Sydecar supports the version 2 holding template.",
      });
    }
    if (
      value.provider === SYDECAR_PROVIDER &&
      value.formatVersion >= 2 &&
      value.rows.some(
        (row) =>
          row.dealMetadata.managementFeePpm === null ||
          row.dealMetadata.carryPpm === null,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Sydecar version 2 rows require management fee and carry.",
      });
    }
    if (
      value.formatVersion === 3 &&
      value.rows.some((row) => row.providerInvestmentId === undefined)
    )
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Captured investments require their provider investment ID.",
      });
    if (
      value.provider === SYDECAR_PROVIDER &&
      value.formatVersion === 1 &&
      value.rows.some(
        (row) =>
          row.dealMetadata.managementFeePpm !== null ||
          row.dealMetadata.carryPpm !== null,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Sydecar version 1 rows cannot report fee or carry.",
      });
    }
    if (
      value.provider === ANGELLIST_PROVIDER &&
      value.rows.some((row) => row.dealMetadata.managementFeePpm !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "The AngelList export does not report management fees.",
      });
    }
    if (
      value.provider === TOKENFOLIO_PROVIDER &&
      value.rows.some(
        (row) =>
          row.dealMetadata.managementFeePpm !== null ||
          row.dealMetadata.carryPpm !== null,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "The Tokenfolio capture does not report fee or carry.",
      });
    }
  });

export type HoldingImportStageInput = z.input<
  typeof HoldingImportStageInputSchema
>;

const PlaidInvestmentsHoldingImportStageInputSchema = z
  .object({
    objectKey: z.string().min(1).max(1_024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(5 * 1_048_576),
    normalizedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    effectiveDate: IsoDateSchema,
    retrievedAt: IsoTimestampSchema,
    rows: z.array(PlaidInvestmentHoldingRowSchema).max(MAX_IMPORT_ROWS),
    canonicalScope: HoldingImportCanonicalScopeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const rowNumbers = value.rows.map((row) => row.rowNumber).sort();
    const scopedRows = value.canonicalScope.rows
      .map((row) => row.sourceRowNumber)
      .sort();
    if (JSON.stringify(rowNumbers) !== JSON.stringify(scopedRows)) {
      context.addIssue({
        code: "custom",
        path: ["canonicalScope", "rows"],
        message:
          "Every Plaid Investments row requires one canonical row scope.",
      });
    }
    if (value.canonicalScope.connection.mode !== "existing") {
      context.addIssue({
        code: "custom",
        path: ["canonicalScope", "connection"],
        message:
          "Plaid Investments imports require an active canonical connection.",
      });
    }
  });

export type PlaidInvestmentsHoldingImportStageInput = z.input<
  typeof PlaidInvestmentsHoldingImportStageInputSchema
>;

export type HoldingImportStageResult = {
  readonly created: boolean;
  readonly preview: HoldingImportPreview;
};

export type PlaidInvestmentsImportAdjudication = {
  readonly importId: string;
  readonly policyVersion: typeof PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION;
  readonly autoAppliedCount: number;
  readonly quarantinedCount: number;
  readonly preservedPositionCount: number;
};

type DecisionContext = {
  readonly source: "manual" | "policy";
  readonly policyVersion: string | null;
  readonly allowPartial: boolean;
  readonly reasonCodesByRow: ReadonlyMap<string, readonly string[]>;
};

const MANUAL_DECISION_CONTEXT: DecisionContext = {
  source: "manual",
  policyVersion: null,
  allowPartial: false,
  reasonCodesByRow: new Map(),
};

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type ImportIdentityRow = {
  id: string;
  provider: string;
  row_count: number;
  effective_date: string | null;
  retrieved_at: string;
  review_status: "pending_review" | "accepted" | "rejected";
  decision_count: number;
  accepted_count: number;
  application_count: number;
  auto_applied_count: number;
  quarantined_count: number;
  preserved_position_count: number;
};

type ImportCoveragePreviewRow = {
  container_id: string;
  display_label: string;
  completeness:
    | "complete"
    | "partial"
    | "unavailable"
    | "malformed"
    | "failed"
    | "ambiguous";
  reported_row_count: number;
};

type ImportPreviewRow = {
  id: string;
  source_row_number: number;
  legal_vehicle_name: string;
  exposure_label: string;
  owner_label: string;
  provider_status: "live" | "realized";
  invested_on: string | null;
  invested_on_state: "not_reported" | "reported";
  invested_minor: number;
  unrealized_value_minor: number | null;
  unrealized_value_state: "reported" | "locked" | "not_reported";
  realized_value_minor: number;
  management_fee_ppm: number | null;
  carry_ppm: number | null;
  ticker: string | null;
  quantity_micros: number | null;
  cost_basis_minor: number | null;
  parse_status: "ready" | "needs_attention";
  issue_codes_json: string;
  existing_position_id: string | null;
  existing_snapshot_id: string | null;
  application_outcome:
    "created_position" | "appended_snapshot" | "no_change" | null;
  decision_source: "manual" | "policy" | null;
  reason_codes_json: string | null;
  quarantine_reason_code:
    "row_validation_failed" | "possible_identity_change" | null;
};

type ImportPreviewExposureRow = {
  import_row_id: string;
  canonical_name: string;
};

type PendingImportRow = {
  id: string;
  provider: string;
  row_count: number;
  effective_date: string | null;
  retrieved_at: string;
  created_at: string;
  quarantined_count: number;
};

type ApplyImportRow = {
  id: string;
  position_fingerprint: string;
  snapshot_fingerprint: string;
  legal_vehicle_name: string;
  owner_label: string;
  exposure_label: string;
  provider_status: "live" | "realized";
  invested_on: string | null;
  invested_on_state: "not_reported" | "reported";
  invested_minor: number;
  allocation_minor: number;
  unrealized_value_minor: number | null;
  unrealized_value_state: "reported" | "locked" | "not_reported";
  realized_value_minor: number;
  net_value_minor: number | null;
  net_value_state: "reported" | "locked" | "not_reported";
  instrument_type: string;
  position_kind: "direct" | "spv_interest" | "fund_interest";
  quantity_micros: number | null;
  ticker: string | null;
  cost_basis_minor: number | null;
  public_exposure_identity_kind: "cusip" | "isin" | "sedol" | null;
  protected_exposure_key: string | null;
  currency_hint: string | null;
  parse_status: "ready" | "needs_attention";
  source_document_id: string;
  effective_date: string | null;
  retrieved_at: string;
  container_id: string;
};

type ExistingPositionRow = {
  id: string;
  position_fingerprint: string;
  currency: string;
  container_id: string;
};

type PlaidInvestmentsExistingPositionRow = ExistingPositionRow & {
  instrument_type: string;
};

type ExistingSnapshotRow = {
  id: string;
  position_id: string;
  snapshot_fingerprint: string;
};

type ExistingDecisionRow = {
  import_row_id: string;
  decision: "accepted" | "rejected";
  matched_position_id: string | null;
  currency: string | null;
  rationale: string;
  decision_source: "manual" | "policy";
};

type PlaidInvestmentsAdjudicationRow = {
  id: string;
  position_fingerprint: string;
  snapshot_fingerprint: string;
  instrument_type: string;
  parse_status: "ready" | "needs_attention";
  cost_basis_minor: number | null;
  issue_codes_json: string;
  container_id: string;
  coverage_completeness:
    | "complete"
    | "partial"
    | "unavailable"
    | "malformed"
    | "failed"
    | "ambiguous";
};

type PlaidInvestmentsAdjudicationImport = {
  normalized_fingerprint: string;
  connection_id: string;
  coverage_count: number;
  complete_coverage_count: number;
};

type CanonicalConnectionRow = {
  id: string;
  adapter_type: "plaid-investments" | "angellist-import" | "manual";
  protected_source_key: string;
  version_id: string;
  version: number;
  institution_key: string;
  institution_label: string;
  lifecycle_state: "pending" | "active" | "paused" | "disconnected";
  credential_reference: string | null;
};

type CanonicalContainerRow = {
  id: string;
  protected_account_key: string;
  version_id: string;
  version: number;
  display_label: string;
  container_kind:
    | "brokerage"
    | "ira"
    | "retirement"
    | "trust"
    | "entity"
    | "unresolved"
    | "other";
  tax_treatment: "taxable" | "tax_deferred" | "tax_exempt" | "unknown";
};

type PreparedCanonicalScope = {
  readonly connectionId: string;
  readonly containersByKey: ReadonlyMap<string, CanonicalContainerRow>;
  readonly statements: readonly D1PreparedStatement[];
};

type ReportedEconomicsEvidence = {
  readonly managementFeePpm: number | null;
  readonly carryPpm: number | null;
  readonly derivationMethod:
    typeof ANGELLIST_ECONOMICS_DERIVATION | typeof SYDECAR_ECONOMICS_DERIVATION;
};

type ApplySummaryRow = {
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  locked_value_count: number;
};

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
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

async function snapshotFingerprint(
  row: PrivateInvestmentImportRow,
  protectedPositionKey: string,
  provider: "angellist" | "tokenfolio" | "sydecar",
): Promise<string> {
  return sha256(
    JSON.stringify([
      provider === ANGELLIST_PROVIDER
        ? "angellist-position-snapshot-v1"
        : `${provider}-keel-template-position-snapshot-v1`,
      protectedPositionKey,
      row.status,
      row.investedMinor,
      row.dealMetadata.allocationMinor,
      row.unrealizedValueState,
      row.unrealizedValueMinor,
      row.realizedValueMinor,
      row.netValueState,
      row.netValueMinor,
      row.dealMetadata.instrument,
    ]),
  );
}

function reportedEconomicsEvidence(
  provider: PrivateHoldingImportProvider,
  row: PrivateInvestmentImportRow,
): ReportedEconomicsEvidence | null {
  const managementFeePpm = row.dealMetadata.managementFeePpm;
  const carryPpm = row.dealMetadata.carryPpm;
  if (managementFeePpm === null && carryPpm === null) {
    return null;
  }
  if (provider === TOKENFOLIO_PROVIDER) {
    throw new Error("Tokenfolio does not report exact fee or carry terms.");
  }
  return {
    managementFeePpm,
    carryPpm,
    derivationMethod:
      provider === ANGELLIST_PROVIDER
        ? ANGELLIST_ECONOMICS_DERIVATION
        : SYDECAR_ECONOMICS_DERIVATION,
  };
}

function assertReportedEconomicsEvidence(
  provider: PrivateHoldingImportProvider,
  rows: readonly PrivateInvestmentImportRow[],
  preview: HoldingImportPreview,
): void {
  const previewBySourceRow = new Map(
    preview.rows.map((row) => [row.sourceRowNumber, row]),
  );
  for (const row of rows) {
    const evidence = reportedEconomicsEvidence(provider, row);
    if (evidence === null) {
      continue;
    }
    const retained = previewBySourceRow.get(row.rowNumber);
    if (
      retained === undefined ||
      retained.reportedManagementFeePpm !== evidence.managementFeePpm ||
      retained.reportedCarryPpm !== evidence.carryPpm
    ) {
      throw new Error(
        "Reported position economics were not retained as source evidence.",
      );
    }
  }
}

async function plaidInvestmentsSnapshotFingerprint(
  row: PlaidInvestmentHoldingRow,
  retrievedAt: string,
  protectedPositionKey: string,
): Promise<string> {
  return sha256(
    JSON.stringify([
      "plaid-investments-position-snapshot-v1",
      protectedPositionKey,
      retrievedAt,
      row.observedOn,
      row.quantityMicros,
      row.costBasisMinor,
      row.marketValueMinor,
      row.ticker,
      row.securityType,
      row.currency,
      row.issues,
    ]),
  );
}

function issues(serialized: string): string[] {
  const parsed = z.array(z.string().min(1)).safeParse(JSON.parse(serialized));
  if (!parsed.success) {
    throw new Error("Holding import contains invalid issue metadata.");
  }
  return parsed.data;
}

function actionFor(row: ImportPreviewRow): HoldingImportRowPreview["action"] {
  if (
    row.parse_status === "needs_attention" ||
    row.quarantine_reason_code !== null
  ) {
    return "needs_attention";
  }
  switch (row.application_outcome) {
    case "created_position":
      return "create_position";
    case "appended_snapshot":
      return "append_snapshot";
    case "no_change":
      return "no_change";
    default:
      break;
  }
  if (row.existing_position_id === null) {
    return "create_position";
  }
  return row.existing_snapshot_id === null ? "append_snapshot" : "no_change";
}

function containerPositionKey(
  containerId: string,
  protectedPositionKey: string,
): string {
  return JSON.stringify([containerId, protectedPositionKey]);
}

export class D1HoldingImportRepository {
  public constructor(private readonly db: D1Database) {}

  public async listPendingHoldingImports(
    accessSubject: string,
  ): Promise<HoldingImportSummary[]> {
    const identity = await this.findIdentity(accessSubject);
    return this.listPendingHoldingImportsForHousehold(identity.household_id);
  }

  public async listPendingHoldingImportsForHousehold(
    householdId: string,
  ): Promise<HoldingImportSummary[]> {
    const rows = await all<PendingImportRow>(
      this.db
        .prepare(
          `SELECT
             import.id,
             import.provider,
             import.row_count,
             document.effective_date,
             document.retrieved_at,
             import.created_at,
             (SELECT COUNT(*)
              FROM holding_import_quarantines quarantine
              LEFT JOIN holding_import_row_decisions decision
                ON decision.import_row_id = quarantine.import_row_id
              WHERE quarantine.import_id = import.id
                AND (quarantine.position_id IS NOT NULL OR decision.id IS NULL))
               AS quarantined_count
           FROM holding_imports import
           JOIN source_documents document
             ON document.id = import.source_document_id
           WHERE import.household_id = ?
             AND import.provider IN (
               'angellist', 'tokenfolio', 'sydecar', 'plaid_investments'
             )
             AND document.review_status = 'pending_review'
           ORDER BY import.created_at DESC
           LIMIT 20`,
        )
        .bind(householdId),
    );
    return HoldingImportSummariesSchema.parse(
      rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        status:
          row.provider === PLAID_INVESTMENTS_PROVIDER &&
          row.quarantined_count > 0
            ? "quarantined"
            : "pending_review",
        observedAt:
          row.effective_date === null
            ? row.retrieved_at
            : `${row.effective_date}T00:00:00.000Z`,
        rowCount: row.row_count,
        createdAt: row.created_at,
      })),
    );
  }

  public async findHoldingImportBySourceHash(
    accessSubject: string,
    connectionId: string,
    documentSha256: string,
  ): Promise<HoldingImportPreview | null> {
    const sha = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(documentSha256);
    const identity = await this.findIdentity(accessSubject);
    const existing = await this.db
      .prepare(
        `SELECT import.id
         FROM holding_imports import
         JOIN source_documents document
           ON document.id = import.source_document_id
         JOIN holding_import_connections scope ON scope.import_id = import.id
         WHERE import.household_id = ? AND scope.connection_id = ?
           AND document.sha256 = ?`,
      )
      .bind(identity.household_id, connectionId, sha)
      .first<{ id: string }>();
    return existing === null
      ? null
      : this.getHoldingImport(accessSubject, existing.id);
  }

  public async stageHoldingImport(
    accessSubject: string,
    rawInput: HoldingImportStageInput,
  ): Promise<HoldingImportStageResult> {
    const input = HoldingImportStageInputSchema.parse(rawInput);
    const importMetadata = PRIVATE_HOLDING_IMPORT_METADATA[input.provider];
    const parserSchema =
      input.formatVersion === 3
        ? `${input.provider}_keel_template_v3`
        : input.provider === SYDECAR_PROVIDER && input.formatVersion === 2
          ? SYDECAR_PARSER_SCHEMA_V2
          : importMetadata.parserSchema;
    const identity = await this.findIdentity(accessSubject);
    const createdAt = new Date().toISOString();
    const canonical = await this.prepareCanonicalScope(
      identity,
      input.canonicalScope,
      createdAt,
    );
    const existing = await this.findHoldingImportBySourceHash(
      accessSubject,
      canonical.connectionId,
      input.sha256,
    );
    if (existing !== null) {
      await this.addMissingReportedEconomicsEvidence(
        identity,
        input.provider,
        input.rows,
        input.sha256,
        existing,
        createdAt,
      );
      const refreshed = await this.getHoldingImport(accessSubject, existing.id);
      assertReportedEconomicsEvidence(input.provider, input.rows, refreshed);
      return {
        created: false,
        preview: refreshed,
      };
    }
    const rowScopes = new Map(
      input.canonicalScope.rows.map((scope) => [scope.sourceRowNumber, scope]),
    );
    const duplicateCounts = new Map<string, number>();
    input.canonicalScope.rows.forEach((row) => {
      duplicateCounts.set(
        row.protectedPositionKey,
        (duplicateCounts.get(row.protectedPositionKey) ?? 0) + 1,
      );
    });
    const preparedRows = await Promise.all(
      input.rows.map(async (row) => {
        const scope = rowScopes.get(row.rowNumber);
        if (scope === undefined) {
          throw new Error("AngelList row scope was not found.");
        }
        return {
          row,
          scope,
          snapshotFingerprint: await snapshotFingerprint(
            row,
            scope.protectedPositionKey,
            input.provider,
          ),
          duplicate: (duplicateCounts.get(scope.protectedPositionKey) ?? 0) > 1,
        };
      }),
    );
    const importId = crypto.randomUUID();
    const sourceDocumentId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      ...canonical.statements,
      this.db
        .prepare(
          `INSERT INTO source_documents (
             id, household_id, object_key, file_name, content_type, byte_size,
             sha256, effective_date, retrieved_at, source_label, review_status,
             created_at
           ) VALUES (?, ?, ?, ?, 'text/csv', ?, ?, ?, ?, ?,
             'pending_review', ?)`,
        )
        .bind(
          sourceDocumentId,
          identity.household_id,
          input.objectKey,
          importMetadata.fileName,
          input.byteSize,
          input.sha256,
          input.effectiveDate,
          input.retrievedAt,
          importMetadata.sourceLabel,
          createdAt,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_imports (
             id, household_id, source_document_id, provider, parser_schema,
             row_count, created_by, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          importId,
          identity.household_id,
          sourceDocumentId,
          input.provider,
          parserSchema,
          preparedRows.length,
          identity.user_id,
          createdAt,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_import_connections (
             id, household_id, import_id, connection_id, created_at, immutable
           ) VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          importId,
          canonical.connectionId,
          createdAt,
        ),
    ];

    input.canonicalScope.containers.forEach((containerScope) => {
      const container = canonical.containersByKey.get(
        containerScope.protectedAccountKey,
      );
      if (container === undefined) {
        throw new Error("AngelList ownership container was not found.");
      }
      statements.push(
        this.db
          .prepare(
            `INSERT INTO holding_import_coverages (
               id, household_id, import_id, container_id, completeness,
               evidence_sha256, observed_at, created_at, immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            importId,
            container.id,
            containerScope.completeness,
            input.sha256,
            input.retrievedAt,
            createdAt,
          ),
      );
    });

    preparedRows.forEach(
      ({ row, scope, snapshotFingerprint: fingerprint, duplicate }) => {
        const issueCodes = duplicate ? ["duplicate_natural_key"] : [];
        const rowId = crypto.randomUUID();
        const economicsEvidence = reportedEconomicsEvidence(
          input.provider,
          row,
        );
        const container = canonical.containersByKey.get(
          scope.protectedAccountKey,
        );
        if (container === undefined) {
          throw new Error("AngelList row ownership container was not found.");
        }
        statements.push(
          this.db
            .prepare(
              `INSERT INTO holding_import_rows (
               id, household_id, import_id, source_row_number,
               position_fingerprint, snapshot_fingerprint, legal_vehicle_name,
               owner_label, exposure_label, provider_status, invested_on,
               invested_on_state, invested_minor, allocation_minor, unrealized_value_minor,
               unrealized_value_state, realized_value_minor, net_value_minor,
               net_value_state, instrument_type, currency_hint, parse_status,
               issue_codes_json, position_kind, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'USD', ?, ?, ?, ?)`,
            )
            .bind(
              rowId,
              identity.household_id,
              importId,
              row.rowNumber,
              scope.protectedPositionKey,
              fingerprint,
              row.fundName,
              row.investmentEntity,
              row.companyOrFund,
              row.status.toLowerCase(),
              row.investDate,
              row.investDateState,
              row.investedMinor,
              row.dealMetadata.allocationMinor,
              row.unrealizedValueMinor,
              row.unrealizedValueState,
              row.realizedValueMinor,
              row.netValueMinor,
              row.netValueState,
              row.dealMetadata.instrument,
              duplicate ? "needs_attention" : "ready",
              JSON.stringify(issueCodes),
              row.positionKind,
              createdAt,
            ),
          this.db
            .prepare(
              `INSERT INTO holding_import_row_containers (
                 id, household_id, import_row_id, container_id, created_at,
                 immutable
               ) VALUES (?, ?, ?, ?, ?, 1)`,
            )
            .bind(
              crypto.randomUUID(),
              identity.household_id,
              rowId,
              container.id,
              createdAt,
            ),
        );
        if (row.providerInvestmentId !== undefined)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO holding_import_row_provider_investments (import_row_id, household_id, provider_investment_id) VALUES (?, ?, ?)`,
              )
              .bind(rowId, identity.household_id, row.providerInvestmentId),
          );
        if (economicsEvidence !== null) {
          statements.push(
            this.reportedEconomicsEvidenceInsert(
              identity,
              rowId,
              input.sha256,
              economicsEvidence,
              createdAt,
            ),
          );
        }
      },
    );

    try {
      await this.db.batch(statements);
    } catch (error) {
      const raced = await this.findHoldingImportBySourceHash(
        accessSubject,
        canonical.connectionId,
        input.sha256,
      );
      if (raced !== null) {
        await this.addMissingReportedEconomicsEvidence(
          identity,
          input.provider,
          input.rows,
          input.sha256,
          raced,
          createdAt,
        );
        const refreshed = await this.getHoldingImport(accessSubject, raced.id);
        assertReportedEconomicsEvidence(input.provider, input.rows, refreshed);
        return {
          created: false,
          preview: refreshed,
        };
      }
      throw error;
    }

    const preview = await this.getHoldingImport(accessSubject, importId);
    assertReportedEconomicsEvidence(input.provider, input.rows, preview);
    return {
      created: true,
      preview,
    };
  }

  public async findPlaidInvestmentsHoldingImportByFingerprint(
    accessSubject: string,
    connectionId: string,
    normalizedFingerprint: string,
  ): Promise<HoldingImportPreview | null> {
    const fingerprint = z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(normalizedFingerprint);
    const identity = await this.findIdentity(accessSubject);
    const existing = await this.db
      .prepare(
        `SELECT candidate.id
         FROM holding_imports candidate
         JOIN holding_import_connections candidate_scope
           ON candidate_scope.import_id = candidate.id
         WHERE candidate.household_id = ?
           AND candidate_scope.connection_id = ?
           AND candidate.provider = 'plaid_investments'
           AND candidate.normalized_fingerprint = ?
           AND candidate.id = (
             SELECT latest.id
             FROM holding_imports latest
             JOIN holding_import_connections latest_scope
               ON latest_scope.import_id = latest.id
             WHERE latest.household_id = candidate.household_id
               AND latest.provider = candidate.provider
               AND latest_scope.connection_id = candidate_scope.connection_id
             ORDER BY latest.created_at DESC, latest.id DESC
             LIMIT 1
           )`,
      )
      .bind(identity.household_id, connectionId, fingerprint)
      .first<{ id: string }>();
    return existing === null
      ? null
      : this.getHoldingImport(accessSubject, existing.id);
  }

  public async stagePlaidInvestmentsHoldingImport(
    accessSubject: string,
    rawInput: PlaidInvestmentsHoldingImportStageInput,
  ): Promise<HoldingImportStageResult> {
    const input = PlaidInvestmentsHoldingImportStageInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const createdAt = new Date().toISOString();
    const canonical = await this.prepareCanonicalScope(
      identity,
      input.canonicalScope,
      createdAt,
    );
    const existing = await this.findPlaidInvestmentsHoldingImportByFingerprint(
      accessSubject,
      canonical.connectionId,
      input.normalizedFingerprint,
    );
    if (existing !== null) {
      return { created: false, preview: existing };
    }
    const rowScopes = new Map(
      input.canonicalScope.rows.map((scope) => [scope.sourceRowNumber, scope]),
    );
    const preparedRows = await Promise.all(
      input.rows.map(async (row) => {
        const scope = rowScopes.get(row.rowNumber);
        if (scope === undefined) {
          throw new Error("Plaid Investments row scope was not found.");
        }
        return {
          row,
          scope,
          snapshotFingerprint: await plaidInvestmentsSnapshotFingerprint(
            row,
            input.retrievedAt,
            scope.protectedPositionKey,
          ),
        };
      }),
    );
    const importId = crypto.randomUUID();
    const sourceDocumentId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      ...canonical.statements,
      this.db
        .prepare(
          `INSERT INTO source_documents (
             id, household_id, object_key, file_name, content_type, byte_size,
             sha256, effective_date, retrieved_at, source_label, review_status,
             created_at
           ) VALUES (?, ?, ?, 'plaid-investments-holdings.json', 'application/json', ?,
             ?, ?, ?, ?, 'pending_review', ?)`,
        )
        .bind(
          sourceDocumentId,
          identity.household_id,
          input.objectKey,
          input.byteSize,
          input.sha256,
          input.effectiveDate,
          input.retrievedAt,
          PLAID_INVESTMENTS_SOURCE_LABEL,
          createdAt,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_imports (
             id, household_id, source_document_id, provider, parser_schema,
             normalized_fingerprint, row_count, created_by, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          importId,
          identity.household_id,
          sourceDocumentId,
          PLAID_INVESTMENTS_PROVIDER,
          PLAID_INVESTMENTS_PARSER_SCHEMA,
          input.normalizedFingerprint,
          preparedRows.length,
          identity.user_id,
          createdAt,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_import_connections (
             id, household_id, import_id, connection_id, created_at, immutable
           ) VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          importId,
          canonical.connectionId,
          createdAt,
        ),
    ];

    input.canonicalScope.containers.forEach((containerScope) => {
      const container = canonical.containersByKey.get(
        containerScope.protectedAccountKey,
      );
      if (container === undefined) {
        throw new Error("Plaid Investments ownership container was not found.");
      }
      statements.push(
        this.db
          .prepare(
            `INSERT INTO holding_import_coverages (
               id, household_id, import_id, container_id, completeness,
               evidence_sha256, observed_at, created_at, immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            importId,
            container.id,
            containerScope.completeness,
            input.sha256,
            input.retrievedAt,
            createdAt,
          ),
      );
    });

    preparedRows.forEach(({ row, scope, snapshotFingerprint: fingerprint }) => {
      const exposureLabel =
        row.ticker === null
          ? row.securityName
          : `${row.ticker} · ${row.securityName}`;
      const costBasisPlaceholder = row.costBasisMinor ?? 0;
      const rowId = crypto.randomUUID();
      const container = canonical.containersByKey.get(
        scope.protectedAccountKey,
      );
      if (container === undefined) {
        throw new Error(
          "Plaid Investments row ownership container was not found.",
        );
      }
      statements.push(
        this.db
          .prepare(
            `INSERT INTO holding_import_rows (
               id, household_id, import_id, source_row_number,
               position_fingerprint, snapshot_fingerprint, legal_vehicle_name,
               owner_label, exposure_label, provider_status, invested_on,
               invested_on_state, invested_minor, allocation_minor, unrealized_value_minor,
               unrealized_value_state, realized_value_minor, net_value_minor,
               net_value_state, instrument_type, currency_hint, parse_status,
               issue_codes_json, position_kind, quantity_micros, ticker,
               cost_basis_minor, public_exposure_identity_kind,
               protected_exposure_key, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', NULL, 'not_reported', ?, ?, ?,
               'reported', 0, ?, 'reported', ?, 'USD', ?, ?, 'direct', ?, ?,
               ?, ?, ?, ?)`,
          )
          .bind(
            rowId,
            identity.household_id,
            importId,
            row.rowNumber,
            scope.protectedPositionKey,
            fingerprint,
            row.securityName,
            row.accountLabel,
            exposureLabel,
            costBasisPlaceholder,
            costBasisPlaceholder,
            row.marketValueMinor,
            row.marketValueMinor,
            row.securityType,
            row.issues.every((issue) =>
              NON_BLOCKING_PLAID_INVESTMENTS_ISSUES.has(issue),
            )
              ? "ready"
              : "needs_attention",
            JSON.stringify(row.issues),
            row.quantityMicros,
            row.ticker,
            row.costBasisMinor,
            scope.publicExposureIdentityKind,
            scope.protectedExposureKey,
            createdAt,
          ),
        this.db
          .prepare(
            `INSERT INTO holding_import_row_containers (
               id, household_id, import_row_id, container_id, created_at,
               immutable
             ) VALUES (?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            rowId,
            container.id,
            createdAt,
          ),
      );
    });

    try {
      await this.db.batch(statements);
    } catch (error) {
      const raced = await this.findPlaidInvestmentsHoldingImportByFingerprint(
        accessSubject,
        canonical.connectionId,
        input.normalizedFingerprint,
      );
      if (raced !== null) {
        return { created: false, preview: raced };
      }
      throw error;
    }

    return {
      created: true,
      preview: await this.getHoldingImport(accessSubject, importId),
    };
  }

  public async autoAdjudicatePlaidInvestmentsHoldingImport(
    accessSubject: string,
    importId: string,
  ): Promise<PlaidInvestmentsImportAdjudication> {
    const identity = await this.findIdentity(accessSubject);
    const [importRecord, rows, positions, recordedDecisions] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT
               import.normalized_fingerprint,
               scope.connection_id,
               (SELECT COUNT(*)
                FROM holding_import_coverages coverage
                WHERE coverage.import_id = import.id) AS coverage_count,
               (SELECT COUNT(*)
                FROM holding_import_coverages coverage
                WHERE coverage.import_id = import.id
                  AND coverage.completeness = 'complete')
                 AS complete_coverage_count
             FROM holding_imports import
             JOIN holding_import_connections scope ON scope.import_id = import.id
             WHERE import.id = ? AND import.household_id = ?
               AND import.provider = 'plaid_investments'`,
          )
          .bind(importId, identity.household_id)
          .first<PlaidInvestmentsAdjudicationImport>(),
        all<PlaidInvestmentsAdjudicationRow>(
          this.db
            .prepare(
              `SELECT
                 row.id,
                 row.position_fingerprint,
                 row.snapshot_fingerprint,
                 row.instrument_type,
                 row.parse_status,
                 row.cost_basis_minor,
                 row.issue_codes_json,
                 scope.container_id,
                 coverage.completeness AS coverage_completeness
               FROM holding_import_rows row
               JOIN holding_import_row_containers scope
                 ON scope.import_row_id = row.id
               JOIN holding_import_coverages coverage
                 ON coverage.import_id = row.import_id
                AND coverage.container_id = scope.container_id
               WHERE row.import_id = ? AND row.household_id = ?
               ORDER BY row.source_row_number`,
            )
            .bind(importId, identity.household_id),
        ),
        all<PlaidInvestmentsExistingPositionRow>(
          this.db
            .prepare(
              `SELECT
                 position.id,
                 ownership.protected_position_key AS position_fingerprint,
                 position.currency,
                 position.instrument_type,
                 ownership.container_id
               FROM holding_import_coverages coverage
               JOIN holding_position_ownerships ownership
                 ON ownership.container_id = coverage.container_id
               JOIN holding_positions position
                 ON position.id = ownership.position_id
               WHERE coverage.import_id = ?
                 AND coverage.household_id = ?
                 AND coverage.completeness = 'complete'
                 AND position.provider = 'plaid_investments'
                 AND NOT EXISTS (
                   SELECT 1
                   FROM holding_position_ownerships later
                   WHERE later.supersedes_ownership_id = ownership.id
                 )`,
            )
            .bind(importId, identity.household_id),
        ),
        all<{ decision_source: "manual" | "policy" }>(
          this.db
            .prepare(
              `SELECT decision.decision_source
             FROM holding_import_row_decisions decision
             JOIN holding_import_rows row ON row.id = decision.import_row_id
             WHERE row.import_id = ? AND decision.household_id = ?`,
            )
            .bind(importId, identity.household_id),
        ),
      ]);
    if (importRecord === null || importRecord.coverage_count === 0) {
      throw new Error("Plaid Investments holding import not found.");
    }
    if (
      recordedDecisions.some(
        (decision) => decision.decision_source === "manual",
      )
    ) {
      throw new Error(
        "Plaid Investments holding import was already reviewed manually.",
      );
    }
    if (recordedDecisions.length > 0) {
      const preview = await this.getHoldingImport(accessSubject, importId);
      return {
        importId,
        policyVersion: PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
        autoAppliedCount: preview.summary.autoAppliedCount,
        quarantinedCount: preview.summary.quarantinedCount,
        preservedPositionCount: preview.summary.preservedPositionCount,
      };
    }

    const currentPositionKeys = new Set(
      rows.map((row) =>
        containerPositionKey(row.container_id, row.position_fingerprint),
      ),
    );
    const positionsByKey = new Map(
      positions.map((position) => [
        containerPositionKey(
          position.container_id,
          position.position_fingerprint,
        ),
        position,
      ]),
    );
    const hasIncompleteCoverage =
      importRecord.coverage_count !== importRecord.complete_coverage_count;
    const missingPositions = hasIncompleteCoverage
      ? []
      : positions.filter(
          (position) =>
            !currentPositionKeys.has(
              containerPositionKey(
                position.container_id,
                position.position_fingerprint,
              ),
            ),
        );
    const missingPlanningPositions = missingPositions.filter((position) =>
      isPlaidInvestmentsFiPlanningSecurityType(position.instrument_type),
    );
    const containersWithMissingPlanningPositions = new Set(
      missingPlanningPositions.map((position) => position.container_id),
    );
    const clearRows: PlaidInvestmentsAdjudicationRow[] = [];
    const quarantineStatements: D1PreparedStatement[] = [];
    const createdAt = new Date().toISOString();

    rows.forEach((row) => {
      if (hasIncompleteCoverage || row.coverage_completeness !== "complete") {
        return;
      }
      const rowValidationFailed = row.parse_status === "needs_attention";
      const identityChanged =
        containersWithMissingPlanningPositions.has(row.container_id) &&
        !positionsByKey.has(
          containerPositionKey(row.container_id, row.position_fingerprint),
        );
      if (!rowValidationFailed && !identityChanged) {
        clearRows.push(row);
        return;
      }
      quarantineStatements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO holding_import_quarantines (
               id, household_id, import_id, import_row_id, position_id,
               reason_code, policy_version, evidence_sha256, detail, created_at
             ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            importId,
            row.id,
            rowValidationFailed
              ? "row_validation_failed"
              : "possible_identity_change",
            PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
            row.snapshot_fingerprint,
            rowValidationFailed
              ? (
                  "The row did not satisfy the automatic holdings policy: " +
                  issues(row.issue_codes_json).join(" ")
                ).slice(0, 500)
              : "A new position appeared while a prior position disappeared, so Keel kept both states separate.",
            createdAt,
          ),
      );
    });
    missingPlanningPositions.forEach((position) => {
      quarantineStatements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO holding_import_quarantines (
               id, household_id, import_id, import_row_id, position_id,
               reason_code, policy_version, evidence_sha256, detail, created_at
             ) VALUES (?, ?, ?, NULL, ?, 'position_not_reported', ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            importId,
            position.id,
            PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
            importRecord.normalized_fingerprint,
            "This investment account did not report the prior position. Keel preserved its last accepted value and did not infer a sale.",
            createdAt,
          ),
      );
    });
    if (quarantineStatements.length > 0) {
      await this.db.batch(quarantineStatements);
    }

    if (clearRows.length > 0) {
      const reasonCodesByRow = new Map<string, readonly string[]>();
      clearRows.forEach((row) => {
        reasonCodesByRow.set(row.id, [
          isPlaidInvestmentsOutsideFiSecurityType(row.instrument_type)
            ? "excluded_from_fi_planning"
            : "supported_usd_long_position",
          positionsByKey.has(
            containerPositionKey(row.container_id, row.position_fingerprint),
          )
            ? "existing_position_matched"
            : "new_position_identity_clear",
          ...(row.cost_basis_minor === null ? ["cost_basis_unavailable"] : []),
        ]);
      });
      await this.applyHoldingImport(
        accessSubject,
        importId,
        {
          currency: "USD",
          decisions: clearRows.map((row) => ({
            rowId: row.id,
            decision: "accepted" as const,
            rationale: `Automatically accepted by ${PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION}.`,
          })),
        },
        {
          source: "policy",
          policyVersion: PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
          allowPartial: true,
          reasonCodesByRow,
        },
      );
    }

    if (
      rows.length === 0 &&
      missingPlanningPositions.length === 0 &&
      importRecord.coverage_count === importRecord.complete_coverage_count
    ) {
      await this.db
        .prepare(
          `UPDATE source_documents
           SET review_status = 'accepted'
           WHERE id = (
             SELECT source_document_id
             FROM holding_imports
             WHERE id = ? AND household_id = ?
           ) AND review_status = 'pending_review'`,
        )
        .bind(importId, identity.household_id)
        .run();
    }

    const preview = await this.getHoldingImport(accessSubject, importId);
    return {
      importId,
      policyVersion: PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
      autoAppliedCount: preview.summary.autoAppliedCount,
      quarantinedCount: preview.summary.quarantinedCount,
      preservedPositionCount: preview.summary.preservedPositionCount,
    };
  }

  public async getHoldingImport(
    accessSubject: string,
    importId: string,
  ): Promise<HoldingImportPreview> {
    const identity = await this.findIdentity(accessSubject);
    const importRow = await this.db
      .prepare(
        `SELECT
           import.id,
           import.provider,
           import.row_count,
           document.effective_date,
           document.retrieved_at,
           document.review_status,
           (SELECT COUNT(*) FROM holding_import_row_decisions decision
            JOIN holding_import_rows row ON row.id = decision.import_row_id
            WHERE row.import_id = import.id) AS decision_count,
           (SELECT COUNT(*) FROM holding_import_row_decisions decision
            JOIN holding_import_rows row ON row.id = decision.import_row_id
            WHERE row.import_id = import.id AND decision.decision = 'accepted')
             AS accepted_count,
           (SELECT COUNT(*) FROM holding_import_applications application
            JOIN holding_import_rows row ON row.id = application.import_row_id
            WHERE row.import_id = import.id) AS application_count,
           (SELECT COUNT(*) FROM holding_import_row_decisions decision
            JOIN holding_import_rows row ON row.id = decision.import_row_id
            WHERE row.import_id = import.id
              AND decision.decision_source = 'policy'
              AND decision.decision = 'accepted') AS auto_applied_count,
           (SELECT COUNT(*) FROM holding_import_quarantines quarantine
            WHERE quarantine.import_id = import.id) AS quarantined_count,
           (SELECT COUNT(*) FROM holding_import_quarantines quarantine
            WHERE quarantine.import_id = import.id
              AND quarantine.position_id IS NOT NULL)
             AS preserved_position_count
         FROM holding_imports import
         JOIN source_documents document ON document.id = import.source_document_id
         WHERE import.id = ? AND import.household_id = ?`,
      )
      .bind(importId, identity.household_id)
      .first<ImportIdentityRow>();
    if (importRow === null) {
      throw new Error("Holding import not found.");
    }
    const provider = HoldingImportProviderSchema.safeParse(importRow.provider);
    if (!provider.success) {
      throw new Error("Holding import provider is not supported.");
    }

    const [rows, coverage, currentExposures] = await Promise.all([
      all<ImportPreviewRow>(
        this.db
          .prepare(
            `SELECT
             row.id,
             row.source_row_number,
             row.legal_vehicle_name,
             row.exposure_label,
             row.owner_label,
             row.provider_status,
             row.invested_on,
             row.invested_on_state,
             row.invested_minor,
             row.unrealized_value_minor,
             row.unrealized_value_state,
             row.realized_value_minor,
             economics_evidence.management_fee_ppm,
             economics_evidence.carry_ppm,
             row.ticker,
             row.quantity_micros,
             row.cost_basis_minor,
             row.parse_status,
             row.issue_codes_json,
             position.id AS existing_position_id,
             snapshot.id AS existing_snapshot_id,
             application.outcome AS application_outcome,
             decision.decision_source,
             decision.reason_codes_json,
             quarantine.reason_code AS quarantine_reason_code
           FROM holding_import_rows row
           JOIN holding_imports import ON import.id = row.import_id
           LEFT JOIN holding_import_row_reported_economics_evidence
             economics_evidence
             ON economics_evidence.import_row_id = row.id
           JOIN holding_import_row_containers row_scope
             ON row_scope.import_row_id = row.id
           LEFT JOIN holding_position_ownerships ownership
             ON ownership.container_id = row_scope.container_id
             AND ownership.protected_position_key = row.position_fingerprint
             AND NOT EXISTS (
               SELECT 1
               FROM holding_position_ownerships later
               WHERE later.supersedes_ownership_id = ownership.id
             )
           LEFT JOIN holding_positions position
             ON position.id = ownership.position_id
             AND position.household_id = row.household_id
             AND position.provider = import.provider
           LEFT JOIN holding_position_snapshots snapshot
             ON snapshot.position_id = position.id
             AND snapshot.snapshot_fingerprint = row.snapshot_fingerprint
           LEFT JOIN holding_import_applications application
             ON application.import_row_id = row.id
           LEFT JOIN holding_import_row_decisions decision
             ON decision.import_row_id = row.id
           LEFT JOIN holding_import_quarantines quarantine
             ON quarantine.import_row_id = row.id
           WHERE row.import_id = ? AND row.household_id = ?
           ORDER BY row.source_row_number`,
          )
          .bind(importId, identity.household_id),
      ),
      all<ImportCoveragePreviewRow>(
        this.db
          .prepare(
            `SELECT
             coverage.container_id,
             version.display_label,
             coverage.completeness,
             (SELECT COUNT(*)
              FROM holding_import_rows row
              JOIN holding_import_row_containers row_scope
                ON row_scope.import_row_id = row.id
              WHERE row.import_id = coverage.import_id
                AND row_scope.container_id = coverage.container_id)
               AS reported_row_count
           FROM holding_import_coverages coverage
           JOIN ownership_container_versions version
             ON version.container_id = coverage.container_id
            AND NOT EXISTS (
              SELECT 1
              FROM ownership_container_versions later
              WHERE later.supersedes_version_id = version.id
            )
           WHERE coverage.import_id = ? AND coverage.household_id = ?
           ORDER BY version.display_label, coverage.container_id`,
          )
          .bind(importId, identity.household_id),
      ),
      all<ImportPreviewExposureRow>(
        this.db
          .prepare(
            `SELECT
               row.id AS import_row_id,
               exposure.canonical_name
             FROM holding_import_rows row
             JOIN holding_imports import ON import.id = row.import_id
             JOIN holding_import_row_containers row_scope
               ON row_scope.import_row_id = row.id
             JOIN holding_position_ownerships ownership
               ON ownership.container_id = row_scope.container_id
              AND ownership.protected_position_key = row.position_fingerprint
              AND NOT EXISTS (
                SELECT 1
                FROM holding_position_ownerships later_ownership
                WHERE later_ownership.supersedes_ownership_id = ownership.id
              )
             JOIN holding_positions position
               ON position.id = ownership.position_id
              AND position.household_id = row.household_id
              AND position.provider = import.provider
             JOIN holding_position_exposure_mappings mapping
               ON mapping.position_id = position.id
              AND mapping.household_id = row.household_id
              AND mapping.status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM holding_position_exposure_mappings later_mapping
                WHERE later_mapping.supersedes_mapping_id = mapping.id
              )
             JOIN canonical_exposures exposure
               ON exposure.id = mapping.exposure_id
              AND exposure.household_id = row.household_id
              AND exposure.exposure_kind <> 'unresolved'
             WHERE row.import_id = ? AND row.household_id = ?
             ORDER BY row.source_row_number, lower(exposure.canonical_name)`,
          )
          .bind(importId, identity.household_id),
      ),
    ]);
    const exposureNamesByRowId = new Map<string, string[]>();
    currentExposures.forEach((record) => {
      const names = exposureNamesByRowId.get(record.import_row_id) ?? [];
      if (!names.includes(record.canonical_name)) {
        names.push(record.canonical_name);
      }
      exposureNamesByRowId.set(record.import_row_id, names);
    });
    const previewRows: HoldingImportRowPreview[] = rows.map((row) => ({
      id: row.id,
      sourceRowNumber: row.source_row_number,
      positionName: row.legal_vehicle_name,
      exposureName: row.exposure_label,
      ownerLabel: row.owner_label,
      providerStatus: row.provider_status === "live" ? "Live" : "Realized",
      investedOn: row.invested_on,
      investedOnState: row.invested_on_state,
      investedMinor: row.invested_minor,
      administratorNavMinor: row.unrealized_value_minor,
      administratorNavState: row.unrealized_value_state,
      realizedValueMinor: row.realized_value_minor,
      reportedManagementFeePpm: row.management_fee_ppm,
      reportedCarryPpm: row.carry_ppm,
      ticker: row.ticker,
      quantityMicros: row.quantity_micros,
      costBasisMinor: row.cost_basis_minor,
      currentExposureNames: exposureNamesByRowId.get(row.id) ?? [],
      action: actionFor(row),
      issues: issues(row.issue_codes_json),
      adjudicationStatus:
        row.decision_source === "policy"
          ? "auto_applied"
          : row.decision_source === "manual"
            ? "manually_resolved"
            : row.quarantine_reason_code !== null
              ? "quarantined"
              : "pending_review",
      decisionSource: row.decision_source,
      reasonCodes:
        row.reason_codes_json === null ? [] : issues(row.reason_codes_json),
    }));
    const actions = previewRows.map((row) => row.action);
    const observedAt =
      importRow.effective_date === null
        ? importRow.retrieved_at
        : `${importRow.effective_date}T00:00:00.000Z`;
    const status =
      importRow.quarantined_count > 0
        ? "quarantined"
        : importRow.review_status !== "pending_review"
          ? "applied"
          : "pending_review";

    return {
      id: importRow.id,
      provider: provider.data,
      status,
      observedAt,
      summary: {
        rowCount: previewRows.length,
        administratorValueCount: previewRows.filter(
          (row) => row.administratorNavState === "reported",
        ).length,
        lockedValueCount: previewRows.filter(
          (row) => row.administratorNavState === "locked",
        ).length,
        createCount: actions.filter((action) => action === "create_position")
          .length,
        updateCount: actions.filter((action) => action === "append_snapshot")
          .length,
        unchangedCount: actions.filter((action) => action === "no_change")
          .length,
        needsAttentionCount: actions.filter(
          (action) => action === "needs_attention",
        ).length,
        autoAppliedCount: importRow.auto_applied_count,
        quarantinedCount: importRow.quarantined_count,
        preservedPositionCount: importRow.preserved_position_count,
      },
      coverage: coverage.map((record) => ({
        containerId: record.container_id,
        displayLabel: record.display_label,
        completeness: record.completeness,
        reportedRowCount: record.reported_row_count,
      })),
      rows: previewRows,
    };
  }

  public async applyHoldingImport(
    accessSubject: string,
    importId: string,
    rawInput: HoldingImportApplyInput,
    decisionContext: DecisionContext = MANUAL_DECISION_CONTEXT,
  ): Promise<HoldingImportApplyResult> {
    const input = HoldingImportApplyInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const importProvider = await this.db
      .prepare(
        `SELECT provider
         FROM holding_imports
         WHERE id = ? AND household_id = ?`,
      )
      .bind(importId, identity.household_id)
      .first<{ provider: string }>();
    if (importProvider === null) {
      throw new Error("Holding import not found.");
    }
    const provider = HoldingImportProviderSchema.parse(importProvider.provider);
    const rows = await all<ApplyImportRow>(
      this.db
        .prepare(
          `SELECT
             row.id,
             row.position_fingerprint,
             row.snapshot_fingerprint,
             row.legal_vehicle_name,
             row.owner_label,
             row.exposure_label,
             row.provider_status,
             row.invested_on,
             row.invested_on_state,
             row.invested_minor,
             row.allocation_minor,
             row.unrealized_value_minor,
             row.unrealized_value_state,
             row.realized_value_minor,
             row.net_value_minor,
             row.net_value_state,
             row.instrument_type,
             row.position_kind,
             row.quantity_micros,
             row.ticker,
             row.cost_basis_minor,
             row.public_exposure_identity_kind,
             row.protected_exposure_key,
             row.currency_hint,
             row.parse_status,
             import.source_document_id,
             document.effective_date,
             document.retrieved_at,
             row_scope.container_id
           FROM holding_import_rows row
           JOIN holding_imports import ON import.id = row.import_id
           JOIN source_documents document ON document.id = import.source_document_id
           JOIN holding_import_row_containers row_scope
             ON row_scope.import_row_id = row.id
           WHERE import.id = ?
             AND import.household_id = ?
             AND import.provider = ?
           ORDER BY row.source_row_number`,
        )
        .bind(importId, identity.household_id, provider),
    );
    if (rows.length === 0) {
      throw new Error("Holding import not found.");
    }
    const decisionsByRow = new Map(
      input.decisions.map((decision) => [decision.rowId, decision]),
    );
    if (
      decisionsByRow.size !== input.decisions.length ||
      input.decisions.some(
        (decision) => !rows.some((row) => row.id === decision.rowId),
      )
    ) {
      throw new Error("Holding import decisions contain an invalid row.");
    }

    const existingDecisions = await all<ExistingDecisionRow>(
      this.db
        .prepare(
          `SELECT
             decision.import_row_id,
             decision.decision,
             decision.matched_position_id,
             decision.currency,
             decision.rationale,
             decision.decision_source
           FROM holding_import_row_decisions decision
           JOIN holding_import_rows row ON row.id = decision.import_row_id
           WHERE row.import_id = ? AND decision.household_id = ?`,
        )
        .bind(importId, identity.household_id),
    );
    const existingDecisionRowIds = new Set(
      existingDecisions.map((decision) => decision.import_row_id),
    );
    const unresolvedRows = rows.filter(
      (row) => !existingDecisionRowIds.has(row.id),
    );
    if (unresolvedRows.length === 0) {
      const exactRetry =
        existingDecisions.length === rows.length &&
        input.decisions.length === rows.length &&
        existingDecisions.every((recorded) => {
          const requested = decisionsByRow.get(recorded.import_row_id);
          return (
            requested !== undefined &&
            requested.decision === recorded.decision &&
            requested.rationale === recorded.rationale &&
            (requested.decision === "rejected" ||
              recorded.currency === input.currency) &&
            (requested.matchedPositionId == null ||
              requested.matchedPositionId === recorded.matched_position_id)
          );
        });
      if (!exactRetry) {
        throw new Error("Holding import was already reviewed differently.");
      }
      await new D1ExposureRepository(this.db).reconcileAcceptedImportExposures(
        accessSubject,
        importId,
      );
      return this.getApplyResult(identity.household_id, importId);
    }
    if (
      input.decisions.some((decision) =>
        existingDecisionRowIds.has(decision.rowId),
      ) ||
      (!decisionContext.allowPartial &&
        input.decisions.length !== unresolvedRows.length) ||
      input.decisions.some(
        (decision) => !unresolvedRows.some((row) => row.id === decision.rowId),
      )
    ) {
      throw new Error(
        decisionContext.allowPartial
          ? "Automatic holding decisions must cover only clear unresolved rows."
          : "Holding import decisions must cover every unresolved row exactly once.",
      );
    }

    const positions = await all<ExistingPositionRow>(
      this.db
        .prepare(
          `SELECT
             position.id,
             ownership.protected_position_key AS position_fingerprint,
             position.currency,
             ownership.container_id
           FROM holding_position_ownerships ownership
           JOIN holding_positions position ON position.id = ownership.position_id
           WHERE ownership.household_id = ?
             AND position.provider = ?
             AND NOT EXISTS (
               SELECT 1
               FROM holding_position_ownerships later
               WHERE later.supersedes_ownership_id = ownership.id
             )`,
        )
        .bind(identity.household_id, provider),
    );
    const snapshots = await all<ExistingSnapshotRow>(
      this.db
        .prepare(
          `SELECT snapshot.id, snapshot.position_id, snapshot.snapshot_fingerprint
           FROM holding_position_snapshots snapshot
           JOIN holding_positions position ON position.id = snapshot.position_id
           WHERE snapshot.household_id = ? AND position.provider = ?`,
        )
        .bind(identity.household_id, provider),
    );
    const positionsByKey = new Map(
      positions.map((position) => [
        containerPositionKey(
          position.container_id,
          position.position_fingerprint,
        ),
        position,
      ]),
    );
    const positionsById = new Map(
      positions.map((position) => [position.id, position]),
    );
    const snapshotsByPositionAndFingerprint = new Map(
      snapshots.map((snapshot) => [
        `${snapshot.position_id}:${snapshot.snapshot_fingerprint}`,
        snapshot,
      ]),
    );
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    const applications: Array<{
      row: ApplyImportRow;
      decisionId: string;
      positionId: string;
      snapshotId: string;
      outcome: "created_position" | "appended_snapshot" | "no_change";
    }> = [];

    for (const row of rows) {
      const decision = decisionsByRow.get(row.id);
      if (decision === undefined) {
        continue;
      }
      if (decision.decision === "accepted" && row.parse_status !== "ready") {
        throw new Error(
          "Holding import row needs attention before acceptance.",
        );
      }
      if (
        decision.decision === "accepted" &&
        row.currency_hint !== null &&
        row.currency_hint !== input.currency
      ) {
        throw new Error(
          "Holding import currency does not match the reviewed file.",
        );
      }

      const requestedMatch = decision.matchedPositionId ?? null;
      let position =
        requestedMatch === null
          ? positionsByKey.get(
              containerPositionKey(row.container_id, row.position_fingerprint),
            )
          : positionsById.get(requestedMatch);
      if (requestedMatch !== null && position === undefined) {
        throw new Error("Matched holding position not found.");
      }
      if (
        requestedMatch !== null &&
        (position?.position_fingerprint !== row.position_fingerprint ||
          position.container_id !== row.container_id)
      ) {
        throw new Error(
          "Matched holding position does not represent this row.",
        );
      }
      if (
        decision.decision === "accepted" &&
        position !== undefined &&
        position.currency !== input.currency
      ) {
        throw new Error("Matched holding position uses a different currency.");
      }

      let outcome: "created_position" | "appended_snapshot" | "no_change";
      let createdPosition = false;
      if (decision.decision === "accepted" && position === undefined) {
        position = {
          id: crypto.randomUUID(),
          position_fingerprint: row.position_fingerprint,
          currency: input.currency,
          container_id: row.container_id,
        };
        positionsByKey.set(
          containerPositionKey(row.container_id, row.position_fingerprint),
          position,
        );
        positionsById.set(position.id, position);
        createdPosition = true;
        statements.push(
          this.db
            .prepare(
              `INSERT INTO holding_positions (
                 id, household_id, provider, position_fingerprint,
                 legal_vehicle_name, owner_label, position_kind,
                 instrument_type, opened_on, currency, created_by, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              position.id,
              identity.household_id,
              provider,
              row.position_fingerprint,
              row.legal_vehicle_name,
              row.owner_label,
              row.position_kind,
              row.instrument_type,
              row.invested_on,
              input.currency,
              identity.user_id,
              createdAt,
            ),
          this.db
            .prepare(
              `INSERT INTO holding_position_exposures (
                 id, household_id, position_id, exposure_label, exposure_kind,
                 company_id, created_at
               ) VALUES (?, ?, ?, ?, 'unresolved', NULL, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              identity.household_id,
              position.id,
              row.exposure_label,
              createdAt,
            ),
        );
        outcome = "created_position";
      } else {
        outcome = "appended_snapshot";
      }

      const decisionId = crypto.randomUUID();
      statements.push(
        this.db
          .prepare(
            `INSERT INTO holding_import_row_decisions (
               id, household_id, import_row_id, reviewer_user_id, decision,
               matched_position_id, currency, reviewed_snapshot_fingerprint,
               rationale, decision_source, policy_version, reason_codes_json,
               decided_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            decisionId,
            identity.household_id,
            row.id,
            identity.user_id,
            decision.decision,
            decision.decision === "accepted" ? position?.id : null,
            decision.decision === "accepted" ? input.currency : null,
            row.snapshot_fingerprint,
            decision.rationale,
            decisionContext.source,
            decisionContext.policyVersion,
            JSON.stringify(decisionContext.reasonCodesByRow.get(row.id) ?? []),
            createdAt,
          ),
      );

      if (decision.decision === "rejected" || position === undefined) {
        continue;
      }
      if (createdPosition) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO holding_position_ownerships (
                 id, household_id, container_id, position_id,
                 protected_position_key, association_basis, evidence_sha256,
                 version, supersedes_ownership_id, accepted_by_user_id,
                 accepted_at, immutable
               ) VALUES (?, ?, ?, ?, ?, 'reviewed_import', ?, 1, NULL, ?, ?, 1)`,
            )
            .bind(
              crypto.randomUUID(),
              identity.household_id,
              row.container_id,
              position.id,
              row.position_fingerprint,
              row.snapshot_fingerprint,
              identity.user_id,
              createdAt,
            ),
        );
      }
      const snapshotKey = `${position.id}:${row.snapshot_fingerprint}`;
      let snapshot = snapshotsByPositionAndFingerprint.get(snapshotKey);
      if (snapshot === undefined) {
        snapshot = {
          id: crypto.randomUUID(),
          position_id: position.id,
          snapshot_fingerprint: row.snapshot_fingerprint,
        };
        snapshotsByPositionAndFingerprint.set(snapshotKey, snapshot);
        statements.push(
          this.db
            .prepare(
              `INSERT INTO holding_position_snapshots (
                 id, household_id, position_id, source_document_id,
                 source_import_row_id, snapshot_fingerprint, provider_status,
                 invested_minor, allocation_minor, unrealized_value_minor,
                 unrealized_value_state, realized_value_minor, net_value_minor,
                 net_value_state, instrument_type, currency, observed_at,
                 quantity_micros, ticker, cost_basis_minor, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              snapshot.id,
              identity.household_id,
              position.id,
              row.source_document_id,
              row.id,
              row.snapshot_fingerprint,
              row.provider_status,
              row.invested_minor,
              row.allocation_minor,
              row.unrealized_value_minor,
              row.unrealized_value_state,
              row.realized_value_minor,
              row.net_value_minor,
              row.net_value_state,
              row.instrument_type,
              input.currency,
              row.effective_date === null
                ? row.retrieved_at
                : `${row.effective_date}T00:00:00.000Z`,
              row.quantity_micros,
              row.ticker,
              row.cost_basis_minor,
              createdAt,
            ),
        );
      } else {
        outcome = "no_change";
      }
      applications.push({
        row,
        decisionId,
        positionId: position.id,
        snapshotId: snapshot.id,
        outcome,
      });
    }

    applications.forEach((application) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO holding_import_applications (
               id, household_id, import_row_id, decision_id, position_id,
               snapshot_id, outcome, applied_by, applied_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            application.row.id,
            application.decisionId,
            application.positionId,
            application.snapshotId,
            application.outcome,
            identity.user_id,
            createdAt,
          ),
      );
    });
    statements.push(
      this.db
        .prepare(
          `UPDATE source_documents
           SET review_status = 'accepted'
           WHERE id = (
             SELECT import.source_document_id
             FROM holding_imports import
             WHERE import.id = ? AND import.household_id = ?
           )
           AND (
             SELECT COUNT(*) FROM holding_import_rows row
             WHERE row.import_id = ?
           ) = (
             SELECT COUNT(*)
             FROM holding_import_row_decisions decision
             JOIN holding_import_rows row ON row.id = decision.import_row_id
             WHERE row.import_id = ?
           )
           AND (
             SELECT COUNT(*)
             FROM holding_import_row_decisions decision
             JOIN holding_import_rows row ON row.id = decision.import_row_id
             WHERE row.import_id = ? AND decision.decision = 'accepted'
           ) = (
             SELECT COUNT(*)
             FROM holding_import_applications application
             JOIN holding_import_rows row ON row.id = application.import_row_id
             WHERE row.import_id = ?
           )`,
        )
        .bind(
          importId,
          identity.household_id,
          importId,
          importId,
          importId,
          importId,
        ),
    );
    await this.db.batch(statements);
    await new D1ExposureRepository(this.db).reconcileAcceptedImportExposures(
      accessSubject,
      importId,
    );
    return this.getApplyResult(identity.household_id, importId);
  }

  private reportedEconomicsEvidenceInsert(
    identity: HouseholdIdentity,
    importRowId: string,
    evidenceSha256: string,
    evidence: ReportedEconomicsEvidence,
    createdAt: string,
    ignoreExisting = false,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `${ignoreExisting ? "INSERT OR IGNORE" : "INSERT"}
         INTO holding_import_row_reported_economics_evidence (
           id, household_id, import_row_id, management_fee_ppm, carry_ppm,
           evidence_sha256, derivation_method, created_by_user_id, created_at,
           immutable
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .bind(
        crypto.randomUUID(),
        identity.household_id,
        importRowId,
        evidence.managementFeePpm,
        evidence.carryPpm,
        evidenceSha256,
        evidence.derivationMethod,
        identity.user_id,
        createdAt,
      );
  }

  private async addMissingReportedEconomicsEvidence(
    identity: HouseholdIdentity,
    provider: PrivateHoldingImportProvider,
    rows: readonly PrivateInvestmentImportRow[],
    evidenceSha256: string,
    preview: HoldingImportPreview,
    createdAt: string,
  ): Promise<void> {
    const previewBySourceRow = new Map(
      preview.rows.map((row) => [row.sourceRowNumber, row]),
    );
    const statements: D1PreparedStatement[] = [];
    for (const row of rows) {
      const evidence = reportedEconomicsEvidence(provider, row);
      if (evidence === null) {
        continue;
      }
      const existing = previewBySourceRow.get(row.rowNumber);
      if (existing === undefined) {
        throw new Error(
          "Existing holding import does not match the source document rows.",
        );
      }
      const hasExistingEvidence =
        existing.reportedManagementFeePpm !== null ||
        existing.reportedCarryPpm !== null;
      if (hasExistingEvidence) {
        if (
          existing.reportedManagementFeePpm !== evidence.managementFeePpm ||
          existing.reportedCarryPpm !== evidence.carryPpm
        ) {
          throw new Error(
            "Reported position economics conflict with retained source evidence.",
          );
        }
        continue;
      }
      statements.push(
        this.reportedEconomicsEvidenceInsert(
          identity,
          existing.id,
          evidenceSha256,
          evidence,
          createdAt,
          true,
        ),
      );
    }
    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  private async prepareCanonicalScope(
    identity: HouseholdIdentity,
    rawScope: HoldingImportCanonicalScope,
    recordedAt: string,
  ): Promise<PreparedCanonicalScope> {
    const scope = HoldingImportCanonicalScopeSchema.parse(rawScope);
    const statements: D1PreparedStatement[] = [];
    let connection: CanonicalConnectionRow | null;

    if (scope.connection.mode === "existing") {
      connection = await this.findCanonicalConnection(
        identity.household_id,
        scope.connection.connectionId,
      );
      if (
        connection === null ||
        connection.adapter_type !== "plaid-investments" ||
        connection.lifecycle_state !== "active"
      ) {
        throw new Error("Active investment connection was not found.");
      }
    } else {
      connection = await this.db
        .prepare(
          `SELECT
             connection.id,
             connection.adapter_type,
             connection.protected_source_key,
             version.id AS version_id,
             version.version,
             version.institution_key,
             version.institution_label,
             version.lifecycle_state,
             version.credential_reference
           FROM investment_connections connection
           JOIN investment_connection_versions version
             ON version.connection_id = connection.id
           WHERE connection.household_id = ?
             AND connection.adapter_type = ?
             AND connection.protected_source_key = ?
             AND NOT EXISTS (
               SELECT 1
               FROM investment_connection_versions later
               WHERE later.supersedes_version_id = version.id
             )`,
        )
        .bind(
          identity.household_id,
          scope.connection.adapterType,
          scope.connection.protectedSourceKey,
        )
        .first<CanonicalConnectionRow>();

      if (connection === null) {
        const connectionId = crypto.randomUUID();
        const versionId = crypto.randomUUID();
        statements.push(
          this.db
            .prepare(
              `INSERT INTO investment_connections (
                 id, household_id, adapter_type, protected_source_key,
                 created_by_user_id, created_at, immutable
               ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
            )
            .bind(
              connectionId,
              identity.household_id,
              scope.connection.adapterType,
              scope.connection.protectedSourceKey,
              identity.user_id,
              recordedAt,
            ),
          this.db
            .prepare(
              `INSERT INTO investment_connection_versions (
                 id, household_id, connection_id, version, institution_key,
                 institution_label, lifecycle_state, credential_reference,
                 supersedes_version_id, recorded_by_user_id, recorded_at,
                 immutable
               ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, ?, 1)`,
            )
            .bind(
              versionId,
              identity.household_id,
              connectionId,
              scope.connection.institutionKey,
              scope.connection.institutionLabel,
              scope.connection.lifecycleState,
              scope.connection.credentialReference,
              identity.user_id,
              recordedAt,
            ),
        );
        connection = {
          id: connectionId,
          adapter_type: scope.connection.adapterType,
          protected_source_key: scope.connection.protectedSourceKey,
          version_id: versionId,
          version: 1,
          institution_key: scope.connection.institutionKey,
          institution_label: scope.connection.institutionLabel,
          lifecycle_state: scope.connection.lifecycleState,
          credential_reference: scope.connection.credentialReference,
        };
      } else if (
        connection.institution_key !== scope.connection.institutionKey ||
        connection.institution_label !== scope.connection.institutionLabel ||
        connection.lifecycle_state !== scope.connection.lifecycleState ||
        connection.credential_reference !== scope.connection.credentialReference
      ) {
        const versionId = crypto.randomUUID();
        statements.push(
          this.db
            .prepare(
              `INSERT INTO investment_connection_versions (
                 id, household_id, connection_id, version, institution_key,
                 institution_label, lifecycle_state, credential_reference,
                 supersedes_version_id, recorded_by_user_id, recorded_at,
                 immutable
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            )
            .bind(
              versionId,
              identity.household_id,
              connection.id,
              connection.version + 1,
              scope.connection.institutionKey,
              scope.connection.institutionLabel,
              scope.connection.lifecycleState,
              scope.connection.credentialReference,
              connection.version_id,
              identity.user_id,
              recordedAt,
            ),
        );
        connection = {
          ...connection,
          version_id: versionId,
          version: connection.version + 1,
          institution_key: scope.connection.institutionKey,
          institution_label: scope.connection.institutionLabel,
          lifecycle_state: scope.connection.lifecycleState,
          credential_reference: scope.connection.credentialReference,
        };
      }
    }

    const containersByKey = new Map<string, CanonicalContainerRow>();
    for (const containerScope of scope.containers) {
      const existing = await this.db
        .prepare(
          `SELECT
             container.id,
             container.protected_account_key,
             version.id AS version_id,
             version.version,
             version.display_label,
             version.container_kind,
             version.tax_treatment
           FROM ownership_containers container
           JOIN ownership_container_versions version
             ON version.container_id = container.id
           WHERE container.household_id = ?
             AND container.connection_id = ?
             AND container.protected_account_key = ?
             AND NOT EXISTS (
               SELECT 1
               FROM ownership_container_versions later
               WHERE later.supersedes_version_id = version.id
             )`,
        )
        .bind(
          identity.household_id,
          connection.id,
          containerScope.protectedAccountKey,
        )
        .first<CanonicalContainerRow>();
      if (existing === null) {
        const containerId = crypto.randomUUID();
        const versionId = crypto.randomUUID();
        statements.push(
          this.db
            .prepare(
              `INSERT INTO ownership_containers (
                 id, household_id, connection_id, protected_account_key,
                 created_by_user_id, created_at, immutable
               ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
            )
            .bind(
              containerId,
              identity.household_id,
              connection.id,
              containerScope.protectedAccountKey,
              identity.user_id,
              recordedAt,
            ),
          this.db
            .prepare(
              `INSERT INTO ownership_container_versions (
                 id, household_id, container_id, version, display_label,
                 container_kind, tax_treatment, supersedes_version_id,
                 recorded_by_user_id, recorded_at, immutable
               ) VALUES (?, ?, ?, 1, ?, ?, ?, NULL, ?, ?, 1)`,
            )
            .bind(
              versionId,
              identity.household_id,
              containerId,
              containerScope.displayLabel,
              containerScope.containerKind,
              containerScope.taxTreatment,
              identity.user_id,
              recordedAt,
            ),
        );
        containersByKey.set(containerScope.protectedAccountKey, {
          id: containerId,
          protected_account_key: containerScope.protectedAccountKey,
          version_id: versionId,
          version: 1,
          display_label: containerScope.displayLabel,
          container_kind: containerScope.containerKind,
          tax_treatment: containerScope.taxTreatment,
        });
        continue;
      }

      if (
        existing.display_label === containerScope.displayLabel &&
        existing.container_kind === containerScope.containerKind &&
        existing.tax_treatment === containerScope.taxTreatment
      ) {
        containersByKey.set(containerScope.protectedAccountKey, existing);
        continue;
      }

      const versionId = crypto.randomUUID();
      statements.push(
        this.db
          .prepare(
            `INSERT INTO ownership_container_versions (
               id, household_id, container_id, version, display_label,
               container_kind, tax_treatment, supersedes_version_id,
               recorded_by_user_id, recorded_at, immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            versionId,
            identity.household_id,
            existing.id,
            existing.version + 1,
            containerScope.displayLabel,
            containerScope.containerKind,
            containerScope.taxTreatment,
            existing.version_id,
            identity.user_id,
            recordedAt,
          ),
      );
      containersByKey.set(containerScope.protectedAccountKey, {
        ...existing,
        version_id: versionId,
        version: existing.version + 1,
        display_label: containerScope.displayLabel,
        container_kind: containerScope.containerKind,
        tax_treatment: containerScope.taxTreatment,
      });
    }

    return {
      connectionId: connection.id,
      containersByKey,
      statements,
    };
  }

  private async findCanonicalConnection(
    householdId: string,
    connectionId: string,
  ): Promise<CanonicalConnectionRow | null> {
    return this.db
      .prepare(
        `SELECT
           connection.id,
           connection.adapter_type,
           connection.protected_source_key,
           version.id AS version_id,
           version.version,
           version.institution_key,
           version.institution_label,
           version.lifecycle_state,
           version.credential_reference
         FROM investment_connections connection
         JOIN investment_connection_versions version
           ON version.connection_id = connection.id
         WHERE connection.id = ?
           AND connection.household_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM investment_connection_versions later
             WHERE later.supersedes_version_id = version.id
           )`,
      )
      .bind(connectionId, householdId)
      .first<CanonicalConnectionRow>();
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
      throw new Error("Household not found for the authenticated user.");
    }
    return identity;
  }

  private async getApplyResult(
    householdId: string,
    importId: string,
  ): Promise<HoldingImportApplyResult> {
    const result = await this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN application.outcome = 'created_position'
             THEN 1 ELSE 0 END), 0) AS created_count,
           COALESCE(SUM(CASE WHEN application.outcome = 'appended_snapshot'
             THEN 1 ELSE 0 END), 0) AS updated_count,
           COALESCE(SUM(CASE WHEN application.outcome = 'no_change'
             THEN 1 ELSE 0 END), 0) AS unchanged_count,
           COALESCE(SUM(CASE WHEN decision.decision = 'rejected'
             THEN 1 ELSE 0 END), 0) AS rejected_count,
           COALESCE(SUM(CASE WHEN decision.decision = 'accepted'
             AND row.unrealized_value_state = 'locked' THEN 1 ELSE 0 END), 0)
             AS locked_value_count
         FROM holding_import_rows row
         JOIN holding_import_row_decisions decision
           ON decision.import_row_id = row.id
         LEFT JOIN holding_import_applications application
           ON application.import_row_id = row.id
         WHERE row.import_id = ? AND row.household_id = ?`,
      )
      .bind(importId, householdId)
      .first<ApplySummaryRow>();
    if (result === null) {
      throw new Error("Holding import application result not found.");
    }
    return {
      importId,
      createdCount: result.created_count,
      updatedCount: result.updated_count,
      unchangedCount: result.unchanged_count,
      rejectedCount: result.rejected_count,
      lockedValueCount: result.locked_value_count,
    };
  }
}
