import { IsoDateSchema, NonNegativeMoneyMinorSchema } from "@keel/domain";
import { z } from "zod";

export const MAX_ANGELLIST_CSV_BYTES = 1024 * 1024;
export const MAX_ANGELLIST_CSV_ROWS = 500;
export const MAX_ANGELLIST_CSV_CELL_BYTES = 4_096;
export const ANGELLIST_INVESTMENTS_CSV_PREAMBLE =
  "Do not disclose. Investments on AngelList are highly confidential";

export const ANGELLIST_INVESTMENTS_CSV_HEADERS = [
  "Company/Fund",
  "Status",
  "Invest Date",
  "Invested",
  "Unrealized Value",
  "Realized Value",
  "Net Value",
  "Multiple",
  "Investment Entity",
  "Lead",
  "Investment Type",
  "Source",
  "Round",
  "Market",
  "Fund Name",
  "Allocation",
  "Instrument",
  "Round Size",
  "Valuation or Cap Type",
  "Valuation or Cap",
  "Discount",
  "Carry",
  "Share Class",
] as const;

export const AngelListInvestmentStatusSchema = z.enum(["Live", "Realized"]);
export const AngelListInvestmentTypeSchema = z.literal("Syndicate");
export const AngelListPositionValueStateSchema = z.enum(["reported", "locked"]);

const RequiredProviderTextSchema = z.string().trim().min(1).max(1_000);
const OptionalProviderTextSchema = z
  .string()
  .trim()
  .max(1_000)
  .transform((value) => (value === "" ? null : value));

export const AngelListDealMetadataSchema = z
  .object({
    allocationMinor: NonNegativeMoneyMinorSchema,
    instrument: RequiredProviderTextSchema,
    roundSizeMinor: NonNegativeMoneyMinorSchema.nullable(),
    valuationOrCapType: z.string().min(1).max(1_000).nullable(),
    valuationOrCapMinor: NonNegativeMoneyMinorSchema.nullable(),
    discount: z.string().min(1).max(1_000).nullable(),
    carry: z.string().min(1).max(1_000).nullable(),
    shareClass: z.string().min(1).max(1_000).nullable(),
  })
  .strict();

export const AngelListInvestmentCsvRowSchema = z
  .object({
    rowNumber: z.number().int().min(3),
    naturalKeySha256: z.string().regex(/^[a-f0-9]{64}$/),
    companyOrFund: RequiredProviderTextSchema,
    status: AngelListInvestmentStatusSchema,
    investDate: IsoDateSchema,
    investedMinor: NonNegativeMoneyMinorSchema.positive(),
    unrealizedValueMinor: NonNegativeMoneyMinorSchema.nullable(),
    unrealizedValueState: AngelListPositionValueStateSchema,
    realizedValueMinor: NonNegativeMoneyMinorSchema,
    netValueMinor: NonNegativeMoneyMinorSchema.nullable(),
    netValueState: AngelListPositionValueStateSchema,
    multiplePpm: z.number().int().safe().nonnegative().nullable(),
    investmentEntity: RequiredProviderTextSchema,
    lead: z.string().min(1).max(1_000).nullable(),
    investmentType: AngelListInvestmentTypeSchema,
    source: z.string().min(1).max(1_000).nullable(),
    round: z.string().min(1).max(1_000).nullable(),
    market: z.string().min(1).max(1_000).nullable(),
    fundName: RequiredProviderTextSchema,
    dealMetadata: AngelListDealMetadataSchema,
  })
  .strict()
  .superRefine((row, context) => {
    const unrealizedIsLocked = row.unrealizedValueState === "locked";
    const netIsLocked = row.netValueState === "locked";
    if (unrealizedIsLocked !== (row.unrealizedValueMinor === null)) {
      context.addIssue({
        code: "custom",
        path: ["unrealizedValueState"],
        message: "Unrealized value state must match its value.",
      });
    }
    if (netIsLocked !== (row.netValueMinor === null)) {
      context.addIssue({
        code: "custom",
        path: ["netValueState"],
        message: "Net value state must match its value.",
      });
    }
    if (unrealizedIsLocked !== netIsLocked) {
      context.addIssue({
        code: "custom",
        path: ["netValueState"],
        message: "Unrealized and net value states must agree.",
      });
    }
    if (netIsLocked !== (row.multiplePpm === null)) {
      context.addIssue({
        code: "custom",
        path: ["multiplePpm"],
        message: "Multiple availability must match net value state.",
      });
    }
  });

