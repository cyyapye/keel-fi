import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  runCapacityWork,
  CapacityCostSchema,
  CAPACITY_INTERACTIVE_RESERVE,
  CAPACITY_LIMITS,
  type CapacityStore,
} from "../packages/database/src/d1-capacity";
import { nodeCapacityStore } from "./d1-capacity-r2";
import { privateR2, PrivateR2ConfigSchema } from "./private-document-r2";
import { assertMigrationSafety } from "./d1-migration-safety";
import {
  exportMaintenanceD1,
  D1_EXPORT_MAX_POLLS,
} from "./d1-maintenance-export";
import {
  writePreviewDeploymentFiles,
  writePreviewApiSecrets,
} from "./preview-deployment-config";
import {
  readDeploymentVersions,
  writeBackupManifest,
  writeReleaseEvidence,
  MaintenanceAdmissionSchema,
} from "./preview-deployment-evidence";
import { storePreviewEvidence } from "./preview-deployment-storage";
import { runPreviewDeploymentSmoke } from "./preview-deployment-smoke";
import { runMaintenanceCommand } from "./d1-maintenance-command";
import { readMaintenanceJson } from "./d1-maintenance-http";

const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const Name = z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/u);
export const MaintenancePlanSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(["release", "daily-backup"]),
    account: z.string().regex(/^[a-f0-9]{32}$/u),
    database: z.uuid(),
    revision: z.string().regex(/^[a-f0-9]{40}$/u),
    runId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    attempt: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    frontier: Name,
    pending: z.array(Name).max(100),
    migrationReceiptDigest: Digest,
    sourceDigest: Digest,
    observedAt: z.iso.datetime(),
    operationCreatedAt: z.iso.datetime(),
    usageUpper: CapacityCostSchema,
    usageBasisHash: Digest,
    footprintBasisHash: Digest,
    tableRowsUpper: z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]*$/u),
        z.number().int().nonnegative().safe(),
      )
      .refine(
        (value) =>
          Object.keys(value).length > 0 && Object.keys(value).length <= 200,
      ),
    complete: z.literal(true),
    envelope: CapacityCostSchema,
    exportBasisHash: Digest,
    exportMaxBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 ** 2),
    exportMaxPolls: z.literal(D1_EXPORT_MAX_POLLS),
    resourceSmokeAttempts: z.literal(3),
    readinessAttempts: z.literal(12),
  })
  .strict();
type MaintenancePlan = z.infer<typeof MaintenancePlanSchema>;
type Scope = Parameters<Parameters<typeof runCapacityWork>[1]>[0];
type Command = (
  program: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<void>;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function checkMaintenanceEntryPoints() {
  for (const name of await readdir(".github/workflows")) {
    if (!/\.ya?ml$/u.test(name)) continue;
    const source = await readFile(`.github/workflows/${name}`, "utf8");
    if (
      /wrangler\s+(?:\\\s*)?d1|scripts\/preview-deployment-smoke\.ts/u.test(
        source,
      )
    )
      throw new Error(`Raw D1 maintenance bypass in workflow ${name}.`);
  }
  const release = await readFile(".github/workflows/post-merge.yml", "utf8");
  const backup = await readFile(
    ".github/workflows/private-document-backup.yml",
    "utf8",
  );
  if (
    !release.includes("scripts/d1-maintenance.ts release") ||
    !backup.includes("scripts/private-document-backup-job.ts") ||
    !backup.includes("scripts/populated-migration-d1-cost.test.ts") ||
    !release.includes("scripts/populated-migration-d1-cost.test.ts")
  )
    throw new Error("Maintenance owner or populated verification is missing.");
}

async function privateJson(path: string) {
  const file = await stat(path);
  if (!file.isFile() || file.size > 256 * 1024)
    throw new Error("Maintenance evidence is unavailable.");
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error("Maintenance evidence is invalid.");
  }
}

