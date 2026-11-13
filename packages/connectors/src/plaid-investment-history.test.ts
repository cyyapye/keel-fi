import { describe, it, expect } from "vitest";
import {
  normalizePlaidInvestmentTransaction,
  normalizePlaidTaxLot,
} from "./plaid-investment-history";
const purchase = {
  investment_transaction_id: "synthetic-trade",
  account_id: "synthetic-account",
  security_id: "synthetic-security",
  date: "2026-11-09",
  transaction_datetime: "2026-11-06T00:00:00Z",
  name: "Synthetic purchase",
  type: "buy" as const,
  subtype: "buy",
  quantity: "40",
  amount: "6005",
  price: "150",
  fees: "5",
  iso_currency_code: "USD",
  unofficial_currency_code: null,
};
describe("broker investment evidence", () => {
  it("retains minute and fractional timestamp precision in transaction and lot evidence", () => {
    const lot = {
      institution_lot_id: null,
      original_purchase_datetime: null,
      quantity: "40",
      purchase_price: "150",
      cost_basis: "6010",
      current_value: null,
      position_type: "LONG",
    };
    for (const value of [
      "2026-11-06T09:30Z",
      "2026-11-06T09:30+05:30",
      "2026-11-06T09:30:00.123-07:00",
    ]) {
      expect(
        normalizePlaidInvestmentTransaction({
          ...purchase,
          transaction_datetime: value,
        }),
      ).toMatchObject({
        initiatedAt: value,
        initiationPrecision: "provider_supplied_unknown",
      });
      expect(
        normalizePlaidTaxLot({ ...lot, original_purchase_datetime: value }),
      ).toMatchObject({
        acquiredAt: value,
        acquisitionPrecision: "provider_supplied_unknown",
      });
    }
    const invalid = "2026-02-30T09:30Z";
    expect(() =>
      normalizePlaidInvestmentTransaction({
        ...purchase,
        transaction_datetime: invalid,
      }),
    ).toThrow();
    expect(() =>
      normalizePlaidTaxLot({ ...lot, original_purchase_datetime: invalid }),
    ).toThrow();
  });

  it("preserves posting and initiation meaning and counts all-in cash and fees once", () => {
    expect(normalizePlaidInvestmentTransaction(purchase)).toMatchObject({
      postedOn: "2026-11-09",
      initiatedAt: "2026-11-06T00:00:00Z",
      initiationPrecision: "provider_supplied_unknown",
      quantityMicros: 40_000_000,
      unitPriceMicros: 150_000_000,
      feesMinor: 500,
      cashDeltaMinor: -600500,
    });
    expect(
      normalizePlaidInvestmentTransaction({
        ...purchase,
        type: "sell",
        subtype: "sell",
        quantity: "-10",
        amount: "-1800",
        fees: null,
      }).cashDeltaMinor,
    ).toBe(180000);
    expect(
      normalizePlaidInvestmentTransaction({
        ...purchase,
        security_id: null,
        type: "fee",
        subtype: "account fee",
        quantity: "0",
        amount: "0",
        fees: null,
      }).feesMinor,
    ).toBeNull();
    expect(
      normalizePlaidInvestmentTransaction({
        ...purchase,
        quantity: "1.0000004",
      }),
    ).toMatchObject({
      quantityMicros: 1_000_000,
      sourceQuantityDecimal: "1.0000004",
      quantityPrecision: "rounded_to_millionths",
    });
    expect(
      normalizePlaidInvestmentTransaction({ ...purchase, quantity: "1e-6" }),
    ).toMatchObject({
      quantityMicros: 1,
      quantityPrecision: "exact_millionths",
    });
    expect(() =>
      normalizePlaidInvestmentTransaction({
        ...purchase,
        iso_currency_code: "EUR",
      }),
    ).toThrow(/USD/);
  });
  it("keeps adjusted basis separate from acquisition price and missing fields unknown", () => {
    const lot = {
      institution_lot_id: null,
      original_purchase_datetime: null,
      quantity: "40",
      purchase_price: "150",
      cost_basis: "6010",
      current_value: null,
      position_type: "LONG",
    };
    expect(normalizePlaidTaxLot(lot)).toMatchObject({
      providerLotId: null,
      acquiredAt: null,
      quantityMicros: 40_000_000,
      purchasePriceMicros: 150_000_000,
      costBasisMinor: 601000,
      basisPerUnitMicros: 150_250_000,
    });
    expect(
      normalizePlaidTaxLot({ ...lot, quantity: null, cost_basis: null }),
    ).toMatchObject({
      quantityMicros: null,
      costBasisMinor: null,
      basisPerUnitMicros: null,
    });
    expect(() => normalizePlaidTaxLot({ ...lot, quantity: "-1" })).toThrow(
      /negative/,
    );
  });
});
