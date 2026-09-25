import { describe, expect, it } from "vitest";

import {
  AcceptPositionEconomicsInputSchema,
  ReportedPositionEconomicsTermsSchema,
  calculatePositionEconomics,
  calculatePositionPerformance,
  type PositionEconomicsContext,
} from "./position-economics";

const context = {
  snapshotId: "snapshot-synthetic",
  currency: "USD",
  committedMinor: 10_000_000,
  fundedMinor: 10_000_000,
  reportedTerms: null,
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
  it("keeps independently reported fee or carry evidence explicit", () => {
    expect(
      ReportedPositionEconomicsTermsSchema.parse({
        managementFeePpm: null,
        carryPpm: 200_000,
        sourceLabel: "AngelList export",
        observedAt: "2026-08-25T12:00:00.000Z",
      }),
    ).toMatchObject({ managementFeePpm: null, carryPpm: 200_000 });
    expect(
      ReportedPositionEconomicsTermsSchema.safeParse({
        managementFeePpm: null,
        carryPpm: null,
        sourceLabel: "Unsupported empty report",
        observedAt: "2026-08-25T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("deducts a ten-year upfront admin fee from funded capital", () => {
    expect(calculatePositionEconomics(context)).toEqual({
      committedMinor: 10_000_000,
      fundedMinor: 10_000_000,
      upfrontAdminFeeMinor: 1_000_000,
      setupFeeMinor: 0,
      purchaseFeeMinor: 0,
      positionCostBasisMinor: 9_000_000,
      totalAdminFeePpm: 100_000,
      setupFeePpm: 0,
      carryPpm: 200_000,
    });
  });

  it("applies purchase fees once with their stated basis after SPV fees", () => {
    const terms = {
      ...context.acceptedTerms,
      purchaseFee: {
        receiptId: "synthetic-receipt",
        ratePpm: 60_000,
        basis: "net_capital" as const,
        label: "Underlying fee",
      },
    };
    const result = calculatePositionEconomics({
      ...context,
      acceptedTerms: terms,
    });
    expect(result).toMatchObject({
      upfrontAdminFeeMinor: 1_000_000,
      purchaseFeeMinor: 509_434,
      positionCostBasisMinor: 8_490_566,
    });
    expect(
      calculatePositionEconomics({
        ...context,
        acceptedTerms: {
          ...terms,
          purchaseFee: { ...terms.purchaseFee, basis: "gross_cash" },
        },
      }),
    ).toMatchObject({
      purchaseFeeMinor: 540_000,
      positionCostBasisMinor: 8_460_000,
    });
    expect(
      calculatePositionEconomics({
        ...context,
        committedMinor: 8_490_566,
        acceptedTerms: {
          ...terms,
          commitmentMinorAtAcceptance: 8_490_566,
          capitalBasis: "net_invested",
          grossCommitmentMinor: 10_000_000,
          setupFeePpm: 0,
        },
      }),
    ).toMatchObject({ positionCostBasisMinor: 8_490_566 });
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

  it("reconciles a net import to reviewed gross capital without deducting fees twice", () => {
    const netContext = {
      ...context,
      committedMinor: 2_730_000,
      fundedMinor: 2_730_000,
      acceptedTerms: {
        ...context.acceptedTerms,
        commitmentMinorAtAcceptance: 2_730_000,
        fundedMinorAtAcceptance: 2_730_000,
        capitalBasis: "net_invested" as const,
        grossCommitmentMinor: 3_000_000,
        annualAdminFeePpm: 80_000,
        adminFeeYears: 1,
        setupFeePpm: 10_000,
        carryPpm: 150_000,
      },
    };
    expect(calculatePositionEconomics(netContext)).toMatchObject({
      committedMinor: 3_000_000,
      upfrontAdminFeeMinor: 240_000,
      setupFeeMinor: 30_000,
      positionCostBasisMinor: 2_730_000,
      carryPpm: 150_000,
    });
    expect(
      calculatePositionPerformance({
        currentValueMinor: 2_730_000,
        currentValueReported: true,
        realizedValueMinor: 0,
        providerCostBasisMinor: null,
        fundedMinor: 2_730_000,
        economicsContext: netContext,
        allowFundedAmountEstimate: true,
      }),
    ).toMatchObject({ costBasisMinor: 3_000_000, totalGainMinor: -270_000 });
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

  it("includes setup fees on gross imports and keeps rounding in minor units", () => {
    expect(
      calculatePositionEconomics({
        ...context,
        acceptedTerms: { ...context.acceptedTerms, setupFeePpm: 25_000 },
      }),
    ).toMatchObject({
      upfrontAdminFeeMinor: 1_000_000,
      setupFeeMinor: 250_000,
      positionCostBasisMinor: 8_750_000,
    });
    expect(
      calculatePositionEconomics({
        ...context,
        committedMinor: 1,
        acceptedTerms: {
          ...context.acceptedTerms,
          commitmentMinorAtAcceptance: 1,
          annualAdminFeePpm: 500_000,
          adminFeeYears: 1,
          setupFeePpm: 500_000,
        },
      }),
    ).toMatchObject({
      upfrontAdminFeeMinor: 1,
      setupFeeMinor: 0,
      positionCostBasisMinor: 0,
    });
  });

  it("requires explicit gross capital for net imports and rejects inconsistent terms", () => {
    const input = {
      expectedSnapshotId: context.snapshotId,
      expectedTermsId: null,
      annualAdminFeePpm: 80_000,
      adminFeeYears: 1,
      setupFeePpm: 10_000,
      carryPpm: 150_000,
      note: "Synthetic capital reconciliation.",
    };
    for (const invalid of [
      { capitalBasis: "net_invested" },
      { capitalBasis: "net_invested", grossCommitmentMinor: 0 },
      {
        capitalBasis: "net_invested",
        grossCommitmentMinor: Number.MAX_SAFE_INTEGER + 1,
      },
      { capitalBasis: "gross_commitment", grossCommitmentMinor: 3_000_000 },
      { setupFeePpm: null },
      { setupFeePpm: 950_000 },
      { setupFeePpm: -1 },
      { setupFeePpm: 0.5 },
    ])
      expect(
        AcceptPositionEconomicsInputSchema.safeParse({ ...input, ...invalid })
          .success,
      ).toBe(false);
    expect(
      calculatePositionEconomics({
        ...context,
        acceptedTerms: {
          ...context.acceptedTerms,
          capitalBasis: "net_invested",
          grossCommitmentMinor: 3_000_000,
          setupFeePpm: 0,
        },
      }),
    ).toBeNull();
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

  it("uses paid cash including fees and distributions without counting unfunded commitments", () => {
    const input = {
      currentValueMinor: 3_500_000,
      currentValueReported: true,
      realizedValueMinor: 500_000,
      providerCostBasisMinor: null,
      fundedMinor: 2_500_000,
      allowFundedAmountEstimate: true,
      economicsContext: {
        ...context,
        fundedMinor: 2_500_000,
        acceptedTerms: {
          ...context.acceptedTerms,
          fundedMinorAtAcceptance: 2_500_000,
          purchaseFee: {
            receiptId: "synthetic-purchase",
            ratePpm: 60_000,
            basis: "net_capital" as const,
            label: "Underlying fee",
          },
        },
      },
    };
    expect(calculatePositionPerformance(input)).toMatchObject({
      costBasisMinor: 2_500_000,
      totalGainMinor: 1_500_000,
      totalReturnPpm: 600_000,
    });
    expect(
      calculatePositionPerformance({
        ...input,
        economicsContext: {
          ...input.economicsContext,
          committedMinor: 9_000_000,
          acceptedTerms: {
            ...input.economicsContext.acceptedTerms,
            capitalBasis: "net_invested",
            grossCommitmentMinor: 10_000_000,
            commitmentMinorAtAcceptance: 9_000_000,
            purchaseFee: null,
            setupFeePpm: 0,
          },
        },
      }),
    ).toMatchObject({ costBasisMinor: null, totalReturnPpm: null });
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
      costBasisMinor: 10_000_000,
      costBasisSource: "reviewed_spv_terms",
      totalValueMinor: 13_500_000,
      totalGainMinor: 3_500_000,
      totalReturnPpm: 350_000,
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
      costBasisMinor: 10_000_000,
      totalGainMinor: null,
      totalReturnPpm: null,
    });
  });
});
