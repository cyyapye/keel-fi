import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapacityScope } from "../packages/database/src/d1-capacity";
import type * as EvidenceModule from "./preview-deployment-evidence";
import type * as ExportModule from "./d1-maintenance-export";

vi.mock("./preview-deployment-config", () => ({
  writePreviewDeploymentFiles: vi.fn(),
  writePreviewApiSecrets: vi.fn(),
}));
vi.mock("./preview-deployment-evidence", async (original) => ({
  ...(await original<typeof EvidenceModule>()),
  writeBackupManifest: vi.fn(),
  writeReleaseEvidence: vi.fn(),
  readDeploymentVersions: vi.fn(() =>
    Promise.resolve({
      apiVersionId: "synthetic-api",
      webVersionId: "synthetic-web",
    }),
  ),
}));
vi.mock("./preview-deployment-storage", () => ({
  storePreviewEvidence: vi.fn(),
}));
vi.mock("./d1-maintenance-export", async (original) => ({
  ...(await original<typeof ExportModule>()),
  exportMaintenanceD1: vi.fn(),
}));
vi.mock("./preview-deployment-smoke", () => ({
  runPreviewDeploymentSmoke: vi.fn(),
}));

import { writePreviewDeploymentFiles } from "./preview-deployment-config";
import { storePreviewEvidence } from "./preview-deployment-storage";
import { MaintenancePlanSchema, runRelease } from "./d1-maintenance";
import { runPreviewDeploymentSmoke } from "./preview-deployment-smoke";

const owned: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    owned.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "keel-baseline-release-"));
  owned.push(root);
  const paths = {
    apiConfigPath: join(root, "api.json"),
    webConfigPath: join(root, "web.json"),
    apiSecretsPath: join(root, "secrets.json"),
    backupPassphrasePath: join(root, "passphrase"),
  };
  vi.mocked(writePreviewDeploymentFiles).mockResolvedValue(paths);
  const env = {
    CLOUDFLARE_API_TOKEN: "synthetic-token-only-123456",
    KEEL_PREVIEW_D1_NAME: "synthetic-d1",
    KEEL_API_WRANGLER_OUTPUT_PATH: join(root, "api.jsonl"),
    KEEL_WEB_WRANGLER_OUTPUT_PATH: join(root, "web.jsonl"),
    KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH: join(root, "plain.sql"),
    KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH: join(root, "cipher.gpg"),
    KEEL_PREVIEW_BACKUP_VERIFY_PATH: join(root, "verify.sql"),
  };
  const plan = MaintenancePlanSchema.parse({
    version: 1,
    kind: "release",
    account: "a".repeat(32),
    database: "10000000-0000-4000-8000-000000000001",
    revision: "b".repeat(40),
    runId: "123",
    attempt: "1",
    frontier: "0089_manual_holdings.sql",
    pending: [],
    migrationReceiptDigest: "c".repeat(64),
    sourceDigest: "d".repeat(64),
    observedAt: "2026-08-20T12:00:00.000Z",
    operationCreatedAt: "2026-08-20T12:00:00.000Z",
    usageUpper: { reads: 0, writes: 0 },
    usageBasisHash: "e".repeat(64),
    footprintBasisHash: "f".repeat(64),
    tableRowsUpper: { synthetic_table: 0 },
    complete: true,
    envelope: { reads: 100_000, writes: 10_000 },
    exportBasisHash: "e".repeat(64),
    exportMaxBytes: 1024,
    exportMaxPolls: 12,
    resourceSmokeAttempts: 3,
    readinessAttempts: 12,
  });
  const stages: string[] = [];
  const scope: CapacityScope = {
    check: () => undefined,
    record: () => undefined,
    recordUnknown: () => undefined,
    stage: <T>(name: string, execute: () => Promise<T>) => {
      stages.push(name);
      return execute();
    },
  };
  const calls: { program: string; args: string[] }[] = [];
  const invoke = (program: string, args: string[]) => {
    calls.push({ program, args });
    return Promise.resolve();
  };
  const history = readdirSync("packages/database/migrations")
    .filter((name) => name.endsWith(".sql") && name <= plan.frontier)
    .sort();
  const request = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json({
        success: true,
        result: [{ success: true, results: history.map((name) => ({ name })) }],
      }),
    ),
  );
  vi.stubGlobal("fetch", request);
  return { env, plan, scope, stages, calls, invoke, request, history };
}

describe("applied-schema release without pending SQL", () => {
  it("skips migration execution while retaining backup integrity, complete history and smokes", async () => {
    const f = await setup();
    await runRelease(f.scope, f.plan, f.env, f.invoke);
    expect(f.calls.some((call) => call.args.includes("d1"))).toBe(false);
    expect(f.calls.filter((call) => call.program === "gpg")).toHaveLength(2);
    expect(f.calls.filter((call) => call.program === "cmp")).toHaveLength(1);
    expect(
      vi.mocked(storePreviewEvidence).mock.calls.map((call) => call[0]),
    ).toEqual(["backup", "release"]);
    expect(f.stages).toEqual([
      "export",
      "backup-integrity",
      "migration",
      "api-deploy",
      "web-deploy",
      "smokes",
      "release-evidence",
    ]);
    expect(f.request).toHaveBeenCalledOnce();
    expect(runPreviewDeploymentSmoke).toHaveBeenCalledOnce();
  });
  it("refuses a missing intermediate history entry even when the final filename matches", async () => {
    const f = await setup();
    f.request.mockResolvedValue(
      Response.json({
        success: true,
        result: [
          {
            success: true,
            results: f.history
              .filter((_, index) => index !== 1)
              .map((name) => ({ name })),
          },
        ],
      }),
    );
    await expect(runRelease(f.scope, f.plan, f.env, f.invoke)).rejects.toThrow(
      "frontier mismatch",
    );
    expect(f.calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(runPreviewDeploymentSmoke).not.toHaveBeenCalled();
    expect(
      vi.mocked(storePreviewEvidence).mock.calls.map((call) => call[0]),
    ).toEqual(["backup"]);
  });
});
