import { createHash } from "node:crypto";
import { build } from "esbuild";
import { z } from "zod";
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

import { publicInventoryCostInput } from "./test-support/public-inventory-cost-worker";

const costWorker = (entry: string) =>
  build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["browser", "module", "main"],
    external: ["node:*", "cloudflare:*"],
    logLevel: "silent",
  }).then((result) => result.outputFiles[0]!.text);

const inventoryWorker = costWorker(
  "scripts/test-support/public-inventory-cost-worker.ts",
);
const captureWorker = costWorker(
  "scripts/test-support/public-source-capture-cost-worker.ts",
);
const count = z.number().int().nonnegative();
const captureResult = z
  .object({
    importId: z.string().min(1).max(256),
    accepted: z
      .object({
        autoAppliedCount: count,
        quarantinedCount: count,
        preservedPositionCount: count,
      })
      .strict(),
    cost: z
      .object({
        roundTrips: count,
        statements: count,
        rowsRead: count,
        rowsWritten: count,
      })
      .strict(),
    queries: z
      .array(
        z
          .object({
            sql: z.string().max(220),
            calls: count,
            rowsRead: count,
            rowsWritten: count,
          })
          .strict(),
      )
      .max(4),
  })
  .strict();
async function capturePublicSource(
  runtime: Awaited<ReturnType<typeof populatedMigrationDatabase>>,
  history: 12 | 24,
  kind: "public" | "fallback",
) {
  const response = await runtime.dispatchFetch(
    "https://synthetic-public-capture.invalid/replay",
    { method: "POST", body: JSON.stringify({ history, kind }) },
  );
  if (!response.ok) throw new Error("Synthetic public capture failed.");
  return captureResult.parse(await response.json());
}

