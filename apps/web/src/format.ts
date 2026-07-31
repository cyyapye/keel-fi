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
