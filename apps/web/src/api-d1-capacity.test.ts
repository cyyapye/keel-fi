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
    const request = vi
      .fn()
      .mockResolvedValue(Response.json(body, { status: 503 }));
    vi.stubGlobal("fetch", request);
    const result = await requestKeel("/api/legal-entities", {
      method: "POST",
      body: "{}",
    });
    expect(await result.json()).toEqual(body);
    expect(request).toHaveBeenCalledOnce();
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
