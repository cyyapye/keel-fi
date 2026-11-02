import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialCapacityLedger,
  type CapacityLedger,
  type CapacityStore,
} from "../packages/database/src/d1-capacity";
import {
  assertMigrationSafety,
  IMPLEMENTED_BASELINE_TABLES,
  migrationSourceDigest,
  type MigrationSafetyReceipt,
} from "./d1-migration-safety";
import {
  MaintenancePlanSchema,
  runD1Maintenance,
  validateMaintenancePlan,
} from "./d1-maintenance";

const time = Date.parse("2026-08-20T12:00:00.000Z");
const revision = "a".repeat(40);
const account = "b".repeat(32);
const database = "10000000-0000-4000-8000-000000000001";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const owned: string[] = [];
afterEach(() => {
  for (const path of owned.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture(kind: "release" | "daily-backup" = "daily-backup") {
  const directory = mkdtempSync(join(tmpdir(), "keel-maintenance-test-"));
  owned.push(directory);
  const receipt: MigrationSafetyReceipt = {
    version: 2,
    gitSha: revision,
    sourceDigest: migrationSourceDigest(),
    generatedAt: new Date(time).toISOString(),
    baseline: {
      kind: "baseline",
      id: "applied-schema-v1",
      frontier: "0089_manual_holdings.sql",
      pending: [],
      scenarios: ([12, 24] as const).map((history) => ({
        history,
        mainPositions: 120,
        unrelatedPositions: 120,
        fixtureHash: (history === 12 ? "c" : "d").repeat(64),
        tableRows: {
          ...Object.fromEntries(
            IMPLEMENTED_BASELINE_TABLES.map((table) => [table, 0]),
          ),
          holding_positions: 241,
          holding_position_snapshots: 120 * (history + 2) + 1,
          holding_purchase_reviews: 120 * history + 1,
          portfolio_baseline_items: 120,
          manual_holding_submissions: 1,
          households: 2,
        },
        tablesPreserved: 137,
        schemaObjectsPreserved: 691,
        foreignKeyViolations: 0,
        immutableProbes: 3,
        physicalIntegrity: "unsupported-in-local-d1",
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
      })),
    },
    cases: [],
  };
  const safety = assertMigrationSafety({
    frontier: "0089_manual_holdings.sql",
    pending: [],
    gitSha: revision,
    receipt,
    now: new Date(time),
  });
  const env = {
    KEEL_D1_MAINTENANCE_RECEIPT_PATH: join(directory, "admission.json"),
    CLOUDFLARE_ACCOUNT_ID: account,
    KEEL_PREVIEW_D1_ID: database,
    GITHUB_SHA: revision,
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
    KEEL_D1_QUOTA_KEY: "operations/d1-capacity/synthetic.json",
    KEEL_PREVIEW_D1_CAPACITY_BUCKET: "synthetic-capacity",
    KEEL_PREVIEW_D1_CAPACITY_KEY: "operations/d1-capacity/synthetic.json",
    KEEL_D1_QUOTA_R2_CONFIG: JSON.stringify({
      account,
      bucket: "synthetic-capacity",
      accessKeyId: "synthetic-key-only",
      secretAccessKey: "synthetic-private-key-only".repeat(2),
    }),
  };
  const plan = MaintenancePlanSchema.parse({
    version: 1,
    kind,
    account,
    database,
    revision,
    runId: "123",
    attempt: "1",
    frontier: "0089_manual_holdings.sql",
    pending: [],
    migrationReceiptDigest: safety.receiptDigest,
    sourceDigest: safety.sourceDigest,
    observedAt: new Date(time).toISOString(),
    operationCreatedAt: new Date(time).toISOString(),
    usageUpper: { reads: 0, writes: 0 },
    usageBasisHash: "d".repeat(64),
    footprintBasisHash: "f".repeat(64),
    tableRowsUpper: receipt.baseline.scenarios[1]!.tableRows,
    complete: true,
    envelope: { reads: 100_000, writes: 10_000 },
    exportBasisHash: "e".repeat(64),
    exportMaxBytes: 1024,
    exportMaxPolls: 12,
    resourceSmokeAttempts: 3,
    readinessAttempts: 12,
  });
  return { receipt, env, plan };
}
class Store implements CapacityStore {
  version = 0;
  value: CapacityLedger | null;
  constructor(plans: ReturnType<typeof fixture>["plan"][]) {
    this.value = initialCapacityLedger(
      {
        day: "2026-08-20",
        account,
        databases: [database],
        revisions: [revision],
        inventoryHash: "c".repeat(64),
        bootstrapBasisHash: "d".repeat(64),
        priorUsageUpper: { reads: 0, writes: 0 },
        policies: plans.map((plan) => ({
          producer: plan.kind,
          operation: plan.envelope,
          daily: { reads: 2_000_000, writes: 80_000 },
          maxOperations: plan.kind === "release" ? 2 : 1,
          maxDurationMs: 60_000,
          evidenceHash: hash(plan),
        })),
        usage: {
          account,
          day: "2026-08-20",
          observedAt: new Date(time).toISOString(),
          coveredThrough: new Date(time).toISOString(),
          upper: { reads: 0, writes: 0 },
          complete: true,
          basisHash: "e".repeat(64),
        },
      },
      time,
    );
  }
  read() {
    return Promise.resolve(
      this.value === null
        ? null
        : { version: String(this.version), value: structuredClone(this.value) },
    );
  }
  compareAndWrite(expected: string | null, value: CapacityLedger) {
    if (expected !== (this.value === null ? null : String(this.version)))
      return Promise.resolve("conflict" as const);
    this.value = structuredClone(value);
    this.version++;
    return Promise.resolve("committed" as const);
  }
}
const history = () =>
  readdirSync("packages/database/migrations")
    .filter(
      (name) => name.endsWith(".sql") && name <= "0089_manual_holdings.sql",
    )
    .sort();
function dependencies(f: ReturnType<typeof fixture>, store: CapacityStore) {
  return {
    environment: f.env,
    plan: f.plan,
    migrationReceipt: f.receipt,
    store,
    now: () => time,
    frontier: vi.fn(() => Promise.resolve(history())),
    execute: vi.fn(() => Promise.resolve()),
  };
}

describe("D1 maintenance admission", () => {
  it("requires fresh complete attempt-bound usage and protects interactive capacity", () => {
    const { env, plan } = fixture();
    expect(validateMaintenancePlan(plan, env, plan.kind, time)).toEqual(plan);
    for (const changed of [
      { ...plan, observedAt: new Date(time - 300_001).toISOString() },
      { ...plan, complete: false },
      { ...plan, account: "f".repeat(32) },
      { ...plan, usageUpper: { reads: 2_000_000, writes: 0 } },
      { ...plan, exportBasisHash: undefined },
    ])
      expect(() =>
        validateMaintenancePlan(changed, env, plan.kind, time),
      ).toThrow();
  });
  it("starts no D1 operation when owner, evidence or published envelope is absent", async () => {
    const f = fixture();
    for (const missing of ["owner", "receipt", "undercharge"]) {
      const store = new Store([f.plan]);
      if (missing === "owner") store.value = null;
      if (missing === "undercharge")
        store.value!.allowance.policies[0]!.operation = { reads: 1, writes: 1 };
      const deps = dependencies(f, store);
      if (missing === "receipt")
        deps.migrationReceipt = { ...f.receipt, sourceDigest: "0".repeat(64) };
      await expect(runD1Maintenance(f.plan.kind, deps)).rejects.toThrow();
      expect(deps.frontier).not.toHaveBeenCalled();
      expect(deps.execute).not.toHaveBeenCalled();
    }
  });
  it("refuses a populated legacy upgrade before its first frontier read", async () => {
    const f = fixture();
    const deps = dependencies(f, new Store([f.plan]));
    deps.plan = {
      ...f.plan,
      frontier: "0088_wefunder_exact_entity_links.sql",
      pending: ["0089_manual_holdings.sql"],
    };
    await expect(runD1Maintenance(f.plan.kind, deps)).rejects.toThrow("legacy");
    expect(deps.frontier).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it("charges the entire operation before observing the actual frontier and rejects a mismatch", async () => {
    const f = fixture();
    const store = new Store([f.plan]);
    const deps = dependencies(f, store);
    deps.frontier.mockImplementation(() => {
      expect(store.value!.charged).toEqual(f.plan.envelope);
      return Promise.resolve(history().slice(0, -1));
    });
    await expect(runD1Maintenance(f.plan.kind, deps)).rejects.toThrow(
      "frontier",
    );
    expect(deps.frontier).toHaveBeenCalledTimes(1);
    expect(deps.execute).not.toHaveBeenCalled();
    expect(store.value!.charged).toEqual(f.plan.envelope);
  });
  it("executes a duplicate attempt once and retains unknown billing without refund", async () => {
    const f = fixture();
    const store = new Store([f.plan]);
    const deps = dependencies(f, store);
    const results = await Promise.allSettled([
      runD1Maintenance(f.plan.kind, deps),
      runD1Maintenance(f.plan.kind, deps),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(deps.execute).toHaveBeenCalledTimes(1);
    expect(store.value!.charged).toEqual(f.plan.envelope);
    expect(store.value!.entries[0]!.actual).toBeNull();
  });
  it("makes independent backup and release owners contend for the same remaining capacity", async () => {
    const backup = fixture(),
      release = fixture("release");
    for (const f of [backup, release])
      f.plan.envelope = { reads: 1_100_000, writes: 40_001 };
    const store = new Store([backup.plan, release.plan]);
    const a = dependencies(backup, store),
      b = dependencies(release, store);
    const results = await Promise.allSettled([
      runD1Maintenance("daily-backup", a),
      runD1Maintenance("release", b),
    ]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(a.frontier.mock.calls.length + b.frontier.mock.calls.length).toBe(1);
    expect(store.value!.charged).toEqual(backup.plan.envelope);
  });
  it("enforces one maintenance entrypoint for release and independent backup workflows", () => {
    const release = readFileSync(".github/workflows/post-merge.yml", "utf8"),
      backup = readFileSync(
        ".github/workflows/private-document-backup.yml",
        "utf8",
      );
    expect(release).toContain("scripts/d1-maintenance.ts release");
    expect(backup).toContain("scripts/private-document-backup-job.ts");
    for (const source of [release, backup]) {
      expect(source).toContain("scripts/populated-migration-d1-cost.test.ts");
      expect(source).not.toMatch(
        /wrangler d1|scripts\/preview-deployment-smoke\.ts/u,
      );
    }
    expect(
      readFileSync("scripts/private-document-backup-job.ts", "utf8"),
    ).toContain('runD1Maintenance("daily-backup")');
  });
});
