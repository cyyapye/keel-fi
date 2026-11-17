import { readFileSync } from "node:fs";
import { expect, it, onTestFinished, vi } from "vitest";
import {
  legalDocumentTestDatabase,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import {
  COST_SUBJECT,
  seedCostHoldings,
  seedCostWatchTargets,
} from "../../../scripts/test-support/cost-fixtures";
import { D1PositionPurchaseRepository } from "./position-purchases";
import { D1PriceProxyRepository } from "./price-proxies";
import { D1HoldingsPageRepository } from "./holdings-page";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import {
  PurchaseLotSchema,
  PurchaseReceiptSchema,
  type PurchaseReceipt,
  assessValuationFromShares,
  selectedPositionValuation,
} from "@keel/domain/position-purchases";
import {
  DistributionReviewSchema,
  unknownInvestmentTerms,
} from "@keel/domain/investment-details";
import { holdingValueSummary } from "../../../apps/web/src/holding-value";
import {
  continuedPriceMetadata,
  type ValuationRecord,
} from "@keel/domain/valuation-record";

let db: LegalDocumentTestD1, repo: D1PositionPurchaseRepository;
let positions: { id: string; snapshotId: string }[];
const basis = { key: "issuer-original", unitsPerOriginal: 1 };
const prices = (
  price = 200_000_000,
  date: string | null = "2026-09-10",
  units = 1,
) => ({
  costMicros: null,
  markMicros: price,
  markDate: date,
  shareClass: "Common",
  shareBasis: { ...basis, unitsPerOriginal: units },
});
async function setUpRepository(omitInitialMetadata = false) {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
  db = legalDocumentTestDatabase();
  const { sqlite } = db;
  onTestFinished(() => sqlite.close());
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 1, false, {
    sharePrices: {
      ...prices(200_000_000, null),
      ...(omitInitialMetadata ? { shareClass: null, shareBasis: null } : {}),
    },
  });
  await seedCostWatchTargets(db.asD1());
  // One reviewed issuer, separate legal positions. Never infer by company label.
  db.sqlite.exec(`INSERT INTO holding_position_exposure_mappings
    (id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
    SELECT id||'-withdrawn',household_id,position_id,exposure_id,relationship_kind,NULL,'withdrawn','review','Synthetic shared issuer',evidence_sha256,effective_at,version+1,id,'usr_demo',accepted_at,1 FROM holding_position_exposure_mappings WHERE id LIKE 'cost-mapping-%' AND status='active';
    INSERT INTO holding_position_exposure_mappings
    (id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
    SELECT id||'-shared',household_id,position_id,'cost-exposure-0',relationship_kind,1000000,'active','review','Synthetic shared issuer',evidence_sha256,effective_at,
      CASE WHEN exposure_id='cost-exposure-0' THEN version+1 ELSE 1 END,CASE WHEN exposure_id='cost-exposure-0' THEN id ELSE NULL END,'usr_demo',accepted_at,1
    FROM holding_position_exposure_mappings WHERE id LIKE 'cost-mapping-%-withdrawn';`);
  repo = new D1PositionPurchaseRepository(db.asD1());
  await readPositions();
}
async function readPositions() {
  positions = (
    await new D1InvestmentPositionViewRepository(db.asD1()).list(COST_SUBJECT)
  ).connections
    .flatMap((c) =>
      c.containers.flatMap((c) =>
        c.positions.map((p) => ({ id: p.id, snapshotId: p.snapshot.id })),
      ),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}
function current(index: number) {
  const row = db.sqlite
    .prepare(
      "SELECT receipt_json FROM holding_purchase_reviews r JOIN holding_purchase_heads h ON h.review_id=r.id WHERE h.position_id=?",
    )
    .get(positions[index]!.id);
  return row
    ? PurchaseReceiptSchema.parse(JSON.parse(String(row.receipt_json)))
    : null;
}
function replayMetadataMigration() {
  const old = readFileSync(
    "packages/database/migrations/0086_live_price_proxies.sql",
    "utf8",
  );
  const prior = readFileSync(
    "packages/database/migrations/0093_gp_reported_total_refresh.sql",
    "utf8",
  );
  db.sqlite.exec(
    "DROP TRIGGER holding_price_quote_head; DROP TRIGGER holding_price_continuation_guard; DROP VIEW holding_price_current_quotes; DROP TABLE holding_price_metadata_heads; DROP INDEX holding_price_source_heads_version; CREATE INDEX holding_price_source_heads_household ON holding_price_source_heads(household_id,source_position_id);",
  );
  db.sqlite.exec(
    old.slice(
      old.indexOf("CREATE TRIGGER holding_price_quote_head"),
      old.indexOf("CREATE TRIGGER holding_price_quotes_no_update"),
    ),
  );
  db.sqlite.exec(
    prior.slice(
      prior.indexOf("CREATE VIEW holding_price_current_quotes"),
      prior.indexOf("DROP TRIGGER holding_selected_valuation_guard"),
    ),
  );
  db.sqlite.exec(
    prior.slice(
      prior.indexOf("CREATE TRIGGER holding_price_continuation_guard"),
    ),
  );
  db.sqlite.exec(
    readFileSync(
      "packages/database/migrations/0097_price_metadata_continuation.sql",
      "utf8",
    ),
  );
}
function gp(
  price = 200_000_000,
  date = "2026-09-10",
  units = 1,
): ValuationRecord {
  return {
    id: "gp",
    origin: "gp",
    totalMinor: 1_234_567,
    priceMicros: price,
    priceDate: date,
    effectiveDate: "2026-09-01",
    shareClass: "Common",
    shareBasis: { ...basis, unitsPerOriginal: units },
    carryStatus: "before_carry",
    sourceLabel: "Synthetic provider",
    sourceUrl: null,
    sourceEvidenceId: null,
    sourcePositionId: null,
    sourceCapturedAt: null,
    watchEvidenceId: null,
  };
}
async function reviewQuote(
  price = 200_000_000,
  date = "2026-09-10",
  units = 1,
) {
  vi.setSystemTime(new Date(Date.now() + 1000));
  const source = positions[3]!;
  return repo.acceptValuation(COST_SUBJECT, source.id, {
    expectedSnapshotId: source.snapshotId,
    expectedReceiptId: current(3)?.id ?? null,
    record: gp(price, date, units),
    method: "total",
  });
}
async function link(index: number, shares = 84_400_000) {
  const p = positions[index]!;
  const investment = await repo.accept(COST_SUBJECT, p.id, {
    expectedSnapshotId: p.snapshotId,
    expectedReceiptId: null,
    details: {
      coversPosition: true,
      cashCoversPosition: true,
      investmentTerms: {
        ...unknownInvestmentTerms(),
        carryPpm: 150000,
        carryBasis: "gross_cash",
      },
      lots: [
        PurchaseLotSchema.parse({
          id: "allocation",
          purchasedOn: "2025-04-12",
          shareClass: "Preferred",
          priceMicros: 100_000_000,
          referencePriceMicros: null,
          grossCashMinor: 1_000_000,
          netCapitalMinor: 844_000,
          upfrontDeductionsMinor: 56_000,
          capitalReturn: {
            amountMinor: 100_000,
            status: "received",
            effectiveDate: null,
            reportedDistributions: "excluded",
          },
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: shares,
          sharesAsOf: "2026-09-01",
          sourceLabel: "Synthetic agreement",
          sourceUrl: null,
          sourceText:
            "Synthetic provisional allocation; cash retained is not deployed capital.",
          mark: null,
          quantityDetails: {
            status: "estimated",
            derivation: "Synthetic net allocation divided by entry price",
            evidence: "Synthetic allocation notice",
            shareBasis: basis,
          },
        }),
      ],
    },
  });
  const manual = await repo.acceptValuation(COST_SUBJECT, p.id, {
    expectedSnapshotId: p.snapshotId,
    expectedReceiptId: investment.id,
    record: {
      ...gp(),
      id: "mine",
      origin: "judgment",
      sourceLabel: "My estimate",
    },
    method: "total",
  });
  const quote = (await repo.valuationEvidence(COST_SUBJECT, p.id)).prices.find(
    (q) => q.positionId === positions[3]!.id,
  )!;
  return repo.acceptValuation(COST_SUBJECT, p.id, {
    expectedSnapshotId: p.snapshotId,
    expectedReceiptId: manual.id,
    record: {
      ...gp(),
      id: `proxy:${quote.positionId}`,
      origin: "proxy",
      totalMinor: null,
      followSource: true,
      crossClassProxy: true,
      priceSourcePositionId: quote.positionId,
      sourcePositionId: quote.positionId,
      sourceEvidenceId: quote.id,
      sourceCapturedAt: quote.capturedAt,
      sourceLabel: quote.sourceLabel,
      priceDate: quote.markDate,
      priceMicros: quote.markMicros,
      shareBasis: quote.shareBasis,
    },
    method: "shares",
  });
}
const value = (index: number) =>
  selectedPositionValuation(current(index), positions[index]!.snapshotId)
    ?.valueMinor;

it("uses the saved reviewed date instead of an undated import, follows accepted imports, and preserves independent records", async () => {
  await setUpRepository();
  const source = await reviewQuote();
  const initial: PurchaseReceipt[] = [];
  for (const [i, q] of [84_400_000, 23_625_000, 7_875_000].entries())
    initial.push(await link(i, q));
  for (let index = 0; index < initial.length; index++) {
    const prior = initial[index]!;
    initial[index] = await repo.acceptDistributions(
      COST_SUBJECT,
      prior.positionId,
      {
        expectedSnapshotId: prior.snapshotId,
        expectedReceiptId: prior.id,
        distributionReview: DistributionReviewSchema.parse({
          method: "capital_return_first_v1",
          events: Array.from({ length: 100 }, (_, event) => ({
            id: `synthetic-distribution-${event}`,
            kind: "cash",
            receivedOn: "2025-06-01",
            investorValueMinor: event,
            sourceLabel: "Synthetic notice",
            sourceUrl: null,
            note: "",
          })),
          coverage: { status: "complete", throughDate: "2026-10-01" },
          priorCarry: { status: "known", amountMinor: 0 },
          provider: {
            inclusion: "none",
            sourceSnapshotId: prior.snapshotId,
            realizedValueMinor: 0,
          },
          sourceLabel: "Synthetic reviewed history",
          sourceUrl: null,
          note: "",
        }),
      },
    );
    expect(initial[index]!.details.valuation).toEqual(prior.details.valuation);
    expect(initial[index]!.details.lots).toEqual(prior.details.lots);
  }
  expect([value(0), value(1), value(2)]).toEqual([1_688_000, 472_500, 157_500]);
  expect(initial[0]!.details.valuation!.calculation?.estimatedShares).toBe(
    true,
  );
  expect(
    initial[0]!.details.valuation!.records.some((r) => r.id === "mine"),
  ).toBe(true);
  vi.setSystemTime(new Date(Date.now() + 1000));
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 2, false, {
    sharePrices: prices(250_000_000, "2026-09-12"),
  });
  await readPositions();
  expect([value(0), value(1), value(2)]).toEqual([2_110_000, 590_625, 196_875]);
  for (let i = 0; i < 3; i++) {
    expect(current(i)!.details.lots).toEqual(initial[i]!.details.lots);
    expect(current(i)!.details.distributionReview).toEqual(
      initial[i]!.details.distributionReview,
    );
    expect(current(i)!.details.valuation!.calculation!.quantityReceiptId).toBe(
      initial[i]!.details.valuation!.calculation!.quantityReceiptId,
    );
    expect(current(i)!.details.investmentTerms).toEqual(
      initial[i]!.details.investmentTerms,
    );
    expect(current(i)!.details.valuation!.calculation!.policy).toBe(
      "linked-price-proxy-v1",
    );
    expect(
      (await repo.history(COST_SUBJECT, positions[i]!.id)).entries,
    ).toHaveLength(5);
  }
  expect(current(3)).toEqual(source);
  expect(current(3)!.details.valuation!.records[0]).toMatchObject({
    totalMinor: 1_234_567,
    effectiveDate: "2026-09-01",
    priceDate: "2026-09-10",
  });
  const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
    COST_SUBJECT,
    "configuration_required",
  );
  expect(
    page.investmentHoldings.exposureView.positions.find(
      (p) => p.id === positions[0]!.id,
    )?.valueMinor,
  ).toBe(2_110_000);
  const summary = holdingValueSummary(
    page.holdings.find((p) => p.id === positions[0]!.id)!,
  );
  expect(summary.capital).toEqual({
    capitalBasisMinor: 900_000,
    investorDistributionsMinor: 4_950,
    capitalRemainingMinor: 895_050,
    historyReason: null,
  });
  expect(summary.after).toEqual({
    status: "available",
    method: "cumulative",
    carryMinor: 182_243,
    proceedsMinor: 1_927_757,
    alreadyAfterCarry: false,
  });
});

