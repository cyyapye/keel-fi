import { z } from "zod";

const MAX_PLAID_HOLDINGS = 500;
const QUANTITY_SCALE = 6;

const PlaidDecimalSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u),
]);

const PlaidAccountSchema = z
  .object({
    account_id: z.string().min(1).max(512),
    persistent_account_id: z.string().min(1).max(512).nullable().optional(),
    name: z.string().min(1).max(512),
    official_name: z.string().min(1).max(512).nullable(),
    subtype: z.string().min(1).max(128).nullable(),
    type: z.string().min(1).max(128),
  })
  .passthrough();

const PlaidHoldingSchema = z
  .object({
    account_id: z.string().min(1).max(512),
    security_id: z.string().min(1).max(512),
    institution_value: PlaidDecimalSchema,
    cost_basis: PlaidDecimalSchema.nullable(),
    quantity: PlaidDecimalSchema,
    institution_price_as_of: z.iso.date().nullable().optional(),
    iso_currency_code: z.string().length(3).nullable(),
    unofficial_currency_code: z.string().min(1).max(32).nullable(),
  })
  .passthrough();

const PlaidSecuritySchema = z
  .object({
    security_id: z.string().min(1).max(512),
    name: z.string().min(1).max(1_000).nullable(),
    ticker_symbol: z.string().min(1).max(32).nullable(),
    type: z.string().min(1).max(128).nullable(),
    cusip: z.string().min(1).max(64).nullable().optional(),
    isin: z.string().min(1).max(64).nullable().optional(),
    sedol: z.string().min(1).max(64).nullable().optional(),
    iso_currency_code: z.string().length(3).nullable(),
    unofficial_currency_code: z.string().min(1).max(32).nullable(),
  })
  .passthrough();

export const PlaidInvestmentsHoldingsResponseSchema = z
  .object({
    accounts: z.array(PlaidAccountSchema).max(100),
    holdings: z.array(PlaidHoldingSchema).max(MAX_PLAID_HOLDINGS),
    securities: z.array(PlaidSecuritySchema).max(MAX_PLAID_HOLDINGS),
    item: z
      .object({
        institution_id: z.string().min(1).max(512).nullable(),
        item_id: z.string().min(1).max(512),
      })
      .passthrough(),
    request_id: z.string().min(1).max(512),
  })
  .passthrough();

const fiPlanningSecurityTypes = new Set([
  "cash",
  "equity",
  "etf",
  "mutual fund",
]);

const outsideFiSecurityTypes = new Set(["cryptocurrency"]);

export const PLAID_INVESTMENTS_CRYPTO_OUTSIDE_FI_ISSUE =
  "Crypto is recorded outside the FI plan.";

export function isPlaidInvestmentsFiPlanningSecurityType(
  securityType: string,
): boolean {
  return fiPlanningSecurityTypes.has(securityType.trim().toLowerCase());
}

export function isPlaidInvestmentsOutsideFiSecurityType(
  securityType: string,
): boolean {
  return outsideFiSecurityTypes.has(securityType.trim().toLowerCase());
}

export const PlaidInvestmentHoldingRowSchema = z
  .object({
    rowNumber: z.number().int().positive().max(MAX_PLAID_HOLDINGS),
    naturalKeySha256: z.string().regex(/^[a-f0-9]{64}$/u),
    securityName: z.string().min(1).max(1_000),
    ticker: z.string().min(1).max(32).nullable(),
    securityType: z.string().min(1).max(128),
    accountLabel: z.string().min(1).max(1_000),
    quantityMicros: z.number().int().safe().nonnegative(),
    costBasisMinor: z.number().int().safe().nonnegative().nullable(),
    marketValueMinor: z.number().int().safe().nonnegative(),
    observedOn: z.iso.date(),
    currency: z.literal("USD"),
    issues: z.array(z.string().min(1).max(240)).max(5),
  })
  .strict();

export const PlaidInvestmentsHoldingImportSchema = z
  .object({
    provider: z.literal("plaid_investments"),
    formatVersion: z.literal(1),
    normalizedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    effectiveDate: z.iso.date(),
    rows: z.array(PlaidInvestmentHoldingRowSchema).max(MAX_PLAID_HOLDINGS),
  })
  .strict();

