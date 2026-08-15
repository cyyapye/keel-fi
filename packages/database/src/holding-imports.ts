import {
  AngelListInvestmentCsvRowSchema,
  isRobinhoodFiPlanningSecurityType,
  isRobinhoodOutsideFiSecurityType,
  ROBINHOOD_CRYPTO_OUTSIDE_FI_ISSUE,
  RobinhoodHoldingRowSchema,
  type AngelListInvestmentCsvRow,
  type RobinhoodHoldingRow,
} from "@keel/connectors";
import {
  HoldingImportApplyInputSchema,
  HoldingImportProviderSchema,
  HoldingImportSummariesSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  type HoldingImportApplyInput,
  type HoldingImportApplyResult,
  type HoldingImportPreview,
  type HoldingImportRowPreview,
  type HoldingImportSummary,
} from "@keel/domain";
import { z } from "zod";

const MAX_IMPORT_BYTES = 1_048_576;
const MAX_IMPORT_ROWS = 500;
const ANGELLIST_PROVIDER = "angellist";
const ANGELLIST_PARSER_SCHEMA = "angellist_investments_v1";
const ANGELLIST_SOURCE_LABEL = "AngelList export";
const ROBINHOOD_PROVIDER = "robinhood";
const ROBINHOOD_PARSER_SCHEMA = "plaid_robinhood_holdings_v1";
const ROBINHOOD_SOURCE_LABEL = "Robinhood via Plaid";
export const ROBINHOOD_HOLDINGS_POLICY_VERSION = "robinhood-holdings-auto-v2";
const NON_BLOCKING_ROBINHOOD_ISSUES = new Set([
  "Cost basis is unavailable.",
  ROBINHOOD_CRYPTO_OUTSIDE_FI_ISSUE,
]);

const HoldingImportStageInputSchema = z
  .object({
    objectKey: z.string().min(1).max(1_024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().positive().max(MAX_IMPORT_BYTES),
    effectiveDate: IsoDateSchema,
    retrievedAt: IsoTimestampSchema,
    rows: z.array(AngelListInvestmentCsvRowSchema).min(1).max(MAX_IMPORT_ROWS),
  })
  .strict();

export type HoldingImportStageInput = z.infer<
  typeof HoldingImportStageInputSchema
>;

const RobinhoodHoldingImportStageInputSchema = z
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
    rows: z.array(RobinhoodHoldingRowSchema).min(1).max(MAX_IMPORT_ROWS),
  })
  .strict();

export type RobinhoodHoldingImportStageInput = z.infer<
  typeof RobinhoodHoldingImportStageInputSchema
>;

export type HoldingImportStageResult = {
  readonly created: boolean;
  readonly preview: HoldingImportPreview;
};

export type RobinhoodImportAdjudication = {
  readonly importId: string;
  readonly policyVersion: typeof ROBINHOOD_HOLDINGS_POLICY_VERSION;
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
  decision_count: number;
  accepted_count: number;
  application_count: number;
  auto_applied_count: number;
  quarantined_count: number;
  preserved_position_count: number;
};

type ImportPreviewRow = {
  id: string;
  source_row_number: number;
  legal_vehicle_name: string;
  exposure_label: string;
  owner_label: string;
  provider_status: "live" | "realized";
  invested_on: string;
  invested_minor: number;
  unrealized_value_minor: number | null;
  unrealized_value_state: "reported" | "locked" | "not_reported";
  realized_value_minor: number;
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
  invested_on: string;
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
  currency_hint: string | null;
  parse_status: "ready" | "needs_attention";
  source_document_id: string;
  effective_date: string | null;
  retrieved_at: string;
};

type ExistingPositionRow = {
  id: string;
  position_fingerprint: string;
  currency: string;
};

