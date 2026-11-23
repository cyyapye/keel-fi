import { expect, it } from "vitest";
import { easternTradingDate } from "@keel/domain/market-close";
import { parseDailyPrices } from "./alpha-vantage-daily";

it("imports only completed raw daily closes for the confirmed US symbol", () => {
  const response = {
    "Meta Data": { "2. Symbol": "CDR", "5. Time Zone": "US/Eastern" },
    "Time Series (Daily)": {
      "2025-10-02": { "4. close": "51.90" },
      "2025-10-01": { "4. close": "48.001125", "5. adjusted close": "40.10" },
    },
  };
  const day = easternTradingDate(new Date("2025-10-03T01:00:00Z"));
  expect(parseDailyPrices(response, "CDR", day)).toEqual([
    { date: "2025-10-01", priceMicros: 48_001_125 },
  ]);
  expect(() => parseDailyPrices(response, "OTHER", day)).toThrow();
  expect(() =>
    parseDailyPrices({ Information: "Rate limited" }, "CDR", day),
  ).toThrow();
});
