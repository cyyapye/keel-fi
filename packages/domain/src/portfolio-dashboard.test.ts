import type { PortfolioBaselineState } from "./index";
import { describe, expect, it } from "vitest";
import {
  createInvestmentExposureView,
  type InvestmentExposureView,
} from "./exposure-read-model";
import { InvestmentHoldingsViewSchema } from "./investment-holdings-view";
import {
  createPortfolioDashboardSnapshot,
  type PortfolioDashboardSnapshot,
} from "./portfolio-dashboard";
import type {
  InvestmentPositionRecord,
  InvestmentPositionView,
} from "./position-read-model";
import type { CanonicalExposure, PositionExposureMapping } from "./index";
import { calculatePortfolioPerformance } from "./portfolio-performance";
import { unknownInvestmentTerms } from "./investment-details";

const asOf = "2026-08-23T12:00:00.000Z";

function fingerprint(character: string): string {
  return character.repeat(64);
}

function position(input: {
  id: string;
  name: string;
  currentMinor: number | null;
  priorMinor: number | null;
  instrumentType?: string;
  valueState?: "reported" | "locked" | "not_reported";
}): InvestmentPositionRecord {
  const valueState = input.valueState ?? "reported";
  return {
    id: input.id,
    legalVehicleName: input.name,
    legalEntityNameEvidence: {
      state: "unavailable",
      legalName: null,
      sourceField: null,
    },
    reportedExposureName: input.name,
    kind: "direct",
    openedOn: null,
    reviewStatus: "accepted",
    acceptedAt: "2026-08-23T10:00:00.000Z",
    ownershipVersion: 1,
    ownershipBasis: "provider_provenance",
    source: {
      label: "Synthetic source",
      effectiveDate: "2026-08-23",
      retrievedAt: asOf,
      freshness: "current",
    },
    snapshot: {
      id: `snapshot_${input.id}`,
      fingerprint: fingerprint("a"),
      observedAt: asOf,
      providerStatus: "live",
      investedMinor: input.currentMinor ?? 0,
      allocationMinor: input.currentMinor ?? 0,
      unrealizedValue: { state: valueState, minor: input.currentMinor },
      realizedValueMinor: 0,
      netValue: { state: valueState, minor: input.currentMinor },
      instrumentType: input.instrumentType ?? "equity",
      currency: "USD",
      quantityMicros: 1_000_000,
      ticker: input.instrumentType === "cash" ? null : input.id.toUpperCase(),
      costBasisMinor: null,
    },
    acceptedValueAdjustment: null,
    priorValue:
      input.priorMinor === null
        ? null
        : {
            state: "reported",
            minor: input.priorMinor,
            observedAt: "2026-07-23T12:00:00.000Z",
          },
  };
}

function exposure(
  id: string,
  name: string,
  kind: "public_instrument" | "private_company" = "public_instrument",
): CanonicalExposure {
  return {
    id,
    householdId: "household_synthetic",
    exposureKind: kind,
    canonicalName: name,
    protectedIdentityKey:
      kind === "public_instrument" ? fingerprint("b") : null,
    companyId: kind === "private_company" ? `company_${id}` : null,
    resolutionMethod:
      kind === "public_instrument" ? "strong_identifier" : "reviewed_company",
    evidenceSha256: fingerprint("e"),
    createdAt: "2026-08-23T10:00:00.000Z",
  };
}

function mapping(
  index: number,
  positionId: string,
  exposureId: string,
  cash = false,
): PositionExposureMapping {
  return {
    id: `mapping_${index}`,
    householdId: "household_synthetic",
    positionId,
    exposureId,
    relationshipKind: "direct",
    allocationPpm: 1_000_000,
    status: "active",
    decisionSource: "deterministic_policy",
    decisionReference: cash
      ? "cash-currency-v1:USD"
      : `synthetic mapping ${index}`,
    evidenceSha256: fingerprint("d"),
    effectiveAt: "2026-08-23T10:00:00.000Z",
    version: 1,
    supersedesMappingId: null,
  };
}

