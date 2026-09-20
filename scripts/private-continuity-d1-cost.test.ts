import { expect, it } from "vitest";
import { D1ExposureRepository } from "../packages/database/src/exposures";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import {
  COST_SUBJECT,
  COST_TIME,
  seedCostHoldings,
} from "./test-support/cost-fixtures";

it("automatically reconciles 120 historical private investments with bounded D1 work and stable retries", async () => {
  const fixture = await createCostDatabase();
  try {
    await seedCostHoldings(fixture.database, COST_SUBJECT, 1, true, {
      status: "Realized",
    });
    const measured = measureD1(fixture.database);
    await seedCostHoldings(measured.database, COST_SUBJECT, 2, false, {
      status: "Realized",
      investedMinor: 130_000,
      allocationMinor: 170_000,
    });
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(35);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(60_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(8_000);
    console.info(JSON.stringify({ historicalPrivateImport: measured.cost }));
    expect(
      await fixture.database
        .prepare("SELECT COUNT(*) count FROM holding_position_continuities")
        .first("count"),
    ).toBe(120);
    const positions = new D1InvestmentPositionViewRepository(measured.database);
    measured.reset();
    const inventory = await positions.listForHousehold("hh_demo");
    const rows = inventory.connections.flatMap((connection) =>
      connection.containers.flatMap((container) => container.positions),
    );
    expect(rows).toHaveLength(120);
    expect(
      rows.every(
        (position) =>
          position.snapshot.providerStatus === "realized" &&
          position.snapshot.investedMinor === 130_000,
      ),
    ).toBe(true);
    expect(measured.cost.rowsWritten).toBe(0);
    const repository = new D1ExposureRepository(measured.database);
    measured.reset();
    await repository.reconcileRetainedPositionContinuity(COST_SUBJECT);
    const retryCost = { ...measured.cost };
    expect(retryCost.roundTrips).toBe(2);
    expect(retryCost.rowsWritten).toBe(0);

    // Grow accepted same-date history without changing economic identity.
    for (let revision = 3; revision < 6; revision++) {
      await seedCostHoldings(fixture.database, COST_SUBJECT, revision, false, {
        status: "Realized",
        investedMinor: 130_000,
        allocationMinor: 170_000,
      });
    }
    measured.reset();
    await repository.reconcileRetainedPositionContinuity(COST_SUBJECT);
    const historyCost = { ...measured.cost };
    // A populated latest/prior lookup may visit one additional candidate per
    // investment; it must not scan all three older captures per investment.
    expect(historyCost.rowsRead).toBeLessThanOrEqual(retryCost.rowsRead + 240);
    console.info(JSON.stringify({ historicalPrivateHistory: historyCost }));
    await fixture.database.batch([
      fixture.database
        .prepare(
          "INSERT INTO users VALUES ('continuity-other-user', 'synthetic-continuity-other-subject', 'other@example.invalid', 'Synthetic user', ?)",
        )
        .bind(COST_TIME),
      fixture.database
        .prepare(
          "INSERT INTO households VALUES ('continuity-other-household', 'continuity-other-user', 'Synthetic household', 'USD', ?)",
        )
        .bind(COST_TIME),
    ]);
    await seedCostHoldings(
      fixture.database,
      "synthetic-continuity-other-subject",
    );
    measured.reset();
    await repository.reconcileRetainedPositionContinuity(COST_SUBJECT);
    expect(measured.cost.roundTrips).toBe(2);
    expect(measured.cost.rowsWritten).toBe(0);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(
      historyCost.rowsRead + 10,
    );
    console.info(
      JSON.stringify({
        historicalPrivateRetry: { before: retryCost, after: measured.cost },
      }),
    );
    for (const sql of measured.queries) {
      const plan = (
        await fixture.database
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind(...Array(sql.split("?").length - 1).fill(null))
          .all<{ detail: string }>()
      ).results;
      expect(
        plan.filter((step) =>
          /SCAN (position|candidate|snapshot|ownership|container|application|existing)\b/u.test(
            step.detail,
          ),
        ),
      ).toEqual([]);
    }
    expect(
      await fixture.database
        .prepare(
          "SELECT COUNT(*) count FROM holding_positions WHERE household_id = 'hh_demo'",
        )
        .first("count"),
    ).toBe(240);
    expect(
      await fixture.database
        .prepare(
          "SELECT COUNT(*) count FROM holding_position_continuities WHERE household_id = 'hh_demo'",
        )
        .first("count"),
    ).toBe(120);
  } finally {
    await fixture.close();
  }
}, 90_000);
