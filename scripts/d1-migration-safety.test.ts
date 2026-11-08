import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertMigrationSafety,
  IMPLEMENTED_BASELINE_TABLES,
  MigrationSafetyReceiptSchema,
  MigrationSafetyScenarioSchema,
  migrationSourceDigest,
  migrationFootprint,
  readMigrationSafetyRegistry,
  validateMigrationSafetyReceipt,
  type MigrationSafetyReceipt,
} from "./d1-migration-safety";
import {
  preserveMigrationFixture,
  type PopulatedMigrationFixture,
} from "./test-support/populated-migration";

const now = new Date("2026-09-01T12:00:00.000Z");
const gitSha = "a".repeat(40);
const pending: string[] = [];
const futureMigration = "0093_unmeasured.sql";
const immutableFrontier = "0089_manual_holdings.sql";
const distributionFrontier = "0090_distribution_reviews.sql";
const sourceFrontier = "0091_public_source_reviews.sql";
const frontier = "0092_public_holding_inventories.sql";
const temporaryRoots: string[] = [];
function isolatedRegistry() {
  const root = mkdtempSync(join(tmpdir(), "keel-migration-contract-"));
  temporaryRoots.push(root);
  cpSync(
    "packages/database/migrations",
    join(root, "packages/database/migrations"),
    { recursive: true },
  );
  cpSync(
    ".tugling/d1-migrations.json",
    join(root, ".tugling/d1-migrations.json"),
    { recursive: true },
  );
  return root;
}
function tableRows(history: 12 | 24, terminal = true, publicHistory = true) {
  return {
    ...Object.fromEntries(
      IMPLEMENTED_BASELINE_TABLES.filter(
        (table) =>
          terminal ||
          !/^(public_holding_|portfolio_baseline_public_source_versions$)/u.test(
            table,
          ),
      ).map((table) => [table, 0]),
    ),
    holding_positions: publicHistory ? 481 : 241,
    holding_position_snapshots: (publicHistory ? 240 : 120) * (history + 2) + 1,
    holding_purchase_reviews: 120 * history + 1,
    portfolio_baseline_items: 120,
    manual_holding_submissions: 1,
    households: 2,
  };
}
function receipt(): MigrationSafetyReceipt {
  return MigrationSafetyReceiptSchema.parse({
    version: 2,
    gitSha,
    sourceDigest: migrationSourceDigest(),
    generatedAt: now.toISOString(),
    baseline: {
      kind: "baseline",
      id: "public-inventory-schema-v1",
      frontier,
      pending: [],
      scenarios: [
        {
          history: 24,
          mainPositions: 120,
          unrelatedPositions: 120,
          fixtureHash: "d".repeat(64),
          tableRows: tableRows(24),
          tablesPreserved: 147,
          schemaObjectsPreserved: 746,
          foreignKeyViolations: 0,
          immutableProbes: 3,
          validation: "applied-schema-preservation",
          migrationMeasurement: "not-applicable-no-pending-sql",
          inboundForeignKeyPlans: "observed-existing-index-and-scan-plans",
          foreignKeyPlanEvidence: {
            digest: "e".repeat(64),
            foreignKeys: 2,
            emptyLookups: 2,
            positiveLookups: 1,
            indexSearches: 1,
            tableScans: 2,
          },
          physicalIntegrity: "unsupported-in-local-d1",
        },
      ],
    },
    cases: readMigrationSafetyRegistry().cases.map((review) => ({
      kind: "upgrade",
      id: review.id,
      frontier: review.frontier,
      pending: review.migrations.map((item) => item.name),
      scenarios: [12, 24].map((history) => ({
        ...upgradeScenario(),
        history,
        fixtureHash: (history === 12 ? "c" : "d").repeat(64),
        tableRows: tableRows(
          history as 12 | 24,
          false,
          review.id !== "distribution-reviews-v1",
        ),
        tablesPreserved: Object.keys(
          tableRows(
            history as 12 | 24,
            false,
            review.id !== "distribution-reviews-v1",
          ),
        ).length,
        rowsRead: 10,
        rowsWritten: 4,
        inboundForeignKeyPlans:
          review.id !== "distribution-reviews-v1"
            ? "indexed-current-head-backfill-no-parent-rebuild"
            : "not-applicable-trigger-only-no-table-dml",
      })),
    })),
  });
}
function futureCase(root: string) {
  const sql = "CREATE TABLE synthetic_unmeasured (id TEXT PRIMARY KEY);\n";
  writeFileSync(
    join(root, "packages/database/migrations", futureMigration),
    sql,
  );
  return {
    kind: "upgrade" as const,
    id: "unimplemented-upgrade-v1",
    frontier,
    migrations: [
      {
        name: futureMigration,
        sha256: createHash("sha256").update(sql).digest("hex"),
      },
    ],
    fixture: "holding-history-v1",
    mainPositions: 120 as const,
    unrelatedPositions: 120 as const,
    histories: [12, 24] as [12, 24],
    maxRowsRead: 20_000,
    maxRowsWritten: 10_000,
  };
}
function upgradeScenario() {
  return {
    history: 12 as const,
    mainPositions: 120 as const,
    unrelatedPositions: 120 as const,
    fixtureHash: "c".repeat(64),
    tableRows: tableRows(12, false, false),
    tablesPreserved: 137,
    schemaObjectsPreserved: 693,
    foreignKeyViolations: 0 as const,
    immutableProbes: 3 as const,
    physicalIntegrity: "unsupported-in-local-d1" as const,
    statements: 1,
    rowsRead: 13_000,
    rowsWritten: 7_000,
    measuredFromFirstStatement: true as const,
    counterSource: "local-workerd-d1-meta" as const,
    inboundForeignKeyPlans:
      "indexed-positive-and-empty-before-destructive-statements" as const,
    completeSequence: "preparation-through-cleanup" as const,
  };
}
const admit = (evidence: unknown, request = { frontier, pending, gitSha }) =>
  assertMigrationSafety({ ...request, receipt: evidence, now });

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("populated D1 migration evidence", () => {
  it("registers every migration and keeps applied SQL byte-identical", () => {
    const registry = readMigrationSafetyRegistry();
    expect(registry.immutableMigrations.at(-1)).toEqual({
      name: immutableFrontier,
      sha256:
        "ee26f2377d723ca9e7d4752b1e1d56de675a9fb4d3b7fbdc05e32d9877281ea2",
    });
    expect(registry.cases).toMatchObject([
      {
        id: "distribution-reviews-v1",
        frontier: immutableFrontier,
        migrations: [{ name: distributionFrontier }],
      },
      {
        id: "public-source-reviews-v1",
        frontier: distributionFrontier,
        migrations: [{ name: sourceFrontier }],
      },
      {
        id: "public-inventory-v1",
        frontier: sourceFrontier,
        migrations: [{ name: frontier }],
      },
    ]);
    expect(registry.baseline).toMatchObject({
      kind: "baseline",
      id: "public-inventory-schema-v1",
      frontier,
      pending: [],
    });
    expect(IMPLEMENTED_BASELINE_TABLES).toHaveLength(147);
  });

  it("refuses a registry that attempts to approve rewritten applied history", () => {
    const root = isolatedRegistry();
    const path = join(root, ".tugling/d1-migrations.json");
    const registry = JSON.parse(readFileSync(path, "utf8"));
    const first = registry.immutableMigrations[0];
    const sqlPath = join(root, "packages/database/migrations", first.name);
    const changed =
      readFileSync(sqlPath, "utf8") + "\n-- Synthetic historical rewrite.\n";
    writeFileSync(sqlPath, changed);
    first.sha256 = createHash("sha256").update(changed).digest("hex");
    writeFileSync(path, JSON.stringify(registry));
    expect(() => readMigrationSafetyRegistry(root)).toThrow(
      "manifest is immutable",
    );
  });

  it("blocks a new migration until its populated old-schema case is registered", () => {
    const root = isolatedRegistry();
    writeFileSync(
      join(root, "packages/database/migrations/0091_unmeasured.sql"),
      "CREATE TABLE synthetic_unmeasured (id TEXT PRIMARY KEY);\n",
    );
    expect(() => readMigrationSafetyRegistry(root)).toThrow(
      "Every new migration requires",
    );
  });

  it("blocks changed historical SQL and missing reviewed migration bytes", () => {
    const root = isolatedRegistry();
    const file = join(root, "packages/database/migrations", immutableFrontier);
    writeFileSync(
      file,
      readFileSync(file, "utf8") + "\n-- Changed historical SQL.\n",
    );
    expect(() => readMigrationSafetyRegistry(root)).toThrow(
      "Migration source changed",
    );
    rmSync(file);
    expect(() => readMigrationSafetyRegistry(root)).toThrow(
      "Applied migration history",
    );
  });

  it("blocks duplicate cases and skipped source frontiers", () => {
    const root = isolatedRegistry();
    const file = join(root, ".tugling/d1-migrations.json");
    const registry = readMigrationSafetyRegistry();
    const review = futureCase(root);
    registry.cases.push(review, review);
    writeFileSync(file, JSON.stringify(registry));
    expect(() => readMigrationSafetyRegistry(root)).toThrow(
      "Duplicate migration safety case",
    );
    registry.cases.pop();
    registry.cases[0]!.frontier = "0088_wefunder_exact_entity_links.sql";
    writeFileSync(file, JSON.stringify(registry));
    expect(() => readMigrationSafetyRegistry(root)).toThrow(
      "exact ordered frontier",
    );
  });

  it("admits only the exact pending suffix and conservatively reserves the largest measured holdout", () => {
    const evidence = receipt();
    expect(
      migrationFootprint([
        { tableRows: { households: 3, holding_position_snapshots: 1681 } },
        { tableRows: { households: 2, holding_position_snapshots: 3121 } },
      ]),
    ).toEqual({ households: 3, holding_position_snapshots: 3121 });
    const admitted = admit(evidence);
    expect(admitted).toMatchObject({
      kind: "baseline",
      caseId: "public-inventory-schema-v1",
      migrationCost: null,
      footprint: { households: 2, holding_position_snapshots: 6241 },
    });
    expect(Object.keys(admitted.footprint).sort()).toEqual(
      IMPLEMENTED_BASELINE_TABLES,
    );
    expect(admitted.receiptDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(admitted).not.toHaveProperty("rowsRead");
    expect(admitted).not.toHaveProperty("rowsWritten");
  });

  it("admits only the certified source-head backfill suffix and preserves the earlier trigger case", () => {
    const evidence = receipt();
    expect(
      validateMigrationSafetyReceipt(evidence, { gitSha, now }).cases[0]
        ?.scenarios[0],
    ).toMatchObject({ rowsRead: 10, rowsWritten: 4 });
    expect(
      admit(evidence, {
        frontier: sourceFrontier,
        pending: [frontier],
        gitSha,
      }),
    ).toMatchObject({
      kind: "upgrade",
      caseId: "public-inventory-v1",
      migrationCost: { rowsRead: 10, rowsWritten: 4 },
    });
    // An older target has two pending migrations; neither individual case claims that complete sequence.
    expect(() =>
      admit(evidence, {
        frontier: immutableFrontier,
        pending: [distributionFrontier, sourceFrontier, frontier],
        gitSha,
      }),
    ).toThrow("no exact baseline or populated OLD-schema evidence");
    for (const patch of [
      { rowsRead: 2001 },
      { rowsWritten: 101 },
      {
        inboundForeignKeyPlans:
          "indexed-positive-and-empty-before-destructive-statements" as const,
      },
    ]) {
      const invalid = receipt();
      Object.assign(invalid.cases[0]!.scenarios[0], patch);
      expect(() => admit(invalid)).toThrow("actual D1 row budget");
    }
    for (const patch of [
      { rowsRead: 15001 },
      { rowsWritten: 10001 },
      { rowsRead: 0, rowsWritten: 0 },
    ]) {
      const invalid = receipt();
      Object.assign(invalid.cases[1]!.scenarios[0], patch);
      expect(() => admit(invalid)).toThrow();
    }
    const zero = receipt();
    for (const scenario of zero.cases[0]!.scenarios) {
      scenario.rowsRead = 0;
      scenario.rowsWritten = 0;
    }
    expect(() =>
      validateMigrationSafetyReceipt(zero, { gitSha, now }),
    ).not.toThrow();
  });

  it("refuses a populated legacy upgrade because forward indexes would run too late", () => {
    const legacyFrontier =
      readMigrationSafetyRegistry().immutableMigrations.at(-2)!.name;
    expect(() =>
      admit(undefined, {
        frontier: legacyFrontier,
        pending: [
          immutableFrontier,
          distributionFrontier,
          sourceFrontier,
          frontier,
        ],
        gitSha,
      }),
    ).toThrow("forward indexes run after the unsafe rebuild");
  });

  it("rejects unknown frontiers and omitted, reordered or injected pending migrations", () => {
    for (const request of [
      { frontier: "9999_unknown.sql", pending, gitSha },
      { frontier, pending: [futureMigration], gitSha },
      { frontier, pending: [futureMigration, "0091_injected.sql"], gitSha },
      { frontier, pending: ["0091_injected.sql", futureMigration], gitSha },
    ])
      expect(() => admit(receipt(), request)).toThrow(
        "frontier and pending sequence",
      );
  });

  it("rejects absent, different-source, different-revision and stale or future receipts", () => {
    expect(() => admit(undefined)).toThrow();
    const otherSource = receipt();
    otherSource.sourceDigest = "b".repeat(64);
    expect(() => admit(otherSource)).toThrow("this revision and source");
    const otherRevision = receipt();
    otherRevision.gitSha = "b".repeat(40);
    expect(() => admit(otherRevision)).toThrow("this revision and source");
    for (const generatedAt of [
      "2026-08-31T11:59:59.999Z",
      "2026-09-01T12:00:00.001Z",
    ]) {
      const stale = receipt();
      stale.generatedAt = generatedAt;
      expect(() => admit(stale)).toThrow("stale or from a future clock");
    }
  });

  it("rejects missing, duplicate and wrongly ordered history or case evidence", () => {
    const missing = { ...receipt(), baseline: undefined };
    expect(() => admit(missing)).toThrow();
    const duplicate = receipt();
    duplicate.cases.push({
      kind: "upgrade",
      id: "unimplemented-upgrade-v1",
      frontier,
      pending: [futureMigration],
      scenarios: [
        upgradeScenario(),
        {
          ...upgradeScenario(),
          history: 24,
          fixtureHash: "d".repeat(64),
          tableRows: tableRows(24),
        },
      ],
    });
    expect(() => admit(duplicate)).toThrow("omitted or duplicated");
    const histories = receipt();
    expect(() =>
      admit({
        ...histories,
        baseline: {
          ...histories.baseline,
          scenarios: [{ ...histories.baseline.scenarios[0], history: 12 }],
        },
      }),
    ).toThrow();
    const repeatedBaseline = receipt();
    repeatedBaseline.baseline.scenarios.push(
      repeatedBaseline.baseline.scenarios[0],
    );
    expect(() => admit(repeatedBaseline)).toThrow();
    const upgrade = duplicate.cases[0]!;
    for (const holdouts of [
      [],
      [upgrade.scenarios[0]],
      [...upgrade.scenarios].reverse(),
    ])
      expect(() =>
        MigrationSafetyReceiptSchema.parse({
          ...receipt(),
          cases: [{ ...upgrade, scenarios: holdouts }],
        }),
      ).toThrow();
    const absentHoldout = receipt();
    absentHoldout.baseline.scenarios.pop();
    expect(() => admit(absentHoldout)).toThrow();
  });

  it("rejects missing actual counters, unsafe integers, over-budget work and failed preservation", () => {
    expect(
      MigrationSafetyScenarioSchema.parse(upgradeScenario()),
    ).toMatchObject({ rowsRead: 13_000, rowsWritten: 7_000 });
    for (const patch of [
      { statements: 0 },
      { rowsRead: undefined },
      { rowsRead: 0 },
      { rowsRead: Number.MAX_SAFE_INTEGER + 1 },
      { rowsWritten: 0 },
      { rowsWritten: -1 },
      { measuredFromFirstStatement: false },
      { inboundForeignKeyPlans: "indexed-only-after-migration" },
      { completeSequence: "preparation-omitted" },
    ])
      expect(() =>
        MigrationSafetyScenarioSchema.parse({ ...upgradeScenario(), ...patch }),
      ).toThrow();
    const unauthorized = receipt();
    unauthorized.cases.push({
      kind: "upgrade",
      id: "unimplemented-upgrade-v1",
      frontier,
      pending: [futureMigration],
      scenarios: [
        { ...upgradeScenario(), rowsRead: 20_001 },
        {
          ...upgradeScenario(),
          history: 24,
          fixtureHash: "d".repeat(64),
          tableRows: tableRows(24),
          rowsWritten: 10_001,
        },
      ],
    });
    expect(() => admit(unauthorized)).toThrow("omitted or duplicated");
    for (const patch of [
      { foreignKeyViolations: 1 },
      { immutableProbes: 2 },
      { tablesPreserved: 136 },
      { schemaObjectsPreserved: 690 },
      { inboundForeignKeyPlans: "indexed-positive-and-empty" },
      { statements: 0 },
      { rowsRead: 0 },
      { rowsWritten: 0 },
    ]) {
      const invalid = receipt();
      Object.assign(invalid.baseline.scenarios[0], patch);
      expect(() =>
        validateMigrationSafetyReceipt(invalid, { gitSha, now }),
      ).toThrow();
    }
  });

  it("rejects incomplete footprints, underfilled scale and reused history fixtures", () => {
    const absent = receipt();
    delete absent.baseline.scenarios[0].tableRows.holding_positions;
    expect(() => admit(absent)).toThrow("footprint evidence");
    const differentTables = receipt();
    delete differentTables.baseline.scenarios[0].tableRows
      .actual_liquidity_events;
    differentTables.baseline.scenarios[0].tableRows.synthetic_other_table = 0;
    expect(() => admit(differentTables)).toThrow("footprint evidence");
    const tooLittleHistory = receipt();
    tooLittleHistory.baseline.scenarios[0].tableRows.holding_position_snapshots =
      tableRows(12).holding_position_snapshots;
    expect(() => admit(tooLittleHistory)).toThrow("populated scale");
    const tooFewReviews = receipt();
    tooFewReviews.baseline.scenarios[0].tableRows.holding_purchase_reviews =
      tableRows(12).holding_purchase_reviews;
    expect(() => admit(tooFewReviews)).toThrow("populated scale");
    const sameFixture = receipt();
    sameFixture.cases.push({
      kind: "upgrade",
      id: "unimplemented-upgrade-v1",
      frontier,
      pending: [futureMigration],
      scenarios: [
        upgradeScenario(),
        { ...upgradeScenario(), history: 24, tableRows: tableRows(24) },
      ],
    });
    expect(() => MigrationSafetyReceiptSchema.parse(sameFixture)).toThrow(
      "same fixture",
    );
  });
  it("refuses metadata-only future baseline and upgrade registrations", () => {
    const root = isolatedRegistry();
    const path = join(root, ".tugling/d1-migrations.json");
    const registry = readMigrationSafetyRegistry();
    registry.baseline.fixture = "unimplemented-fixture-v2";
    writeFileSync(path, JSON.stringify(registry));
    expect(() => readMigrationSafetyRegistry(root)).toThrow(
      "implemented fixture and canonical runner",
    );
    registry.baseline.fixture = "holding-history-v1";
    registry.cases.push(futureCase(root));
    writeFileSync(path, JSON.stringify(registry));
    expect(() => readMigrationSafetyRegistry(root)).toThrow("exact terminal");
    registry.baseline.frontier = futureMigration;
    writeFileSync(path, JSON.stringify(registry));
    expect(() => readMigrationSafetyRegistry(root)).toThrow(
      "metadata-only approval",
    );
  });

  it("rejects a wrong-frontier baseline, nonempty baseline pending SQL and fake baseline counters", () => {
    const wrong = receipt();
    wrong.baseline.frontier = "0088_wefunder_exact_entity_links.sql";
    expect(() => admit(wrong)).toThrow("exact registered terminal frontier");
    expect(() =>
      MigrationSafetyReceiptSchema.parse({
        ...receipt(),
        baseline: { ...receipt().baseline, pending: [futureMigration] },
      }),
    ).toThrow();
    expect(() =>
      MigrationSafetyReceiptSchema.parse({
        ...receipt(),
        baseline: {
          ...receipt().baseline,
          scenarios: receipt().baseline.scenarios.map((scenario) => ({
            ...scenario,
            rowsRead: 0,
            rowsWritten: 0,
          })),
        },
      }),
    ).toThrow();
  });

  it("rejects missing or fabricated baseline foreign-key plan coverage", () => {
    for (const patch of [
      { emptyLookups: 1 },
      { positiveLookups: 0 },
      { positiveLookups: 3 },
      { indexSearches: 0 },
      { tableScans: 0 },
      { tableScans: 3 },
    ]) {
      const invalid = receipt();
      Object.assign(
        invalid.baseline.scenarios[0].foreignKeyPlanEvidence,
        patch,
      );
      expect(() => admit(invalid)).toThrow();
    }
  });

  it("rejects extra schema objects and changed definitions during exact baseline preservation", async () => {
    const object = {
      type: "table",
      name: "synthetic_preserved",
      sql: "CREATE TABLE synthetic_preserved (id TEXT PRIMARY KEY)",
    };
    const fixture = {
      tables: [],
      objects: [object],
    } as unknown as PopulatedMigrationFixture;
    const database = (objects: unknown[]) =>
      ({
        batch: () => Promise.resolve([]),
        prepare: (sql: string) => ({
          all: () =>
            Promise.resolve({
              results: sql === "PRAGMA foreign_key_check" ? [] : objects,
            }),
        }),
      }) as unknown as D1Database;
    await expect(
      preserveMigrationFixture(database([object]), fixture, true),
    ).resolves.toMatchObject({ schemaObjectsPreserved: 1 });
    await expect(
      preserveMigrationFixture(
        database([
          object,
          {
            type: "index",
            name: "synthetic_extra",
            sql: "CREATE INDEX synthetic_extra ON synthetic_preserved(id)",
          },
        ]),
        fixture,
        true,
      ),
    ).rejects.toThrow("complete schema object set");
    await expect(
      preserveMigrationFixture(
        database([
          { ...object, sql: "CREATE TABLE synthetic_preserved (id TEXT)" },
        ]),
        fixture,
        true,
      ),
    ).rejects.toThrow("lost or changed old schema object");
  });
});
