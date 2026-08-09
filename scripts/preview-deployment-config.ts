import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const CloudflareAccountIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
const CloudflareResourceNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/);
const HostnameSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(
    /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
  );
const PreviewUrlSchema = z
  .string()
  .url()
  .transform((value, context) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      context.addIssue({
        code: "custom",
        message: "Preview URL must be an HTTPS origin with no path or query.",
      });
      return z.NEVER;
    }
    return url;
  });

export const PreviewDeploymentEnvironmentSchema = z.object({
  CLOUDFLARE_ACCOUNT_ID: CloudflareAccountIdSchema,
  CLOUDFLARE_API_TOKEN: z.string().min(20),
  GITHUB_SHA: GitShaSchema,
  KEEL_PREVIEW_ANGELLIST_ACCESS_SUBJECT: z.string().min(1).max(512),
  KEEL_PREVIEW_ANGELLIST_AUTOMATION_ENABLED: z.enum(["true", "false"]),
  KEEL_PREVIEW_ANGELLIST_KV_ID: CloudflareAccountIdSchema,
  KEEL_PREVIEW_ANGELLIST_SESSION_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  KEEL_PREVIEW_ACCESS_AUD: z.string().min(8).max(256),
  KEEL_PREVIEW_ACCESS_CLIENT_ID: z.string().min(16).max(512),
  KEEL_PREVIEW_ACCESS_CLIENT_SECRET: z.string().min(32).max(1024),
  KEEL_PREVIEW_ACCESS_TEAM_DOMAIN: HostnameSchema,
  KEEL_PREVIEW_API_WORKER: CloudflareResourceNameSchema,
  KEEL_PREVIEW_BACKUP_PASSPHRASE: z.string().min(32).max(1024),
  KEEL_PREVIEW_D1_ID: z.uuid(),
  KEEL_PREVIEW_D1_NAME: CloudflareResourceNameSchema,
  KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN: z.string().min(32).max(1024),
  KEEL_PREVIEW_QUEUE: CloudflareResourceNameSchema,
  KEEL_PREVIEW_QUEUE_DLQ: CloudflareResourceNameSchema,
  KEEL_PREVIEW_R2_BUCKET: CloudflareResourceNameSchema,
  KEEL_PREVIEW_URL: PreviewUrlSchema,
  KEEL_PREVIEW_WEB_WORKER: CloudflareResourceNameSchema,
  RUNNER_TEMP: z.string().min(1),
});

const PreviewApiSecretsEnvironmentSchema = z.object({
  KEEL_PREVIEW_ANGELLIST_ACCESS_SUBJECT: z.string().min(1).max(512),
  KEEL_PREVIEW_ANGELLIST_AUTOMATION_ENABLED: z.enum(["true", "false"]),
  KEEL_PREVIEW_ANGELLIST_SESSION_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  KEEL_PREVIEW_ACCESS_AUD: z.string().min(8).max(256),
  KEEL_PREVIEW_ACCESS_TEAM_DOMAIN: HostnameSchema,
  KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN: z.string().min(32).max(1024),
  RUNNER_TEMP: z.string().min(1),
});

type PreviewDeploymentEnvironment = z.infer<
  typeof PreviewDeploymentEnvironmentSchema
>;

export type PreviewDeploymentPaths = {
  apiConfigPath: string;
  apiSecretsPath: string;
  backupPassphrasePath: string;
  webConfigPath: string;
};

function apiConfiguration(configuration: PreviewDeploymentEnvironment) {
  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: configuration.KEEL_PREVIEW_API_WORKER,
    main: "src/index.ts",
    compatibility_date: "2026-07-28",
    compatibility_flags: ["global_fetch_strictly_public", "nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
    vars: {
      ENVIRONMENT: "preview",
      DEPLOYED_GIT_SHA: configuration.GITHUB_SHA,
    },
    secrets: {
      required: [
        "ACCESS_AUD",
        "ACCESS_TEAM_DOMAIN",
        "ANGELLIST_ACCESS_SUBJECT",
        "ANGELLIST_AUTOMATION_ENABLED",
        "ANGELLIST_SESSION_KEY",
        "DEPLOYMENT_SMOKE_TOKEN",
      ],
    },
    browser: { binding: "ANGELLIST_BROWSER" },
    kv_namespaces: [
      {
        binding: "ANGELLIST_AUTOMATION",
        id: configuration.KEEL_PREVIEW_ANGELLIST_KV_ID,
      },
    ],
    triggers: { crons: ["0 * * * 1"] },
    version_metadata: { binding: "CF_VERSION_METADATA" },
    d1_databases: [
      {
        binding: "DB",
        database_name: configuration.KEEL_PREVIEW_D1_NAME,
        database_id: configuration.KEEL_PREVIEW_D1_ID,
        migrations_dir: "../../packages/database/migrations",
      },
    ],
    r2_buckets: [
      {
        binding: "DOCUMENTS",
        bucket_name: configuration.KEEL_PREVIEW_R2_BUCKET,
      },
    ],
    queues: {
      producers: [
        {
          binding: "INGESTION_QUEUE",
          queue: configuration.KEEL_PREVIEW_QUEUE,
        },
      ],
      consumers: [
        {
          queue: configuration.KEEL_PREVIEW_QUEUE,
          dead_letter_queue: configuration.KEEL_PREVIEW_QUEUE_DLQ,
          max_batch_size: 1,
          max_batch_timeout: 5,
          max_retries: 3,
        },
      ],
    },
    observability: {
      enabled: true,
      head_sampling_rate: 0.1,
    },
  };
}

