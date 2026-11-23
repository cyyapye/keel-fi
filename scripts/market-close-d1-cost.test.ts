import {
  personalInstrument,
  recordPersonalDailyCloses,
} from "../packages/database/src/personal-daily-closes";
import { expect, it } from "vitest";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { measureD1 } from "./test-support/d1-cost";
import { COST_SUBJECT } from "./test-support/cost-fixtures";
import { PurchaseLotSchema } from "../packages/domain/src/position-purchases";
import {
  decideMarketSource,
  listMarketReviews,
  marketReviewDetail,
  recordOfficialClose,
} from "../packages/database/src/market-close";
import { firstCedarClose } from "./seed-closing-price";

it("bounds the close review projection for 120 exposures across same-session revisions and an empty household", async () => {
  const fixture = await createCostFixtureDatabase();
  try {
    const db = fixture.database;
    await fixture.setup({
      operation: "holdings",
      fixedTime: "2026-09-15T12:00:00.000Z",
    });
    await fixture.setup({ operation: "watch-targets" });
    const q = firstCedarClose;
    const lot = PurchaseLotSchema.parse({
      id: "allocation",
      purchasedOn: "2025-01-01",
      shareClass: "Class A",
      priceMicros: null,
      referencePriceMicros: null,
      grossCashMinor: null,
      netCapitalMinor: null,
      feePpm: null,
      feeBasis: null,
      feeLabel: null,
      remainingSharesMicros: 100_000_000,
      sharesAsOf: "2026-01-01",
      sourceLabel: "Synthetic allocation",
      sourceUrl: null,
      mark: null,
      quantityDetails: {
        status: "confirmed",
        derivation: "Synthetic allocation",
        evidence: "Synthetic shares",
        shareBasis: q.shareBasis,
      },
    });
    await db
      .prepare(
        `INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at)
 SELECT 'close-test-'||p.id,p.household_id,p.id,a.snapshot_id,NULL,json_object('id','close-test-'||p.id,'positionId',p.id,'snapshotId',a.snapshot_id,'currency','USD','details',json(?),'acceptedAt',?), 'usr_demo',?
 FROM holding_positions p JOIN holding_import_application_heads a ON a.position_id=p.id WHERE p.household_id='hh_demo'`,
      )
      .bind(
        JSON.stringify({ coversPosition: true, lots: [lot] }),
        q.observedAt,
        q.observedAt,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO exposure_market_listings SELECT id,?,'CDR','Demo Exchange','Class A',?,?,?,'USD' FROM canonical_exposures WHERE id LIKE 'cost-exposure-%'`,
      )
      .bind(q.instrumentId, q.shareBasis.key, q.date, q.sourceUrl)
      .run();
    const measured = measureD1(db);
    for (const count of [1, 5, 15]) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO exposure_market_closes SELECT l.exposure_id||'-'||r.value,l.exposure_id,?,r.value,50000000,1,?,? FROM exposure_market_listings l CROSS JOIN json_each(?) r`,
        )
        .bind(
          q.date,
          q.sourceUrl,
          q.observedAt,
          JSON.stringify(Array.from({ length: count }, (_, i) => i + 1)),
        )
        .run();
      measured.reset();
      expect(
        await listMarketReviews(measured.database, COST_SUBJECT),
      ).toHaveLength(120);
      expect(measured.cost.roundTrips).toBe(1);
      expect(measured.cost.rowsRead).toBeLessThan(7500);
      expect(measured.cost.rowsWritten).toBe(0);
    }
    const sql = [...measured.queries][0]!;
    const plan = await db
      .prepare("EXPLAIN QUERY PLAN " + sql)
      .bind(COST_SUBJECT)
      .all<{ detail: string }>();
    expect(
      plan.results.filter((n) =>
        /SCAN (f|first|q|other|review)\b/.test(n.detail),
      ),
    ).toEqual([]);
    measured.reset();
    expect(
      await listMarketReviews(measured.database, "unrelated-subject"),
    ).toEqual([]);
    expect(measured.cost.rowsRead).toBeLessThan(15);
    measured.reset();
    await recordOfficialClose(measured.database, {
      ...q,
      revision: 16,
      exposureId: "cost-exposure-0",
    });
    expect(measured.cost.roundTrips).toBe(2);
    expect(measured.cost.rowsRead).toBeLessThan(40);
    expect(measured.cost.rowsWritten).toBeLessThan(20);
    const revised = (await marketReviewDetail(
      db,
      COST_SUBJECT,
      "cost-exposure-0",
    ))!;
    const approval = {
      choice: "follow" as const,
      token: revised.token,
      requestId: crypto.randomUUID(),
    };
    // D1 counts writes from the member and read-state triggers in changes.
    expect(
      await decideMarketSource(db, COST_SUBJECT, revised.exposureId, approval),
    ).toBe(true);
    expect(
      await decideMarketSource(db, COST_SUBJECT, revised.exposureId, approval),
    ).toBe(true);
    const saved = (await listMarketReviews(db, COST_SUBJECT)).find(
      (review) => review.exposureId === revised.exposureId,
    )!;
    expect([
      saved.version,
      saved.choice,
      saved.positions.every((p) => p.enrolled),
    ]).toEqual([1, "follow", true]);

    // Personal daily observations must stay isolated from official-close enrollment.
    const listing = {
      company: "Test company",
      issuerId: "0000000001",
      ticker: "CDR",
      venue: "Nasdaq" as const,
      shareClass: "Class A",
      firstSession: "2025-01-01",
      identitySourceUrl: "https://example.test/filing",
    };
    const instrument = personalInstrument(listing);
    const exposure = "personal-price-test";
    await db
      .prepare(
        `INSERT INTO canonical_exposures(id,household_id,exposure_kind,canonical_name,resolution_method,evidence_sha256,created_by_user_id,created_at,immutable)
      SELECT ?,'hh_demo','unresolved','Test company','unresolved',lower(hex(randomblob(32))),'usr_demo',?,1`,
      )
      .bind(exposure, q.observedAt)
      .run();
    await db
      .prepare("INSERT INTO exposure_market_listings VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(
        exposure,
        instrument,
        listing.ticker,
        listing.venue,
        listing.shareClass,
        instrument,
        listing.firstSession,
        listing.identitySourceUrl,
        "USD",
      )
      .run();
    const days = Array.from({ length: 100 }, (_, i) => ({
      date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
      priceMicros: 45_000_000 + i,
    }));
    const importPrices = (prices: typeof days, at: string, id = exposure) =>
      recordPersonalDailyCloses(measured.database, id, listing, prices, at);
    await expect(
      importPrices(days, "2025-06-01T13:00:00Z", revised.exposureId),
    ).rejects.toThrow("matching confirmed listing");
    await expect(
      recordOfficialClose(db, {
        ...q,
        exposureId: exposure,
        instrumentId: instrument,
      }),
    ).rejects.toThrow();
    for (const repeat of [false, true]) {
      measured.reset();
      expect(await importPrices(days, "2025-05-01T13:00:00Z")).toBe(!repeat);
      expect(measured.cost.roundTrips).toBe(2);
      expect(measured.cost.rowsRead).toBeLessThan(2500);
      expect(measured.cost.rowsWritten).toBeLessThan(1200);
      if (repeat) expect(measured.cost.rowsWritten).toBe(0);
    }
    const last = days.at(-1)!;
    const corrected = [{ ...last, priceMicros: 51_000_000 }];
    expect(await importPrices(corrected, "2025-05-03T13:00:00Z")).toBe(true);
    expect(await importPrices([last], "2025-05-02T13:00:00Z")).toBe(false);
    expect(
      await db
        .prepare(
          "SELECT price_micros FROM exposure_market_closes WHERE exposure_id=? AND session_date=? ORDER BY revision",
        )
        .bind(exposure, last.date)
        .all()
        .then((r) => r.results.map((d) => d.price_micros)),
    ).toEqual([last.priceMicros, corrected[0]!.priceMicros]);
  } finally {
    await fixture.close();
  }
}, 120_000);
