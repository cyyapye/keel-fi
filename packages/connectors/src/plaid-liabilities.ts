import {
  IsoDateSchema,
  IsoTimestampSchema,
  liabilityClassification,
  LiabilityClassificationSchema,
  LiabilityKindSchema,
  LiabilityValueStateSchema,
  ProbabilityPpmSchema,
  type LiabilityKind,
  type LiabilityValueState,
} from "@keel/domain";
import { z } from "zod";

import { plaidDecimalToScaledInteger } from "./plaid-robinhood-holdings";

const MAX_PLAID_LIABILITIES = 100;

const PlaidDecimalSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u),
]);

const PlaidLiabilityAccountSchema = z
  .object({
    account_id: z.string().min(1).max(512),
    persistent_account_id: z.string().min(1).max(512).nullable().optional(),
    balances: z
      .object({
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

const PlaidCreditLiabilitySchema = z
  .object({
    account_id: z.string().min(1).max(512).nullable(),
    aprs: z
      .array(z.object({ apr_percentage: PlaidDecimalSchema }).passthrough())
      .max(50),
    is_overdue: z.boolean().nullable(),
    last_statement_issue_date: z.iso.date().nullable(),
    minimum_payment_amount: PlaidDecimalSchema.nullable(),
    next_payment_due_date: z.iso.date().nullable(),
  })
  .passthrough();

const PlaidMortgageLiabilitySchema = z
  .object({
    account_id: z.string().min(1).max(512),
    current_late_fee: PlaidDecimalSchema.nullable(),
    interest_rate: z
      .object({ percentage: PlaidDecimalSchema.nullable() })
      .passthrough(),
    next_monthly_payment: PlaidDecimalSchema.nullable(),
    next_payment_due_date: z.iso.date().nullable(),
    past_due_amount: PlaidDecimalSchema.nullable(),
  })
  .passthrough();

const PlaidStudentLiabilitySchema = z
  .object({
    account_id: z.string().min(1).max(512).nullable(),
    interest_rate_percentage: PlaidDecimalSchema.nullable(),
    is_overdue: z.boolean().nullable(),
    last_statement_issue_date: z.iso.date().nullable(),
    minimum_payment_amount: PlaidDecimalSchema.nullable(),
    next_payment_due_date: z.iso.date().nullable(),
  })
  .passthrough();

export const PlaidLiabilitiesResponseSchema = z
  .object({
    accounts: z.array(PlaidLiabilityAccountSchema).max(MAX_PLAID_LIABILITIES),
    item: z
      .object({
        institution_id: z.string().min(1).max(512).nullable(),
        item_id: z.string().min(1).max(512),
      })
      .passthrough(),
    liabilities: z
      .object({
        credit: z
          .array(PlaidCreditLiabilitySchema)
          .max(MAX_PLAID_LIABILITIES)
          .nullable(),
        mortgage: z
          .array(PlaidMortgageLiabilitySchema)
          .max(MAX_PLAID_LIABILITIES)
          .nullable(),
        student: z
          .array(PlaidStudentLiabilitySchema)
          .max(MAX_PLAID_LIABILITIES)
          .nullable(),
      })
      .strict(),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

export const NormalizedLiabilitySchema = z
  .object({
    naturalKeySha256: z.string().regex(/^[a-f0-9]{64}$/u),
    institutionLabel: z.string().min(1).max(512),
    accountLabel: z.string().min(1).max(512),
    kind: LiabilityKindSchema,
    classification: LiabilityClassificationSchema,
    balanceMinor: z.number().int().safe().nonnegative().nullable(),
    valueState: LiabilityValueStateSchema,
    paymentMinor: z.number().int().safe().nonnegative().nullable(),
    interestRatePpm: ProbabilityPpmSchema.nullable(),
    nextPaymentDueDate: IsoDateSchema.nullable(),
    isOverdue: z.boolean().nullable(),
    effectiveDate: IsoDateSchema,
    observedAt: IsoTimestampSchema,
    issues: z.array(z.string().min(1).max(240)).max(5),
  })
  .strict();

export const NormalizedLiabilitiesSchema = z
  .object({
    normalizedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    observedAt: IsoTimestampSchema,
    rows: z.array(NormalizedLiabilitySchema).max(MAX_PLAID_LIABILITIES),
  })
  .strict();

export type PlaidLiabilitiesResponse = z.infer<
  typeof PlaidLiabilitiesResponseSchema
>;
export type NormalizedLiability = z.infer<typeof NormalizedLiabilitySchema>;
export type NormalizedLiabilities = z.infer<typeof NormalizedLiabilitiesSchema>;

type LiabilityDetails =
  | {
      kind: "credit_card";
      accountId: string;
      payment: number | string | null;
      pastDue: null;
      interestRates: readonly (number | string)[];
      dueDate: string | null;
      isOverdue: boolean | null;
      effectiveDate: string | null;
    }
  | {
      kind: "mortgage";
      accountId: string;
      payment: number | string | null;
      pastDue: number | string | null;
      interestRates: readonly (number | string)[];
      dueDate: string | null;
      isOverdue: boolean | null;
      effectiveDate: null;
    }
  | {
      kind: "student_loan";
      accountId: string;
      payment: number | string | null;
      pastDue: null;
      interestRates: readonly (number | string)[];
      dueDate: string | null;
      isOverdue: boolean | null;
      effectiveDate: string | null;
    };

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function supportedAccount(
  account: z.infer<typeof PlaidLiabilityAccountSchema>,
  kind: LiabilityKind,
): boolean {
  const type = account.type.toLowerCase();
  const subtype = account.subtype?.toLowerCase() ?? "";
  return kind === "credit_card"
    ? type === "credit" && (subtype === "credit card" || subtype === "paypal")
    : type === "loan" &&
        ((kind === "mortgage" && subtype === "mortgage") ||
          (kind === "student_loan" && subtype === "student"));
}

function balance(
  account: z.infer<typeof PlaidLiabilityAccountSchema>,
  kind: LiabilityKind,
): {
  balanceMinor: number | null;
  valueState: LiabilityValueState;
  issues: string[];
} {
  const issues: string[] = [];
  if (!supportedAccount(account, kind)) {
    issues.push("This Plaid account type is not supported as a liability.");
  }
  if (
    account.balances.iso_currency_code !== "USD" ||
    account.balances.unofficial_currency_code !== null
  ) {
    issues.push("Only USD liabilities are supported.");
  }
  const currentMinor =
    account.balances.current === null
      ? null
      : plaidDecimalToScaledInteger(account.balances.current, 2);
  if (currentMinor !== null && currentMinor < 0) {
    issues.push("A negative debt balance cannot be treated as an obligation.");
  }
  if (issues.length > 0) {
    return { balanceMinor: null, valueState: "unsupported", issues };
  }
  if (currentMinor === null) {
    return {
      balanceMinor: null,
      valueState: "unavailable",
      issues: ["Plaid did not report the outstanding balance."],
    };
  }
  return { balanceMinor: currentMinor, valueState: "reported", issues };
}

function payment(
  next: number | string | null,
  pastDue: number | string | null,
  issues: string[],
): number | null {
  const values = [next, pastDue]
    .filter((value): value is number | string => value !== null)
    .map((value) => plaidDecimalToScaledInteger(value, 2));
  if (values.some((value) => value < 0)) {
    issues.push("Plaid reported a negative required payment.");
    return null;
  }
  if (values.length === 0) {
    issues.push("No next payment was reported; planning impact stays unknown.");
    return null;
  }
  return Math.max(...values);
}

function interestRate(
  rates: readonly (number | string)[],
  issues: string[],
): number | null {
  if (rates.length === 0) {
    return null;
  }
  const normalized = rates.map((rate) => plaidDecimalToScaledInteger(rate, 4));
  const highest = Math.max(...normalized);
  if (highest < 0 || highest > 1_000_000) {
    issues.push("Plaid reported an interest rate outside Keel's range.");
    return null;
  }
  return highest;
}

function detailsFrom(response: PlaidLiabilitiesResponse): LiabilityDetails[] {
  const details: LiabilityDetails[] = [];
  for (const credit of response.liabilities.credit ?? []) {
    if (credit.account_id === null) {
      throw new Error("Plaid returned a credit liability without an account.");
    }
    details.push({
      kind: "credit_card",
      accountId: credit.account_id,
      payment: credit.minimum_payment_amount,
      pastDue: null,
      interestRates: credit.aprs.map((apr) => apr.apr_percentage),
      dueDate: credit.next_payment_due_date,
      isOverdue: credit.is_overdue,
      effectiveDate: credit.last_statement_issue_date,
    });
  }
  for (const mortgage of response.liabilities.mortgage ?? []) {
    const pastDueMinor =
      mortgage.past_due_amount === null
        ? null
        : plaidDecimalToScaledInteger(mortgage.past_due_amount, 2);
    details.push({
      kind: "mortgage",
      accountId: mortgage.account_id,
      payment: mortgage.next_monthly_payment,
      pastDue: mortgage.past_due_amount,
      interestRates:
        mortgage.interest_rate.percentage === null
          ? []
          : [mortgage.interest_rate.percentage],
      dueDate: mortgage.next_payment_due_date,
      isOverdue: pastDueMinor === null ? null : pastDueMinor > 0,
      effectiveDate: null,
    });
  }
  for (const student of response.liabilities.student ?? []) {
    if (student.account_id === null) {
      throw new Error("Plaid returned a student liability without an account.");
    }
    details.push({
      kind: "student_loan",
      accountId: student.account_id,
      payment: student.minimum_payment_amount,
      pastDue: null,
      interestRates:
        student.interest_rate_percentage === null
          ? []
          : [student.interest_rate_percentage],
      dueDate: student.next_payment_due_date,
      isOverdue: student.is_overdue,
      effectiveDate: student.last_statement_issue_date,
    });
  }
  return details;
}

export async function normalizePlaidLiabilities(
  raw: unknown,
  input: {
    institutionLabel: string;
    retrievedAt: string;
    accountKeyFor: (providerAccountId: string) => Promise<string>;
  },
): Promise<NormalizedLiabilities> {
  const response = PlaidLiabilitiesResponseSchema.parse(raw);
  const institutionLabel = z
    .string()
    .trim()
    .min(1)
    .max(512)
    .parse(input.institutionLabel);
  const observedAt = IsoTimestampSchema.parse(input.retrievedAt);
  const observedOn = observedAt.slice(0, 10);
  const accountsById = new Map(
    response.accounts.map((account) => [account.account_id, account]),
  );
  const details = detailsFrom(response);
  const accountIds = details.map((detail) => detail.accountId);
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error("Plaid returned duplicate liabilities.");
  }

  const rows = await Promise.all(
    details.map(async (detail) => {
      const account = accountsById.get(detail.accountId);
      if (account === undefined) {
        throw new Error("Plaid returned a liability without account details.");
      }
      const normalizedBalance = balance(account, detail.kind);
      const issues = [...normalizedBalance.issues];
      const paymentMinor = payment(detail.payment, detail.pastDue, issues);
      const interestRatePpm = interestRate(detail.interestRates, issues);
      return NormalizedLiabilitySchema.parse({
        naturalKeySha256: await input.accountKeyFor(
          account.persistent_account_id ?? account.account_id,
        ),
        institutionLabel,
        accountLabel: account.name,
        kind: detail.kind,
        classification: liabilityClassification(detail.kind),
        ...normalizedBalance,
        paymentMinor,
        interestRatePpm,
        nextPaymentDueDate: detail.dueDate,
        isOverdue: detail.isOverdue,
        effectiveDate: detail.effectiveDate ?? observedOn,
        observedAt,
        issues: issues.slice(0, 5),
      });
    }),
  );
  const stableRows = [...rows]
    .sort((left, right) =>
      left.naturalKeySha256.localeCompare(right.naturalKeySha256),
    )
    .map((row) => ({
      naturalKeySha256: row.naturalKeySha256,
      institutionLabel: row.institutionLabel,
      accountLabel: row.accountLabel,
      kind: row.kind,
      classification: row.classification,
      balanceMinor: row.balanceMinor,
      valueState: row.valueState,
      paymentMinor: row.paymentMinor,
      interestRatePpm: row.interestRatePpm,
      nextPaymentDueDate: row.nextPaymentDueDate,
      isOverdue: row.isOverdue,
      effectiveDate: row.effectiveDate,
      issues: row.issues,
    }));

  return NormalizedLiabilitiesSchema.parse({
    normalizedFingerprint: await sha256(
      JSON.stringify(["plaid-liabilities-v1", stableRows]),
    ),
    observedAt,
    rows,
  });
}
