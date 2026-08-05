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
});
