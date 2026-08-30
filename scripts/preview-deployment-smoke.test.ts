import { describe, expect, it, vi } from "vitest";

import { runPreviewDeploymentSmoke } from "./preview-deployment-smoke";

const gitSha = "c".repeat(40);

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function environment(): NodeJS.ProcessEnv {
  return {
    GITHUB_SHA: gitSha,
    KEEL_API_VERSION_ID: "api-version-1",
    KEEL_PREVIEW_ACCESS_CLIENT_ID: "synthetic-preview-service-token.access",
    KEEL_PREVIEW_ACCESS_CLIENT_SECRET:
      "synthetic-preview-service-secret-for-tests",
    KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN:
      "synthetic-preview-smoke-token-for-tests",
    KEEL_PREVIEW_URL: "https://keel-preview.example.com",
    KEEL_WEB_VERSION_ID: "web-version-1",
  };
}

function successfulFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const headers = new Headers(init?.headers);
    if (url.hostname === "keel-preview-webhooks.example.com") {
      return Promise.resolve(
        new Response(null, {
          status: url.pathname === "/webhooks/plaid" ? 401 : 404,
        }),
      );
    }
    if (url.hostname === "keel-preview-agents.example.com") {
      const agentPathnames = new Set([
        "/api/automation/angellist/mac-agent/lease",
        "/api/automation/provider-browser/angellist/mac-agent/lease",
      ]);
      return Promise.resolve(
        new Response(null, {
          status: agentPathnames.has(url.pathname) ? 401 : 404,
        }),
      );
    }
    const authenticated =
      headers.get("CF-Access-Client-Id") ===
        "synthetic-preview-service-token.access" &&
      headers.get("CF-Access-Client-Secret") ===
        "synthetic-preview-service-secret-for-tests";
    if (!authenticated) {
      return Promise.resolve(new Response(null, { status: 403 }));
    }
    if (url.pathname === "/health") {
      return Promise.resolve(
        Response.json(
          {
            status: "ok",
            service: "keel-api",
            deployedGitSha: gitSha,
            workerVersionId: "api-version-1",
            workerVersionTag: gitSha,
          },
          {
            headers: {
              "X-Keel-Web-Git-Sha": gitSha,
              "X-Keel-Web-Version-Id": "web-version-1",
              "X-Keel-Web-Version-Tag": gitSha,
            },
          },
        ),
      );
    }
    if (url.pathname === "/api/deployment-smoke") {
      return Promise.resolve(
        Response.json({
          status: "ok",
          service: "keel-api",
          deployedGitSha: gitSha,
          workerVersionId: "api-version-1",
          workerVersionTag: gitSha,
          checks: {
            alpha: true,
            d1: true,
            queue: true,
            r2: true,
          },
        }),
      );
    }
    if (url.pathname.startsWith("/assets/")) {
      return Promise.resolve(
        new Response("export {};", {
          headers: { "Content-Type": "text/javascript" },
        }),
      );
    }
    return Promise.resolve(
      new Response(
        '<!doctype html><div id="root"></div><script type="module" src="/assets/app.js"></script>',
        { headers: { "Content-Type": "text/html" } },
      ),
    );
  });
}

