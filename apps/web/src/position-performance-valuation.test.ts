import { describe, expect, it } from "vitest";
import { HoldingSchema, type Holding } from "@keel/domain";
import { PositionValueAdjustmentSchema } from "@keel/domain/position-value";
import { PrivatePositionValueEstimateSchema } from "@keel/domain/private-position-value-estimate";
import { positionPerformanceValuation } from "./position-performance-valuation";

const adjustment = (valueMinor = 100_000) =>
  PositionValueAdjustmentSchema.parse({
    id: "synthetic-adjustment",
    positionId: "synthetic-position",
    snapshotId: "synthetic-snapshot",
    priorValueState: "reported",
    priorValueMinor: 300_000,
    valueMinor,
    currency: "USD",
    effectiveDate: "2026-06-01",
    sourceKind: "gp_update",
    sourceLabel: "Synthetic reviewed valuation",
    sourceUrl: null,
    commentary: "Synthetic accepted evidence.",
    acceptedAt: "2026-11-01T12:00:00Z",
  });

const projected = (valueMinor = 400_000) => {
  const round = {
    evidenceEventId: "synthetic-round",
    effectiveDate: "2026-03-01",
    postMoneyValueMinor: 1_000_000,
    sourceTitle: "Synthetic financing",
    sourceUrl: "https://example.com/synthetic-round",
    approximate: false,
    distanceDays: 0,
  };
  return PrivatePositionValueEstimateSchema.parse({
    method: "gp_mark_tranche_ratio",
    positionId: "synthetic-position",
    valueMinor,
    currency: "USD",
    effectiveDate: "2026-09-01",
    costBasisMinor: 50_000,
    impliedCompanyValueMinor: 2_000_000,
    referencePositionId: "synthetic-reference",
    referenceValueMinor: 800_000,
    referenceCostBasisMinor: 100_000,
    referenceSourceLabel: "Synthetic reference",
    referenceRound: round,
    positionRound: round,
    approximate: false,
  });
};

const holding = (overrides: Partial<Holding> = {}) =>
  HoldingSchema.parse({
    id: "synthetic-position",
    companyId: null,
    positionName: "Synthetic position",
    exposureName: null,
    ownerLabel: "Synthetic household",
    positionKind: "direct",
    administratorNavMinor: 300_000,
    administratorNavState: "reported",
    externalMarkMinor: null,
    underwritingValueMinor: null,
    scenarioValueMinor: null,
    usableLiquidityMinor: null,
    sourceStatus: "verified",
    sourceLabel: "Synthetic provider",
    effectiveDate: "2026-11-01",
    retrievedAt: "2026-11-01T12:00:00Z",
    confidencePpm: null,
    shareValueEstimate: {
      valueMinor: 200_000,
      effectiveDate: "2026-07-01",
      proxy: false,
      derivedShares: false,
      grossCashMinor: null,
      lots: [],
    },
    positionValueContext: {
      snapshotId: "synthetic-snapshot",
      currency: "USD",
      providerValueState: "reported",
      providerValueMinor: 300_000,
      acceptedAdjustment: adjustment(),
      projectedEstimate: projected(),
    },
    purchaseContext: {
      snapshotId: "synthetic-snapshot",
      currency: "USD",
      openedOn: null,
      receipt: null,
      sourceObservedOn: "2026-08-01",
    },
    ...overrides,
  });

const selections = [
  {
    owner: "accepted adjustment",
    valueMinor: 100_000,
    effectiveDate: "2026-06-01",
    input: () => holding(),
  },
  {
    owner: "share estimate",
    valueMinor: 200_000,
    effectiveDate: "2026-07-01",
    input: () => {
      const input = holding();
      input.positionValueContext!.acceptedAdjustment = null;
      return input;
    },
  },
  {
    owner: "administrator NAV",
    valueMinor: 300_000,
    effectiveDate: "2026-08-01",
    input: () => {
      const input = holding({ shareValueEstimate: null });
      input.positionValueContext!.acceptedAdjustment = null;
      return input;
    },
  },
  {
    owner: "projected estimate",
    valueMinor: 400_000,
    effectiveDate: "2026-09-01",
    input: () => {
      const input = holding({
        shareValueEstimate: null,
        administratorNavMinor: null,
      });
      input.positionValueContext!.acceptedAdjustment = null;
      return input;
    },
  },
];

describe("position performance valuation", () => {
  it.each(selections)(
    "uses the $owner amount and its own date in precedence order",
    ({ input, valueMinor, effectiveDate }) => {
      expect(positionPerformanceValuation(input())).toEqual({
        valueMinor,
        effectiveDate,
      });
    },
  );

  it.each(selections)(
    "keeps zero as the selected $owner amount",
    ({ input, effectiveDate }) => {
      const source = input();
      const adjustment = source.positionValueContext?.acceptedAdjustment;
      if (adjustment) adjustment.valueMinor = 0;
      else if (source.shareValueEstimate)
        source.shareValueEstimate.valueMinor = 0;
      else if (source.administratorNavMinor !== null)
        source.administratorNavMinor = 0;
      else source.positionValueContext!.projectedEstimate!.valueMinor = 0;
      expect(positionPerformanceValuation(source)).toEqual({
        valueMinor: 0,
        effectiveDate,
      });
    },
  );

  it("preserves an undated share estimate without borrowing a provider or capture date", () => {
    const input = selections[1]!.input();
    input.shareValueEstimate!.effectiveDate = null;
    expect(positionPerformanceValuation(input)).toEqual({
      valueMinor: 200_000,
      effectiveDate: null,
    });
  });

  it.each([null, undefined])(
    "preserves an administrator NAV with sourceObservedOn %s without using the holding date",
    (sourceObservedOn) => {
      const input = selections[2]!.input();
      if (sourceObservedOn === undefined)
        delete input.purchaseContext!.sourceObservedOn;
      else input.purchaseContext!.sourceObservedOn = sourceObservedOn;
      expect(positionPerformanceValuation(input)).toEqual({
        valueMinor: 300_000,
        effectiveDate: null,
      });
    },
  );

  it("keeps the projected date when provider valuation evidence is absent", () => {
    const input = selections[3]!.input();
    input.purchaseContext = null;
    expect(positionPerformanceValuation(input)).toEqual({
      valueMinor: 400_000,
      effectiveDate: "2026-09-01",
    });
  });

  it("returns no valuation when no source has an amount, even when dates are present", () => {
    const input = selections[3]!.input();
    input.positionValueContext!.projectedEstimate = null;
    expect(positionPerformanceValuation(input)).toBeNull();
  });
});
