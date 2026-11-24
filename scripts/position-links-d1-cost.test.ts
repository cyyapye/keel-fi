import { expect, it } from "vitest";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { measureD1 } from "./test-support/d1-cost";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1PositionLinkRepository } from "../packages/database/src/position-links";
import { COST_SUBJECT } from "./test-support/cost-fixtures";

it("includes 120 retained private sources with bounded projection-only workspace reads", async () => {
  const fixture = await createCostFixtureDatabase({
    operation: "holdings",
    legacy: true,
    observations: { status: "Realized" },
  });
  try {
    await fixture.execute(`INSERT INTO investment_connection_versions
      (id,household_id,connection_id,version,institution_key,institution_label,lifecycle_state,credential_reference,supersedes_version_id,recorded_by_user_id,recorded_at,immutable)
      SELECT id||':history',household_id,connection_id,version+1,'reviewed-history:sydecar','Synthetic reviewed history',lifecycle_state,NULL,id,recorded_by_user_id,recorded_at,1
      FROM investment_connection_versions WHERE connection_id='reconciled-holding-connection-v1:hh_demo:sydecar';`);
    const meter = measureD1(fixture.database);
    const repo = new D1PositionLinkRepository(meter.database);
    const workspace = await repo.workspace(COST_SUBJECT);
    expect(workspace.positions).toHaveLength(120);
    expect(
      workspace.positions.every(
        (p) => p.reviewedHistory && p.sourceProvider === "sydecar",
      ),
    ).toBe(true);
    expect(workspace.positions.every((p) => p.ownershipContainerId)).toBe(true);
    expect(workspace.links).toEqual([]);
    expect(meter.cost.roundTrips).toBe(5);
    expect(meter.cost.rowsWritten).toBe(0);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(12_000);
    const history = { ...meter.cost };
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
    await fixture.execute(
      `INSERT INTO users VALUES('retained-other-user','retained-other-subject','other@example.test','Synthetic other owner','2026-09-01T00:00:00.000Z'); INSERT INTO households VALUES('retained-other-household','retained-other-user','Synthetic other household','USD','2026-09-01T00:00:00.000Z');`,
    );
    await fixture.setup({
      operation: "holdings",
      subject: "retained-other-subject",
    });
    meter.reset();
    expect((await repo.workspace(COST_SUBJECT)).positions).toHaveLength(120);
    expect(meter.cost.roundTrips).toBe(5);
    expect(meter.cost.rowsWritten).toBe(0);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(history.rowsRead + 10);
    // A provider label alone must not turn an ordinary account into history.
    await fixture.execute(`INSERT INTO investment_connection_versions
      (id,household_id,connection_id,version,institution_key,institution_label,lifecycle_state,credential_reference,supersedes_version_id,recorded_by_user_id,recorded_at,immutable)
      SELECT id||':misleading-label',household_id,connection_id,version+1,'reviewed-history:sydecar',institution_label,lifecycle_state,NULL,id,recorded_by_user_id,recorded_at,1
      FROM investment_connection_versions WHERE household_id='retained-other-household';`);
    meter.reset();
    expect((await repo.workspace("retained-other-subject")).positions).toEqual(
      [],
    );
    expect(meter.cost.roundTrips).toBe(5);
    expect(meter.cost.rowsWritten).toBe(0);
    console.info(
      JSON.stringify({
        retainedPositionLinks: { history, unrelated: meter.cost },
      }),
    );
  } finally {
    await fixture.close();
  }
}, 120_000);

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
    expect(
      positions.every((position) => position.hasLinkedRecords === false),
    ).toBe(true);
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
      await fixture.setup({
        operation: "position-link-history",
        positions: positions.map((position) => ({
          id: position.id,
          snapshotId: position.snapshot.id,
        })),
        reviewIds: Array.from({ length: positions.length / 2 }, () =>
          crypto.randomUUID(),
        ),
      });
      meter.reset();
      const targets = await flatten();
      expect(targets).toHaveLength(60);
      expect(targets.every((target) => target.hasLinkedRecords === true)).toBe(
        true,
      );
      expect(meter.cost.roundTrips).toBe(3);
      expect(meter.cost.rowsWritten).toBe(0);
      expect(meter.cost.rowsRead).toBeLessThanOrEqual(12_000);
    }
    expect(
      await fixture.database
        .prepare(
          "SELECT COUNT(*) AS count FROM holding_position_link_reviews WHERE note = 'Synthetic cost history'",
        )
        .first<number>("count"),
    ).toBe(480);
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
      expect(plan.map((r) => r.detail)).toContain(
        "SEARCH link_presence USING COVERING INDEX holding_position_link_heads_target (household_id=? AND target_position_id=? AND state=?)",
      );
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
