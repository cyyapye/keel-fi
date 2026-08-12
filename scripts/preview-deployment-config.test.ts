import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PreviewDeploymentEnvironmentSchema,
  writePreviewApiSecrets,
  writePreviewDeploymentFiles,
} from "./preview-deployment-config";

const temporaryDirectories: string[] = [];

function environment(root: string): NodeJS.ProcessEnv {
  return {
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_API_TOKEN: "synthetic-cloudflare-token-for-tests",
    GITHUB_SHA: "b".repeat(40),
    KEEL_PREVIEW_ACCESS_AUD: "synthetic-preview-audience",
    KEEL_PREVIEW_ACCESS_CLIENT_ID: "synthetic-preview-service-token.access",
    KEEL_PREVIEW_ACCESS_CLIENT_SECRET:
      "synthetic-preview-service-secret-for-tests",
    KEEL_PREVIEW_ACCESS_TEAM_DOMAIN: "team.example.com",
    KEEL_PREVIEW_API_WORKER: "keel-preview-api",
    KEEL_PREVIEW_BACKUP_PASSPHRASE:
      "synthetic-preview-backup-passphrase-for-tests",
    KEEL_PREVIEW_D1_ID: "00000000-0000-4000-8000-000000000001",
    KEEL_PREVIEW_D1_NAME: "keel-preview",
    KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN:
      "synthetic-preview-smoke-token-for-tests",
    KEEL_PREVIEW_CONNECTOR_CREDENTIAL_KEY: "a".repeat(43),
    KEEL_PREVIEW_PLAID_CLIENT_ID: "synthetic-plaid-client-id",
    KEEL_PREVIEW_PLAID_ENVIRONMENT: "sandbox",
    KEEL_PREVIEW_PLAID_REDIRECT_URI:
      "https://keel-preview.example.com/holdings",
    KEEL_PREVIEW_PLAID_SECRET: "synthetic-plaid-secret",
    KEEL_PREVIEW_QUEUE: "keel-preview-ingestion",
    KEEL_PREVIEW_QUEUE_DLQ: "keel-preview-ingestion-dlq",
    KEEL_PREVIEW_R2_BUCKET: "keel-preview-private-documents",
    KEEL_PREVIEW_URL: "https://keel-preview.example.com",
    KEEL_PREVIEW_WEB_WORKER: "keel-preview-web",
    RUNNER_TEMP: join(root, "runner-temp"),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("preview deployment configuration", () => {
  it("fails closed on a non-origin preview URL or partial Git SHA", () => {
    const invalid = environment("/tmp/unused");
    invalid.GITHUB_SHA = "abc123";
    invalid.KEEL_PREVIEW_URL = "https://keel-preview.example.com/path";

    expect(PreviewDeploymentEnvironmentSchema.safeParse(invalid).success).toBe(
      false,
    );

    const partialConnector = environment("/tmp/unused");
    delete partialConnector.KEEL_PREVIEW_PLAID_SECRET;
    expect(
      PreviewDeploymentEnvironmentSchema.safeParse(partialConnector).success,
    ).toBe(false);
  });

  it("generates complete private Wrangler configuration outside tracked files", async () => {
    const root = await mkdtemp(join(tmpdir(), "keel-preview-config-"));
    temporaryDirectories.push(root);

    const paths = await writePreviewDeploymentFiles(environment(root), root);
    await writePreviewApiSecrets(environment(root));
    const apiConfig = JSON.parse(await readFile(paths.apiConfigPath, "utf8"));
    const webConfig = JSON.parse(await readFile(paths.webConfigPath, "utf8"));
    const apiSecrets = JSON.parse(await readFile(paths.apiSecretsPath, "utf8"));

    expect(apiConfig).toMatchObject({
      name: "keel-preview-api",
      workers_dev: false,
      preview_urls: false,
      vars: { ENVIRONMENT: "preview", DEPLOYED_GIT_SHA: "b".repeat(40) },
      compatibility_flags: ["global_fetch_strictly_public", "nodejs_compat"],
      secrets: {
        required: [
          "ACCESS_AUD",
          "ACCESS_TEAM_DOMAIN",
          "DEPLOYMENT_SMOKE_TOKEN",
          "CONNECTOR_CREDENTIAL_KEY",
          "PLAID_CLIENT_ID",
          "PLAID_ENVIRONMENT",
          "PLAID_REDIRECT_URI",
          "PLAID_SECRET",
        ],
      },
      version_metadata: { binding: "CF_VERSION_METADATA" },
      queues: {
        consumers: [
          {
            queue: "keel-preview-ingestion",
            dead_letter_queue: "keel-preview-ingestion-dlq",
          },
        ],
      },
    });
    expect(webConfig).toMatchObject({
      name: "keel-preview-web",
      routes: [{ pattern: "keel-preview.example.com" }],
      services: [{ service: "keel-preview-api" }],
      vars: { DEPLOYED_GIT_SHA: "b".repeat(40) },
    });
    expect(apiSecrets).toEqual({
      ACCESS_AUD: "synthetic-preview-audience",
      ACCESS_TEAM_DOMAIN: "team.example.com",
      CONNECTOR_CREDENTIAL_KEY: "a".repeat(43),
      DEPLOYMENT_SMOKE_TOKEN: "synthetic-preview-smoke-token-for-tests",
      PLAID_CLIENT_ID: "synthetic-plaid-client-id",
      PLAID_ENVIRONMENT: "sandbox",
      PLAID_REDIRECT_URI: "https://keel-preview.example.com/holdings",
      PLAID_SECRET: "synthetic-plaid-secret",
    });
    expect(JSON.stringify(apiConfig)).not.toContain(
      "synthetic-preview-service-secret-for-tests",
    );
    expect((await stat(paths.apiSecretsPath)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.backupPassphrasePath)).mode & 0o777).toBe(0o600);
  });
});
