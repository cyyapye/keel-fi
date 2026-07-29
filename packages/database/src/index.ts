import {
  AlphaDataSchema,
  type AlphaData,
  type ForecastHistoryItemSchema,
} from "@keel/domain";
import {
  assertReviewTransition,
  ReviewInputSchema,
  type ReviewInput,
} from "@keel/evidence";
import type { z } from "zod";

type DashboardRow = {
  as_of_date: string;
  household_name: string;
  fi_eligible_liquid_minor: number;
  protected_runway_months: number;
  household_burn_monthly_minor: number;
  business_burn_monthly_minor: number;
  fi_target_minor: number;
  fi_gap_minor: number;
  p25_five_year_liquidity_minor: number;
  p50_five_year_liquidity_minor: number;
  probability_crossing_fi_ppm: number;
};

type HoldingRow = {
  id: string;
  company_name: string;
  account_name: string;
  lot_label: string;
  administrator_nav_minor: number;
  external_mark_minor: number;
  underwriting_value_minor: number;
  scenario_value_minor: number;
  usable_liquidity_minor: number;
  source_status: "verified" | "review_due" | "proposed";
  source_label: string;
  effective_date: string;
  retrieved_at: string;
  confidence_ppm: number;
};

type EvidenceRow = {
  id: string;
  company_name: string;
  event_type: string;
  headline: string;
  detected_at: string;
  effective_date: string;
  status: "pending_review" | "accepted" | "rejected" | "scenario_only";
  confidence_ppm: number;
  source_label: string;
  prior_value_json: string;
  replacement_value_json: string;
  estimated_forecast_impact_minor: number;
};

type ScenarioRow = {
  id: string;
  name: string;
  description: string;
  is_sandbox: number;
  conditional_value_minor: number;
  timing_adjusted_liquidity_minor: number;
};

type AssumptionRow = {
  id: string;
  scenario_id: string;
  label: string;
  value_integer: number;
  unit: "ppm" | "months" | "minor_units";
  provenance: string;
};

type CurveRow = {
  scenario_id: string;
  year: number;
  p25_minor: number;
  p50_minor: number;
  p75_minor: number;
  expected_minor: number;
  probability_zero_ppm: number;
};

type HistoryRow = {
  id: string;
  scenario_id: string;
  version: number;
  scenario_name: string;
  created_at: string;
  created_by: string;
  trigger: string;
  attributed_change: string;
  p50_minor: number | null;
};

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type ReviewEventRow = HouseholdIdentity & {
  current_status: string;
  prior_value_json: string | null;
  replacement_value_json: string | null;
};

export interface AlphaRepository {
  getAlphaData(accessSubject: string): Promise<AlphaData>;
  reviewEvidence(
    accessSubject: string,
    eventId: string,
    input: ReviewInput,
  ): Promise<void>;
}

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

function displayJsonValue(serialized: string): string {
  const value = JSON.parse(serialized) as Record<string, unknown>;
  const first = Object.values(value)[0];

  if (typeof first === "number") {
    const key = Object.keys(value)[0] ?? "";
    if (key.toLowerCase().includes("minor")) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(BigInt(first) / 100n);
    }
    return new Intl.NumberFormat("en-US").format(first);
  }

  if (first === null || first === undefined) {
    return "Not set";
  }
  if (typeof first === "string" || typeof first === "boolean") {
    return String(first);
  }
  return JSON.stringify(first);
}

export class D1AlphaRepository implements AlphaRepository {
  public constructor(private readonly db: D1Database) {}

