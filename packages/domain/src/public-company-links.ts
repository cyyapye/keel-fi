import { z } from "zod";

const Id = z.string().min(1).max(500);
const Label = z.string().trim().min(1).max(1_000);

export const PublicCompanyLinkCatalogSchema = z.object({
  securities: z.array(
    z.object({
      exposureId: Id,
      name: Label,
      companyId: Id.nullable(),
      reviewId: Id.nullable(),
      positionCount: z.number().int().positive(),
    }),
  ),
  companies: z.array(z.object({ id: Id, name: Label })),
});

export const PublicCompanyLinkReviewSchema = z.object({
  exposureId: Id,
  companyId: Id,
  expectedReviewId: Id.nullable(),
  sourceUrl: z
    .url()
    .max(2_048)
    .refine(
      (value) => /^https?:\/\//iu.test(value),
      "Use an http or https URL.",
    ),
  reason: z.string().trim().min(1).max(1_000),
});

export const PublicCompanyLinkReceiptSchema = z.object({
  id: Id,
  exposureId: Id,
  companyId: Id,
  reviewedAt: z.iso.datetime({ offset: true }),
});

export type PublicCompanyLinkCatalog = z.infer<
  typeof PublicCompanyLinkCatalogSchema
>;
export type PublicCompanyLinkReview = z.infer<
  typeof PublicCompanyLinkReviewSchema
>;
