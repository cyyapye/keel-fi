import { expect, it, vi } from "vitest";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { measureD1 } from "./test-support/d1-cost";
import { COST_SUBJECT } from "./test-support/cost-fixtures";
import { D1GpReportedTotalRepository } from "../packages/database/src/gp-reported-totals";
import { PurchaseReceiptSchema } from "../packages/domain/src/position-purchases";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";

it("refreshes 120 linked GP totals in two round trips with bounded real D1 cost through tied and unrelated history", async () => {
  const fixture = await createCostFixtureDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-02T12:00:00.000Z"));
  try {
    const db = fixture.database;
    await fixture.setup({
      operation: "holdings",
      fixedTime: "2026-09-01T12:00:00.000Z",
      observations: { positionCount: 240 },
    });
    const positions = (
      await db
        .prepare(
          "SELECT position_id,snapshot_id FROM holding_import_application_heads head JOIN holding_positions p ON p.id=head.position_id WHERE p.household_id='hh_demo' ORDER BY position_id",
        )
        .all<{ position_id: string; snapshot_id: string }>()
    ).results;
    expect(positions).toHaveLength(240);
    const writes: D1PreparedStatement[] = [];
    for (const [index, target] of positions.slice(120).entries()) {
      const source = positions[index]!;
      writes.push(
        db
          .prepare(
            `INSERT INTO holding_position_link_reviews(id,household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,source_participation_review_id,target_participation_review_id,prior_id,relationship,state,use_source_value,note,reviewer_user_id,accepted_at)
        VALUES(?,'hh_demo',?,?,?,?,NULL,NULL,NULL,'same_investment','linked',1,'Synthetic GP source','usr_demo',?)`,
          )
          .bind(
            crypto.randomUUID(),
            source.position_id,
            target.position_id,
            source.snapshot_id,
            target.snapshot_id,
            new Date().toISOString(),
          ),
      );
      const receipt = PurchaseReceiptSchema.parse({
        id: crypto.randomUUID(),
        positionId: target.position_id,
        snapshotId: target.snapshot_id,
        currency: "USD",
        acceptedAt: new Date().toISOString(),
        details: {
          coversPosition: false,
          lots: [],
          investmentTerms: unknownInvestmentTerms(),
          valuation: {
            snapshotId: target.snapshot_id,
            records: [
              {
                id: "gp",
                origin: "gp",
                totalMinor: 100_001,
                priceMicros: null,
                effectiveDate: "2026-09-01",
                priceDate: null,
                shareClass: null,
                carryStatus: "before_carry",
                sourceLabel: "Synthetic GP report",
                sourceUrl: null,
                sourceEvidenceId: null,
                sourcePositionId: null,
                sourceCapturedAt: null,
                watchEvidenceId: null,
              },
            ],
            selected: { recordId: "gp", method: "total", sharesKey: null },
          },
        },
      });
      writes.push(
        db
          .prepare(
            "INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,'hh_demo',?,?,NULL,?,'usr_demo',?)",
          )
          .bind(
            receipt.id,
            target.position_id,
            target.snapshot_id,
            JSON.stringify(receipt),
            receipt.acceptedAt,
          ),
      );
    }
    await db.batch(writes);
    await fixture.execute(
      "INSERT INTO users VALUES('gp-other-user','gp-other-subject','other@example.invalid','Synthetic other','2026-09-01'); INSERT INTO households VALUES('gp-other','gp-other-user','Synthetic other','USD','2026-09-01');",
    );
    const meter = measureD1(db);
    const repository = new D1GpReportedTotalRepository(meter.database);
    const costs = [];
    for (const round of [1, 2, 3, 4]) {
      const captureTime = `2026-09-0${round + 2}T12:00:00.000Z`;
      vi.setSystemTime(new Date(`2026-09-0${round + 2}T12:00:01.000Z`));
      for (const revision of [round * 2, round * 2 + 1]) {
        await fixture.setup({
          operation: "holdings",
          subject: "gp-other-subject",
          revision,
          fixedTime: captureTime,
        });
        await expect(
          fixture.setup({
            operation: "holdings",
            revision,
            fixedTime: captureTime,
            observations: { positionCount: 240 },
            interruptGpTotalPropagation: true,
          }),
        ).rejects.toThrow("synthetic projection interruption");
      }
      meter.reset();
      expect(await repository.refresh(COST_SUBJECT)).toEqual({
        refreshed: 120,
      });
      expect(meter.cost.roundTrips).toBe(2);
      expect(meter.cost.rowsWritten).toBeLessThanOrEqual(1_000);
      expect(meter.cost.rowsRead).toBeLessThanOrEqual(7_000);
      costs.push({ ...meter.cost });
      expect(
        await db
          .prepare(
            `SELECT COUNT(*) count FROM holding_purchase_heads h
        JOIN holding_purchase_reviews r ON r.id=h.review_id
        JOIN holding_position_link_heads link ON link.target_position_id=h.position_id AND link.state='linked' AND link.use_source_value=1
        JOIN holding_import_application_heads source ON source.position_id=link.source_position_id
        JOIN holding_position_snapshots balance ON balance.id=source.snapshot_id
        WHERE h.household_id='hh_demo'
          AND json_extract(r.receipt_json,'$.details.valuation.reportedTotalRefresh.sourceApplicationId')=source.application_id
          AND json_extract(r.receipt_json,'$.details.valuation.records[0].totalMinor')=balance.unrealized_value_minor`,
          )
          .first("count"),
      ).toBe(120);
      for (const sql of meter.queries)
        if (sql.includes("SELECT h.household_id")) {
          const plan = await db
            .prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .bind(COST_SUBJECT, new Date().toISOString())
            .all<{ detail: string }>();
          expect(
            plan.results.filter((r) =>
              /SCAN (?:h|review|source|source_head|balance|target)\b/u.test(
                r.detail,
              ),
            ),
          ).toEqual([]);
        }
      meter.reset();
      expect(await repository.refresh(COST_SUBJECT)).toEqual({ refreshed: 0 });
      expect(meter.cost.roundTrips).toBe(1);
      expect(meter.cost.rowsWritten).toBe(0);
    }
    expect(
      Math.max(...costs.map((c) => c.rowsRead)) -
        Math.min(...costs.map((c) => c.rowsRead)),
    ).toBeLessThanOrEqual(120);
    meter.reset();
    expect(await repository.refresh("missing-subject")).toEqual({
      refreshed: 0,
    });
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(10);
    expect(meter.cost.roundTrips).toBe(1);
    expect(meter.cost.rowsWritten).toBe(0);
    console.info(
      JSON.stringify({ gpReportedTotals: { costs, empty: meter.cost } }),
    );
  } finally {
    vi.useRealTimers();
    await fixture.close();
  }
}, 120_000);
