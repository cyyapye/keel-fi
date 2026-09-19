import { expect, type Page } from "@playwright/test";

export async function selectReviewSection(page: Page, name: string) {
  await expect(page.locator(".section-navigation")).toBeVisible();
  const dropdown = page.getByRole("combobox", {
    name: "Review sections",
    exact: true,
  });
  if (await dropdown.isVisible()) {
    await dropdown.click();
    await page
      .getByRole("option", { name: new RegExp(`^${name}\\b`, "u") })
      .click();
  } else {
    await page.getByRole("tab", { name, exact: true }).click();
  }
  await expect(page.locator(".entity-review__panel:not([hidden])")).toHaveCount(
    1,
  );
}
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
  // Existing review fixtures hold their evidence fixed. Tests of automatic
  // recovery replace this route with a state transition explicitly.
  await page.route("**/api/legal-entities/resolve", (route) =>
    route.fulfill({
      json: {
        processedCount: 0,
        changedCount: 0,
        resolvedCount: 0,
        exceptionCount: 0,
        nextPositionId: null,
      },
    }),
  );
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
        closure:
          input.participationStatus !== "historical"
            ? null
            : input.closure === undefined
              ? (context.review?.closure ?? null)
              : input.closure === null
                ? null
                : {
                    ...input.closure,
                    replacementPositionLabel:
                      context.otherPositions.find(
                        (item) =>
                          item.id === input.closure?.replacementPositionId,
                      )?.label ?? null,
                  },
        ownershipObservations: [
          ...(context.review?.ownershipObservations ?? []),
          ...(ownership === undefined
            ? []
            : [
                InvestmentOwnershipObservationSchema.parse({
                  ...ownership,
                  id: crypto.randomUUID(),
                  recordedAt: "2026-09-01T12:00:00.000Z",
                  evidenceBasis:
                    ownership.documentId === null
                      ? "user_reported"
                      : "document_review",
                  documentSha256:
                    context.documents.find(
                      (doc) => doc.id === ownership.documentId,
                    )?.sha256 ?? null,
                }),
              ]),
        ],
        documentAssignments: [
          ...new Map(
            [
              ...(context.review?.documentAssignments ?? []),
              ...(input.documentAssignments ?? []),
            ].map((item) => [item.documentId, item]),
          ).values(),
        ],
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
      if (reject)
        return route.fulfill({
          status: 409,
          json: {
            error: "This investment changed. Reload details before saving.",
          },
        });
      const companyId =
        input.company.mode === "existing"
          ? input.company.companyId
          : "demo_company";
      context.companyReceipt = InvestmentCompanyReceiptSchema.parse({
        ...input,
        positionId: context.positionId,
        companyId,
        companyName:
          input.company.mode === "new"
            ? input.company.legalName
            : context.companies.find((company) => company.id === companyId)!
                .legalName,
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
          companyId,
          companyName: context.companyReceipt.companyName,
          status: "active",
        },
      ];
      if (!context.companies.some((company) => company.id === companyId)) {
        context.companies.push({
          id: companyId,
          legalName: context.companyReceipt.companyName,
        });
      }
      source.companyReview = context.companyReceipt;
      if (context.automaticReview != null) {
        context.automaticReview.issues = context.automaticReview.issues.filter(
          (issue) => issue.section !== "company",
        );
        if (!context.automaticReview.resolved.includes("company"))
          context.automaticReview.resolved.push("company");
      }
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
