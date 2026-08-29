import { describe, expect, it } from "vitest";

import {
  formatCompactCurrency,
  formatMagnitudeRoundedCurrency,
  formatRoundedCompactCurrency,
} from "./format";

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