export const AngelListInvestmentsCsvImportSchema = z
  .object({
    provider: z.literal("angellist"),
    formatVersion: z.literal(1),
    rows: z
      .array(AngelListInvestmentCsvRowSchema)
      .min(1)
      .max(MAX_ANGELLIST_CSV_ROWS),
  })
  .strict();

export type AngelListDealMetadata = z.infer<typeof AngelListDealMetadataSchema>;
export type AngelListInvestmentCsvRow = z.infer<
  typeof AngelListInvestmentCsvRowSchema
>;
export type AngelListInvestmentsCsvImport = z.infer<
  typeof AngelListInvestmentsCsvImportSchema
>;

type AngelListCsvErrorCode =
  | "file_too_large"
  | "invalid_utf8"
  | "invalid_csv"
  | "invalid_preamble"
  | "invalid_header"
  | "too_many_rows"
  | "invalid_row_width"
  | "unsafe_cell"
  | "invalid_row";

export class AngelListCsvParseError extends Error {
  readonly code: AngelListCsvErrorCode;

  constructor(code: AngelListCsvErrorCode, message: string) {
    super(message);
    this.name = "AngelListCsvParseError";
    this.code = code;
  }
}

type CsvRecord = {
  readonly rowNumber: number;
  readonly fields: readonly string[];
};

type CsvMode = "field_start" | "unquoted" | "quoted" | "after_quote";

