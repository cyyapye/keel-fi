import {
  AlphaDataSchema,
  CreateSignalUpdateProposalInputSchema,
  createGoalPreview,
  FinancingAnnouncementFactsSchema,
  FinancingValuationFactSchema,
  GoalDraftInputSchema,
  multiplyMinorByScalePpm,
  projectScenario,
  projectScenarioProbabilityPpm,
  projectScenarioValue,
  projectScenarioZeroProbabilityPpm,
  reconcileFinancingSignals,
  scenarioLiquidityFactorPpm,
  ScenarioDraftInputSchema,
  signalReconciliationRevisionMaterial,
  SignalReconciliationGroupSchema,
  SignalUpdateProposalSchema,
  type AlphaData,
  type CreateSignalUpdateProposalInput,
  type FinancingAnnouncementFacts,
  type ForecastHistoryItemSchema,
  type GoalDraftInput,
  type HoldingImportApplyInput,
  type HoldingImportApplyResult,
  type HoldingImportPreview,
  type HoldingImportSummary,
  type PublicSourceObservation,
  type Scenario,
  type ScenarioDraftInput,
  type SignalReconciliationGroup,
  type SignalUpdateProposal,
} from "@keel/domain";
import {
  assertReviewTransition,
  getDirectEvidenceApplication,
  ReviewInputSchema,
  type ReviewInput,
} from "@keel/evidence";
import type { z } from "zod";

import {
  D1PortfolioWatchRepository,
  type PortfolioWatchScanPreparation,
} from "./portfolio-watch";
import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
  type HoldingImportStageResult,
} from "./holding-imports";

export * from "./holding-imports";
export * from "./holdings-page";
export * from "./angellist-mac-agent";
export * from "./provider-portfolio-agent";
export * from "./provider-legal-documents";
export * from "./portfolio-baseline";
import {
  D1PortfolioBaselineRepository,
  refreshAcceptedPortfolioBaseline,
} from "./portfolio-baseline";
export * from "./plan-inputs";
export * from "./investment-connections";
export * from "./portfolio-watch";
export * from "./cash-accounts";
export * from "./cash-flow";
export * from "./liabilities";
export * from "./mac-agent-credentials";
export * from "./provider-browser-sessions";
export * from "./exposures";
export * from "./exposure-read-model";
export * from "./position-read-model";
export * from "./plan-actual-monitoring";
export * from "./position-value-adjustments";
export * from "./position-economics";
export * from "./legal-entities";
export * from "./investment-review";

type DashboardRow = {
  as_of_date: string;
  forecast_horizon_date: string;
  household_name: string;
  fi_eligible_liquid_minor: number;
  protected_runway_months: number;
  protected_cash_floor_minor: number;
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
  company_id: string | null;
  position_name: string;
  exposure_name: string | null;
  owner_label: string;
  position_kind: "direct" | "spv_interest" | "fund_interest";
  administrator_nav_minor: number | null;
  administrator_nav_state: "reported" | "locked" | "not_set";
  external_mark_minor: number | null;
  underwriting_value_minor: number | null;
  scenario_value_minor: number | null;
  usable_liquidity_minor: number | null;
  source_status: "verified" | "review_due" | "proposed";
  source_label: string;
  effective_date: string;
  retrieved_at: string;
  confidence_ppm: number | null;
  ticker: string | null;
  quantity_micros: number | null;
  cost_basis_minor: number | null;
  invested_minor: number | null;
  committed_minor: number | null;
  realized_value_minor: number | null;
  instrument_type: string | null;
  position_snapshot_id: string | null;
  position_currency: string | null;
  position_provider_value_state: "reported" | "locked" | "not_reported" | null;
  position_provider_value_minor: number | null;
  adjustment_id: string | null;
  adjustment_snapshot_id: string | null;
  adjustment_prior_value_state: "reported" | "locked" | "not_reported" | null;
  adjustment_prior_value_minor: number | null;
  adjustment_value_minor: number | null;
  adjustment_currency: string | null;
  adjustment_effective_date: string | null;
  adjustment_source_kind: "gp_update" | "news_article" | "other" | null;
  adjustment_source_label: string | null;
  adjustment_source_url: string | null;
  adjustment_commentary: string | null;
  adjustment_accepted_at: string | null;
  economics_id: string | null;
  economics_snapshot_id: string | null;
  economics_commitment_minor: number | null;
  economics_funded_minor: number | null;
  economics_capital_basis: "gross_commitment" | "net_invested" | null;
  economics_gross_commitment_minor: number | null;
  economics_setup_fee_ppm: number | null;
  economics_annual_admin_fee_ppm: number | null;
  economics_admin_fee_years: number | null;
  economics_carry_ppm: number | null;
  economics_note: string | null;
  economics_accepted_at: string | null;
  reported_management_fee_ppm: number | null;
  reported_carry_ppm: number | null;
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
  claim_value_json: string | null;
  public_source_url: string | null;
  public_observed_fact: string | null;
  application_applied_at: string | null;
};

type PortfolioWatchTargetRow = {
  id: string;
  company_id: string;
  company_name: string;
  official_host: string | null;
  status: "active" | "paused";
  coverage_status: "active" | "discovering" | "degraded" | "unavailable";
  last_checked_at: string | null;
  latest_observation_at: string | null;
};

