import {
  createPlanInputImpact,
  PlanInputSaveResultSchema,
  PlanInputSaveSchema,
  PlanInputStateSchema,
  type PlanInputSave,
  type PlanInputSaveResult,
  type PlanInputState,
} from "@keel/domain";

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
  display_name: string;
};

type PlanningRow = {
  scenario_id: string;
  cash_flow_plan_id: string;
  forecast_snapshot_id: string;
  forecast_snapshot_version: number;
  household_burn_monthly_minor: number;
  business_burn_monthly_minor: number;
  fi_eligible_liquid_minor: number;
  protected_cash_floor_minor: number;
  fi_target_minor: number;
  forecast_horizon_date: string;
};

type CompanyForecastRow = {
  company_id: string;
  conditional_value_minor: number;
  timing_adjusted_liquidity_minor: number;
  probability_zero_ppm: number;
  effective_date: string;
};

type LiquidityCurveRow = {
  year: number;
  p25_minor: number;
  p50_minor: number;
  p75_minor: number;
  expected_minor: number;
  probability_zero_ppm: number;
};

type ForecastOutputRow = {
  metric_key: string;
  horizon_date: string;
  percentile: number | null;
  value_minor: number | null;
  probability_ppm: number | null;
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

function stateFromPlanning(planning: PlanningRow): PlanInputState {
  const values = {
    householdBurnMonthlyMinor: planning.household_burn_monthly_minor,
    businessBurnMonthlyMinor: planning.business_burn_monthly_minor,
    protectedCashFloorMinor: planning.protected_cash_floor_minor,
  };
  return PlanInputStateSchema.parse({
    baseCashFlowPlanId: planning.cash_flow_plan_id,
    baseForecastSnapshotId: planning.forecast_snapshot_id,
    baseForecastSnapshotVersion: planning.forecast_snapshot_version,
    values,
    fiEligibleLiquidMinor: planning.fi_eligible_liquid_minor,
    fiTargetMinor: planning.fi_target_minor,
    forecastHorizonDate: planning.forecast_horizon_date,
    impact: createPlanInputImpact(values, planning.fi_eligible_liquid_minor),
  });
}

export interface PlanInputsRepository {
  getState(accessSubject: string): Promise<PlanInputState>;
  save(
    accessSubject: string,
    input: PlanInputSave,
  ): Promise<PlanInputSaveResult>;
}

export class D1PlanInputsRepository implements PlanInputsRepository {
  public constructor(private readonly db: D1Database) {}

  public async getState(accessSubject: string): Promise<PlanInputState> {
    const identity = await this.findIdentity(accessSubject);
    return stateFromPlanning(await this.getPlanningRow(identity.household_id));
  }

  public async save(
    accessSubject: string,
    rawInput: PlanInputSave,
  ): Promise<PlanInputSaveResult> {
    const input = PlanInputSaveSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const planning = await this.getPlanningRow(identity.household_id);
    if (
      planning.cash_flow_plan_id !== input.baseCashFlowPlanId ||
      planning.forecast_snapshot_id !== input.baseForecastSnapshotId ||
      planning.forecast_snapshot_version !== input.baseForecastSnapshotVersion
    ) {
      throw new Error("Plan inputs are stale.");
    }
    if (
      planning.household_burn_monthly_minor ===
        input.householdBurnMonthlyMinor &&
      planning.business_burn_monthly_minor === input.businessBurnMonthlyMinor &&
      planning.protected_cash_floor_minor === input.protectedCashFloorMinor
    ) {
      throw new Error("Plan inputs are already current.");
    }
    if (input.cashFlowProposalId !== undefined) {
      const proposal = await this.db
        .prepare(
          `SELECT base_cash_flow_plan_id, base_forecast_snapshot_id,
                  base_forecast_snapshot_version,
                  suggested_household_burn_monthly_minor,
                  suggested_business_burn_monthly_minor,
                  protected_cash_floor_minor
           FROM cash_flow_proposals
           WHERE id = ? AND household_id = ? AND status = 'ready_for_plan'`,
        )
        .bind(input.cashFlowProposalId, identity.household_id)
        .first<{
          base_cash_flow_plan_id: string;
          base_forecast_snapshot_id: string;
          base_forecast_snapshot_version: number;
          suggested_household_burn_monthly_minor: number;
          suggested_business_burn_monthly_minor: number;
          protected_cash_floor_minor: number;
        }>();
      if (
        proposal === null ||
        proposal.base_cash_flow_plan_id !== input.baseCashFlowPlanId ||
        proposal.base_forecast_snapshot_id !== input.baseForecastSnapshotId ||
        proposal.base_forecast_snapshot_version !==
          input.baseForecastSnapshotVersion ||
        proposal.suggested_household_burn_monthly_minor !==
          input.householdBurnMonthlyMinor ||
        proposal.suggested_business_burn_monthly_minor !==
          input.businessBurnMonthlyMinor ||
        proposal.protected_cash_floor_minor !== input.protectedCashFloorMinor
      ) {
        throw new Error("Observed cash-flow proposal is stale.");
      }
    }

    const [companyForecasts, curves, outputs] = await Promise.all([
      all<CompanyForecastRow>(
        this.db
          .prepare(
            `SELECT company_id, conditional_value_minor,
                    timing_adjusted_liquidity_minor, probability_zero_ppm,
                    effective_date
             FROM company_forecasts
             WHERE household_id = ? AND forecast_snapshot_id = ?
             ORDER BY company_id`,
          )
          .bind(identity.household_id, input.baseForecastSnapshotId),
      ),
      all<LiquidityCurveRow>(
        this.db
          .prepare(
            `SELECT year, p25_minor, p50_minor, p75_minor, expected_minor,
                    probability_zero_ppm
             FROM liquidity_curves
             WHERE household_id = ? AND forecast_snapshot_id = ?
             ORDER BY year`,
          )
          .bind(identity.household_id, input.baseForecastSnapshotId),
      ),
      all<ForecastOutputRow>(
        this.db
          .prepare(
            `SELECT metric_key, horizon_date, percentile, value_minor,
                    probability_ppm
             FROM forecast_outputs
             WHERE household_id = ? AND forecast_snapshot_id = ?
             ORDER BY metric_key, percentile`,
          )
          .bind(identity.household_id, input.baseForecastSnapshotId),
      ),
    ]);

    const priorImpact = createPlanInputImpact(
      {
        householdBurnMonthlyMinor: planning.household_burn_monthly_minor,
        businessBurnMonthlyMinor: planning.business_burn_monthly_minor,
        protectedCashFloorMinor: planning.protected_cash_floor_minor,
      },
      planning.fi_eligible_liquid_minor,
    );
    const values = {
      householdBurnMonthlyMinor: input.householdBurnMonthlyMinor,
      businessBurnMonthlyMinor: input.businessBurnMonthlyMinor,
      protectedCashFloorMinor: input.protectedCashFloorMinor,
    };
    const impact = createPlanInputImpact(
      values,
      planning.fi_eligible_liquid_minor,
    );
    const createdAt = new Date().toISOString();
    const cashFlowPlanId = crypto.randomUUID();
    const forecastSnapshotId = crypto.randomUUID();
    const forecastSnapshotVersion = planning.forecast_snapshot_version + 1;
    const inputHash = await sha256(
      [
        "plan-inputs",
        input.baseCashFlowPlanId,
        input.baseForecastSnapshotId,
        forecastSnapshotVersion,
        input.householdBurnMonthlyMinor,
        input.businessBurnMonthlyMinor,
        input.protectedCashFloorMinor,
      ].join("|"),
    );
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO cash_flow_plans (
             id, household_id, scenario_id, household_burn_monthly_minor,
             business_burn_monthly_minor, fi_eligible_liquid_minor,
             protected_cash_floor_minor, fi_target_minor, effective_date,
             provenance, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          cashFlowPlanId,
          identity.household_id,
          planning.scenario_id,
          input.householdBurnMonthlyMinor,
          input.businessBurnMonthlyMinor,
          planning.fi_eligible_liquid_minor,
          input.protectedCashFloorMinor,
          planning.fi_target_minor,
          createdAt,
          `Plan inputs for forecast ${forecastSnapshotId}`,
          createdAt,
        ),
      this.db
        .prepare(
          `INSERT INTO forecast_snapshots (
             id, household_id, scenario_id, version, input_hash, created_at,
             created_by, trigger, attributed_change, immutable
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Plan inputs', ?, 1)`,
        )
        .bind(
          forecastSnapshotId,
          identity.household_id,
          planning.scenario_id,
          forecastSnapshotVersion,
          inputHash,
          createdAt,
          identity.display_name,
          input.changeNote,
        ),
    ];

    companyForecasts.forEach((row) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO company_forecasts (
               id, household_id, forecast_snapshot_id, scenario_id,
               company_id, conditional_value_minor,
               timing_adjusted_liquidity_minor, probability_zero_ppm,
               effective_date, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            forecastSnapshotId,
            planning.scenario_id,
            row.company_id,
            row.conditional_value_minor,
            row.timing_adjusted_liquidity_minor,
            row.probability_zero_ppm,
            row.effective_date,
            createdAt,
          ),
      );
    });
    curves.forEach((row) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO liquidity_curves (
               id, household_id, forecast_snapshot_id, scenario_id, year,
               p25_minor, p50_minor, p75_minor, expected_minor,
               probability_zero_ppm, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            forecastSnapshotId,
            planning.scenario_id,
            row.year,
            row.p25_minor,
            row.p50_minor,
            row.p75_minor,
            row.expected_minor,
            row.probability_zero_ppm,
            createdAt,
          ),
      );
    });
    outputs.forEach((row) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO forecast_outputs (
               id, household_id, forecast_snapshot_id, metric_key,
               horizon_date, percentile, value_minor, probability_ppm,
               created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            forecastSnapshotId,
            row.metric_key,
            row.horizon_date,
            row.percentile,
            row.value_minor,
            row.probability_ppm,
            createdAt,
          ),
      );
    });
    if (input.cashFlowProposalId !== undefined) {
      statements.push(
        this.db
          .prepare(
            `UPDATE cash_flow_proposals
             SET status = 'applied', applied_cash_flow_plan_id = ?,
                 applied_at = ?
             WHERE id = ? AND household_id = ?`,
          )
          .bind(
            cashFlowPlanId,
            createdAt,
            input.cashFlowProposalId,
            identity.household_id,
          ),
      );
    }

    await this.db.batch(statements);
    return PlanInputSaveResultSchema.parse({
      plan: {
        baseCashFlowPlanId: cashFlowPlanId,
        baseForecastSnapshotId: forecastSnapshotId,
        baseForecastSnapshotVersion: forecastSnapshotVersion,
        values,
        fiEligibleLiquidMinor: planning.fi_eligible_liquid_minor,
        fiTargetMinor: planning.fi_target_minor,
        forecastHorizonDate: planning.forecast_horizon_date,
        impact,
      },
      priorImpact,
      createdAt,
      createdBy: identity.display_name,
    });
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id, user.id AS user_id,
                user.display_name
         FROM users user
         JOIN households household ON household.owner_user_id = user.id
         WHERE user.access_subject = ?
         ORDER BY household.created_at
         LIMIT 1`,
      )
      .bind(accessSubject)
      .first<HouseholdIdentity>();
    if (identity === null) {
      throw new Error("No household is provisioned for this identity.");
    }
    return identity;
  }

  private async getPlanningRow(householdId: string): Promise<PlanningRow> {
    const row = await this.db
      .prepare(
        `SELECT scenario.id AS scenario_id,
                plan.id AS cash_flow_plan_id,
                snapshot.id AS forecast_snapshot_id,
                snapshot.version AS forecast_snapshot_version,
                plan.household_burn_monthly_minor,
                plan.business_burn_monthly_minor,
                plan.fi_eligible_liquid_minor,
                plan.protected_cash_floor_minor,
                plan.fi_target_minor,
                p50.horizon_date AS forecast_horizon_date
         FROM scenarios scenario
         JOIN cash_flow_plans plan
           ON plan.id = (
             SELECT latest.id
             FROM cash_flow_plans latest
             WHERE latest.scenario_id = scenario.id
             ORDER BY latest.effective_date DESC, latest.created_at DESC,
                      latest.id DESC
             LIMIT 1
           )
         JOIN forecast_snapshots snapshot
           ON snapshot.scenario_id = scenario.id
           AND snapshot.version = (
             SELECT MAX(latest.version)
             FROM forecast_snapshots latest
             WHERE latest.scenario_id = scenario.id
           )
         JOIN forecast_outputs p50
           ON p50.forecast_snapshot_id = snapshot.id
           AND p50.metric_key = 'cumulative_liquidity'
           AND p50.percentile = 50
         WHERE scenario.household_id = ?
           AND scenario.name = 'FI Underwriting'`,
      )
      .bind(householdId)
      .first<PlanningRow>();
    if (row === null) {
      throw new Error("Plan inputs require a complete FI forecast.");
    }
    return row;
  }
}
