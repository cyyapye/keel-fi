import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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

export const assetLotRetirements = sqliteTable(
  "asset_lot_retirements",
  {
    id: id("id"),
    householdId: householdReference(),
    assetLotId: text("asset_lot_id")
      .notNull()
      .references(() => assetLots.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    retiredByUserId: text("retired_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    retiredAt: timestamp("retired_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("asset_lot_retirements_household_idx").on(
      table.householdId,
      table.retiredAt,
    ),
    uniqueIndex("asset_lot_retirements_asset_lot_unique").on(table.assetLotId),
    check(
      "asset_lot_retirements_reason_check",
      sql`${table.reason} IN ('preview_demo_cleanup')`,
    ),
    check("asset_lot_retirements_immutable_check", sql`${table.immutable} = 1`),
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
    index("portfolio_watch_sources_target_status_idx").on(
      table.watchTargetId,
      table.status,
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
    providerAccountKey: text("provider_account_key"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("connector_accounts_household_idx").on(table.householdId),
    uniqueIndex("connector_accounts_household_label_unique").on(
      table.householdId,
      table.connectorType,
      table.displayLabel,
    ),
    uniqueIndex("connector_accounts_provider_account_key_unique")
      .on(table.connectorType, table.providerAccountKey)
      .where(sql`${table.providerAccountKey} IS NOT NULL`),
    check(
      "connector_accounts_provider_account_key_check",
      sql`${table.providerAccountKey} IS NULL OR (length(${table.providerAccountKey}) = 64 AND ${table.providerAccountKey} NOT GLOB '*[^0-9a-f]*')`,
    ),
  ],
);

export const plaidWebhookDeliveries = sqliteTable(
  "plaid_webhook_deliveries",
  {
    id: id("id"),
    householdId: householdReference(),
    connectorAccountId: text("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "restrict" }),
    signatureSha256: text("signature_sha256").notNull().unique(),
    bodySha256: text("body_sha256").notNull(),
    issuedAt: timestamp("issued_at"),
    receivedAt: timestamp("received_at"),
    status: text("status").notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("plaid_webhook_deliveries_account_received_idx").on(
      table.connectorAccountId,
      table.receivedAt,
    ),
    index("plaid_webhook_deliveries_status_received_idx").on(
      table.status,
      table.receivedAt,
    ),
    check(
      "plaid_webhook_deliveries_signature_check",
      sql`length(${table.signatureSha256}) = 64 AND ${table.signatureSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "plaid_webhook_deliveries_body_check",
      sql`length(${table.bodySha256}) = 64 AND ${table.bodySha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "plaid_webhook_deliveries_status_check",
      sql`${table.status} IN ('received', 'queued', 'processing', 'processed', 'failed')`,
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
    adjudicationPolicyVersion: text("adjudication_policy_version"),
    autoAppliedCount: integer("auto_applied_count").notNull().default(0),
    quarantinedCount: integer("quarantined_count").notNull().default(0),
    preservedPositionCount: integer("preserved_position_count")
      .notNull()
      .default(0),
    baselineRefreshStatus: text("baseline_refresh_status")
      .notNull()
      .default("not_needed"),
    portfolioBaselineId: text("portfolio_baseline_id"),
  },
  (table) => [
    index("connector_sync_runs_account_started_idx").on(
      table.connectorAccountId,
      table.startedAt,
    ),
    uniqueIndex("connector_sync_runs_active_account_unique")
      .on(table.connectorAccountId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    check(
      "connector_sync_runs_counts_check",
      sql`${table.discoveredCount} >= 0 AND ${table.proposedCount} >= 0 AND ${table.autoAppliedCount} >= 0 AND ${table.quarantinedCount} >= 0 AND ${table.preservedPositionCount} >= 0`,
    ),
    check(
      "connector_sync_runs_baseline_refresh_check",
      sql`${table.baselineRefreshStatus} IN ('not_needed', 'refreshed', 'manual_required')`,
    ),
  ],
);

export const cashBalanceProposals = sqliteTable(
  "cash_balance_proposals",
  {
    id: id("id"),
    householdId: householdReference(),
    connectorAccountId: text("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "restrict" }),
    syncRunId: text("sync_run_id")
      .notNull()
      .references(() => connectorSyncRuns.id, { onDelete: "restrict" }),
    sourceObjectKey: text("source_object_key").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    normalizedFingerprint: text("normalized_fingerprint").notNull(),
    refreshKind: text("refresh_kind").notNull(),
    observedAt: timestamp("observed_at"),
    retrievedAt: timestamp("retrieved_at"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("cash_balance_proposals_sync_run_unique").on(table.syncRunId),
    uniqueIndex("cash_balance_proposals_source_object_unique").on(
      table.sourceObjectKey,
    ),
    index("cash_balance_proposals_household_status_idx").on(
      table.householdId,
      table.status,
      table.createdAt,
    ),
    index("cash_balance_proposals_connection_created_idx").on(
      table.connectorAccountId,
      table.createdAt,
    ),
    check(
      "cash_balance_proposals_source_sha_check",
      sql`length(${table.sourceSha256}) = 64 AND ${table.sourceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "cash_balance_proposals_fingerprint_check",
      sql`length(${table.normalizedFingerprint}) = 64 AND ${table.normalizedFingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "cash_balance_proposals_refresh_kind_check",
      sql`${table.refreshKind} IN ('initial', 'live')`,
    ),
    check(
      "cash_balance_proposals_status_check",
      sql`${table.status} IN ('pending_review', 'applied')`,
    ),
  ],
);

export const cashBalanceProposalRows = sqliteTable(
  "cash_balance_proposal_rows",
  {
    id: id("id"),
    householdId: householdReference(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => cashBalanceProposals.id, { onDelete: "restrict" }),
    naturalKeySha256: text("natural_key_sha256").notNull(),
    itemAccountKeySha256: text("item_account_key_sha256"),
    institutionLabel: text("institution_label").notNull(),
    accountLabel: text("account_label").notNull(),
    subtype: text("subtype").notNull(),
    availableMinor: integer("available_minor"),
    currentMinor: integer("current_minor"),
    valueMinor: integer("value_minor"),
    valueState: text("value_state").notNull(),
    balanceSource: text("balance_source"),
    observedAt: timestamp("observed_at"),
    issuesJson: text("issues_json").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("cash_balance_proposal_rows_proposal_key_unique").on(
      table.proposalId,
      table.naturalKeySha256,
    ),
    index("cash_balance_proposal_rows_proposal_idx").on(
      table.proposalId,
      table.naturalKeySha256,
    ),
    index("cash_balance_proposal_rows_item_account_key_idx").on(
      table.itemAccountKeySha256,
    ),
    check(
      "cash_balance_proposal_rows_key_check",
      sql`length(${table.naturalKeySha256}) = 64 AND ${table.naturalKeySha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "cash_balance_proposal_rows_item_account_key_check",
      sql`${table.itemAccountKeySha256} IS NULL OR (length(${table.itemAccountKeySha256}) = 64 AND ${table.itemAccountKeySha256} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "cash_balance_proposal_rows_subtype_check",
      sql`${table.subtype} IN ('checking', 'savings', 'money market', 'cash management', 'other')`,
    ),
    check(
      "cash_balance_proposal_rows_labels_check",
      sql`length(${table.institutionLabel}) BETWEEN 1 AND 512 AND length(${table.accountLabel}) BETWEEN 1 AND 512`,
    ),
    check(
      "cash_balance_proposal_rows_value_state_check",
      sql`${table.valueState} IN ('reported', 'unavailable', 'unsupported', 'not_reported')`,
    ),
    check(
      "cash_balance_proposal_rows_balance_source_check",
      sql`${table.balanceSource} IS NULL OR ${table.balanceSource} IN ('available', 'current')`,
    ),
    check(
      "cash_balance_proposal_rows_value_check",
      sql`(${table.valueState} = 'reported' AND ${table.valueMinor} IS NOT NULL AND ${table.valueMinor} >= 0 AND ${table.balanceSource} IS NOT NULL) OR (${table.valueState} <> 'reported' AND ${table.valueMinor} IS NULL AND ${table.balanceSource} IS NULL)`,
    ),
    check(
      "cash_balance_proposal_rows_issues_check",
      sql`json_valid(${table.issuesJson}) AND json_type(${table.issuesJson}) = 'array'`,
    ),
  ],
);

export const cashBalanceReviewDecisions = sqliteTable(
  "cash_balance_review_decisions",
  {
    id: id("id"),
    householdId: householdReference(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => cashBalanceProposals.id, { onDelete: "restrict" }),
    proposalRowId: text("proposal_row_id")
      .notNull()
      .references(() => cashBalanceProposalRows.id, { onDelete: "restrict" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    changeNote: text("change_note").notNull(),
    decidedAt: timestamp("decided_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("cash_balance_review_decisions_row_unique").on(
      table.proposalRowId,
    ),
    index("cash_balance_review_decisions_household_decided_idx").on(
      table.householdId,
      table.decidedAt,
    ),
    check(
      "cash_balance_review_decisions_decision_check",
      sql`${table.decision} IN ('accepted', 'excluded')`,
    ),
    check(
      "cash_balance_review_decisions_note_check",
      sql`length(${table.changeNote}) BETWEEN 1 AND 500`,
    ),
    check(
      "cash_balance_review_decisions_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const cashAccountIdentityDecisions = sqliteTable(
  "cash_account_identity_decisions",
  {
    id: id("id"),
    householdId: householdReference(),
    connectorAccountId: text("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "restrict" }),
    naturalKeyLowSha256: text("natural_key_low_sha256").notNull(),
    naturalKeyHighSha256: text("natural_key_high_sha256").notNull(),
    decision: text("decision").notNull(),
    supersedesDecisionId: text("supersedes_decision_id"),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    changeNote: text("change_note").notNull(),
    decidedAt: timestamp("decided_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesDecisionId],
      foreignColumns: [table.id],
      name: "cash_account_identity_decisions_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("cash_account_identity_decisions_supersedes_unique").on(
      table.supersedesDecisionId,
    ),
    index("cash_account_identity_decisions_household_pair_idx").on(
      table.householdId,
      table.connectorAccountId,
      table.naturalKeyLowSha256,
      table.naturalKeyHighSha256,
      table.decidedAt,
    ),
    check(
      "cash_account_identity_decisions_low_key_check",
      sql`length(${table.naturalKeyLowSha256}) = 64 AND ${table.naturalKeyLowSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "cash_account_identity_decisions_high_key_check",
      sql`length(${table.naturalKeyHighSha256}) = 64 AND ${table.naturalKeyHighSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "cash_account_identity_decisions_key_order_check",
      sql`${table.naturalKeyLowSha256} < ${table.naturalKeyHighSha256}`,
    ),
    check(
      "cash_account_identity_decisions_decision_check",
      sql`${table.decision} IN ('same_account', 'separate_accounts')`,
    ),
    check(
      "cash_account_identity_decisions_note_check",
      sql`length(${table.changeNote}) BETWEEN 1 AND 500`,
    ),
    check(
      "cash_account_identity_decisions_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const liabilityProposals = sqliteTable(
  "liability_proposals",
  {
    id: id("id"),
    householdId: householdReference(),
    connectorAccountId: text("connector_account_id").references(
      () => connectorAccounts.id,
      { onDelete: "restrict" },
    ),
    syncRunId: text("sync_run_id").references(() => connectorSyncRuns.id, {
      onDelete: "restrict",
    }),
    source: text("source").notNull(),
    sourceObjectKey: text("source_object_key"),
    sourceSha256: text("source_sha256"),
    normalizedFingerprint: text("normalized_fingerprint").notNull(),
    refreshKind: text("refresh_kind").notNull(),
    observedAt: timestamp("observed_at"),
    retrievedAt: timestamp("retrieved_at"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("liability_proposals_sync_run_unique").on(table.syncRunId),
    uniqueIndex("liability_proposals_source_object_unique").on(
      table.sourceObjectKey,
    ),
    index("liability_proposals_household_status_idx").on(
      table.householdId,
      table.status,
      table.createdAt,
    ),
    index("liability_proposals_connection_created_idx").on(
      table.connectorAccountId,
      table.createdAt,
    ),
    check(
      "liability_proposals_source_check",
      sql`${table.source} IN ('plaid', 'manual')`,
    ),
    check(
      "liability_proposals_source_sha_check",
      sql`${table.sourceSha256} IS NULL OR (length(${table.sourceSha256}) = 64 AND ${table.sourceSha256} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "liability_proposals_fingerprint_check",
      sql`length(${table.normalizedFingerprint}) = 64 AND ${table.normalizedFingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "liability_proposals_refresh_kind_check",
      sql`${table.refreshKind} IN ('initial', 'live', 'manual')`,
    ),
    check(
      "liability_proposals_status_check",
      sql`${table.status} IN ('pending_review', 'applied')`,
    ),
    check(
      "liability_proposals_boundary_check",
      sql`(${table.source} = 'plaid' AND ${table.connectorAccountId} IS NOT NULL AND ${table.syncRunId} IS NOT NULL AND ${table.sourceObjectKey} IS NOT NULL AND ${table.sourceSha256} IS NOT NULL AND ${table.refreshKind} IN ('initial', 'live')) OR (${table.source} = 'manual' AND ${table.connectorAccountId} IS NULL AND ${table.syncRunId} IS NULL AND ${table.sourceObjectKey} IS NULL AND ${table.sourceSha256} IS NULL AND ${table.refreshKind} = 'manual')`,
    ),
  ],
);

export const liabilityProposalRows = sqliteTable(
  "liability_proposal_rows",
  {
    id: id("id"),
    householdId: householdReference(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => liabilityProposals.id, { onDelete: "restrict" }),
    naturalKeySha256: text("natural_key_sha256").notNull(),
    source: text("source").notNull(),
    institutionLabel: text("institution_label").notNull(),
    accountLabel: text("account_label").notNull(),
    kind: text("kind").notNull(),
    classification: text("classification").notNull(),
    balanceMinor: integer("balance_minor"),
    valueState: text("value_state").notNull(),
    paymentMinor: integer("payment_minor"),
    interestRatePpm: integer("interest_rate_ppm"),
    nextPaymentDueDate: text("next_payment_due_date"),
    isOverdue: integer("is_overdue", { mode: "boolean" }),
    effectiveDate: text("effective_date").notNull(),
    observedAt: timestamp("observed_at"),
    issuesJson: text("issues_json").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("liability_proposal_rows_proposal_key_unique").on(
      table.proposalId,
      table.naturalKeySha256,
    ),
    index("liability_proposal_rows_proposal_idx").on(
      table.proposalId,
      table.naturalKeySha256,
    ),
    check(
      "liability_proposal_rows_key_check",
      sql`length(${table.naturalKeySha256}) = 64 AND ${table.naturalKeySha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "liability_proposal_rows_source_check",
      sql`${table.source} IN ('plaid', 'manual')`,
    ),
    check(
      "liability_proposal_rows_kind_check",
      sql`${table.kind} IN ('credit_card', 'mortgage', 'student_loan', 'other_revolving', 'other_scheduled')`,
    ),
    check(
      "liability_proposal_rows_classification_check",
      sql`(${table.kind} IN ('credit_card', 'other_revolving') AND ${table.classification} = 'revolving') OR (${table.kind} IN ('mortgage', 'student_loan', 'other_scheduled') AND ${table.classification} = 'scheduled')`,
    ),
    check(
      "liability_proposal_rows_labels_check",
      sql`length(${table.institutionLabel}) BETWEEN 1 AND 512 AND length(${table.accountLabel}) BETWEEN 1 AND 512`,
    ),
    check(
      "liability_proposal_rows_value_state_check",
      sql`${table.valueState} IN ('reported', 'unavailable', 'unsupported', 'not_reported')`,
    ),
    check(
      "liability_proposal_rows_value_check",
      sql`(${table.valueState} = 'reported' AND ${table.balanceMinor} IS NOT NULL AND ${table.balanceMinor} >= 0) OR (${table.valueState} <> 'reported' AND ${table.balanceMinor} IS NULL)`,
    ),
    check(
      "liability_proposal_rows_payment_check",
      sql`${table.paymentMinor} IS NULL OR ${table.paymentMinor} >= 0`,
    ),
    check(
      "liability_proposal_rows_rate_check",
      sql`${table.interestRatePpm} IS NULL OR ${table.interestRatePpm} BETWEEN 0 AND 1000000`,
    ),
    check(
      "liability_proposal_rows_issues_check",
      sql`json_valid(${table.issuesJson}) AND json_type(${table.issuesJson}) = 'array'`,
    ),
  ],
);

export const liabilityReviewDecisions = sqliteTable(
  "liability_review_decisions",
  {
    id: id("id"),
    householdId: householdReference(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => liabilityProposals.id, { onDelete: "restrict" }),
    proposalRowId: text("proposal_row_id")
      .notNull()
      .references(() => liabilityProposalRows.id, { onDelete: "restrict" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    paymentTreatment: text("payment_treatment"),
    changeNote: text("change_note").notNull(),
    decidedAt: timestamp("decided_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("liability_review_decisions_row_unique").on(
      table.proposalRowId,
    ),
    index("liability_review_decisions_household_decided_idx").on(
      table.householdId,
      table.decidedAt,
    ),
    check(
      "liability_review_decisions_decision_check",
      sql`${table.decision} IN ('accepted', 'excluded')`,
    ),
    check(
      "liability_review_decisions_treatment_check",
      sql`${table.paymentTreatment} IS NULL OR ${table.paymentTreatment} IN ('reserve_from_liquidity', 'add_to_household_burn', 'already_in_plan')`,
    ),
    check(
      "liability_review_decisions_boundary_check",
      sql`(${table.decision} = 'accepted' AND ${table.paymentTreatment} IS NOT NULL) OR (${table.decision} = 'excluded' AND ${table.paymentTreatment} IS NULL)`,
    ),
    check(
      "liability_review_decisions_note_check",
      sql`length(${table.changeNote}) BETWEEN 1 AND 500`,
    ),
    check(
      "liability_review_decisions_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const cashFlowConnections = sqliteTable(
  "cash_flow_connections",
  {
    connectorAccountId: text("connector_account_id")
      .primaryKey()
      .references(() => connectorAccounts.id, { onDelete: "restrict" }),
    householdId: householdReference(),
    confirmedByUserId: text("confirmed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    policyVersion: text("policy_version").notNull(),
    pricingConfirmedAt: timestamp("pricing_confirmed_at"),
    plaidCursor: text("plaid_cursor"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("cash_flow_connections_household_idx").on(
      table.householdId,
      table.createdAt,
    ),
    check(
      "cash_flow_connections_policy_check",
      sql`${table.policyVersion} = 'observed-cash-flow-v1'`,
    ),
  ],
);

export const cashFlowActivationEvents = sqliteTable(
  "cash_flow_activation_events",
  {
    id: id("id"),
    householdId: householdReference(),
    connectorAccountId: text("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "restrict" }),
    confirmedByUserId: text("confirmed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    policyVersion: text("policy_version").notNull(),
    pricingConfirmedAt: timestamp("pricing_confirmed_at"),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("cash_flow_activation_events_household_created_idx").on(
      table.householdId,
      table.createdAt,
    ),
    check(
      "cash_flow_activation_events_policy_check",
      sql`${table.policyVersion} = 'observed-cash-flow-v1'`,
    ),
    check(
      "cash_flow_activation_events_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const cashFlowTransactionRevisions = sqliteTable(
  "cash_flow_transaction_revisions",
  {
    id: id("id"),
    householdId: householdReference(),
    connectorAccountId: text("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "restrict" }),
    syncRunId: text("sync_run_id")
      .notNull()
      .references(() => connectorSyncRuns.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    mutation: text("mutation").notNull(),
    transactionKeySha256: text("transaction_key_sha256").notNull(),
    accountKeySha256: text("account_key_sha256"),
    effectiveDate: text("effective_date"),
    month: text("month"),
    amountMinor: integer("amount_minor"),
    pending: integer("pending", { mode: "boolean" }),
    category: text("category"),
    currencySupported: integer("currency_supported", { mode: "boolean" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("cash_flow_revisions_run_sequence_unique").on(
      table.syncRunId,
      table.sequence,
    ),
    uniqueIndex("cash_flow_revisions_run_transaction_unique").on(
      table.syncRunId,
      table.transactionKeySha256,
    ),
    index("cash_flow_revisions_household_transaction_idx").on(
      table.householdId,
      table.transactionKeySha256,
      table.createdAt,
      table.sequence,
    ),
    index("cash_flow_revisions_connection_month_idx").on(
      table.connectorAccountId,
      table.month,
      table.createdAt,
    ),
    check(
      "cash_flow_revisions_mutation_check",
      sql`${table.mutation} IN ('added', 'modified', 'removed')`,
    ),
    check(
      "cash_flow_revisions_transaction_key_check",
      sql`length(${table.transactionKeySha256}) = 64 AND ${table.transactionKeySha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check("cash_flow_revisions_sequence_check", sql`${table.sequence} > 0`),
    check("cash_flow_revisions_immutable_check", sql`${table.immutable} = 1`),
  ],
);

export const cashFlowProposals = sqliteTable(
  "cash_flow_proposals",
  {
    id: id("id"),
    householdId: householdReference(),
    triggerSyncRunId: text("trigger_sync_run_id")
      .notNull()
      .references(() => connectorSyncRuns.id, { onDelete: "restrict" }),
    sourceRevision: text("source_revision").notNull(),
    status: text("status").notNull(),
    observedAt: timestamp("observed_at"),
    periodStartMonth: text("period_start_month").notNull(),
    periodEndMonth: text("period_end_month").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    pendingExcludedCount: integer("pending_excluded_count").notNull(),
    unsupportedExcludedCount: integer("unsupported_excluded_count").notNull(),
    unreviewedAccountExcludedCount: integer(
      "unreviewed_account_excluded_count",
    ).notNull(),
    coveredConnectionCount: integer("covered_connection_count").notNull(),
    baseCashFlowPlanId: text("base_cash_flow_plan_id")
      .notNull()
      .references(() => cashFlowPlans.id, { onDelete: "restrict" }),
    baseForecastSnapshotId: text("base_forecast_snapshot_id")
      .notNull()
      .references(() => forecastSnapshots.id, { onDelete: "restrict" }),
    baseForecastSnapshotVersion: integer(
      "base_forecast_snapshot_version",
    ).notNull(),
    householdBurnMonthlyMinor: integer(
      "household_burn_monthly_minor",
    ).notNull(),
    businessBurnMonthlyMinor: integer("business_burn_monthly_minor").notNull(),
    debtPaymentContextMonthlyMinor: integer(
      "debt_payment_context_monthly_minor",
    ).notNull(),
    protectedCashFloorMinor: integer("protected_cash_floor_minor").notNull(),
    fiEligibleLiquidMinor: integer("fi_eligible_liquid_minor").notNull(),
    suggestedHouseholdBurnMonthlyMinor: integer(
      "suggested_household_burn_monthly_minor",
    ),
    suggestedBusinessBurnMonthlyMinor: integer(
      "suggested_business_burn_monthly_minor",
    ),
    reviewedAt: text("reviewed_at"),
    appliedCashFlowPlanId: text("applied_cash_flow_plan_id").references(
      () => cashFlowPlans.id,
      { onDelete: "restrict" },
    ),
    appliedAt: text("applied_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("cash_flow_proposals_trigger_run_unique").on(
      table.triggerSyncRunId,
    ),
    uniqueIndex("cash_flow_proposals_household_revision_unique").on(
      table.householdId,
      table.sourceRevision,
    ),
    uniqueIndex("cash_flow_proposals_household_action_unique")
      .on(table.householdId)
      .where(sql`${table.status} IN ('pending_review', 'ready_for_plan')`),
    index("cash_flow_proposals_household_created_idx").on(
      table.householdId,
      table.createdAt,
    ),
    check(
      "cash_flow_proposals_status_check",
      sql`${table.status} IN ('pending_review', 'ready_for_plan', 'reviewed_no_change', 'applied')`,
    ),
    check(
      "cash_flow_proposals_counts_check",
      sql`${table.transactionCount} > 0 AND ${table.pendingExcludedCount} >= 0 AND ${table.unsupportedExcludedCount} >= 0 AND ${table.unreviewedAccountExcludedCount} >= 0 AND ${table.coveredConnectionCount} > 0`,
    ),
  ],
);

export const cashFlowProposalMonths = sqliteTable(
  "cash_flow_proposal_months",
  {
    id: id("id"),
    householdId: householdReference(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => cashFlowProposals.id, { onDelete: "restrict" }),
    month: text("month").notNull(),
    outflowMinor: integer("outflow_minor").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("cash_flow_proposal_months_proposal_month_unique").on(
      table.proposalId,
      table.month,
    ),
    index("cash_flow_proposal_months_proposal_idx").on(
      table.proposalId,
      table.month,
    ),
    check(
      "cash_flow_proposal_months_values_check",
      sql`${table.outflowMinor} >= 0 AND ${table.transactionCount} > 0`,
    ),
    check(
      "cash_flow_proposal_months_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const cashFlowProposalCategories = sqliteTable(
  "cash_flow_proposal_categories",
  {
    id: id("id"),
    householdId: householdReference(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => cashFlowProposals.id, { onDelete: "restrict" }),
    category: text("category").notNull(),
    label: text("label").notNull(),
    totalMinor: integer("total_minor").notNull(),
    averageMonthlyMinor: integer("average_monthly_minor").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    defaultTreatment: text("default_treatment").notNull(),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("cash_flow_proposal_categories_proposal_category_unique").on(
      table.proposalId,
      table.category,
    ),
    index("cash_flow_proposal_categories_proposal_idx").on(
      table.proposalId,
      table.category,
    ),
    check(
      "cash_flow_proposal_categories_values_check",
      sql`${table.totalMinor} >= 0 AND ${table.averageMonthlyMinor} >= 0 AND ${table.transactionCount} > 0`,
    ),
    check(
      "cash_flow_proposal_categories_treatment_check",
      sql`${table.defaultTreatment} IN ('household', 'business', 'excluded', 'debt_payment')`,
    ),
    check(
      "cash_flow_proposal_categories_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const cashFlowReviewDecisions = sqliteTable(
  "cash_flow_review_decisions",
  {
    id: id("id"),
    householdId: householdReference(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => cashFlowProposals.id, { onDelete: "restrict" }),
    proposalCategoryId: text("proposal_category_id")
      .notNull()
      .references(() => cashFlowProposalCategories.id, {
        onDelete: "restrict",
      }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    treatment: text("treatment").notNull(),
    changeNote: text("change_note").notNull(),
    decidedAt: timestamp("decided_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("cash_flow_review_decisions_category_unique").on(
      table.proposalCategoryId,
    ),
    index("cash_flow_review_decisions_household_decided_idx").on(
      table.householdId,
      table.decidedAt,
    ),
    check(
      "cash_flow_review_decisions_treatment_check",
      sql`${table.treatment} IN ('household', 'business', 'excluded', 'debt_payment')`,
    ),
    check(
      "cash_flow_review_decisions_note_check",
      sql`length(${table.changeNote}) BETWEEN 1 AND 500`,
    ),
    check(
      "cash_flow_review_decisions_immutable_check",
      sql`${table.immutable} = 1`,
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
    normalizedFingerprint: text("normalized_fingerprint"),
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
      "holding_imports_normalized_fingerprint_check",
      sql`${table.normalizedFingerprint} IS NULL OR (length(${table.normalizedFingerprint}) = 64 AND ${table.normalizedFingerprint} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "holding_imports_row_count_check",
      sql`${table.rowCount} BETWEEN 0 AND 500`,
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
    investedOn: text("invested_on"),
    investedOnState: text("invested_on_state").notNull().default("reported"),
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
    positionKind: text("position_kind").notNull().default("spv_interest"),
    quantityMicros: integer("quantity_micros"),
    ticker: text("ticker"),
    costBasisMinor: integer("cost_basis_minor"),
    publicExposureIdentityKind: text("public_exposure_identity_kind"),
    protectedExposureKey: text("protected_exposure_key"),
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
    index("holding_import_rows_protected_exposure_idx")
      .on(table.householdId, table.protectedExposureKey)
      .where(sql`${table.protectedExposureKey} IS NOT NULL`),
    check(
      "holding_import_rows_provider_status_check",
      sql`${table.providerStatus} IN ('live', 'realized')`,
    ),
    check(
      "holding_import_rows_invested_on_state_check",
      sql`(${table.investedOnState} = 'reported' AND ${table.investedOn} IS NOT NULL) OR (${table.investedOnState} = 'not_reported' AND ${table.investedOn} IS NULL)`,
    ),
    check(
      "holding_import_rows_parse_status_check",
      sql`${table.parseStatus} IN ('ready', 'needs_attention')`,
    ),
    check(
      "holding_import_rows_issue_codes_json_check",
      sql`json_valid(${table.issueCodesJson})`,
    ),
    check(
      "holding_import_rows_position_kind_check",
      sql`${table.positionKind} IN ('direct', 'spv_interest', 'fund_interest')`,
    ),
    check(
      "holding_import_rows_public_values_check",
      sql`(${table.quantityMicros} IS NULL OR ${table.quantityMicros} >= 0) AND (${table.costBasisMinor} IS NULL OR ${table.costBasisMinor} >= 0) AND (${table.ticker} IS NULL OR length(${table.ticker}) BETWEEN 1 AND 32)`,
    ),
    check(
      "holding_import_rows_exposure_identity_check",
      sql`((${table.publicExposureIdentityKind} IS NULL) = (${table.protectedExposureKey} IS NULL)) AND (${table.publicExposureIdentityKind} IS NULL OR ${table.publicExposureIdentityKind} IN ('cusip', 'isin', 'sedol')) AND (${table.protectedExposureKey} IS NULL OR (length(${table.protectedExposureKey}) = 64 AND ${table.protectedExposureKey} NOT GLOB '*[^0-9a-f]*'))`,
    ),
  ],
);

export const holdingImportRowReportedEconomicsEvidence = sqliteTable(
  "holding_import_row_reported_economics_evidence",
  {
    id: id("id"),
    householdId: householdReference(),
    importRowId: text("import_row_id")
      .notNull()
      .references(() => holdingImportRows.id, { onDelete: "restrict" })
      .unique(),
    managementFeePpm: integer("management_fee_ppm"),
    carryPpm: integer("carry_ppm"),
    evidenceSha256: text("evidence_sha256").notNull(),
    derivationMethod: text("derivation_method").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("holding_import_row_reported_economics_household_row_idx").on(
      table.householdId,
      table.importRowId,
    ),
    check(
      "holding_import_row_reported_economics_values_check",
      sql`(${table.managementFeePpm} IS NULL OR ${table.managementFeePpm} BETWEEN 0 AND 1000000) AND (${table.carryPpm} IS NULL OR ${table.carryPpm} BETWEEN 0 AND 1000000) AND (${table.managementFeePpm} IS NOT NULL OR ${table.carryPpm} IS NOT NULL)`,
    ),
    check(
      "holding_import_row_reported_economics_hash_check",
      sql`length(${table.evidenceSha256}) = 64 AND ${table.evidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "holding_import_row_reported_economics_derivation_check",
      sql`${table.derivationMethod} IN ('angellist_export_carry_v1', 'sydecar_template_economics_v1')`,
    ),
    check(
      "holding_import_row_reported_economics_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingImportRowPublicExposureEvidence = sqliteTable(
  "holding_import_row_public_exposure_evidence",
  {
    id: id("id"),
    householdId: householdReference(),
    importRowId: text("import_row_id")
      .notNull()
      .references(() => holdingImportRows.id, { onDelete: "restrict" })
      .unique(),
    resolutionStatus: text("resolution_status").notNull(),
    identityKind: text("identity_kind"),
    protectedIdentityKey: text("protected_identity_key"),
    evidenceSha256: text("evidence_sha256").notNull(),
    derivationMethod: text("derivation_method").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("holding_import_row_public_exposure_evidence_key_idx")
      .on(table.householdId, table.protectedIdentityKey)
      .where(sql`${table.protectedIdentityKey} IS NOT NULL`),
    check(
      "holding_import_row_public_exposure_evidence_status_check",
      sql`${table.resolutionStatus} IN ('strong_identifier', 'no_strong_identifier')`,
    ),
    check(
      "holding_import_row_public_exposure_evidence_kind_check",
      sql`${table.identityKind} IS NULL OR ${table.identityKind} IN ('cusip', 'isin', 'sedol')`,
    ),
    check(
      "holding_import_row_public_exposure_evidence_key_check",
      sql`${table.protectedIdentityKey} IS NULL OR (length(${table.protectedIdentityKey}) = 64 AND ${table.protectedIdentityKey} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "holding_import_row_public_exposure_evidence_hash_check",
      sql`length(${table.evidenceSha256}) = 64 AND ${table.evidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "holding_import_row_public_exposure_evidence_derivation_check",
      sql`${table.derivationMethod} = 'retained_source_document'`,
    ),
    check(
      "holding_import_row_public_exposure_evidence_result_check",
      sql`(${table.resolutionStatus} = 'strong_identifier' AND ${table.identityKind} IS NOT NULL AND ${table.protectedIdentityKey} IS NOT NULL) OR (${table.resolutionStatus} = 'no_strong_identifier' AND ${table.identityKind} IS NULL AND ${table.protectedIdentityKey} IS NULL)`,
    ),
    check(
      "holding_import_row_public_exposure_evidence_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingImportRowProviderExposureEvidence = sqliteTable(
  "holding_import_row_provider_exposure_evidence",
  {
    id: id("id"),
    householdId: householdReference(),
    importRowId: text("import_row_id")
      .notNull()
      .references(() => holdingImportRows.id, { onDelete: "restrict" })
      .unique(),
    resolutionStatus: text("resolution_status").notNull(),
    protectedIdentityKey: text("protected_identity_key"),
    evidenceSha256: text("evidence_sha256").notNull(),
    derivationMethod: text("derivation_method").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("holding_import_row_provider_exposure_evidence_key_idx")
      .on(table.householdId, table.protectedIdentityKey)
      .where(sql`${table.protectedIdentityKey} IS NOT NULL`),
    check(
      "holding_import_row_provider_exposure_evidence_status_check",
      sql`${table.resolutionStatus} IN ('scoped_identifier', 'not_eligible')`,
    ),
    check(
      "holding_import_row_provider_exposure_evidence_key_check",
      sql`${table.protectedIdentityKey} IS NULL OR (length(${table.protectedIdentityKey}) = 64 AND ${table.protectedIdentityKey} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "holding_import_row_provider_exposure_evidence_hash_check",
      sql`length(${table.evidenceSha256}) = 64 AND ${table.evidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "holding_import_row_provider_exposure_evidence_derivation_check",
      sql`${table.derivationMethod} = 'retained_source_provider_security_v1'`,
    ),
    check(
      "holding_import_row_provider_exposure_evidence_result_check",
      sql`(${table.resolutionStatus} = 'scoped_identifier' AND ${table.protectedIdentityKey} IS NOT NULL) OR (${table.resolutionStatus} = 'not_eligible' AND ${table.protectedIdentityKey} IS NULL)`,
    ),
    check(
      "holding_import_row_provider_exposure_evidence_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingImportRowStructuredAssetExposureEvidence = sqliteTable(
  "holding_import_row_structured_asset_exposure_evidence",
  {
    id: id("id"),
    householdId: householdReference(),
    importRowId: text("import_row_id")
      .notNull()
      .references(() => holdingImportRows.id, { onDelete: "restrict" })
      .unique(),
    resolutionStatus: text("resolution_status").notNull(),
    identityKind: text("identity_kind"),
    protectedIdentityKey: text("protected_identity_key"),
    currencyCode: text("currency_code"),
    evidenceSha256: text("evidence_sha256").notNull(),
    derivationMethod: text("derivation_method").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("holding_import_row_structured_asset_exposure_evidence_key_idx")
      .on(table.householdId, table.protectedIdentityKey)
      .where(sql`${table.protectedIdentityKey} IS NOT NULL`),
    check(
      "holding_import_row_structured_asset_exposure_evidence_status_check",
      sql`${table.resolutionStatus} IN ('structured_identifier', 'not_eligible')`,
    ),
    check(
      "holding_import_row_structured_asset_exposure_evidence_kind_check",
      sql`${table.identityKind} IS NULL OR ${table.identityKind} IN ('cash_currency', 'provider_crypto')`,
    ),
    check(
      "holding_import_row_structured_asset_exposure_evidence_key_check",
      sql`${table.protectedIdentityKey} IS NULL OR (length(${table.protectedIdentityKey}) = 64 AND ${table.protectedIdentityKey} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "holding_import_row_structured_asset_exposure_evidence_currency_check",
      sql`${table.currencyCode} IS NULL OR ${table.currencyCode} = 'USD'`,
    ),
    check(
      "holding_import_row_structured_asset_exposure_evidence_hash_check",
      sql`length(${table.evidenceSha256}) = 64 AND ${table.evidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "holding_import_row_structured_asset_exposure_evidence_derivation_check",
      sql`${table.derivationMethod} = 'retained_source_structured_asset_v1'`,
    ),
    check(
      "holding_import_row_structured_asset_exposure_evidence_result_check",
      sql`(${table.resolutionStatus} = 'structured_identifier' AND ${table.identityKind} = 'cash_currency' AND ${table.protectedIdentityKey} IS NOT NULL AND ${table.currencyCode} = 'USD') OR (${table.resolutionStatus} = 'structured_identifier' AND ${table.identityKind} = 'provider_crypto' AND ${table.protectedIdentityKey} IS NOT NULL AND ${table.currencyCode} IS NULL) OR (${table.resolutionStatus} = 'not_eligible' AND ${table.identityKind} IS NULL AND ${table.protectedIdentityKey} IS NULL AND ${table.currencyCode} IS NULL)`,
    ),
    check(
      "holding_import_row_structured_asset_exposure_evidence_immutable_check",
      sql`${table.immutable} = 1`,
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
    quantityMicros: integer("quantity_micros"),
    ticker: text("ticker"),
    costBasisMinor: integer("cost_basis_minor"),
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
    check(
      "holding_position_snapshots_public_values_check",
      sql`(${table.quantityMicros} IS NULL OR ${table.quantityMicros} >= 0) AND (${table.costBasisMinor} IS NULL OR ${table.costBasisMinor} >= 0) AND (${table.ticker} IS NULL OR length(${table.ticker}) BETWEEN 1 AND 32)`,
    ),
  ],
);

export const holdingPositionValueProposals = sqliteTable(
  "holding_position_value_proposals",
  {
    id: id("id"),
    householdId: householdReference(),
    positionId: text("position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => holdingPositionSnapshots.id, {
        onDelete: "restrict",
      }),
    supersedesProposalId: text("supersedes_proposal_id"),
    priorValueState: text("prior_value_state").notNull(),
    priorValueMinor: integer("prior_value_minor"),
    valueMinor: integer("value_minor").notNull(),
    currency: text("currency").notNull(),
    effectiveDate: text("effective_date").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceLabel: text("source_label").notNull(),
    sourceUrl: text("source_url"),
    commentary: text("commentary").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesProposalId],
      foreignColumns: [table.id],
      name: "holding_position_value_proposals_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("holding_position_value_proposals_roots_unique")
      .on(table.positionId)
      .where(sql`${table.supersedesProposalId} IS NULL`),
    uniqueIndex("holding_position_value_proposals_supersedes_unique")
      .on(table.supersedesProposalId)
      .where(sql`${table.supersedesProposalId} IS NOT NULL`),
    index("holding_position_value_proposals_household_position_idx").on(
      table.householdId,
      table.positionId,
      table.createdAt,
    ),
    check(
      "holding_position_value_proposals_prior_value_state_check",
      sql`${table.priorValueState} IN ('reported', 'locked', 'not_reported')`,
    ),
    check(
      "holding_position_value_proposals_prior_value_check",
      sql`${table.priorValueMinor} IS NULL OR ${table.priorValueMinor} >= 0`,
    ),
    check(
      "holding_position_value_proposals_value_check",
      sql`${table.valueMinor} >= 0`,
    ),
    check(
      "holding_position_value_proposals_currency_check",
      sql`length(${table.currency}) = 3 AND ${table.currency} = upper(${table.currency})`,
    ),
    check(
      "holding_position_value_proposals_source_kind_check",
      sql`${table.sourceKind} IN ('gp_update', 'news_article', 'other')`,
    ),
    check(
      "holding_position_value_proposals_source_label_check",
      sql`length(${table.sourceLabel}) BETWEEN 1 AND 240`,
    ),
    check(
      "holding_position_value_proposals_source_url_check",
      sql`${table.sourceUrl} IS NULL OR (length(${table.sourceUrl}) <= 2048 AND ${table.sourceUrl} LIKE 'https://%')`,
    ),
    check(
      "holding_position_value_proposals_commentary_check",
      sql`length(${table.commentary}) BETWEEN 3 AND 1000`,
    ),
    check(
      "holding_position_value_proposals_prior_state_check",
      sql`(${table.priorValueState} = 'reported' AND ${table.priorValueMinor} IS NOT NULL) OR (${table.priorValueState} <> 'reported' AND ${table.priorValueMinor} IS NULL)`,
    ),
    check(
      "holding_position_value_proposals_news_url_check",
      sql`${table.sourceKind} <> 'news_article' OR ${table.sourceUrl} IS NOT NULL`,
    ),
    check(
      "holding_position_value_proposals_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingPositionValueReviews = sqliteTable(
  "holding_position_value_reviews",
  {
    id: id("id"),
    householdId: householdReference(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => holdingPositionValueProposals.id, {
        onDelete: "restrict",
      }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    decidedAt: timestamp("decided_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("holding_position_value_reviews_proposal_unique").on(
      table.proposalId,
    ),
    index("holding_position_value_reviews_household_decided_idx").on(
      table.householdId,
      table.decidedAt,
    ),
    check(
      "holding_position_value_reviews_decision_check",
      sql`${table.decision} IN ('accepted', 'rejected')`,
    ),
    check(
      "holding_position_value_reviews_rationale_check",
      sql`length(${table.rationale}) BETWEEN 3 AND 1000`,
    ),
    check(
      "holding_position_value_reviews_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingPositionEconomicsProposals = sqliteTable(
  "holding_position_economics_proposals",
  {
    id: id("id"),
    householdId: householdReference(),
    positionId: text("position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => holdingPositionSnapshots.id, {
        onDelete: "restrict",
      }),
    supersedesProposalId: text("supersedes_proposal_id"),
    commitmentMinor: integer("commitment_minor").notNull(),
    fundedMinor: integer("funded_minor").notNull(),
    annualAdminFeePpm: integer("annual_admin_fee_ppm").notNull(),
    adminFeeYears: integer("admin_fee_years").notNull(),
    carryPpm: integer("carry_ppm").notNull(),
    note: text("note").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesProposalId],
      foreignColumns: [table.id],
      name: "holding_position_economics_proposals_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("holding_position_economics_proposals_roots_unique")
      .on(table.positionId)
      .where(sql`${table.supersedesProposalId} IS NULL`),
    uniqueIndex("holding_position_economics_proposals_supersedes_unique")
      .on(table.supersedesProposalId)
      .where(sql`${table.supersedesProposalId} IS NOT NULL`),
    index("holding_position_economics_proposals_household_position_idx").on(
      table.householdId,
      table.positionId,
      table.createdAt,
    ),
    check(
      "holding_position_economics_proposals_amounts_check",
      sql`${table.commitmentMinor} > 0 AND ${table.fundedMinor} >= 0`,
    ),
    check(
      "holding_position_economics_proposals_fee_check",
      sql`${table.annualAdminFeePpm} BETWEEN 0 AND 1000000 AND ${table.adminFeeYears} BETWEEN 1 AND 100 AND ${table.annualAdminFeePpm} * ${table.adminFeeYears} <= 1000000`,
    ),
    check(
      "holding_position_economics_proposals_carry_check",
      sql`${table.carryPpm} BETWEEN 0 AND 1000000`,
    ),
    check(
      "holding_position_economics_proposals_note_check",
      sql`length(${table.note}) BETWEEN 3 AND 500`,
    ),
    check(
      "holding_position_economics_proposals_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingPositionEconomicsReviews = sqliteTable(
  "holding_position_economics_reviews",
  {
    id: id("id"),
    householdId: householdReference(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => holdingPositionEconomicsProposals.id, {
        onDelete: "restrict",
      }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    decidedAt: timestamp("decided_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("holding_position_economics_reviews_proposal_unique").on(
      table.proposalId,
    ),
    index("holding_position_economics_reviews_household_decided_idx").on(
      table.householdId,
      table.decidedAt,
    ),
    check(
      "holding_position_economics_reviews_decision_check",
      sql`${table.decision} IN ('accepted', 'rejected')`,
    ),
    check(
      "holding_position_economics_reviews_rationale_check",
      sql`length(${table.rationale}) BETWEEN 3 AND 1000`,
    ),
    check(
      "holding_position_economics_reviews_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const connectorSyncImports = sqliteTable(
  "connector_sync_imports",
  {
    id: id("id"),
    householdId: householdReference(),
    syncRunId: text("sync_run_id")
      .notNull()
      .references(() => connectorSyncRuns.id, { onDelete: "restrict" }),
    holdingImportId: text("holding_import_id")
      .notNull()
      .references(() => holdingImports.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("connector_sync_imports_run_unique").on(table.syncRunId),
    uniqueIndex("connector_sync_imports_import_unique").on(
      table.holdingImportId,
    ),
    index("connector_sync_imports_household_created_idx").on(
      table.householdId,
      table.createdAt,
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
    decisionSource: text("decision_source").notNull().default("manual"),
    policyVersion: text("policy_version"),
    reasonCodesJson: text("reason_codes_json").notNull().default("[]"),
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
    check(
      "holding_import_row_decisions_source_check",
      sql`${table.decisionSource} IN ('manual', 'policy')`,
    ),
  ],
);

export const holdingImportQuarantines = sqliteTable(
  "holding_import_quarantines",
  {
    id: id("id"),
    householdId: householdReference(),
    importId: text("import_id")
      .notNull()
      .references(() => holdingImports.id, { onDelete: "restrict" }),
    importRowId: text("import_row_id").references(() => holdingImportRows.id, {
      onDelete: "restrict",
    }),
    positionId: text("position_id").references(() => holdingPositions.id, {
      onDelete: "restrict",
    }),
    reasonCode: text("reason_code").notNull(),
    policyVersion: text("policy_version").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    detail: text("detail").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("holding_import_quarantines_row_unique")
      .on(table.importId, table.importRowId)
      .where(sql`${table.importRowId} IS NOT NULL`),
    uniqueIndex("holding_import_quarantines_position_unique")
      .on(table.importId, table.positionId)
      .where(sql`${table.positionId} IS NOT NULL`),
    index("holding_import_quarantines_household_created_idx").on(
      table.householdId,
      table.createdAt,
    ),
    check(
      "holding_import_quarantines_reason_check",
      sql`${table.reasonCode} IN ('row_validation_failed', 'possible_identity_change', 'position_not_reported')`,
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

export const portfolioBaselines = sqliteTable(
  "portfolio_baselines",
  {
    id: id("id"),
    householdId: householdReference(),
    sourceRevision: text("source_revision").notNull(),
    sourceObservedAt: timestamp("source_observed_at"),
    positionCount: integer("position_count").notNull(),
    publicMarketValueMinor: integer("public_market_value_minor").notNull(),
    privatePaperValueMinor: integer("private_paper_value_minor").notNull(),
    cashAccountCount: integer("cash_account_count").notNull(),
    cashAccountValueMinor: integer("cash_account_value_minor").notNull(),
    unknownCashAccountCount: integer("unknown_cash_account_count").notNull(),
    unknownValueCount: integer("unknown_value_count").notNull(),
    potentialDuplicateCount: integer("potential_duplicate_count").notNull(),
    priorFiEligibleLiquidMinor: integer(
      "prior_fi_eligible_liquid_minor",
    ).notNull(),
    fiEligibleLiquidMinor: integer("fi_eligible_liquid_minor").notNull(),
    baseForecastSnapshotId: text("base_forecast_snapshot_id")
      .notNull()
      .references(() => forecastSnapshots.id, { onDelete: "restrict" }),
    cashFlowPlanId: text("cash_flow_plan_id")
      .notNull()
      .references(() => cashFlowPlans.id, { onDelete: "restrict" }),
    forecastSnapshotId: text("forecast_snapshot_id")
      .notNull()
      .references(() => forecastSnapshots.id, { onDelete: "restrict" }),
    goalVersionId: text("goal_version_id").references(() => goalVersions.id, {
      onDelete: "restrict",
    }),
    changeNote: text("change_note").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("portfolio_baselines_household_created_idx").on(
      table.householdId,
      table.createdAt,
    ),
    uniqueIndex("portfolio_baselines_forecast_snapshot_unique").on(
      table.forecastSnapshotId,
    ),
    uniqueIndex("portfolio_baselines_cash_flow_plan_unique").on(
      table.cashFlowPlanId,
    ),
    check(
      "portfolio_baselines_source_revision_check",
      sql`length(${table.sourceRevision}) = 64 AND ${table.sourceRevision} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "portfolio_baselines_counts_check",
      sql`${table.positionCount} > 0 AND ${table.unknownValueCount} BETWEEN 0 AND ${table.positionCount} AND ${table.potentialDuplicateCount} BETWEEN 0 AND ${table.positionCount} AND ${table.cashAccountCount} >= 0 AND ${table.unknownCashAccountCount} BETWEEN 0 AND ${table.cashAccountCount}`,
    ),
    check(
      "portfolio_baselines_values_check",
      sql`${table.publicMarketValueMinor} >= 0 AND ${table.privatePaperValueMinor} >= 0 AND ${table.cashAccountValueMinor} >= 0 AND ${table.priorFiEligibleLiquidMinor} >= 0 AND ${table.fiEligibleLiquidMinor} >= 0`,
    ),
    check(
      "portfolio_baselines_note_check",
      sql`length(${table.changeNote}) BETWEEN 1 AND 500`,
    ),
    check("portfolio_baselines_immutable_check", sql`${table.immutable} = 1`),
  ],
);

export const portfolioBaselinePolicyDecisions = sqliteTable(
  "portfolio_baseline_policy_decisions",
  {
    baselineId: text("baseline_id")
      .primaryKey()
      .references(() => portfolioBaselines.id, { onDelete: "restrict" }),
    priorBaselineId: text("prior_baseline_id")
      .notNull()
      .references(() => portfolioBaselines.id, { onDelete: "restrict" }),
    policyVersion: text("policy_version", {
      enum: ["accepted-sources-auto-v1"],
    }).notNull(),
  },
);

export const portfolioBaselineItems = sqliteTable(
  "portfolio_baseline_items",
  {
    id: id("id"),
    householdId: householdReference(),
    baselineId: text("baseline_id")
      .notNull()
      .references(() => portfolioBaselines.id, { onDelete: "restrict" }),
    positionId: text("position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => holdingPositionSnapshots.id, {
        onDelete: "restrict",
      }),
    provider: text("provider").notNull(),
    classification: text("classification").notNull(),
    valueMinor: integer("value_minor"),
    valueState: text("value_state").notNull(),
    observedAt: timestamp("observed_at"),
    duplicateKey: text("duplicate_key"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("portfolio_baseline_items_baseline_position_unique").on(
      table.baselineId,
      table.positionId,
    ),
    index("portfolio_baseline_items_baseline_idx").on(
      table.baselineId,
      table.positionId,
    ),
    check(
      "portfolio_baseline_items_provider_check",
      sql`${table.provider} IN ('angellist', 'tokenfolio', 'sydecar', 'plaid_investments')`,
    ),
    check(
      "portfolio_baseline_items_classification_check",
      sql`${table.classification} IN ('public_market', 'private_paper')`,
    ),
    check(
      "portfolio_baseline_items_value_check",
      sql`${table.valueMinor} IS NULL OR ${table.valueMinor} >= 0`,
    ),
    check(
      "portfolio_baseline_items_state_check",
      sql`${table.valueState} IN ('reported', 'locked', 'not_reported')`,
    ),
    check(
      "portfolio_baseline_items_provider_classification_check",
      sql`(${table.provider} = 'plaid_investments' AND ${table.classification} = 'public_market') OR (${table.provider} IN ('angellist', 'tokenfolio', 'sydecar') AND ${table.classification} = 'private_paper')`,
    ),
    check(
      "portfolio_baseline_items_value_state_check",
      sql`(${table.valueState} = 'reported' AND ${table.valueMinor} IS NOT NULL) OR (${table.valueState} <> 'reported' AND ${table.valueMinor} IS NULL)`,
    ),
  ],
);

export const portfolioBaselineCashItems = sqliteTable(
  "portfolio_baseline_cash_items",
  {
    id: id("id"),
    householdId: householdReference(),
    baselineId: text("baseline_id")
      .notNull()
      .references(() => portfolioBaselines.id, { onDelete: "restrict" }),
    reviewDecisionId: text("review_decision_id")
      .notNull()
      .references(() => cashBalanceReviewDecisions.id, {
        onDelete: "restrict",
      }),
    proposalRowId: text("proposal_row_id")
      .notNull()
      .references(() => cashBalanceProposalRows.id, { onDelete: "restrict" }),
    naturalKeySha256: text("natural_key_sha256").notNull(),
    valueMinor: integer("value_minor"),
    valueState: text("value_state").notNull(),
    observedAt: timestamp("observed_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("portfolio_baseline_cash_items_baseline_key_unique").on(
      table.baselineId,
      table.naturalKeySha256,
    ),
    index("portfolio_baseline_cash_items_baseline_idx").on(
      table.baselineId,
      table.naturalKeySha256,
    ),
    check(
      "portfolio_baseline_cash_items_key_check",
      sql`length(${table.naturalKeySha256}) = 64 AND ${table.naturalKeySha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "portfolio_baseline_cash_items_value_state_check",
      sql`${table.valueState} IN ('reported', 'not_reported')`,
    ),
    check(
      "portfolio_baseline_cash_items_value_check",
      sql`(${table.valueState} = 'reported' AND ${table.valueMinor} IS NOT NULL AND ${table.valueMinor} >= 0) OR (${table.valueState} = 'not_reported' AND ${table.valueMinor} IS NULL)`,
    ),
  ],
);

export const investmentConnections = sqliteTable(
  "investment_connections",
  {
    id: id("id"),
    householdId: householdReference(),
    adapterType: text("adapter_type").notNull(),
    protectedSourceKey: text("protected_source_key").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("investment_connections_household_source_unique").on(
      table.householdId,
      table.adapterType,
      table.protectedSourceKey,
    ),
    index("investment_connections_household_created_idx").on(
      table.householdId,
      table.createdAt,
    ),
    check(
      "investment_connections_adapter_check",
      sql`${table.adapterType} IN ('plaid-investments', 'angellist-import', 'manual')`,
    ),
    check(
      "investment_connections_source_key_check",
      sql`length(${table.protectedSourceKey}) = 64 AND ${table.protectedSourceKey} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "investment_connections_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const investmentConnectionVersions = sqliteTable(
  "investment_connection_versions",
  {
    id: id("id"),
    householdId: householdReference(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => investmentConnections.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    institutionKey: text("institution_key").notNull(),
    institutionLabel: text("institution_label").notNull(),
    lifecycleState: text("lifecycle_state").notNull(),
    credentialReference: text("credential_reference"),
    supersedesVersionId: text("supersedes_version_id"),
    recordedByUserId: text("recorded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesVersionId],
      foreignColumns: [table.id],
      name: "investment_connection_versions_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("investment_connection_versions_supersedes_unique").on(
      table.supersedesVersionId,
    ),
    uniqueIndex("investment_connection_versions_connection_version_unique").on(
      table.connectionId,
      table.version,
    ),
    index("investment_connection_versions_household_connection_idx").on(
      table.householdId,
      table.connectionId,
      table.version,
    ),
    check(
      "investment_connection_versions_version_check",
      sql`${table.version} > 0 AND ((${table.version} = 1 AND ${table.supersedesVersionId} IS NULL) OR (${table.version} > 1 AND ${table.supersedesVersionId} IS NOT NULL))`,
    ),
    check(
      "investment_connection_versions_metadata_check",
      sql`length(${table.institutionKey}) BETWEEN 1 AND 200 AND length(${table.institutionLabel}) BETWEEN 1 AND 512`,
    ),
    check(
      "investment_connection_versions_lifecycle_check",
      sql`${table.lifecycleState} IN ('pending', 'active', 'paused', 'disconnected')`,
    ),
    check(
      "investment_connection_versions_reference_check",
      sql`${table.credentialReference} IS NULL OR (length(${table.credentialReference}) BETWEEN 1 AND 1024 AND ${table.credentialReference} NOT GLOB '*[^A-Za-z0-9._/-]*' AND substr(${table.credentialReference}, 1, 1) GLOB '[A-Za-z0-9]')`,
    ),
    check(
      "investment_connection_versions_disconnect_check",
      sql`${table.lifecycleState} <> 'disconnected' OR ${table.credentialReference} IS NULL`,
    ),
    check(
      "investment_connection_versions_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const ownershipContainers = sqliteTable(
  "ownership_containers",
  {
    id: id("id"),
    householdId: householdReference(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => investmentConnections.id, { onDelete: "restrict" }),
    protectedAccountKey: text("protected_account_key").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("ownership_containers_connection_account_unique").on(
      table.connectionId,
      table.protectedAccountKey,
    ),
    index("ownership_containers_household_connection_idx").on(
      table.householdId,
      table.connectionId,
      table.createdAt,
    ),
    check(
      "ownership_containers_account_key_check",
      sql`length(${table.protectedAccountKey}) = 64 AND ${table.protectedAccountKey} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check("ownership_containers_immutable_check", sql`${table.immutable} = 1`),
  ],
);

export const ownershipContainerVersions = sqliteTable(
  "ownership_container_versions",
  {
    id: id("id"),
    householdId: householdReference(),
    containerId: text("container_id")
      .notNull()
      .references(() => ownershipContainers.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    displayLabel: text("display_label").notNull(),
    containerKind: text("container_kind").notNull(),
    taxTreatment: text("tax_treatment").notNull(),
    supersedesVersionId: text("supersedes_version_id"),
    recordedByUserId: text("recorded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesVersionId],
      foreignColumns: [table.id],
      name: "ownership_container_versions_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("ownership_container_versions_supersedes_unique").on(
      table.supersedesVersionId,
    ),
    uniqueIndex("ownership_container_versions_container_version_unique").on(
      table.containerId,
      table.version,
    ),
    index("ownership_container_versions_household_container_idx").on(
      table.householdId,
      table.containerId,
      table.version,
    ),
    check(
      "ownership_container_versions_version_check",
      sql`${table.version} > 0 AND ((${table.version} = 1 AND ${table.supersedesVersionId} IS NULL) OR (${table.version} > 1 AND ${table.supersedesVersionId} IS NOT NULL))`,
    ),
    check(
      "ownership_container_versions_label_check",
      sql`length(${table.displayLabel}) BETWEEN 1 AND 512`,
    ),
    check(
      "ownership_container_versions_kind_check",
      sql`${table.containerKind} IN ('brokerage', 'ira', 'retirement', 'trust', 'entity', 'unresolved', 'other')`,
    ),
    check(
      "ownership_container_versions_tax_check",
      sql`${table.taxTreatment} IN ('taxable', 'tax_deferred', 'tax_exempt', 'unknown')`,
    ),
    check(
      "ownership_container_versions_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingPositionOwnerships = sqliteTable(
  "holding_position_ownerships",
  {
    id: id("id"),
    householdId: householdReference(),
    containerId: text("container_id")
      .notNull()
      .references(() => ownershipContainers.id, { onDelete: "restrict" }),
    positionId: text("position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    protectedPositionKey: text("protected_position_key").notNull(),
    associationBasis: text("association_basis").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    version: integer("version").notNull(),
    supersedesOwnershipId: text("supersedes_ownership_id"),
    acceptedByUserId: text("accepted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    acceptedAt: timestamp("accepted_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesOwnershipId],
      foreignColumns: [table.id],
      name: "holding_position_ownerships_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("holding_position_ownerships_supersedes_unique").on(
      table.supersedesOwnershipId,
    ),
    uniqueIndex("holding_position_ownership_roots_unique")
      .on(table.positionId)
      .where(sql`${table.supersedesOwnershipId} IS NULL`),
    uniqueIndex("holding_position_ownerships_position_version_unique").on(
      table.positionId,
      table.version,
    ),
    uniqueIndex("holding_position_ownerships_container_position_key_unique").on(
      table.containerId,
      table.protectedPositionKey,
    ),
    index("holding_position_ownerships_household_container_idx").on(
      table.householdId,
      table.containerId,
      table.positionId,
      table.version,
    ),
    check(
      "holding_position_ownerships_position_key_check",
      sql`length(${table.protectedPositionKey}) = 64 AND ${table.protectedPositionKey} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "holding_position_ownerships_basis_check",
      sql`${table.associationBasis} IN ('provider_provenance', 'reviewed_import', 'manual')`,
    ),
    check(
      "holding_position_ownerships_evidence_check",
      sql`length(${table.evidenceSha256}) = 64 AND ${table.evidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "holding_position_ownerships_version_check",
      sql`${table.version} > 0 AND ((${table.version} = 1 AND ${table.supersedesOwnershipId} IS NULL) OR (${table.version} > 1 AND ${table.supersedesOwnershipId} IS NOT NULL))`,
    ),
    check(
      "holding_position_ownerships_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const legalEntities = sqliteTable(
  "legal_entities",
  {
    id: id("id"),
    householdId: householdReference(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("legal_entities_household_created_idx").on(
      table.householdId,
      table.createdAt,
      table.id,
    ),
    check("legal_entities_immutable_check", sql`${table.immutable} = 1`),
  ],
);

export const legalEntityVersions = sqliteTable(
  "legal_entity_versions",
  {
    id: id("id"),
    householdId: householdReference(),
    legalEntityId: text("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    legalName: text("legal_name").notNull(),
    entityType: text("entity_type").notNull(),
    relationship: text("relationship").notNull(),
    currentOwner: text("current_owner"),
    jurisdiction: text("jurisdiction"),
    formedOn: text("formed_on"),
    einLastFour: text("ein_last_four"),
    ownershipInterestPpm: integer("ownership_interest_ppm"),
    interestStatus: text("interest_status").notNull(),
    taxClassification: text("tax_classification"),
    notes: text("notes"),
    supersedesVersionId: text("supersedes_version_id"),
    recordedByUserId: text("recorded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesVersionId],
      foreignColumns: [table.id],
      name: "legal_entity_versions_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("legal_entity_versions_supersedes_unique").on(
      table.supersedesVersionId,
    ),
    uniqueIndex("legal_entity_versions_entity_version_unique").on(
      table.legalEntityId,
      table.version,
    ),
    index("legal_entity_versions_household_entity_idx").on(
      table.householdId,
      table.legalEntityId,
      table.version,
    ),
    check(
      "legal_entity_versions_version_check",
      sql`${table.version} > 0 AND ((${table.version} = 1 AND ${table.supersedesVersionId} IS NULL) OR (${table.version} > 1 AND ${table.supersedesVersionId} IS NOT NULL))`,
    ),
    check(
      "legal_entity_versions_name_check",
      sql`length(${table.legalName}) BETWEEN 1 AND 1000`,
    ),
    check(
      "legal_entity_versions_type_check",
      sql`${table.entityType} IN ('llc', 'limited_partnership', 'corporation', 'partnership', 'trust', 'other')`,
    ),
    check(
      "legal_entity_versions_relationship_check",
      sql`${table.relationship} IN ('direct_interest', 'ownership_entity', 'operating_entity', 'investment_vehicle', 'other')`,
    ),
    check(
      "legal_entity_versions_owner_check",
      sql`${table.currentOwner} IS NULL OR length(${table.currentOwner}) BETWEEN 1 AND 1000`,
    ),
    check(
      "legal_entity_versions_jurisdiction_check",
      sql`${table.jurisdiction} IS NULL OR length(${table.jurisdiction}) BETWEEN 1 AND 240`,
    ),
    check(
      "legal_entity_versions_formed_on_check",
      sql`${table.formedOn} IS NULL OR length(${table.formedOn}) = 10`,
    ),
    check(
      "legal_entity_versions_ein_check",
      sql`${table.einLastFour} IS NULL OR (length(${table.einLastFour}) = 4 AND ${table.einLastFour} NOT GLOB '*[^0-9]*')`,
    ),
    check(
      "legal_entity_versions_ownership_check",
      sql`${table.ownershipInterestPpm} IS NULL OR ${table.ownershipInterestPpm} BETWEEN 0 AND 1000000`,
    ),
    check(
      "legal_entity_versions_status_check",
      sql`${table.interestStatus} IN ('current', 'historical', 'unknown')`,
    ),
    check(
      "legal_entity_versions_tax_check",
      sql`${table.taxClassification} IS NULL OR length(${table.taxClassification}) BETWEEN 1 AND 240`,
    ),
    check(
      "legal_entity_versions_notes_check",
      sql`${table.notes} IS NULL OR length(${table.notes}) BETWEEN 1 AND 2000`,
    ),
    check("legal_entity_versions_immutable_check", sql`${table.immutable} = 1`),
  ],
);

export const legalEntitySourceDecisions = sqliteTable(
  "legal_entity_source_decisions",
  {
    id: id("id"),
    householdId: householdReference(),
    sourceKind: text("source_kind").notNull(),
    sourceReference: text("source_reference").notNull(),
    sourceName: text("source_name").notNull(),
    sourceLabel: text("source_label").notNull(),
    sourceAsOf: text("source_as_of").notNull(),
    relationship: text("relationship").notNull(),
    currentOwner: text("current_owner"),
    interestStatus: text("interest_status").notNull(),
    openedOn: text("opened_on"),
    decision: text("decision").notNull(),
    legalEntityId: text("legal_entity_id").references(() => legalEntities.id, {
      onDelete: "restrict",
    }),
    version: integer("version").notNull(),
    supersedesDecisionId: text("supersedes_decision_id"),
    decidedByUserId: text("decided_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesDecisionId],
      foreignColumns: [table.id],
      name: "legal_entity_source_decisions_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("legal_entity_source_decisions_supersedes_unique").on(
      table.supersedesDecisionId,
    ),
    uniqueIndex("legal_entity_source_decisions_root_unique")
      .on(table.sourceKind, table.sourceReference)
      .where(sql`${table.supersedesDecisionId} IS NULL`),
    uniqueIndex("legal_entity_source_decisions_source_version_unique").on(
      table.sourceKind,
      table.sourceReference,
      table.version,
    ),
    index("legal_entity_source_decisions_household_source_idx").on(
      table.householdId,
      table.sourceKind,
      table.sourceReference,
      table.version,
    ),
    index("legal_entity_source_decisions_household_entity_idx").on(
      table.householdId,
      table.legalEntityId,
      table.version,
    ),
    check(
      "legal_entity_source_decisions_source_check",
      sql`${table.sourceKind} IN ('ownership_container', 'holding_position') AND length(${table.sourceReference}) BETWEEN 1 AND 500`,
    ),
    check(
      "legal_entity_source_decisions_metadata_check",
      sql`length(${table.sourceName}) BETWEEN 1 AND 1000 AND length(${table.sourceLabel}) BETWEEN 1 AND 1000 AND length(${table.sourceAsOf}) = 10`,
    ),
    check(
      "legal_entity_source_decisions_relationship_check",
      sql`${table.relationship} IN ('direct_interest', 'ownership_entity', 'operating_entity', 'investment_vehicle', 'other')`,
    ),
    check(
      "legal_entity_source_decisions_owner_check",
      sql`${table.currentOwner} IS NULL OR length(${table.currentOwner}) BETWEEN 1 AND 1000`,
    ),
    check(
      "legal_entity_source_decisions_status_check",
      sql`${table.interestStatus} IN ('current', 'historical', 'unknown')`,
    ),
    check(
      "legal_entity_source_decisions_opened_on_check",
      sql`${table.openedOn} IS NULL OR length(${table.openedOn}) = 10`,
    ),
    check(
      "legal_entity_source_decisions_decision_check",
      sql`(${table.decision} = 'linked' AND ${table.legalEntityId} IS NOT NULL) OR (${table.decision} = 'not_llc' AND ${table.legalEntityId} IS NULL)`,
    ),
    check(
      "legal_entity_source_decisions_version_check",
      sql`${table.version} > 0 AND ((${table.version} = 1 AND ${table.supersedesDecisionId} IS NULL) OR (${table.version} > 1 AND ${table.supersedesDecisionId} IS NOT NULL))`,
    ),
    check(
      "legal_entity_source_decisions_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingPositionContinuities = sqliteTable(
  "holding_position_continuities",
  {
    id: id("id"),
    householdId: householdReference(),
    predecessorPositionId: text("predecessor_position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    predecessorSnapshotId: text("predecessor_snapshot_id")
      .notNull()
      .references(() => holdingPositionSnapshots.id, {
        onDelete: "restrict",
      }),
    successorPositionId: text("successor_position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    successorSnapshotId: text("successor_snapshot_id")
      .notNull()
      .references(() => holdingPositionSnapshots.id, {
        onDelete: "restrict",
      }),
    resolutionMethod: text("resolution_method").notNull(),
    recordedByUserId: text("recorded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("holding_position_continuities_predecessor_unique").on(
      table.predecessorPositionId,
    ),
    uniqueIndex("holding_position_continuities_successor_unique").on(
      table.successorPositionId,
    ),
    index("holding_position_continuities_household_idx").on(
      table.householdId,
      table.predecessorPositionId,
      table.successorPositionId,
    ),
    check(
      "holding_position_continuities_positions_check",
      sql`${table.predecessorPositionId} <> ${table.successorPositionId}`,
    ),
    check(
      "holding_position_continuities_resolution_check",
      sql`${table.resolutionMethod} = 'exact_reconnect_snapshot_v1'`,
    ),
    check(
      "holding_position_continuities_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingImportConnections = sqliteTable(
  "holding_import_connections",
  {
    id: id("id"),
    householdId: householdReference(),
    importId: text("import_id")
      .notNull()
      .references(() => holdingImports.id, { onDelete: "restrict" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => investmentConnections.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("holding_import_connections_import_unique").on(table.importId),
    index("holding_import_connections_household_connection_idx").on(
      table.householdId,
      table.connectionId,
      table.createdAt,
    ),
    check(
      "holding_import_connections_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingImportRowContainers = sqliteTable(
  "holding_import_row_containers",
  {
    id: id("id"),
    householdId: householdReference(),
    importRowId: text("import_row_id")
      .notNull()
      .references(() => holdingImportRows.id, { onDelete: "restrict" }),
    containerId: text("container_id")
      .notNull()
      .references(() => ownershipContainers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("holding_import_row_containers_row_unique").on(
      table.importRowId,
    ),
    index("holding_import_row_containers_household_container_idx").on(
      table.householdId,
      table.containerId,
      table.importRowId,
    ),
    check(
      "holding_import_row_containers_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const holdingImportCoverages = sqliteTable(
  "holding_import_coverages",
  {
    id: id("id"),
    householdId: householdReference(),
    importId: text("import_id")
      .notNull()
      .references(() => holdingImports.id, { onDelete: "restrict" }),
    containerId: text("container_id")
      .notNull()
      .references(() => ownershipContainers.id, { onDelete: "restrict" }),
    completeness: text("completeness").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    observedAt: timestamp("observed_at"),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("holding_import_coverages_import_container_unique").on(
      table.importId,
      table.containerId,
    ),
    index("holding_import_coverages_household_container_idx").on(
      table.householdId,
      table.containerId,
      table.observedAt,
    ),
    check(
      "holding_import_coverages_completeness_check",
      sql`${table.completeness} IN ('complete', 'partial', 'unavailable', 'malformed', 'failed', 'ambiguous')`,
    ),
    check(
      "holding_import_coverages_evidence_check",
      sql`length(${table.evidenceSha256}) = 64 AND ${table.evidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "holding_import_coverages_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const connectorInvestmentConnectionVersions = sqliteTable(
  "connector_investment_connection_versions",
  {
    id: id("id"),
    householdId: householdReference(),
    connectorAccountId: text("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "restrict" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => investmentConnections.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    supersedesLinkId: text("supersedes_link_id"),
    recordedAt: timestamp("recorded_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesLinkId],
      foreignColumns: [table.id],
      name: "connector_investment_connection_versions_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex(
      "connector_investment_connection_versions_supersedes_unique",
    ).on(table.supersedesLinkId),
    uniqueIndex("connector_investment_connection_roots_unique")
      .on(table.connectorAccountId)
      .where(sql`${table.supersedesLinkId} IS NULL`),
    uniqueIndex("connector_investment_connection_account_version_unique").on(
      table.connectorAccountId,
      table.version,
    ),
    index("connector_investment_connection_household_idx").on(
      table.householdId,
      table.connectorAccountId,
      table.connectionId,
      table.version,
    ),
    check(
      "connector_investment_connection_version_check",
      sql`${table.version} > 0 AND ((${table.version} = 1 AND ${table.supersedesLinkId} IS NULL) OR (${table.version} > 1 AND ${table.supersedesLinkId} IS NOT NULL))`,
    ),
    check(
      "connector_investment_connection_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const connectorSyncInvestmentConnections = sqliteTable(
  "connector_sync_investment_connections",
  {
    id: id("id"),
    householdId: householdReference(),
    syncRunId: text("sync_run_id")
      .notNull()
      .references(() => connectorSyncRuns.id, { onDelete: "restrict" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => investmentConnections.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("connector_sync_investment_connections_run_unique").on(
      table.syncRunId,
    ),
    index("connector_sync_investment_connections_household_idx").on(
      table.householdId,
      table.connectionId,
      table.createdAt,
    ),
    check(
      "connector_sync_investment_connections_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const plaidWebhookInvestmentConnections = sqliteTable(
  "plaid_webhook_investment_connections",
  {
    id: id("id"),
    householdId: householdReference(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => plaidWebhookDeliveries.id, { onDelete: "restrict" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => investmentConnections.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("plaid_webhook_investment_connections_delivery_unique").on(
      table.deliveryId,
    ),
    index("plaid_webhook_investment_connections_household_idx").on(
      table.householdId,
      table.connectionId,
      table.createdAt,
    ),
    check(
      "plaid_webhook_investment_connections_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const canonicalExposures = sqliteTable(
  "canonical_exposures",
  {
    id: id("id"),
    householdId: householdReference(),
    exposureKind: text("exposure_kind").notNull(),
    canonicalName: text("canonical_name").notNull(),
    protectedIdentityKey: text("protected_identity_key"),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "restrict",
    }),
    resolutionMethod: text("resolution_method").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("canonical_exposures_household_identity_unique")
      .on(table.householdId, table.protectedIdentityKey)
      .where(sql`${table.protectedIdentityKey} IS NOT NULL`),
    uniqueIndex("canonical_exposures_company_unique")
      .on(table.companyId)
      .where(sql`${table.companyId} IS NOT NULL`),
    index("canonical_exposures_household_kind_idx").on(
      table.householdId,
      table.exposureKind,
      table.canonicalName,
    ),
    check(
      "canonical_exposures_name_check",
      sql`length(${table.canonicalName}) BETWEEN 1 AND 1000`,
    ),
    check(
      "canonical_exposures_identity_key_check",
      sql`${table.protectedIdentityKey} IS NULL OR (length(${table.protectedIdentityKey}) = 64 AND ${table.protectedIdentityKey} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "canonical_exposures_identity_check",
      sql`(${table.exposureKind} = 'public_instrument' AND ${table.resolutionMethod} = 'strong_identifier' AND ${table.protectedIdentityKey} IS NOT NULL AND ${table.companyId} IS NULL) OR (${table.exposureKind} = 'private_company' AND ${table.resolutionMethod} = 'reviewed_company' AND ${table.companyId} IS NOT NULL) OR (${table.exposureKind} = 'fund' AND ${table.resolutionMethod} = 'reviewed_fund' AND ${table.protectedIdentityKey} IS NOT NULL AND ${table.companyId} IS NULL) OR (${table.exposureKind} = 'unresolved' AND ${table.resolutionMethod} = 'unresolved' AND ${table.protectedIdentityKey} IS NULL AND ${table.companyId} IS NULL)`,
    ),
    check(
      "canonical_exposures_evidence_check",
      sql`length(${table.evidenceSha256}) = 64 AND ${table.evidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check("canonical_exposures_immutable_check", sql`${table.immutable} = 1`),
  ],
);

export const holdingPositionExposureMappings = sqliteTable(
  "holding_position_exposure_mappings",
  {
    id: id("id"),
    householdId: householdReference(),
    positionId: text("position_id")
      .notNull()
      .references(() => holdingPositions.id, { onDelete: "restrict" }),
    exposureId: text("exposure_id")
      .notNull()
      .references(() => canonicalExposures.id, { onDelete: "restrict" }),
    relationshipKind: text("relationship_kind").notNull(),
    allocationPpm: integer("allocation_ppm"),
    status: text("status").notNull(),
    decisionSource: text("decision_source").notNull(),
    decisionReference: text("decision_reference").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    effectiveAt: timestamp("effective_at"),
    version: integer("version").notNull(),
    supersedesMappingId: text("supersedes_mapping_id"),
    acceptedByUserId: text("accepted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    acceptedAt: timestamp("accepted_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesMappingId],
      foreignColumns: [table.id],
      name: "holding_position_exposure_mappings_supersedes_fk",
    }).onDelete("restrict"),
    uniqueIndex("holding_position_exposure_mappings_supersedes_unique").on(
      table.supersedesMappingId,
    ),
    uniqueIndex("holding_position_exposure_mapping_roots_unique")
      .on(table.positionId, table.exposureId)
      .where(sql`${table.supersedesMappingId} IS NULL`),
    index("holding_position_exposure_mappings_household_position_idx").on(
      table.householdId,
      table.positionId,
      table.exposureId,
      table.version,
    ),
    check(
      "holding_position_exposure_mappings_relationship_check",
      sql`${table.relationshipKind} IN ('direct', 'look_through')`,
    ),
    check(
      "holding_position_exposure_mappings_allocation_check",
      sql`${table.allocationPpm} IS NULL OR ${table.allocationPpm} BETWEEN 0 AND 1000000`,
    ),
    check(
      "holding_position_exposure_mappings_status_check",
      sql`${table.status} IN ('active', 'withdrawn') AND (${table.status} <> 'withdrawn' OR ${table.allocationPpm} IS NULL)`,
    ),
    check(
      "holding_position_exposure_mappings_decision_check",
      sql`${table.decisionSource} IN ('deterministic_policy', 'review') AND length(${table.decisionReference}) BETWEEN 1 AND 200`,
    ),
    check(
      "holding_position_exposure_mappings_evidence_check",
      sql`length(${table.evidenceSha256}) = 64 AND ${table.evidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "holding_position_exposure_mappings_version_check",
      sql`${table.version} > 0 AND ((${table.version} = 1 AND ${table.supersedesMappingId} IS NULL) OR (${table.version} > 1 AND ${table.supersedesMappingId} IS NOT NULL))`,
    ),
    check(
      "holding_position_exposure_mappings_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);

export const planActualMonitoringCooldowns = sqliteTable(
  "plan_actual_monitoring_cooldowns",
  {
    id: id("id"),
    householdId: householdReference(),
    itemKey: text("item_key").notNull(),
    sourceRevision: text("source_revision").notNull(),
    snoozedUntil: timestamp("snoozed_until"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    immutable: integer("immutable", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("plan_actual_monitoring_cooldowns_household_item_idx").on(
      table.householdId,
      table.itemKey,
      table.sourceRevision,
      table.createdAt,
    ),
    check(
      "plan_actual_monitoring_cooldowns_item_check",
      sql`${table.itemKey} IN ('cash_review', 'cash_freshness', 'cash_drift', 'debt_review', 'debt_overdue', 'debt_freshness', 'debt_drift', 'burn_review', 'burn_freshness', 'burn_drift', 'runway_drift')`,
    ),
    check(
      "plan_actual_monitoring_cooldowns_revision_check",
      sql`length(${table.sourceRevision}) = 64 AND ${table.sourceRevision} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "plan_actual_monitoring_cooldowns_time_check",
      sql`${table.snoozedUntil} > ${table.createdAt}`,
    ),
    check(
      "plan_actual_monitoring_cooldowns_immutable_check",
      sql`${table.immutable} = 1`,
    ),
  ],
);
