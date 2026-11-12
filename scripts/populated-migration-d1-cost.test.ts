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
          review.id === "investment-history-v1"
        ) {
          const investment = review.id === "investment-history-v1";
          const createdTable = (name: string) =>
            investment
              ? /^investment_(?:history_|transaction_|tax_lots$)/u.test(name)
              : name.startsWith("app_access_");
          const oldFrontier = investment ? "0094" : "0093";
          const newFrontier = investment ? "0095" : "0094";
          const newMigration = investment
            ? "0095_investment_history.sql"
            : "0094_app_access.sql";
          expect(review.frontier).toBe(
            investment
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
              /^CREATE (?:TABLE|(?:UNIQUE )?INDEX|TRIGGER)\b/.test(
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
            const preservation = await preserveMigrationFixture(
              runtime.database,
              fixture,
            );
            await preserveMigrationFixture(
              runtime.database,
              investment
                ? {
                    ...terminal,
                    tables: terminal.tables.map((table) =>
                      createdTable(table.name)
                        ? { ...table, rows: [], sha256: migrationDigest("[]") }
                        : table,
                    ),
                  }
                : terminal,
              true,
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
            const preservation = await preserveMigrationFixture(
              runtime.database,
              fixture,
            );
            await preserveMigrationFixture(runtime.database, terminal, true);
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
        const gpTotal = review.id === "gp-reported-total-v1";
        expect(review.id).toBe(
          gpTotal ? "gp-reported-total-v1" : "distribution-reviews-v1",
        );
        expect(review.frontier).toBe(
          gpTotal
            ? "0092_public_holding_inventories.sql"
            : "0089_manual_holdings.sql",
        );
        expect(review.migrations.map((item) => item.name)).toEqual([
          gpTotal
            ? "0093_gp_reported_total_refresh.sql"
            : "0090_distribution_reviews.sql",
        ]);
        const pending = review.migrations.flatMap((item) =>
          unstable_splitSqlQuery(
            readFileSync(
              join("packages/database/migrations", item.name),
              "utf8",
            ),
          ),
        );
        expect(pending).toHaveLength(gpTotal ? 5 : 6);
        expect(
          pending.every((sql) =>
            /^(?:DROP|CREATE) (?:TRIGGER|VIEW)\b/u.test(sql.trim()),
          ),
        ).toBe(true);
        const fixture = await populatedMigrationFixture(
          history,
          gpTotal ? "0092" : "0089",
        );
        const terminal = await populatedMigrationFixture(
          history,
          gpTotal ? "0093" : "0090",
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
        expect(terminal.tables).toEqual(fixture.tables);
        const changedNames = new Set(
          gpTotal
            ? [
                "holding_gp_total_refresh_guard",
                "holding_price_current_quotes",
                "holding_selected_valuation_guard",
                "holding_price_continuation_guard",
              ]
            : [
                "holding_purchase_unified_guard",
                "holding_purchase_price_evidence_guard",
                "holding_purchase_reported_value_guard",
                "holding_purchase_distribution_guard",
              ],
        );
        expect(
          terminal.objects.filter((object) => !changedNames.has(object.name)),
        ).toEqual(
          fixture.objects.filter((object) => !changedNames.has(object.name)),
        );
        expect(
          terminal.objects.filter((object) => changedNames.has(object.name)),
        ).toHaveLength(4);
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
          const preservation = await preserveMigrationFixture(
            runtime.database,
            fixture,
          );
          expect(
            await preserveMigrationFixture(runtime.database, terminal, true),
          ).toEqual({
            tablesPreserved: gpTotal ? 147 : 137,
            schemaObjectsPreserved: gpTotal ? 749 : 693,
            foreignKeyViolations: 0,
          });
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
              fixture.tables.map((table) => [table.name, table.rows.length]),
            ),
            ...preservation,
            immutableProbes,
            statements: cost.statements,
            rowsRead: cost.rowsRead,
            rowsWritten: cost.rowsWritten,
            measuredFromFirstStatement: true,
            counterSource: "local-workerd-d1-meta",
            inboundForeignKeyPlans: "not-applicable-trigger-only-no-table-dml",
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
                foreignKeyPlans: "not-applicable-trigger-only-no-table-dml",
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
        registry.baseline.frontier !== "0095_investment_history.sql" ||
        registry.cases.length !== 6 ||
        registry.cases[0]?.id !== "distribution-reviews-v1"
      )
        throw new Error(
          "New frontier needs an implemented baseline and OLD-schema upgrade runner, not a metadata-only approval",
        );
      const fixture = await populatedMigrationFixture(history, "0095");
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
        const preservation = await preserveMigrationFixture(
          runtime.database,
          fixture,
          true,
        );
        expect(preservation).toEqual({
          tablesPreserved: 159,
          schemaObjectsPreserved: 812,
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
