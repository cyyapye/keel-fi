import { describe, expect, it } from "vitest";

import { InvestmentHoldingsViewSchema } from "./investment-holdings-view";

describe("investment holdings view contract", () => {
  it("requires position and exposure projections from the same instant", () => {
    const base = {
      version: 1 as const,
      authorizationStatus: "provider_approval_required" as const,
      positionView: {
        asOf: "2026-08-16T12:00:00.000Z",
        connections: [],
      },
      exposureView: {
        asOf: "2026-08-16T12:00:00.000Z",
        positions: [],
        exposures: [],
      },
    };

    expect(InvestmentHoldingsViewSchema.parse(base)).toEqual(base);
    expect(
      InvestmentHoldingsViewSchema.safeParse({
        ...base,
        exposureView: {
          ...base.exposureView,
          asOf: "2026-08-16T12:00:01.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects an exposure projection from a different accepted snapshot", () => {
    const observedAt = "2026-08-16T11:00:00.000Z";
    const fingerprint = "a".repeat(64);
    const position = {
      id: "position-synthetic",
      legalVehicleName: "Synthetic common stock",
      legalEntityNameEvidence: {
        state: "unavailable" as const,
        legalName: null,
        sourceField: null,
      },
      reportedExposureName: null,
      kind: "direct" as const,
      openedOn: null,
      reviewStatus: "accepted" as const,
      acceptedAt: observedAt,
      ownershipVersion: 1,
      ownershipBasis: "manual" as const,
      source: {
        label: "Synthetic review",
        effectiveDate: "2026-08-16",
        retrievedAt: observedAt,
        freshness: "current" as const,
      },
      snapshot: {
        id: "snapshot-authoritative",
        fingerprint,
        observedAt,
        providerStatus: "live" as const,
        investedMinor: 10_000,
        allocationMinor: 10_000,
        unrealizedValue: { state: "reported" as const, minor: 12_000 },
        realizedValueMinor: 0,
        netValue: { state: "reported" as const, minor: 12_000 },
        instrumentType: "common_stock",
        currency: "USD",
        quantityMicros: null,
        ticker: null,
        costBasisMinor: null,
      },
    };
    const value = {
      version: 1 as const,
      authorizationStatus: "provider_approval_required" as const,
      positionView: {
        asOf: "2026-08-16T12:00:00.000Z",
        connections: [
          {
            id: "connection-synthetic",
            purpose: "source" as const,
            adapterType: "manual" as const,
            institutionKey: "manual",
            institutionLabel: "Manual holdings",
            lifecycleState: "active" as const,
            containers: [
              {
                id: "container-synthetic",
                label: "Direct holdings",
                kind: "brokerage" as const,
                taxTreatment: "taxable" as const,
                coverage: null,
                positions: [position],
              },
            ],
          },
        ],
      },
      exposureView: {
        asOf: "2026-08-16T12:00:00.000Z",
        positions: [
          {
            id: position.id,
            connectionId: "connection-synthetic",
            adapterType: "manual" as const,
            institutionKey: "manual",
            institutionLabel: "Manual holdings",
            connectionState: "active" as const,
            containerId: "container-synthetic",
            containerLabel: "Direct holdings",
            containerKind: "brokerage" as const,
            taxTreatment: "taxable" as const,
            coverage: null,
            legalVehicleName: position.legalVehicleName,
            openedOn: position.openedOn,
            reportedExposureName: null,
            positionKind: "direct" as const,
            ownershipBasis: "manual" as const,
            sourceLabel: "Synthetic review",
            sourceFreshness: "current" as const,
            snapshotId: "snapshot-different",
            snapshotFingerprint: fingerprint,
            observedAt,
            instrumentType: "common_stock",
            currency: "USD",
            ticker: null,
            quantityMicros: null,
            investedMinor: 10_000,
            committedMinor: 10_000,
            realizedValueMinor: 0,
            providerCostBasisMinor: null,
            isPrivateCompanyPosition: false,
            privateValueEstimate: null,
            mappings: [],
            mappedExposureIds: [],
            knownAllocationPpm: 0,
            hasUnknownAllocation: false,
            valueState: "reported" as const,
            valueMinor: 12_000,
            allocatedValueMinor: 0,
            unallocatedValueMinor: 12_000,
          },
        ],
        exposures: [],
      },
    };

    expect(InvestmentHoldingsViewSchema.safeParse(value).success).toBe(false);
    value.exposureView.positions[0]!.snapshotId = "snapshot-authoritative";
    expect(InvestmentHoldingsViewSchema.parse(value)).toEqual(value);
  });
});
