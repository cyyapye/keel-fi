import {
  IsoDateSchema,
  NonNegativeMoneyMinorSchema,
  ProbabilityPpmSchema,
} from "@keel/domain";
import { z } from "zod";

import { parseUsdMinorUnits } from "./angellist-investments-csv";

export const MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_BYTES = 1024 * 1024;
export const MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS = 500;
export const MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_CELL_BYTES = 4_096;

export const ProviderHoldingsTemplateProviderSchema = z.enum([
  "tokenfolio",
  "sydecar",
]);

export const PROVIDER_HOLDINGS_TEMPLATE_CSV_HEADERS = [
  "Investment",
  "Legal Position",
  "Position Type",
  "Held Through",
  "Status",
  "Investment Date",
  "As Of Date",
  "Invested USD",
  "Committed USD",
  "Current Value USD",
  "Realized Value USD",
  "Instrument",
] as const;

export const SYDECAR_HOLDINGS_TEMPLATE_CSV_V2_HEADERS = [
  ...PROVIDER_HOLDINGS_TEMPLATE_CSV_HEADERS,
  "Management Fee %",
  "Carry %",
] as const;

export const PROVIDER_HOLDINGS_TEMPLATE_CSV_PREAMBLES = {
  sydecar: "Keel Sydecar holdings template v2",
  tokenfolio: "Keel Tokenfolio holdings template v1",
} as const;
export const PROVIDER_HOLDINGS_CAPTURE_CSV_PREAMBLES = {
  sydecar: "Keel Sydecar holdings template v3",
  tokenfolio: "Keel Tokenfolio holdings template v3",
} as const;

const LEGACY_SYDECAR_HOLDINGS_TEMPLATE_CSV_PREAMBLE =
  "Keel Sydecar holdings template v1";

const RequiredTemplateTextSchema = z.string().trim().min(1).max(1_000);

export const PrivateInvestmentImportRowSchema = z
  .object({
    rowNumber: z.number().int().positive(),
    naturalKeySha256: z.string().regex(/^[a-f0-9]{64}$/u),
    providerInvestmentId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,128}$/u)
      .optional(),
    companyOrFund: RequiredTemplateTextSchema,
    status: z.enum(["Live", "Realized"]),
    investDate: IsoDateSchema.nullable(),
    investDateState: z.enum(["reported", "not_reported"]).default("reported"),
    investedMinor: NonNegativeMoneyMinorSchema.positive(),
    unrealizedValueMinor: NonNegativeMoneyMinorSchema.nullable(),
    unrealizedValueState: z.enum(["reported", "locked", "not_reported"]),
    realizedValueMinor: NonNegativeMoneyMinorSchema,
    netValueMinor: NonNegativeMoneyMinorSchema.nullable(),
    netValueState: z.enum(["reported", "locked", "not_reported"]),
    investmentEntity: RequiredTemplateTextSchema,
    fundName: RequiredTemplateTextSchema,
    positionKind: z
      .enum(["direct", "spv_interest", "fund_interest"])
      .default("spv_interest"),
    dealMetadata: z
      .object({
        allocationMinor: NonNegativeMoneyMinorSchema,
        instrument: RequiredTemplateTextSchema,
        managementFeePpm: ProbabilityPpmSchema.nullable().default(null),
        carryPpm: ProbabilityPpmSchema.nullable().default(null),
      })
      .passthrough(),
  })
  .passthrough()
  .superRefine((row, context) => {
    const valueMatchesState =
      (row.unrealizedValueState === "reported" &&
        row.unrealizedValueMinor !== null) ||
      (row.unrealizedValueState !== "reported" &&
        row.unrealizedValueMinor === null);
    if (!valueMatchesState) {
      context.addIssue({
        code: "custom",
        message: "Current value state must match its value.",
        path: ["unrealizedValueState"],
      });
    }
    const dateMatchesState =
      (row.investDateState === "reported" && row.investDate !== null) ||
      (row.investDateState === "not_reported" && row.investDate === null);
    if (!dateMatchesState) {
      context.addIssue({
        code: "custom",
        message: "Investment date state must match its value.",
        path: ["investDateState"],
      });
    }
    const netMatchesState =
      (row.netValueState === "reported" && row.netValueMinor !== null) ||
      (row.netValueState !== "reported" && row.netValueMinor === null);
    if (!netMatchesState) {
      context.addIssue({
        code: "custom",
        message: "Net value state must match its value.",
        path: ["netValueState"],
      });
    }
    if (
      (row.dealMetadata.managementFeePpm !== null ||
        row.dealMetadata.carryPpm !== null) &&
      row.positionKind !== "spv_interest"
    ) {
      context.addIssue({
        code: "custom",
        message: "Reported position economics require an SPV position.",
        path: ["positionKind"],
      });
    }
  });

