import { z } from "zod";
import { ShareBasisSchema } from "./valuation-record";
import { HttpsSourceUrlSchema } from "./source-url";

export const MarketQuoteSchema = z.object({
  id: z.string().min(1),
  ticker: z.string().min(1),
  venue: z.string().min(1),
  shareClass: z.string().min(1),
  shareBasis: ShareBasisSchema,
  date: z.iso.date(),
  priceMicros: z.number().int().positive().max(1_000_000_000_000),
  sourceUrl: HttpsSourceUrlSchema,
});
export const GpMarkPriceSchema = z.object({
  priceMicros: MarketQuoteSchema.shape.priceMicros,
  priceDate: z.iso.date().nullable(),
  sourceLabel: z.string().trim().min(1).max(500),
});

export const DailyPriceSchema = MarketQuoteSchema.pick({
  date: true,
  priceMicros: true,
});
export type DailyPrice = z.infer<typeof DailyPriceSchema>;

export function easternTradingDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export type MarketQuote = z.infer<typeof MarketQuoteSchema>;
export const CloseProxyBasisSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("indicative_shares"),
    sharesKey: z.string().min(1),
  }),
  z.object({
    method: z.literal("price_change"),
    startMinor: z.number().int().safe().positive(),
    valueDate: z.iso.date(),
    sourceLabel: z.string().min(1),
    startDate: z.iso.date(),
    startPriceMicros: MarketQuoteSchema.shape.priceMicros,
    shareBasis: ShareBasisSchema,
    sharesKey: z.string().min(1),
  }),
]);
export type CloseProxyBasis = z.infer<typeof CloseProxyBasisSchema>;
export const MarketReviewSchema = z.object({
  exposureId: z.string(),
  name: z.string(),
  quote: MarketQuoteSchema,
  firstDate: z.iso.date(),
  firstPriceMicros: MarketQuoteSchema.shape.priceMicros,
  read: z.boolean(),
  readVersion: z.number().int().nonnegative(),
  version: z.number().int(),
  choice: z.enum(["follow", "keep"]).nullable(),
  token: z.string(),
  renewalCount: z.number().int().positive().optional(),
  positions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      valueMinor: z.number().int().safe(),
      quantityMicros: z.number().int().safe().nullable(),
      proxyBasis: CloseProxyBasisSchema.optional(),
      privateClasses: z.array(z.string().min(1)).optional(),
      previousSource: z.string().optional(),
      latestGpPrice: GpMarkPriceSchema.optional(),
      previousMinor: z.number().int().safe().nullable(),
      enrolled: z.boolean(),
    }),
  ),
});
export type MarketReview = z.infer<typeof MarketReviewSchema>;
export const MarketDecisionInput = z
  .object({
    requestId: z.uuid(),
    token: z.string().min(1).max(128),
    choice: z.enum(["follow", "keep"]),
    acceptProxyBasis: z.literal(true).optional(),
    scope: z.literal("active").optional(),
  })
  .strict();

export const PersonalListingSchema = z
  .object({
    company: z.string().trim().min(1).max(120),
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/u),
    issuerId: z.string().regex(/^\d{10}$/u),
    venue: z.enum(["Nasdaq", "NYSE"]),
    shareClass: z.string().trim().min(1).max(80),
    firstSession: z.iso.date(),
    identitySourceUrl: HttpsSourceUrlSchema,
  })
  .strict();
export type PersonalListing = z.infer<typeof PersonalListingSchema>;

export const PreviewPersonalFeedSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(256),
    exposureId: z.uuid(),
    householdId: z.string().min(1).max(256),
    basisKey: ShareBasisSchema.shape.key,
    listing: PersonalListingSchema,
  })
  .strict();

export function alphaVantageDailyUrl(ticker: string): string {
  const url = new URL("https://www.alphavantage.co/query");
  url.search = new URLSearchParams({
    function: "TIME_SERIES_DAILY",
    symbol: ticker,
  }).toString();
  return url.toString();
}

export function dailyCloseProvider(
  quote: Pick<MarketQuote, "ticker" | "sourceUrl">,
) {
  return quote.sourceUrl === alphaVantageDailyUrl(quote.ticker)
    ? "Alpha Vantage"
    : undefined;
}
