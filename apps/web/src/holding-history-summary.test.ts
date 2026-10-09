import { expect, it } from "vitest";
import { PurchaseReceiptSchema } from "@keel/domain/position-purchases";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";
import { holdingHistorySummary } from "./holding-history-summary";
import { holdingHistoryChanges } from "./holding-history-changes";

const receipt = () =>
  PurchaseReceiptSchema.parse({
    id: "review-1",
    positionId: "synthetic",
    snapshotId: "snapshot",
    currency: "USD",
    acceptedAt: "2026-10-01T12:00:00Z",
    details: {
      cashCoversPosition: true,
      coversPosition: true,
      investmentTerms: unknownInvestmentTerms(),
      lots: [
        {
          id: "lot",
          purchasedOn: null,
          shareClass: "Common",
          priceMicros: 24_700_000,
          referencePriceMicros: null,
          grossCashMinor: 100_000,
          netCapitalMinor: null,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: 30_000_000,
          sharesAsOf: null,
          sourceLabel: "Synthetic subscription",
          sourceUrl: null,
          mark: null,
        },
      ],
    },
  });

it("identifies the changed amount rather than repeating the saved day", () => {
  const before = receipt(),
    after = receipt();
  after.details.lots[0]!.grossCashMinor = 120_000;
  expect(holdingHistorySummary(after, before)).toBe(
    "Investment · Cash paid $1,200.00",
  );
  expect(holdingHistorySummary(before, null)).not.toContain("removed");
});

it("shows only changed fields and preserves cleared values", () => {
  const before = receipt(),
    after = receipt();
  after.details.lots[0]!.grossCashMinor = 120_000;
  after.details.lots[0]!.shareClass = null;
  expect(holdingHistoryChanges(after, before)).toEqual([
    {
      key: "lot:lot:cash",
      label: "Cash paid",
      before: "$1,000.00",
      after: "$1,200.00",
    },
    {
      key: "lot:lot:class",
      label: "Share class",
      before: "Common",
      after: null,
    },
  ]);
  expect(holdingHistoryChanges(before, before)).toEqual([]);
  expect(holdingHistoryChanges(before, null).map((c) => c.label)).toContain(
    "Purchase price",
  );
});
it("isolates a fee rate change from unchanged cash and shares", () => {
  const before = receipt();
  before.details.lots[0]!.fees = [
    {
      id: "fee",
      label: "One-time fee",
      kind: "one_time",
      method: "percentage",
      ratePpm: 100_000,
      paidMinor: null,
      basis: "cash",
      basisMinor: null,
      prepaidMonths: null,
      coveredLotIds: [],
      treatment: "upfront",
      paymentStatus: "paid",
      dueDate: null,
    },
  ];
  const after = structuredClone(before);
  after.details.lots[0]!.fees![0]!.ratePpm = 130_000;
  expect(holdingHistoryChanges(after, before)).toEqual([
    {
      key: "lot:lot:fee:fee:rate",
      label: "One-time fee · Rate",
      before: "10%",
      after: "13%",
    },
  ]);
});
it("distinguishes a carry change from a shares change", () => {
  const before = receipt(),
    after = receipt();
  after.details.investmentTerms!.carryPpm = 150_000;
  after.details.lots[0]!.remainingSharesMicros = 31_000_000;
  expect(holdingHistorySummary(after, before)).toBe(
    "Investment · Shares 31 · Carry 15%",
  );
});
it("shows the chosen source, amount and carry treatment for a valuation change", () => {
  const before = receipt(),
    after = receipt();
  after.details.valuation = {
    snapshotId: "snapshot",
    selected: { recordId: "gp", method: "total", sharesKey: null },
    records: [
      {
        id: "gp",
        origin: "gp",
        totalMinor: 200_000,
        priceMicros: null,
        effectiveDate: "2026-10-01",
        priceDate: null,
        shareClass: null,
        carryStatus: "before_carry",
        sourceLabel: "Demo GP",
        sourceUrl: null,
        sourceEvidenceId: null,
        sourcePositionId: null,
        sourceCapturedAt: null,
        watchEvidenceId: null,
      },
    ],
  };
  expect(holdingHistorySummary(after, before)).toBe(
    "Valuation · Demo GP $2,000.00 · before carry",
  );
});
