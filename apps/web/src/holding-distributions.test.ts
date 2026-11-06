import { describe, expect, it } from "vitest";
import { HoldingSchema } from "@keel/domain";
import {
  PurchaseLotSchema,
  PurchaseReceiptSchema,
} from "@keel/domain/position-purchases";
import {
  DistributionReviewSchema,
  unknownInvestmentTerms,
} from "@keel/domain/investment-details";
import {
  draftDistributions,
  parseDistributionDraft,
} from "./holding-distributions";
import { holdingValueSummary } from "./holding-value";
import { holdingHistoryChanges } from "./holding-history-changes";
import { holdingHistorySummary } from "./holding-history-summary";

const review = () =>
  DistributionReviewSchema.parse({
    method: "capital_return_first_v1",
    events: [
      {
        id: "synthetic-stock",
        kind: "in_kind",
        receivedOn: "2026-06-01",
        investorValueMinor: 900_000,
        securityLabel: "Synthetic common stock",
        quantityMicros: 60_000_000,
        sourceLabel: "Synthetic distribution notice",
        sourceUrl: "https://example.com/distribution",
        note: "Synthetic event note",
      },
    ],
    coverage: { status: "complete", throughDate: "2026-10-01" },
    priorCarry: { status: "known", amountMinor: 0 },
    provider: {
      inclusion: "all",
      sourceSnapshotId: "canonical",
      realizedValueMinor: 900_000,
    },
    sourceLabel: "Synthetic history review",
    sourceUrl: "https://example.com/history",
    note: "Synthetic review note",
  });
const draft = () =>
  draftDistributions({
    snapshotId: "canonical",
    receiptId: "synthetic-receipt",
    realizedValueMinor: 900_000,
    review: review(),
  });
const receipt = () =>
  PurchaseReceiptSchema.parse({
    id: "synthetic-receipt",
    positionId: "synthetic-position",
    snapshotId: "canonical",
    currency: "USD",
    acceptedAt: "2026-10-01T12:00:00Z",
    details: {
      cashCoversPosition: true,
      coversPosition: true,
      distributionReview: review(),
      investmentTerms: {
        ...unknownInvestmentTerms(),
        importedAmountBasis: "gross_cash",
        carryPpm: 200_000,
        carryBasis: "gross_cash",
      },
      lots: [
        PurchaseLotSchema.parse({
          id: "synthetic-acquisition",
          purchasedOn: null,
          shareClass: null,
          priceMicros: null,
          referencePriceMicros: null,
          grossCashMinor: 3_000_000,
          netCapitalMinor: 2_700_000,
          upfrontDeductionsMinor: 300_000,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: null,
          sharesAsOf: null,
          sourceLabel: null,
          sourceUrl: null,
          mark: null,
        }),
      ],
      valuation: {
        snapshotId: "canonical",
        selected: { recordId: "gp", method: "total", sharesKey: null },
        records: [
          {
            id: "gp",
            origin: "gp",
            totalMinor: 4_000_000,
            priceMicros: null,
            effectiveDate: "2026-10-01",
            priceDate: null,
            shareClass: null,
            shareBasis: null,
            carryStatus: "before_carry",
            sourceLabel: "Synthetic GP statement",
            sourceUrl: null,
            sourceEvidenceId: null,
            sourcePositionId: null,
            sourceCapturedAt: null,
            watchEvidenceId: null,
          },
        ],
      },
    },
  });
const holding = () =>
  HoldingSchema.parse({
    id: "synthetic-position",
    companyId: null,
    positionName: "Synthetic SPV",
    exposureName: null,
    ownerLabel: "Synthetic household",
    positionKind: "spv_interest",
    administratorNavMinor: 4_000_000,
    administratorNavState: "reported",
    externalMarkMinor: null,
    underwritingValueMinor: null,
    scenarioValueMinor: null,
    usableLiquidityMinor: null,
    sourceStatus: "verified",
    sourceLabel: "Synthetic canonical provider",
    effectiveDate: "2026-10-01",
    retrievedAt: "2026-10-01T12:00:00Z",
    confidencePpm: null,
    investedMinor: 3_000_000,
    realizedValueMinor: 900_000,
    purchaseContext: {
      snapshotId: "canonical",
      currency: "USD",
      openedOn: null,
      sourceObservedOn: "2026-10-01",
      reportedValueMinor: 4_000_000,
      receipt: receipt(),
    },
  });

