import { expect, it } from "vitest";
import { formatHoldingsAmount } from "./money";

it("rounds Holdings display values after scaling in their native currency", () => {
  expect(formatHoldingsAmount(0)).toBe("$0");
  expect(formatHoldingsAmount(1)).toBe("<$1");
  expect(formatHoldingsAmount(-1)).toBe("(<$1)");
  expect(formatHoldingsAmount(1255)).toBe("$13");
  expect(formatHoldingsAmount(99950)).toBe("$1K");
  expect(formatHoldingsAmount(-8461275)).toBe("-$84.6K");
  expect(formatHoldingsAmount(99994999)).toBe("$999.9K");
  expect(formatHoldingsAmount(99995000)).toBe("$1M");
  expect(formatHoldingsAmount(355388675)).toBe("$3.6M");
  expect(formatHoldingsAmount(5650, "jpy")).toBe("JPY 5.7K");
  expect(formatHoldingsAmount(5650000, "KWD")).toBe("KWD 5.7K");
  expect(formatHoldingsAmount(99999999999999999999n)).toBe("$1000000000000M");
});
