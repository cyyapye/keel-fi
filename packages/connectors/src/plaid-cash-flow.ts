import {
  CashFlowCategorySchema,
  CashFlowTreatmentSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  type CashFlowCategory,
  type CashFlowTreatment,
} from "@keel/domain";
import { z } from "zod";

import { plaidDecimalToScaledInteger } from "./plaid-investments-holdings";

export const MAX_PLAID_TRANSACTION_MUTATIONS = 5_000;

const PlaidDecimalSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u),
]);

const PlaidTransactionSchema = z
  .object({
    transaction_id: z.string().min(1).max(512),
    account_id: z.string().min(1).max(512),
    amount: PlaidDecimalSchema,
    iso_currency_code: z.string().length(3).nullable(),
    unofficial_currency_code: z.string().min(1).max(32).nullable(),
    date: IsoDateSchema,
    pending: z.boolean(),
    personal_finance_category: z
      .object({
        primary: z.string().min(1).max(128),
        detailed: z.string().min(1).max(256),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();

const PlaidRemovedTransactionSchema = z
  .object({
    transaction_id: z.string().min(1).max(512),
  })
  .passthrough();

export const PlaidTransactionsSyncResponseSchema = z
  .object({
    added: z.array(PlaidTransactionSchema).max(500),
    modified: z.array(PlaidTransactionSchema).max(500),
    removed: z.array(PlaidRemovedTransactionSchema).max(500),
    next_cursor: z.string().min(1).max(4_096),
    has_more: z.boolean(),
    transactions_update_status: z.enum([
      "TRANSACTIONS_UPDATE_STATUS_UNKNOWN",
      "NOT_READY",
      "INITIAL_UPDATE_COMPLETE",
      "HISTORICAL_UPDATE_COMPLETE",
    ]),
    request_id: z.string().min(1).max(512),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (
      value.added.length + value.modified.length + value.removed.length >
      500
    ) {
      context.addIssue({
        code: "custom",
        message: "Plaid returned too many mutations in one page.",
      });
    }
  });

export type PlaidTransactionsSyncResponse = z.infer<
  typeof PlaidTransactionsSyncResponseSchema
>;

export const NormalizedCashFlowMutationSchema = z
  .object({
    sequence: z.number().int().positive(),
    mutation: z.enum(["added", "modified", "removed"]),
    transactionKeySha256: z.string().regex(/^[a-f0-9]{64}$/u),
    accountKeySha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    effectiveDate: IsoDateSchema.nullable(),
    month: z
      .string()
      .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u)
      .nullable(),
    amountMinor: z.number().int().safe().nullable(),
    pending: z.boolean().nullable(),
    category: CashFlowCategorySchema.nullable(),
    currencySupported: z.boolean().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const details = [
      value.accountKeySha256,
      value.effectiveDate,
      value.month,
      value.pending,
      value.category,
      value.currencySupported,
    ];
    if (value.mutation === "removed" && details.some((item) => item !== null)) {
      context.addIssue({
        code: "custom",
        message: "Removed transactions cannot retain source details.",
      });
    }
    if (value.mutation !== "removed" && details.some((item) => item === null)) {
      context.addIssue({
        code: "custom",
        message: "Transaction revisions require normalized details.",
      });
    }
    if (
      value.mutation !== "removed" &&
      value.currencySupported === true &&
      value.amountMinor === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Supported transaction currency requires an amount.",
      });
    }
    if (
      value.mutation !== "removed" &&
      value.currencySupported === false &&
      value.amountMinor !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Unsupported transaction currency cannot retain an amount.",
      });
    }
  });

export const NormalizedCashFlowDeltaSchema = z
  .object({
    normalizedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    retrievedAt: IsoTimestampSchema,
    nextCursor: z.string().min(1).max(4_096),
    mutations: z
      .array(NormalizedCashFlowMutationSchema)
      .max(MAX_PLAID_TRANSACTION_MUTATIONS),
  })
  .strict();

export type NormalizedCashFlowMutation = z.infer<
  typeof NormalizedCashFlowMutationSchema
>;
export type NormalizedCashFlowDelta = z.infer<
  typeof NormalizedCashFlowDeltaSchema
>;

const supportedCategories = new Set(CashFlowCategorySchema.options);

const categoryLabels: Record<CashFlowCategory, string> = {
  BANK_FEES: "Bank fees",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Food and drink",
  GENERAL_MERCHANDISE: "General merchandise",
  GENERAL_SERVICES: "General services",
  GOVERNMENT_AND_NON_PROFIT: "Government and nonprofit",
  HOME_IMPROVEMENT: "Home improvement",
  INCOME: "Income",
  LOAN_PAYMENTS: "Loan payments",
  MEDICAL: "Medical",
  OTHER: "Other spending",
  PERSONAL_CARE: "Personal care",
  RENT_AND_UTILITIES: "Rent and utilities",
  TRANSFER_IN: "Transfers in",
  TRANSFER_OUT: "Transfers out",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
};