export const ProviderHoldingsTemplateCsvImportSchema = z
  .object({
    provider: ProviderHoldingsTemplateProviderSchema,
    formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    effectiveDate: IsoDateSchema,
    rows: z
      .array(PrivateInvestmentImportRowSchema)
      .min(1)
      .max(MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS),
  })
  .strict();

export type ProviderHoldingsTemplateProvider = z.infer<
  typeof ProviderHoldingsTemplateProviderSchema
>;
export type PrivateInvestmentImportRow = z.infer<
  typeof PrivateInvestmentImportRowSchema
>;
export type ProviderHoldingsTemplateCsvImport = z.infer<
  typeof ProviderHoldingsTemplateCsvImportSchema
>;

type ProviderHoldingsTemplateCsvErrorCode =
  | "file_too_large"
  | "invalid_utf8"
  | "invalid_csv"
  | "invalid_preamble"
  | "invalid_header"
  | "too_many_rows"
  | "invalid_row_width"
  | "unsafe_cell"
  | "invalid_row";

export class ProviderHoldingsTemplateCsvParseError extends Error {
  public constructor(
    public readonly code: ProviderHoldingsTemplateCsvErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHoldingsTemplateCsvParseError";
  }
}

type CsvRecord = {
  readonly rowNumber: number;
  readonly fields: readonly string[];
};

type CsvMode = "field_start" | "unquoted" | "quoted" | "after_quote";

function providerLabel(provider: ProviderHoldingsTemplateProvider): string {
  return provider === "tokenfolio" ? "Tokenfolio" : "Sydecar";
}

function parseCsvRecords(
  document: string,
  provider: ProviderHoldingsTemplateProvider,
): readonly CsvRecord[] {
  const label = providerLabel(provider);
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let mode: CsvMode = "field_start";
  let lineNumber = 1;
  let recordStartLine = 1;

  const append = (value: string): void => {
    field += value;
    if (field.length > MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_CELL_BYTES) {
      throw new ProviderHoldingsTemplateCsvParseError(
        "invalid_csv",
        `${label} template row ${recordStartLine.toString()} contains an oversized cell.`,
      );
    }
  };

  const finishField = (): void => {
    if (
      new TextEncoder().encode(field).byteLength >
      MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_CELL_BYTES
    ) {
      throw new ProviderHoldingsTemplateCsvParseError(
        "invalid_csv",
        `${label} template row ${recordStartLine.toString()} contains an oversized cell.`,
      );
    }
    fields.push(field);
    field = "";
  };

  const finishRecord = (): void => {
    finishField();
    records.push({ fields, rowNumber: recordStartLine });
    if (records.length > MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS + 2) {
      throw new ProviderHoldingsTemplateCsvParseError(
        "too_many_rows",
        `${label} template exceeds ${MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS.toString()} holding rows.`,
      );
    }
    fields = [];
    mode = "field_start";
  };

  for (let index = 0; index < document.length; index += 1) {
    const character = document[index] ?? "";

    if (mode === "quoted") {
      if (character === '"') {
        if (document[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          mode = "after_quote";
        }
      } else if (character === "\r") {
        if (document[index + 1] !== "\n") {
          throw new ProviderHoldingsTemplateCsvParseError(
            "invalid_csv",
            `${label} template row ${recordStartLine.toString()} contains a bare carriage return.`,
          );
        }
        append("\n");
        index += 1;
        lineNumber += 1;
      } else {
        append(character);
        if (character === "\n") {
          lineNumber += 1;
        }
      }
      continue;
    }

    if (character === ",") {
      finishField();
      mode = "field_start";
      continue;
    }

    if (character === "\r" || character === "\n") {
      if (character === "\r") {
        if (document[index + 1] !== "\n") {
          throw new ProviderHoldingsTemplateCsvParseError(
            "invalid_csv",
            `${label} template row ${recordStartLine.toString()} contains a bare carriage return.`,
          );
        }
        index += 1;
      }
      finishRecord();
      lineNumber += 1;
      recordStartLine = lineNumber;
      continue;
    }

    if (character === '"') {
      if (mode !== "field_start") {
        throw new ProviderHoldingsTemplateCsvParseError(
          "invalid_csv",
          `${label} template row ${recordStartLine.toString()} contains an invalid quote.`,
        );
      }
      mode = "quoted";
      continue;
    }

    if (mode === "after_quote") {
      throw new ProviderHoldingsTemplateCsvParseError(
        "invalid_csv",
        `${label} template row ${recordStartLine.toString()} contains characters after a closing quote.`,
      );
    }

    append(character);
    mode = "unquoted";
  }

  if (mode === "quoted") {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_csv",
      `${label} template row ${recordStartLine.toString()} contains an unterminated quoted cell.`,
    );
  }

  if (mode !== "field_start" || fields.length > 0 || field.length > 0) {
    finishRecord();
  }

  return records;
}

