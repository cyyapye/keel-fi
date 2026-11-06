import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NormalizedCashAccounts } from "@keel/connectors";

import { createSqliteFixture } from "../../../scripts/test-support/sqlite-fixture";

import { D1CashAccountsRepository } from "./cash-accounts";
import { D1PlanActualMonitoringRepository } from "./plan-actual-monitoring";
import { D1PlanInputsRepository } from "./plan-inputs";

class TestD1Statement {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: readonly SQLInputValue[] = [],
  ) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    return new TestD1Statement(this.database, this.sql, values);
  }

  public first<T>(): Promise<T | null> {
    return Promise.resolve(
      (this.database.prepare(this.sql).get(...this.values) as T) ?? null,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({
      results: this.database.prepare(this.sql).all(...this.values) as T[],
    });
  }

  public run(): Promise<{ meta: { changes: number } }> {
    const result = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }

  public execute(): void {
    this.database.prepare(this.sql).run(...this.values);
  }
}

class TestD1Database {
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
    this.database.exec("BEGIN");
    try {
      statements.forEach((statement) => statement.execute());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return Promise.resolve();
  }
}

function cashObservation(valueMinor: number): NormalizedCashAccounts {
  return {
    normalizedFingerprint: "f".repeat(64),
    observedAt: "2026-08-15T12:00:00.000Z",
    rows: [
      {
        naturalKeySha256: "a".repeat(64),
        itemAccountKeySha256: "a".repeat(64),
        institutionLabel: "Synthetic Bank",
        accountLabel: "Operating cash",
        subtype: "checking",
        availableMinor: valueMinor,
        currentMinor: valueMinor,
        valueMinor,
        valueState: "reported",
        balanceSource: "available",
        observedAt: "2026-08-15T12:00:00.000Z",
        issues: [],
      },
    ],
  };
}

