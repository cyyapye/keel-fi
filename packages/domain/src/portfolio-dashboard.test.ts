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
    const snapshot: PortfolioDashboardSnapshot =
      createPortfolioDashboardSnapshot(holdingsFixture(), baselineFixture());

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
  });
});
