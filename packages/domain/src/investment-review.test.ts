import { describe, expect, it } from "vitest";

import {
  InvestmentOwnershipInputSchema,
  ReviewInvestmentInputSchema,
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