const PORTFOLIO_WATCH_TARGETS_SQL = `SELECT
    target.id,
    company.id AS company_id,
    company.legal_name AS company_name,
    company.website_host AS official_host,
    target.status,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM portfolio_watch_sources source
        WHERE source.watch_target_id = target.id
          AND source.status = 'active'
      ) THEN 'active'
      WHEN EXISTS (
        SELECT 1 FROM portfolio_watch_sources source
        WHERE source.watch_target_id = target.id
          AND source.status = 'degraded'
      ) THEN 'degraded'
      WHEN EXISTS (
        SELECT 1 FROM portfolio_watch_sources source
        WHERE source.watch_target_id = target.id
          AND source.status IN ('discovered', 'verified')
      ) THEN 'discovering'
      WHEN company.website_host IS NULL OR trim(company.website_host) = ''
        THEN 'unavailable'
      WHEN target.last_checked_at IS NULL THEN 'discovering'
      ELSE 'unavailable'
    END AS coverage_status,
    target.last_checked_at,
    (
      SELECT MAX(observation.retrieved_at)
      FROM public_source_observations observation
      WHERE observation.company_id = company.id
    ) AS latest_observation_at
  FROM portfolio_watch_targets target
  JOIN companies company ON company.id = target.company_id
  WHERE target.household_id = ?
    AND target.status = 'active'
  ORDER BY company.legal_name`;

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
  claim_value_json: string | null;
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
  has_financing_terms_claim: number;
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
  latest_snapshot_id: string | null;
  latest_snapshot_version: number | null;
  conditional_value_minor: number;
  timing_adjusted_liquidity_minor: number;
};

type SignalUpdateProposalRow = {
  id: string;
  household_id: string;
  company_id: string;
  company_name: string;
  reconciliation_group_id: string;
  reconciliation_revision: string;
  scenario_id: string;
  scenario_name: string;
  base_forecast_snapshot_id: string;
  base_forecast_snapshot_version: number;
  proposed_company_valuation_json: string;
  rationale: string;
  created_at: string;
  created_by: string;
  current_snapshot_id: string | null;
};

type SignalUpdateProposalEvidenceRow = {
  proposal_id: string;
  evidence_event_id: string;
};

