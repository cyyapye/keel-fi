import {
  parseProviderHoldingsTemplateCsv,
  providerHoldingsTemplateCsv,
} from "../../packages/connectors/src/provider-holdings-template-csv";
import type { HoldingImportStageInput } from "../../packages/database/src/holding-imports";

const digest = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export async function syntheticWefunderImport(input: {
  count: number;
  positionType?: "Direct" | "SPV" | "Fund";
  legalName: string | ((index: number) => string);
  investmentPrefix?: string;
}): Promise<HoldingImportStageInput> {
  const cell = (value: string) =>
    /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const csv =
    providerHoldingsTemplateCsv("wefunder") +
    Array.from({ length: input.count }, (_, index) =>
      [
        `${input.investmentPrefix ?? "Synthetic Operating Company"} ${index} LLC`,
        typeof input.legalName === "string"
          ? input.legalName
          : input.legalName(index),
        input.positionType ?? "SPV",
        "Synthetic Family Trust",
        "Live",
        "",
        "2026-08-20",
        "$1250.00",
        "",
        "",
        "",
        "Membership interest",
      ]
        .map(cell)
        .join(","),
    ).join("\n") +
    "\n";
  const parsed = await parseProviderHoldingsTemplateCsv(
    "wefunder",
    new TextEncoder().encode(csv),
  );
  const ownerKey = await digest("synthetic-wefunder-owner");
  return {
    ...parsed,
    objectKey: "holding-imports/wefunder/synthetic.csv",
    sha256: await digest(csv),
    byteSize: new TextEncoder().encode(csv).byteLength,
    retrievedAt: "2026-08-20T12:00:00.000Z",
    canonicalScope: {
      connection: {
        mode: "ensure",
        adapterType: "manual",
        protectedSourceKey: await digest("synthetic-wefunder-source"),
        institutionKey: "wefunder",
        institutionLabel: "Wefunder",
        lifecycleState: "pending",
        credentialReference: null,
      },
      containers: [
        {
          protectedAccountKey: ownerKey,
          displayLabel: "Synthetic Family Trust",
          containerKind: "trust",
          taxTreatment: "unknown",
          completeness: "partial",
        },
      ],
      rows: parsed.rows.map((row) => ({
        sourceRowNumber: row.rowNumber,
        protectedAccountKey: ownerKey,
        protectedPositionKey: row.naturalKeySha256,
      })),
    },
  };
}
