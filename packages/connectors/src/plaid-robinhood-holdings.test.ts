import { describe, expect, it } from "vitest";

import {
  normalizeRobinhoodHoldings,
  plaidDecimalToScaledInteger,
} from "./plaid-robinhood-holdings";

function syntheticResponse(
  options: {
    costBasis?: number | null;
    currency?: string;
    quantity?: number;
    requestId?: string;
    securityType?: string;
  } = {},
) {
  return {
    accounts: [
      {
        account_id: "synthetic-account-id",
        persistent_account_id: "synthetic-persistent-account-id",
        name: "Synthetic Brokerage",
        official_name: "Synthetic Brokerage Account",
        subtype: "brokerage",
        type: "investment",
      },
    ],
    holdings: [
      {
        account_id: "synthetic-account-id",
        security_id: "synthetic-security-id",
        institution_value: 1234.565,
        cost_basis:
          options.costBasis === undefined ? 1000.004 : options.costBasis,
        quantity: options.quantity ?? 12.3456784,
        institution_price_as_of: "2026-08-08",
        iso_currency_code: options.currency ?? "USD",
        unofficial_currency_code: null,
      },
    ],
    securities: [
      {
        security_id: "synthetic-security-id",
        name: "Synthetic Public Company",
        ticker_symbol: "SYN",
        type: options.securityType ?? "equity",
        cusip: "000000000",
        isin: null,
        sedol: null,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      },
    ],
    item: {
      institution_id: "synthetic-robinhood-institution",
      item_id: "synthetic-item-id",
    },
    request_id: options.requestId ?? "synthetic-request-id",
  };
}

describe("Plaid Robinhood holdings normalization", () => {
  it("rounds provider decimals with exact integer arithmetic", () => {
    expect(plaidDecimalToScaledInteger("1234.565", 2)).toBe(123_457);
    expect(plaidDecimalToScaledInteger(1000.004, 2)).toBe(100_000);
    expect(plaidDecimalToScaledInteger("12.3456784", 6)).toBe(12_345_678);
    expect(plaidDecimalToScaledInteger("1.23456785e2", 6)).toBe(123_456_785);
  });

  it("creates a stable, reviewable public holding without provider identifiers", async () => {
    const result = await normalizeRobinhoodHoldings(
      syntheticResponse(),
      "2026-08-10T12:00:00.000Z",
    );

    expect(result).toMatchObject({
      provider: "robinhood",
      formatVersion: 1,
      effectiveDate: "2026-08-08",
      normalizedFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      rows: [
        {
          rowNumber: 1,
          naturalKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          securityName: "Synthetic Public Company",
          ticker: "SYN",
          securityType: "equity",
          accountLabel: "Robinhood brokerage",
          quantityMicros: 12_345_678,
          costBasisMinor: 100_000,
          marketValueMinor: 123_457,
          observedOn: "2026-08-08",
          currency: "USD",
          issues: [],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-account-id");
    expect(JSON.stringify(result)).not.toContain("synthetic-security-id");
    expect(JSON.stringify(result)).not.toContain("synthetic-item-id");
  });

  it("deduplicates unchanged holdings despite request metadata changes", async () => {
    const first = await normalizeRobinhoodHoldings(
      syntheticResponse(),
      "2026-08-10T12:00:00.000Z",
    );
    const second = await normalizeRobinhoodHoldings(
      syntheticResponse({ requestId: "another-synthetic-request" }),
      "2026-08-11T12:00:00.000Z",
    );

    expect(second.normalizedFingerprint).toBe(first.normalizedFingerprint);
  });

  it("marks missing cost basis and unsupported instruments for exclusion", async () => {
    const result = await normalizeRobinhoodHoldings(
      syntheticResponse({ costBasis: null, securityType: "option" }),
      "2026-08-10T12:00:00.000Z",
    );

    expect(result.rows[0]?.issues).toEqual([
      "Cost basis is unavailable.",
      "option positions are not supported yet.",
    ]);
  });

  it("recognizes crypto as recordable evidence outside FI planning", async () => {
    const result = await normalizeRobinhoodHoldings(
      syntheticResponse({ securityType: "cryptocurrency" }),
      "2026-08-10T12:00:00.000Z",
    );

    expect(result.rows[0]?.issues).toEqual([
      "Crypto is recorded outside the FI plan.",
    ]);
  });

  it("fails closed for non-USD and short positions", async () => {
    await expect(
      normalizeRobinhoodHoldings(
        syntheticResponse({ currency: "EUR" }),
        "2026-08-10T12:00:00.000Z",
      ),
    ).rejects.toThrow("USD holdings only");

    await expect(
      normalizeRobinhoodHoldings(
        syntheticResponse({ quantity: -1 }),
        "2026-08-10T12:00:00.000Z",
      ),
    ).rejects.toThrow("short positions");
  });
});
