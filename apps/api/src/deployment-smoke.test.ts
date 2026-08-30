import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import {
  deploymentSmokeTokenMatches,
  DeploymentSmokeMessageSchema,
  runDeploymentSmoke,
} from "./deployment-smoke";
import { handlePortfolioWatchQueue } from "./portfolio-watch";
import type { Env } from "./types";

const deployedGitSha = "a".repeat(40);
const deploymentSmokeToken = "preview-smoke-token-with-at-least-32-characters";

function deploymentEnv(): {
  env: Env;
  alphaProjectionLoader: ReturnType<typeof vi.fn>;
  deleteObject: ReturnType<typeof vi.fn>;
  getObject: ReturnType<typeof vi.fn>;
  headObject: ReturnType<typeof vi.fn>;
  putObject: ReturnType<typeof vi.fn>;
  queueSend: ReturnType<typeof vi.fn>;
} {
  const first = vi.fn().mockResolvedValueOnce({ ok: 1 }).mockResolvedValueOnce({
    access_subject: "synthetic-access-subject",
  });
  const alphaProjectionLoader = vi.fn(() => Promise.resolve());
  const putObject = vi.fn(() => Promise.resolve({}));
  const getObject = vi.fn(() =>
    Promise.resolve({
      text: () => Promise.resolve("keel-preview-deployment-smoke"),
    }),
  );
  const deleteObject = vi.fn(() => Promise.resolve());
  const headObject = vi.fn(() => Promise.resolve(null));
  const queueSend = vi.fn(() => Promise.resolve());
  return {
    env: {
      ACCESS_AUD: "synthetic-access-audience",
      ACCESS_TEAM_DOMAIN: "access.example.com",
      CF_VERSION_METADATA: {
        id: "api-version-1",
        tag: deployedGitSha,
        timestamp: "2026-08-08T12:00:00.000Z",
      },
      DB: {
        prepare: vi.fn(() => ({ first })),
      } as unknown as D1Database,
      DEPLOYED_GIT_SHA: deployedGitSha,
      DEPLOYMENT_SMOKE_TOKEN: deploymentSmokeToken,
      DOCUMENTS: {
        delete: deleteObject,
        get: getObject,
        head: headObject,
        put: putObject,
      } as unknown as R2Bucket,
      ENVIRONMENT: "preview",
      INGESTION_QUEUE: { send: queueSend } as unknown as Queue,
    },
    alphaProjectionLoader,
    deleteObject,
    getObject,
    headObject,
    putObject,
    queueSend,
  };
}

describe("preview deployment smoke", () => {
  it("compares the dedicated smoke secret without accepting missing values", async () => {
    await expect(
      deploymentSmokeTokenMatches(deploymentSmokeToken, deploymentSmokeToken),
    ).resolves.toBe(true);
    await expect(
      deploymentSmokeTokenMatches("wrong", deploymentSmokeToken),
    ).resolves.toBe(false);
    await expect(
      deploymentSmokeTokenMatches(undefined, deploymentSmokeToken),
    ).resolves.toBe(false);
  });

  it("verifies D1, transient R2, Queue, and deployment metadata", async () => {
    const bindings = deploymentEnv();

    await expect(
      runDeploymentSmoke(bindings.env, bindings.alphaProjectionLoader),
    ).resolves.toEqual({
      status: "ok",
      service: "keel-api",
      deployedGitSha,
      workerVersionId: "api-version-1",
      workerVersionTag: deployedGitSha,
      checks: { alpha: true, d1: true, queue: true, r2: true },
    });
    expect(bindings.alphaProjectionLoader).toHaveBeenCalledWith(
      bindings.env,
      "synthetic-access-subject",
    );
    expect(bindings.putObject).toHaveBeenCalledTimes(1);
    expect(bindings.getObject).toHaveBeenCalledTimes(1);
    expect(bindings.deleteObject).toHaveBeenCalledTimes(1);
    expect(bindings.headObject).toHaveBeenCalledTimes(1);
    expect(bindings.queueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "deployment_smoke",
        gitSha: deployedGitSha,
      }),
    );
  });

  it("cleans up the R2 canary when Queue publication fails", async () => {
    const bindings = deploymentEnv();
    bindings.queueSend.mockRejectedValueOnce(new Error("Queue unavailable"));

    await expect(
      runDeploymentSmoke(bindings.env, bindings.alphaProjectionLoader),
    ).rejects.toThrow("Queue unavailable");
    expect(bindings.deleteObject).toHaveBeenCalledTimes(1);
  });

  it("fails before resource writes when the user projection is invalid", async () => {
    const bindings = deploymentEnv();
    bindings.alphaProjectionLoader.mockRejectedValueOnce(
      new Error("Invalid alpha projection"),
    );

    await expect(
      runDeploymentSmoke(bindings.env, bindings.alphaProjectionLoader),
    ).rejects.toThrow("Invalid alpha projection");
    expect(bindings.putObject).not.toHaveBeenCalled();
    expect(bindings.queueSend).not.toHaveBeenCalled();
  });

  it("exposes the resource check only in preview and behind both auth layers", async () => {
    const bindings = deploymentEnv();
    const app = createApp({
      deploymentSmokeAlphaLoader: bindings.alphaProjectionLoader,
      verifyAccess: vi.fn(() =>
        Promise.resolve({
          kind: "service" as const,
          subject: `${"a".repeat(32)}.access`,
          email: null,
        }),
      ),
    });

    const denied = await app.request(
      "/api/deployment-smoke",
      {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": "valid-access-token" },
      },
      bindings.env,
    );
    expect(denied.status).toBe(403);

    const passed = await app.request(
      "/api/deployment-smoke",
      {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": "valid-access-token",
          "X-Keel-Deployment-Smoke-Token": deploymentSmokeToken,
        },
      },
      bindings.env,
    );
    expect(passed.status).toBe(200);
    expect(passed.headers.get("Cache-Control")).toBe("no-store");

    bindings.env.ENVIRONMENT = "local";
    const outsidePreview = await app.request(
      "/api/deployment-smoke",
      { method: "POST" },
      bindings.env,
    );
    expect(outsidePreview.status).toBe(404);
  });

  it("acknowledges the bounded canary without invoking source ingestion", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const message = DeploymentSmokeMessageSchema.parse({
      type: "deployment_smoke",
      gitSha: deployedGitSha,
      messageId: "00000000-0000-4000-8000-000000000001",
      requestedAt: "2026-08-08T12:00:00.000Z",
    });
    const batch = {
      messages: [{ body: message, ack, retry }],
    } as unknown as MessageBatch<unknown>;

    await handlePortfolioWatchQueue(batch, deploymentEnv().env);

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });
});