it.each([5, 10])(
  "normalizes a %i-for-1 split once, corrects provisional quantities once, and retains reconstructable receipts",
  async (factor) => {
    await setUpRepository();
    const splitPrice = Number(200_000_000n / BigInt(factor));
    await reviewQuote();
    const original = await link(0);
    await reviewQuote(splitPrice, "2026-09-15", factor);
    expect(value(0)).toBe(1_688_000);
    const split = current(0)!;
    expect(split.details.valuation!.calculation).toMatchObject({
      quantityMicros: Number(84_400_000n * BigInt(factor)),
      estimatedShares: true,
    });
    expect(
      split.details.valuation!.records.find((r) => r.followSource)?.shareBasis,
    ).toEqual({ ...basis, unitsPerOriginal: factor });
    await new D1PriceProxyRepository(db.asD1()).refresh(COST_SUBJECT);
    expect(current(0)!.id).toBe(split.id);
    await reviewQuote(splitPrice, "2026-09-15", factor);
    expect(current(0)!.id).toBe(split.id);
    const corrected = structuredClone(split.details);
    corrected.lots[0]!.remainingSharesMicros = Number(
      85_000_000n * BigInt(factor),
    );
    corrected.lots[0]!.quantityDetails = {
      ...corrected.lots[0]!.quantityDetails!,
      status: "confirmed",
      derivation: "Synthetic final administrator allocation",
      shareBasis: { ...basis, unitsPerOriginal: factor },
    };
    await repo.accept(COST_SUBJECT, positions[0]!.id, {
      expectedSnapshotId: positions[0]!.snapshotId,
      expectedReceiptId: split.id,
      details: corrected,
    });
    expect(value(0)).toBe(1_700_000);
    expect(current(0)!.details.valuation!.calculation?.estimatedShares).toBe(
      false,
    );
    expect(current(0)!.details.lots[0]!.quantityDetails?.shareBasis).toEqual({
      ...basis,
      unitsPerOriginal: factor,
    });
    const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
      COST_SUBJECT,
      "configuration_required",
    );
    const reloaded = page.holdings.find((p) => p.id === positions[0]!.id)!;
    expect(
      reloaded.purchaseContext?.receipt?.details.lots[0]?.quantityDetails
        ?.shareBasis,
    ).toEqual({ ...basis, unitsPerOriginal: factor });
    expect(holdingValueSummary(reloaded).record?.valueMinor).toBe(1_700_000);
    expect(
      selectedPositionValuation(original, original.snapshotId)?.valueMinor,
    ).toBe(1_688_000);
    expect(current(0)!.details.lots).toHaveLength(1);
    await expect(
      repo.accept(COST_SUBJECT, positions[0]!.id, {
        expectedSnapshotId: positions[0]!.snapshotId,
        expectedReceiptId: split.id,
        details: corrected,
      }),
    ).rejects.toMatchObject({ code: "stale" });
  },
);