describe("distribution editor accepted facts", () => {
  it("records blank as unknown and entered zero as an explicit financial fact", () => {
    const input = draft();
    for (const amount of ["", "9000", "0", " "]) {
      input.events[0]!.amount = amount;
      input.priorCarryAmount = amount;
      const parsed = parseDistributionDraft(input);
      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error(parsed.message);
      expect(parsed.data.distributionReview.events[0]!.investorValueMinor).toBe(
        amount.trim() === "" ? null : amount === "0" ? 0 : 900_000,
      );
      expect(parsed.data.distributionReview.priorCarry).toEqual(
        amount.trim() === ""
          ? { status: "unknown" }
          : { status: "known", amountMinor: amount === "0" ? 0 : 900_000 },
      );
    }
  });
  it("rejects malformed, negative and overprecision amounts without converting them to unknown", () => {
    for (const amount of ["-1", "12.001", "money", "9007199254740993"]) {
      const input = draft();
      input.events[0]!.amount = amount;
      expect(parseDistributionDraft(input).success).toBe(false);
      input.events[0]!.amount = "9000";
      input.priorCarryAmount = amount;
      expect(parseDistributionDraft(input).success).toBe(false);
    }
  });
  it("keeps stable IDs and hidden evidence when correcting visible facts", () => {
    const input = draft();
    input.events[0]!.amount = "10000";
    input.events[0]!.evidence = "Synthetic corrected notice";
    const parsed = parseDistributionDraft(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.message);
    expect(parsed.data.distributionReview).toMatchObject({
      sourceLabel: "Synthetic history review",
      sourceUrl: "https://example.com/history",
      note: "Synthetic review note",
      events: [
        {
          id: "synthetic-stock",
          investorValueMinor: 1_000_000,
          sourceLabel: "Synthetic corrected notice",
          sourceUrl: "https://example.com/distribution",
          note: "Synthetic event note",
        },
      ],
    });
    expect(parsed.data.expectedReceiptId).toBe("synthetic-receipt");
  });
  it("requires review of provider inclusion after either canonical binding fact changes", () => {
    for (const change of [
      { snapshotId: "new-canonical" },
      { realizedValueMinor: 1_000_000 },
    ]) {
      const input = draftDistributions({
        snapshotId: "canonical",
        receiptId: "later-receipt",
        realizedValueMinor: 900_000,
        review: review(),
        ...change,
      });
      expect(input.inclusion).toBe("unknown");
      expect(input.providerBindingStale).toBe(true);
      const parsed = parseDistributionDraft(input);
      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error(parsed.message);
      expect(parsed.data.distributionReview.provider).toEqual({
        inclusion: "unknown",
        sourceSnapshotId: change.snapshotId ?? "canonical",
        realizedValueMinor: change.realizedValueMinor ?? 900_000,
      });
    }
  });
  it("requires explicit zero for complete empty history and never supplies an observed-through date", () => {
    const input = draftDistributions({
      snapshotId: "canonical",
      receiptId: null,
      realizedValueMinor: 0,
      review: undefined,
    });
    expect(input.throughDate).toBe("");
    expect(input.priorCarryAmount).toBe("");
    input.events = [];
    input.coverage = "complete";
    input.throughDate = "2026-10-01";
    expect(parseDistributionDraft(input).success).toBe(false);
    input.priorCarryAmount = "0";
    expect(parseDistributionDraft(input).success).toBe(true);
  });
});

