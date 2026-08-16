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

export const ROBINHOOD_CRYPTO_OUTSIDE_FI_ISSUE =
  "Crypto is recorded outside the FI plan.";

export function isRobinhoodFiPlanningSecurityType(
  securityType: string,
): boolean {
  return fiPlanningSecurityTypes.has(securityType.trim().toLowerCase());
}

export function isRobinhoodOutsideFiSecurityType(
  securityType: string,
): boolean {
  return outsideFiSecurityTypes.has(securityType.trim().toLowerCase());
}

export const RobinhoodHoldingRowSchema = z
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

export const RobinhoodHoldingsImportSchema = z
  .object({
    provider: z.literal("robinhood"),
    formatVersion: z.literal(1),
    normalizedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    effectiveDate: z.iso.date(),
    rows: z.array(RobinhoodHoldingRowSchema).max(MAX_PLAID_HOLDINGS),
  })
  .strict();

export type PlaidInvestmentsHoldingsResponse = z.infer<
  typeof PlaidInvestmentsHoldingsResponseSchema
>;
export type RobinhoodHoldingRow = z.infer<typeof RobinhoodHoldingRowSchema>;
export type RobinhoodHoldingsImport = z.infer<
  typeof RobinhoodHoldingsImportSchema
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

function accountLabel(subtype: string | null): string {
  const normalized = subtype?.toLowerCase() ?? "";
  if (normalized.includes("roth")) {
    return "Robinhood Roth IRA";
  }
  if (normalized.includes("ira")) {
    return "Robinhood IRA";
  }
  return "Robinhood brokerage";
}

export function plaidInvestmentSecurityIdentity(
  security: z.infer<typeof PlaidSecuritySchema>,
): string {
  if (security.cusip != null) {
    return `cusip:${security.cusip.toUpperCase()}`;
  }
  if (security.isin != null) {
    return `isin:${security.isin.toUpperCase()}`;
  }
  if (security.sedol != null) {
    return `sedol:${security.sedol.toUpperCase()}`;
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
  if (isRobinhoodOutsideFiSecurityType(input.securityType)) {
    messages.push(ROBINHOOD_CRYPTO_OUTSIDE_FI_ISSUE);
  } else if (!isRobinhoodFiPlanningSecurityType(input.securityType)) {
    messages.push(`${input.securityType} positions are not supported yet.`);
  }
  return messages;
}

export async function normalizeRobinhoodHoldings(
  raw: unknown,
  retrievedAt: string,
): Promise<RobinhoodHoldingsImport> {
  const parsedRetrievedAt = z.iso.datetime({ offset: true }).parse(retrievedAt);
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
  if (securitiesById.size !== response.securities.length) {
    throw new Error("Plaid returned duplicate securities.");
  }

  const fallbackDate = parsedRetrievedAt.slice(0, 10);
  const rows = await Promise.all(
    response.holdings.map(
      async (holding, index): Promise<RobinhoodHoldingRow> => {
        const account = accountsById.get(holding.account_id);
        const security = securitiesById.get(holding.security_id);
        if (account === undefined || security === undefined) {
          throw new Error("Plaid holding references unknown account data.");
        }
        if (account.type.toLowerCase() !== "investment") {
          throw new Error("Plaid returned a non-investment Robinhood account.");
        }
        if (
          holding.iso_currency_code !== "USD" ||
          holding.unofficial_currency_code !== null ||
          security.iso_currency_code !== "USD" ||
          security.unofficial_currency_code !== null
        ) {
          throw new Error(
            "Robinhood sync currently supports USD holdings only.",
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
          throw new Error("Robinhood short positions are not supported yet.");
        }

        const securityName =
          security.name?.trim() || security.ticker_symbol?.trim() || "Security";
        const ticker = security.ticker_symbol?.trim().toUpperCase() ?? null;
        const securityType = security.type?.trim() || "unknown security";
        const accountIdentity =
          account.persistent_account_id ?? account.account_id;
        const naturalKeySha256 = await sha256(
          JSON.stringify([
            "robinhood-position-v1",
            accountIdentity,
            plaidInvestmentSecurityIdentity(security),
          ]),
        );
        const issues = issueMessages({ costBasisMinor, securityType });

        return RobinhoodHoldingRowSchema.parse({
          rowNumber: index + 1,
          naturalKeySha256,
          securityName,
          ticker,
          securityType,
          accountLabel: accountLabel(account.subtype),
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
    throw new Error("Plaid returned duplicate Robinhood holdings.");
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

  return RobinhoodHoldingsImportSchema.parse({
    provider: "robinhood",
    formatVersion: 1,
    normalizedFingerprint: await sha256(
      JSON.stringify(["robinhood-holdings-import-v1", stableRows]),
    ),
    effectiveDate,
    rows,
  });
}
