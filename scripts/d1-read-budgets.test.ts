import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { D1AlphaRepository } from "../packages/database/src/index";
import { D1CashAccountsRepository } from "../packages/database/src/cash-accounts";
import { D1CashFlowRepository } from "../packages/database/src/cash-flow";
import { D1LiabilitiesRepository } from "../packages/database/src/liabilities";
import { D1InvestmentConnectionsRepository } from "../packages/database/src/investment-connections";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1HoldingsPageRepository } from "../packages/database/src/holdings-page";
import { D1HoldingImportRepository } from "../packages/database/src/holding-imports";
import { D1PortfolioWatchRepository } from "../packages/database/src/portfolio-watch";
import { D1ExposureRepository } from "../packages/database/src/exposures";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import {
  COST_SUBJECT,
  COST_TIME,
  seedCostHoldings,
  seedCostProposals,
  seedCostWatchTargets,
  syntheticDigest,
} from "./test-support/cost-fixtures";

let fixture: Awaited<ReturnType<typeof createCostDatabase>>;
let measured: ReturnType<typeof measureD1>;
let importId: string;
beforeAll(async () => {
  fixture = await createCostDatabase();
  measured = measureD1(fixture.database);
  await seedCostHoldings(measured.database, COST_SUBJECT, 1, true);
  // Includes the documented maximum of 100 containers. The former row lookup
  // loop alone required 100 round trips before any import data was persisted.
  expect(measured.cost.roundTrips).toBeLessThanOrEqual(35);
  measured.reset();
  importId = await seedCostHoldings(measured.database, COST_SUBJECT, 2);
  expect(measured.cost.roundTrips).toBeLessThanOrEqual(35);
  console.info(
    JSON.stringify({
      captureQueries: [...measured.byQuery]
        .sort((a, b) => b[1].rowsRead - a[1].rowsRead)
        .slice(0, 5)
        .map(([sql, cost]) => ({ sql: sql.slice(0, 170), ...cost })),
    }),
  );
  expect(measured.cost.rowsRead).toBeLessThanOrEqual(60_000);
  expect(measured.cost.rowsWritten).toBeLessThanOrEqual(8_000);
  expect(
    await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM holding_position_continuities")
      .first<number>("count"),
  ).toBe(120);
  console.info(JSON.stringify({ syntheticAcceptedCapture: measured.cost }));
  await seedCostProposals(fixture.database);
  await seedCostWatchTargets(fixture.database);
  const connections = new D1InvestmentConnectionsRepository(fixture.database);
  for (let index = 0; index < 50; index++) {
    await connections.upsertConnection(
      COST_SUBJECT,
      "connector-secrets/synthetic.enc",
      syntheticDigest(40_000 + index),
      `ins-synthetic-${index}`,
      `Synthetic institution ${index}`,
    );
  }
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});

async function readWithin<T>(
  name: string,
  read: () => Promise<T>,
  trips: number,
  rows: number,
) {
  measured.reset();
  const result = await read();
  expect(measured.cost.roundTrips, name).toBeLessThanOrEqual(trips);
  expect(measured.cost.rowsRead, name).toBeLessThanOrEqual(rows);
  expect(measured.cost.rowsWritten, name).toBe(0);
  console.info(
    JSON.stringify({ syntheticReadBudget: { name, ...measured.cost } }),
  );
  return result;
}

