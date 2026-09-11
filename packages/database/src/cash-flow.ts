import {
  cashFlowCategoryLabel,
  defaultCashFlowTreatment,
  NormalizedCashFlowDeltaSchema,
  type NormalizedCashFlowDelta,
  type NormalizedCashFlowMutation,
} from "@keel/connectors";
import {
  addMinorUnits,
  CASH_FLOW_POLICY_VERSION,
  CashFlowCategorySchema,
  CashFlowErrorCodeSchema,
  CashFlowReviewInputSchema,
  CashFlowReviewResultSchema,
  CashFlowStateSchema,
  CashFlowSyncInputSchema,
  CashFlowTreatmentSchema,
  createCashFlowComparison,
  type CashFlowCategory,
  type CashFlowErrorCode,
  type CashFlowPlanningContext,
  type CashFlowProposal,
  type CashFlowReviewInput,
  type CashFlowReviewResult,
  type CashFlowState,
  type CashFlowSyncInput,
  type CashFlowTreatment,
} from "@keel/domain";
import { z } from "zod";

import { groupRowsBy } from "./group-rows";

const CONNECTOR_TYPE = "plaid-cash";
const DAILY_CHECK_LIMIT = 4;
const RETENTION_MONTHS = 24;
const MUTATION_INSERT_BATCH_SIZE = 500;

type IdentityRow = {
  household_id: string;
  user_id: string;
};

type ConnectionRow = {
  id: string;
  display_label: string;
  secret_reference: string;
  status: "active" | "paused" | "revoked";
  accepted_account_count: number;
  pricing_confirmed_at: string | null;
  plaid_cursor: string | null;
  cash_flow_last_synced_at: string | null;
  latest_run_status: "running" | "succeeded" | "failed" | null;
  latest_error_code: string | null;
  daily_checks_used: number;
  successful_checks_today: number;
};

type PlanningRow = {
  cash_flow_plan_id: string;
  forecast_snapshot_id: string;
  forecast_snapshot_version: number;
  household_burn_monthly_minor: number;
  business_burn_monthly_minor: number;
  debt_payment_context_monthly_minor: number;
  protected_cash_floor_minor: number;
  fi_eligible_liquid_minor: number;
};

type CurrentTransactionRow = {
  transaction_key_sha256: string;
  account_key_sha256: string;
  connector_account_id: string;
  effective_date: string;
  month: string;
  amount_minor: number | null;
  pending: number;
  category: CashFlowCategory;
  currency_supported: number;
};

type AcceptedAccountKeyRow = {
  connector_account_id: string;
  natural_key_sha256: string;
};

type CoverageRow = {
  connector_account_id: string;
  pricing_confirmed_at: string | null;
  last_synced_at: string | null;
};

type ProposalRow = {
  id: string;
  status: "pending_review" | "ready_for_plan";
  observed_at: string;
  period_start_month: string;
  period_end_month: string;
  transaction_count: number;
  pending_excluded_count: number;
  unsupported_excluded_count: number;
  unreviewed_account_excluded_count: number;
  covered_connection_count: number;
  base_cash_flow_plan_id: string;
  base_forecast_snapshot_id: string;
  base_forecast_snapshot_version: number;
  household_burn_monthly_minor: number;
  business_burn_monthly_minor: number;
  debt_payment_context_monthly_minor: number;
  protected_cash_floor_minor: number;
  fi_eligible_liquid_minor: number;
  suggested_household_burn_monthly_minor: number | null;
  suggested_business_burn_monthly_minor: number | null;
};

type ProposalMonthRow = {
  month: string;
  outflow_minor: number;
  transaction_count: number;
};

type ProposalCategoryRow = {
  id: string;
  category: CashFlowCategory;
  label: string;
  total_minor: number;
  average_monthly_minor: number;
  transaction_count: number;
  default_treatment: CashFlowTreatment;
  reviewed_treatment: CashFlowTreatment | null;
  change_note: string | null;
};

export type CashFlowSyncRun = {
  readonly id: string;
  readonly connectionId: string;
  readonly institutionLabel: string;
  readonly secretReference: string;
  readonly plaidCursor: string | null;
  readonly initial: boolean;
};

export class CashFlowRepositoryError extends Error {
  public constructor(
    public readonly code: CashFlowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CashFlowRepositoryError";
  }
}

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

function utcDayPrefix(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

function completeMonths(at: string): [string, string, string] {
  const date = new Date(at);
  const firstOfCurrentMonth = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    1,
  );
  const monthAtOffset = (offset: number) =>
    new Date(
      Date.UTC(
        new Date(firstOfCurrentMonth).getUTCFullYear(),
        new Date(firstOfCurrentMonth).getUTCMonth() - offset,
        1,
      ),
    )
      .toISOString()
      .slice(0, 7);
  return [monthAtOffset(3), monthAtOffset(2), monthAtOffset(1)];
}

function roundedAverage(totalMinor: number, monthCount = 3): number {
  return Number(
    (BigInt(totalMinor) + BigInt(Math.floor(monthCount / 2))) /
      BigInt(monthCount),
  );
}

function retentionCutoff(at: string): string {
  const date = new Date(at);
  date.setUTCMonth(date.getUTCMonth() - RETENTION_MONTHS);
  return date.toISOString();
}

function planningFrom(row: PlanningRow): CashFlowPlanningContext {
  return {
    baseCashFlowPlanId: row.cash_flow_plan_id,
    baseForecastSnapshotId: row.forecast_snapshot_id,
    baseForecastSnapshotVersion: row.forecast_snapshot_version,
    householdBurnMonthlyMinor: row.household_burn_monthly_minor,
    businessBurnMonthlyMinor: row.business_burn_monthly_minor,
    debtPaymentContextMonthlyMinor: row.debt_payment_context_monthly_minor,
    protectedCashFloorMinor: row.protected_cash_floor_minor,
    fiEligibleLiquidMinor: row.fi_eligible_liquid_minor,
  };
}

