import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  D1_EXPORT_MAX_POLLS,
  exportMaintenanceD1,
} from "./d1-maintenance-export";

const owned: string[] = [];
afterEach(async () => {
  await Promise.all(
    owned.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function input() {
  const directory = await mkdtemp(join(tmpdir(), "keel-export-test-"));
  owned.push(directory);
  return {
    account: "a".repeat(32),
    database: "10000000-0000-4000-8000-000000000001",
    token: "synthetic-token-only-12345",
    output: join(directory, "state.sql"),
    maxBytes: 100,
  };
}
const complete = (
  url = "https://synthetic.r2.cloudflarestorage.com/export?secret=synthetic-private",
) =>
  Response.json({
    success: true,
    result: { success: true, status: "complete", result: { signed_url: url } },
  });

describe("bounded private D1 export", () => {
  it("downloads a complete export privately without claiming unavailable billing counters", async () => {
    const config = await input();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(complete())
      .mockResolvedValueOnce(new Response("synthetic SQL"));
    const check = vi.fn();
    await expect(
      exportMaintenanceD1(config, { fetch: request, check }),
    ).resolves.toEqual({
      polls: 1,
      bytes: 13,
      actualBilledRows: "unavailable",
    });
    expect(await readFile(config.output, "utf8")).toBe("synthetic SQL");
    const download = request.mock.calls[1]!;
    expect(new Headers(download[1]?.headers).has("Authorization")).toBe(false);
    expect(download[1]?.redirect).toBe("error");
    expect(check).toHaveBeenCalledTimes(2);
  });
  it("bounds continuation polls and never starts a second export after a lost response", async () => {
    const config = await input();
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          success: true,
          result: { success: true, at_bookmark: "same-bookmark" },
        }),
      ),
    );
    const delay = vi.fn(() => Promise.resolve());
    await expect(
      exportMaintenanceD1(config, { fetch: request, delay }),
    ).rejects.toThrow("polling limit");
    expect(request).toHaveBeenCalledTimes(D1_EXPORT_MAX_POLLS);
    expect(delay).toHaveBeenCalledTimes(D1_EXPORT_MAX_POLLS - 1);
    for (const call of request.mock.calls.slice(1)) {
      const body = call[1]?.body;
      if (typeof body !== "string")
        throw new Error("Expected a JSON export request.");
      expect(JSON.parse(body).current_bookmark).toBe("same-bookmark");
    }
    const uncertain = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error("synthetic private URL")),
    );
    await expect(
      exportMaintenanceD1(await input(), { fetch: uncertain }),
    ).rejects.toThrow("outcome is unknown");
    expect(uncertain).toHaveBeenCalledTimes(1);
  });
  it("refuses changed bookmarks, oversized exports and unexpected download hosts", async () => {
    const changed = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          result: { success: true, at_bookmark: "one" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          result: { success: true, at_bookmark: "two" },
        }),
      );
    await expect(
      exportMaintenanceD1(await input(), {
        fetch: changed,
        delay: () => Promise.resolve(),
      }),
    ).rejects.toThrow("bookmark changed");
    const oversized = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(complete())
      .mockResolvedValueOnce(new Response("x".repeat(101)));
    await expect(
      exportMaintenanceD1(await input(), { fetch: oversized }),
    ).rejects.toThrow("size envelope");
    const wrongHost = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(complete("https://synthetic.invalid/private"));
    await expect(
      exportMaintenanceD1(await input(), { fetch: wrongHost }),
    ).rejects.toThrow("unexpected download host");
    expect(wrongHost).toHaveBeenCalledTimes(1);
  });
  it("redacts malformed responses and download transport errors", async () => {
    const secret = "https://synthetic.r2.cloudflarestorage.com/?secret=private";
    for (const request of [
      vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(secret)),
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(complete())
        .mockRejectedValueOnce(new Error(secret)),
    ]) {
      const error = await exportMaintenanceD1(await input(), {
        fetch: request,
      }).catch((value) => value as Error);
      if (!(error instanceof Error))
        throw new Error("Expected an export error.");
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain("secret=");
    }
  });
});
