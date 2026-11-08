import { createHash } from "node:crypto";
import { z } from "zod";
import {
  D1HoldingImportRepository,
  type PlaidInvestmentsHoldingImportStageInput,
} from "../../packages/database/src/holding-imports";

export function publicInventoryCostInput(
  round: number,
  empty: boolean,
): PlaidInvestmentsHoldingImportStageInput {
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const sourceUpdatedAt = new Date(
    Date.UTC(2026, 8, 1) + round * 3600000,
  ).toISOString();
  const keys = empty ? [119] : Array.from({ length: 120 }, (_, index) => index);
  return {
    objectKey: `synthetic/inventory-cost/${round}.json`,
    sha256: hash(`raw:${round}`),
    byteSize: 24000,
    normalizedFingerprint: hash(`inventory:${round}`),
    effectiveDate: "2026-08-30",
    retrievedAt: sourceUpdatedAt,
    inventoryEvidence: {
      sourceUpdatedAt,
      objectKey: `synthetic/inventory-cost/${round}-capture.json`,
      sha256: hash(`capture:${round}`),
      byteSize: 512,
    },
    rows: keys.map((index, row) => ({
      rowNumber: row + 1,
      naturalKeySha256: hash(`row:${index}`),
      securityName: `Synthetic Inventory ${index}`,
      ticker: `S${index}`,
      securityType: index === 119 ? "cash" : "equity",
      accountLabel: "Synthetic Brokerage",
      quantityMicros: 1_000_000,
      costBasisMinor: 10000,
      marketValueMinor: 12000,
      observedOn: "2026-08-30",
      currency: "USD",
      issues: [],
    })),
    canonicalScope: {
      connection: {
        mode: "existing",
        connectionId: "synthetic_public_migration_hh_demo",
      },
      containers: [
        {
          protectedAccountKey: hash("hh_demo:account"),
          displayLabel: "Synthetic Brokerage",
          containerKind: "brokerage",
          taxTreatment: "taxable",
          completeness: "complete",
        },
      ],
      rows: keys.map((index, row) => ({
        sourceRowNumber: row + 1,
        protectedAccountKey: hash("hh_demo:account"),
        protectedPositionKey:
          index === 119
            ? hash("inventory:cash")
            : hash(`hh_demo:position:${index}`),
        publicExposureIdentityKind: index === 119 ? null : "cusip",
        protectedExposureKey:
          index === 119 ? null : hash(`hh_demo:security:${index}`),
      })),
    },
  };
}

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const { history } = z
      .object({ history: z.union([z.literal(12), z.literal(24)]) })
      .strict()
      .parse(await request.json());
    const imports = new D1HoldingImportRepository(env.DB);
    const ids: string[] = [];
    for (let round = 0; round < history; round++) {
      const report = await imports.stagePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        publicInventoryCostInput(round, round % 2 === 1),
      );
      await imports.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        report.preview.id,
      );
      ids.push(report.preview.id);
    }
    return Response.json({ ids });
  },
};
