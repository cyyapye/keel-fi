import { z } from "zod";
import type { PurchaseLot } from "./position-purchases";

export const PurchaseNoticeInputSchema = z.string().trim().min(1).max(12_000);

// Deliberately bounded, label-based extraction. Notice text is data, never
// instructions. Repeated or ambiguous facts stay blank for manual review.
export function extractPurchaseNotice(raw: string) {
  const sourceText = PurchaseNoticeInputSchema.parse(raw);
  const normalized = sourceText
    .replace(
      /&#(?:x([0-9a-f]{1,4})|(\d{1,5}));/giu,
      (_: string, hex: string | undefined, dec: string | undefined) =>
        String.fromCharCode(Number.parseInt(hex ?? dec ?? "", hex ? 16 : 10)),
    )
    .replace(/&nbsp;/giu, " ")
    .replace(/\*\*/gu, "")
    .replace(/[–—]/gu, "-");
  const warnings: string[] = [];
  const terms: Partial<PurchaseLot> = { sourceText };
  function unique(pattern: RegExp, label: string): string | null {
    const found = [...normalized.matchAll(pattern)].map((m) => m[1]!.trim());
    if (new Set(found.map((v) => v.toLowerCase())).size > 1) {
      warnings.push(
        `Several ${label} values were found. Enter the correct value.`,
      );
      return null;
    }
    return found[0] ?? null;
  }
  function units(value: string | null, digits: number, maximum: number) {
    if (value === null) return null;
    const cleaned = value.replace(/,/gu, "");
    if (!new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`, "u").test(cleaned))
      return null;
    const [whole = "0", fraction = ""] = cleaned.split(".");
    const n =
      BigInt(whole) * 10n ** BigInt(digits) +
      BigInt(fraction.padEnd(digits, "0"));
    return n <= BigInt(maximum) ? Number(n) : null;
  }
  const type = unique(
    /\bType\s*:\s*(Primary|Secondary)\b/giu,
    "transaction type",
  );
  if (type)
    terms.transactionType = type.toLowerCase() as "primary" | "secondary";
  const shareClass = unique(
    /\bType\s*:\s*(?:Primary|Secondary)\s*-\s*([^\n;]+)/giu,
    "share class",
  );
  if (shareClass && shareClass.length <= 500) terms.shareClass = shareClass;
  // A dollar sign alone means USD only in this explicitly USD purchase form.
  const foreignCurrency =
    /\b(?:EUR|GBP|CAD|AUD|HKD|SGD|JPY|CNY)\b|[€£¥]|(?:C|A|HK|S)\$/iu.test(
      normalized,
    );
  if (foreignCurrency)
    warnings.push(
      "This notice names another currency. Enter USD share prices only after checking the currency.",
    );
  const price = unique(
    /\b(?:Purchase\s+)?Price\s*:\s*(?:USD\s*)?\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*share|per\s+share)\b/giu,
    "purchase price",
  );
  const reference = unique(
    /\bSeries\s+[A-Z][\w-]*\s*:\s*[^\n;()]*?\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*share|per\s+share)\b/giu,
    "reference price",
  );
  if (!foreignCurrency) {
    const priceMicros = units(price, 6, 1_000_000_000_000);
    const referencePriceMicros = units(reference, 6, 1_000_000_000_000);
    if (priceMicros !== null && priceMicros > 0)
      terms.priceMicros = priceMicros;
    if (referencePriceMicros !== null && referencePriceMicros > 0)
      terms.referencePriceMicros = referencePriceMicros;
  }
  const round = unique(/\b(Series\s+[A-Z][\w-]*)\s*:/giu, "reference round");
  if (round) terms.referenceRound = round;
  const fee = units(
    unique(
      /\b(\d+(?:\.\d+)?)\s*%\s*(?:underlying\s+fund|one-time|upfront|setup)\s*fee\b/giu,
      "one-time fee",
    ),
    4,
    1_000_000,
  );
  if (fee !== null) {
    terms.feePpm = fee;
    terms.feeLabel = /underlying\s+fund\s+fee/iu.test(normalized)
      ? "Underlying fund fee"
      : "One-time fee";
    // Preserve the rate without a basis if the notice does not explicitly say
    // it is added to the price or deducted from gross cash.
    if (
      !foreignCurrency &&
      price !== null &&
      /(?:\/\s*share|per\s+share)\s*\+\s*\d+(?:\.\d+)?\s*%\s*(?:underlying\s+fund|one-time|upfront|setup)\s*fee/iu.test(
        normalized,
      )
    )
      terms.feeBasis = "net_capital";
    else
      warnings.push(
        "Confirm whether the one-time fee is added to share capital or deducted from gross cash. The rate can be saved without a basis.",
      );
  }
  const management = units(
    unique(
      /\b(\d+(?:\.\d+)?)\s*%\s*(?:\/\s*(?:yr|year)|per\s+year|annual(?:ly)?)\s*(?:mgmt|management)\s*fee\b/giu,
      "annual management fee",
    ),
    4,
    1_000_000,
  );
  const carry = units(
    unique(
      /\b(\d+(?:\.\d+)?)\s*%\s*(?:carry|carried\s+interest)\b/giu,
      "carry",
    ),
    4,
    1_000_000,
  );
  const premium = units(
    unique(/\b(\d+(?:\.\d+)?)\s*%\s*premium\b/giu, "quoted premium"),
    4,
    10_000_000,
  );
  if (management !== null) terms.reportedManagementFeePpm = management;
  if (carry !== null) terms.reportedCarryPpm = carry;
  if (premium !== null) terms.reportedPremiumPpm = premium;
  if (Object.keys(terms).length === 1)
    warnings.push(
      "No supported purchase terms were found. Enter the details manually; the notice is kept as evidence.",
    );
  return { terms, warnings };
}
