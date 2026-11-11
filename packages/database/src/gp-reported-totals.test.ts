import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  legalDocumentTestDatabase,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import {
  seedPositionLinks,
  LINK_DEMO_SUBJECT,
  LINK_DEMO_CASES,
} from "../../../scripts/seed-position-links";
import { D1PositionLinkRepository } from "./position-links";
import { D1PositionPurchaseRepository } from "./position-purchases";
import { D1GpReportedTotalRepository } from "./gp-reported-totals";
import { D1HoldingsPageRepository } from "./holdings-page";
import {
  PurchaseReceiptSchema,
  PurchaseLotSchema,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";
import type { ValuationRecord } from "@keel/domain/valuation-record";
import type { PositionLinkWorkspace } from "@keel/domain/position-links";
import { holdingValueSummary } from "../../../apps/web/src/holding-value";

let db: LegalDocumentTestD1, purchases: D1PositionPurchaseRepository;
let target: PositionLinkWorkspace["positions"][number], sourceId: string;
const page = () =>
  new D1HoldingsPageRepository(db.asD1()).getPage(
    LINK_DEMO_SUBJECT,
    "available",
  );
const current = () =>
  PurchaseReceiptSchema.parse(
    JSON.parse(
      String(
        db.sqlite
          .prepare(
            "SELECT receipt_json FROM holding_purchase_reviews r JOIN holding_purchase_heads h ON h.review_id=r.id WHERE h.position_id=?",
          )
          .get(target.id)!.receipt_json,
      ),
    ),
  );
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-20T13:00:00.000Z"));
  db = legalDocumentTestDatabase();
  await seedPositionLinks(db.asD1());
  const links = new D1PositionLinkRepository(db.asD1());
  const workspace = await links.workspace(LINK_DEMO_SUBJECT);
  target = workspace.positions.find(
    (p) => p.legalVehicleName === "Demo Atlas II SPV",
  )!;
  const source = workspace.positions.find(
    (p) => p.legalVehicleName === "Demo Atlas AI source",
  )!;
  sourceId = source.id;
  await links.accept(LINK_DEMO_SUBJECT, {
    sourcePositionId: source.id,
    targetPositionId: target.id,
    expectedSourceSnapshotId: source.snapshot.id,
    expectedTargetSnapshotId: target.snapshot.id,
    expectedSourceParticipationReviewId: source.investmentReview?.id ?? null,
    expectedTargetParticipationReviewId: target.investmentReview?.id ?? null,
    expectedReviewId: null,
    relationship: "same_investment",
    state: "linked",
    useSourceValue: true,
    note: "",
  });
  purchases = new D1PositionPurchaseRepository(db.asD1());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  db.sqlite.close();
});
async function select(
  origin: ValuationRecord["origin"] = "gp",
  method: "total" | "shares" = "total",
) {
  vi.setSystemTime(new Date("2026-09-20T13:01:00.000Z"));
  const investment = await purchases.accept(LINK_DEMO_SUBJECT, target.id, {
    expectedSnapshotId: target.snapshot.id,
    expectedReceiptId: null,
    details: {
      cashCoversPosition: true,
      coversPosition: true,
      investmentTerms: {
        ...unknownInvestmentTerms(),
        carryPpm: 150_000,
        carryBasis: "net_capital",
      },
      lots: [
        PurchaseLotSchema.parse({
          id: "synthetic-purchase",
          purchasedOn: "2025-03-12",
          shareClass: "Common",
          priceMicros: 100_000_000,
          referencePriceMicros: null,
          grossCashMinor: 1_200_000,
          netCapitalMinor: 1_090_000,
          upfrontDeductionsMinor: 100_000,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: 100_000_000,
          sharesAsOf: "2026-09-01",
          sourceLabel: "Synthetic agreement",
          sourceUrl: null,
          mark: null,
          capitalReturn: {
            amountMinor: 10_000,
            status: "received",
            effectiveDate: null,
            reportedDistributions: "excluded",
          },
        }),
      ],
    },
  });
  return purchases.acceptValuation(LINK_DEMO_SUBJECT, target.id, {
    expectedSnapshotId: target.snapshot.id,
    expectedReceiptId: investment.id,
    method,
    record: {
      id: origin === "gp" ? "gp" : "mine",
      origin,
      totalMinor: 4_200_000,
      priceMicros: 200_000_000,
      effectiveDate: "2026-09-19",
      priceDate: "2026-09-10",
      shareClass: "Common",
      carryStatus: "before_carry",
      sourceLabel: "Synthetic GP report",
      sourceUrl: null,
      sourceEvidenceId: null,
      sourcePositionId: null,
      sourceCapturedAt: null,
      watchEvidenceId: null,
    },
  });
}
async function sync(revision = 2) {
  vi.setSystemTime(new Date(`2026-09-20T13:0${revision}:00.000Z`));
  await seedPositionLinks(db.asD1(), revision);
}
it("refreshes a selected GP total on a linked source sync without changing investment inputs, price dates or history", async () => {
  const prior = await select();
  await sync();
  const saved = current();
  expect(saved.id).not.toBe(prior.id);
  expect(saved.details.lots).toEqual(prior.details.lots);
  expect(saved.details.investmentTerms).toEqual(prior.details.investmentTerms);
  expect(saved.details.investmentSnapshotId).toBe(
    prior.details.investmentSnapshotId,
  );
  expect(saved.details.valuation).toMatchObject({
    selected: prior.details.valuation!.selected,
    reportedTotalRefresh: {
      policy: "accepted-gp-total-v1",
      priorReceiptId: prior.id,
      sourcePositionId: sourceId,
    },
    records: [
      {
        totalMinor: 4_300_000,
        effectiveDate: "2026-09-20",
        priceMicros: 200_000_000,
        priceDate: "2026-09-10",
        carryStatus: "unknown",
      },
    ],
  });
  const state = await page();
  expect(
    state.investmentHoldings.exposureView.positions.find(
      (p) => p.id === target.id,
    )?.valueMinor,
  ).toBe(4_300_000);
  expect(
    holdingValueSummary(state.holdings.find((h) => h.id === target.id)!).record,
  ).toMatchObject({ valueMinor: 4_300_000, carryStatus: "unknown" });
  expect(
    JSON.parse(
      String(
        db.sqlite
          .prepare(
            "SELECT receipt_json FROM holding_purchase_reviews WHERE id=?",
          )
          .get(prior.id)!.receipt_json,
      ),
    ),
  ).toEqual(prior);
  expect(
    await new D1GpReportedTotalRepository(db.asD1()).refresh(LINK_DEMO_SUBJECT),
  ).toEqual({ refreshed: 0 });
  expect(
    await new D1GpReportedTotalRepository(db.asD1()).refresh("foreign-subject"),
  ).toEqual({ refreshed: 0 });
});
it.each([
  ["judgment", "total"],
  ["gp", "shares"],
] as const)(
  "preserves an explicitly selected %s %s valuation",
  async (origin, method) => {
    const prior = await select(origin, method);
    await sync();
    expect(current()).toEqual(prior);
  },
);
it("recovers an interrupted propagation and lets a racing manual valuation win", async () => {
  const prior = await select();
  const skip = vi
    .spyOn(D1GpReportedTotalRepository.prototype, "refresh")
    .mockResolvedValue({ refreshed: 0 });
  await sync();
  skip.mockRestore();
  expect(current()).toEqual(prior);
  expect(
    await new D1GpReportedTotalRepository(db.asD1()).refresh(LINK_DEMO_SUBJECT),
  ).toEqual({ refreshed: 1 });
  const refreshed = current();
  const skipAgain = vi
    .spyOn(D1GpReportedTotalRepository.prototype, "refresh")
    .mockResolvedValue({ refreshed: 0 });
  await sync(3);
  skipAgain.mockRestore();
  const manual: PurchaseReceipt = structuredClone(refreshed);
  manual.id = crypto.randomUUID();
  manual.acceptedAt = new Date().toISOString();
  delete manual.details.valuation!.reportedTotalRefresh;
  manual.details.valuation!.records[0]!.origin = "judgment";
  manual.details.valuation!.records[0]!.totalMinor = 4_500_000;
  db.beforeBatch = () => {
    db.sqlite
      .prepare(
        "INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,'hh_demo',?,?,?,?, 'usr_demo',?)",
      )
      .run(
        manual.id,
        target.id,
        target.snapshot.id,
        refreshed.id,
        JSON.stringify(manual),
        manual.acceptedAt,
      );
  };
  expect(
    await new D1GpReportedTotalRepository(db.asD1()).refresh(LINK_DEMO_SUBJECT),
  ).toEqual({ refreshed: 0 });
  expect(current()).toEqual(manual);
});

