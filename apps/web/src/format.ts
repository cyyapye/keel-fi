const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function formatMoney(minorUnits: number): string {
  const amount = BigInt(minorUnits);
  const sign = amount < 0 ? "-" : "";
  const absolute = amount < 0 ? -amount : amount;
  const dollars = absolute / BigInt(100);
  const cents = absolute % BigInt(100);

  return `${sign}$${integerFormatter.format(dollars)}.${cents
    .toString()
    .padStart(2, "0")}`;
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
  let fractionDigits = 2;
  try {
    fractionDigits =
      new Intl.NumberFormat("en-US", {
        currency: normalizedCurrency,
        style: "currency",
      }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown ISO-style codes remain visible and use the common two-minor-unit fallback.
  }
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