function holdingsFixture() {
  const positions = [
    position({
      id: "alpha",
      name: "Synthetic Alpha",
      currentMinor: 100_000,
      priorMinor: 80_000,
    }),
    position({
      id: "beta",
      name: "Synthetic Beta",
      currentMinor: 60_000,
      priorMinor: 70_000,
    }),
    position({
      id: "cash",
      name: "US Dollar",
      currentMinor: 20_000,
      priorMinor: 20_000,
      instrumentType: "cash",
    }),
    position({
      id: "locked",
      name: "Synthetic Locked SPV",
      currentMinor: null,
      priorMinor: null,
      valueState: "locked",
    }),
  ];
  const positionView: InvestmentPositionView = {
    asOf,
    connections: [
      {
        id: "connection_synthetic",
        purpose: "source",
        adapterType: "plaid-investments",
        institutionKey: "synthetic",
        institutionLabel: "Synthetic institution",
        lifecycleState: "active",
        containers: [
          {
            id: "container_synthetic",
            label: "Synthetic account",
            kind: "brokerage",
            taxTreatment: "taxable",
            coverage: {
              completeness: "complete",
              observedAt: asOf,
              freshness: "current",
            },
            positions,
          },
        ],
      },
    ],
  };
  const exposures = [
    exposure("exposure_alpha", "Synthetic Alpha"),
    exposure("exposure_beta", "Synthetic Beta"),
    exposure("exposure_cash", "US Dollar"),
    exposure("exposure_locked", "Synthetic Locked", "private_company"),
  ];
  const exposureView: InvestmentExposureView = createInvestmentExposureView(
    positionView,
    exposures,
    [
      mapping(1, "alpha", "exposure_alpha"),
      mapping(2, "beta", "exposure_beta"),
      mapping(3, "cash", "exposure_cash", true),
      mapping(4, "locked", "exposure_locked"),
    ],
  );
  return InvestmentHoldingsViewSchema.parse({
    version: 1,
    authorizationStatus: "available",
    positionView,
    exposureView,
  });
}

function baselineFixture(): PortfolioBaselineState {
  return {
    status: "ready",
    sourceRevision: fingerprint("a"),
    observedAt: asOf,
    baseForecastSnapshotId: "forecast_synthetic",
    baseForecastSnapshotVersion: 1,
    summary: null,
    positions: [
      {
        id: "cash",
        positionName: "US Dollar",
        ownerLabel: "Synthetic account",
        sourceLabel: "Plaid Investments",
        provider: "plaid_investments",
        classification: "public_market",
        valueMinor: 20_000,
        valueState: "reported",
        observedAt: asOf,
        ticker: null,
        isCashPosition: true,
        potentialDuplicate: false,
        duplicateWith: [],
      },
      {
        id: "public",
        positionName: "Synthetic public holdings",
        ownerLabel: "Synthetic account",
        sourceLabel: "Plaid Investments",
        provider: "plaid_investments",
        classification: "public_market",
        valueMinor: 150_000,
        valueState: "reported",
        observedAt: asOf,
        ticker: "SYN",
        isCashPosition: false,
        potentialDuplicate: false,
        duplicateWith: [],
      },
      {
        id: "private",
        positionName: "Synthetic private holdings",
        ownerLabel: "Synthetic entity",
        sourceLabel: "AngelList",
        provider: "angellist",
        classification: "private_paper",
        valueMinor: 70_000,
        valueState: "reported",
        observedAt: asOf,
        ticker: null,
        isCashPosition: false,
        potentialDuplicate: false,
        duplicateWith: [],
      },
    ],
    cashAccounts: [
      {
        id: "bank_cash",
        institutionLabel: "Synthetic bank",
        accountLabel: "Demo checking",
        subtype: "checking",
        valueMinor: 30_000,
        valueState: "reported",
        refreshKind: "live",
        observedAt: asOf,
      },
    ],
    changes: { positions: [], cashAccounts: [] },
    planning: {
      currentFiEligibleLiquidMinor: 200_000,
      protectedCashFloorMinor: 10_000,
      householdBurnMonthlyMinor: 5_000,
      businessBurnMonthlyMinor: 0,
      fiTargetMinor: 500_000,
      p25FiveYearLiquidityMinor: 0,
      p50FiveYearLiquidityMinor: 0,
      p75FiveYearLiquidityMinor: 0,
      forecastHorizonDate: "2031-12-31",
    },
    suggestedOtherFiEligibleLiquidMinor: 0,
    currentImpact: {
      fiEligibleLiquidMinor: 200_000,
      fiEligibleChangeMinor: 0,
      protectedRunwayMonths: 38,
      fiGapMinor: 300_000,
      lowerTotalAvailableMinor: 200_000,
      middleTotalAvailableMinor: 200_000,
      higherTotalAvailableMinor: 200_000,
      probabilityCrossingFiPpm: 0,
    },
    latestBaseline: null,
    hasSourceChanges: true,
    hasCashAccountChanges: true,
    requiresDuplicateReview: false,
    requiresCashOverlapReview: false,
    canConfirm: true,
  };
}