it("rejects forged refresh provenance and changes to preserved investment inputs in native SQL", async () => {
  await select();
  const skip = vi
    .spyOn(D1GpReportedTotalRepository.prototype, "refresh")
    .mockResolvedValue({ refreshed: 0 });
  await sync();
  skip.mockRestore();
  const batch = db.batch.bind(db);
  vi.spyOn(db, "batch").mockImplementation((statements) => {
    const statement = statements.find((s) =>
      s.sql.includes(
        "SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM holding_purchase_heads",
      ),
    )!;
    for (const attack of [
      (r: PurchaseReceipt) => {
        r.details.valuation!.reportedTotalRefresh!.sourcePositionId = target.id;
      },
      (r: PurchaseReceipt) => {
        r.details.valuation!.reportedTotalRefresh!.sourceSnapshotId =
          target.snapshot.id;
      },
      (r: PurchaseReceipt) => {
        r.details.valuation!.records[0]!.totalMinor = 4_300_001;
      },
      (r: PurchaseReceipt) => {
        r.details.lots[0]!.netCapitalMinor = 1;
      },
      (r: PurchaseReceipt) => {
        r.details.valuation!.records[0]!.priceMicros = 200_000_001;
      },
    ]) {
      expect(typeof statement.values[5]).toBe("string");
      const forged = PurchaseReceiptSchema.parse(
        JSON.parse(statement.values[5] as string),
      );
      forged.id = crypto.randomUUID();
      attack(forged);
      const values = [...statement.values];
      values[0] = forged.id;
      values[5] = JSON.stringify(forged);
      expect(() => db.sqlite.prepare(statement.sql).run(...values)).toThrow(
        /GP total refresh/,
      );
    }
    return batch(statements);
  });
  expect(
    await new D1GpReportedTotalRepository(db.asD1()).refresh(LINK_DEMO_SUBJECT),
  ).toEqual({ refreshed: 1 });
  expect(current().details.valuation!.records[0]!.totalMinor).toBe(4_300_000);
});