function webConfiguration(configuration: PreviewDeploymentEnvironment) {
  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: configuration.KEEL_PREVIEW_WEB_WORKER,
    main: "src/worker.ts",
    compatibility_date: "2026-07-28",
    workers_dev: false,
    preview_urls: false,
    routes: [
      {
        pattern: configuration.KEEL_PREVIEW_URL.hostname,
        custom_domain: true,
        previews_enabled: false,
      },
    ],
    vars: {
      DEPLOYED_GIT_SHA: configuration.GITHUB_SHA,
    },
    version_metadata: { binding: "CF_VERSION_METADATA" },
    assets: {
      directory: "./dist",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api", "/api/*", "/health"],
    },
    services: [
      {
        binding: "API",
        service: configuration.KEEL_PREVIEW_API_WORKER,
      },
    ],
    observability: {
      enabled: true,
      head_sampling_rate: 0.1,
    },
  };
}

export async function writePreviewDeploymentFiles(
  rawEnvironment: NodeJS.ProcessEnv,
  repositoryRoot = process.cwd(),
): Promise<PreviewDeploymentPaths> {
  const configuration =
    PreviewDeploymentEnvironmentSchema.parse(rawEnvironment);
  const paths = {
    apiConfigPath: resolve(repositoryRoot, "apps/api/wrangler.preview.jsonc"),
    apiSecretsPath: resolve(
      configuration.RUNNER_TEMP,
      "keel-preview-api-secrets.json",
    ),
    backupPassphrasePath: resolve(
      configuration.RUNNER_TEMP,
      "keel-preview-backup-passphrase",
    ),
    webConfigPath: resolve(repositoryRoot, "apps/web/wrangler.preview.jsonc"),
  } satisfies PreviewDeploymentPaths;

  await Promise.all([
    mkdir(dirname(paths.apiConfigPath), { recursive: true }),
    mkdir(dirname(paths.webConfigPath), { recursive: true }),
    mkdir(configuration.RUNNER_TEMP, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      paths.apiConfigPath,
      `${JSON.stringify(apiConfiguration(configuration), null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      paths.webConfigPath,
      `${JSON.stringify(webConfiguration(configuration), null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      paths.backupPassphrasePath,
      configuration.KEEL_PREVIEW_BACKUP_PASSPHRASE,
      { mode: 0o600 },
    ),
  ]);
  await Promise.all(
    [paths.apiConfigPath, paths.backupPassphrasePath, paths.webConfigPath].map(
      (path) => chmod(path, 0o600),
    ),
  );

  return paths;
}

export async function writePreviewApiSecrets(
  rawEnvironment: NodeJS.ProcessEnv,
): Promise<string> {
  const configuration =
    PreviewApiSecretsEnvironmentSchema.parse(rawEnvironment);
  const path = resolve(
    configuration.RUNNER_TEMP,
    "keel-preview-api-secrets.json",
  );
  await mkdir(configuration.RUNNER_TEMP, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        ACCESS_AUD: configuration.KEEL_PREVIEW_ACCESS_AUD,
        ACCESS_TEAM_DOMAIN: configuration.KEEL_PREVIEW_ACCESS_TEAM_DOMAIN,
        ANGELLIST_ACCESS_SUBJECT:
          configuration.KEEL_PREVIEW_ANGELLIST_ACCESS_SUBJECT,
        ANGELLIST_AUTOMATION_ENABLED:
          configuration.KEEL_PREVIEW_ANGELLIST_AUTOMATION_ENABLED,
        ANGELLIST_SESSION_KEY: configuration.KEEL_PREVIEW_ANGELLIST_SESSION_KEY,
        DEPLOYMENT_SMOKE_TOKEN:
          configuration.KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
  return path;
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  if (process.argv[2] === "api-secrets") {
    await writePreviewApiSecrets(process.env);
    console.info("Generated private API deployment secrets file.");
  } else {
    await writePreviewDeploymentFiles(process.env);
    console.info("Validated preview environment and generated private config.");
  }
}
