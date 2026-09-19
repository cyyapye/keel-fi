import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  D1PortfolioBaselineRepository,
  refreshAcceptedPortfolioBaseline,
} from "../packages/database/src/portfolio-baseline";
import { D1InvestmentExposureViewRepository } from "../packages/database/src/exposure-read-model";
import {
  createCostDatabase,
  measureD1,
  emptyD1Cost,
} from "./test-support/d1-cost";
import { seedCostHoldings, COST_SUBJECT } from "./test-support/cost-fixtures";

it("keeps partial baseline refresh costs bounded with 120 sources, tied-date history, and retained exceptions", async () => {
  const fixture = await createCostDatabase();
  try {
    await seedCostHoldings(fixture.database);
    const measured = measureD1(fixture.database);
    const exposures = new D1InvestmentExposureViewRepository(measured.database);
    let missing = false;
    const baseline = new D1PortfolioBaselineRepository(measured.database, {
      list: async (subject) => {
        const view = await exposures.list(subject);
        return {
          ...view,
          positions: missing ? view.positions.slice(1) : view.positions,
        };
      },
    });
    const initial = await baseline.getState(COST_SUBJECT);
    await baseline.confirm(COST_SUBJECT, {
      sourceRevision: initial.sourceRevision!,
      baseForecastSnapshotId: initial.baseForecastSnapshotId!,
      baseForecastSnapshotVersion: initial.baseForecastSnapshotVersion!,
      otherFiEligibleLiquidMinor: 100_000,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Set synthetic cost baseline.",
    });
    await fixture.execute(
      readFileSync(
        "packages/database/migrations/0068_exception_baseline_empty.sql",
        "utf8",
      ),
    );
    expect(
      (await fixture.database.prepare("PRAGMA foreign_key_check").all())
        .results,
    ).toEqual([]);
    const costs: (typeof measured.cost)[] = [];
    for (const revision of [2, 3, 4, 5]) {
      await seedCostHoldings(fixture.database, COST_SUBJECT, revision);
      missing = true;
      Object.assign(measured.cost, emptyD1Cost());
      expect(
        (await refreshAcceptedPortfolioBaseline(baseline, COST_SUBJECT)).status,
      ).toBe("refreshed");
      expect(measured.cost.roundTrips).toBeLessThanOrEqual(46);
      expect(measured.cost.rowsWritten).toBeLessThanOrEqual(1_000);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(18_000);
      costs.push({ ...measured.cost });
      Object.assign(measured.cost, emptyD1Cost());
      const state = await baseline.getState(COST_SUBJECT);
      expect(state.exceptions).toHaveLength(1);
      expect(state.automaticUpdateCount).toBe(0);
      expect(measured.cost.roundTrips).toBeLessThanOrEqual(14);
      expect(measured.cost.rowsWritten).toBe(0);
      Object.assign(measured.cost, emptyD1Cost());
      expect(
        (await refreshAcceptedPortfolioBaseline(baseline, COST_SUBJECT)).status,
      ).toBe("manual_required");
      expect(measured.cost.rowsWritten).toBe(0);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(6_000);
    }
    const sql = [...measured.queries].find(
      (query) =>
        query.includes("AS source_json") &&
        query.includes("portfolio_baseline_cash_items"),
    )!;
    const current = await baseline.getState(COST_SUBJECT);
    const plan = await fixture.database
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(
        "hh_demo",
        current.latestBaseline!.id,
        "hh_demo",
        current.latestBaseline!.id,
      )
      .all<{ detail: string }>();
    expect(
      plan.results.some((row) =>
        /SCAN (?:item|snapshot|position|holding_position_ownerships)\b/.test(
          row.detail,
        ),
      ),
    ).toBe(false);
    expect(
      plan.results.some((row) =>
        /portfolio_baseline_items_baseline_idx|sqlite_autoindex_portfolio_baseline_items/.test(
          row.detail,
        ),
      ),
    ).toBe(true);
    // An unrelated household and its historical items must not enter the projection.
    await fixture.execute(
      "INSERT INTO users VALUES ('baseline-other-user', 'baseline-other-subject', 'other@example.invalid', 'Synthetic Other', '2026-09-01'); INSERT INTO households VALUES ('baseline-other', 'baseline-other-user', 'Synthetic Other', 'USD', '2026-09-01')",
    );
    await seedCostHoldings(fixture.database, "baseline-other-subject", 6);
    Object.assign(measured.cost, emptyD1Cost());
    const unchanged = await baseline.getState(COST_SUBJECT);
    expect(unchanged.latestBaseline?.id).toBe(current.latestBaseline?.id);
    expect(unchanged.exceptions).toEqual(current.exceptions);
    expect(measured.cost.rowsWritten).toBe(0);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(6_000);
    console.info(
      JSON.stringify({
        baselineRefreshCosts: costs,
        baselineReadCost: measured.cost,
      }),
    );
  } finally {
    await fixture.close();
  }
}, 180_000);
