import { afterAll, beforeAll, expect, it } from "vitest";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import {
  seedCostHoldings,
  syntheticDigest,
} from "./test-support/cost-fixtures";
import { D1CashAccountsRepository } from "../packages/database/src/cash-accounts";
import { D1BrokerageCashHistoryRepository } from "../packages/database/src/cash-balance-history";
import { addMinorUnits } from "../packages/domain/src/index";

let fixture: Awaited<ReturnType<typeof createCostDatabase>>;
beforeAll(async () => {
  fixture = await createCostDatabase();
}, 30_000);
afterAll(async () => {
  await fixture?.close();
});
const subject = "synthetic-access-subject";

async function seedBank(who: string, start: number, end: number) {
  const repository = new D1CashAccountsRepository(fixture.database, "free");
  const connection =
    start === 0
      ? await repository.upsertConnection(
          who,
          "Synthetic history bank",
          "synthetic-only/cash-history",
          syntheticDigest(who === subject ? 1000 : 2000),
        )
      : (await repository.getState(who, true)).connections[0]!;
  for (let revision = start; revision < end; revision++) {
    const observedAt = `2026-08-${String(revision + 1).padStart(2, "0")}T12:00:00.000Z`;
    const run = await repository.beginRefresh(
      who,
      connection.id,
      revision === 0 ? "initial" : "live",
    );
    const staged = await repository.stageProposal(who, run.id, {
      objectKey: `synthetic-history/${who}/${revision}.json`,
      sourceSha256: syntheticDigest(revision + 100),
      normalized: {
        normalizedFingerprint: syntheticDigest(revision + 200),
        observedAt,
        rows: Array.from({ length: 100 }, (_, i) => ({
          naturalKeySha256: syntheticDigest(i + 1),
          itemAccountKeySha256: syntheticDigest(i + 1),
          institutionLabel: "Synthetic history bank",
          accountLabel: `Synthetic account ${i}`,
          subtype: "checking" as const,
          availableMinor: addMinorUnits(10000, revision),
          currentMinor: addMinorUnits(10000, revision),
          valueMinor: addMinorUnits(10000, revision),
          valueState: "reported" as const,
          balanceSource: "available" as const,
          observedAt,
          issues: [],
        })),
      },
    });
    if (!staged.proposal) throw new Error("Missing synthetic proposal");
    await repository.completeRefresh(who, run.id, staged.proposal.id, 100);
    if (revision === 0)
      await repository.applyProposal(who, staged.proposal.id, {
        changeNote: "Accepted synthetic history accounts",
        decisions: staged.proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
        })),
      });
    else await repository.applyAutomaticUpdates(who);
  }
  return (await repository.getState(who, true)).acceptedAccounts[0]!.id;
}

it("keeps cash history reads fixed and linear as accepted history grows, with household isolation and indexed plans", async () => {
  // Bank accounts have a documented maximum of 100; brokerage positions can exceed it.
  const id = await seedBank(subject, 0, 8);
  const meter = measureD1(fixture.database);
  const banks = new D1CashAccountsRepository(meter.database);
  const small = await banks.balanceHistory(subject, id, 5);
  expect(small?.entries).toHaveLength(5);
  const low = { ...meter.cost };
  expect(low).toMatchObject({ roundTrips: 3, statements: 3, rowsWritten: 0 });
  expect(low.rowsRead).toBeGreaterThan(0);
  const laterId = await seedBank(subject, 8, 16);
  meter.reset();
  const grown = await banks.balanceHistory(subject, laterId, 5);
  const high = { ...meter.cost };
  expect(grown?.total).toBe(16);
  expect(high).toMatchObject({ roundTrips: 3, statements: 3, rowsWritten: 0 });
  expect(high.rowsRead).toBeLessThanOrEqual(low.rowsRead * 3);
  expect(high.rowsRead).toBeLessThan(20_000);
  await fixture.execute(`INSERT INTO users (id,access_subject,email,display_name,created_at) VALUES('usr_cash_other','synthetic-other-history','other@example.invalid','Other demo','2026-08-01T00:00:00Z');
    INSERT INTO households (id,owner_user_id,name,base_currency,created_at) VALUES('hh_cash_other','usr_cash_other','Other synthetic household','USD','2026-08-01T00:00:00Z');`);
  const otherId = await seedBank("synthetic-other-history", 0, 8);
  meter.reset();
  expect(await banks.balanceHistory(subject, otherId, 5)).toBeNull();
  expect(meter.cost.roundTrips).toBe(1);
  expect(meter.cost.rowsWritten).toBe(0);
  meter.reset();
  await banks.balanceHistory(subject, laterId, 5);
  expect(meter.cost.rowsRead).toBe(high.rowsRead);
  await seedCostHoldings(fixture.database, subject, 1, false, {
    instrument: "cash",
  });
  const position = await fixture.database
    .prepare(
      `SELECT a.position_id,a.snapshot_id FROM holding_import_applications a JOIN holding_position_snapshots s ON s.id=a.snapshot_id WHERE s.instrument_type='cash' LIMIT 1`,
    )
    .first<{ position_id: string; snapshot_id: string }>();
  expect(position).not.toBeNull();
  const broker = new D1BrokerageCashHistoryRepository(meter.database);
  meter.reset();
  expect((await broker.history(subject, position!.position_id, 5))?.total).toBe(
    1,
  );
  const brokerLow = { ...meter.cost };
  for (let revision = 2; revision <= 4; revision++)
    await seedCostHoldings(fixture.database, subject, revision, false, {
      instrument: "cash",
    });
  meter.reset();
  expect((await broker.history(subject, position!.position_id, 5))?.total).toBe(
    4,
  );
  const brokerHigh = { ...meter.cost };
  expect(brokerHigh).toMatchObject({
    roundTrips: 2,
    statements: 2,
    rowsWritten: 0,
  });
  expect(brokerHigh.rowsRead).toBeLessThan(200);
  expect(
    (
      await broker.history(
        subject,
        position!.position_id,
        5,
        undefined,
        position!.snapshot_id,
      )
    )?.total,
  ).toBe(1);
  meter.reset();
  expect(
    await broker.history("synthetic-other-history", position!.position_id, 5),
  ).toBeNull();
  expect(meter.cost.roundTrips).toBe(1);
  for (const sql of meter.queries) {
    const plan = await fixture.database
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...Array<null>((sql.match(/\?/gu) ?? []).length).fill(null))
      .all<{ detail: string }>();
    expect(plan.results.some((row) => /SEARCH/u.test(row.detail))).toBe(true);
    expect(
      plan.results.filter((row) =>
        /^SCAN (decision|row|proposal|a|s)(?:\s|$)/u.test(row.detail),
      ),
    ).toEqual([]);
  }
  console.log(
    JSON.stringify({
      cashHistoryD1: {
        bank: { low, high },
        brokerage: { low: brokerLow, high: brokerHigh },
        bankMaximum: 100,
        brokeragePositions: 120,
      },
    }),
  );
}, 120_000);
