import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
import { type ValuationRecord } from "@keel/domain/valuation-record";

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
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
  db = legalDocumentTestDatabase();
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 1, false, {
    sharePrices: prices(200_000_000, null),
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
});
afterEach(() => {
  db.sqlite.close();
  vi.useRealTimers();
});
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

it("rejects older or incomplete source updates without reviving manual estimates and isolates household access", async () => {
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
    sharePrices: prices(300_000_000, null),
  });
  await readPositions();
  expect(value(0)).toBe(1_688_000);
  const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
    COST_SUBJECT,
    "configuration_required",
  );
  expect(
    page.holdings.find((p) => p.id === positions[0]!.id)?.purchaseContext
      ?.priceProxyStatus?.stale,
  ).toBe(true);
  expect(
    (await repo.valuationEvidence("foreign", positions[0]!.id)).prices,
  ).toEqual([]);
  expect(
    await new D1PriceProxyRepository(db.asD1()).refresh("foreign"),
  ).toEqual({ recalculated: 0 });
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