it("follows a newer undated GP price using recorded metadata assumptions, rejects older or incompatible prices and isolates household access", async () => {
  await setUpRepository();
  await reviewQuote();
  await link(0);
  const initial = current(0)!;
  vi.setSystemTime(new Date(Date.now() + 1000));
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 2, false, {
    sharePrices: prices(180_000_000, "2026-09-02"),
  });
  await readPositions();
  expect(current(0)!.id).toBe(initial.id);
  expect(value(0)).toBe(1_688_000);
  vi.setSystemTime(new Date(Date.now() + 1000));
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 3, false, {
    sharePrices: {
      ...prices(300_000_000, null),
      shareClass: null,
      shareBasis: null,
    },
  });
  await readPositions();
  expect(value(0)).toBe(2_532_000);
  const refreshed = current(0)!;
  const record = refreshed.details.valuation!.records.find(
    (r) => r.followSource,
  )!;
  expect(record).toMatchObject({
    priceMicros: 300_000_000,
    priceDate: null,
    shareClass: null,
    shareBasis: null,
    sourceContinuation: {
      policy: "accepted-source-continuation-v1",
      quoteId: initial.details.valuation!.calculation!.quoteId,
      shareClass: "Common",
      shareBasis: basis,
    },
  });
  expect(
    selectedPositionValuation(refreshed, positions[0]!.snapshotId)
      ?.effectiveDate,
  ).toBeNull();
  expect(refreshed.details.lots).toEqual(initial.details.lots);
  const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
    COST_SUBJECT,
    "configuration_required",
  );
  expect(
    page.holdings.find((p) => p.id === positions[0]!.id)?.purchaseContext
      ?.priceProxyStatus?.stale,
  ).toBe(false);
  expect(
    (await repo.valuationEvidence(COST_SUBJECT, positions[0]!.id)).prices.find(
      (p) => p.positionId === positions[3]!.id,
    ),
  ).toMatchObject({
    markMicros: 300_000_000,
    markDate: null,
    shareClass: null,
    shareBasis: null,
  });
  // Native receipt validation rejects invented continuation metadata.
  const forged = structuredClone(refreshed);
  forged.id = crypto.randomUUID();
  forged.details.valuation!.records.find(
    (r) => r.followSource,
  )!.sourceContinuation!.shareBasis.unitsPerOriginal = 10;
  expect(() =>
    db.sqlite
      .prepare(
        `INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,'hh_demo',?,?,?,?,'usr_demo',?)`,
      )
      .run(
        forged.id,
        forged.positionId,
        forged.snapshotId,
        refreshed.id,
        JSON.stringify(forged),
        forged.acceptedAt,
      ),
  ).toThrow("price continuation provenance mismatch");
  vi.setSystemTime(new Date(Date.now() + 1000));
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 4, false, {
    sharePrices: {
      ...prices(350_000_000, null),
      shareBasis: { key: "different-security", unitsPerOriginal: 1 },
    },
  });
  expect(current(0)!.id).toBe(refreshed.id);
  expect(value(0)).toBe(2_532_000);
  // A later review can refer to evidence captured before the portal snapshot.
  // Its newer acceptance must win over that previously accepted observation.
  await readPositions();
  vi.setSystemTime(new Date(Date.now() + 1000));
  await repo.acceptValuation(COST_SUBJECT, positions[3]!.id, {
    expectedSnapshotId: positions[3]!.snapshotId,
    expectedReceiptId: current(3)!.id,
    method: "total",
    record: {
      ...gp(220_000_000, "2026-09-12"),
      sourceCapturedAt: "2026-09-01T00:00:00.000Z",
    },
  });
  expect(value(0)).toBe(1_856_800);
  const corrected = await new D1HoldingsPageRepository(db.asD1()).getPage(
    COST_SUBJECT,
    "configuration_required",
  );
  expect(
    corrected.holdings.find((p) => p.id === positions[0]!.id)!.purchaseContext!
      .priceProxyStatus!.stale,
  ).toBe(false);
  expect(
    current(0)!.details.valuation!.records.find((r) => r.followSource),
  ).toMatchObject({
    priceMicros: 220_000_000,
    priceDate: "2026-09-12",
    shareClass: "Common",
    shareBasis: basis,
  });
  expect(
    await new D1PriceProxyRepository(db.asD1()).refresh(COST_SUBJECT),
  ).toEqual({ recalculated: 0 });
  vi.setSystemTime(new Date(Date.now() + 1000));
  await repo.acceptValuation(COST_SUBJECT, positions[3]!.id, {
    expectedSnapshotId: positions[3]!.snapshotId,
    expectedReceiptId: current(3)!.id,
    method: "total",
    record: { ...gp(350_000_000), priceDate: null },
  });
  expect(value(0)).toBe(2_954_000);
  expect(
    current(0)!.details.valuation!.records.find((r) => r.followSource)!
      .priceDate,
  ).toBeNull();
  expect(
    (await repo.valuationEvidence("foreign", positions[0]!.id)).prices,
  ).toEqual([]);
  expect(
    await new D1PriceProxyRepository(db.asD1()).refresh("foreign"),
  ).toEqual({ recalculated: 0 });
});