function parseCsvRecords(document: string): readonly CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let mode: CsvMode = "field_start";
  let lineNumber = 1;
  let recordStartLine = 1;

  const append = (value: string): void => {
    field += value;
    if (field.length > MAX_ANGELLIST_CSV_CELL_BYTES) {
      throw new AngelListCsvParseError(
        "invalid_csv",
        `AngelList CSV row ${recordStartLine} contains an oversized cell.`,
      );
    }
  };

  const finishField = (): void => {
    if (
      new TextEncoder().encode(field).byteLength > MAX_ANGELLIST_CSV_CELL_BYTES
    ) {
      throw new AngelListCsvParseError(
        "invalid_csv",
        `AngelList CSV row ${recordStartLine} contains an oversized cell.`,
      );
    }
    fields.push(field);
    field = "";
  };

  const finishRecord = (): void => {
    finishField();
    records.push({ rowNumber: recordStartLine, fields });
    if (records.length > MAX_ANGELLIST_CSV_ROWS + 2) {
      throw new AngelListCsvParseError(
        "too_many_rows",
        `AngelList CSV exceeds ${MAX_ANGELLIST_CSV_ROWS.toString()} investment rows.`,
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
          throw new AngelListCsvParseError(
            "invalid_csv",
            `AngelList CSV row ${recordStartLine} contains a bare carriage return.`,
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
      if (
        mode === "after_quote" ||
        mode === "unquoted" ||
        mode === "field_start"
      ) {
        finishField();
        mode = "field_start";
        continue;
      }
    }

    if (character === "\r" || character === "\n") {
      if (character === "\r") {
        if (document[index + 1] !== "\n") {
          throw new AngelListCsvParseError(
            "invalid_csv",
            `AngelList CSV row ${recordStartLine} contains a bare carriage return.`,
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
        throw new AngelListCsvParseError(
          "invalid_csv",
          `AngelList CSV row ${recordStartLine} contains an invalid quote.`,
        );
      }
      mode = "quoted";
      continue;
    }

    if (mode === "after_quote") {
      throw new AngelListCsvParseError(
        "invalid_csv",
        `AngelList CSV row ${recordStartLine} contains characters after a closing quote.`,
      );
    }

    append(character);
    mode = "unquoted";
  }

  if (mode === "quoted") {
    throw new AngelListCsvParseError(
      "invalid_csv",
      `AngelList CSV row ${recordStartLine} contains an unterminated quoted cell.`,
    );
  }

  if (mode !== "field_start" || fields.length > 0 || field.length > 0) {
    finishRecord();
  }

  return records;
}

function decodeUtf8(contents: Uint8Array): string {
  if (contents.byteLength > MAX_ANGELLIST_CSV_BYTES) {
    throw new AngelListCsvParseError(
      "file_too_large",
      `AngelList CSV exceeds ${MAX_ANGELLIST_CSV_BYTES.toString()} bytes.`,
    );
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    const withoutBom = decoded.startsWith("\uFEFF")
      ? decoded.slice(1)
      : decoded;
    if (withoutBom.includes("\0")) {
      throw new AngelListCsvParseError(
        "invalid_utf8",
        "AngelList CSV contains a NUL character.",
      );
    }
    return withoutBom;
  } catch (error) {
    if (error instanceof AngelListCsvParseError) {
      throw error;
    }
    throw new AngelListCsvParseError(
      "invalid_utf8",
      "AngelList CSV must be valid UTF-8.",
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

export function parseUsdMinorUnits(value: string): number {
  const match =
    /^\$(?:(0|[1-9]\d*)|([1-9]\d{0,2}(?:,\d{3})+))(?:\.(\d{2}))?$/.exec(
      value.trim(),
    );
  if (match === null) {
    throw new Error("USD amount must use a non-negative dollar format.");
  }

  const dollars = BigInt((match[1] ?? match[2] ?? "").replaceAll(",", ""));
  const cents = BigInt(match[3] ?? "00");
  const minorUnits = dollars * 100n + cents;
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("USD amount exceeds the supported safe-integer range.");
  }
  return Number(minorUnits);
}

export function parseUsDateToIso(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (match === null) {
    throw new Error("Date must use M/D/YYYY or MM/DD/YYYY format.");
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const maximumDay = daysInMonth[month - 1];
  if (maximumDay === undefined || day < 1 || day > maximumDay) {
    throw new Error("Date is not a valid calendar date.");
  }

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

type ParsedMultiple = {
  readonly numerator: bigint;
  readonly scale: bigint;
  readonly ppm: number;
};

function parseMultiple(value: string): ParsedMultiple {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,30}))?$/.exec(value.trim());
  if (match === null) {
    throw new Error("Multiple must be a non-negative bare decimal.");
  }

  const fraction = match[2] ?? "";
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(match[1] ?? "0") * scale + BigInt(fraction || "0");
  const ppm = (numerator * 1_000_000n + scale / 2n) / scale;
  if (ppm > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Multiple exceeds the supported safe-integer range.");
  }
  return { numerator, scale, ppm: Number(ppm) };
}

function parseRowUsd(
  value: string,
  rowNumber: number,
  fieldName: string,
): number {
  try {
    return parseUsdMinorUnits(value);
  } catch {
    throw new AngelListCsvParseError(
      "invalid_row",
      `AngelList CSV row ${rowNumber.toString()} has an invalid ${fieldName} value.`,
    );
  }
}

function parseOptionalRowUsd(
  value: string,
  rowNumber: number,
  fieldName: string,
): number | null {
  return value.trim() === "" ? null : parseRowUsd(value, rowNumber, fieldName);
}

function canonicalNaturalKeyPart(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

async function createNaturalKeySha256(input: {
  readonly fundName: string;
  readonly investmentEntity: string;
  readonly investDate: string;
  readonly companyOrFund: string;
}): Promise<string> {
  const canonical = JSON.stringify([
    "angellist-investment-v1",
    canonicalNaturalKeyPart(input.fundName),
    canonicalNaturalKeyPart(input.investmentEntity),
    input.investDate,
    canonicalNaturalKeyPart(input.companyOrFund),
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const RawAngelListRowSchema = z
  .object({
    companyOrFund: RequiredProviderTextSchema,
    status: AngelListInvestmentStatusSchema,
    investDate: RequiredProviderTextSchema,
    invested: RequiredProviderTextSchema,
    unrealizedValue: RequiredProviderTextSchema,
    realizedValue: RequiredProviderTextSchema,
    netValue: RequiredProviderTextSchema,
    multiple: z.string().trim().max(1_000),
    investmentEntity: RequiredProviderTextSchema,
    lead: OptionalProviderTextSchema,
    investmentType: AngelListInvestmentTypeSchema,
    source: OptionalProviderTextSchema,
    round: OptionalProviderTextSchema,
    market: OptionalProviderTextSchema,
    fundName: RequiredProviderTextSchema,
    allocation: RequiredProviderTextSchema,
    instrument: RequiredProviderTextSchema,
    roundSize: z.string().trim().max(1_000),
    valuationOrCapType: OptionalProviderTextSchema,
    valuationOrCap: z.string().trim().max(1_000),
    discount: OptionalProviderTextSchema,
    carry: OptionalProviderTextSchema,
    shareClass: OptionalProviderTextSchema,
  })
  .strict();

function toRawRow(fields: readonly string[]) {
  return {
    companyOrFund: fields[0],
    status: fields[1],
    investDate: fields[2],
    invested: fields[3],
    unrealizedValue: fields[4],
    realizedValue: fields[5],
    netValue: fields[6],
    multiple: fields[7],
    investmentEntity: fields[8],
    lead: fields[9],
    investmentType: fields[10],
    source: fields[11],
    round: fields[12],
    market: fields[13],
    fundName: fields[14],
    allocation: fields[15],
    instrument: fields[16],
    roundSize: fields[17],
    valuationOrCapType: fields[18],
    valuationOrCap: fields[19],
    discount: fields[20],
    carry: fields[21],
    shareClass: fields[22],
  };
}

async function parseInvestmentRecord(
  record: CsvRecord,
): Promise<AngelListInvestmentCsvRow> {
  if (record.fields.length !== ANGELLIST_INVESTMENTS_CSV_HEADERS.length) {
    throw new AngelListCsvParseError(
      "invalid_row_width",
      `AngelList CSV row ${record.rowNumber.toString()} must contain exactly 23 columns.`,
    );
  }

  for (
    let columnIndex = 0;
    columnIndex < record.fields.length;
    columnIndex += 1
  ) {
    const value = record.fields[columnIndex] ?? "";
    if (isFormulaLike(value)) {
      throw new AngelListCsvParseError(
        "unsafe_cell",
        `AngelList CSV row ${record.rowNumber.toString()}, column ${(columnIndex + 1).toString()} contains a formula-like value.`,
      );
    }
  }

  const parsedRaw = RawAngelListRowSchema.safeParse(toRawRow(record.fields));
  if (!parsedRaw.success) {
    throw new AngelListCsvParseError(
      "invalid_row",
      `AngelList CSV row ${record.rowNumber.toString()} contains missing or unsupported fields.`,
    );
  }
  const raw = parsedRaw.data;

  let investDate: string;
  try {
    investDate = parseUsDateToIso(raw.investDate);
  } catch {
    throw new AngelListCsvParseError(
      "invalid_row",
      `AngelList CSV row ${record.rowNumber.toString()} has an invalid Invest Date value.`,
    );
  }

  const investedMinor = parseRowUsd(raw.invested, record.rowNumber, "Invested");
  if (investedMinor === 0) {
    throw new AngelListCsvParseError(
      "invalid_row",
      `AngelList CSV row ${record.rowNumber.toString()} must have a positive Invested value.`,
    );
  }
  const realizedValueMinor = parseRowUsd(
    raw.realizedValue,
    record.rowNumber,
    "Realized Value",
  );

  const unrealizedLocked = raw.unrealizedValue === "Locked";
  const netLocked = raw.netValue === "Locked";
  if (unrealizedLocked !== netLocked) {
    throw new AngelListCsvParseError(
      "invalid_row",
      `AngelList CSV row ${record.rowNumber.toString()} has inconsistent locked values.`,
    );
  }

  const unrealizedValueMinor = unrealizedLocked
    ? null
    : parseRowUsd(raw.unrealizedValue, record.rowNumber, "Unrealized Value");
  const netValueMinor = netLocked
    ? null
    : parseRowUsd(raw.netValue, record.rowNumber, "Net Value");

  let multiplePpm: number | null = null;
  if (netLocked) {
    if (raw.multiple !== "") {
      throw new AngelListCsvParseError(
        "invalid_row",
        `AngelList CSV row ${record.rowNumber.toString()} must have a blank Multiple when Net Value is locked.`,
      );
    }
  } else {
    if (raw.multiple === "") {
      throw new AngelListCsvParseError(
        "invalid_row",
        `AngelList CSV row ${record.rowNumber.toString()} must have a Multiple value.`,
      );
    }
    if (unrealizedValueMinor === null || netValueMinor === null) {
      throw new AngelListCsvParseError(
        "invalid_row",
        `AngelList CSV row ${record.rowNumber.toString()} has inconsistent position values.`,
      );
    }
    if (
      BigInt(netValueMinor) !==
      BigInt(unrealizedValueMinor) + BigInt(realizedValueMinor)
    ) {
      throw new AngelListCsvParseError(
        "invalid_row",
        `AngelList CSV row ${record.rowNumber.toString()} has inconsistent Net Value components.`,
      );
    }

    let parsedMultiple: ParsedMultiple;
    try {
      parsedMultiple = parseMultiple(raw.multiple);
    } catch {
      throw new AngelListCsvParseError(
        "invalid_row",
        `AngelList CSV row ${record.rowNumber.toString()} has an invalid Multiple value.`,
      );
    }
    const ratioDifference =
      parsedMultiple.numerator * BigInt(investedMinor) -
      BigInt(netValueMinor) * parsedMultiple.scale;
    const absoluteDifference =
      ratioDifference < 0n ? -ratioDifference : ratioDifference;
    // AngelList serializes some multiples through binary floating point. Keep
    // the provider decimal intact for validation, but tolerate no more than
    // one trillionth of a multiple using integer rational arithmetic.
    if (
      absoluteDifference * 1_000_000_000_000n >
      parsedMultiple.scale * BigInt(investedMinor)
    ) {
      throw new AngelListCsvParseError(
        "invalid_row",
        `AngelList CSV row ${record.rowNumber.toString()} has a Multiple inconsistent with Net Value and Invested.`,
      );
    }
    multiplePpm = parsedMultiple.ppm;
  }

  const allocationMinor = parseRowUsd(
    raw.allocation,
    record.rowNumber,
    "Allocation",
  );
  const roundSizeMinor = parseOptionalRowUsd(
    raw.roundSize,
    record.rowNumber,
    "Round Size",
  );
  const valuationOrCapMinor = parseOptionalRowUsd(
    raw.valuationOrCap,
    record.rowNumber,
    "Valuation or Cap",
  );
  const naturalKeySha256 = await createNaturalKeySha256({
    fundName: raw.fundName,
    investmentEntity: raw.investmentEntity,
    investDate,
    companyOrFund: raw.companyOrFund,
  });

  return AngelListInvestmentCsvRowSchema.parse({
    rowNumber: record.rowNumber,
    naturalKeySha256,
    companyOrFund: raw.companyOrFund,
    status: raw.status,
    investDate,
    investedMinor,
    unrealizedValueMinor,
    unrealizedValueState: unrealizedLocked ? "locked" : "reported",
    realizedValueMinor,
    netValueMinor,
    netValueState: netLocked ? "locked" : "reported",
    multiplePpm,
    investmentEntity: raw.investmentEntity,
    lead: raw.lead,
    investmentType: raw.investmentType,
    source: raw.source,
    round: raw.round,
    market: raw.market,
    fundName: raw.fundName,
    dealMetadata: {
      allocationMinor,
      instrument: raw.instrument,
      roundSizeMinor,
      valuationOrCapType: raw.valuationOrCapType,
      valuationOrCapMinor,
      discount: raw.discount,
      carry: raw.carry,
      shareClass: raw.shareClass,
    },
  });
}

function hasExactHeader(fields: readonly string[]): boolean {
  return (
    fields.length === ANGELLIST_INVESTMENTS_CSV_HEADERS.length &&
    fields.every(
      (field, index) => field === ANGELLIST_INVESTMENTS_CSV_HEADERS[index],
    )
  );
}

export async function parseAngelListInvestmentsCsv(
  contents: Uint8Array,
): Promise<AngelListInvestmentsCsvImport> {
  const records = parseCsvRecords(decodeUtf8(contents));
  const preamble = records[0];
  const header = records[1];

  if (
    preamble === undefined ||
    preamble.fields.length !== 1 ||
    preamble.fields[0] !== ANGELLIST_INVESTMENTS_CSV_PREAMBLE
  ) {
    throw new AngelListCsvParseError(
      "invalid_preamble",
      "AngelList CSV must begin with one confidentiality preamble record.",
    );
  }
  if (header === undefined || !hasExactHeader(header.fields)) {
    throw new AngelListCsvParseError(
      "invalid_header",
      "AngelList CSV header does not match the supported 23-column export format.",
    );
  }
  if (records.length === 2) {
    throw new AngelListCsvParseError(
      "invalid_row",
      "AngelList CSV must contain at least one investment row.",
    );
  }

  const rows = await Promise.all(records.slice(2).map(parseInvestmentRecord));
  return AngelListInvestmentsCsvImportSchema.parse({
    provider: "angellist",
    formatVersion: 1,
    rows,
  });
}
