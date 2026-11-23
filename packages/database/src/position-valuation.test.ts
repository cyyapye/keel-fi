import { afterEach, beforeEach, expect, it } from "vitest";
import {
  legalDocumentTestDatabase,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import {
  seedCostHoldings,
  COST_SUBJECT,
} from "../../../scripts/test-support/cost-fixtures";
import { D1PositionPurchaseRepository } from "./position-purchases";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1HoldingsPageRepository } from "./holdings-page";
import {
  PurchaseLotSchema,
  selectedPositionValuation,
  netInvestedValuation,
  reviewedInvestmentFromReceipt,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";
import { ValuationRecordSchema } from "@keel/domain/valuation-record";
import { InvestmentFeeSchema } from "@keel/domain/investment-fees";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";
let db: LegalDocumentTestD1,
  repo: D1PositionPurchaseRepository,
  positionId: string,
  snapshotId: string;
beforeEach(async () => {
  db = legalDocumentTestDatabase();
  await seedCostHoldings(db.asD1());
  repo = new D1PositionPurchaseRepository(db.asD1());
  const position = (
    await new D1InvestmentPositionViewRepository(db.asD1()).list(COST_SUBJECT)
  ).connections.flatMap((c) => c.containers.flatMap((c) => c.positions))[0]!;
  positionId = position.id;
  snapshotId = position.snapshot.id;
});
afterEach(() => db.sqlite.close());
const record = () =>
  ValuationRecordSchema.parse({
    id: "gp",
    origin: "gp",
    totalMinor: 1_748_000,
    priceMicros: 200_000_000,
    effectiveDate: "2026-09-30",
    priceDate: "2026-09-15",
    shareClass: "Preferred",
    carryStatus: "before_carry",
    sourceLabel: "Synthetic GP",
    sourceUrl: null,
    sourceEvidenceId: null,
    sourcePositionId: null,
    sourceCapturedAt: null,
    watchEvidenceId: null,
  });
const fee = () =>
  InvestmentFeeSchema.parse({
    id: "setup",
    kind: "one_time",
    label: "One-time fee",
    method: "paid",
    paidMinor: 56_000,
    ratePpm: null,
    basis: "unknown",
    basisMinor: null,
    prepaidMonths: null,
  });
const details = () => ({
  investmentTerms: {
    ...unknownInvestmentTerms(),
    carryPpm: 150000,
    carryBasis: "gross_cash" as const,
  },
  cashCoversPosition: true,
  coversPosition: true,
  lots: [
    PurchaseLotSchema.parse({
      id: "a",
      purchasedOn: "2025-06-10",
      shareClass: "Preferred",
      priceMicros: 100_000_000,
      referencePriceMicros: null,
      grossCashMinor: 1_000_000,
      netCapitalMinor: null,
      upfrontDeductionsMinor: null,
      feePpm: null,
      feeBasis: null,
      feeLabel: null,
      remainingSharesMicros: 84_400_000,
      sharesAsOf: "2026-01-01",
      sourceLabel: "Synthetic subscription",
      sourceUrl: null,
      mark: null,
      feesComplete: true,
      fees: [fee()],
      capitalReturn: {
        amountMinor: 100_000,
        status: "received",
        effectiveDate: null,
        reportedDistributions: "excluded",
      },
    }),
  ],
});
const saveInvestment = (previous: PurchaseReceipt | null, d = details()) =>
  repo.accept(COST_SUBJECT, positionId, {
    expectedSnapshotId: snapshotId,
    expectedReceiptId: previous?.id ?? null,
    details: d,
  });
it("persists both valuation facts, projects the explicit choice and isolates edits with compare-and-swap", async () => {
  const first = await saveInvestment(null);
  expect(first.details.lots[0]).toMatchObject({
    netCapitalMinor: 844_000,
    upfrontDeductionsMinor: 56_000,
  });
  const selected = await repo.acceptValuation(COST_SUBJECT, positionId, {
    expectedSnapshotId: snapshotId,
    expectedReceiptId: first.id,
    record: record(),
    method: "shares",
  });
  const holdings = (
    await new D1HoldingsPageRepository(db.asD1()).getPage(
      COST_SUBJECT,
      "configuration_required",
    )
  ).holdings;
  const read = holdings.find((p) => p.id === positionId)!;
  expect(read.purchaseContext?.receipt?.details.valuation?.records[0]).toEqual(
    record(),
  );
  expect(
    selectedPositionValuation(read.purchaseContext!.receipt, snapshotId),
  ).toMatchObject({ valueMinor: 1_688_000, effectiveDate: "2026-09-15" });
  const edited = structuredClone(selected.details);
  edited.lots[0]!.purchasedOn = "2025-06-11";
  const metadata = await repo.accept(COST_SUBJECT, positionId, {
    expectedSnapshotId: snapshotId,
    expectedReceiptId: selected.id,
    details: edited,
  });
  expect(selectedPositionValuation(metadata, snapshotId)?.valueMinor).toBe(
    1_688_000,
  );
  expect(metadata.details.lots[0]!.netCapitalMinor).toBe(844_000);
  await expect(
    repo.acceptValuation(COST_SUBJECT, positionId, {
      expectedSnapshotId: snapshotId,
      expectedReceiptId: selected.id,
      record: record(),
      method: "total",
    }),
  ).rejects.toMatchObject({ code: "stale" });
  const changed = structuredClone(metadata.details);
  changed.lots[0]!.remainingSharesMicros = 80_000_000;
  const newShares = await repo.accept(COST_SUBJECT, positionId, {
    expectedSnapshotId: snapshotId,
    expectedReceiptId: metadata.id,
    details: changed,
  });
  expect(newShares.details.valuation!.selected).toBeNull();
  expect(newShares.details.valuation!.records[0]).toEqual(record());
});
it("accepts only the verified net cost and retains its evidence when a GP writes the holding down to zero", async () => {
  const first = await saveInvestment(null);
  const cost = netInvestedValuation(first, snapshotId)!;
  expect(cost.totalMinor).toBe(844_000);
  const input = {
    expectedSnapshotId: snapshotId,
    expectedReceiptId: first.id,
    method: "total" as const,
  };
  await expect(
    repo.acceptValuation(COST_SUBJECT, positionId, {
      ...input,
      record: { ...cost, totalMinor: 1_000_000 },
    }),
  ).rejects.toMatchObject({ code: "stale" });
  const accepted = await repo.acceptValuation(COST_SUBJECT, positionId, {
    ...input,
    record: cost,
  });
  expect(selectedPositionValuation(accepted, snapshotId)).toMatchObject({
    origin: "at_cost",
    valueMinor: 844_000,
  });
  const zero = await repo.acceptValuation(COST_SUBJECT, positionId, {
    ...input,
    expectedReceiptId: accepted.id,
    record: { ...record(), totalMinor: 0 },
  });
  expect(selectedPositionValuation(zero, snapshotId)).toMatchObject({
    origin: "gp",
    valueMinor: 0,
  });
  expect(zero.details.valuation?.records).toContainEqual(
    expect.objectContaining({ origin: "at_cost", totalMinor: 844_000 }),
  );
});

it("preserves GP carry classification while adopting an attributed estimate and refuses foreign evidence", async () => {
  const context = (
    await new D1HoldingsPageRepository(db.asD1()).getPage(
      COST_SUBJECT,
      "configuration_required",
    )
  ).holdings.find((h) => h.id === positionId)!.purchaseContext!;
  const d = details();
  d.investmentTerms.reportedValueReview = {
    sourceSnapshotId: snapshotId,
    valueMinor: context.reportedValueMinor!,
    effectiveDate: context.sourceObservedOn,
    carryStatus: "after_carry",
    sourceLabel: "Synthetic GP",
  } as never;
  const first = await saveInvestment(null, d);
  const mine = {
    ...record(),
    id: "mine",
    origin: "judgment" as const,
    sourceLabel: "My estimate",
  };
  const saved = await repo.acceptValuation(COST_SUBJECT, positionId, {
    expectedSnapshotId: snapshotId,
    expectedReceiptId: first.id,
    record: mine,
    method: "total",
  });
  expect(
    saved.details.valuation?.records.find((r) => r.id === "gp"),
  ).toMatchObject({
    carryStatus: "after_carry",
    totalMinor: context.reportedValueMinor,
  });
  await expect(
    repo.acceptValuation(COST_SUBJECT, positionId, {
      expectedSnapshotId: snapshotId,
      expectedReceiptId: saved.id,
      record: {
        ...record(),
        sourceEvidenceId: "foreign",
        sourcePositionId: "other",
        sourceCapturedAt: "2026-09-01T00:00:00Z",
      },
      method: "total",
    }),
  ).rejects.toMatchObject({ code: "stale" });
  await expect(
    repo.acceptValuation("foreign-user", positionId, {
      expectedSnapshotId: snapshotId,
      expectedReceiptId: null,
      record: mine,
      method: "total",
    }),
  ).rejects.toMatchObject({ code: "not_found" });
});
it("owns every shared charge once, excludes unpaid fees and rejects impossible estimates", async () => {
  const d = details();
  d.lots[0]!.fees!.push({
    ...fee(),
    id: "unpaid",
    paymentStatus: "unpaid",
    paidMinor: 10_000,
    dueDate: "2026-10-31",
    kind: "management",
  });
  const first = await saveInvestment(null, d);
  expect(first.details.lots[0]!.netCapitalMinor).toBe(844_000);
  const duplicate = structuredClone(first.details);
  duplicate.lots.push({ ...duplicate.lots[0]!, id: "b" });
  await expect(
    repo.accept(COST_SUBJECT, positionId, {
      expectedSnapshotId: snapshotId,
      expectedReceiptId: first.id,
      details: duplicate,
    }),
  ).rejects.toMatchObject({ code: "unsupported" });
  const excessive = details();
  excessive.lots[0]!.fees = [
    {
      ...fee(),
      method: "percentage",
      paidMinor: null,
      ratePpm: 1_000_000,
      basis: "cash",
    },
  ];
  await expect(saveInvestment(first, excessive)).rejects.toMatchObject({
    code: "unsupported",
  });
});
it("paginates 120 immutable revisions without per-row requests and isolates empty/foreign history", async () => {
  let previous: PurchaseReceipt | null = null;
  for (let i = 0; i < 121; i++) previous = await saveInvestment(previous);
  db.queries.length = 0;
  const first = await repo.history(COST_SUBJECT, positionId);
  expect(first.entries).toHaveLength(30);
  expect(first.next).not.toBeNull();
  for (const entry of first.entries) {
    expect(entry.kind).toBe("investment");
    if (entry.kind !== "investment") throw new Error("Unexpected link");
    expect(entry.previous?.id ?? null).toBe(
      db.sqlite
        .prepare("SELECT prior_id FROM holding_purchase_reviews WHERE id=?")
        .get(entry.receipt.id)!.prior_id,
    );
  }
  expect(db.queries).toHaveLength(1);
  const statement = db.statements.at(-1)!;
  const plan = db.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
    .all(...statement.values)
    .map((r) => String(r.detail))
    .join("\n");
  expect(plan).toContain("holding_purchase_reviews_position");
  expect(plan).toContain("holding_position_link_target_history");
  expect(plan).not.toMatch(/SCAN (r|prior)\b/u);
  let page = first;
  const ids = new Set(page.entries.map((r) => r.receipt.id));
  while (page.next) {
    page = await repo.history(COST_SUBJECT, positionId, page.next);
    for (const r of page.entries) {
      expect(ids.has(r.receipt.id)).toBe(false);
      ids.add(r.receipt.id);
    }
  }
  expect(ids.size).toBe(121);
  expect((await repo.history("foreign-user", positionId)).entries).toEqual([]);
  expect((await repo.history(COST_SUBJECT, "absent")).entries).toEqual([]);
});

it("keeps stale investment evidence inactive when a later source receives a new total", async () => {
  const first = await saveInvestment(null);
  const originalSnapshot = snapshotId;
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 2);
  const position = (
    await new D1InvestmentPositionViewRepository(db.asD1()).list(COST_SUBJECT)
  ).connections
    .flatMap((c) => c.containers.flatMap((c) => c.positions))
    .find((p) => p.id === positionId)!;
  snapshotId = position.snapshot.id;
  expect(snapshotId).not.toBe(originalSnapshot);
  await expect(
    repo.acceptValuation(COST_SUBJECT, positionId, {
      expectedSnapshotId: snapshotId,
      expectedReceiptId: first.id,
      record: record(),
      method: "shares",
    }),
  ).rejects.toMatchObject({ code: "unsupported" });
  const total = await repo.acceptValuation(COST_SUBJECT, positionId, {
    expectedSnapshotId: snapshotId,
    expectedReceiptId: first.id,
    record: record(),
    method: "total",
  });
  expect(total.snapshotId).toBe(snapshotId);
  expect(total.details.investmentSnapshotId).toBe(originalSnapshot);
  expect(reviewedInvestmentFromReceipt(total)?.snapshotId).toBe(
    originalSnapshot,
  );
  expect(selectedPositionValuation(total, snapshotId)?.valueMinor).toBe(
    1_748_000,
  );
  const reviewed = await repo.accept(COST_SUBJECT, positionId, {
    expectedSnapshotId: snapshotId,
    expectedReceiptId: total.id,
    details: total.details,
  });
  expect(reviewedInvestmentFromReceipt(reviewed)?.snapshotId).toBe(snapshotId);
});
it("settles a later fee without reducing share capital or omitting the cash payment", async () => {
  const d = details();
  d.lots[0]!.fees!.push({
    ...fee(),
    id: "later-management",
    kind: "management",
    paidMinor: 10_000,
    paymentStatus: "unpaid",
  });
  const due = await saveInvestment(null, d);
  expect(due.details.lots[0]!.fees![1]!.treatment).toBe("separate");
  const paidDetails = structuredClone(due.details);
  paidDetails.lots[0]!.fees![1]!.paymentStatus = "paid";
  const paid = await repo.accept(COST_SUBJECT, positionId, {
    expectedSnapshotId: snapshotId,
    expectedReceiptId: due.id,
    details: paidDetails,
  });
  expect(paid.details.lots[0]!.netCapitalMinor).toBe(844_000);
  expect(reviewedInvestmentFromReceipt(paid)).toMatchObject({
    cashPaidMinor: 1_010_000,
    additionalPaidFeesMinor: 10_000,
    upfrontDeductionsMinor: 56_000,
  });
});