function mutationToCurrent(
  mutation: NormalizedCashFlowMutation,
  connectionId: string,
): CurrentTransactionRow | null {
  if (
    mutation.mutation === "removed" ||
    mutation.accountKeySha256 === null ||
    mutation.effectiveDate === null ||
    mutation.month === null ||
    mutation.pending === null ||
    mutation.category === null ||
    mutation.currencySupported === null
  ) {
    return null;
  }
  return {
    transaction_key_sha256: mutation.transactionKeySha256,
    account_key_sha256: mutation.accountKeySha256,
    connector_account_id: connectionId,
    effective_date: mutation.effectiveDate,
    month: mutation.month,
    amount_minor: mutation.amountMinor,
    pending: mutation.pending ? 1 : 0,
    category: mutation.category,
    currency_supported: mutation.currencySupported ? 1 : 0,
  };
}

function accountMapKey(connectionId: string, accountKeySha256: string) {
  return `${connectionId}:${accountKeySha256}`;
}

function transactionMapKey(connectionId: string, transactionKeySha256: string) {
  return `${connectionId}:${transactionKeySha256}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface CashFlowRepository {
  getState(accessSubject: string, configured: boolean): Promise<CashFlowState>;
  beginSync(
    accessSubject: string,
    connectionId: string,
    input: CashFlowSyncInput,
  ): Promise<CashFlowSyncRun>;
  completeSync(
    accessSubject: string,
    runId: string,
    delta: NormalizedCashFlowDelta,
  ): Promise<void>;
  failSync(
    accessSubject: string,
    runId: string,
    errorCode: CashFlowErrorCode,
  ): Promise<void>;
  reviewProposal(
    accessSubject: string,
    proposalId: string,
    input: CashFlowReviewInput,
  ): Promise<CashFlowReviewResult>;
}

export class D1CashFlowRepository implements CashFlowRepository {
  public constructor(private readonly db: D1Database) {}

  public async getState(
    accessSubject: string,
    configured: boolean,
  ): Promise<CashFlowState> {
    const identity = await this.findIdentity(accessSubject);
    const [connections, proposals, latestRun] = await Promise.all([
      this.connectionRows(identity.household_id),
      this.pendingProposals(identity.household_id),
      this.db
        .prepare(
          `SELECT status, error_code, proposed_count
           FROM connector_sync_runs
           WHERE household_id = ?
             AND cursor IN ('cash-flow-initial-v1', 'cash-flow-incremental-v1')
           ORDER BY started_at DESC, id DESC
           LIMIT 1`,
        )
        .bind(identity.household_id)
        .first<{
          status: "running" | "succeeded" | "failed";
          error_code: string | null;
          proposed_count: number;
        }>(),
    ]);
    const parsedError =
      latestRun?.status === "failed" && latestRun.error_code !== null
        ? CashFlowErrorCodeSchema.catch("unexpected_failure").parse(
            latestRun.error_code,
          )
        : null;
    const latestOutcome =
      proposals.length > 0
        ? ("proposal_ready" as const)
        : latestRun === null
          ? ("never_checked" as const)
          : latestRun.error_code === "history_incomplete"
            ? ("history_incomplete" as const)
            : latestRun.error_code === "coverage_incomplete"
              ? ("coverage_incomplete" as const)
              : ("no_material_change" as const);
    const hasAccepted = connections.some(
      (connection) => connection.accepted_account_count > 0,
    );
    const hasUnconfirmedEligible = connections.some(
      (connection) =>
        connection.accepted_account_count > 0 &&
        connection.pricing_confirmed_at === null,
    );
    const hasFailed = connections.some(
      (connection) => connection.latest_run_status === "failed",
    );

    return CashFlowStateSchema.parse({
      version: 1,
      configured,
      status: !configured
        ? "setup_required"
        : connections.length === 0
          ? "disconnected"
          : !hasAccepted
            ? "waiting_for_cash_review"
            : proposals.length > 0
              ? "review_required"
              : hasFailed
                ? "needs_attention"
                : hasUnconfirmedEligible
                  ? "consent_required"
                  : "ready",
      latestOutcome,
      connections: connections.map((connection) => ({
        id: connection.id,
        institutionLabel: connection.display_label,
        status:
          connection.accepted_account_count === 0
            ? "cash_review_required"
            : connection.latest_run_status === "failed"
              ? "needs_attention"
              : connection.pricing_confirmed_at === null
                ? "consent_required"
                : "ready",
        acceptedAccountCount: connection.accepted_account_count,
        pricingConfirmedAt: connection.pricing_confirmed_at,
        lastCheckedAt: connection.cash_flow_last_synced_at,
        dailyCheckLimit: DAILY_CHECK_LIMIT,
        dailyChecksUsed: connection.daily_checks_used,
        dailyChecksRemaining:
          connection.successful_checks_today > 0
            ? 0
            : Math.max(DAILY_CHECK_LIMIT - connection.daily_checks_used, 0),
      })),
      pendingProposals: proposals,
      errorCode: configured ? parsedError : "configuration_required",
    });
  }

  public async beginSync(
    accessSubject: string,
    rawConnectionId: string,
    rawInput: CashFlowSyncInput,
  ): Promise<CashFlowSyncRun> {
    const connectionId = z.string().min(1).parse(rawConnectionId);
    const input = CashFlowSyncInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const connection = (
      await this.connectionRows(identity.household_id, connectionId)
    )[0];
    if (connection === undefined || connection.status !== "active") {
      throw new CashFlowRepositoryError(
        "connection_invalid",
        "Reconnect this institution to continue.",
      );
    }
    if (connection.accepted_account_count === 0) {
      throw new CashFlowRepositoryError(
        "consent_required",
        "Review at least one cash account before comparing cash flow.",
      );
    }
    if (connection.pricing_confirmed_at === null && !input.pricingConfirmed) {
      throw new CashFlowRepositoryError(
        "consent_required",
        "Confirm deployment pricing before starting Transactions.",
      );
    }
    const blocked = await this.db
      .prepare(
        `SELECT (
           EXISTS (
             SELECT 1 FROM cash_flow_proposals proposal
             WHERE proposal.household_id = ?
               AND proposal.status IN ('pending_review', 'ready_for_plan')
           ) OR EXISTS (
             SELECT 1 FROM cash_balance_proposals proposal
             WHERE proposal.household_id = ?
               AND proposal.status = 'pending_review'
           ) OR EXISTS (
             SELECT 1 FROM connector_sync_runs run
             WHERE run.household_id = ?
               AND run.cursor IN (
                 'cash-flow-initial-v1', 'cash-flow-incremental-v1'
               )
               AND run.status IN ('queued', 'running')
           )
         ) AS blocked`,
      )
      .bind(identity.household_id, identity.household_id, identity.household_id)
      .first<{ blocked: number }>();
    if (blocked?.blocked === 1) {
      throw new CashFlowRepositoryError(
        "review_required",
        "Finish the current cash-flow review before checking again.",
      );
    }
    if (
      connection.successful_checks_today > 0 ||
      connection.daily_checks_used >= DAILY_CHECK_LIMIT
    ) {
      throw new CashFlowRepositoryError(
        "daily_limit_reached",
        connection.successful_checks_today > 0
          ? "This institution already completed its cash-flow check today."
          : "This institution has used its cash-flow checks for today.",
      );
    }

    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const initial = connection.plaid_cursor === null;
    const statements: D1PreparedStatement[] = [];
    if (connection.pricing_confirmed_at === null) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO cash_flow_connections (
               connector_account_id, household_id, confirmed_by_user_id,
               policy_version, pricing_confirmed_at, plaid_cursor,
               last_synced_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
          )
          .bind(
            connectionId,
            identity.household_id,
            identity.user_id,
            CASH_FLOW_POLICY_VERSION,
            startedAt,
            startedAt,
            startedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO cash_flow_activation_events (
               id, household_id, connector_account_id, confirmed_by_user_id,
               policy_version, pricing_confirmed_at, created_at, immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            connectionId,
            identity.user_id,
            CASH_FLOW_POLICY_VERSION,
            startedAt,
            startedAt,
          ),
      );
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO connector_sync_runs (
             id, household_id, connector_account_id, status, started_at,
             finished_at, cursor, discovered_count, proposed_count, error_code
           ) VALUES (?, ?, ?, 'running', ?, NULL, ?, 0, 0, NULL)`,
        )
        .bind(
          id,
          identity.household_id,
          connectionId,
          startedAt,
          initial ? "cash-flow-initial-v1" : "cash-flow-incremental-v1",
        ),
    );
    try {
      await this.db.batch(statements);
    } catch {
      throw new CashFlowRepositoryError(
        "review_required",
        "Another review or check started first.",
      );
    }
    return {
      id,
      connectionId,
      institutionLabel: connection.display_label,
      secretReference: connection.secret_reference,
      plaidCursor: connection.plaid_cursor,
      initial,
    };
  }

  public async completeSync(
    accessSubject: string,
    rawRunId: string,
    rawDelta: NormalizedCashFlowDelta,
  ): Promise<void> {
    const runId = z.string().min(1).parse(rawRunId);
    const delta = NormalizedCashFlowDeltaSchema.parse(rawDelta);
    const identity = await this.findIdentity(accessSubject);
    const run = await this.db
      .prepare(
        `SELECT run.connector_account_id
         FROM connector_sync_runs run
         JOIN connector_accounts account ON account.id = run.connector_account_id
         WHERE run.id = ? AND run.household_id = ? AND run.status = 'running'
           AND run.cursor IN (
             'cash-flow-initial-v1', 'cash-flow-incremental-v1'
           )
           AND account.connector_type = ?`,
      )
      .bind(runId, identity.household_id, CONNECTOR_TYPE)
      .first<{ connector_account_id: string }>();
    if (run === null) {
      throw new CashFlowRepositoryError(
        "staging_failed",
        "The cash-flow check is no longer active.",
      );
    }
    const [currentRows, acceptedKeys, coverage, planningRow] =
      await Promise.all([
        this.currentTransactions(identity.household_id),
        this.acceptedAccountKeys(identity.household_id),
        this.coverageRows(identity.household_id),
        this.planningRow(identity.household_id),
      ]);
    const current = new Map(
      currentRows.map((transaction) => [
        transactionMapKey(
          transaction.connector_account_id,
          transaction.transaction_key_sha256,
        ),
        transaction,
      ]),
    );
    delta.mutations.forEach((mutation) => {
      const next = mutationToCurrent(mutation, run.connector_account_id);
      const key = transactionMapKey(
        run.connector_account_id,
        mutation.transactionKeySha256,
      );
      if (next === null) {
        current.delete(key);
      } else {
        current.set(key, next);
      }
    });
    const acceptedByKey = new Map(
      acceptedKeys.map((row) => [
        accountMapKey(row.connector_account_id, row.natural_key_sha256),
        row,
      ]),
    );
    const eligibleConnectionIds = new Set(
      acceptedKeys.map((row) => row.connector_account_id),
    );
    const coverageByConnection = new Map(
      coverage.map((row) => [row.connector_account_id, row]),
    );
    const coverageComplete = [...eligibleConnectionIds].every(
      (connectionId) => {
        const row = coverageByConnection.get(connectionId);
        return (
          row?.pricing_confirmed_at !== null &&
          (row?.last_synced_at !== null ||
            connectionId === run.connector_account_id)
        );
      },
    );
    const months = completeMonths(delta.retrievedAt);
    const monthSet = new Set(months);
    const monthly = new Map(
      months.map((month) => [
        month,
        { month, outflowMinor: 0, transactionCount: 0 },
      ]),
    );
    const categories = new Map<
      CashFlowCategory,
      {
        category: CashFlowCategory;
        totalMinor: number;
        transactionCount: number;
      }
    >();
    let pendingExcludedCount = 0;
    let unsupportedExcludedCount = 0;
    let unreviewedAccountExcludedCount = 0;
    for (const transaction of current.values()) {
      if (!monthSet.has(transaction.month)) {
        continue;
      }
      const accepted = acceptedByKey.has(
        accountMapKey(
          transaction.connector_account_id,
          transaction.account_key_sha256,
        ),
      );
      if (!accepted) {
        unreviewedAccountExcludedCount += 1;
        continue;
      }
      if (transaction.pending === 1) {
        pendingExcludedCount += 1;
        continue;
      }
      if (
        transaction.currency_supported !== 1 ||
        transaction.amount_minor === null
      ) {
        unsupportedExcludedCount += 1;
        continue;
      }
      if (transaction.amount_minor <= 0) {
        continue;
      }
      const month = monthly.get(transaction.month);
      if (month === undefined) {
        continue;
      }
      month.outflowMinor = addMinorUnits(
        month.outflowMinor,
        transaction.amount_minor,
      );
      month.transactionCount += 1;
      const category = categories.get(transaction.category) ?? {
        category: transaction.category,
        totalMinor: 0,
        transactionCount: 0,
      };
      category.totalMinor = addMinorUnits(
        category.totalMinor,
        transaction.amount_minor,
      );
      category.transactionCount += 1;
      categories.set(transaction.category, category);
    }
    const monthRows = months.map((month) => monthly.get(month));
    if (monthRows.some((month) => month === undefined)) {
      throw new CashFlowRepositoryError(
        "staging_failed",
        "Keel could not prepare complete calendar months.",
      );
    }
    const categoryRows = [...categories.values()].sort((left, right) =>
      left.category.localeCompare(right.category),
    );
    const historyComplete =
      monthRows.every(
        (month) => month !== undefined && month.transactionCount > 0,
      ) && categoryRows.length > 0;
    const planning = planningFrom(planningRow);
    const defaultTotals = categoryRows.reduce(
      (totals, category) => {
        const treatment = defaultCashFlowTreatment(category.category);
        if (treatment === "household") {
          totals.household = addMinorUnits(
            totals.household,
            category.totalMinor,
          );
        } else if (treatment === "business") {
          totals.business = addMinorUnits(totals.business, category.totalMinor);
        }
        return totals;
      },
      { household: 0, business: 0 },
    );
    const defaultComparison = createCashFlowComparison(
      planning,
      roundedAverage(defaultTotals.household),
      roundedAverage(defaultTotals.business),
    );
    const shouldPropose =
      coverageComplete && historyComplete && defaultComparison.material;
    const sourceRevision = await sha256(
      JSON.stringify([
        "reviewed-cash-flow-v1",
        months,
        monthRows,
        categoryRows,
        [...eligibleConnectionIds].sort(),
        planning,
      ]),
    );
    const existing = await this.db
      .prepare(
        `SELECT id FROM cash_flow_proposals
         WHERE household_id = ? AND source_revision = ? LIMIT 1`,
      )
      .bind(identity.household_id, sourceRevision)
      .first<{ id: string }>();
    const createProposal = shouldPropose && existing === null;
    const createdAt = delta.retrievedAt;
    const proposalId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `DELETE FROM cash_flow_transaction_revisions
           WHERE household_id = ? AND created_at < ?`,
        )
        .bind(identity.household_id, retentionCutoff(createdAt)),
    ];
    for (
      let offset = 0;
      offset < delta.mutations.length;
      offset += MUTATION_INSERT_BATCH_SIZE
    ) {
      const mutationBatch = delta.mutations.slice(
        offset,
        offset + MUTATION_INSERT_BATCH_SIZE,
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO cash_flow_transaction_revisions (
               id, household_id, connector_account_id, sync_run_id, sequence,
               mutation, transaction_key_sha256, account_key_sha256,
               effective_date, month, amount_minor, pending, category,
               currency_supported, created_at, immutable
             )
             SELECT json_extract(value, '$[0]'), ?, ?, ?,
                    json_extract(value, '$[1]'),
                    json_extract(value, '$[2]'),
                    json_extract(value, '$[3]'),
                    json_extract(value, '$[4]'),
                    json_extract(value, '$[5]'),
                    json_extract(value, '$[6]'),
                    json_extract(value, '$[7]'),
                    json_extract(value, '$[8]'),
                    json_extract(value, '$[9]'),
                    json_extract(value, '$[10]'), ?, 1
             FROM json_each(?)`,
          )
          .bind(
            identity.household_id,
            run.connector_account_id,
            runId,
            createdAt,
            JSON.stringify(
              mutationBatch.map((mutation) => [
                crypto.randomUUID(),
                mutation.sequence,
                mutation.mutation,
                mutation.transactionKeySha256,
                mutation.accountKeySha256,
                mutation.effectiveDate,
                mutation.month,
                mutation.amountMinor,
                mutation.pending === null ? null : mutation.pending ? 1 : 0,
                mutation.category,
                mutation.currencySupported === null
                  ? null
                  : mutation.currencySupported
                    ? 1
                    : 0,
              ]),
            ),
          ),
      );
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE cash_flow_connections
           SET plaid_cursor = ?, last_synced_at = ?, updated_at = ?
           WHERE household_id = ? AND connector_account_id = ?`,
        )
        .bind(
          delta.nextCursor,
          createdAt,
          createdAt,
          identity.household_id,
          run.connector_account_id,
        ),
      this.db
        .prepare(
          `UPDATE connector_sync_runs
           SET status = 'succeeded', finished_at = ?, discovered_count = ?,
               proposed_count = ?, error_code = ?
           WHERE id = ? AND household_id = ? AND status = 'running'`,
        )
        .bind(
          createdAt,
          delta.mutations.length,
          createProposal ? categoryRows.length : 0,
          !coverageComplete
            ? "coverage_incomplete"
            : !historyComplete
              ? "history_incomplete"
              : null,
          runId,
          identity.household_id,
        ),
    );
    if (createProposal) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO cash_flow_proposals (
               id, household_id, trigger_sync_run_id, source_revision, status,
               observed_at, period_start_month, period_end_month,
               transaction_count, pending_excluded_count,
               unsupported_excluded_count, unreviewed_account_excluded_count,
               covered_connection_count, base_cash_flow_plan_id,
               base_forecast_snapshot_id, base_forecast_snapshot_version,
               household_burn_monthly_minor, business_burn_monthly_minor,
               debt_payment_context_monthly_minor, protected_cash_floor_minor,
               fi_eligible_liquid_minor,
               suggested_household_burn_monthly_minor,
               suggested_business_burn_monthly_minor, reviewed_at,
               applied_cash_flow_plan_id, applied_at, created_at
             ) VALUES (
               ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?
             )`,
          )
          .bind(
            proposalId,
            identity.household_id,
            runId,
            sourceRevision,
            createdAt,
            months[0],
            months[2],
            monthRows.reduce(
              (sum, month) => sum + (month?.transactionCount ?? 0),
              0,
            ),
            pendingExcludedCount,
            unsupportedExcludedCount,
            unreviewedAccountExcludedCount,
            eligibleConnectionIds.size,
            planning.baseCashFlowPlanId,
            planning.baseForecastSnapshotId,
            planning.baseForecastSnapshotVersion,
            planning.householdBurnMonthlyMinor,
            planning.businessBurnMonthlyMinor,
            planning.debtPaymentContextMonthlyMinor,
            planning.protectedCashFloorMinor,
            planning.fiEligibleLiquidMinor,
            createdAt,
          ),
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO cash_flow_proposal_months (
               id, household_id, proposal_id, month, outflow_minor,
               transaction_count, created_at, immutable
             )
             SELECT json_extract(value, '$[0]'), ?, ?,
                    json_extract(value, '$[1]'),
                    json_extract(value, '$[2]'),
                    json_extract(value, '$[3]'), ?, 1
             FROM json_each(?)`,
          )
          .bind(
            identity.household_id,
            proposalId,
            createdAt,
            JSON.stringify(
              monthRows.map((month) => [
                crypto.randomUUID(),
                month?.month,
                month?.outflowMinor,
                month?.transactionCount,
              ]),
            ),
          ),
        this.db
          .prepare(
            `INSERT INTO cash_flow_proposal_categories (
               id, household_id, proposal_id, category, label, total_minor,
               average_monthly_minor, transaction_count, default_treatment,
               created_at, immutable
             )
             SELECT json_extract(value, '$[0]'), ?, ?,
                    json_extract(value, '$[1]'),
                    json_extract(value, '$[2]'),
                    json_extract(value, '$[3]'),
                    json_extract(value, '$[4]'),
                    json_extract(value, '$[5]'),
                    json_extract(value, '$[6]'), ?, 1
             FROM json_each(?)`,
          )
          .bind(
            identity.household_id,
            proposalId,
            createdAt,
            JSON.stringify(
              categoryRows.map((category) => [
                crypto.randomUUID(),
                category.category,
                cashFlowCategoryLabel(category.category),
                category.totalMinor,
                roundedAverage(category.totalMinor),
                category.transactionCount,
                defaultCashFlowTreatment(category.category),
              ]),
            ),
          ),
      );
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      const repositoryError = new CashFlowRepositoryError(
        "staging_failed",
        "Keel could not store the normalized cash-flow update.",
      );
      repositoryError.cause = error;
      throw repositoryError;
    }
  }

  public async failSync(
    accessSubject: string,
    rawRunId: string,
    rawErrorCode: CashFlowErrorCode,
  ): Promise<void> {
    const runId = z.string().min(1).parse(rawRunId);
    const errorCode = CashFlowErrorCodeSchema.parse(rawErrorCode);
    const identity = await this.findIdentity(accessSubject);
    await this.db
      .prepare(
        `UPDATE connector_sync_runs
         SET status = 'failed', finished_at = ?, error_code = ?
         WHERE id = ? AND household_id = ? AND status = 'running'
           AND cursor IN (
             'cash-flow-initial-v1', 'cash-flow-incremental-v1'
           )`,
      )
      .bind(new Date().toISOString(), errorCode, runId, identity.household_id)
      .run();
  }

  public async reviewProposal(
    accessSubject: string,
    rawProposalId: string,
    rawInput: CashFlowReviewInput,
  ): Promise<CashFlowReviewResult> {
    const proposalId = z.string().min(1).parse(rawProposalId);
    const input = CashFlowReviewInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const proposal = await this.db
      .prepare(
        `SELECT id, base_cash_flow_plan_id, base_forecast_snapshot_id,
                base_forecast_snapshot_version,
                household_burn_monthly_minor, business_burn_monthly_minor,
                debt_payment_context_monthly_minor,
                protected_cash_floor_minor, fi_eligible_liquid_minor
         FROM cash_flow_proposals
         WHERE id = ? AND household_id = ? AND status = 'pending_review'`,
      )
      .bind(proposalId, identity.household_id)
      .first<
        Pick<
          ProposalRow,
          | "id"
          | "base_cash_flow_plan_id"
          | "base_forecast_snapshot_id"
          | "base_forecast_snapshot_version"
          | "household_burn_monthly_minor"
          | "business_burn_monthly_minor"
          | "debt_payment_context_monthly_minor"
          | "protected_cash_floor_minor"
          | "fi_eligible_liquid_minor"
        >
      >();
    if (proposal === null) {
      throw new CashFlowRepositoryError(
        "review_required",
        "The cash-flow proposal is no longer waiting for review.",
      );
    }
    const [categories, latestPlanning] = await Promise.all([
      all<ProposalCategoryRow>(
        this.db
          .prepare(
            `SELECT id, category, label, total_minor,
                    average_monthly_minor, transaction_count,
                    default_treatment, NULL AS reviewed_treatment,
                    NULL AS change_note
             FROM cash_flow_proposal_categories
             WHERE proposal_id = ? AND household_id = ?
             ORDER BY category`,
          )
          .bind(proposalId, identity.household_id),
      ),
      this.planningRow(identity.household_id),
    ]);
    if (
      latestPlanning.cash_flow_plan_id !== proposal.base_cash_flow_plan_id ||
      latestPlanning.forecast_snapshot_id !==
        proposal.base_forecast_snapshot_id ||
      latestPlanning.forecast_snapshot_version !==
        proposal.base_forecast_snapshot_version
    ) {
      throw new CashFlowRepositoryError(
        "review_required",
        "The runway plan changed. Check cash flow again against the latest plan.",
      );
    }
    const decisions = new Map(
      input.decisions.map((decision) => [decision.categoryId, decision]),
    );
    if (
      decisions.size !== input.decisions.length ||
      decisions.size !== categories.length ||
      categories.some((category) => !decisions.has(category.id))
    ) {
      throw new CashFlowRepositoryError(
        "review_required",
        "Choose one treatment for every spending category.",
      );
    }
    const totals = categories.reduce(
      (result, category) => {
        const treatment = decisions.get(category.id)?.treatment;
        if (treatment === "household") {
          result.household = addMinorUnits(
            result.household,
            category.total_minor,
          );
        } else if (treatment === "business") {
          result.business = addMinorUnits(
            result.business,
            category.total_minor,
          );
        }
        return result;
      },
      { household: 0, business: 0 },
    );
    const planning: CashFlowPlanningContext = {
      baseCashFlowPlanId: proposal.base_cash_flow_plan_id,
      baseForecastSnapshotId: proposal.base_forecast_snapshot_id,
      baseForecastSnapshotVersion: proposal.base_forecast_snapshot_version,
      householdBurnMonthlyMinor: proposal.household_burn_monthly_minor,
      businessBurnMonthlyMinor: proposal.business_burn_monthly_minor,
      debtPaymentContextMonthlyMinor:
        proposal.debt_payment_context_monthly_minor,
      protectedCashFloorMinor: proposal.protected_cash_floor_minor,
      fiEligibleLiquidMinor: proposal.fi_eligible_liquid_minor,
    };
    const comparison = createCashFlowComparison(
      planning,
      roundedAverage(totals.household),
      roundedAverage(totals.business),
      !categories.some((category) => {
        const treatment = decisions.get(category.id)?.treatment;
        return (
          category.category === "LOAN_PAYMENTS" &&
          (treatment === "household" || treatment === "business")
        );
      }),
    );
    const reviewedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = categories.map((category) => {
      const decision = decisions.get(category.id);
      if (decision === undefined) {
        throw new CashFlowRepositoryError(
          "review_required",
          "Choose one treatment for every spending category.",
        );
      }
      return this.db
        .prepare(
          `INSERT INTO cash_flow_review_decisions (
             id, household_id, proposal_id, proposal_category_id,
             reviewer_user_id, treatment, change_note, decided_at, immutable
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          proposalId,
          category.id,
          identity.user_id,
          decision.treatment,
          input.changeNote,
          reviewedAt,
        );
    });
    statements.push(
      this.db
        .prepare(
          `UPDATE cash_flow_proposals
           SET status = ?, suggested_household_burn_monthly_minor = ?,
               suggested_business_burn_monthly_minor = ?, reviewed_at = ?
           WHERE id = ? AND household_id = ? AND status = 'pending_review'`,
        )
        .bind(
          comparison.material ? "ready_for_plan" : "reviewed_no_change",
          comparison.material
            ? comparison.proposedHouseholdBurnMonthlyMinor
            : null,
          comparison.material
            ? comparison.proposedBusinessBurnMonthlyMinor
            : null,
          reviewedAt,
          proposalId,
          identity.household_id,
        ),
    );
    await this.db.batch(statements);
    return CashFlowReviewResultSchema.parse({
      proposalId,
      comparison,
      planSuggestion: comparison.material
        ? {
            proposalId,
            householdBurnMonthlyMinor:
              comparison.proposedHouseholdBurnMonthlyMinor,
            businessBurnMonthlyMinor:
              comparison.proposedBusinessBurnMonthlyMinor,
            changeNote: `Observed cash flow review: ${input.changeNote}`.slice(
              0,
              500,
            ),
          }
        : null,
    });
  }

  private async findIdentity(accessSubject: string): Promise<IdentityRow> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id, user.id AS user_id
         FROM users user
         JOIN households household ON household.owner_user_id = user.id
         WHERE user.access_subject = ?
         ORDER BY household.created_at
         LIMIT 1`,
      )
      .bind(accessSubject)
      .first<IdentityRow>();
    if (identity === null) {
      throw new Error("Household not found for the authenticated user.");
    }
    return identity;
  }

  private connectionRows(
    householdId: string,
    connectionId?: string,
  ): Promise<readonly ConnectionRow[]> {
    const today = `${utcDayPrefix()}T00:00:00.000Z`;
    const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString();
    return all<ConnectionRow>(
      this.db
        .prepare(
          `SELECT account.id, account.display_label, account.secret_reference,
                  account.status,
                  (
                    SELECT COUNT(*) FROM (
                      SELECT row.natural_key_sha256,
                             row.item_account_key_sha256,
                             ROW_NUMBER() OVER (
                               PARTITION BY proposal.connector_account_id,
                                            row.natural_key_sha256
                               ORDER BY decision.decided_at DESC,
                                        decision.id DESC
                             ) AS recency
                      FROM cash_balance_review_decisions decision
                      JOIN cash_balance_proposal_rows row
                        ON row.id = decision.proposal_row_id
                      JOIN cash_balance_proposals proposal
                        ON proposal.id = decision.proposal_id
                      WHERE decision.household_id = account.household_id
                        AND decision.decision = 'accepted'
                        AND proposal.connector_account_id = account.id
                        AND decision.decided_at >= COALESCE((
                          SELECT MAX(initial.started_at)
                          FROM connector_sync_runs initial
                          WHERE initial.connector_account_id = account.id
                            AND initial.cursor = 'cash-initial-v1'
                        ), '')
                    ) accepted WHERE accepted.recency = 1
                      AND accepted.item_account_key_sha256 IS NOT NULL
                  ) AS accepted_account_count,
                  flow.pricing_confirmed_at, flow.plaid_cursor,
                  flow.last_synced_at AS cash_flow_last_synced_at,
                  (
                    SELECT run.status FROM connector_sync_runs run
                    WHERE run.connector_account_id = account.id
                      AND run.cursor IN (
                        'cash-flow-initial-v1', 'cash-flow-incremental-v1'
                      )
                    ORDER BY run.started_at DESC, run.id DESC LIMIT 1
                  ) AS latest_run_status,
                  (
                    SELECT run.error_code FROM connector_sync_runs run
                    WHERE run.connector_account_id = account.id
                      AND run.cursor IN (
                        'cash-flow-initial-v1', 'cash-flow-incremental-v1'
                      )
                    ORDER BY run.started_at DESC, run.id DESC LIMIT 1
                  ) AS latest_error_code,
                  (
                    SELECT COUNT(*) FROM connector_sync_runs run
                    WHERE run.connector_account_id = account.id
                      AND run.cursor IN (
                        'cash-flow-initial-v1', 'cash-flow-incremental-v1'
                      )
                      AND run.started_at >= ? AND run.started_at < ?
                  ) AS daily_checks_used,
                  (
                    SELECT COUNT(*) FROM connector_sync_runs run
                    WHERE run.connector_account_id = account.id
                      AND run.cursor IN (
                        'cash-flow-initial-v1', 'cash-flow-incremental-v1'
                      )
                      AND run.status = 'succeeded'
                      AND run.started_at >= ? AND run.started_at < ?
                  ) AS successful_checks_today
           FROM connector_accounts account
           LEFT JOIN cash_flow_connections flow
             ON flow.connector_account_id = account.id
           WHERE account.household_id = ? AND account.connector_type = ?
             AND account.status = 'active'
             AND (? IS NULL OR account.id = ?)
           ORDER BY account.display_label, account.id`,
        )
        .bind(
          today,
          tomorrow,
          today,
          tomorrow,
          householdId,
          CONNECTOR_TYPE,
          connectionId ?? null,
          connectionId ?? null,
        ),
    );
  }

  private async planningRow(householdId: string): Promise<PlanningRow> {
    const row = await this.db
      .prepare(
        `SELECT plan.id AS cash_flow_plan_id,
                snapshot.id AS forecast_snapshot_id,
                snapshot.version AS forecast_snapshot_version,
                plan.household_burn_monthly_minor,
                plan.business_burn_monthly_minor,
                COALESCE((
                  SELECT SUM(latest.payment_minor) FROM (
                    SELECT row.payment_minor, decision.payment_treatment,
                           ROW_NUMBER() OVER (
                             PARTITION BY row.natural_key_sha256
                             ORDER BY decision.decided_at DESC,
                                      decision.id DESC
                           ) AS recency
                    FROM liability_review_decisions decision
                    JOIN liability_proposal_rows row
                      ON row.id = decision.proposal_row_id
                    WHERE decision.household_id = ?
                      AND decision.decision = 'accepted'
                  ) latest
                  WHERE latest.recency = 1
                    AND latest.payment_treatment IN (
                      'already_in_plan', 'add_to_household_burn'
                    )
                    AND latest.payment_minor IS NOT NULL
                ), 0) AS debt_payment_context_monthly_minor,
                plan.protected_cash_floor_minor,
                plan.fi_eligible_liquid_minor
         FROM scenarios scenario
         JOIN cash_flow_plans plan
           ON plan.id = (
             SELECT latest.id FROM cash_flow_plans latest
             WHERE latest.scenario_id = scenario.id
             ORDER BY latest.effective_date DESC, latest.created_at DESC,
                      latest.id DESC LIMIT 1
           )
         JOIN forecast_snapshots snapshot
           ON snapshot.scenario_id = scenario.id
           AND snapshot.version = (
             SELECT MAX(latest.version) FROM forecast_snapshots latest
             WHERE latest.scenario_id = scenario.id
           )
         WHERE scenario.household_id = ? AND scenario.name = 'FI Underwriting'`,
      )
      .bind(householdId, householdId)
      .first<PlanningRow>();
    if (row === null) {
      throw new Error("Observed cash flow requires a complete FI plan.");
    }
    return row;
  }

  private currentTransactions(
    householdId: string,
  ): Promise<readonly CurrentTransactionRow[]> {
    return all<CurrentTransactionRow>(
      this.db
        .prepare(
          `WITH ranked AS (
             SELECT revision.transaction_key_sha256,
                    revision.account_key_sha256,
                    revision.connector_account_id, revision.effective_date,
                    revision.month, revision.amount_minor, revision.pending,
                    revision.category, revision.currency_supported,
                    revision.mutation,
                    ROW_NUMBER() OVER (
                      PARTITION BY revision.connector_account_id,
                                   revision.transaction_key_sha256
                      ORDER BY revision.created_at DESC, run.started_at DESC,
                               revision.sequence DESC
                    ) AS recency
             FROM cash_flow_transaction_revisions revision
             JOIN connector_sync_runs run ON run.id = revision.sync_run_id
             WHERE revision.household_id = ?
           )
           SELECT transaction_key_sha256, account_key_sha256,
                  connector_account_id, effective_date, month, amount_minor,
                  pending, category, currency_supported
           FROM ranked
           WHERE recency = 1 AND mutation <> 'removed'
           ORDER BY transaction_key_sha256`,
        )
        .bind(householdId),
    );
  }

  private acceptedAccountKeys(
    householdId: string,
  ): Promise<readonly AcceptedAccountKeyRow[]> {
    return all<AcceptedAccountKeyRow>(
      this.db
        .prepare(
          `WITH accepted AS (
             SELECT proposal.connector_account_id, row.natural_key_sha256,
                    row.item_account_key_sha256,
                    ROW_NUMBER() OVER (
                      PARTITION BY proposal.connector_account_id,
                                   row.natural_key_sha256
                      ORDER BY decision.decided_at DESC, decision.id DESC
                    ) AS recency
             FROM cash_balance_review_decisions decision
             JOIN cash_balance_proposal_rows row
               ON row.id = decision.proposal_row_id
             JOIN cash_balance_proposals proposal
               ON proposal.id = decision.proposal_id
             JOIN connector_accounts account
               ON account.id = proposal.connector_account_id
               AND account.household_id = proposal.household_id
             WHERE decision.household_id = ? AND decision.decision = 'accepted'
               AND account.status = 'active'
               AND decision.decided_at >= COALESCE((
                 SELECT MAX(initial.started_at)
                 FROM connector_sync_runs initial
                 WHERE initial.connector_account_id = account.id
                   AND initial.cursor = 'cash-initial-v1'
               ), '')
           )
           SELECT connector_account_id,
                  item_account_key_sha256 AS natural_key_sha256
           FROM accepted
           WHERE recency = 1 AND item_account_key_sha256 IS NOT NULL
           ORDER BY connector_account_id, item_account_key_sha256`,
        )
        .bind(householdId),
    );
  }

  private coverageRows(householdId: string): Promise<readonly CoverageRow[]> {
    return all<CoverageRow>(
      this.db
        .prepare(
          `SELECT account.id AS connector_account_id,
                  flow.pricing_confirmed_at, flow.last_synced_at
           FROM connector_accounts account
           LEFT JOIN cash_flow_connections flow
             ON flow.connector_account_id = account.id
           WHERE account.household_id = ? AND account.connector_type = ?
             AND account.status = 'active'
           ORDER BY account.id`,
        )
        .bind(householdId, CONNECTOR_TYPE),
    );
  }

  private async pendingProposals(
    householdId: string,
  ): Promise<CashFlowProposal[]> {
    const proposals = await all<ProposalRow>(
      this.db
        .prepare(
          `SELECT id, status, observed_at, period_start_month,
                  period_end_month, transaction_count,
                  pending_excluded_count, unsupported_excluded_count,
                  unreviewed_account_excluded_count,
                  covered_connection_count, base_cash_flow_plan_id,
                  base_forecast_snapshot_id, base_forecast_snapshot_version,
                  household_burn_monthly_minor, business_burn_monthly_minor,
                  debt_payment_context_monthly_minor,
                  protected_cash_floor_minor, fi_eligible_liquid_minor,
                  suggested_household_burn_monthly_minor,
                  suggested_business_burn_monthly_minor
           FROM cash_flow_proposals
           WHERE household_id = ?
             AND status IN ('pending_review', 'ready_for_plan')
           ORDER BY created_at, id`,
        )
        .bind(householdId),
    );
    const [months, categories] = await Promise.all([
      all<ProposalMonthRow & { proposal_id: string }>(
        this.db
          .prepare(
            `SELECT proposal_id, month, outflow_minor, transaction_count
                 FROM cash_flow_proposal_months
                 WHERE household_id = ? AND proposal_id IN (SELECT id FROM cash_flow_proposals WHERE household_id = ? AND status IN ('pending_review', 'ready_for_plan'))
                 ORDER BY month`,
          )
          .bind(householdId, householdId),
      ),
      all<ProposalCategoryRow & { proposal_id: string }>(
        this.db
          .prepare(
            `SELECT category.proposal_id, category.id, category.category, category.label,
                        category.total_minor, category.average_monthly_minor,
                        category.transaction_count,
                        category.default_treatment,
                        decision.treatment AS reviewed_treatment,
                        decision.change_note
                 FROM cash_flow_proposal_categories category
                 LEFT JOIN cash_flow_review_decisions decision
                   ON decision.proposal_category_id = category.id
                 WHERE category.household_id = ? AND category.proposal_id IN (SELECT id FROM cash_flow_proposals WHERE household_id = ? AND status IN ('pending_review', 'ready_for_plan'))
                 ORDER BY category.total_minor DESC, category.category`,
          )
          .bind(householdId, householdId),
      ),
    ]);
    const monthsByProposal = groupRowsBy(months, (row) => row.proposal_id);
    const categoriesByProposal = groupRowsBy(
      categories,
      (row) => row.proposal_id,
    );
    return proposals.map((proposal) => {
      const months = monthsByProposal.get(proposal.id) ?? [];
      const categories = categoriesByProposal.get(proposal.id) ?? [];
      const planning: CashFlowPlanningContext = {
        baseCashFlowPlanId: proposal.base_cash_flow_plan_id,
        baseForecastSnapshotId: proposal.base_forecast_snapshot_id,
        baseForecastSnapshotVersion: proposal.base_forecast_snapshot_version,
        householdBurnMonthlyMinor: proposal.household_burn_monthly_minor,
        businessBurnMonthlyMinor: proposal.business_burn_monthly_minor,
        debtPaymentContextMonthlyMinor:
          proposal.debt_payment_context_monthly_minor,
        protectedCashFloorMinor: proposal.protected_cash_floor_minor,
        fiEligibleLiquidMinor: proposal.fi_eligible_liquid_minor,
      };
      const totals = categories.reduce(
        (result, category) => {
          const treatment =
            category.reviewed_treatment ?? category.default_treatment;
          if (treatment === "household") {
            result.household = addMinorUnits(
              result.household,
              category.total_minor,
            );
          } else if (treatment === "business") {
            result.business = addMinorUnits(
              result.business,
              category.total_minor,
            );
          }
          return result;
        },
        { household: 0, business: 0 },
      );
      const comparison = createCashFlowComparison(
        planning,
        roundedAverage(totals.household),
        roundedAverage(totals.business),
        !categories.some((category) => {
          const treatment =
            category.reviewed_treatment ?? category.default_treatment;
          return (
            category.category === "LOAN_PAYMENTS" &&
            (treatment === "household" || treatment === "business")
          );
        }),
      );
      const changeNote = categories.find(
        (category) => category.change_note !== null,
      )?.change_note;
      return {
        id: proposal.id,
        status: proposal.status,
        observedAt: proposal.observed_at,
        periodStartMonth: proposal.period_start_month,
        periodEndMonth: proposal.period_end_month,
        transactionCount: proposal.transaction_count,
        pendingExcludedCount: proposal.pending_excluded_count,
        unsupportedExcludedCount: proposal.unsupported_excluded_count,
        unreviewedAccountExcludedCount:
          proposal.unreviewed_account_excluded_count,
        coveredConnectionCount: proposal.covered_connection_count,
        planning,
        comparison,
        months: months.map((month) => ({
          month: month.month,
          outflowMinor: month.outflow_minor,
          transactionCount: month.transaction_count,
        })),
        categories: categories.map((category) => ({
          id: category.id,
          category: CashFlowCategorySchema.parse(category.category),
          label: category.label,
          totalMinor: category.total_minor,
          averageMonthlyMinor: category.average_monthly_minor,
          transactionCount: category.transaction_count,
          defaultTreatment: CashFlowTreatmentSchema.parse(
            category.default_treatment,
          ),
          reviewedTreatment:
            category.reviewed_treatment === null
              ? null
              : CashFlowTreatmentSchema.parse(category.reviewed_treatment),
        })),
        planSuggestion:
          proposal.status === "ready_for_plan" &&
          proposal.suggested_household_burn_monthly_minor !== null &&
          proposal.suggested_business_burn_monthly_minor !== null
            ? {
                proposalId: proposal.id,
                householdBurnMonthlyMinor:
                  proposal.suggested_household_burn_monthly_minor,
                businessBurnMonthlyMinor:
                  proposal.suggested_business_burn_monthly_minor,
                changeNote:
                  `Observed cash flow review: ${changeNote ?? "Reviewed category treatment."}`.slice(
                    0,
                    500,
                  ),
              }
            : null,
      } satisfies CashFlowProposal;
    });
  }
}
