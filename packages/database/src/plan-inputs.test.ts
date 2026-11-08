import { createSqliteFixture } from "../../../scripts/test-support/sqlite-fixture";
import { readdirSync } from "node:fs";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { D1AlphaRepository } from "./index";
import { D1PlanInputsRepository } from "./plan-inputs";

const migrationFiles = [
  ...readdirSync("packages/database/migrations")
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort()
    .map((file) => `packages/database/migrations/${file}`),
  "packages/database/seed/synthetic.sql",
];

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

describe("plan input persistence", () => {
  let sqlite: DatabaseSync;
  let database: D1Database;
  let repository: D1PlanInputsRepository;

  beforeEach(() => {
    sqlite = createSqliteFixture(migrationFiles);
    database = new TestD1Database(sqlite) as unknown as D1Database;
    repository = new D1PlanInputsRepository(database);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("loads the accepted FI plan and appends a matching forecast version", async () => {
    const before = await repository.getState("synthetic-access-subject");
    expect(before).toEqual({
      baseCashFlowPlanId: "cf_fi",
      baseForecastSnapshotId: "snap_fi_v3",
      baseForecastSnapshotVersion: 3,
      values: {
        householdBurnMonthlyMinor: 2_850_000,
        businessBurnMonthlyMinor: 1_250_000,
        protectedCashFloorMinor: 10_300_000,
      },
      fiEligibleLiquidMinor: 182_500_000,
      fiTargetMinor: 325_000_000,
      forecastHorizonDate: "2031-12-31",
      impact: {
        totalMonthlyBurnMinor: 4_100_000,
        liquidAfterCashFloorMinor: 172_200_000,
        protectedRunwayMonths: 42,
      },
    });

    const result = await repository.save("synthetic-access-subject", {
      baseCashFlowPlanId: before.baseCashFlowPlanId,
      baseForecastSnapshotId: before.baseForecastSnapshotId,
      baseForecastSnapshotVersion: before.baseForecastSnapshotVersion,
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
      protectedCashFloorMinor: 15_000_000,
      changeNote: "Updated synthetic runway inputs.",
    });

    expect(result).toMatchObject({
      createdBy: "Demo Operator",
      priorImpact: before.impact,
      plan: {
        baseForecastSnapshotVersion: 4,
        values: {
          householdBurnMonthlyMinor: 3_000_000,
          businessBurnMonthlyMinor: 1_500_000,
          protectedCashFloorMinor: 15_000_000,
        },
        impact: {
          totalMonthlyBurnMinor: 4_500_000,
          liquidAfterCashFloorMinor: 167_500_000,
          protectedRunwayMonths: 37,
        },
      },
    });

    const savedPlan = sqlite
      .prepare(
        `SELECT household_burn_monthly_minor, business_burn_monthly_minor,
                fi_eligible_liquid_minor, protected_cash_floor_minor,
                fi_target_minor, provenance
         FROM cash_flow_plans WHERE id = ?`,
      )
      .get(result.plan.baseCashFlowPlanId) as Record<string, unknown>;
    expect(savedPlan).toEqual({
      household_burn_monthly_minor: 3_000_000,
      business_burn_monthly_minor: 1_500_000,
      fi_eligible_liquid_minor: 182_500_000,
      protected_cash_floor_minor: 15_000_000,
      fi_target_minor: 325_000_000,
      provenance: `Plan inputs for forecast ${result.plan.baseForecastSnapshotId}`,
    });
    expect(
      sqlite
        .prepare(
          `SELECT trigger, attributed_change FROM forecast_snapshots
           WHERE id = ?`,
        )
        .get(result.plan.baseForecastSnapshotId),
    ).toEqual({
      trigger: "Plan inputs",
      attributed_change: "Updated synthetic runway inputs.",
    });

    const artifactCounts = sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM company_forecasts
            WHERE forecast_snapshot_id = ?) AS company_count,
           (SELECT COUNT(*) FROM liquidity_curves
            WHERE forecast_snapshot_id = ?) AS curve_count,
           (SELECT COUNT(*) FROM forecast_outputs
            WHERE forecast_snapshot_id = ?) AS output_count`,
      )
      .get(
        result.plan.baseForecastSnapshotId,
        result.plan.baseForecastSnapshotId,
        result.plan.baseForecastSnapshotId,
      );
    expect(artifactCounts).toEqual({
      company_count: 3,
      curve_count: 5,
      output_count: 4,
    });

    const alpha = await new D1AlphaRepository(database).getAlphaData(
      "synthetic-access-subject",
    );
    expect(alpha.dashboard).toMatchObject({
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
      protectedCashFloorMinor: 15_000_000,
      protectedRunwayMonths: 37,
    });
    expect(alpha.forecastHistory[0]).toMatchObject({
      version: 4,
      trigger: "Plan inputs",
      attributedChange: "Updated synthetic runway inputs.",
      priorP50Minor: 210_000_000,
      p50Minor: 210_000_000,
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM goal_versions
           WHERE goal_id = 'goal_fi'`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("rejects stale and no-op saves without creating redundant versions", async () => {
    const before = await repository.getState("synthetic-access-subject");
    const input = {
      baseCashFlowPlanId: before.baseCashFlowPlanId,
      baseForecastSnapshotId: before.baseForecastSnapshotId,
      baseForecastSnapshotVersion: before.baseForecastSnapshotVersion,
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
      protectedCashFloorMinor: 15_000_000,
      changeNote: "Updated synthetic runway inputs.",
    };
    await repository.save("synthetic-access-subject", input);
    await expect(
      repository.save("synthetic-access-subject", input),
    ).rejects.toThrow("Plan inputs are stale");

    const current = await repository.getState("synthetic-access-subject");
    await expect(
      repository.save("synthetic-access-subject", {
        ...current.values,
        baseCashFlowPlanId: current.baseCashFlowPlanId,
        baseForecastSnapshotId: current.baseForecastSnapshotId,
        baseForecastSnapshotVersion: current.baseForecastSnapshotVersion,
        changeNote: "No actual change.",
      }),
    ).rejects.toThrow("Plan inputs are already current");
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM forecast_snapshots
           WHERE scenario_id = 'scn_fi'`,
        )
        .get(),
    ).toEqual({ count: 4 });
  });

  it("keeps every cash-flow plan immutable and handles zero burn safely", async () => {
    expect(() =>
      sqlite
        .prepare(
          `UPDATE cash_flow_plans SET household_burn_monthly_minor = 1
           WHERE id = 'cf_fi'`,
        )
        .run(),
    ).toThrow("cash flow plans are immutable");
    expect(() =>
      sqlite.prepare("DELETE FROM cash_flow_plans WHERE id = 'cf_fi'").run(),
    ).toThrow("cash flow plans are immutable");

    const before = await repository.getState("synthetic-access-subject");
    await repository.save("synthetic-access-subject", {
      baseCashFlowPlanId: before.baseCashFlowPlanId,
      baseForecastSnapshotId: before.baseForecastSnapshotId,
      baseForecastSnapshotVersion: before.baseForecastSnapshotVersion,
      householdBurnMonthlyMinor: 0,
      businessBurnMonthlyMinor: 0,
      protectedCashFloorMinor: 200_000_000,
      changeNote: "Pause synthetic monthly burn.",
    });
    const alpha = await new D1AlphaRepository(database).getAlphaData(
      "synthetic-access-subject",
    );
    expect(alpha.dashboard.protectedRunwayMonths).toBe(0);
  });
});
