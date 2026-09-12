import { z } from "zod";

export const MAX_ECONOMICS_CITATIONS = 32;
const fields = [
  "managementFeePpm",
  "adminFeeYears",
  "setupFeePpm",
  "carryPpm",
  "grossCommitmentMinor",
  "netInvestedMinor",
] as const;
type Field = (typeof fields)[number];
type Citation = {
  field: Field;
  value: number;
  page: number;
  quote: string;
  basis?: "gross_commitment";
  currency?: string;
};

function scaledDecimal(value: string, places: number): number | null {
  const [whole, fraction = ""] = value.replaceAll(",", "").split(".");
  if (!/^\d{1,18}$/u.test(whole ?? "") || fraction.length > places) return null;
  const integer =
    BigInt(whole!) * 10n ** BigInt(places) +
    BigInt(fraction.padEnd(places, "0"));
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : null;
}

/** Only explicit labels and supported fee terms are eligible for automation. */
export function agreementEconomicsLine(line: string, page: number): Citation[] {
  const quote = line.replace(/\s+/gu, " ").trim();
  if (quote.length > 2_000) return [];
  const money =
    /^(Gross commitment|Net invested capital):\s*(USD|EUR|GBP|CAD|AUD|\$)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*$/iu.exec(
      quote,
    );
  if (money !== null) {
    const value = scaledDecimal(money[3]!, 2);
    return value === null || value <= 0
      ? []
      : [
          {
            field:
              money[1]!.toLowerCase() === "gross commitment"
                ? "grossCommitmentMinor"
                : "netInvestedMinor",
            value,
            page,
            quote,
            currency: money[2] === "$" ? "USD" : money[2]!.toUpperCase(),
          },
        ];
  }
  const rate =
    /^(Management fee|Setup fee|Carry|Carried interest):\s*(\d{1,3}(?:\.\d{1,4})?)%\s*(.*?)\s*$/iu.exec(
      quote,
    );
  if (rate === null) return [];
  const value = scaledDecimal(rate[2]!, 4);
  if (value === null || value > 1_000_000) return [];
  const label = rate[1]!.toLowerCase();
  const tail = rate[3]!.toLowerCase();
  const field: Field =
    label === "management fee"
      ? "managementFeePpm"
      : label === "setup fee"
        ? "setupFeePpm"
        : "carryPpm";
  if (field === "carryPpm" && !/^(?:of exit gains|of profits)?\.?$/u.test(tail))
    return [];
  if (field !== "carryPpm" && /exit gains|profits/u.test(tail)) return [];
  if (field === "setupFeePpm" && /per year|annually|prepaid/u.test(tail))
    return [];
  // Do not extract a conditional example, tier, cap, range, or preferred return.
  if (
    !/^(?:(?:per year|annually)\s+)?(?:of gross commitment|of exit gains|of profits)?(?:,?\s*(?:one-time|one time|prepaid for \d{1,3} years?))?\.?$/u.test(
      tail,
    )
  )
    return [];
  const basis =
    field !== "carryPpm" &&
    (tail.includes("of gross commitment") || value === 0)
      ? ("gross_commitment" as const)
      : undefined;
  const result: Citation[] = [
    { field, value, page, quote, ...(basis === undefined ? {} : { basis }) },
  ];
  if (field === "managementFeePpm") {
    const prepaid = /prepaid for (\d{1,3}) years?/u.exec(tail);
    const years =
      /one[- ]time/u.test(tail) || value === 0
        ? 1
        : prepaid !== null && /per year|annually/u.test(tail)
          ? Number(prepaid[1])
          : null;
    if (years !== null && years >= 1 && years <= 100)
      result.push({ field: "adminFeeYears", value: years, page, quote });
  }
  return result;
}

export const AgreementEconomicsCitationSchema = z
  .object({
    field: z.enum(fields),
    value: z.number().int().safe().nonnegative(),
    page: z.number().int().min(1).max(150),
    quote: z.string().trim().min(1).max(2_000),
    basis: z.literal("gross_commitment").optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
  })
  .strict()
  .refine(
    (citation) =>
      agreementEconomicsLine(citation.quote, citation.page).some(
        (parsed) =>
          parsed.field === citation.field &&
          parsed.value === citation.value &&
          parsed.basis === citation.basis &&
          parsed.currency === citation.currency,
      ),
    "The economics value must match its exact supported document excerpt.",
  );

export type AgreementEconomicsCitation = z.infer<
  typeof AgreementEconomicsCitationSchema
>;
