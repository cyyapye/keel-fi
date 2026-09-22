import { D1InvestmentReviewRepository } from "../packages/database/src/investment-review";
import { InvestmentReviewStateSchema } from "../packages/domain/src/investment-review";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  D1PortfolioBaselineRepository,
  refreshAcceptedPortfolioBaseline,
} from "../packages/database/src/portfolio-baseline";
import { D1InvestmentExposureViewRepository } from "../packages/database/src/exposure-read-model";
import { measureD1, emptyD1Cost } from "./test-support/d1-cost";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { COST_SUBJECT } from "./test-support/cost-fixtures";

it("keeps partial baseline refresh costs bounded with 120 sources, tied-date history, and retained exceptions", async () => {
  const fixture = await createCostFixtureDatabase({ operation: "holdings" });
  try {
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
      await fixture.setup({
        operation: "holdings",
        subject: COST_SUBJECT,
        revision,
      });
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
        /SCAN (?:item|snapshot|position|holding_position_ownerships|candidate|candidate_snapshot|review|application|accepted_snapshot)\b/.test(
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
    await fixture.setup({
      operation: "holdings",
      subject: "baseline-other-subject",
      revision: 6,
    });
    Object.assign(measured.cost, emptyD1Cost());
    const unchanged = await baseline.getState(COST_SUBJECT);
    expect(unchanged.latestBaseline?.id).toBe(current.latestBaseline?.id);
    expect(unchanged.exceptions).toEqual(current.exceptions);
    expect(measured.cost.rowsWritten).toBe(0);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(6_000);
    // Accepted closures refresh around the one truly missing source, with the
    // same fixed query and measured D1 budgets as ordinary value updates.
    const reviewRepository = new D1InvestmentReviewRepository(fixture.database);
    const active = await exposures.list(COST_SUBJECT);
    // Keep one real review transition here; the 118 remaining positions are
    // fixture volume for the baseline projection, not separate workflow cases.
    for (const position of active.positions.slice(1, 2)) {
      const context = await reviewRepository.getContext(
        COST_SUBJECT,
        position.id,
      );
      await reviewRepository.review(COST_SUBJECT, position.id, {
        requestId: crypto.randomUUID(),
        expectedReviewId: context.review?.id ?? null,
        expectedSnapshotId: context.snapshotId,
        expectedEvidenceRevision: context.evidenceRevision,
        participationStatus: "historical",
      });
    }
    const historical = active.positions.slice(2).map((position) =>
      InvestmentReviewStateSchema.parse({
        id: crypto.randomUUID(),
        positionId: position.id,
        version: 1,
        participationStatus: "historical",
        closure: null,
        amountCorrection: null,
        ownershipObservations: [],
        documentAssignments: [],
        recordedAt: "2026-09-01T00:00:00.000Z",
      }),
    );
    await fixture.database
      .prepare(
        `
      INSERT INTO holding_investment_reviews
        (id, household_id, position_id, request_id, request_sha256,
         expected_snapshot_id, supersedes_review_id, version, state_json,
         reviewer_user_id, recorded_at, evidence_guard_json)
      SELECT json_extract(item.value, '$.id'), p.household_id, p.id,
        json_extract(item.value, '$.id'), printf('%064d', 0),
        (SELECT candidate.snapshot_id FROM holding_import_applications candidate
         JOIN holding_position_snapshots snapshot ON snapshot.id = candidate.snapshot_id
         WHERE candidate.position_id = p.id
         ORDER BY candidate.applied_at DESC, snapshot.observed_at DESC, candidate.id DESC LIMIT 1),
        NULL, 1, item.value, household.owner_user_id,
        json_extract(item.value, '$.recordedAt'),
        '{"reviewId":null,"observationId":null,"scans":[],"incoming":[]}'
      FROM json_each(?) item
      JOIN holding_positions p ON p.id = json_extract(item.value, '$.positionId')
      JOIN households household ON household.id = p.household_id
      WHERE p.household_id = 'hh_demo'
    `,
      )
      .bind(JSON.stringify(historical))
      .run();
    expect(historical).toHaveLength(118);
    expect(
      await fixture.database
        .prepare(
          `
      SELECT COUNT(*) AS count FROM holding_investment_reviews
      WHERE household_id = 'hh_demo'
        AND json_extract(state_json, '$.participationStatus') = 'historical'
    `,
        )
        .first("count"),
    ).toBe(119);
    expect(
      (await fixture.database.prepare("PRAGMA foreign_key_check").all())
        .results,
    ).toEqual([]);
    Object.assign(measured.cost, emptyD1Cost());
    const closed = await baseline.getState(COST_SUBJECT);
    expect(closed.exceptions).toHaveLength(1);
    expect(closed.exceptions?.[0]?.reason).toBe("removed");
    expect(closed.automaticUpdateCount).toBe(119);
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(14);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(6_000);
    expect(measured.cost.rowsWritten).toBe(0);
    Object.assign(measured.cost, emptyD1Cost());
    expect(
      (await refreshAcceptedPortfolioBaseline(baseline, COST_SUBJECT)).status,
    ).toBe("refreshed");
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(46);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(18_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(1_000);
    const retained = await baseline.getState(COST_SUBJECT);
    expect(retained.latestBaseline?.summary.positionCount).toBe(1);
    expect(retained.exceptions).toEqual(closed.exceptions);
    Object.assign(measured.cost, emptyD1Cost());
    expect(
      (await refreshAcceptedPortfolioBaseline(baseline, COST_SUBJECT)).status,
    ).toBe("manual_required");
    expect(measured.cost.rowsWritten).toBe(0);
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
