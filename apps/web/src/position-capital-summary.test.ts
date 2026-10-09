import { describe, expect, it } from "vitest";
import {
  PurchaseLotSchema,
  PurchaseReceiptSchema,
  purchaseShares,
  reviewedInvestmentFromReceipt,
} from "@keel/domain/position-purchases";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";
import {
  positionCapitalSummary,
  purchaseCapitalSummary,
} from "./position-capital-summary";

const lot = (overrides = {}) =>
  PurchaseLotSchema.parse({
    id: "synthetic-capital-lot",
    purchasedOn: null,
    shareClass: "Common",
    priceMicros: 10_000_000,
    referencePriceMicros: null,
    grossCashMinor: 100_000,
    netCapitalMinor: null,
    upfrontDeductionsMinor: null,
    feePpm: 90_000,
    feeBasis: null,
    feeLabel: "One-time fee",
    originalSharesUnchanged: true,
    remainingSharesMicros: null,
    sharesAsOf: null,
    sourceLabel: null,
    sourceUrl: null,
    mark: null,
    capitalReturn: {
      amountMinor: 20_000,
      status: "received",
      effectiveDate: null,
      reportedDistributions: "unknown",
    },
    ...overrides,
  });
const receipt = (lots = [lot()], cashCoversPosition = true) =>
  PurchaseReceiptSchema.parse({
    id: "synthetic-capital-receipt",
    householdId: "synthetic-household",
    positionId: "synthetic-position",
    snapshotId: "current",
    currency: "USD",
    acceptedAt: "2026-01-01T00:00:00Z",
    details: {
      lots,
      cashCoversPosition,
      coversPosition: false,
      investmentTerms: unknownInvestmentTerms(),
    },
  });

describe("position capital display", () => {
  it("deducts received refunds and conservatively estimates an unclassified one-time fee without creating accepted capital or shares", () => {
    const source = lot();
    const before = JSON.stringify(source);
    expect(purchaseCapitalSummary(source)).toEqual({
      amountMinor: 72_800,
      upfrontFeesMinor: 7_200,
      kind: "estimated_net",
      assumedFeeBasis: true,
    });
    expect(JSON.stringify(source)).toBe(before);
    expect(purchaseShares(source)).toBeNull();
    expect(
      reviewedInvestmentFromReceipt(receipt())!.netCapitalMinor,
    ).toBeNull();
  });
  it("respects a recorded markup basis and rounds money using integer arithmetic", () => {
    expect(
      purchaseCapitalSummary(lot({ feeBasis: "net_capital" })),
    ).toMatchObject({
      amountMinor: 73_394,
      upfrontFeesMinor: 6_606,
      kind: "estimated_net",
      assumedFeeBasis: false,
    });
  });
  it("does not subtract promised refunds from current invested capital", () => {
    expect(
      purchaseCapitalSummary(
        lot({
          capitalReturn: {
            amountMinor: 20_000,
            status: "expected",
            effectiveDate: "2026-02-01",
            reportedDistributions: "unknown",
          },
        }),
      ),
    ).toMatchObject({
      amountMinor: 91_000,
      upfrontFeesMinor: 9_000,
      kind: "estimated_net",
    });
  });
  it("uses confirmed total deductions once, including any prepaid management and setup fees", () => {
    expect(
      purchaseCapitalSummary(
        lot({
          upfrontDeductionsMinor: 10_000,
          feePpm: 90_000,
          reportedManagementFeePpm: 20_000,
        }),
      ),
    ).toEqual({
      amountMinor: 70_000,
      upfrontFeesMinor: 10_000,
      kind: "net",
      assumedFeeBasis: false,
    });
  });
  it("preserves missing fee amounts instead of treating them as zero", () => {
    expect(purchaseCapitalSummary(lot({ feePpm: null }))).toEqual({
      amountMinor: 80_000,
      upfrontFeesMinor: null,
      kind: "before_fees",
      assumedFeeBasis: false,
    });
  });
  it("recognizes an explicitly confirmed zero deduction", () => {
    expect(
      purchaseCapitalSummary(lot({ upfrontDeductionsMinor: 0, feePpm: 0 })),
    ).toMatchObject({ amountMinor: 80_000, upfrontFeesMinor: 0, kind: "net" });
  });
  it("aggregates multiple purchases without upgrading estimates to confirmed capital", () => {
    expect(
      positionCapitalSummary(
        receipt([
          lot(),
          lot({ id: "synthetic-lot-2", feeBasis: "net_capital" }),
        ]),
        "current",
      ),
    ).toEqual({
      amountMinor: 146_194,
      upfrontFeesMinor: 13_806,
      kind: "estimated_net",
      assumedFeeBasis: true,
    });
  });
  it("keeps incomplete-fee totals distinct from estimated net totals", () => {
    expect(
      positionCapitalSummary(
        receipt([lot(), lot({ id: "synthetic-lot-2", feePpm: null })]),
        "current",
      ),
    ).toMatchObject({
      amountMinor: 152_800,
      upfrontFeesMinor: null,
      kind: "before_fees",
    });
  });
  it("does not expose stale or partial purchase totals as position capital", () => {
    expect(positionCapitalSummary(receipt(), "new-source")).toBeNull();
    expect(
      positionCapitalSummary(receipt([lot()], false), "current"),
    ).toBeNull();
  });
  it("omits missing capital rather than filling in an amount", () => {
    expect(
      purchaseCapitalSummary(
        lot({ grossCashMinor: null, capitalReturn: undefined }),
      ),
    ).toMatchObject({ amountMinor: null, upfrontFeesMinor: null });
  });
});