describe("preview deployment runtime verification", () => {
  it("checks Access, dashboard assets, resources, and both exact Worker versions", async () => {
    const fetchImplementation = successfulFetch();

    await expect(
      runPreviewDeploymentSmoke(environment(), fetchImplementation, () =>
        Promise.resolve(),
      ),
    ).resolves.toBeUndefined();

    expect(fetchImplementation).toHaveBeenCalledTimes(11);
  });

  it("waits for a new Mac agent hostname to resolve", async () => {
    const baseFetch = successfulFetch() as unknown as FetchImplementation;
    let agentRootAttempts = 0;
    const fetchImplementation = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (
          url.hostname === "keel-preview-agents.example.com" &&
          url.pathname === "/"
        ) {
          agentRootAttempts += 1;
          if (agentRootAttempts < 3) {
            return Promise.reject(new TypeError("fetch failed"));
          }
        }
        return baseFetch(input, init);
      },
    );
    const delay = vi.fn(() => Promise.resolve());

    await expect(
      runPreviewDeploymentSmoke(environment(), fetchImplementation, delay),
    ).resolves.toBeUndefined();

    expect(agentRootAttempts).toBe(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenNthCalledWith(1, 5_000);
    expect(delay).toHaveBeenNthCalledWith(2, 5_000);
  });

  it("fails when the public health route reports a different merged SHA", async () => {
    const baseFetch = successfulFetch() as unknown as FetchImplementation;
    const fetchImplementation = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (url.pathname === "/health") {
          return Promise.resolve(
            Response.json(
              {
                status: "ok",
                service: "keel-api",
                deployedGitSha: "d".repeat(40),
                workerVersionId: "api-version-1",
                workerVersionTag: "d".repeat(40),
              },
              {
                headers: {
                  "X-Keel-Web-Git-Sha": gitSha,
                  "X-Keel-Web-Version-Id": "web-version-1",
                  "X-Keel-Web-Version-Tag": gitSha,
                },
              },
            ),
          );
        }
        return baseFetch(input, init);
      },
    );

    await expect(
      runPreviewDeploymentSmoke(environment(), fetchImplementation, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow("different deployed version");
  });

  it("retries a resource version mismatch at most three times", async () => {
    const baseFetch = successfulFetch() as unknown as FetchImplementation;
    let resourceAttempts = 0;
    const fetchImplementation = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (url.pathname === "/api/deployment-smoke") {
          resourceAttempts += 1;
          if (resourceAttempts < 3) {
            return Promise.resolve(
              Response.json({
                status: "ok",
                service: "keel-api",
                deployedGitSha: gitSha,
                workerVersionId: "api-version-previous",
                workerVersionTag: gitSha,
                checks: {
                  alpha: true,
                  d1: true,
                  queue: true,
                  r2: true,
                },
              }),
            );
          }
        }
        return baseFetch(input, init);
      },
    );
    const delay = vi.fn(() => Promise.resolve());

    await expect(
      runPreviewDeploymentSmoke(environment(), fetchImplementation, delay),
    ).resolves.toBeUndefined();

    expect(resourceAttempts).toBe(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenNthCalledWith(1, 5_000);
    expect(delay).toHaveBeenNthCalledWith(2, 5_000);
  });

  it("stops after three resource version mismatches", async () => {
    const baseFetch = successfulFetch() as unknown as FetchImplementation;
    let resourceAttempts = 0;
    const fetchImplementation = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (url.pathname === "/api/deployment-smoke") {
          resourceAttempts += 1;
          return Promise.resolve(
            Response.json({
              status: "ok",
              service: "keel-api",
              deployedGitSha: gitSha,
              workerVersionId: "api-version-previous",
              workerVersionTag: gitSha,
              checks: {
                alpha: true,
                d1: true,
                queue: true,
                r2: true,
              },
            }),
          );
        }
        return baseFetch(input, init);
      },
    );
    const delay = vi.fn(() => Promise.resolve());

    await expect(
      runPreviewDeploymentSmoke(environment(), fetchImplementation, delay),
    ).rejects.toThrow("different API deployment");

    expect(resourceAttempts).toBe(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("does not retry resource HTTP or authentication failures", async () => {
    const baseFetch = successfulFetch() as unknown as FetchImplementation;
    let resourceAttempts = 0;
    const fetchImplementation = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (url.pathname === "/api/deployment-smoke") {
          resourceAttempts += 1;
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return baseFetch(input, init);
      },
    );
    const delay = vi.fn(() => Promise.resolve());

    await expect(
      runPreviewDeploymentSmoke(environment(), fetchImplementation, delay),
    ).rejects.toThrow("Resource smoke returned HTTP 503");

    expect(resourceAttempts).toBe(1);
    expect(delay).not.toHaveBeenCalled();
  });
});
