import { createHash } from "node:crypto";
import {
  syntheticAgreementPdf,
  syntheticDocumentScan,
} from "./legal-documents";
import { extractLegalNameFromPages } from "../legal-document-extraction";
import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
} from "../../packages/database/src/holding-imports";
import { D1ProviderPortfolioAgentRepository } from "../../packages/database/src/provider-portfolio-agent";
import { D1ProviderLegalDocumentRepository } from "../../packages/database/src/provider-legal-documents";
const now = "2026-09-01T12:00:00.000Z";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function seedAutomaticInvestments(
  database: D1Database,
  count = 1,
  extraLines: string[] = [],
  sharedName = false,
  accessSubject = "synthetic-access-subject",
  onAccepted?: () => void,
  capturedCount = count,
  options: { companyName?: string | null; includeEconomics?: boolean } = {},
) {
  const input: HoldingImportStageInput = {
    provider: "sydecar",
    formatVersion: 3,
    objectKey: "holding-imports/synthetic-auto.csv",
    sha256: digest("synthetic automatic import"),
    byteSize: 1024,
    effectiveDate: "2026-09-01",
    retrievedAt: now,
    rows: Array.from({ length: count }, (_, i) => ({
      rowNumber: i + 2,
      naturalKeySha256: digest(`auto-row-${i}`),
      providerInvestmentId: `synthetic-auto-${i}`,
      companyOrFund: `Synthetic Orchard ${i}`,
      fundName: `Synthetic Orchard ${i} SPV`,
      investmentEntity: "Synthetic Family LLC",
      status: "Live",
      investDate: "2026-08-01",
      investedMinor: 3_710_000,
      unrealizedValueMinor: null,
      unrealizedValueState: "not_reported",
      realizedValueMinor: 0,
      netValueMinor: null,
      netValueState: "not_reported",
      positionKind: "spv_interest",
      dealMetadata: {
        allocationMinor: 3_710_000,
        instrument: "SPV interest",
        managementFeePpm: 60_000,
        carryPpm: 175_000,
      },
    })),
    canonicalScope: {
      connection: {
        mode: "ensure",
        adapterType: "manual",
        protectedSourceKey: digest("auto-source"),
        institutionKey: "sydecar",
        institutionLabel: "Sydecar",
        lifecycleState: "pending",
        credentialReference: null,
      },
      containers: [
        {
          protectedAccountKey: digest("auto-holder"),
          displayLabel: "Synthetic Family LLC",
          containerKind: "entity",
          taxTreatment: "unknown",
          completeness: "partial",
        },
      ],
      rows: Array.from({ length: count }, (_, i) => ({
        sourceRowNumber: i + 2,
        protectedAccountKey: digest("auto-holder"),
        protectedPositionKey: digest(`auto-position-${i}`),
      })),
    },
  };
  const imports = new D1HoldingImportRepository(database);
  const staged = await imports.stageHoldingImport(accessSubject, input);
  await imports.applyHoldingImport(accessSubject, staged.preview.id, {
    currency: "USD",
    decisions: staged.preview.rows.map((row) => ({
      rowId: row.id,
      decision: "accepted",
      rationale: "Accepted synthetic source.",
    })),
  });
  onAccepted?.();
  const agents = new D1ProviderPortfolioAgentRepository(
    database,
    () => new Date(now),
  );
  await agents.register(accessSubject, "sydecar");
  await agents.requestRun(accessSubject, "sydecar");
  const run = (await agents.lease(accessSubject, "sydecar")).run!;
  const documents = new D1ProviderLegalDocumentRepository(
    database,
    () => new Date(now),
  );
  const lease = await documents.lease(
    accessSubject,
    "sydecar",
    run.id,
    run.leaseToken,
  );
  for (let i = 0; i < Math.min(count, capturedCount); i++) {
    const lines = [
      `Issuer: Synthetic Orchard ${sharedName ? 0 : i} SPV LLC`,
      ...(options.companyName === null
        ? []
        : [
            `Underlying Company: ${options.companyName ?? "Synthetic Orchard Inc."}`,
          ]),
      ...(options.includeEconomics === false
        ? []
        : [
            "Gross commitment: USD 40,000.00",
            "Net invested capital: USD 37,100.00",
            "Management fee: 6% of gross commitment, one-time",
            "Setup fee: 1.25% of gross commitment",
            "Carry: 17.5% of exit gains",
          ]),
      ...extraLines,
    ];
    const bytes = syntheticAgreementPdf(lines);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await documents.record(
      lease,
      digest(`auto-position-${i}`),
      {
        version: 1,
        naturalKeySha256: digest(`auto-row-${i}`),
        ownershipLabel: "Synthetic Family LLC",
        sourceInvestment: {
          id: `synthetic-auto-${i}`,
          association: "investment_page",
        },
        problem: null,
        documents: [
          {
            documentKey: digest(`auto-document-${i}`),
            sha256,
            fileName: `synthetic-auto-${i}.pdf`,
            byteSize: bytes.length,
            checkedAt: now,
            scan: syntheticDocumentScan(bytes),
            extraction: extractLegalNameFromPages([lines.join("\n")]),
          },
        ],
      },
      [{ sha256, objectKey: `legal-entity-documents/hh_demo/${sha256}.pdf` }],
    );
  }
  const rows = (
    await database
      .prepare(
        "SELECT id FROM holding_positions WHERE position_fingerprint IN (SELECT value FROM json_each(?)) ORDER BY id",
      )
      .bind(
        JSON.stringify(
          Array.from({ length: count }, (_, i) => digest(`auto-position-${i}`)),
        ),
      )
      .all<{ id: string }>()
  ).results;
  return rows.map((row) => row.id);
}