it("retains an undated reviewed split through partial and missing source metadata without applying it twice", async () => {
  await setUpRepository();
  await reviewQuote();
  await link(0);
  await link(1);
  const original = current(0)!;
  const postSplit = current(1)!;
  const correctedQuantity = structuredClone(postSplit.details);
  correctedQuantity.lots[0]!.remainingSharesMicros = 844_000_000;
  correctedQuantity.lots[0]!.quantityDetails!.shareBasis.unitsPerOriginal = 10;
  await repo.accept(COST_SUBJECT, positions[1]!.id, {
    expectedSnapshotId: positions[1]!.snapshotId,
    expectedReceiptId: postSplit.id,
    details: correctedQuantity,
  });
  vi.setSystemTime(new Date(Date.now() + 1000));
  await repo.acceptValuation(COST_SUBJECT, positions[3]!.id, {
    expectedSnapshotId: positions[3]!.snapshotId,
    expectedReceiptId: current(3)!.id,
    method: "total",
    record: { ...gp(20_000_000, "2026-09-10", 10), priceDate: null },
  });
  const splitQuoteId = current(0)!.details.valuation!.calculation!.quoteId;
  expect(value(0)).toBe(1_688_000);
  expect(value(1)).toBe(1_688_000);
  // Editing investment facts can preserve an already accepted quote verbatim;
  // its older, now-unused assumptions remain reconstructable until refresh.
  const splitReceipt = current(0)!;
  await repo.accept(COST_SUBJECT, positions[0]!.id, {
    expectedSnapshotId: positions[0]!.snapshotId,
    expectedReceiptId: splitReceipt.id,
    details: { ...splitReceipt.details, cashCoversPosition: false },
  });
  expect(current(0)!.id).not.toBe(splitReceipt.id);
  for (const revision of [2, 3, 4, 5, 6]) {
    vi.setSystemTime(new Date(Date.now() + 1000));
    await seedCostHoldings(db.asD1(), COST_SUBJECT, revision, false, {
      sharePrices: {
        ...prices(20_000_000 + revision * 1_000_000, null, 10),
        shareClass: revision === 5 ? "Class A" : null,
        // A split-only observation and a later metadata-free observation must
        // each retain the newest evidenced basis, not the old dated anchor.
        shareBasis: revision === 3 ? { ...basis, unitsPerOriginal: 10 } : null,
      },
    });
    expect(value(0)).toBe(1_688_000 + revision * 84_400);
    expect(value(1)).toBe(value(0));
    expect(current(0)!.details.lots).toEqual(original.details.lots);
    const record = current(0)!.details.valuation!.records.find(
      (r) => r.followSource,
    )!;
    expect(record.priceDate).toBeNull();
    expect(record.sourceContinuation?.shareBasis.unitsPerOriginal).toBe(10);
    if (revision <= 4)
      expect(record.sourceContinuation?.quoteId).toBe(splitQuoteId);
    if (revision === 4)
      expect(record.sourceContinuation?.shareBasisQuoteId).toBeDefined();
    if (revision === 6)
      expect(record.sourceContinuation?.shareClass).toBe("Class A");
    const receiptId = current(0)!.id;
    expect(
      await new D1PriceProxyRepository(db.asD1()).refresh(COST_SUBJECT),
    ).toEqual({ recalculated: 0 });
    expect(current(0)!.id).toBe(receiptId);
  }
  const latest = current(0)!;
  const forged = structuredClone(latest);
  forged.id = crypto.randomUUID();
  forged.details.valuation!.records.find(
    (r) => r.followSource,
  )!.sourceContinuation!.shareBasis.unitsPerOriginal = 1;
  expect(() =>
    db.sqlite
      .prepare(
        `INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,'hh_demo',?,?,?,?,'usr_demo',?)`,
      )
      .run(
        forged.id,
        forged.positionId,
        forged.snapshotId,
        latest.id,
        JSON.stringify(forged),
        forged.acceptedAt,
      ),
  ).toThrow("price continuation provenance mismatch");
});

