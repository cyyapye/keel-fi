import { describe, expect, it, vi } from "vitest";

import { handleRequest, type WebWorkerBindings } from "./worker";

function bindings() {
  const apiFetch = vi.fn((request: Request) => {
    void request;
    return Promise.resolve(new Response("api"));
  });
  const assetsFetch = vi.fn((request: Request) => {
    void request;
    return Promise.resolve(new Response("assets"));
  });

  return {
    apiFetch,
    assetsFetch,
    value: {
      API: { fetch: apiFetch },
      ASSETS: { fetch: assetsFetch },
    } satisfies WebWorkerBindings,
  };
}

describe("web Worker routing", () => {
  it.each(["/api", "/api/alpha", "/health"])(
    "forwards %s to the private API service",
    async (pathname) => {
      const testBindings = bindings();
      const request = new Request(
        `https://keel-preview.example.com${pathname}`,
        {
          headers: { "Cf-Access-Jwt-Assertion": "synthetic-test-assertion" },
        },
      );

      const response = await handleRequest(request, testBindings.value);

      expect(await response.text()).toBe("api");
      expect(testBindings.apiFetch).toHaveBeenCalledWith(request);
      expect(testBindings.assetsFetch).not.toHaveBeenCalled();
      expect(
        (testBindings.apiFetch.mock.calls[0]?.[0] as Request).headers.get(
          "Cf-Access-Jwt-Assertion",
        ),
      ).toBe("synthetic-test-assertion");
    },
  );

  it("serves application routes from static assets", async () => {
    const testBindings = bindings();
    const request = new Request("https://keel-preview.example.com/holdings");

    const response = await handleRequest(request, testBindings.value);

    expect(await response.text()).toBe("assets");
    expect(testBindings.assetsFetch).toHaveBeenCalledWith(request);
    expect(testBindings.apiFetch).not.toHaveBeenCalled();
  });

  it("exposes only the Plaid endpoint on the dedicated webhook host", async () => {
    const testBindings = bindings();
    const webhookBindings = {
      ...testBindings.value,
      PLAID_WEBHOOK_HOST: "keel-preview-webhooks.example.com",
    };
    const webhook = new Request(
      "https://keel-preview-webhooks.example.com/webhooks/plaid",
      { method: "POST", body: "{}" },
    );

    const response = await handleRequest(webhook, webhookBindings);

    expect(await response.text()).toBe("api");
    expect(testBindings.apiFetch).toHaveBeenCalledWith(webhook);
    expect(
      await handleRequest(
        new Request("https://keel-preview-webhooks.example.com/"),
        webhookBindings,
      ),
    ).toMatchObject({ status: 404 });
    expect(
      await handleRequest(
        new Request("https://keel-preview.example.com/webhooks/plaid", {
          method: "POST",
          body: "{}",
        }),
        webhookBindings,
      ),
    ).toMatchObject({ status: 404 });
  });

  it("exposes only scoped POST routes on the Mac agent host", async () => {
    const testBindings = bindings();
    const agentBindings = {
      ...testBindings.value,
      MAC_AGENT_API_HOST: "keel-preview-agents.example.com",
    };
    const routes = [
      "/api/automation/angellist/mac-agent/lease",
      "/api/automation/angellist/mac-agent/run",
      "/api/automation/angellist/mac-agent/runs/11111111-1111-4111-8111-111111111111/complete",
      "/api/automation/provider-browser/angellist/mac-agent/lease",
      "/api/automation/provider-browser/tokenfolio/mac-agent/rotate",
      "/api/automation/provider-browser/sydecar/mac-agent/sessions/33333333-3333-4333-8333-333333333333/status",
      "/api/automation/provider-browser/angellist/mac-agent/sessions/44444444-4444-4444-8444-444444444444/ready",
      "/api/automation/provider-browser/tokenfolio/mac-agent/sessions/55555555-5555-4555-8555-555555555555/complete",
      "/api/automation/provider-browser/sydecar/mac-agent/sessions/66666666-6666-4666-8666-666666666666/fail",
      "/api/automation/provider-holdings/tokenfolio/mac-agent/lease",
      "/api/automation/provider-holdings/sydecar/mac-agent/runs/22222222-2222-4222-8222-222222222222/fail",
    ];

    for (const route of routes) {
      const response = await handleRequest(
        new Request(`https://keel-preview-agents.example.com${route}`, {
          method: "POST",
        }),
        agentBindings,
      );
      expect(await response.text()).toBe("api");
    }
    await expect(
      handleRequest(
        new Request(
          "https://keel-preview-agents.example.com/api/automation/angellist/status",
        ),
        agentBindings,
      ),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      handleRequest(
        new Request(
          "https://keel-preview-agents.example.com/api/automation/angellist/mac-agent/lease",
          { method: "GET" },
        ),
        agentBindings,
      ),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      handleRequest(
        new Request(
          "https://keel-preview-agents.example.com/api/automation/provider-holdings/tokenfolio/mac-agent/authorize",
          { method: "POST" },
        ),
        agentBindings,
      ),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      handleRequest(
        new Request(
          "https://keel-preview-agents.example.com/api/automation/provider-browser/angellist/mac-agent/sessions/not-a-session/ready",
          { method: "POST" },
        ),
        agentBindings,
      ),
    ).resolves.toMatchObject({ status: 404 });
  });

  it("identifies the exact web deployment on the health response", async () => {
    const testBindings = bindings();
    const request = new Request("https://keel-preview.example.com/health");

    const response = await handleRequest(request, {
      ...testBindings.value,
      CF_VERSION_METADATA: {
        id: "web-version-1",
        tag: "a".repeat(40),
      },
      DEPLOYED_GIT_SHA: "a".repeat(40),
    });

    expect(response.headers.get("X-Keel-Web-Git-Sha")).toBe("a".repeat(40));
    expect(response.headers.get("X-Keel-Web-Version-Id")).toBe("web-version-1");
    expect(response.headers.get("X-Keel-Web-Version-Tag")).toBe("a".repeat(40));
  });
});
