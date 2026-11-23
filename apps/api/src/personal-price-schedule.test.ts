import { fetchDailyPrices } from "@keel/connectors/alpha-vantage-daily";
import { expect, it, vi } from "vitest";
import {
  listMarketReviews,
  marketReviewDetail,
  decideMarketSource,
} from "@keel/database/market-close";
import { legalDocumentTestDatabase } from "../../../scripts/test-support/legal-documents";
import { seedSamplePricePositions } from "../../../scripts/seed-closing-price";
import { LINK_DEMO_SUBJECT } from "../../../scripts/seed-position-links";
import { refreshPreviewDailyPrices } from "./personal-price-schedule";
import type { Env } from "./types";

it("admits one preview price refresh per day and continues both approved positions across retries and a split", async () => {
  const fixture = legalDocumentTestDatabase();
  const db = fixture.asD1();
  const listing = {
    company: "Cedar Robotics",
    issuerId: "0000000001",
    ticker: "CDR",
    venue: "Nasdaq",
    shareClass: "Class A",
    firstSession: "2026-11-19",
    identitySourceUrl: "https://example.test/cedar/filing",
  };
  const basisKey = "reviewed-cedar-common";
  const id = await seedSamplePricePositions(db, listing.company, {
    key: basisKey,
    unitsPerOriginal: 1,
  });
  const config = {
    listing,
    exposureId: id,
    householdId: "hh_demo",
    basisKey,
    apiKey: "synthetic",
  };
  let window: string | null = null;
  const bucket = {
    head: vi.fn(() =>
      Promise.resolve(
        window ? { etag: window, customMetadata: { day: window } } : null,
      ),
    ),
    put: vi.fn(
      (
        _key: string,
        day: string,
        options: {
          onlyIf: { etagMatches?: string; etagDoesNotMatch?: string };
        },
      ) => {
        if (
          window
            ? options.onlyIf.etagMatches !== window
            : options.onlyIf.etagDoesNotMatch !== "*"
        )
          return Promise.resolve(null);
        window = day;
        return Promise.resolve({ etag: day });
      },
    ),
  };
  const env = {
    ENVIRONMENT: "preview",
    PERSONAL_DAILY_PRICES_ENABLED: "true",
    DB: db,
    DOCUMENTS: bucket,
    ALPHA_VANTAGE_PERSONAL_FEED: JSON.stringify(config),
  } as unknown as Env;
  let quotes: Record<string, { "4. close": string }> = {
    "2026-11-19": { "4. close": "67.23" },
  };
  let split: string | null = null,
    outage = false;
  const provider = vi.fn((url: URL) => {
    if (outage)
      return Promise.resolve(
        Response.json({ Information: "Provider unavailable" }),
      );
    return Promise.resolve(
      Response.json(
        url.searchParams.get("function") === "SPLITS"
          ? {
              symbol: listing.ticker,
              data: split
                ? [{ effective_date: split, split_factor: "2.0" }]
                : [],
            }
          : {
              "Meta Data": {
                "2. Symbol": listing.ticker,
                "5. Time Zone": "US/Eastern",
              },
              "Time Series (Daily)": quotes,
            },
      ),
    );
  });
  vi.stubGlobal("fetch", provider);
  vi.useFakeTimers({ toFake: ["Date"] });
  const tick = (day: string, configuration = env) => {
    const scheduledTime = Date.parse(day + "T13:00:00Z");
    vi.setSystemTime(scheduledTime);
    return refreshPreviewDailyPrices(
      { cron: "0 13 * * *", scheduledTime },
      configuration,
    );
  };
  try {
    await tick("2026-11-19", { ...env, ENVIRONMENT: "production" });
    await tick("2026-11-19", {
      ...env,
      PERSONAL_DAILY_PRICES_ENABLED: "false",
    });
    expect(bucket.head).not.toHaveBeenCalled();
    await tick("2026-11-19", {
      ...env,
      ALPHA_VANTAGE_PERSONAL_FEED: JSON.stringify({
        ...config,
        householdId: "unrelated",
      }),
    });
    expect(provider).not.toHaveBeenCalled();
    split = listing.firstSession;
    await expect(
      fetchDailyPrices(
        listing.ticker,
        "synthetic",
        new Date("2026-11-20T13:00:00Z"),
        listing.firstSession,
      ),
    ).rejects.toThrow("No completed trading date");
    split = null;
    provider.mockClear();
    await Promise.all([tick("2026-11-20"), tick("2026-11-20")]);
    expect(provider).toHaveBeenCalledTimes(2);
    const first = (await marketReviewDetail(db, LINK_DEMO_SUBJECT, id))!;
    expect(first.choice).toBe(null);
    expect(first.positions).toHaveLength(2);
    await decideMarketSource(db, LINK_DEMO_SUBJECT, id, {
      requestId: crypto.randomUUID(),
      choice: "follow",
      token: first.token,
    });
    quotes = { ...quotes, "2026-11-20": { "4. close": "62.91" } };
    await tick("2026-11-21");
    const [next] = await listMarketReviews(db, LINK_DEMO_SUBJECT);
    expect(next?.quote.date).toBe("2026-11-20");
    expect(next?.version).toBe(1);
    expect(
      next?.positions
        .filter((p) => p.enrolled)
        .map((p) => p.valueMinor)
        .sort((a, b) => a - b),
    ).toEqual([377460, 629100]);
    outage = true;
    await tick("2026-11-22");
    await tick("2026-11-22");
    expect(provider).toHaveBeenCalledTimes(5);
    outage = false;
    split = "2026-11-23";
    quotes["2026-11-23"] = { "4. close": "31.45" };
    await tick("2026-11-24");
    expect(provider).toHaveBeenCalledTimes(7);
    expect(
      (await listMarketReviews(db, LINK_DEMO_SUBJECT))[0]?.quote.date,
    ).toBe("2026-11-20");
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fixture.sqlite.close();
  }
});
