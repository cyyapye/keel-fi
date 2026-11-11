import { expect, it, vi } from "vitest";
import { measureD1 } from "./test-support/d1-cost";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { COST_SUBJECT } from "./test-support/cost-fixtures";
import { D1PriceProxyRepository } from "../packages/database/src/price-proxies";
import {
  PurchaseLotSchema,
  PurchaseReceiptSchema,
  valuationSharesKey,
} from "../packages/domain/src/position-purchases";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";

it("bounds 120 linked recalculations including triggers, tied history, failure recovery and empty reads", async () => {
  const fixture = await createCostFixtureDatabase();
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
    const seed = (
      subject: string,
      revision: number,
      prices: {
        costMicros: number | null;
        markMicros: number;
        markDate: string | null;
        shareClass: string | null;
        shareBasis: typeof basis | null;
      },
      interruptPricePropagation = false,
    ) =>
      fixture.setup({
        operation: "holdings",
        subject,
        revision,
        fixedTime: new Date().toISOString(),
        interruptPricePropagation,
        observations: { sharePrices: prices },
      });
    await seed(COST_SUBJECT, 1, sharePrices);
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
        distributionReview: {
          method: "capital_return_first_v1" as const,
          events: Array.from({ length: 100 }, (_, index) => ({
            id: `synthetic-distribution-${index}`,
            kind: "cash" as const,
            receivedOn: "2025-01-01",
            investorValueMinor: index,
            sourceLabel: "Synthetic notice",
            sourceUrl: null,
            note: "",
          })),
          coverage: { status: "complete" as const, throughDate: "2026-10-01" },
          priorCarry: { status: "known" as const, amountMinor: 0 },
          provider: {
            inclusion: "none" as const,
            sourceSnapshotId: p.snapshot_id,
            realizedValueMinor: 0,
          },
          sourceLabel: "Synthetic reviewed history",
          sourceUrl: null,
          note: "",
        },
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
    await db.batch([
      db.prepare(
        "INSERT INTO users VALUES ('proxy-other-user','proxy-other-subject','proxy-other@example.invalid','Synthetic Other','2026-09-01')",
      ),
      db.prepare(
        "INSERT INTO households VALUES ('proxy-other','proxy-other-user','Synthetic Other','USD','2026-09-01')",
      ),
    ]);
    const measured = measureD1(db);
    const propagator = new D1PriceProxyRepository(measured.database);
    const costs = [];
    for (const revision of [2, 3, 4, 5]) {
      // Unrelated household history grows alongside every returned position.
      await seed("proxy-other-subject", revision, sharePrices);
      // Tie both application and observation timestamps to exercise the ID
      // tiebreaker as history grows, not just the leading timestamp.
      await expect(
        seed(
          COST_SUBJECT,
          revision,
          {
            ...sharePrices,
            markMicros: 200_000_000 + revision * 1_000_000,
            markDate: `2026-09-${String(revision).padStart(2, "0")}`,
          },
          true,
        ),
      ).rejects.toThrow("synthetic projection interruption");
      expect(
        await db
          .prepare(
            `SELECT COUNT(DISTINCT applied_at) appliedTimes,
        COUNT(DISTINCT snapshot.observed_at) observedTimes
        FROM holding_import_applications application
        JOIN holding_position_snapshots snapshot ON snapshot.id=application.snapshot_id
        WHERE application.household_id='hh_demo'`,
          )
          .first(),
      ).toEqual({ appliedTimes: 1, observedTimes: 1 });
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
      const preserved = await db
        .prepare(
          `SELECT r.receipt_json FROM holding_purchase_heads head
        JOIN holding_purchase_reviews r ON r.id=head.review_id WHERE head.household_id='hh_demo' ORDER BY head.position_id`,
        )
        .all<{ receipt_json: string }>();
      expect(preserved.results).toHaveLength(120);
      for (const [index, row] of preserved.results.entries()) {
        const receipt = PurchaseReceiptSchema.parse(
          JSON.parse(row.receipt_json),
        );
        expect(receipt.details.distributionReview).toEqual(
          receipts[index]!.details.distributionReview,
        );
        expect(receipt.details.valuation!.calculation!.quantityReceiptId).toBe(
          "synthetic-original-quantity",
        );
      }

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
    // A changed portal price can omit every piece of share metadata. The
    // followed relationship must still advance, with a native-checked anchor,
    // within the same fanout budget after all the history above has accumulated.
    vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
    await expect(
      seed(
        COST_SUBJECT,
        6,
        {
          costMicros: null,
          markMicros: 150_000_000,
          markDate: null,
          shareClass: null,
          shareBasis: null,
        },
        true,
      ),
    ).rejects.toThrow("synthetic projection interruption");
    measured.reset();
    expect(await propagator.refresh(COST_SUBJECT)).toEqual({
      recalculated: 120,
    });
    expect(measured.cost.roundTrips).toBe(2);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(6_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(1_000);
    costs.push({ ...measured.cost });
    const continued = await db
      .prepare(
        `SELECT receipt_json FROM holding_purchase_reviews r JOIN holding_purchase_heads h ON h.review_id=r.id WHERE h.household_id='hh_demo'`,
      )
      .all<{ receipt_json: string }>();
    expect(continued.results).toHaveLength(120);
    for (const row of continued.results) {
      const receipt = PurchaseReceiptSchema.parse(JSON.parse(row.receipt_json));
      expect(receipt.details.valuation!.records[0]).toMatchObject({
        priceMicros: 150_000_000,
        priceDate: null,
        shareClass: null,
        shareBasis: null,
        sourceContinuation: {
          policy: "accepted-source-continuation-v1",
          shareClass: "Common",
          shareBasis: basis,
        },
      });
      expect(receipt.details.valuation!.calculation).toMatchObject({
        valueMinor: 185185,
        quantityReceiptId: "synthetic-original-quantity",
      });
    }
    measured.reset();
    expect(await propagator.refresh(COST_SUBJECT)).toEqual({ recalculated: 0 });
    expect(measured.cost.roundTrips).toBe(1);
    expect(measured.cost.rowsWritten).toBe(0);
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
