import {
  CashAccountSubtypeSchema,
  CashAccountValueStateSchema,
  CashBalanceSourceSchema,
  IsoTimestampSchema,
  type CashAccountSubtype,
  type CashAccountValueState,
  type CashBalanceSource,
} from "@keel/domain";
import { z } from "zod";

import { plaidDecimalToScaledInteger } from "./plaid-investments-holdings";

const MAX_PLAID_CASH_ACCOUNTS = 100;

const PlaidDecimalSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u),
]);

const PlaidCashAccountSchema = z
  .object({
    account_id: z.string().min(1).max(512),
    persistent_account_id: z.string().min(1).max(512).nullable().optional(),
    balances: z
      .object({
        available: PlaidDecimalSchema.nullable(),
        current: PlaidDecimalSchema.nullable(),
        iso_currency_code: z.string().length(3).nullable(),
        unofficial_currency_code: z.string().min(1).max(32).nullable(),
      })
      .passthrough(),
    name: z.string().trim().min(1).max(512),
    official_name: z.string().trim().min(1).max(512).nullable(),
    subtype: z.string().min(1).max(128).nullable(),
    type: z.string().min(1).max(128),
  })
  .passthrough();

export const PlaidCashAccountsResponseSchema = z
  .object({
    accounts: z.array(PlaidCashAccountSchema).max(MAX_PLAID_CASH_ACCOUNTS),
    item: z
      .object({
        institution_id: z.string().min(1).max(512).nullable(),
        item_id: z.string().min(1).max(512),
      })
      .passthrough(),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

export const NormalizedCashAccountSchema = z
  .object({
    naturalKeySha256: z.string().regex(/^[a-f0-9]{64}$/u),
    itemAccountKeySha256: z.string().regex(/^[a-f0-9]{64}$/u),
    institutionLabel: z.string().min(1).max(512),
    accountLabel: z.string().min(1).max(512),
    subtype: CashAccountSubtypeSchema,
    availableMinor: z.number().int().safe().nullable(),
    currentMinor: z.number().int().safe().nullable(),
    valueMinor: z.number().int().safe().nonnegative().nullable(),
    valueState: CashAccountValueStateSchema,
    balanceSource: CashBalanceSourceSchema.nullable(),
    observedAt: IsoTimestampSchema,
    issues: z.array(z.string().min(1).max(240)).max(5),
  })
  .strict();

export const NormalizedCashAccountsSchema = z
  .object({
    normalizedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    observedAt: IsoTimestampSchema,
    rows: z.array(NormalizedCashAccountSchema).max(MAX_PLAID_CASH_ACCOUNTS),
  })
  .strict();

export type PlaidCashAccountsResponse = z.infer<
  typeof PlaidCashAccountsResponseSchema
>;
export type NormalizedCashAccount = z.infer<typeof NormalizedCashAccountSchema>;
export type NormalizedCashAccounts = z.infer<
  typeof NormalizedCashAccountsSchema
>;

const supportedSubtypes = new Set<CashAccountSubtype>([
  "checking",
  "savings",
  "money market",
  "cash management",
]);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizedSubtype(rawSubtype: string | null): CashAccountSubtype {
  const normalized = rawSubtype?.toLowerCase() ?? "";
  return CashAccountSubtypeSchema.parse(
    supportedSubtypes.has(normalized as CashAccountSubtype)
      ? normalized
      : "other",
  );
}

function normalizedBalance(input: {
  accountType: string;
  accountSubtype: string | null;
  available: number | string | null;
  current: number | string | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
}): {
  availableMinor: number | null;
  currentMinor: number | null;
  valueMinor: number | null;
  valueState: CashAccountValueState;
  balanceSource: CashBalanceSource | null;
  issues: string[];
} {
  const availableMinor =
    input.available === null
      ? null
      : plaidDecimalToScaledInteger(input.available, 2);
  const currentMinor =
    input.current === null
      ? null
      : plaidDecimalToScaledInteger(input.current, 2);
  const issues: string[] = [];
  const subtype = input.accountSubtype?.toLowerCase() ?? "";
  if (
    input.accountType.toLowerCase() !== "depository" ||
    !supportedSubtypes.has(subtype as CashAccountSubtype)
  ) {
    issues.push("This account type is not supported as cash yet.");
  }
  if (
    input.isoCurrencyCode !== "USD" ||
    input.unofficialCurrencyCode !== null
  ) {
    issues.push("Only USD cash balances are supported.");
  }
  if (
    (availableMinor !== null && availableMinor < 0) ||
    (currentMinor !== null && currentMinor < 0)
  ) {
    issues.push("Negative balances require the later liabilities review.");
  }
  if (issues.length > 0) {
    return {
      availableMinor,
      currentMinor,
      valueMinor: null,
      valueState: "unsupported",
      balanceSource: null,
      issues,
    };
  }
  if (availableMinor !== null) {
    return {
      availableMinor,
      currentMinor,
      valueMinor: availableMinor,
      valueState: "reported",
      balanceSource: "available",
      issues,
    };
  }
  if (currentMinor !== null) {
    return {
      availableMinor,
      currentMinor,
      valueMinor: currentMinor,
      valueState: "reported",
      balanceSource: "current",
      issues,
    };
  }
  return {
    availableMinor,
    currentMinor,
    valueMinor: null,
    valueState: "unavailable",
    balanceSource: null,
    issues: ["Plaid did not report an available or current balance."],
  };
}

export async function normalizePlaidCashAccounts(
  raw: unknown,
  input: {
    institutionLabel: string;
    retrievedAt: string;
    accountKeyFor: (providerAccountId: string) => Promise<string>;
  },
): Promise<NormalizedCashAccounts> {
  const response = PlaidCashAccountsResponseSchema.parse(raw);
  const institutionLabel = z
    .string()
    .trim()
    .min(1)
    .max(512)
    .parse(input.institutionLabel);
  const observedAt = IsoTimestampSchema.parse(input.retrievedAt);
  const providerAccountIds = response.accounts.map(
    (account) => account.persistent_account_id ?? account.account_id,
  );
  if (new Set(providerAccountIds).size !== providerAccountIds.length) {
    throw new Error("Plaid returned duplicate cash accounts.");
  }

  const rows = await Promise.all(
    response.accounts.map(async (account) => {
      const balance = normalizedBalance({
        accountType: account.type,
        accountSubtype: account.subtype,
        available: account.balances.available,
        current: account.balances.current,
        isoCurrencyCode: account.balances.iso_currency_code,
        unofficialCurrencyCode: account.balances.unofficial_currency_code,
      });
      const [naturalKeySha256, itemAccountKeySha256] = await Promise.all([
        input.accountKeyFor(
          account.persistent_account_id ?? account.account_id,
        ),
        input.accountKeyFor(account.account_id),
      ]);
      return NormalizedCashAccountSchema.parse({
        naturalKeySha256,
        itemAccountKeySha256,
        institutionLabel,
        accountLabel: account.name,
        subtype: normalizedSubtype(account.subtype),
        ...balance,
        observedAt,
      });
    }),
  );
  const stableRows = [...rows]
    .sort((left, right) =>
      left.naturalKeySha256.localeCompare(right.naturalKeySha256),
    )
    .map((row) => ({
      naturalKeySha256: row.naturalKeySha256,
      itemAccountKeySha256: row.itemAccountKeySha256,
      institutionLabel: row.institutionLabel,
      accountLabel: row.accountLabel,
      subtype: row.subtype,
      availableMinor: row.availableMinor,
      currentMinor: row.currentMinor,
      valueMinor: row.valueMinor,
      valueState: row.valueState,
      balanceSource: row.balanceSource,
      issues: row.issues,
    }));

  return NormalizedCashAccountsSchema.parse({
    normalizedFingerprint: await sha256(
      JSON.stringify(["plaid-cash-accounts-v1", stableRows]),
    ),
    observedAt,
    rows,
  });
}
