import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { PLAID_INVESTMENTS_DAILY_SYNC_CRON } from "../packages/connectors/src/plaid-investments-schedule";

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

const OptionalEnvironmentValue = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );
const OptionalWatchEnvironmentShape = {
  KEEL_PREVIEW_BRAVE_SEARCH_API_KEY: OptionalEnvironmentValue(
    z.string().trim().min(1).max(512),
  ),
};
const OptionalPlaidEnvironmentShape = {
  KEEL_PREVIEW_CONNECTOR_CREDENTIAL_KEY: OptionalEnvironmentValue(
    z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  ),
  KEEL_PREVIEW_PLAID_CLIENT_ID: OptionalEnvironmentValue(
    z.string().min(1).max(512),
  ),
  KEEL_PREVIEW_PLAID_ENVIRONMENT: OptionalEnvironmentValue(
    z.enum(["sandbox", "production"]),
  ),
  KEEL_PREVIEW_PLAID_REDIRECT_URI: OptionalEnvironmentValue(
    z
      .url()
      .max(2_048)
      .refine((value) => new URL(value).protocol === "https:"),
  ),
  KEEL_PREVIEW_PLAID_SECRET: OptionalEnvironmentValue(
    z.string().min(1).max(512),
  ),
} as const;

function validateCompletePlaidEnvironment(
  value: Partial<Record<keyof typeof OptionalPlaidEnvironmentShape, unknown>>,
  context: z.RefinementCtx,
) {
  const configuredCount = Object.keys(OptionalPlaidEnvironmentShape).filter(
    (key) =>
      value[key as keyof typeof OptionalPlaidEnvironmentShape] !== undefined,
  ).length;
  if (
    configuredCount !== 0 &&
    configuredCount !== Object.keys(OptionalPlaidEnvironmentShape).length
  ) {
    context.addIssue({
      code: "custom",
      message: "Preview Plaid settings must be supplied together.",
    });
  }
}

export const PreviewDeploymentEnvironmentSchema = z
  .object({
    CLOUDFLARE_ACCOUNT_ID: CloudflareAccountIdSchema,
    CLOUDFLARE_API_TOKEN: z.string().min(20),
    GITHUB_SHA: GitShaSchema,
    KEEL_PREVIEW_ACCESS_AUD: z.string().min(8).max(256),
    KEEL_PREVIEW_ACCESS_CLIENT_ID: z.string().min(16).max(512),
    KEEL_PREVIEW_ACCESS_CLIENT_SECRET: z.string().min(32).max(1024),
    KEEL_PREVIEW_ACCESS_TEAM_DOMAIN: HostnameSchema,
    KEEL_PREVIEW_API_WORKER: CloudflareResourceNameSchema,
    KEEL_PREVIEW_AGENT_READ_SERVICE_SUBJECT: OptionalEnvironmentValue(
      z.string().regex(/^[a-f0-9]{32}\.access$/i),
    ),
    KEEL_PREVIEW_AGENT_READ_HOUSEHOLD_ID: OptionalEnvironmentValue(
      z.string().trim().min(1).max(256),
    ),
    KEEL_PREVIEW_AGENT_GOAL_WRITE_SERVICE_SUBJECT: OptionalEnvironmentValue(
      z.string().regex(/^[a-f0-9]{32}\.access$/i),
    ),
    KEEL_PREVIEW_AGENT_GOAL_WRITE_HOUSEHOLD_ID: OptionalEnvironmentValue(
      z.string().trim().min(1).max(256),
    ),
    KEEL_PREVIEW_PLAID_CASH_USAGE_PLAN: OptionalEnvironmentValue(
      z.enum(["free", "paid"]),
    ),
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
    ...OptionalPlaidEnvironmentShape,
    ...OptionalWatchEnvironmentShape,
  })
  .superRefine(validateCompletePlaidEnvironment)
  .superRefine((value, ctx) => {
    const writeId = value.KEEL_PREVIEW_AGENT_GOAL_WRITE_SERVICE_SUBJECT;
    if (
      (writeId === undefined) !==
        (value.KEEL_PREVIEW_AGENT_GOAL_WRITE_HOUSEHOLD_ID === undefined) ||
      (writeId !== undefined &&
        [
          value.KEEL_PREVIEW_AGENT_READ_SERVICE_SUBJECT,
          value.KEEL_PREVIEW_ACCESS_CLIENT_ID,
        ].includes(writeId))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Goal writes require a distinct service identity and a household.",
      });
    if (
      (value.KEEL_PREVIEW_AGENT_READ_SERVICE_SUBJECT === undefined) !==
        (value.KEEL_PREVIEW_AGENT_READ_HOUSEHOLD_ID === undefined) ||
      value.KEEL_PREVIEW_AGENT_READ_SERVICE_SUBJECT ===
        value.KEEL_PREVIEW_ACCESS_CLIENT_ID
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A read grant requires a dedicated service identity and household together.",
      });
  });

