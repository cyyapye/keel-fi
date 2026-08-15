import { describe, expect, it } from "vitest";

import {
  cashFlowCategoryLabel,
  defaultCashFlowTreatment,
  normalizePlaidTransactionsSync,
} from "./plaid-cash-flow";

const keyFor = (prefix: string) => (value: string) =>
  Promise.resolve(
    `${prefix}${value}`
      .padEnd(64, prefix)
      .slice(0, 64)
      .replace(/[^a-f0-9]/gu, "a"),
  );

function transaction(
  transactionId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    transaction_id: transactionId,
    account_id: "account-one",
    amount: "125.67",
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    date: "2026-07-18",
    pending: false,
    personal_finance_category: {
      primary: "FOOD_AND_DRINK",
      detailed: "FOOD_AND_DRINK_RESTAURANT",
    },
    name: "must not survive normalization",
    merchant_name: "must not survive normalization",
    location: { city: "Never stored" },
    ...overrides,
  };
}

describe("Plaid observed cash-flow normalization", () => {
  it("normalizes incremental changes without retaining transaction descriptions", async () => {
    const normalized = await normalizePlaidTransactionsSync(
      [
        {
          added: [transaction("transaction-added")],
          modified: [
            transaction("transaction-modified", {
              amount: "-10.25",
              personal_finance_category: {
                primary: "NEW_PROVIDER_CATEGORY",
                detailed: "NEW",
              },
            }),
          ],
          removed: [{ transaction_id: "transaction-removed" }],
          next_cursor: "cursor-two",
          has_more: false,
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
          request_id: "request-one",
        },
      ],
      {
        retrievedAt: "2026-08-15T12:00:00.000Z",
        accountKeyFor: keyFor("b"),
        transactionKeyFor: keyFor("c"),
      },
    );

    expect(normalized.mutations).toHaveLength(3);
    expect(normalized.mutations[0]).toMatchObject({
      mutation: "added",
      amountMinor: 12_567,
      month: "2026-07",
      category: "FOOD_AND_DRINK",
      currencySupported: true,
    });
    expect(normalized.mutations[1]).toMatchObject({
      mutation: "modified",
      amountMinor: -1_025,
      category: "OTHER",
    });
    expect(normalized.mutations[2]).toEqual(
      expect.objectContaining({
        mutation: "removed",
        accountKeySha256: null,
        effectiveDate: null,
        amountMinor: null,
        category: null,
      }),
    );
    expect(JSON.stringify(normalized)).not.toContain("must not survive");
    expect(normalized.normalizedFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps non-USD amounts unavailable and rejects duplicate mutations", async () => {
    const foreign = await normalizePlaidTransactionsSync(
      [
        {
          added: [
            transaction("foreign", {
              amount: "99.95",
              iso_currency_code: "EUR",
            }),
          ],
          modified: [],
          removed: [],
          next_cursor: "cursor-foreign",
          has_more: false,
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
          request_id: "request-foreign",
        },
      ],
      {
        retrievedAt: "2026-08-15T12:00:00.000Z",
        accountKeyFor: keyFor("d"),
        transactionKeyFor: keyFor("e"),
      },
    );
    expect(foreign.mutations[0]).toMatchObject({
      amountMinor: null,
      currencySupported: false,
    });

    await expect(
      normalizePlaidTransactionsSync(
        [
          {
            added: [transaction("duplicate")],
            modified: [transaction("duplicate")],
            removed: [],
            next_cursor: "cursor-duplicate",
            has_more: false,
            transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
            request_id: "request-duplicate",
          },
        ],
        {
          retrievedAt: "2026-08-15T12:00:00.000Z",
          accountKeyFor: keyFor("f"),
          transactionKeyFor: keyFor("a"),
        },
      ),
    ).rejects.toThrow("duplicate transaction mutation");
  });

  it("defaults transfers and loan payments away from ordinary burn", () => {
    expect(defaultCashFlowTreatment("LOAN_PAYMENTS")).toBe("debt_payment");
    expect(defaultCashFlowTreatment("TRANSFER_OUT")).toBe("excluded");
    expect(defaultCashFlowTreatment("FOOD_AND_DRINK")).toBe("household");
    expect(cashFlowCategoryLabel("RENT_AND_UTILITIES")).toBe(
      "Rent and utilities",
    );
  });

  it("rejects a provider page that exceeds the requested mutation count", async () => {
    await expect(
      normalizePlaidTransactionsSync(
        [
          {
            added: Array.from({ length: 500 }, (_, index) =>
              transaction(`bounded-${index}`),
            ),
            modified: [transaction("one-too-many")],
            removed: [],
            next_cursor: "cursor-oversized",
            has_more: false,
            transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
            request_id: "request-oversized",
          },
        ],
        {
          retrievedAt: "2026-08-15T12:00:00.000Z",
          accountKeyFor: keyFor("b"),
          transactionKeyFor: keyFor("c"),
        },
      ),
    ).rejects.toThrow();
  });
});
