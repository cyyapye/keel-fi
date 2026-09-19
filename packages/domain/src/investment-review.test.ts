import { describe, expect, it } from "vitest";

import {
  includesCurrentInvestment,
  InvestmentOwnershipInputSchema,
  ReviewInvestmentInputSchema,
  investmentCompanyEvidenceRevision,
} from "./investment-review";

const emptyOwnership = {
  sourceKind: "user_reported",
  sourceLabel: "User reported",
  effectiveDate: "2026-09-01",
  taxYear: null,
  ownershipPpm: null,
  profitBeginningPpm: null,
  profitEndingPpm: null,
  lossBeginningPpm: null,
  lossEndingPpm: null,
  capitalBeginningPpm: null,
  capitalEndingPpm: null,
  documentId: null,
  page: null,
  quote: null,
  supersedesObservationId: null,
};

describe("connected investment review", () => {
  it("acknowledges stable company evidence across repeat captures but detects new evidence", async () => {
    const citation = {
      documentId: crypto.randomUUID(),
      sha256: "a".repeat(64),
      companyName: "Synthetic Orchard Global, LLC",
      page: 4,
      quote:
        "“Portfolio Investment”: The entity referred to as Synthetic Orchard Global, LLC.",
    };
    const revision = await investmentCompanyEvidenceRevision([citation]);
    expect(
      await investmentCompanyEvidenceRevision([
        { ...citation, documentId: crypto.randomUUID() },
        citation,
      ]),
    ).toBe(revision);
    for (const changes of [
      { sha256: "b".repeat(64) },
      { companyName: "Synthetic New Company LLC" },
      { page: 5 },
      { quote: "Portfolio Company: Synthetic Orchard Global, LLC" },
    ])
      expect(
        await investmentCompanyEvidenceRevision([{ ...citation, ...changes }]),
      ).not.toBe(revision);
    expect(await investmentCompanyEvidenceRevision([])).not.toBe(revision);
  });
  it("can confirm participation while ownership remains unreported", () => {
    expect(
      ReviewInvestmentInputSchema.safeParse({
        requestId: crypto.randomUUID(),
        expectedReviewId: null,
        expectedSnapshotId: "snapshot_demo",
        expectedEvidenceRevision: "a".repeat(64),
        participationStatus: "current",
      }).success,
    ).toBe(true);
  });

  it("keeps K-1 profit, loss and capital shares separate and dated by tax year", () => {
    const report = {
      ...emptyOwnership,
      sourceKind: "k1",
      effectiveDate: null,
      taxYear: 2025,
      profitEndingPpm: 23_000,
      capitalEndingPpm: 25_000,
    };
    expect(InvestmentOwnershipInputSchema.safeParse(report).success).toBe(true);
    expect(
      InvestmentOwnershipInputSchema.safeParse({
        ...report,
        ownershipPpm: 25_000,
      }).success,
    ).toBe(false);
    expect(
      InvestmentOwnershipInputSchema.safeParse({ ...report, taxYear: null })
        .success,
    ).toBe(false);
  });

  it("does not invent a percentage and distinguishes zero from missing", () => {
    expect(
      InvestmentOwnershipInputSchema.safeParse(emptyOwnership).success,
    ).toBe(false);
    expect(
      InvestmentOwnershipInputSchema.safeParse({
        ...emptyOwnership,
        ownershipPpm: 0,
      }).success,
    ).toBe(true);
    expect(
      InvestmentOwnershipInputSchema.safeParse({
        ...emptyOwnership,
        ownershipPpm: 0.1,
      }).success,
    ).toBe(false);
    expect(
      InvestmentOwnershipInputSchema.safeParse({
        ...emptyOwnership,
        ownershipPpm: 1_000_001,
      }).success,
    ).toBe(false);
  });

  it("requires an actual agreement and page for a document-backed observation", () => {
    const report = {
      ...emptyOwnership,
      sourceKind: "agreement",
      ownershipPpm: 25_000,
    };
    expect(InvestmentOwnershipInputSchema.safeParse(report).success).toBe(
      false,
    );
    expect(
      InvestmentOwnershipInputSchema.safeParse({
        ...report,
        documentId: crypto.randomUUID(),
        page: 2,
      }).success,
    ).toBe(true);
  });
});

it("preserves unresolved participation and validates optional closure metadata without inferring money", () => {
  const base = {
    requestId: crypto.randomUUID(),
    expectedReviewId: null,
    expectedSnapshotId: null,
    expectedEvidenceRevision: "a".repeat(64),
  };
  for (const participationStatus of [
    "current",
    "pending",
    "unknown",
    "historical",
    "cancelled",
  ] as const) {
    expect(
      includesCurrentInvestment({
        snapshot: { providerStatus: "live" },
        investmentReview: { participationStatus },
      }),
    ).toBe(!["historical", "cancelled"].includes(participationStatus));
    const closure = {
      endedOn: "2026-08-25",
      reason: "unwound",
      note: "Fully refunded (synthetic note)",
      replacementPositionId: "synthetic-replacement",
    };
    expect(
      ReviewInvestmentInputSchema.safeParse({
        ...base,
        participationStatus,
        closure,
      }).success,
    ).toBe(participationStatus === "historical");
  }
  expect(
    includesCurrentInvestment({ snapshot: { providerStatus: "realized" } }),
  ).toBe(false);
  expect(
    ReviewInvestmentInputSchema.safeParse({
      ...base,
      participationStatus: "historical",
      closure: {
        endedOn: "2026-02-31",
        reason: null,
        note: null,
        replacementPositionId: null,
      },
    }).success,
  ).toBe(false);
});