export type PlaidInvestmentsHoldingsResponse = z.infer<
  typeof PlaidInvestmentsHoldingsResponseSchema
>;
export type PlaidInvestmentHoldingRow = z.infer<
  typeof PlaidInvestmentHoldingRowSchema
>;
export type PlaidInvestmentsHoldingImport = z.infer<
  typeof PlaidInvestmentsHoldingImportSchema
>;

function decimalParts(value: number | string): {
  digits: bigint;
  decimalPlaces: number;
  negative: boolean;
} {
  const text = typeof value === "number" ? String(value) : value;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(text);
  if (match === null) {
    throw new Error("Plaid returned an invalid decimal value.");
  }
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
    throw new Error("Plaid returned a decimal exponent outside Keel limits.");
  }
  return {
    digits: BigInt(`${integer}${fraction}`),
    decimalPlaces: fraction.length - exponent,
    negative: match[1] === "-",
  };
}

/** Convert a provider decimal using only integer arithmetic, with half-up rounding. */
export function plaidDecimalToScaledInteger(
  value: number | string,
  scale: number,
): number {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw new Error("Plaid decimal scale is invalid.");
  }
  const parts = decimalParts(value);
  const power = scale - parts.decimalPlaces;
  let scaled: bigint;
  if (power >= 0) {
    scaled = parts.digits * 10n ** BigInt(power);
  } else {
    const divisor = 10n ** BigInt(-power);
    const quotient = parts.digits / divisor;
    const remainder = parts.digits % divisor;
    scaled = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  }
  if (parts.negative) {
    scaled = -scaled;
  }
  const result = Number(scaled);
  if (!Number.isSafeInteger(result)) {
    throw new Error("Plaid decimal exceeds Keel integer limits.");
  }
  return result;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function plaidInvestmentAccountPresentation(input: {
  institutionLabel: string;
  subtype: string | null;
}): {
  displayLabel: string;
  containerKind: "brokerage" | "ira" | "retirement" | "trust" | "other";
  taxTreatment: "taxable" | "tax_deferred" | "tax_exempt" | "unknown";
} {
  const institutionLabel = z
    .string()
    .trim()
    .min(1)
    .max(512)
    .parse(input.institutionLabel);
  const normalized = input.subtype?.trim().toLowerCase() ?? "";
  if (normalized.includes("roth")) {
    return {
      displayLabel: `${institutionLabel} Roth IRA`,
      containerKind: "ira",
      taxTreatment: "tax_exempt",
    };
  }
  if (normalized.includes("ira")) {
    return {
      displayLabel: `${institutionLabel} IRA`,
      containerKind: "ira",
      taxTreatment: "tax_deferred",
    };
  }
  if (
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("457") ||
    normalized.includes("pension") ||
    normalized.includes("retirement")
  ) {
    return {
      displayLabel: `${institutionLabel} retirement account`,
      containerKind: "retirement",
      taxTreatment: "tax_deferred",
    };
  }
  if (normalized.includes("trust")) {
    return {
      displayLabel: `${institutionLabel} trust`,
      containerKind: "trust",
      taxTreatment: "unknown",
    };
  }
  if (normalized === "" || normalized.includes("brokerage")) {
    return {
      displayLabel: `${institutionLabel} brokerage`,
      containerKind: "brokerage",
      taxTreatment: "taxable",
    };
  }
  return {
    displayLabel: `${institutionLabel} investment account`,
    containerKind: "other",
    taxTreatment: "unknown",
  };
}

export type PlaidStrongSecurityIdentifier = {
  readonly kind: "cusip" | "isin" | "sedol";
  readonly value: string;
};

function identifierCharacterValue(character: string): number {
  if (/^[0-9]$/u.test(character)) {
    return Number(character);
  }
  if (/^[A-Z]$/u.test(character)) {
    return character.charCodeAt(0) - 55;
  }
  if (character === "*") {
    return 36;
  }
  if (character === "@") {
    return 37;
  }
  if (character === "#") {
    return 38;
  }
  return -1;
}

