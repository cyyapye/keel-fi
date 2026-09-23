import { D1InvestmentReviewRepository } from "../packages/database/src/investment-review";
import { expect, it } from "vitest";
import { D1PositionPurchaseRepository } from "../packages/database/src/position-purchases";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import { seedCostHoldings, COST_SUBJECT } from "./test-support/cost-fixtures";

it("bounds purchase-head reads and writes across 120 positions and growing review history", async () => {
  const fixture = await createCostDatabase();
  try {
    await seedCostHoldings(fixture.database);
    await fixture.execute(`INSERT INTO users VALUES('purchase-other-user','purchase-other-subject','purchase-other@example.test','Synthetic other owner','2026-09-01T00:00:00.000Z');
    INSERT INTO households VALUES('purchase-other-household','purchase-other-user','Synthetic other household','USD','2026-09-01T00:00:00.000Z');`);
    await seedCostHoldings(fixture.database, "purchase-other-subject");
    const meter = measureD1(fixture.database);
    const reader = new D1InvestmentPositionViewRepository(meter.database);
    const get = () => reader.listForHousehold("hh_demo");
    await get();
    const empty = { ...meter.cost };
    meter.reset();
    const positions = (await get()).connections.flatMap((c) =>
      c.containers.flatMap((c) => c.positions),
    );
    expect(positions).toHaveLength(120);
    const review = new D1InvestmentReviewRepository(meter.database);
    meter.reset();
    await review.getContext(COST_SUBJECT, positions[0]!.id);
    const reviewEmpty = { ...meter.cost };
    const repo = new D1PositionPurchaseRepository(meter.database);
    const heads = new Map<string, string>();
    for (let version = 0; version < 8; version++) {
      for (const p of positions) {
        meter.reset();
        const r = await repo.accept(COST_SUBJECT, p.id, {
          expectedSnapshotId: p.snapshot.id,
          expectedReceiptId: heads.get(p.id) ?? null,
          details: { coversPosition: true, lots: [] },
        });
        heads.set(p.id, r.id);
        expect(meter.cost.roundTrips).toBe(2);
        expect(meter.cost.rowsWritten).toBeLessThanOrEqual(12);
        expect(meter.cost.rowsRead).toBeLessThanOrEqual(60);
      }
      meter.reset();
      await get();
      expect(meter.cost.roundTrips).toBe(3);
      expect(meter.cost.rowsWritten).toBe(0);
      expect(meter.cost.rowsRead).toBeLessThanOrEqual(empty.rowsRead + 480);
    }
    meter.reset();
    const reviewed = await review.getContext(COST_SUBJECT, positions[0]!.id);
    expect(reviewed.purchaseContext?.receipt?.id).toBe(
      heads.get(positions[0]!.id),
    );
    expect(meter.cost.roundTrips).toBe(reviewEmpty.roundTrips);
    expect(meter.cost.rowsWritten).toBe(0);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(reviewEmpty.rowsRead + 4);
    const reviewSql = [...meter.queries].find((sql) =>
      sql.includes("purchase.receipt_json purchase_json"),
    )!;
    const reviewPlan = (
      await fixture.database
        .prepare(`EXPLAIN QUERY PLAN ${reviewSql}`)
        .bind(positions[0]!.id, "hh_demo")
        .all<{ detail: string }>()
    ).results;
    expect(
      reviewPlan.filter((row) => /SCAN purchase(?:_head)?\b/u.test(row.detail)),
    ).toEqual([]);
    meter.reset();
    await reader.listForHousehold("unrelated-empty-household");
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(10);
    for (const sql of [...meter.queries].filter((query) =>
      query.includes("purchase_review.receipt_json"),
    )) {
      const plan = (
        await fixture.database
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind("hh_demo")
          .all<{ detail: string }>()
      ).results;
      expect(
        plan.filter((row) => /SCAN purchase_(?:head|review)/u.test(row.detail)),
      ).toEqual([]);
    }
  } finally {
    await fixture.close();
  }
  // This exercises 960 real D1 writes plus reads; allow the shared Linux runner
  // the same fixture time as other large cost holdouts. Query/row budgets above
  // remain the performance contract and are asserted for every operation.
}, 180_000);
