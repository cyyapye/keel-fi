import { describe, expect, it } from "vitest";

import type { CanonicalExposure, PositionExposureMapping } from "./index";
import { createInvestmentExposureView } from "./exposure-read-model";
import type {
  InvestmentPositionRecord,
  InvestmentPositionView,
} from "./position-read-model";

const asOf = "2026-08-16T12:00:00.000Z";
const evidenceSha256 = "a".repeat(64);

function position(
  id: string,
  valueMinor: number | null,
  valueState: "reported" | "locked" | "not_reported" = "reported",
): InvestmentPositionRecord {
  return {
    id,
    legalVehicleName: `Synthetic position ${id}`,
    reportedExposureName: "Synthetic common equity",
    kind: "direct",
    openedOn: "2026-01-15",
    reviewStatus: "accepted",
    acceptedAt: "2026-08-15T12:00:00.000Z",
    ownershipVersion: 1,
    ownershipBasis: "provider_provenance",
    source: {
      label: "Synthetic Investments",
      effectiveDate: "2026-08-15",
      retrievedAt: "2026-08-15T11:50:00.000Z",
      freshness: "current",
    },
    snapshot: {
      id: `snapshot_${id}`,
      fingerprint: id.slice(-1).repeat(64),
      observedAt: "2026-08-15T11:45:00.000Z",
      providerStatus: "live",
      investedMinor: 100_000,
      allocationMinor: 100_000,
      unrealizedValue: { state: valueState, minor: valueMinor },
      realizedValueMinor: 0,
      netValue: { state: valueState, minor: valueMinor },
      instrumentType: "equity",
      currency: "USD",
      quantityMicros: 1_000_000,
      ticker: "SYN",
      costBasisMinor: 100_000,
    },
  };
}

function positionView(
  positions: readonly InvestmentPositionRecord[],
): InvestmentPositionView {
  return {
    asOf,
    connections: [
      {
        id: "connection_synthetic",
        purpose: "source",
        adapterType: "plaid-investments",
        institutionKey: "ins_synthetic",
        institutionLabel: "Synthetic Brokerage",
        lifecycleState: "active",
        containers: positions.map((record, index) => ({
          id: `container_${record.id}`,
          label: `Synthetic account ${index + 1}`,
          kind: index === 2 ? "ira" : "brokerage",
          taxTreatment: index === 2 ? "tax_exempt" : "taxable",
          coverage: {
            completeness: "complete",
            observedAt: "2026-08-15T11:45:00.000Z",
            freshness: "current",
          },
          positions: [record],
        })),
      },
    ],
  };
}

function exposure(id: string, canonicalName: string): CanonicalExposure {
  return {
    id,
    householdId: "household_synthetic",
    exposureKind: "public_instrument",
    canonicalName,
    protectedIdentityKey: id.slice(-1).repeat(64),
    companyId: null,
    resolutionMethod: "strong_identifier",
    evidenceSha256,
    createdAt: "2026-08-15T12:00:00.000Z",
  };
}

function mapping(
  id: string,
  positionId: string,
  exposureId: string,
  allocationPpm: number | null = 1_000_000,
): PositionExposureMapping {
  return {
    id,
    householdId: "household_synthetic",
    positionId,
    exposureId,
    relationshipKind: allocationPpm === 1_000_000 ? "direct" : "look_through",
    allocationPpm,
    status: "active",
    decisionSource:
      allocationPpm === 1_000_000 ? "deterministic_policy" : "review",
    decisionReference: "synthetic exposure decision",
    evidenceSha256,
    effectiveAt: "2026-08-15T12:00:00.000Z",
    version: 1,
    supersedesMappingId: null,
  };
}

