import { describe, expect, it } from "vitest";
import {
  reconcileInvestmentCapital,
  DistributionReviewSchema,
  assessInvestmentCarry,
  summarizeInvestmentCarryCapital,
  reconcileHistoricalProceeds,
  type ReviewedInvestment,
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
    l.capitalReturn!.effectiveDate = null;
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
        capitalReturn: { ...l.capitalReturn!, effectiveDate: "unknown" },
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
    l.upfrontDeductionsMinor = 43_711;
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
      costBasisMinor: 441968,
      totalGainMinor: null,
      totalReturnPpm: null,
    });
    l.capitalReturn!.reportedDistributions = "excluded";
    const excluded = performance(0);
    expect(excluded).toMatchObject({
      costBasisMinor: 441968,
      totalValueMinor: 900000,
      totalGainMinor: 458032,
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
      costBasisMinor: 596289,
      totalValueMinor: 900000,
      totalGainMinor: 303711,
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
    "uses reviewed net capital for returns without double deductions for %s imports",
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
        costBasisMinor: 211234,
        costBasisSource: "reviewed_spv_terms",
        totalGainMinor: 208766,
        totalReturnPpm: 988316,
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
  it("projects complete fee estimates without creating accepted net capital or shares", () => {
    const r = receipt();
    const l = r.details.lots[0]!;
    l.netCapitalMinor = null;
    l.upfrontDeductionsMinor = null;
    l.feePpm = null;
    l.feeBasis = null;
    l.feesComplete = true;
    l.fees = [
      {
        id: "synthetic-fee",
        label: "One-time fee",
        kind: "one_time",
        method: "percentage",
        paymentStatus: "paid",
        treatment: "upfront",
        ratePpm: 100_000,
        paidMinor: null,
        basis: "cash",
        basisMinor: null,
        coveredLotIds: [],
        prepaidMonths: null,
        dueDate: null,
      },
    ];
    const original = JSON.stringify(r);
    expect(reviewedInvestmentFromReceipt(r)).toMatchObject({
      netCapitalMinor: null,
      estimatedNetCapitalMinor: 216_000,
    });
    expect(purchaseShares(l)).toBeNull();
    expect(JSON.stringify(r)).toBe(original);
    l.feesComplete = false;
    expect(
      reviewedInvestmentFromReceipt(r)?.estimatedNetCapitalMinor,
    ).toBeNull();
    l.feesComplete = true;
    l.fees[0]!.basis = "unknown";
    expect(
      reviewedInvestmentFromReceipt(r)?.estimatedNetCapitalMinor,
    ).toBeNull();
    l.fees[0]!.basis = "cash";
    r.details.cashCoversPosition = false;
    expect(
      reviewedInvestmentFromReceipt(r)?.estimatedNetCapitalMinor,
    ).toBeNull();
  });
  it("calculates the unreviewed-history illustration without charging an after-carry value again", () => {
    const investment = {
      snapshotId: "synthetic-snapshot",
      receiptId: "synthetic-receipt",
      cashPaidMinor: 240000,
      netCapitalMinor: 211234,
      upfrontDeductionsMinor: 28766,
      terms: {
        ...unknownInvestmentTerms(),
        carryPpm: 200000,
        carryBasis: "net_capital" as const,
      },
    };
    const input = {
      valueMinor: 420000,
      carryStatus: "before_carry" as const,
      valuationDate: null,
      investment,
    };
    expect(assessInvestmentCarry(input)).toMatchObject({
      method: "legacy_remaining_only",
      carryMinor: 41753,
      proceedsMinor: 378247,
    });
    expect(
      assessInvestmentCarry({ ...input, valueMinor: 200000 }),
    ).toMatchObject({ carryMinor: 0, proceedsMinor: 200000 });
    expect(
      assessInvestmentCarry({
        ...input,
        investment: {
          ...investment,
          terms: { ...investment.terms, carryBasis: "gross_cash" },
        },
      }),
    ).toMatchObject({ carryMinor: 36000 });
    expect(
      assessInvestmentCarry({ ...input, carryStatus: "after_carry" }),
    ).toMatchObject({
      carryMinor: null,
      proceedsMinor: 420000,
      alreadyAfterCarry: true,
    });
    expect(assessInvestmentCarry({ ...input, carryStatus: "unknown" })).toEqual(
      { status: "unavailable", reason: "unknown_source_carry" },
    );
    expect(
      assessInvestmentCarry({
        ...input,
        investment: {
          ...investment,
          terms: { ...investment.terms, carryBasis: "unknown" },
        },
      }),
    ).toEqual({ status: "unavailable", reason: "unknown_capital" });
    expect(
      assessInvestmentCarry({
        ...input,
        investment: {
          ...investment,
          terms: { ...investment.terms, carryPpm: null },
        },
      }),
    ).toEqual({ status: "unavailable", reason: "unknown_carry_rate" });
  });
});

