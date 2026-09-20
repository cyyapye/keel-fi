import { describe, expect, it } from "vitest";
import {
  PurchaseLotSchema,
  PurchaseReceiptSchema,
  estimatePurchaseValue,
  purchaseCapital,
  purchaseShares,
} from "./position-purchases";
const lot = () =>
  PurchaseLotSchema.parse({
    id: "lot",
    purchasedOn: "2026-01-01",
    shareClass: "Series B",
    priceMicros: 12_500_000,
    referencePriceMicros: 10_000_000,
    grossCashMinor: 11_000,
    netCapitalMinor: 10_000,
    feePpm: 100_000,
    feeBasis: "net_capital",
    feeLabel: "Underlying fund fee",
    remainingSharesMicros: null,
    sharesAsOf: null,
    sourceLabel: "Synthetic subscription",
    sourceUrl: null,
    originalSharesUnchanged: true,
    mark: {
      priceMicros: 20_000_000,
      effectiveDate: "2026-09-01",
      shareClass: "Series B",
      sourceLabel: "Synthetic GP price",
      sourceUrl: null,
    },
  });
const receipt = () =>
  PurchaseReceiptSchema.parse({
    id: "r",
    positionId: "p",
    snapshotId: "s",
    currency: "USD",
    acceptedAt: "2026-09-01T00:00:00.000Z",
    details: { lots: [lot()] },
  });
describe("purchase economics", () => {
  it("keeps price premium in capital, charges added fees once and derives fractional shares", () => {
    expect(purchaseCapital({ ...lot(), netCapitalMinor: null })).toEqual({
      netCapitalMinor: 10000,
      grossCashMinor: 11000,
      conflict: false,
    });
    expect(purchaseShares(lot())).toEqual({
      quantityMicros: 8_000_000,
      derived: true,
    });
    expect(estimatePurchaseValue(receipt(), "s")).toMatchObject({
      valueMinor: 16000,
      grossCashMinor: 11000,
      derivedShares: true,
    });
    expect(
      purchaseCapital({
        ...lot(),
        netCapitalMinor: null,
        feeBasis: "gross_cash",
      }),
    ).toMatchObject({ netCapitalMinor: 9900 });
  });
  it("saves partial optional data but does not invent fees or share exposure", () => {
    const partial = {
      ...lot(),
      grossCashMinor: null,
      netCapitalMinor: null,
      priceMicros: null,
      feeBasis: null,
      feePpm: null,
      mark: null,
    };
    expect(PurchaseLotSchema.safeParse(partial).success).toBe(true);
    expect(purchaseShares(partial)).toBeNull();
    expect(
      purchaseShares({ ...lot(), originalSharesUnchanged: false }),
    ).toBeNull();
    expect(
      PurchaseLotSchema.safeParse({ ...lot(), grossCashMinor: 12000 }).success,
    ).toBe(false);
  });
  it("requires matching class and current reviewed source revision for every lot", () => {
    expect(estimatePurchaseValue(receipt(), "new-snapshot")).toBeNull();
    const r = receipt();
    r.details.lots[0]!.mark!.shareClass = "Common";
    expect(estimatePurchaseValue(r, "s")).toBeNull();
    r.details.lots.push({ ...lot(), id: "second", mark: null });
    expect(estimatePurchaseValue(r, "s")).toBeNull();
  });
  it("uses remaining shares after sales or splits and preserves sub-cent prices", () => {
    const r = receipt();
    r.details.lots[0] = {
      ...lot(),
      remainingSharesMicros: 2_500_000,
      sharesAsOf: "2026-08-31",
      mark: { ...lot().mark!, priceMicros: 1_234_567 },
    };
    expect(estimatePurchaseValue(r, "s")).toMatchObject({
      valueMinor: 309,
      derivedShares: false,
    });
    r.details.lots.push({ ...lot(), id: "second" });
    expect(estimatePurchaseValue(r, "s")).toMatchObject({ valueMinor: 16309 });
  });
  it("rejects malformed numbers, impossible dates and duplicate lots", () => {
    expect(
      PurchaseLotSchema.safeParse({ ...lot(), priceMicros: 12.5 }).success,
    ).toBe(false);
    expect(
      PurchaseLotSchema.safeParse({
        ...lot(),
        remainingSharesMicros: 1,
        sharesAsOf: null,
      }).success,
    ).toBe(false);
    expect(
      PurchaseReceiptSchema.safeParse({
        ...receipt(),
        details: { lots: [lot(), lot()] },
      }).success,
    ).toBe(false);
  });
});
