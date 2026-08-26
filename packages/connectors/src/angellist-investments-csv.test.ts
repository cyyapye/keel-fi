import { describe, expect, it } from "vitest";

import {
  ANGELLIST_INVESTMENTS_CSV_HEADERS,
  ANGELLIST_INVESTMENTS_CSV_PREAMBLE,
  AngelListCsvParseError,
  MAX_ANGELLIST_CSV_BYTES,
  MAX_ANGELLIST_CSV_ROWS,
  parseAngelListInvestmentsCsv,
  parseUsdMinorUnits,
  parseUsDateToIso,
} from "./angellist-investments-csv";

type Header = (typeof ANGELLIST_INVESTMENTS_CSV_HEADERS)[number];

const syntheticUnlockedRow: Record<Header, string> = {
  "Company/Fund": "Synthetic Comet Works, Inc.",
  Status: "Live",
  "Invest Date": "2/29/2024",
  Invested: "$1,234.56",
  "Unrealized Value": "$1,500.00",
  "Realized Value": "$234.56",
  "Net Value": "$1,734.56",
  Multiple: "1.405002592016588906168999481597",
  "Investment Entity": "Synthetic Cedar Holdings LLC",
  Lead: "Synthetic Northstar Lead",
  "Investment Type": "Syndicate",
  Source: "Synthetic referral",
  Round: "Seed",
  Market: "Robotics",
  "Fund Name": "Synthetic Comet 2024 SPV",
  Allocation: "$2,000.00",
  Instrument: "safe",
  "Round Size": "$4,000,000.00",
  "Valuation or Cap Type": "Post-money",
  "Valuation or Cap": "$12,000,000.00",
  Discount: "20%",
  Carry: "15%",
  "Share Class": "Preferred",
};

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvRecord(values: readonly string[]): string {
  return values.map(csvCell).join(",");
}

function rowValues(overrides: Partial<Record<Header, string>> = {}): string[] {
  const row = { ...syntheticUnlockedRow, ...overrides };
  return ANGELLIST_INVESTMENTS_CSV_HEADERS.map((header) => row[header]);
}

function documentBytes(
  rows: readonly (readonly string[])[],
  options: { readonly lineEnding?: "\n" | "\r\n"; readonly bom?: boolean } = {},
): Uint8Array {
  const lineEnding = options.lineEnding ?? "\n";
  const document = [
    csvRecord([ANGELLIST_INVESTMENTS_CSV_PREAMBLE]),
    csvRecord(ANGELLIST_INVESTMENTS_CSV_HEADERS),
    ...rows.map(csvRecord),
  ].join(lineEnding);
  return new TextEncoder().encode(
    `${options.bom === true ? "\uFEFF" : ""}${document}`,
  );
}

