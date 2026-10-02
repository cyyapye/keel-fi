import { describe, expect, it } from "vitest";
import {
  reconcileInvestmentCapital,
  estimateProceedsAfterCarry,
  unknownInvestmentTerms,
} from "./investment-details";
import {
  PurchaseLotSchema,
  PurchaseDetailsSchema,
  PurchaseReceiptSchema,
  purchaseCapital,
  purchaseShares,
  reviewedInvestmentFromReceipt,
} from "./position-purchases";
import {
  calculatePositionPerformance,
  calculatePositionEconomics,
} from "./position-economics";

const lot = () =>
  PurchaseLotSchema.parse({
    id: "synthetic-lot",
    purchasedOn: null,
    shareClass: null,
    priceMicros: null,
    referencePriceMicros: null,
    grossCashMinor: 240000,
    netCapitalMinor: 211234,
    upfrontDeductionsMinor: null,
    feePpm: 60000,
    feeBasis: "net_capital",
    feeLabel: "One component only",
    remainingSharesMicros: null,
    sharesAsOf: null,
    sourceLabel: "Synthetic executed statement",
    sourceUrl: null,
    mark: null,
  });
const receipt = () =>
  PurchaseReceiptSchema.parse({
    id: "synthetic-review",
    positionId: "synthetic-position",
    snapshotId: "synthetic-snapshot",
    currency: "USD",
    acceptedAt: "2026-09-01T00:00:00.000Z",
    details: {
      investmentTerms: {
        ...unknownInvestmentTerms(),
        carryPpm: 200000,
        carryBasis: "net_capital",
      },
      cashCoversPosition: true,
      coversPosition: false,
      lots: [lot()],
    },
  });
