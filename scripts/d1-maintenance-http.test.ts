import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportMaintenanceD1 } from "./d1-maintenance-export";
import { readMaintenanceFrontier } from "./d1-maintenance";
import { readMaintenanceJson } from "./d1-maintenance-http";

const owned: string[] = [];
afterEach(async () => {
  await Promise.all(
    owned.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function oversized(headers?: HeadersInit) {
  let produced = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (produced === 2 * 1024 ** 2) return controller.close();
        const chunk = new Uint8Array(16 * 1024).fill(32);
        produced += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    response: new Response(body, headers === undefined ? {} : { headers }),
    evidence: () => ({ produced, cancelled }),
  };
}

describe("bounded maintenance HTTP metadata", () => {
  it("maintenance-http-chunked-byte-cap cancels after the first overflowing chunk", async () => {
    const stream = oversized();
    await expect(readMaintenanceJson(stream.response)).rejects.toThrow(
      "envelope",
    );
    expect(stream.evidence()).toEqual({ produced: 80 * 1024, cancelled: true });
  });

  it.each(["65537", "2097152", "-1", "1.5", "unknown", "9007199254740993"])(
    "maintenance-http-declared-length-%s cancels before reading body bytes",
    async (length) => {
      const stream = oversized({ "Content-Length": length });
      await expect(readMaintenanceJson(stream.response)).rejects.toThrow(
        "envelope",
      );
      expect(stream.evidence()).toEqual({ produced: 0, cancelled: true });
    },
  );

  it("maintenance-http-utf8-cap counts bytes and accepts a valid exact-limit payload", async () => {
    await expect(
      readMaintenanceJson(
        new Response(JSON.stringify({ text: "é".repeat(40_000) })),
      ),
    ).rejects.toThrow("envelope");
    const exact = JSON.stringify({ synthetic: "é" }).padEnd(65535, " ");
    expect(new TextEncoder().encode(exact).byteLength).toBe(65536);
    await expect(
      readMaintenanceJson(
        new Response(exact, { headers: { "Content-Length": "65536" } }),
      ),
    ).resolves.toEqual({ synthetic: "é" });
  });

  it("maintenance-http-private-errors redacts malformed JSON and stream failure", async () => {
    const secret =
      "https://synthetic.r2.cloudflarestorage.com/?secret=synthetic-private";
    const responses = [
      new Response(secret),
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(secret));
          },
        }),
      ),
      new Response(new Uint8Array([0xff])),
    ];
    for (const response of responses) {
      const error = await readMaintenanceJson(response).catch(
        (value: unknown) => value,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("secret=");
    }
  });

  it.each(["export", "frontier"] as const)(
    "maintenance-http-%s-integration stops oversized metadata before buffering the full response",
    async (boundary) => {
      const directory = await mkdtemp(
        join(tmpdir(), "keel-maintenance-http-test-"),
      );
      owned.push(directory);
      const stream = oversized();
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValue(stream.response);
      const input = {
        account: "a".repeat(32),
        database: "10000000-0000-4000-8000-000000000001",
        token: "synthetic-token-only-12345",
        output: join(directory, "state.sql"),
        maxBytes: 100,
      };
      await expect(
        boundary === "export"
          ? exportMaintenanceD1(input, { fetch: fetchImplementation })
          : readMaintenanceFrontier(
              input,
              { CLOUDFLARE_API_TOKEN: input.token },
              fetchImplementation,
            ),
      ).rejects.toThrow("envelope");
      expect(stream.evidence()).toEqual({
        produced: 80 * 1024,
        cancelled: true,
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    },
  );

  it("maintenance-http-frontier-success preserves validated migration names", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: true,
        result: [{ success: true, results: [{ name: "0001_synthetic.sql" }] }],
      }),
    );
    await expect(
      readMaintenanceFrontier(
        {
          account: "a".repeat(32),
          database: "10000000-0000-4000-8000-000000000001",
        },
        { CLOUDFLARE_API_TOKEN: "synthetic-token-only-12345" },
        fetchImplementation,
      ),
    ).resolves.toEqual(["0001_synthetic.sql"]);
  });
});
