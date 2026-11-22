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
export type MarketQuote = z.infer<typeof MarketQuoteSchema>;
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
  positions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      valueMinor: z.number().int().safe(),
      quantityMicros: z.number().int().safe(),
      previousSource: z.string().optional(),
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
  })
  .strict();
