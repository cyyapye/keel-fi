import { expect, it } from "vitest";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { measureD1 } from "./test-support/d1-cost";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1PositionLinkRepository } from "../packages/database/src/position-links";
import { COST_SUBJECT } from "./test-support/cost-fixtures";

it("bounds 120-record link projections, positive matches, growing history, empty and unrelated households", async () => {
  const fixture = await createCostFixtureDatabase({ operation: "holdings" });
  try {
    const meter = measureD1(fixture.database);
    const reader = new D1InvestmentPositionViewRepository(meter.database);
    const flatten = async () =>
      (await reader.listForHousehold("hh_demo")).connections.flatMap((c) =>
        c.containers.flatMap((c) => c.positions),
      );
    const positions = await flatten();
    expect(positions).toHaveLength(120);
    expect(meter.cost.roundTrips).toBe(3);
    expect(meter.cost.rowsWritten).toBe(0);
    const first = positions[0]!;
    const second = positions[1]!;
    meter.reset();
    await new D1PositionLinkRepository(meter.database).accept(COST_SUBJECT, {
      sourcePositionId: first.id,
      targetPositionId: second.id,
      expectedSourceSnapshotId: first.snapshot.id,
      expectedTargetSnapshotId: second.snapshot.id,
      expectedSourceParticipationReviewId: null,
      expectedTargetParticipationReviewId: null,
      expectedReviewId: null,
      relationship: "same_investment",
      state: "linked",
      useSourceValue: true,
      note: "",
    });
    expect(meter.cost.roundTrips).toBe(7);
    expect(meter.cost.rowsWritten).toBeLessThanOrEqual(16);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(20_000);
    const acceptance = { ...meter.cost };
    // Native constraints stay enabled. Exercise one head lookup per source and
    // target while accepted decisions grow independently of the visible count.
    for (let version = 0; version < 8; version++) {
      const statements = [];
      for (let index = 0; index < 120; index += 2) {
        const source = positions[index]!;
        const target = positions[index + 1]!;
        statements.push(
          fixture.database
            .prepare(
              `INSERT INTO holding_position_link_reviews(id,household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,source_participation_review_id,target_participation_review_id,prior_id,relationship,state,use_source_value,note,reviewer_user_id,accepted_at)
          VALUES(?,'hh_demo',?,?,?,?,NULL,NULL,(SELECT review_id FROM holding_position_link_heads WHERE source_position_id=?),'same_investment','linked',1,'Synthetic cost history','usr_demo','2026-09-20T12:00:00.000Z')`,
            )
            .bind(
              crypto.randomUUID(),
              source.id,
              target.id,
              source.snapshot.id,
              target.snapshot.id,
              source.id,
            ),
        );
      }
      await fixture.database.batch(statements);
      meter.reset();
      expect(await flatten()).toHaveLength(60);
      expect(meter.cost.roundTrips).toBe(3);
      expect(meter.cost.rowsWritten).toBe(0);
      expect(meter.cost.rowsRead).toBeLessThanOrEqual(12_000);
    }
    const positive = { ...meter.cost };
    for (let revision = 2; revision <= 4; revision++)
      await fixture.setup({ operation: "holdings", revision });
    meter.reset();
    await flatten();
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(positive.rowsRead + 720);
    const history = { ...meter.cost };
    await fixture.execute(
      `INSERT INTO users VALUES('links-other-user','links-other-subject','other@example.test','Synthetic other owner','2026-09-01T00:00:00.000Z'); INSERT INTO households VALUES('links-other-household','links-other-user','Synthetic other household','USD','2026-09-01T00:00:00.000Z');`,
    );
    await fixture.setup({
      operation: "holdings",
      subject: "links-other-subject",
    });
    meter.reset();
    await flatten();
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(history.rowsRead + 10);
    for (const sql of [...meter.queries].filter((q) =>
      q.includes("AS linked_value_json"),
    )) {
      const plan = (
        await fixture.database
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind("hh_demo")
          .all<{ detail: string }>()
      ).results;
      expect(
        plan.filter((r) => /SCAN (link|lp|la|ls|lr|a|ss)\b/u.test(r.detail)),
      ).toEqual([]);
    }
    meter.reset();
    await reader.listForHousehold("missing-household");
    expect(meter.cost.roundTrips).toBe(3);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(10);
    expect(meter.cost.rowsWritten).toBe(0);
    console.info(
      JSON.stringify({
        positionLinks: { acceptance, positive, history, empty: meter.cost },
      }),
    );
  } finally {
    await fixture.close();
  }
}, 120_000);
