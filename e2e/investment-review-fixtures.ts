import type { Page } from "@playwright/test";
import type { LegalEntitySourceSummary } from "../packages/domain/src/legal-entities";
import {
  InvestmentCompanyReceiptSchema,
  InvestmentCompanyReviewInputSchema,
  InvestmentOwnershipObservationSchema,
  InvestmentReviewContextSchema,
  InvestmentReviewStateSchema,
  ReviewInvestmentInputSchema,
  investmentEvidenceRevision,
  type InvestmentReviewContext,
} from "../packages/domain/src/investment-review";

export async function routeInvestmentReview(
  page: Page,
  source: LegalEntitySourceSummary,
  overrides: Partial<InvestmentReviewContext> = {},
) {
  const context = InvestmentReviewContextSchema.parse({
    positionId: source.source.id,
    positionLabel: source.sourceDisplayName,
    holderLabel: source.currentOwner ?? "Not recorded",
    snapshotId: null,
    committedMinor: null,
    fundedMinor: null,
    currency: "USD",
    economics: null,
    review: null,
    defaultParticipationStatus: source.interestStatus,
    documents: source.legalEntityNameEvidence.documents ?? [],
    evidenceRevision: "a".repeat(64),
    companyChoices: [],
    companies: [],
    mappings: [],
    companyReceipt: null,
    otherPositions: [],
    ...overrides,
  });
  const writes: unknown[] = [];
  let reads = 0;
  let reject = false;
  await page.route(
    `**/api/investment-positions/${source.source.id}/review`,
    async (route) => {
      if (route.request().method() === "GET") {
        reads += 1;
        return route.fulfill({ json: context });
      }
      const input = ReviewInvestmentInputSchema.parse(
        route.request().postDataJSON(),
      );
      writes.push(input);
      if (reject)
        return route.fulfill({
          status: 409,
          json: {
            error: "This investment changed. Reload details before saving.",
          },
        });
      const ownership = input.ownershipObservation;
      context.review = InvestmentReviewStateSchema.parse({
        id: crypto.randomUUID(),
        positionId: context.positionId,
        version: (context.review?.version ?? 0) + 1,
        participationStatus: input.participationStatus,
        ownershipObservations: [
          ...(context.review?.ownershipObservations ?? []),
          ...(ownership === undefined
            ? []
            : [
                InvestmentOwnershipObservationSchema.parse({
                  ...ownership,
                  id: crypto.randomUUID(),
                  recordedAt: "2026-09-01T12:00:00.000Z",
                  evidenceBasis: "user_reported",
                  documentSha256: null,
                }),
              ]),
        ],
        documentAssignments:
          input.documentAssignments ??
          context.review?.documentAssignments ??
          [],
        recordedAt: "2026-09-01T12:00:00.000Z",
      });
      source.investmentReview = context.review;
      context.evidenceRevision = await investmentEvidenceRevision(
        context.review.documentAssignments,
      );
      return route.fulfill({ status: 201, json: context.review });
    },
  );
  await page.route(
    `**/api/investment-positions/${source.source.id}/company-review`,
    async (route) => {
      const input = InvestmentCompanyReviewInputSchema.parse(
        route.request().postDataJSON(),
      );
      writes.push(input);
      context.companyReceipt = InvestmentCompanyReceiptSchema.parse({
        ...input,
        positionId: context.positionId,
        companyId: "demo_company",
        companyName:
          input.company.mode === "new"
            ? input.company.legalName
            : "Demo Robotics Inc.",
        mappingId: "demo_mapping",
        recordedAt: "2026-09-01T12:00:00.000Z",
        sourceDocument:
          context.documents.find(
            (doc) => doc.id === input.citation?.documentId,
          ) ?? null,
      });
      context.mappings = [
        {
          id: "demo_mapping",
          companyId: "demo_company",
          companyName: context.companyReceipt.companyName,
          status: "active",
        },
      ];
      source.companyReview = context.companyReceipt;
      return route.fulfill({ status: 201, json: context.companyReceipt });
    },
  );
  return {
    context,
    writes,
    reads: () => reads,
    rejectWrites: (value: boolean) => {
      reject = value;
    },
  };
}
