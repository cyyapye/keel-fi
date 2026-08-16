import { isRobinhoodFiPlanningSecurityType } from "@keel/connectors";
import {
  addMinorUnits,
  createGoalPreview,
  createPortfolioBaselineImpact,
  PortfolioBaselineConfirmInputSchema,
  PortfolioBaselineConfirmResultSchema,
  PortfolioBaselineStateSchema,
  subtractMinorUnits,
  type PortfolioBaselineConfirmInput,
  type PortfolioBaselineConfirmResult,
  type PortfolioBaselineCashAccount,
  type PortfolioBaselinePosition,
  type PortfolioBaselineRecord,
  type PortfolioBaselineState,
  type PortfolioBaselineSummary,
} from "@keel/domain";

import {
  projectCashAccountIdentities,
  type AcceptedCashAccountHistoryRow,
} from "./cash-account-identity";
import {
  holdingPositionReadSource,
  type HoldingPositionReadOptions,
} from "./holding-position-compatibility";

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
  display_name: string;
};

type SourcePositionRow = {
  position_id: string;
  snapshot_id: string;
  snapshot_fingerprint: string;
  provider: "angellist" | "robinhood";
  legal_vehicle_name: string;
  owner_label: string;
  exposure_label: string | null;
  unrealized_value_minor: number | null;
  unrealized_value_state: "reported" | "locked" | "not_reported";
  observed_at: string;
  ticker: string | null;
  instrument_type: string;
};

type SourceCashAccountRow = AcceptedCashAccountHistoryRow & {
  proposal_row_id: string;
};

type CashAccountIdentityDecisionRow = {
  connector_account_id: string;
  natural_key_low_sha256: string;
  natural_key_high_sha256: string;
};

type PlanningRow = {
  scenario_id: string;
  forecast_snapshot_id: string;
  forecast_snapshot_version: number;
  cash_flow_plan_id: string;
  household_burn_monthly_minor: number;
  business_burn_monthly_minor: number;
  fi_eligible_liquid_minor: number;
  protected_cash_floor_minor: number;
  fi_target_minor: number;
  forecast_horizon_date: string;
  p25_five_year_liquidity_minor: number;
  p50_five_year_liquidity_minor: number;
  p75_five_year_liquidity_minor: number;
};

