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

export const goals = sqliteTable(
  "goals",
  {
    id: id("id"),
    householdId: householdReference(),
    templateKey: text("template_key").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull(),
    archivedAt: text("archived_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("goals_household_idx").on(table.householdId),
    uniqueIndex("goals_household_primary_unique")
      .on(table.householdId)
      .where(sql`${table.isPrimary} = 1`),
    check(
      "goals_template_key_check",
      sql`${table.templateKey} IN ('financial_independence', 'cash_runway', 'major_purchase', 'custom')`,
    ),
    check("goals_primary_check", sql`${table.isPrimary} IN (0, 1)`),
  ],
);

export const goalVersions = sqliteTable(
  "goal_versions",
  {
    id: id("id"),
    householdId: householdReference(),
    goalId: text("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    metricKey: text("metric_key").notNull(),
    metricLabel: text("metric_label").notNull(),
    targetValueInteger: integer("target_value_integer"),
    targetUnit: text("target_unit").notNull(),
    targetDate: text("target_date"),
    currentValueInteger: integer("current_value_integer").notNull(),
    currentValueSource: text("current_value_source").notNull(),
    changeNote: text("change_note").notNull(),
    createdAt: timestamp("created_at"),
    createdBy: text("created_by").notNull(),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("goal_versions_household_goal_idx").on(
      table.householdId,
      table.goalId,
    ),
    uniqueIndex("goal_versions_goal_version_unique").on(
      table.goalId,
      table.version,
    ),
    check("goal_versions_version_check", sql`${table.version} > 0`),
    check(
      "goal_versions_values_check",
      sql`${table.currentValueInteger} >= 0 AND (${table.targetValueInteger} IS NULL OR ${table.targetValueInteger} >= 0)`,
    ),
    check(
      "goal_versions_unit_check",
      sql`${table.targetUnit} IN ('minor_units', 'months', 'ppm', 'count')`,
    ),
    check("goal_versions_immutable_check", sql`${table.immutable} = 1`),
  ],
);

export const goalForecastSnapshots = sqliteTable(
  "goal_forecast_snapshots",
  {
    id: id("id"),
    householdId: householdReference(),
    goalVersionId: text("goal_version_id")
      .notNull()
      .references(() => goalVersions.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    modelStatus: text("model_status").notNull(),
    lowerValueInteger: integer("lower_value_integer"),
    middleValueInteger: integer("middle_value_integer"),
    higherValueInteger: integer("higher_value_integer"),
    successProbabilityPpm: integer("success_probability_ppm"),
    unit: text("unit").notNull(),
    horizonDate: text("horizon_date"),
    methodology: text("methodology").notNull(),
    createdAt: timestamp("created_at"),
    createdBy: text("created_by").notNull(),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("goal_forecast_snapshots_household_idx").on(table.householdId),
    uniqueIndex("goal_forecast_snapshots_goal_version_unique").on(
      table.goalVersionId,
    ),
    check("goal_forecast_snapshots_version_check", sql`${table.version} > 0`),
    check(
      "goal_forecast_snapshots_status_check",
      sql`${table.modelStatus} IN ('modeled', 'not_configured')`,
    ),
    check(
      "goal_forecast_snapshots_values_check",
      sql`(${table.lowerValueInteger} IS NULL OR ${table.lowerValueInteger} >= 0)
        AND (${table.middleValueInteger} IS NULL OR ${table.middleValueInteger} >= 0)
        AND (${table.higherValueInteger} IS NULL OR ${table.higherValueInteger} >= 0)
        AND (${table.successProbabilityPpm} IS NULL OR ${table.successProbabilityPpm} BETWEEN 0 AND 1000000)`,
    ),
    check(
      "goal_forecast_snapshots_order_check",
      sql`${table.modelStatus} = 'not_configured'
        OR (${table.lowerValueInteger} <= ${table.middleValueInteger}
          AND ${table.middleValueInteger} <= ${table.higherValueInteger})`,
    ),
    check(
      "goal_forecast_snapshots_unit_check",
      sql`${table.unit} IN ('minor_units', 'months', 'ppm', 'count')`,
    ),
    check(
      "goal_forecast_snapshots_immutable_check",
      sql`${table.immutable} = 1`,
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

export const portfolioWatchTargets = sqliteTable(
  "portfolio_watch_targets",
  {
    id: id("id"),
    householdId: householdReference(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    sourcePolicy: text("source_policy").notNull(),
    lastCheckedAt: timestamp("last_checked_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("portfolio_watch_targets_household_idx").on(
      table.householdId,
      table.status,
    ),
    uniqueIndex("portfolio_watch_targets_household_company_unique").on(
      table.householdId,
      table.companyId,
    ),
  ],
);

export const portfolioWatchSources = sqliteTable(
  "portfolio_watch_sources",
  {
    id: id("id"),
    householdId: householdReference(),
    watchTargetId: text("watch_target_id")
      .notNull()
      .references(() => portfolioWatchTargets.id, { onDelete: "restrict" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    sourceKind: text("source_kind").notNull(),
    sourceClass: text("source_class").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    allowedOrigin: text("allowed_origin").notNull(),
    allowedPathPrefix: text("allowed_path_prefix").notNull(),
    status: text("status").notNull(),
    authorityPpm: integer("authority_ppm").notNull(),
    identityConfidencePpm: integer("identity_confidence_ppm").notNull(),
    operationalHealthPpm: integer("operational_health_ppm").notNull(),
    coverageJson: text("coverage_json").notNull(),
    autoActivatedAt: text("auto_activated_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("portfolio_watch_sources_ready_idx").on(
      table.status,
      table.updatedAt,
    ),
    index("portfolio_watch_sources_company_idx").on(
      table.householdId,
      table.companyId,
      table.status,
    ),
    uniqueIndex("portfolio_watch_sources_target_url_unique").on(
      table.watchTargetId,
      table.canonicalUrl,
    ),
    check(
      "portfolio_watch_sources_kind_check",
      sql`${table.sourceKind} IN ('official_company_web', 'official_rss', 'official_atom')`,
    ),
    check(
      "portfolio_watch_sources_class_check",
      sql`${table.sourceClass} = 'official_company'`,
    ),
    check(
      "portfolio_watch_sources_status_check",
      sql`${table.status} IN ('discovered', 'verified', 'active', 'degraded', 'quarantined', 'revoked')`,
    ),
    check(
      "portfolio_watch_sources_authority_check",
      sql`${table.authorityPpm} BETWEEN 0 AND 1000000`,
    ),
    check(
      "portfolio_watch_sources_identity_check",
      sql`${table.identityConfidencePpm} BETWEEN 0 AND 1000000`,
    ),
    check(
      "portfolio_watch_sources_health_check",
      sql`${table.operationalHealthPpm} BETWEEN 0 AND 1000000`,
    ),
  ],
);

export const portfolioWatchSourceVerificationEvents = sqliteTable(
  "portfolio_watch_source_verification_events",
  {
    id: id("id"),
    householdId: householdReference(),
    sourceId: text("source_id")
      .notNull()
      .references(() => portfolioWatchSources.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    reasonCode: text("reason_code").notNull(),
    observedUrl: text("observed_url").notNull(),
    normalizedUrl: text("normalized_url"),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    redirectUrl: text("redirect_url"),
    securityPassed: integer("security_passed", { mode: "boolean" }).notNull(),
    authorityPpm: integer("authority_ppm").notNull(),
    identityConfidencePpm: integer("identity_confidence_ppm").notNull(),
    coverageJson: text("coverage_json").notNull(),
    occurredAt: timestamp("occurred_at"),
  },
  (table) => [
    index("portfolio_watch_source_verification_events_source_idx").on(
      table.sourceId,
      table.occurredAt,
    ),
    check(
      "portfolio_watch_source_verification_events_type_check",
      sql`${table.eventType} IN ('discovered', 'verified', 'activated', 'degraded', 'quarantined', 'revoked')`,
    ),
    check(
      "portfolio_watch_source_verification_events_security_check",
      sql`${table.securityPassed} IN (0, 1)`,
    ),
    check(
      "portfolio_watch_source_verification_events_authority_check",
      sql`${table.authorityPpm} BETWEEN 0 AND 1000000`,
    ),
    check(
      "portfolio_watch_source_verification_events_identity_check",
      sql`${table.identityConfidencePpm} BETWEEN 0 AND 1000000`,
    ),
  ],
);

export const portfolioWatchSourceSyncState = sqliteTable(
  "portfolio_watch_source_sync_state",
  {
    sourceId: text("source_id")
      .primaryKey()
      .references(() => portfolioWatchSources.id, { onDelete: "restrict" }),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastContentSha256: text("last_content_sha256"),
    lastAttemptAt: text("last_attempt_at"),
    lastSuccessAt: text("last_success_at"),
    nextCheckAt: timestamp("next_check_at"),
    lastHttpStatus: integer("last_http_status"),
    consecutiveFailureCount: integer("consecutive_failure_count")
      .notNull()
      .default(0),
    lastErrorCode: text("last_error_code"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("portfolio_watch_source_sync_due_idx").on(table.nextCheckAt),
    check(
      "portfolio_watch_source_sync_failures_check",
      sql`${table.consecutiveFailureCount} >= 0`,
    ),
  ],
);

export const publicSourceObservations = sqliteTable(
  "public_source_observations",
  {
    id: id("id"),
    householdId: householdReference(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    evidenceEventId: text("evidence_event_id")
      .notNull()
      .unique()
      .references(() => evidenceEvents.id, { onDelete: "restrict" }),
    sourceId: text("source_id").references(() => portfolioWatchSources.id, {
      onDelete: "restrict",
    }),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "restrict" }),
    sourceClass: text("source_class").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceTitle: text("source_title").notNull(),
    publishedAt: timestamp("published_at"),
    retrievedAt: timestamp("retrieved_at"),
    observedFact: text("observed_fact").notNull(),
    inference: text("inference").notNull(),
    sourceReliabilityPpm: integer("source_reliability_ppm").notNull(),
    modelConfidencePpm: integer("model_confidence_ppm").notNull(),
    valuationLowMinor: integer("valuation_low_minor"),
    valuationMiddleMinor: integer("valuation_middle_minor"),
    valuationHighMinor: integer("valuation_high_minor"),
    limitations: text("limitations").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("public_source_observations_household_idx").on(
      table.householdId,
      table.retrievedAt,
    ),
    index("public_source_observations_company_idx").on(
      table.companyId,
      table.publishedAt,
    ),
    index("public_source_observations_source_published_idx").on(
      table.sourceId,
      table.publishedAt,
    ),
    uniqueIndex("public_source_observations_household_fingerprint_unique").on(
      table.householdId,
      table.fingerprint,
    ),
    check(
      "public_source_observations_reliability_check",
      sql`${table.sourceReliabilityPpm} BETWEEN 0 AND 1000000`,
    ),
    check(
      "public_source_observations_model_confidence_check",
      sql`${table.modelConfidencePpm} BETWEEN 0 AND 1000000`,
    ),
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

export const signalUpdateProposals = sqliteTable(
  "signal_update_proposals",
  {
    id: id("id"),
    householdId: householdReference(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    reconciliationGroupId: text("reconciliation_group_id").notNull(),
    reconciliationRevision: text("reconciliation_revision").notNull(),
    scenarioId: text("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "restrict" }),
    baseForecastSnapshotId: text("base_forecast_snapshot_id")
      .notNull()
      .references(() => forecastSnapshots.id, { onDelete: "restrict" }),
    baseForecastSnapshotVersion: integer(
      "base_forecast_snapshot_version",
    ).notNull(),
    proposedCompanyValuationJson: text(
      "proposed_company_valuation_json",
    ).notNull(),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("signal_update_proposals_household_created_idx").on(
      table.householdId,
      table.createdAt,
    ),
    index("signal_update_proposals_group_idx").on(
      table.householdId,
      table.reconciliationGroupId,
    ),
    uniqueIndex("signal_update_proposals_version_unique").on(
      table.householdId,
      table.reconciliationGroupId,
      table.reconciliationRevision,
      table.scenarioId,
      table.baseForecastSnapshotId,
    ),
    check(
      "signal_update_proposals_revision_check",
      sql`length(${table.reconciliationRevision}) = 64`,
    ),
    check(
      "signal_update_proposals_snapshot_version_check",
      sql`${table.baseForecastSnapshotVersion} > 0`,
    ),
    check(
      "signal_update_proposals_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const signalUpdateProposalEvidence = sqliteTable(
  "signal_update_proposal_evidence",
  {
    proposalId: text("proposal_id")
      .notNull()
      .references(() => signalUpdateProposals.id, { onDelete: "restrict" }),
    householdId: householdReference(),
    evidenceEventId: text("evidence_event_id")
      .notNull()
      .references(() => evidenceEvents.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("signal_update_proposal_evidence_unique").on(
      table.proposalId,
      table.evidenceEventId,
    ),
    index("signal_update_proposal_evidence_event_idx").on(
      table.evidenceEventId,
    ),
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

export const angelListMacAgents = sqliteTable(
  "angellist_mac_agents",
  {
    id: id("id"),
    householdId: householdReference(),
    registeredByUserId: text("registered_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    interval: text("interval").notNull(),
    lastSeenAt: timestamp("last_seen_at"),
    lastCompletedAt: text("last_completed_at"),
    nextRunAt: text("next_run_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("angellist_mac_agents_household_unique").on(table.householdId),
    check(
      "angellist_mac_agents_interval_check",
      sql`${table.interval} IN ('off', 'daily', 'weekly')`,
    ),
  ],
);

export const angelListMacRuns = sqliteTable(
  "angellist_mac_runs",
  {
    id: id("id"),
    householdId: householdReference(),
    agentId: text("agent_id")
      .notNull()
      .references(() => angelListMacAgents.id, { onDelete: "restrict" }),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestKind: text("request_kind").notNull(),
    status: text("status").notNull(),
    leaseTokenSha256: text("lease_token_sha256"),
    leaseExpiresAt: text("lease_expires_at"),
    importId: text("import_id").references(() => holdingImports.id, {
      onDelete: "restrict",
    }),
    errorCode: text("error_code"),
    requestedAt: timestamp("requested_at"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    uniqueIndex("angellist_mac_runs_active_agent_unique")
      .on(table.agentId)
      .where(sql`${table.status} IN ('queued', 'leased')`),
    index("angellist_mac_runs_household_requested_idx").on(
      table.householdId,
      table.requestedAt,
    ),
    check(
      "angellist_mac_runs_request_kind_check",
      sql`${table.requestKind} IN ('manual', 'schedule')`,
    ),
    check(
      "angellist_mac_runs_status_check",
      sql`${table.status} IN ('queued', 'leased', 'completed', 'failed')`,
    ),
  ],
);

export const holdingImports = sqliteTable(
  "holding_imports",
  {
    id: id("id"),
    householdId: householdReference(),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    parserSchema: text("parser_schema").notNull(),
    rowCount: integer("row_count").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("holding_imports_source_document_unique").on(
      table.sourceDocumentId,
    ),
    index("holding_imports_household_created_idx").on(
      table.householdId,
      table.createdAt,
    ),
    check(
      "holding_imports_row_count_check",
      sql`${table.rowCount} BETWEEN 1 AND 500`,
    ),
  ],
);

export const holdingImportRows = sqliteTable(
  "holding_import_rows",
  {
    id: id("id"),
    householdId: householdReference(),
    importId: text("import_id")
      .notNull()
      .references(() => holdingImports.id, { onDelete: "restrict" }),
    sourceRowNumber: integer("source_row_number").notNull(),
    positionFingerprint: text("position_fingerprint").notNull(),
    snapshotFingerprint: text("snapshot_fingerprint").notNull(),
    legalVehicleName: text("legal_vehicle_name").notNull(),
    ownerLabel: text("owner_label").notNull(),
    exposureLabel: text("exposure_label").notNull(),
    providerStatus: text("provider_status").notNull(),
    investedOn: text("invested_on").notNull(),
    investedMinor: integer("invested_minor").notNull(),
    allocationMinor: integer("allocation_minor").notNull(),
    unrealizedValueMinor: integer("unrealized_value_minor"),
    unrealizedValueState: text("unrealized_value_state").notNull(),
    realizedValueMinor: integer("realized_value_minor").notNull(),
    netValueMinor: integer("net_value_minor"),
    netValueState: text("net_value_state").notNull(),
    instrumentType: text("instrument_type").notNull(),
    currencyHint: text("currency_hint"),
    parseStatus: text("parse_status").notNull(),
    issueCodesJson: text("issue_codes_json").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("holding_import_rows_import_row_unique").on(
      table.importId,
      table.sourceRowNumber,
    ),
    index("holding_import_rows_import_idx").on(
      table.importId,
      table.sourceRowNumber,
    ),
    index("holding_import_rows_position_idx").on(
      table.householdId,
      table.positionFingerprint,
    ),
    check(
      "holding_import_rows_provider_status_check",
      sql`${table.providerStatus} IN ('live', 'realized')`,
    ),
    check(
      "holding_import_rows_parse_status_check",
      sql`${table.parseStatus} IN ('ready', 'needs_attention')`,
    ),
    check(
      "holding_import_rows_issue_codes_json_check",
      sql`json_valid(${table.issueCodesJson})`,
    ),
  ],
);

export const holdingPositions = sqliteTable(
  "holding_positions",
  {
    id: id("id"),
    householdId: householdReference(),
    provider: text("provider").notNull(),
    positionFingerprint: text("position_fingerprint").notNull(),
    legalVehicleName: text("legal_vehicle_name").notNull(),
    ownerLabel: text("owner_label").notNull(),
    positionKind: text("position_kind").notNull(),
    instrumentType: text("instrument_type").notNull(),
    openedOn: text("opened_on"),
    currency: text("currency").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("holding_positions_household_provider_fingerprint_unique").on(
      table.householdId,
      table.provider,
      table.positionFingerprint,
    ),
    index("holding_positions_household_created_idx").on(
      table.householdId,
      table.createdAt,
    ),
    check(
      "holding_positions_kind_check",
      sql`${table.positionKind} IN ('direct', 'spv_interest', 'fund_interest')`,
    ),
  ],
);

export const holdingPositionExposures = sqliteTable(
  "holding_position_exposures",
  {
    id: id("id"),
    householdId: householdReference(),
    positionId: text("position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    exposureLabel: text("exposure_label"),
    exposureKind: text("exposure_kind").notNull(),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("holding_position_exposures_position_label_unique").on(
      table.positionId,
      table.exposureLabel,
    ),
    index("holding_position_exposures_household_idx").on(
      table.householdId,
      table.positionId,
    ),
    check(
      "holding_position_exposures_kind_check",
      sql`${table.exposureKind} IN ('unresolved', 'company', 'fund')`,
    ),
  ],
);

export const holdingPositionSnapshots = sqliteTable(
  "holding_position_snapshots",
  {
    id: id("id"),
    householdId: householdReference(),
    positionId: text("position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "restrict" }),
    sourceImportRowId: text("source_import_row_id")
      .notNull()
      .references(() => holdingImportRows.id, { onDelete: "restrict" }),
    snapshotFingerprint: text("snapshot_fingerprint").notNull(),
    providerStatus: text("provider_status").notNull(),
    investedMinor: integer("invested_minor").notNull(),
    allocationMinor: integer("allocation_minor").notNull(),
    unrealizedValueMinor: integer("unrealized_value_minor"),
    unrealizedValueState: text("unrealized_value_state").notNull(),
    realizedValueMinor: integer("realized_value_minor").notNull(),
    netValueMinor: integer("net_value_minor"),
    netValueState: text("net_value_state").notNull(),
    instrumentType: text("instrument_type").notNull(),
    currency: text("currency").notNull(),
    observedAt: timestamp("observed_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("holding_position_snapshots_source_row_unique").on(
      table.sourceImportRowId,
    ),
    uniqueIndex("holding_position_snapshots_position_fingerprint_unique").on(
      table.positionId,
      table.snapshotFingerprint,
    ),
    index("holding_position_snapshots_position_idx").on(
      table.positionId,
      table.observedAt,
    ),
  ],
);

export const holdingImportRowDecisions = sqliteTable(
  "holding_import_row_decisions",
  {
    id: id("id"),
    householdId: householdReference(),
    importRowId: text("import_row_id")
      .notNull()
      .references(() => holdingImportRows.id, { onDelete: "restrict" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    matchedPositionId: text("matched_position_id").references(
      () => holdingPositions.id,
      { onDelete: "restrict" },
    ),
    currency: text("currency"),
    reviewedSnapshotFingerprint: text(
      "reviewed_snapshot_fingerprint",
    ).notNull(),
    rationale: text("rationale").notNull(),
    decidedAt: timestamp("decided_at"),
  },
  (table) => [
    uniqueIndex("holding_import_row_decisions_row_unique").on(
      table.importRowId,
    ),
    index("holding_import_row_decisions_household_idx").on(
      table.householdId,
      table.decidedAt,
    ),
    check(
      "holding_import_row_decisions_decision_check",
      sql`${table.decision} IN ('accepted', 'rejected')`,
    ),
  ],
);

export const holdingImportApplications = sqliteTable(
  "holding_import_applications",
  {
    id: id("id"),
    householdId: householdReference(),
    importRowId: text("import_row_id")
      .notNull()
      .references(() => holdingImportRows.id, { onDelete: "restrict" }),
    decisionId: text("decision_id")
      .notNull()
      .references(() => holdingImportRowDecisions.id, {
        onDelete: "restrict",
      }),
    positionId: text("position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => holdingPositionSnapshots.id, { onDelete: "restrict" }),
    outcome: text("outcome").notNull(),
    appliedBy: text("applied_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    appliedAt: timestamp("applied_at"),
  },
  (table) => [
    uniqueIndex("holding_import_applications_row_unique").on(table.importRowId),
    uniqueIndex("holding_import_applications_decision_unique").on(
      table.decisionId,
    ),
    index("holding_import_applications_household_idx").on(
      table.householdId,
      table.appliedAt,
    ),
    check(
      "holding_import_applications_outcome_check",
      sql`${table.outcome} IN ('created_position', 'appended_snapshot', 'no_change')`,
    ),
  ],
);
