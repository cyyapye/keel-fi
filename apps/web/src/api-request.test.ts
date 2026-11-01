import { afterEach, describe, expect, it, vi } from "vitest";
import { requestKeel } from "./api-request";

afterEach(() => vi.unstubAllGlobals());

describe("Keel connection recovery", () => {
  it("explains how to recover a rejected Holdings read", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    await expect(requestKeel("/api/holdings-page", {})).rejects.toThrow(
      "reload the page to refresh your session",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not retry an ambiguous legal-entity save or claim it failed to persist", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      requestKeel("/api/legal-entities", { method: "POST", body: "{}" }),
    ).rejects.toThrow("check for the record before trying again");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("identifies a sign-in HTML response before parsing it as application data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Sign in</html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      ),
    );
    await expect(requestKeel("/api/holdings-page", {})).rejects.toThrow(
      "Your session needs to be refreshed",
    );
  });

  it("preserves cancellation and HTTP error responses", async () => {
    const aborted = new DOMException("Cancelled", "AbortError");
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(aborted)
      .mockResolvedValueOnce(
        new Response('{"error":"Holdings are unavailable."}', { status: 503 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(requestKeel("/api/holdings-page", {})).rejects.toBe(aborted);
    expect((await requestKeel("/api/holdings-page", {})).status).toBe(503);
  });
});