function decodeUtf8(
  contents: Uint8Array,
  provider: ProviderHoldingsTemplateProvider,
): string {
  const label = providerLabel(provider);
  if (contents.byteLength > MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_BYTES) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "file_too_large",
      `${label} template exceeds ${MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_BYTES.toString()} bytes.`,
    );
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    const withoutBom = decoded.startsWith("\uFEFF")
      ? decoded.slice(1)
      : decoded;
    if (withoutBom.includes("\0")) {
      throw new ProviderHoldingsTemplateCsvParseError(
        "invalid_utf8",
        `${label} template contains a NUL character.`,
      );
    }
    return withoutBom;
  } catch (error) {
    if (error instanceof ProviderHoldingsTemplateCsvParseError) {
      throw error;
    }
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_utf8",
      `${label} template must be valid UTF-8.`,
    );
  }
}

function isFormulaLike(value: string): boolean {
  const firstCharacter = value.trimStart()[0];
  return (
    firstCharacter === "=" ||
    firstCharacter === "+" ||
    firstCharacter === "-" ||
    firstCharacter === "@"
  );
}

function validIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseTemplateUsd(
  value: string,
  rowNumber: number,
  fieldName: string,
  provider: ProviderHoldingsTemplateProvider,
): number {
  try {
    return parseUsdMinorUnits(value);
  } catch {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${providerLabel(provider)} template row ${rowNumber.toString()} has an invalid ${fieldName} value. Use a non-negative value such as $1250.00.`,
    );
  }
}

function parseOptionalTemplateUsd(
  value: string,
  rowNumber: number,
  fieldName: string,
  provider: ProviderHoldingsTemplateProvider,
): number | null {
  return value.trim() === ""
    ? null
    : parseTemplateUsd(value, rowNumber, fieldName, provider);
}

function parseTemplatePercentagePpm(
  value: string,
  rowNumber: number,
  fieldName: string,
  provider: ProviderHoldingsTemplateProvider,
): number {
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?%$/u.exec(value.trim());
  if (match === null) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${providerLabel(provider)} template row ${rowNumber.toString()} has an invalid ${fieldName} value. Use a percentage such as 2% or 12.5%.`,
    );
  }
  const whole = Number(match[1]);
  const fractional = Number((match[2] ?? "").padEnd(4, "0"));
  const ppm = whole * 10_000 + fractional;
  if (!Number.isSafeInteger(ppm) || ppm > 1_000_000) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${providerLabel(provider)} template row ${rowNumber.toString()} has an invalid ${fieldName} value. Use a percentage from 0% through 100%.`,
    );
  }
  return ppm;
}

function safeMinorSum(left: number, right: number): number {
  return NonNegativeMoneyMinorSchema.parse(
    Number(BigInt(left) + BigInt(right)),
  );
}

function canonicalNaturalKeyPart(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export async function createProviderPositionNaturalKeySha256(input: {
  readonly provider: ProviderHoldingsTemplateProvider;
  readonly legalPosition: string;
  readonly heldThrough: string;
  readonly investmentDate: string | null;
  readonly investment: string;
}): Promise<string> {
  const canonical = JSON.stringify([
    `${input.provider}-keel-template-position-v1`,
    canonicalNaturalKeyPart(input.legalPosition),
    canonicalNaturalKeyPart(input.heldThrough),
    input.investmentDate ?? "not_reported",
    canonicalNaturalKeyPart(input.investment),
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const RawTemplateRowSchema = z
  .object({
    investment: RequiredTemplateTextSchema,
    legalPosition: RequiredTemplateTextSchema,
    positionType: z.enum(["Direct", "SPV", "Fund"]),
    heldThrough: RequiredTemplateTextSchema,
    status: z.enum(["Live", "Realized"]),
    investmentDate: z.string().trim().max(1_000),
    asOfDate: RequiredTemplateTextSchema,
    investedUsd: RequiredTemplateTextSchema,
    committedUsd: z.string().trim().max(1_000),
    currentValueUsd: z.string().trim().max(1_000),
    realizedValueUsd: z.string().trim().max(1_000),
    instrument: RequiredTemplateTextSchema,
    managementFeePercent: RequiredTemplateTextSchema.nullable(),
    carryPercent: RequiredTemplateTextSchema.nullable(),
    providerInvestmentId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,128}$/u)
      .optional(),
  })
  .strict();

function toRawTemplateRow(
  fields: readonly string[],
  formatVersion: 1 | 2 | 3,
  provider: ProviderHoldingsTemplateProvider,
) {
  const hasFees = provider === "sydecar" && formatVersion >= 2;
  return {
    investment: fields[0],
    legalPosition: fields[1],
    positionType: fields[2],
    heldThrough: fields[3],
    status: fields[4],
    investmentDate: fields[5],
    asOfDate: fields[6],
    investedUsd: fields[7],
    committedUsd: fields[8],
    currentValueUsd: fields[9],
    realizedValueUsd: fields[10],
    instrument: fields[11],
    managementFeePercent: hasFees ? fields[12] : null,
    carryPercent: hasFees ? fields[13] : null,
    ...(formatVersion === 3
      ? { providerInvestmentId: fields[hasFees ? 14 : 12] }
      : {}),
  };
}

async function parseTemplateRow(
  record: CsvRecord,
  provider: ProviderHoldingsTemplateProvider,
  formatVersion: 1 | 2 | 3,
): Promise<{ effectiveDate: string; row: PrivateInvestmentImportRow }> {
  const label = providerLabel(provider);
  const headers = providerHoldingsTemplateCsvHeaders(provider, formatVersion);
  if (record.fields.length !== headers.length) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row_width",
      `${label} template row ${record.rowNumber.toString()} must contain exactly ${headers.length.toString()} columns.`,
    );
  }
  if (record.fields.some(isFormulaLike)) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "unsafe_cell",
      `${label} template row ${record.rowNumber.toString()} contains a formula-like value.`,
    );
  }
  const parsedRaw = RawTemplateRowSchema.safeParse(
    toRawTemplateRow(record.fields, formatVersion, provider),
  );
  if (!parsedRaw.success) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${label} template row ${record.rowNumber.toString()} contains missing or unsupported fields.`,
    );
  }
  const raw = parsedRaw.data;
  const investmentDate =
    provider === "sydecar" && raw.investmentDate === ""
      ? null
      : raw.investmentDate;
  if (
    (investmentDate !== null && !validIsoDate(investmentDate)) ||
    !validIsoDate(raw.asOfDate)
  ) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${label} template row ${record.rowNumber.toString()} must use YYYY-MM-DD dates.`,
    );
  }
  if (investmentDate !== null && raw.asOfDate < investmentDate) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${label} template row ${record.rowNumber.toString()} has an as-of date before its investment date.`,
    );
  }

  const investedMinor = parseTemplateUsd(
    raw.investedUsd,
    record.rowNumber,
    "Invested USD",
    provider,
  );
  if (investedMinor === 0) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${label} template row ${record.rowNumber.toString()} must have a positive funded amount.`,
    );
  }
  const committedMinor =
    parseOptionalTemplateUsd(
      raw.committedUsd,
      record.rowNumber,
      "Committed USD",
      provider,
    ) ?? investedMinor;
  if (committedMinor < investedMinor) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${label} template row ${record.rowNumber.toString()} cannot have a committed amount below its funded amount.`,
    );
  }
  const currentValueMinor = parseOptionalTemplateUsd(
    raw.currentValueUsd,
    record.rowNumber,
    "Current Value USD",
    provider,
  );
  const realizedValueMinor =
    parseOptionalTemplateUsd(
      raw.realizedValueUsd,
      record.rowNumber,
      "Realized Value USD",
      provider,
    ) ?? 0;
  const netValueMinor =
    currentValueMinor === null
      ? null
      : safeMinorSum(currentValueMinor, realizedValueMinor);
  const valueState =
    currentValueMinor === null
      ? ("not_reported" as const)
      : ("reported" as const);
  const positionKind = {
    Direct: "direct",
    Fund: "fund_interest",
    SPV: "spv_interest",
  }[raw.positionType] as "direct" | "fund_interest" | "spv_interest";
  const managementFeePpm =
    raw.managementFeePercent === null
      ? null
      : parseTemplatePercentagePpm(
          raw.managementFeePercent,
          record.rowNumber,
          "Management Fee %",
          provider,
        );
  const carryPpm =
    raw.carryPercent === null
      ? null
      : parseTemplatePercentagePpm(
          raw.carryPercent,
          record.rowNumber,
          "Carry %",
          provider,
        );

  return {
    effectiveDate: raw.asOfDate,
    row: PrivateInvestmentImportRowSchema.parse({
      rowNumber: record.rowNumber,
      naturalKeySha256: await createProviderPositionNaturalKeySha256({
        heldThrough: raw.heldThrough,
        investment: raw.investment,
        investmentDate,
        legalPosition: raw.legalPosition,
        provider,
      }),
      companyOrFund: raw.investment,
      ...(raw.providerInvestmentId === undefined
        ? {}
        : { providerInvestmentId: raw.providerInvestmentId }),
      status: raw.status,
      investDate: investmentDate,
      investDateState: investmentDate === null ? "not_reported" : "reported",
      investedMinor,
      unrealizedValueMinor: currentValueMinor,
      unrealizedValueState: valueState,
      realizedValueMinor,
      netValueMinor,
      netValueState: valueState,
      investmentEntity: raw.heldThrough,
      fundName: raw.legalPosition,
      positionKind,
      dealMetadata: {
        allocationMinor: committedMinor,
        instrument: raw.instrument,
        managementFeePpm,
        carryPpm,
      },
    }),
  };
}