export function validateMaintenancePlan(
  raw: unknown,
  environment: NodeJS.ProcessEnv,
  kind: MaintenancePlan["kind"],
  now = Date.now(),
) {
  const plan = MaintenancePlanSchema.parse(raw);
  if (
    plan.kind !== kind ||
    plan.account !== environment.CLOUDFLARE_ACCOUNT_ID ||
    plan.database !== environment.KEEL_PREVIEW_D1_ID ||
    plan.revision !== environment.GITHUB_SHA ||
    plan.runId !== environment.GITHUB_RUN_ID ||
    plan.attempt !== environment.GITHUB_RUN_ATTEMPT
  )
    throw new Error("Maintenance identity does not match this attempt.");
  const observed = Date.parse(plan.observedAt);
  const created = Date.parse(plan.operationCreatedAt);
  if (
    created > now ||
    now - created >= 45 * 60_000 ||
    plan.operationCreatedAt.slice(0, 10) !==
      new Date(now).toISOString().slice(0, 10)
  )
    throw new Error(
      "Maintenance attempt expired; reconcile before starting another operation.",
    );
  if (
    observed > now ||
    now - observed > 5 * 60_000 ||
    plan.observedAt.slice(0, 10) !== new Date(now).toISOString().slice(0, 10)
  )
    throw new Error("Maintenance usage evidence is stale or unavailable.");
  if (
    plan.usageUpper.reads +
      plan.envelope.reads +
      CAPACITY_INTERACTIVE_RESERVE.reads >
      CAPACITY_LIMITS.reads ||
    plan.usageUpper.writes +
      plan.envelope.writes +
      CAPACITY_INTERACTIVE_RESERVE.writes >
      CAPACITY_LIMITS.writes
  )
    throw new Error("Maintenance cannot preserve interactive capacity.");
  return plan;
}