it("recovers a missed source split after a later incomplete capture and reselects only a previously accepted proxy", async () => {
  await setUpRepository();
  await reviewQuote();
  await link(0);
  await link(1);
  const original = current(0)!;
  const previousProxy = current(1)!.details.valuation!.records.find(
    (r) => r.followSource,
  )!;
  await repo.acceptValuation(COST_SUBJECT, positions[1]!.id, {
    expectedSnapshotId: positions[1]!.snapshotId,
    expectedReceiptId: current(1)!.id,
    method: "total",
    record: { ...gp(), priceMicros: null, priceDate: null },
  });
  vi.setSystemTime(new Date(Date.now() + 1000));
  const interrupted = vi
    .spyOn(D1PriceProxyRepository.prototype, "refresh")
    .mockRejectedValueOnce(new Error("synthetic interrupted propagation"));
  try {
    await expect(
      repo.acceptValuation(COST_SUBJECT, positions[3]!.id, {
        expectedSnapshotId: positions[3]!.snapshotId,
        expectedReceiptId: current(3)!.id,
        method: "total",
        record: { ...gp(20_000_000, "2026-09-10", 10), priceDate: null },
      }),
    ).rejects.toThrow("synthetic interrupted propagation");
  } finally {
    interrupted.mockRestore();
  }
  expect(current(0)!.id).toBe(original.id);
  vi.setSystemTime(new Date(Date.now() + 1000));
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 2, false, {
    sharePrices: {
      ...prices(22_000_000, null),
      shareClass: null,
      shareBasis: null,
    },
  });
  expect(value(0)).toBe(1_856_800);
  await readPositions();
  const price = (
    await repo.valuationEvidence(COST_SUBJECT, positions[1]!.id)
  ).prices.find((p) => p.positionId === positions[3]!.id)!;
  expect(price).toMatchObject({
    markDate: null,
    shareClass: null,
    shareBasis: null,
    sourceMetadata: {
      shareClass: "Common",
      shareBasis: { ...basis, unitsPerOriginal: 10 },
    },
  });
  const record: ValuationRecord = {
    ...previousProxy,
    priceMicros: price.markMicros,
    priceDate: price.markDate,
    shareClass: price.shareClass,
    shareBasis: price.shareBasis,
    sourceEvidenceId: price.id,
    sourceCapturedAt: price.capturedAt,
  };
  record.sourceContinuation = continuedPriceMetadata(
    previousProxy,
    record,
    price.sourceMetadata ?? undefined,
  );
  await repo.acceptValuation(COST_SUBJECT, positions[1]!.id, {
    expectedSnapshotId: positions[1]!.snapshotId,
    expectedReceiptId: current(1)!.id,
    method: "shares",
    record,
  });
  expect(value(1)).toBe(1_856_800);
  expect(
    continuedPriceMetadata(
      undefined,
      record,
      price.sourceMetadata ?? undefined,
    ),
  ).toBeUndefined();
  await expect(
    repo.acceptValuation(COST_SUBJECT, positions[2]!.id, {
      expectedSnapshotId: positions[2]!.snapshotId,
      expectedReceiptId: null,
      method: "shares",
      record: { ...record, sourceContinuation: undefined },
    }),
  ).rejects.toMatchObject({ code: "unsupported" });
  expect(
    db.sqlite
      .prepare("SELECT 1 FROM holding_price_proxy_links WHERE position_id=?")
      .get(positions[2]!.id),
  ).toBeUndefined();
});

