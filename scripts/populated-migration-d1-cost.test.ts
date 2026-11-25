import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import {
  MigrationSafetyReceiptSchema,
  MigrationSafetyBaselineScenarioSchema,
  MigrationSafetyScenarioSchema,
  migrationSourceDigest,
  readMigrationSafetyRegistry,
  validateMigrationSafetyReceipt,
  type MigrationSafetyScenario,
  type MigrationSafetyBaselineScenario,
} from "./d1-migration-safety";
import {
  hasUsableMigrationForeignKeyIndex,
  immutableMigrationProbes,
  migrationForeignKeyPlans,
  migrationDigest,
  populatedMigrationDatabase,
  populatedMigrationFixtures,
  preparePopulatedMigrationSeed,
  preserveMigrationFixture,
  preserveMigrationFixtures,
} from "./test-support/populated-migration";

const rebuild = unstable_splitSqlQuery(
  readFileSync("packages/database/migrations/0089_manual_holdings.sql", "utf8"),
);
const syntheticHistoricalFkPreparation = unstable_splitSqlQuery(
  readFileSync(
    "scripts/test-support/synthetic-historical-foreign-key-indexes.sql",
    "utf8",
  ),
);
const registry = readMigrationSafetyRegistry();
const triggerUpgrades = [
  {
    id: "distribution-reviews-v1",
    frontier: "0089_manual_holdings.sql",
    oldFixture: "0089",
    newFixture: "0090",
    migration: "0090_distribution_reviews.sql",
    statements: 6,
    changedNames: [
      "holding_purchase_unified_guard",
      "holding_purchase_price_evidence_guard",
      "holding_purchase_reported_value_guard",
      "holding_purchase_distribution_guard",
    ],
    tables: 137,
    schemaObjects: 693,
  },
  {
    id: "gp-reported-total-v1",
    frontier: "0092_public_holding_inventories.sql",
    oldFixture: "0092",
    newFixture: "0093",
    migration: "0093_gp_reported_total_refresh.sql",
    statements: 5,
    changedNames: [
      "holding_gp_total_refresh_guard",
      "holding_price_current_quotes",
      "holding_selected_valuation_guard",
      "holding_price_continuation_guard",
    ],
    tables: 147,
    schemaObjects: 749,
  },
  {
    id: "economics-snapshot-lookup-v1",
    frontier: "0095_investment_history.sql",
    oldFixture: "0095",
    newFixture: "0096",
    migration: "0096_economics_snapshot_lookup.sql",
    statements: 2,
    changedNames: ["holding_position_economics_proposals_integrity_insert"],
    tables: 159,
    schemaObjects: 812,
  },
  {
    id: "price-metadata-continuation-v1",
    frontier: "0096_economics_snapshot_lookup.sql",
    oldFixture: "0096-prices",
    newFixture: "0097",
    migration: "0097_price_metadata_continuation.sql",
    statements: 10,
    changedNames: [
      "holding_price_metadata_heads",
      "holding_price_source_heads_version",
      "holding_price_source_heads_household",
      "holding_selected_valuation_guard",
      "holding_price_quote_head",
      "holding_price_continuation_guard",
    ],
    tables: 160,
    schemaObjects: 813,
  },
  {
    id: "market-proxy-basis-v1",
    frontier: "0098_exposure_closing_prices.sql",
    oldFixture: "0098-market",
    newFixture: "0099",
    migration: "0099_market_proxy_basis.sql",
    statements: 3,
    changedNames: [
      "exposure_market_members",
      "exposure_market_decision_project",
    ],
    tables: 166,
    schemaObjects: 837,
  },
] as const;
const completedRegressions = new Set<number>();
const baselineScenarios: MigrationSafetyBaselineScenario[] = [];
const scenarios = new Map<string, MigrationSafetyScenario[]>();
const receiptPath =
  process.env.KEEL_MIGRATION_SAFETY_RECEIPT ??
  (process.env.KEEL_NATIVE_EVIDENCE_DIR
    ? join(process.env.KEEL_NATIVE_EVIDENCE_DIR, "migration-safety.json")
    : undefined);
let sourceDigest = "";
const populatedMigrationFixture = populatedMigrationFixtures();

beforeAll(() => {
  if (receiptPath) rmSync(receiptPath, { force: true });
  sourceDigest = migrationSourceDigest();
});

afterAll(() => {
  if (
    ![12, 24].every((history) => completedRegressions.has(history)) ||
    JSON.stringify(
      baselineScenarios.map((scenario) => scenario.history).sort(),
    ) !== JSON.stringify(registry.baseline.histories) ||
    scenarios.size !== registry.cases.length ||
    [...scenarios.values()].some((holdouts) => holdouts.length !== 2)
  )
    throw new Error(
      "Incomplete populated migration verification; no receipt emitted",
    );
  if (migrationSourceDigest() !== sourceDigest)
    throw new Error(
      "Migration evidence sources changed during verification; no receipt emitted",
    );
  const receipt = MigrationSafetyReceiptSchema.parse({
    version: 2,
    gitSha: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    sourceDigest,
    generatedAt: new Date().toISOString(),
    baseline: {
      kind: "baseline",
      id: registry.baseline.id,
      frontier: registry.baseline.frontier,
      pending: [],
      scenarios: baselineScenarios.sort(
        (left, right) => left.history - right.history,
      ),
    },
    cases: registry.cases.map((review) => ({
      kind: "upgrade",
      id: review.id,
      frontier: review.frontier,
      pending: review.migrations.map((item) => item.name),
      scenarios: scenarios
        .get(review.id)!
        .sort((left, right) => left.history - right.history),
    })),
  });
  validateMigrationSafetyReceipt(receipt, { gitSha: receipt.gitSha });
  if (receiptPath) {
    mkdirSync(dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
      mode: 0o600,
    });
  }
});

