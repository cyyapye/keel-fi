import { z } from "zod";
import { plaidDecimalToScaledInteger } from "./plaid-investments-holdings";

const decimal = z.union([
  z.number().finite(),
  z
    .string()
    .max(128)
    .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u),
]);
const id = z.string().min(1).max(512);
export const PlaidInvestmentTransactionSchema = z
  .object({
    investment_transaction_id: id,
    account_id: id,
    security_id: id.nullable(),
    date: z.iso.date(),
    transaction_datetime: z.iso
      .datetime({ offset: true })
      .nullable()
      .optional(),
    name: z.string().max(1000),
    type: z.enum(["buy", "sell", "cash", "fee", "transfer", "cancel"]),
    subtype: z.string().max(256),
    quantity: decimal,
    amount: decimal,
    price: decimal,
    fees: decimal.nullable(),
    iso_currency_code: z.string().length(3).nullable(),
    unofficial_currency_code: z.string().max(32).nullable(),
  })
  .passthrough();
export const PlaidInvestmentTransactionsResponseSchema = z
  .object({
    accounts: z.array(z.object({ account_id: id }).passthrough()).max(100),
    securities: z
      .array(
        z
          .object({
            security_id: id,
            name: z.string().max(1000).nullable(),
            ticker_symbol: z.string().max(32).nullable(),
            type: z.string().max(128).nullable(),
            cusip: id.nullable().optional(),
            isin: id.nullable().optional(),
            sedol: id.nullable().optional(),
            iso_currency_code: z.string().length(3).nullable(),
            unofficial_currency_code: z.string().max(32).nullable(),
          })
          .passthrough(),
      )
      .max(500),
    investment_transactions: z.array(PlaidInvestmentTransactionSchema).max(500),
    total_investment_transactions: z.number().int().safe().nonnegative(),
    item: z
      .object({ item_id: id, institution_id: id.nullable() })
      .passthrough(),
    request_id: id,
  })
  .passthrough();
export type PlaidInvestmentTransactionsResponse = z.infer<
  typeof PlaidInvestmentTransactionsResponseSchema
>;
function quantityPrecision(value: number | string | null) {
  if (value === null) return "unknown" as const;
  // Conversion enforces the exponent/integer limits before this helper is used.
  const text = String(value),
    match = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(text)!;
  const fraction = match[2] ?? "",
    places = fraction.length - Number(match[3] ?? "0");
  const exact =
    places <= 6 ||
    BigInt(match[1]! + fraction) % 10n ** BigInt(places - 6) === 0n;
  return exact
    ? ("exact_millionths" as const)
    : ("rounded_to_millionths" as const);
}
export const PlaidTaxLotSchema = z
  .object({
    institution_lot_id: id.nullable(),
    original_purchase_datetime: z.iso.datetime({ offset: true }).nullable(),
    quantity: decimal.nullable(),
    purchase_price: decimal.nullable(),
    cost_basis: decimal.nullable(),
    current_value: decimal.nullable(),
    position_type: z.enum(["LONG", "SHORT"]).nullable(),
  })
  .passthrough();

export function normalizePlaidInvestmentTransaction(
  raw: z.infer<typeof PlaidInvestmentTransactionSchema>,
) {
  const row = PlaidInvestmentTransactionSchema.parse(raw);
  if (row.iso_currency_code !== "USD" || row.unofficial_currency_code !== null)
    throw new Error("Investment history currently supports USD evidence only.");
  const quantityMicros = plaidDecimalToScaledInteger(row.quantity, 6);
  return {
    providerTransactionId: row.investment_transaction_id,
    type: row.type,
    subtype: row.subtype,
    postedOn: row.date,
    initiatedAt: row.transaction_datetime ?? null,
    initiationPrecision: "provider_supplied_unknown" as const,
    quantityMicros,
    sourceQuantityDecimal: String(row.quantity),
    quantityPrecision: quantityPrecision(row.quantity),
    unitPriceMicros: z
      .number()
      .int()
      .safe()
      .nonnegative()
      .parse(plaidDecimalToScaledInteger(row.price, 6)),
    feesMinor:
      row.fees === null
        ? null
        : z
            .number()
            .int()
            .safe()
            .nonnegative()
            .parse(plaidDecimalToScaledInteger(row.fees, 2)),
    // Plaid's amount already includes fees. Its debit sign is opposite to cash delta.
    cashDeltaMinor: -plaidDecimalToScaledInteger(row.amount, 2),
    currency: "USD" as const,
  };
}

export function normalizePlaidTaxLot(raw: unknown) {
  const row = PlaidTaxLotSchema.parse(raw);
  const quantityMicros =
    row.quantity === null ? null : plaidDecimalToScaledInteger(row.quantity, 6);
  const costBasisMinor =
    row.cost_basis === null
      ? null
      : plaidDecimalToScaledInteger(row.cost_basis, 2);
  if (
    (quantityMicros !== null && quantityMicros < 0) ||
    (costBasisMinor !== null && costBasisMinor < 0)
  )
    throw new Error("Unsupported negative lot quantity or basis.");
  const basis =
    quantityMicros && costBasisMinor !== null
      ? Number(
          (BigInt(costBasisMinor) * 10_000_000_000n) / BigInt(quantityMicros),
        )
      : null;
  if (basis !== null && !Number.isSafeInteger(basis))
    throw new Error("Lot basis exceeds integer limits.");
  return {
    providerLotId: row.institution_lot_id,
    acquiredAt: row.original_purchase_datetime,
    acquisitionPrecision: "provider_supplied_unknown" as const,
    quantityMicros,
    sourceQuantityDecimal: row.quantity === null ? null : String(row.quantity),
    quantityPrecision: quantityPrecision(row.quantity),
    costBasisMinor,
    basisPerUnitMicros: basis,
    purchasePriceMicros:
      row.purchase_price === null
        ? null
        : z
            .number()
            .int()
            .safe()
            .nonnegative()
            .parse(plaidDecimalToScaledInteger(row.purchase_price, 6)),
    positionType: row.position_type,
    origin: "broker_reported" as const,
    currency: "USD" as const,
  };
}
