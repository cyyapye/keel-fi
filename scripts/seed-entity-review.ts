import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  legalDocumentTestDatabase,
  syntheticAgreementPdf,
  syntheticDocumentScan,
} from "./test-support/legal-documents";
import { extractLegalNameFromPages } from "./legal-document-extraction";
import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
} from "../packages/database/src/holding-imports";
import { D1ProviderPortfolioAgentRepository } from "../packages/database/src/provider-portfolio-agent";
import { D1ProviderLegalDocumentRepository } from "../packages/database/src/provider-legal-documents";
import { D1InvestmentReviewRepository } from "../packages/database/src/investment-review";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1LegalEntityRepository } from "../packages/database/src/legal-entities";

const subject = "synthetic-access-subject";
const now = "2026-09-01T12:00:00.000Z";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cases = [
  {
    label: "Demo Horizon",
    names: ["Demo Horizon V LLC", "Demo Horizon V LLC", "Demo River LLC"],
    company: "Demo Robotics Inc.",
  },
  { label: "Demo Growth III", names: ["Demo Growth III LLC"], company: null },
  {
    label: "Demo Growth IV",
    names: ["Demo Growth IV LLC"],
    company: "Demo Compute Inc.",
  },
  { label: "Demo Orchard", names: ["Demo Orchard Series IX"], company: null },
  { label: "Demo New Investment", names: [], company: null },
  {
    label: "Demo Existing Vehicle",
    names: ["Demo Existing Vehicle LLC"],
    company: "Demo Robotics Inc.",
  },
  {
    label: "Demo Reviewed Vehicle",
    names: ["Demo Reviewed Vehicle LLC"],
    company: "Demo Compute Inc.",
  },
  {
    label: "Demo Meridian",
    names: [
      "Demo Meridian II LLC",
      "Demo Meridian II LLC",
      "Demo Meridian III LLC",
    ],
    company: "Demo Robotics Inc.",
  },
  ...Array.from({ length: 25 }, (_, index) => ({
    label: `Demo Follow-up ${String(index + 1).padStart(2, "0")}`,
    names: [],
    company: null,
  })),
];