const fixture = populatedMigrationFixtures("0092");
for (const history of [12, 24] as const) {
  it(`reads 120 public source heads independently of ${history} observations and decisions per position`, async () => {
    const stored = await fixture(history, "0092");
    const runtime = await populatedMigrationDatabase(stored, {
      replayWorker: await captureWorker,
    });
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
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(2);
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
      const captured = await capturePublicSource(runtime, history, "public");
      expect(captured.accepted).toMatchObject({
        autoAppliedCount: 120,
        quarantinedCount: 0,
        preservedPositionCount: 0,
      });
      expect(captured.cost.roundTrips).toBeLessThanOrEqual(40);
      expect(captured.cost.rowsRead).toBeLessThanOrEqual(60000);
      expect(captured.cost.rowsWritten).toBeLessThanOrEqual(8000);
      const captureCost = { ...captured.cost };
      // Provider-only securities use the same accepted import and a bounded
      // completion pass. Twenty source securities span six ownership accounts.
      measured.reset();
      const fallback = await capturePublicSource(runtime, history, "fallback");
      expect(fallback.accepted).toMatchObject({
        autoAppliedCount: 120,
        quarantinedCount: 0,
      });
      const fallbackCaptureCost = { ...fallback.cost };
      const fallbackQueries = fallback.queries;
      expect(fallbackCaptureCost.roundTrips).toBeLessThanOrEqual(40);
      measured.reset();
      await imports.getHoldingImport(
        "synthetic-access-subject",
        fallback.importId,
      );
      const completionResponseReads = { ...measured.cost };
      const exposures = new D1ExposureRepository(measured.database);
      measured.reset();
      const documents = await exposures.listRetainedPublicExposureDocuments(
        "synthetic-access-subject",
        fallback.importId,
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
        fallback.importId,
      );
      const completionCost = { ...measured.cost };
      const completionQueries = [...measured.byQuery]
        .sort((a, b) => b[1].rowsRead - a[1].rowsRead)
        .slice(0, 4)
        .map(([sql, cost]) => ({ sql: sql.slice(0, 220), ...cost }));
      const mappingSql = [...measured.byQuery.keys()].find((query) =>
        query.includes("current_application.application_id"),
      )!;
      measured.reset();
      await imports.getHoldingImport(
        "synthetic-access-subject",
        fallback.importId,
      );
      completionResponseReads.roundTrips += measured.cost.roundTrips;
      completionResponseReads.rowsRead += measured.cost.rowsRead;
      expect(completionResponseReads.roundTrips).toBe(12);
      expect(measured.cost.rowsWritten).toBe(0);

      expect(completionCost.roundTrips).toBeLessThanOrEqual(16);
      console.info(
        JSON.stringify({
          completionBudget: {
            history,
            fallbackCaptureCost,
            completionCost,
            completionResponseReads,
            fallbackQueries,
            completionQueries,
          },
        }),
      );
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
              .bind("hh_demo", fallback.importId)
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
          fallback.importId,
        ),
      ).toEqual([]);
      await exposures.reconcileAcceptedPublicExposureHistory(
        "synthetic-access-subject",
        fallback.importId,
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
          .bind(fallback.importId)
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
        plan.some((detail) =>
          /SCAN (?:active|r|s|a|review|later)\b/u.test(detail),
        ),
      ).toBe(false);
      expect(
        plan.some((detail) => /public_active_household/u.test(detail)),
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
  it(`keeps current inventory reads bounded across ${history} presence transitions for 120 securities`, async () => {
    const stored = await fixture(history, "0092");
    const runtime = await populatedMigrationDatabase(stored, {
      replayWorker: await inventoryWorker,
    });
    try {
      const measured = measureD1(runtime.database);
      const imports = new D1HoldingImportRepository(measured.database);
      const capture = async (round: number, empty: boolean) => {
        const report = await imports.stagePlaidInvestmentsHoldingImport(
          "synthetic-access-subject",
          publicInventoryCostInput(round, empty),
        );
        await imports.autoAdjudicatePlaidInvestmentsHoldingImport(
          "synthetic-access-subject",
          report.preview.id,
        );
        return report.preview.id;
      };
      // Replay the same production producer inside workerd. Per-statement
      // host-proxy handles are test transport, not part of this history holdout.
      const prepared = await runtime.dispatchFetch(
        "https://synthetic-public-inventory.invalid/replay",
        { method: "POST", body: JSON.stringify({ history }) },
      );
      if (!prepared.ok) throw new Error(await prepared.text());
      const preparedHistory = z
        .object({ ids: z.array(z.string().min(1)).length(history) })
        .strict()
        .parse(await prepared.json());
      expect(new Set(preparedHistory.ids).size).toBe(history);
      measured.reset();
      const latest = await capture(history, false);
      const captureCost = { ...measured.cost };
      expect(captureCost.roundTrips).toBeLessThanOrEqual(40);
      expect(captureCost.rowsRead).toBeLessThanOrEqual(60000);
      expect(captureCost.rowsWritten).toBeLessThanOrEqual(8000);
      measured.reset();
      const state = await publicSourceState(measured.database, "hh_demo");
      expect(
        state.positions.filter((position) => !state.hiddenIds.has(position.id)),
      ).toHaveLength(120);
      expect(measured.cost.roundTrips).toBe(1);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(2500);
      expect(measured.cost.rowsWritten).toBe(0);
      const currentCost = { ...measured.cost };
      measured.reset();
      const report = await imports.getHoldingImport(
        "synthetic-access-subject",
        latest,
      );
      expect(report.inventory).toMatchObject({
        complete: true,
        returnedPositionIds: expect.any(Array),
        changeCount: 119,
      });
      expect(report.inventory?.returnedPositionIds).toHaveLength(119);
      expect(measured.cost.roundTrips).toBe(6);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(14000);
      expect(measured.cost.rowsWritten).toBe(0);
      const previewCost = { ...measured.cost };
      measured.reset();
      await imports.autoAdjudicatePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        latest,
      );
      expect(measured.cost.rowsWritten).toBe(0);
      const withoutCash = publicInventoryCostInput(history + 1, false);
      withoutCash.rows = withoutCash.rows
        .filter((row) => row.securityType !== "cash")
        .map((row) => ({
          ...row,
          quantityMicros: 2_000_000,
          marketValueMinor: 24000,
        }));
      withoutCash.canonicalScope.rows = withoutCash.canonicalScope.rows.slice(
        0,
        -1,
      );
      measured.reset();
      const partial = await imports.stagePlaidInvestmentsHoldingImport(
        "synthetic-access-subject",
        withoutCash,
      );
      const partialResult =
        await imports.autoAdjudicatePlaidInvestmentsHoldingImport(
          "synthetic-access-subject",
          partial.preview.id,
        );
      const partialCost = { ...measured.cost };
      expect(partialResult.autoAppliedCount).toBe(119);
      expect(partialCost.roundTrips).toBeLessThanOrEqual(40);
      expect(partialCost.rowsRead).toBeLessThanOrEqual(60000);
      expect(partialCost.rowsWritten).toBeLessThanOrEqual(8000);
      measured.reset();
      const partialState = await publicSourceState(
        measured.database,
        "hh_demo",
      );
      expect(
        partialState.positions.filter(
          (position) => position.account_cash_unconfirmed === 1,
        ),
      ).toHaveLength(119);
      expect(
        partialState.positions.filter(
          (position) => !partialState.hiddenIds.has(position.id),
        ),
      ).toHaveLength(120);
      expect(measured.cost.roundTrips).toBe(1);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(2500);
      expect(measured.cost.rowsWritten).toBe(0);
      expect(
        await runtime.database
          .prepare(
            "SELECT COUNT(*) count FROM public_holding_inventories WHERE household_id='hh_demo'",
          )
          .first("count"),
      ).toBe(history + 1);
      expect(
        await runtime.database
          .prepare(
            "SELECT COUNT(*) count FROM public_holding_active_positions WHERE household_id='hh_migration_foreign'",
          )
          .first("count"),
      ).toBe(120);
      const plans = (
        await runtime.database
          .prepare(`EXPLAIN QUERY PLAN ${PUBLIC_SOURCE_POSITIONS_SQL}`)
          .bind("hh_demo")
          .all<{ detail: string }>()
      ).results.map((row) => row.detail);
      expect(plans.some((plan) => /public_active_household/u.test(plan))).toBe(
        true,
      );
      expect(plans.some((plan) => /SCAN (?:active|k|o|p)\b/u.test(plan))).toBe(
        false,
      );
      console.info(
        JSON.stringify({
          publicInventory: {
            history,
            captureCost,
            partialCost,
            currentCost,
            previewCost,
            plans,
          },
        }),
      );
    } finally {
      await runtime.close();
    }
  }, 120_000);
}
