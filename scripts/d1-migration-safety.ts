import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.string().regex(/^[a-f0-9]{40}$/u);
const migrationName = z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/u);
const safeInteger = z.number().int().nonnegative().safe();
const caseId = z.string().regex(/^[a-z0-9-]+$/u);
const MigrationSchema = z
  .object({ name: migrationName, sha256: hash })
  .strict();
const fixtureRegistration = {
  fixture: z.string(),
  mainPositions: z.literal(120),
  unrelatedPositions: z.literal(120),
};
export const MigrationSafetyRegistrySchema = z
  .object({
    version: z.literal(2),
    immutableThrough: z.literal("0089_manual_holdings.sql"),
    immutableMigrations: z.array(MigrationSchema).min(1),
    baseline: z
      .object({
        kind: z.literal("baseline"),
        id: caseId,
        frontier: migrationName,
        pending: z.tuple([]),
        ...fixtureRegistration,
        histories: z.tuple([z.literal(24)]),
      })
      .strict(),
    cases: z.array(
      z
        .object({
          kind: z.literal("upgrade"),
          id: caseId,
          frontier: migrationName,
          migrations: z.array(MigrationSchema).min(1),
          ...fixtureRegistration,
          histories: z.tuple([z.literal(12), z.literal(24)]),
          maxRowsRead: safeInteger.positive(),
          maxRowsWritten: safeInteger.positive(),
        })
        .strict(),
    ),
  })
  .strict();

const commonScenario = {
  history: z.union([z.literal(12), z.literal(24)]),
  mainPositions: z.literal(120),
  unrelatedPositions: z.literal(120),
  fixtureHash: hash,
  tableRows: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/u), safeInteger),
  tablesPreserved: safeInteger.positive(),
  schemaObjectsPreserved: safeInteger.positive(),
  foreignKeyViolations: z.literal(0),
  immutableProbes: z.literal(3),
  physicalIntegrity: z.literal("unsupported-in-local-d1"),
};
const ForeignKeyPlanEvidenceSchema = z
  .object({
    digest: hash,
    foreignKeys: safeInteger.positive(),
    emptyLookups: safeInteger.positive(),
    positiveLookups: safeInteger.positive(),
    indexSearches: safeInteger.positive(),
    tableScans: safeInteger.positive(),
  })
  .strict()
  .refine(
    (evidence) =>
      evidence.emptyLookups === evidence.foreignKeys &&
      evidence.positiveLookups <= evidence.foreignKeys &&
      evidence.indexSearches + evidence.tableScans ===
        evidence.emptyLookups + evidence.positiveLookups,
    "Incomplete observed positive and empty foreign-key plan coverage",
  );
export const MigrationSafetyBaselineScenarioSchema = z
  .object({
    ...commonScenario,
    history: z.literal(24),
    tablesPreserved: z.literal(159),
    schemaObjectsPreserved: z.literal(812),
    validation: z.literal("applied-schema-preservation"),
    migrationMeasurement: z.literal("not-applicable-no-pending-sql"),
    inboundForeignKeyPlans: z.literal("observed-existing-index-and-scan-plans"),
    foreignKeyPlanEvidence: ForeignKeyPlanEvidenceSchema,
  })
  .strict();
export type MigrationSafetyBaselineScenario = z.infer<
  typeof MigrationSafetyBaselineScenarioSchema
>;
export const MigrationSafetyScenarioSchema = z
  .object({
    ...commonScenario,
    statements: safeInteger.positive(),
    rowsRead: safeInteger,
    rowsWritten: safeInteger,
    measuredFromFirstStatement: z.literal(true),
    counterSource: z.literal("local-workerd-d1-meta"),
    inboundForeignKeyPlans: z.enum([
      "indexed-positive-and-empty-before-destructive-statements",
      "not-applicable-trigger-only-no-table-dml",
      "indexed-current-head-backfill-no-parent-rebuild",
      "indexed-new-tables-no-parent-rebuild",
    ]),
    completeSequence: z.literal("preparation-through-cleanup"),
  })
  .strict()
  .refine(
    (scenario) =>
      scenario.inboundForeignKeyPlans ===
        "not-applicable-trigger-only-no-table-dml" ||
      scenario.inboundForeignKeyPlans ===
        "indexed-new-tables-no-parent-rebuild" ||
      (scenario.rowsRead > 0 && scenario.rowsWritten > 0),
    "A destructive migration needs positive measured counters",
  );