type RobinhoodExistingPositionRow = ExistingPositionRow & {
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

type RobinhoodAdjudicationRow = {
  id: string;
  position_fingerprint: string;
  snapshot_fingerprint: string;
  instrument_type: string;
  parse_status: "ready" | "needs_attention";
  cost_basis_minor: number | null;
  issue_codes_json: string;
};

type RobinhoodAdjudicationImport = {
  normalized_fingerprint: string;
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
  row: AngelListInvestmentCsvRow,
): Promise<string> {
  return sha256(
    JSON.stringify([
      "angellist-position-snapshot-v1",
      row.naturalKeySha256,
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

async function robinhoodSnapshotFingerprint(
  row: RobinhoodHoldingRow,
  retrievedAt: string,
): Promise<string> {
  return sha256(
    JSON.stringify([
      "robinhood-position-snapshot-v1",
      row.naturalKeySha256,
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

export class D1HoldingImportRepository {
  public constructor(private readonly db: D1Database) {}

  public async listPendingHoldingImports(
    accessSubject: string,
  ): Promise<HoldingImportSummary[]> {
    const identity = await this.findIdentity(accessSubject);
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
             AND import.provider IN ('angellist', 'robinhood')
             AND document.review_status = 'pending_review'
           ORDER BY import.created_at DESC
           LIMIT 20`,
        )
        .bind(identity.household_id),
    );
    return HoldingImportSummariesSchema.parse(
      rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        status:
          row.provider === ROBINHOOD_PROVIDER && row.quarantined_count > 0
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
         WHERE import.household_id = ? AND document.sha256 = ?`,
      )
      .bind(identity.household_id, sha)
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
    const existing = await this.findHoldingImportBySourceHash(
      accessSubject,
      input.sha256,
    );
    if (existing !== null) {
      return { created: false, preview: existing };
    }

    const identity = await this.findIdentity(accessSubject);
    const duplicateCounts = new Map<string, number>();
    input.rows.forEach((row) => {
      duplicateCounts.set(
        row.naturalKeySha256,
        (duplicateCounts.get(row.naturalKeySha256) ?? 0) + 1,
      );
    });
    const preparedRows = await Promise.all(
      input.rows.map(async (row) => ({
        row,
        snapshotFingerprint: await snapshotFingerprint(row),
        duplicate: (duplicateCounts.get(row.naturalKeySha256) ?? 0) > 1,
      })),
    );
    const importId = crypto.randomUUID();
    const sourceDocumentId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO source_documents (
             id, household_id, object_key, file_name, content_type, byte_size,
             sha256, effective_date, retrieved_at, source_label, review_status,
             created_at
           ) VALUES (?, ?, ?, 'angellist-investments.csv', 'text/csv', ?, ?, ?,
             ?, ?, 'pending_review', ?)`,
        )
        .bind(
          sourceDocumentId,
          identity.household_id,
          input.objectKey,
          input.byteSize,
          input.sha256,
          input.effectiveDate,
          input.retrievedAt,
          ANGELLIST_SOURCE_LABEL,
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
          ANGELLIST_PROVIDER,
          ANGELLIST_PARSER_SCHEMA,
          preparedRows.length,
          identity.user_id,
          createdAt,
        ),
    ];

    preparedRows.forEach(
      ({ row, snapshotFingerprint: fingerprint, duplicate }) => {
        const issueCodes = duplicate ? ["duplicate_natural_key"] : [];
        statements.push(
          this.db
            .prepare(
              `INSERT INTO holding_import_rows (
               id, household_id, import_id, source_row_number,
               position_fingerprint, snapshot_fingerprint, legal_vehicle_name,
               owner_label, exposure_label, provider_status, invested_on,
               invested_minor, allocation_minor, unrealized_value_minor,
               unrealized_value_state, realized_value_minor, net_value_minor,
               net_value_state, instrument_type, currency_hint, parse_status,
               issue_codes_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'USD', ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              identity.household_id,
              importId,
              row.rowNumber,
              row.naturalKeySha256,
              fingerprint,
              row.fundName,
              row.investmentEntity,
              row.companyOrFund,
              row.status.toLowerCase(),
              row.investDate,
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
              createdAt,
            ),
        );
      },
    );

    try {
      await this.db.batch(statements);
    } catch (error) {
      const raced = await this.findHoldingImportBySourceHash(
        accessSubject,
        input.sha256,
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

  public async findRobinhoodHoldingImportByFingerprint(
    accessSubject: string,
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
         WHERE candidate.household_id = ?
           AND candidate.provider = 'robinhood'
           AND candidate.normalized_fingerprint = ?
           AND candidate.id = (
             SELECT latest.id
             FROM holding_imports latest
             WHERE latest.household_id = candidate.household_id
               AND latest.provider = candidate.provider
             ORDER BY latest.created_at DESC, latest.id DESC
             LIMIT 1
           )`,
      )
      .bind(identity.household_id, fingerprint)
      .first<{ id: string }>();
    return existing === null
      ? null
      : this.getHoldingImport(accessSubject, existing.id);
  }

  public async stageRobinhoodHoldingImport(
    accessSubject: string,
    rawInput: RobinhoodHoldingImportStageInput,
  ): Promise<HoldingImportStageResult> {
    const input = RobinhoodHoldingImportStageInputSchema.parse(rawInput);
    const existing = await this.findRobinhoodHoldingImportByFingerprint(
      accessSubject,
      input.normalizedFingerprint,
    );
    if (existing !== null) {
      return { created: false, preview: existing };
    }

    const identity = await this.findIdentity(accessSubject);
    const preparedRows = await Promise.all(
      input.rows.map(async (row) => ({
        row,
        snapshotFingerprint: await robinhoodSnapshotFingerprint(
          row,
          input.retrievedAt,
        ),
      })),
    );
    const importId = crypto.randomUUID();
    const sourceDocumentId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO source_documents (
             id, household_id, object_key, file_name, content_type, byte_size,
             sha256, effective_date, retrieved_at, source_label, review_status,
             created_at
           ) VALUES (?, ?, ?, 'robinhood-holdings.json', 'application/json', ?,
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
          ROBINHOOD_SOURCE_LABEL,
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
          ROBINHOOD_PROVIDER,
          ROBINHOOD_PARSER_SCHEMA,
          input.normalizedFingerprint,
          preparedRows.length,
          identity.user_id,
          createdAt,
        ),
    ];

    preparedRows.forEach(({ row, snapshotFingerprint: fingerprint }) => {
      const exposureLabel =
        row.ticker === null
          ? row.securityName
          : `${row.ticker} · ${row.securityName}`;
      const costBasisPlaceholder = row.costBasisMinor ?? 0;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO holding_import_rows (
               id, household_id, import_id, source_row_number,
               position_fingerprint, snapshot_fingerprint, legal_vehicle_name,
               owner_label, exposure_label, provider_status, invested_on,
               invested_minor, allocation_minor, unrealized_value_minor,
               unrealized_value_state, realized_value_minor, net_value_minor,
               net_value_state, instrument_type, currency_hint, parse_status,
               issue_codes_json, position_kind, quantity_micros, ticker,
               cost_basis_minor, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?,
               'reported', 0, ?, 'reported', ?, 'USD', ?, ?, 'direct', ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            importId,
            row.rowNumber,
            row.naturalKeySha256,
            fingerprint,
            row.securityName,
            row.accountLabel,
            exposureLabel,
            row.observedOn,
            costBasisPlaceholder,
            costBasisPlaceholder,
            row.marketValueMinor,
            row.marketValueMinor,
            row.securityType,
            row.issues.every((issue) =>
              NON_BLOCKING_ROBINHOOD_ISSUES.has(issue),
            )
              ? "ready"
              : "needs_attention",
            JSON.stringify(row.issues),
            row.quantityMicros,
            row.ticker,
            row.costBasisMinor,
            createdAt,
          ),
      );
    });

    try {
      await this.db.batch(statements);
    } catch (error) {
      const raced = await this.findRobinhoodHoldingImportByFingerprint(
        accessSubject,
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

  public async hasAcceptedRobinhoodPlanningPositions(
    accessSubject: string,
  ): Promise<boolean> {
    const identity = await this.findIdentity(accessSubject);
    const rows = await all<{ instrument_type: string }>(
      this.db
        .prepare(
          `SELECT instrument_type
         FROM holding_positions
         WHERE household_id = ? AND provider = 'robinhood'`,
        )
        .bind(identity.household_id),
    );
    return rows.some((row) =>
      isRobinhoodFiPlanningSecurityType(row.instrument_type),
    );
  }

  public async autoAdjudicateRobinhoodHoldingImport(
    accessSubject: string,
    importId: string,
  ): Promise<RobinhoodImportAdjudication> {
    const identity = await this.findIdentity(accessSubject);
    const [importRecord, rows, positions, recordedDecisions] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT normalized_fingerprint
           FROM holding_imports
           WHERE id = ? AND household_id = ? AND provider = 'robinhood'`,
          )
          .bind(importId, identity.household_id)
          .first<RobinhoodAdjudicationImport>(),
        all<RobinhoodAdjudicationRow>(
          this.db
            .prepare(
              `SELECT id, position_fingerprint, snapshot_fingerprint,
                    instrument_type, parse_status, cost_basis_minor,
                    issue_codes_json
             FROM holding_import_rows
             WHERE import_id = ? AND household_id = ?
             ORDER BY source_row_number`,
            )
            .bind(importId, identity.household_id),
        ),
        all<RobinhoodExistingPositionRow>(
          this.db
            .prepare(
              `SELECT id, position_fingerprint, currency, instrument_type
             FROM holding_positions
             WHERE household_id = ? AND provider = 'robinhood'`,
            )
            .bind(identity.household_id),
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
    if (importRecord === null || rows.length === 0) {
      throw new Error("Robinhood holding import not found.");
    }
    if (
      recordedDecisions.some(
        (decision) => decision.decision_source === "manual",
      )
    ) {
      throw new Error(
        "Robinhood holding import was already reviewed manually.",
      );
    }
    if (recordedDecisions.length > 0) {
      const preview = await this.getHoldingImport(accessSubject, importId);
      return {
        importId,
        policyVersion: ROBINHOOD_HOLDINGS_POLICY_VERSION,
        autoAppliedCount: preview.summary.autoAppliedCount,
        quarantinedCount: preview.summary.quarantinedCount,
        preservedPositionCount: preview.summary.preservedPositionCount,
      };
    }

    const currentFingerprints = new Set(
      rows.map((row) => row.position_fingerprint),
    );
    const positionsByFingerprint = new Map(
      positions.map((position) => [position.position_fingerprint, position]),
    );
    const missingPositions = positions.filter(
      (position) => !currentFingerprints.has(position.position_fingerprint),
    );
    const missingPlanningPositions = missingPositions.filter((position) =>
      isRobinhoodFiPlanningSecurityType(position.instrument_type),
    );
    const possibleIdentityChange =
      positions.length > 0 && missingPlanningPositions.length > 0;
    const clearRows: RobinhoodAdjudicationRow[] = [];
    const quarantineStatements: D1PreparedStatement[] = [];
    const createdAt = new Date().toISOString();

    rows.forEach((row) => {
      const rowValidationFailed = row.parse_status === "needs_attention";
      const identityChanged =
        possibleIdentityChange &&
        !positionsByFingerprint.has(row.position_fingerprint);
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
            ROBINHOOD_HOLDINGS_POLICY_VERSION,
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
            ROBINHOOD_HOLDINGS_POLICY_VERSION,
            importRecord.normalized_fingerprint,
            "Robinhood did not report this prior position. Keel preserved its last accepted value and did not infer a sale.",
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
          isRobinhoodOutsideFiSecurityType(row.instrument_type)
            ? "excluded_from_fi_planning"
            : "supported_usd_long_position",
          positionsByFingerprint.has(row.position_fingerprint)
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
            rationale: `Automatically accepted by ${ROBINHOOD_HOLDINGS_POLICY_VERSION}.`,
          })),
        },
        {
          source: "policy",
          policyVersion: ROBINHOOD_HOLDINGS_POLICY_VERSION,
          allowPartial: true,
          reasonCodesByRow,
        },
      );
    }

    const preview = await this.getHoldingImport(accessSubject, importId);
    return {
      importId,
      policyVersion: ROBINHOOD_HOLDINGS_POLICY_VERSION,
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

    const rows = await all<ImportPreviewRow>(
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
             row.invested_minor,
             row.unrealized_value_minor,
             row.unrealized_value_state,
             row.realized_value_minor,
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
           LEFT JOIN holding_positions position
             ON position.household_id = row.household_id
             AND position.provider = import.provider
             AND position.position_fingerprint = row.position_fingerprint
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
    );
    const previewRows: HoldingImportRowPreview[] = rows.map((row) => ({
      id: row.id,
      sourceRowNumber: row.source_row_number,
      positionName: row.legal_vehicle_name,
      exposureName: row.exposure_label,
      ownerLabel: row.owner_label,
      providerStatus: row.provider_status === "live" ? "Live" : "Realized",
      investedOn: row.invested_on,
      investedMinor: row.invested_minor,
      administratorNavMinor: row.unrealized_value_minor,
      administratorNavState: row.unrealized_value_state,
      realizedValueMinor: row.realized_value_minor,
      ticker: row.ticker,
      quantityMicros: row.quantity_micros,
      costBasisMinor: row.cost_basis_minor,
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
        : importRow.decision_count === importRow.row_count &&
            importRow.application_count === importRow.accepted_count
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
             row.currency_hint,
             row.parse_status,
             import.source_document_id,
             document.effective_date,
             document.retrieved_at
           FROM holding_import_rows row
           JOIN holding_imports import ON import.id = row.import_id
           JOIN source_documents document ON document.id = import.source_document_id
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
          `SELECT id, position_fingerprint, currency
           FROM holding_positions
           WHERE household_id = ? AND provider = ?`,
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
    const positionsByFingerprint = new Map(
      positions.map((position) => [position.position_fingerprint, position]),
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
          ? positionsByFingerprint.get(row.position_fingerprint)
          : positionsById.get(requestedMatch);
      if (requestedMatch !== null && position === undefined) {
        throw new Error("Matched holding position not found.");
      }
      if (
        requestedMatch !== null &&
        position?.position_fingerprint !== row.position_fingerprint
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
      if (decision.decision === "accepted" && position === undefined) {
        position = {
          id: crypto.randomUUID(),
          position_fingerprint: row.position_fingerprint,
          currency: input.currency,
        };
        positionsByFingerprint.set(row.position_fingerprint, position);
        positionsById.set(position.id, position);
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
              provider === ANGELLIST_PROVIDER ? row.invested_on : null,
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
    return this.getApplyResult(identity.household_id, importId);
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
