import { describe, expect, it, vi } from "vitest";

import { MAX_ANGELLIST_CSV_BYTES } from "../packages/connectors/src/index";
import { __angellistMacAgentTest } from "./angellist-mac-agent";

describe("AngelList Mac agent boundaries", () => {
  it("does not override download behavior when attaching to existing Chrome", async () => {
    const context = {};
    const connectOverCDP = vi.fn().mockResolvedValue({
      contexts: () => [context],
    });

    await expect(
      __angellistMacAgentTest.connectContext(
        new URL("https://keel-preview.example.com"),
        () => Promise.resolve(50_576),
        connectOverCDP,
      ),
    ).resolves.toBe(context);
    expect(connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:50576", {
      noDefaults: true,
    });
  });

  it("accepts an account-scoped portfolio dashboard without retaining URL extras", () => {
    expect(
      __angellistMacAgentTest.parseAngelListPortfolioUrl(
        "https://venture.angellist.com/v/synthetic-venture/i/synthetic-investor/portfolio/dashboard?source=test#holdings",
      ).href,
    ).toBe(
      "https://venture.angellist.com/v/synthetic-venture/i/synthetic-investor/portfolio/dashboard",
    );
    expect(() =>
      __angellistMacAgentTest.parseAngelListPortfolioUrl(
        "https://example.com/v/synthetic-venture/i/synthetic-investor/portfolio/dashboard",
      ),
    ).toThrow();
    expect(() =>
      __angellistMacAgentTest.parseAngelListPortfolioUrl(
        "https://venture.angellist.com/v/synthetic-venture/i/synthetic-investor/settings",
      ),
    ).toThrow();
  });

  it("preserves the signed-in dashboard during setup", async () => {
    const goto = vi.fn();
    const page = {
      goto,
      url: () =>
        "https://venture.angellist.com/v/synthetic-venture/i/synthetic-investor/portfolio/dashboard",
    };
    const context = {
      newPage: vi.fn(),
      pages: () => [page],
    } as unknown as Parameters<typeof __angellistMacAgentTest.angelListPage>[0];

    await expect(__angellistMacAgentTest.angelListPage(context)).resolves.toBe(
      page,
    );
    expect(goto).not.toHaveBeenCalled();
  });

  it("returns to the locally captured dashboard for a daily run", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = {
      goto,
      url: () => "https://venture.angellist.com/",
    };
    const context = {
      newPage: vi.fn(),
      pages: () => [page],
    } as unknown as Parameters<typeof __angellistMacAgentTest.angelListPage>[0];
    const portfolioUrl = new URL(
      "https://venture.angellist.com/v/synthetic-venture/i/synthetic-investor/portfolio/dashboard",
    );

    await expect(
      __angellistMacAgentTest.angelListPage(context, portfolioUrl),
    ).resolves.toBe(page);
    expect(goto).toHaveBeenCalledWith(portfolioUrl.href, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
  });

  it("enables browser-level downloads without a browser context id", async () => {
    const send = vi.fn().mockResolvedValue({});
    const session = {
      send,
    } as unknown as Parameters<
      typeof __angellistMacAgentTest.configureDownloads
    >[0];

    await __angellistMacAgentTest.configureDownloads(
      session,
      "/tmp/keel-synthetic-downloads",
    );

    expect(send).toHaveBeenCalledWith("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: "/tmp/keel-synthetic-downloads",
      eventsEnabled: true,
    });
    expect(send.mock.calls[0]?.[1]).not.toHaveProperty("browserContextId");
  });

  it("restores Chrome's default download behavior after a run", async () => {
    const send = vi.fn().mockResolvedValue({});
    const session = {
      send,
    } as unknown as Parameters<
      typeof __angellistMacAgentTest.resetDownloads
    >[0];

    await __angellistMacAgentTest.resetDownloads(session);

    expect(send).toHaveBeenCalledWith("Browser.setDownloadBehavior", {
      behavior: "default",
      eventsEnabled: false,
    });
  });

  it("captures a completed browser-level download and removes its listeners", async () => {
    type Listener = (event: unknown) => void;
    const listeners = new Map<string, Set<Listener>>();
    const on = vi.fn((event: string, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    });
    const off = vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    });
    const session = { off, on } as unknown as Parameters<
      typeof __angellistMacAgentTest.captureNextDownload
    >[0];
    const capture = __angellistMacAgentTest.captureNextDownload(session, 1_000);
    const guid = "00000000-0000-4000-8000-000000000001";

    listeners.get("Browser.downloadWillBegin")?.forEach((listener) =>
      listener({
        guid,
        suggestedFilename: "keel-synthetic.csv",
      }),
    );
    listeners
      .get("Browser.downloadProgress")
      ?.forEach((listener) => listener({ guid, state: "completed" }));

    await expect(capture.result).resolves.toEqual({
      guid,
      suggestedFilename: "keel-synthetic.csv",
    });
    expect(off).toHaveBeenCalledTimes(2);
  });

  it("makes the setup Node binary available to pnpm under launchd", () => {
    const keelOrigin = new URL("https://keel-preview.example.com");
    const plist = __angellistMacAgentTest.buildLaunchAgentPlist({
      keelOrigin,
      logDirectory: "/Users/synthetic/Library/Logs/Keel",
      nodeExecutable: "/opt/keel-node/bin/node",
      pnpmCli: "/opt/keel-pnpm/bin/pnpm.mjs",
      repositoryRoot: "/Users/synthetic/keel-fi",
      scriptPath: "/Users/synthetic/keel-fi/scripts/angellist-mac-agent.ts",
    });

    expect(plist).toContain("<key>EnvironmentVariables</key>");
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).toContain(
      "<string>/opt/keel-node/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>",
    );
    expect(plist).toContain("<string>/opt/keel-node/bin/node</string>");
    expect(plist).toContain(
      `<string>${__angellistMacAgentTest.agentPaths(keelOrigin).launchAgentLabel}</string>`,
    );
    expect(plist).toContain("<string>once</string>");
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>86400</integer>");
    expect(plist).not.toContain("<key>KeepAlive</key>");
    expect(plist).not.toContain("<string>serve</string>");
  });

  it("isolates its scheduled job and Chrome profile by Keel origin", () => {
    const local = __angellistMacAgentTest.agentPaths(
      new URL("http://127.0.0.1:5422"),
    );
    const preview = __angellistMacAgentTest.agentPaths(
      new URL("https://keel-preview.example.com"),
    );

    expect(local.launchAgentLabel).not.toBe(preview.launchAgentLabel);
    expect(local.launchAgentPath).not.toBe(preview.launchAgentPath);
    expect(local.profileDirectory).not.toBe(preview.profileDirectory);
    expect(local.configPath).not.toBe(preview.configPath);
  });

  it("accepts only an explicit Keel HTTP(S) origin", () => {
    const options = __angellistMacAgentTest.parseOptions([
      "setup",
      "--keel-url",
      "https://keel-preview.example.com",
    ]);
    expect(options.command).toBe("setup");
    expect(options.keelOrigin.origin).toBe("https://keel-preview.example.com");

    expect(
      __angellistMacAgentTest.parseOptions([
        "run",
        "--keel-url",
        "https://keel-preview.example.com",
      ]).command,
    ).toBe("run");

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