describe("createPortfolioDashboardSnapshot", () => {
  it("keeps exposure, access, mover, and unknown-value math explicit", () => {
    const holdings = holdingsFixture();
    const snapshot: PortfolioDashboardSnapshot =
      createPortfolioDashboardSnapshot(holdings, baselineFixture());

    expect(snapshot.currency).toBe("USD");
    expect(snapshot.topExposures.map((item) => item.name)).toEqual([
      "Synthetic Alpha",
      "Synthetic Beta",
    ]);
    expect(snapshot.knownExposureValueMinor).toBe(160_000);
    expect(snapshot.topFiveConcentrationPpm).toBe(1_000_000);
    expect(snapshot.liquidity).toEqual([
      { key: "cash", label: "Cash", valueMinor: 50_000 },
      {
        key: "public_market",
        label: "Public market",
        valueMinor: 150_000,
      },
      {
        key: "private_paper",
        label: "Private paper",
        valueMinor: 70_000,
      },
    ]);
    expect(snapshot.knownPortfolioValueMinor).toBe(270_000);
    expect(snapshot.unknownValueCount).toBe(1);
    expect(snapshot.moversUp).toEqual([
      expect.objectContaining({
        name: "Synthetic Alpha",
        changeMinor: 20_000,
        changePpm: 250_000,
      }),
    ]);
    expect(snapshot.moversDown).toEqual([
      expect.objectContaining({
        name: "Synthetic Beta",
        changeMinor: -10_000,
        changePpm: -142_857,
      }),
    ]);
    for (const position of holdings.exposureView.positions) {
      position.priorValueMinor = null;
      position.priorValueState = "not_reported";
      position.priorValueObservedAt = null;
    }
    const baseline = baselineFixture();
    baseline.suggestedOtherFiEligibleLiquidMinor = 10_000;
    const firstObservation = createPortfolioDashboardSnapshot(
      holdings,
      baseline,
    );
    expect(firstObservation.liquidity).toContainEqual({
      key: "other_liquid",
      label: "Other liquid",
      valueMinor: 10_000,
    });
    expect(firstObservation.knownPortfolioValueMinor).toBe(280_000);
    expect(firstObservation.knownExposureValueMinor).toBe(160_000);
    expect(firstObservation.moversUp).toEqual([]);
    expect(firstObservation.moversDown).toEqual([]);
  });
});

