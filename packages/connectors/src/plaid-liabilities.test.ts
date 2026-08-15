import { describe, expect, it } from "vitest";

import {
  normalizePlaidLiabilities,
  type PlaidLiabilitiesResponse,
} from "./plaid-liabilities";

const retrievedAt = "2026-08-14T18:00:00.000Z";

function account(
  accountId: string,
  name: string,
  type: string,
  subtype: string,
  current: number | string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    account_id: accountId,
    persistent_account_id: `persistent_${accountId}`,
    balances: {
      available: null,
      current,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    },
    name,
    official_name: null,
    type,
    subtype,
    ...overrides,
  };
}

function response(): PlaidLiabilitiesResponse {
  return {
    accounts: [
      account("card", "Household card", "credit", "credit card", "3000.00"),
      account("mortgage", "Home loan", "loan", "mortgage", "240000.00"),
      account("student", "Graduate loan", "loan", "student", "40000.00"),
    ],
    item: { institution_id: "ins_synthetic", item_id: "item_synthetic" },
    liabilities: {
      credit: [
        {
          account_id: "card",
          aprs: [
            { apr_percentage: "12.5", apr_type: "purchase_apr" },
            { apr_percentage: "27.95", apr_type: "cash_apr" },
          ],
          is_overdue: false,
          last_statement_issue_date: "2026-08-01",
          minimum_payment_amount: "125.00",
          next_payment_due_date: "2026-08-28",
        },
      ],
      mortgage: [
        {
          account_id: "mortgage",
          current_late_fee: null,
          interest_rate: { percentage: "4.25", type: "fixed" },
          next_monthly_payment: "2000.00",
          next_payment_due_date: "2026-09-01",
          past_due_amount: "2500.00",
        },
      ],
      student: [
        {
          account_id: "student",
          interest_rate_percentage: "5.25",
          is_overdue: false,
          last_statement_issue_date: "2026-07-31",
          minimum_payment_amount: "450.00",
          next_payment_due_date: "2026-09-10",
        },
      ],
    },
    request_id: "request_synthetic",
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

describe("normalizePlaidLiabilities", () => {
  it("normalizes supported debt facts with integer money and rates", async () => {
    const normalized = await normalizePlaidLiabilities(response(), {
      institutionLabel: "First Synthetic Bank",
      retrievedAt,
      accountKeyFor,
    });

    expect(normalized.rows).toEqual([
      expect.objectContaining({
        accountLabel: "Household card",
        kind: "credit_card",
        classification: "revolving",
        balanceMinor: 300_000,
        valueState: "reported",
        paymentMinor: 12_500,
        interestRatePpm: 279_500,
        effectiveDate: "2026-08-01",
        issues: [],
      }),
      expect.objectContaining({
        accountLabel: "Home loan",
        kind: "mortgage",
        classification: "scheduled",
        balanceMinor: 24_000_000,
        paymentMinor: 250_000,
        interestRatePpm: 42_500,
        isOverdue: true,
        effectiveDate: "2026-08-14",
      }),
      expect.objectContaining({
        accountLabel: "Graduate loan",
        kind: "student_loan",
        classification: "scheduled",
        balanceMinor: 4_000_000,
        paymentMinor: 45_000,
        interestRatePpm: 52_500,
        effectiveDate: "2026-07-31",
      }),
    ]);
    expect(normalized.normalizedFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps absent values unknown without inferring repayment", async () => {
    const raw = response();
    raw.accounts = [
      account("student", "Graduate loan", "loan", "student", null),
    ];
    raw.liabilities.credit = [];
    raw.liabilities.mortgage = [];
    raw.liabilities.student = [
      {
        account_id: "student",
        interest_rate_percentage: null,
        is_overdue: null,
        last_statement_issue_date: null,
        minimum_payment_amount: null,
        next_payment_due_date: null,
      },
    ];

    const normalized = await normalizePlaidLiabilities(raw, {
      institutionLabel: "First Synthetic Bank",
      retrievedAt,
      accountKeyFor,
    });
    expect(normalized.rows[0]).toMatchObject({
      balanceMinor: null,
      valueState: "unavailable",
      paymentMinor: null,
      interestRatePpm: null,
      effectiveDate: "2026-08-14",
      issues: [
        "Plaid did not report the outstanding balance.",
        "No next payment was reported; planning impact stays unknown.",
      ],
    });
  });

  it("rejects unsupported currency and duplicate liability identities", async () => {
    const nonUsd = response();
    nonUsd.accounts[0] = account(
      "card",
      "Household card",
      "credit",
      "credit card",
      "3000.00",
      {
        balances: {
          current: "3000.00",
          iso_currency_code: "CAD",
          unofficial_currency_code: null,
        },
      },
    );
    const normalized = await normalizePlaidLiabilities(nonUsd, {
      institutionLabel: "First Synthetic Bank",
      retrievedAt,
      accountKeyFor,
    });
    expect(normalized.rows[0]).toMatchObject({
      balanceMinor: null,
      valueState: "unsupported",
      issues: ["Only USD liabilities are supported."],
    });

    const duplicate = response();
    duplicate.liabilities.student?.push({
      account_id: "card",
      interest_rate_percentage: "5.00",
      is_overdue: false,
      last_statement_issue_date: "2026-08-01",
      minimum_payment_amount: "10.00",
      next_payment_due_date: "2026-09-01",
    });
    await expect(
      normalizePlaidLiabilities(duplicate, {
        institutionLabel: "First Synthetic Bank",
        retrievedAt,
        accountKeyFor,
      }),
    ).rejects.toThrow("duplicate liabilities");
  });
});
