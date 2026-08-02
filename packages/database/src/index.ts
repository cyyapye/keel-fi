import {
  AlphaDataSchema,
  createGoalPreview,
  GoalDraftInputSchema,
  multiplyMinorByScalePpm,
  PortfolioWatchScanResultSchema,
  projectScenario,
  projectScenarioProbabilityPpm,
  projectScenarioValue,
  projectScenarioZeroProbabilityPpm,
  scenarioLiquidityFactorPpm,
  ScenarioDraftInputSchema,
  type AlphaData,
  type ForecastHistoryItemSchema,
  type GoalDraftInput,
  type PortfolioWatchScanResult,
  type Scenario,
  type ScenarioDraftInput,
} from "@keel/domain";
import {
  assertReviewTransition,
  getDirectEvidenceApplication,
  ReviewInputSchema,
  type ReviewInput,
} from "@keel/evidence";
import type { z } from "zod";

type DashboardRow = {
  as_of_date: string;
  forecast_horizon_date: string;
  household_name: string;
  fi_eligible_liquid_minor: number;
  protected_runway_months: number;
  household_burn_monthly_minor: number;
  business_burn_monthly_minor: number;
  fi_target_minor: number;
  fi_gap_minor: number;
  p25_five_year_liquidity_minor: number;
  p50_five_year_liquidity_minor: number;
  p75_five_year_liquidity_minor: number;
  probability_crossing_fi_ppm: number;
};

type GoalRow = {
  id: string;
  template_key:
    "financial_independence" | "cash_runway" | "major_purchase" | "custom";
  is_primary: number;
  archived_at: string | null;
  goal_created_at: string;
  goal_version_id: string;
  version: number;
  name: string;
  metric_key: string;
  metric_label: string;
  target_value_integer: number | null;
  target_unit: "minor_units" | "months" | "ppm" | "count";
  target_date: string | null;
  current_value_integer: number;
  current_value_source: string;
  change_note: string;
  version_created_at: string;
  version_created_by: string;
  forecast_id: string;
  model_status: "modeled" | "not_configured";
  lower_value_integer: number | null;
  middle_value_integer: number | null;
  higher_value_integer: number | null;
  success_probability_ppm: number | null;
  forecast_unit: "minor_units" | "months" | "ppm" | "count";
  horizon_date: string | null;
  methodology: string;
  forecast_created_at: string;
  forecast_created_by: string;
};

type GoalIdentityRow = {
  id: string;
  template_key: GoalRow["template_key"];
  latest_version: number;
  is_primary: number;
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
  model_confidence_ppm: number | null;
  source_label: string;
  prior_value_json: string;
  replacement_value_json: string;
  estimated_forecast_impact_minor: number;
  claim_field_path: string | null;
  application_applied_at: string | null;
};

type PortfolioWatchTargetRow = {
  id: string;
  company_id: string;
  company_name: string;
  official_host: string;
  status: "active" | "paused";
  last_checked_at: string | null;
  latest_observation_at: string | null;
};

type PublicSourceObservationRow = {
  id: string;
  company_id: string;
  company_name: string;
  evidence_event_id: string;
  evidence_status: "pending_review" | "accepted" | "rejected" | "scenario_only";
  source_class:
    | "official_company"
    | "regulatory_filing"
    | "reputable_reporting"
    | "secondary_source";
  source_url: string;
  source_title: string;
  published_at: string;
  retrieved_at: string;
  observed_fact: string;
  inference: string;
  source_reliability_ppm: number;
  model_confidence_ppm: number;
  valuation_low_minor: number | null;
  valuation_middle_minor: number | null;
  valuation_high_minor: number | null;
  limitations: string;
};

type EvidenceApplyEventRow = HouseholdIdentity & {
  current_status: "pending_review" | "accepted" | "rejected" | "scenario_only";
  company_id: string | null;
  effective_date: string;
  retrieved_at: string;
  detected_at: string;
  confidence_ppm: number;
  source_label: string;
  prior_value_json: string | null;
  replacement_value_json: string | null;
  claim_field_path: string | null;
  review_decision_id: string | null;
};

type MarkTargetRow = {
  lot_id: string;
  currency: string;
};

type ExistingMarkRow = {
  id: string;
  value_minor: number;
  review_status: "accepted" | "proposed" | "rejected";
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
  assumption_key: string;
  label: string;
  value_integer: number;
  value_scale: number;
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

type ScenarioIdentityRow = {
  id: string;
  name: string;
  description: string;
  is_sandbox: number;
  latest_version: number;
  latest_snapshot_id: string | null;
};

type ScenarioCompanyForecastRow = {
  company_id: string;
  conditional_value_minor: number;
  timing_adjusted_liquidity_minor: number;
  probability_zero_ppm: number;
  effective_date: string;
};

type ScenarioOutputRow = {
  metric_key: string;
  horizon_date: string;
  percentile: number | null;
  value_minor: number | null;
  probability_ppm: number | null;
};

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
  display_name: string;
};

type ReviewEventRow = HouseholdIdentity & {
  current_status: string;
  prior_value_json: string | null;
  replacement_value_json: string | null;
};

export interface AlphaRepository {
  getAlphaData(accessSubject: string): Promise<AlphaData>;
  scanPortfolioWatch(accessSubject: string): Promise<PortfolioWatchScanResult>;
  saveGoal(accessSubject: string, input: GoalDraftInput): Promise<void>;
  saveScenario(accessSubject: string, input: ScenarioDraftInput): Promise<void>;
  reviewEvidence(
    accessSubject: string,
    eventId: string,
    input: ReviewInput,
  ): Promise<void>;
  applyEvidence(accessSubject: string, eventId: string): Promise<void>;
}

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

