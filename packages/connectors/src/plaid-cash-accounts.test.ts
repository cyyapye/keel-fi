import { describe, expect, it } from "vitest";

import { normalizePlaidCashAccounts } from "./plaid-cash-accounts";

const observedAt = "2026-08-14T18:00:00.000Z";

function response(accounts: unknown[]): Record<string, unknown> {
  return {
    accounts,
    item: { institution_id: "ins_synthetic", item_id: "item_synthetic" },
    request_id: "request_synthetic",
  };
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    account_id: "account_synthetic_checking",
    persistent_account_id: "persistent_synthetic_checking",
    balances: {
      available: "1234.56",
      current: "1250.00",
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    },
    name: "Household checking",
    official_name: "Synthetic checking",
    subtype: "checking",
    type: "depository",
    ...overrides,
  };
}

async function accountKeyFor(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("normalizePlaidCashAccounts", () => {
  it("prefers the available USD balance and converts with integer arithmetic", async () => {
    const normalized = await normalizePlaidCashAccounts(response([account()]), {
      institutionLabel: "First Synthetic Bank",
      retrievedAt: observedAt,
      accountKeyFor,
    });

    expect(normalized.rows).toEqual([
      expect.objectContaining({
        institutionLabel: "First Synthetic Bank",
        accountLabel: "Household checking",
        subtype: "checking",
        availableMinor: 123_456,
        currentMinor: 125_000,
        valueMinor: 123_456,
        valueState: "reported",
        balanceSource: "available",
        observedAt,
        issues: [],
      }),
    ]);
    expect(normalized.normalizedFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("falls back to current when available is not reported", async () => {
    const normalized = await normalizePlaidCashAccounts(
      response([
        account({
          balances: {
            available: null,
            current: 42.19,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
          },
          subtype: "money market",
        }),
      ]),
      {
        institutionLabel: "First Synthetic Bank",
        retrievedAt: observedAt,
        accountKeyFor,
      },
    );

    expect(normalized.rows[0]).toMatchObject({
      subtype: "money market",
      valueMinor: 4_219,
      valueState: "reported",
      balanceSource: "current",
    });
  });

  it.each([
    {
      name: "negative balance",
      balances: {
        available: "-1.00",
        current: "-1.00",
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      },
      issue: "Negative balances require the later liabilities review.",
    },
    {
      name: "non-USD balance",
      balances: {
        available: "100.00",
        current: "100.00",
        iso_currency_code: "CAD",
        unofficial_currency_code: null,
      },
      issue: "Only USD cash balances are supported.",
    },
  ])("keeps a $name explicit and unusable", async ({ balances, issue }) => {
    const normalized = await normalizePlaidCashAccounts(
      response([account({ balances })]),
      {
        institutionLabel: "First Synthetic Bank",
        retrievedAt: observedAt,
        accountKeyFor,
      },
    );

    expect(normalized.rows[0]).toMatchObject({
      valueMinor: null,
      valueState: "unsupported",
      balanceSource: null,
      issues: [issue],
    });
  });

  it("keeps a missing balance unknown", async () => {
    const normalized = await normalizePlaidCashAccounts(
      response([
        account({
          balances: {
            available: null,
            current: null,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
          },
        }),
      ]),
      {
        institutionLabel: "First Synthetic Bank",
        retrievedAt: observedAt,
        accountKeyFor,
      },
    );

    expect(normalized.rows[0]).toMatchObject({
      valueMinor: null,
      valueState: "unavailable",
      balanceSource: null,
      issues: ["Plaid did not report an available or current balance."],
    });
  });

  it("does not mislabel an unsupported subtype as checking", async () => {
    const normalized = await normalizePlaidCashAccounts(
      response([
        account({
          subtype: "certificate of deposit",
        }),
      ]),
      {
        institutionLabel: "First Synthetic Bank",
        retrievedAt: observedAt,
        accountKeyFor,
      },
    );

    expect(normalized.rows[0]).toMatchObject({
      subtype: "other",
      valueMinor: null,
      valueState: "unsupported",
      issues: ["This account type is not supported as cash yet."],
    });
  });

  it("rejects duplicate persistent account identities", async () => {
    await expect(
      normalizePlaidCashAccounts(
        response([
          account(),
          account({
            account_id: "another_provider_id",
            name: "Second checking",
          }),
        ]),
        {
          institutionLabel: "First Synthetic Bank",
          retrievedAt: observedAt,
          accountKeyFor,
        },
      ),
    ).rejects.toThrow("duplicate cash accounts");
  });
});
