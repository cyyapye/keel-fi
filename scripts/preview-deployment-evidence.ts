import { createHash } from "node:crypto";
import {
  appendFile,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const DeploymentRecordSchema = z
  .object({
    type: z.literal("deploy"),
    version_id: z.string().min(1).max(128),
    worker_name: z.string().min(1).max(128),
    worker_tag: z.string().nullable().optional(),
  })
  .passthrough();

const DeploymentEnvironmentSchema = z.object({
  GITHUB_SHA: GitShaSchema,
  KEEL_API_WRANGLER_OUTPUT_PATH: z.string().min(1),
  KEEL_PREVIEW_API_WORKER: z.string().min(1).max(128),
  KEEL_PREVIEW_WEB_WORKER: z.string().min(1).max(128),
  KEEL_WEB_WRANGLER_OUTPUT_PATH: z.string().min(1),
});

const BackupEnvironmentSchema = z.object({
  GITHUB_SHA: GitShaSchema,
  GITHUB_RUN_ID: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  GITHUB_RUN_ATTEMPT: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  KEEL_PREVIEW_BACKUP_NAME: z.string().min(1).max(256),
  KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH: z.string().min(1),
  KEEL_PREVIEW_BACKUP_MANIFEST_PATH: z.string().min(1),
  KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH: z.string().min(1),
});

export const BackupManifestSchema = z.object({
  schemaVersion: z.literal(2),
  environment: z.literal("preview"),
  gitSha: GitShaSchema,
  exportedAt: z.iso.datetime(),
  runId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  runAttempt: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  backupName: z.string().min(1).max(256),
  plaintextSha256: Sha256Schema,
  encryptedSha256: Sha256Schema,
});

export const StorageReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal("r2"),
    bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u),
    gitSha: GitShaSchema,
    runId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    runAttempt: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    backupKey: z.string().min(1).max(1024),
    manifestKey: z.string().min(1).max(1024),
    encryptedSha256: Sha256Schema,
    verifiedAt: z.iso.datetime(),
  })
  .refine((value) => {
    const prefix = `backups/${value.gitSha}/${value.runId}-${value.runAttempt}`;
    return (
      value.backupKey === `${prefix}/state.sql.gpg` &&
      value.manifestKey === `${prefix}/manifest.json`
    );
  }, "Backup object keys do not match the deployment attempt");

const ReleaseEnvironmentSchema = DeploymentEnvironmentSchema.extend({
  GITHUB_REPOSITORY: z.string().min(3),
  GITHUB_RUN_ATTEMPT: z.string().regex(/^\d+$/),
  GITHUB_RUN_ID: z.string().regex(/^\d+$/),
  GITHUB_SERVER_URL: z.string().url(),
  GITHUB_STEP_SUMMARY: z.string().min(1),
  KEEL_PREVIEW_BACKUP_MANIFEST_PATH: z.string().min(1),
  KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH: z.string().min(1),
  KEEL_PREVIEW_BACKUP_BUCKET: z.string().min(1),
  KEEL_PREVIEW_RELEASE_EVIDENCE_PATH: z.string().min(1),
});

export type DeploymentVersions = {
  apiVersionId: string;
  webVersionId: string;
};

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", resolveHash);
  });
  return hash.digest("hex");
}

export function deploymentRecordFromJsonl(
  contents: string,
  expectedWorkerName: string,
): z.infer<typeof DeploymentRecordSchema> {
  const records = contents
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown)
    .map((record) => DeploymentRecordSchema.safeParse(record))
    .filter((result) => result.success)
    .map((result) => result.data);
  const deployment = records.at(-1);
  if (
    deployment === undefined ||
    deployment.worker_name !== expectedWorkerName
  ) {
    throw new Error("Wrangler output did not record the expected deployment.");
  }
  return deployment;
}

export async function readDeploymentVersions(
  rawEnvironment: NodeJS.ProcessEnv,
): Promise<DeploymentVersions> {
  const configuration = DeploymentEnvironmentSchema.parse(rawEnvironment);
  const [apiOutput, webOutput] = await Promise.all([
    readFile(configuration.KEEL_API_WRANGLER_OUTPUT_PATH, "utf8"),
    readFile(configuration.KEEL_WEB_WRANGLER_OUTPUT_PATH, "utf8"),
  ]);
  const api = deploymentRecordFromJsonl(
    apiOutput,
    configuration.KEEL_PREVIEW_API_WORKER,
  );
  const web = deploymentRecordFromJsonl(
    webOutput,
    configuration.KEEL_PREVIEW_WEB_WORKER,
  );
  return { apiVersionId: api.version_id, webVersionId: web.version_id };
}

