import { z } from "zod";

const money = z.number().int().safe().nonnegative();
const rate = z.number().int().min(0).max(1_000_000);

// Reviewed terms are intentionally distinct from imported source observations.
// A missing rate is unknown, including when exact upfront cash is known.
export const InvestmentTermsSchema = z
  .object({
    importedAmountBasis: z.enum(["gross_cash", "net_capital", "unknown"]),
    annualManagementFeePpm: rate.nullable(),
    annualManagementBasis: z.enum(["gross_cash", "net_capital", "unknown"]),
    carryPpm: rate.nullable(),
    carryBasis: z.enum(["gross_cash", "net_capital", "unknown"]),
    reportedValueReview: z
      .object({
        sourceSnapshotId: z.string().min(1),
        valueMinor: money,
        sourceLabel: z.string().trim().min(1).max(500),
        effectiveDate: z.iso.date().nullable(),
        carryStatus: z.enum(["before_carry", "after_carry", "unknown"]),
      })
      .strict()
      .nullable(),
    note: z.string().trim().max(1000),
  })
  .strict();

export const ReviewedInvestmentSchema = z.object({
  snapshotId: z.string().min(1),
  receiptId: z.string().min(1),
  cashPaidMinor: money.nullable(),
  additionalPaidFeesMinor: money.nullable().optional(),
  upfrontDeductionsMinor: money.nullable(),
  returnedCapitalMinor: money.optional(),
  additionalReturnedCapitalMinor: money.optional(),
  includedReturnedCapitalMinor: money.optional(),
  returnedCapitalReconciliationPending: z.boolean().optional(),
  netCapitalMinor: money.nullable(),
  // A projection from complete reviewed fee terms, never an accepted allocation.
  estimatedNetCapitalMinor: money.nullable().optional(),
  terms: InvestmentTermsSchema,
});

export type InvestmentTerms = z.infer<typeof InvestmentTermsSchema>;
export type ReviewedInvestment = z.infer<typeof ReviewedInvestmentSchema>;

export const unknownInvestmentTerms = (): InvestmentTerms => ({
  importedAmountBasis: "unknown",
  annualManagementFeePpm: null,
  annualManagementBasis: "unknown",
  carryPpm: null,
  carryBasis: "unknown",
  reportedValueReview: null,
  note: "",
});

/** Exact cash reconciliation. Rates describe components and never replace totals. */
export function reconcileInvestmentCapital(input: {
  grossCashMinor: number | null;
  netCapitalMinor: number | null;
  upfrontDeductionsMinor: number | null;
}) {
  let gross = input.grossCashMinor;
  let net = input.netCapitalMinor;
  let deductions = input.upfrontDeductionsMinor;
  if (
    [gross, net, deductions].some(
      (n) => n !== null && (!Number.isSafeInteger(n) || n < 0),
    )
  )
    return {
      grossCashMinor: gross,
      netCapitalMinor: net,
      upfrontDeductionsMinor: deductions,
      conflict: true,
    };
  if (gross !== null && net !== null)
    deductions ??= Number(BigInt(gross) - BigInt(net));
  else if (gross !== null && deductions !== null)
    net = Number(BigInt(gross) - BigInt(deductions));
  else if (net !== null && deductions !== null) {
    const sum = BigInt(net) + BigInt(deductions);
    gross = sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : NaN;
  }
  const values = [gross, net, deductions];
  const conflict =
    values.some((n) => n !== null && (!Number.isSafeInteger(n) || n < 0)) ||
    (gross !== null &&
      net !== null &&
      deductions !== null &&
      BigInt(gross) !== BigInt(net) + BigInt(deductions));
  return {
    grossCashMinor: gross,
    netCapitalMinor: net,
    upfrontDeductionsMinor: deductions,
    conflict,
  };
}

/** A carry-only illustration. Never claim this includes annual fees or taxes. */
export function estimateProceedsAfterCarry(input: {
  valueMinor: number | null;
  carryStatus: "before_carry" | "after_carry" | "unknown";
  cashPaidMinor: number | null;
  netCapitalMinor: number | null;
  carryPpm: number | null;
  carryBasis: "gross_cash" | "net_capital" | "unknown";
}) {
  if (input.valueMinor === null || input.carryStatus === "unknown") return null;
  if (input.carryStatus === "after_carry")
    return {
      carryMinor: null,
      proceedsMinor: input.valueMinor,
      alreadyAfterCarry: true,
    };
  if (input.carryPpm === null) return null;
  if (input.carryPpm === 0)
    return {
      carryMinor: 0,
      proceedsMinor: input.valueMinor,
      alreadyAfterCarry: false,
    };
  const basis =
    input.carryBasis === "gross_cash"
      ? input.cashPaidMinor
      : input.carryBasis === "net_capital"
        ? input.netCapitalMinor
        : null;
  if (basis === null) return null;
  const gain =
    BigInt(input.valueMinor) > BigInt(basis)
      ? BigInt(input.valueMinor) - BigInt(basis)
      : 0n;
  const carry = (gain * BigInt(input.carryPpm) + 500_000n) / 1_000_000n;
  return {
    carryMinor: Number(carry),
    proceedsMinor: Number(BigInt(input.valueMinor) - carry),
    alreadyAfterCarry: false,
  };
}