function validCusip(value: string): boolean {
  if (!/^[0-9A-Z*@#]{8}[0-9]$/u.test(value)) {
    return false;
  }
  const sum = [...value.slice(0, 8)].reduce((total, character, index) => {
    const weighted =
      identifierCharacterValue(character) * (index % 2 === 0 ? 1 : 2);
    return total + Math.floor(weighted / 10) + (weighted % 10);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

function validIsin(value: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/u.test(value)) {
    return false;
  }
  const digits = [...value]
    .map((character) => String(identifierCharacterValue(character)))
    .join("");
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const parsed = Number(digits[index]);
    const weighted = double ? parsed * 2 : parsed;
    sum += Math.floor(weighted / 10) + (weighted % 10);
    double = !double;
  }
  return sum % 10 === 0;
}

function validSedol(value: string): boolean {
  if (!/^[0-9BCDFGHJKLMNPQRSTVWXYZ]{6}[0-9]$/u.test(value)) {
    return false;
  }
  const weights = [1, 3, 1, 7, 3, 9, 1] as const;
  return (
    [...value].reduce(
      (sum, character, index) =>
        sum + identifierCharacterValue(character) * (weights[index] ?? 0),
      0,
    ) %
      10 ===
    0
  );
}

/** Return only checksum-valid identifiers that are safe to canonicalize. */
export function plaidInvestmentStrongSecurityIdentifier(
  security: z.infer<typeof PlaidSecuritySchema>,
): PlaidStrongSecurityIdentifier | null {
  const candidates: readonly PlaidStrongSecurityIdentifier[] = [
    ...(security.cusip == null
      ? []
      : [
          {
            kind: "cusip" as const,
            value: security.cusip.trim().toUpperCase(),
          },
        ]),
    ...(security.isin == null
      ? []
      : [{ kind: "isin" as const, value: security.isin.trim().toUpperCase() }]),
    ...(security.sedol == null
      ? []
      : [
          {
            kind: "sedol" as const,
            value: security.sedol.trim().toUpperCase(),
          },
        ]),
  ];
  return (
    candidates.find((candidate) => {
      if (candidate.kind === "cusip") {
        return validCusip(candidate.value);
      }
      if (candidate.kind === "isin") {
        return validIsin(candidate.value);
      }
      return validSedol(candidate.value);
    }) ?? null
  );
}

export function plaidInvestmentSecurityIdentity(
  security: z.infer<typeof PlaidSecuritySchema>,
): string {
  const strongIdentifier = plaidInvestmentStrongSecurityIdentifier(security);
  if (strongIdentifier !== null) {
    return `${strongIdentifier.kind}:${strongIdentifier.value}`;
  }
  if (security.ticker_symbol != null && security.type != null) {
    return `ticker:${security.ticker_symbol.toUpperCase()}:${security.type.toLowerCase()}`;
  }
  return `plaid:${security.security_id}`;
}

function issueMessages(input: {
  costBasisMinor: number | null;
  securityType: string;
}): string[] {
  const messages: string[] = [];
  if (input.costBasisMinor === null) {
    messages.push("Cost basis is unavailable.");
  }
  if (isPlaidInvestmentsOutsideFiSecurityType(input.securityType)) {
    messages.push(PLAID_INVESTMENTS_CRYPTO_OUTSIDE_FI_ISSUE);
  } else if (!isPlaidInvestmentsFiPlanningSecurityType(input.securityType)) {
    messages.push(`${input.securityType} positions are not supported yet.`);
  }
  return messages;
}

export async function normalizePlaidInvestmentsHoldings(
  raw: unknown,
  retrievedAt: string,
  institutionLabel: string,
): Promise<PlaidInvestmentsHoldingImport> {
  const parsedRetrievedAt = z.iso.datetime({ offset: true }).parse(retrievedAt);
  const parsedInstitutionLabel = z
    .string()
    .trim()
    .min(1)
    .max(512)
    .parse(institutionLabel);
  const response = PlaidInvestmentsHoldingsResponseSchema.parse(raw);
  const accountsById = new Map(
    response.accounts.map((account) => [account.account_id, account]),
  );
  const securitiesById = new Map(
    response.securities.map((security) => [security.security_id, security]),
  );
  if (accountsById.size !== response.accounts.length) {
    throw new Error("Plaid returned duplicate investment accounts.");
  }
  if (
    response.accounts.some(
      (account) => account.type.trim().toLowerCase() !== "investment",
    )
  ) {
    throw new Error("Plaid returned a non-investment account.");
  }
  if (securitiesById.size !== response.securities.length) {
    throw new Error("Plaid returned duplicate securities.");
  }

  const fallbackDate = parsedRetrievedAt.slice(0, 10);
  const rows = await Promise.all(
    response.holdings.map(
      async (holding, index): Promise<PlaidInvestmentHoldingRow> => {
        const account = accountsById.get(holding.account_id);
        const security = securitiesById.get(holding.security_id);
        if (account === undefined || security === undefined) {
          throw new Error("Plaid holding references unknown account data.");
        }
        if (account.type.toLowerCase() !== "investment") {
          throw new Error("Plaid returned a non-investment account.");
        }
        if (
          holding.iso_currency_code !== "USD" ||
          holding.unofficial_currency_code !== null ||
          security.iso_currency_code !== "USD" ||
          security.unofficial_currency_code !== null
        ) {
          throw new Error(
            "Plaid Investments sync currently supports USD holdings only.",
          );
        }

        const quantityMicros = plaidDecimalToScaledInteger(
          holding.quantity,
          QUANTITY_SCALE,
        );
        const marketValueMinor = plaidDecimalToScaledInteger(
          holding.institution_value,
          2,
        );
        const costBasisMinor =
          holding.cost_basis === null
            ? null
            : plaidDecimalToScaledInteger(holding.cost_basis, 2);
        if (
          quantityMicros < 0 ||
          marketValueMinor < 0 ||
          (costBasisMinor !== null && costBasisMinor < 0)
        ) {
          throw new Error("Short investment positions are not supported yet.");
        }

        const securityName =
          security.name?.trim() || security.ticker_symbol?.trim() || "Security";
        const ticker = security.ticker_symbol?.trim().toUpperCase() ?? null;
        const securityType = security.type?.trim() || "unknown security";
        const accountIdentity =
          account.persistent_account_id ?? account.account_id;
        const naturalKeySha256 = await sha256(
          JSON.stringify([
            "plaid-investments-position-v1",
            accountIdentity,
            plaidInvestmentSecurityIdentity(security),
          ]),
        );
        const issues = issueMessages({ costBasisMinor, securityType });

        return PlaidInvestmentHoldingRowSchema.parse({
          rowNumber: index + 1,
          naturalKeySha256,
          securityName,
          ticker,
          securityType,
          accountLabel: plaidInvestmentAccountPresentation({
            institutionLabel: parsedInstitutionLabel,
            subtype: account.subtype,
          }).displayLabel,
          quantityMicros,
          costBasisMinor,
          marketValueMinor,
          observedOn: holding.institution_price_as_of ?? fallbackDate,
          currency: "USD",
          issues,
        });
      },
    ),
  );
  const keys = rows.map((row) => row.naturalKeySha256);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Plaid returned duplicate investment holdings.");
  }

  const stableRows = [...rows]
    .sort((left, right) =>
      left.naturalKeySha256.localeCompare(right.naturalKeySha256),
    )
    .map((row) => ({
      naturalKeySha256: row.naturalKeySha256,
      ticker: row.ticker,
      securityName: row.securityName,
      securityType: row.securityType,
      quantityMicros: row.quantityMicros,
      costBasisMinor: row.costBasisMinor,
      marketValueMinor: row.marketValueMinor,
      currency: row.currency,
      issues: row.issues,
    }));
  const effectiveDate =
    rows.length === 0
      ? fallbackDate
      : rows.reduce(
          (latest, row) => (row.observedOn > latest ? row.observedOn : latest),
          rows[0]?.observedOn ?? fallbackDate,
        );

  return PlaidInvestmentsHoldingImportSchema.parse({
    provider: "plaid_investments",
    formatVersion: 1,
    normalizedFingerprint: await sha256(
      JSON.stringify(["plaid-investments-holdings-import-v1", stableRows]),
    ),
    effectiveDate,
    rows,
  });
}
