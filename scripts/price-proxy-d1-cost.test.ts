import { expect, it, vi } from "vitest";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import { seedCostHoldings, COST_SUBJECT } from "./test-support/cost-fixtures";
import { D1PriceProxyRepository } from "../packages/database/src/price-proxies";
import {
  PurchaseLotSchema,
  PurchaseReceiptSchema,
  valuationSharesKey,
} from "../packages/domain/src/position-purchases";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";

it("bounds 120 linked recalculations including triggers, tied history, failure recovery and empty reads", async () => {
  const fixture = await createCostDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
  try {
    const db = fixture.database;
    const basis = { key: "issuer-original", unitsPerOriginal: 1 };
    const sharePrices = {
      costMicros: null,
      markMicros: 200_000_000,
      markDate: "2026-09-01",
      shareClass: "Common",
      shareBasis: basis,
    };
    await seedCostHoldings(db, COST_SUBJECT, 1, false, { sharePrices });
    const positions = (
      await db
        .prepare(
          `SELECT h.position_id,h.snapshot_id,q.id quote_id,q.observed_at
      FROM holding_import_application_heads h JOIN holding_price_source_heads p ON p.source_position_id=h.position_id
      JOIN holding_price_quotes q ON q.id=p.quote_id WHERE p.household_id='hh_demo' ORDER BY h.position_id`,
        )
        .all<{
          position_id: string;
          snapshot_id: string;
          quote_id: string;
          observed_at: string;
        }>()
    ).results;
    expect(positions).toHaveLength(120);
    const receipts = positions.map((p, i) => {
      const source = positions[i === 0 ? 1 : 0]!;
      const details = {
        investmentTerms: unknownInvestmentTerms(),
        coversPosition: true,
        lots: [
          PurchaseLotSchema.parse({
            id: "synthetic-allocation",
            purchasedOn: "2025-01-01",
            shareClass: "Preferred",
            priceMicros: null,
            referencePriceMicros: null,
            grossCashMinor: null,
            netCapitalMinor: null,
            feePpm: null,
            feeBasis: null,
            feeLabel: null,
            remainingSharesMicros: 12_345_678,
            sharesAsOf: "2026-01-01",
            sourceLabel: "Synthetic allocation",
            sourceUrl: null,
            mark: null,
            quantityDetails: {
              status: "estimated",
              derivation: "Synthetic allocation notice",
              evidence: null,
              shareBasis: basis,
            },
          }),
        ],
      };
      return PurchaseReceiptSchema.parse({
        id: crypto.randomUUID(),
        positionId: p.position_id,
        snapshotId: p.snapshot_id,
        currency: "USD",
        acceptedAt: new Date().toISOString(),
        details: {
          ...details,
          valuation: {
            snapshotId: p.snapshot_id,
            records: [
              {
                id: "proxy",
                origin: "proxy",
                totalMinor: null,
                priceMicros: sharePrices.markMicros,
                effectiveDate: sharePrices.markDate,
                priceDate: sharePrices.markDate,
                shareClass: "Common",
                shareBasis: basis,
                carryStatus: "before_carry",
                sourceLabel: "Tokenfolio",
                sourceUrl: null,
                sourceEvidenceId: source.quote_id,
                sourcePositionId: source.position_id,
                priceSourcePositionId: source.position_id,
                sourceCapturedAt: source.observed_at,
                watchEvidenceId: null,
                followSource: true,
                crossClassProxy: true,
              },
            ],
            selected: {
              recordId: "proxy",
              method: "shares",
              sharesKey: valuationSharesKey(details),
            },
            calculation: {
              policy: "linked-price-proxy-v1",
              quoteId: source.quote_id,
              quantityReceiptId: "synthetic-original-quantity",
              valueMinor: 246914,
              quantityMicros: 12_345_678,
              estimatedShares: true,
            },
          },
        },
      });
    });
    await db.batch(
      receipts.map((r) =>
        db
          .prepare(
            `INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at)
      VALUES(?,'hh_demo',?,?,NULL,?,'usr_demo',?)`,
          )
          .bind(
            r.id,
            r.positionId,
            r.snapshotId,
            JSON.stringify(r),
            r.acceptedAt,
          ),
      ),
    );
    // Interrupt only propagation after the import is accepted: replay must pick
    // up durable source heads without re-fetching the provider or losing value.
    const interrupted = new Proxy(db, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => {
            if (sql.includes("SELECT link.household_id"))
              throw new Error("synthetic projection interruption");
            return target.prepare(sql);
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    await fixture.execute(`INSERT INTO users VALUES ('proxy-other-user','proxy-other-subject','proxy-other@example.invalid','Synthetic Other','2026-09-01');
      INSERT INTO households VALUES ('proxy-other','proxy-other-user','Synthetic Other','USD','2026-09-01')`);
    const measured = measureD1(db);
    const propagator = new D1PriceProxyRepository(measured.database);
    const costs = [];
    for (const revision of [2, 3, 4, 5]) {
      // Unrelated household history grows alongside every returned position.
      await seedCostHoldings(db, "proxy-other-subject", revision, false, {
        sharePrices,
      });
      // Tie both application and observation timestamps to exercise the ID
      // tiebreaker as history grows, not just the leading timestamp.
      await expect(
        seedCostHoldings(interrupted, COST_SUBJECT, revision, false, {
          sharePrices: {
            ...sharePrices,
            markMicros: 200_000_000 + revision * 1_000_000,
            markDate: `2026-09-${String(revision).padStart(2, "0")}`,
          },
        }),
      ).rejects.toThrow("synthetic projection interruption");
      measured.reset();
      expect(await propagator.refresh(COST_SUBJECT)).toEqual({
        recalculated: 120,
      });
      for (const sql of measured.queries)
        if (sql.includes("SELECT link.household_id")) {
          const plan = await db
            .prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .bind(COST_SUBJECT)
            .all<{ detail: string }>();
          expect(
            plan.results.filter((row) =>
              /SCAN (?:review|q|head|link|application_head)\b/u.test(
                row.detail,
              ),
            ),
          ).toEqual([]);
        }
      expect(measured.cost.roundTrips).toBe(2);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(6_000);
      expect(measured.cost.rowsWritten).toBeLessThanOrEqual(1_000);
      costs.push({ ...measured.cost });
      measured.reset();
      expect(await propagator.refresh(COST_SUBJECT)).toEqual({
        recalculated: 0,
      });
      expect(measured.cost.roundTrips).toBe(1);
      expect(measured.cost.rowsWritten).toBe(0);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(1_000);
    }
    expect(costs.at(-1)!.rowsRead).toBeLessThanOrEqual(
      costs[0]!.rowsRead + 120,
    );
    measured.reset();
    expect(await propagator.refresh("foreign-subject")).toEqual({
      recalculated: 0,
    });
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(10);
    expect(measured.cost.rowsWritten).toBe(0);
    console.info(JSON.stringify({ proxyRefresh: costs }));
  } finally {
    vi.useRealTimers();
    await fixture.close();
  }
}, 120_000);
