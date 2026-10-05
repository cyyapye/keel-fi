// Keep prices, shares and money as scaled integers throughout input handling.
export function decimal(value: number | null | undefined, digits: number) {
  if (value == null) return "";
  if (value === 0) return "0";
  const unit = 10n ** BigInt(digits);
  const n = BigInt(value);
  return `${n / unit}.${(n % unit).toString().padStart(digits, "0")}`.replace(
    /\.?0+$/u,
    "",
  );
}

export function scaled(
  value: string | undefined,
  digits: number,
): number | null {
  if (!value?.trim()) return null;
  if (!new RegExp(`^\\d+(?:\\.\\d{0,${digits}})?$`, "u").test(value.trim()))
    return NaN;
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const n =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0"));
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : NaN;
}
