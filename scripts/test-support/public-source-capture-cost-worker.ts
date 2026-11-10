import { createHash } from "node:crypto";
import { z } from "zod";
import {
  D1HoldingImportRepository,
  type PlaidInvestmentsHoldingImportStageInput,
} from "../../packages/database/src/holding-imports";
import { measureD1 } from "./d1-meter";

export function publicSourceCaptureInput(
  history: 12 | 24,
  kind: "public" | "fallback",
): PlaidInvestmentsHoldingImportStageInput {
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const account = hash("hh_demo:account");
  return kind === "public"
    ? {
        objectKey: `synthetic/public-cost/${history}.json`,
        sha256: hash(`public-cost:${history}`),
        normalizedFingerprint: hash(`public-cost-normalized:${history}`),
        byteSize: 24000,
        effectiveDate: "2026-08-26",
        retrievedAt: "2026-08-26T12:00:00.000Z",
        rows: Array.from({ length: 120 }, (_, index) => ({
          rowNumber: index + 1,
          naturalKeySha256: hash(`hh_demo:row:${index}`),
          securityName: `Synthetic Migration Public ${index}`,
          ticker: `S${index}`,
          securityType: "equity",
          accountLabel: "Synthetic Brokerage",
          quantityMicros: 1_000_000,
          costBasisMinor: 10000,
          marketValueMinor: 12500,
          observedOn: "2026-08-26",
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
              protectedAccountKey: account,
              displayLabel: "Synthetic Brokerage",
              containerKind: "brokerage",
              taxTreatment: "taxable",
              completeness: "complete",
            },
          ],
          rows: Array.from({ length: 120 }, (_, index) => ({
            sourceRowNumber: index + 1,
            protectedAccountKey: account,
            protectedPositionKey: hash(`hh_demo:position:${index}`),
            publicExposureIdentityKind: "cusip",
            protectedExposureKey: hash(`hh_demo:security:${index}`),
          })),
        },
      }
    : {
        objectKey: `synthetic/provider-completion/${history}.json`,
        sha256: hash(`provider-completion:${history}`),
        byteSize: 24000,
        normalizedFingerprint: hash(
          `provider-completion-normalized:${history}`,
        ),
        effectiveDate: "2026-08-27",
        retrievedAt: "2026-08-27T12:00:00.000Z",
        rows: Array.from({ length: 120 }, (_, index) => ({
          rowNumber: index + 1,
          naturalKeySha256: hash(`completion-row:${index}`),
          securityName: `Synthetic Completion Security ${index % 20}`,
          ticker: `R${index % 20}`,
          securityType: "equity",
          accountLabel: `Synthetic Completion Account ${Math.floor(index / 20)}`,
          quantityMicros: 1_000_000,
          costBasisMinor: 10000,
          marketValueMinor: 12500,
          observedOn: "2026-08-27",
          currency: "USD",
          issues: [],
        })),
        canonicalScope: {
          connection: {
            mode: "existing",
            connectionId: "synthetic_public_migration_hh_demo",
          },
          containers: Array.from({ length: 6 }, (_, index) => ({
            protectedAccountKey: hash(`completion-account:${index}`),
            displayLabel: `Synthetic Completion Account ${index}`,
            containerKind: "brokerage",
            taxTreatment: "taxable",
            completeness: "complete",
          })),
          rows: Array.from({ length: 120 }, (_, index) => ({
            sourceRowNumber: index + 1,
            protectedAccountKey: hash(
              `completion-account:${Math.floor(index / 20)}`,
            ),
            protectedPositionKey: hash(`completion-position:${index}`),
            publicExposureIdentityKind: null,
            protectedExposureKey: null,
          })),
        },
      };
}

// Execute the unchanged production capture beside real D1; export its actual
// billing counters for the calling test's independent ceilings and comparisons.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const input = z
      .object({
        history: z.union([z.literal(12), z.literal(24)]),
        kind: z.enum(["public", "fallback"]),
      })
      .strict()
      .parse(await request.json());
    const measured = measureD1(env.DB);
    const imports = new D1HoldingImportRepository(measured.database);
    const staged = await imports.stagePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      publicSourceCaptureInput(input.history, input.kind),
    );
    const accepted = await imports.autoAdjudicatePlaidInvestmentsHoldingImport(
      "synthetic-access-subject",
      staged.preview.id,
    );
    return Response.json({
      importId: staged.preview.id,
      accepted: {
        autoAppliedCount: accepted.autoAppliedCount,
        quarantinedCount: accepted.quarantinedCount,
        preservedPositionCount: accepted.preservedPositionCount,
      },
      cost: measured.cost,
      queries: [...measured.byQuery]
        .sort((a, b) => b[1].rowsRead - a[1].rowsRead)
        .slice(0, 4)
        .map(([sql, cost]) => ({ sql: sql.slice(0, 220), ...cost })),
    });
  },
};