it("repairs a legacy proxy after metadata backfill even when its price quote is unchanged and exposes pending recovery", async () => {
  await setUpRepository();
  await reviewQuote();
  await link(0);
  const original = current(0)!;
  const refresh = vi
    .spyOn(D1PriceProxyRepository.prototype, "refresh")
    .mockResolvedValue({ recalculated: 0 });
  try {
    vi.setSystemTime(new Date(Date.now() + 1000));
    await repo.acceptValuation(COST_SUBJECT, positions[3]!.id, {
      expectedSnapshotId: positions[3]!.snapshotId,
      expectedReceiptId: current(3)!.id,
      method: "total",
      record: { ...gp(20_000_000, "2026-09-10", 10), priceDate: null },
    });
    vi.setSystemTime(new Date(Date.now() + 1000));
    await seedCostHoldings(db.asD1(), COST_SUBJECT, 2, false, {
      sharePrices: {
        ...prices(22_000_000, null),
        shareClass: null,
        shareBasis: null,
      },
    });
  } finally {
    refresh.mockRestore();
  }
  await readPositions();
  const price = (
    await repo.valuationEvidence(COST_SUBJECT, positions[0]!.id)
  ).prices.find((p) => p.positionId === positions[3]!.id)!;
  const legacy = structuredClone(original);
  legacy.id = crypto.randomUUID();
  legacy.acceptedAt = new Date().toISOString();
  legacy.snapshotId = positions[0]!.snapshotId;
  legacy.details.investmentSnapshotId = original.snapshotId;
  legacy.details.valuation!.snapshotId = legacy.snapshotId;
  const record = legacy.details.valuation!.records.find((r) => r.followSource)!;
  record.sourceContinuation = {
    policy: "accepted-source-continuation-v1",
    quoteId: record.sourceEvidenceId!,
    shareClass: "Common",
    shareBasis: basis,
  };
  Object.assign(record, {
    priceMicros: price.markMicros,
    priceDate: null,
    shareClass: null,
    shareBasis: null,
    sourceEvidenceId: price.id,
    sourceCapturedAt: price.capturedAt,
  });
  Object.assign(legacy.details.valuation!.calculation!, {
    quoteId: price.id,
    valueMinor: 185_680,
  });
  // Reproduce the old policy's immutable receipt; no accepted row is rewritten.
  const old = readFileSync(
    "packages/database/migrations/0093_gp_reported_total_refresh.sql",
    "utf8",
  );
  db.sqlite.exec("DROP TRIGGER holding_price_continuation_guard");
  db.sqlite.exec(
    old.slice(old.indexOf("CREATE TRIGGER holding_price_continuation_guard")),
  );
  db.sqlite
    .prepare(
      `INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,'hh_demo',?,?,?,?,'usr_demo',?)`,
    )
    .run(
      legacy.id,
      legacy.positionId,
      legacy.snapshotId,
      original.id,
      JSON.stringify(legacy),
      new Date().toISOString(),
    );
  replayMetadataMigration();
  const page = () =>
    new D1HoldingsPageRepository(db.asD1()).getPage(
      COST_SUBJECT,
      "configuration_required",
    );
  expect(
    (await page()).holdings.find((p) => p.id === positions[0]!.id)!
      .purchaseContext!.priceProxyStatus!.stale,
  ).toBe(true);
  expect(value(0)).toBe(185_680);
  expect(
    await new D1PriceProxyRepository(db.asD1()).refresh(COST_SUBJECT),
  ).toEqual({ recalculated: 1 });
  expect(value(0)).toBe(1_856_800);
  expect(current(0)!.details.valuation!.calculation!.quoteId).toBe(price.id);
  expect(
    (await page()).holdings.find((p) => p.id === positions[0]!.id)!
      .purchaseContext!.priceProxyStatus!.stale,
  ).toBe(false);
  expect(
    await new D1PriceProxyRepository(db.asD1()).refresh(COST_SUBJECT),
  ).toEqual({ recalculated: 0 });
  expect(
    JSON.parse(
      String(
        db.sqlite
          .prepare(
            "SELECT receipt_json FROM holding_purchase_reviews WHERE id=?",
          )
          .get(legacy.id)!.receipt_json,
      ),
    ),
  ).toEqual(legacy);
});

