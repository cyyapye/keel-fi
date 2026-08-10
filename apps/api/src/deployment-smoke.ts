import { z } from "zod";

import type { Env } from "./types";

export const DeployedGitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "Expected a full lowercase Git SHA.");

export const DeploymentSmokeMessageSchema = z
  .object({
    type: z.literal("deployment_smoke"),
    gitSha: DeployedGitShaSchema,
    messageId: z.uuid(),
    requestedAt: z.iso.datetime(),
  })
  .strict();

const WorkerVersionMetadataSchema = z.object({
  id: z.string().min(1).max(128),
  tag: DeployedGitShaSchema,
  timestamp: z.string().min(1),
});

const encoder = new TextEncoder();
const smokeObjectBody = "keel-preview-deployment-smoke";

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
}

export async function deploymentSmokeTokenMatches(
  supplied: string | undefined,
  expected: string | undefined,
): Promise<boolean> {
  if (supplied === undefined || expected === undefined) {
    return false;
  }

  const [suppliedDigest, expectedDigest] = await Promise.all([
    digest(supplied),
    digest(expected),
  ]);
  let difference = suppliedDigest.byteLength ^ expectedDigest.byteLength;
  const comparedLength = Math.max(
    suppliedDigest.byteLength,
    expectedDigest.byteLength,
  );
  for (let index = 0; index < comparedLength; index += 1) {
    difference |= (suppliedDigest[index] ?? 0) ^ (expectedDigest[index] ?? 0);
  }
  return difference === 0;
}

export const DeploymentSmokeResultSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("keel-api"),
    deployedGitSha: DeployedGitShaSchema,
    workerVersionId: z.string().min(1).max(128),
    workerVersionTag: DeployedGitShaSchema,
    checks: z
      .object({
        d1: z.literal(true),
        queue: z.literal(true),
        r2: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type DeploymentSmokeResult = z.infer<typeof DeploymentSmokeResultSchema>;

export async function runDeploymentSmoke(
  env: Env,
): Promise<DeploymentSmokeResult> {
  const deployedGitSha = DeployedGitShaSchema.parse(env.DEPLOYED_GIT_SHA);
  const versionMetadata = WorkerVersionMetadataSchema.parse(
    env.CF_VERSION_METADATA,
  );
  if (versionMetadata.tag !== deployedGitSha) {
    throw new Error("API Worker version tag does not match its deployed SHA.");
  }

  const d1Result = await env.DB.prepare("SELECT 1 AS ok").first<{
    ok: number;
  }>();
  if (d1Result?.ok !== 1) {
    throw new Error("D1 deployment smoke failed.");
  }

  const objectKey = `deployment-smoke/${deployedGitSha}/${crypto.randomUUID()}`;
  try {
    await env.DOCUMENTS.put(objectKey, smokeObjectBody, {
      httpMetadata: { contentType: "text/plain" },
    });
    const storedObject = await env.DOCUMENTS.get(objectKey);
    if (
      storedObject === null ||
      (await storedObject.text()) !== smokeObjectBody
    ) {
      throw new Error("R2 deployment smoke failed.");
    }

    await env.INGESTION_QUEUE.send(
      DeploymentSmokeMessageSchema.parse({
        type: "deployment_smoke",
        gitSha: deployedGitSha,
        messageId: crypto.randomUUID(),
        requestedAt: new Date().toISOString(),
      }),
    );
  } finally {
    await env.DOCUMENTS.delete(objectKey);
  }

  if ((await env.DOCUMENTS.head(objectKey)) !== null) {
    throw new Error("R2 deployment smoke cleanup failed.");
  }

  return DeploymentSmokeResultSchema.parse({
    status: "ok",
    service: "keel-api",
    deployedGitSha,
    workerVersionId: versionMetadata.id,
    workerVersionTag: versionMetadata.tag,
    checks: {
      d1: true,
      queue: true,
      r2: true,
    },
  });
}
