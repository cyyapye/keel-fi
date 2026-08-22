import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { DeploymentSmokeResultSchema } from "../apps/api/src/deployment-smoke";
import {
  macAgentApiOrigin,
  plaidWebhookUrl,
} from "./preview-deployment-config";

const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const PreviewUrlSchema = z
  .string()
  .url()
  .transform((value) => new URL(value));
const VersionIdSchema = z.string().min(1).max(128);

const PreviewSmokeEnvironmentSchema = z.object({
  GITHUB_SHA: GitShaSchema,
  KEEL_API_VERSION_ID: VersionIdSchema,
  KEEL_PREVIEW_ACCESS_CLIENT_ID: z.string().min(16).max(512),
  KEEL_PREVIEW_ACCESS_CLIENT_SECRET: z.string().min(32).max(1024),
  KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN: z.string().min(32).max(1024),
  KEEL_PREVIEW_URL: PreviewUrlSchema,
  KEEL_WEB_VERSION_ID: VersionIdSchema,
});

const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("keel-api"),
  deployedGitSha: GitShaSchema,
  workerVersionId: VersionIdSchema,
  workerVersionTag: GitShaSchema,
});

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type Delay = (milliseconds: number) => Promise<void>;

class DeploymentVersionMismatch extends Error {}

type EventuallyOptions = {
  attempts?: number;
  shouldRetry?: (error: unknown) => boolean;
};

function accessHeaders(configuration: PreviewSmokeEnvironment): Headers {
  return new Headers({
    "CF-Access-Client-Id": configuration.KEEL_PREVIEW_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": configuration.KEEL_PREVIEW_ACCESS_CLIENT_SECRET,
  });
}