it("retains the GP total for missing source values and reports observed before a newer GP review", async () => {
  const prior = await select();
  vi.setSystemTime(new Date("2026-09-20T13:02:00.000Z"));
  await seedPositionLinks(
    db.asD1(),
    2,
    false,
    LINK_DEMO_CASES.map((c) =>
      c.name === "Demo Atlas AI source" ? { ...c, value: null } : c,
    ),
  );
  expect(current()).toEqual(prior);
  vi.setSystemTime(new Date("2026-09-22T13:00:00.000Z"));
  const newer = await purchases.acceptValuation(LINK_DEMO_SUBJECT, target.id, {
    expectedSnapshotId: target.snapshot.id,
    expectedReceiptId: prior.id,
    method: "total",
    record: {
      ...prior.details.valuation!.records[0]!,
      effectiveDate: "2026-09-21",
    },
  });
  vi.setSystemTime(new Date("2026-09-23T13:00:00.000Z"));
  await seedPositionLinks(db.asD1(), 3);
  expect(current()).toEqual(newer);
});

it("refreshes legacy receipts without changing their accepted JSON serialization", async () => {
  const prior = await select();
  const reverseKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, entry]) => [key, reverseKeys(entry)]),
      );
    return value;
  };
  const legacy = { ...prior, id: crypto.randomUUID() };
  const serialized = JSON.stringify(reverseKeys(legacy));
  PurchaseReceiptSchema.parse(JSON.parse(serialized));
  db.sqlite
    .prepare(
      "INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,'hh_demo',?,?,?,?, 'usr_demo',?)",
    )
    .run(
      legacy.id,
      target.id,
      target.snapshot.id,
      prior.id,
      serialized,
      legacy.acceptedAt,
    );
  await sync();
  expect(current().details.valuation!.records[0]!.totalMinor).toBe(4_300_000);
  expect(current().details.lots).toEqual(legacy.details.lots);
});