  public async getAlphaData(accessSubject: string): Promise<AlphaData> {
    const identity = await this.findIdentity(accessSubject);
    const householdId = identity.household_id;

    const [dashboard, holdings, evidence, scenarioRows, assumptions, curves] =
      await Promise.all([
        this.getDashboard(householdId),
        all<HoldingRow>(
          this.db
            .prepare(
              `SELECT
                lot.id,
                company.legal_name AS company_name,
                account.name AS account_name,
                lot.lot_label,
                MAX(CASE WHEN mark.mark_kind = 'administrator_nav' THEN mark.value_minor END) AS administrator_nav_minor,
                MAX(CASE WHEN mark.mark_kind = 'external_mark' THEN mark.value_minor END) AS external_mark_minor,
                MAX(CASE WHEN mark.mark_kind = 'fi_underwriting' THEN mark.value_minor END) AS underwriting_value_minor,
                MAX(CASE WHEN mark.mark_kind = 'thesis_weighted' THEN mark.value_minor END) AS scenario_value_minor,
                MAX(CASE WHEN mark.mark_kind = 'usable_liquidity' THEN mark.value_minor END) AS usable_liquidity_minor,
                CASE
                  WHEN external.review_status = 'proposed' THEN 'proposed'
                  WHEN julianday('now') - julianday(external.retrieved_at) > 90 THEN 'review_due'
                  ELSE 'verified'
                END AS source_status,
                source.source_name AS source_label,
                substr(external.effective_at, 1, 10) AS effective_date,
                external.retrieved_at,
                source.confidence_ppm
              FROM asset_lots lot
              JOIN companies company ON company.id = lot.company_id
              JOIN asset_accounts account ON account.id = lot.asset_account_id
              JOIN marks mark ON mark.asset_lot_id = lot.id
              JOIN marks external
                ON external.asset_lot_id = lot.id
                AND external.mark_kind = 'external_mark'
              JOIN mark_sources source ON source.id = external.mark_source_id
              WHERE lot.household_id = ?
              GROUP BY lot.id
              ORDER BY company.legal_name`,
            )
            .bind(householdId),
        ),
        all<EvidenceRow>(
          this.db
            .prepare(
              `SELECT
                event.id,
                company.legal_name AS company_name,
                event.event_type,
                event.headline,
                event.detected_at,
                event.effective_date,
                event.status,
                event.confidence_ppm,
                document.source_label,
                event.prior_value_json,
                event.replacement_value_json,
                event.estimated_forecast_impact_minor
              FROM evidence_events event
              JOIN companies company ON company.id = event.company_id
              JOIN source_documents document ON document.id = event.source_document_id
              WHERE event.household_id = ?
              ORDER BY
                CASE event.status WHEN 'pending_review' THEN 0 ELSE 1 END,
                event.detected_at DESC`,
            )
            .bind(householdId),
        ),
        all<ScenarioRow>(
          this.db
            .prepare(
              `SELECT
                scenario.id,
                scenario.name,
                scenario.description,
                scenario.is_sandbox,
                COALESCE(SUM(forecast.conditional_value_minor), 0) AS conditional_value_minor,
                COALESCE(SUM(forecast.timing_adjusted_liquidity_minor), 0) AS timing_adjusted_liquidity_minor
              FROM scenarios scenario
              LEFT JOIN forecast_snapshots snapshot
                ON snapshot.scenario_id = scenario.id
                AND snapshot.version = (
                  SELECT MAX(newest.version)
                  FROM forecast_snapshots newest
                  WHERE newest.scenario_id = scenario.id
                )
              LEFT JOIN company_forecasts forecast
                ON forecast.forecast_snapshot_id = snapshot.id
              WHERE scenario.household_id = ? AND scenario.archived_at IS NULL
              GROUP BY scenario.id
              ORDER BY CASE scenario.name
                WHEN 'Runway / No Liquidity' THEN 1
                WHEN 'FI Underwriting' THEN 2
                WHEN 'Thesis-Weighted Expected' THEN 3
                WHEN 'Upside' THEN 4
                ELSE 5
              END`,
            )
            .bind(householdId),
        ),
        all<AssumptionRow>(
          this.db
            .prepare(
              `SELECT
                id,
                scenario_id,
                label,
                value_integer,
                unit,
                provenance
              FROM scenario_assumptions
              WHERE household_id = ?
              ORDER BY label`,
            )
            .bind(householdId),
        ),
        all<CurveRow>(
          this.db
            .prepare(
              `SELECT
                curve.scenario_id,
                curve.year,
                curve.p25_minor,
                curve.p50_minor,
                curve.p75_minor,
                curve.expected_minor,
                curve.probability_zero_ppm
              FROM liquidity_curves curve
              JOIN forecast_snapshots snapshot
                ON snapshot.id = curve.forecast_snapshot_id
                AND snapshot.version = (
                  SELECT MAX(newest.version)
                  FROM forecast_snapshots newest
                  WHERE newest.scenario_id = curve.scenario_id
                )
              WHERE curve.household_id = ?
              ORDER BY curve.scenario_id, curve.year`,
            )
            .bind(householdId),
        ),
      ]);

    const history = await this.getHistory(householdId);

    return AlphaDataSchema.parse({
      dashboard,
      holdings: holdings.map((row) => ({
        id: row.id,
        companyName: row.company_name,
        accountName: row.account_name,
        lotLabel: row.lot_label,
        administratorNavMinor: row.administrator_nav_minor,
        externalMarkMinor: row.external_mark_minor,
        underwritingValueMinor: row.underwriting_value_minor,
        scenarioValueMinor: row.scenario_value_minor,
        usableLiquidityMinor: row.usable_liquidity_minor,
        sourceStatus: row.source_status,
        sourceLabel: row.source_label,
        effectiveDate: row.effective_date,
        retrievedAt: row.retrieved_at,
        confidencePpm: row.confidence_ppm,
      })),
      evidenceInbox: evidence.map((row) => ({
        id: row.id,
        companyName: row.company_name,
        eventType: row.event_type,
        headline: row.headline,
        detectedAt: row.detected_at,
        effectiveDate: row.effective_date,
        status: row.status,
        confidencePpm: row.confidence_ppm,
        sources: [row.source_label],
        priorValue: displayJsonValue(row.prior_value_json),
        replacementValue: displayJsonValue(row.replacement_value_json),
        forecastImpactMinor: row.estimated_forecast_impact_minor,
      })),
      scenarios: scenarioRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        isSandbox: Boolean(row.is_sandbox),
        conditionalValueMinor: row.conditional_value_minor,
        timingAdjustedLiquidityMinor: row.timing_adjusted_liquidity_minor,
        assumptions: assumptions
          .filter((assumption) => assumption.scenario_id === row.id)
          .map((assumption) => ({
            id: assumption.id,
            label: assumption.label,
            value: assumption.value_integer,
            unit: assumption.unit,
            provenance: assumption.provenance,
          })),
        liquidityCurve: curves
          .filter((curve) => curve.scenario_id === row.id)
          .map((curve) => ({
            year: curve.year,
            p25Minor: curve.p25_minor,
            p50Minor: curve.p50_minor,
            p75Minor: curve.p75_minor,
            expectedMinor: curve.expected_minor,
            probabilityZeroPpm: curve.probability_zero_ppm,
          })),
      })),
      forecastHistory: history,
    });
  }

  public async reviewEvidence(
    accessSubject: string,
    eventId: string,
    rawInput: ReviewInput,
  ): Promise<void> {
    const input = ReviewInputSchema.parse(rawInput);
    const event = await this.db
      .prepare(
        `SELECT
          event.status AS current_status,
          event.prior_value_json,
          event.replacement_value_json,
          event.household_id,
          user.id AS user_id
        FROM evidence_events event
        JOIN households household ON household.id = event.household_id
        JOIN users user ON user.id = household.owner_user_id
        WHERE event.id = ? AND user.access_subject = ?`,
      )
      .bind(eventId, accessSubject)
      .first<ReviewEventRow>();

    if (event === null) {
      throw new Error("Evidence event not found.");
    }
    if (
      event.prior_value_json === null ||
      event.replacement_value_json === null
    ) {
      throw new Error(
        "Evidence event does not contain a complete proposed change.",
      );
    }

    assertReviewTransition(event.current_status, input.decision);
    const decidedAt = new Date().toISOString();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO review_decisions (
            id,
            household_id,
            evidence_event_id,
            reviewer_user_id,
            decision,
            rationale,
            prior_value_json,
            replacement_value_json,
            decided_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          event.household_id,
          eventId,
          event.user_id,
          input.decision,
          input.rationale,
          event.prior_value_json,
          event.replacement_value_json,
          decidedAt,
        ),
      this.db
        .prepare("UPDATE evidence_events SET status = ? WHERE id = ?")
        .bind(input.decision, eventId),
    ]);
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id, user.id AS user_id
        FROM households household
        JOIN users user ON user.id = household.owner_user_id
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

  private async getDashboard(householdId: string) {
    const row = await this.db
      .prepare(
        `SELECT
          plan.effective_date AS as_of_date,
          household.name AS household_name,
          plan.fi_eligible_liquid_minor,
          CAST(
            (plan.fi_eligible_liquid_minor - plan.protected_cash_floor_minor)
            / (plan.household_burn_monthly_minor + plan.business_burn_monthly_minor)
            AS INTEGER
          ) AS protected_runway_months,
          plan.household_burn_monthly_minor,
          plan.business_burn_monthly_minor,
          plan.fi_target_minor,
          MAX(plan.fi_target_minor - plan.fi_eligible_liquid_minor, 0) AS fi_gap_minor,
          p25.value_minor AS p25_five_year_liquidity_minor,
          p50.value_minor AS p50_five_year_liquidity_minor,
          crossing.probability_ppm AS probability_crossing_fi_ppm
        FROM households household
        JOIN scenarios scenario
          ON scenario.household_id = household.id
          AND scenario.name = 'FI Underwriting'
        JOIN cash_flow_plans plan
          ON plan.scenario_id = scenario.id
          AND plan.effective_date = (
            SELECT MAX(newest.effective_date)
            FROM cash_flow_plans newest
            WHERE newest.scenario_id = scenario.id
          )
        JOIN forecast_snapshots snapshot
          ON snapshot.scenario_id = scenario.id
          AND snapshot.version = (
            SELECT MAX(newest.version)
            FROM forecast_snapshots newest
            WHERE newest.scenario_id = scenario.id
          )
        JOIN forecast_outputs p25
          ON p25.forecast_snapshot_id = snapshot.id
          AND p25.metric_key = 'cumulative_liquidity'
          AND p25.percentile = 25
        JOIN forecast_outputs p50
          ON p50.forecast_snapshot_id = snapshot.id
          AND p50.metric_key = 'cumulative_liquidity'
          AND p50.percentile = 50
        JOIN forecast_outputs crossing
          ON crossing.forecast_snapshot_id = snapshot.id
          AND crossing.metric_key = 'probability_crossing_fi'
        WHERE household.id = ?`,
      )
      .bind(householdId)
      .first<DashboardRow>();

    if (row === null) {
      throw new Error("The household does not have a complete FI forecast.");
    }

    return {
      asOfDate: row.as_of_date,
      householdName: row.household_name,
      fiEligibleLiquidMinor: row.fi_eligible_liquid_minor,
      protectedRunwayMonths: row.protected_runway_months,
      householdBurnMonthlyMinor: row.household_burn_monthly_minor,
      businessBurnMonthlyMinor: row.business_burn_monthly_minor,
      fiTargetMinor: row.fi_target_minor,
      fiGapMinor: row.fi_gap_minor,
      p25FiveYearLiquidityMinor: row.p25_five_year_liquidity_minor,
      p50FiveYearLiquidityMinor: row.p50_five_year_liquidity_minor,
      probabilityCrossingFiPpm: row.probability_crossing_fi_ppm,
    };
  }

  private async getHistory(
    householdId: string,
  ): Promise<z.infer<typeof ForecastHistoryItemSchema>[]> {
    const rows = await all<HistoryRow>(
      this.db
        .prepare(
          `SELECT
            snapshot.id,
            snapshot.scenario_id,
            snapshot.version,
            scenario.name AS scenario_name,
            snapshot.created_at,
            snapshot.created_by,
            snapshot.trigger,
            snapshot.attributed_change,
            output.value_minor AS p50_minor
          FROM forecast_snapshots snapshot
          JOIN scenarios scenario ON scenario.id = snapshot.scenario_id
          LEFT JOIN forecast_outputs output
            ON output.forecast_snapshot_id = snapshot.id
            AND output.metric_key = 'cumulative_liquidity'
            AND output.percentile = 50
          WHERE snapshot.household_id = ?
          ORDER BY snapshot.created_at`,
        )
        .bind(householdId),
    );

    const priorByScenario = new Map<string, number>();
    return rows
      .map((row) => {
        const p50Minor = row.p50_minor ?? 0;
        const priorP50Minor = priorByScenario.get(row.scenario_id) ?? null;
        priorByScenario.set(row.scenario_id, p50Minor);
        return {
          id: row.id,
          version: row.version,
          scenarioName: row.scenario_name,
          createdAt: row.created_at,
          createdBy: row.created_by,
          trigger: row.trigger,
          attributedChange: row.attributed_change,
          priorP50Minor,
          p50Minor,
        };
      })
      .reverse();
  }
}

export * from "./schema";