async function request(
  fetchImplementation: FetchLike,
  url: URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetchImplementation(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

function requireSuccessfulResponse(response: Response, label: string): void {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
}

async function parseJson(response: Response, label: string): Promise<unknown> {
  requireSuccessfulResponse(response, label);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
}

async function eventually<T>(
  operation: () => Promise<T>,
  delay: Delay,
  options: EventuallyOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 12;
  const shouldRetry = options.shouldRetry ?? (() => true);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts && shouldRetry(error)) {
        await delay(5_000);
      } else {
        break;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Preview deployment did not become ready.");
}

type PreviewSmokeEnvironment = z.infer<typeof PreviewSmokeEnvironmentSchema>;

export async function runPreviewDeploymentSmoke(
  rawEnvironment: NodeJS.ProcessEnv,
  fetchImplementation: FetchLike = fetch,
  delay: Delay = (milliseconds) =>
    new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
): Promise<void> {
  const configuration = PreviewSmokeEnvironmentSchema.parse(rawEnvironment);
  const baseUrl = configuration.KEEL_PREVIEW_URL;
  const agentApiOrigin = macAgentApiOrigin(baseUrl);
  const webhookUrl = plaidWebhookUrl(baseUrl);

  const unauthenticatedResponse = await request(fetchImplementation, baseUrl);
  if (unauthenticatedResponse.ok) {
    throw new Error("Cloudflare Access allowed an unauthenticated request.");
  }

  const invalidAccessResponse = await request(fetchImplementation, baseUrl, {
    headers: {
      "CF-Access-Client-Id": "invalid.access",
      "CF-Access-Client-Secret": "invalid",
    },
  });
  if (invalidAccessResponse.ok) {
    throw new Error("Cloudflare Access allowed an invalid service token.");
  }

  const webhookHostRoot = new URL(webhookUrl);
  webhookHostRoot.pathname = "/";
  const webhookRootResponse = await request(
    fetchImplementation,
    webhookHostRoot,
  );
  if (webhookRootResponse.status !== 404) {
    throw new Error("Plaid webhook host exposed an unexpected route.");
  }
  const unsignedWebhookResponse = await request(
    fetchImplementation,
    webhookUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  if (![401, 503].includes(unsignedWebhookResponse.status)) {
    throw new Error("Plaid webhook endpoint did not fail closed.");
  }

  const agentRootResponse = await request(fetchImplementation, agentApiOrigin);
  if (agentRootResponse.status !== 404) {
    throw new Error("Mac agent host exposed an unexpected route.");
  }
  const unauthenticatedAgentResponse = await request(
    fetchImplementation,
    new URL("/api/automation/angellist/mac-agent/lease", agentApiOrigin),
    { method: "POST" },
  );
  if (unauthenticatedAgentResponse.status !== 401) {
    throw new Error("Mac agent endpoint did not require its device token.");
  }

  const authenticatedHeaders = accessHeaders(configuration);
  await eventually(async () => {
    const response = await request(
      fetchImplementation,
      new URL("/health", baseUrl),
      { headers: authenticatedHeaders },
    );
    const health = HealthResponseSchema.parse(
      await parseJson(response, "Health smoke"),
    );
    if (
      health.deployedGitSha !== configuration.GITHUB_SHA ||
      health.workerVersionId !== configuration.KEEL_API_VERSION_ID ||
      health.workerVersionTag !== configuration.GITHUB_SHA ||
      response.headers.get("X-Keel-Web-Git-Sha") !== configuration.GITHUB_SHA ||
      response.headers.get("X-Keel-Web-Version-Id") !==
        configuration.KEEL_WEB_VERSION_ID ||
      response.headers.get("X-Keel-Web-Version-Tag") !==
        configuration.GITHUB_SHA
    ) {
      throw new Error("Health smoke reached a different deployed version.");
    }
  }, delay);

  const dashboardResponse = await request(fetchImplementation, baseUrl, {
    headers: authenticatedHeaders,
  });
  requireSuccessfulResponse(dashboardResponse, "Dashboard smoke");
  const dashboardHtml = await dashboardResponse.text();
  if (!/<div\s+id=["']root["']><\/div>/.test(dashboardHtml)) {
    throw new Error(
      "Dashboard smoke did not return the Keel application shell.",
    );
  }
  const assetPath = dashboardHtml.match(
    /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/,
  )?.[1];
  if (assetPath === undefined) {
    throw new Error(
      "Dashboard smoke could not identify the application asset.",
    );
  }
  const assetUrl = new URL(assetPath, baseUrl);
  if (assetUrl.origin !== baseUrl.origin) {
    throw new Error(
      "Dashboard smoke resolved an asset outside the preview origin.",
    );
  }
  const assetResponse = await request(fetchImplementation, assetUrl, {
    headers: authenticatedHeaders,
  });
  requireSuccessfulResponse(assetResponse, "Dashboard asset smoke");

  const resourceHeaders = accessHeaders(configuration);
  resourceHeaders.set(
    "X-Keel-Deployment-Smoke-Token",
    configuration.KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN,
  );
  await eventually(
    async () => {
      const resourceResponse = await request(
        fetchImplementation,
        new URL("/api/deployment-smoke", baseUrl),
        { method: "POST", headers: resourceHeaders },
      );
      const resourceSmoke = DeploymentSmokeResultSchema.parse(
        await parseJson(resourceResponse, "Resource smoke"),
      );
      if (
        resourceSmoke.deployedGitSha !== configuration.GITHUB_SHA ||
        resourceSmoke.workerVersionId !== configuration.KEEL_API_VERSION_ID ||
        resourceSmoke.workerVersionTag !== configuration.GITHUB_SHA
      ) {
        throw new DeploymentVersionMismatch(
          "Resource smoke reached a different API deployment.",
        );
      }
    },
    delay,
    {
      attempts: 3,
      shouldRetry: (error) => error instanceof DeploymentVersionMismatch,
    },
  );

  console.info(`Preview smokes passed for ${configuration.GITHUB_SHA}.`);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  await runPreviewDeploymentSmoke(process.env);
}
