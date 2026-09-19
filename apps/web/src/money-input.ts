import { currencyFractionDigits } from "./format";

export function moneyInputValue(
  value: number | null | undefined,
  currency: string,
): string {
  if (value == null) return "";
  const amount = BigInt(value);
  const digits = currencyFractionDigits(currency);
  const unit = 10n ** BigInt(digits);
  return digits === 0
    ? amount.toString()
    : `${amount / unit}.${(amount % unit).toString().padStart(digits, "0")}`;
}

export function parseMoneyInput(
  value: string,
  currency: string,
): number | null {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d*)?$/u.test(normalized)) return null;
  const [whole = "0", decimal = ""] = normalized.split(".");
  const digits = currencyFractionDigits(currency);
  if (decimal.length > digits) return null;
  const minor =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(decimal.padEnd(digits, "0") || "0");
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(minor)
    : null;
}
