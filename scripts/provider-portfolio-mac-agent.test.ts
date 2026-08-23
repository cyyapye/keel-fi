import { describe, expect, it, vi } from "vitest";

import { parseProviderHoldingsTemplateCsv } from "../packages/connectors/src/index";
import { __providerPortfolioMacAgentTest } from "./provider-portfolio-mac-agent";

const {
  buildLaunchAgentPlist,
  chromeProcessIdsForProfile,
  formatUsdMinor,
  manualSetupChromeArguments,
  openSydecarRow,
  parseOptions,
  parseProviderDate,
  parseUsdMinor,
  providerPaths,
  rowsToCsv,
  tokenfolioActiveHoldingStatus,
  tokenfolioTabCount,
} = __providerPortfolioMacAgentTest;

describe("provider portfolio Mac agent", () => {
  it.each([
    ["tokenfolio", "https://app.tokenfolio.co/portfolio?tab=active"],
    ["sydecar", "https://app.sydecar.io/investments"],
  ] as const)(
    "opens %s sign-in in normal Chrome before automation",
    (provider, portfolioUrl) => {
      const keelOrigin = new URL("https://keel.example.com");
      const arguments_ = manualSetupChromeArguments(provider, keelOrigin);

      expect(arguments_).toContain("--disable-background-mode");
      expect(arguments_).toContain(portfolioUrl);
      expect(arguments_).toContain("https://keel.example.com/holdings");
      expect(arguments_).toContain(
        `--user-data-dir=${providerPaths(provider, keelOrigin).profileDirectory}`,
      );
      expect(arguments_).not.toContain("--remote-debugging-address=127.0.0.1");
      expect(arguments_).not.toContain("--remote-debugging-port=0");
    },
  );

  it("stops only Chrome using the exact isolated provider profile", () => {
    const profile = "/Users/synthetic/Sydecar Agent/Instances/local/Chrome";
    const processList = [
      "100 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      `101 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${profile} --no-first-run`,
      `102 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper --user-data-dir=${profile}`,
      `103 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${profile}-copy`,
    ].join("\n");

    expect(chromeProcessIdsForProfile(processList, profile)).toEqual([101]);
  });

  it("parses CLI provider scope and rejects an unsupported provider", () => {
    expect(
      parseOptions([
        "setup",
        "--provider",
        "tokenfolio",
        "--keel-url",
        "https://keel.example.com",
      ]),
    ).toMatchObject({
      command: "setup",
      provider: "tokenfolio",
      keelOrigin: new URL("https://keel.example.com"),
    });
    expect(() =>
      parseOptions([
        "run",
        "--provider",
        "unknown",
        "--keel-url",
        "https://keel.example.com",
      ]),
    ).toThrow();
  });

  it("uses integer minor units for provider amounts", () => {
    expect(parseUsdMinor("US$ 12,345.67")).toBe(1_234_567n);
    expect(parseUsdMinor("$42")).toBe(4_200n);
    expect(formatUsdMinor(1_234_567n)).toBe("$12345.67");
    expect(() => parseUsdMinor("-$42.00")).toThrow("page_not_supported");
  });

  it("normalizes supported provider dates and holding counts", () => {
    expect(parseProviderDate("Aug 7, 2026")).toBe("2026-08-07");
    expect(parseProviderDate("August 21st, 2026")).toBe("2026-08-21");
    expect(tokenfolioTabCount("Active Holdings 124")).toBe(124);
    expect(() => tokenfolioTabCount("Active Holdings")).toThrow(
      "page_not_supported",
    );
    expect(() => tokenfolioTabCount("Other Holdings 124")).toThrow(
      "page_not_supported",
    );
  });

  it("accepts only known statuses inside Tokenfolio active holdings", () => {
    expect(tokenfolioActiveHoldingStatus("Active")).toBe(true);
    expect(tokenfolioActiveHoldingStatus("Funds Received")).toBe(true);
    expect(tokenfolioActiveHoldingStatus("Completed")).toBe(true);
    expect(tokenfolioActiveHoldingStatus("Exited")).toBe(false);
  });

  it("builds a parseable Tokenfolio capture without floating-point money", async () => {
    const bytes = rowsToCsv("tokenfolio", [
      {
        investment: "Synthetic Robotics",
        legalPosition: "Tokenfolio position in Synthetic Robotics",
        positionType: "SPV",
        heldThrough: "Synthetic Family LLC",
        status: "Live",
        investmentDate: "2025-06-10",
        asOfDate: "2026-08-21",
        investedMinor: 1_250_050n,
        committedMinor: 1_250_050n,
        currentValueMinor: 1_640_099n,
        realizedValueMinor: 0n,
        instrument: "Tokenfolio private position",
        identityKey:
          "synthetic robotics\u0000synthetic family llc\u00002025-06-10",
      },
    ]);
    const parsed = await parseProviderHoldingsTemplateCsv("tokenfolio", bytes);
    expect(parsed).toMatchObject({
      provider: "tokenfolio",
      effectiveDate: "2026-08-21",
      rows: [
        {
          companyOrFund: "Synthetic Robotics",
          investedMinor: 1_250_050,
          unrealizedValueMinor: 1_640_099,
          positionKind: "spv_interest",
        },
      ],
    });
  });

  it("keeps missing Sydecar valuations explicit", async () => {
    const bytes = rowsToCsv("sydecar", [
      {
        investment: "Synthetic Climate Fund",
        legalPosition: "Sydecar SPV in Synthetic Climate Fund",
        positionType: "SPV",
        heldThrough: "Synthetic Trust",
        status: "Live",
        investmentDate: "2024-02-01",
        asOfDate: "2026-08-21",
        investedMinor: 500_000n,
        committedMinor: 750_000n,
        currentValueMinor: null,
        realizedValueMinor: 0n,
        instrument: "Sydecar SPV interest",
        identityKey: "11111111-1111-4111-8111-111111111111",
      },
    ]);
    const parsed = await parseProviderHoldingsTemplateCsv("sydecar", bytes);
    expect(parsed.rows[0]).toMatchObject({
      unrealizedValueMinor: null,
      unrealizedValueState: "not_reported",
      netValueMinor: null,
      netValueState: "not_reported",
    });
  });

  it("opens animated Sydecar rows without waiting for visual stability", async () => {
    const click = vi.fn().mockResolvedValue(undefined);

    await openSydecarRow({ click } as never);

    expect(click).toHaveBeenCalledWith({ force: true, noWaitAfter: true });
  });

  it("installs an isolated daily LaunchAgent for each provider and origin", () => {
    const keelOrigin = new URL("https://keel.example.com");
    const plist = buildLaunchAgentPlist({
      keelOrigin,
      logDirectory: "/Users/synthetic/Library/Logs/Keel",
      nodeExecutable: "/opt/node/bin/node",
      pnpmCli: "/opt/pnpm/pnpm.cjs",
      provider: "sydecar",
      repositoryRoot: "/Users/synthetic/keel-fi",
      scriptPath:
        "/Users/synthetic/keel-fi/scripts/provider-portfolio-mac-agent.ts",
    });
    expect(plist).toContain(
      providerPaths("sydecar", keelOrigin).launchAgentLabel,
    );
    expect(plist).toContain("<string>sydecar</string>");
    expect(plist).toContain("<integer>86400</integer>");
    expect(plist).toContain("/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("keeps local and preview schedules and Chrome profiles separate", () => {
    const local = providerPaths("tokenfolio", new URL("http://127.0.0.1:5422"));
    const preview = providerPaths(
      "tokenfolio",
      new URL("https://keel-preview.example.com"),
    );

    expect(local.launchAgentLabel).not.toBe(preview.launchAgentLabel);
    expect(local.launchAgentPath).not.toBe(preview.launchAgentPath);
    expect(local.profileDirectory).not.toBe(preview.profileDirectory);
  });
});
