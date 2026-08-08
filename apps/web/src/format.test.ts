import { describe, expect, it } from "vitest";

import { formatCompactCurrency } from "./format";

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