const PreviewApiSecretsEnvironmentSchema = z
  .object({
    KEEL_PREVIEW_ACCESS_AUD: z.string().min(8).max(256),
    KEEL_PREVIEW_ACCESS_TEAM_DOMAIN: HostnameSchema,
    KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN: z.string().min(32).max(1024),
    RUNNER_TEMP: z.string().min(1),
    ...OptionalPlaidEnvironmentShape,
    ...OptionalWatchEnvironmentShape,
  })
  .superRefine(validateCompletePlaidEnvironment);

type PreviewDeploymentEnvironment = z.infer<
  typeof PreviewDeploymentEnvironmentSchema
>;

export function plaidWebhookUrl(previewUrl: URL): URL {
  const labels = previewUrl.hostname.split(".");
  if (labels.length < 3) {
    throw new Error("Preview URL must use a subdomain in a managed zone.");
  }
  const first = labels.shift();
  if (first === undefined) {
    throw new Error("Preview URL must include a hostname.");
  }
  const webhook = new URL(previewUrl);
  webhook.hostname = HostnameSchema.parse(
    `${first}-webhooks.${labels.join(".")}`,
  );
  webhook.pathname = "/webhooks/plaid";
  return webhook;
}

export function macAgentApiOrigin(previewUrl: URL): URL {
  const labels = previewUrl.hostname.split(".");
  if (labels.length < 3) {
    throw new Error("Preview URL must use a subdomain in a managed zone.");
  }
  const first = labels.shift();
  if (first === undefined) {
    throw new Error("Preview URL must include a hostname.");
  }
  const agentApi = new URL(previewUrl);
  agentApi.hostname = HostnameSchema.parse(
    `${first}-agents.${labels.join(".")}`,
  );
  return agentApi;
}

export type PreviewDeploymentPaths = {
  apiConfigPath: string;
  apiSecretsPath: string;
  backupPassphrasePath: string;
  webConfigPath: string;
};