type BaselineRow = {
  id: string;
  source_revision: string;
  source_observed_at: string;
  position_count: number;
  public_market_value_minor: number;
  private_paper_value_minor: number;
  cash_account_count: number;
  cash_account_value_minor: number;
  unknown_cash_account_count: number;
  unknown_value_count: number;
  potential_duplicate_count: number;
  prior_fi_eligible_liquid_minor: number;
  fi_eligible_liquid_minor: number;
  forecast_snapshot_id: string;
  forecast_snapshot_version: number;
  goal_version: number | null;
  change_note: string;
  created_at: string;
  created_by: string;
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

type FinancialIndependenceGoalRow = {
  goal_id: string;
  latest_version: number;
  name: string;
  metric_key: string;
  metric_label: string;
  target_value_integer: number | null;
  target_unit: "minor_units";
  target_date: string | null;
  is_primary: number;
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

function normalizedDuplicateKey(name: string, ticker: string | null): string {
  const trimmedName = name.trimStart();
  const possibleTickerSuffix =
    ticker !== null &&
    trimmedName.toUpperCase().startsWith(ticker.toUpperCase())
      ? trimmedName.slice(ticker.length).trimStart()
      : null;
  const nameWithoutTicker =
    possibleTickerSuffix !== null && /^[·:–—-]/u.test(possibleTickerSuffix)
      ? possibleTickerSuffix.slice(1).trimStart()
      : name;
  const normalized = nameWithoutTicker
    .normalize("NFKD")
    .toLowerCase()
    .replace(
      /\b(?:incorporated|corporation|company|holdings?|limited|fund|spv|inc|corp|llc|ltd)\b/gu,
      "",
    )
    .replace(/[^a-z0-9]+/gu, "");
  return normalized.length > 0
    ? `name:${normalized}`
    : `ticker:${ticker?.toUpperCase() ?? "unknown"}`;
}

async function sourceRevision(
  rows: readonly SourcePositionRow[],
  cashRows: readonly SourceCashAccountRow[],
): Promise<string> {
  return sha256(
    [
      ...rows.map((row) =>
        [
          "holding",
          row.position_id,
          row.snapshot_id,
          row.snapshot_fingerprint,
          row.provider,
          row.unrealized_value_minor ?? "unknown",
          row.unrealized_value_state,
          row.observed_at,
          row.ticker ?? "",
          row.instrument_type,
        ].join(":"),
      ),
      ...cashRows.map((row) =>
        [
          "cash",
          row.decision_id,
          row.proposal_row_id,
          row.natural_key_sha256,
          row.value_minor ?? "unknown",
          row.value_state,
          row.refresh_kind,
          row.observed_at,
        ].join(":"),
      ),
    ]
      .sort((left, right) => left.localeCompare(right))
      .join("|"),
  );
}

function baselineRecordFromRow(row: BaselineRow): PortfolioBaselineRecord {
  return {
    id: row.id,
    sourceRevision: row.source_revision,
    observedAt: row.source_observed_at,
    summary: {
      positionCount: row.position_count,
      publicMarketValueMinor: row.public_market_value_minor,
      privatePaperValueMinor: row.private_paper_value_minor,
      cashAccountCount: row.cash_account_count,
      cashAccountValueMinor: row.cash_account_value_minor,
      unknownCashAccountCount: row.unknown_cash_account_count,
      unknownValueCount: row.unknown_value_count,
      potentialDuplicateCount: row.potential_duplicate_count,
    },
    priorFiEligibleLiquidMinor: row.prior_fi_eligible_liquid_minor,
    fiEligibleLiquidMinor: row.fi_eligible_liquid_minor,
    otherFiEligibleLiquidMinor: Math.max(
      subtractMinorUnits(
        row.fi_eligible_liquid_minor,
        addMinorUnits(
          row.public_market_value_minor,
          row.cash_account_value_minor,
        ),
      ),
      0,
    ),
    forecastSnapshotId: row.forecast_snapshot_id,
    forecastSnapshotVersion: row.forecast_snapshot_version,
    goalVersion: row.goal_version,
    changeNote: row.change_note,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function sourceCashAccounts(
  rows: readonly SourceCashAccountRow[],
): PortfolioBaselineCashAccount[] {
  return rows.map((row) => ({
    id: row.decision_id,
    institutionLabel: row.institution_label,
    accountLabel: row.account_label,
    subtype: row.subtype,
    valueMinor: row.value_minor,
    valueState: row.value_state,
    refreshKind: row.refresh_kind,
    observedAt: row.observed_at,
  }));
}

function sourcePositions(
  rows: readonly SourcePositionRow[],
): PortfolioBaselinePosition[] {
  const material = rows.map((row) => {
    const positionName = row.exposure_label ?? row.legal_vehicle_name;
    return {
      row,
      positionName,
      duplicateKey: normalizedDuplicateKey(positionName, row.ticker),
    };
  });
  const providersByDuplicateKey = new Map<string, Set<string>>();
  material.forEach(({ duplicateKey, row }) => {
    const providers = providersByDuplicateKey.get(duplicateKey) ?? new Set();
    providers.add(row.provider);
    providersByDuplicateKey.set(duplicateKey, providers);
  });

  return material.map(({ duplicateKey, positionName, row }) => {
    const duplicateWith = material
      .filter(
        (candidate) =>
          candidate.duplicateKey === duplicateKey &&
          candidate.row.provider !== row.provider,
      )
      .map((candidate) => candidate.positionName)
      .sort((left, right) => left.localeCompare(right));
    const potentialDuplicate =
      (providersByDuplicateKey.get(duplicateKey)?.size ?? 0) > 1;
    return {
      id: row.position_id,
      positionName,
      ownerLabel: row.owner_label,
      sourceLabel: row.provider === "robinhood" ? "Robinhood" : "AngelList",
      provider: row.provider,
      classification:
        row.provider === "robinhood" ? "public_market" : "private_paper",
      valueMinor: row.unrealized_value_minor,
      valueState: row.unrealized_value_state,
      observedAt: row.observed_at,
      ticker: row.ticker,
      isCashPosition: row.instrument_type.toLowerCase() === "cash",
      potentialDuplicate,
      duplicateWith,
    };
  });
}

function summarizePositions(
  positions: readonly PortfolioBaselinePosition[],
  cashAccounts: readonly PortfolioBaselineCashAccount[],
): PortfolioBaselineSummary {
  return {
    positionCount: positions.length,
    publicMarketValueMinor: addMinorUnits(
      ...positions
        .filter(
          (position) =>
            position.classification === "public_market" &&
            position.valueMinor !== null,
        )
        .map((position) => position.valueMinor ?? 0),
    ),
    privatePaperValueMinor: addMinorUnits(
      ...positions
        .filter(
          (position) =>
            position.classification === "private_paper" &&
            position.valueMinor !== null,
        )
        .map((position) => position.valueMinor ?? 0),
    ),
    cashAccountCount: cashAccounts.length,
    cashAccountValueMinor: addMinorUnits(
      ...cashAccounts.map((account) => account.valueMinor ?? 0),
    ),
    unknownCashAccountCount: cashAccounts.filter(
      (account) => account.valueState !== "reported",
    ).length,
    unknownValueCount: positions.filter(
      (position) => position.valueState !== "reported",
    ).length,
    potentialDuplicateCount: positions.filter(
      (position) => position.potentialDuplicate,
    ).length,
  };
}

function requiresCashOverlapReview(
  positions: readonly PortfolioBaselinePosition[],
  linkedCashMinor: number,
  manualResidualMinor: number,
): boolean {
  const brokerageCashMinor = addMinorUnits(
    ...positions
      .filter(
        (position) => position.isCashPosition && position.valueMinor !== null,
      )
      .map((position) => position.valueMinor ?? 0),
  );
  return (
    [linkedCashMinor, brokerageCashMinor, manualResidualMinor].filter(
      (value) => value > 0,
    ).length > 1
  );
}

function haveSameIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((id, index) => id === sortedRight[index])
  );
}

export interface PortfolioBaselineRepository {
  getState(accessSubject: string): Promise<PortfolioBaselineState>;
  confirm(
    accessSubject: string,
    input: PortfolioBaselineConfirmInput,
  ): Promise<PortfolioBaselineConfirmResult>;
}

export class D1PortfolioBaselineRepository implements PortfolioBaselineRepository {
  private readonly holdingPositionsReadSource:
    "holding_positions" | "holding_position_compatibility";

  public constructor(
    private readonly db: D1Database,
    options: HoldingPositionReadOptions = {},
  ) {
    this.holdingPositionsReadSource = holdingPositionReadSource(
      options.holdingPositionReadMode,
    );
  }

  public async getState(
    accessSubject: string,
  ): Promise<PortfolioBaselineState> {
    const identity = await this.findIdentity(accessSubject);
    const [rows, cashRows, planning, latestBaseline] = await Promise.all([
      this.getSourceRows(identity.household_id),
      this.getSourceCashRows(identity.household_id),
      this.getPlanningRow(identity.household_id),
      this.getLatestBaseline(identity.household_id),
    ]);
    const positions = sourcePositions(rows);
    const cashAccounts = sourceCashAccounts(cashRows);
    const planningContext = {
      currentFiEligibleLiquidMinor: planning.fi_eligible_liquid_minor,
      protectedCashFloorMinor: planning.protected_cash_floor_minor,
      householdBurnMonthlyMinor: planning.household_burn_monthly_minor,
      businessBurnMonthlyMinor: planning.business_burn_monthly_minor,
      fiTargetMinor: planning.fi_target_minor,
      p25FiveYearLiquidityMinor: planning.p25_five_year_liquidity_minor,
      p50FiveYearLiquidityMinor: planning.p50_five_year_liquidity_minor,
      p75FiveYearLiquidityMinor: planning.p75_five_year_liquidity_minor,
      forecastHorizonDate: planning.forecast_horizon_date,
    };
    const suggestedOtherFiEligibleLiquidMinor =
      latestBaseline?.otherFiEligibleLiquidMinor ?? 0;
    const currentImpact = createPortfolioBaselineImpact(
      planningContext,
      planning.fi_eligible_liquid_minor,
    );
    const baselineCashDecisionIds =
      latestBaseline === null
        ? []
        : await this.getBaselineCashDecisionIds(
            identity.household_id,
            latestBaseline.id,
          );
    const hasCashAccountChanges =
      latestBaseline === null
        ? cashRows.length > 0
        : !haveSameIds(
            cashRows.map((row) => row.decision_id),
            baselineCashDecisionIds,
          );

    if (positions.length === 0) {
      return PortfolioBaselineStateSchema.parse({
        status: "waiting_for_reviewed_holdings",
        sourceRevision: null,
        observedAt: null,
        baseForecastSnapshotId: null,
        baseForecastSnapshotVersion: null,
        summary: null,
        positions: [],
        cashAccounts,
        planning: planningContext,
        suggestedOtherFiEligibleLiquidMinor,
        currentImpact,
        latestBaseline,
        hasSourceChanges: false,
        hasCashAccountChanges,
        requiresDuplicateReview: false,
        requiresCashOverlapReview: false,
        canConfirm: false,
      });
    }

    const currentSourceRevision = await sourceRevision(rows, cashRows);
    const observedAt = [...positions, ...cashAccounts]
      .map((item) => item.observedAt)
      .sort((left, right) => right.localeCompare(left))[0];
    if (observedAt === undefined) {
      throw new Error("Portfolio baseline has no observed source date.");
    }
    const summary = summarizePositions(positions, cashAccounts);
    const hasSourceChanges =
      latestBaseline?.sourceRevision !== currentSourceRevision;

    return PortfolioBaselineStateSchema.parse({
      status: hasSourceChanges ? "ready" : "current",
      sourceRevision: currentSourceRevision,
      observedAt,
      baseForecastSnapshotId: planning.forecast_snapshot_id,
      baseForecastSnapshotVersion: planning.forecast_snapshot_version,
      summary,
      positions,
      cashAccounts,
      planning: planningContext,
      suggestedOtherFiEligibleLiquidMinor,
      currentImpact,
      latestBaseline,
      hasSourceChanges,
      hasCashAccountChanges,
      requiresDuplicateReview: summary.potentialDuplicateCount > 0,
      requiresCashOverlapReview: requiresCashOverlapReview(
        positions,
        summary.cashAccountValueMinor,
        suggestedOtherFiEligibleLiquidMinor,
      ),
      canConfirm: hasSourceChanges,
    });
  }

  public async confirm(
    accessSubject: string,
    rawInput: PortfolioBaselineConfirmInput,
  ): Promise<PortfolioBaselineConfirmResult> {
    const input = PortfolioBaselineConfirmInputSchema.parse(rawInput);
    const state = await this.getState(accessSubject);
    if (
      state.status !== "ready" ||
      !state.canConfirm ||
      state.sourceRevision === null ||
      state.observedAt === null ||
      state.summary === null
    ) {
      throw new Error("Portfolio baseline is already current.");
    }
    if (
      state.sourceRevision !== input.sourceRevision ||
      state.baseForecastSnapshotId !== input.baseForecastSnapshotId ||
      state.baseForecastSnapshotVersion !== input.baseForecastSnapshotVersion
    ) {
      throw new Error("Portfolio baseline proposal is stale.");
    }
    if (state.requiresDuplicateReview && !input.duplicateReviewConfirmed) {
      throw new Error("Possible portfolio overlaps must be reviewed.");
    }
    if (
      requiresCashOverlapReview(
        state.positions,
        state.summary.cashAccountValueMinor,
        input.otherFiEligibleLiquidMinor,
      ) &&
      !input.cashOverlapReviewConfirmed
    ) {
      throw new Error("Possible cash overlaps must be reviewed.");
    }

    const identity = await this.findIdentity(accessSubject);
    const [
      sourceRows,
      sourceCashRows,
      planning,
      companyForecasts,
      curves,
      outputs,
      goal,
    ] = await Promise.all([
      this.getSourceRows(identity.household_id),
      this.getSourceCashRows(identity.household_id),
      this.getPlanningRow(identity.household_id),
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
      this.getFinancialIndependenceGoal(identity.household_id),
    ]);
    const currentPositions = sourcePositions(sourceRows);
    const currentCashAccounts = sourceCashAccounts(sourceCashRows);
    const currentSourceRevision = await sourceRevision(
      sourceRows,
      sourceCashRows,
    );
    const currentSummary = summarizePositions(
      currentPositions,
      currentCashAccounts,
    );
    const currentObservedAt = [...currentPositions, ...currentCashAccounts]
      .map((item) => item.observedAt)
      .sort((left, right) => right.localeCompare(left))[0];
    if (
      planning.forecast_snapshot_id !== input.baseForecastSnapshotId ||
      planning.forecast_snapshot_version !==
        input.baseForecastSnapshotVersion ||
      currentSourceRevision !== input.sourceRevision ||
      currentObservedAt === undefined
    ) {
      throw new Error("Portfolio baseline proposal is stale.");
    }
    if (
      currentSummary.potentialDuplicateCount > 0 &&
      !input.duplicateReviewConfirmed
    ) {
      throw new Error("Possible portfolio overlaps must be reviewed.");
    }
    if (
      requiresCashOverlapReview(
        currentPositions,
        currentSummary.cashAccountValueMinor,
        input.otherFiEligibleLiquidMinor,
      ) &&
      !input.cashOverlapReviewConfirmed
    ) {
      throw new Error("Possible cash overlaps must be reviewed.");
    }

    const fiEligibleLiquidMinor = addMinorUnits(
      currentSummary.publicMarketValueMinor,
      currentSummary.cashAccountValueMinor,
      input.otherFiEligibleLiquidMinor,
    );

    const impact = createPortfolioBaselineImpact(
      {
        currentFiEligibleLiquidMinor: planning.fi_eligible_liquid_minor,
        protectedCashFloorMinor: planning.protected_cash_floor_minor,
        householdBurnMonthlyMinor: planning.household_burn_monthly_minor,
        businessBurnMonthlyMinor: planning.business_burn_monthly_minor,
        fiTargetMinor: planning.fi_target_minor,
        p25FiveYearLiquidityMinor: planning.p25_five_year_liquidity_minor,
        p50FiveYearLiquidityMinor: planning.p50_five_year_liquidity_minor,
        p75FiveYearLiquidityMinor: planning.p75_five_year_liquidity_minor,
        forecastHorizonDate: planning.forecast_horizon_date,
      },
      fiEligibleLiquidMinor,
    );
    const createdAt = new Date().toISOString();
    const baselineId = crypto.randomUUID();
    const cashFlowPlanId = crypto.randomUUID();
    const forecastSnapshotId = crypto.randomUUID();
    const forecastSnapshotVersion = planning.forecast_snapshot_version + 1;
    const inputHash = await sha256(
      [
        "portfolio-baseline",
        input.sourceRevision,
        fiEligibleLiquidMinor,
        input.otherFiEligibleLiquidMinor,
        forecastSnapshotVersion,
      ].join("|"),
    );
    const duplicateKeys = new Map(
      currentPositions.map((position) => [
        position.id,
        position.potentialDuplicate
          ? normalizedDuplicateKey(position.positionName, position.ticker)
          : null,
      ]),
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
          planning.household_burn_monthly_minor,
          planning.business_burn_monthly_minor,
          fiEligibleLiquidMinor,
          planning.protected_cash_floor_minor,
          planning.fi_target_minor,
          createdAt,
          `Portfolio baseline ${baselineId}`,
          createdAt,
        ),
      this.db
        .prepare(
          `INSERT INTO forecast_snapshots (
             id, household_id, scenario_id, version, input_hash, created_at,
             created_by, trigger, attributed_change, immutable
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Portfolio baseline', ?, 1)`,
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
      const crossing = row.metric_key === "probability_crossing_fi";
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
            crossing ? null : row.value_minor,
            crossing ? impact.probabilityCrossingFiPpm : row.probability_ppm,
            createdAt,
          ),
      );
    });

    let goalVersionId: string | null = null;
    let goalVersion: number | null = null;
    if (goal !== null) {
      goalVersion = goal.latest_version + 1;
      goalVersionId = crypto.randomUUID();
      const goalForecastId = crypto.randomUUID();
      const preview = createGoalPreview(
        {
          goalId: goal.goal_id,
          templateKey: "financial_independence",
          name: goal.name,
          metricKey: goal.metric_key,
          metricLabel: goal.metric_label,
          targetValueInteger: goal.target_value_integer,
          targetUnit: goal.target_unit,
          targetDate: goal.target_date,
          currentValueInteger: fiEligibleLiquidMinor,
          makePrimary: Boolean(goal.is_primary),
          changeNote: input.changeNote,
        },
        {
          p25FiveYearLiquidityMinor: planning.p25_five_year_liquidity_minor,
          p50FiveYearLiquidityMinor: planning.p50_five_year_liquidity_minor,
          p75FiveYearLiquidityMinor: planning.p75_five_year_liquidity_minor,
          horizonDate: planning.forecast_horizon_date,
        },
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO goal_versions (
               id, household_id, goal_id, version, name, metric_key,
               metric_label, target_value_integer, target_unit, target_date,
               current_value_integer, current_value_source, change_note,
               created_at, created_by, immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            goalVersionId,
            identity.household_id,
            goal.goal_id,
            goalVersion,
            goal.name,
            goal.metric_key,
            goal.metric_label,
            goal.target_value_integer,
            goal.target_unit,
            goal.target_date,
            fiEligibleLiquidMinor,
            "Portfolio baseline",
            input.changeNote,
            createdAt,
            identity.display_name,
          ),
        this.db
          .prepare(
            `INSERT INTO goal_forecast_snapshots (
               id, household_id, goal_version_id, version, model_status,
               lower_value_integer, middle_value_integer,
               higher_value_integer, success_probability_ppm, unit,
               horizon_date, methodology, created_at, created_by, immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            goalForecastId,
            identity.household_id,
            goalVersionId,
            goalVersion,
            preview.modelStatus,
            preview.lowerValueInteger,
            preview.middleValueInteger,
            preview.higherValueInteger,
            preview.successProbabilityPpm,
            goal.target_unit,
            preview.horizonDate,
            preview.methodology,
            createdAt,
            identity.display_name,
          ),
      );
    }

    statements.push(
      this.db
        .prepare(
          `INSERT INTO portfolio_baselines (
             id, household_id, source_revision, source_observed_at,
             position_count, public_market_value_minor,
             private_paper_value_minor, cash_account_count,
             cash_account_value_minor, unknown_cash_account_count,
             unknown_value_count, potential_duplicate_count,
             prior_fi_eligible_liquid_minor, fi_eligible_liquid_minor,
             base_forecast_snapshot_id,
             cash_flow_plan_id,
             forecast_snapshot_id, goal_version_id, change_note,
             created_by_user_id, created_at, immutable
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          baselineId,
          identity.household_id,
          input.sourceRevision,
          currentObservedAt,
          currentSummary.positionCount,
          currentSummary.publicMarketValueMinor,
          currentSummary.privatePaperValueMinor,
          currentSummary.cashAccountCount,
          currentSummary.cashAccountValueMinor,
          currentSummary.unknownCashAccountCount,
          currentSummary.unknownValueCount,
          currentSummary.potentialDuplicateCount,
          planning.fi_eligible_liquid_minor,
          fiEligibleLiquidMinor,
          input.baseForecastSnapshotId,
          cashFlowPlanId,
          forecastSnapshotId,
          goalVersionId,
          input.changeNote,
          identity.user_id,
          createdAt,
        ),
    );
    sourceRows.forEach((row) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO portfolio_baseline_items (
               id, household_id, baseline_id, position_id, snapshot_id,
               provider, classification, value_minor, value_state,
               observed_at, duplicate_key, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            baselineId,
            row.position_id,
            row.snapshot_id,
            row.provider,
            row.provider === "robinhood" ? "public_market" : "private_paper",
            row.unrealized_value_minor,
            row.unrealized_value_state,
            row.observed_at,
            duplicateKeys.get(row.position_id) ?? null,
            createdAt,
          ),
      );
    });
    sourceCashRows.forEach((row) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO portfolio_baseline_cash_items (
               id, household_id, baseline_id, review_decision_id,
               proposal_row_id, natural_key_sha256, value_minor, value_state,
               observed_at, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            baselineId,
            row.decision_id,
            row.proposal_row_id,
            row.natural_key_sha256,
            row.value_minor,
            row.value_state,
            row.observed_at,
            createdAt,
          ),
      );
    });

    await this.db.batch(statements);
    return PortfolioBaselineConfirmResultSchema.parse({
      baseline: {
        id: baselineId,
        sourceRevision: input.sourceRevision,
        observedAt: currentObservedAt,
        summary: currentSummary,
        priorFiEligibleLiquidMinor: planning.fi_eligible_liquid_minor,
        fiEligibleLiquidMinor,
        otherFiEligibleLiquidMinor: input.otherFiEligibleLiquidMinor,
        forecastSnapshotId,
        forecastSnapshotVersion,
        goalVersion,
        changeNote: input.changeNote,
        createdAt,
        createdBy: identity.display_name,
      },
      impact,
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

  private async getSourceRows(householdId: string) {
    const rows = await all<SourcePositionRow>(
      this.db
        .prepare(
          `SELECT
             position.id AS position_id,
             snapshot.id AS snapshot_id,
             snapshot.snapshot_fingerprint,
             position.provider,
             position.legal_vehicle_name,
             position.owner_label,
             (
               SELECT exposure.exposure_label
               FROM holding_position_exposures exposure
               WHERE exposure.position_id = position.id
               ORDER BY exposure.created_at, exposure.id
               LIMIT 1
             ) AS exposure_label,
             snapshot.unrealized_value_minor,
             snapshot.unrealized_value_state,
             snapshot.observed_at,
             snapshot.ticker,
             position.instrument_type
           FROM ${this.holdingPositionsReadSource} position
           JOIN holding_position_snapshots snapshot
             ON snapshot.id = (
               SELECT latest.id
               FROM holding_position_snapshots latest
               WHERE latest.position_id = position.id
               ORDER BY latest.observed_at DESC, latest.created_at DESC,
                        latest.id DESC
               LIMIT 1
             )
           WHERE position.household_id = ?
             AND position.provider IN ('angellist', 'robinhood')
             AND EXISTS (
               SELECT 1
               FROM holding_import_applications application
               WHERE application.position_id = position.id
                 AND application.snapshot_id = snapshot.id
             )
           ORDER BY position.provider, position.id`,
        )
        .bind(householdId),
    );
    return rows.filter(
      (row) =>
        row.provider !== "robinhood" ||
        isRobinhoodFiPlanningSecurityType(row.instrument_type),
    );
  }

  private async getSourceCashRows(householdId: string) {
    const [rows, identityDecisions] = await Promise.all([
      all<SourceCashAccountRow>(
        this.db
          .prepare(
            `SELECT decision.id AS decision_id, proposal.id AS proposal_id,
                  row.id AS proposal_row_id,
                  row.natural_key_sha256, row.item_account_key_sha256,
                  proposal.connector_account_id, row.institution_label,
                  row.account_label, row.subtype, row.value_minor,
                  row.value_state, row.balance_source, proposal.refresh_kind,
                  row.observed_at, decision.decided_at
           FROM cash_balance_review_decisions decision
           JOIN cash_balance_proposal_rows row
             ON row.id = decision.proposal_row_id
           JOIN cash_balance_proposals proposal
             ON proposal.id = decision.proposal_id
           WHERE decision.household_id = ?
             AND decision.decision = 'accepted'
           ORDER BY decision.decided_at, decision.id`,
          )
          .bind(householdId),
      ),
      all<CashAccountIdentityDecisionRow>(
        this.db
          .prepare(
            `SELECT decision.connector_account_id,
                    decision.natural_key_low_sha256,
                    decision.natural_key_high_sha256
             FROM cash_account_identity_decisions decision
             WHERE decision.household_id = ?
               AND decision.decision = 'same_account'
               AND NOT EXISTS (
                 SELECT 1 FROM cash_account_identity_decisions later
                 WHERE later.supersedes_decision_id = decision.id
               )
             ORDER BY decision.decided_at, decision.id`,
          )
          .bind(householdId),
      ),
    ]);
    return projectCashAccountIdentities(
      rows,
      [],
      identityDecisions.map((decision) => ({
        connectorAccountId: decision.connector_account_id,
        naturalKeyLowSha256: decision.natural_key_low_sha256,
        naturalKeyHighSha256: decision.natural_key_high_sha256,
      })),
    )
      .acceptedRows.map(({ row }) => row)
      .sort((left, right) =>
        left.natural_key_sha256.localeCompare(right.natural_key_sha256),
      );
  }

  private async getPlanningRow(householdId: string): Promise<PlanningRow> {
    const row = await this.db
      .prepare(
        `SELECT
           scenario.id AS scenario_id,
           snapshot.id AS forecast_snapshot_id,
           snapshot.version AS forecast_snapshot_version,
           plan.id AS cash_flow_plan_id,
           plan.household_burn_monthly_minor,
           plan.business_burn_monthly_minor,
           plan.fi_eligible_liquid_minor,
           plan.protected_cash_floor_minor,
           plan.fi_target_minor,
           p50.horizon_date AS forecast_horizon_date,
           p25.value_minor AS p25_five_year_liquidity_minor,
           p50.value_minor AS p50_five_year_liquidity_minor,
           p75.value_minor AS p75_five_year_liquidity_minor
         FROM scenarios scenario
         JOIN forecast_snapshots snapshot
           ON snapshot.scenario_id = scenario.id
           AND snapshot.version = (
             SELECT MAX(latest.version)
             FROM forecast_snapshots latest
             WHERE latest.scenario_id = scenario.id
           )
         JOIN cash_flow_plans plan
           ON plan.scenario_id = scenario.id
           AND plan.effective_date = (
             SELECT MAX(latest.effective_date)
             FROM cash_flow_plans latest
             WHERE latest.scenario_id = scenario.id
           )
         JOIN forecast_outputs p25
           ON p25.forecast_snapshot_id = snapshot.id
           AND p25.metric_key = 'cumulative_liquidity'
           AND p25.percentile = 25
         JOIN forecast_outputs p50
           ON p50.forecast_snapshot_id = snapshot.id
           AND p50.metric_key = 'cumulative_liquidity'
           AND p50.percentile = 50
         JOIN forecast_outputs p75
           ON p75.forecast_snapshot_id = snapshot.id
           AND p75.metric_key = 'cumulative_liquidity'
           AND p75.percentile = 75
         WHERE scenario.household_id = ? AND scenario.name = 'FI Underwriting'`,
      )
      .bind(householdId)
      .first<PlanningRow>();
    if (row === null) {
      throw new Error("Portfolio baseline requires a complete FI forecast.");
    }
    return row;
  }

  private async getLatestBaseline(
    householdId: string,
  ): Promise<PortfolioBaselineRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
           baseline.id,
           baseline.source_revision,
           baseline.source_observed_at,
           baseline.position_count,
           baseline.public_market_value_minor,
           baseline.private_paper_value_minor,
           baseline.cash_account_count,
           baseline.cash_account_value_minor,
           baseline.unknown_cash_account_count,
           baseline.unknown_value_count,
           baseline.potential_duplicate_count,
           baseline.prior_fi_eligible_liquid_minor,
           baseline.fi_eligible_liquid_minor,
           baseline.forecast_snapshot_id,
           snapshot.version AS forecast_snapshot_version,
           goal.version AS goal_version,
           baseline.change_note,
           baseline.created_at,
           user.display_name AS created_by
         FROM portfolio_baselines baseline
         JOIN forecast_snapshots snapshot
           ON snapshot.id = baseline.forecast_snapshot_id
         JOIN users user ON user.id = baseline.created_by_user_id
         LEFT JOIN goal_versions goal ON goal.id = baseline.goal_version_id
         WHERE baseline.household_id = ?
         ORDER BY baseline.created_at DESC, baseline.id DESC
         LIMIT 1`,
      )
      .bind(householdId)
      .first<BaselineRow>();
    return row === null ? null : baselineRecordFromRow(row);
  }

  private getBaselineCashDecisionIds(
    householdId: string,
    baselineId: string,
  ): Promise<readonly string[]> {
    return all<{ review_decision_id: string }>(
      this.db
        .prepare(
          `SELECT review_decision_id
           FROM portfolio_baseline_cash_items
           WHERE household_id = ? AND baseline_id = ?
           ORDER BY review_decision_id`,
        )
        .bind(householdId, baselineId),
    ).then((rows) => rows.map((row) => row.review_decision_id));
  }

  private getFinancialIndependenceGoal(householdId: string) {
    return this.db
      .prepare(
        `SELECT
           goal.id AS goal_id,
           MAX(version.version) AS latest_version,
           latest.name,
           latest.metric_key,
           latest.metric_label,
           latest.target_value_integer,
           latest.target_unit,
           latest.target_date,
           goal.is_primary
         FROM goals goal
         JOIN goal_versions version ON version.goal_id = goal.id
         JOIN goal_versions latest
           ON latest.goal_id = goal.id
           AND latest.version = (
             SELECT MAX(newest.version)
             FROM goal_versions newest
             WHERE newest.goal_id = goal.id
           )
         WHERE goal.household_id = ?
           AND goal.template_key = 'financial_independence'
           AND goal.archived_at IS NULL
         GROUP BY goal.id
         ORDER BY goal.is_primary DESC, goal.created_at
         LIMIT 1`,
      )
      .bind(householdId)
      .first<FinancialIndependenceGoalRow>();
  }
}
