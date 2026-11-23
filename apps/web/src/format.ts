import { currencyFractionDigits } from "@keel/ui/money";
export { currencyFractionDigits } from "@keel/ui/money";

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function formatMoney(minorUnits: number | bigint): string {
  const amount = BigInt(minorUnits);
  const sign = amount < 0 ? "-" : "";
  const absolute = amount < 0 ? -amount : amount;
  const dollars = absolute / BigInt(100);
  const cents = absolute % BigInt(100);

  return `${sign}$${integerFormatter.format(dollars)}.${cents
    .toString()
    .padStart(2, "0")}`;
}

/** Share prices retain source precision and always display at least cents. */
export function formatSharePrice(priceMicros: number): string {
  const amount = BigInt(priceMicros);
  const absolute = amount < 0n ? -amount : amount;
  const fraction = (absolute % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "")
    .padEnd(2, "0");
  return `${amount < 0n ? "-" : ""}$${integerFormatter.format(absolute / 1_000_000n)}.${fraction}`;
}

/** Format exact minor units without compacting or floating-point conversion. */
export function formatCurrency(minorUnits: number, currency: string): string {
  const code = currency.toUpperCase();
  const digits = currencyFractionDigits(code);
  const amount = BigInt(minorUnits);
  const absolute = amount < 0n ? -amount : amount;
  const unit = 10n ** BigInt(digits);
  const fraction =
    digits === 0
      ? ""
      : `.${(absolute % unit).toString().padStart(digits, "0")}`;
  return `${amount < 0n ? "-" : ""}${code} ${integerFormatter.format(absolute / unit)}${fraction}`;
}

export function formatCompactMoney(minorUnits: number): string {
  const amount = BigInt(minorUnits);
  const sign = amount < 0 ? "-" : "";
  const absolute = amount < 0 ? -amount : amount;
  const millionMinor = BigInt(100_000_000);
  const thousandMinor = BigInt(100_000);

  if (absolute >= millionMinor) {
    const tenths =
      (absolute + millionMinor / BigInt(20)) / (millionMinor / 10n);
    return `${sign}$${tenths / 10n}.${tenths % 10n}M`;
  }
  if (absolute >= thousandMinor) {
    const roundedThousands = (absolute + thousandMinor / 2n) / thousandMinor;
    return `${sign}$${integerFormatter.format(roundedThousands)}k`;
  }
  return formatMoney(minorUnits);
}

export function formatCompactCurrency(
  minorUnits: number,
  currency: string,
): string {
  const normalizedCurrency = currency.toUpperCase();
  const fractionDigits = currencyFractionDigits(normalizedCurrency);
  const minorPerMajor = 10n ** BigInt(fractionDigits);
  const amount = BigInt(minorUnits);
  const sign = amount < 0 ? "-" : "";
  const absolute = amount < 0 ? -amount : amount;
  const compactUnits = [
    { majorUnits: 1_000_000_000n, suffix: "B" },
    { majorUnits: 1_000_000n, suffix: "M" },
    { majorUnits: 1_000n, suffix: "k" },
  ] as const;

  const fullAmount = (): string => {
    const major = absolute / minorPerMajor;
    const remainder = absolute % minorPerMajor;
    const fraction = remainder.toString().padStart(fractionDigits, "0");
    const decimal = remainder === 0n ? "" : `.${fraction.replace(/0+$/, "")}`;
    return `${sign}${normalizedCurrency} ${integerFormatter.format(major)}${decimal}`;
  };

  for (const unit of compactUnits) {
    const unitMinor = unit.majorUnits * minorPerMajor;
    if (absolute >= unitMinor) {
      const whole = absolute / unitMinor;
      const remainder = absolute % unitMinor;
      if (remainder === 0n) {
        return `${sign}${normalizedCurrency} ${whole}${unit.suffix}`;
      }
      let scaledRemainder = remainder;
      for (let digits = 1; digits <= 3; digits += 1) {
        scaledRemainder *= 10n;
        if (scaledRemainder % unitMinor === 0n) {
          const fraction = (scaledRemainder / unitMinor)
            .toString()
            .padStart(digits, "0");
          return `${sign}${normalizedCurrency} ${whole}.${fraction}${unit.suffix}`;
        }
      }
      return fullAmount();
    }
  }

  return fullAmount();
}

export function formatRoundedCompactCurrency(
  minorUnits: number,
  currency: string,
  roundingMajorUnits: number,
): string {
  if (!Number.isSafeInteger(roundingMajorUnits) || roundingMajorUnits <= 0) {
    throw new Error("Currency rounding units must be a positive safe integer.");
  }
  const normalizedCurrency = currency.toUpperCase();
  const fractionDigits = currencyFractionDigits(normalizedCurrency);
  const minorPerMajor = 10n ** BigInt(fractionDigits);
  const roundingMinor = BigInt(roundingMajorUnits) * minorPerMajor;
  const amount = BigInt(minorUnits);
  const absolute = amount < 0 ? -amount : amount;

  if (absolute < roundingMinor) {
    return formatCompactCurrency(minorUnits, normalizedCurrency);
  }

  const roundedAbsolute =
    ((absolute + roundingMinor / 2n) / roundingMinor) * roundingMinor;
  const rounded = amount < 0 ? -roundedAbsolute : roundedAbsolute;
  if (
    rounded > BigInt(Number.MAX_SAFE_INTEGER) ||
    rounded < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return formatCompactCurrency(minorUnits, normalizedCurrency);
  }
  return formatCompactCurrency(Number(rounded), normalizedCurrency);
}

export function formatMagnitudeRoundedCurrency(
  minorUnits: number,
  currency: string,
): string {
  const normalizedCurrency = currency.toUpperCase();
  const minorPerMajor =
    10n ** BigInt(currencyFractionDigits(normalizedCurrency));
  const amount = BigInt(minorUnits);
  const absolute = amount < 0 ? -amount : amount;
  const roundingMajorUnits =
    absolute >= 100_000n * minorPerMajor
      ? 10_000
      : absolute >= 1_000n * minorPerMajor
        ? 1_000
        : null;
  return roundingMajorUnits === null
    ? formatCompactCurrency(minorUnits, normalizedCurrency)
    : formatRoundedCompactCurrency(
        minorUnits,
        normalizedCurrency,
        roundingMajorUnits,
      );
}

export function formatProbability(probabilityPpm: number): string {
  const tenthsPercent = Math.floor((probabilityPpm + 500) / 1_000);
  return `${Math.floor(tenthsPercent / 10)}.${tenthsPercent % 10}%`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatSavedAt(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Position displays use $ for USD; other currencies retain their explicit code. */
export function formatPositionCurrency(
  minorUnits: number,
  currency: string,
): string {
  return currency.toUpperCase() === "USD"
    ? formatMoney(minorUnits)
    : formatCurrency(minorUnits, currency);
}

export function formatCompactPositionCurrency(
  minorUnits: number,
  currency: string,
): string {
  return currency.toUpperCase() === "USD"
    ? formatCompactMoney(minorUnits)
    : formatRoundedCompactCurrency(minorUnits, currency, 1_000);
}
