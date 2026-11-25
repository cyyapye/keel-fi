import { D1PriceProxyRepository } from "./price-proxies";
import { D1GpReportedTotalRepository } from "./gp-reported-totals";
import { reviewedRenameScopes } from "./reviewed-rename-scope";
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
  HoldingImportPreviewSchema,
  HoldingImportProviderSchema,
  HoldingImportSummariesSchema,
  PublicHoldingReviewInputSchema,
  PublicHoldingReviewEffectsSchema,
  addMinorUnits,
  IsoDateSchema,
  IsoTimestampSchema,
  type HoldingImportApplyInput,
  type HoldingImportApplyResult,
  type HoldingImportCanonicalScope,
  type HoldingImportPreview,
  type HoldingImportRowPreview,
  type HoldingImportSummary,
  type PublicHoldingReviewInput,
} from "@keel/domain";
import { z } from "zod";

import { D1ExposureRepository } from "./exposures";
import {
  publicSourceState,
  buildPublicSourceState,
  type PublicSourcePosition,
  type PublicSourceState,
} from "./public-source-state";

const MAX_IMPORT_BYTES = 1_048_576;
const MAX_IMPORT_ROWS = 500;
const ANGELLIST_PROVIDER = "angellist";
const ANGELLIST_PARSER_SCHEMA = "angellist_investments_v2";
const ANGELLIST_SOURCE_LABEL = "AngelList export";
const ANGELLIST_ECONOMICS_DERIVATION = "angellist_export_carry_v1";
const TOKENFOLIO_PROVIDER = "tokenfolio";
const TOKENFOLIO_PARSER_SCHEMA = "tokenfolio_keel_template_v1";
const TOKENFOLIO_SOURCE_LABEL = "Tokenfolio template";
const WEFUNDER_PROVIDER = "wefunder";
const SYDECAR_PROVIDER = "sydecar";
const SYDECAR_PARSER_SCHEMA_V1 = "sydecar_keel_template_v1";
const SYDECAR_PARSER_SCHEMA_V2 = "sydecar_keel_template_v2";
const SYDECAR_SOURCE_LABEL = "Sydecar template";
const SYDECAR_ECONOMICS_DERIVATION = "sydecar_template_economics_v1";
const PLAID_INVESTMENTS_PROVIDER = "plaid_investments";
const PLAID_INVESTMENTS_PARSER_SCHEMA = "plaid_investments_holdings_v1";
const PLAID_INVESTMENTS_SOURCE_LABEL = "Plaid Investments";
export const PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION =
  "plaid-investments-holdings-auto-v5";
const PUBLIC_SOURCE_IDENTITY_POLICY_VERSION =
  "plaid-investments-holdings-auto-v4";
const PRIVATE_HOLDINGS_POLICY_VERSION = "private-holdings-auto-v1";
const NON_BLOCKING_PLAID_INVESTMENTS_ISSUES = new Set([
  "Cost basis is unavailable.",
  PLAID_INVESTMENTS_CRYPTO_OUTSIDE_FI_ISSUE,
]);

const PrivateHoldingImportProviderSchema = z.enum([
  WEFUNDER_PROVIDER,
  ANGELLIST_PROVIDER,
  TOKENFOLIO_PROVIDER,
  SYDECAR_PROVIDER,
]);
type PrivateHoldingImportProvider = z.output<
  typeof PrivateHoldingImportProviderSchema
>;

