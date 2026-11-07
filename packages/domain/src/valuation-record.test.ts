import { describe, expect, it } from "vitest";
import { InvestmentFeeSchema, investmentFeeAmount } from "./investment-fees";
import { ValuationRecordSchema } from "./valuation-record";
import {
  PurchaseLotSchema,
  PurchaseReceiptSchema,
  calculateValuationFromShares,
  selectedPositionValuation,
  valuationSharesKey,
} from "./position-purchases";
const lot = () =>
  PurchaseLotSchema.parse({
    id: "a",
    purchasedOn: "2025-06-10",
    shareClass: "Preferred",
    priceMicros: 100_000_000,
    referencePriceMicros: null,
    grossCashMinor: 1_000_000,
    netCapitalMinor: 844_000,
    upfrontDeductionsMinor: 56_000,
    feePpm: null,
    feeBasis: null,
    feeLabel: null,
    remainingSharesMicros: 84_400_000,
    sharesAsOf: "2026-01-01",
    sourceLabel: "Synthetic subscription",
    sourceUrl: null,
    mark: null,
    capitalReturn: {
      amountMinor: 100_000,
      status: "received",
      effectiveDate: null,
      reportedDistributions: "excluded",
    },
  });
const record = () =>
  ValuationRecordSchema.parse({
    id: "gp",
    origin: "gp",
    totalMinor: 1_748_000,
    priceMicros: 200_000_000,
    effectiveDate: "2026-09-30",
    priceDate: "2026-09-15",
    shareClass: "Preferred",
    carryStatus: "before_carry",
    sourceLabel: "Synthetic GP",
    sourceUrl: null,
    sourceEvidenceId: null,
    sourcePositionId: null,
    sourceCapturedAt: null,
    watchEvidenceId: null,
  });
const receipt = () =>
  PurchaseReceiptSchema.parse({
    id: "r",
    positionId: "p",
    snapshotId: "s",
    currency: "USD",
    acceptedAt: "2026-10-01T00:00:00Z",
    details: {
      coversPosition: true,
      cashCoversPosition: true,
      lots: [lot()],
      valuation: { snapshotId: "s", records: [record()], selected: null },
    },
  });
describe("independent valuation facts", () => {
  it.each(["h", "https", "https:", "https:/", "https://", "https://["])(
    "returns a validation failure for an unfinished source link: %s",
    (sourceUrl) => {
      expect(
        ValuationRecordSchema.safeParse({ ...record(), sourceUrl }).success,
      ).toBe(false);
    },
  );
  it("uses canonical investment shares, retains a different GP total and dates the chosen fact", () => {
    const r = receipt();
    expect(calculateValuationFromShares(r.details, record())).toEqual({
      valueMinor: 1_688_000,
      quantityMicros: 84_400_000,
      estimatedShares: false,
    });
    r.details.valuation!.selected = {
      recordId: "gp",
      method: "shares",
      sharesKey: valuationSharesKey(r.details),
    };
    expect(selectedPositionValuation(r, "s")).toMatchObject({
      valueMinor: 1_688_000,
      effectiveDate: "2026-09-15",
      totalMinor: 1_748_000,
    });
    r.details.valuation!.selected.method = "total";
    expect(selectedPositionValuation(r, "s")).toMatchObject({
      valueMinor: 1_748_000,
      effectiveDate: "2026-09-30",
    });
    expect(r.details.lots[0]!.remainingSharesMicros).toBe(84_400_000);
  });
  it("invalidates ownership changes, retains metadata edits and does not double apply carry", () => {
    const r = receipt();
    r.details.valuation!.records[0]!.carryStatus = "after_carry";
    r.details.valuation!.selected = {
      recordId: "gp",
      method: "shares",
      sharesKey: valuationSharesKey(r.details),
    };
    r.details.lots[0]!.purchasedOn = "2025-06-11";
    expect(selectedPositionValuation(r, "s")?.carryStatus).toBe("before_carry");
    r.details.lots[0]!.remainingSharesMicros = 80_000_000;
    expect(selectedPositionValuation(r, "s")).toBeNull();
    r.details.valuation!.selected.method = "total";
    expect(selectedPositionValuation(r, "s")?.carryStatus).toBe("after_carry");
    expect(selectedPositionValuation(r, "different-snapshot")).toBeNull();
  });
  it("allows partial investment records but never values undated, partial or mismatched shares", () => {
    const r = receipt();
    r.details.lots[0]!.sharesAsOf = null;
    expect(PurchaseReceiptSchema.safeParse(r).success).toBe(true);
    expect(calculateValuationFromShares(r.details, record())).toBeNull();
    r.details.lots[0]!.sharesAsOf = "2026-09-20";
    expect(calculateValuationFromShares(r.details, record())).toBeNull();
    r.details.lots[0]!.sharesAsOf = "2026-01-01";
    expect(
      calculateValuationFromShares(r.details, {
        ...record(),
        shareClass: "Common",
      }),
    ).toBeNull();
    expect(
      calculateValuationFromShares(
        { ...r.details, coversPosition: false },
        record(),
      ),
    ).toBeNull();
  });
  it("rejects transferring another vehicle total and malformed fact dates", () => {
    expect(
      ValuationRecordSchema.safeParse({ ...record(), origin: "proxy" }).success,
    ).toBe(false);
    expect(
      ValuationRecordSchema.safeParse({ ...record(), priceDate: null }).success,
    ).toBe(true);
    expect(
      ValuationRecordSchema.safeParse({
        ...record(),
        effectiveDate: "2026-02-30",
      }).success,
    ).toBe(false);
  });
});
it("calculates prepaid fees with integer rates and months without compounding or inventing a basis", () => {
  const f = InvestmentFeeSchema.parse({
    id: "m",
    kind: "management",
    label: "Management fee",
    method: "percentage",
    paidMinor: null,
    ratePpm: 20_000,
    basis: "retained",
    basisMinor: null,
    prepaidMonths: 24,
  });
  const capital = {
    grossCashMinor: 1_000_000,
    refundMinor: 100_000,
    netCapitalMinor: null,
  };
  expect(investmentFeeAmount(f, capital)).toBe(36_000);
  expect(investmentFeeAmount({ ...f, prepaidMonths: 1 }, capital)).toBe(1_500);
  expect(
    investmentFeeAmount({ ...f, basis: "net_capital" }, capital),
  ).toBeNull();
  expect(
    investmentFeeAmount(
      { ...f, basis: "net_capital", basisMinor: 844_000 },
      capital,
    ),
  ).toBe(33_760);
  expect(
    investmentFeeAmount({ ...f, method: "paid", paidMinor: 36_000 }, capital),
  ).toBe(36_000);
});
