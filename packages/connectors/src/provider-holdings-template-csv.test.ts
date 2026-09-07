import { describe, expect, it } from "vitest";

import {
  MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_BYTES,
  PROVIDER_HOLDINGS_TEMPLATE_CSV_HEADERS,
  ProviderHoldingsTemplateCsvParseError,
  parseProviderHoldingsTemplateCsv,
  providerHoldingsTemplateCsv,
  providerHoldingsTemplateCsvHeaders,
  PROVIDER_HOLDINGS_CAPTURE_CSV_PREAMBLES,
} from "./provider-holdings-template-csv";

const encoder = new TextEncoder();

it.each(["sydecar", "tokenfolio"] as const)(
  "retains %s capture IDs without re-keying legacy accepted positions",
  async (provider) => {
    const row = provider === "sydecar" ? sydecarRow : tokenfolioRow;
    const old = await parseProviderHoldingsTemplateCsv(
      provider,
      documentBytes(provider, [row]),
    );
    const bytes = encoder.encode(
      `${PROVIDER_HOLDINGS_CAPTURE_CSV_PREAMBLES[provider]}\n${providerHoldingsTemplateCsvHeaders(provider, 3).join(",")}\n${row},synthetic-investment-123\n`,
    );
    const captured = await parseProviderHoldingsTemplateCsv(provider, bytes);
    expect(captured.formatVersion).toBe(3);
    expect(captured.rows[0]).toMatchObject({
      providerInvestmentId: "synthetic-investment-123",
      naturalKeySha256: old.rows[0]?.naturalKeySha256,
      investedMinor: old.rows[0]?.investedMinor,
    });
    await expect(
      parseProviderHoldingsTemplateCsv(
        provider,
        encoder.encode(
          new TextDecoder()
            .decode(bytes)
            .replace("synthetic-investment-123", ""),
        ),
      ),
    ).rejects.toThrow();
  },
);

function documentBytes(
  provider: "tokenfolio" | "sydecar",
  rows: readonly string[],
): Uint8Array {
  return encoder.encode(
    `${providerHoldingsTemplateCsv(provider)}${rows.join("\n")}\n`,
  );
}

const tokenfolioRow = [
  "Synthetic Robotics",
  "Synthetic Robotics direct shares",
  "Direct",
  "Synthetic Family Trust",
  "Live",
  "2024-03-15",
  "2026-08-20",
  "$1250.00",
  "",
  "$1800.25",
  "",
  "Common stock",
].join(",");

const sydecarRow = [
  "Example Climate Fund",
  "Example Climate Fund SPV I",
  "SPV",
  "Synthetic Investment Profile",
  "Live",
  "2025-02-01",
  "2026-08-20",
  "$5000.00",
  "$7500.00",
  "",
  "",
  "Membership interest",
  "2%",
  "20%",
].join(",");