function performanceFixture() {
  const view = holdingsFixture();
  const publicPosition = view.exposureView.positions.find(
    (p) => p.id === "alpha",
  )!;
  Object.assign(publicPosition, {
    valueMinor: 20_000,
    allocatedValueMinor: 20_000,
    unallocatedValueMinor: 0,
    providerCostBasisMinor: 10_000,
    realizedValueMinor: 1_000,
  });
  const privatePosition = view.exposureView.positions.find(
    (p) => p.id === "beta",
  )!;
  Object.assign(privatePosition, {
    positionKind: "spv_interest",
    isPrivateCompanyPosition: true,
    valueMinor: 18_000,
    allocatedValueMinor: 18_000,
    unallocatedValueMinor: 0,
    realizedValueMinor: 3_000,
    reviewedInvestment: {
      snapshotId: privatePosition.snapshotId,
      receiptId: "reviewed_synthetic",
      cashPaidMinor: 12_000,
      additionalPaidFeesMinor: 0,
      upfrontDeductionsMinor: 2_000,
      returnedCapitalMinor: 1_000,
      includedReturnedCapitalMinor: 1_000,
      additionalReturnedCapitalMinor: 0,
      netCapitalMinor: 9_000,
      terms: {
        ...unknownInvestmentTerms(),
        carryPpm: 200_000,
        carryBasis: "net_capital",
        reportedValueReview: {
          sourceSnapshotId: privatePosition.snapshotId,
          valueMinor: 18_000,
          sourceLabel: "Synthetic after-carry report",
          effectiveDate: "2026-08-23",
          carryStatus: "after_carry",
        },
      },
    },
  });
  return {
    view: InvestmentHoldingsViewSchema.parse(view),
    publicPosition,
    privatePosition,
  };
}