function hasExactHeader(
  fields: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    fields.length === expected.length &&
    fields.every((field, index) => field === expected[index])
  );
}

export function providerHoldingsTemplateCsvHeaders(
  provider: ProviderHoldingsTemplateProvider,
  formatVersion: 1 | 2 | 3 = provider === "sydecar" ? 2 : 1,
): readonly string[] {
  const headers =
    provider === "sydecar" && formatVersion >= 2
      ? SYDECAR_HOLDINGS_TEMPLATE_CSV_V2_HEADERS
      : PROVIDER_HOLDINGS_TEMPLATE_CSV_HEADERS;
  return formatVersion === 3 ? [...headers, "Provider Investment ID"] : headers;
}

export function providerHoldingsTemplateCsv(
  rawProvider: ProviderHoldingsTemplateProvider,
): string {
  const provider = ProviderHoldingsTemplateProviderSchema.parse(rawProvider);
  return `${PROVIDER_HOLDINGS_TEMPLATE_CSV_PREAMBLES[provider]}\n${providerHoldingsTemplateCsvHeaders(provider).join(",")}\n`;
}

export async function parseProviderHoldingsTemplateCsv(
  rawProvider: ProviderHoldingsTemplateProvider,
  contents: Uint8Array,
): Promise<ProviderHoldingsTemplateCsvImport> {
  const provider = ProviderHoldingsTemplateProviderSchema.parse(rawProvider);
  const label = providerLabel(provider);
  const records = parseCsvRecords(decodeUtf8(contents, provider), provider);
  const preamble = records[0];
  const header = records[1];
  const preambleValue =
    preamble !== undefined && preamble.fields.length === 1
      ? preamble.fields[0]
      : null;
  const formatVersion =
    preambleValue === PROVIDER_HOLDINGS_CAPTURE_CSV_PREAMBLES[provider]
      ? (3 as const)
      : preambleValue === PROVIDER_HOLDINGS_TEMPLATE_CSV_PREAMBLES[provider]
        ? provider === "sydecar"
          ? (2 as const)
          : (1 as const)
        : provider === "sydecar" &&
            preambleValue === LEGACY_SYDECAR_HOLDINGS_TEMPLATE_CSV_PREAMBLE
          ? (1 as const)
          : null;
  if (formatVersion === null) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_preamble",
      `Choose the Keel ${label} holdings template without changing its first line.`,
    );
  }
  const expectedHeaders = providerHoldingsTemplateCsvHeaders(
    provider,
    formatVersion,
  );
  if (header === undefined || !hasExactHeader(header.fields, expectedHeaders)) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_header",
      `${label} template header does not match the supported format. Download a fresh template.`,
    );
  }
  if (records.length === 2) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${label} template must contain at least one holding row.`,
    );
  }

  const parsedRows = await Promise.all(
    records
      .slice(2)
      .map((record) => parseTemplateRow(record, provider, formatVersion)),
  );
  const effectiveDates = new Set(
    parsedRows.map((record) => record.effectiveDate),
  );
  if (effectiveDates.size !== 1) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${label} template rows must use one shared As Of Date.`,
    );
  }
  const effectiveDate = parsedRows[0]?.effectiveDate;
  if (effectiveDate === undefined) {
    throw new ProviderHoldingsTemplateCsvParseError(
      "invalid_row",
      `${label} template must contain at least one holding row.`,
    );
  }
  return ProviderHoldingsTemplateCsvImportSchema.parse({
    provider,
    formatVersion,
    effectiveDate,
    rows: parsedRows.map((record) => record.row),
  });
}