function insertReviewedNoChangeBurn(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO connector_accounts (
      id, household_id, connector_type, display_label, secret_reference,
      status, last_synced_at, created_at
    ) VALUES (
      'connector_m10_cash', 'hh_demo', 'plaid-cash', 'Synthetic Bank',
      'connector-secrets/m10-synthetic.enc', 'active',
      '2026-08-15T12:00:00.000Z', '2026-08-15T12:00:00.000Z'
    );
    INSERT INTO connector_sync_runs (
      id, household_id, connector_account_id, status, started_at,
      finished_at, cursor, discovered_count, proposed_count, error_code
    ) VALUES (
      'sync_m10_cash_flow', 'hh_demo', 'connector_m10_cash', 'succeeded',
      '2026-08-15T11:59:00.000Z', '2026-08-15T12:00:00.000Z',
      'cash-flow-initial-v1', 30, 1, NULL
    );
    INSERT INTO cash_flow_proposals (
      id, household_id, trigger_sync_run_id, source_revision, status,
      observed_at, period_start_month, period_end_month, transaction_count,
      pending_excluded_count, unsupported_excluded_count,
      unreviewed_account_excluded_count, covered_connection_count,
      base_cash_flow_plan_id, base_forecast_snapshot_id,
      base_forecast_snapshot_version, household_burn_monthly_minor,
      business_burn_monthly_minor, debt_payment_context_monthly_minor,
      protected_cash_floor_minor, fi_eligible_liquid_minor,
      suggested_household_burn_monthly_minor,
      suggested_business_burn_monthly_minor, reviewed_at,
      applied_cash_flow_plan_id, applied_at, created_at
    ) VALUES (
      'proposal_m10_no_change', 'hh_demo', 'sync_m10_cash_flow',
      '${"e".repeat(64)}', 'pending_review', '2026-08-15T12:00:00.000Z',
      '2026-05', '2026-07', 30, 0, 0, 0, 1, 'cf_fi', 'snap_fi_v3',
      3, 2850000, 1250000, 0, 10300000, 182500000,
      NULL, NULL, NULL, NULL, NULL, '2026-08-15T12:00:00.000Z'
    );
    INSERT INTO cash_flow_proposal_months (
      id, household_id, proposal_id, month, outflow_minor,
      transaction_count, created_at, immutable
    ) VALUES
      ('month_m10_may', 'hh_demo', 'proposal_m10_no_change', '2026-05',
       4100000, 10, '2026-08-15T12:00:00.000Z', 1),
      ('month_m10_jun', 'hh_demo', 'proposal_m10_no_change', '2026-06',
       4100000, 10, '2026-08-15T12:00:00.000Z', 1),
      ('month_m10_jul', 'hh_demo', 'proposal_m10_no_change', '2026-07',
       4100000, 10, '2026-08-15T12:00:00.000Z', 1);
    INSERT INTO cash_flow_proposal_categories (
      id, household_id, proposal_id, category, label, total_minor,
      average_monthly_minor, transaction_count, default_treatment,
      created_at, immutable
    ) VALUES
      ('category_m10_household', 'hh_demo', 'proposal_m10_no_change',
       'FOOD_AND_DRINK', 'Household', 8550000, 2850000, 20, 'household',
       '2026-08-15T12:00:00.000Z', 1),
      ('category_m10_business', 'hh_demo', 'proposal_m10_no_change',
       'GENERAL_SERVICES', 'Business', 3750000, 1250000, 10, 'business',
       '2026-08-15T12:00:00.000Z', 1);
    INSERT INTO cash_flow_review_decisions (
      id, household_id, proposal_id, proposal_category_id, reviewer_user_id,
      treatment, change_note, decided_at, immutable
    ) VALUES
      ('decision_m10_household', 'hh_demo', 'proposal_m10_no_change',
       'category_m10_household', 'usr_demo', 'household',
       'Reviewed synthetic household burn.', '2026-08-15T12:05:00.000Z', 1),
      ('decision_m10_business', 'hh_demo', 'proposal_m10_no_change',
       'category_m10_business', 'usr_demo', 'business',
       'Reviewed synthetic business burn.', '2026-08-15T12:05:00.000Z', 1);
    UPDATE cash_flow_proposals
    SET status = 'reviewed_no_change', reviewed_at = '2026-08-15T12:05:00.000Z'
    WHERE id = 'proposal_m10_no_change';
  `);
}

describe("plan-versus-actual monitoring persistence", () => {
  let sqlite: DatabaseSync;
  let database: D1Database;
  let monitoring: D1PlanActualMonitoringRepository;

  beforeEach(() => {
    const migrationDirectory = resolve(
      process.cwd(),
      "packages/database/migrations",
    );
    sqlite = createSqliteFixture([
      ...readdirSync(migrationDirectory)
        .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
        .sort((left, right) => left.localeCompare(right))
        .map((file) => resolve(migrationDirectory, file)),
      resolve(process.cwd(), "packages/database/seed/synthetic.sql"),
    ]);
    database = new TestD1Database(sqlite) as unknown as D1Database;
    monitoring = new D1PlanActualMonitoringRepository(database);
  });

  afterEach(() => sqlite.close());

  it("returns an explicit limited no-action state when actual sources are not enabled", async () => {
    await expect(
      monitoring.getState(
        "synthetic-access-subject",
        "2026-08-16T12:00:00.000Z",
      ),
    ).resolves.toMatchObject({
      status: "limited",
      actionItems: [],
      coverage: {
        cash: "not_configured",
        debt: "not_configured",
        burn: "not_configured",
        runway: "limited",
      },
    });
  });

  it("projects accepted cash drift and appends an exact-source cooldown", async () => {
    const cash = new D1CashAccountsRepository(database);
    const connection = await cash.upsertConnection(
      "synthetic-access-subject",
      "Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "b".repeat(64),
    );
    const run = await cash.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const staged = await cash.stageProposal(
      "synthetic-access-subject",
      run.id,
      {
        objectKey: "cash-observations/m10-synthetic.json",
        sourceSha256: "c".repeat(64),
        normalized: cashObservation(1_000_000),
      },
    );
    const proposal = staged.proposal;
    if (proposal === null) {
      throw new Error("Expected a synthetic cash proposal.");
    }
    await cash.completeRefresh(
      "synthetic-access-subject",
      run.id,
      proposal.id,
      1,
    );
    await cash.applyProposal("synthetic-access-subject", proposal.id, {
      decisions: proposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted" as const,
      })),
      changeNote: "Accepted synthetic cash for monitoring.",
    });

    const evaluatedAt = "2026-08-16T12:00:00.000Z";
    const before = await monitoring.getState(
      "synthetic-access-subject",
      evaluatedAt,
    );
    const cashItem = before.actionItems.find(
      (item) => item.key === "cash_drift",
    );
    expect(cashItem).toMatchObject({
      plannedValueMinor: 0,
      actualValueMinor: 1_000_000,
      thresholdMinor: 500_000,
    });
    if (cashItem === undefined) {
      throw new Error("Expected a cash monitoring item.");
    }

    const deferred = await monitoring.snooze(
      "synthetic-access-subject",
      {
        itemKey: cashItem.key,
        sourceRevision: cashItem.sourceRevision,
        durationDays: 7,
      },
      evaluatedAt,
    );
    expect(deferred.actionItems).toEqual([]);
    expect(deferred.deferredItems).toMatchObject([
      {
        key: "cash_drift",
        cooldownUntil: "2026-08-23T12:00:00.000Z",
      },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT item_key, source_revision, snoozed_until, immutable FROM plan_actual_monitoring_cooldowns",
        )
        .get(),
    ).toEqual({
      item_key: "cash_drift",
      source_revision: before.sourceRevision,
      snoozed_until: "2026-08-23T12:00:00.000Z",
      immutable: 1,
    });
    expect(() =>
      sqlite
        .prepare(
          "UPDATE plan_actual_monitoring_cooldowns SET snoozed_until = ?",
        )
        .run("2026-08-24T12:00:00.000Z"),
    ).toThrow("monitoring cooldowns are immutable");
    await expect(
      monitoring.snooze(
        "synthetic-access-subject",
        {
          itemKey: "cash_drift",
          sourceRevision: "d".repeat(64),
          durationDays: 7,
        },
        evaluatedAt,
      ),
    ).rejects.toThrow("changed or is already deferred");
  });

  it("keeps a reviewed no-change burn observation distinct from a later plan edit", async () => {
    insertReviewedNoChangeBurn(sqlite);
    const planInputs = new D1PlanInputsRepository(database);
    const current = await planInputs.getState("synthetic-access-subject");
    await planInputs.save("synthetic-access-subject", {
      baseCashFlowPlanId: current.baseCashFlowPlanId,
      baseForecastSnapshotId: current.baseForecastSnapshotId,
      baseForecastSnapshotVersion: current.baseForecastSnapshotVersion,
      householdBurnMonthlyMinor: 4_000_000,
      businessBurnMonthlyMinor: 2_000_000,
      protectedCashFloorMinor: current.values.protectedCashFloorMinor,
      changeNote: "Changed the synthetic plan after reviewing burn.",
    });

    const state = await monitoring.getState(
      "synthetic-access-subject",
      "2026-08-16T12:00:00.000Z",
    );
    expect(
      state.actionItems.find((item) => item.key === "burn_drift"),
    ).toMatchObject({
      plannedValueMinor: 6_000_000,
      actualValueMinor: 4_100_000,
      differenceMinor: -1_900_000,
    });
  });
});