// Build native, schema-validated records offline, then replay their writes into
// local D1. No API fixture routes or changes to accepted live records are used.
export async function buildEntityReviewSeed() {
  const d1 = legalDocumentTestDatabase();
  const statements: string[] = [];
  const files: { objectKey: string; bytes: Uint8Array }[] = [];
  const literal = (value: unknown) =>
    value === null
      ? "NULL"
      : typeof value === "number" || typeof value === "bigint"
        ? String(value)
        : typeof value === "string"
          ? `'${value.replaceAll("'", "''")}'`
          : (() => {
              throw new Error("Unexpected seed SQL value.");
            })();
  const prepare = d1.prepare.bind(d1);
  type Statement = ReturnType<typeof prepare>;
  const track = (statement: Statement): Statement =>
    new Proxy(statement, {
      get(target, key) {
        if (key === "bind")
          return (...values: Parameters<Statement["bind"]>) =>
            track(target.bind(...values));
        if (key === "execute" || key === "run")
          return () => {
            const result = target[key]();
            let index = 0;
            statements.push(
              target.sql.replaceAll("?", () =>
                literal(target.values[index++]),
              ) + ";",
            );
            return result;
          };
        if (key === "first") return target.first.bind(target);
        if (key === "all") return target.all.bind(target);
        if (key === "sql") return target.sql;
        if (key === "values") return target.values;
        throw new Error("Unexpected seed statement operation.");
      },
    });
  d1.prepare = (sql: string) => track(prepare(sql));
  try {
    const input: HoldingImportStageInput = {
      provider: "sydecar",
      formatVersion: 3,
      objectKey: "holding-imports/demo-entity-review.csv",
      sha256: digest("demo-review"),
      byteSize: 4096,
      effectiveDate: "2026-09-01",
      retrievedAt: now,
      rows: cases.map((item, index) => ({
        rowNumber: index + 2,
        naturalKeySha256: digest(`demo-row-${index}`),
        providerInvestmentId: `demo-investment-${index}`,
        companyOrFund: item.label,
        fundName: item.label,
        investmentEntity: "Demo Family LLC",
        status: "Live",
        investDate: "2026-08-01",
        investedMinor: 1_250_000 + index * 250_000,
        unrealizedValueMinor: null,
        unrealizedValueState: "not_reported",
        realizedValueMinor: 0,
        netValueMinor: null,
        netValueState: "not_reported",
        positionKind: "spv_interest",
        dealMetadata: {
          allocationMinor: 1_250_000 + index * 250_000,
          instrument: "SPV interest",
          managementFeePpm: 10_000,
          carryPpm: 150_000,
        },
      })),
      canonicalScope: {
        connection: {
          mode: "ensure",
          adapterType: "manual",
          protectedSourceKey: digest("demo-review-source"),
          institutionKey: "sydecar",
          institutionLabel: "Sydecar",
          lifecycleState: "pending",
          credentialReference: null,
        },
        containers: [
          {
            protectedAccountKey: digest("demo-review-holder"),
            displayLabel: "Demo Family LLC",
            containerKind: "entity",
            taxTreatment: "unknown",
            completeness: "partial",
          },
        ],
        rows: cases.map((_, index) => ({
          sourceRowNumber: index + 2,
          protectedAccountKey: digest("demo-review-holder"),
          protectedPositionKey: digest(`demo-position-${index}`),
        })),
      },
    };
    const imports = new D1HoldingImportRepository(d1.asD1());
    const staged = await imports.stageHoldingImport(subject, input);
    await imports.applyHoldingImport(subject, staged.preview.id, {
      currency: "USD",
      decisions: staged.preview.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
        rationale: "Reviewed fabricated local demonstration.",
      })),
    });
    const agents = new D1ProviderPortfolioAgentRepository(
      d1.asD1(),
      () => new Date(now),
    );
    await agents.register(subject, "sydecar");
    await agents.requestRun(subject, "sydecar");
    const run = (await agents.lease(subject, "sydecar")).run!;
    const documents = new D1ProviderLegalDocumentRepository(
      d1.asD1(),
      () => new Date(now),
    );
    const lease = await documents.lease(
      subject,
      "sydecar",
      run.id,
      run.leaseToken,
    );
    for (const [index, item] of cases.entries()) {
      const capture = item.names.map((name, documentIndex) => {
        const lines = [
          "SYNTHETIC DEMO - NOT A REAL AGREEMENT",
          "Subscription Agreement",
          `Fund: ${name}`,
          ...(item.company ? [`Underlying Company: ${item.company}`] : []),
          `Agreement copy ${documentIndex + 1}`,
        ];
        const bytes = syntheticAgreementPdf(lines);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const objectKey = `legal-entity-documents/hh_demo/${sha256}.pdf`;
        files.push({ objectKey, bytes });
        const extraction = extractLegalNameFromPages([lines.join("\n")]);
        // The PDF contains the name, but this fixture models an extractor that
        // could not classify it. Manual entry must remain possible.
        if (index === 3) {
          extraction.citations = [];
          extraction.problem = "name_not_found";
        }
        return {
          documentKey: digest(`demo-document-${index}-${documentIndex}`),
          sha256,
          fileName: `demo-${index + 1}-agreement-${documentIndex + 1}.pdf`,
          byteSize: bytes.length,
          checkedAt: now,
          scan: syntheticDocumentScan(bytes, now),
          extraction,
        };
      });
      await documents.record(
        lease,
        digest(`demo-position-${index}`),
        {
          version: 1,
          naturalKeySha256: digest(`demo-row-${index}`),
          ownershipLabel: "Demo Family LLC",
          sourceInvestment: {
            id: `demo-investment-${index}`,
            association: "investment_page",
          },
          problem: capture.length === 0 ? "missing" : null,
          documents: capture,
        },
        capture.map((doc) => ({
          sha256: doc.sha256,
          objectKey: `legal-entity-documents/hh_demo/${doc.sha256}.pdf`,
        })),
      );
    }
    const positions = d1.sqlite
      .prepare("SELECT id, position_fingerprint FROM holding_positions")
      .all() as { id: string; position_fingerprint: string }[];
    const position = (index: number) =>
      positions.find(
        (p) => p.position_fingerprint === digest(`demo-position-${index}`),
      )!.id;
    const reviews = new D1InvestmentReviewRepository(d1.asD1());
    const reviewBase = (
      context: Awaited<ReturnType<typeof reviews.getContext>>,
    ) => ({
      requestId: crypto.randomUUID(),
      expectedReviewId: context.review?.id ?? null,
      expectedSnapshotId: context.snapshotId,
      expectedEvidenceRevision: context.evidenceRevision,
      participationStatus: context.defaultParticipationStatus,
    });
    const first = await reviews.getContext(subject, position(0));
    await reviews.createRelated(subject, position(0), {
      ...reviewBase(first),
      label: "Demo Cancelled Subscription",
      participationStatus: "cancelled",
      documentIds: [first.documents[2]!.id],
    });
    // Leave another source with genuine conflicting names for comparison.
    // The original now has one supported vehicle after moving the cancelled one.
    const context = await reviews.getContext(subject, position(2));
    await reviews.reviewCompany(subject, position(2), {
      requestId: crypto.randomUUID(),
      expectedSnapshotId: context.snapshotId,
      expectedEvidenceRevision: context.evidenceRevision,
      expectedMappingIds: context.mappings.map((m) => m.id),
      company: { mode: "new", legalName: "Demo Compute Inc." },
      basis: "document_choice",
      citation: context.companyChoices[0]!,
      reason: null,
    });
    const legacy = await reviews.getContext(subject, position(1));
    await reviews.reviewCompany(subject, position(1), {
      requestId: crypto.randomUUID(),
      expectedSnapshotId: legacy.snapshotId,
      expectedEvidenceRevision: legacy.evidenceRevision,
      expectedMappingIds: legacy.mappings.map((m) => m.id),
      company: { mode: "new", legalName: "Demo Robotics Inc." },
      basis: "user_confirmed",
      citation: null,
      reason: null,
    });
    const ownership = await reviews.getContext(subject, position(6));
    await reviews.review(subject, position(6), {
      ...reviewBase(ownership),
      ownershipObservation: {
        sourceKind: "k1",
        sourceLabel: "Demo K-1",
        effectiveDate: null,
        taxYear: 2025,
        ownershipPpm: null,
        profitBeginningPpm: null,
        profitEndingPpm: 12_000,
        lossBeginningPpm: null,
        lossEndingPpm: 12_000,
        capitalBeginningPpm: null,
        capitalEndingPpm: 10_000,
        documentId: null,
        page: null,
        quote: null,
        supersedesObservationId: null,
      },
    });
    const entities = new D1LegalEntityRepository(d1.asD1());
    const view = await new D1InvestmentPositionViewRepository(d1.asD1()).list(
      subject,
      now,
    );
    for (const index of [5, 6])
      await entities.create(
        subject,
        {
          profile: {
            legalName: cases[index]!.names[0]!,
            entityType: "llc",
            relationship: "investment_vehicle",
            currentOwner: null,
            jurisdiction: null,
            formedOn: null,
            einLastFour: null,
            ownershipInterestPpm: null,
            interestStatus: "unknown",
            taxClassification: null,
            notes: null,
          },
          source:
            index === 5
              ? null
              : {
                  reference: { kind: "holding_position", id: position(index) },
                  expectedDecisionId: null,
                },
        },
        view,
      );
    return {
      sql: [
        "-- Fabricated local entity-review scenario.",
        "PRAGMA defer_foreign_keys = ON;",
        ...statements,
      ].join("\n"),
      files,
    };
  } finally {
    d1.sqlite.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(process.argv[2] ?? "");
  if (root !== resolve(".keel-local/scenarios/entity-review"))
    throw new Error(
      "Entity review seed is local-only and requires its exact scenario directory.",
    );
  const seed = await buildEntityReviewSeed();
  mkdirSync(join(root, "agreements"), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, "entity-review.sql"), seed.sql);
  const files = seed.files.map((file, index) => {
    const path = join(root, "agreements", `demo-${index}.pdf`);
    writeFileSync(path, file.bytes);
    return { objectKey: file.objectKey, path };
  });
  writeFileSync(join(root, "agreements.json"), JSON.stringify(files));
}
