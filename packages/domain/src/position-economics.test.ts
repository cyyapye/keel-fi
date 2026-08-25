import { describe, expect, it } from "vitest";

import {
  AcceptPositionEconomicsInputSchema,
  calculatePositionEconomics,
  calculatePositionPerformance,
  type PositionEconomicsContext,
} from "./position-economics";

const context = {
  snapshotId: "snapshot-synthetic",
  currency: "USD",
  committedMinor: 10_000_000,
  fundedMinor: 10_000_000,
  acceptedTerms: {
    id: "economics-synthetic",
    positionId: "position-synthetic",
    acceptedAgainstSnapshotId: "snapshot-synthetic",
    commitmentMinorAtAcceptance: 10_000_000,
    fundedMinorAtAcceptance: 10_000_000,
    annualAdminFeePpm: 10_000,
    adminFeeYears: 10,
    carryPpm: 200_000,
    note: "Synthetic reviewed SPV terms.",
    acceptedAt: "2026-08-24T12:00:00.000Z",
  },
} satisfies PositionEconomicsContext;

describe("position economics", () => {
  it("deducts a ten-year upfront admin fee from funded capital", () => {
    expect(calculatePositionEconomics(context)).toEqual({
      committedMinor: 10_000_000,
      fundedMinor: 10_000_000,
      upfrontAdminFeeMinor: 1_000_000,
      positionCostBasisMinor: 9_000_000,
      totalAdminFeePpm: 100_000,
      carryPpm: 200_000,
    });
  });

  it("derives basis from commitment even when funded capital differs", () => {
    expect(
      calculatePositionEconomics({
        ...context,
        fundedMinor: 500_000,
        acceptedTerms: {
          ...context.acceptedTerms,
          fundedMinorAtAcceptance: 500_000,
        },
      }),
    ).toMatchObject({
      upfrontAdminFeeMinor: 1_000_000,
      positionCostBasisMinor: 9_000_000,
    });
  });

  it("rejects fee terms above the commitment", () => {
    expect(
      AcceptPositionEconomicsInputSchema.safeParse({
        expectedSnapshotId: "snapshot-synthetic",
        expectedTermsId: null,
        annualAdminFeePpm: 200_000,
        adminFeeYears: 6,
        carryPpm: 200_000,
        note: "Synthetic terms.",
      }).success,
    ).toBe(false);
  });

  it("does not reprice accepted terms against a newer source snapshot", () => {
    expect(
      calculatePositionEconomics({
        ...context,
        snapshotId: "snapshot-synthetic-newer",
        committedMinor: 12_500_000,
      }),
    ).toBeNull();
  });

  it("calculates total return only when current value is reported", () => {
    expect(
      calculatePositionPerformance({
        currentValueMinor: 13_500_000,
        currentValueReported: true,
        realizedValueMinor: 0,
        providerCostBasisMinor: null,
        fundedMinor: 10_000_000,
        economicsContext: context,
        allowFundedAmountEstimate: true,
      }),
    ).toEqual({
      costBasisMinor: 9_000_000,
      costBasisSource: "reviewed_spv_terms",
      totalValueMinor: 13_500_000,
      totalGainMinor: 4_500_000,
      totalReturnPpm: 500_000,
    });

    expect(
      calculatePositionPerformance({
        currentValueMinor: null,
        currentValueReported: false,
        realizedValueMinor: 0,
        providerCostBasisMinor: null,
        fundedMinor: 10_000_000,
        economicsContext: context,
        allowFundedAmountEstimate: true,
      }),
    ).toMatchObject({
      costBasisMinor: 9_000_000,
      totalGainMinor: null,
      totalReturnPpm: null,
    });
  });
});
