import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

import {
  formatCompactCurrency,
  formatCurrency,
  formatMagnitudeRoundedCurrency,
  formatRoundedCompactCurrency,
  formatSharePrice,
  formatSavedAt,
} from "./format";

describe("holding evidence precision", () => {
  it.each([
    {
      zone: "America/Los_Angeles",
      times: [
        "2026-11-01T09:30:00.000Z",
        "2026-11-01T08:30:00.000Z",
        "2026-10-03T01:15:42.000Z",
      ],
      expected: [
        "Nov 1, 2026, 1:30 AM",
        "Nov 1, 2026, 1:30 AM",
        "Oct 2, 2026, 6:15 PM",
      ],
    },
    {
      zone: "Asia/Singapore",
      times: ["2026-10-02T17:45:06.000Z"],
      expected: ["Oct 3, 2026, 1:45 AM"],
    },
  ])(
    "formats local instants and fixed source calendar dates in $zone",
    ({ zone, times, expected }) => {
      // Fresh Node Intl with the real formatter: no mocked Date or Intl implementation.
      const output = execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          `import { formatDate, formatSavedAt } from './apps/web/src/format.ts';
       console.log(JSON.stringify({source: formatDate('2026-09-30'), saved: ${JSON.stringify(times)}.map(formatSavedAt)}));`,
        ],
        { env: { ...process.env, TZ: zone }, encoding: "utf8", timeout: 10000 },
      );
      expect(JSON.parse(output)).toEqual({
        source: "Sep 30, 2026",
        saved: expected,
      });
    },
  );
  it("keeps sub-cent share prices exact while displaying at least two decimals", () => {
    expect(formatSharePrice(24_700_000)).toBe("$24.70");
    expect(formatSharePrice(24_712_345)).toBe("$24.712345");
    expect(formatSharePrice(100_000_000)).toBe("$100.00");
    expect(formatSharePrice(5_000)).toBe("$0.005");
  });
  it("shows local history to the minute without seconds or a zone suffix", () => {
    expect(formatSavedAt("2026-10-01T12:00:01Z")).toBe(
      formatSavedAt("2026-10-01T12:00:02Z"),
    );
    expect(formatSavedAt("2026-10-01T12:00:01Z")).not.toBe(
      formatSavedAt("2026-10-01T12:01:01Z"),
    );
    expect(formatSavedAt("2026-10-01T12:00:01Z")).toMatch(
      /\d{1,2}:\d{2} [AP]M$/,
    );
  });
});

describe("formatCompactCurrency", () => {
  it("formats large two-decimal currencies without floating-point math", () => {
    expect(formatCompactCurrency(6_200_000_000, "USD")).toBe("USD 62M");
    expect(formatCompactCurrency(6_250_000_000, "USD")).toBe("USD 62.5M");
    expect(formatCompactCurrency(31_050_000_000, "EUR")).toBe("EUR 310.5M");
    expect(formatCompactCurrency(125_000_000_000, "USD")).toBe("USD 1.25B");
    expect(formatCompactCurrency(123_456_789_012, "USD")).toBe(
      "USD 1,234,567,890.12",
    );
  });

  it("uses the currency's own minor-unit precision", () => {
    expect(formatCompactCurrency(6_200_000_000, "JPY")).toBe("JPY 6.2B");
    expect(formatCompactCurrency(1_234, "KWD")).toBe("KWD 1.234");
  });

  it("keeps unsupported three-letter currency codes visible", () => {
    expect(formatCompactCurrency(12_345, "ZZZ")).toBe("ZZZ 123.45");
  });
});

describe("formatRoundedCompactCurrency", () => {
  it("rounds display-only portfolio values with integer arithmetic", () => {
    expect(formatRoundedCompactCurrency(31_098_034, "USD", 10_000)).toBe(
      "USD 310k",
    );
    expect(formatRoundedCompactCurrency(18_308_735, "USD", 1_000)).toBe(
      "USD 183k",
    );
    expect(formatRoundedCompactCurrency(-10_449_494, "USD", 1_000)).toBe(
      "-USD 104k",
    );
  });

  it("preserves exact values below the requested display increment", () => {
    expect(formatRoundedCompactCurrency(12_345, "USD", 1_000)).toBe(
      "USD 123.45",
    );
    expect(formatRoundedCompactCurrency(12_345, "JPY", 1_000)).toBe("JPY 12k");
  });

  it("rejects invalid rounding increments", () => {
    expect(() => formatRoundedCompactCurrency(12_345, "USD", 0)).toThrow(
      /positive safe integer/u,
    );
  });
});

describe("formatMagnitudeRoundedCurrency", () => {
  it("keeps smaller totals useful while simplifying six figures", () => {
    expect(formatMagnitudeRoundedCurrency(31_098_034, "USD")).toBe("USD 310k");
    expect(formatMagnitudeRoundedCurrency(2_339_805, "USD")).toBe("USD 23k");
    expect(formatMagnitudeRoundedCurrency(99_950, "USD")).toBe("USD 999.5");
  });
});

describe("formatCurrency", () => {
  it("shows complete amounts with each currency's precision, including negative and large values", () => {
    expect(formatCurrency(123_456_789, "usd")).toBe("USD 1,234,567.89");
    expect(formatCurrency(-120, "USD")).toBe("-USD 1.20");
    expect(formatCurrency(0, "USD")).toBe("USD 0.00");
    expect(formatCurrency(1_234, "JPY")).toBe("JPY 1,234");
    expect(formatCurrency(1_234, "KWD")).toBe("KWD 1.234");
    expect(formatCurrency(Number.MAX_SAFE_INTEGER, "USD")).toBe(
      "USD 90,071,992,547,409.91",
    );
  });
});