function apiConfiguration(configuration: PreviewDeploymentEnvironment) {
  const webhookUrl = plaidWebhookUrl(configuration.KEEL_PREVIEW_URL);
  const agentApiOrigin = macAgentApiOrigin(configuration.KEEL_PREVIEW_URL);
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
      ...(configuration.KEEL_PREVIEW_AGENT_READ_SERVICE_SUBJECT
        ? {
            AGENT_READ_SERVICE_SUBJECT:
              configuration.KEEL_PREVIEW_AGENT_READ_SERVICE_SUBJECT,
            AGENT_READ_HOUSEHOLD_ID:
              configuration.KEEL_PREVIEW_AGENT_READ_HOUSEHOLD_ID,
          }
        : {}),
      ...(configuration.KEEL_PREVIEW_AGENT_GOAL_WRITE_SERVICE_SUBJECT
        ? {
            AGENT_GOAL_WRITE_SERVICE_SUBJECT:
              configuration.KEEL_PREVIEW_AGENT_GOAL_WRITE_SERVICE_SUBJECT,
            AGENT_GOAL_WRITE_HOUSEHOLD_ID:
              configuration.KEEL_PREVIEW_AGENT_GOAL_WRITE_HOUSEHOLD_ID,
          }
        : {}),
      INVESTMENTS_NEW_CONNECTIONS_ENABLED: "true",
      PLAID_CASH_USAGE_PLAN:
        configuration.KEEL_PREVIEW_PLAID_CASH_USAGE_PLAN ?? "paid",
      MAC_AGENT_API_ORIGIN: agentApiOrigin.origin,
      APP_ACCESS_API_ORIGIN: agentApiOrigin.origin,
      APP_ACCESS_WEB_ORIGIN: configuration.KEEL_PREVIEW_URL.origin,
      PLAID_WEBHOOK_URL: webhookUrl.href,
    },
    secrets: {
      required: [
        "ACCESS_AUD",
        "ACCESS_TEAM_DOMAIN",
        "DEPLOYMENT_SMOKE_TOKEN",
        ...(configuration.KEEL_PREVIEW_BRAVE_SEARCH_API_KEY === undefined
          ? []
          : ["BRAVE_SEARCH_API_KEY"]),
        ...(configuration.KEEL_PREVIEW_PLAID_CLIENT_ID === undefined
          ? []
          : [
              "CONNECTOR_CREDENTIAL_KEY",
              "PLAID_CLIENT_ID",
              "PLAID_ENVIRONMENT",
              "PLAID_REDIRECT_URI",
              "PLAID_SECRET",
            ]),
      ],
    },
    ratelimits: [
      {
        name: "APP_ACCESS_LIMITER",
        namespace_id: "11094",
        simple: { limit: 60, period: 60 },
      },
    ],
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
    triggers: {
      crons: [PLAID_INVESTMENTS_DAILY_SYNC_CRON],
    },
    observability: {
      enabled: true,
      head_sampling_rate: 0.1,
    },
  };
}

function webConfiguration(configuration: PreviewDeploymentEnvironment) {
  const webhookUrl = plaidWebhookUrl(configuration.KEEL_PREVIEW_URL);
  const agentApiOrigin = macAgentApiOrigin(configuration.KEEL_PREVIEW_URL);
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
      {
        pattern: webhookUrl.hostname,
        custom_domain: true,
        previews_enabled: false,
      },
      {
        pattern: agentApiOrigin.hostname,
        custom_domain: true,
        previews_enabled: false,
      },
    ],
    vars: {
      DEPLOYED_GIT_SHA: configuration.GITHUB_SHA,
      MAC_AGENT_API_HOST: agentApiOrigin.hostname,
      PLAID_WEBHOOK_HOST: webhookUrl.hostname,
    },
    version_metadata: { binding: "CF_VERSION_METADATA" },
    assets: {
      directory: "./dist",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: true,
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
        DEPLOYMENT_SMOKE_TOKEN:
          configuration.KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN,
        ...(configuration.KEEL_PREVIEW_BRAVE_SEARCH_API_KEY === undefined
          ? {}
          : {
              BRAVE_SEARCH_API_KEY:
                configuration.KEEL_PREVIEW_BRAVE_SEARCH_API_KEY,
            }),
        ...(configuration.KEEL_PREVIEW_PLAID_CLIENT_ID === undefined
          ? {}
          : {
              CONNECTOR_CREDENTIAL_KEY:
                configuration.KEEL_PREVIEW_CONNECTOR_CREDENTIAL_KEY,
              PLAID_CLIENT_ID: configuration.KEEL_PREVIEW_PLAID_CLIENT_ID,
              PLAID_ENVIRONMENT: configuration.KEEL_PREVIEW_PLAID_ENVIRONMENT,
              PLAID_REDIRECT_URI: configuration.KEEL_PREVIEW_PLAID_REDIRECT_URI,
              PLAID_SECRET: configuration.KEEL_PREVIEW_PLAID_SECRET,
            }),
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