describe("unified investment details", () => {
  it.each([
    {
      grossCashMinor: 240000,
      netCapitalMinor: 211234,
      upfrontDeductionsMinor: null,
    },
    {
      grossCashMinor: 240000,
      netCapitalMinor: null,
      upfrontDeductionsMinor: 28766,
    },
    {
      grossCashMinor: null,
      netCapitalMinor: 211234,
      upfrontDeductionsMinor: 28766,
    },
  ])(
    "reconciles any two exact amounts without deriving fee components: %j",
    (input) => {
      expect(reconcileInvestmentCapital(input)).toEqual({
        grossCashMinor: 240000,
        netCapitalMinor: 211234,
        upfrontDeductionsMinor: 28766,
        conflict: false,
      });
    },
  );
  it("rejects exact conflicts, negative capital and unsafe sums", () => {
    expect(
      reconcileInvestmentCapital({
        grossCashMinor: NaN,
        netCapitalMinor: 100,
        upfrontDeductionsMinor: 0,
      }).conflict,
    ).toBe(true);
    expect(
      reconcileInvestmentCapital({
        grossCashMinor: 240000,
        netCapitalMinor: 211234,
        upfrontDeductionsMinor: 28765,
      }).conflict,
    ).toBe(true);
    expect(
      reconcileInvestmentCapital({
        grossCashMinor: 100,
        netCapitalMinor: null,
        upfrontDeductionsMinor: 101,
      }).conflict,
    ).toBe(true);
    expect(
      reconcileInvestmentCapital({
        grossCashMinor: null,
        netCapitalMinor: Number.MAX_SAFE_INTEGER,
        upfrontDeductionsMinor: 1,
      }).conflict,
    ).toBe(true);
    expect(
      PurchaseLotSchema.safeParse({ ...lot(), upfrontDeductionsMinor: 1 })
        .success,
    ).toBe(false);
    expect(
      PurchaseDetailsSchema.safeParse({
        investmentTerms: unknownInvestmentTerms(),
        cashCoversPosition: true,
        lots: ["a", "b"].map((id) => ({
          ...lot(),
          id,
          grossCashMinor: Number.MAX_SAFE_INTEGER,
          netCapitalMinor: null,
          upfrontDeductionsMinor: null,
        })),
      }).success,
    ).toBe(false);
  });
  it("uses exact totals despite optional component rates and never converts SPV units", () => {
    expect(purchaseCapital(lot())).toMatchObject({
      grossCashMinor: 240000,
      netCapitalMinor: 211234,
      upfrontDeductionsMinor: 28766,
    });
    expect(
      purchaseShares({ ...lot(), nominalSpvUnitsMicros: 500000000 }),
    ).toBeNull();
    const legacy = { ...lot() };
    delete legacy.upfrontDeductionsMinor;
    legacy.netCapitalMinor = null;
    expect(purchaseCapital(legacy).netCapitalMinor).toBe(226415);
  });
  it.each(["unknown", "gross_cash", "net_capital"] as const)(
    "uses reviewed cash for returns without double deductions for %s imports",
    (basis) => {
      const r = receipt();
      r.details.investmentTerms!.importedAmountBasis = basis;
      const context = {
        snapshotId: r.snapshotId,
        currency: "USD",
        committedMinor: 211234,
        fundedMinor: 211234,
        acceptedTerms: null,
        reportedTerms: null,
        reviewedInvestment: reviewedInvestmentFromReceipt(r),
      };
      expect(
        calculatePositionPerformance({
          currentValueMinor: 420000,
          currentValueReported: true,
          realizedValueMinor: 0,
          providerCostBasisMinor: null,
          fundedMinor: 211234,
          economicsContext: context,
          allowFundedAmountEstimate: true,
        }),
      ).toMatchObject({
        costBasisMinor: 240000,
        costBasisSource: "reviewed_spv_terms",
        totalGainMinor: 180000,
        totalReturnPpm: 750000,
      });
      expect(calculatePositionEconomics(context)).toBeNull();
      const stale = calculatePositionPerformance({
        currentValueMinor: 420000,
        currentValueReported: true,
        realizedValueMinor: 0,
        providerCostBasisMinor: null,
        fundedMinor: 211234,
        economicsContext: { ...context, snapshotId: "changed" },
        allowFundedAmountEstimate: true,
      });
      expect(stale.costBasisMinor).toBeNull();
    },
  );
  it("sums multiple tranches only with whole-position cash coverage and keeps partial terms unknown", () => {
    const r = receipt();
    r.details.lots.push({
      ...lot(),
      id: "second",
      grossCashMinor: 120000,
      netCapitalMinor: 100000,
    });
    expect(reviewedInvestmentFromReceipt(r)).toMatchObject({
      cashPaidMinor: 360000,
      netCapitalMinor: 311234,
      upfrontDeductionsMinor: 48766,
      terms: { annualManagementFeePpm: null, carryPpm: 200000 },
    });
    r.details.cashCoversPosition = false;
    expect(reviewedInvestmentFromReceipt(r)?.cashPaidMinor).toBeNull();
    r.details.cashCoversPosition = true;
    r.details.lots[1]!.grossCashMinor = null;
    r.details.lots[1]!.netCapitalMinor = null;
    expect(reviewedInvestmentFromReceipt(r)?.cashPaidMinor).toBeNull();
  });
  it("calculates carry on positive gains only and never charges an after-carry mark again", () => {
    const input = {
      valueMinor: 420000,
      carryStatus: "before_carry" as const,
      cashPaidMinor: 240000,
      netCapitalMinor: 211234,
      carryPpm: 200000,
      carryBasis: "net_capital" as const,
    };
    expect(estimateProceedsAfterCarry(input)).toMatchObject({
      carryMinor: 41753,
      proceedsMinor: 378247,
    });
    expect(
      estimateProceedsAfterCarry({ ...input, valueMinor: 200000 }),
    ).toMatchObject({ carryMinor: 0, proceedsMinor: 200000 });
    expect(
      estimateProceedsAfterCarry({ ...input, carryBasis: "gross_cash" }),
    ).toMatchObject({ carryMinor: 36000 });
    expect(
      estimateProceedsAfterCarry({ ...input, carryStatus: "after_carry" }),
    ).toMatchObject({
      carryMinor: null,
      proceedsMinor: 420000,
      alreadyAfterCarry: true,
    });
    expect(
      estimateProceedsAfterCarry({ ...input, carryStatus: "unknown" }),
    ).toBeNull();
    expect(
      estimateProceedsAfterCarry({ ...input, carryBasis: "unknown" }),
    ).toBeNull();
    expect(estimateProceedsAfterCarry({ ...input, carryPpm: null })).toBeNull();
  });
});