describe("provider holdings template CSV", () => {
  it("generates a provider-specific blank template", () => {
    expect(providerHoldingsTemplateCsv("tokenfolio")).toBe(
      `Keel Tokenfolio holdings template v1\n${PROVIDER_HOLDINGS_TEMPLATE_CSV_HEADERS.join(",")}\n`,
    );
    expect(providerHoldingsTemplateCsv("sydecar")).toContain(
      "Keel Sydecar holdings template v2",
    );
    expect(providerHoldingsTemplateCsv("sydecar")).toContain(
      "Management Fee %,Carry %",
    );
  });

  it("parses Tokenfolio template rows without floating-point money", async () => {
    const result = await parseProviderHoldingsTemplateCsv(
      "tokenfolio",
      documentBytes("tokenfolio", [tokenfolioRow]),
    );

    expect(result.provider).toBe("tokenfolio");
    expect(result.effectiveDate).toBe("2026-08-20");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      companyOrFund: "Synthetic Robotics",
      fundName: "Synthetic Robotics direct shares",
      investmentEntity: "Synthetic Family Trust",
      investedMinor: 125_000,
      unrealizedValueMinor: 180_025,
      unrealizedValueState: "reported",
      netValueMinor: 180_025,
      netValueState: "reported",
      positionKind: "direct",
      dealMetadata: {
        allocationMinor: 125_000,
        instrument: "Common stock",
      },
    });
  });

  it("keeps unavailable Sydecar current values explicit", async () => {
    const result = await parseProviderHoldingsTemplateCsv(
      "sydecar",
      documentBytes("sydecar", [sydecarRow]),
    );

    expect(result.rows[0]).toMatchObject({
      investedMinor: 500_000,
      investDate: "2025-02-01",
      investDateState: "reported",
      unrealizedValueMinor: null,
      unrealizedValueState: "not_reported",
      netValueMinor: null,
      netValueState: "not_reported",
      positionKind: "spv_interest",
      dealMetadata: {
        allocationMinor: 750_000,
        managementFeePpm: 20_000,
        carryPpm: 200_000,
      },
    });
  });

  it("keeps legacy Sydecar v1 templates reviewable without inventing terms", async () => {
    const legacyRow = sydecarRow.split(",").slice(0, 12).join(",");
    const legacy = encoder.encode(
      `Keel Sydecar holdings template v1\n${PROVIDER_HOLDINGS_TEMPLATE_CSV_HEADERS.join(",")}\n${legacyRow}\n`,
    );

    const result = await parseProviderHoldingsTemplateCsv("sydecar", legacy);

    expect(result.formatVersion).toBe(1);
    expect(result.rows[0]?.dealMetadata).toMatchObject({
      managementFeePpm: null,
      carryPpm: null,
    });
  });

  it("keeps an unavailable Sydecar investment date explicit", async () => {
    const result = await parseProviderHoldingsTemplateCsv(
      "sydecar",
      documentBytes("sydecar", [sydecarRow.replace("2025-02-01", "")]),
    );

    expect(result.rows[0]).toMatchObject({
      investDate: null,
      investDateState: "not_reported",
    });
    await expect(
      parseProviderHoldingsTemplateCsv(
        "tokenfolio",
        documentBytes("tokenfolio", [tokenfolioRow.replace("2024-03-15", "")]),
      ),
    ).rejects.toThrow("must use YYYY-MM-DD dates");
  });

  it("rejects a commitment below funded capital", async () => {
    await expect(
      parseProviderHoldingsTemplateCsv(
        "sydecar",
        documentBytes("sydecar", [sydecarRow.replace("$7500.00", "$1000.00")]),
      ),
    ).rejects.toThrow("committed amount below its funded amount");
  });

  it("rejects unsupported Sydecar fee or carry rates", async () => {
    await expect(
      parseProviderHoldingsTemplateCsv(
        "sydecar",
        documentBytes("sydecar", [sydecarRow.replace("2%", "2x")]),
      ),
    ).rejects.toThrow("invalid Management Fee % value");
    await expect(
      parseProviderHoldingsTemplateCsv(
        "sydecar",
        documentBytes("sydecar", [sydecarRow.replace("20%", "101%")]),
      ),
    ).rejects.toThrow("percentage from 0% through 100%");
  });

  it("rejects the wrong provider template and changed headers", async () => {
    await expect(
      parseProviderHoldingsTemplateCsv(
        "sydecar",
        documentBytes("tokenfolio", [tokenfolioRow]),
      ),
    ).rejects.toMatchObject({ code: "invalid_preamble" });

    const wrongHeader = encoder.encode(
      `Keel Tokenfolio holdings template v1\nInvestment,Value\n${tokenfolioRow}\n`,
    );
    await expect(
      parseProviderHoldingsTemplateCsv("tokenfolio", wrongHeader),
    ).rejects.toMatchObject({ code: "invalid_header" });
  });

  it("rejects mixed snapshot dates and formula-like cells", async () => {
    const secondDate = tokenfolioRow.replace("2026-08-20", "2026-08-19");
    await expect(
      parseProviderHoldingsTemplateCsv(
        "tokenfolio",
        documentBytes("tokenfolio", [tokenfolioRow, secondDate]),
      ),
    ).rejects.toThrow("one shared As Of Date");

    const formula = tokenfolioRow.replace("Synthetic Robotics", "=SUM(A1:A2)");
    await expect(
      parseProviderHoldingsTemplateCsv(
        "tokenfolio",
        documentBytes("tokenfolio", [formula]),
      ),
    ).rejects.toMatchObject({ code: "unsafe_cell" });
  });

  it("rejects invalid UTF-8 and oversized files", async () => {
    await expect(
      parseProviderHoldingsTemplateCsv(
        "tokenfolio",
        Uint8Array.from([0xc3, 0x28]),
      ),
    ).rejects.toBeInstanceOf(ProviderHoldingsTemplateCsvParseError);
    await expect(
      parseProviderHoldingsTemplateCsv(
        "sydecar",
        new Uint8Array(MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_BYTES + 1),
      ),
    ).rejects.toMatchObject({ code: "file_too_large" });
  });
});
