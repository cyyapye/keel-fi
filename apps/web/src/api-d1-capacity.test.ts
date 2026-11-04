import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHoldingsPage } from "./api";
import { requestKeel } from "./api-request";

afterEach(() => vi.unstubAllGlobals());
const body = {
  error:
    "Synthetic database allowance exhausted. Check for the record before trying again.",
  code: "d1_quota_exhausted",
  retryAt: "2026-09-02T00:00:00.000Z",
  outcome: "unknown",
};

describe("browser database quota failures", () => {
  it("retains validated reset metadata through the public projection client", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(Response.json(body, { status: 503 }));
    vi.stubGlobal("fetch", request);
    await expect(loadHoldingsPage()).rejects.toMatchObject({
      name: "D1ServiceUnavailableError",
      code: body.code,
      retryAt: body.retryAt,
      outcome: "unknown",
    });
    expect(request).toHaveBeenCalledOnce();
  });
  it("preserves an uncertain save response without automatic replay", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-01T18:45:00Z"));
      const retryAfterSeconds = 3_600;
      const request = vi.fn(() =>
        Promise.resolve(
          Response.json(body, {
            status: 503,
            headers: { "Retry-After": String(retryAfterSeconds) },
          }),
        ),
      );
      vi.stubGlobal("fetch", request);
      for (const path of ["/api/legal-entities", "/api/manual-holdings"]) {
        const result = await requestKeel(path, { method: "POST", body: "{}" });
        expect(await result.json()).toEqual(body);
      }
      expect(request).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(retryAfterSeconds * 1_000);
      expect(request).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(Date.parse(body.retryAt) - Date.now());
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not promote an invalid retry timestamp to a trusted quota pause", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...body, retryAt: "tomorrow" }, { status: 503 }),
      );
    vi.stubGlobal("fetch", request);
    await expect(loadHoldingsPage()).rejects.toMatchObject({ name: "Error" });
    expect(request).toHaveBeenCalledOnce();
  });
});