it("preserves established source heads across tied acceptances and excludes initial future metadata during backfill", async () => {
  await setUpRepository(true);
  const insert = (
    index: number,
    id: string,
    date: string,
    observed: string,
    units: number,
  ) =>
    db.sqlite
      .prepare(
        `INSERT INTO holding_price_quotes(id,household_id,source_position_id,import_row_id,review_id,price_micros,price_date,share_class,basis_json,source_label,source_url,observed_at,accepted_at,decision_policy)
    SELECT ?,'hh_demo',source_position_id,import_row_id,NULL,20_000_000,?,'Common',?,'Synthetic source',NULL,?,'2026-10-01T12:00:01.000Z','accepted-import-price-v1' FROM holding_price_quotes WHERE source_position_id=? LIMIT 1`,
      )
      .run(
        id,
        date,
        JSON.stringify({ ...basis, unitsPerOriginal: units }),
        observed,
        positions[index]!.id,
      );
  insert(3, "synthetic-b", "2026-09-01", "2026-10-01T12:00:01.000Z", 10);
  insert(3, "synthetic-a", "2026-09-01", "2026-10-01T12:00:02.000Z", 1);
  insert(0, "synthetic-future", "2027-01-01", "2026-10-01T12:00:03.000Z", 999);
  expect(
    db.sqlite
      .prepare(
        "SELECT quote_id FROM holding_price_current_quotes WHERE source_position_id=?",
      )
      .get(positions[3]!.id)!.quote_id,
  ).toBe("synthetic-b");
  expect(
    db.sqlite
      .prepare(
        "SELECT 1 FROM holding_price_metadata_heads WHERE source_position_id=?",
      )
      .get(positions[0]!.id),
  ).toBeUndefined();
  replayMetadataMigration();
  expect(
    db.sqlite
      .prepare(
        "SELECT share_class_quote_id,share_basis_quote_id FROM holding_price_metadata_heads WHERE source_position_id=?",
      )
      .get(positions[3]!.id),
  ).toMatchObject({
    share_class_quote_id: "synthetic-b",
    share_basis_quote_id: "synthetic-b",
  });
  expect(
    db.sqlite
      .prepare(
        "SELECT 1 FROM holding_price_metadata_heads WHERE source_position_id=?",
      )
      .get(positions[0]!.id),
  ).toBeUndefined();
});

it("explains distinct missing input and compatibility failures", () => {
  const record = gp();
  const details = { coversPosition: false, lots: [] };
  expect(
    assessValuationFromShares(details, { ...record, priceDate: null }),
  ).toMatchObject({ code: "missing_price_date" });
  expect(assessValuationFromShares(details, record)).toMatchObject({
    code: "missing_quantity",
  });
  const lot = PurchaseLotSchema.parse({
    id: "synthetic-validation",
    purchasedOn: "2025-01-01",
    shareClass: "Common",
    priceMicros: null,
    referencePriceMicros: null,
    grossCashMinor: null,
    netCapitalMinor: null,
    feePpm: null,
    feeBasis: null,
    feeLabel: null,
    remainingSharesMicros: 10_000_000,
    sharesAsOf: "2026-09-01",
    sourceLabel: null,
    sourceUrl: null,
    mark: null,
    quantityDetails: {
      status: "estimated",
      derivation: "Synthetic estimate",
      evidence: null,
      shareBasis: basis,
    },
  });
  const covered = { coversPosition: true, lots: [lot] };
  expect(
    assessValuationFromShares({ ...covered, coversPosition: false }, record),
  ).toMatchObject({ code: "incomplete_coverage" });
  expect(
    assessValuationFromShares(
      { ...covered, lots: [{ ...lot, sharesAsOf: null }] },
      record,
    ),
  ).toMatchObject({ code: "missing_quantity_date" });
  expect(
    assessValuationFromShares(covered, {
      ...record,
      shareBasis: { key: "different-issuer", unitsPerOriginal: 1 },
    }),
  ).toMatchObject({ code: "incompatible_basis" });
  expect(
    assessValuationFromShares(covered, {
      ...record,
      shareClass: "Preferred",
      origin: "proxy",
      followSource: true,
    }),
  ).toMatchObject({ code: "cross_class" });
});