const PRIVATE_HOLDING_IMPORT_METADATA = {
  [WEFUNDER_PROVIDER]: {
    fileName: "wefunder-holdings.csv",
    parserSchema: "wefunder_keel_template_v1",
    sourceLabel: "Wefunder template",
  },
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
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
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
    if (
      value.rows.some((row) => row.dealMetadata.sharePrices != null) &&
      (value.provider !== TOKENFOLIO_PROVIDER || value.formatVersion !== 4)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message:
          "Per-share source prices require a Tokenfolio version 4 capture.",
      });
    }

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
      value.formatVersion >= 3 &&
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
    inventoryEvidence: z
      .object({
        sourceUpdatedAt: IsoTimestampSchema,
        zeroCashAccountKeys: z
          .array(z.string().regex(/^[a-f0-9]{64}$/u))
          .max(100)
          .default([]),
        objectKey: z.string().min(1).max(1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        byteSize: z.number().int().positive().max(131072),
      })
      .strict()
      .optional(),
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
    for (const key of value.inventoryEvidence?.zeroCashAccountKeys ?? []) {
      if (
        !value.canonicalScope.containers.some(
          (container) => container.protectedAccountKey === key,
        ) ||
        value.canonicalScope.rows.some((row) => row.protectedAccountKey === key)
      )
        context.addIssue({
          code: "custom",
          path: ["inventoryEvidence", "zeroCashAccountKeys"],
          message:
            "Zero account balance requires an explicitly covered account with no holdings rows.",
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
  readonly expectedCashlessSourceVersion?: number;
  readonly rowObservedAtById?: ReadonlyMap<string, string>;
  readonly afterApplications?: (
    applications: readonly {
      row: ApplyImportRow;
      positionId: string;
      snapshotId: string;
      outcome: "created_position" | "appended_snapshot" | "no_change";
    }[],
    createdAt: string,
  ) => readonly D1PreparedStatement[];
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
  preserved_position_ids_json: string;
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
  public_observed_on?: string | null;
  container_id: string;
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
  applied_position_id: string | null;
  public_exposure_identity_kind: string | null;
  protected_exposure_key: string | null;
  instrument_type: string;
  existing_snapshot_id: string | null;
  application_outcome:
    "created_position" | "appended_snapshot" | "no_change" | null;
  decision_source: "manual" | "policy" | null;
  recorded_decision: "accepted" | "rejected" | null;
  reason_codes_json: string | null;
  quarantine_reason_code:
    "row_validation_failed" | "possible_identity_change" | null;
  quarantine_detail: string | null;
  source_review_id: string | null;
  source_review_decision: "same" | "separate" | "ignore" | null;
  source_review_prior_position_id: string | null;
  source_review_source: "manual" | "policy" | null;
  source_review_created_at: string | null;
  source_review_row_id: string | null;
  source_review_import_id: string | null;
  report_review_id: string | null;
  report_review_created_at: string | null;
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
  public_observed_on: string | null;
  parse_status: "ready" | "needs_attention";
  cost_basis_minor: number | null;
  quantity_micros: number;
  unrealized_value_minor: number;
  issue_codes_json: string;
  public_exposure_identity_kind: string | null;
  protected_exposure_key: string | null;
  container_id: string;
  coverage_completeness:
    | "complete"
    | "partial"
    | "unavailable"
    | "malformed"
    | "failed"
    | "ambiguous";
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
  provider: PrivateHoldingImportProvider,
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
      ...(row.dealMetadata.sharePrices ? [row.dealMetadata.sharePrices] : []),
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
  inventory = false,
): Promise<string> {
  return sha256(
    JSON.stringify([
      inventory
        ? "plaid-investments-position-snapshot-v2"
        : "plaid-investments-position-snapshot-v1",
      protectedPositionKey,
      ...(inventory ? [] : [retrievedAt]),
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
    (row.decision_source === null &&
      row.quarantine_reason_code === "row_validation_failed")
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

function preparePublicHoldingRow(db: D1Database, certified: boolean) {
  return db.prepare(`INSERT INTO holding_import_rows (
               id, household_id, import_id, source_row_number,
               position_fingerprint, snapshot_fingerprint, legal_vehicle_name,
               owner_label, exposure_label, provider_status, invested_on,
               invested_on_state, invested_minor, allocation_minor, unrealized_value_minor,
               unrealized_value_state, realized_value_minor, net_value_minor,
               net_value_state, instrument_type, currency_hint, parse_status,
               issue_codes_json, position_kind, quantity_micros, ticker,
               cost_basis_minor, public_exposure_identity_kind,
               protected_exposure_key, created_at${certified ? ", public_observed_on" : ""}
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', NULL, 'not_reported', ?, ?, ?,
               'reported', 0, ?, 'reported', ?, 'USD', ?, ?, 'direct', ?, ?,
               ?, ?, ?, ?${certified ? ", ?" : ""})`);
}

function prepareImportPositions(db: D1Database, publicSource: boolean) {
  return db.prepare(
    publicSource
      ? `SELECT position.id,ownership.protected_position_key position_fingerprint,position.currency,ownership.container_id
          FROM holding_import_rows row INDEXED BY sqlite_autoindex_holding_import_rows_2 CROSS JOIN holding_import_row_containers scope ON scope.import_row_id=row.id
          CROSS JOIN holding_position_ownerships ownership INDEXED BY holding_position_ownerships_household_container_idx ON ownership.household_id=row.household_id AND ownership.container_id=scope.container_id AND ownership.protected_position_key=row.position_fingerprint
          CROSS JOIN holding_positions position ON position.id=ownership.position_id
          WHERE row.import_id=? AND row.household_id=? AND position.provider=? AND row.position_kind='direct'
            AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=ownership.id)`
      : `SELECT
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
  );
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
                AND quarantine.import_row_id IS NOT NULL AND decision.id IS NULL
                AND NOT EXISTS(SELECT 1 FROM public_holding_source_heads ignored
                  WHERE ignored.review_key='report:'||quarantine.import_row_id AND ignored.decision='ignore'))
               AS quarantined_count
           FROM holding_imports import
           JOIN source_documents document
             ON document.id = import.source_document_id
           WHERE import.household_id = ?
             AND import.provider IN (
               'angellist', 'tokenfolio', 'sydecar', 'wefunder', 'plaid_investments'
             )
             AND document.review_status = 'pending_review'
             AND (import.provider<>'plaid_investments' OR EXISTS(
               SELECT 1 FROM public_holding_import_heads latest WHERE latest.import_id=import.id))
             AND (EXISTS(SELECT 1 FROM holding_import_rows pending
               LEFT JOIN holding_import_row_decisions decision ON decision.import_row_id=pending.id
               WHERE pending.import_id=import.id AND decision.id IS NULL
                 AND NOT EXISTS(SELECT 1 FROM public_holding_source_heads ignored
                   WHERE ignored.review_key='report:'||pending.id AND ignored.decision='ignore'))
               OR EXISTS(SELECT 1 FROM holding_import_coverages coverage WHERE coverage.import_id=import.id AND coverage.completeness<>'complete'))
           ORDER BY import.created_at DESC
           LIMIT 20`,
        )
        .bind(householdId),
    );
    return HoldingImportSummariesSchema.parse(
      rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        status: row.quarantined_count > 0 ? "quarantined" : "pending_review",
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
      input.formatVersion >= 3
        ? `${input.provider}_keel_template_v${input.formatVersion}`
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
    const resolvedScopes = await reviewedRenameScopes(
      this.db,
      identity.household_id,
      canonical.connectionId,
      input,
      canonical.containersByKey,
    );
    const rowScopes = new Map(
      resolvedScopes.map((scope) => [scope.sourceRowNumber, scope]),
    );
    const duplicateCounts = new Map<string, number>();
    resolvedScopes.forEach((row) => {
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
        if (row.dealMetadata.sharePrices) {
          statements.push(
            this.db
              .prepare(
                `INSERT INTO holding_import_share_prices(import_row_id, household_id, evidence_json) VALUES (?, ?, ?)`,
              )
              .bind(
                rowId,
                identity.household_id,
                JSON.stringify(row.dealMetadata.sharePrices),
              ),
          );
        }
        if (scope.renameReviewId)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO holding_import_rename_aliases(import_row_id,household_id,rename_review_id,target_position_id) VALUES(?,?,?,?)`,
              )
              .bind(
                rowId,
                identity.household_id,
                scope.renameReviewId,
                scope.renameTargetPositionId!,
              ),
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

  /** Accept validated evidence using the same transaction as manual decisions. */
  public async autoAdjudicatePrivateHoldingImport(
    accessSubject: string,
    importId: string,
  ): Promise<HoldingImportPreview> {
    const preview = await this.getHoldingImport(accessSubject, importId);
    if (preview.provider === PLAID_INVESTMENTS_PROVIDER) {
      await this.autoAdjudicatePlaidInvestmentsHoldingImport(
        accessSubject,
        importId,
      );
      return this.getHoldingImport(accessSubject, importId);
    }
    const unresolvedIds = new Set(
      preview.rows
        .filter((row) => row.decisionSource === null)
        .map((row) => row.id),
    );
    if (unresolvedIds.size === 0) {
      // Recover projection work if an earlier request stopped after acceptance.
      await new D1ExposureRepository(this.db).reconcileAcceptedImportExposures(
        accessSubject,
        importId,
      );
      return preview;
    }
    const identity = await this.findIdentity(accessSubject);
    const [rows, positions] = await Promise.all([
      all<{
        id: string;
        container_id: string;
        position_fingerprint: string;
        snapshot_fingerprint: string;
        legal_vehicle_name: string;
        instrument_type: string;
        currency_hint: string | null;
        completeness: string;
        parse_status: string;
        provider_status: string;
        invested_minor: number;
        allocation_minor: number;
      }>(
        this.db
          .prepare(
            `
        SELECT row.id, scope.container_id, row.position_fingerprint,
          row.snapshot_fingerprint, row.legal_vehicle_name, row.instrument_type,
          row.currency_hint, coverage.completeness, row.parse_status, row.provider_status, row.invested_minor, row.allocation_minor
        FROM holding_import_rows row
        JOIN holding_import_row_containers scope ON scope.import_row_id = row.id
        JOIN holding_import_coverages coverage ON coverage.import_id = row.import_id
          AND coverage.container_id = scope.container_id
        WHERE row.import_id = ? AND row.household_id = ?
        ORDER BY row.source_row_number
      `,
          )
          .bind(importId, identity.household_id),
      ),
      all<{
        id: string;
        container_id: string;
        protected_position_key: string;
        legal_vehicle_name: string;
        instrument_type: string;
        currency: string;
        observed_at: string;
        historical_rename: number;
        rename_cash_json: string | null;
      }>(
        this.db
          .prepare(
            `
        SELECT position.id, ownership.container_id, ownership.protected_position_key,
          position.legal_vehicle_name, position.currency,
          EXISTS(SELECT 1 FROM holding_position_link_heads link JOIN holding_position_link_reviews r ON r.id=link.review_id JOIN holding_position_snapshots prior ON prior.id=r.target_snapshot_id WHERE link.household_id=position.household_id AND link.target_position_id=position.id AND link.state='linked' AND r.company_renamed=1 AND prior.provider_status='realized') historical_rename,
          (SELECT json_object('investedMinor',prior.invested_minor,'allocationMinor',prior.allocation_minor) FROM holding_position_link_heads link JOIN holding_position_link_reviews r ON r.id=link.review_id JOIN holding_position_snapshots prior ON prior.id=r.target_snapshot_id WHERE link.household_id=position.household_id AND link.target_position_id=position.id AND link.state='linked' AND r.company_renamed=1 AND prior.provider_status='realized' ORDER BY r.accepted_at DESC,r.id DESC LIMIT 1) rename_cash_json,
          (SELECT snapshot.instrument_type FROM holding_position_snapshots snapshot
            WHERE snapshot.position_id = position.id
            ORDER BY snapshot.observed_at DESC, snapshot.created_at DESC, snapshot.id DESC
            LIMIT 1) AS instrument_type,
          (SELECT MAX(snapshot.observed_at) FROM holding_position_snapshots snapshot
            WHERE snapshot.position_id = position.id) AS observed_at
        FROM holding_import_connections import_scope
        JOIN ownership_containers container ON container.connection_id = import_scope.connection_id
        JOIN holding_position_ownerships ownership ON ownership.container_id = container.id
        JOIN holding_positions position ON position.id = ownership.position_id
        WHERE import_scope.import_id = ? AND import_scope.household_id = ?
          AND NOT EXISTS (SELECT 1 FROM holding_position_ownerships later
            WHERE later.supersedes_ownership_id = ownership.id)
      `,
          )
          .bind(importId, identity.household_id),
      ),
    ]);
    const positionsByKey = new Map(
      positions.map((position) => [
        containerPositionKey(
          position.container_id,
          position.protected_position_key,
        ),
        position,
      ]),
    );
    const reportedKeys = new Set(
      rows.map((row) =>
        containerPositionKey(row.container_id, row.position_fingerprint),
      ),
    );
    const completeContainers = new Set(
      preview.coverage
        .filter((coverage) => coverage.completeness === "complete")
        .map((coverage) => coverage.containerId),
    );
    const missingContainers = new Set(
      positions
        .filter(
          (position) =>
            completeContainers.has(position.container_id) &&
            !reportedKeys.has(
              containerPositionKey(
                position.container_id,
                position.protected_position_key,
              ),
            ),
        )
        .map((position) => position.container_id),
    );
    const normalizeName = (value: string) =>
      value.trim().toLowerCase().replace(/\s+/gu, " ");
    const positionsByName = new Map<string, (typeof positions)[number][]>();
    for (const position of positions) {
      const key = normalizeName(position.legal_vehicle_name);
      const candidates = positionsByName.get(key) ?? [];
      candidates.push(position);
      positionsByName.set(key, candidates);
    }
    const decisions: HoldingImportApplyInput["decisions"] = [];
    const reasons = new Map<string, readonly string[]>();
    const quarantines: D1PreparedStatement[] = [];
    const createdAt = new Date().toISOString();
    for (const row of rows) {
      if (!unresolvedIds.has(row.id)) continue;
      const position = positionsByKey.get(
        containerPositionKey(row.container_id, row.position_fingerprint),
      );
      // Delayed exports must never replace a newer accepted snapshot.
      if (position !== undefined && preview.observedAt < position.observed_at) {
        decisions.push({
          rowId: row.id,
          decision: "rejected",
          rationale: "A newer source value is already recorded.",
        });
        reasons.set(row.id, ["older_observation_ignored"]);
        continue;
      }
      const invalid =
        row.parse_status !== "ready" ||
        row.currency_hint !== "USD" ||
        !["complete", "partial"].includes(row.completeness) ||
        (position !== undefined && position.currency !== row.currency_hint);
      const renamedCash =
        position?.rename_cash_json == null
          ? null
          : z
              .object({
                investedMinor: z.number().int().safe(),
                allocationMinor: z.number().int().safe(),
              })
              .parse(JSON.parse(position.rename_cash_json));
      const possibleIdentityChange =
        position === undefined
          ? missingContainers.has(row.container_id) ||
            (
              positionsByName.get(normalizeName(row.legal_vehicle_name)) ?? []
            ).some(
              (candidate) =>
                !reportedKeys.has(
                  containerPositionKey(
                    candidate.container_id,
                    candidate.protected_position_key,
                  ),
                ),
            )
          : position.instrument_type !== row.instrument_type ||
            (position.historical_rename === 1 &&
              (row.provider_status !== "realized" ||
                (renamedCash !== null &&
                  (row.invested_minor !== renamedCash.investedMinor ||
                    row.allocation_minor !== renamedCash.allocationMinor))));
      if (invalid || possibleIdentityChange) {
        quarantines.push(
          this.db
            .prepare(
              `
          INSERT OR IGNORE INTO holding_import_quarantines (
            id, household_id, import_id, import_row_id, position_id,
            reason_code, policy_version, evidence_sha256, detail, created_at
          ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
        `,
            )
            .bind(
              crypto.randomUUID(),
              identity.household_id,
              importId,
              row.id,
              invalid ? "row_validation_failed" : "possible_identity_change",
              PRIVATE_HOLDINGS_POLICY_VERSION,
              row.snapshot_fingerprint,
              invalid
                ? "The source identity, currency, or row data could not be validated. Correct the source and import it again."
                : "Check the legal position and owner. This may replace or overlap a previously recorded position.",
              createdAt,
            ),
        );
        continue;
      }
      decisions.push({
        rowId: row.id,
        decision: "accepted",
        rationale: "Validated source identity and position facts.",
      });
      reasons.set(row.id, [
        position === undefined
          ? "new_source_position"
          : "exact_source_position",
      ]);
    }
    if (quarantines.length > 0) await this.db.batch(quarantines);
    if (decisions.length > 0) {
      try {
        await this.applyHoldingImport(
          accessSubject,
          importId,
          { currency: "USD", decisions },
          {
            source: "policy",
            policyVersion: PRIVATE_HOLDINGS_POLICY_VERSION,
            allowPartial: true,
            reasonCodesByRow: reasons,
          },
        );
      } catch (error) {
        // A concurrent identical delivery may already have recorded these rows.
        const current = await this.getHoldingImport(accessSubject, importId);
        if (
          decisions.some(
            (decision) =>
              !current.rows.find((row) => row.id === decision.rowId)
                ?.decisionSource,
          )
        )
          throw error;
        await new D1ExposureRepository(
          this.db,
        ).reconcileAcceptedImportExposures(accessSubject, importId);
      }
    }
    return this.getHoldingImport(accessSubject, importId);
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
    input.retrievedAt = new Date(input.retrievedAt).toISOString();
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
    const ambiguousAccounts = input.inventoryEvidence
      ? new Set(
          (
            await all<{ account_key: string }>(
              this.db
                .prepare(
                  `
      WITH reported AS MATERIALIZED (SELECT value account_key FROM json_each(?))
      SELECT reported.account_key FROM reported WHERE
        EXISTS(SELECT 1 FROM ownership_containers old
          WHERE old.household_id=? AND old.connection_id=?
            AND old.protected_account_key NOT IN(SELECT account_key FROM reported)
            AND EXISTS(SELECT 1 FROM public_holding_active_positions active WHERE active.household_id=old.household_id AND active.container_id=old.id))
        AND NOT EXISTS(SELECT 1 FROM ownership_containers known
          JOIN public_holding_security_heads security ON security.container_id=known.id
          WHERE known.household_id=? AND known.connection_id=? AND known.protected_account_key=reported.account_key)
    `,
                )
                .bind(
                  JSON.stringify(
                    input.canonicalScope.containers.map(
                      (container) => container.protectedAccountKey,
                    ),
                  ),
                  identity.household_id,
                  canonical.connectionId,
                  identity.household_id,
                  canonical.connectionId,
                ),
            )
          ).map((row) => row.account_key),
        )
      : new Set<string>();
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
            input.inventoryEvidence !== undefined,
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
           ) VALUES (?, ?, ?, 'plaid-investments-capture.json', 'application/json', ?,
             ?, ?, ?, ?, 'pending_review', ?)`,
        )
        .bind(
          sourceDocumentId,
          identity.household_id,
          input.inventoryEvidence?.objectKey ?? input.objectKey,
          input.inventoryEvidence?.byteSize ?? input.byteSize,
          input.inventoryEvidence?.sha256 ?? input.sha256,
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

    if (input.inventoryEvidence) {
      // A capture manifest has its own checksum even when the raw response bytes
      // match an older report. Keep both the original object and status evidence.
      statements.push(
        this.db
          .prepare(
            `INSERT INTO public_holding_inventory_evidence(
        import_id,status_document_id,holdings_object_key,holdings_sha256,holdings_byte_size,zero_cash_containers_json,source_updated_at,created_at,policy_version)
        VALUES(?,?,?,?,?,?,?,?,'public-holding-inventory-v1')`,
          )
          .bind(
            importId,
            sourceDocumentId,
            input.objectKey,
            input.sha256,
            input.byteSize,
            JSON.stringify(
              input.inventoryEvidence.zeroCashAccountKeys.map(
                (key) => canonical.containersByKey.get(key)!.id,
              ),
            ),
            new Date(input.inventoryEvidence.sourceUpdatedAt).toISOString(),
            createdAt,
          ),
      );
    }

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
            ambiguousAccounts.has(containerScope.protectedAccountKey)
              ? "ambiguous"
              : containerScope.completeness,
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
        preparePublicHoldingRow(this.db, Boolean(input.inventoryEvidence)).bind(
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
          ...(input.inventoryEvidence ? [row.observedOn] : []),
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
        return { created: raced.id === importId, preview: raced };
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
    const [record, rows, state, decisions, ignoredReports] = await Promise.all([
      this.db
        .prepare(
          `SELECT i.normalized_fingerprint,d.review_status,
        COALESCE((SELECT zero_cash_containers_json FROM public_holding_inventory_evidence e WHERE e.import_id=i.id),'[]') zero_cash_containers,
        (SELECT source_updated_at FROM public_holding_inventory_evidence e WHERE e.import_id=i.id) source_updated_at,
        EXISTS(SELECT 1 FROM public_holding_inventories inventory WHERE inventory.import_id=i.id) inventory_accepted,
        (SELECT MAX(head.source_updated_at) FROM holding_import_coverages covered JOIN public_holding_account_inventory_heads head ON head.container_id=covered.container_id WHERE covered.import_id=i.id) last_inventory_source_at,
        EXISTS(SELECT 1 FROM holding_import_connections link JOIN public_holding_import_heads head ON head.connection_id=link.connection_id AND head.import_id=link.import_id WHERE link.import_id=i.id) source_is_latest,
        COALESCE(d.effective_date||'T00:00:00.000Z',d.retrieved_at) observed_at,
        (SELECT COUNT(*) FROM holding_import_coverages c WHERE c.import_id=i.id) coverage_count,
        (SELECT COUNT(*) FROM holding_import_coverages c WHERE c.import_id=i.id AND c.completeness='complete') complete_coverage_count,
        (SELECT json_group_array(c.container_id) FROM holding_import_coverages c WHERE c.import_id=i.id AND c.completeness='complete') complete_containers
        FROM holding_imports i JOIN source_documents d ON d.id=i.source_document_id
        WHERE i.id=? AND i.household_id=? AND i.provider='plaid_investments'`,
        )
        .bind(importId, identity.household_id)
        .first<{
          normalized_fingerprint: string;
          review_status: string;
          zero_cash_containers: string;
          observed_at: string;
          source_updated_at: string | null;
          inventory_accepted: number;
          last_inventory_source_at: string | null;
          source_is_latest: number;
          coverage_count: number;
          complete_coverage_count: number;
          complete_containers: string;
        }>(),
      all<PlaidInvestmentsAdjudicationRow>(
        this.db
          .prepare(
            `SELECT r.id,r.position_fingerprint,r.snapshot_fingerprint,
        r.instrument_type,r.parse_status,r.public_observed_on,r.cost_basis_minor,r.quantity_micros,r.unrealized_value_minor,r.issue_codes_json,r.public_exposure_identity_kind,r.protected_exposure_key,
        c.container_id,coverage.completeness coverage_completeness
        FROM holding_import_rows r JOIN holding_import_row_containers c ON c.import_row_id=r.id
        JOIN holding_import_coverages coverage ON coverage.import_id=r.import_id AND coverage.container_id=c.container_id
        WHERE r.import_id=? AND r.household_id=? ORDER BY r.source_row_number`,
          )
          .bind(importId, identity.household_id),
      ),
      publicSourceState(this.db, identity.household_id, importId),
      all<{
        import_row_id: string;
        decision: string;
        decision_source: string;
        outcome: string | null;
      }>(
        this.db
          .prepare(
            `SELECT d.import_row_id,d.decision,d.decision_source,application.outcome FROM holding_import_rows r
        CROSS JOIN holding_import_row_decisions d ON d.import_row_id=r.id LEFT JOIN holding_import_applications application ON application.import_row_id=r.id WHERE r.import_id=? AND r.household_id=? AND d.household_id=r.household_id AND r.position_kind='direct'`,
          )
          .bind(importId, identity.household_id),
      ),
      all<{ import_row_id: string }>(
        this.db
          .prepare(
            `SELECT h.import_row_id FROM holding_import_rows r
        CROSS JOIN public_holding_source_heads h ON h.review_key='report:'||r.id AND h.decision='ignore'
        WHERE r.import_id=? AND r.household_id=? AND r.position_kind='direct'`,
          )
          .bind(importId, identity.household_id),
      ),
    ]);
    if (!record || record.coverage_count === 0)
      throw new Error("Plaid Investments holding import not found.");
    const complete = new Set(
      z.array(z.string()).parse(JSON.parse(record.complete_containers)),
    );
    const done = new Set(
      [...decisions, ...ignoredReports].map((item) => item.import_row_id),
    );
    const zeroCashContainers = new Set(
      z.array(z.string()).parse(JSON.parse(record.zero_cash_containers)),
    );
    const byKey = new Map(
      state.positions.map((position) => [
        containerPositionKey(position.container_id, position.position_key),
        position,
      ]),
    );
    const reportedKeys = new Set(
      rows.map((row) =>
        containerPositionKey(row.container_id, row.position_fingerprint),
      ),
    );
    const reportedGroups = new Set(
      rows.flatMap((row) => {
        const position = byKey.get(
          containerPositionKey(row.container_id, row.position_fingerprint),
        );
        const visible = position
          ? state.visibleById.get(position.id)
          : undefined;
        return visible ? [visible] : [];
      }),
    );
    const incomplete = record.coverage_count !== record.complete_coverage_count;
    const certified = record.source_updated_at !== null;
    const cashContainers = new Set(
      rows
        .filter((row) => row.instrument_type === "cash")
        .map((row) => row.container_id),
    );
    const missingCash = new Set(
      [...complete].filter(
        (container) =>
          !cashContainers.has(container) && !zeroCashContainers.has(container),
      ),
    );
    const staleInventory =
      certified &&
      record.last_inventory_source_at !== null &&
      (record.source_updated_at! < record.last_inventory_source_at ||
        (!record.inventory_accepted &&
          record.source_updated_at === record.last_inventory_source_at));
    if (
      (record.inventory_accepted && missingCash.size === 0) ||
      staleInventory ||
      !record.source_is_latest
    ) {
      const preview = await this.getHoldingImport(accessSubject, importId);
      return {
        importId,
        policyVersion: PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
        autoAppliedCount: preview.summary.autoAppliedCount,
        quarantinedCount: preview.summary.quarantinedCount,
        preservedPositionCount: preview.summary.preservedPositionCount,
      };
    }
    const missing =
      incomplete && !certified
        ? []
        : state.positions.filter(
            (position) =>
              complete.has(position.container_id) &&
              !state.hiddenIds.has(position.id) &&
              !reportedKeys.has(
                containerPositionKey(
                  position.container_id,
                  position.position_key,
                ),
              ) &&
              !reportedGroups.has(position.id),
          );
    const missingPlanning = new Set(
      missing
        .filter((position) =>
          isPlaidInvestmentsFiPlanningSecurityType(position.instrument_type),
        )
        .map((position) => position.container_id),
    );
    const identityKey = (
      container: string,
      kind: string,
      key: string,
      instrument: string,
    ) => `${container}:${kind}:${key}:${instrument}:USD`;
    const missingTypes = new Set(
      missing.map(
        (position) => `${position.container_id}:${position.instrument_type}`,
      ),
    );
    const missingByIdentity = new Map<string, PublicSourcePosition[]>();
    for (const position of missing) {
      if (
        position.identity_kind === null ||
        position.identity_key === null ||
        position.currency !== "USD"
      )
        continue;
      const key = identityKey(
        position.container_id,
        position.identity_kind,
        position.identity_key,
        position.instrument_type,
      );
      const matches = missingByIdentity.get(key) ?? [];
      matches.push(position);
      missingByIdentity.set(key, matches);
    }
    const existingIdentityGroups = new Map<string, Set<string>>();
    for (const position of state.positions) {
      if (
        position.identity_kind === null ||
        position.identity_key === null ||
        state.ignoredIds.has(position.id)
      )
        continue;
      const key = identityKey(
        position.container_id,
        position.identity_kind,
        position.identity_key,
        position.instrument_type,
      );
      const groups = existingIdentityGroups.get(key) ?? new Set<string>();
      groups.add(state.visibleById.get(position.id) ?? position.id);
      existingIdentityGroups.set(key, groups);
    }
    const incomingIdentityCounts = new Map<string, number>();
    for (const row of rows)
      if (row.public_exposure_identity_kind && row.protected_exposure_key) {
        const key = identityKey(
          row.container_id,
          row.public_exposure_identity_kind,
          row.protected_exposure_key,
          row.instrument_type,
        );
        incomingIdentityCounts.set(
          key,
          (incomingIdentityCounts.get(key) ?? 0) + 1,
        );
      }
    const invalidContainers = new Set(
      rows
        .filter((row) => row.parse_status !== "ready")
        .map((row) => row.container_id),
    );
    if (certified) {
      for (const position of state.positions) {
        if (
          position.is_active !== 0 &&
          position.inventory_source_at &&
          position.inventory_source_at >= record.source_updated_at!
        ) {
          invalidContainers.add(position.container_id);
        }
      }
    }
    const clear: HoldingImportApplyInput["decisions"] = [];
    const reasons = new Map<string, readonly string[]>();
    const matches = new Map<string, PublicSourcePosition>();
    const reconsider = new Set<string>();
    const quarantines: D1PreparedStatement[] = [];
    const createdAt = new Date().toISOString();
    for (const row of rows) {
      const cashMissing = certified && missingCash.has(row.container_id);
      if (
        done.has(row.id) ||
        (record.inventory_accepted && !cashMissing) ||
        (certified && invalidContainers.has(row.container_id)) ||
        (incomplete && !certified) ||
        row.coverage_completeness !== "complete"
      )
        continue;
      const current = byKey.get(
        containerPositionKey(row.container_id, row.position_fingerprint),
      );
      const visible = current
        ? state.byId.get(state.visibleById.get(current.id) ?? current.id)
        : undefined;
      if (
        current &&
        !certified &&
        record.observed_at < (visible?.observed_at ?? current.observed_at)
      ) {
        clear.push({
          rowId: row.id,
          decision: "rejected",
          rationale: "A newer source value is already recorded.",
        });
        reasons.set(row.id, ["older_observation_ignored"]);
        continue;
      }
      const verifiedConflict =
        visible?.identity_key !== null &&
        visible?.identity_key !== undefined &&
        row.protected_exposure_key !== null &&
        (visible.identity_key !== row.protected_exposure_key ||
          visible.identity_kind !== row.public_exposure_identity_kind);
      const invalid =
        row.parse_status !== "ready" ||
        (current !== undefined &&
          current.instrument_type !== row.instrument_type) ||
        verifiedConflict;
      if (cashMissing) {
        if (
          !invalid &&
          current !== undefined &&
          visible?.id === current.id &&
          !state.hiddenIds.has(current.id)
        ) {
          clear.push({
            rowId: row.id,
            decision: "accepted",
            rationale:
              "Updated an existing position from a verified report with missing account cash.",
          });
          reasons.set(row.id, [
            "existing_position_matched",
            "account_cash_missing",
          ]);
        }
        continue;
      }
      const key =
        row.public_exposure_identity_kind && row.protected_exposure_key
          ? identityKey(
              row.container_id,
              row.public_exposure_identity_kind,
              row.protected_exposure_key,
              row.instrument_type,
            )
          : null;
      const candidates =
        key &&
        incomingIdentityCounts.get(key) === 1 &&
        existingIdentityGroups.get(key)?.size === 1
          ? (missingByIdentity.get(key) ?? [])
          : [];
      const match =
        !invalid &&
        (!current || state.ignoredIds.has(current.id)) &&
        candidates.length === 1 &&
        candidates[0]?.id !== current?.id
          ? candidates[0]
          : undefined;
      const priorIgnored = current?.review_decision === "ignore";
      if (certified && priorIgnored) continue;
      const identityChanged =
        !certified &&
        !current &&
        (missingPlanning.has(row.container_id) ||
          missingTypes.has(`${row.container_id}:${row.instrument_type}`));
      if (!invalid && (!identityChanged || match)) {
        clear.push({
          rowId: row.id,
          decision: "accepted",
          rationale: `Automatically accepted by ${PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION}.`,
        });
        reasons.set(row.id, [
          isPlaidInvestmentsOutsideFiSecurityType(row.instrument_type)
            ? "excluded_from_fi_planning"
            : "supported_usd_long_position",
          match
            ? "verified_security_identity_matched"
            : current
              ? "existing_position_matched"
              : "new_position_identity_clear",
          ...(row.cost_basis_minor === null ? ["cost_basis_unavailable"] : []),
        ]);
        if (match) matches.set(row.id, match);
        else if (
          priorIgnored &&
          !missingPlanning.has(row.container_id) &&
          !missingTypes.has(`${row.container_id}:${row.instrument_type}`)
        )
          reconsider.add(row.id);
        else if (priorIgnored) {
          clear.pop();
          reasons.delete(row.id);
        } else continue;
        if (!priorIgnored || match || reconsider.has(row.id)) continue;
      }
      quarantines.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO holding_import_quarantines(
        id,household_id,import_id,import_row_id,position_id,reason_code,policy_version,evidence_sha256,detail,created_at
      ) VALUES(?,?,?,?,NULL,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            importId,
            row.id,
            invalid ? "row_validation_failed" : "possible_identity_change",
            PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
            row.snapshot_fingerprint,
            invalid
              ? "The source identity or row data could not be validated. Correct the source before accepting these facts."
              : "The evidence does not establish whether this reported position replaces a prior holding. Keel kept the previous holdings.",
            createdAt,
          ),
      );
    }
    const acceptedRows = new Set(
      decisions
        .filter((item) => item.decision === "accepted")
        .map((item) => item.import_row_id),
    );
    const accepting = new Set(
      clear
        .filter((item) => item.decision === "accepted")
        .map((item) => item.rowId),
    );
    const excludedRows = new Set(
      rows
        .filter((row) => {
          const current = byKey.get(
            containerPositionKey(row.container_id, row.position_fingerprint),
          );
          return (
            current?.review_decision === "ignore" &&
            current.review_source === "manual"
          );
        })
        .map((row) => row.id),
    );
    const inventoryContainers = new Set(
      [...complete].filter(
        (container) =>
          certified &&
          !record.inventory_accepted &&
          !invalidContainers.has(container) &&
          !missingCash.has(container) &&
          !rows.some(
            (row) =>
              row.container_id === container &&
              decisions.some(
                (decision) =>
                  decision.import_row_id === row.id &&
                  decision.decision_source === "manual",
              ),
          ) &&
          rows
            .filter((row) => row.container_id === container)
            .every(
              (row) =>
                (acceptedRows.has(row.id) ||
                  accepting.has(row.id) ||
                  excludedRows.has(row.id)) &&
                !ignoredReports.some((item) => item.import_row_id === row.id),
            ),
      ),
    );
    const acceptsInventory = inventoryContainers.size > 0;
    const matchedPriorIds = new Set(
      [...matches.values()].map((position) => position.id),
    );
    const closed = missing.filter(
      (position) =>
        inventoryContainers.has(position.container_id) &&
        !matchedPriorIds.has(position.id),
    );
    const returned = state.positions.filter(
      (position) =>
        inventoryContainers.has(position.container_id) &&
        position.is_active === 0 &&
        !state.ignoredIds.has(position.id) &&
        reportedKeys.has(
          containerPositionKey(position.container_id, position.position_key),
        ),
    );
    const automaticChangeCount =
      closed.length +
      rows.filter((row) => {
        if (
          !inventoryContainers.has(row.container_id) ||
          excludedRows.has(row.id)
        )
          return false;
        const current = byKey.get(
          containerPositionKey(row.container_id, row.position_fingerprint),
        );
        const prior = current
          ? state.byId.get(state.visibleById.get(current.id) ?? current.id)
          : matches.get(row.id);
        return (
          !prior ||
          prior.is_active === 0 ||
          prior.quantity_micros !== row.quantity_micros ||
          prior.value_minor !== row.unrealized_value_minor ||
          (prior.cost_basis_minor ?? null) !== row.cost_basis_minor
        );
      }).length;
    const inventoryInsert = (version: number, time: string) =>
      this.db
        .prepare(
          `INSERT INTO public_holding_inventories(
      import_id,household_id,source_updated_at,expected_source_version,container_ids_json,change_count,prior_snapshots_json,closed_positions_json,returned_position_ids_json,policy_version,accepted_by_user_id,accepted_at
    ) VALUES(?,?,?,?,?,?,?,?,?,'public-holding-inventory-v1',?,?)`,
        )
        .bind(
          importId,
          identity.household_id,
          record.source_updated_at,
          version,
          JSON.stringify([...inventoryContainers]),
          automaticChangeCount,
          JSON.stringify(
            rows.flatMap((row) => {
              if (!inventoryContainers.has(row.container_id)) return [];
              const current = byKey.get(
                containerPositionKey(
                  row.container_id,
                  row.position_fingerprint,
                ),
              );
              const prior = current
                ? state.byId.get(
                    state.visibleById.get(current.id) ?? current.id,
                  )
                : matches.get(row.id);
              return prior
                ? [
                    {
                      rowId: row.id,
                      snapshotId: prior.snapshot_id,
                      returned: prior.is_active === 0,
                    },
                  ]
                : [];
            }),
          ),
          JSON.stringify(
            closed.map((position) => ({
              positionId: position.id,
              snapshotId: position.snapshot_id,
              applicationId: position.application_id,
            })),
          ),
          JSON.stringify(returned.map((position) => position.id)),
          identity.user_id,
          time,
        );
    for (const position of missing.filter(
      (position) =>
        !record.inventory_accepted &&
        !inventoryContainers.has(position.container_id),
    ))
      quarantines.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO holding_import_quarantines(
      id,household_id,import_id,import_row_id,position_id,reason_code,policy_version,evidence_sha256,detail,created_at
    ) VALUES(?,?,?,NULL,?,'position_not_reported',?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            importId,
            position.id,
            PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
            record.normalized_fingerprint,
            "The account did not report this holding. Keel kept its last accepted value; no sale was inferred.",
            createdAt,
          ),
      );
    const atomicQuarantines =
      certified && missingCash.size > 0 && clear.length > 0;
    if (quarantines.length && !atomicQuarantines)
      await this.db.batch(quarantines);
    if (clear.length) {
      try {
        await this.applyHoldingImport(
          accessSubject,
          importId,
          { currency: "USD", decisions: clear },
          {
            source: "policy",
            policyVersion: PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
            allowPartial: true,
            reasonCodesByRow: reasons,
            ...(atomicQuarantines
              ? { expectedCashlessSourceVersion: state.version }
              : {}),
            rowObservedAtById: new Map(
              rows.flatMap((row) =>
                row.public_observed_on
                  ? [
                      [
                        row.id,
                        `${row.public_observed_on}T00:00:00.000Z`,
                      ] as const,
                    ]
                  : [],
              ),
            ),
            afterApplications: (applications, time) => {
              let version = state.version;
              const reviewStatements = applications.flatMap((application) => {
                const match = matches.get(application.row.id);
                if (!match && !reconsider.has(application.row.id)) return [];
                const current = byKey.get(
                  containerPositionKey(
                    application.row.container_id,
                    application.row.position_fingerprint,
                  ),
                );
                return [
                  this.publicReviewInsert({
                    identity,
                    rowId: application.row.id,
                    reviewKey: `${application.row.container_id}:${application.row.position_fingerprint}`,
                    positionId: application.positionId,
                    snapshotId: application.snapshotId,
                    priorPositionId: match?.id ?? null,
                    priorSnapshotId: match?.snapshot_id ?? null,
                    priorReviewId: current?.review_id ?? null,
                    version: version++,
                    decision: match ? "same" : "separate",
                    source: "policy",
                    createdAt: time,
                    initial: true,
                  }),
                ];
              });
              if (acceptsInventory)
                reviewStatements.push(inventoryInsert(version, time));
              if (atomicQuarantines) reviewStatements.push(...quarantines);
              return reviewStatements;
            },
          },
        );
      } catch (error) {
        if (record.inventory_accepted) {
          const saved = await this.getHoldingImport(accessSubject, importId);
          const applied = new Set(
            saved.rows
              .filter((row) => row.adjudicationStatus === "auto_applied")
              .map((row) => row.id),
          );
          if (clear.some((row) => !applied.has(row.rowId))) throw error;
        } else {
          const saved = await this.db
            .prepare(
              "SELECT import_id FROM public_holding_inventories WHERE import_id=? AND household_id=?",
            )
            .bind(importId, identity.household_id)
            .first();
          if (!saved) throw error;
        }
      }
    } else if (
      record.review_status === "pending_review" &&
      (!incomplete || certified) &&
      rows.every((row) => done.has(row.id) || excludedRows.has(row.id))
    ) {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE source_documents SET review_status='accepted' WHERE id=(SELECT source_document_id FROM holding_imports WHERE id=? AND household_id=?) AND review_status='pending_review'`,
          )
          .bind(importId, identity.household_id),
        ...(acceptsInventory
          ? [inventoryInsert(state.version, createdAt)]
          : []),
      ]);
    }
    if (
      !clear.length &&
      record.review_status !== "pending_review" &&
      acceptsInventory
    )
      await this.db.batch([inventoryInsert(state.version, createdAt)]);
    const preview = await this.getHoldingImport(accessSubject, importId);
    return {
      importId,
      policyVersion: PLAID_INVESTMENTS_HOLDINGS_POLICY_VERSION,
      autoAppliedCount: preview.summary.autoAppliedCount,
      quarantinedCount: preview.summary.quarantinedCount,
      preservedPositionCount: preview.summary.preservedPositionCount,
    };
  }

  private publicImportDetails(
    rows: readonly ImportPreviewRow[],
    state: PublicSourceState,
    preservedJson: string,
  ) {
    const omitted = z.array(z.string()).parse(JSON.parse(preservedJson));
    const reportedGroups = new Set<string>();
    for (const row of rows) {
      if (row.applied_position_id) {
        const visible = state.visibleById.get(row.applied_position_id);
        if (visible) reportedGroups.add(visible);
      }
    }
    const preserved = new Map<string, PublicSourcePosition>();
    for (const id of omitted) {
      const visibleId = state.visibleById.get(id);
      const position = visibleId ? state.byId.get(visibleId) : undefined;
      if (
        position &&
        !reportedGroups.has(position.id) &&
        !state.ignoredIds.has(position.id)
      )
        preserved.set(position.id, position);
    }
    const prior = new Map(
      state.positions
        .filter((position) => !state.hiddenIds.has(position.id))
        .map((position) => [position.id, position]),
    );
    for (const [id, position] of preserved) prior.set(id, position);
    for (const row of rows) {
      const position = row.source_review_prior_position_id
        ? state.byId.get(row.source_review_prior_position_id)
        : undefined;
      if (position) prior.set(position.id, position);
    }
    const display = (position: PublicSourcePosition) => ({
      positionId: position.id,
      containerId: position.container_id,
      name: position.name,
      accountLabel: position.account_label,
      ticker: position.ticker,
      instrumentType: position.instrument_type,
      snapshotId: position.snapshot_id,
      observedAt: position.observed_at,
      quantityMicros: position.quantity_micros,
      valueMinor: position.value_minor,
    });
    return {
      preserved: [...preserved.values()].map(display),
      prior: [...prior.values()].map(display),
    };
  }

  private publicReviewInsert(input: {
    identity: HouseholdIdentity;
    rowId: string;
    reviewKey: string;
    positionId: string | null;
    snapshotId: string | null;
    priorPositionId: string | null;
    priorSnapshotId: string | null;
    priorReviewId: string | null;
    version: number;
    decision: PublicHoldingReviewInput["decision"];
    source: "manual" | "policy";
    createdAt: string;
    initial?: boolean;
  }): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO public_holding_source_reviews(
      id,household_id,review_key,import_row_id,position_id,source_snapshot_id,
      prior_position_id,prior_snapshot_id,prior_review_id,expected_household_version,
      decision,decision_source,policy_version,reviewer_user_id,created_at,initial_acceptance
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.identity.household_id,
        input.reviewKey,
        input.rowId,
        input.positionId,
        input.snapshotId,
        input.priorPositionId,
        input.priorSnapshotId,
        input.priorReviewId,
        input.version,
        input.decision,
        input.source,
        input.source === "policy"
          ? PUBLIC_SOURCE_IDENTITY_POLICY_VERSION
          : null,
        input.identity.user_id,
        input.createdAt,
        input.initial ? 1 : 0,
      );
  }

  public async reviewPublicHoldingImport(
    accessSubject: string,
    importId: string,
    rowId: string,
    rawInput: PublicHoldingReviewInput,
  ): Promise<HoldingImportPreview> {
    const input = PublicHoldingReviewInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const preview = await this.getHoldingImport(accessSubject, importId);
    const row = preview.rows.find((item) => item.id === rowId);
    if (
      preview.provider !== PLAID_INVESTMENTS_PROVIDER ||
      !row ||
      !row.containerId
    )
      throw new Error("Public source position not found.");
    const state = await publicSourceState(
      this.db,
      identity.household_id,
      importId,
    );
    const original = await this.db
      .prepare(
        `SELECT r.position_fingerprint,c.container_id,
      EXISTS(SELECT 1 FROM holding_import_applications a WHERE a.import_row_id=r.id) applied,
      r.parse_status
      FROM holding_import_rows r JOIN holding_import_row_containers c ON c.import_row_id=r.id
      WHERE r.id=? AND r.import_id=? AND r.household_id=?`,
      )
      .bind(rowId, importId, identity.household_id)
      .first<{
        position_fingerprint: string;
        container_id: string;
        applied: number;
        parse_status: string;
      }>();
    if (!original) throw new Error("Public source position not found.");
    const position = state.positions.find(
      (item) =>
        item.container_id === original.container_id &&
        item.position_key === original.position_fingerprint,
    );
    const current = row.sourceReview;
    if (
      current?.appliesToThisReport &&
      current.decision === input.decision &&
      current.priorPositionId ===
        (input.decision === "same" ? input.priorPositionId : null)
    )
      return preview;
    if (
      (row.identityReviewId ?? null) !== input.expectedReviewId ||
      (position?.snapshot_id ?? null) !== input.expectedSourceSnapshotId
    )
      throw new Error(
        "The source decision changed. Reload this report and try again.",
      );
    const prior = input.priorPositionId
      ? state.byId.get(input.priorPositionId)
      : undefined;
    if (
      input.decision === "same" &&
      (!prior ||
        prior.id === position?.id ||
        prior.container_id !== original.container_id ||
        prior.currency !== "USD" ||
        prior.instrument_type !== row.instrumentType ||
        prior.snapshot_id !== input.expectedPriorSnapshotId)
    )
      throw new Error(
        "The prior holding changed or does not match this account.",
      );
    if (input.decision !== "ignore" && row.acceptanceBlocked !== false)
      throw new Error(
        "Correct the source data before accepting this position.",
      );
    if (original.applied === 0 && input.decision !== "ignore") {
      const latest = await this.db
        .prepare(
          `SELECT latest.import_id FROM holding_import_connections current
           JOIN public_holding_import_heads latest ON latest.connection_id=current.connection_id
           WHERE current.import_id=? AND current.household_id=?`,
        )
        .bind(importId, identity.household_id)
        .first<{ import_id: string }>();
      if (latest?.import_id !== importId)
        throw new Error("A newer report is available. Open the latest report.");
    }
    const createdAt = new Date().toISOString();
    const key = `${original.container_id}:${original.position_fingerprint}`;
    if (input.decision === "ignore" && original.applied === 0) {
      const priorReport = await this.db
        .prepare(
          "SELECT review_id FROM public_holding_source_heads WHERE review_key=? AND household_id=?",
        )
        .bind(`report:${row.id}`, identity.household_id)
        .first<{ review_id: string }>();
      await this.db.batch([
        this.publicReviewInsert({
          identity,
          rowId,
          reviewKey: `report:${row.id}`,
          positionId: null,
          snapshotId: null,
          priorPositionId: null,
          priorSnapshotId: null,
          priorReviewId: priorReport?.review_id ?? null,
          version: state.version,
          decision: "ignore",
          source: "manual",
          createdAt,
        }),
      ]);
    } else if (original.applied !== 0) {
      if (!position || !row.identityReviewId || current?.rowId !== rowId)
        throw new Error(
          "Only an unresolved source identity or a saved source decision can be changed here.",
        );
      await this.db.batch([
        this.publicReviewInsert({
          identity,
          rowId,
          reviewKey: key,
          positionId: position.id,
          snapshotId: position.snapshot_id,
          priorPositionId: input.decision === "same" ? prior!.id : null,
          priorSnapshotId:
            input.decision === "same" ? prior!.snapshot_id : null,
          priorReviewId: input.expectedReviewId,
          version: state.version,
          decision: input.decision,
          source: "manual",
          createdAt,
        }),
      ]);
    } else {
      await this.applyHoldingImport(
        accessSubject,
        importId,
        {
          currency: "USD",
          decisions: [
            {
              rowId,
              decision: "accepted",
              rationale:
                input.decision === "same"
                  ? "Confirmed the same holding using the source comparison."
                  : "Confirmed a separate holding.",
            },
          ],
        },
        {
          source: "manual",
          policyVersion: null,
          allowPartial: true,
          reasonCodesByRow: new Map(),
          rowObservedAtById: new Map(
            row.valueObservedOn
              ? [[row.id, `${row.valueObservedOn}T00:00:00.000Z`]]
              : [],
          ),
          afterApplications: (applications, time) =>
            applications.map((application) =>
              this.publicReviewInsert({
                identity,
                rowId,
                reviewKey: key,
                positionId: application.positionId,
                snapshotId: application.snapshotId,
                priorPositionId: input.decision === "same" ? prior!.id : null,
                priorSnapshotId:
                  input.decision === "same" ? prior!.snapshot_id : null,
                priorReviewId: input.expectedReviewId,
                version: state.version,
                decision: input.decision,
                source: "manual",
                createdAt: time,
                initial: true,
              }),
            ),
        },
      );
    }
    await this.db
      .prepare(
        `UPDATE source_documents SET review_status='accepted'
      WHERE id=(SELECT source_document_id FROM holding_imports WHERE id=? AND household_id=?)
      AND review_status='pending_review'
      AND NOT EXISTS(SELECT 1 FROM holding_import_rows r WHERE r.import_id=?
        AND NOT EXISTS(SELECT 1 FROM holding_import_row_decisions d WHERE d.import_row_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM public_holding_source_heads h WHERE h.review_key='report:'||r.id AND h.decision='ignore'))
      AND NOT EXISTS(SELECT 1 FROM holding_import_coverages WHERE import_id=? AND completeness<>'complete')`,
      )
      .bind(importId, identity.household_id, importId, importId)
      .run();
    return this.getHoldingImport(accessSubject, importId);
  }

  public async publicHoldingReviewEffects(
    accessSubject: string,
    importId: string,
    rowId: string,
    priorPositionId: string | null,
  ) {
    const identity = await this.findIdentity(accessSubject);
    const preview = await this.getHoldingImport(accessSubject, importId);
    const row = preview.rows.find((item) => item.id === rowId);
    if (preview.provider !== PLAID_INVESTMENTS_PROVIDER || !row?.containerId)
      throw new Error("Public source position not found.");
    const state = await publicSourceState(
      this.db,
      identity.household_id,
      importId,
    );
    const scopes = new Set(preview.coverage.map((item) => item.containerId));
    const current = row.positionId ? state.byId.get(row.positionId) : undefined;
    const prior = priorPositionId ? state.byId.get(priorPositionId) : undefined;
    if (
      priorPositionId &&
      (!prior ||
        prior.container_id !== row.containerId ||
        prior.id === current?.id ||
        prior.instrument_type !== row.instrumentType ||
        prior.currency !== "USD")
    )
      throw new Error("The prior holding does not match this account.");
    const total = (positions: readonly PublicSourcePosition[]) => {
      const visible = buildPublicSourceState(positions, state.version);
      let sum = 0;
      for (const position of positions) {
        if (
          !scopes.has(position.container_id) ||
          visible.hiddenIds.has(position.id)
        )
          continue;
        if (position.currency !== "USD" || position.value_minor === null)
          return null;
        sum = addMinorUnits(sum, position.value_minor);
      }
      return sum;
    };
    const reported = {
      value_minor: row.administratorNavMinor,
      quantity_micros: row.quantityMicros,
      cost_basis_minor: row.costBasisMinor,
    };
    const proposed: PublicSourcePosition = current
      ? {
          ...current,
          ...(row.decisionSource === null ||
          row.sourceReview?.decision === "ignore"
            ? reported
            : {}),
        }
      : {
          id: `proposal:${row.id}`,
          container_id: row.containerId,
          position_key: row.id,
          name: row.positionName,
          account_label: row.ownerLabel,
          ticker: row.ticker,
          quantity_micros: row.quantityMicros,
          value_minor: row.administratorNavMinor,
          currency: "USD",
          instrument_type: row.instrumentType ?? "",
          snapshot_id: row.id,
          observed_at: preview.observedAt,
          applied_at: new Date().toISOString(),
          application_id: row.id,
          identity_kind: null,
          identity_key: null,
          review_id: null,
          review_decision: null,
          prior_position_id: null,
          review_source: null,
          review_created_at: null,
        };
    const currentInventory =
      preview.inventory?.currentContainerIds.includes(row.containerId) === true;
    const restoringPrior =
      current?.review_decision === "same" ? current.prior_position_id : null;
    const effect = (decision: "same" | "separate" | "ignore") =>
      total([
        ...state.positions
          .filter((position) => position.id !== proposed.id)
          .map((position) =>
            currentInventory &&
            decision !== "same" &&
            position.id === restoringPrior
              ? { ...position, is_active: 1 }
              : position,
          ),
        {
          ...proposed,
          ...(currentInventory && decision !== "ignore"
            ? { is_active: 1 }
            : {}),
          review_decision: decision,
          prior_position_id: decision === "same" ? priorPositionId : null,
        },
      ]);
    return PublicHoldingReviewEffectsSchema.parse({
      rowId,
      priorPositionId,
      currentTotalMinor: total(state.positions),
      sameTotalMinor: prior ? effect("same") : null,
      separateTotalMinor: effect("separate"),
      ignoreTotalMinor: effect("ignore"),
    });
  }

  private importPreviewRowsStatement(publicSource: boolean) {
    return this.db.prepare(`SELECT
             row.id,
             row_scope.container_id,
             ${publicSource ? "row.public_observed_on," : ""}
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
             row.public_exposure_identity_kind,
             row.protected_exposure_key,
             row.instrument_type,
             row.parse_status,
             row.issue_codes_json,
             position.id AS existing_position_id,
             snapshot.id AS existing_snapshot_id,
             application.outcome AS application_outcome,
             application.position_id AS applied_position_id,
             decision.decision_source,
             decision.decision AS recorded_decision,
             decision.reason_codes_json,
             quarantine.reason_code AS quarantine_reason_code,
             quarantine.detail AS quarantine_detail,
             ${
               publicSource
                 ? `source_head.review_id source_review_id,source_head.decision source_review_decision,
               source_head.prior_position_id source_review_prior_position_id,source_review.decision_source source_review_source,
               source_review.created_at source_review_created_at,source_head.import_row_id source_review_row_id,
               (SELECT import_id FROM holding_import_rows WHERE id=source_head.import_row_id) source_review_import_id,
               report_head.review_id report_review_id,report_review.created_at report_review_created_at`
                 : `NULL source_review_id,NULL source_review_decision,NULL source_review_prior_position_id,NULL source_review_source,NULL source_review_created_at,NULL source_review_row_id,NULL source_review_import_id,NULL report_review_id,NULL report_review_created_at`
             }
           FROM holding_import_rows row
           JOIN holding_imports import ON import.id = row.import_id
           LEFT JOIN holding_import_row_reported_economics_evidence
             economics_evidence
             ON economics_evidence.import_row_id = row.id
           JOIN holding_import_row_containers row_scope
             ON row_scope.import_row_id = row.id
           ${
             publicSource
               ? `LEFT JOIN public_holding_source_heads source_head ON source_head.review_key=row_scope.container_id||':'||row.position_fingerprint
             LEFT JOIN public_holding_source_reviews source_review ON source_review.id=source_head.review_id
             LEFT JOIN public_holding_source_heads report_head ON report_head.review_key='report:'||row.id
             LEFT JOIN public_holding_source_reviews report_review ON report_review.id=report_head.review_id`
               : ""
           }
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
             ON quarantine.import_id = row.import_id
             AND quarantine.import_row_id = row.id
           WHERE row.import_id = ? AND row.household_id = ?
           ORDER BY row.source_row_number`);
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
            LEFT JOIN holding_import_row_decisions decision
              ON decision.import_row_id = quarantine.import_row_id
            WHERE quarantine.import_id = import.id
              AND quarantine.import_row_id IS NOT NULL
              AND decision.id IS NULL) AS quarantined_count,
           (SELECT COUNT(*) FROM holding_import_quarantines quarantine
            WHERE quarantine.import_id = import.id
              AND quarantine.position_id IS NOT NULL)
             AS preserved_position_count,
           (SELECT json_group_array(quarantine.position_id)
            FROM holding_import_quarantines quarantine
            WHERE quarantine.import_id=import.id AND quarantine.position_id IS NOT NULL)
             AS preserved_position_ids_json
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
        this.importPreviewRowsStatement(
          provider.data === PLAID_INVESTMENTS_PROVIDER,
        ).bind(importId, identity.household_id),
      ),
      all<Omit<ImportCoveragePreviewRow, "reported_row_count">>(
        this.db
          .prepare(
            `SELECT
             coverage.container_id,
             version.display_label,
             coverage.completeness
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
    const reportedRowsByContainer = new Map<string, number>();
    const cashConfirmed = new Set<string>();
    for (const row of rows) {
      if (row.instrument_type === "cash") cashConfirmed.add(row.container_id);
      reportedRowsByContainer.set(
        row.container_id,
        (reportedRowsByContainer.get(row.container_id) ?? 0) + 1,
      );
    }
    const exposureNamesByRowId = new Map<string, string[]>();
    currentExposures.forEach((record) => {
      const names = exposureNamesByRowId.get(record.import_row_id) ?? [];
      if (!names.includes(record.canonical_name)) {
        names.push(record.canonical_name);
      }
      exposureNamesByRowId.set(record.import_row_id, names);
    });
    const sourceState =
      provider.data === PLAID_INVESTMENTS_PROVIDER
        ? await publicSourceState(this.db, identity.household_id, importId)
        : null;
    let inventory: HoldingImportPreview["inventory"];
    if (sourceState?.inventoryDetails) {
      const { zeroCashContainerIds, ...details } =
        HoldingImportPreviewSchema.shape.inventory
          .unwrap()
          .extend({ zeroCashContainerIds: z.array(z.string()) })
          .parse(JSON.parse(sourceState.inventoryDetails));
      inventory = details;
      for (const containerId of zeroCashContainerIds)
        cashConfirmed.add(containerId);
    }
    const previewRows: HoldingImportRowPreview[] = rows.map((row) => {
      const positionId = row.applied_position_id ?? row.existing_position_id;
      const current = positionId
        ? sourceState?.byId.get(positionId)
        : undefined;
      const ignored =
        (row.report_review_id !== null && row.decision_source === null) ||
        (row.source_review_decision === "ignore" &&
          (row.source_review_row_id === row.id ||
            row.decision_source !== null ||
            (inventory?.currentContainerIds.includes(row.container_id) &&
              current?.review_source === "manual")));
      return {
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
        action:
          provider.data === PLAID_INVESTMENTS_PROVIDER &&
          row.quarantine_reason_code !== null &&
          row.decision_source === null
            ? "needs_attention"
            : actionFor(row),
        issues: [
          ...issues(row.issue_codes_json),
          ...(row.decision_source === null && row.quarantine_detail !== null
            ? [row.quarantine_detail]
            : []),
        ],
        adjudicationStatus: ignored
          ? "ignored"
          : row.decision_source === "policy"
            ? row.recorded_decision === "rejected"
              ? "ignored"
              : "auto_applied"
            : row.decision_source === "manual"
              ? "manually_resolved"
              : row.quarantine_reason_code !== null
                ? "quarantined"
                : "pending_review",
        decisionSource: ignored ? "manual" : row.decision_source,
        reasonCodes:
          row.reason_codes_json === null ? [] : issues(row.reason_codes_json),
        ...(sourceState
          ? {
              containerId: row.container_id,
              instrumentType: row.instrument_type,
              ...(row.public_observed_on
                ? { valueObservedOn: row.public_observed_on }
                : {}),
              positionId,
              currentSnapshotId: current?.snapshot_id ?? null,
              identityReviewId: row.source_review_id,
              ...(current
                ? {
                    currentValueMinor: current.value_minor,
                    currentQuantityMicros: current.quantity_micros,
                    currentObservedAt: current.observed_at,
                  }
                : {}),
              hasVerifiedSecurityIdentity:
                row.protected_exposure_key !== null &&
                row.public_exposure_identity_kind !== null,
              acceptanceBlocked:
                row.parse_status !== "ready" ||
                (current !== undefined &&
                  (current.instrument_type !== row.instrument_type ||
                    (current.identity_key !== null &&
                      row.protected_exposure_key !== null &&
                      (current.identity_key !== row.protected_exposure_key ||
                        current.identity_kind !==
                          row.public_exposure_identity_kind)))),
              sourceReview:
                row.decision_source === null &&
                row.report_review_id &&
                row.report_review_created_at
                  ? {
                      id: row.report_review_id,
                      decision: "ignore",
                      priorPositionId: null,
                      decisionSource: "manual",
                      createdAt: row.report_review_created_at,
                      appliesToThisReport: true,
                      importId,
                      rowId: row.id,
                    }
                  : row.source_review_id &&
                      row.source_review_decision &&
                      row.source_review_source &&
                      row.source_review_created_at &&
                      row.source_review_import_id &&
                      row.source_review_row_id
                    ? {
                        id: row.source_review_id,
                        decision: row.source_review_decision,
                        priorPositionId: row.source_review_prior_position_id,
                        decisionSource: row.source_review_source,
                        createdAt: row.source_review_created_at,
                        appliesToThisReport:
                          row.source_review_decision !== "ignore" ||
                          row.source_review_row_id === row.id ||
                          row.decision_source !== null,
                        importId: row.source_review_import_id,
                        rowId: row.source_review_row_id,
                      }
                    : null,
            }
          : {}),
      };
    });
    const publicDetails = sourceState
      ? this.publicImportDetails(
          rows,
          sourceState,
          importRow.preserved_position_ids_json,
        )
      : { preserved: [], prior: [] };
    const unresolvedCount = sourceState
      ? previewRows.filter((row) => row.adjudicationStatus === "quarantined")
          .length
      : importRow.quarantined_count;
    const actions = previewRows.map((row) => row.action);
    const observedAt =
      importRow.effective_date === null
        ? importRow.retrieved_at
        : `${importRow.effective_date}T00:00:00.000Z`;
    const status =
      unresolvedCount > 0
        ? "quarantined"
        : inventory?.complete ||
            importRow.review_status !== "pending_review" ||
            (previewRows.every((row) => row.decisionSource !== null) &&
              coverage.every((item) => item.completeness === "complete") &&
              (previewRows.length > 0 ||
                importRow.preserved_position_count > 0))
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
        quarantinedCount: unresolvedCount,
        preservedPositionCount: sourceState
          ? publicDetails.preserved.length
          : importRow.preserved_position_count,
      },
      coverage: coverage.map((record) => ({
        containerId: record.container_id,
        displayLabel: record.display_label,
        completeness: record.completeness,
        reportedRowCount: reportedRowsByContainer.get(record.container_id) ?? 0,
        ...(inventory?.sourceUpdatedAt &&
        record.completeness === "complete" &&
        !cashConfirmed.has(record.container_id)
          ? { cashMissing: true as const }
          : {}),
      })),
      rows: previewRows,
      ...(sourceState
        ? {
            preservedPositions: publicDetails.preserved,
            priorPositions: publicDetails.prior,
            ...(inventory ? { inventory } : {}),
          }
        : {}),
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
        `SELECT provider, EXISTS(SELECT 1 FROM holding_import_rows price_row
           JOIN holding_import_share_prices price ON price.import_row_id=price_row.id
           WHERE price_row.import_id=holding_imports.id) has_share_prices
         FROM holding_imports
         WHERE id = ? AND household_id = ?`,
      )
      .bind(importId, identity.household_id)
      .first<{ provider: string; has_share_prices: number }>();
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
      this.importDecisionRowsStatement(
        provider === PLAID_INVESTMENTS_PROVIDER,
      ).bind(importId, identity.household_id),
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
        input.decisions.every((requested) => {
          const recorded = existingDecisions.find(
            (decision) => decision.import_row_id === requested.rowId,
          );
          return (
            recorded !== undefined &&
            recorded.decision_source === decisionContext.source &&
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
      if (importProvider.has_share_prices)
        await new D1PriceProxyRepository(this.db).refresh(accessSubject);
      if (PrivateHoldingImportProviderSchema.safeParse(provider).success)
        await new D1GpReportedTotalRepository(this.db).refresh(accessSubject);
      return this.getApplyResult(
        identity.household_id,
        importId,
        provider === PLAID_INVESTMENTS_PROVIDER,
      );
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
      prepareImportPositions(
        this.db,
        provider === PLAID_INVESTMENTS_PROVIDER,
      ).bind(
        ...(provider === PLAID_INVESTMENTS_PROVIDER
          ? [importId, identity.household_id, provider]
          : [identity.household_id, provider]),
      ),
    );
    const snapshots = await all<ExistingSnapshotRow>(
      this.importSnapshotRowsStatement(
        provider === PLAID_INVESTMENTS_PROVIDER,
      ).bind(identity.household_id, importId),
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
        );
        // Plaid's accepted import row already retains the reported label. Its
        // canonical public mapping is completed separately; a legacy unresolved
        // label row would duplicate that evidence for every new position.
        if (provider !== PLAID_INVESTMENTS_PROVIDER) {
          statements.push(
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
        }
        outcome = "created_position";
      } else {
        outcome = "appended_snapshot";
      }

      const decisionId = crypto.randomUUID();
      const reasonCodes = decisionContext.reasonCodesByRow.get(row.id) ?? [];
      const guarded =
        decisionContext.expectedCashlessSourceVersion !== undefined &&
        reasonCodes.includes("account_cash_missing");
      // An application requires its decision. A concurrent ignore or graph edit
      // suppresses the decision below, which rolls the application batch back.
      statements.push(
        this.rowDecisionStatement(guarded).bind(
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
          JSON.stringify(reasonCodes),
          createdAt,
          ...(guarded
            ? [
                identity.household_id,
                decisionContext.expectedCashlessSourceVersion,
                row.id,
              ]
            : []),
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
              decisionContext.rowObservedAtById?.get(row.id) ??
                (row.effective_date === null
                  ? row.retrieved_at
                  : `${row.effective_date}T00:00:00.000Z`),
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
    statements.push(
      ...(decisionContext.afterApplications?.(applications, createdAt) ?? []),
    );
    await this.db.batch(statements);
    await new D1ExposureRepository(this.db).reconcileAcceptedImportExposures(
      accessSubject,
      importId,
    );
    if (importProvider.has_share_prices)
      await new D1PriceProxyRepository(this.db).refresh(accessSubject);
    if (PrivateHoldingImportProviderSchema.safeParse(provider).success)
      await new D1GpReportedTotalRepository(this.db).refresh(accessSubject);
    return this.getApplyResult(
      identity.household_id,
      importId,
      provider === PLAID_INVESTMENTS_PROVIDER,
    );
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

    const existingContainers = await all<CanonicalContainerRow>(
      this.db
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
             AND container.protected_account_key IN (SELECT value FROM json_each(?))
             AND NOT EXISTS (
               SELECT 1
               FROM ownership_container_versions later
               WHERE later.supersedes_version_id = version.id
             )`,
        )
        .bind(
          identity.household_id,
          connection.id,
          JSON.stringify(
            scope.containers.map((container) => container.protectedAccountKey),
          ),
        ),
    );
    const existingByKey = new Map(
      existingContainers.map((container) => [
        container.protected_account_key,
        container,
      ]),
    );
    const containersByKey = new Map<string, CanonicalContainerRow>();
    for (const containerScope of scope.containers) {
      const existing =
        existingByKey.get(containerScope.protectedAccountKey) ?? null;
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

  private rowDecisionStatement(guarded: boolean) {
    return this.db.prepare(
      `INSERT INTO holding_import_row_decisions (
               id, household_id, import_row_id, reviewer_user_id, decision,
               matched_position_id, currency, reviewed_snapshot_fingerprint,
               rationale, decision_source, policy_version, reason_codes_json,
               decided_at
             ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             ${
               guarded
                 ? `WHERE COALESCE((SELECT version FROM public_holding_source_versions WHERE household_id=?),0)=?
               AND NOT EXISTS(SELECT 1 FROM public_holding_source_heads WHERE review_key='report:'||? AND decision='ignore')`
                 : ""
             }`,
    );
  }

  private importDecisionRowsStatement(publicSource: boolean) {
    return this.db.prepare(`SELECT
             decision.import_row_id,
             decision.decision,
             decision.matched_position_id,
             decision.currency,
             decision.rationale,
             decision.decision_source
           FROM holding_import_rows row
           CROSS JOIN holding_import_row_decisions decision ON decision.import_row_id = row.id
           WHERE row.import_id = ? AND row.household_id = ? AND decision.household_id=row.household_id ${publicSource ? "AND row.position_kind='direct'" : ""}`);
  }
  private importSnapshotRowsStatement(publicSource: boolean) {
    return this.db
      .prepare(`SELECT snapshot.id, snapshot.position_id, snapshot.snapshot_fingerprint
           FROM holding_import_rows row
           CROSS JOIN holding_import_row_containers scope ON scope.import_row_id = row.id
           CROSS JOIN holding_position_ownerships ownership
             ON ownership.container_id = scope.container_id
             AND ownership.protected_position_key = row.position_fingerprint
             AND NOT EXISTS (SELECT 1 FROM holding_position_ownerships later
               WHERE later.supersedes_ownership_id = ownership.id)
           CROSS JOIN holding_position_snapshots snapshot
             ON snapshot.position_id = ownership.position_id
             AND snapshot.snapshot_fingerprint = row.snapshot_fingerprint
           WHERE row.household_id = ? AND row.import_id = ? ${publicSource ? "AND row.position_kind='direct'" : ""}`);
  }
  private async getApplyResult(
    householdId: string,
    importId: string,
    publicSource = false,
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
         CROSS JOIN holding_import_row_decisions decision
           ON decision.import_row_id = row.id
         LEFT JOIN holding_import_applications application
           ON application.import_row_id = row.id
         WHERE row.import_id = ? AND row.household_id = ? ${publicSource ? "AND row.position_kind='direct'" : ""}`,
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
