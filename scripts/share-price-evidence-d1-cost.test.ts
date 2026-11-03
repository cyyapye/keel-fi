import { expect, it, vi } from "vitest";
import { measureD1 } from "./test-support/d1-cost";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { COST_SUBJECT } from "./test-support/cost-fixtures";
import { D1PositionPurchaseRepository } from "../packages/database/src/position-purchases";

it("bounds share-price evidence reads across 120 holdings, repeated history and empty results", async () => {
  const fixture = await createCostFixtureDatabase();
  const fixedTime = "2026-09-05T00:00:00.000Z";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(fixedTime));
  try {
    const db = fixture.database;
    await fixture.setup({ operation: "holdings", fixedTime });
    await fixture.setup({ operation: "watch-targets" });
    // All 120 legal positions have a recorded review linking the same issuer.
    await db.batch([
      db.prepare(`INSERT INTO holding_position_exposure_mappings
        (id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
        SELECT id||'-regrouped',household_id,position_id,exposure_id,relationship_kind,NULL,'withdrawn','review','Synthetic shared issuer',evidence_sha256,effective_at,version+1,id,'usr_demo',accepted_at,1
        FROM holding_position_exposure_mappings m WHERE id LIKE 'cost-mapping-%' AND status='active'`),
      db.prepare(`INSERT INTO holding_position_exposure_mappings
        (id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
        SELECT id||'-shared',household_id,position_id,'cost-exposure-0',relationship_kind,1000000,'active','review','Synthetic shared issuer',evidence_sha256,effective_at,
          CASE WHEN exposure_id='cost-exposure-0' THEN version+1 ELSE 1 END,
          CASE WHEN exposure_id='cost-exposure-0' THEN id ELSE NULL END,'usr_demo',accepted_at,1
        FROM holding_position_exposure_mappings WHERE id LIKE 'cost-mapping-%-regrouped'`),
    ]);
    const p = await db
      .prepare(
        "SELECT id FROM holding_positions WHERE household_id='hh_demo' ORDER BY id LIMIT 1",
      )
      .first<{ id: string }>();
    const measured = measureD1(db);
    const repo = new D1PositionPurchaseRepository(measured.database);
    for (const revision of [1, 2, 3]) {
      if (revision > 1)
        await fixture.setup({ operation: "holdings", revision, fixedTime });
      await db
        .prepare(
          `INSERT OR IGNORE INTO holding_import_share_prices(import_row_id,household_id,evidence_json)
        SELECT a.import_row_id,'hh_demo','{"costMicros":20000000,"markMicros":35000000,"markDate":"2026-09-01","shareClass":"Series B"}'
        FROM holding_import_applications a`,
        )
        .run();
      measured.reset();
      expect(
        (await repo.valuationEvidence(COST_SUBJECT, p!.id)).prices,
      ).toHaveLength(120);
      expect(measured.cost.roundTrips).toBe(2);
      expect(measured.cost.rowsWritten).toBe(0);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(5000);
      console.info(JSON.stringify({ revision, ...measured.cost }));
    }
    const baselineReads = measured.cost.rowsRead;
    await fixture.execute(`INSERT INTO users VALUES ('price-other-user','price-other-subject','price-other@example.invalid','Synthetic Other','2026-09-01');
      INSERT INTO households VALUES ('price-other','price-other-user','Synthetic Other','USD','2026-09-01')`);
    await db
      .prepare(
        `INSERT INTO companies SELECT 'price-foreign-'||value,'price-other','Synthetic Foreign '||value,NULL,'active','2026-09-01','2026-09-01' FROM json_each(?)`,
      )
      .bind(JSON.stringify(Array.from({ length: 1200 }, (_, i) => i)))
      .run();
    await db
      .prepare(
        `INSERT INTO canonical_exposures (id,household_id,exposure_kind,canonical_name,protected_identity_key,company_id,resolution_method,evidence_sha256,created_by_user_id,created_at,immutable)
      SELECT id||'-exposure',household_id,'private_company',legal_name,NULL,id,'reviewed_company',?,'price-other-user','2026-09-01',1 FROM companies WHERE household_id='price-other'`,
      )
      .bind("b".repeat(64))
      .run();
    measured.reset();
    expect(
      (await repo.valuationEvidence(COST_SUBJECT, p!.id)).prices,
    ).toHaveLength(120);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(baselineReads + 20);
    measured.reset();
    expect(await repo.valuationEvidence("price-other-subject", p!.id)).toEqual({
      prices: [],
      watch: [],
    });
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(100);
    measured.reset();
    expect(await repo.valuationEvidence("foreign-subject", p!.id)).toEqual({
      prices: [],
      watch: [],
    });
    expect(measured.cost.roundTrips).toBe(2);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(100);
  } finally {
    vi.useRealTimers();
    await fixture.close();
  }
}, 120000);