describe("real D1 reads at collection scale", () => {
  it("bounds the maximum 20 pending cash and debt proposals with 120 rows and 100 historical proposals without per-proposal requests", async () => {
    const cash = await readWithin(
      "cash proposals",
      () =>
        new D1CashAccountsRepository(measured.database).getState(
          COST_SUBJECT,
          true,
        ),
      8,
      5_000,
    );
    expect(cash.pendingProposals).toHaveLength(20);
    expect(
      cash.pendingProposals.flatMap((proposal) => proposal.rows),
    ).toHaveLength(120);
    const debts = await readWithin(
      "debt proposals",
      () =>
        new D1LiabilitiesRepository(measured.database).getState(
          COST_SUBJECT,
          true,
        ),
      8,
      5_000,
    );
    expect(debts.pendingProposals).toHaveLength(20);
    expect(
      debts.pendingProposals.flatMap((proposal) => proposal.rows),
    ).toHaveLength(120);
    await readWithin(
      "cash flow",
      () =>
        new D1CashFlowRepository(measured.database).getState(
          COST_SUBJECT,
          true,
        ),
      6,
      1_000,
    );
  });

  it("loads the maximum 50 brokerage statuses in three requests", async () => {
    const state = await readWithin(
      "investment status",
      () =>
        new D1InvestmentConnectionsRepository(measured.database).getState(
          COST_SUBJECT,
          true,
        ),
      3,
      5_000,
    );
    expect(state.connections).toHaveLength(50);
  });

  it("keeps accepted position and import reads within independent budgets", async () => {
    const positions = await readWithin(
      "positions",
      () =>
        new D1InvestmentPositionViewRepository(measured.database).list(
          COST_SUBJECT,
          COST_TIME,
        ),
      8,
      20_000,
    );
    expect(
      positions.connections
        .flatMap((connection) => connection.containers)
        .flatMap((container) => container.positions),
    ).toHaveLength(120);
    await readWithin(
      "holdings page",
      () =>
        new D1HoldingsPageRepository(measured.database).getPage(
          COST_SUBJECT,
          "available",
        ),
      20,
      35_000,
    );
    const preview = await readWithin(
      "import preview",
      () =>
        new D1HoldingImportRepository(measured.database).getHoldingImport(
          COST_SUBJECT,
          importId,
        ),
      5,
      12_000,
    );
    expect(preview.rows).toHaveLength(120);
    await readWithin(
      "pending imports",
      () =>
        new D1HoldingImportRepository(
          measured.database,
        ).listPendingHoldingImports(COST_SUBJECT),
      2,
      5_000,
    );
  });

  it("selects at most 40 jobs from 120 watch targets without bootstrap writes", async () => {
    const watch = new D1PortfolioWatchRepository(measured.database);
    measured.reset();
    const first = await watch.prepareScan("hh_demo");
    expect(first.jobs).toHaveLength(40);
    expect(measured.cost.roundTrips).toBe(1);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(8_000);
    expect(measured.cost.rowsWritten).toBe(0);
    await readWithin(
      "repeat source discovery",
      () => watch.prepareScan("hh_demo"),
      3,
      2_000,
    );
  });

  it("bounds forty source discoveries and observations and makes replay read-only", async () => {
    const watch = new D1PortfolioWatchRepository(measured.database);
    const row = await fixture.database
      .prepare(
        "SELECT id FROM portfolio_watch_sources WHERE company_id = 'cost-company-0' LIMIT 1",
      )
      .first<{ id: string }>();
    if (!row) throw new Error("Synthetic source missing");
    await fixture.database
      .prepare(
        "UPDATE portfolio_watch_sources SET status = 'active' WHERE id = ?",
      )
      .bind(row.id)
      .run();
    const source = await watch.getSource(row.id);
    if (!source) throw new Error("Synthetic source missing");
    const candidates = Array.from({ length: 40 }, (_, index) => ({
      canonicalUrl: `${source.allowedOrigin}/news/synthetic-${index}`,
      sourceKind: "official_company_web" as const,
      discoveryMethod: "synthetic-cost-test",
      grade: source.grade,
    }));
    measured.reset();
    expect(
      await watch.registerCandidates(source.id, candidates, COST_TIME),
    ).toHaveLength(40);
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(4);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(5_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(800);
    console.info(JSON.stringify({ syntheticDiscovery: measured.cost }));
    await readWithin(
      "discovery replay",
      () => watch.registerCandidates(source.id, candidates, COST_TIME),
      3,
      500,
    );
    const observations = candidates.map((candidate, index) => ({
      sourceId: source.id,
      objectKey: "synthetic/source.html",
      contentType: "text/html",
      byteSize: 1_000,
      sha256: syntheticDigest(90_000),
      retrievedAt: COST_TIME,
      sourceUrl: candidate.canonicalUrl,
      sourceTitle: `Synthetic news ${index}`,
      publishedAt: COST_TIME,
      eventType: "company_update" as const,
      observedFact: `Synthetic company announcement ${index}`,
      modelConfidencePpm: 900_000,
      financingFacts: null,
      fingerprint: syntheticDigest(90_100 + index),
    }));
    measured.reset();
    expect(await watch.recordObservations(observations)).toBe(40);
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(4);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(2_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(1_000);
    console.info(JSON.stringify({ syntheticObservationBatch: measured.cost }));
    expect(
      await readWithin(
        "observation replay",
        () => watch.recordObservations(observations),
        2,
        200,
      ),
    ).toBe(0);
    expect(
      await fixture.database.prepare("PRAGMA foreign_key_check").all(),
    ).toMatchObject({ results: [] });
  });

  it("excludes prior months from recurring cash usage counts", async () => {
    const cash = new D1CashAccountsRepository(measured.database);
    measured.reset();
    const before = await cash.getState(COST_SUBJECT, true);
    const beforeCost = { ...measured.cost };
    await fixture.database
      .prepare(
        `INSERT INTO connector_sync_runs
      (id, household_id, connector_account_id, status, started_at, finished_at, cursor, discovered_count, proposed_count, error_code)
      SELECT 'cost-old-cash-' || value, 'hh_demo', 'cost-cash', 'succeeded', '2025-01-01T00:00:00.000Z',
        '2025-01-01T00:00:00.000Z', 'cash-live-v1', 0, 0, NULL FROM json_each(?)`,
      )
      .bind(JSON.stringify(Array.from({ length: 120 }, (_, index) => index)))
      .run();
    measured.reset();
    expect(await cash.getState(COST_SUBJECT, true)).toEqual(before);
    expect(measured.cost.rowsRead - beforeCost.rowsRead).toBeLessThanOrEqual(
      10,
    );
    expect(measured.cost.rowsWritten).toBe(0);
  });

  it("keeps history and unrelated households out of the dashboard and continuity read cost", async () => {
    const alpha = new D1AlphaRepository(measured.database);
    await readWithin(
      "alpha before history",
      () => alpha.getAlphaData(COST_SUBJECT),
      40,
      40_000,
    );
    const before = { ...measured.cost };
    const snapshot = await fixture.database
      .prepare(
        "SELECT * FROM forecast_snapshots WHERE household_id = 'hh_demo' ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .first<Record<string, string | number | null>>();
    if (!snapshot) throw new Error("Synthetic forecast missing");
    const children = await Promise.all(
      ["company_forecasts", "liquidity_curves", "forecast_outputs"].map(
        async (table) => ({
          table,
          rows: (
            await fixture.database
              .prepare(`SELECT * FROM ${table} WHERE forecast_snapshot_id = ?`)
              .bind(snapshot.id)
              .all<Record<string, string | number | null>>()
          ).results,
        }),
      ),
    );
    const writes: D1PreparedStatement[] = [];
    const insert = (
      table: string,
      row: Record<string, string | number | null>,
    ) => {
      writes.push(
        fixture.database
          .prepare(
            `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.keys(
              row,
            )
              .map(() => "?")
              .join(", ")})`,
          )
          .bind(...Object.values(row)),
      );
    };
    for (let index = 0; index < 120; index++) {
      const id = `synthetic-cost-history-${index}`;
      insert("forecast_snapshots", {
        ...snapshot,
        id,
        version: Number(snapshot.version) + index + 1,
        input_hash: syntheticDigest(50_000 + index),
      });
      for (const child of children)
        for (const row of child.rows) {
          insert(child.table, {
            ...row,
            id: `${row.id}-cost-${index}`,
            forecast_snapshot_id: id,
          });
        }
    }
    await fixture.database.batch(writes);
    await readWithin(
      "alpha after 120 snapshots",
      () => alpha.getAlphaData(COST_SUBJECT),
      40,
      40_000,
    );
    expect(measured.cost.rowsRead - before.rowsRead).toBeLessThanOrEqual(1_000);
    const exposures = new D1ExposureRepository(measured.database);
    measured.reset();
    await exposures.reconcileRetainedPositionContinuity(COST_SUBJECT);
    const continuityBefore = { ...measured.cost };
    await fixture.database.batch([
      fixture.database
        .prepare(
          "INSERT INTO users VALUES ('cost-other-user', 'synthetic-other-cost-subject', 'cost@example.invalid', 'Synthetic cost user', ?)",
        )
        .bind(COST_TIME),
      fixture.database
        .prepare(
          "INSERT INTO households VALUES ('cost-other-household', 'cost-other-user', 'Synthetic cost household', 'USD', ?)",
        )
        .bind(COST_TIME),
    ]);
    await seedCostHoldings(fixture.database, "synthetic-other-cost-subject");
    measured.reset();
    await exposures.reconcileRetainedPositionContinuity(COST_SUBJECT);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(
      continuityBefore.rowsRead + 10,
    );
    expect(measured.cost.rowsWritten).toBe(0);
    await readWithin(
      "alpha with unrelated household",
      () => alpha.getAlphaData(COST_SUBJECT),
      40,
      40_000,
    );
    expect(measured.cost.rowsRead - before.rowsRead).toBeLessThanOrEqual(1_000);
  }, 60_000);
});