describe("holding distribution-aware value", () => {
  it("uses cumulative carry and counts included or excluded distributions once", () => {
    for (const inclusion of ["all", "none"] as const) {
      const item = holding();
      item.realizedValueMinor = inclusion === "all" ? 900_000 : 0;
      const r = item.purchaseContext!.receipt!.details.distributionReview!;
      r.provider.inclusion = inclusion;
      r.provider.realizedValueMinor = item.realizedValueMinor;
      const result = holdingValueSummary(item);
      expect(result.after).toMatchObject({
        method: "cumulative",
        carryMinor: 380_000,
        proceedsMinor: 3_620_000,
      });
      expect(result.capital.capitalRemainingMinor).toBe(2_100_000);
      expect(result.historical).toMatchObject({
        status: "available",
        netDistributionsMinor: 900_000,
      });
      expect(result.afterReturn?.totalReturnPpm).toBe(674_074);
      expect(result.beforeReturn?.totalReturnPpm).toBe(814_814);
    }
  });
  it("withholds only dependent returns for mixed or unknown provider inclusion", () => {
    for (const inclusion of ["unsupported_mixed", "unknown"] as const) {
      const item = holding();
      item.purchaseContext!.receipt!.details.distributionReview!.provider.inclusion =
        inclusion;
      const result = holdingValueSummary(item);
      expect(result.after).toMatchObject({
        carryMinor: 380_000,
        proceedsMinor: 3_620_000,
      });
      expect(result.historical).toEqual({
        status: "unavailable",
        reason:
          inclusion === "unknown"
            ? "unknown_provider_inclusion"
            : "unsupported_mixed_inclusion",
      });
      expect(result.beforeReturn?.totalReturnPpm).toBeNull();
      expect(result.afterReturn?.totalReturnPpm).toBeNull();
    }
  });
  it("keeps historical investor capital separate from an older remaining-value date", () => {
    const item = holding();
    item.purchaseContext!.receipt!.details.valuation!.records[0]!.effectiveDate =
      "2026-05-01";
    const result = holdingValueSummary(item);
    expect(result.capital.capitalRemainingMinor).toBe(2_100_000);
    expect(result.carry).toEqual({
      status: "unavailable",
      reason: "valuation_predates_distribution",
    });
    expect(result.beforeReturn?.totalReturnPpm).toBeNull();
  });
  it("preserves known investor capital but withholds carry when prior GP carry is unknown", () => {
    const item = holding();
    item.purchaseContext!.receipt!.details.distributionReview!.priorCarry = {
      status: "unknown",
    };
    const result = holdingValueSummary(item);
    expect(result.capital.capitalRemainingMinor).toBe(2_100_000);
    expect(result.carry).toEqual({
      status: "unavailable",
      reason: "unknown_prior_carry",
    });
    expect(result.after).toBeNull();
    expect(result.beforeReturn?.totalReturnPpm).toBe(814_814);
  });
  it("retains source classification and does not charge an after-carry value again", () => {
    const item = holding();
    const gp = item.purchaseContext!.receipt!.details.valuation!.records[0]!;
    gp.carryStatus = "unknown";
    expect(holdingValueSummary(item).after).toBeNull();
    gp.carryStatus = "after_carry";
    item.purchaseContext!.receipt!.details.distributionReview!.priorCarry = {
      status: "unknown",
    };
    expect(holdingValueSummary(item).after).toMatchObject({
      method: "reported_after_carry",
      proceedsMinor: 4_000_000,
      carryMinor: null,
    });
  });
  it("does not replace an explicitly unknown reviewed value date with an import date", () => {
    const item = holding();
    const details = item.purchaseContext!.receipt!.details;
    delete details.valuation;
    details.investmentTerms!.reportedValueReview = {
      sourceSnapshotId: "canonical",
      valueMinor: 4_000_000,
      sourceLabel: "Synthetic undated statement",
      carryStatus: "before_carry",
      effectiveDate: null,
    };
    expect(holdingValueSummary(item).record?.effectiveDate).toBe("");
    expect(holdingValueSummary(item).carry).toEqual({
      status: "unavailable",
      reason: "missing_valuation_date",
    });
  });
  it("binds distribution reconciliation to the original position rather than its linked NAV source", () => {
    const item = holding();
    item.purchaseContext!.reportedValueSnapshotId = "linked-nav";
    const result = holdingValueSummary(item);
    expect(result.historical).toMatchObject({
      status: "available",
      netDistributionsMinor: 900_000,
    });
    expect(result.afterReturn?.totalReturnPpm).toBe(674_074);
  });
});

describe("distribution receipt history", () => {
  it("shows corrected and removed values by stable event identity without altering earlier facts", () => {
    const before = receipt();
    const original = JSON.stringify(before);
    const corrected = structuredClone(before);
    corrected.id = "synthetic-correction";
    corrected.details.distributionReview!.events[0]!.investorValueMinor = 1_000_000;
    expect(holdingHistoryChanges(corrected, before)).toContainEqual({
      key: "distribution:synthetic-stock:amount",
      label: "Distribution 1 · Historical investor value",
      before: "$9,000.00",
      after: "$10,000.00",
    });
    expect(holdingHistorySummary(corrected, before)).toContain(
      "Distribution history updated",
    );
    const removed = structuredClone(corrected);
    removed.details.distributionReview!.events = [];
    expect(holdingHistoryChanges(removed, corrected)).toContainEqual({
      key: "distribution:synthetic-stock:amount",
      label: "Distribution 1 · Historical investor value",
      before: "$10,000.00",
      after: null,
    });
    expect(holdingHistorySummary(removed, corrected)).toContain(
      "Distribution removed",
    );
    expect(JSON.stringify(before)).toBe(original);
  });
});
