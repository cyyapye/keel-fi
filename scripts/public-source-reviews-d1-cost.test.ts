import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  populatedMigrationFixtures,
  populatedMigrationDatabase,
} from "./test-support/populated-migration";
import { measureD1 } from "./test-support/d1-cost";
import {
  publicSourceState,
  PUBLIC_SOURCE_POSITIONS_SQL,
} from "../packages/database/src/public-source-state";
import { D1HoldingImportRepository } from "../packages/database/src/holding-imports";

const fixture = populatedMigrationFixtures();
for (const history of [12, 24] as const) {
  it(`reads 120 public source heads independently of ${history} observations and decisions per position`, async () => {
    const stored = await fixture(history, "0091");
    const runtime = await populatedMigrationDatabase(stored);
    try {
      const db = runtime.database;
      const anchors = (
        await db
          .prepare(
            `SELECT k.position_id,k.container_id,o.protected_position_key,a.snapshot_id,s.source_import_row_id row_id
        FROM public_holding_security_heads k JOIN holding_position_ownerships o ON o.position_id=k.position_id
        JOIN holding_import_application_heads a ON a.position_id=k.position_id JOIN holding_position_snapshots s ON s.id=a.snapshot_id
        WHERE k.household_id='hh_demo' AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=o.id)
        ORDER BY k.position_id`,
          )
          .all<{
            position_id: string;
            container_id: string;
            protected_position_key: string;
            snapshot_id: string;
            row_id: string;
          }>()
      ).results;
      expect(anchors).toHaveLength(120);
      let version = 0;
      const receiptIds = new Map<string, string>();
      let receiptCost = { rowsRead: 0, rowsWritten: 0 };
      const sqlText = (value: string | null) =>
        value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
      for (let round = 0; round < history; round++) {
        const statements = anchors.map((anchor, index) => {
          const id = `synthetic-source-cost-${round}-${index}`;
          const prior = receiptIds.get(anchor.position_id) ?? null;
          receiptIds.set(anchor.position_id, id);
          return `INSERT INTO public_holding_source_reviews(id,household_id,review_key,import_row_id,position_id,source_snapshot_id,prior_position_id,prior_snapshot_id,prior_review_id,expected_household_version,decision,decision_source,policy_version,reviewer_user_id,created_at,initial_acceptance)
            VALUES (${sqlText(id)},'hh_demo',${sqlText(`${anchor.container_id}:${anchor.protected_position_key}`)},${sqlText(anchor.row_id)},${sqlText(anchor.position_id)},${sqlText(anchor.snapshot_id)},NULL,NULL,${sqlText(prior)},${version++},'separate','manual',NULL,'usr_demo','2026-08-25T12:00:00.000Z',0)`;
        });
        // Prepare fixture-history statements inside workerd. The host proxy's
        // per-statement handles are not part of this D1 billing holdout.
        const results = await runtime.execute(statements);
        if (round === history - 1)
          receiptCost = {
            rowsRead: results.rowsRead,
            rowsWritten: results.rowsWritten,
          };
      }
      expect(receiptCost.rowsWritten).toBeLessThanOrEqual(5000);
      expect(receiptCost.rowsRead).toBeLessThanOrEqual(12000);
      const measured = measureD1(db);
      const state = await publicSourceState(measured.database, "hh_demo");
      expect(state.positions).toHaveLength(120);
      expect(state.hiddenIds.size).toBe(0);
      expect(state.version).toBe(120 * history);
      expect(measured.cost.roundTrips).toBe(1);
      expect(measured.cost.rowsWritten).toBe(0);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(2500);
      const readCost = { ...measured.cost };
      measured.reset();
      const empty = await publicSourceState(
        measured.database,
        "synthetic-empty-household",
      );
      expect(empty.positions).toEqual([]);
      expect(measured.cost.roundTrips).toBe(1);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(1);
      expect(measured.cost.rowsWritten).toBe(0);
      const importId = (await db
        .prepare(
          "SELECT import_id FROM public_holding_import_heads WHERE household_id='hh_demo'",
        )
        .first<{ import_id: string }>())!.import_id;
      measured.reset();
      const preview = await new D1HoldingImportRepository(
        measured.database,
      ).getHoldingImport("synthetic-access-subject", importId);
      expect(preview.rows).toHaveLength(120);
      expect(preview.summary.quarantinedCount).toBe(0);
      expect(measured.cost.roundTrips).toBe(6);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(14000);
      expect(measured.cost.rowsWritten).toBe(0);
      const previewCost = { ...measured.cost };
      measured.reset();
      const hash = (value: string) =>
        createHash("sha256").update(value).digest("hex");
      const imports = new D1HoldingImportRepository(measured.database);
      const account = hash("hh_demo:account");
      const staged = await imports.stagePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        {
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
        },
      );
      const accepted =
        await imports.autoAdjudicatePlaidInvestmentsHoldingImport(
          "synthetic-access-subject",
          staged.preview.id,
        );
      expect(accepted).toMatchObject({
        autoAppliedCount: 120,
        quarantinedCount: 0,
        preservedPositionCount: 0,
      });
      expect(measured.cost.roundTrips).toBeLessThanOrEqual(40);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(60000);
      expect(measured.cost.rowsWritten).toBeLessThanOrEqual(8000);
      const captureCost = { ...measured.cost };
      const plan = (
        await db
          .prepare(`EXPLAIN QUERY PLAN ${PUBLIC_SOURCE_POSITIONS_SQL}`)
          .bind("hh_demo")
          .all<{ detail: string }>()
      ).results.map((row) => row.detail);
      expect(
        plan.some((detail) => /SCAN (?:r|s|a|review|later)\b/u.test(detail)),
      ).toBe(false);
      expect(
        plan.some((detail) => /public_holding_security_match/u.test(detail)),
      ).toBe(true);
      expect(
        (await db.prepare("PRAGMA foreign_key_check").all()).results,
      ).toEqual([]);
      console.info(
        JSON.stringify({
          publicSourceHeads: {
            history,
            readCost,
            previewCost,
            captureCost,
            receiptCost,
            plan,
          },
        }),
      );
    } finally {
      await runtime.close();
    }
  }, 120_000);
}
