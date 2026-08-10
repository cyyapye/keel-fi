import { describe, expect, it } from "vitest";

import { MAX_ANGELLIST_CSV_BYTES } from "../packages/connectors/src/index";
import { __angellistMacAgentTest } from "./angellist-mac-agent";

describe("AngelList Mac agent boundaries", () => {
  it("accepts only an explicit Keel HTTP(S) origin", () => {
    const options = __angellistMacAgentTest.parseOptions([
      "setup",
      "--keel-url",
      "https://keel-preview.example.com",
    ]);
    expect(options.command).toBe("setup");
    expect(options.keelOrigin.origin).toBe("https://keel-preview.example.com");

    expect(() =>
      __angellistMacAgentTest.parseOptions([
        "serve",
        "--keel-url",
        "https://keel-preview.example.com/holdings",
      ]),
    ).toThrow();
    expect(() =>
      __angellistMacAgentTest.parseOptions([
        "serve",
        "--keel-url",
        "ftp://keel-preview.example.com",
      ]),
    ).toThrow();
    expect(() =>
      __angellistMacAgentTest.parseOptions([
        "unknown",
        "--keel-url",
        "https://keel-preview.example.com",
      ]),
    ).toThrow();
  });

  it("rejects unsafe or non-CSV download names", () => {
    expect(
      __angellistMacAgentTest.validateFilename("investments_2026_08_09.csv"),
    ).toBe("investments_2026_08_09.csv");
    expect(() =>
      __angellistMacAgentTest.validateFilename("../investments.csv"),
    ).toThrow("download_failed");
    expect(() =>
      __angellistMacAgentTest.validateFilename("investments\n.csv"),
    ).toThrow("download_failed");
    expect(() =>
      __angellistMacAgentTest.validateFilename("investments.pdf"),
    ).toThrow("download_failed");
  });

  it("bounds downloaded bytes before any upload", async () => {
    await expect(
      __angellistMacAgentTest.readDownload({
        failure: () => Promise.resolve(null),
        createReadStream: () =>
          Promise.resolve(
            (async function* () {
              await Promise.resolve();
              yield "synthetic";
              yield new Uint8Array([1, 2, 3]);
            })(),
          ),
      }),
    ).resolves.toHaveLength(12);

    await expect(
      __angellistMacAgentTest.readDownload({
        failure: () => Promise.resolve(null),
        createReadStream: () =>
          Promise.resolve(
            (async function* () {
              await Promise.resolve();
              yield new Uint8Array(MAX_ANGELLIST_CSV_BYTES + 1);
            })(),
          ),
      }),
    ).rejects.toThrow("download_failed");
    await expect(
      __angellistMacAgentTest.readDownload({
        failure: () => Promise.resolve("cancelled"),
        createReadStream: () => Promise.resolve(null),
      }),
    ).rejects.toThrow("download_failed");
  });
});