it("keeps refresh queries independent of receipt and quote history", async () => {
  await setUpRepository();
  await reviewQuote();
  await link(0);
  const start = db.statements.length;
  await new D1PriceProxyRepository(db.asD1()).refresh(COST_SUBJECT);
  const query = db.statements[start]!;
  const plan = db.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
    .all(COST_SUBJECT) as { detail: string }[];
  expect(
    plan.filter((row) =>
      /SCAN (?:review|q|head|link|application_head)\b/u.test(row.detail),
    ),
  ).toEqual([]);
  expect(plan.some((row) => /SEARCH link USING INDEX/u.test(row.detail))).toBe(
    true,
  );
});

it("backfills previously reviewed dates from the append-only ledger without changing balances", async () => {
  await setUpRepository();
  const reviewed = await reviewQuote();
  // Rebuild the new projections over an existing ledger, as the forward
  // migration does. No receipt is edited or replaced during the backfill.
  db.sqlite.exec(`
    DROP TRIGGER holding_import_application_head;
    DROP TRIGGER holding_import_accepted_price;
    DROP TRIGGER holding_import_late_price;
    DROP TRIGGER holding_review_accepted_price;
    DROP TRIGGER holding_price_proxy_link;
    DROP TRIGGER holding_review_price_source_guard;
    DROP TABLE holding_price_proxy_links;
    DROP TABLE holding_price_metadata_heads;
    DROP TABLE holding_price_source_heads;
    DROP TABLE holding_price_quotes;
    DROP TABLE holding_import_application_heads;
  `);
  db.sqlite.exec(
    readFileSync(
      "packages/database/migrations/0086_live_price_proxies.sql",
      "utf8",
    ),
  );
  db.sqlite.exec(
    readFileSync(
      "packages/database/migrations/0097_price_metadata_continuation.sql",
      "utf8",
    ),
  );
  expect(current(3)).toEqual(reviewed);
  expect(
    (await repo.valuationEvidence(COST_SUBJECT, positions[0]!.id)).prices.find(
      (p) => p.positionId === positions[3]!.id,
    ),
  ).toMatchObject({ markMicros: 200_000_000, markDate: "2026-09-10" });
  await link(0);
  expect(value(0)).toBe(1_688_000);
});

it("projects the complete latest application order when both timestamps tie", async () => {
  await setUpRepository();
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 2, false, {
    sharePrices: prices(210_000_000, "2026-09-11"),
  });
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 3, false, {
    sharePrices: prices(220_000_000, "2026-09-12"),
  });
  const mismatches = db.sqlite
    .prepare(
      `SELECT COUNT(*) n FROM holding_import_application_heads h
    WHERE h.application_id IS NOT (SELECT a.id FROM holding_import_applications a
      JOIN holding_position_snapshots s ON s.id=a.snapshot_id WHERE a.position_id=h.position_id
      ORDER BY a.applied_at DESC,s.observed_at DESC,a.id DESC LIMIT 1)`,
    )
    .get()!;
  expect(mismatches.n).toBe(0);
});

it("preserves distributions across valuation saves and preserves quantity provenance across unrelated investment edits", async () => {
  await setUpRepository();
  await reviewQuote();
  const linked = await link(0);
  const distributions = await repo.acceptDistributions(
    COST_SUBJECT,
    linked.positionId,
    {
      expectedSnapshotId: linked.snapshotId,
      expectedReceiptId: linked.id,
      distributionReview: {
        method: "capital_return_first_v1",
        events: [],
        coverage: { status: "complete", throughDate: "2026-10-01" },
        priorCarry: { status: "known", amountMinor: 0 },
        provider: {
          inclusion: "none",
          sourceSnapshotId: linked.snapshotId,
          realizedValueMinor: 0,
        },
        sourceLabel: "Synthetic reviewed empty history",
        sourceUrl: null,
        note: "",
      },
    },
  );
  const investment = await repo.accept(COST_SUBJECT, linked.positionId, {
    expectedSnapshotId: linked.snapshotId,
    expectedReceiptId: distributions.id,
    details: {
      ...distributions.details,
      investmentTerms: {
        ...distributions.details.investmentTerms!,
        note: "Synthetic metadata correction",
      },
    },
  });
  expect(investment.details.distributionReview).toEqual(
    distributions.details.distributionReview,
  );
  expect(investment.details.valuation?.calculation?.quantityReceiptId).toBe(
    linked.details.valuation?.calculation?.quantityReceiptId,
  );
  const valuation = await repo.acceptValuation(
    COST_SUBJECT,
    linked.positionId,
    {
      expectedSnapshotId: linked.snapshotId,
      expectedReceiptId: investment.id,
      record: {
        ...gp(),
        id: "mine",
        origin: "judgment",
        sourceLabel: "Synthetic manual estimate",
      },
      method: "total",
    },
  );
  expect(valuation.details.distributionReview).toEqual(
    distributions.details.distributionReview,
  );
});
