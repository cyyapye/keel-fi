import { expect, it, vi } from "vitest";
import { easternTradingDate } from "@keel/domain/market-close";
import { fetchDailyPrices, parseDailyPrices } from "./alpha-vantage-daily";

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

it("recovers a shared-key burst once while respecting the daily quota and UTC window", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-10-03T10:00:00Z"));
  vi.setTimerTickMode("nextTimerAsync");
  let lastRequestAt = -Infinity;
  let problem: string | undefined;
  let slowPreview = false;
  let responseDelay = 0;
  let rejectOperations: string[] = [];
  const jitter = vi.spyOn(Math, "random").mockReturnValue(0.99999);
  const delay = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  const provider = vi.fn(async (url: URL) => {
    const symbol = url.searchParams.get("symbol");
    const split = url.searchParams.get("function") === "SPLITS";
    if (slowPreview && symbol === "ELM" && !split) await delay(2_450);
    const at = Date.now();
    const operation = split ? "SPLITS" : "TIME_SERIES_DAILY";
    const rejectNext = rejectOperations[0] === operation;
    if (rejectNext) rejectOperations.shift();
    const throttled = rejectNext || at - lastRequestAt < 1_000;
    lastRequestAt = at;
    if (responseDelay) await delay(responseDelay);
    if (problem || throttled)
      return Response.json({
        Information: problem ?? "Please limit to 1 request per second.",
      });
    if (split) {
      if (slowPreview && symbol === "ELM") await delay(11_000);
      return Response.json({ symbol, data: [] });
    }
    return Response.json({
      "Meta Data": { "2. Symbol": symbol, "5. Time Zone": "US/Eastern" },
      "Time Series (Daily)": { "2025-10-01": { "4. close": "48" } },
    });
  });
  vi.stubGlobal("fetch", provider);
  const refresh = (ticker: string, feed: "local" | "preview" = "local") =>
    fetchDailyPrices(ticker, "synthetic", new Date(), "2025-10-01", feed);
  try {
    const results = await Promise.all([
      refresh("CDR"),
      refresh("ELM", "preview"),
    ]);
    expect(results.map((prices) => prices[0]?.date)).toEqual([
      "2025-10-01",
      "2025-10-01",
    ]);
    expect(provider).toHaveBeenCalledTimes(5);
    provider.mockClear();
    vi.setSystemTime(new Date("2025-10-03T11:00:00Z"));
    const delayedPreview = async () => {
      await delay(900);
      return refresh("ELM", "preview");
    };
    const staggered = await Promise.all([refresh("CDR"), delayedPreview()]);
    expect(staggered.map((prices) => prices[0]?.date)).toEqual([
      "2025-10-01",
      "2025-10-01",
    ]);
    expect(provider).toHaveBeenCalledTimes(6);
    provider.mockClear();
    vi.setSystemTime(new Date("2025-10-03T12:00:00Z"));
    slowPreview = true;
    const preview = refresh("ELM", "preview");
    await delay(100);
    const delayedResults = await Promise.all([preview, refresh("CDR")]);
    expect(delayedResults).toEqual(results);
    expect(provider).toHaveBeenCalledTimes(5);
    slowPreview = false;
    provider.mockClear();
    vi.setSystemTime(new Date("2025-10-03T13:00:00Z"));
    jitter.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
    const local = refresh("CDR");
    await delay(900);
    expect(await Promise.all([local, refresh("ELM")])).toEqual(results);
    expect(provider).toHaveBeenCalledTimes(6);
    provider.mockClear();
    vi.setSystemTime(new Date("2025-10-03T14:00:00Z"));
    rejectOperations = ["SPLITS", "TIME_SERIES_DAILY"];
    await expect(refresh("CDR")).rejects.toThrow();
    expect(provider).toHaveBeenCalledTimes(3);
    provider.mockClear();
    problem = "Please limit to 1 request per second.";
    await expect(refresh("CDR")).rejects.toThrow();
    expect(provider).toHaveBeenCalledTimes(2);
    provider.mockClear();
    problem = "Your daily limit is 25 requests per day.";
    await expect(refresh("CDR")).rejects.toThrow();
    expect(provider).toHaveBeenCalledTimes(1);
    provider.mockClear();
    problem = undefined;
    vi.setSystemTime(new Date("2025-10-03T15:00:00Z"));
    responseDelay = 11_999;
    for (const [feed, budgetMs] of [
      ["local", 87_200],
      ["preview", 157_200],
    ] as const) {
      provider.mockClear();
      rejectOperations = ["SPLITS"];
      const start = Date.now();
      await expect(refresh("CDR", feed)).resolves.toEqual(results[0]);
      expect(provider).toHaveBeenCalledTimes(3);
      expect(Date.now() - start).toBeLessThanOrEqual(budgetMs);
    }
    responseDelay = 0;
    provider.mockClear();
    vi.setSystemTime(new Date("2025-10-03T23:59:59.500Z"));
    await expect(refresh("CDR")).rejects.toThrow("daily price window");
    expect(provider).toHaveBeenCalledTimes(1);
  } finally {
    jitter.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