describe("populated OLD-schema D1 migration safety", () => {
  for (const history of [12, 24] as const) {
    it(`measures the historical foreign-key amplification and indexed correction at ${history} captures`, async () => {
      const probe = new DatabaseSync(":memory:");
      try {
        probe.exec(`
          PRAGMA foreign_keys=ON;
          CREATE TABLE synthetic_parent(id TEXT PRIMARY KEY);
          CREATE TABLE synthetic_child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES synthetic_parent(id),state TEXT);
          INSERT INTO synthetic_parent VALUES ('synthetic-present');
          INSERT INTO synthetic_child VALUES ('synthetic-linked','synthetic-present','kept'),('synthetic-null',NULL,'other');
          CREATE INDEX synthetic_partial ON synthetic_child(parent_id) WHERE parent_id IS NOT NULL AND state='kept';
        `);
        expect(
          hasUsableMigrationForeignKeyIndex(
            probe,
            "synthetic_child",
            "parent_id",
          ),
        ).toBe(false);
        probe.exec(`
          DROP INDEX synthetic_partial;
          CREATE INDEX synthetic_partial ON synthetic_child(parent_id) WHERE parent_id IS NOT NULL;
        `);
        expect(
          hasUsableMigrationForeignKeyIndex(
            probe,
            "synthetic_child",
            "parent_id",
          ),
        ).toBe(true);
        for (const value of ["synthetic-present", "synthetic-missing"]) {
          const plans = probe
            .prepare(
              "EXPLAIN QUERY PLAN SELECT rowid FROM synthetic_child WHERE parent_id=?",
            )
            .all(value);
          expect(
            plans.every(
              (plan) =>
                /\bSEARCH\b/u.test(String(plan.detail)) &&
                !/\bSCAN\b/u.test(String(plan.detail)),
            ),
          ).toBe(true);
        }
        expect(probe.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        probe.close();
      }
      const fixture = await populatedMigrationFixture(history, "0088");
      expect(fixture.counts).toMatchObject({
        holding_positions: 240,
        holding_position_snapshots: 120 * (history + 2),
        holding_purchase_reviews: 120 * history,
        portfolio_baseline_items: 120,
        households: 2,
      });
      expect(fixture.foreignKeys.filter((fk) => !fk.indexed)).toHaveLength(14);
      const seed = await preparePopulatedMigrationSeed(fixture);
      try {
        const original = await populatedMigrationDatabase(fixture, { seed });
        let originalReads: number;
        try {
          await preserveMigrationFixture(original.database, fixture, true);
          const plans = await migrationForeignKeyPlans(
            original.database,
            fixture,
          );
          expect(
            plans
              .filter((plan) => !plan.indexed)
              .every((plan) =>
                plan.details.some((detail) => /\bSCAN\b/u.test(detail)),
              ),
          ).toBe(true);
          const cost = await original.execute(rebuild);
          expect(cost.statements).toBe(rebuild.length);
          expect(cost.rowsRead).toBeGreaterThan(
            history === 12 ? 5_000_000 : 19_000_000,
          );
          const drop =
            cost.records[
              rebuild.findIndex(
                (sql) => sql.trim() === "DROP TABLE holding_position_snapshots",
              )
            ]!;
          expect(drop.rowsRead).toBeGreaterThan((cost.rowsRead * 9) / 10);
          expect(cost.rowsWritten).toBeGreaterThan(20_000);
          expect(
            await immutableMigrationProbes(original.database, fixture),
          ).toBe(3);
          await preserveMigrationFixture(original.database, fixture);
          originalReads = cost.rowsRead;
        } finally {
          await original.close();
        }

        const corrected = await populatedMigrationDatabase(fixture, { seed });
        try {
          await preserveMigrationFixture(corrected.database, fixture, true);
          const preparation = await corrected.execute(
            syntheticHistoricalFkPreparation.filter(
              (sql) => !sql.includes("manual_holding_submissions"),
            ),
          );
          expect(preparation.statements).toBe(14);
          expect(preparation.rowsWritten).toBeGreaterThan(0);
          const plans = await migrationForeignKeyPlans(
            corrected.database,
            fixture,
          );
          expect(
            plans.every((plan) =>
              plan.details.every(
                (detail) =>
                  /\bSEARCH\b/u.test(detail) && !/\bSCAN\b/u.test(detail),
              ),
            ),
          ).toBe(true);
          const migration = await corrected.execute(rebuild);
          const restoration = await corrected.execute(
            syntheticHistoricalFkPreparation,
          );
          const rowsRead =
            preparation.rowsRead + migration.rowsRead + restoration.rowsRead;
          const rowsWritten =
            preparation.rowsWritten +
            migration.rowsWritten +
            restoration.rowsWritten;
          expect(rowsRead).toBeLessThanOrEqual(200_000);
          expect(rowsWritten).toBeLessThanOrEqual(50_000);
          expect(migration.rowsRead).toBeLessThan(originalReads / 20);
          expect(
            await immutableMigrationProbes(corrected.database, fixture),
          ).toBe(3);
          await preserveMigrationFixture(corrected.database, fixture);
          expect(
            (await migrationForeignKeyPlans(corrected.database, fixture)).every(
              (plan) =>
                plan.details.every((detail) => /\bSEARCH\b/u.test(detail)),
            ),
          ).toBe(true);
          console.info(
            JSON.stringify({
              syntheticMigrationRegression: {
                history,
                mainPositions: 120,
                unrelatedPositions: 120,
                originalReads,
                preparationReads: preparation.rowsRead,
                preparationWrites: preparation.rowsWritten,
                migrationReads: migration.rowsRead,
                migrationWrites: migration.rowsWritten,
                restorationReads: restoration.rowsRead,
                restorationWrites: restoration.rowsWritten,
              },
            }),
          );
        } finally {
          await corrected.close();
        }
      } finally {
        seed.close();
      }
      completedRegressions.add(history);
    }, 120_000);
  }

  for (const review of registry.cases) {
    for (const history of review.histories) {
      it(`certifies ${review.id} from populated ${review.frontier} at ${history} captures`, async () => {
        if (
          review.id === "app-access-v1" ||
          review.id === "investment-history-v1" ||
          review.id === "exposure-closing-prices-v1"
        ) {
          const market = review.id === "exposure-closing-prices-v1";
          const investment = review.id === "investment-history-v1";
          const createdTable = (name: string) =>
            market
              ? name.startsWith("exposure_market_")
              : investment
                ? /^investment_(?:history_|transaction_|tax_lots$)/u.test(name)
                : name.startsWith("app_access_");
          const oldFrontier = market ? "0097" : investment ? "0094" : "0093";
          const newFrontier = market ? "0098" : investment ? "0095" : "0094";
          const newMigration = market
            ? "0098_exposure_closing_prices.sql"
            : investment
              ? "0095_investment_history.sql"
              : "0094_app_access.sql";
          expect(review.frontier).toBe(
            market
              ? "0097_price_metadata_continuation.sql"
              : investment
                ? "0094_app_access.sql"
                : "0093_gp_reported_total_refresh.sql",
          );
          expect(review.migrations.map((m) => m.name)).toEqual([newMigration]);
          const fixture = await populatedMigrationFixture(history, oldFrontier);
          const terminal = await populatedMigrationFixture(
            history,
            newFrontier,
          );
          const pending = unstable_splitSqlQuery(
            readFileSync(
              "packages/database/migrations/" + newMigration,
              "utf8",
            ),
          );
          expect(
            pending.every((sql) =>
              /^CREATE (?:TABLE|(?:UNIQUE )?INDEX|TRIGGER|VIEW)\b/.test(
                sql.replace(/--[^\n]*(?:\n|$)/gu, "").trim(),
              ),
            ),
          ).toBe(true);
          expect(terminal.tables.filter((t) => !createdTable(t.name))).toEqual(
            fixture.tables,
          );
          const runtime = await populatedMigrationDatabase(fixture);
          try {
            await preserveMigrationFixture(runtime.database, fixture, true);
            const cost = await runtime.execute(pending);
            expect(cost.records).toHaveLength(pending.length);
            expect(cost.rowsRead).toBeLessThanOrEqual(review.maxRowsRead);
            expect(cost.rowsWritten).toBeLessThanOrEqual(review.maxRowsWritten);
            const [preservation] = await preserveMigrationFixtures(
              runtime.database,
              [
                { fixture, exactObjects: false },
                {
                  fixture: investment
                    ? {
                        ...terminal,
                        tables: terminal.tables.map((table) =>
                          createdTable(table.name)
                            ? {
                                ...table,
                                rows: [],
                                sha256: migrationDigest("[]"),
                              }
                            : table,
                        ),
                      }
                    : terminal,
                  exactObjects: true,
                },
              ],
            );
            const plans = (
              await migrationForeignKeyPlans(runtime.database, terminal)
            ).filter((p) => createdTable(p.child));
            expect(plans.length).toBeGreaterThan(0);
            expect(
              plans.every(
                (p) =>
                  p.indexed &&
                  p.details.every(
                    (d) => /\bSEARCH\b/.test(d) && !/\bSCAN\b/.test(d),
                  ),
              ),
            ).toBe(true);
            const immutableProbes = await immutableMigrationProbes(
              runtime.database,
              fixture,
            );
            const scenario = MigrationSafetyScenarioSchema.parse({
              history,
              mainPositions: 120,
              unrelatedPositions: 120,
              fixtureHash: fixture.hash,
              tableRows: Object.fromEntries(
                fixture.tables.map((t) => [t.name, t.rows.length]),
              ),
              ...preservation,
              immutableProbes,
              statements: cost.statements,
              rowsRead: cost.rowsRead,
              rowsWritten: cost.rowsWritten,
              measuredFromFirstStatement: true,
              counterSource: "local-workerd-d1-meta",
              inboundForeignKeyPlans: "indexed-new-tables-no-parent-rebuild",
              completeSequence: "preparation-through-cleanup",
              physicalIntegrity: "unsupported-in-local-d1",
            });
            scenarios.set(review.id, [
              ...(scenarios.get(review.id) ?? []),
              scenario,
            ]);
            console.info(
              JSON.stringify({
                certifiedAppAccessUpgrade: {
                  history,
                  ...cost,
                  ...preservation,
                  newForeignKeyPlans: plans,
                },
              }),
            );
          } finally {
            await runtime.close();
          }
          return;
        }
        if (
          review.id === "public-source-reviews-v1" ||
          review.id === "public-inventory-v1"
        ) {
          const inventory = review.id === "public-inventory-v1";
          expect(review.frontier).toBe(
            inventory
              ? "0091_public_source_reviews.sql"
              : "0090_distribution_reviews.sql",
          );
          expect(review.migrations.map((item) => item.name)).toEqual([
            inventory
              ? "0092_public_holding_inventories.sql"
              : "0091_public_source_reviews.sql",
          ]);
          const pending = unstable_splitSqlQuery(
            readFileSync(
              `packages/database/migrations/${inventory ? "0092_public_holding_inventories.sql" : "0091_public_source_reviews.sql"}`,
              "utf8",
            ),
          );
          if (!inventory)
            expect(
              pending.every((sql) => !/^\s*(DROP|DELETE|UPDATE)\b/u.test(sql)),
            ).toBe(true);
          else
            expect(
              pending.flatMap((sql) =>
                [...sql.matchAll(/\bDROP TRIGGER ([a-z_]+)/gu)].map(
                  (match) => match[1],
                ),
              ),
            ).toEqual([
              "public_holding_security_head",
              "public_holding_security_head_update",
              "holding_import_application_head",
            ]);
          const fixture = await populatedMigrationFixture(
            history,
            inventory ? "0091" : "0090-public",
          );
          const terminal = await populatedMigrationFixture(
            history,
            inventory ? "0092" : "0091",
          );
          expect(fixture.counts.holding_positions).toBe(481);
          expect(fixture.counts.holding_position_snapshots).toBe(
            240 * (history + 2) + 1,
          );
          const runtime = await populatedMigrationDatabase(fixture);
          try {
            await preserveMigrationFixture(runtime.database, fixture, true);
            const cost = await runtime.execute(pending);
            expect(cost.rowsRead).toBeGreaterThan(0);
            expect(cost.rowsWritten).toBeGreaterThan(0);
            expect(cost.rowsRead).toBeLessThanOrEqual(review.maxRowsRead);
            expect(cost.rowsWritten).toBeLessThanOrEqual(review.maxRowsWritten);
            const [preservation] = await preserveMigrationFixtures(
              runtime.database,
              [
                { fixture, exactObjects: false },
                { fixture: terminal, exactObjects: true },
              ],
            );
            const plans = (
              await migrationForeignKeyPlans(runtime.database, terminal)
            ).filter(
              (plan) =>
                !fixture.tables.some((table) => table.name === plan.child),
            );
            expect(plans.length).toBeGreaterThan(0);
            expect(
              plans.every(
                (plan) =>
                  plan.indexed &&
                  plan.details.every(
                    (detail) =>
                      /\bSEARCH\b/u.test(detail) && !/\bSCAN\b/u.test(detail),
                  ),
              ),
            ).toBe(true);
            expect(
              (
                await runtime.database
                  .prepare(
                    "SELECT COUNT(*) count FROM public_holding_security_heads",
                  )
                  .first<{ count: number }>()
              )?.count,
            ).toBe(240);
            expect(
              (
                await runtime.database
                  .prepare(
                    "SELECT COUNT(*) count FROM public_holding_import_heads",
                  )
                  .first<{ count: number }>()
              )?.count,
            ).toBe(2);
            if (inventory) {
              expect(
                await runtime.database
                  .prepare(
                    `SELECT COUNT(*) count FROM holding_import_application_heads a
                JOIN holding_import_applications application ON application.id=a.application_id
                JOIN holding_import_rows r ON r.id=application.import_row_id JOIN holding_imports i ON i.id=r.import_id
                JOIN source_documents d ON d.id=i.source_document_id JOIN public_holding_security_heads public ON public.position_id=a.position_id WHERE a.source_updated_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',d.retrieved_at)`,
                  )
                  .first("count"),
              ).toBe(0);
              expect(
                pending.flatMap((sql) =>
                  [...sql.matchAll(/\bDROP INDEX ([a-z_]+)/gu)].map(
                    (match) => match[1],
                  ),
                ),
              ).toEqual([
                "holding_position_ownerships_household_container_idx",
                "holding_positions_household_id_idx",
              ]);
              expect(
                terminal.objects.find(
                  (object) =>
                    object.type === "index" &&
                    object.name ===
                      "holding_position_ownerships_household_container_idx",
                )?.sql,
              ).toContain("protected_position_key");
              expect(
                terminal.objects.find(
                  (object) =>
                    object.type === "index" &&
                    object.name === "holding_positions_household_id_idx",
                )?.sql,
              ).toContain("household_id,provider,id");
              expect(
                await runtime.database
                  .prepare(
                    "SELECT COUNT(*) count FROM public_holding_active_positions",
                  )
                  .first("count"),
              ).toBe(240);
              expect(
                await runtime.database
                  .prepare(
                    "SELECT COUNT(*) count FROM public_holding_inventories",
                  )
                  .first("count"),
              ).toBe(0);
              for (const trigger of [
                "public_holding_security_head",
                "public_holding_security_head_update",
              ]) {
                const after = terminal.objects.find(
                  (object) =>
                    object.type === "trigger" && object.name === trigger,
                )!;
                const before = fixture.objects.find(
                  (object) =>
                    object.type === "trigger" && object.name === trigger,
                )!;
                expect(after.sql).not.toBe(before.sql);
                expect(after.sql).toContain(
                  "excluded.identity_key IS NOT public_holding_security_heads.identity_key",
                );
              }
              expect(
                terminal.objects.find(
                  (object) =>
                    object.type === "trigger" &&
                    object.name === "holding_import_application_head",
                )?.sql,
              ).toContain("source_updated_at");
            }
            const immutableProbes = await immutableMigrationProbes(
              runtime.database,
              fixture,
            );
            scenarios.set(review.id, [
              ...(scenarios.get(review.id) ?? []),
              MigrationSafetyScenarioSchema.parse({
                history,
                mainPositions: 120,
                unrelatedPositions: 120,
                fixtureHash: fixture.hash,
                tableRows: Object.fromEntries(
                  fixture.tables.map((table) => [
                    table.name,
                    table.rows.length,
                  ]),
                ),
                ...preservation,
                immutableProbes,
                statements: cost.statements,
                rowsRead: cost.rowsRead,
                rowsWritten: cost.rowsWritten,
                measuredFromFirstStatement: true,
                counterSource: "local-workerd-d1-meta",
                inboundForeignKeyPlans:
                  "indexed-current-head-backfill-no-parent-rebuild",
                completeSequence: "preparation-through-cleanup",
                physicalIntegrity: "unsupported-in-local-d1",
              }),
            ]);
            console.info(
              JSON.stringify({
                certifiedPublicSourceUpgrade: {
                  history,
                  ...cost,
                  ...preservation,
                  newForeignKeyPlans: plans,
                },
              }),
            );
          } finally {
            await runtime.close();
          }
          return;
        }
        const upgrade = triggerUpgrades.find(({ id }) => id === review.id);
        if (!upgrade)
          throw new Error("Unimplemented trigger-only migration case");
        expect(review.frontier).toBe(upgrade.frontier);
        expect(review.migrations.map((item) => item.name)).toEqual([
          upgrade.migration,
        ]);
        const pending = review.migrations.flatMap((item) =>
          unstable_splitSqlQuery(
            readFileSync(
              join("packages/database/migrations", item.name),
              "utf8",
            ),
          ),
        );
        expect(pending).toHaveLength(upgrade.statements);
        const proxyUpgrade = review.id === "market-proxy-basis-v1";
        expect(
          pending.every(
            (sql) =>
              (proxyUpgrade &&
                sql.replace(/--[^\n]*/gu, "").trim() ===
                  "ALTER TABLE exposure_market_members ADD COLUMN proxy_basis_json TEXT") ||
              /^(?:--[^\r\n]*(?:\r?\n|$)\s*)*(?:(?:DROP|CREATE) (?:TRIGGER|VIEW|TABLE|INDEX)\b|WITH\b)/u.test(
                sql.trim(),
              ),
          ),
        ).toBe(true);
        const fixture = await populatedMigrationFixture(
          history,
          upgrade.oldFixture,
        );
        const terminal = await populatedMigrationFixture(
          history,
          upgrade.newFixture,
        );
        const positions = fixture.tables.find(
          (table) => table.name === "holding_positions",
        )!;
        const manual = positions.rows.find(
          (row) => row[positions.columns.indexOf("provider")] === "manual",
        )!;
        expect(manual).toBeDefined();
        const snapshots = fixture.tables.find(
          (table) => table.name === "holding_position_snapshots",
        )!;
        const manualSnapshot = snapshots.rows.find(
          (row) =>
            row[snapshots.columns.indexOf("position_id")] ===
            manual[positions.columns.indexOf("id")],
        )!;
        expect(manualSnapshot).toBeDefined();
        expect(
          manualSnapshot[snapshots.columns.indexOf("realized_value_minor")],
        ).toBeNull();
        if (proxyUpgrade) {
          const member = "exposure_market_members";
          const oldMembers = fixture.tables.find((t) => t.name === member)!;
          const newMembers = terminal.tables.find((t) => t.name === member)!;
          expect(oldMembers.rows.length).toBeGreaterThanOrEqual(240);
          expect(newMembers.columns).toEqual([
            ...oldMembers.columns,
            "proxy_basis_json",
          ]);
          const oldIndex = oldMembers.columns.indexOf("position_id");
          const identities = new Set(
            oldMembers.rows.map((row) => JSON.stringify(row)),
          );
          expect(newMembers.rows.length).toBe(oldMembers.rows.length);
          for (const row of newMembers.rows) {
            expect(row[oldIndex]).toBeTruthy();
            expect(row.at(-1)).toBeNull();
            expect(identities.has(JSON.stringify(row.slice(0, -1)))).toBe(true);
          }
          expect(terminal.tables.filter((t) => t.name !== member)).toEqual(
            fixture.tables.filter((t) => t.name !== member),
          );
        } else {
          expect(
            terminal.tables.filter(
              (table) => table.name !== "holding_price_metadata_heads",
            ),
          ).toEqual(fixture.tables);
        }
        const changedNames = new Set<string>(upgrade.changedNames);
        if (review.id === "economics-snapshot-lookup-v1") {
          const name = "holding_position_economics_proposals_integrity_insert";
          const prior = fixture.triggers.find(
            (trigger) => trigger.name === name,
          )!;
          const next = terminal.triggers.find(
            (trigger) => trigger.name === name,
          )!;
          const lookup = "FROM holding_import_applications candidate\n";
          expect(prior.sql.split(lookup)).toHaveLength(2);
          expect(next.sql).toBe(
            prior.sql.replace(
              lookup,
              "FROM holding_import_applications candidate INDEXED BY holding_import_applications_position_applied_idx\n",
            ),
          );
        }
        expect(
          terminal.objects.filter((object) => !changedNames.has(object.name)),
        ).toEqual(
          fixture.objects.filter((object) => !changedNames.has(object.name)),
        );
        expect(
          terminal.objects.filter((object) => changedNames.has(object.name)),
        ).toHaveLength(
          upgrade.changedNames.length -
            (review.id === "price-metadata-continuation-v1" ? 1 : 0),
        );
        const runtime = await populatedMigrationDatabase(fixture);
        try {
          await preserveMigrationFixture(runtime.database, fixture, true);
          expect(
            await immutableMigrationProbes(runtime.database, fixture),
          ).toBe(3);
          const cost = await runtime.execute(pending);
          expect(cost.statements).toBe(pending.length);
          expect(cost.records).toHaveLength(pending.length);
          expect(cost.rowsRead).toBeLessThanOrEqual(review.maxRowsRead);
          expect(cost.rowsWritten).toBeLessThanOrEqual(review.maxRowsWritten);
          if (review.id === "price-metadata-continuation-v1") {
            const backfill = pending.find((sql) =>
              /WITH history AS MATERIALIZED/u.test(sql),
            )!;
            const plan = await runtime.database
              .prepare(`EXPLAIN QUERY PLAN ${backfill}`)
              .all<{ id: number; parent: number; detail: string }>();
            const nodes = new Map(plan.results.map((row) => [row.id, row]));
            expect(
              plan.results.filter((row) => {
                if (!/SCAN (?:head|observation|dated)\b/u.test(row.detail))
                  return false;
                let parent = nodes.get(row.parent);
                while (parent) {
                  if (/CORRELATED/u.test(parent.detail)) return true;
                  parent = nodes.get(parent.parent);
                }
                return false;
              }),
            ).toEqual([]);
          }
          const [preservation, terminalPreservation] =
            await preserveMigrationFixtures(runtime.database, [
              {
                fixture:
                  review.id === "price-metadata-continuation-v1"
                    ? {
                        ...fixture,
                        // Its exact covering replacement is included in the complete
                        // terminal schema proof below; no old table data is excluded.
                        objects: fixture.objects.filter(
                          (object) =>
                            object.name !==
                            "holding_price_source_heads_household",
                        ),
                      }
                    : fixture,
                exactObjects: false,
              },
              { fixture: terminal, exactObjects: true },
            ]);
          expect(terminalPreservation).toEqual({
            tablesPreserved: upgrade.tables,
            schemaObjectsPreserved: upgrade.schemaObjects,
            foreignKeyViolations: 0,
          });
          if (review.id === "price-metadata-continuation-v1") {
            const metadata = await runtime.database
              .prepare(
                `SELECT metadata.household_id,
              metadata.current_quote_id=head.quote_id price_matches,class.share_class,basis.basis_json,current.price_date,current.share_class raw_class,current.basis_json raw_basis
              FROM holding_price_metadata_heads metadata
              JOIN holding_price_quotes class ON class.id=metadata.share_class_quote_id AND class.household_id=metadata.household_id AND class.source_position_id=metadata.source_position_id
              JOIN holding_price_quotes basis ON basis.id=metadata.share_basis_quote_id AND basis.household_id=metadata.household_id AND basis.source_position_id=metadata.source_position_id
              JOIN holding_price_current_quotes head ON head.source_position_id=metadata.source_position_id
              JOIN holding_price_quotes current ON current.id=head.quote_id`,
              )
              .all<{
                household_id: string;
                price_matches: number;
                share_class: string;
                basis_json: string;
                price_date: null;
                raw_class: null;
                raw_basis: null;
              }>();
            expect(metadata.results).toHaveLength(240);
            expect(
              new Set(metadata.results.map((row) => row.household_id)).size,
            ).toBe(2);
            for (const row of metadata.results) {
              expect(row.price_matches).toBe(1);
              expect(row.share_class).toBe("Common");
              expect(JSON.parse(row.basis_json)).toEqual({
                key: "issuer-original",
                unitsPerOriginal: 10,
              });
              expect([row.price_date, row.raw_class, row.raw_basis]).toEqual([
                null,
                null,
                null,
              ]);
            }
            if (history === 24) {
              const earlier = scenarios.get(review.id)![0]!;
              expect(cost.rowsRead).toBeLessThanOrEqual(earlier.rowsRead * 2);
              expect(cost.rowsWritten).toBe(earlier.rowsWritten);
            }
          }
          const immutableProbes = await immutableMigrationProbes(
            runtime.database,
            fixture,
          );
          if (review.id === "economics-snapshot-lookup-v1") {
            const target = await runtime.database
              .prepare(
                `
              SELECT p.id position_id, p.household_id, h.owner_user_id,
                current.snapshot_id, prior.snapshot_id stale_snapshot_id
              FROM holding_positions p JOIN households h ON h.id=p.household_id
              JOIN holding_import_application_heads current ON current.position_id=p.id
              JOIN holding_import_applications prior INDEXED BY holding_import_applications_position_applied_idx ON prior.position_id=p.id
              WHERE p.provider='wefunder'
                AND prior.snapshot_id<>current.snapshot_id
                AND NOT EXISTS (SELECT 1 FROM holding_purchase_heads head
                  JOIN holding_purchase_reviews receipt ON receipt.id=head.review_id
                  WHERE head.position_id=p.id AND json_type(receipt.receipt_json,'$.details.investmentTerms') IS NOT NULL)
              ORDER BY p.id,prior.id LIMIT 1`,
              )
              .first<{
                position_id: string;
                household_id: string;
                owner_user_id: string;
                snapshot_id: string;
                stale_snapshot_id: string;
              }>();
            if (target === null)
              throw new Error("Missing unreviewed synthetic economics history");
            const insert = (
              id: string,
              snapshot: string,
              owner: string,
              prior: string | null = null,
            ) =>
              runtime.database
                .prepare(
                  `
              INSERT INTO holding_position_economics_proposals
                (id,household_id,position_id,snapshot_id,supersedes_proposal_id,commitment_minor,funded_minor,
                 annual_admin_fee_ppm,admin_fee_years,carry_ppm,note,created_by,created_at,immutable)
              SELECT ?,p.household_id,p.id,s.id,?,
                COALESCE((SELECT json_extract(review.state_json,'$.amountCorrection.amountMinor')
                  FROM holding_investment_reviews review WHERE review.household_id=p.household_id
                    AND review.position_id=p.id ORDER BY review.version DESC LIMIT 1),
                  CASE p.provider WHEN 'angellist' THEN s.invested_minor ELSE s.allocation_minor END),
                s.invested_minor,0,1,0,'Synthetic migration guard probe',?,'2026-08-20T00:00:00.000Z',1
              FROM holding_positions p JOIN holding_position_snapshots s ON s.position_id=p.id
              WHERE p.id=? AND s.id=?`,
                )
                .bind(id, prior, owner, target.position_id, snapshot);
            await expect(
              insert(
                "synthetic-stale-economics",
                target.stale_snapshot_id,
                target.owner_user_id,
              ).run(),
            ).rejects.toThrow(/position economics proposal snapshot is stale/);
            await expect(
              insert(
                "synthetic-foreign-economics",
                target.snapshot_id,
                "synthetic-missing-owner",
              ).run(),
            ).rejects.toThrow(
              /position economics proposal provenance mismatch/,
            );
            await expect(
              insert(
                "synthetic-chain-economics",
                target.snapshot_id,
                target.owner_user_id,
                "synthetic-missing-proposal",
              ).run(),
            ).rejects.toThrow(/position economics proposal chain mismatch/);
            expect(
              (
                await insert(
                  "synthetic-current-economics",
                  target.snapshot_id,
                  target.owner_user_id,
                ).run()
              ).meta.changes,
            ).toBe(1);
            const plan = await runtime.database
              .prepare(
                `EXPLAIN QUERY PLAN
              SELECT candidate.snapshot_id FROM holding_import_applications candidate INDEXED BY holding_import_applications_position_applied_idx
              JOIN holding_position_snapshots candidate_snapshot ON candidate_snapshot.id=candidate.snapshot_id
              WHERE candidate.position_id=? AND candidate.household_id=?
              ORDER BY candidate.applied_at DESC,candidate_snapshot.observed_at DESC,candidate.id DESC LIMIT 1`,
              )
              .bind(target.position_id, target.household_id)
              .all<{ detail: string }>();
            expect(
              plan.results.some(
                ({ detail }) =>
                  detail.includes(
                    "holding_import_applications_position_applied_idx",
                  ) && /SEARCH/.test(detail),
              ),
            ).toBe(true);
            expect(
              plan.results.some(({ detail }) =>
                /SCAN candidate\b/.test(detail),
              ),
            ).toBe(false);
          }
          const scenario = MigrationSafetyScenarioSchema.parse({
            history,
            mainPositions: 120,
            unrelatedPositions: 120,
            fixtureHash: fixture.hash,
            tableRows: Object.fromEntries(
              fixture.tables.map((table) => [table.name, table.rows.length]),
            ),
            ...preservation,
            immutableProbes,
            statements: cost.statements,
            rowsRead: cost.rowsRead,
            rowsWritten: cost.rowsWritten,
            measuredFromFirstStatement: true,
            counterSource: "local-workerd-d1-meta",
            inboundForeignKeyPlans: proxyUpgrade
              ? "nullable-column-and-trigger-no-table-dml"
              : review.id === "price-metadata-continuation-v1"
                ? "indexed-current-head-backfill-no-parent-rebuild"
                : "not-applicable-trigger-only-no-table-dml",
            completeSequence: "preparation-through-cleanup",
            physicalIntegrity: "unsupported-in-local-d1",
          });
          scenarios.set(review.id, [
            ...(scenarios.get(review.id) ?? []),
            scenario,
          ]);
          console.info(
            JSON.stringify({
              certifiedTriggerUpgrade: {
                caseId: review.id,
                history,
                ...cost,
                ...preservation,
                immutableProbes,
                foreignKeyPlans: scenario.inboundForeignKeyPlans,
              },
            }),
          );
        } finally {
          await runtime.close();
        }
      }, 120_000);
    }
  }

  for (const history of registry.baseline.histories) {
    it(`certifies the unchanged applied-schema baseline with no pending SQL at ${history} captures`, async () => {
      if (
        registry.baseline.fixture !== "public-holding-history-v1" ||
        registry.baseline.frontier !== "0099_market_proxy_basis.sql" ||
        registry.cases.length !== 10 ||
        registry.cases[0]?.id !== "distribution-reviews-v1"
      )
        throw new Error(
          "New frontier needs an implemented baseline and OLD-schema upgrade runner, not a metadata-only approval",
        );
      const fixture = await populatedMigrationFixture(history, "0099");
      const runtime = await populatedMigrationDatabase(fixture);
      let scenario: MigrationSafetyBaselineScenario;
      try {
        const plans = await migrationForeignKeyPlans(runtime.database, fixture);
        const foreignKeyPlanEvidence = {
          digest: migrationDigest(JSON.stringify(plans)),
          foreignKeys: fixture.foreignKeys.length,
          emptyLookups: plans.filter(
            (plan) => plan.value === "synthetic-missing-reference",
          ).length,
          positiveLookups: plans.filter(
            (plan) => plan.value !== "synthetic-missing-reference",
          ).length,
          indexSearches: plans.filter((plan) =>
            plan.details.every(
              (detail) =>
                /\bSEARCH\b/u.test(detail) && !/\bSCAN\b/u.test(detail),
            ),
          ).length,
          tableScans: plans.filter((plan) =>
            plan.details.some((detail) => /\bSCAN\b/u.test(detail)),
          ).length,
        };
        expect(foreignKeyPlanEvidence.emptyLookups).toBe(
          fixture.foreignKeys.length,
        );
        expect(foreignKeyPlanEvidence.positiveLookups).toBeGreaterThan(0);
        expect(foreignKeyPlanEvidence.indexSearches).toBeGreaterThan(0);
        expect(foreignKeyPlanEvidence.tableScans).toBeGreaterThan(0);
        expect(
          foreignKeyPlanEvidence.indexSearches +
            foreignKeyPlanEvidence.tableScans,
        ).toBe(plans.length);
        expect(
          plans
            .filter((plan) => !plan.indexed)
            .every((plan) =>
              plan.details.some((detail) => /\bSCAN\b/u.test(detail)),
            ),
        ).toBe(true);
        const immutableProbes = await immutableMigrationProbes(
          runtime.database,
          fixture,
        );
        const households = fixture.tables.find(
          (table) => table.name === "households",
        )!;
        const row = households.rows[0]!;
        const id = row[households.columns.indexOf("id")];
        const name = row[households.columns.indexOf("name")];
        await runtime.database
          .prepare("UPDATE households SET name=? WHERE id=?")
          .bind("Synthetic preservation corruption", id)
          .run();
        try {
          await expect(
            preserveMigrationFixture(runtime.database, fixture, true),
          ).rejects.toThrow("Old rows changed in households");
        } finally {
          await runtime.database
            .prepare("UPDATE households SET name=? WHERE id=?")
            .bind(name, id)
            .run();
        }
        await expect(
          preserveMigrationFixtures(runtime.database, [
            { fixture: { ...fixture, tables: [] }, exactObjects: true },
            {
              fixture: {
                ...fixture,
                tables: [
                  {
                    ...households,
                    sha256: migrationDigest("Synthetic mismatched expectation"),
                  },
                ],
              },
              exactObjects: true,
            },
          ]),
        ).rejects.toThrow("Old rows changed in households");
        const reversedRows = households.rows.map((values) =>
          [...values].reverse(),
        );
        const [preservation] = await preserveMigrationFixtures(
          runtime.database,
          [
            { fixture, exactObjects: true },
            {
              fixture: {
                ...fixture,
                tables: [
                  {
                    ...households,
                    columns: [...households.columns].reverse(),
                    rows: reversedRows,
                    sha256: migrationDigest(
                      JSON.stringify(
                        reversedRows
                          .map((values) => JSON.stringify(values))
                          .sort(),
                      ),
                    ),
                  },
                ],
              },
              exactObjects: true,
            },
          ],
        );
        expect(preservation).toEqual({
          tablesPreserved: 166,
          schemaObjectsPreserved: 837,
          foreignKeyViolations: 0,
        });
        scenario = MigrationSafetyBaselineScenarioSchema.parse({
          history,
          mainPositions: 120,
          unrelatedPositions: 120,
          fixtureHash: fixture.hash,
          tableRows: Object.fromEntries(
            fixture.tables.map((table) => [table.name, table.rows.length]),
          ),
          ...preservation,
          immutableProbes,
          validation: "applied-schema-preservation",
          migrationMeasurement: "not-applicable-no-pending-sql",
          inboundForeignKeyPlans: "observed-existing-index-and-scan-plans",
          foreignKeyPlanEvidence,
          physicalIntegrity: "unsupported-in-local-d1",
        });
        console.info(
          JSON.stringify({
            certifiedAppliedSchemaBaseline: {
              caseId: registry.baseline.id,
              history,
              migrationMeasurement: "not-applicable-no-pending-sql",
              ...preservation,
              foreignKeyPlanEvidence,
              platformSchemaObjects: runtime.platformSchemaObjects.length,
              platformSchemaDigest: migrationDigest(
                JSON.stringify(runtime.platformSchemaObjects),
              ),
            },
          }),
        );
      } finally {
        await runtime.close();
      }
      baselineScenarios.push(scenario);
    }, 120_000);
  }
});