describe("AngelList investments CSV parsing", () => {
  it("parses the exact export shape without floating-point money arithmetic", async () => {
    const result = await parseAngelListInvestmentsCsv(
      documentBytes([rowValues()], { lineEnding: "\r\n", bom: true }),
    );

    expect(result).toEqual({
      provider: "angellist",
      formatVersion: 1,
      rows: [
        expect.objectContaining({
          rowNumber: 3,
          naturalKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          companyOrFund: "Synthetic Comet Works, Inc.",
          status: "Live",
          investDate: "2024-02-29",
          investedMinor: 123_456,
          unrealizedValueMinor: 150_000,
          unrealizedValueState: "reported",
          realizedValueMinor: 23_456,
          netValueMinor: 173_456,
          netValueState: "reported",
          multiplePpm: 1_405_003,
          investmentEntity: "Synthetic Cedar Holdings LLC",
          fundName: "Synthetic Comet 2024 SPV",
          dealMetadata: {
            allocationMinor: 200_000,
            instrument: "safe",
            roundSizeMinor: 400_000_000,
            valuationOrCapType: "Post-money",
            valuationOrCapMinor: 1_200_000_000,
            discount: "20%",
            carry: "15%",
            managementFeePpm: null,
            carryPpm: 150_000,
            shareClass: "Preferred",
          },
        }),
      ],
    });
  });

  it("normalizes only exact reported carry percentages", async () => {
    const blank = await parseAngelListInvestmentsCsv(
      documentBytes([rowValues({ Carry: "" })]),
    );
    expect(blank.rows[0]?.dealMetadata).toMatchObject({
      carry: null,
      managementFeePpm: null,
      carryPpm: null,
    });

    for (const carry of ["15", "100.0001%", "101%", "1.00001%"] as const) {
      await expect(
        parseAngelListInvestmentsCsv(
          documentBytes([rowValues({ Carry: carry })]),
        ),
      ).rejects.toThrow("invalid Carry value");
    }
  });

  it("maps locked values to explicit states and requires a blank multiple", async () => {
    const result = await parseAngelListInvestmentsCsv(
      documentBytes([
        rowValues({
          "Unrealized Value": "Locked",
          "Realized Value": "$0.00",
          "Net Value": "Locked",
          Multiple: "",
        }),
      ]),
    );

    expect(result.rows[0]).toMatchObject({
      unrealizedValueMinor: null,
      unrealizedValueState: "locked",
      realizedValueMinor: 0,
      netValueMinor: null,
      netValueState: "locked",
      multiplePpm: null,
    });

    await expect(
      parseAngelListInvestmentsCsv(
        documentBytes([
          rowValues({
            "Unrealized Value": "Locked",
            "Net Value": "Locked",
            Multiple: "1.00",
          }),
        ]),
      ),
    ).rejects.toThrow("must have a blank Multiple");
  });

  it("validates a long provider multiple as an exact rational and rounds only its PPM representation", async () => {
    const result = await parseAngelListInvestmentsCsv(
      documentBytes([
        rowValues({
          Invested: "$5,242.88",
          "Unrealized Value": "$5,242.89",
          "Realized Value": "$0.00",
          "Net Value": "$5,242.89",
          Multiple: "1.0000019073486328125",
        }),
        rowValues({
          Invested: "$5,242.88",
          "Unrealized Value": "$5,242.89",
          "Realized Value": "$0.00",
          "Net Value": "$5,242.89",
          Multiple: "1.0000019073486335000",
        }),
      ]),
    );

    expect(result.rows[0]?.multiplePpm).toBe(1_000_002);
    expect(result.rows[1]?.multiplePpm).toBe(1_000_002);
  });

  it("handles escaped quotes, commas, and embedded newlines in quoted cells", async () => {
    const result = await parseAngelListInvestmentsCsv(
      documentBytes([
        rowValues({
          "Company/Fund": 'Synthetic "Aurora", Labs',
          Lead: "Synthetic Lead\nTeam",
        }),
        rowValues({
          "Company/Fund": "Synthetic Second Works",
          "Fund Name": "Synthetic Second SPV",
        }),
      ]),
    );

    expect(result.rows[0]).toMatchObject({
      rowNumber: 3,
      companyOrFund: 'Synthetic "Aurora", Labs',
      lead: "Synthetic Lead\nTeam",
    });
    expect(result.rows[1]?.rowNumber).toBe(5);
  });

  it("derives a stable normalized natural key only from the identity fields", async () => {
    const result = await parseAngelListInvestmentsCsv(
      documentBytes([
        rowValues(),
        rowValues({
          "Company/Fund": "  SYNTHETIC COMET WORKS, INC.  ",
          "Fund Name": "Synthetic Comet ２０２４  SPV",
          Invested: "$2,469.12",
          "Unrealized Value": "$3,000.00",
          "Realized Value": "$469.12",
          "Net Value": "$3,469.12",
        }),
        rowValues({ "Fund Name": "Synthetic Comet Follow-on SPV" }),
      ]),
    );

    expect(result.rows[0]?.naturalKeySha256).toBe(
      result.rows[1]?.naturalKeySha256,
    );
    expect(result.rows[2]?.naturalKeySha256).not.toBe(
      result.rows[0]?.naturalKeySha256,
    );
  });

  it("rejects a changed header or confidentiality preamble", async () => {
    const wrongHeader: string[] = [...ANGELLIST_INVESTMENTS_CSV_HEADERS];
    wrongHeader[0] = "Company";
    const wrongHeaderBytes = new TextEncoder().encode(
      [
        ANGELLIST_INVESTMENTS_CSV_PREAMBLE,
        csvRecord(wrongHeader),
        csvRecord(rowValues()),
      ].join("\n"),
    );
    const wrongPreambleBytes = new TextEncoder().encode(
      [
        "Confidential synthetic export",
        csvRecord(ANGELLIST_INVESTMENTS_CSV_HEADERS),
        csvRecord(rowValues()),
      ].join("\n"),
    );

    await expect(
      parseAngelListInvestmentsCsv(wrongHeaderBytes),
    ).rejects.toMatchObject({
      code: "invalid_header",
    });
    await expect(
      parseAngelListInvestmentsCsv(wrongPreambleBytes),
    ).rejects.toMatchObject({ code: "invalid_preamble" });

    await expect(
      parseAngelListInvestmentsCsv(documentBytes([])),
    ).rejects.toMatchObject({ code: "invalid_row" });
  });

  it("rejects malformed CSV, row widths, NUL, invalid UTF-8, and oversized files", async () => {
    const shortRow = rowValues().slice(0, -1);
    await expect(
      parseAngelListInvestmentsCsv(documentBytes([shortRow])),
    ).rejects.toMatchObject({ code: "invalid_row_width" });

    const malformed = new TextEncoder().encode(
      `${ANGELLIST_INVESTMENTS_CSV_PREAMBLE}\n${csvRecord(
        ANGELLIST_INVESTMENTS_CSV_HEADERS,
      )}\n"unterminated`,
    );
    await expect(parseAngelListInvestmentsCsv(malformed)).rejects.toMatchObject(
      {
        code: "invalid_csv",
      },
    );

    const nul = documentBytes([rowValues({ Lead: "Synthetic\0Lead" })]);
    await expect(parseAngelListInvestmentsCsv(nul)).rejects.toMatchObject({
      code: "invalid_utf8",
    });
    await expect(
      parseAngelListInvestmentsCsv(Uint8Array.from([0xc3, 0x28])),
    ).rejects.toMatchObject({ code: "invalid_utf8" });
    await expect(
      parseAngelListInvestmentsCsv(new Uint8Array(MAX_ANGELLIST_CSV_BYTES + 1)),
    ).rejects.toMatchObject({ code: "file_too_large" });

    await expect(
      parseAngelListInvestmentsCsv(
        documentBytes(
          Array.from({ length: MAX_ANGELLIST_CSV_ROWS + 1 }, () => rowValues()),
        ),
      ),
    ).rejects.toMatchObject({ code: "too_many_rows" });

    await expect(
      parseAngelListInvestmentsCsv(
        documentBytes([rowValues({ Lead: "🧪".repeat(1_025) })]),
      ),
    ).rejects.toMatchObject({ code: "invalid_csv" });
  });

  it("rejects formula-like cells without echoing their contents", async () => {
    const privateMarker = "=PRIVATE_SYNTHETIC_MARKER()";
    let thrown: unknown;
    try {
      await parseAngelListInvestmentsCsv(
        documentBytes([rowValues({ Lead: privateMarker })]),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AngelListCsvParseError);
    expect((thrown as Error).message).not.toContain(privateMarker);
    expect(thrown).toMatchObject({ code: "unsafe_cell" });
  });

  it("rejects inconsistent money identities and multiples", async () => {
    await expect(
      parseAngelListInvestmentsCsv(
        documentBytes([rowValues({ "Net Value": "$1,734.55" })]),
      ),
    ).rejects.toThrow("inconsistent Net Value components");

    await expect(
      parseAngelListInvestmentsCsv(
        documentBytes([rowValues({ Multiple: "9.99" })]),
      ),
    ).rejects.toThrow("Multiple inconsistent");

    await expect(
      parseAngelListInvestmentsCsv(
        documentBytes([
          rowValues({ "Unrealized Value": "Locked", "Net Value": "$0.00" }),
        ]),
      ),
    ).rejects.toThrow("inconsistent locked values");
  });
});

describe("AngelList scalar parsing", () => {
  it("parses exact USD minor units and rejects ambiguous formats", () => {
    expect(parseUsdMinorUnits("$0.00")).toBe(0);
    expect(parseUsdMinorUnits("$9,876,543.21")).toBe(987_654_321);
    expect(parseUsdMinorUnits("$9876543")).toBe(987_654_300);
    expect(() => parseUsdMinorUnits("$1.1")).toThrow();
    expect(() => parseUsdMinorUnits("1.00")).toThrow();
    expect(() => parseUsdMinorUnits("-$1.00")).toThrow();
  });

  it("converts US dates with calendar validation", () => {
    expect(parseUsDateToIso("6/14/2026")).toBe("2026-06-14");
    expect(parseUsDateToIso("02/29/2024")).toBe("2024-02-29");
    expect(() => parseUsDateToIso("02/29/2025")).toThrow();
    expect(() => parseUsDateToIso("2026-06-14")).toThrow();
  });
});
