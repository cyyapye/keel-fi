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
  estimatePurchaseCapital,
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
  const allocationLot = () =>
    PurchaseLotSchema.parse({
      ...lot(),
      grossCashMinor: 640000,
      netCapitalMinor: null,
      upfrontDeductionsMinor: null,
      feePpm: 90000,
      feeBasis: "gross_cash",
      capitalReturn: {
        amountMinor: 154321,
        status: "expected",
        effectiveDate: "2026-03-05",
        reportedDistributions: "unknown",
      },
    });
  it("previews the upfront rate after an expected allocation refund without accepting invested capital or shares", () => {
    const l = allocationLot();
    expect(estimatePurchaseCapital(l)).toEqual({
      retainedCashMinor: 485679,
      upfrontDeductionsMinor: 43711,
      netCapitalMinor: 441968,
      expectedRefund: true,
    });
    expect(purchaseCapital(l)).toMatchObject({
      grossCashMinor: 640000,
      netCapitalMinor: null,
      upfrontDeductionsMinor: null,
    });
    expect(
      purchaseShares({
        ...l,
        priceMicros: 17500000,
        originalSharesUnchanged: true,
      }),
    ).toBeNull();
    const r = receipt();
    r.details.lots = [l];
    expect(reviewedInvestmentFromReceipt(r)).toMatchObject({
      cashPaidMinor: 640000,
      netCapitalMinor: null,
      upfrontDeductionsMinor: null,
      returnedCapitalMinor: 0,
      additionalReturnedCapitalMinor: 0,
    });
    expect(estimatePurchaseCapital({ ...l, feeBasis: null })).toBeNull();
    expect(estimatePurchaseCapital({ ...l, feePpm: null })).toBeNull();
    expect(
      estimatePurchaseCapital({ ...l, feeBasis: "net_capital" })
        ?.netCapitalMinor,
    ).toBe(445577);
  });
  it("reconciles received refunds independently of exact fees and preserves original cash paid", () => {
    const l = allocationLot();
    l.capitalReturn!.status = "received";
    l.netCapitalMinor = 441968;
    l.upfrontDeductionsMinor = 43711;
    l.feePpm = 300000; // An optional component never replaces an exact statement.
    expect(PurchaseLotSchema.safeParse(l).success).toBe(true);
    expect(purchaseCapital(l)).toEqual({
      grossCashMinor: 640000,
      netCapitalMinor: 441968,
      upfrontDeductionsMinor: 43711,
      conflict: false,
    });
    expect(estimatePurchaseCapital(l)).toBeNull();
    expect(
      PurchaseLotSchema.safeParse({ ...l, upfrontDeductionsMinor: 43710 })
        .success,
    ).toBe(false);
    expect(
      PurchaseLotSchema.safeParse({
        ...l,
        capitalReturn: { ...l.capitalReturn!, amountMinor: 640001 },
      }).success,
    ).toBe(false);
    expect(
      PurchaseLotSchema.safeParse({
        ...l,
        capitalReturn: { ...l.capitalReturn!, effectiveDate: null },
      }).success,
    ).toBe(false);
    expect(
      PurchaseLotSchema.safeParse({
        ...l,
        capitalReturn: {
          ...l.capitalReturn!,
          status: "expected",
          reportedDistributions: "included",
        },
      }).success,
    ).toBe(false);
  });
  it("counts a received refund once in returns and withholds gains while its provider inclusion is unknown", () => {
    const r = receipt();
    const l = allocationLot();
    l.capitalReturn!.status = "received";
    r.details.lots = [l];
    const performance = (realizedValueMinor: number) =>
      calculatePositionPerformance({
        currentValueMinor: 900000,
        currentValueReported: true,
        realizedValueMinor,
        providerCostBasisMinor: null,
        fundedMinor: 640000,
        allowFundedAmountEstimate: true,
        economicsContext: {
          snapshotId: r.snapshotId,
          currency: "USD",
          committedMinor: 640000,
          fundedMinor: 640000,
          acceptedTerms: null,
          reportedTerms: null,
          reviewedInvestment: reviewedInvestmentFromReceipt(r),
        },
      });
    expect(performance(0)).toMatchObject({
      costBasisMinor: 640000,
      totalGainMinor: null,
      totalReturnPpm: null,
    });
    l.capitalReturn!.reportedDistributions = "excluded";
    const excluded = performance(0);
    expect(excluded).toMatchObject({
      costBasisMinor: 640000,
      totalValueMinor: 1054321,
      totalGainMinor: 414321,
    });
    l.capitalReturn!.reportedDistributions = "included";
    expect(performance(0)).toMatchObject({
      totalGainMinor: null,
      totalReturnPpm: null,
    });
    expect(performance(154321)).toEqual(excluded);
    l.capitalReturn!.status = "expected";
    l.capitalReturn!.reportedDistributions = "unknown";
    expect(performance(0)).toMatchObject({
      costBasisMinor: 640000,
      totalValueMinor: 900000,
      totalGainMinor: 260000,
    });
  });
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
