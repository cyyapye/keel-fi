export function currencyFractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        currency,
        style: "currency",
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    // Unknown ISO-style codes remain visible and use the common two-minor-unit fallback.
    return 2;
  }
}

/** Compact portfolio amounts only after aggregation, preserving each currency's minor units. */
export function formatHoldingsAmount(
  minor: number | bigint,
  currency = "USD",
): string {
  const code = currency.toUpperCase();
  const unit =
    code === "USD" ? 100n : 10n ** BigInt(currencyFractionDigits(code));
  const amount = BigInt(minor);
  const magnitude = amount < 0n ? -amount : amount;
  const prefix = code === "USD" ? "$" : code + " ";
  const sign = amount < 0n ? "-" : "";
  if (magnitude > 0n && magnitude < unit) {
    const small = `<${prefix}1`;
    return amount < 0n ? `(${small})` : small;
  }

  const whole = (magnitude + unit / 2n) / unit;
  if (whole < 1_000n) return `${sign}${prefix}${whole}`;

  const thousand = 1_000n * unit;
  const tenthsK = (magnitude * 10n + thousand / 2n) / thousand;
  const millions = tenthsK >= 10_000n;
  const million = 1_000_000n * unit;
  const tenths = millions
    ? (magnitude * 10n + million / 2n) / million
    : tenthsK;
  const fraction = tenths % 10n;
  return `${sign}${prefix}${tenths / 10n}${fraction ? "." + fraction : ""}${millions ? "M" : "K"}`;
}