describe("distribution-aware carry", () => {
  const review = () =>
    DistributionReviewSchema.parse({
      method: "capital_return_first_v1",
      events: [
        {
          id: "synthetic-cash",
          kind: "cash",
          receivedOn: "2026-01-15",
          investorValueMinor: 900000,
          sourceLabel: "Synthetic distribution notice",
          sourceUrl: null,
          note: "",
        },
      ],
      coverage: { status: "complete", throughDate: "2026-09-01" },
      priorCarry: { status: "known", amountMinor: 0 },
      provider: {
        inclusion: "none",
        sourceSnapshotId: "synthetic-snapshot",
        realizedValueMinor: 0,
      },
      sourceLabel: "Synthetic reviewed history",
      sourceUrl: null,
      note: "",
    });
  const investment = (): ReviewedInvestment => ({
    snapshotId: "synthetic-snapshot",
    receiptId: "synthetic-receipt",
    cashPaidMinor: 3000000,
    netCapitalMinor: 2700000,
    upfrontDeductionsMinor: 300000,
    terms: {
      ...unknownInvestmentTerms(),
      carryPpm: 200000,
      carryBasis: "gross_cash",
    },
    distributionReview: review(),
  });
  const assess = (
    changes: Partial<Parameters<typeof assessInvestmentCarry>[0]> = {},
  ) =>
    assessInvestmentCarry({
      valueMinor: 4000000,
      carryStatus: "before_carry",
      valuationDate: "2026-09-01",
      investment: investment(),
      ...changes,
    });
  const reconcile = (
    changes: Partial<Parameters<typeof reconcileHistoricalProceeds>[0]> = {},
  ) =>
    reconcileHistoricalProceeds({
      review: review(),
      providerSnapshotId: "synthetic-snapshot",
      realizedValueMinor: 0,
      includedRefundMinor: 0,
      excludedRefundMinor: 0,
      refundReconciliationPending: false,
      asOfDate: "2026-09-01",
      ...changes,
    });

  it("uses contributed capital once and returns the canonical cumulative proceeds", () => {
    expect(assess()).toEqual({
      status: "available",
      method: "cumulative",
      carryMinor: 380000,
      proceedsMinor: 3620000,
      alreadyAfterCarry: false,
    });
    const fees = investment();
    fees.cashPaidMinor = 3100000;
    fees.additionalPaidFeesMinor = 100000;
    expect(assess({ investment: fees })).toMatchObject({ carryMinor: 380000 });
    fees.cashPaidMinor = 3200000;
    fees.returnedCapitalMinor = 100000;
    expect(assess({ investment: fees })).toMatchObject({ carryMinor: 380000 });
  });
  it("keeps investor capital still to return known independently of prior GP carry", () => {
    const value = investment();
    value.distributionReview!.priorCarry = { status: "unknown" };
    expect(
      summarizeInvestmentCarryCapital({
        investment: value,
        asOfDate: "2026-09-01",
      }),
    ).toEqual({
      capitalBasisMinor: 3000000,
      investorDistributionsMinor: 900000,
      capitalRemainingMinor: 2100000,
      historyReason: null,
    });
    expect(assess({ investment: value })).toEqual({
      status: "unavailable",
      reason: "unknown_prior_carry",
    });
    value.distributionReview!.priorCarry = {
      status: "known",
      amountMinor: 100000,
    };
    expect(
      summarizeInvestmentCarryCapital({
        investment: value,
        asOfDate: "2026-09-01",
      }).capitalRemainingMinor,
    ).toBe(2100000);
    value.distributionReview!.events[0]!.investorValueMinor = 4000000;
    expect(
      summarizeInvestmentCarryCapital({
        investment: value,
        asOfDate: "2026-09-01",
      }).capitalRemainingMinor,
    ).toBe(0);
    value.distributionReview!.events[0]!.investorValueMinor = null;
    expect(
      summarizeInvestmentCarryCapital({
        investment: value,
        asOfDate: "2026-09-01",
      }).capitalRemainingMinor,
    ).toBeNull();
    delete value.distributionReview;
    expect(
      summarizeInvestmentCarryCapital({
        investment: value,
        asOfDate: "2026-09-01",
      }),
    ).toMatchObject({
      capitalBasisMinor: 3000000,
      investorDistributionsMinor: null,
      capitalRemainingMinor: null,
      historyReason: "unreviewed_history",
    });
  });

  it("reconstructs gross historical proceeds with prior carry and never credits a clawback", () => {
    const value = investment();
    value.distributionReview!.priorCarry = {
      status: "known",
      amountMinor: 100000,
    };
    expect(assess({ investment: value })).toMatchObject({
      carryMinor: 300000,
      proceedsMinor: 3700000,
    });
    expect(assess({ investment: value, valueMinor: 1 })).toMatchObject({
      carryMinor: 0,
      proceedsMinor: 1,
    });
    value.distributionReview!.events[0]!.investorValueMinor = 10000000;
    expect(assess({ investment: value, valueMinor: 100 })).toEqual({
      status: "unavailable",
      reason: "carry_exceeds_remaining_value",
    });
  });
  it("supports zero and exact hurdles and rounds cumulative carry once", () => {
    expect(assess({ valueMinor: 2100000 })).toMatchObject({
      carryMinor: 0,
      proceedsMinor: 2100000,
    });
    expect(assess({ valueMinor: 1000000 })).toMatchObject({ carryMinor: 0 });
    expect(assess({ valueMinor: 2100003 })).toMatchObject({
      carryMinor: 1,
      proceedsMinor: 2100002,
    });
  });
  it.each([
    [
      "incomplete_history",
      (v: ReviewedInvestment) => {
        v.distributionReview!.coverage.status = "incomplete";
      },
    ],
    [
      "unknown_distribution_value",
      (v: ReviewedInvestment) => {
        v.distributionReview!.events[0]!.investorValueMinor = null;
      },
    ],
    [
      "unknown_prior_carry",
      (v: ReviewedInvestment) => {
        v.distributionReview!.priorCarry = { status: "unknown" };
      },
    ],
    [
      "history_coverage",
      (v: ReviewedInvestment) => {
        v.distributionReview!.coverage.throughDate = "2026-08-01";
      },
    ],
  ] as const)(
    "withholds cumulative carry for %s without burdening after-carry or zero-rate marks",
    (reason, change) => {
      const value = investment();
      change(value);
      expect(assess({ investment: value })).toEqual({
        status: "unavailable",
        reason,
      });
      expect(
        assess({ investment: value, carryStatus: "after_carry" }),
      ).toMatchObject({
        status: "available",
        method: "reported_after_carry",
        proceedsMinor: 4000000,
      });
      value.terms.carryPpm = 0;
      expect(assess({ investment: value })).toMatchObject({
        status: "available",
        method: "zero_carry",
      });
    },
  );
  it("preserves unknown source status, actual valuation dates and explicitly labeled legacy behavior", () => {
    expect(assess({ carryStatus: "unknown" })).toEqual({
      status: "unavailable",
      reason: "unknown_source_carry",
    });
    expect(assess({ valuationDate: null })).toEqual({
      status: "unavailable",
      reason: "missing_valuation_date",
    });
    expect(assess({ valuationDate: "2026-01-01" })).toEqual({
      status: "unavailable",
      reason: "valuation_predates_distribution",
    });
    const value = investment();
    delete value.distributionReview;
    expect(assess({ investment: value })).toMatchObject({
      status: "available",
      method: "legacy_remaining_only",
      carryMinor: 200000,
    });
    value.distributionReview = review();
    value.distributionReview.events = [];
    expect(assess({ investment: value })).toMatchObject({
      status: "available",
      method: "cumulative",
      carryMinor: 200000,
    });
  });
  it("saves unknown-value stock events while retaining strict bounds and dated coverage", () => {
    const value = review();
    value.events = [
      {
        ...value.events[0]!,
        kind: "in_kind",
        securityLabel: "Synthetic common stock",
        quantityMicros: null,
        investorValueMinor: null,
      },
    ];
    expect(DistributionReviewSchema.safeParse(value).success).toBe(true);
    expect(
      assess({ investment: { ...investment(), distributionReview: value } }),
    ).toMatchObject({
      status: "unavailable",
      reason: "unknown_distribution_value",
    });
    expect(
      DistributionReviewSchema.safeParse({
        ...value,
        events: Array.from({ length: 101 }, (_, id) => ({
          ...value.events[0],
          id: `synthetic-${id}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      DistributionReviewSchema.safeParse({
        ...value,
        events: [value.events[0], value.events[0]],
      }).success,
    ).toBe(false);
    expect(
      DistributionReviewSchema.safeParse({
        ...value,
        coverage: { status: "complete", throughDate: "2025-01-01" },
      }).success,
    ).toBe(false);
    expect(
      DistributionReviewSchema.safeParse({
        ...value,
        events: Array.from({ length: 100 }, (_, id) => ({
          ...value.events[0],
          id: `synthetic-${id}`,
          note: "界".repeat(300),
        })),
      }).success,
    ).toBe(false);
    expect(
      DistributionReviewSchema.safeParse({
        ...value,
        events: [
          { ...value.events[0], investorValueMinor: Number.MAX_SAFE_INTEGER },
        ],
        priorCarry: { status: "known", amountMinor: 1 },
      }).success,
    ).toBe(false);
  });
  it("counts included and excluded distributions once and keeps refunds out of net-capital returns", () => {
    expect(reconcile()).toEqual({
      status: "available",
      netDistributionsMinor: 900000,
      paidInDistributionsMinor: 900000,
    });
    const included = review();
    included.provider.inclusion = "all";
    included.provider.realizedValueMinor = 1000000;
    expect(
      reconcile({
        review: included,
        realizedValueMinor: 1000000,
        includedRefundMinor: 100000,
        excludedRefundMinor: 50000,
      }),
    ).toEqual({
      status: "available",
      netDistributionsMinor: 900000,
      paidInDistributionsMinor: 1050000,
    });
    const excluded = review();
    excluded.provider.realizedValueMinor = 100000;
    expect(
      reconcile({
        review: excluded,
        realizedValueMinor: 100000,
        includedRefundMinor: 100000,
        excludedRefundMinor: 50000,
      }),
    ).toEqual({
      status: "available",
      netDistributionsMinor: 900000,
      paidInDistributionsMinor: 1050000,
    });
    excluded.priorCarry = { status: "unknown" };
    expect(
      reconcile({
        review: excluded,
        realizedValueMinor: 100000,
        includedRefundMinor: 100000,
      }),
    ).toMatchObject({ status: "available" });
  });
  it.each(["unknown", "unsupported_mixed"] as const)(
    "withholds dependent performance for %s inclusion independently of carry",
    (inclusion) => {
      const value = review();
      value.provider.inclusion = inclusion;
      expect(reconcile({ review: value }).status).toBe("unavailable");
      expect(
        assess({ investment: { ...investment(), distributionReview: value } })
          .status,
      ).toBe("available");
    },
  );
  it("rejects stale source bindings and unexplained provider residuals", () => {
    expect(reconcile({ realizedValueMinor: null })).toEqual({
      status: "unavailable",
      reason: "unknown_provider_distributions",
    });
    expect(
      reconcile({ providerSnapshotId: "new-synthetic-snapshot" }),
    ).toMatchObject({
      status: "unavailable",
      reason: "provider_binding_stale",
    });
    expect(reconcile({ realizedValueMinor: 1 })).toMatchObject({
      status: "unavailable",
      reason: "provider_binding_stale",
    });
    const value = review();
    value.provider.realizedValueMinor = 1;
    expect(reconcile({ review: value, realizedValueMinor: 1 })).toMatchObject({
      status: "unavailable",
      reason: "provider_amount_mismatch",
    });
  });
});