export async function writeBackupManifest(
  rawEnvironment: NodeJS.ProcessEnv,
): Promise<void> {
  const configuration = BackupEnvironmentSchema.parse(rawEnvironment);
  const [plaintextStats, encryptedStats, plaintextSha256, encryptedSha256] =
    await Promise.all([
      stat(configuration.KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH),
      stat(configuration.KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH),
      sha256File(configuration.KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH),
      sha256File(configuration.KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH),
    ]);
  if (plaintextStats.size === 0 || encryptedStats.size === 0) {
    throw new Error("Preview backup export or encrypted artifact was empty.");
  }

  const manifest = BackupManifestSchema.parse({
    schemaVersion: 2,
    environment: "preview",
    gitSha: configuration.GITHUB_SHA,
    exportedAt: new Date().toISOString(),
    runId: configuration.GITHUB_RUN_ID,
    runAttempt: configuration.GITHUB_RUN_ATTEMPT,
    backupName: configuration.KEEL_PREVIEW_BACKUP_NAME,
    plaintextSha256,
    encryptedSha256,
  });
  await writeFile(
    configuration.KEEL_PREVIEW_BACKUP_MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export async function writeReleaseEvidence(
  rawEnvironment: NodeJS.ProcessEnv,
  repositoryRoot = process.cwd(),
): Promise<void> {
  const configuration = ReleaseEnvironmentSchema.parse(rawEnvironment);
  const [versions, backupContents, storageContents, migrationEntries] =
    await Promise.all([
      readDeploymentVersions(rawEnvironment),
      readFile(configuration.KEEL_PREVIEW_BACKUP_MANIFEST_PATH, "utf8"),
      readFile(configuration.KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH, "utf8"),
      readdir(resolve(repositoryRoot, "packages/database/migrations")),
    ]);
  const backup = BackupManifestSchema.parse(
    JSON.parse(backupContents) as unknown,
  );
  const storage = StorageReceiptSchema.parse(
    JSON.parse(storageContents) as unknown,
  );
  if (
    backup.gitSha !== configuration.GITHUB_SHA ||
    storage.gitSha !== configuration.GITHUB_SHA ||
    storage.runId !== configuration.GITHUB_RUN_ID ||
    storage.runAttempt !== configuration.GITHUB_RUN_ATTEMPT ||
    backup.runId !== storage.runId ||
    backup.runAttempt !== storage.runAttempt ||
    storage.bucket !== configuration.KEEL_PREVIEW_BACKUP_BUCKET ||
    storage.encryptedSha256 !== backup.encryptedSha256
  ) {
    throw new Error(
      "Backup evidence belongs to a different deployment attempt.",
    );
  }
  const migrationNames = migrationEntries
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (migrationNames.length === 0) {
    throw new Error("No D1 migrations were found for release evidence.");
  }

  const runUrl = `${configuration.GITHUB_SERVER_URL}/${configuration.GITHUB_REPOSITORY}/actions/runs/${configuration.GITHUB_RUN_ID}/attempts/${configuration.GITHUB_RUN_ATTEMPT}`;
  const evidence = {
    schemaVersion: 2,
    environment: "preview",
    gitSha: configuration.GITHUB_SHA,
    deployedAt: new Date().toISOString(),
    githubActionsRun: runUrl,
    workers: {
      apiVersionId: versions.apiVersionId,
      webVersionId: versions.webVersionId,
    },
    d1: {
      backupStorage: storage,
      backupEncryptedSha256: backup.encryptedSha256,
      migrations: migrationNames,
    },
    verifiedSmokes: [
      "access_missing_denied",
      "access_invalid_denied",
      "access_service_token",
      "dashboard_shell_and_asset",
      "d1_binding",
      "issuer_lookup_provider",
      "r2_transient_round_trip_and_cleanup",
      "queue_publish_canary",
      "api_and_web_git_sha",
      "api_and_web_worker_version",
    ],
  };
  await writeFile(
    configuration.KEEL_PREVIEW_RELEASE_EVIDENCE_PATH,
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
  await appendFile(
    configuration.GITHUB_STEP_SUMMARY,
    [
      "## Preview deployment",
      "",
      `- Git SHA: \`${configuration.GITHUB_SHA}\``,
      `- API Worker version: \`${versions.apiVersionId}\``,
      `- Web Worker version: \`${versions.webVersionId}\``,
      `- Encrypted D1 backup: private R2 \`${storage.backupKey}\` (read-back verified)`,
      `- Migrations represented: ${migrationNames.length}`,
      "- Access, dashboard, D1, R2, Queue, and exact-version smokes: passed",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "versions") {
    const githubOutput = z.string().min(1).parse(process.env.GITHUB_OUTPUT);
    const versions = await readDeploymentVersions(process.env);
    await appendFile(
      githubOutput,
      `api_version_id=${versions.apiVersionId}\nweb_version_id=${versions.webVersionId}\n`,
    );
    return;
  }
  if (command === "backup") {
    await writeBackupManifest(process.env);
    console.info("Encrypted preview D1 backup manifest recorded.");
    return;
  }
  if (command === "release") {
    await writeReleaseEvidence(process.env);
    console.info(
      `Preview release evidence recorded for ${process.env.GITHUB_SHA}.`,
    );
    return;
  }
  throw new Error("Expected command: versions, backup, or release.");
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  await main();
}
