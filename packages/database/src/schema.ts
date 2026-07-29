import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = (name: string) => text(name).primaryKey();
const timestamp = (name: string) => text(name).notNull();
const householdReference = () =>
  text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "restrict" });

export const users = sqliteTable(
  "users",
  {
    id: id("id"),
    accessSubject: text("access_subject").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("users_access_subject_unique").on(table.accessSubject),
    uniqueIndex("users_email_unique").on(table.email),
  ],
);

export const households = sqliteTable(
  "households",
  {
    id: id("id"),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    baseCurrency: text("base_currency").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("households_owner_user_idx").on(table.ownerUserId),
    uniqueIndex("households_owner_name_unique").on(
      table.ownerUserId,
      table.name,
    ),
  ],
);

export const companies = sqliteTable(
  "companies",
  {
    id: id("id"),
    householdId: householdReference(),
    legalName: text("legal_name").notNull(),
    websiteHost: text("website_host"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("companies_household_idx").on(table.householdId),
    uniqueIndex("companies_household_name_unique").on(
      table.householdId,
      table.legalName,
    ),
  ],
);

export const assetAccounts = sqliteTable(
  "asset_accounts",
  {
    id: id("id"),
    householdId: householdReference(),
    name: text("name").notNull(),
    accountType: text("account_type").notNull(),
    administratorLabel: text("administrator_label"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("asset_accounts_household_idx").on(table.householdId),
    uniqueIndex("asset_accounts_household_name_unique").on(
      table.householdId,
      table.name,
    ),
  ],
);

export const privateVehicles = sqliteTable(
  "private_vehicles",
  {
    id: id("id"),
    householdId: householdReference(),
    name: text("name").notNull(),
    vehicleType: text("vehicle_type").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("private_vehicles_household_idx").on(table.householdId),
    uniqueIndex("private_vehicles_household_name_unique").on(
      table.householdId,
      table.name,
    ),
  ],
);

export const assetLots = sqliteTable(
  "asset_lots",
  {
    id: id("id"),
    householdId: householdReference(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    assetAccountId: text("asset_account_id")
      .notNull()
      .references(() => assetAccounts.id, { onDelete: "restrict" }),
    privateVehicleId: text("private_vehicle_id").references(
      () => privateVehicles.id,
      { onDelete: "restrict" },
    ),
    lotLabel: text("lot_label").notNull(),
    securityType: text("security_type").notNull(),
    quantityScaled: integer("quantity_scaled").notNull(),
    quantityScale: integer("quantity_scale").notNull(),
    acquisitionDate: text("acquisition_date").notNull(),
    costBasisMinor: integer("cost_basis_minor").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("asset_lots_household_company_idx").on(
      table.householdId,
      table.companyId,
    ),
    uniqueIndex("asset_lots_account_label_unique").on(
      table.assetAccountId,
      table.lotLabel,
    ),
    check("asset_lots_quantity_scale_check", sql`${table.quantityScale} >= 0`),
    check("asset_lots_cost_basis_check", sql`${table.costBasisMinor} >= 0`),
  ],
);

export const markSources = sqliteTable(
  "mark_sources",
  {
    id: id("id"),
    householdId: householdReference(),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    confidencePpm: integer("confidence_ppm").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("mark_sources_household_idx").on(table.householdId),
    check(
      "mark_sources_confidence_check",
      sql`${table.confidencePpm} BETWEEN 0 AND 1000000`,
    ),
  ],
);

export const marks = sqliteTable(
  "marks",
  {
    id: id("id"),
    householdId: householdReference(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    assetLotId: text("asset_lot_id").references(() => assetLots.id, {
      onDelete: "restrict",
    }),
    markSourceId: text("mark_source_id")
      .notNull()
      .references(() => markSources.id, { onDelete: "restrict" }),
    markKind: text("mark_kind").notNull(),
    valueMinor: integer("value_minor").notNull(),
    currency: text("currency").notNull(),
    effectiveAt: timestamp("effective_at"),
    retrievedAt: timestamp("retrieved_at"),
    reviewStatus: text("review_status").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("marks_household_company_kind_idx").on(
      table.householdId,
      table.companyId,
      table.markKind,
    ),
    uniqueIndex("marks_lot_kind_effective_unique").on(
      table.assetLotId,
      table.markKind,
      table.effectiveAt,
    ),
    check("marks_value_check", sql`${table.valueMinor} >= 0`),
  ],
);

export const sourceDocuments = sqliteTable(
  "source_documents",
  {
    id: id("id"),
    householdId: householdReference(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    effectiveDate: text("effective_date"),
    retrievedAt: timestamp("retrieved_at"),
    sourceLabel: text("source_label").notNull(),
    reviewStatus: text("review_status").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("source_documents_household_idx").on(table.householdId),
    uniqueIndex("source_documents_household_hash_unique").on(
      table.householdId,
      table.sha256,
    ),
    check("source_documents_byte_size_check", sql`${table.byteSize} > 0`),
  ],
);

export const evidenceEvents = sqliteTable(
  "evidence_events",
  {
    id: id("id"),
    householdId: householdReference(),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "restrict",
    }),
    sourceDocumentId: text("source_document_id").references(
      () => sourceDocuments.id,
      { onDelete: "restrict" },
    ),
    eventType: text("event_type").notNull(),
    headline: text("headline").notNull(),
    effectiveDate: text("effective_date").notNull(),
    detectedAt: timestamp("detected_at"),
    retrievedAt: timestamp("retrieved_at"),
    status: text("status").notNull(),
    confidencePpm: integer("confidence_ppm").notNull(),
    priorValueJson: text("prior_value_json"),
    replacementValueJson: text("replacement_value_json"),
    estimatedForecastImpactMinor: integer(
      "estimated_forecast_impact_minor",
    ).notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("evidence_events_household_status_idx").on(
      table.householdId,
      table.status,
      table.detectedAt,
    ),
    check(
      "evidence_events_confidence_check",
      sql`${table.confidencePpm} BETWEEN 0 AND 1000000`,
    ),
    check(
      "evidence_events_accepted_values_check",
      sql`${table.status} <> 'accepted' OR (${table.priorValueJson} IS NOT NULL AND ${table.replacementValueJson} IS NOT NULL)`,
    ),
  ],
);

export const evidenceClaims = sqliteTable(
  "evidence_claims",
  {
    id: id("id"),
    householdId: householdReference(),
    evidenceEventId: text("evidence_event_id")
      .notNull()
      .references(() => evidenceEvents.id, { onDelete: "restrict" }),
    fieldPath: text("field_path").notNull(),
    claimValueJson: text("claim_value_json").notNull(),
    unit: text("unit"),
    provenance: text("provenance").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("evidence_claims_event_idx").on(table.evidenceEventId),
    uniqueIndex("evidence_claims_event_field_unique").on(
      table.evidenceEventId,
      table.fieldPath,
    ),
  ],
);

export const reviewDecisions = sqliteTable(
  "review_decisions",
  {
    id: id("id"),
    householdId: householdReference(),
    evidenceEventId: text("evidence_event_id")
      .notNull()
      .references(() => evidenceEvents.id, { onDelete: "restrict" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    priorValueJson: text("prior_value_json").notNull(),
    replacementValueJson: text("replacement_value_json").notNull(),
    decidedAt: timestamp("decided_at"),
  },
  (table) => [
    uniqueIndex("review_decisions_event_unique").on(table.evidenceEventId),
    index("review_decisions_household_idx").on(table.householdId),
  ],
);

export const scenarios = sqliteTable(
  "scenarios",
  {
    id: id("id"),
    householdId: householdReference(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    isSandbox: integer("is_sandbox", { mode: "boolean" }).notNull(),
    archivedAt: text("archived_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("scenarios_household_idx").on(table.householdId),
    uniqueIndex("scenarios_household_name_unique").on(
      table.householdId,
      table.name,
    ),
  ],
);

export const scenarioAssumptions = sqliteTable(
  "scenario_assumptions",
  {
    id: id("id"),
    householdId: householdReference(),
    scenarioId: text("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "restrict" }),
    assumptionKey: text("assumption_key").notNull(),
    label: text("label").notNull(),
    valueInteger: integer("value_integer").notNull(),
    valueScale: integer("value_scale").notNull(),
    unit: text("unit").notNull(),
    provenance: text("provenance").notNull(),
    effectiveDate: text("effective_date").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("scenario_assumptions_household_scenario_idx").on(
      table.householdId,
      table.scenarioId,
    ),
    uniqueIndex("scenario_assumptions_version_unique").on(
      table.scenarioId,
      table.assumptionKey,
      table.effectiveDate,
    ),
    check("scenario_assumptions_scale_check", sql`${table.valueScale} >= 0`),
  ],
);

export const taxProfiles = sqliteTable(
  "tax_profiles",
  {
    id: id("id"),
    householdId: householdReference(),
    name: text("name").notNull(),
    assumedTaxRatePpm: integer("assumed_tax_rate_ppm").notNull(),
    effectiveDate: text("effective_date").notNull(),
    provenance: text("provenance").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("tax_profiles_household_idx").on(table.householdId),
    check(
      "tax_profiles_rate_check",
      sql`${table.assumedTaxRatePpm} BETWEEN 0 AND 1000000`,
    ),
  ],
);

export const cashFlowPlans = sqliteTable(
  "cash_flow_plans",
  {
    id: id("id"),
    householdId: householdReference(),
    scenarioId: text("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "restrict" }),
    householdBurnMonthlyMinor: integer(
      "household_burn_monthly_minor",
    ).notNull(),
    businessBurnMonthlyMinor: integer("business_burn_monthly_minor").notNull(),
    fiEligibleLiquidMinor: integer("fi_eligible_liquid_minor").notNull(),
    protectedCashFloorMinor: integer("protected_cash_floor_minor").notNull(),
    fiTargetMinor: integer("fi_target_minor").notNull(),
    effectiveDate: text("effective_date").notNull(),
    provenance: text("provenance").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("cash_flow_plans_household_scenario_idx").on(
      table.householdId,
      table.scenarioId,
      table.effectiveDate,
    ),
    uniqueIndex("cash_flow_plans_version_unique").on(
      table.scenarioId,
      table.effectiveDate,
    ),
    check(
      "cash_flow_plans_nonnegative_check",
      sql`${table.householdBurnMonthlyMinor} >= 0 AND ${table.businessBurnMonthlyMinor} >= 0 AND ${table.fiEligibleLiquidMinor} >= 0 AND ${table.protectedCashFloorMinor} >= 0 AND ${table.fiTargetMinor} >= 0`,
    ),
  ],
);

export const forecastSnapshots = sqliteTable(
  "forecast_snapshots",
  {
    id: id("id"),
    householdId: householdReference(),
    scenarioId: text("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    inputHash: text("input_hash").notNull(),
    createdAt: timestamp("created_at"),
    createdBy: text("created_by").notNull(),
    trigger: text("trigger").notNull(),
    attributedChange: text("attributed_change").notNull(),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("forecast_snapshots_household_created_idx").on(
      table.householdId,
      table.createdAt,
    ),
    uniqueIndex("forecast_snapshots_scenario_version_unique").on(
      table.scenarioId,
      table.version,
    ),
    uniqueIndex("forecast_snapshots_input_hash_unique").on(table.inputHash),
    check("forecast_snapshots_immutable_check", sql`${table.immutable} = 1`),
  ],
);

export const companyForecasts = sqliteTable(
  "company_forecasts",
  {
    id: id("id"),
    householdId: householdReference(),
    forecastSnapshotId: text("forecast_snapshot_id")
      .notNull()
      .references(() => forecastSnapshots.id, { onDelete: "restrict" }),
    scenarioId: text("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "restrict" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    conditionalValueMinor: integer("conditional_value_minor").notNull(),
    timingAdjustedLiquidityMinor: integer(
      "timing_adjusted_liquidity_minor",
    ).notNull(),
    probabilityZeroPpm: integer("probability_zero_ppm").notNull(),
    effectiveDate: text("effective_date").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("company_forecasts_snapshot_idx").on(table.forecastSnapshotId),
    uniqueIndex("company_forecasts_snapshot_company_unique").on(
      table.forecastSnapshotId,
      table.companyId,
    ),
    check(
      "company_forecasts_probability_check",
      sql`${table.probabilityZeroPpm} BETWEEN 0 AND 1000000`,
    ),
  ],
);

export const liquidityCurves = sqliteTable(
  "liquidity_curves",
  {
    id: id("id"),
    householdId: householdReference(),
    forecastSnapshotId: text("forecast_snapshot_id")
      .notNull()
      .references(() => forecastSnapshots.id, { onDelete: "restrict" }),
    scenarioId: text("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "restrict" }),
    year: integer("year").notNull(),
    p25Minor: integer("p25_minor").notNull(),
    p50Minor: integer("p50_minor").notNull(),
    p75Minor: integer("p75_minor").notNull(),
    expectedMinor: integer("expected_minor").notNull(),
    probabilityZeroPpm: integer("probability_zero_ppm").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("liquidity_curves_snapshot_year_unique").on(
      table.forecastSnapshotId,
      table.year,
    ),
    index("liquidity_curves_scenario_year_idx").on(
      table.scenarioId,
      table.year,
    ),
    check(
      "liquidity_curves_nonnegative_check",
      sql`${table.p25Minor} >= 0 AND ${table.p50Minor} >= 0 AND ${table.p75Minor} >= 0 AND ${table.expectedMinor} >= 0`,
    ),
    check(
      "liquidity_curves_probability_check",
      sql`${table.probabilityZeroPpm} BETWEEN 0 AND 1000000`,
    ),
  ],
);

export const forecastOutputs = sqliteTable(
  "forecast_outputs",
  {
    id: id("id"),
    householdId: householdReference(),
    forecastSnapshotId: text("forecast_snapshot_id")
      .notNull()
      .references(() => forecastSnapshots.id, { onDelete: "restrict" }),
    metricKey: text("metric_key").notNull(),
    horizonDate: text("horizon_date").notNull(),
    percentile: integer("percentile"),
    valueMinor: integer("value_minor"),
    probabilityPpm: integer("probability_ppm"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("forecast_outputs_snapshot_idx").on(table.forecastSnapshotId),
    uniqueIndex("forecast_outputs_metric_unique").on(
      table.forecastSnapshotId,
      table.metricKey,
      table.horizonDate,
      table.percentile,
    ),
  ],
);

export const actualLiquidityEvents = sqliteTable(
  "actual_liquidity_events",
  {
    id: id("id"),
    householdId: householdReference(),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "restrict",
    }),
    assetLotId: text("asset_lot_id").references(() => assetLots.id, {
      onDelete: "restrict",
    }),
    sourceDocumentId: text("source_document_id").references(
      () => sourceDocuments.id,
      { onDelete: "restrict" },
    ),
    eventType: text("event_type").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    occurredAt: timestamp("occurred_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("actual_liquidity_events_household_occurred_idx").on(
      table.householdId,
      table.occurredAt,
    ),
    check(
      "actual_liquidity_events_amount_check",
      sql`${table.amountMinor} >= 0`,
    ),
  ],
);

export const connectorAccounts = sqliteTable(
  "connector_accounts",
  {
    id: id("id"),
    householdId: householdReference(),
    connectorType: text("connector_type").notNull(),
    displayLabel: text("display_label").notNull(),
    secretReference: text("secret_reference").notNull(),
    status: text("status").notNull(),
    lastSyncedAt: text("last_synced_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("connector_accounts_household_idx").on(table.householdId),
    uniqueIndex("connector_accounts_household_label_unique").on(
      table.householdId,
      table.connectorType,
      table.displayLabel,
    ),
  ],
);

export const connectorSyncRuns = sqliteTable(
  "connector_sync_runs",
  {
    id: id("id"),
    householdId: householdReference(),
    connectorAccountId: text("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: text("finished_at"),
    cursor: text("cursor"),
    discoveredCount: integer("discovered_count").notNull(),
    proposedCount: integer("proposed_count").notNull(),
    errorCode: text("error_code"),
  },
  (table) => [
    index("connector_sync_runs_account_started_idx").on(
      table.connectorAccountId,
      table.startedAt,
    ),
    check(
      "connector_sync_runs_counts_check",
      sql`${table.discoveredCount} >= 0 AND ${table.proposedCount} >= 0`,
    ),
  ],
);