export type MigrationSafetyScenario = z.infer<
  typeof MigrationSafetyScenarioSchema
>;

export const MigrationSafetyReceiptSchema = z
  .object({
    version: z.literal(2),
    gitSha: revision,
    sourceDigest: hash,
    generatedAt: z.iso.datetime(),
    baseline: z
      .object({
        kind: z.literal("baseline"),
        id: caseId,
        frontier: migrationName,
        pending: z.tuple([]),
        scenarios: z.tuple([MigrationSafetyBaselineScenarioSchema]),
      })
      .strict(),
    cases: z.array(
      z
        .object({
          kind: z.literal("upgrade"),
          id: caseId,
          frontier: migrationName,
          pending: z.array(migrationName).min(1),
          scenarios: z
            .tuple([
              MigrationSafetyScenarioSchema.safeExtend({
                history: z.literal(12),
              }),
              MigrationSafetyScenarioSchema.safeExtend({
                history: z.literal(24),
              }),
            ])
            .refine(
              ([first, second]) => first.fixtureHash !== second.fixtureHash,
              "Migration history holdouts reused the same fixture",
            ),
        })
        .strict(),
    ),
  })
  .strict();
export type MigrationSafetyReceipt = z.infer<
  typeof MigrationSafetyReceiptSchema
>;
export const MigrationSafetyRequestSchema = z
  .object({
    frontier: migrationName,
    pending: z.array(migrationName),
    gitSha: revision,
  })
  .strict();

export const IMPLEMENTED_BASELINE_TABLES: readonly string[] = [
  "actual_liquidity_events",
  "angellist_mac_agents",
  "angellist_mac_runs",
  "app_access_clients",
  "app_access_codes",
  "app_access_credentials",
  "app_access_grants",
  "asset_accounts",
  "asset_lot_retirements",
  "asset_lots",
  "automatic_investment_reviews",
  "canonical_exposures",
  "cash_account_identity_decisions",
  "cash_balance_proposal_rows",
  "cash_balance_proposals",
  "cash_balance_review_decisions",
  "cash_flow_activation_events",
  "cash_flow_connections",
  "cash_flow_plans",
  "cash_flow_proposal_categories",
  "cash_flow_proposal_months",
  "cash_flow_proposals",
  "cash_flow_review_decisions",
  "cash_flow_transaction_revisions",
  "companies",
  "company_alias_position_receipts",
  "company_alias_reviews",
  "company_aliases",
  "company_forecasts",
  "company_identity_revisions",
  "company_redirects",
  "connector_accounts",
  "connector_investment_connection_versions",
  "connector_sync_imports",
  "connector_sync_investment_connections",
  "connector_sync_runs",
  "document_investment_origins",
  "evidence_applications",
  "evidence_claims",
  "evidence_events",
  "forecast_outputs",
  "forecast_snapshots",
  "goal_forecast_snapshots",
  "goal_versions",
  "goals",
  "holding_import_application_heads",
  "holding_import_applications",
  "holding_import_connections",
  "holding_import_coverages",
  "holding_import_quarantines",
  "holding_import_rename_aliases",
  "holding_import_row_containers",
  "holding_import_row_decisions",
  "holding_import_row_provider_exposure_evidence",
  "holding_import_row_provider_investments",
  "holding_import_row_public_exposure_evidence",
  "holding_import_row_reported_economics_evidence",
  "holding_import_row_structured_asset_exposure_evidence",
  "holding_import_rows",
  "holding_import_share_prices",
  "holding_imports",
  "holding_investment_reviews",
  "holding_position_continuities",
  "holding_position_economics_proposals",
  "holding_position_economics_reviews",
  "holding_position_exposure_heads",
  "holding_position_exposure_mappings",
  "holding_position_exposures",
  "holding_position_link_heads",
  "holding_position_link_reviews",
  "holding_position_ownerships",
  "holding_position_snapshots",
  "holding_position_value_proposals",
  "holding_position_value_reviews",
  "holding_positions",
  "holding_price_proxy_links",
  "holding_price_quotes",
  "holding_price_source_heads",
  "holding_purchase_heads",
  "holding_purchase_reviews",
  "households",
  "investment_company_reviews",
  "investment_connection_versions",
  "investment_connections",
  "investment_document_assignments",
  "investment_event_revisions",
  "investment_history_account_heads",
  "investment_history_accounts",
  "investment_history_admissions",
  "investment_history_captures",
  "investment_history_positions",
  "investment_tax_lots",
  "investment_transaction_heads",
  "investment_transaction_observations",
  "legal_entities",
  "legal_entity_name_heads",
  "legal_entity_source_decisions",
  "legal_entity_versions",
  "liability_proposal_rows",
  "liability_proposals",
  "liability_review_decisions",
  "liquidity_curves",
  "mac_agent_credentials",
  "manual_holding_identity_heads",
  "manual_holding_identity_versions",
  "manual_holding_submissions",
  "mark_sources",
  "marks",
  "ownership_container_versions",
  "ownership_containers",
  "plaid_webhook_deliveries",
  "plaid_webhook_investment_connections",
  "plan_actual_monitoring_cooldowns",
  "portfolio_baseline_cash_items",
  "portfolio_baseline_items",
  "portfolio_baseline_policy_decisions",
  "portfolio_baseline_public_source_versions",
  "portfolio_baselines",
  "portfolio_watch_checks",
  "portfolio_watch_read_receipts",
  "portfolio_watch_runs",
  "portfolio_watch_source_sync_state",
  "portfolio_watch_source_verification_events",
  "portfolio_watch_sources",
  "portfolio_watch_targets",
  "portfolio_watch_website_decisions",
  "private_document_access_events",
  "private_document_scans",
  "private_vehicles",
  "provider_browser_sessions",
  "provider_legal_document_latest",
  "provider_legal_document_observations",
  "provider_legal_document_uploads",
  "provider_portfolio_agents",
  "provider_portfolio_runs",
  "provider_session_renewal_attempts",
  "provider_session_renewals",
  "public_company_match_runs",
  "public_exposure_company_links",
  "public_exposure_company_reviews",
  "public_holding_account_inventory_heads",
  "public_holding_active_positions",
  "public_holding_import_heads",
  "public_holding_inventories",
  "public_holding_inventory_evidence",
  "public_holding_security_heads",
  "public_holding_source_heads",
  "public_holding_source_reviews",
  "public_holding_source_versions",
  "public_source_observations",
  "retained_public_exposure_document_failures",
  "review_decisions",
  "scenario_assumptions",
  "scenarios",
  "signal_update_proposal_evidence",
  "signal_update_proposals",
  "source_documents",
  "tax_profiles",
  "users",
];

