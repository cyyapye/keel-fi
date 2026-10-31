import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { legalDocumentTestDatabase } from "./test-support/legal-documents";
import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
} from "../packages/database/src/holding-imports";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1InvestmentReviewRepository } from "../packages/database/src/investment-review";
import { D1PositionPurchaseRepository } from "../packages/database/src/position-purchases";
import { PurchaseLotSchema } from "../packages/domain/src/position-purchases";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
export const LINK_DEMO_SUBJECT = "synthetic-access-subject";
export type LinkDemoCase = {
  provider: "sydecar" | "tokenfolio";
  name: string;
  company: string;
  amount: number;
  value: number | null;
  date: string;
};
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const LINK_DEMO_CASES = [
  {
    provider: "sydecar",
    name: "Demo Atlas II SPV",
    company: "Demo Atlas AI",
    amount: 1_200_000,
    value: null,
    date: "2025-03-12",
  },
  {
    provider: "tokenfolio",
    name: "Demo Atlas AI source",
    company: "Demo Atlas AI",
    amount: 1_050_000,
    value: 4_200_000,
    date: "2025-03-12",
  },
  {
    provider: "sydecar",
    name: "Demo Orbit V SPV",
    company: "Demo Orbit Aerospace",
    amount: 600_000,
    value: null,
    date: "2024-08-14",
  },
  {
    provider: "sydecar",
    name: "Demo Orbit VII SPV",
    company: "Demo Orbit Aerospace",
    amount: 600_000,
    value: null,
    date: "2025-01-21",
  },
  {
    provider: "tokenfolio",
    name: "Demo Orbit Aerospace source",
    company: "Demo Orbit Aerospace",
    amount: 520_000,
    value: 1_560_000,
    date: "2025-01-21",
  },
  {
    provider: "sydecar",
    name: "Demo Atlas Separate SPV",
    company: "Demo Atlas AI",
    amount: 800_000,
    value: null,
    date: "2025-06-10",
  },
] as const;
export async function seedPositionLinks(
  db: D1Database,
  revision = 1,
  purchasePractice = false,
  demoCases: readonly LinkDemoCase[] = LINK_DEMO_CASES,
) {
  for (const provider of ["sydecar", "tokenfolio"] as const) {
    const cases = demoCases.filter((c) => c.provider === provider);
    const input: HoldingImportStageInput = {
      provider,
      formatVersion: provider === "sydecar" ? 3 : purchasePractice ? 4 : 1,
      objectKey: `holding-imports/demo-links-${provider}-${revision}.csv`,
      sha256: digest(`demo-links-${provider}-${revision}`),
      byteSize: 4096,
      effectiveDate: "2026-09-20",
      retrievedAt: `2026-09-20T12:00:${String(revision).padStart(2, "0")}.000Z`,
      rows: cases.map((c, i) => ({
        rowNumber: i + 2,
        naturalKeySha256: digest(c.name),
        providerInvestmentId: `demo-${digest(c.name).slice(0, 16)}`,
        companyOrFund: c.company,
        fundName: c.name,
        investmentEntity: "Demo Family LLC",
        status: "Live",
        investDate: c.date,
        investedMinor: c.amount,
        unrealizedValueMinor:
          c.value === null ? null : c.value + (revision - 1) * 100_000,
        unrealizedValueState: c.value === null ? "not_reported" : "reported",
        realizedValueMinor: 0,
        netValueMinor: null,
        netValueState: "not_reported",
        positionKind: "spv_interest",
        dealMetadata: {
          ...(purchasePractice && provider === "tokenfolio"
            ? {
                sharePrices: {
                  costMicros: 165_000_000,
                  markMicros: 495_000_000,
                  markDate: null,
                  shareClass: "Common",
                },
              }
            : {}),
          allocationMinor: c.amount,
          instrument: "SPV interest",
          managementFeePpm: provider === "sydecar" ? 10_000 : null,
          carryPpm: provider === "sydecar" ? 150_000 : null,
        },
      })),
      canonicalScope: {
        connection: {
          mode: "ensure",
          adapterType: "manual",
          protectedSourceKey: digest(`demo-links-${provider}`),
          institutionKey: provider,
          institutionLabel: provider === "sydecar" ? "Sydecar" : "Tokenfolio",
          lifecycleState: "pending",
          credentialReference: null,
        },
        containers: [
          {
            protectedAccountKey: digest(`demo-links-holder-${provider}`),
            displayLabel: "Demo Family LLC",
            containerKind: "entity",
            taxTreatment: "unknown",
            completeness: "partial",
          },
        ],
        rows: cases.map((c, i) => ({
          sourceRowNumber: i + 2,
          protectedAccountKey: digest(`demo-links-holder-${provider}`),
          protectedPositionKey: digest(`position-${c.name}`),
        })),
      },
    };
    const imports = new D1HoldingImportRepository(db);
    const staged = await imports.stageHoldingImport(LINK_DEMO_SUBJECT, input);
    if (staged.preview.status !== "applied")
      await imports.applyHoldingImport(LINK_DEMO_SUBJECT, staged.preview.id, {
        currency: "USD",
        decisions: staged.preview.rows.map((r) => ({
          rowId: r.id,
          decision: "accepted",
          rationale: "Fabricated local position-link scenario.",
        })),
      });
  }
  if (revision === 1) {
    const positions = (
      await new D1InvestmentPositionViewRepository(db).list(LINK_DEMO_SUBJECT)
    ).connections.flatMap((c) => c.containers.flatMap((c) => c.positions));
    const reviews = new D1InvestmentReviewRepository(db);
    const companies = new Map<string, string>();
    for (const position of positions) {
      const item = demoCases.find((c) => c.name === position.legalVehicleName);
      if (!item) continue;
      const context = await reviews.getContext(LINK_DEMO_SUBJECT, position.id);
      const existing = companies.get(item.company);
      const receipt = await reviews.reviewCompany(
        LINK_DEMO_SUBJECT,
        position.id,
        {
          requestId: crypto.randomUUID(),
          expectedSnapshotId: context.snapshotId,
          expectedEvidenceRevision: context.evidenceRevision,
          expectedMappingIds: context.mappings.map((m) => m.id),
          company: existing
            ? { mode: "existing", companyId: existing }
            : { mode: "new", legalName: item.company },
          basis: "user_confirmed",
          citation: null,
          reason: null,
        },
      );
      companies.set(item.company, receipt.companyId);
    }
  }
}
export async function seedPurchaseRefundPractice(db: D1Database) {
  await seedPositionLinks(db, 1, true);
  const positions = (
    await new D1InvestmentPositionViewRepository(db).list(LINK_DEMO_SUBJECT)
  ).connections.flatMap((c) => c.containers.flatMap((c) => c.positions));
  const position = positions.find(
    (p) => p.legalVehicleName === "Demo Atlas Separate SPV",
  );
  if (!position) throw new Error("Synthetic practice SPV missing.");
  const context = await new D1InvestmentReviewRepository(db).getContext(
    LINK_DEMO_SUBJECT,
    position.id,
  );
  if (!context.snapshotId)
    throw new Error("Synthetic practice snapshot missing.");
  await new D1PositionPurchaseRepository(db).accept(
    LINK_DEMO_SUBJECT,
    position.id,
    {
      expectedSnapshotId: context.snapshotId,
      expectedReceiptId: null,
      expectedTermsId: null,
      details: {
        coversPosition: false,
        cashCoversPosition: true,
        investmentTerms: { ...unknownInvestmentTerms(), carryPpm: 150_000 },
        lots: [
          PurchaseLotSchema.parse({
            id: "demo-refund-purchase",
            purchasedOn: "2025-06-10",
            shareClass: "Preferred",
            transactionType: "secondary",
            priceMicros: 165_000_000,
            referencePriceMicros: null,
            grossCashMinor: 800_000,
            netCapitalMinor: null,
            upfrontDeductionsMinor: null,
            capitalReturn: {
              amountMinor: 187_654,
              status: "received",
              effectiveDate: null,
              reportedDistributions: "unknown",
            },
            feePpm: 90_000,
            feeBasis: null,
            feeLabel: "One-time fee",
            remainingSharesMicros: null,
            sharesAsOf: null,
            sourceKind: "executed",
            sourceLabel: "Demo purchase confirmation",
            sourceUrl: null,
            mark: null,
          }),
        ],
      },
    },
  );
}
export async function buildRecordedSeed(
  seed: (db: D1Database) => Promise<void>,
) {
  const d1 = legalDocumentTestDatabase();
  const statements: string[] = [];
  const prepare = d1.prepare.bind(d1);
  type Statement = ReturnType<typeof prepare>;
  const literal = (v: unknown) =>
    v === null
      ? "NULL"
      : typeof v === "string"
        ? `'${v.replaceAll("'", "''")}'`
        : typeof v === "number" || typeof v === "bigint"
          ? String(v)
          : (() => {
              throw new Error("Unexpected seed value.");
            })();
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
        throw new Error("Unexpected seed operation.");
      },
    });
  d1.prepare = (sql) => track(prepare(sql));
  try {
    await seed(d1.asD1());
    return [
      "-- Fabricated position-link practice records.",
      "PRAGMA defer_foreign_keys=ON;",
      ...statements,
    ].join("\n");
  } finally {
    d1.sqlite.close();
  }
}
export async function buildPositionLinksSeed(purchasePractice = false) {
  return buildRecordedSeed((db) =>
    purchasePractice ? seedPurchaseRefundPractice(db) : seedPositionLinks(db),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(process.argv[2] ?? "");
  if (
    !["position-links", "purchase-refund"].some(
      (scenario) => root === resolve(`.keel-local/scenarios/${scenario}`),
    )
  )
    throw new Error(
      "Position-link seed requires its exact local scenario directory.",
    );
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "position-links.sql"),
    await buildPositionLinksSeed(
      root === resolve(".keel-local/scenarios/purchase-refund"),
    ),
  );
}
