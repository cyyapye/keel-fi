import type { InvestmentTerms } from "@keel/domain/investment-details";
export type TermsDraft = Record<string, string>;
export function rateText(n: number | null) {
  if (n === null) return "";
  const value = BigInt(n);
  return `${value / 10_000n}.${(value % 10_000n).toString().padStart(4, "0")}`.replace(
    /\.?0+$/u,
    "",
  );
}
export function termsDraft(terms: InvestmentTerms): TermsDraft {
  return {
    importedAmountBasis: terms.importedAmountBasis,
    annualManagementFeePpm: rateText(terms.annualManagementFeePpm),
    annualManagementBasis: terms.annualManagementBasis,
    carryPpm: rateText(terms.carryPpm),
    carryBasis: terms.carryBasis,
    carryStatus: terms.reportedValueReview?.carryStatus ?? "unknown",
    valueDate: terms.reportedValueReview?.effectiveDate ?? "",
    note: terms.note,
  };
}
export function parsedRate(raw: string | undefined) {
  if (!raw?.trim()) return null;
  if (!/^\d+(?:\.\d{0,4})?$/u.test(raw.trim())) return NaN;
  const [whole, fraction = ""] = raw.trim().split(".");
  const result = BigInt(whole!) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  return result <= 1_000_000n ? Number(result) : NaN;
}