async function hashInput(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

function parseMinorValue(serialized: string, key: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Evidence event does not contain a valid financial value.");
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>)[key] !== "number" ||
    !Number.isSafeInteger((parsed as Record<string, unknown>)[key]) ||
    ((parsed as Record<string, unknown>)[key] as number) < 0
  ) {
    throw new Error(
      "Evidence event does not contain a deterministic minor-unit value.",
    );
  }

  const value = (parsed as Record<string, unknown>)[key];
  if (typeof value !== "number") {
    throw new Error(
      "Evidence event does not contain a deterministic minor-unit value.",
    );
  }
  return value;
}

export class D1AlphaRepository implements AlphaRepository {
  public constructor(private readonly db: D1Database) {}

  public async getAlphaData(accessSubject: string): Promise<AlphaData> {
    const identity = await this.findIdentity(accessSubject);
    const householdId = identity.household_id;

    const [
      dashboard,
      goals,
      holdings,
      evidence,
      watchTargets,
      publicObservations,
      scenarioRows,
      assumptions,
      curves,
    ] = await Promise.all([
      this.getDashboard(householdId),
      this.getGoals(householdId),
      all<HoldingRow>(
        this.db
          .prepare(
            `SELECT
                lot.id,
                company.legal_name AS company_name,
                account.name AS account_name,
                lot.lot_label,
                (
                  SELECT mark.value_minor
                  FROM marks mark
                  WHERE mark.asset_lot_id = lot.id
                    AND mark.mark_kind = 'administrator_nav'
                  ORDER BY mark.effective_at DESC, mark.created_at DESC
                  LIMIT 1
                ) AS administrator_nav_minor,
                external.value_minor AS external_mark_minor,
                (
                  SELECT mark.value_minor
                  FROM marks mark
                  WHERE mark.asset_lot_id = lot.id
                    AND mark.mark_kind = 'fi_underwriting'
                  ORDER BY mark.effective_at DESC, mark.created_at DESC
                  LIMIT 1
                ) AS underwriting_value_minor,
                (
                  SELECT mark.value_minor
                  FROM marks mark
                  WHERE mark.asset_lot_id = lot.id
                    AND mark.mark_kind = 'thesis_weighted'
                  ORDER BY mark.effective_at DESC, mark.created_at DESC
                  LIMIT 1
                ) AS scenario_value_minor,
                (
                  SELECT mark.value_minor
                  FROM marks mark
                  WHERE mark.asset_lot_id = lot.id
                    AND mark.mark_kind = 'usable_liquidity'
                  ORDER BY mark.effective_at DESC, mark.created_at DESC
                  LIMIT 1
                ) AS usable_liquidity_minor,
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
              JOIN marks external
                ON external.id = (
                  SELECT latest.id
                  FROM marks latest
                  WHERE latest.asset_lot_id = lot.id
                    AND latest.mark_kind = 'external_mark'
                  ORDER BY latest.effective_at DESC, latest.created_at DESC
                  LIMIT 1
                )
              JOIN mark_sources source ON source.id = external.mark_source_id
              WHERE lot.household_id = ?
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
                (
                  SELECT observation.model_confidence_ppm
                  FROM public_source_observations observation
                  WHERE observation.evidence_event_id = event.id
                  LIMIT 1
                ) AS model_confidence_ppm,
                document.source_label,
                event.prior_value_json,
                event.replacement_value_json,
                event.estimated_forecast_impact_minor,
                (
                  SELECT claim.field_path
                  FROM evidence_claims claim
                  WHERE claim.evidence_event_id = event.id
                  ORDER BY claim.created_at
                  LIMIT 1
                ) AS claim_field_path,
                (
                  SELECT application.applied_at
                  FROM evidence_applications application
                  WHERE application.evidence_event_id = event.id
                  LIMIT 1
                ) AS application_applied_at
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
      all<PortfolioWatchTargetRow>(
        this.db
          .prepare(
            `SELECT
                target.id,
                company.id AS company_id,
                company.legal_name AS company_name,
                company.website_host AS official_host,
                target.status,
                target.last_checked_at,
                (
                  SELECT MAX(observation.retrieved_at)
                  FROM public_source_observations observation
                  WHERE observation.company_id = company.id
                ) AS latest_observation_at
              FROM portfolio_watch_targets target
              JOIN companies company ON company.id = target.company_id
              WHERE target.household_id = ?
              ORDER BY company.legal_name`,
          )
          .bind(householdId),
      ),
      all<PublicSourceObservationRow>(
        this.db
          .prepare(
            `SELECT
                observation.id,
                company.id AS company_id,
                company.legal_name AS company_name,
                observation.evidence_event_id,
                event.status AS evidence_status,
                observation.source_class,
                observation.source_url,
                observation.source_title,
                observation.published_at,
                observation.retrieved_at,
                observation.observed_fact,
                observation.inference,
                observation.source_reliability_ppm,
                observation.model_confidence_ppm,
                observation.valuation_low_minor,
                observation.valuation_middle_minor,
                observation.valuation_high_minor,
                observation.limitations
              FROM public_source_observations observation
              JOIN companies company ON company.id = observation.company_id
              JOIN evidence_events event ON event.id = observation.evidence_event_id
              WHERE observation.household_id = ?
              ORDER BY observation.retrieved_at DESC`,
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
                assumption.id,
                assumption.scenario_id,
                assumption.assumption_key,
                assumption.label,
                assumption.value_integer,
                assumption.value_scale,
                assumption.unit,
                assumption.provenance
              FROM scenario_assumptions assumption
              WHERE assumption.household_id = ?
                AND assumption.created_at = (
                  SELECT MAX(newest.created_at)
                  FROM scenario_assumptions newest
                  WHERE newest.scenario_id = assumption.scenario_id
                    AND newest.assumption_key = assumption.assumption_key
                )
              ORDER BY assumption.label`,
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
      goals,
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
      evidenceInbox: evidence.map((row) => {
        const application = getDirectEvidenceApplication(row.claim_field_path);
        return {
          id: row.id,
          companyName: row.company_name,
          eventType: row.event_type,
          headline: row.headline,
          detectedAt: row.detected_at,
          effectiveDate: row.effective_date,
          status: row.status,
          confidencePpm: row.confidence_ppm,
          modelConfidencePpm: row.model_confidence_ppm,
          sources: [row.source_label],
          priorValue: displayJsonValue(row.prior_value_json),
          replacementValue: displayJsonValue(row.replacement_value_json),
          forecastImpactMinor: row.estimated_forecast_impact_minor,
          application:
            application === null
              ? null
              : {
                  ...application,
                  applied: row.application_applied_at !== null,
                },
        };
      }),
      portfolioWatch: {
        targets: watchTargets.map((row) => ({
          id: row.id,
          companyId: row.company_id,
          companyName: row.company_name,
          officialHost: row.official_host,
          status: row.status,
          lastCheckedAt: row.last_checked_at,
          latestObservationAt: row.latest_observation_at,
        })),
        observations: publicObservations.map((row) => ({
          id: row.id,
          companyId: row.company_id,
          companyName: row.company_name,
          evidenceEventId: row.evidence_event_id,
          evidenceStatus: row.evidence_status,
          sourceClass: row.source_class,
          sourceUrl: row.source_url,
          sourceTitle: row.source_title,
          publishedAt: row.published_at,
          retrievedAt: row.retrieved_at,
          observedFact: row.observed_fact,
          inference: row.inference,
          sourceReliabilityPpm: row.source_reliability_ppm,
          modelConfidencePpm: row.model_confidence_ppm,
          valuationLowMinor: row.valuation_low_minor,
          valuationMiddleMinor: row.valuation_middle_minor,
          valuationHighMinor: row.valuation_high_minor,
          limitations: row.limitations,
        })),
      },
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
            key: assumption.assumption_key,
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

  public async scanPortfolioWatch(
    accessSubject: string,
  ): Promise<PortfolioWatchScanResult> {
    const identity = await this.findIdentity(accessSubject);
    const checkedAt = new Date().toISOString();
    const sourceUrl =
      "https://newsroom.harbor-health.example/updates/series-c-financing";
    const observedFact =
      "Harbor Health Systems announced a synthetic $62 million Series C financing and described the proceeds as growth capital.";
    const inference =
      "Keel's synthetic model uses the reported company-level financing signal to estimate a wider holding-value range. It does not treat the round headline as an administrator NAV.";
    const limitations =
      "The public announcement does not disclose the SPV's exact ownership, security preferences, dilution, fees, carry, or settlement terms.";
    const publishedAt = "2026-07-31T13:00:00-07:00";
    const fingerprint = await hashInput(
      `co_harbor|${sourceUrl}|${publishedAt}|${observedFact}`,
    );
    const existingObservation = await this.db
      .prepare(
        `SELECT id
         FROM public_source_observations
         WHERE fingerprint = ? AND household_id = ?`,
      )
      .bind(fingerprint, identity.household_id)
      .first<{ id: string }>();

    if (existingObservation !== null) {
      await this.db
        .prepare(
          `UPDATE portfolio_watch_targets
           SET last_checked_at = ?
           WHERE household_id = ? AND status = 'active'`,
        )
        .bind(checkedAt, identity.household_id)
        .run();
      return PortfolioWatchScanResultSchema.parse({
        checkedAt,
        discoveredCount: 0,
        proposedCount: 0,
      });
    }

    const target = await this.db
      .prepare(
        `SELECT target.id, company.id AS company_id
         FROM portfolio_watch_targets target
         JOIN companies company ON company.id = target.company_id
         WHERE target.household_id = ?
           AND target.id = 'watch_harbor'
           AND target.status = 'active'`,
      )
      .bind(identity.household_id)
      .first<{ id: string; company_id: string }>();
    if (target === null) {
      throw new Error("Portfolio watch target not found.");
    }

    const mark = await this.db
      .prepare(
        `SELECT mark.id, mark.value_minor, mark.review_status
         FROM marks mark
         JOIN asset_lots lot ON lot.id = mark.asset_lot_id
         WHERE lot.company_id = ?
           AND lot.household_id = ?
           AND mark.mark_kind = 'external_mark'
         ORDER BY mark.effective_at DESC, mark.created_at DESC
         LIMIT 1`,
      )
      .bind(target.company_id, identity.household_id)
      .first<ExistingMarkRow>();
    if (mark === null) {
      throw new Error("Portfolio watch mark target not found.");
    }

    const sourceDocumentId = crypto.randomUUID();
    const evidenceEventId = crypto.randomUUID();
    const observationId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    const replacementMiddleMinor = 118_000_000;
    const valuationLowMinor = 93_000_000;
    const valuationHighMinor = 142_000_000;
    const retrievedAt = checkedAt;
    const sourceHash = await hashInput(
      `${sourceUrl}|${observedFact}|${inference}`,
    );

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO source_documents (
            id,
            household_id,
            object_key,
            file_name,
            content_type,
            byte_size,
            sha256,
            effective_date,
            retrieved_at,
            source_label,
            review_status,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          sourceDocumentId,
          identity.household_id,
          "synthetic/public-watch/harbor-series-c.txt",
          "harbor-series-c.txt",
          "text/plain",
          2048,
          sourceHash,
          "2026-07-31",
          retrievedAt,
          "Synthetic official company newsroom",
          "pending_review",
          checkedAt,
        ),
      this.db
        .prepare(
          `INSERT INTO evidence_events (
            id,
            household_id,
            company_id,
            source_document_id,
            event_type,
            headline,
            effective_date,
            detected_at,
            retrieved_at,
            status,
            confidence_ppm,
            prior_value_json,
            replacement_value_json,
            estimated_forecast_impact_minor,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          evidenceEventId,
          identity.household_id,
          target.company_id,
          sourceDocumentId,
          "financing_round",
          "Public financing announcement suggests a new valuation range",
          "2026-07-31",
          retrievedAt,
          retrievedAt,
          "pending_review",
          920_000,
          JSON.stringify({ externalMarkMinor: mark.value_minor }),
          JSON.stringify({ externalMarkMinor: replacementMiddleMinor }),
          replacementMiddleMinor - mark.value_minor,
          checkedAt,
        ),
      this.db
        .prepare(
          `INSERT INTO evidence_claims (
            id,
            household_id,
            evidence_event_id,
            field_path,
            claim_value_json,
            unit,
            provenance,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          claimId,
          identity.household_id,
          evidenceEventId,
          "valuation_estimates.external_mark_range",
          JSON.stringify({
            lowMinor: valuationLowMinor,
            middleMinor: replacementMiddleMinor,
            highMinor: valuationHighMinor,
          }),
          "minor_units",
          "Synthetic official company newsroom; holding translation is inferred",
          checkedAt,
        ),
      this.db
        .prepare(
          `INSERT INTO public_source_observations (
            id,
            household_id,
            company_id,
            evidence_event_id,
            source_document_id,
            source_class,
            source_url,
            source_title,
            published_at,
            retrieved_at,
            observed_fact,
            inference,
            source_reliability_ppm,
            model_confidence_ppm,
            valuation_low_minor,
            valuation_middle_minor,
            valuation_high_minor,
            limitations,
            fingerprint,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          observationId,
          identity.household_id,
          target.company_id,
          evidenceEventId,
          sourceDocumentId,
          "official_company",
          sourceUrl,
          "Synthetic Series C financing announcement",
          publishedAt,
          retrievedAt,
          observedFact,
          inference,
          920_000,
          610_000,
          valuationLowMinor,
          replacementMiddleMinor,
          valuationHighMinor,
          limitations,
          fingerprint,
          checkedAt,
        ),
      this.db
        .prepare(
          `UPDATE portfolio_watch_targets
           SET last_checked_at = ?
           WHERE household_id = ? AND status = 'active'`,
        )
        .bind(checkedAt, identity.household_id),
    ]);

    return PortfolioWatchScanResultSchema.parse({
      checkedAt,
      discoveredCount: 1,
      proposedCount: 1,
    });
  }

  public async saveGoal(
    accessSubject: string,
    rawInput: GoalDraftInput,
  ): Promise<void> {
    const input = GoalDraftInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const dashboard = await this.getDashboard(identity.household_id);
    const preview = createGoalPreview(input, {
      p25FiveYearLiquidityMinor: dashboard.p25FiveYearLiquidityMinor,
      p50FiveYearLiquidityMinor: dashboard.p50FiveYearLiquidityMinor,
      p75FiveYearLiquidityMinor: dashboard.p75FiveYearLiquidityMinor,
      horizonDate: dashboard.forecastHorizonDate,
    });

    const existing =
      input.goalId === undefined
        ? null
        : await this.db
            .prepare(
              `SELECT
                goal.id,
                goal.template_key,
                goal.is_primary,
                COALESCE(MAX(version.version), 0) AS latest_version
              FROM goals goal
              LEFT JOIN goal_versions version ON version.goal_id = goal.id
              WHERE goal.id = ?
                AND goal.household_id = ?
                AND goal.archived_at IS NULL
              GROUP BY goal.id`,
            )
            .bind(input.goalId, identity.household_id)
            .first<GoalIdentityRow>();

    if (input.goalId !== undefined && existing === null) {
      throw new Error("Goal not found.");
    }
    if (existing !== null && existing.template_key !== input.templateKey) {
      throw new Error("A goal template cannot change between versions.");
    }

    const goalId = existing?.id ?? crypto.randomUUID();
    const version = (existing?.latest_version ?? 0) + 1;
    const versionId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const hasPrimary =
      (
        await this.db
          .prepare(
            `SELECT COUNT(*) AS count
            FROM goals
            WHERE household_id = ?
              AND archived_at IS NULL
              AND is_primary = 1`,
          )
          .bind(identity.household_id)
          .first<{ count: number }>()
      )?.count === 1;
    const makePrimary = input.makePrimary || !hasPrimary;
    const statements: D1PreparedStatement[] = [];

    if (makePrimary) {
      statements.push(
        this.db
          .prepare(
            `UPDATE goals
            SET is_primary = 0
            WHERE household_id = ? AND is_primary = 1`,
          )
          .bind(identity.household_id),
      );
    }

    if (existing === null) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO goals (
              id,
              household_id,
              template_key,
              is_primary,
              archived_at,
              created_at
            ) VALUES (?, ?, ?, ?, NULL, ?)`,
          )
          .bind(
            goalId,
            identity.household_id,
            input.templateKey,
            makePrimary ? 1 : 0,
            createdAt,
          ),
      );
    } else if (makePrimary && existing.is_primary === 0) {
      statements.push(
        this.db
          .prepare("UPDATE goals SET is_primary = 1 WHERE id = ?")
          .bind(goalId),
      );
    } else if (makePrimary) {
      statements.push(
        this.db
          .prepare("UPDATE goals SET is_primary = 1 WHERE id = ?")
          .bind(goalId),
      );
    }

    statements.push(
      this.db
        .prepare(
          `INSERT INTO goal_versions (
            id,
            household_id,
            goal_id,
            version,
            name,
            metric_key,
            metric_label,
            target_value_integer,
            target_unit,
            target_date,
            current_value_integer,
            current_value_source,
            change_note,
            created_at,
            created_by,
            immutable
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          versionId,
          identity.household_id,
          goalId,
          version,
          input.name,
          input.metricKey,
          input.metricLabel,
          input.targetValueInteger,
          input.targetUnit,
          input.targetDate,
          input.currentValueInteger,
          "Goal editor input",
          input.changeNote,
          createdAt,
          identity.display_name,
        ),
      this.db
        .prepare(
          `INSERT INTO goal_forecast_snapshots (
            id,
            household_id,
            goal_version_id,
            version,
            model_status,
            lower_value_integer,
            middle_value_integer,
            higher_value_integer,
            success_probability_ppm,
            unit,
            horizon_date,
            methodology,
            created_at,
            created_by,
            immutable
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          snapshotId,
          identity.household_id,
          versionId,
          version,
          preview.modelStatus,
          preview.lowerValueInteger,
          preview.middleValueInteger,
          preview.higherValueInteger,
          preview.successProbabilityPpm,
          input.targetUnit,
          preview.horizonDate,
          preview.methodology,
          createdAt,
          identity.display_name,
        ),
    );

    await this.db.batch(statements);
  }

  public async saveScenario(
    accessSubject: string,
    rawInput: ScenarioDraftInput,
  ): Promise<void> {
    const input = ScenarioDraftInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const scenario = await this.db
      .prepare(
        `SELECT
          scenario.id,
          scenario.name,
          scenario.description,
          scenario.is_sandbox,
          COALESCE(MAX(snapshot.version), 0) AS latest_version,
          (
            SELECT newest.id
            FROM forecast_snapshots newest
            WHERE newest.scenario_id = scenario.id
            ORDER BY newest.version DESC
            LIMIT 1
          ) AS latest_snapshot_id
        FROM scenarios scenario
        LEFT JOIN forecast_snapshots snapshot
          ON snapshot.scenario_id = scenario.id
        WHERE scenario.id = ?
          AND scenario.household_id = ?
          AND scenario.archived_at IS NULL
        GROUP BY scenario.id`,
      )
      .bind(input.scenarioId, identity.household_id)
      .first<ScenarioIdentityRow>();

    if (scenario === null) {
      throw new Error("Scenario not found.");
    }
    if (scenario.latest_snapshot_id === null) {
      throw new Error("Scenario does not have a forecast snapshot.");
    }

    const assumptions = await all<AssumptionRow>(
      this.db
        .prepare(
          `SELECT
              assumption.id,
              assumption.scenario_id,
              assumption.assumption_key,
              assumption.label,
              assumption.value_integer,
              assumption.value_scale,
              assumption.unit,
              assumption.provenance
            FROM scenario_assumptions assumption
            WHERE assumption.household_id = ?
              AND assumption.scenario_id = ?
              AND assumption.created_at = (
                SELECT MAX(newest.created_at)
                FROM scenario_assumptions newest
                WHERE newest.scenario_id = assumption.scenario_id
                  AND newest.assumption_key = assumption.assumption_key
              )
            ORDER BY assumption.assumption_key`,
        )
        .bind(identity.household_id, scenario.id),
    );
    const draftValuesByKey = new Map(
      input.assumptions.map((assumption) => [assumption.key, assumption.value]),
    );
    if (
      input.assumptions.length !== assumptions.length ||
      new Set(input.assumptions.map((assumption) => assumption.key)).size !==
        input.assumptions.length
    ) {
      throw new Error("Scenario assumptions are stale.");
    }
    const draftValues = new Map<string, number>();
    assumptions.forEach((assumption) => {
      const value = draftValuesByKey.get(assumption.assumption_key);
      if (value === undefined) {
        throw new Error("Scenario assumptions are stale.");
      }
      if (assumption.unit === "ppm" && value > 1_000_000) {
        throw new Error(
          "Probability assumptions must be between 0 and 1000000.",
        );
      }
      draftValues.set(assumption.id, value);
    });

    const [companyForecasts, curveRows, outputRows] = await Promise.all([
      all<ScenarioCompanyForecastRow>(
        this.db
          .prepare(
            `SELECT
                company_id,
                conditional_value_minor,
                timing_adjusted_liquidity_minor,
                probability_zero_ppm,
                effective_date
              FROM company_forecasts
              WHERE household_id = ? AND forecast_snapshot_id = ?
              ORDER BY company_id`,
          )
          .bind(identity.household_id, scenario.latest_snapshot_id),
      ),
      all<CurveRow>(
        this.db
          .prepare(
            `SELECT
                scenario_id,
                year,
                p25_minor,
                p50_minor,
                p75_minor,
                expected_minor,
                probability_zero_ppm
              FROM liquidity_curves
              WHERE household_id = ? AND forecast_snapshot_id = ?
              ORDER BY year`,
          )
          .bind(identity.household_id, scenario.latest_snapshot_id),
      ),
      all<ScenarioOutputRow>(
        this.db
          .prepare(
            `SELECT
                metric_key,
                horizon_date,
                percentile,
                value_minor,
                probability_ppm
              FROM forecast_outputs
              WHERE household_id = ? AND forecast_snapshot_id = ?
              ORDER BY metric_key, percentile`,
          )
          .bind(identity.household_id, scenario.latest_snapshot_id),
      ),
    ]);

    const base: Scenario = {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      isSandbox: Boolean(scenario.is_sandbox),
      conditionalValueMinor: companyForecasts.reduce(
        (total, row) => total + row.conditional_value_minor,
        0,
      ),
      timingAdjustedLiquidityMinor: companyForecasts.reduce(
        (total, row) => total + row.timing_adjusted_liquidity_minor,
        0,
      ),
      assumptions: assumptions.map((assumption) => ({
        id: assumption.id,
        key: assumption.assumption_key,
        label: assumption.label,
        value: assumption.value_integer,
        unit: assumption.unit,
        provenance: assumption.provenance,
      })),
      liquidityCurve: curveRows.map((row) => ({
        year: row.year,
        p25Minor: row.p25_minor,
        p50Minor: row.p50_minor,
        p75Minor: row.p75_minor,
        expectedMinor: row.expected_minor,
        probabilityZeroPpm: row.probability_zero_ppm,
      })),
    };
    const projection = projectScenario(base, {
      ...input,
      assumptions: assumptions.map((assumption) => ({
        id: assumption.id,
        key: assumption.assumption_key,
        value: draftValues.get(assumption.id) ?? assumption.value_integer,
      })),
    });
    const baseProbability = assumptions.find(
      (assumption) => assumption.assumption_key === "liquidity_probability",
    );
    const baseDelay = assumptions.find(
      (assumption) => assumption.assumption_key === "timing_delay_months",
    );
    if (baseProbability === undefined || baseDelay === undefined) {
      throw new Error(
        "Scenario requires liquidity probability and timing delay assumptions.",
      );
    }
    const draftProbability = draftValues.get(baseProbability.id);
    const draftDelay = draftValues.get(baseDelay.id);
    if (draftProbability === undefined || draftDelay === undefined) {
      throw new Error("Scenario assumptions are stale.");
    }
    const baseFactorPpm = scenarioLiquidityFactorPpm(
      baseProbability.value_integer,
      baseDelay.value_integer,
    );
    const draftFactorPpm = scenarioLiquidityFactorPpm(
      draftProbability,
      draftDelay,
    );
    const createdAt = new Date().toISOString();
    const version = scenario.latest_version + 1;
    const inputHash = await hashInput(
      [
        scenario.id,
        version,
        ...[...draftValues.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, value]) => `${id}:${value}`),
      ].join("|"),
    );
    const effectiveDate = createdAt;
    const snapshotUuid = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO forecast_snapshots (
            id,
            household_id,
            scenario_id,
            version,
            input_hash,
            created_at,
            created_by,
            trigger,
            attributed_change,
            immutable
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          snapshotUuid,
          identity.household_id,
          scenario.id,
          version,
          inputHash,
          createdAt,
          identity.display_name,
          "Scenario editor",
          input.changeNote,
        ),
    ];

    assumptions.forEach((assumption) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO scenario_assumptions (
              id,
              household_id,
              scenario_id,
              assumption_key,
              label,
              value_integer,
              value_scale,
              unit,
              provenance,
              effective_date,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            scenario.id,
            assumption.assumption_key,
            assumption.label,
            draftValues.get(assumption.id),
            assumption.value_scale,
            assumption.unit,
            "Scenario editor input",
            effectiveDate,
            createdAt,
          ),
      );
    });

    companyForecasts.forEach((row) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO company_forecasts (
              id,
              household_id,
              forecast_snapshot_id,
              scenario_id,
              company_id,
              conditional_value_minor,
              timing_adjusted_liquidity_minor,
              probability_zero_ppm,
              effective_date,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            snapshotUuid,
            scenario.id,
            row.company_id,
            row.conditional_value_minor,
            projectScenarioValue(
              row.conditional_value_minor,
              row.timing_adjusted_liquidity_minor,
              baseFactorPpm,
              draftFactorPpm,
              projection.liquidityScalePpm,
            ),
            projectScenarioZeroProbabilityPpm(
              row.probability_zero_ppm,
              projection.liquidityScalePpm,
            ),
            row.effective_date,
            createdAt,
          ),
      );
    });

    projection.liquidityCurve.forEach((point) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO liquidity_curves (
              id,
              household_id,
              forecast_snapshot_id,
              scenario_id,
              year,
              p25_minor,
              p50_minor,
              p75_minor,
              expected_minor,
              probability_zero_ppm,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            snapshotUuid,
            scenario.id,
            point.year,
            point.p25Minor,
            point.p50Minor,
            point.p75Minor,
            point.expectedMinor,
            point.probabilityZeroPpm,
            createdAt,
          ),
      );
    });

    outputRows.forEach((row) => {
      const valueMinor =
        row.value_minor === null
          ? null
          : multiplyMinorByScalePpm(
              row.value_minor,
              projection.liquidityScalePpm,
            );
      const probabilityPpm =
        row.probability_ppm === null
          ? null
          : projectScenarioProbabilityPpm(
              row.probability_ppm,
              projection.liquidityScalePpm,
            );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO forecast_outputs (
              id,
              household_id,
              forecast_snapshot_id,
              metric_key,
              horizon_date,
              percentile,
              value_minor,
              probability_ppm,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            snapshotUuid,
            row.metric_key,
            row.horizon_date,
            row.percentile,
            valueMinor,
            probabilityPpm,
            createdAt,
          ),
      );
    });

    await this.db.batch(statements);
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

  public async applyEvidence(
    accessSubject: string,
    eventId: string,
  ): Promise<void> {
    const event = await this.db
      .prepare(
        `SELECT
          event.status AS current_status,
          event.company_id,
          event.effective_date,
          event.retrieved_at,
          event.detected_at,
          event.confidence_ppm,
          event.prior_value_json,
          event.replacement_value_json,
          document.source_label,
          (
            SELECT claim.field_path
            FROM evidence_claims claim
            WHERE claim.evidence_event_id = event.id
            ORDER BY claim.created_at
            LIMIT 1
          ) AS claim_field_path,
          decision.id AS review_decision_id,
          household.id AS household_id,
          user.id AS user_id,
          user.display_name
        FROM evidence_events event
        JOIN households household ON household.id = event.household_id
        JOIN users user ON user.id = household.owner_user_id
        JOIN source_documents document ON document.id = event.source_document_id
        LEFT JOIN review_decisions decision
          ON decision.evidence_event_id = event.id
        WHERE event.id = ? AND user.access_subject = ?`,
      )
      .bind(eventId, accessSubject)
      .first<EvidenceApplyEventRow>();

    if (event === null) {
      throw new Error("Evidence event not found.");
    }

    const application = getDirectEvidenceApplication(event.claim_field_path);
    if (application === null) {
      throw new Error(
        "Evidence event has no deterministic direct application.",
      );
    }
    if (
      event.prior_value_json === null ||
      event.replacement_value_json === null
    ) {
      throw new Error(
        "Evidence event does not contain a complete proposed change.",
      );
    }

    const valueKey =
      application.target === "external_mark"
        ? "externalMarkMinor"
        : "usableLiquidityMinor";
    const priorValue = parseMinorValue(event.prior_value_json, valueKey);
    const replacementValue = parseMinorValue(
      event.replacement_value_json,
      valueKey,
    );

    const existingApplication = await this.db
      .prepare(
        `SELECT id
         FROM evidence_applications
         WHERE evidence_event_id = ?`,
      )
      .bind(eventId)
      .first<{ id: string }>();
    if (existingApplication !== null) {
      throw new Error("Evidence event has already been applied.");
    }

    if (
      event.current_status !== "pending_review" &&
      event.current_status !== "accepted"
    ) {
      throw new Error(
        `Evidence event cannot be directly applied from ${event.current_status}.`,
      );
    }
    if (
      event.current_status === "accepted" &&
      event.review_decision_id === null
    ) {
      throw new Error("Accepted evidence is missing its review decision.");
    }
    if (
      event.current_status === "pending_review" &&
      event.review_decision_id !== null
    ) {
      throw new Error("Pending evidence already has a review decision.");
    }
    if (event.company_id === null) {
      throw new Error("Evidence event is not linked to a company record.");
    }

    const target = await this.db
      .prepare(
        `SELECT
          lot.id AS lot_id,
          lot.currency
        FROM asset_lots lot
        WHERE lot.household_id = ? AND lot.company_id = ?
        ORDER BY lot.created_at
        LIMIT 1`,
      )
      .bind(event.household_id, event.company_id)
      .first<MarkTargetRow>();
    if (target === null) {
      throw new Error("Evidence event has no financial record target.");
    }

    const markKind = application.target;
    let effectiveAt = `${event.effective_date}T00:00:00.000Z`;
    let existingMark = await this.db
      .prepare(
        `SELECT id, value_minor, review_status
         FROM marks
         WHERE asset_lot_id = ? AND mark_kind = ? AND effective_at = ?`,
      )
      .bind(target.lot_id, markKind, effectiveAt)
      .first<ExistingMarkRow>();

    if (
      existingMark !== null &&
      (existingMark.value_minor !== replacementValue ||
        existingMark.review_status !== "accepted")
    ) {
      effectiveAt = event.retrieved_at;
      existingMark = await this.db
        .prepare(
          `SELECT id, value_minor, review_status
           FROM marks
           WHERE asset_lot_id = ? AND mark_kind = ? AND effective_at = ?`,
        )
        .bind(target.lot_id, markKind, effectiveAt)
        .first<ExistingMarkRow>();
    }

    const createdAt = new Date().toISOString();
    const markId =
      existingMark?.value_minor === replacementValue &&
      existingMark.review_status === "accepted"
        ? existingMark.id
        : crypto.randomUUID();
    const source = await this.db
      .prepare(
        `SELECT id
         FROM mark_sources
         WHERE household_id = ? AND source_name = ?
         ORDER BY created_at
         LIMIT 1`,
      )
      .bind(event.household_id, event.source_label)
      .first<{ id: string }>();
    const sourceId = source?.id ?? crypto.randomUUID();
    const reviewDecisionId = event.review_decision_id ?? crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];

    if (source === null) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO mark_sources (
              id,
              household_id,
              source_type,
              source_name,
              confidence_ppm,
              created_at
            ) VALUES (?, ?, 'company_announcement', ?, ?, ?)`,
          )
          .bind(
            sourceId,
            event.household_id,
            event.source_label,
            event.confidence_ppm,
            createdAt,
          ),
      );
    }

    if (event.current_status === "pending_review") {
      statements.push(
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
            ) VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?, ?)`,
          )
          .bind(
            reviewDecisionId,
            event.household_id,
            eventId,
            event.user_id,
            `Accepted and applied to ${application.label}.`,
            event.prior_value_json,
            event.replacement_value_json,
            createdAt,
          ),
        this.db
          .prepare(
            "UPDATE evidence_events SET status = 'accepted' WHERE id = ?",
          )
          .bind(eventId),
      );
    }

    if (markId !== existingMark?.id) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO marks (
              id,
              household_id,
              company_id,
              asset_lot_id,
              mark_source_id,
              mark_kind,
              value_minor,
              currency,
              effective_at,
              retrieved_at,
              review_status,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?)`,
          )
          .bind(
            markId,
            event.household_id,
            event.company_id,
            target.lot_id,
            sourceId,
            markKind,
            replacementValue,
            target.currency,
            effectiveAt,
            event.retrieved_at,
            createdAt,
          ),
      );
    }

    statements.push(
      this.db
        .prepare(
          `INSERT INTO evidence_applications (
            id,
            household_id,
            evidence_event_id,
            review_decision_id,
            target_kind,
            target_record_id,
            prior_value_json,
            replacement_value_json,
            applied_at,
            applied_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          event.household_id,
          eventId,
          reviewDecisionId,
          markKind,
          markId,
          JSON.stringify({ [valueKey]: priorValue }),
          JSON.stringify({ [valueKey]: replacementValue }),
          createdAt,
          event.user_id,
        ),
    );

    await this.db.batch(statements);
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT
          household.id AS household_id,
          user.id AS user_id,
          user.display_name
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
          p50.horizon_date AS forecast_horizon_date,
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
          p75.value_minor AS p75_five_year_liquidity_minor,
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
        JOIN forecast_outputs p75
          ON p75.forecast_snapshot_id = snapshot.id
          AND p75.metric_key = 'cumulative_liquidity'
          AND p75.percentile = 75
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
      forecastHorizonDate: row.forecast_horizon_date,
      householdName: row.household_name,
      fiEligibleLiquidMinor: row.fi_eligible_liquid_minor,
      protectedRunwayMonths: row.protected_runway_months,
      householdBurnMonthlyMinor: row.household_burn_monthly_minor,
      businessBurnMonthlyMinor: row.business_burn_monthly_minor,
      fiTargetMinor: row.fi_target_minor,
      fiGapMinor: row.fi_gap_minor,
      p25FiveYearLiquidityMinor: row.p25_five_year_liquidity_minor,
      p50FiveYearLiquidityMinor: row.p50_five_year_liquidity_minor,
      p75FiveYearLiquidityMinor: row.p75_five_year_liquidity_minor,
      probabilityCrossingFiPpm: row.probability_crossing_fi_ppm,
    };
  }

  private async getGoals(householdId: string) {
    const rows = await all<GoalRow>(
      this.db
        .prepare(
          `SELECT
            goal.id,
            goal.template_key,
            goal.is_primary,
            goal.archived_at,
            goal.created_at AS goal_created_at,
            version.id AS goal_version_id,
            version.version,
            version.name,
            version.metric_key,
            version.metric_label,
            version.target_value_integer,
            version.target_unit,
            version.target_date,
            version.current_value_integer,
            version.current_value_source,
            version.change_note,
            version.created_at AS version_created_at,
            version.created_by AS version_created_by,
            forecast.id AS forecast_id,
            forecast.model_status,
            forecast.lower_value_integer,
            forecast.middle_value_integer,
            forecast.higher_value_integer,
            forecast.success_probability_ppm,
            forecast.unit AS forecast_unit,
            forecast.horizon_date,
            forecast.methodology,
            forecast.created_at AS forecast_created_at,
            forecast.created_by AS forecast_created_by
          FROM goals goal
          JOIN goal_versions version ON version.goal_id = goal.id
          JOIN goal_forecast_snapshots forecast
            ON forecast.goal_version_id = version.id
          WHERE goal.household_id = ? AND goal.archived_at IS NULL
          ORDER BY goal.is_primary DESC, goal.created_at, version.version DESC`,
        )
        .bind(householdId),
    );

    const goalsById = new Map<
      string,
      {
        id: string;
        templateKey: GoalRow["template_key"];
        isPrimary: boolean;
        archivedAt: string | null;
        createdAt: string;
        versions: {
          id: string;
          version: number;
          name: string;
          metricKey: string;
          metricLabel: string;
          targetValueInteger: number | null;
          targetUnit: GoalRow["target_unit"];
          targetDate: string | null;
          currentValueInteger: number;
          currentValueSource: string;
          changeNote: string;
          createdAt: string;
          createdBy: string;
          forecast: {
            id: string;
            version: number;
            modelStatus: GoalRow["model_status"];
            lowerValueInteger: number | null;
            middleValueInteger: number | null;
            higherValueInteger: number | null;
            successProbabilityPpm: number | null;
            unit: GoalRow["forecast_unit"];
            horizonDate: string | null;
            methodology: string;
            createdAt: string;
            createdBy: string;
          };
        }[];
      }
    >();

    rows.forEach((row) => {
      const goal = goalsById.get(row.id) ?? {
        id: row.id,
        templateKey: row.template_key,
        isPrimary: Boolean(row.is_primary),
        archivedAt: row.archived_at,
        createdAt: row.goal_created_at,
        versions: [],
      };
      goal.versions.push({
        id: row.goal_version_id,
        version: row.version,
        name: row.name,
        metricKey: row.metric_key,
        metricLabel: row.metric_label,
        targetValueInteger: row.target_value_integer,
        targetUnit: row.target_unit,
        targetDate: row.target_date,
        currentValueInteger: row.current_value_integer,
        currentValueSource: row.current_value_source,
        changeNote: row.change_note,
        createdAt: row.version_created_at,
        createdBy: row.version_created_by,
        forecast: {
          id: row.forecast_id,
          version: row.version,
          modelStatus: row.model_status,
          lowerValueInteger: row.lower_value_integer,
          middleValueInteger: row.middle_value_integer,
          higherValueInteger: row.higher_value_integer,
          successProbabilityPpm: row.success_probability_ppm,
          unit: row.forecast_unit,
          horizonDate: row.horizon_date,
          methodology: row.methodology,
          createdAt: row.forecast_created_at,
          createdBy: row.forecast_created_by,
        },
      });
      goalsById.set(row.id, goal);
    });

    return [...goalsById.values()];
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
          ORDER BY snapshot.created_at, snapshot.version`,
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
