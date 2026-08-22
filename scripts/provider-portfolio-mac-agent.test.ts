import { describe, expect, it } from "vitest";

import { parseProviderHoldingsTemplateCsv } from "../packages/connectors/src/index";
import { __providerPortfolioMacAgentTest } from "./provider-portfolio-mac-agent";

const {
  buildLaunchAgentPlist,
  formatUsdMinor,
  parseOptions,
  parseProviderDate,
  parseUsdMinor,
  rowsToCsv,
  tokenfolioTabCount,
} = __providerPortfolioMacAgentTest;

describe("provider portfolio Mac agent", () => {
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

  it("installs an isolated daily LaunchAgent for each provider", () => {
    const plist = buildLaunchAgentPlist({
      keelOrigin: new URL("https://keel.example.com"),
      logDirectory: "/Users/synthetic/Library/Logs/Keel",
      nodeExecutable: "/opt/node/bin/node",
      pnpmCli: "/opt/pnpm/pnpm.cjs",
      provider: "sydecar",
      repositoryRoot: "/Users/synthetic/keel-fi",
      scriptPath:
        "/Users/synthetic/keel-fi/scripts/provider-portfolio-mac-agent.ts",
    });
    expect(plist).toContain("com.keel.sydecar-agent");
    expect(plist).toContain("<string>sydecar</string>");
    expect(plist).toContain("<integer>86400</integer>");
    expect(plist).toContain("/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });
});
