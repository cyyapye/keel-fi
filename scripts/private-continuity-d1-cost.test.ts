import { build } from "esbuild";
import { expect, it } from "vitest";
import { D1ExposureRepository } from "../packages/database/src/exposures";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import { COST_SUBJECT, seedCostHoldings } from "./test-support/cost-fixtures";

it("automatically reconciles 120 historical private investments with bounded D1 work and stable retries", async () => {
  const bundled = await build({
    entryPoints: ["scripts/test-support/private-continuity-cost-worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["browser", "module", "main"],
    external: ["node:*", "cloudflare:*"],
    logLevel: "silent",
  });
  const fixture = await createCostDatabase(bundled.outputFiles[0]!.text);
  const setup = async (operation: "history" | "initial" | "unrelated") => {
    const response = await fixture.dispatchFetch(
      "https://synthetic-setup.invalid",
      { method: "POST", body: operation },
    );
    if (!response.ok) throw new Error(await response.text());
  };
  try {
    await setup("initial");
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
    await setup("history");
    measured.reset();
    await repository.reconcileRetainedPositionContinuity(COST_SUBJECT);
    const historyCost = { ...measured.cost };
    // A populated latest/prior lookup may visit one additional candidate per
    // investment; it must not scan all three older captures per investment.
    expect(historyCost.rowsRead).toBeLessThanOrEqual(retryCost.rowsRead + 240);
    console.info(JSON.stringify({ historicalPrivateHistory: historyCost }));
    await setup("unrelated");
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