const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const baselineTableNamesDigest =
  "8815a4c0a847c57c4c9ec0188cb8f2c48cfc541e982a21eca2e5c94fad99a753";
const safetySources = [
  "package.json",
  "pnpm-lock.yaml",
  "vitest.config.ts",
  "scripts/d1-migration-safety.ts",
  "scripts/d1-migration-safety.test.ts",
  "scripts/populated-migration-d1-cost.test.ts",
  "scripts/test-support",
  "packages/database/src",
  "packages/domain/src",
  "packages/connectors/src",
  "packages/database/seed/synthetic.sql",
  ".tugling/d1-migrations.json",
];

function filesUnder(path: string): string[] {
  const stat = lstatSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory())
    throw new Error(`Invalid migration safety source ${path}`);
  return readdirSync(path).flatMap((entry) => filesUnder(join(path, entry)));
}

export function readMigrationSafetyRegistry(root = process.cwd()) {
  const registry = MigrationSafetyRegistrySchema.parse(
    JSON.parse(
      readFileSync(resolve(root, ".tugling/d1-migrations.json"), "utf8"),
    ),
  );
  if (
    digest(JSON.stringify(registry.immutableMigrations)) !==
    "93d8bf342f338ac33824876d59c8c1f48828c1323b3e7af2b96311fec9f6026e"
  )
    throw new Error(
      "Applied migration manifest is immutable; do not bless rewritten history.",
    );
  if (
    digest(JSON.stringify(IMPLEMENTED_BASELINE_TABLES)) !==
    baselineTableNamesDigest
  )
    throw new Error(
      "Implemented baseline table manifest changed without fixture support",
    );
  const names = readdirSync(resolve(root, "packages/database/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (
    registry.immutableMigrations.at(-1)?.name !== registry.immutableThrough ||
    registry.immutableMigrations.some(
      (item) => item.name > registry.immutableThrough,
    )
  )
    throw new Error("Invalid immutable migration frontier");
  const immutableNames = names.filter(
    (name) => name <= registry.immutableThrough,
  );
  if (
    !same(
      immutableNames,
      registry.immutableMigrations.map((item) => item.name),
    )
  )
    throw new Error(
      "Applied migration history is missing, reordered or unregistered",
    );
  const covered = [...registry.immutableMigrations];
  const caseIds = new Set([registry.baseline.id]);
  for (const review of registry.cases) {
    if (caseIds.has(review.id))
      throw new Error("Duplicate migration safety case");
    caseIds.add(review.id);
    if (review.frontier !== covered.at(-1)?.name)
      throw new Error(
        "Migration cost cases must cover the exact ordered frontier",
      );
    covered.push(...review.migrations);
  }
  if (
    !same(
      names,
      covered.map((item) => item.name),
    )
  )
    throw new Error(
      "Every new migration requires a reviewed populated OLD-schema cost case",
    );
  for (const entry of covered) {
    if (
      digest(
        readFileSync(resolve(root, "packages/database/migrations", entry.name)),
      ) !== entry.sha256
    )
      throw new Error(
        `Migration source changed without matching evidence: ${entry.name}`,
      );
  }
  if (registry.baseline.frontier !== covered.at(-1)?.name)
    throw new Error(
      "Baseline must cover the exact terminal checked-in migration frontier",
    );
  if (
    registry.baseline.id !== "price-metadata-continuation-schema-v1" ||
    registry.baseline.frontier !== "0097_price_metadata_continuation.sql" ||
    registry.baseline.fixture !== "public-holding-history-v1"
  )
    throw new Error(
      "New baseline frontier needs an implemented fixture and canonical runner, not a metadata-only approval",
    );
  if (
    registry.cases.length !== 8 ||
    registry.cases[7]?.id !== "price-metadata-continuation-v1" ||
    registry.cases[7].frontier !== "0096_economics_snapshot_lookup.sql" ||
    registry.cases[7].fixture !== "public-holding-history-v1" ||
    !same(
      registry.cases[7].migrations.map((item) => item.name),
      ["0097_price_metadata_continuation.sql"],
    ) ||
    registry.cases[6]?.id !== "economics-snapshot-lookup-v1" ||
    registry.cases[6].frontier !== "0095_investment_history.sql" ||
    registry.cases[6].fixture !== "public-holding-history-v1" ||
    !same(
      registry.cases[6].migrations.map((item) => item.name),
      ["0096_economics_snapshot_lookup.sql"],
    ) ||
    registry.cases[5]?.id !== "investment-history-v1" ||
    registry.cases[5].frontier !== "0094_app_access.sql" ||
    registry.cases[5].fixture !== "public-holding-history-v1" ||
    !same(
      registry.cases[5].migrations.map((item) => item.name),
      ["0095_investment_history.sql"],
    ) ||
    registry.cases[4]?.id !== "app-access-v1" ||
    registry.cases[4].frontier !== "0093_gp_reported_total_refresh.sql" ||
    registry.cases[4].fixture !== "public-holding-history-v1" ||
    !same(
      registry.cases[4].migrations.map((item) => item.name),
      ["0094_app_access.sql"],
    ) ||
    registry.cases[3]?.id !== "gp-reported-total-v1" ||
    registry.cases[3].frontier !== "0092_public_holding_inventories.sql" ||
    registry.cases[3].fixture !== "public-holding-history-v1" ||
    !same(
      registry.cases[3].migrations.map((item) => item.name),
      ["0093_gp_reported_total_refresh.sql"],
    ) ||
    registry.cases[2]?.id !== "public-inventory-v1" ||
    registry.cases[2].frontier !== "0091_public_source_reviews.sql" ||
    registry.cases[2].fixture !== "public-holding-history-v1" ||
    !same(
      registry.cases[2].migrations.map((item) => item.name),
      ["0092_public_holding_inventories.sql"],
    ) ||
    registry.cases[1]?.id !== "public-source-reviews-v1" ||
    registry.cases[1].frontier !== "0090_distribution_reviews.sql" ||
    registry.cases[1].fixture !== "public-holding-history-v1" ||
    !same(
      registry.cases[1].migrations.map((item) => item.name),
      ["0091_public_source_reviews.sql"],
    ) ||
    registry.cases[0]?.id !== "distribution-reviews-v1" ||
    registry.cases[0].frontier !== "0089_manual_holdings.sql" ||
    registry.cases[0].fixture !== "holding-history-v1" ||
    !same(
      registry.cases[0].migrations.map((item) => item.name),
      ["0090_distribution_reviews.sql"],
    )
  )
    throw new Error(
      "New migration case needs an implemented OLD-schema fixture and canonical runner, not a metadata-only approval",
    );
  return registry;
}

export function migrationSourceDigest(root = process.cwd()) {
  readMigrationSafetyRegistry(root);
  const sources = [
    ...safetySources.flatMap((path) => filesUnder(resolve(root, path))),
    ...filesUnder(resolve(root, "packages/database/migrations")),
  ].sort();
  return digest(
    JSON.stringify(
      sources.map((path) => [
        relative(root, path).replaceAll("\\", "/"),
        digest(readFileSync(path)),
      ]),
    ),
  );
}

function validateFootprint(
  scenarios:
    | MigrationSafetyReceipt["baseline"]["scenarios"]
    | MigrationSafetyReceipt["cases"][number]["scenarios"],
  histories: readonly number[],
  baseline: boolean,
) {
  if (
    !same(
      scenarios.map((scenario) => scenario.history),
      histories,
    )
  )
    throw new Error(
      "Migration evidence does not cover the exact history holdouts",
    );
  const keys = Object.keys(scenarios[0].tableRows).sort();
  for (const scenario of scenarios) {
    if (
      Object.keys(scenario.tableRows).length !== scenario.tablesPreserved ||
      !same(Object.keys(scenario.tableRows).sort(), keys) ||
      (baseline && !same(keys, IMPLEMENTED_BASELINE_TABLES))
    )
      throw new Error(
        "Migration footprint evidence is incomplete or has unexpected table keys",
      );
    if (
      baseline &&
      ((scenario.tableRows.holding_positions ?? 0) < 480 ||
        (scenario.tableRows.holding_position_snapshots ?? 0) <
          240 * (scenario.history + 2))
    )
      throw new Error(
        "Migration footprint evidence is below its declared populated scale",
      );
    if (
      (scenario.tableRows.holding_positions ?? 0) < 240 ||
      (scenario.tableRows.holding_position_snapshots ?? 0) <
        120 * (scenario.history + 2) ||
      (scenario.tableRows.holding_purchase_reviews ?? 0) <
        120 * scenario.history ||
      (scenario.tableRows.portfolio_baseline_items ?? 0) < 120 ||
      (scenario.tableRows.manual_holding_submissions ?? 0) < 1 ||
      (scenario.tableRows.households ?? 0) < 2
    )
      throw new Error(
        "Migration footprint evidence is below its declared populated scale",
      );
  }
}

export function validateMigrationSafetyReceipt(
  raw: unknown,
  options: { gitSha: string; now?: Date },
  root = process.cwd(),
) {
  const registry = readMigrationSafetyRegistry(root);
  const receipt = MigrationSafetyReceiptSchema.parse(raw);
  if (
    receipt.gitSha !== revision.parse(options.gitSha) ||
    receipt.sourceDigest !== migrationSourceDigest(root)
  )
    throw new Error(
      "Migration evidence is not bound to this revision and source",
    );
  const age =
    (options.now ?? new Date()).getTime() - Date.parse(receipt.generatedAt);
  if (!Number.isSafeInteger(age) || age < 0 || age > 24 * 60 * 60 * 1000)
    throw new Error("Migration evidence is stale or from a future clock");
  if (
    receipt.baseline.id !== registry.baseline.id ||
    receipt.baseline.frontier !== registry.baseline.frontier ||
    !same(receipt.baseline.pending, registry.baseline.pending)
  )
    throw new Error(
      "Baseline evidence does not cover the exact registered terminal frontier",
    );
  validateFootprint(
    receipt.baseline.scenarios,
    registry.baseline.histories,
    true,
  );
  if (
    !same(
      receipt.cases.map((item) => item.id),
      registry.cases.map((item) => item.id),
    )
  )
    throw new Error("Migration evidence omitted or duplicated a reviewed case");
  for (const [index, review] of registry.cases.entries()) {
    const actual = receipt.cases[index]!;
    if (
      actual.frontier !== review.frontier ||
      !same(
        actual.pending,
        review.migrations.map((item) => item.name),
      )
    )
      throw new Error(
        "Migration evidence does not cover the exact old frontier and pending sequence",
      );
    validateFootprint(actual.scenarios, review.histories, false);
    if (
      (review.id === "public-source-reviews-v1" ||
        review.id === "public-inventory-v1") &&
      actual.scenarios.some(
        (scenario) =>
          (scenario.tableRows.holding_positions ?? 0) < 480 ||
          (scenario.tableRows.holding_position_snapshots ?? 0) <
            240 * (scenario.history + 2),
      )
    )
      throw new Error(
        "Public source migration needs populated public and unrelated history",
      );
    if (
      actual.scenarios.some(
        (scenario) =>
          scenario.rowsRead > review.maxRowsRead ||
          scenario.rowsWritten > review.maxRowsWritten ||
          scenario.inboundForeignKeyPlans !==
            (review.id === "public-source-reviews-v1" ||
            review.id === "public-inventory-v1"
              ? "indexed-current-head-backfill-no-parent-rebuild"
              : review.id === "app-access-v1" ||
                  review.id === "investment-history-v1"
                ? "indexed-new-tables-no-parent-rebuild"
                : "not-applicable-trigger-only-no-table-dml"),
      )
    )
      throw new Error(
        "Populated migration exceeds its reviewed actual D1 row budget",
      );
  }
  return receipt;
}

type ScenarioFootprint = Pick<MigrationSafetyScenario, "tableRows">;
export function migrationFootprint(
  scenarios: readonly [ScenarioFootprint, ...ScenarioFootprint[]],
) {
  return Object.fromEntries(
    Object.keys(scenarios[0].tableRows).map((table) => [
      table,
      Math.max(...scenarios.map((scenario) => scenario.tableRows[table]!)),
    ]),
  );
}

export function assertMigrationSafety(
  input: {
    frontier: string;
    pending: string[];
    gitSha: string;
    receipt: unknown;
    now?: Date;
  },
  root = process.cwd(),
) {
  const request = MigrationSafetyRequestSchema.parse({
    frontier: input.frontier,
    pending: input.pending,
    gitSha: input.gitSha,
  });
  const registry = readMigrationSafetyRegistry(root);
  const names = [
    ...registry.immutableMigrations,
    ...registry.cases.flatMap((item) => item.migrations),
  ].map((item) => item.name);
  const frontierIndex = names.indexOf(request.frontier);
  if (
    frontierIndex < 0 ||
    !same(names.slice(frontierIndex + 1), request.pending)
  )
    throw new Error(
      "Unknown or mismatched actual migration frontier and pending sequence",
    );
  if (request.frontier < registry.immutableThrough)
    throw new Error(
      "Populated legacy upgrade refused: forward indexes run after the unsafe rebuild",
    );
  const receipt = validateMigrationSafetyReceipt(
    input.receipt,
    {
      gitSha: request.gitSha,
      ...(input.now === undefined ? {} : { now: input.now }),
    },
    root,
  );
  const review =
    request.pending.length === 0
      ? receipt.baseline.frontier === request.frontier
        ? receipt.baseline
        : undefined
      : receipt.cases.find(
          (item) =>
            item.frontier === request.frontier &&
            same(item.pending, request.pending),
        );
  if (review === undefined)
    throw new Error(
      "Migration frontier has no exact baseline or populated OLD-schema evidence",
    );
  const footprint = migrationFootprint(review.scenarios);
  return {
    kind: review.kind,
    migrationCost:
      review.kind === "baseline"
        ? null
        : {
            rowsRead: Math.max(
              ...review.scenarios.map((scenario) => scenario.rowsRead),
            ),
            rowsWritten: Math.max(
              ...review.scenarios.map((scenario) => scenario.rowsWritten),
            ),
          },
    footprint,
    caseId: review.id,
    receiptDigest: digest(JSON.stringify(receipt)),
    sourceDigest: receipt.sourceDigest,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "check") {
    const registry = readMigrationSafetyRegistry();
    console.log(
      JSON.stringify({
        migrationSafety: "source-contract-valid",
        sourceDigest: migrationSourceDigest(),
        baseline: registry.baseline.id,
        cases: registry.cases.map((item) => item.id),
      }),
    );
  } else if (
    process.argv[2] === "admit" &&
    process.argv[3] &&
    process.argv[4]
  ) {
    const request = MigrationSafetyRequestSchema.parse(
      JSON.parse(readFileSync(process.argv[4], "utf8")),
    );
    console.log(
      JSON.stringify(
        assertMigrationSafety({
          ...request,
          receipt: JSON.parse(readFileSync(process.argv[3], "utf8")) as unknown,
        }),
      ),
    );
  } else {
    throw new Error(
      "Use check, or admit <private-receipt.json> <private-request.json>",
    );
  }
}
