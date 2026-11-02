import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import {
  MigrationSafetyReceiptSchema,
  MigrationSafetyBaselineScenarioSchema,
  migrationSourceDigest,
  readMigrationSafetyRegistry,
  validateMigrationSafetyReceipt,
  type MigrationSafetyReceipt,
  type MigrationSafetyBaselineScenario,
} from "./d1-migration-safety";
import {
  hasUsableMigrationForeignKeyIndex,
  immutableMigrationProbes,
  migrationForeignKeyPlans,
  migrationDigest,
  populatedMigrationDatabase,
  populatedMigrationFixture,
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
const scenarios = new Map<
  string,
  MigrationSafetyReceipt["cases"][number]["scenarios"]
>();
const receiptPath =
  process.env.KEEL_MIGRATION_SAFETY_RECEIPT ??
  (process.env.KEEL_NATIVE_EVIDENCE_DIR
    ? join(process.env.KEEL_NATIVE_EVIDENCE_DIR, "migration-safety.json")
    : undefined);
let sourceDigest = "";

beforeAll(() => {
  if (receiptPath) rmSync(receiptPath, { force: true });
  sourceDigest = migrationSourceDigest();
});

afterAll(() => {
  if (
    ![12, 24].every((history) => completedRegressions.has(history)) ||
    baselineScenarios.length !== 2 ||
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
      const original = await populatedMigrationDatabase(fixture);
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
        await preserveMigrationFixture(original.database, fixture);
        expect(await immutableMigrationProbes(original.database, fixture)).toBe(
          3,
        );
        originalReads = cost.rowsRead;
      } finally {
        await original.close();
      }

      const corrected = await populatedMigrationDatabase(fixture);
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
        await preserveMigrationFixture(corrected.database, fixture);
        expect(
          await immutableMigrationProbes(corrected.database, fixture),
        ).toBe(3);
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
      completedRegressions.add(history);
    }, 120_000);

    it(`certifies the unchanged applied-schema baseline with no pending SQL at ${history} captures`, async () => {
      if (
        registry.baseline.fixture !== "holding-history-v1" ||
        registry.baseline.frontier !== "0089_manual_holdings.sql" ||
        registry.cases.length !== 0
      )
        throw new Error(
          "New frontier needs an implemented baseline and OLD-schema upgrade runner, not a metadata-only approval",
        );
      const fixture = await populatedMigrationFixture(history, "0089");
      const runtime = await populatedMigrationDatabase(fixture);
      let scenario: MigrationSafetyBaselineScenario;
      try {
        const preservation = await preserveMigrationFixture(
          runtime.database,
          fixture,
          true,
        );
        expect(preservation).toEqual({
          tablesPreserved: 137,
          schemaObjectsPreserved: 691,
          foreignKeyViolations: 0,
        });
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
        if (history === 24) {
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
        }
        await preserveMigrationFixture(runtime.database, fixture, true);
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