describe("investment exposure read model", () => {
  it("groups shared exposure while preserving exact position lineage and provenance", () => {
    const records = [
      position("position_1", 1_000_000),
      position("position_2", 2_000_000),
      position("position_3", 3_000_000),
    ];
    const sharedExposure = exposure("exposure_1", "Synthetic common equity");
    const view = createInvestmentExposureView(
      positionView(records),
      [sharedExposure],
      records.map((record, index) =>
        mapping(`mapping_${index + 1}`, record.id, sharedExposure.id),
      ),
    );

    expect(view.positions).toHaveLength(3);
    expect(
      new Set(view.positions.map((record) => record.containerId)).size,
    ).toBe(3);
    expect(view.positions[2]).toMatchObject({
      institutionLabel: "Synthetic Brokerage",
      containerKind: "ira",
      snapshotId: "snapshot_position_3",
      quantityMicros: 1_000_000,
      allocatedValueMinor: 3_000_000,
      unallocatedValueMinor: 0,
      mappings: [
        {
          decisionSource: "deterministic_policy",
          decisionReference: "synthetic exposure decision",
        },
      ],
    });
    expect(view.exposures).toEqual([
      expect.objectContaining({
        exposure: expect.objectContaining({ id: sharedExposure.id }),
        contributions: expect.arrayContaining([
          expect.objectContaining({
            positionId: "position_1",
            mappingId: "mapping_1",
            allocatedValueMinor: 1_000_000,
          }),
        ]),
        totals: [
          {
            currency: "USD",
            allocatedValueMinor: 6_000_000,
            knownValuePositionCount: 3,
            unknownValuePositionCount: 0,
          },
        ],
      }),
    ]);
  });

  it("keeps unknown allocations and unavailable values explicit without manufacturing money", () => {
    const reported = {
      ...position("position_4", 5_000_000),
      kind: "fund_interest" as const,
    };
    const locked = position("position_5", null, "locked");
    const first = exposure("exposure_4", "Synthetic Company One");
    const second = exposure("exposure_5", "Synthetic Company Two");
    const view = createInvestmentExposureView(
      positionView([reported, locked]),
      [first, second],
      [
        mapping("mapping_4", reported.id, first.id, null),
        mapping("mapping_5", reported.id, second.id, null),
        mapping("mapping_6", locked.id, first.id),
      ],
    );

    expect(
      view.positions.find((record) => record.id === reported.id),
    ).toMatchObject({
      knownAllocationPpm: 0,
      hasUnknownAllocation: true,
      allocatedValueMinor: 0,
      unallocatedValueMinor: 5_000_000,
    });
    expect(
      view.positions.find((record) => record.id === locked.id),
    ).toMatchObject({
      valueState: "locked",
      valueMinor: null,
      allocatedValueMinor: null,
      unallocatedValueMinor: null,
    });
    expect(
      view.exposures.find((group) => group.exposure.id === first.id)?.totals,
    ).toEqual([
      {
        currency: "USD",
        allocatedValueMinor: 0,
        knownValuePositionCount: 0,
        unknownValuePositionCount: 2,
      },
    ]);
  });

  it("rolls an accepted sourced position mark into exposure totals", () => {
    const providerPosition = position("position_7", 1_000_000);
    const adjustedPosition: InvestmentPositionRecord = {
      ...providerPosition,
      acceptedValueAdjustment: {
        id: "adjustment_position_7",
        positionId: providerPosition.id,
        snapshotId: providerPosition.snapshot.id,
        priorValueState: "reported",
        priorValueMinor: 1_000_000,
        valueMinor: 1_400_000,
        currency: "USD",
        effectiveDate: "2026-08-16",
        sourceKind: "gp_update",
        sourceLabel: "Synthetic GP update",
        sourceUrl: null,
        commentary: "Synthetic progress supports the reviewed mark.",
        acceptedAt: "2026-08-16T10:00:00.000Z",
      },
      priorValue: {
        state: "reported",
        minor: 1_000_000,
        observedAt: "2026-07-16T10:00:00.000Z",
      },
    };
    const reviewedExposure = exposure(
      "exposure_7",
      "Synthetic reviewed company",
    );

    const view = createInvestmentExposureView(
      positionView([adjustedPosition]),
      [reviewedExposure],
      [mapping("mapping_7", adjustedPosition.id, reviewedExposure.id)],
    );

    expect(adjustedPosition.snapshot.unrealizedValue.minor).toBe(1_000_000);
    expect(view.positions[0]).toMatchObject({
      valueMinor: 1_400_000,
      valueSource: "reviewed_adjustment",
      valueEffectiveDate: "2026-08-16",
      valueSourceLabel: "Synthetic GP update",
      priorValueState: "reported",
      priorValueMinor: 1_000_000,
      priorValueObservedAt: "2026-07-16T10:00:00.000Z",
    });
    expect(view.exposures[0]?.totals).toEqual([
      {
        currency: "USD",
        allocatedValueMinor: 1_400_000,
        knownValuePositionCount: 1,
        unknownValuePositionCount: 0,
      },
    ]);
  });

  it("uses invested amount for a live exposure when current value is not reported", () => {
    const missingMark = {
      ...position("position_8", null, "not_reported"),
      snapshot: {
        ...position("position_8", null, "not_reported").snapshot,
        investedMinor: 425_000,
      },
    };
    const estimatedExposure = exposure(
      "exposure_8",
      "Synthetic estimated company",
    );

    const view = createInvestmentExposureView(
      positionView([missingMark]),
      [estimatedExposure],
      [mapping("mapping_8", missingMark.id, estimatedExposure.id)],
    );

    expect(missingMark.snapshot.unrealizedValue).toEqual({
      state: "not_reported",
      minor: null,
    });
    expect(view.positions[0]).toMatchObject({
      valueState: "reported",
      valueMinor: 425_000,
      valueSource: "invested_amount",
      allocatedValueMinor: 425_000,
      unallocatedValueMinor: 0,
    });
    expect(view.exposures[0]?.totals).toEqual([
      {
        currency: "USD",
        allocatedValueMinor: 425_000,
        knownValuePositionCount: 1,
        unknownValuePositionCount: 0,
      },
    ]);
  });

  it("does not estimate missing cash, realized positions, or a zero basis", () => {
    const missingCash = {
      ...position("position_9", null, "not_reported"),
      snapshot: {
        ...position("position_9", null, "not_reported").snapshot,
        investedMinor: 25_000,
        instrumentType: "cash",
      },
    };
    const realized = {
      ...position("position_10", null, "not_reported"),
      snapshot: {
        ...position("position_10", null, "not_reported").snapshot,
        investedMinor: 600_000,
        providerStatus: "realized" as const,
      },
    };
    const zeroBasis = {
      ...position("position_11", null, "not_reported"),
      snapshot: {
        ...position("position_11", null, "not_reported").snapshot,
        investedMinor: 0,
      },
    };
    const first = exposure("exposure_9", "Synthetic cash");
    const second = exposure("exposure_10", "Synthetic realized company");
    const third = exposure("exposure_11", "Synthetic unknown basis");

    const view = createInvestmentExposureView(
      positionView([missingCash, realized, zeroBasis]),
      [first, second, third],
      [
        mapping("mapping_9", missingCash.id, first.id),
        mapping("mapping_10", realized.id, second.id),
        mapping("mapping_11", zeroBasis.id, third.id),
      ],
    );

    expect(view.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: missingCash.id,
          valueState: "not_reported",
          valueMinor: null,
          valueSource: "provider",
        }),
        expect.objectContaining({
          id: realized.id,
          valueState: "not_reported",
          valueMinor: null,
          valueSource: "provider",
        }),
        expect.objectContaining({
          id: zeroBasis.id,
          valueState: "not_reported",
          valueMinor: null,
          valueSource: "provider",
        }),
      ]),
    );
  });

  it("fails closed when a mapping is outside the authoritative position view", () => {
    expect(() =>
      createInvestmentExposureView(
        positionView([position("position_6", 100_000)]),
        [exposure("exposure_6", "Synthetic common equity")],
        [mapping("mapping_7", "position_missing", "exposure_6")],
      ),
    ).toThrow(/authoritative accepted position/u);
  });
});