export async function readMaintenanceFrontier(
  plan: Pick<MaintenancePlan, "account" | "database">,
  environment: NodeJS.ProcessEnv,
  fetchImplementation: typeof fetch,
) {
  const token = z
    .string()
    .min(20)
    .parse(
      environment.CLOUDFLARE_API_TOKEN ??
        environment.KEEL_DOCUMENT_D1_READ_TOKEN,
    );
  const response = await fetchImplementation(
    `https://api.cloudflare.com/client/v4/accounts/${plan.account}/d1/database/${plan.database}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "SELECT name FROM d1_migrations ORDER BY id",
        params: [],
      }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  ).catch(() => {
    throw new Error("D1 frontier observation is uncertain.");
  });
  if (!response.ok) throw new Error("D1 frontier observation failed.");
  const parsed = z
    .object({
      success: z.literal(true),
      result: z
        .array(
          z.object({
            success: z.literal(true),
            results: z.array(z.object({ name: Name })).max(1000),
          }),
        )
        .length(1),
    })
    .safeParse(await readMaintenanceJson(response));
  if (!parsed.success) throw new Error("D1 frontier evidence is invalid.");
  return parsed.data.result[0]!.results.map((row) => row.name);
}

export async function runD1Maintenance(
  kind: MaintenancePlan["kind"],
  dependencies: {
    environment?: NodeJS.ProcessEnv;
    now?: () => number;
    store?: CapacityStore;
    plan?: unknown;
    migrationReceipt?: unknown;
    frontier?: (plan: MaintenancePlan) => Promise<string[]>;
    execute?: (
      scope: Scope,
      plan: MaintenancePlan,
      env: NodeJS.ProcessEnv,
    ) => Promise<void>;
  } = {},
) {
  const environment = dependencies.environment ?? process.env;
  const now = dependencies.now ?? Date.now;
  const plan = validateMaintenancePlan(
    dependencies.plan ??
      JSON.parse(z.string().min(1).parse(environment.KEEL_D1_MAINTENANCE_PLAN)),
    environment,
    kind,
    now(),
  );
  const receipt =
    dependencies.migrationReceipt ??
    (await privateJson(
      z.string().min(1).parse(environment.KEEL_MIGRATION_SAFETY_RECEIPT),
    ));
  const safety = assertMigrationSafety({
    frontier: plan.frontier,
    pending: plan.pending,
    receipt,
    gitSha: plan.revision,
    now: new Date(now()),
  });
  const footprintKeys = Object.keys(safety.footprint).sort();
  if (
    JSON.stringify(Object.keys(plan.tableRowsUpper).sort()) !==
      JSON.stringify(footprintKeys) ||
    footprintKeys.some(
      (table) => plan.tableRowsUpper[table]! > safety.footprint[table]!,
    )
  )
    throw new Error(
      "Target database footprint is outside the measured migration envelope.",
    );
  if (
    safety.receiptDigest !== plan.migrationReceiptDigest ||
    safety.sourceDigest !== plan.sourceDigest ||
    (safety.migrationCost?.rowsRead ?? 0) > plan.envelope.reads ||
    (safety.migrationCost?.rowsWritten ?? 0) > plan.envelope.writes
  )
    throw new Error(
      "Maintenance migration evidence does not match its envelope.",
    );
  const config = PrivateR2ConfigSchema.parse(
    JSON.parse(z.string().min(1).parse(environment.KEEL_D1_QUOTA_R2_CONFIG)),
  );
  if (config.account !== plan.account)
    throw new Error("Maintenance capacity owner account mismatch.");
  const key = z.string().min(1).parse(environment.KEEL_D1_QUOTA_KEY);
  if (
    kind === "release" &&
    (config.bucket !== environment.KEEL_PREVIEW_D1_CAPACITY_BUCKET ||
      key !== environment.KEEL_PREVIEW_D1_CAPACITY_KEY)
  )
    throw new Error(
      "Worker and maintenance capacity owner configuration differs.",
    );
  const store = dependencies.store ?? nodeCapacityStore(privateR2(config), key);
  const evidenceHash = digest(plan);
  return runCapacityWork(
    {
      store,
      account: plan.account,
      database: plan.database,
      revision: plan.revision,
      producer: kind,
      operationId: `${kind}-${plan.runId}-${plan.attempt}`,
      operationCreatedAt: plan.operationCreatedAt,
      evidenceHash,
      minimumCost: plan.envelope,
      now,
    },
    async (scope) => {
      scope.recordUnknown();
      const history = await scope.stage("frontier", () =>
        (
          dependencies.frontier ??
          ((p) => readMaintenanceFrontier(p, environment, fetch))
        )(plan),
      );
      const expected = (await readdir("packages/database/migrations"))
        .filter((name) => name.endsWith(".sql") && name <= plan.frontier)
        .sort();
      if (JSON.stringify(history) !== JSON.stringify(expected))
        throw new Error("Actual D1 migration frontier is uncertified.");
      if (kind === "release") {
        const admission = MaintenanceAdmissionSchema.parse({
          version: 1,
          state: "admitted",
          gitSha: plan.revision,
          runId: plan.runId,
          runAttempt: plan.attempt,
          frontier: plan.frontier,
          pending: plan.pending,
          migrationSafetyKind: safety.kind,
          migrationCost: safety.migrationCost,
          sourceDigest: safety.sourceDigest,
          migrationReceiptDigest: safety.receiptDigest,
          capacityEvidenceHash: evidenceHash,
          chargedEnvelope: plan.envelope,
          actualBilledRows: "unavailable",
        });
        await writeFile(
          z.string().min(1).parse(environment.KEEL_D1_MAINTENANCE_RECEIPT_PATH),
          JSON.stringify(admission),
          { mode: 0o600 },
        );
      }
      await (dependencies.execute ?? executeMaintenance)(
        scope,
        plan,
        environment,
      );
    },
  );
}

async function executeMaintenance(
  scope: Scope,
  plan: MaintenancePlan,
  environment: NodeJS.ProcessEnv,
) {
  if (plan.kind === "daily-backup") {
    const { runPrivateDocumentBackupJob } =
      await import("./private-document-backup-job");
    await scope.stage("daily-backup", () =>
      runPrivateDocumentBackupJob({
        exportDatabase: (output) =>
          exportMaintenanceD1(
            {
              account: plan.account,
              database: plan.database,
              token: z
                .string()
                .min(20)
                .parse(environment.KEEL_DOCUMENT_D1_READ_TOKEN),
              output,
              maxBytes: plan.exportMaxBytes,
            },
            { check: () => scope.check() },
          ),
      }),
    );
    return;
  }
  await runRelease(scope, plan, environment, runMaintenanceCommand);
}

export async function runRelease(
  scope: Scope,
  plan: MaintenancePlan,
  environment: NodeJS.ProcessEnv,
  invoke: Command,
) {
  const required = (key: string) => z.string().min(1).parse(environment[key]);
  const paths = await writePreviewDeploymentFiles(environment);
  const pnpm = (args: string[], overrides: NodeJS.ProcessEnv = {}) =>
    invoke("pnpm", args, { ...environment, ...overrides });
  await scope.stage("export", () =>
    exportMaintenanceD1(
      {
        account: plan.account,
        database: plan.database,
        token: required("CLOUDFLARE_API_TOKEN"),
        output: required("KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH"),
        maxBytes: plan.exportMaxBytes,
      },
      { check: () => scope.check() },
    ),
  );
  await scope.stage("backup-integrity", async () => {
    const shared = [
      "--batch",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--passphrase-file",
      paths.backupPassphrasePath,
    ];
    await invoke(
      "gpg",
      [
        ...shared,
        "--symmetric",
        "--cipher-algo",
        "AES256",
        "--output",
        required("KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH"),
        required("KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH"),
      ],
      environment,
    );
    await invoke(
      "gpg",
      [
        ...shared,
        "--output",
        required("KEEL_PREVIEW_BACKUP_VERIFY_PATH"),
        "--decrypt",
        required("KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH"),
      ],
      environment,
    );
    await invoke(
      "cmp",
      [
        "--silent",
        required("KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH"),
        required("KEEL_PREVIEW_BACKUP_VERIFY_PATH"),
      ],
      environment,
    );
    await writeBackupManifest(environment);
    await storePreviewEvidence("backup", environment);
  });
  await scope.stage("migration", async () => {
    if (plan.pending.length)
      await pnpm([
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "apply",
        required("KEEL_PREVIEW_D1_NAME"),
        "--remote",
        "--config",
        paths.apiConfigPath,
      ]);
    const after = await readMaintenanceFrontier(plan, environment, fetch);
    const target = plan.pending.at(-1) ?? plan.frontier;
    const expected = (await readdir("packages/database/migrations"))
      .filter((name) => name.endsWith(".sql") && name <= target)
      .sort();
    if (JSON.stringify(after) !== JSON.stringify(expected))
      throw new Error("Applied migration frontier mismatch.");
  });
  await scope.stage("api-deploy", async () => {
    await writePreviewApiSecrets(environment);
    await pnpm(
      [
        "exec",
        "wrangler",
        "deploy",
        "--config",
        paths.apiConfigPath,
        "--secrets-file",
        paths.apiSecretsPath,
        "--strict",
        "--tag",
        plan.revision,
        "--message",
        `GitHub Actions preview ${plan.revision}`,
      ],
      { WRANGLER_OUTPUT_FILE_PATH: required("KEEL_API_WRANGLER_OUTPUT_PATH") },
    );
  });
  await scope.stage("web-deploy", async () => {
    await pnpm(["--filter", "@keel/web", "build"]);
    await pnpm(
      [
        "exec",
        "wrangler",
        "deploy",
        "--config",
        paths.webConfigPath,
        "--strict",
        "--tag",
        plan.revision,
        "--message",
        `GitHub Actions preview ${plan.revision}`,
      ],
      { WRANGLER_OUTPUT_FILE_PATH: required("KEEL_WEB_WRANGLER_OUTPUT_PATH") },
    );
  });
  const versions = await readDeploymentVersions(environment);
  await scope.stage("smokes", () =>
    runPreviewDeploymentSmoke({
      ...environment,
      KEEL_API_VERSION_ID: versions.apiVersionId,
      KEEL_WEB_VERSION_ID: versions.webVersionId,
    }),
  );
  await scope.stage("release-evidence", async () => {
    await writeReleaseEvidence(environment);
    await storePreviewEvidence("release", environment);
  });
  await Promise.all(
    [
      paths.apiSecretsPath,
      paths.backupPassphrasePath,
      required("KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH"),
      required("KEEL_PREVIEW_BACKUP_VERIFY_PATH"),
    ].map((path) => rm(path, { force: true })),
  );
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  try {
    if (process.argv[2] === "check") await checkMaintenanceEntryPoints();
    else
      await runD1Maintenance(
        z.enum(["release", "daily-backup"]).parse(process.argv[2]),
      );
  } catch {
    console.error(
      "D1 maintenance refused or incomplete. Inspect private evidence and reconcile uncertain work before retrying.",
    );
    process.exitCode = 1;
  }
}
