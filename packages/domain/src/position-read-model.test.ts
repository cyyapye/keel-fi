import { describe, expect, it } from "vitest";

import {
  investmentSourceFreshness,
  InvestmentPositionViewSchema,
} from "./position-read-model";

const basePosition = {
  id: "position_synthetic",
  legalVehicleName: "Synthetic Public Security",
  reportedExposureName: "Synthetic Public Security",
  kind: "direct" as const,
  openedOn: "2026-01-15",
  reviewStatus: "accepted" as const,
  acceptedAt: "2026-08-15T12:00:00.000Z",
  ownershipVersion: 1,
  ownershipBasis: "provider_provenance" as const,
  source: {
    label: "Synthetic Investments",
    effectiveDate: "2026-08-15",
    retrievedAt: "2026-08-15T11:50:00.000Z",
    freshness: "current" as const,
  },
  snapshot: {
    id: "snapshot_synthetic",
    fingerprint: "a".repeat(64),
    observedAt: "2026-08-15T11:45:00.000Z",
    providerStatus: "live" as const,
    investedMinor: 100_000,
    allocationMinor: 100_000,
    unrealizedValue: { state: "reported" as const, minor: 125_000 },
    realizedValueMinor: 0,
    netValue: { state: "reported" as const, minor: 125_000 },
    instrumentType: "equity",
    currency: "USD",
    quantityMicros: 1_000_000,
    ticker: "SYN",
    costBasisMinor: 100_000,
  },
};

describe("investment position view contract", () => {
  it("keeps connection, container, and legal-position identity separate", () => {
    const view = InvestmentPositionViewSchema.parse({
      asOf: "2026-08-16T12:00:00.000Z",
      connections: [
        {
          id: "connection_synthetic",
          purpose: "source",
          adapterType: "plaid-investments",
          institutionKey: "ins_synthetic",
          institutionLabel: "Synthetic Brokerage",
          lifecycleState: "active",
          containers: [
            {
              id: "container_taxable",
              label: "Synthetic Brokerage",
              kind: "brokerage",
              taxTreatment: "taxable",
              coverage: {
                completeness: "complete",
                observedAt: "2026-08-15T11:45:00.000Z",
                freshness: "current",
              },
              positions: [basePosition],
            },
            {
              id: "container_ira",
              label: "Synthetic IRA",
              kind: "ira",
              taxTreatment: "tax_exempt",
              coverage: null,
              positions: [
                {
                  ...basePosition,
                  id: "position_synthetic_ira",
                  snapshot: {
                    ...basePosition.snapshot,
                    id: "snapshot_synthetic_ira",
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(view.connections[0]?.containers).toHaveLength(2);
    expect(view.connections[0]?.purpose).toBe("source");
    expect(
      view.connections[0]?.containers.flatMap(
        (container) => container.positions,
      ),
    ).toHaveLength(2);
  });

  it("requires an explicit source or reviewed-history purpose", () => {
    const connection = {
      id: "connection_reviewed_history_synthetic",
      purpose: "reviewed_history" as const,
      adapterType: "manual" as const,
      institutionKey: "reviewed-history:manual",
      institutionLabel: "Reviewed holding history",
      lifecycleState: "pending" as const,
      containers: [],
    };
    expect(
      InvestmentPositionViewSchema.parse({
        asOf: "2026-08-16T12:00:00.000Z",
        connections: [connection],
      }).connections[0]?.purpose,
    ).toBe("reviewed_history");
    expect(
      InvestmentPositionViewSchema.safeParse({
        asOf: "2026-08-16T12:00:00.000Z",
        connections: [
          {
            id: connection.id,
            adapterType: connection.adapterType,
            institutionKey: connection.institutionKey,
            institutionLabel: connection.institutionLabel,
            lifecycleState: connection.lifecycleState,
            containers: connection.containers,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps locked and not-reported values unknown instead of zero", () => {
    for (const state of ["locked", "not_reported"] as const) {
      expect(() =>
        InvestmentPositionViewSchema.parse({
          asOf: "2026-08-16T12:00:00.000Z",
          connections: [
            {
              id: "connection_synthetic",
              purpose: "source",
              adapterType: "manual",
              institutionKey: "manual-synthetic",
              institutionLabel: "Synthetic Manual Holdings",
              lifecycleState: "active",
              containers: [
                {
                  id: "container_synthetic",
                  label: "Synthetic Entity",
                  kind: "entity",
                  taxTreatment: "unknown",
                  coverage: null,
                  positions: [
                    {
                      ...basePosition,
                      snapshot: {
                        ...basePosition.snapshot,
                        unrealizedValue: { state, minor: null },
                        netValue: { state, minor: null },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ).not.toThrow();
    }

    expect(() =>
      InvestmentPositionViewSchema.parse({
        asOf: "2026-08-16T12:00:00.000Z",
        connections: [
          {
            id: "connection_synthetic",
            purpose: "source",
            adapterType: "manual",
            institutionKey: "manual-synthetic",
            institutionLabel: "Synthetic Manual Holdings",
            lifecycleState: "active",
            containers: [
              {
                id: "container_synthetic",
                label: "Synthetic Entity",
                kind: "entity",
                taxTreatment: "unknown",
                coverage: null,
                positions: [
                  {
                    ...basePosition,
                    snapshot: {
                      ...basePosition.snapshot,
                      unrealizedValue: { state: "locked", minor: 0 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow(/reported state/u);
  });

  it("computes freshness from an explicit as-of time", () => {
    expect(
      investmentSourceFreshness(
        "2026-08-15T12:00:00.000Z",
        "2026-08-16T12:00:00.000Z",
      ),
    ).toBe("current");
    expect(
      investmentSourceFreshness(
        "2026-05-01T12:00:00.000Z",
        "2026-08-16T12:00:00.000Z",
      ),
    ).toBe("stale");
    expect(() =>
      investmentSourceFreshness(
        "2026-08-17T12:00:00.000Z",
        "2026-08-16T12:00:00.000Z",
      ),
    ).toThrow(/future/u);
  });
});
