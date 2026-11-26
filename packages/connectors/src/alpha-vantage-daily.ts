import { z } from "zod";

import {
  DailyPriceSchema,
  easternTradingDate,
  type DailyPrice,
} from "@keel/domain/market-close";

const responseSchema = z.object({
  "Meta Data": z.object({
    "2. Symbol": z.string(),
    "5. Time Zone": z.enum(["US/Eastern", "America/New_York"]),
  }),
  "Time Series (Daily)": z.record(
    z.iso.date(),
    z.object({ "4. close": z.string().regex(/^\d{1,7}(?:\.\d{1,6})?$/u) }),
  ),
});

export function parseDailyPrices(
  raw: unknown,
  symbol: string,
  todayEastern: string,
) {
  const result = responseSchema.safeParse(raw);
  if (!result.success || result.data["Meta Data"]["2. Symbol"] !== symbol)
    throw new Error(
      "Alpha Vantage did not return daily prices for the selected US listing.",
    );
  const prices: DailyPrice[] = [];
  const entries = Object.entries(result.data["Time Series (Daily)"]);
  if (entries.length > 100) throw new Error("Unexpected daily history length.");
  for (const [date, bar] of entries) {
    if (date >= todayEastern) continue;
    const [dollars, fraction = ""] = bar["4. close"].split(".");
    const micros =
      BigInt(dollars!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
    prices.push(DailyPriceSchema.parse({ date, priceMicros: Number(micros) }));
  }
  if (!prices.length)
    throw new Error("No completed trading date is available.");
  return prices.sort((a, b) => a.date.localeCompare(b.date));
}

async function alphaVantageResponse(
  operation: "TIME_SERIES_DAILY" | "SPLITS",
  symbol: string,
  apiKey: string,
): Promise<unknown> {
  const url = new URL("https://www.alphavantage.co/query");
  url.search = new URLSearchParams({
    function: operation,
    symbol,
    ...(operation === "TIME_SERIES_DAILY" ? { outputsize: "compact" } : {}),
    apikey: apiKey,
  }).toString();
  const response = await fetch(url, {
    // Workers support manual redirect handling. The status check below rejects 3xx.
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("The daily price service is unavailable.");
  // Compact history contains at most 100 bars. Bound the actual transferred body as well.
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error("The daily price service returned an empty response.");
  let bytes = 0;
  const decoder = new TextDecoder();
  let body = "";
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 96 * 1024) {
      await reader.cancel();
      throw new Error("The daily price response exceeded its limit.");
    }
    body += decoder.decode(part.value, { stream: true });
  }
  return JSON.parse(body + decoder.decode()) as unknown;
}

const providerNotice = z.object({
  Information: z.string().optional(),
  Note: z.string().optional(),
});
const perSecondLimit = /\b(?:1|one) (?:API )?(?:request|call) per second\b/iu;
const exhaustedDailyLimit =
  /\b(?:daily|per day)\b.{0,100}\b(?:exhausted|exceeded|reached|used up)\b|\b(?:exhausted|exceeded|reached|used up)\b.{0,100}\b(?:daily|per day)\b/isu;

function canRetryBurst(response: unknown) {
  const notice = providerNotice.safeParse(response);
  if (!notice.success) return false;
  const message = [notice.data.Information, notice.data.Note].join(" ");
  return perSecondLimit.test(message) && !exhaustedDailyLimit.test(message);
}

export async function fetchDailyPrices(
  symbol: string,
  apiKey: string,
  now: Date,
  firstSession: string,
  feed: "local" | "preview" = "local",
) {
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(24, 0, 0, 0);
  let recovered = false;

  async function request(
    operation: "SPLITS" | "TIME_SERIES_DAILY",
    delayMs = 0,
  ): Promise<unknown> {
    if (Date.now() + delayMs >= endOfDay.getTime())
      throw new Error("The daily price window has ended.");
    if (delayMs > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    if (Date.now() >= endOfDay.getTime())
      throw new Error("The daily price window has ended.");
    const response = await alphaVantageResponse(operation, symbol, apiKey);
    if (!recovered && canRetryBurst(response)) {
      // Two 12-second HTTP deadlines and the normal pause fit in 30s.
      // Preview also gives a throttled local pair time to finish its recovery.
      recovered = true;
      // Randomize local recovery so independent profiles avoid retrying in lockstep.
      const backoffMs =
        feed === "preview"
          ? 120_000
          : 30_000 + Math.floor(Math.random() * 20_000);
      return request(operation, backoffMs);
    }
    return response;
  }
  const splitResponse = z
    .object({
      symbol: z.literal(symbol),
      data: z.array(z.object({ effective_date: z.iso.date() })).max(500),
    })
    .safeParse(await request("SPLITS"));
  if (!splitResponse.success)
    throw new Error("Unable to confirm the trading share basis.");
  const split = splitResponse.data.data
    .map((s) => s.effective_date)
    .filter((d) => d >= firstSession)
    .sort()[0];
  // After a split, raw prices and the original share allocation use different units.
  const cutoff = easternTradingDate(now);
  return parseDailyPrices(
    await request("TIME_SERIES_DAILY", 1_200),
    symbol,
    split && split < cutoff ? split : cutoff,
  );
}
