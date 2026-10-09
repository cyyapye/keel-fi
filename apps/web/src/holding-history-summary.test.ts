import { expect, it } from "vitest";
import { PurchaseReceiptSchema } from "@keel/domain/position-purchases";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";
import {
  holdingHistorySummary,
  previousHistoryReceipt,
} from "./holding-history-summary";

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

it("follows the saved predecessor when equal timestamps sort revisions out of causal order", () => {
  const first = { ...receipt(), id: "z-first", previousReceiptId: null };
  const second = { ...receipt(), id: "a-second", previousReceiptId: "z-first" };
  const third = { ...receipt(), id: "m-third", previousReceiptId: "a-second" };
  const history = {
    receipts: [first, third, second],
    previous: null,
    next: null,
  };
  expect(previousHistoryReceipt(history, 1)).toBe(second);
  expect(previousHistoryReceipt(history, 0)).toBeNull();
  expect(
    previousHistoryReceipt(
      { ...history, receipts: [third], previous: second },
      0,
    ),
  ).toBe(second);
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