export function cashFlowCategoryLabel(category: CashFlowCategory): string {
  return categoryLabels[CashFlowCategorySchema.parse(category)];
}

export function defaultCashFlowTreatment(
  category: CashFlowCategory,
): CashFlowTreatment {
  const parsed = CashFlowCategorySchema.parse(category);
  return CashFlowTreatmentSchema.parse(
    parsed === "LOAN_PAYMENTS"
      ? "debt_payment"
      : parsed === "TRANSFER_IN" ||
          parsed === "TRANSFER_OUT" ||
          parsed === "INCOME"
        ? "excluded"
        : "household",
  );
}

function normalizeCategory(raw: string | undefined): CashFlowCategory {
  const normalized = raw?.toUpperCase() ?? "OTHER";
  return supportedCategories.has(normalized as CashFlowCategory)
    ? (normalized as CashFlowCategory)
    : "OTHER";
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    ownedArrayBuffer(new TextEncoder().encode(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function normalizePlaidTransactionsSync(
  rawPages: readonly unknown[],
  input: {
    retrievedAt: string;
    accountKeyFor: (providerAccountId: string) => Promise<string>;
    transactionKeyFor: (providerTransactionId: string) => Promise<string>;
  },
): Promise<NormalizedCashFlowDelta> {
  const retrievedAt = IsoTimestampSchema.parse(input.retrievedAt);
  const pages = z
    .array(PlaidTransactionsSyncResponseSchema)
    .min(1)
    .max(20)
    .parse(rawPages);
  const mutationCount = pages.reduce(
    (count, page) =>
      count + page.added.length + page.modified.length + page.removed.length,
    0,
  );
  if (mutationCount > MAX_PLAID_TRANSACTION_MUTATIONS) {
    throw new Error("Plaid returned too many transaction changes.");
  }
  pages.forEach((page, index) => {
    if (index < pages.length - 1 && !page.has_more) {
      throw new Error("Plaid transaction pagination ended unexpectedly.");
    }
    if (index === pages.length - 1 && page.has_more) {
      throw new Error("Plaid transaction pagination is incomplete.");
    }
  });

  const seen = new Set<string>();
  const mutations: NormalizedCashFlowMutation[] = [];
  const appendTransaction = async (
    mutation: "added" | "modified",
    transaction: z.infer<typeof PlaidTransactionSchema>,
  ) => {
    const transactionKeySha256 = await input.transactionKeyFor(
      transaction.transaction_id,
    );
    if (seen.has(transactionKeySha256)) {
      throw new Error("Plaid returned a duplicate transaction mutation.");
    }
    seen.add(transactionKeySha256);
    const currencySupported =
      transaction.iso_currency_code === "USD" &&
      transaction.unofficial_currency_code === null;
    mutations.push(
      NormalizedCashFlowMutationSchema.parse({
        sequence: mutations.length + 1,
        mutation,
        transactionKeySha256,
        accountKeySha256: await input.accountKeyFor(transaction.account_id),
        effectiveDate: transaction.date,
        month: transaction.date.slice(0, 7),
        amountMinor: currencySupported
          ? plaidDecimalToScaledInteger(transaction.amount, 2)
          : null,
        pending: transaction.pending,
        category: normalizeCategory(
          transaction.personal_finance_category?.primary,
        ),
        currencySupported,
      }),
    );
  };

  for (const page of pages) {
    for (const transaction of page.added) {
      await appendTransaction("added", transaction);
    }
    for (const transaction of page.modified) {
      await appendTransaction("modified", transaction);
    }
    for (const transaction of page.removed) {
      const transactionKeySha256 = await input.transactionKeyFor(
        transaction.transaction_id,
      );
      if (seen.has(transactionKeySha256)) {
        throw new Error("Plaid returned a duplicate transaction mutation.");
      }
      seen.add(transactionKeySha256);
      mutations.push(
        NormalizedCashFlowMutationSchema.parse({
          sequence: mutations.length + 1,
          mutation: "removed",
          transactionKeySha256,
          accountKeySha256: null,
          effectiveDate: null,
          month: null,
          amountMinor: null,
          pending: null,
          category: null,
          currencySupported: null,
        }),
      );
    }
  }
  const nextCursor = pages.at(-1)?.next_cursor;
  if (nextCursor === undefined) {
    throw new Error("Plaid did not return a transaction cursor.");
  }
  const normalizedFingerprint = await sha256(
    JSON.stringify([
      "plaid-cash-flow-v1",
      nextCursor,
      mutations.map((mutation) => ({
        mutation: mutation.mutation,
        transactionKeySha256: mutation.transactionKeySha256,
        accountKeySha256: mutation.accountKeySha256,
        effectiveDate: mutation.effectiveDate,
        amountMinor: mutation.amountMinor,
        pending: mutation.pending,
        category: mutation.category,
        currencySupported: mutation.currencySupported,
      })),
    ]),
  );
  return NormalizedCashFlowDeltaSchema.parse({
    normalizedFingerprint,
    retrievedAt,
    nextCursor,
    mutations,
  });
}