type SignalUpdateProposalScenarioRow = {
  id: string;
  name: string;
  latest_snapshot_id: string | null;
  latest_snapshot_version: number | null;
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
  preparePortfolioWatchScan(
    accessSubject: string,
  ): Promise<PortfolioWatchScanPreparation>;
  stageHoldingImport(
    accessSubject: string,
    input: HoldingImportStageInput,
  ): Promise<HoldingImportStageResult>;
  getHoldingImport(
    accessSubject: string,
    importId: string,
  ): Promise<HoldingImportPreview>;
  reconcileHoldingImport(
    accessSubject: string,
    importId: string,
  ): Promise<HoldingImportPreview>;
  listPendingHoldingImports(
    accessSubject: string,
  ): Promise<HoldingImportSummary[]>;
  applyHoldingImport(
    accessSubject: string,
    importId: string,
    input: HoldingImportApplyInput,
  ): Promise<HoldingImportApplyResult>;
  saveGoal(accessSubject: string, input: GoalDraftInput): Promise<void>;
  saveScenario(accessSubject: string, input: ScenarioDraftInput): Promise<void>;
  createSignalUpdateProposal(
    accessSubject: string,
    input: CreateSignalUpdateProposalInput,
  ): Promise<SignalUpdateProposal>;
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

function financingFactsFromClaim(
  serialized: string | null,
): FinancingAnnouncementFacts | null {
  if (serialized === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const result = FinancingAnnouncementFactsSchema.safeParse(
    (parsed as Record<string, unknown>).financingFacts,
  );
  return result.success ? result.data : null;
}

function boundedSourceExcerpt(value: string): string | null {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    return null;
  }

  let excerpt = "";
  for (const word of normalized.split(" ").slice(0, 25)) {
    const candidate = excerpt.length === 0 ? word : `${excerpt} ${word}`;
    if (candidate.length > 240) {
      break;
    }
    excerpt = candidate;
  }
  return excerpt || null;
}

function publicSourceObservationFromRow(
  row: PublicSourceObservationRow,
): PublicSourceObservation {
  return {
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
    financingFacts: financingFactsFromClaim(row.claim_value_json),
    limitations: row.limitations,
  };
}

async function createSignalReconciliationGroups(
  observations: readonly PublicSourceObservation[],
): Promise<SignalReconciliationGroup[]> {
  return Promise.all(
    reconcileFinancingSignals(observations).map(async (group) =>
      SignalReconciliationGroupSchema.parse({
        ...group,
        revision: await hashInput(signalReconciliationRevisionMaterial(group)),
      }),
    ),
  );
}

function parseProposedCompanyValuation(serialized: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Signal update proposal has invalid valuation context.");
  }
  return FinancingValuationFactSchema.parse(parsed);
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
      signalUpdateProposalRows,
      signalUpdateProposalEvidenceRows,
    ] = await Promise.all([
      this.getDashboard(householdId),
      this.getGoals(householdId),
      all<HoldingRow>(
        this.db
          .prepare(
            `SELECT * FROM (
               SELECT
                 lot.id,
                 company.id AS company_id,
                 lot.lot_label AS position_name,
                 company.legal_name AS exposure_name,
                 account.name AS owner_label,
                 CASE
                   WHEN lot.private_vehicle_id IS NULL THEN 'direct'
                   WHEN account.account_type = 'fund' THEN 'fund_interest'
                   ELSE 'spv_interest'
                 END AS position_kind,
                 (
                   SELECT mark.value_minor
                   FROM marks mark
                   WHERE mark.asset_lot_id = lot.id
                     AND mark.mark_kind = 'administrator_nav'
                   ORDER BY mark.effective_at DESC, mark.created_at DESC
                   LIMIT 1
                 ) AS administrator_nav_minor,
                 CASE
                   WHEN EXISTS (
                     SELECT 1 FROM marks mark
                     WHERE mark.asset_lot_id = lot.id
                       AND mark.mark_kind = 'administrator_nav'
                   ) THEN 'reported'
                   ELSE 'not_set'
                 END AS administrator_nav_state,
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
                   WHEN julianday('now') - julianday(external.retrieved_at) > 90
                     THEN 'review_due'
                   ELSE 'verified'
                 END AS source_status,
                 source.source_name AS source_label,
                 substr(external.effective_at, 1, 10) AS effective_date,
                 external.retrieved_at,
                 source.confidence_ppm,
                 NULL AS ticker,
                 NULL AS quantity_micros,
                 NULL AS cost_basis_minor,
                 NULL AS invested_minor,
                 NULL AS committed_minor,
                 NULL AS realized_value_minor,
                 NULL AS instrument_type,
                 NULL AS position_snapshot_id,
                 NULL AS position_currency,
                 NULL AS position_provider_value_state,
                 NULL AS position_provider_value_minor,
                 NULL AS adjustment_id,
                 NULL AS adjustment_snapshot_id,
                 NULL AS adjustment_prior_value_state,
                 NULL AS adjustment_prior_value_minor,
                 NULL AS adjustment_value_minor,
                 NULL AS adjustment_currency,
                 NULL AS adjustment_effective_date,
                 NULL AS adjustment_source_kind,
                 NULL AS adjustment_source_label,
                 NULL AS adjustment_source_url,
                 NULL AS adjustment_commentary,
                 NULL AS adjustment_accepted_at,
                 NULL AS economics_id,
                 NULL AS economics_snapshot_id,
                 NULL AS economics_commitment_minor,
                 NULL AS economics_funded_minor,
                 NULL AS economics_capital_basis,
                 NULL AS economics_gross_commitment_minor,
                 NULL AS economics_setup_fee_ppm,
                 NULL AS economics_annual_admin_fee_ppm,
                 NULL AS economics_admin_fee_years,
                 NULL AS economics_carry_ppm,
                 NULL AS economics_note,
                 NULL AS economics_accepted_at,
                 NULL AS reported_management_fee_ppm,
                 NULL AS reported_carry_ppm
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
                 AND NOT EXISTS (
                   SELECT 1
                   FROM asset_lot_retirements retirement
                   WHERE retirement.asset_lot_id = lot.id
                     AND retirement.household_id = lot.household_id
                 )

               UNION ALL

               SELECT
                 position.id,
                 COALESCE(
                   (
                     SELECT MAX(canonical.company_id)
                     FROM holding_position_exposure_mappings mapping
                     JOIN canonical_exposures canonical
                       ON canonical.id = mapping.exposure_id
                     WHERE mapping.household_id = position.household_id
                       AND mapping.position_id = position.id
                       AND mapping.status = 'active'
                       AND canonical.company_id IS NOT NULL
                       AND NOT EXISTS (
                         SELECT 1
                         FROM holding_position_exposure_mappings later
                         WHERE later.supersedes_mapping_id = mapping.id
                       )
                     HAVING COUNT(DISTINCT canonical.company_id) = 1
                   ),
                   (
                     SELECT MAX(exposure.company_id)
                     FROM holding_position_exposures exposure
                     WHERE exposure.position_id = position.id
                     HAVING COUNT(*) = 1
                       AND COUNT(exposure.company_id) = 1
                   )
                 ) AS company_id,
                 position.legal_vehicle_name AS position_name,
                 COALESCE(
                   (
                     SELECT MAX(canonical.canonical_name)
                     FROM holding_position_exposure_mappings mapping
                     JOIN canonical_exposures canonical
                       ON canonical.id = mapping.exposure_id
                     WHERE mapping.household_id = position.household_id
                       AND mapping.position_id = position.id
                       AND mapping.status = 'active'
                       AND canonical.company_id IS NOT NULL
                       AND NOT EXISTS (
                         SELECT 1
                         FROM holding_position_exposure_mappings later
                         WHERE later.supersedes_mapping_id = mapping.id
                       )
                     HAVING COUNT(DISTINCT canonical.company_id) = 1
                   ),
                   (
                     SELECT exposure.exposure_label
                     FROM holding_position_exposures exposure
                     WHERE exposure.position_id = position.id
                     ORDER BY exposure.created_at, exposure.id
                     LIMIT 1
                   )
                 ) AS exposure_name,
                 position.owner_label,
                 position.position_kind,
                 snapshot.unrealized_value_minor AS administrator_nav_minor,
                 CASE snapshot.unrealized_value_state
                   WHEN 'reported' THEN 'reported'
                   WHEN 'locked' THEN 'locked'
                   ELSE 'not_set'
                 END AS administrator_nav_state,
                 adjustment.value_minor AS external_mark_minor,
                 NULL AS underwriting_value_minor,
                 NULL AS scenario_value_minor,
                 NULL AS usable_liquidity_minor,
                 CASE
                   WHEN julianday('now') - julianday(
                     COALESCE(document.effective_date, document.retrieved_at)
                   ) > 90
                     THEN 'review_due'
                   ELSE 'verified'
                 END AS source_status,
                 CASE position.provider
                   WHEN 'plaid_investments' THEN 'Plaid Investments'
                   WHEN 'tokenfolio' THEN 'Tokenfolio template'
                   WHEN 'sydecar' THEN 'Sydecar template'
                   ELSE 'AngelList export'
                 END AS source_label,
                 COALESCE(
                   document.effective_date,
                   substr(document.retrieved_at, 1, 10)
                 ) AS effective_date,
                 document.retrieved_at,
                 NULL AS confidence_ppm,
                 snapshot.ticker,
                 snapshot.quantity_micros,
                 snapshot.cost_basis_minor,
                 snapshot.invested_minor,
                 snapshot.allocation_minor AS committed_minor,
                 snapshot.realized_value_minor,
                 snapshot.instrument_type,
                 snapshot.id AS position_snapshot_id,
                 snapshot.currency AS position_currency,
                 snapshot.unrealized_value_state AS position_provider_value_state,
                 snapshot.unrealized_value_minor AS position_provider_value_minor,
                 adjustment.id AS adjustment_id,
                 adjustment.snapshot_id AS adjustment_snapshot_id,
                 adjustment.prior_value_state AS adjustment_prior_value_state,
                 adjustment.prior_value_minor AS adjustment_prior_value_minor,
                 adjustment.value_minor AS adjustment_value_minor,
                 adjustment.currency AS adjustment_currency,
                 adjustment.effective_date AS adjustment_effective_date,
                 adjustment.source_kind AS adjustment_source_kind,
                 adjustment.source_label AS adjustment_source_label,
                 adjustment.source_url AS adjustment_source_url,
                 adjustment.commentary AS adjustment_commentary,
                 adjustment_review.decided_at AS adjustment_accepted_at,
                 economics.id AS economics_id,
                 economics.snapshot_id AS economics_snapshot_id,
                 economics.commitment_minor AS economics_commitment_minor,
                 economics.funded_minor AS economics_funded_minor,
                 economics.capital_basis AS economics_capital_basis,
                 economics.gross_commitment_minor AS economics_gross_commitment_minor,
                 economics.setup_fee_ppm AS economics_setup_fee_ppm,
                 economics.annual_admin_fee_ppm
                   AS economics_annual_admin_fee_ppm,
                 economics.admin_fee_years AS economics_admin_fee_years,
                 economics.carry_ppm AS economics_carry_ppm,
                 economics.note AS economics_note,
                 economics_review.decided_at AS economics_accepted_at,
                 economics_evidence.management_fee_ppm
                   AS reported_management_fee_ppm,
                 economics_evidence.carry_ppm AS reported_carry_ppm
               FROM holding_positions position
               JOIN holding_position_snapshots snapshot
                 ON snapshot.id = (
                   SELECT latest.id
                   FROM holding_position_snapshots latest
                   WHERE latest.position_id = position.id
                   ORDER BY latest.observed_at DESC, latest.created_at DESC
                   LIMIT 1
                 )
               JOIN holding_import_applications latest_application
                 ON latest_application.id = (
                   SELECT application.id
                   FROM holding_import_applications application
                   WHERE application.position_id = position.id
                     AND application.snapshot_id = snapshot.id
                   ORDER BY application.applied_at DESC, application.id DESC
                   LIMIT 1
                 )
               JOIN holding_import_rows latest_row
                 ON latest_row.id = latest_application.import_row_id
               LEFT JOIN holding_import_row_reported_economics_evidence
                 economics_evidence
                 ON economics_evidence.import_row_id = latest_row.id
               JOIN holding_imports latest_import
                 ON latest_import.id = latest_row.import_id
               JOIN source_documents document
                 ON document.id = latest_import.source_document_id
               LEFT JOIN holding_position_value_proposals adjustment
                 ON adjustment.id = (
                   SELECT proposal.id
                   FROM holding_position_value_proposals proposal
                   JOIN holding_position_value_reviews review
                     ON review.proposal_id = proposal.id
                    AND review.decision = 'accepted'
                   WHERE proposal.position_id = position.id
                     AND proposal.household_id = position.household_id
                     AND NOT EXISTS (
                       SELECT 1
                       FROM holding_position_value_proposals later
                       JOIN holding_position_value_reviews later_review
                         ON later_review.proposal_id = later.id
                        AND later_review.decision = 'accepted'
                       WHERE later.supersedes_proposal_id = proposal.id
                     )
                   ORDER BY review.decided_at DESC, proposal.id DESC
                   LIMIT 1
                 )
               LEFT JOIN holding_position_value_reviews adjustment_review
                 ON adjustment_review.proposal_id = adjustment.id
                AND adjustment_review.decision = 'accepted'
               LEFT JOIN holding_position_economics_proposals economics
                 ON economics.id = (
                   SELECT proposal.id
                   FROM holding_position_economics_proposals proposal
                   JOIN holding_position_economics_reviews review
                     ON review.proposal_id = proposal.id
                    AND review.decision = 'accepted'
                   WHERE proposal.position_id = position.id
                     AND proposal.household_id = position.household_id
                     AND NOT EXISTS (
                       SELECT 1
                       FROM holding_position_economics_proposals later
                       JOIN holding_position_economics_reviews later_review
                         ON later_review.proposal_id = later.id
                        AND later_review.decision = 'accepted'
                       WHERE later.supersedes_proposal_id = proposal.id
                     )
                   ORDER BY review.decided_at DESC, proposal.id DESC
                   LIMIT 1
                 )
               LEFT JOIN holding_position_economics_reviews economics_review
                 ON economics_review.proposal_id = economics.id
                AND economics_review.decision = 'accepted'
               WHERE position.household_id = ?
             ) holdings
             ORDER BY exposure_name, position_name`,
          )
          .bind(householdId, householdId),
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
                public_observation.model_confidence_ppm,
                document.source_label,
                event.prior_value_json,
                event.replacement_value_json,
                event.estimated_forecast_impact_minor,
                (
                  SELECT claim.field_path
                  FROM evidence_claims claim
                  WHERE claim.evidence_event_id = event.id
                    AND claim.household_id = event.household_id
                  ORDER BY claim.created_at
                  LIMIT 1
                ) AS claim_field_path,
                (
                  SELECT claim.claim_value_json
                  FROM evidence_claims claim
                  WHERE claim.evidence_event_id = event.id
                    AND claim.household_id = event.household_id
                    AND claim.field_path = 'company_event.financing_terms'
                  ORDER BY claim.created_at
                  LIMIT 1
                ) AS claim_value_json,
                public_observation.source_url AS public_source_url,
                public_observation.observed_fact AS public_observed_fact,
                (
                  SELECT application.applied_at
                  FROM evidence_applications application
                  WHERE application.evidence_event_id = event.id
                  LIMIT 1
                ) AS application_applied_at
              FROM evidence_events event
              JOIN companies company ON company.id = event.company_id
              JOIN source_documents document ON document.id = event.source_document_id
              LEFT JOIN public_source_observations public_observation
                ON public_observation.evidence_event_id = event.id
                AND public_observation.household_id = event.household_id
                AND public_observation.company_id = event.company_id
              WHERE event.household_id = ?
              ORDER BY
                CASE event.status WHEN 'pending_review' THEN 0 ELSE 1 END,
                event.detected_at DESC`,
          )
          .bind(householdId),
      ),
      all<PortfolioWatchTargetRow>(
        this.db.prepare(PORTFOLIO_WATCH_TARGETS_SQL).bind(householdId),
      ),
      this.getPublicSourceObservationRows(householdId),
      all<ScenarioRow>(
        this.db
          .prepare(
            `SELECT
                scenario.id,
                scenario.name,
                scenario.description,
                scenario.is_sandbox,
                snapshot.id AS latest_snapshot_id,
                snapshot.version AS latest_snapshot_version,
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
              FROM scenarios scenario
              JOIN forecast_snapshots snapshot
                ON snapshot.scenario_id = scenario.id
                AND snapshot.version = (
                  SELECT MAX(newest.version)
                  FROM forecast_snapshots newest
                  WHERE newest.scenario_id = scenario.id
                )
              JOIN liquidity_curves curve
                ON curve.forecast_snapshot_id = snapshot.id
              WHERE scenario.household_id = ?
                AND curve.household_id = scenario.household_id
              ORDER BY curve.scenario_id, curve.year`,
          )
          .bind(householdId),
      ),
      this.getSignalUpdateProposalRows(householdId),
      this.getSignalUpdateProposalEvidenceRows(householdId),
    ]);

    const observations = publicObservations.map(publicSourceObservationFromRow);
    const signalReconciliations =
      await createSignalReconciliationGroups(observations);
    const reconciliationById = new Map(
      signalReconciliations.map((group) => [group.id, group]),
    );
    const evidenceIdsByProposal = new Map<string, string[]>();
    signalUpdateProposalEvidenceRows.forEach((row) => {
      evidenceIdsByProposal.set(row.proposal_id, [
        ...(evidenceIdsByProposal.get(row.proposal_id) ?? []),
        row.evidence_event_id,
      ]);
    });
    const signalUpdateProposals = signalUpdateProposalRows.map((row) =>
      SignalUpdateProposalSchema.parse({
        id: row.id,
        groupId: row.reconciliation_group_id,
        reconciliationRevision: row.reconciliation_revision,
        companyId: row.company_id,
        companyName: row.company_name,
        scenarioId: row.scenario_id,
        scenarioName: row.scenario_name,
        baseForecastSnapshotId: row.base_forecast_snapshot_id,
        baseForecastSnapshotVersion: row.base_forecast_snapshot_version,
        evidenceEventIds: (evidenceIdsByProposal.get(row.id) ?? []).sort(),
        proposedCompanyValuation: parseProposedCompanyValuation(
          row.proposed_company_valuation_json,
        ),
        rationale: row.rationale,
        createdAt: row.created_at,
        createdBy: row.created_by,
        isCurrent:
          reconciliationById.get(row.reconciliation_group_id)?.revision ===
            row.reconciliation_revision &&
          row.current_snapshot_id === row.base_forecast_snapshot_id,
      }),
    );
    const history = await this.getHistory(householdId);

    return AlphaDataSchema.parse({
      dashboard,
      goals,
      holdings: holdings.map((row) => ({
        id: row.id,
        companyId: row.company_id,
        positionName: row.position_name,
        exposureName: row.exposure_name,
        ownerLabel: row.owner_label,
        positionKind: row.position_kind,
        administratorNavMinor: row.administrator_nav_minor,
        administratorNavState: row.administrator_nav_state,
        externalMarkMinor: row.external_mark_minor,
        underwritingValueMinor: row.underwriting_value_minor,
        scenarioValueMinor: row.scenario_value_minor,
        usableLiquidityMinor: row.usable_liquidity_minor,
        sourceStatus: row.source_status,
        sourceLabel: row.source_label,
        effectiveDate: row.effective_date,
        retrievedAt: row.retrieved_at,
        confidencePpm: row.confidence_ppm,
        ticker: row.ticker,
        quantityMicros: row.quantity_micros,
        costBasisMinor: row.cost_basis_minor,
        investedMinor: row.invested_minor,
        committedMinor: row.committed_minor,
        realizedValueMinor: row.realized_value_minor,
        instrumentType: row.instrument_type,
        positionEconomicsContext:
          row.position_snapshot_id === null ||
          row.position_kind !== "spv_interest" ||
          row.committed_minor === null ||
          row.committed_minor <= 0 ||
          row.invested_minor === null
            ? undefined
            : {
                snapshotId: row.position_snapshot_id,
                currency: row.position_currency,
                committedMinor: row.committed_minor,
                fundedMinor: row.invested_minor,
                reportedTerms:
                  row.reported_management_fee_ppm === null &&
                  row.reported_carry_ppm === null
                    ? null
                    : {
                        managementFeePpm: row.reported_management_fee_ppm,
                        carryPpm: row.reported_carry_ppm,
                        sourceLabel: row.source_label,
                        observedAt: row.retrieved_at,
                      },
                acceptedTerms:
                  row.economics_id === null
                    ? null
                    : {
                        id: row.economics_id,
                        positionId: row.id,
                        acceptedAgainstSnapshotId: row.economics_snapshot_id,
                        commitmentMinorAtAcceptance:
                          row.economics_commitment_minor,
                        fundedMinorAtAcceptance: row.economics_funded_minor,
                        capitalBasis: row.economics_capital_basis,
                        grossCommitmentMinor:
                          row.economics_gross_commitment_minor,
                        setupFeePpm: row.economics_setup_fee_ppm,
                        annualAdminFeePpm: row.economics_annual_admin_fee_ppm,
                        adminFeeYears: row.economics_admin_fee_years,
                        carryPpm: row.economics_carry_ppm,
                        note: row.economics_note,
                        acceptedAt: row.economics_accepted_at,
                      },
              },
        positionValueContext:
          row.position_snapshot_id === null
            ? undefined
            : {
                snapshotId: row.position_snapshot_id,
                currency: row.position_currency,
                providerValueState: row.position_provider_value_state,
                providerValueMinor: row.position_provider_value_minor,
                acceptedAdjustment:
                  row.adjustment_id === null
                    ? null
                    : {
                        id: row.adjustment_id,
                        positionId: row.id,
                        snapshotId: row.adjustment_snapshot_id,
                        priorValueState: row.adjustment_prior_value_state,
                        priorValueMinor: row.adjustment_prior_value_minor,
                        valueMinor: row.adjustment_value_minor,
                        currency: row.adjustment_currency,
                        effectiveDate: row.adjustment_effective_date,
                        sourceKind: row.adjustment_source_kind,
                        sourceLabel: row.adjustment_source_label,
                        sourceUrl: row.adjustment_source_url,
                        commentary: row.adjustment_commentary,
                        acceptedAt: row.adjustment_accepted_at,
                      },
              },
      })),
      evidenceInbox: evidence.map((row) => {
        const financingFacts = financingFactsFromClaim(row.claim_value_json);
        const hasPublicFinancingSource =
          financingFacts !== null &&
          row.public_source_url !== null &&
          row.public_observed_fact !== null;
        const excerptCandidate =
          financingFacts?.announcedAmount?.evidenceText ??
          financingFacts?.companyValuation?.evidenceText ??
          row.public_observed_fact;
        const application =
          row.claim_value_json === null
            ? getDirectEvidenceApplication(row.claim_field_path)
            : null;
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
          sourceUrl: hasPublicFinancingSource ? row.public_source_url : null,
          sourceExcerpt:
            hasPublicFinancingSource && excerptCandidate !== null
              ? boundedSourceExcerpt(excerptCandidate)
              : null,
          priorValue: displayJsonValue(row.prior_value_json),
          replacementValue: displayJsonValue(row.replacement_value_json),
          forecastImpactMinor: row.estimated_forecast_impact_minor,
          financingFacts,
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
          coverageStatus: row.coverage_status,
          lastCheckedAt: row.last_checked_at,
          latestObservationAt: row.latest_observation_at,
        })),
        observations,
      },
      signalReconciliations,
      signalUpdateProposals,
      scenarios: scenarioRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        isSandbox: Boolean(row.is_sandbox),
        latestSnapshotId: row.latest_snapshot_id,
        latestSnapshotVersion: row.latest_snapshot_version,
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

  public async preparePortfolioWatchScan(
    accessSubject: string,
  ): Promise<PortfolioWatchScanPreparation> {
    const identity = await this.findIdentity(accessSubject);
    return new D1PortfolioWatchRepository(this.db).prepareScan(
      identity.household_id,
    );
  }

  public async stageHoldingImport(
    accessSubject: string,
    input: HoldingImportStageInput,
  ): Promise<HoldingImportStageResult> {
    return new D1HoldingImportRepository(this.db).stageHoldingImport(
      accessSubject,
      input,
    );
  }

  public async getHoldingImport(
    accessSubject: string,
    importId: string,
  ): Promise<HoldingImportPreview> {
    return new D1HoldingImportRepository(this.db).getHoldingImport(
      accessSubject,
      importId,
    );
  }

  public async reconcileHoldingImport(
    accessSubject: string,
    importId: string,
  ): Promise<HoldingImportPreview> {
    const preview = await new D1HoldingImportRepository(
      this.db,
    ).autoAdjudicatePrivateHoldingImport(accessSubject, importId);
    await refreshAcceptedPortfolioBaseline(
      new D1PortfolioBaselineRepository(this.db),
      accessSubject,
    );
    return preview;
  }

  public async listPendingHoldingImports(
    accessSubject: string,
  ): Promise<HoldingImportSummary[]> {
    return new D1HoldingImportRepository(this.db).listPendingHoldingImports(
      accessSubject,
    );
  }

  public async applyHoldingImport(
    accessSubject: string,
    importId: string,
    input: HoldingImportApplyInput,
  ): Promise<HoldingImportApplyResult> {
    return new D1HoldingImportRepository(this.db).applyHoldingImport(
      accessSubject,
      importId,
      input,
    );
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
      latestSnapshotId: scenario.latest_snapshot_id,
      latestSnapshotVersion: scenario.latest_version,
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

  public async createSignalUpdateProposal(
    accessSubject: string,
    rawInput: CreateSignalUpdateProposalInput,
  ): Promise<SignalUpdateProposal> {
    const input = CreateSignalUpdateProposalInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const [observationRows, scenario] = await Promise.all([
      this.getPublicSourceObservationRows(identity.household_id),
      this.db
        .prepare(
          `SELECT
            scenario.id,
            scenario.name,
            snapshot.id AS latest_snapshot_id,
            snapshot.version AS latest_snapshot_version
          FROM scenarios scenario
          LEFT JOIN forecast_snapshots snapshot
            ON snapshot.scenario_id = scenario.id
            AND snapshot.version = (
              SELECT MAX(newest.version)
              FROM forecast_snapshots newest
              WHERE newest.scenario_id = scenario.id
            )
          WHERE scenario.id = ?
            AND scenario.household_id = ?
            AND scenario.archived_at IS NULL`,
        )
        .bind(input.scenarioId, identity.household_id)
        .first<SignalUpdateProposalScenarioRow>(),
    ]);

    if (scenario === null || scenario.latest_snapshot_id === null) {
      throw new Error("Scenario not found for signal update proposal.");
    }
    if (
      scenario.latest_snapshot_id !== input.baseForecastSnapshotId ||
      scenario.latest_snapshot_version === null
    ) {
      throw new Error("Signal update proposal base scenario is stale.");
    }

    const groups = await createSignalReconciliationGroups(
      observationRows.map(publicSourceObservationFromRow),
    );
    const group = groups.find((candidate) => candidate.id === input.groupId);
    if (group === undefined) {
      throw new Error("Signal reconciliation group not found.");
    }
    if (group.revision !== input.reconciliationRevision) {
      throw new Error("Signal reconciliation is stale.");
    }
    if (!group.canCreateProposal || group.proposedCompanyValuation === null) {
      throw new Error("Signal reconciliation is not ready for a proposal.");
    }

    const evidenceEventIds = group.reports
      .filter(
        (report) =>
          report.relationship !== "superseded" &&
          (report.evidenceStatus === "accepted" ||
            report.evidenceStatus === "scenario_only"),
      )
      .map((report) => report.evidenceEventId)
      .sort();
    if (evidenceEventIds.length === 0) {
      throw new Error("Signal reconciliation is not ready for a proposal.");
    }

    const proposalId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO signal_update_proposals (
            id,
            household_id,
            company_id,
            reconciliation_group_id,
            reconciliation_revision,
            scenario_id,
            base_forecast_snapshot_id,
            base_forecast_snapshot_version,
            proposed_company_valuation_json,
            rationale,
            created_at,
            created_by_user_id,
            immutable
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          proposalId,
          identity.household_id,
          group.companyId,
          group.id,
          group.revision,
          scenario.id,
          scenario.latest_snapshot_id,
          scenario.latest_snapshot_version,
          JSON.stringify(group.proposedCompanyValuation),
          input.rationale,
          createdAt,
          identity.user_id,
        ),
      ...evidenceEventIds.map((eventId) =>
        this.db
          .prepare(
            `INSERT INTO signal_update_proposal_evidence (
              proposal_id,
              household_id,
              evidence_event_id,
              created_at
            ) VALUES (?, ?, ?, ?)`,
          )
          .bind(proposalId, identity.household_id, eventId, createdAt),
      ),
    ]);

    return SignalUpdateProposalSchema.parse({
      id: proposalId,
      groupId: group.id,
      reconciliationRevision: group.revision,
      companyId: group.companyId,
      companyName: group.companyName,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      baseForecastSnapshotId: scenario.latest_snapshot_id,
      baseForecastSnapshotVersion: scenario.latest_snapshot_version,
      evidenceEventIds,
      proposedCompanyValuation: group.proposedCompanyValuation,
      rationale: input.rationale,
      createdAt,
      createdBy: identity.display_name,
      isCurrent: true,
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
              AND claim.household_id = event.household_id
            ORDER BY claim.created_at
            LIMIT 1
          ) AS claim_field_path,
          EXISTS (
            SELECT 1
            FROM evidence_claims claim
            WHERE claim.evidence_event_id = event.id
              AND claim.field_path = 'company_event.financing_terms'
          ) AS has_financing_terms_claim,
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

    const application =
      event.has_financing_terms_claim !== 0
        ? null
        : getDirectEvidenceApplication(event.claim_field_path);
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

  private async getPublicSourceObservationRows(
    householdId: string,
  ): Promise<readonly PublicSourceObservationRow[]> {
    return all<PublicSourceObservationRow>(
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
              (
                SELECT claim.claim_value_json
                FROM evidence_claims claim
                WHERE claim.evidence_event_id = observation.evidence_event_id
                  AND claim.household_id = observation.household_id
                  AND claim.field_path = 'company_event.financing_terms'
                ORDER BY claim.created_at
                LIMIT 1
              ) AS claim_value_json,
              observation.limitations
            FROM public_source_observations observation
            JOIN companies company ON company.id = observation.company_id
            JOIN evidence_events event ON event.id = observation.evidence_event_id
            WHERE observation.household_id = ?
            ORDER BY observation.retrieved_at DESC`,
        )
        .bind(householdId),
    );
  }

  private async getSignalUpdateProposalRows(
    householdId: string,
  ): Promise<readonly SignalUpdateProposalRow[]> {
    return all<SignalUpdateProposalRow>(
      this.db
        .prepare(
          `SELECT
              proposal.id,
              proposal.household_id,
              proposal.company_id,
              company.legal_name AS company_name,
              proposal.reconciliation_group_id,
              proposal.reconciliation_revision,
              proposal.scenario_id,
              scenario.name AS scenario_name,
              proposal.base_forecast_snapshot_id,
              proposal.base_forecast_snapshot_version,
              proposal.proposed_company_valuation_json,
              proposal.rationale,
              proposal.created_at,
              user.display_name AS created_by,
              (
                SELECT snapshot.id
                FROM forecast_snapshots snapshot
                WHERE snapshot.scenario_id = proposal.scenario_id
                ORDER BY snapshot.version DESC
                LIMIT 1
              ) AS current_snapshot_id
            FROM signal_update_proposals proposal
            JOIN companies company ON company.id = proposal.company_id
            JOIN scenarios scenario ON scenario.id = proposal.scenario_id
            JOIN users user ON user.id = proposal.created_by_user_id
            WHERE proposal.household_id = ?
            ORDER BY proposal.created_at DESC`,
        )
        .bind(householdId),
    );
  }

  private async getSignalUpdateProposalEvidenceRows(
    householdId: string,
  ): Promise<readonly SignalUpdateProposalEvidenceRow[]> {
    return all<SignalUpdateProposalEvidenceRow>(
      this.db
        .prepare(
          `SELECT evidence.proposal_id, evidence.evidence_event_id
           FROM signal_update_proposal_evidence evidence
           JOIN signal_update_proposals proposal
             ON proposal.id = evidence.proposal_id
           WHERE evidence.household_id = ?
             AND proposal.household_id = evidence.household_id
           ORDER BY evidence.proposal_id, evidence.evidence_event_id`,
        )
        .bind(householdId),
    );
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
          substr(plan.effective_date, 1, 10) AS as_of_date,
          p50.horizon_date AS forecast_horizon_date,
          household.name AS household_name,
          plan.fi_eligible_liquid_minor,
          CASE
            WHEN plan.household_burn_monthly_minor
                   + plan.business_burn_monthly_minor = 0
              THEN 0
            ELSE CAST(
              MAX(
                plan.fi_eligible_liquid_minor
                  - plan.protected_cash_floor_minor,
                0
              ) / (
                plan.household_burn_monthly_minor
                  + plan.business_burn_monthly_minor
              ) AS INTEGER
            )
          END AS protected_runway_months,
          plan.protected_cash_floor_minor,
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
      protectedCashFloorMinor: row.protected_cash_floor_minor,
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

export const __alphaRepositoryTest = {
  portfolioWatchTargetsSql: PORTFOLIO_WATCH_TARGETS_SQL,
};

export * from "./schema";
