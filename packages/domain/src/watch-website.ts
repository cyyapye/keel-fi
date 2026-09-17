import { z } from "zod";

export const WatchWebsiteInputSchema = z
  .object({
    decisionId: z.uuid(),
    companyName: z.string().min(1).max(1_000),
    websiteUrl: z.url({ protocol: /^https$/ }).max(2_000),
    rationale: z.string().trim().min(8).max(1_000),
  })
  .strict();
export type WatchWebsiteInput = z.infer<typeof WatchWebsiteInputSchema>;
export const WatchWebsiteReceiptSchema = z.object({
  decisionId: z.uuid(),
  officialHost: z.string().min(1),
  decidedAt: z.iso.datetime({ offset: true }),
});
export const WatchWebsiteSearchSchema = z.object({
  candidates: z
    .array(
      z.object({
        title: z.string().max(500),
        url: z.url({ protocol: /^https$/ }).max(2_000),
        description: z.string().max(1_000),
      }),
    )
    .max(5),
});
