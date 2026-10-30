import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deploymentRecordFromJsonl,
  readDeploymentVersions,
  writeBackupManifest,
} from "./preview-deployment-evidence";

const temporaryDirectories: string[] = [];
const gitSha = "e".repeat(40);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("preview deployment evidence", () => {
  it("selects only the exact Worker deployment record", () => {
    const contents = [
      JSON.stringify({ type: "wrangler-session", version: 1 }),
      JSON.stringify({
        type: "deploy",
        worker_name: "keel-preview-api",
        worker_tag: "internal-api-worker-tag",
        version_id: "api-version-1",
      }),
    ].join("\n");

    expect(
      deploymentRecordFromJsonl(contents, "keel-preview-api"),
    ).toMatchObject({ version_id: "api-version-1" });
    expect(() =>
      deploymentRecordFromJsonl(contents, "keel-preview-web"),
    ).toThrow("expected deployment");
  });

  it("reads ordered API and web version IDs from Wrangler output", async () => {
    const root = await mkdtemp(join(tmpdir(), "keel-preview-evidence-"));
    temporaryDirectories.push(root);
    const apiPath = join(root, "api.jsonl");
    const webPath = join(root, "web.jsonl");
    await Promise.all([
      writeFile(
        apiPath,
        `${JSON.stringify({
          type: "deploy",
          worker_name: "keel-preview-api",
          worker_tag: "internal-api-worker-tag",
          version_id: "api-version-1",
        })}\n`,
      ),
      writeFile(
        webPath,
        `${JSON.stringify({
          type: "deploy",
          worker_name: "keel-preview-web",
          worker_tag: "internal-web-worker-tag",
          version_id: "web-version-1",
        })}\n`,
      ),
    ]);

    await expect(
      readDeploymentVersions({
        GITHUB_SHA: gitSha,
        KEEL_API_WRANGLER_OUTPUT_PATH: apiPath,
        KEEL_PREVIEW_API_WORKER: "keel-preview-api",
        KEEL_PREVIEW_WEB_WORKER: "keel-preview-web",
        KEEL_WEB_WRANGLER_OUTPUT_PATH: webPath,
      }),
    ).resolves.toEqual({
      apiVersionId: "api-version-1",
      webVersionId: "web-version-1",
    });
  });

  it("hashes both plaintext and encrypted backup artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "keel-preview-backup-"));
    temporaryDirectories.push(root);
    const plaintextPath = join(root, "preview.sql");
    const encryptedPath = join(root, "preview.sql.gpg");
    const manifestPath = join(root, "manifest.json");
    await Promise.all([
      writeFile(plaintextPath, "synthetic preview export"),
      writeFile(encryptedPath, "synthetic encrypted preview export"),
    ]);

    await writeBackupManifest({
      GITHUB_SHA: gitSha,
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      KEEL_PREVIEW_BACKUP_NAME: `preview-d1-backup-${gitSha}`,
      KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH: encryptedPath,
      KEEL_PREVIEW_BACKUP_MANIFEST_PATH: manifestPath,
      KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH: plaintextPath,
    });

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      environment: "preview",
      gitSha,
      schemaVersion: 2,
      runId: "123",
      runAttempt: "1",
      backupName: `preview-d1-backup-${gitSha}`,
    });
    expect(manifest.plaintextSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.encryptedSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
