import { z } from "zod";

const money = z.number().int().safe().nonnegative().max(10_000_000_000_000);
export const InvestmentFeeSchema = z
  .object({
    id: z.string().min(1).max(100),
    coveredLotIds: z.array(z.string().min(1)).max(20).default([]),
    treatment: z.enum(["upfront", "separate"]).default("upfront"),
    paymentStatus: z.enum(["paid", "unpaid"]).default("paid"),
    dueDate: z.iso.date().nullable().default(null),
    kind: z.enum(["one_time", "management", "other"]),
    label: z.string().trim().min(1).max(100),
    method: z.enum(["paid", "percentage"]),
    paidMinor: money.nullable(),
    ratePpm: z.number().int().min(0).max(1_000_000).nullable(),
    basis: z.enum(["cash", "retained", "net_capital", "custom", "unknown"]),
    basisMinor: money.nullable(),
    prepaidMonths: z.number().int().min(1).max(1200).nullable(),
  })
  .strict();
export type InvestmentFee = z.infer<typeof InvestmentFeeSchema>;

export function investmentFeeAmount(
  fee: InvestmentFee,
  capital: {
    grossCashMinor: number | null;
    refundMinor: number;
    netCapitalMinor: number | null;
  },
): number | null {
  if (fee.method === "paid") return fee.paidMinor;
  const basis =
    fee.basis === "cash"
      ? capital.grossCashMinor
      : fee.basis === "retained"
        ? capital.grossCashMinor === null
          ? null
          : Number(BigInt(capital.grossCashMinor) - BigInt(capital.refundMinor))
        : fee.basis === "net_capital"
          ? (fee.basisMinor ?? capital.netCapitalMinor)
          : fee.basis === "custom"
            ? fee.basisMinor
            : null;
  if (
    basis === null ||
    basis < 0 ||
    fee.ratePpm === null ||
    (fee.kind === "management" && fee.prepaidMonths === null)
  )
    return null;
  const months = fee.kind === "management" ? BigInt(fee.prepaidMonths!) : 12n;
  const amount =
    (BigInt(basis) * BigInt(fee.ratePpm) * months + 6_000_000n) / 12_000_000n;
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
