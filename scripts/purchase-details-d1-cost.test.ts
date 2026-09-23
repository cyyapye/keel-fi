import { D1InvestmentReviewRepository } from "../packages/database/src/investment-review";
import { expect, it } from "vitest";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { createPurchaseCostDatabase } from "./test-support/purchase-cost-database";
import { measureD1 } from "./test-support/d1-cost";
import { COST_SUBJECT } from "./test-support/cost-fixtures";

it("bounds purchase-head reads and writes across 120 positions and growing review history", async () => {
  const fixture = await createPurchaseCostDatabase();
  try {
    await fixture.seed();
    await fixture.execute(`INSERT INTO users VALUES('purchase-other-user','purchase-other-subject','purchase-other@example.test','Synthetic other owner','2026-09-01T00:00:00.000Z');
    INSERT INTO households VALUES('purchase-other-household','purchase-other-user','Synthetic other household','USD','2026-09-01T00:00:00.000Z');`);
    await fixture.seed("purchase-other-subject");
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
    const history = await fixture.measurePurchaseHistory({
      subject: COST_SUBJECT,
      householdId: "hh_demo",
      positions: positions.map((position) => ({
        id: position.id,
        snapshotId: position.snapshot.id,
      })),
    });
    expect(history.acceptances).toHaveLength(960);
    expect(
      new Set(history.acceptances.map((entry) => entry.receiptId)).size,
    ).toBe(960);
    for (const [index, operation] of history.acceptances.entries()) {
      expect(operation.version).toBe(Math.floor(index / positions.length));
      expect(operation.positionId).toBe(
        positions[index % positions.length]!.id,
      );
      expect(operation.cost.roundTrips).toBe(2);
      expect(operation.cost.rowsWritten).toBeLessThanOrEqual(12);
      expect(operation.cost.rowsRead).toBeLessThanOrEqual(60);
    }
    for (const [version, read] of history.reads.entries()) {
      expect(read.version).toBe(version);
      expect(read.positionCount).toBe(120);
      expect(read.cost.roundTrips).toBe(3);
      expect(read.cost.rowsWritten).toBe(0);
      expect(read.cost.rowsRead).toBeLessThanOrEqual(empty.rowsRead + 480);
    }
    expect(history.stored).toEqual({ receiptCount: 960, positionCount: 120 });
    meter.reset();
    const reviewed = await review.getContext(COST_SUBJECT, positions[0]!.id);
    expect(reviewed.purchaseContext?.receipt?.id).toBe(
      history.acceptances.findLast(
        (entry) => entry.positionId === positions[0]!.id,
      )?.receiptId,
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