describe("current-holdings portfolio performance", () => {
  it("counts an unassigned manual Direct as private paper with incomplete performance coverage", () => {
    const { view } = performanceFixture();
    const eligible = view.exposureView.positions.find(
      (row) => row.id === "beta",
    )!;
    view.exposureView.positions = [
      eligible,
      {
        ...eligible,
        id: "locked",
        snapshotId: "snapshot_locked",
        positionKind: "direct",
        isPrivateCompanyPosition: false,
        manualContext: {
          version: 1,
          containerId: "synthetic_manual_owner",
          containerVersion: 1,
          classification: "private_paper",
          companyMappingIds: [],
        },
        ticker: null,
        instrumentType: "Direct private investment",
        investedMinor: null,
        committedMinor: null,
        realizedValueMinor: null,
        providerCostBasisMinor: null,
        reviewedInvestment: undefined,
        valueState: "not_reported",
        valueMinor: null,
        mappings: [],
        mappedExposureIds: [],
        knownAllocationPpm: 0,
        allocatedValueMinor: null,
        unallocatedValueMinor: null,
      },
    ];
    for (const connection of view.positionView.connections) {
      for (const container of connection.containers) {
        container.positions = container.positions.filter(
          (record) => record.id === "beta" || record.id === "locked",
        );
        const manual = container.positions.find(
          (record) => record.id === "locked",
        );
        if (manual) {
          manual.kind = "direct";
          manual.manualContext = view.exposureView.positions[1]!.manualContext;
          manual.ownershipBasis = "manual";
          manual.snapshot.investedMinor = null;
          manual.snapshot.allocationMinor = null;
          manual.snapshot.realizedValueMinor = null;
          manual.snapshot.unrealizedValue = {
            state: "not_reported",
            minor: null,
          };
          manual.snapshot.netValue = { state: "not_reported", minor: null };
        }
      }
    }
    const result = calculatePortfolioPerformance(
      InvestmentHoldingsViewSchema.parse(view),
      "USD",
    );
    expect(result.privateTvpi).toMatchObject({
      totalCount: 2,
      eligibleCount: 1,
      paidInMinor: 12000,
      valueMinor: 18000,
      multiplePpm: 1750000,
    });
    expect(result.privateDpi).toMatchObject({
      totalCount: 2,
      eligibleCount: 1,
      paidInMinor: 12000,
      distributionsMinor: 3000,
      multiplePpm: 250000,
    });
  });
  it("weights summed capital and keeps paid-in multiples separate from net-capital return", () => {
    const { view } = performanceFixture();
    const result = calculatePortfolioPerformance(view, "USD");
    expect(result.holdingReturn).toMatchObject({
      totalCount: 3,
      eligibleCount: 2,
      estimatedCount: 0,
      valueMinor: 38_000,
      distributionsMinor: 3_000,
      basisMinor: 19_000,
      gainMinor: 22_000,
      returnPpm: 1_157_894,
    });
    expect(result.privateTvpi).toMatchObject({
      totalCount: 2,
      eligibleCount: 1,
      paidInMinor: 12_000,
      valueMinor: 18_000,
      distributionsMinor: 3_000,
      multiplePpm: 1_750_000,
    });
    expect(result.privateDpi).toMatchObject({
      totalCount: 2,
      eligibleCount: 1,
      paidInMinor: 12_000,
      distributionsMinor: 3_000,
      multiplePpm: 250_000,
    });
  });

  it("counts a refund once whether included or excluded by the distribution source", () => {
    const { view } = performanceFixture();
    const expected = calculatePortfolioPerformance(view, "USD");
    const position = view.exposureView.positions.find((p) => p.id === "beta")!;
    position.realizedValueMinor = 2_000;
    position.reviewedInvestment!.includedReturnedCapitalMinor = 0;
    position.reviewedInvestment!.additionalReturnedCapitalMinor = 1_000;
    expect(calculatePortfolioPerformance(view, "USD")).toEqual(expected);
  });

  it("estimates after-carry value from a reviewed before-carry mark without deducting upfront fees again", () => {
    const { view } = performanceFixture();
    const position = view.exposureView.positions.find((p) => p.id === "beta")!;
    position.valueMinor = 20_000;
    position.reviewedInvestment!.terms.reportedValueReview!.valueMinor = 20_000;
    position.reviewedInvestment!.terms.reportedValueReview!.carryStatus =
      "before_carry";
    const result = calculatePortfolioPerformance(view, "USD");
    expect(result.privateTvpi).toMatchObject({
      valueMinor: 17_800,
      multiplePpm: 1_733_333,
      estimatedCount: 1,
    });
    expect(result.holdingReturn).toMatchObject({
      gainMinor: 21_800,
      returnPpm: 1_147_368,
      estimatedCount: 1,
    });
  });

  it.each(["value", "carry", "stale"])(
    "withholds TVPI for missing %s evidence while preserving supported DPI",
    (missing) => {
      const { view } = performanceFixture();
      const position = view.exposureView.positions.find(
        (p) => p.id === "beta",
      )!;
      if (missing === "value") {
        position.valueMinor = null;
        position.valueState = "not_reported";
      } else if (missing === "carry") {
        position.reviewedInvestment!.terms.reportedValueReview!.carryStatus =
          "unknown";
      } else {
        position.reviewedInvestment!.terms.reportedValueReview!.sourceSnapshotId =
          "stale_snapshot";
      }
      const result = calculatePortfolioPerformance(view, "USD");
      expect(result.privateTvpi.multiplePpm).toBeNull();
      expect(result.privateDpi.multiplePpm).toBe(250_000);
      expect(result.holdingReturn.eligibleCount).toBe(1);
    },
  );

  it.each(["stale", "refund", "paid-in"])(
    "does not invent private performance when %s inputs are unsupported",
    (missing) => {
      const { view } = performanceFixture();
      const position = view.exposureView.positions.find(
        (p) => p.id === "beta",
      )!;
      if (missing === "stale")
        position.reviewedInvestment!.snapshotId = "older_snapshot";
      if (missing === "refund")
        position.reviewedInvestment!.returnedCapitalReconciliationPending = true;
      if (missing === "paid-in")
        position.reviewedInvestment!.cashPaidMinor = null;
      const result = calculatePortfolioPerformance(view, "USD");
      expect(result.privateDpi.multiplePpm).toBeNull();
      expect(result.privateTvpi.multiplePpm).toBeNull();
    },
  );

  it("shows supported zero distributions and losses, but never replaces missing basis with zero", () => {
    const { view } = performanceFixture();
    const position = view.exposureView.positions.find((p) => p.id === "alpha")!;
    view.exposureView.positions = [position];
    position.valueMinor = 5_000;
    position.realizedValueMinor = 0;
    expect(
      calculatePortfolioPerformance(view, "USD").holdingReturn,
    ).toMatchObject({
      gainMinor: -5_000,
      returnPpm: -500_000,
    });
    position.providerCostBasisMinor = null;
    expect(
      calculatePortfolioPerformance(view, "USD").holdingReturn.returnPpm,
    ).toBeNull();
    const empty = calculatePortfolioPerformance(view, "EUR");
    expect(empty.holdingReturn.totalCount).toBe(0);
    expect(empty.privateDpi.multiplePpm).toBeNull();
  });

  it("does not turn invested-amount fallback into a supported zero return", () => {
    const { view } = performanceFixture();
    view.exposureView.positions.forEach((p) => {
      p.valueSource = "invested_amount";
    });
    expect(
      calculatePortfolioPerformance(view, "USD").holdingReturn.eligibleCount,
    ).toBe(0);
  });

  it("distinguishes known zero cash returned from unavailable paid-in capital", () => {
    const { view } = performanceFixture();
    const position = view.exposureView.positions.find((p) => p.id === "beta")!;
    position.realizedValueMinor = 0;
    position.reviewedInvestment!.includedReturnedCapitalMinor = 0;
    position.reviewedInvestment!.returnedCapitalMinor = 0;
    const result = calculatePortfolioPerformance(view, "USD");
    expect(result.privateDpi.multiplePpm).toBe(0);
    expect(result.privateDpi.eligibleCount).toBe(1);
    position.reviewedInvestment!.cashPaidMinor = 0;
    expect(
      calculatePortfolioPerformance(view, "USD").privateDpi.multiplePpm,
    ).toBeNull();
  });

  it("scales across 120 legal holdings without multiplying amounts by exposure mappings or historical records", () => {
    const { view } = performanceFixture();
    const original = view.exposureView.positions.find((p) => p.id === "alpha")!;
    view.exposureView.positions = Array.from({ length: 120 }, (_, i) => ({
      ...original,
      id: `scale_${i}`,
      mappedExposureIds: ["a", "b", "c"],
    }));
    const container = view.positionView.connections[0]!.containers[0]!;
    const historical = structuredClone(container.positions[0]!);
    historical.id = "closed_synthetic";
    historical.snapshot.providerStatus = "realized";
    historical.snapshot.realizedValueMinor = 900_000_000;
    container.positions.push(historical);
    const result = calculatePortfolioPerformance(view, "USD");
    expect(result.holdingReturn).toMatchObject({
      totalCount: 120,
      eligibleCount: 120,
      basisMinor: 1_200_000,
      gainMinor: 1_320_000,
      returnPpm: 1_100_000,
    });
  });

  it("rejects totals beyond safe integer money rather than rounding them", () => {
    const { view } = performanceFixture();
    const position = view.exposureView.positions.find((p) => p.id === "alpha")!;
    position.valueMinor = Number.MAX_SAFE_INTEGER;
    position.providerCostBasisMinor = Number.MAX_SAFE_INTEGER;
    position.realizedValueMinor = 0;
    view.exposureView.positions = [position, { ...position, id: "second" }];
    expect(() => calculatePortfolioPerformance(view, "USD")).toThrow(
      /safe integer/,
    );
  });
});
