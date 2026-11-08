import type { DatabaseSync } from "node:sqlite";
import {
  HoldingImportPreviewSchema,
  type HoldingImportPreview,
} from "../../packages/domain/src/index";
import { D1HoldingImportRepository } from "../../packages/database/src/holding-imports";
import { LegalDocumentTestD1 } from "./legal-documents";
import { createHash } from "node:crypto";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** OLD 0090 fixture adapter: ingestion/acceptance use their real owners, while the
 * stage response reads only fields present at that frontier. No 0091 projection
 * or migration statement is run before the populated workload is measured. */
export async function publicMigrationHistory(
  db: DatabaseSync,
  history: number,
) {
  class OldFrontierImport extends D1HoldingImportRepository {
    override getHoldingImport(
      _subject: string,
      importId: string,
    ): Promise<HoldingImportPreview> {
      const rows = db
        .prepare(
          "SELECT id,source_row_number,legal_vehicle_name,owner_label,exposure_label,unrealized_value_minor,quantity_micros,ticker FROM holding_import_rows WHERE import_id=? ORDER BY source_row_number",
        )
        .all(importId);
      return Promise.resolve(
        HoldingImportPreviewSchema.parse({
          id: importId,
          provider: "plaid_investments",
          status: "pending_review",
          observedAt: "2026-08-20T00:00:00.000Z",
          summary: {
            rowCount: rows.length,
            administratorValueCount: rows.length,
            lockedValueCount: 0,
            createCount: rows.length,
            updateCount: 0,
            unchangedCount: 0,
            needsAttentionCount: 0,
          },
          rows: rows.map((row) => ({
            id: row.id,
            sourceRowNumber: row.source_row_number,
            positionName: row.legal_vehicle_name,
            exposureName: row.exposure_label,
            ownerLabel: row.owner_label,
            providerStatus: "Live",
            investedOn: null,
            investedMinor: 0,
            administratorNavMinor: row.unrealized_value_minor,
            administratorNavState: "reported",
            realizedValueMinor: 0,
            ticker: row.ticker,
            quantityMicros: row.quantity_micros,
            action: "create_position",
            issues: [],
          })),
        }),
      );
    }
  }
  const repository = new OldFrontierImport(new LegalDocumentTestD1(db).asD1());
  for (const [subject, household, user, rounds] of [
    ["synthetic-access-subject", "hh_demo", "usr_demo", history],
    [
      "synthetic-migration-foreign",
      "hh_migration_foreign",
      "usr_migration_foreign",
      2,
    ],
  ] as const) {
    const connectionId = `synthetic_public_migration_${household}`;
    db.prepare(
      "INSERT INTO investment_connections(id,household_id,adapter_type,protected_source_key,created_by_user_id,created_at,immutable) VALUES (?,?,'plaid-investments',?,?,'2026-08-01T12:00:00.000Z',1)",
    ).run(connectionId, household, hash(connectionId), user);
    db.prepare(
      "INSERT INTO investment_connection_versions(id,household_id,connection_id,version,institution_key,institution_label,lifecycle_state,credential_reference,supersedes_version_id,recorded_by_user_id,recorded_at,immutable) VALUES (?,?,?,1,'synthetic_public','Synthetic Brokerage','active','synthetic-secret-reference',NULL,?,'2026-08-01T12:00:00.000Z',1)",
    ).run(`${connectionId}_v1`, household, connectionId, user);
    const accountKey = hash(`${household}:account`);
    for (let round = 0; round < rounds; round++) {
      const date = `2026-08-${String(10 + Math.floor(round / 2)).padStart(2, "0")}`;
      const staged = await repository.stagePlaidInvestmentsHoldingImport(
        subject,
        {
          objectKey: `synthetic/public-migration/${household}/${round}.json`,
          sha256: hash(`${household}:document:${round}`),
          byteSize: 24000,
          normalizedFingerprint: hash(`${household}:normalized:${round}`),
          effectiveDate: date,
          retrievedAt: `${date}T12:00:00.000Z`,
          rows: Array.from({ length: 120 }, (_, index) => ({
            rowNumber: index + 1,
            naturalKeySha256: hash(`${household}:row:${index}`),
            securityName: `Synthetic Migration Public ${index}`,
            ticker: `S${index}`,
            securityType: "equity",
            accountLabel: "Synthetic Brokerage",
            quantityMicros: 1_000_000,
            costBasisMinor: 10000,
            marketValueMinor: 12000 + round,
            observedOn: date,
            currency: "USD",
            issues: [],
          })),
          canonicalScope: {
            connection: { mode: "existing", connectionId },
            containers: [
              {
                protectedAccountKey: accountKey,
                displayLabel: "Synthetic Brokerage",
                containerKind: "brokerage",
                taxTreatment: "taxable",
                completeness: "complete",
              },
            ],
            rows: Array.from({ length: 120 }, (_, index) => ({
              sourceRowNumber: index + 1,
              protectedAccountKey: accountKey,
              protectedPositionKey: hash(`${household}:position:${index}`),
              publicExposureIdentityKind: "cusip",
              protectedExposureKey: hash(`${household}:security:${index}`),
            })),
          },
        },
      );
      await repository.applyHoldingImport(subject, staged.preview.id, {
        currency: "USD",
        decisions: staged.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
          rationale:
            "Recorded acceptance for synthetic OLD-schema migration history.",
        })),
      });
    }
  }
}
