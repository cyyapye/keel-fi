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
import { D1ExposureRepository } from "../packages/database/src/exposures";
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
      // Provider-only securities use the same accepted import and a bounded
      // completion pass. Twenty source securities span six ownership accounts.
      measured.reset();
      const fallback = await imports.stagePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        {
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
        },
      );
      expect(
        await imports.autoAdjudicatePlaidInvestmentsHoldingImport(
          "synthetic-access-subject",
          fallback.preview.id,
        ),
      ).toMatchObject({ autoAppliedCount: 120, quarantinedCount: 0 });
      const fallbackCaptureCost = { ...measured.cost };
      expect(fallbackCaptureCost.roundTrips).toBeLessThanOrEqual(40);
      measured.reset();
      await imports.getHoldingImport(
        "synthetic-access-subject",
        fallback.preview.id,
      );
      const completionResponseReads = { ...measured.cost };
      const exposures = new D1ExposureRepository(measured.database);
      measured.reset();
      const documents = await exposures.listRetainedPublicExposureDocuments(
        "synthetic-access-subject",
        fallback.preview.id,
      );
      expect(documents).toHaveLength(1);
      expect(documents[0]?.rows).toHaveLength(120);
      const discoveryCost = { ...measured.cost };
      expect(discoveryCost.roundTrips).toBe(2);
      expect(discoveryCost.rowsRead).toBeLessThanOrEqual(3000);
      expect(discoveryCost.rowsWritten).toBe(0);
      const discoverySql = [...measured.byQuery.keys()].find((query) =>
        query.includes("document.object_key"),
      )!;
      measured.reset();
      await exposures.recordRetainedPublicExposureEvidence(
        "synthetic-access-subject",
        documents[0]!.rows.map((row) => ({
          importRowId: row.importRowId,
          resolutionStatus: "no_strong_identifier",
          evidenceSha256: hash(`provider-completion:${history}`),
        })),
      );
      await exposures.recordRetainedProviderExposureEvidence(
        "synthetic-access-subject",
        documents[0]!.rows.map((row) => ({
          importRowId: row.importRowId,
          resolutionStatus: "scoped_identifier",
          protectedIdentityKey: hash(
            `completion-source-security:${(row.sourceRowNumber - 1) % 20}`,
          ),
          evidenceSha256: hash(`provider-completion:${history}`),
        })),
      );
      await exposures.reconcileAcceptedPublicExposureHistory(
        "synthetic-access-subject",
        fallback.preview.id,
      );
      const completionCost = { ...measured.cost };
      const mappingSql = [...measured.byQuery.keys()].find((query) =>
        query.includes("current_application.application_id"),
      )!;
      measured.reset();
      await imports.getHoldingImport(
        "synthetic-access-subject",
        fallback.preview.id,
      );
      completionResponseReads.roundTrips += measured.cost.roundTrips;
      completionResponseReads.rowsRead += measured.cost.rowsRead;
      expect(completionResponseReads.roundTrips).toBe(12);
      expect(measured.cost.rowsWritten).toBe(0);

      expect(completionCost.roundTrips).toBeLessThanOrEqual(16);
      expect(
        fallbackCaptureCost.rowsRead +
          discoveryCost.rowsRead +
          completionCost.rowsRead +
          completionResponseReads.rowsRead,
      ).toBeLessThanOrEqual(60000);
      expect(
        fallbackCaptureCost.rowsWritten + completionCost.rowsWritten,
      ).toBeLessThanOrEqual(8000);
      const completionPlans = await Promise.all(
        [discoverySql, mappingSql].map(async (query) =>
          (
            await db
              .prepare(`EXPLAIN QUERY PLAN ${query}`)
              .bind("hh_demo", fallback.preview.id)
              .all<{ detail: string }>()
          ).results.map((row) => row.detail),
        ),
      );
      expect(
        completionPlans
          .flat()
          .some((detail) =>
            /SCAN (?:row|application|current_application|import|latest_application)\b/u.test(
              detail,
            ),
          ),
      ).toBe(false);
      measured.reset();
      expect(
        await exposures.listRetainedPublicExposureDocuments(
          "synthetic-access-subject",
          fallback.preview.id,
        ),
      ).toEqual([]);
      await exposures.reconcileAcceptedPublicExposureHistory(
        "synthetic-access-subject",
        fallback.preview.id,
      );
      const repeatedCompletionCost = { ...measured.cost };
      expect(repeatedCompletionCost.roundTrips).toBeLessThanOrEqual(4);
      expect(repeatedCompletionCost.rowsWritten).toBe(0);
      expect(repeatedCompletionCost.rowsRead).toBeLessThanOrEqual(4000);
      measured.reset();
      expect(
        await exposures.listRetainedPublicExposureDocuments(
          "synthetic-access-subject",
          "synthetic-unowned-or-missing-import",
        ),
      ).toEqual([]);
      expect(measured.cost.roundTrips).toBe(2);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(3);
      expect(measured.cost.rowsWritten).toBe(0);
      expect(
        await db
          .prepare(
            "SELECT COUNT(*) count, COUNT(DISTINCT exposure_id) exposures FROM holding_position_exposure_heads WHERE position_id IN (SELECT application.position_id FROM holding_import_applications application JOIN holding_import_rows row ON row.id=application.import_row_id WHERE row.import_id=?) AND status='active'",
          )
          .bind(fallback.preview.id)
          .first(),
      ).toEqual({ count: 120, exposures: 20 });
      console.info(
        JSON.stringify({
          publicSourceCompletion: {
            history,
            fallbackCaptureCost,
            discoveryCost,
            completionCost,
            repeatedCompletionCost,
            completionResponseReads,
            completionPlans,
          },
        }),
      );

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
